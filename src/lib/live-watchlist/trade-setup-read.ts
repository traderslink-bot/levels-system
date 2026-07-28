import type { ChartThesisRead } from "../alerts/alert-types.js";
import { explainFormalBosChochGate } from "../monitoring/market-structure-story-memory.js";
import type {
  RuntimeMarketStructureSnapshot,
  StableMarketStructureRuntimeContext,
} from "../monitoring/monitoring-types.js";
import type { TechnicalContext } from "../technical-context/technical-context-types.js";
import type {
  LiveWatchlistLevelMap,
  LiveWatchlistLevelMapLevel,
  LiveWatchlistReferenceLevel,
} from "./live-watchlist-types.js";
import type { LiveWatchlistPullbackVolumeRead } from "./pullback-read.js";

export const LIVE_WATCHLIST_TRADE_SETUP_READ_MODE_ENV =
  "LIVE_WATCHLIST_TRADE_SETUP_READ_MODE";

export type LiveWatchlistTradeSetupReadMode = "off" | "observe" | "active";

export type LiveWatchlistTradeSetupState =
  | "no_trade"
  | "forming"
  | "armed"
  | "triggered"
  | "extended_risk"
  | "failed";

export type LiveWatchlistTradeSetupZone = {
  low: number;
  high: number;
  score: number;
  categories: string[];
  evidence: string[];
};

export type LiveWatchlistTradeSetupTarget = {
  price: number;
  basis: string;
  rewardRiskRatio: number;
};

export type LiveWatchlistTradeSetupRead = {
  setupType: ChartThesisRead["type"] | "none";
  setupLabel: string;
  state: LiveWatchlistTradeSetupState;
  confidence: "high" | "medium" | "low";
  actionable: boolean;
  zone: LiveWatchlistTradeSetupZone | null;
  triggerPrice: number | null;
  triggerCondition: string | null;
  invalidationPrice: number | null;
  invalidationCondition: string | null;
  targets: LiveWatchlistTradeSetupTarget[];
  plannedRiskPct: number | null;
  firstTargetRewardRiskRatio: number | null;
  blockers: string[];
  evidence: string[];
  body: string;
  metadata: Record<string, string | number | boolean | null>;
};

export type LiveWatchlistTradeSetupReadInput = {
  symbol: string;
  currentPrice: number;
  evaluatedAt: number;
  thesis: ChartThesisRead | null | undefined;
  levelMap: LiveWatchlistLevelMap | null;
  technicalContext: TechnicalContext | null | undefined;
  marketStructure?: RuntimeMarketStructureSnapshot | null;
  volumeRead?: LiveWatchlistPullbackVolumeRead | null;
  bidPrice?: number | null;
  askPrice?: number | null;
};

type ZoneEvidenceCategory =
  | "thesis"
  | "price_action"
  | "structure"
  | "dynamic";

type ZoneCandidate = {
  price: number;
  low: number;
  high: number;
  category: ZoneEvidenceCategory;
  weight: number;
  label: string;
};

type TargetCandidate = {
  price: number;
  basis: string;
  priority: number;
  kind: "chart" | "session" | "structure";
};

type UpsideBarrierCandidate = {
  price: number;
  basis: string;
};

type TradeSetupMarketStructureContext = {
  bias: "bullish" | "bearish" | "mixed" | "neutral" | "unavailable";
  supportiveEvidence: string[];
  blockers: string[];
  line: string | null;
  actionableFormalTimeframes: string[];
  stable5mState: StableMarketStructureRuntimeContext["state"] | null;
  tacticalFormalMetadataOnly: boolean;
};

const MIN_ZONE_CATEGORY_COUNT = 2;
const MIN_FIRST_TARGET_REWARD_RISK = 1.5;
const MAX_LOW_PRICE_SETUP_RISK_PCT = 18;
const MAX_HIGH_PRICE_SETUP_RISK_PCT = 12;
const HIGH_PRICE_THRESHOLD = 10;
const MAX_LOW_PRICE_ENTRY_EXTENSION_PCT = 14;
const MAX_HIGH_PRICE_ENTRY_EXTENSION_PCT = 9;

const CONTINUATION_TYPES = new Set<ChartThesisRead["type"]>([
  "momentum_expansion_continuation",
  "catalyst_active_runner_continuation",
  "cleared_shelf_power_continuation",
  "controlled_range_breakout",
  "small_cap_first_pullback",
  "small_cap_opening_range_retest",
  "small_cap_vwap_reclaim",
  "small_cap_flush_reclaim",
  "small_cap_intraday_base_breakout",
]);

function normalizeMode(value: string | undefined): LiveWatchlistTradeSetupReadMode {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "active" || normalized === "on" || normalized === "1" || normalized === "true") {
    return "active";
  }
  if (normalized === "off" || normalized === "0" || normalized === "false") {
    return "off";
  }
  return "observe";
}

