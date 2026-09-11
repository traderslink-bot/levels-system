import assert from "node:assert/strict";
import test from "node:test";
import { buildBreakoutEvidence, validateBreakoutEvidence, selectBreakoutCandidate, retainBreakoutTargets, type BreakoutCandidate } from "../lib/ai/traderslink-ai-read-breakout-selection.js";

const candidate = (id: BreakoutCandidate["id"], price: number): BreakoutCandidate => ({
  id, level: { label: "Breakout continuation", price, rationale: "Observed rejection pivot" },
  targets: [{ label: "Next level", price: price + 0.1, condition: "After this candidate clears" }], evidenceIds: ["pivot-1"],
  anchorPrice: price, basis: "observed_level",
});
const base = { referencePrice: 0.5, mustClear: { label: "Must clear", price: 0.52, rationale: "Range ceiling" }, validateEvidence: () => [] as string[] };

test("optional targets retain independent levels but drop dependent chains", () => {
  const target = (id: string, price: number, dependsOn: string[]) => ({ id, price, dependsOn, label: id, condition: "Observed daily high" });
  const result = retainBreakoutTargets({ candidateId: "alternate", continuationPrice: 0.54, spacing: 0.01,
    targets: [target("bad", 0.6, ["alternate"]), target("dependent", 0.65, ["bad"]),
      target("independent", 0.7, ["alternate"]), target("wrong-branch", 0.8, ["primary"])],
    validate: value => value.label !== "bad" });
  assert.deepEqual(result.retained.map(value => value.id), ["independent"]);
  assert.equal(result.issues.length, 3);
});

test("duplicate and forward target dependencies cannot borrow another identity", () => {
  const target = (id: string, dependsOn: string[]) => ({ id, dependsOn, price: 0.7, label: id, condition: "Daily high" });
  const result = retainBreakoutTargets({ candidateId: "primary", continuationPrice: 0.54, spacing: 0.01,
    targets: [target("forward", ["later"]), target("duplicate", []), target("duplicate", []), target("later", [])], validate: () => true });
  assert.deepEqual(result.retained.map(value => value.id), ["later"]);
});

test("frozen observations distinguish timeframes and exclude future or invalid highs", () => {
  const context = { intradayCandles: [
    { timestamp: 100, high: 0.54, low: 0.5 }, { timestamp: 100, high: 0.54, low: 0.5 },
    { timestamp: 201, high: 0.6, low: 0.5 }, { timestamp: 150, high: 0.49, low: 0.4 },
    { timestamp: 160, high: 0.8, low: 0.9 },
  ].map(bar => ({ ...bar, open: bar.low, close: bar.low, volume: 1000 })),
    dailyCandles: [{ timestamp: 100, high: 0.7, low: 0.4, open: 0.5, close: 0.6, volume: 1000 }] };
  const evidence = buildBreakoutEvidence(context as any, 0.5, 200);
  assert.deepEqual(evidence.map(item => item.id), ["breakout:intraday:100:high", "breakout:daily:100:high"]);
  const primary = candidate("primary", 0.54);
  primary.evidenceIds = [evidence[0]!.id];
  assert.deepEqual(validateBreakoutEvidence(primary, evidence), []);
  primary.level.price = 0.55;
  assert.ok(validateBreakoutEvidence(primary, evidence).length);
  primary.level.price = 0.54;
  primary.evidenceIds.push("invented");
  assert.ok(validateBreakoutEvidence(primary, evidence).some(reason => reason.includes("Unknown")));
});

