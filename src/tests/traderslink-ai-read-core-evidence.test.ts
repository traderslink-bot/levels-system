import assert from "node:assert/strict";
import test from "node:test";
import { validateCoreEvidence } from "../lib/ai/traderslink-ai-read-core-evidence.js";

const level = (price: number) => ({ label: "Level", price, rationale: "Explanation" });
const levels = { needsToHold: level(3.5), cautionBelow: level(3.4), momentumFailure: level(3.36) };
const observed = (price: number) => price === 3.5;
const anchors = {
  needsToHold: { anchorPrice: 3.5, basis: "observed_level", explanation: "Observed base" },
  cautionBelow: { anchorPrice: 3.5, basis: "threshold_below", explanation: "Caution below the base" },
  momentumFailure: { anchorPrice: 3.5, basis: "threshold_below", explanation: "Proposed failure buffer below the base" },
};

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