export function resolveLiveWatchlistTradeSetupReadMode(
  env: NodeJS.ProcessEnv = process.env,
): LiveWatchlistTradeSetupReadMode {
  return normalizeMode(env[LIVE_WATCHLIST_TRADE_SETUP_READ_MODE_ENV]);
}

function formatPrice(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "n/a";
  }
  return value >= 1 ? value.toFixed(2) : value.toFixed(4);
}

function formatPct(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "n/a";
  }
  return `${value.toFixed(1)}%`;
}

function formatRatio(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "n/a";
  }
  return `${value.toFixed(1)}R`;
}

function priceDistancePct(left: number, right: number): number {
  return Math.abs(left - right) / Math.max(Math.abs(left), Math.abs(right), 0.0001);
}

function strengthWeight(level: LiveWatchlistLevelMapLevel): number {
  switch (level.strengthLabel) {
    case "major":
      return 4.5;
    case "strong":
      return 3.75;
    case "moderate":
      return 2.5;
    case "weak":
      return 1;
    default:
      return 1.5;
  }
}

function structuralSourceBonus(level: LiveWatchlistLevelMapLevel): number {
  if (/daily confluence/i.test(level.sourceLabel ?? "")) return 1.5;
  if (/daily|4h confluence/i.test(level.sourceLabel ?? "")) return 1;
  if (/4h|structure|breakout|continuation/i.test(level.sourceLabel ?? "")) return 0.5;
  return 0;
}

function levelReactionQualityBonus(level: LiveWatchlistLevelMapLevel): number {
  let bonus = 0;
  if (typeof level.reactionQualityScore === "number") {
    if (level.reactionQualityScore >= 0.7) bonus += 1.25;
    else if (level.reactionQualityScore < 0.58) bonus -= 0.75;
  }
  if (typeof level.rejectionScore === "number") {
    if (level.rejectionScore >= 0.48) bonus += 0.5;
    else if (level.rejectionScore < 0.35) bonus -= 0.5;
  }
  if (typeof level.displacementScore === "number") {
    if (level.displacementScore >= 0.65) bonus += 0.5;
    else if (level.displacementScore < 0.3) bonus -= 0.25;
  }
  if (typeof level.sessionSignificanceScore === "number" && level.sessionSignificanceScore >= 0.6) {
    bonus += 0.35;
  }
  if (typeof level.confluenceCount === "number" && level.confluenceCount >= 2) {
    bonus += Math.min(1, (level.confluenceCount - 1) * 0.35);
  }
  if (typeof level.sourceEvidenceCount === "number" && level.sourceEvidenceCount >= 2) {
    bonus += Math.min(0.75, (level.sourceEvidenceCount - 1) * 0.25);
  }
  if (typeof level.touchCount === "number") {
    if (level.touchCount >= 2 && level.touchCount <= 4) {
      bonus += 0.35;
    } else if (level.touchCount >= 5 && (level.rejectionScore ?? 0) < 0.45) {
      bonus -= 1.25;
    }
  }
  return bonus;
}

function levelReactionQualityLabel(level: LiveWatchlistLevelMapLevel): string | null {
  if (
    (level.reactionQualityScore ?? 0) >= 0.7 &&
    (level.rejectionScore ?? 0) >= 0.48
  ) {
    return "reaction-backed";
  }
  if ((level.touchCount ?? 0) >= 5 && (level.rejectionScore ?? 0) < 0.45) {
    return "heavily retested";
  }
  if (typeof level.reactionQualityScore === "number" && level.reactionQualityScore < 0.58) {
    return "weak reaction history";
  }
  return null;
}

function provenanceBonus(
  level: LiveWatchlistLevelMapLevel,
  evaluatedAt: number,
): number {
  const provenance = level.marketDataProvenance;
  const timestamp = provenance?.lastConfirmedAt ?? provenance?.lastTestedAt;
  if (timestamp === undefined || !Number.isFinite(timestamp)) {
    return 0;
  }
  const ageDays = Math.max(0, evaluatedAt - timestamp) / 86_400_000;
  if (provenance?.lastConfirmedAt !== undefined && ageDays <= 7) return 1.5;
  if (ageDays <= 7) return 1;
  if (ageDays <= 30) return 0.5;
  return 0;
}

function addZoneCandidate(
  candidates: ZoneCandidate[],
  input: Omit<ZoneCandidate, "low" | "high"> & { low?: number; high?: number },
  currentPrice: number,
): void {
  if (!Number.isFinite(input.price) || input.price <= 0 || input.price > currentPrice * 1.01) {
    return;
  }
  const distancePct = (currentPrice - input.price) / Math.max(currentPrice, 0.0001);
  if (distancePct > 0.3) {
    return;
  }
  candidates.push({
    ...input,
    low: typeof input.low === "number" && input.low > 0 ? input.low : input.price,
    high: typeof input.high === "number" && input.high > 0 ? input.high : input.price,
  });
}

function referenceCategory(reference: LiveWatchlistReferenceLevel): ZoneEvidenceCategory {
  return reference.kind === "dynamic" ? "dynamic" : "structure";
}

