import assert from "node:assert/strict";
import test from "node:test";

import { assessSnapshotDisplayLevelImportance } from "../lib/monitoring/level-importance.js";

test("level importance ranks higher-timeframe major levels above tiny intraday flickers", () => {
  const daily = assessSnapshotDisplayLevelImportance({
    price: 1.04,
    side: "resistance",
    zone: {
      representativePrice: 1.12,
      strengthLabel: "major",
      sourceLabel: "daily confluence",
    },
  });
  const flicker = assessSnapshotDisplayLevelImportance({
    price: 1.04,
    side: "support",
    zone: {
      representativePrice: 1.03,
      strengthLabel: "weak",
      sourceLabel: "fresh intraday",
    },
  });

  assert.equal(daily.label, "major_decision");
  assert.equal(flicker.label, "minor_noise");
  assert.ok(daily.score > flicker.score);
});

test("clustered practical areas can become active trade boundaries without deleting levels", () => {
  const clustered = assessSnapshotDisplayLevelImportance({
    price: 3.50,
    side: "support",
    zoneCount: 3,
    zone: {
      representativePrice: 3.34,
      lowPrice: 3.32,
      highPrice: 3.38,
      strengthLabel: "moderate",
      sourceLabel: "4h structure",
    },
  });

  assert.equal(clustered.label, "active_trade_boundary");
  assert.match(clustered.reasons.join(" "), /clustered practical area/);
});

