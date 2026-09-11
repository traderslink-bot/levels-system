import assert from "node:assert/strict";
import test from "node:test";
import { validateCoreEvidence, validateUpperEvidence } from "../lib/ai/traderslink-ai-read-core-evidence.js";
import { observedPriceMatcher } from "../lib/ai/traderslink-ai-read-observations.js";

const level = (price: number) => ({ label: "Level", price, rationale: "Explanation" });
const levels = { needsToHold: level(3.5), cautionBelow: level(3.4), momentumFailure: level(3.36) };
const observed = (price: number) => price === 3.5;
const anchors = {
  needsToHold: { anchorPrice: 3.5, basis: "observed_level", explanation: "Observed base" },
  cautionBelow: { anchorPrice: 3.5, basis: "threshold_below", explanation: "Caution below the base" },
  momentumFailure: { anchorPrice: 3.5, basis: "threshold_below", explanation: "Proposed failure buffer below the base" },
};

test("must-clear confirmation distinguishes a proposed threshold from an observed level", () => {
  const proof = { anchorPrice: 3.5, basis: "confirmation_above", explanation: "Proposed acceptance above the observed high" };
  assert.deepEqual(validateUpperEvidence(level(3.6), proof, observed), []);
  assert.equal(validateUpperEvidence(level(3.6), { ...proof, basis: "observed_level" }, observed).length, 1);
  assert.equal(validateUpperEvidence(level(3.4), proof, observed).length, 1);
  assert.equal(validateUpperEvidence(level(3.6), { ...proof, explanation: "" }, observed).length, 1);
  assert.equal(validateUpperEvidence(level(3.6), { ...proof, anchorPrice: 99 }, observed).length, 1);
  assert.equal(validateUpperEvidence(level(3.6), undefined, observed).length, 1);
  assert.deepEqual(validateUpperEvidence(level(3.5), undefined, observed), []);
  assert.equal(validateUpperEvidence({ ...level(3.5), rationale: "" }, undefined, observed).length, 1);
});

test("observed anchor matching uses price precision, never volatile candle width", () => {
  const bar = { timestamp: 100, open: 3.5, high: 4, low: 3, close: 3.75, volume: 1000 };
  const match = observedPriceMatcher([[bar]], 0.95, 100);
  assert.equal(match(3.5), true);
  assert.equal(match(3.504), true);
  assert.equal(match(3.51), false);
  assert.equal(match(3.36), false);
  assert.equal(match(0.95004), true);
  assert.equal(match(0.94), false);
  assert.equal(observedPriceMatcher([[{ ...bar, timestamp: 101 }]], null, 100)(3.5), false);
  assert.equal(observedPriceMatcher([[bar, { ...bar, close: 3.8 }]], null, 100)(3.5), false);
});

test("supported derived core thresholds need not equal an observed candle price", () => {
  assert.deepEqual(validateCoreEvidence(levels, anchors, observed), []);
  assert.equal(validateCoreEvidence(levels, undefined, observed).length, 2);
});
test("unsupported anchors, false observed-price claims and unexplained thresholds do not pass", () => {
  for (const invalid of [
    { ...anchors.momentumFailure, anchorPrice: 4 },
    { ...anchors.momentumFailure, basis: "observed_level" },
    { ...anchors.momentumFailure, explanation: " " },
    { ...anchors.momentumFailure, basis: "anything" },
    null,
  ]) assert.equal(validateCoreEvidence(levels, { ...anchors, momentumFailure: invalid }, observed).length, 1);
  assert.equal(validateCoreEvidence({ ...levels, momentumFailure: level(3.6) }, anchors, observed).length, 1);
});