function buildZoneCandidates(input: LiveWatchlistTradeSetupReadInput): ZoneCandidate[] {
  const candidates: ZoneCandidate[] = [];
  const thesis = input.thesis;
  if (thesis) {
    const trigger = thesis.triggerHigh ?? thesis.triggerLow;
    if (typeof trigger === "number") {
      addZoneCandidate(candidates, {
        price: trigger,
        category: "thesis",
        weight: 5,
        label: `${thesis.label} trigger ${formatPrice(trigger)}`,
      }, input.currentPrice);
    }
    if (typeof thesis.buyerResponseLow === "number") {
      addZoneCandidate(candidates, {
        price: thesis.buyerResponseLow,
        category: "price_action",
        weight: 4.5,
        label: `buyer-response low ${formatPrice(thesis.buyerResponseLow)}`,
      }, input.currentPrice);
    }
  }

  for (const level of input.levelMap?.supportLevels ?? []) {
    const reactionQualityLabel = levelReactionQualityLabel(level);
    addZoneCandidate(candidates, {
      price: level.price,
      low: level.lowPrice,
      high: level.highPrice,
      category: "structure",
      weight: Math.max(
        0.5,
        strengthWeight(level) +
        structuralSourceBonus(level) +
        provenanceBonus(level, input.evaluatedAt) +
        levelReactionQualityBonus(level),
      ),
      label: [
        `${level.strengthLabel ?? "mapped"} ${level.sourceLabel ?? "structure"} ${formatPrice(level.price)}`,
        reactionQualityLabel,
      ].filter((value): value is string => Boolean(value)).join(", "),
    }, input.currentPrice);
  }

  const dynamicCandidates: Array<[string, number | null | undefined]> = [
    ["VWAP", input.technicalContext?.vwap],
    ["EMA9", input.technicalContext?.ema9],
    ["EMA20", input.technicalContext?.ema20],
  ];
  for (const [label, price] of dynamicCandidates) {
    if (typeof price === "number") {
      addZoneCandidate(candidates, {
        price,
        category: "dynamic",
        weight: label === "VWAP" ? 2.5 : 1.75,
        label: `${label} ${formatPrice(price)}`,
      }, input.currentPrice);
    }
  }

  for (const reference of input.levelMap?.referenceLevels ?? []) {
    if (reference.key === "vwap") {
      continue;
    }
    addZoneCandidate(candidates, {
      price: reference.price,
      category: referenceCategory(reference),
      weight: reference.kind === "session" ? 2.75 : 2,
      label: `${reference.label} ${formatPrice(reference.price)}`,
    }, input.currentPrice);
  }

  return candidates;
}

function buildBestTradeZone(input: LiveWatchlistTradeSetupReadInput): LiveWatchlistTradeSetupZone | null {
  const candidates = buildZoneCandidates(input);
  if (candidates.length === 0) {
    return null;
  }
  const clusterTolerancePct = input.currentPrice < 1 ? 0.035 : input.currentPrice < 10 ? 0.025 : 0.018;
  const clusters = candidates.map((seed) =>
    candidates.filter((candidate) => priceDistancePct(candidate.price, seed.price) <= clusterTolerancePct),
  );
  const ranked = clusters
    .map((cluster) => {
      const bestByCategory = new Map<ZoneEvidenceCategory, ZoneCandidate>();
      for (const candidate of cluster) {
        const incumbent = bestByCategory.get(candidate.category);
        if (!incumbent || candidate.weight > incumbent.weight) {
          bestByCategory.set(candidate.category, candidate);
        }
      }
      const categories = [...bestByCategory.keys()];
      const score = [...bestByCategory.values()].reduce((sum, item) => sum + item.weight, 0);
      const weightedPrice = cluster.reduce((sum, item) => sum + item.price * item.weight, 0) /
        Math.max(cluster.reduce((sum, item) => sum + item.weight, 0), 0.0001);
      return { cluster, categories, score, weightedPrice };
    })
    .filter((cluster) => cluster.categories.length >= MIN_ZONE_CATEGORY_COUNT)
    .sort((left, right) =>
      right.score - left.score ||
      Math.abs(input.currentPrice - left.weightedPrice) - Math.abs(input.currentPrice - right.weightedPrice),
    );
  const best = ranked[0];
  if (!best) {
    return null;
  }

  const tickSize = input.currentPrice < 1 ? 0.0001 : 0.01;
  const edgeBuffer = Math.max(tickSize * 2, input.currentPrice * 0.0025);
  const low = Math.max(tickSize, Math.min(...best.cluster.map((item) => item.low)) - edgeBuffer);
  const high = Math.min(input.currentPrice * 1.01, Math.max(...best.cluster.map((item) => item.high)) + edgeBuffer);
  return {
    low,
    high,
    score: Number(best.score.toFixed(2)),
    categories: best.categories,
    evidence: [...new Set(best.cluster.map((item) => item.label))],
  };
}

