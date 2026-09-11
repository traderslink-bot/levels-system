import assert from "node:assert/strict";
import test from "node:test";
import { retainAnalysisCheckpoints } from "../lib/ai/traderslink-ai-read-checkpoint-dependencies.js";

test("checkpoint dependencies retain independent levels after a rejected sibling in either direction", () => {
  for (const direction of ["up", "down"] as const) {
    const root = direction === "up" ? "breakoutContinuation" : "momentumFailure";
    const prices = direction === "up" ? [2.1, 2.2, 2.3] : [1.9, 1.8, 1.7];
    const result = retainAnalysisCheckpoints({ root, rootPrice: 2, direction, spacing: 0.05,
      raw: [
        { id: "bad", dependsOn: [root], price: prices[0], label: "Bad", condition: "bad claim" },
        { id: "dependent", dependsOn: ["bad"], price: prices[1], label: "Dependent", condition: "valid" },
        { id: "independent", dependsOn: [root], price: prices[2], label: "Independent", condition: "valid" },
      ], validate: target => target.condition === "bad claim" ? "Invalid text" : null });
    assert.deepEqual(result.retained.map(row => row.price), [prices[2]]);
    assert.equal(result.issues.length, 2);
    assert.equal(Object.hasOwn(result.retained[0]!, "dependsOn"), false);
  }
});

test("legacy later checkpoints do not silently become independent after an omission", () => {
  const result = retainAnalysisCheckpoints({ root: "momentumFailure", rootPrice: 2, direction: "down", spacing: 0.05,
    raw: [1.9, 1.8, 1.7].map(price => ({ price, label: "Level", condition: price === 1.8 ? "bad" : "valid" })),
    validate: target => target.condition === "bad" ? "Invalid text" : null });
  assert.deepEqual(result.retained.map(row => row.price), [1.9]);
  assert.match(result.issues[1]!.reason, /undeclared/);
});

test("mixed duplicate and forward dependency identities cannot be accepted", () => {
  for (const raw of [
    [{ id: "a", dependsOn: ["future"] }, { id: "future", dependsOn: ["a"] }],
    [{ id: "same", dependsOn: ["momentumFailure"] }, { id: "same", dependsOn: ["momentumFailure"] }],
    [{ id: "a", dependsOn: ["momentumFailure"] }, {}],
  ]) {
    const result = retainAnalysisCheckpoints({ root: "momentumFailure", rootPrice: 2, direction: "down", spacing: 0.05,
      raw: raw.map((identity, index) => ({ ...identity, price: 1.8 - index * 0.2, label: "Level", condition: "valid" })), validate: () => null });
    assert.ok(result.issues.length > 0);
    assert.ok(result.retained.length < raw.length);
  }
});
