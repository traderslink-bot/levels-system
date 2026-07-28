import assert from "node:assert/strict";
import test from "node:test";

import {
  runOfflineSmallCapScenario,
  runOfflineSmallCapScenarios,
  type OfflineScenarioPostedAlert,
} from "../lib/review/offline-small-cap-scenario-simulator.js";

const SYSTEM_OR_OPERATOR_LANGUAGE =
  /Status:|Signal:|Decision area|setup update|state update|state recap|setup move|alert direction|after the alert|current read:|AI note:|LEVEL SNAPSHOT|level map|mapped|remapped|operator-only|policy|suppression|replay|simulation|runtime-only|not a price target/i;

const DIRECT_ADVICE_LANGUAGE =
  /\b(buy|sell|short|trim|exit|enter|entry)\b|longs should|traders should|should buy|should sell|best entry|can buy|wait for/i;

function allTraderText(posts: OfflineScenarioPostedAlert[]): string {
  return posts.map((post) => `${post.title}\n${post.body}`).join("\n\n");
}

test("offline small-cap scenarios keep boring range chop quiet while preserving structure evidence", async () => {
  const results = await runOfflineSmallCapScenarios();
  const range = results.find((result) => result.name === "range_chop");
  const boring = results.find((result) => result.name === "boring_consolidation");
  assert.ok(range);
  assert.ok(boring);

  assert.ok(range.eventCount >= 6, "the simulator should create enough raw events to prove suppression");
  assert.ok(range.suppressedCount >= 3, "range chop should prove suppression happened");
  assert.ok(range.postedCount <= 5, `range chop posted too much: ${range.postedCount}`);
  assert.ok(
    range.practicalStates.some((state) => state === "range_bound" || state === "pressing_resistance"),
    `expected practical range states, got ${range.practicalStates.join(", ")}`,
  );
  assert.ok(boring.eventCount >= 8, "boring consolidation should create enough raw events to prove suppression");
  assert.ok(boring.suppressedCount > boring.postedCount, "boring consolidation should suppress more than it posts");
  assert.ok(boring.postedCount <= 4, `boring consolidation posted too much: ${boring.postedCount}`);
  assert.ok(
    boring.stableStates.some((state) => state === "range_bound" || state === "pressing_range_high"),
    `expected stable range states, got ${boring.stableStates.join(", ")}`,
  );
  assert.ok(
    boring.stableMaterialChangeCount <= 2,
    `boring consolidation had too many stable material changes: ${boring.stableMaterialChangeCount}`,
  );
});

test("offline small-cap scenarios still surface real breakout and support-loss changes", async () => {
  const results = await runOfflineSmallCapScenarios();
  const breakout = results.find((result) => result.name === "base_to_breakout");
  const runner = results.find((result) => result.name === "runner_structure_change");
  const supportLoss = results.find((result) => result.name === "support_area_loss");
  assert.ok(breakout);
  assert.ok(runner);
  assert.ok(supportLoss);

  assert.ok(
    breakout.postedAlerts.some((post) => post.eventType === "breakout"),
    "base-to-breakout scenario should still post at least one breakout",
  );
  assert.ok(
    breakout.practicalStates.some((state) => state === "building_base" || state === "pressing_resistance" || state === "breakout_attempt"),
    `expected constructive structure states, got ${breakout.practicalStates.join(", ")}`,
  );
  assert.ok(
    supportLoss.postedAlerts.some((post) => post.eventType === "breakdown"),
    "support-area loss scenario should still post a breakdown",
  );
  assert.ok(
    supportLoss.practicalStates.some((state) => state === "support_failing" || state === "structure_broken"),
    `expected support failure structure states, got ${supportLoss.practicalStates.join(", ")}`,
  );
  assert.ok(
    runner.postedAlerts.some((post) => post.eventType === "breakout"),
    "runner scenario should still post at least one breakout",
  );
  assert.ok(
    runner.stableMaterialChangeCount >= 1,
    "runner scenario should prove at least one stable 5m material change",
  );
  assert.ok(runner.postedCount <= 6, `runner structure scenario posted too much: ${runner.postedCount}`);
});

test("offline small-cap scenario posts stay trader-facing and non-advisory", async () => {
  const results = await runOfflineSmallCapScenarios();
  const text = allTraderText(results.flatMap((result) => result.postedAlerts));

  assert.doesNotMatch(text, SYSTEM_OR_OPERATOR_LANGUAGE);
  assert.doesNotMatch(text, DIRECT_ADVICE_LANGUAGE);
  assert.doesNotMatch(text, /if 1\.01 fails, risk opens toward 1\.00/i);
});

test("offline fake breakout does not turn every wiggle into a new Discord post", async () => {
  const fakeout = await runOfflineSmallCapScenario({
    name: "fake_breakout",
    symbol: "FAKE",
    description: "Repeated fakeout path for post-policy validation.",
    updates: [
      1.03, 1.045, 1.058, 1.067, 1.071, 1.049, 1.036, 1.022, 1.008, 0.999,
      1.018, 1.041, 1.059, 1.066, 1.052, 1.033, 1.017,
    ],
  });

  assert.ok(fakeout.eventCount >= 3);
  assert.ok(fakeout.postedCount <= 4, `fakeout path posted too much: ${fakeout.postedCount}`);
  assert.ok(
    fakeout.suppressedAlerts.some((alert) => alert.reason === "post_policy_suppressed" || alert.reason === "engine_filtered"),
    "fakeout path should prove suppression happened",
  );
});