function isMeaningfulTargetLevel(level: LiveWatchlistLevelMapLevel): boolean {
  return (
    level.strengthLabel === "major" ||
    level.strengthLabel === "strong" ||
    /daily|4h|confluence|structure|extension/i.test(level.sourceLabel ?? "")
  );
}

function isHighQualityStructuralTarget(level: LiveWatchlistLevelMapLevel): boolean {
  const structuralSource = /daily|4h|confluence|structure/i.test(level.sourceLabel ?? "");
  const qualityEvidence =
    level.strengthLabel === "major" ||
    level.strengthLabel === "strong" ||
    (level.reactionQualityScore ?? 0) >= 0.68 ||
    (level.confluenceCount ?? 0) >= 2 ||
    (level.sourceEvidenceCount ?? 0) >= 2;
  return structuralSource && qualityEvidence;
}

function addTargetCandidate(
  candidates: TargetCandidate[],
  price: number | null | undefined,
  basis: string,
  priority: number,
  kind: TargetCandidate["kind"],
  entryPrice: number,
): void {
  if (typeof price !== "number" || !Number.isFinite(price) || price <= entryPrice) {
    return;
  }
  const duplicate = candidates.find((candidate) => priceDistancePct(candidate.price, price) <= 0.015);
  if (!duplicate) {
    candidates.push({ price, basis, priority, kind });
  } else if (priority > duplicate.priority) {
    duplicate.price = price;
    duplicate.basis = basis;
    duplicate.priority = priority;
    duplicate.kind = kind;
  }
}

function buildTargetCandidates(
  input: LiveWatchlistTradeSetupReadInput,
  entryPrice: number,
): TargetCandidate[] {
  const candidates: TargetCandidate[] = [];
  addTargetCandidate(
    candidates,
    input.thesis?.targetLow,
    `${input.thesis?.label ?? "chart"} target`,
    6,
    "chart",
    entryPrice,
  );
  if (
    typeof input.thesis?.targetHigh === "number" &&
    (
      typeof input.thesis.targetLow !== "number" ||
      input.thesis.targetHigh >= input.thesis.targetLow * 1.05
    )
  ) {
    addTargetCandidate(
      candidates,
      input.thesis.targetHigh,
      `${input.thesis.label} target extension`,
      6,
      "chart",
      entryPrice,
    );
  }
  for (const reference of input.levelMap?.referenceLevels ?? []) {
    if (!(["hod", "pmh", "pdh"] as const).includes(reference.key as "hod" | "pmh" | "pdh")) continue;
    addTargetCandidate(candidates, reference.price, reference.label, 4, "session", entryPrice);
  }
  const chartTargets = candidates.filter((candidate) => candidate.kind === "chart");
  for (const level of input.levelMap?.resistanceLevels ?? []) {
    if (
      isMeaningfulTargetLevel(level) &&
      (
        isHighQualityStructuralTarget(level) ||
        chartTargets.some((candidate) => priceDistancePct(candidate.price, level.price) <= 0.04)
      )
    ) {
      const alignedWithChart = chartTargets.some((candidate) =>
        priceDistancePct(candidate.price, level.price) <= 0.04
      );
      addTargetCandidate(
        candidates,
        level.price,
        alignedWithChart
          ? `${level.sourceLabel ?? level.strengthLabel ?? "mapped resistance"} aligned with chart objective`
          : `${level.sourceLabel ?? level.strengthLabel ?? "mapped resistance"} structural objective`,
        alignedWithChart ? 5 : 3,
        "structure",
        entryPrice,
      );
    }
  }
  return candidates.sort((left, right) => left.price - right.price || right.priority - left.priority);
}

function addUpsideBarrier(
  barriers: UpsideBarrierCandidate[],
  price: number | null | undefined,
  basis: string,
  entryPrice: number,
): void {
  if (typeof price !== "number" || !Number.isFinite(price) || price <= entryPrice) return;
  const duplicate = barriers.find((candidate) => priceDistancePct(candidate.price, price) <= 0.0125);
  if (!duplicate) barriers.push({ price, basis });
}

function buildUpsideBarriers(
  input: LiveWatchlistTradeSetupReadInput,
  entryPrice: number,
  targetCandidates: TargetCandidate[],
): UpsideBarrierCandidate[] {
  const barriers: UpsideBarrierCandidate[] = [];
  for (const level of input.levelMap?.resistanceLevels ?? []) {
    addUpsideBarrier(
      barriers,
      level.price,
      level.sourceLabel ?? level.label ?? "mapped resistance",
      entryPrice,
    );
  }
  for (const reference of input.levelMap?.referenceLevels ?? []) {
    if (reference.key === "vwap") continue;
    addUpsideBarrier(barriers, reference.price, reference.label, entryPrice);
  }
  for (const target of targetCandidates) {
    addUpsideBarrier(barriers, target.price, target.basis, entryPrice);
  }
  return barriers.sort((left, right) => left.price - right.price);
}

