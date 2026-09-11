import assert from "node:assert/strict";
import test from "node:test";
import { hasCompleteValidatedSetup, validateBreakoutOrdering, validatePullbackPair, validatePullbackSection, validateRecoverySection, type ScenarioValidationContext } from "../lib/ai/traderslink-ai-read-section-validation.js";

const context: ScenarioValidationContext = {
  referencePrice: 4, momentumFailure: 3.3, confidence: "high",
  candidates: [{ id: "shallow-base", zoneLow: 3.7, zoneHigh: 3.8 }, { id: "deep-base", zoneLow: 3.4, zoneHigh: 3.5 }],
};
const shallow = { zoneLow: 3.7, zoneHigh: 3.8, confirmationPrice: 3.85, confirmation: "Reclaim the base", invalidationPrice: 3.6, firstObjectivePrice: 4.2, rationale: "Observed base", evidenceIds: ["shallow-base"] };
const deep = { ...shallow, zoneLow: 3.4, zoneHigh: 3.5, confirmationPrice: 3.6, invalidationPrice: 3.3, evidenceIds: ["deep-base"] };
const recovery = { recoveryZoneLow: 3.4, recoveryZoneHigh: 3.5, firstReclaimPrice: 3.6, setupRestorePrice: 3.7, firstObjectivePrice: 3.9, rationale: "Reclaim observed base", evidenceIds: ["deep-base"] };

test("breakout ordering identifies branch-local omissions without moving prices", () => {
  const clear = { label: "Clear", price: 4.1, rationale: "Observed pivot" };
  const continuation = { label: "Continue", price: 4.3, rationale: "Observed high" };
  assert.equal(validateBreakoutOrdering(clear, continuation, 4).omitDependentUpside, false);
  const invalidClear = validateBreakoutOrdering({ ...clear, price: 3.8 }, continuation, 4);
  assert.equal(invalidClear.mustClear.price, null);
  assert.equal(invalidClear.breakoutContinuation.price, null);
  assert.deepEqual(invalidClear.changedPaths, ["mustClear", "breakoutContinuation", "targets"]);
  const reversed = validateBreakoutOrdering(clear, { ...continuation, price: 4.09 }, 4);
  assert.deepEqual(reversed.mustClear, clear);
  assert.equal(reversed.breakoutContinuation.price, null);
  assert.equal(reversed.omitDependentUpside, true);
  assert.equal(continuation.price, 4.3);
  assert.equal(validateBreakoutOrdering(clear, { ...continuation, price: 4.11 }, 4).omitDependentUpside, true);
  assert.equal(validateBreakoutOrdering(clear, { ...continuation, price: 4.13 }, 4).omitDependentUpside, false);
  const missing = { label: "", price: null, rationale: "" };
  assert.equal(validateBreakoutOrdering(missing, missing, 4).issues.length, 0);
  const invalidNumeric = validateBreakoutOrdering(clear, { ...continuation, price: Infinity }, 4);
  assert.equal(invalidNumeric.issues[0]?.code, "invalid_number");
  assert.equal(invalidNumeric.breakoutContinuation.price, null);
  assert.throws(() => validateBreakoutOrdering(clear, continuation, NaN), /shared analysis reference/);
});

test("validated analysis needs a complete setup rather than isolated prices", () => {
  const empty = { momentumFailure: { price: null }, mustClear: { price: null }, breakoutContinuation: { price: null }, pullbackPlans: { shallow: null, deep: null }, failureRecovery: null };
  assert.equal(hasCompleteValidatedSetup(empty), false);
  assert.equal(hasCompleteValidatedSetup({ ...empty, mustClear: { price: 4.2 } }), false);
  assert.equal(hasCompleteValidatedSetup({ ...empty, momentumFailure: { price: 3.3 }, mustClear: { price: 4.2 }, breakoutContinuation: { price: 4.4 } }), true);
  assert.equal(hasCompleteValidatedSetup({ ...empty, pullbackPlans: { shallow, deep: null } }), true);
  assert.equal(hasCompleteValidatedSetup({ ...empty, pullbackPlans: { shallow: null, deep } }), true);
  assert.equal(hasCompleteValidatedSetup({ ...empty, failureRecovery: recovery }), true);
});

test("overlapping valid branches omit shallow without changing the deep setup", () => {
  const savedDeep = JSON.stringify(deep);
  const result = validatePullbackPair({ ...shallow, zoneLow: 3.49 }, deep, 4, 0.1);
  assert.equal(result.value, null);
  assert.equal(result.issues[0]?.code, "zone_overlap");
  assert.equal(JSON.stringify(deep), savedDeep);
  assert.equal(validatePullbackPair(shallow, deep, 4, 0.1).value, shallow);
  assert.equal(validatePullbackPair(shallow, null, 4, 0.1).value, shallow);
  assert.equal(validatePullbackPair(null, deep, 4, 0.1).value, null);
  assert.equal(validatePullbackPair(shallow, deep, 4, 1).value, null);
});

