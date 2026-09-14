import assert from "node:assert/strict";
import test from "node:test";
import { retainAnalysisCheckpoints } from "../lib/ai/traderslink-ai-read-checkpoint-dependencies.js";

test("SOAR downside root alias preserves saved prices and still honors failed predecessor evidence", () => {
  const raw = [
    { id: "downside-202", dependsOn: ["momentum-failure"], price: 0.202, label: "Daily area", condition: "After momentum failure" },
    { id: "downside-1908", dependsOn: ["momentum-failure", "downside-202"], price: 0.1908, label: "Origin", condition: "After the earlier area fails" },
  ];
  const original = JSON.stringify(raw);
  const run = (validate: (value: { price: number | null }) => string | null) => retainAnalysisCheckpoints({
    raw, root: "momentumFailure", rootPrice: 0.2102, direction: "down", spacing: 0.0001, validate });
  assert.deepEqual(run(() => null).retained.map(row => row.price), [0.202, 0.1908]);
  assert.deepEqual(run(row => row.price === 0.202 ? "Unsupported" : null).retained, []);
  assert.equal(JSON.stringify(raw), original);
});

test("checkpoint aliases reject collisions and opposite, unknown and external roots", () => {
  for (const [root, alias] of [["momentumFailure", "momentum-failure"], ["breakoutContinuation", "breakout-continuation"]] as const) {
    const row = (id: string, dependsOn: string[], price = 1.2) => ({ id, dependsOn, price, label: id, condition: "Observed area" });
    const run = (raw: ReturnType<typeof row>[]) => retainAnalysisCheckpoints({ raw, root, rootPrice: 1,
      direction: "up", spacing: 0.01, validate: () => null });
    assert.equal(run([row("valid", [alias])]).retained.length, 1);
    assert.equal(run([row(alias, []), row("child", [alias], 1.3)]).retained.length, 0);
    assert.equal(run([row("child", [alias]), row(alias, [], 1.3)]).retained.length, 0);
    for (const bad of ["unknown", "primary-breakout", "https://example.com/root", root === "momentumFailure" ? "current-price" : "momentum-failure"]) {
      assert.equal(run([row("invalid", [bad])]).retained.length, 0);
    }
  }
});

test("BMGL saved downside roots are scoped to its exact current symbol", () => {
  const raw = [
    { id: "bmgl-downside-513", dependsOn: ["bmgl-momentum-failure"], price: 5.13, label: "Base", condition: "After 5.42 fails" },
    { id: "bmgl-downside-458", dependsOn: ["bmgl-momentum-failure", "bmgl-downside-513"], price: 4.58, label: "Origin", condition: "After 5.13 fails" },
  ];
  const original = JSON.stringify(raw);
  const run = (symbol: string, rows = raw) => retainAnalysisCheckpoints({ raw: rows, symbol, root: "momentumFailure",
    rootPrice: 5.42, direction: "down", spacing: 0.01, validate: () => null });
  assert.deepEqual(run("BMGL").retained.map(row => row.price), [5.13, 4.58]);
  assert.deepEqual(run("SOAR").retained, []);
  assert.deepEqual(run("BMGL", [{ ...raw[0]!, id: "bmgl-momentum-failure" }, ...raw]).retained, []);
  assert.equal(JSON.stringify(raw), original);
});

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