function spreadPct(input: LiveWatchlistTradeSetupReadInput): number | null {
  if (
    typeof input.bidPrice !== "number" ||
    typeof input.askPrice !== "number" ||
    input.bidPrice <= 0 ||
    input.askPrice < input.bidPrice
  ) {
    return null;
  }
  return ((input.askPrice - input.bidPrice) / Math.max(input.currentPrice, 0.0001)) * 100;
}

function lowerConfidence(
  confidence: LiveWatchlistTradeSetupRead["confidence"],
): LiveWatchlistTradeSetupRead["confidence"] {
  if (confidence === "high") return "medium";
  return "low";
}

const BULLISH_STABLE_5M_STATES = new Set<StableMarketStructureRuntimeContext["state"]>([
  "breakout_holding",
  "reclaim_confirmed",
  "higher_lows_intact",
  "trend_intact",
  "pressing_range_high",
]);

const BEARISH_STABLE_5M_STATES = new Set<StableMarketStructureRuntimeContext["state"]>([
  "pivot_lost",
  "trend_damaged",
  "failed_breakout",
]);

function readableStructureState(state: StableMarketStructureRuntimeContext["state"]): string {
  return state.replace(/_/g, " ");
}

function readableFormalEvent(eventType: string): string {
  if (eventType === "bos_bullish") return "bullish BOS";
  if (eventType === "bos_bearish") return "bearish BOS";
  if (eventType === "choch_bullish") return "bullish CHOCH";
  if (eventType === "choch_bearish") return "bearish CHOCH";
  return eventType.replace(/_/g, " ");
}

function interpretMarketStructure(
  snapshot: RuntimeMarketStructureSnapshot | null | undefined,
): TradeSetupMarketStructureContext {
  if (!snapshot) {
    return {
      bias: "unavailable",
      supportiveEvidence: [],
      blockers: [],
      line: null,
      actionableFormalTimeframes: [],
      stable5mState: null,
      tacticalFormalMetadataOnly: false,
    };
  }

  const bullishFormal: string[] = [];
  const bearishFormal: string[] = [];
  const actionableFormalTimeframes: string[] = [];
  for (const timeframe of ["daily", "4h"] as const) {
    const context = snapshot.timeframes?.[timeframe];
    const formal = context?.formal;
    const gate = explainFormalBosChochGate(timeframe, formal, context);
    if (!gate.actionable || !formal) {
      continue;
    }
    actionableFormalTimeframes.push(timeframe);
    const label = `${timeframe} ${readableFormalEvent(formal.eventType)}`;
    if (formal.eventType.endsWith("_bullish")) {
      bullishFormal.push(label);
    } else if (formal.eventType.endsWith("_bearish")) {
      bearishFormal.push(label);
    }
  }

  const tactical = snapshot.timeframes?.["5m"] ?? {
    stable: snapshot.stable,
    formal: snapshot.formal,
  };
  const stable5m = tactical.stable;
  const stable5mInfluential = stable5m?.materialChange === true && stable5m.confidence === "high";
  const bullishStable5m = Boolean(
    stable5mInfluential && stable5m && BULLISH_STABLE_5M_STATES.has(stable5m.state),
  );
  const bearishStable5m = Boolean(
    stable5mInfluential && stable5m && BEARISH_STABLE_5M_STATES.has(stable5m.state),
  );
  const tacticalFormalMetadataOnly = tactical.formal !== undefined &&
    !explainFormalBosChochGate("5m", tactical.formal, tactical).actionable;
  const supportiveEvidence: string[] = [
    ...bullishFormal.map((label) => `fresh ${label} supports the long thesis`),
    ...(bullishStable5m && stable5m
      ? [`high-confidence 5m ${readableStructureState(stable5m.state)} supports buyer control`]
      : []),
  ];
  const blockers: string[] = [];
  if (bullishFormal.length > 0 && bearishFormal.length > 0) {
    blockers.push(
      `fresh higher-timeframe structure conflicts (${[...bullishFormal, ...bearishFormal].join(" versus ")})`,
    );
  } else if (bearishFormal.length > 0) {
    blockers.push(`fresh ${bearishFormal.join(" and ")} conflicts with this long setup`);
  }
  if (bearishStable5m && stable5m) {
    blockers.push(
      `high-confidence 5m structure just shifted to ${readableStructureState(stable5m.state)}`,
    );
  }

  const structureParts: string[] = [];
  if (bullishFormal.length > 0) {
    structureParts.push(`fresh ${bullishFormal.join(" and ")} supports the long thesis`);
  }
  if (bearishFormal.length > 0) {
    structureParts.push(`fresh ${bearishFormal.join(" and ")} is bearish for the long thesis`);
  }
  if (bullishStable5m && stable5m) {
    structureParts.push(`5m ${readableStructureState(stable5m.state)} confirms buyer control`);
  } else if (bearishStable5m && stable5m) {
    structureParts.push(`5m ${readableStructureState(stable5m.state)} says wait for repair`);
  }

  const hasBullish = bullishFormal.length > 0 || bullishStable5m;
  const hasBearish = bearishFormal.length > 0 || bearishStable5m;
  return {
    bias: hasBullish && hasBearish
      ? "mixed"
      : hasBullish
        ? "bullish"
        : hasBearish
          ? "bearish"
          : "neutral",
    supportiveEvidence,
    blockers,
    line: structureParts.length > 0
      ? `Market structure context: ${structureParts.join("; ")}.`
      : null,
    actionableFormalTimeframes,
    stable5mState: stable5m?.state ?? null,
    tacticalFormalMetadataOnly,
  };
}

