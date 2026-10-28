import type { TradersLinkAiReadPayload } from "../live-watchlist/live-watchlist-types.js";
import { parseSimpleAnalysis } from "./watchlist-simple-content.js";
import { ownerTargetCoverage } from './watchlist-upside-coverage.js';
import { sortPullbacksByPrice } from "./pullback-price-order.js";

export const OWNER_ANALYSIS_SECTIONS = ["currentRead", "needsToHold", "cautionBelow", "momentumFailure", "mustClear", "breakoutContinuation", "targets", "downsideCheckpoints", "shallow", "deep", "failureRecovery", "catalystRealityCheck", "dilutionRisk", "listingStatus", "riskSummary"] as const;
type Shape = Record<string, "text" | "price">;
const level: Shape = { label: "text", price: "price", rationale: "text" };
const target: Shape = { label: "text", price: "price", condition: "text" };
const pullback: Shape = { zoneLow: "price", zoneHigh: "price", confirmationPrice: "price", confirmation: "text", rationale: "text" };
const recovery: Shape = { recoveryZoneLow: "price", recoveryZoneHigh: "price", firstReclaimPrice: "price", setupRestorePrice: "price", firstObjectivePrice: "price", rationale: "text" };

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("An edit must be an object.");
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string" || value.length > 8_000 || value.includes("\u0000")) throw new Error("Analysis text must be a string of at most 8,000 characters.");
  return value;
}
function shape(value: unknown, schema: Shape, allowNullPrices = true): Record<string, unknown> {
  const input = record(value);
  if (Object.keys(input).some((key) => !Object.hasOwn(schema, key))) throw new Error("Unexpected analysis field.");
  const output: Record<string, unknown> = {};
  for (const [key, kind] of Object.entries(schema)) {
    const item = input[key];
    if (kind === "text") output[key] = text(item);
    else {
      const nullable = allowNullPrices || key === "firstObjectivePrice";
      if (!(nullable && item === null) && !(typeof item === "number" && Number.isFinite(item) && item > 0)) throw new Error(`${key} must be a positive finite price${nullable ? " or null" : ""}.`);
      output[key] = item;
    }
  }
  return output;
}

/** Technical edit validation only. Trading inconsistencies are warnings, never
 * AI regeneration or an automatic rewrite of the owner's entered prices.
 */
