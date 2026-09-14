import assert from "node:assert/strict";
import test from "node:test";
import { buildBreakoutEvidence, validateBreakoutEvidence, selectBreakoutCandidate, retainBreakoutTargets, type BreakoutCandidate } from "../lib/ai/traderslink-ai-read-breakout-selection.js";

const candidate = (id: BreakoutCandidate["id"], price: number): BreakoutCandidate => ({
  id, level: { label: "Breakout continuation", price, rationale: "Observed rejection pivot" },
  targets: [{ label: "Next level", price: price + 0.1, condition: "After this candidate clears" }], evidenceIds: ["pivot-1"],
  anchorPrice: price, basis: "observed_level",
});
const base = { referencePrice: 0.5, mustClear: { label: "Must clear", price: 0.52, rationale: "Range ceiling" }, validateEvidence: () => [] as string[] };

test("SOAR saved-response dependency spellings retain all three upside checkpoints without mutating source", () => {
  const targets = [
    { id: "primary-target-259", price: 0.259, dependsOn: ["primary-breakout"] },
    { id: "primary-target-265", price: 0.265, dependsOn: ["primary-breakout", "primary-target-259"] },
    { id: "primary-target-272", price: 0.272, dependsOn: ["primary-breakout", "primary-target-265"] },
  ].map(row => ({ ...row, label: row.id, condition: "Conditional daily high" }));
  const original = JSON.stringify(targets);
  const run = (validate: (value: { price: number | null }) => boolean) => retainBreakoutTargets({
    candidateId: "primary", continuationPrice: 0.255, spacing: 0.0001, targets, validate });
  assert.deepEqual(run(() => true).retained.map(row => row.price), [0.259, 0.265, 0.272]);
  assert.deepEqual(run(row => row.price !== 0.259).retained, [], "failed evidence still removes dependent chain");
  assert.equal(JSON.stringify(targets), original);
});

test("breakout aliases cannot resolve another branch, a missing target or an identity collision", () => {
  for (const candidateId of ["primary", "alternate"] as const) {
    const alias = `${candidateId}-breakout`;
    const row = (id: string, dependsOn: string[], price = 1.2) => ({ id, dependsOn, price, label: id, condition: "Observed high" });
    const run = (targets: ReturnType<typeof row>[]) => retainBreakoutTargets({ candidateId,
      continuationPrice: 1, spacing: 0.01, targets, validate: () => true });
    assert.equal(run([row("valid", [alias])]).retained.length, 1);
    for (const bad of [candidateId === "primary" ? "alternate-breakout" : "primary-breakout", "unknown", "https://example.com/primary"]) {
      assert.equal(run([row("invalid", [bad])]).retained.length, 0);
    }
    assert.equal(run([row(alias, []), row("child", [alias], 1.3)]).retained.length, 0);
    assert.equal(run([row("child", [alias]), row(alias, [], 1.3)]).retained.length, 0);
    assert.equal(run([row("bad-order", [alias], 0.9)]).retained.length, 0);
  }
});

test("BMGL saved-response symbol-prefixed upside roots preserve prices only for the current ticker", () => {
  const targets = [
    { id: "bmgl-primary-target-948", price: 9.48, dependsOn: ["bmgl-breakout-primary"] },
    { id: "bmgl-primary-target-1060", price: 10.6, dependsOn: ["bmgl-breakout-primary", "bmgl-primary-target-948"] },
  ].map(row => ({ ...row, label: row.id, condition: "Observed daily high" }));
  const original = JSON.stringify(targets);
  const run = (symbol: string, rows = targets) => retainBreakoutTargets({ candidateId: "primary", symbol,
    continuationPrice: 8.95, spacing: 0.01, targets: rows, validate: () => true });
  assert.deepEqual(run("BMGL").retained.map(row => row.price), [9.48, 10.6]);
  assert.deepEqual(run("SOAR").retained, []);
  assert.deepEqual(run("BMGL", [{ ...targets[0]!, id: "bmgl-breakout-primary" }, ...targets]).retained, []);
  assert.deepEqual(run("BMGL", targets.map(row => ({ ...row, dependsOn: ["bmgl-breakout-alternate"] }))).retained, []);
  assert.equal(JSON.stringify(targets), original);
});

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