function baseState(
  input: LiveWatchlistTradeSetupReadInput,
  zone: LiveWatchlistTradeSetupZone,
  triggerPrice: number,
): LiveWatchlistTradeSetupState {
  const thesis = input.thesis!;
  const tapeTimestamp = thesis.activeRunnerTape?.latestCandleAt;
  const tapeAgeMs = typeof tapeTimestamp === "number"
    ? input.evaluatedAt - tapeTimestamp
    : Number.POSITIVE_INFINITY;
  const freshTape = tapeAgeMs >= -120_000 && tapeAgeMs <= 20 * 60_000;
  if (typeof thesis.invalidationLevel === "number" && input.currentPrice <= thesis.invalidationLevel) {
    return "failed";
  }
  if (freshTape && thesis.activeRunnerTape?.classification === "extended_chase_risk") {
    return "extended_risk";
  }
  if (input.currentPrice < triggerPrice) {
    const triggerDistancePct = ((triggerPrice - input.currentPrice) / Math.max(input.currentPrice, 0.0001)) * 100;
    return thesis.status === "early" || triggerDistancePct > 5 ? "forming" : "armed";
  }
  const extensionPct = ((input.currentPrice - zone.high) / Math.max(zone.high, 0.0001)) * 100;
  const maxExtension = input.currentPrice >= HIGH_PRICE_THRESHOLD
    ? MAX_HIGH_PRICE_ENTRY_EXTENSION_PCT
    : MAX_LOW_PRICE_ENTRY_EXTENSION_PCT;
  if (extensionPct > maxExtension) {
    return "extended_risk";
  }
  if (
    thesis.status === "active" &&
    freshTape &&
    (
      thesis.activeRunnerTape?.structure === "holding_near_term_hold" ||
      thesis.activeRunnerTape?.structure === "upper_range_control"
    )
  ) {
    return "triggered";
  }
  return "armed";
}

function noTradeRead(
  input: LiveWatchlistTradeSetupReadInput,
  blockers: string[],
  thesis: ChartThesisRead | null | undefined = input.thesis,
): LiveWatchlistTradeSetupRead {
  const normalizedBlockers = blockers.length > 0 ? blockers : ["no coherent chart setup is currently confirmed"];
  const body = [
    `${input.symbol.toUpperCase()} Trade Setup — No actionable long setup`,
    thesis ? `Setup under review: ${thesis.label} (${thesis.timeframe}, ${thesis.confidence} confidence).` : null,
    `Reason: ${normalizedBlockers.join("; ")}.`,
    "Wait for a defensible trade zone and buyer confirmation instead of treating the nearest level as an entry.",
  ].filter((line): line is string => Boolean(line)).join("\n");
  return {
    setupType: thesis?.type ?? "none",
    setupLabel: thesis?.label ?? "No coherent setup",
    state: "no_trade",
    confidence: thesis?.confidence ?? "low",
    actionable: false,
    zone: null,
    triggerPrice: thesis?.triggerHigh ?? thesis?.triggerLow ?? null,
    triggerCondition: null,
    invalidationPrice: thesis?.invalidationLevel ?? null,
    invalidationCondition: null,
    targets: [],
    plannedRiskPct: null,
    firstTargetRewardRiskRatio: null,
    blockers: normalizedBlockers,
    evidence: thesis?.evidence ?? [],
    body,
    metadata: {
      tradeSetupState: "no_trade",
      tradeSetupStateBeforeBlockers: null,
      tradeSetupType: thesis?.type ?? "none",
      tradeSetupActionable: false,
      tradeSetupBlockerCount: normalizedBlockers.length,
      tradeSetupPrimaryBlocker: normalizedBlockers[0] ?? null,
    },
  };
}

