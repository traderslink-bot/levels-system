import assert from "node:assert/strict";
import test from "node:test";

import {
  buildKnownBadPostPatternReportFromRows,
  evaluateKnownBadPostPatterns,
} from "../lib/review/known-bad-post-patterns.js";

test("known bad post patterns catch historical Discord wording failures", () => {
  const hits = evaluateKnownBadPostPatterns(
    [
      "no higher resistance is currently in the surfaced ladder",
      "below 1.01, risk stays open toward 1.00",
      "alert direction move: +1.64%",
      "Traders should wait for the best entry",
    ].join("\n"),
  );

  assert.ok(hits.some((hit) => hit.id === "surfaced_ladder_no_level"));
  assert.ok(hits.some((hit) => hit.id === "tiny_penny_risk"));
  assert.ok(hits.some((hit) => hit.id === "system_alert_direction"));
  assert.ok(hits.some((hit) => hit.id === "direct_execution_advice"));
});

test("known bad post pattern report stays quiet on current trader-style examples", () => {
  const report = buildKnownBadPostPatternReportFromRows([
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: 1,
      symbol: "CYCU",
      title: "CYCU support and resistance",
      body: [
        "Current structure: CYCU is range-bound between major support 0.9898-1.02 area and moderate resistance 1.06.",
        "Main decision: moderate resistance 1.06 is the upside decision area; major support 0.9898-1.02 area is the support area that needs to keep holding.",
        "Cleaner above: acceptance above moderate resistance 1.06 would put the next resistance area at heavy resistance 1.12.",
        "Support that matters: major support 0.9898-1.02 area is the first practical area buyers need to keep defending.",
      ].join("\n"),
    },
  ]);

  assert.equal(report.checkedRows, 1);
  assert.equal(report.hitCount, 0);
});