export function applyOwnerAnalysisEdit(original: TradersLinkAiReadPayload, rawPatch: unknown): {
  payload: TradersLinkAiReadPayload; changedPaths: string[]; warnings: string[];
} {
  const patch = record(rawPatch);
  if (original.analysisFormat === "simple") {
    if (Object.keys(patch).some(key=>!["simpleAnalysis","ownerHiddenSections","catalystRealityCheck","riskSummary"].includes(key)))
      throw new Error("Only Simple analysis sections can be edited in this format.");
    const simpleAnalysis = parseSimpleAnalysis(patch.simpleAnalysis ?? original.simpleAnalysis);
    if (!simpleAnalysis) throw new Error("Complete the Simple analysis prices and text before saving.");
    simpleAnalysis.pullbacks = sortPullbacksByPrice(simpleAnalysis.pullbacks.map((plan,index)=>({...plan,
      hidden:plan.hidden ?? (original.ownerHiddenSections ?? []).includes(index===0?"shallow":index===1?"deep":"")})));
    const hidden = patch.ownerHiddenSections ?? original.ownerHiddenSections ?? [];
    if (!Array.isArray(hidden) || hidden.some(key=>!["currentRead","shallow","deep","targets","momentumFailure","breakoutContinuation","catalystRealityCheck","riskSummary"].includes(key)))
      throw new Error("Invalid hidden Simple analysis section.");
    if (patch.simpleAnalysis && record(patch.simpleAnalysis).breakout != null) {
      const breakout = record(record(patch.simpleAnalysis).breakout);
      shape(breakout, {price:"price",explanation:"text",confirmation:"text"}, false);
    }
    const catalyst = patch.catalystRealityCheck === undefined ? original.catalystRealityCheck : {
      ...original.catalystRealityCheck, ...shape(patch.catalystRealityCheck, {summary:"text",dayTradeRelevance:"text"}) };
    const risks = patch.riskSummary ?? original.riskSummary;
    if (!Array.isArray(risks) || risks.length > 20) throw new Error("At most 20 risk notes are supported.");
    const payload = { ...structuredClone(original), catalystRealityCheck:catalyst, riskSummary:risks.map(text), simpleAnalysis, ownerHiddenSections:[...new Set(hidden)],
      currentRead:simpleAnalysis.setup,
      breakoutContinuation:{label:"Breakout",price:simpleAnalysis.breakout?.price ?? null,
        rationale:simpleAnalysis.breakout ? [simpleAnalysis.breakout.explanation,simpleAnalysis.breakout.confirmation].filter(Boolean).join(" ") : ""},
      momentumFailure:{label:"Thesis invalidation",price:simpleAnalysis.invalidation?.price ?? null,rationale:simpleAnalysis.invalidation?.explanation ?? ""},
      targets:simpleAnalysis.upside.map(area=>({label:"",price:area.high,condition:area.explanation})),
    };
    const warnings = simpleAnalysis.pullbacks.flatMap(area=>area.low > area.high ? ["A pullback low is above its high."] : []);
    payload.upsideCoverage = ownerTargetCoverage(original,payload);
    return {payload, warnings, changedPaths:Object.keys(patch).filter(key=>
      JSON.stringify(patch[key]) !== JSON.stringify((original as unknown as Record<string,unknown>)[key]))};
  }
  const result = structuredClone(original);
  const output = result as unknown as Record<string, unknown>;
  const changedPaths: string[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (key === "currentRead") output[key] = text(value);
    else if (key === "bias" || key === "confidence") {
      const allowed = key === "bias" ? ["bullish", "neutral", "bearish", "mixed"] : ["low", "medium", "high"];
      if (typeof value !== "string" || !allowed.includes(value)) throw new Error(`Invalid ${key}.`);
      output[key] = value;
    } else if (["needsToHold", "cautionBelow", "momentumFailure", "mustClear", "breakoutContinuation"].includes(key)) output[key] = shape(value, level);
    else if (key === "targets" || key === "downsideCheckpoints") {
      if (!Array.isArray(value) || (key === "downsideCheckpoints" && value.length > 20)) throw new Error("Invalid analysis levels.");
      output[key] = value.map((item) => shape(item, target));
    } else if (key === "ownerPullbacks") {
      if (!Array.isArray(value)) throw new Error("Pullbacks must be a list.");
      result.ownerPullbacks = sortPullbacksByPrice(value.map(item => {
        const input = { ...record(item) };
        const hidden = input.hidden;
        if (hidden !== undefined && typeof hidden !== "boolean") throw new Error("Invalid pullback visibility.");
        delete input.hidden;
        delete input.invalidationPrice; delete input.firstObjectivePrice; delete input.evidenceIds;
        return { ...shape(input,pullback,false), invalidationPrice:null, firstObjectivePrice:null, evidenceIds:[],
          ...(hidden === undefined ? {} : {hidden}) } as unknown as NonNullable<TradersLinkAiReadPayload["ownerPullbacks"]>[number];
      }),"zoneLow","zoneHigh");
    } else if (key === "pullbackPlans") {
      const plans = record(value);
      if (Object.keys(plans).some((name) => name !== "shallow" && name !== "deep")) throw new Error("Unexpected pullback field.");
      for (const name of ["shallow", "deep"] as const) {
        if (!Object.hasOwn(plans, name)) continue;
        // Retired fields from older editor windows remain readable but are no longer edited.
        const activePlan = plans[name] === null ? null : { ...record(plans[name]) };
        if (activePlan) { delete activePlan.invalidationPrice; delete activePlan.firstObjectivePrice; }
        result.pullbackPlans[name] = activePlan === null ? null : {
          ...shape(activePlan, pullback, false), invalidationPrice: original.pullbackPlans[name]?.invalidationPrice ?? null, firstObjectivePrice: original.pullbackPlans[name]?.firstObjectivePrice ?? null, evidenceIds: [],
        } as unknown as NonNullable<TradersLinkAiReadPayload["pullbackPlans"]["shallow"]>;
      }
    } else if (key === "failureRecovery") output[key] = value === null ? null : { ...shape(value, recovery, false), evidenceIds: [] };
    else if (key === "riskSummary") {
      if (!Array.isArray(value) || value.length > 20) throw new Error("At most 20 risk notes are supported.");
      output[key] = value.map(text);
    } else if (["catalystRealityCheck", "dilutionRisk", "listingStatus"].includes(key)) {
      const fields = shape(value, { summary: "text", dayTradeRelevance: "text" });
      output[key] = { ...record(output[key]), ...fields };
    } else if (key === "ownerHiddenSections") {
      if (!Array.isArray(value) || value.some((item) => !OWNER_ANALYSIS_SECTIONS.includes(item))) throw new Error("Invalid hidden analysis section.");
      output[key] = [...new Set(value)];
    } else throw new Error(`${key} is generation provenance, not an editable analysis field.`);
    if (JSON.stringify(output[key]) !== JSON.stringify((original as unknown as Record<string, unknown>)[key])) changedPaths.push(key);
  }
  result.upsideCoverage = ownerTargetCoverage(original,result);
  const warnings: string[] = [];
  for (const [name, plan] of Object.entries(result.ownerPullbacks ?? result.pullbackPlans)) {
    if (!plan) continue;
    if (plan.zoneLow > plan.zoneHigh) warnings.push(`${name} pullback low is above its high.`);
    if (plan.invalidationPrice != null && plan.invalidationPrice >= plan.zoneLow) warnings.push(`${name} pullback invalidation is at or above its zone.`);
    if (plan.zoneHigh >= result.currentPrice) warnings.push(`${name} pullback is not below the analysis reference price.`);
  }
  if (result.needsToHold.price !== null && result.momentumFailure.price !== null && result.momentumFailure.price > result.needsToHold.price) warnings.push("Momentum failure is above the needs-to-hold price.");
  const breakout = result.breakoutContinuation?.price;
  const mustClear = result.mustClear?.price;
  if (breakout != null && breakout < result.currentPrice) warnings.push("Breakout continuation is below the analysis reference price.");
  if (breakout != null && mustClear != null && breakout <= mustClear) warnings.push("Breakout continuation is at or below the must-clear price.");
  let priorUpside = result.currentPrice;
  for (const point of result.targets ?? []) {
    if (point.price === null) continue;
    if (point.price <= priorUpside) warnings.push("An upside level is at or below the preceding upside level or analysis reference price.");
    priorUpside = point.price;
  }
  return { payload: result, changedPaths, warnings };
}