export function buildLiveWatchlistTradeSetupRead(
  input: LiveWatchlistTradeSetupReadInput,
): LiveWatchlistTradeSetupRead {
  if (!Number.isFinite(input.currentPrice) || input.currentPrice <= 0) {
    return noTradeRead(input, ["current price is unavailable"]);
  }
  const thesis = input.thesis;
  if (!thesis) {
    return noTradeRead(input, ["no candle-based setup passed the chart-thesis gate"]);
  }
  if (thesis.confidence === "low") {
    return noTradeRead(input, ["the best candle-based setup is still low confidence"], thesis);
  }

  const zone = buildBestTradeZone(input);
  if (!zone) {
    return noTradeRead(input, ["no dip area has confirmation from two independent evidence categories"], thesis);
  }

  const thesisTrigger = thesis.triggerHigh ?? thesis.triggerLow;
  const triggerPrice =
    typeof thesisTrigger === "number" && thesisTrigger > input.currentPrice
      ? thesisTrigger
      : zone.high;
  if (
    typeof thesis.invalidationLevel !== "number" ||
    !Number.isFinite(thesis.invalidationLevel) ||
    thesis.invalidationLevel <= 0 ||
    thesis.invalidationLevel >= zone.low
  ) {
    return noTradeRead(
      input,
      ["the candle-based thesis does not provide structural invalidation below the proposed zone"],
      thesis,
    );
  }
  const invalidationPrice = thesis.invalidationLevel;
  const entryPrice = triggerPrice;
  const risk = entryPrice - invalidationPrice;
  if (!Number.isFinite(risk) || risk <= 0) {
    return noTradeRead(input, ["the setup does not have a valid structural invalidation below entry"], thesis);
  }

  const plannedRiskPct = (risk / entryPrice) * 100;
  const rawTargetCandidates = buildTargetCandidates(input, entryPrice);
  const targetCandidates = rawTargetCandidates
    .map((candidate): LiveWatchlistTradeSetupTarget => ({
      price: candidate.price,
      basis: candidate.basis,
      rewardRiskRatio: (candidate.price - entryPrice) / risk,
    }));
  const targets = targetCandidates
    .filter((candidate) => candidate.rewardRiskRatio >= MIN_FIRST_TARGET_REWARD_RISK)
    .slice(0, 3);
  const firstTarget = targets[0] ?? null;
  const firstTargetRewardRiskRatio = firstTarget?.rewardRiskRatio ?? null;
  const bestSubThresholdObjective = [...targetCandidates]
    .sort((left, right) => right.rewardRiskRatio - left.rewardRiskRatio)[0] ?? null;
  const barriers = buildUpsideBarriers(input, entryPrice, rawTargetCandidates);
  const nearestBarrier = barriers[0] ?? null;
  const nearestBarrierRewardRisk = nearestBarrier
    ? (nearestBarrier.price - entryPrice) / risk
    : null;
  const interveningBarrierCount = firstTarget
    ? barriers.filter((barrier) => barrier.price < firstTarget.price * 0.985).length
    : barriers.length;
  const blockers: string[] = [];
  const maxRiskPct = input.currentPrice >= HIGH_PRICE_THRESHOLD
    ? MAX_HIGH_PRICE_SETUP_RISK_PCT
    : MAX_LOW_PRICE_SETUP_RISK_PCT;
  if (plannedRiskPct > maxRiskPct) {
    blockers.push(`structural risk is too wide at ${formatPct(plannedRiskPct)}`);
  }
  if (!firstTarget) {
    blockers.push(
      bestSubThresholdObjective
        ? `the best meaningful upside objective offers only ${formatRatio(bestSubThresholdObjective.rewardRiskRatio)}; no target clears ${formatRatio(MIN_FIRST_TARGET_REWARD_RISK)}`
        : "no meaningful chart-derived or structural upside target is mapped",
    );
  }
  if (
    nearestBarrier &&
    nearestBarrierRewardRisk !== null &&
    nearestBarrierRewardRisk < 1 &&
    (!firstTarget || priceDistancePct(nearestBarrier.price, firstTarget.price) > 0.015)
  ) {
    blockers.push(
      `${nearestBarrier.basis} at ${formatPrice(nearestBarrier.price)} appears before the setup can pay 1R`,
    );
  }
  if (interveningBarrierCount >= 3) {
    blockers.push(`the upside path is crowded by ${interveningBarrierCount} mapped barriers before the first objective`);
  }
  const currentSpreadPct = spreadPct(input);
  const maxSpreadPct = input.currentPrice >= HIGH_PRICE_THRESHOLD ? 1.5 : 3;
  if (currentSpreadPct !== null && currentSpreadPct > maxSpreadPct) {
    blockers.push(`the live bid/ask spread is too wide at ${formatPct(currentSpreadPct)}`);
  }
  if (
    CONTINUATION_TYPES.has(thesis.type) &&
    input.technicalContext?.aboveVwap === false &&
    input.technicalContext?.aboveEma9 === false
  ) {
    blockers.push("the continuation setup has lost both VWAP and EMA9 control");
  }
  const marketStructureContext = interpretMarketStructure(input.marketStructure);
  blockers.push(...marketStructureContext.blockers);

  const stateBeforeBlockers = baseState(input, zone, triggerPrice);
  let state = stateBeforeBlockers;
  if (state === "failed") {
    blockers.push("price is already through the chart-thesis invalidation");
  } else if (state === "extended_risk") {
    blockers.push("price is too extended from the planned entry area to chase");
  }
  if (blockers.length > 0 && state !== "extended_risk" && state !== "failed") {
    state = "no_trade";
  }

  let confidence: LiveWatchlistTradeSetupRead["confidence"] = thesis.confidence;
  if (
    input.levelMap?.dataQuality?.status === "limited" ||
    input.technicalContext?.confidence === "low" ||
    input.technicalContext?.confidence === "unavailable"
  ) {
    confidence = lowerConfidence(confidence);
  }

  const triggerCondition = input.currentPrice < triggerPrice
    ? `A 5-minute close above ${formatPrice(triggerPrice)}, followed by acceptance above it.`
    : `A pullback into ${formatPrice(zone.low)}-${formatPrice(zone.high)} that rejects lower prices, reclaims ${formatPrice(zone.high)}, and forms a higher low.`;
  const invalidationCondition =
    `A 5-minute close below ${formatPrice(invalidationPrice)} invalidates the setup; a single wick should be judged against spread and volatility.`;
  const stateLabel = state.replace(/_/g, " ").replace(/^./, (value) => value.toUpperCase());
  const targetLines = targets.slice(0, 2).map((target, index) =>
    `T${index + 1}: ${formatPrice(target.price)} (${target.basis}, ${formatRatio(target.rewardRiskRatio)}).`,
  );
  const firstObstacleLine = nearestBarrier &&
    (!firstTarget || priceDistancePct(nearestBarrier.price, firstTarget.price) > 0.015)
      ? `First obstacle: ${formatPrice(nearestBarrier.price)} (${nearestBarrier.basis}, ${formatRatio(nearestBarrierRewardRisk)} from planned entry).`
      : null;
  const body = [
    `${input.symbol.toUpperCase()} Trade Setup — ${stateLabel}`,
    `Setup: ${thesis.label} (${thesis.timeframe}, ${confidence} confidence).`,
    `Potential dip-buy zone: ${formatPrice(zone.low)}-${formatPrice(zone.high)}.`,
    `Zone evidence: ${zone.evidence.join(" | ")}.`,
    marketStructureContext.line,
    `Confirmation trigger: ${triggerCondition}`,
    `Invalidation: ${invalidationCondition}`,
    firstObstacleLine,
    ...targetLines,
    `Planned risk: ${formatPct(plannedRiskPct)}; first-target skew: ${formatRatio(firstTargetRewardRiskRatio)}.`,
    blockers.length > 0 ? `Avoid/stand aside: ${blockers.join("; ")}.` : null,
  ].filter((line): line is string => Boolean(line)).join("\n");
  const actionable = state === "triggered" && blockers.length === 0;

  return {
    setupType: thesis.type,
    setupLabel: thesis.label,
    state,
    confidence,
    actionable,
    zone,
    triggerPrice,
    triggerCondition,
    invalidationPrice,
    invalidationCondition,
    targets,
    plannedRiskPct,
    firstTargetRewardRiskRatio,
    blockers,
    evidence: [...new Set([
      ...thesis.evidence,
      ...zone.evidence,
      ...marketStructureContext.supportiveEvidence,
    ])],
    body,
    metadata: {
      tradeSetupState: state,
      tradeSetupStateBeforeBlockers: stateBeforeBlockers,
      tradeSetupType: thesis.type,
      tradeSetupConfidence: confidence,
      tradeSetupActionable: actionable,
      tradeSetupZoneLow: zone.low,
      tradeSetupZoneHigh: zone.high,
      tradeSetupZoneEvidenceCategoryCount: zone.categories.length,
      tradeSetupTrigger: triggerPrice,
      tradeSetupInvalidation: invalidationPrice,
      tradeSetupTarget1: targets[0]?.price ?? null,
      tradeSetupTarget2: targets[1]?.price ?? null,
      tradeSetupPlannedRiskPct: plannedRiskPct,
      tradeSetupFirstTargetRewardRisk: firstTargetRewardRiskRatio,
      tradeSetupNearestObjective: targetCandidates[0]?.price ?? null,
      tradeSetupNearestObjectiveRewardRisk: targetCandidates[0]?.rewardRiskRatio ?? null,
      tradeSetupFirstObstacle: nearestBarrier?.price ?? null,
      tradeSetupFirstObstacleBasis: nearestBarrier?.basis ?? null,
      tradeSetupNearestBarrierRewardRisk: nearestBarrierRewardRisk,
      tradeSetupInterveningBarrierCount: interveningBarrierCount,
      tradeSetupTargetSelectionMode: "paying_objective_after_obstacles",
      tradeSetupBlockerCount: blockers.length,
      tradeSetupPrimaryBlocker: blockers[0] ?? null,
      tradeSetupSpreadPct: currentSpreadPct,
      tradeSetupVolumeLabel: input.volumeRead?.label ?? "unknown",
      tradeSetupMarketStructureBias: marketStructureContext.bias,
      tradeSetupMarketStructureFormalTimeframes:
        marketStructureContext.actionableFormalTimeframes.join(",") || null,
      tradeSetupMarketStructureStable5mState: marketStructureContext.stable5mState,
      tradeSetupMarketStructureTacticalFormalMetadataOnly:
        marketStructureContext.tacticalFormalMetadataOnly,
    },
  };
}