test("conflicting observation versions are excluded independently of input order without losing a valid backup", () => {
  for (const conflicting of [{ timestamp: 100, high: 0.49, low: 0.4 },
    { timestamp: 100, high: 0.54, low: 0.48 }, { timestamp: 100, high: Number.NaN, low: 0.5 }]) {
    const bars = [{ timestamp: 100, high: 0.54, low: 0.5 }, conflicting, { timestamp: 101, high: 0.6, low: 0.5 }];
    for (const intradayCandles of [bars, [...bars].reverse()]) {
      const evidence = buildBreakoutEvidence({ intradayCandles: intradayCandles.map(bar => ({ ...bar,
        open: bar.low, close: bar.low, volume: 1000 })), dailyCandles: [] } as any, 0.5, 200);
      assert.deepEqual(evidence.map(item => item.id), ["breakout:intraday:101:high"]);
      const primary = candidate("primary", 0.54), alternate = candidate("alternate", 0.6);
      primary.evidenceIds = ["breakout:intraday:100:high"];
      alternate.evidenceIds = ["breakout:intraday:101:high"];
      const selected = selectBreakoutCandidate({ ...base, primary, alternate,
        validateEvidence: value => validateBreakoutEvidence(value, evidence) });
      assert.equal(selected.selected?.id, "alternate");
      assert.equal(primary.level.price, 0.54);
    }
  }
});

test("valid primary wins without substituting a farther backup", () => {
  const primary = candidate("primary", 0.54), alternate = candidate("alternate", 0.6);
  const result = selectBreakoutCandidate({ ...base, primary, alternate });
  assert.deepEqual(result.selected, primary);
  assert.equal(result.decisions[1]?.selected, false);
  result.selected!.level.price = 9;
  assert.equal(primary.level.price, 0.54);
});

test("confirmation can clear an observed anchor without pretending to be that high", () => {
  const primary = candidate("primary", 0.55);
  primary.anchorPrice = 0.54;
  primary.basis = "confirmation_above";
  primary.level.rationale = "Confirmation above the observed rejection at $0.54.";
  const evidence = [{ id: "pivot-1", price: 0.54, observedAt: 100, timeframe: "intraday" as const, kind: "candle_high" as const }];
  assert.deepEqual(validateBreakoutEvidence(primary, evidence), []);
  primary.basis = "observed_level";
  assert.ok(validateBreakoutEvidence(primary, evidence).some(reason => reason.includes("differs")));
  primary.basis = "confirmation_above";
  primary.level.price = 0.53;
  assert.ok(validateBreakoutEvidence(primary, evidence).some(reason => reason.includes("above")));
  primary.level.price = 0.55;
  primary.anchorPrice = 0.52;
  assert.ok(validateBreakoutEvidence(primary, evidence).some(reason => reason.includes("anchor")));
});

test("invalid primary selects the backup with its own objectives", () => {
  const primary = candidate("primary", 0.49), alternate = candidate("alternate", 0.6);
  const result = selectBreakoutCandidate({ ...base, primary, alternate });
  assert.equal(result.selected?.id, "alternate");
  assert.deepEqual(result.selected?.targets, alternate.targets);
  assert.notDeepEqual(result.selected?.targets, primary.targets);
  assert.ok(result.decisions[0]!.reasons.some(reason => reason.includes("reference_order")));
});

test("unsupported or missing candidates cannot fabricate a selected breakout", () => {
  const primary = candidate("primary", 0.54), alternate = candidate("alternate", 0.6);
  const result = selectBreakoutCandidate({ ...base, primary, alternate, validateEvidence: () => ["Unknown evidence ID."] });
  assert.equal(result.selected, null);
  assert.ok(result.decisions.every(decision => !decision.selected));
  assert.equal(selectBreakoutCandidate({ ...base, primary: null, alternate: null }).selected, null);
  assert.equal(selectBreakoutCandidate({ ...base, primary, alternate, mustClear: { ...base.mustClear, price: null } }).selected, null);
});

test("evidence checking cannot mutate preserved original candidates", () => {
  const primary = candidate("primary", 0.54);
  const result = selectBreakoutCandidate({ ...base, primary, alternate: null, validateEvidence: value => { value.level.price = 7; return []; } });
  assert.equal(primary.level.price, 0.54);
  assert.equal(result.selected?.level.price, 0.54);
});