test("conflicting branches retain the stronger matching candidate rather than always deep", () => {
  const ranked = context.candidates;
  const result = validatePullbackPair(shallow, deep, 4, 1, ranked);
  assert.equal(result.value, shallow);
  assert.equal(result.deepValue, null);
  assert.deepEqual(result.changedPaths, ["pullbackPlans.deep"]);
  const reversed = validatePullbackPair(shallow, deep, 4, 1, [...ranked].reverse());
  assert.equal(reversed.value, null);
  assert.equal(reversed.deepValue, deep);
  const padded = validatePullbackPair(shallow, { ...deep, evidenceIds: ["shallow-base", "deep-base"] }, 4, 1, ranked);
  assert.equal(padded.value, shallow, "an unrelated high-ranked citation must not boost the deep branch");
});

test("candidate price matching uses rounding precision rather than percentage distance", () => {
  const shifted = validatePullbackSection("shallow", { ...shallow, zoneLow: 3.71, zoneHigh: 3.81 }, context);
  assert.equal(shifted.value, null);
  assert.ok(shifted.issues.some(issue => issue.code === "zone_evidence_mismatch"));
  assert.deepEqual(validatePullbackSection("deep", deep, context).value, deep);
  const pennyContext = { ...context, referencePrice: 0.5, momentumFailure: 0.3,
    candidates: [{ id: "penny", zoneLow: 0.44004, zoneHigh: 0.45004 }] };
  const penny = { ...shallow, zoneLow: 0.44, zoneHigh: 0.45, confirmationPrice: 0.46,
    invalidationPrice: 0.43, firstObjectivePrice: 0.55, evidenceIds: ["penny"] };
  assert.deepEqual(validatePullbackSection("shallow", penny, pennyContext).value, penny);
  const mismatch = validatePullbackSection("shallow", { ...penny, zoneLow: 0.441, zoneHigh: 0.451 }, pennyContext);
  assert.ok(mismatch.issues.some(issue => issue.code === "zone_evidence_mismatch"));
  const rounded = validatePullbackSection("shallow", shallow, { ...context,
    candidates: [{ id: "shallow-base", zoneLow: 3.704, zoneHigh: 3.804 }] });
  assert.deepEqual(rounded.value, shallow);
});

test("invalid shallow does not remove or relabel an independently valid deep zone", () => {
  const result = validatePullbackSection("shallow", { ...shallow, zoneHigh: 4.1 }, context);
  assert.equal(result.value, null);
  assert.ok(result.issues.some((issue) => issue.code === "reference_order"));
  assert.ok(result.issues.some((issue) => issue.code === "zone_evidence_mismatch"));
  assert.deepEqual(result.changedPaths, ["pullbackPlans.shallow"]);
  assert.deepEqual(validatePullbackSection("deep", deep, context).value, deep);
});

test("invalid optional objective retains the zone and removes unstructured dependent prose without mutating original", () => {
  const original = { ...shallow, firstObjectivePrice: 3.7 };
  const result = validatePullbackSection("shallow", original, context);
  assert.equal(result.value?.zoneLow, 3.7);
  assert.equal(result.value?.firstObjectivePrice, null);
  assert.equal(result.value?.confirmation, "");
  assert.equal(result.value?.rationale, "");
  assert.equal(original.firstObjectivePrice, 3.7);
  assert.equal(original.rationale, "Observed base");
  assert.equal(result.issues[0]?.action, "omit_objective");
});

test("collects numeric, candidate and ordering issues without inventing corrected prices", () => {
  const result = validatePullbackSection("shallow", { ...shallow, zoneLow: Number.NaN, invalidationPrice: 4, evidenceIds: ["invented"] }, context);
  assert.equal(result.value, null);
  assert.ok(result.issues.some((issue) => issue.code === "invalid_number"));
  assert.ok(result.issues.some((issue) => issue.code === "unknown_evidence"));
  assert.ok(result.issues.every((issue) => issue.path.startsWith("pullbackPlans.shallow.")));
});

test("low-confidence and failed momentum omit active pullbacks without forbidding recovery", () => {
  assert.equal(validatePullbackSection("shallow", shallow, { ...context, confidence: "low" }).value, null);
  assert.equal(validatePullbackSection("deep", deep, { ...context, momentumFailure: 4 }).value, null);
  assert.deepEqual(validateRecoverySection(recovery, { ...context, momentumFailure: 4 }).value, recovery);
});

test("deep invalidation below failure removes only the deep branch", () => {
  const result = validatePullbackSection("deep", { ...deep, invalidationPrice: 3.2 }, context);
  assert.equal(result.value, null);
  assert.ok(result.issues.some((issue) => issue.code === "failure_order"));
  assert.deepEqual(validatePullbackSection("shallow", shallow, context).value, shallow);
});

test("invalid recovery objective is optional but an invalid reclaim sequence is not", () => {
  const result = validateRecoverySection({ ...recovery, firstObjectivePrice: 3.7 }, context);
  assert.equal(result.value?.firstObjectivePrice, null);
  assert.equal(result.value?.setupRestorePrice, 3.7);
  assert.equal(result.value?.rationale, "");
  assert.equal(validateRecoverySection({ ...recovery, firstReclaimPrice: 3.4 }, context).value, null);
});

test("absent sections stay absent and successful validation does not share evidence arrays", () => {
  assert.deepEqual(validatePullbackSection("shallow", null, context), { value: null, issues: [], changedPaths: [] });
  assert.deepEqual(validateRecoverySection(null, context), { value: null, issues: [], changedPaths: [] });
  const result = validatePullbackSection("shallow", shallow, context);
  result.value!.evidenceIds.push("other");
  assert.deepEqual(shallow.evidenceIds, ["shallow-base"]);
});
