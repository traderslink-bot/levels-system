import assert from "node:assert/strict";
import test from "node:test";

import {
  formatFollowThroughStateUpdateAsPayload,
  formatFollowThroughUpdateAsPayload,
  formatLevelSnapshotMessage,
} from "../lib/alerts/alert-router.js";

const SYSTEM_OR_OPERATOR_LANGUAGE =
  /Status:|Signal:|Decision area|setup update|state update|state recap|setup move|alert direction|after the alert|LEVEL SNAPSHOT|level map|mapped|remapped|operator-only|policy|suppression|replay|simulation|runtime-only|not a price target/i;

const DIRECT_ADVICE_LANGUAGE =
  /\b(?:buy here|buy now|sell now|sell here|take profit|stop out|trim here|add here|exit now|short setup|best entry|safe entry|can buy|should add|should trim|should exit|longs should|traders should|wait for)\b/i;

function assertTraderVisibleReplayText(text: string): void {
  assert.doesNotMatch(text, SYSTEM_OR_OPERATOR_LANGUAGE);
  assert.doesNotMatch(text, DIRECT_ADVICE_LANGUAGE);
}

test("realistic trader-facing replay bodies stay free of old system wording", () => {
  const snapshot = formatLevelSnapshotMessage({
    symbol: "XTLB",
    currentPrice: 3.38,
    supportZones: [
      { representativePrice: 3.34, strengthLabel: "weak", sourceLabel: "fresh intraday" },
      { representativePrice: 3.2, strengthLabel: "major", sourceLabel: "daily confluence" },
      { representativePrice: 2.6, strengthLabel: "moderate", sourceLabel: "daily structure" },
    ],
    resistanceZones: [
      { representativePrice: 3.75, strengthLabel: "moderate", sourceLabel: "daily structure" },
      { representativePrice: 4.44, strengthLabel: "moderate", sourceLabel: "4h structure" },
      { representativePrice: 4.49, strengthLabel: "weak", sourceLabel: "4h structure" },
      { representativePrice: 4.54, strengthLabel: "major", sourceLabel: "daily confluence" },
    ],
    timestamp: 1,
  });
  const followThrough = formatFollowThroughUpdateAsPayload({
    symbol: "XTLB",
    timestamp: 2,
    entryPrice: 3.75,
    outcomePrice: 3.88,
    followThrough: {
      eventType: "breakout",
      label: "working",
      directionalReturnPct: 3.47,
      rawReturnPct: 3.47,
      line: "follow-through: breakout is still holding above the level",
    },
  });
  const progress = formatFollowThroughStateUpdateAsPayload({
    symbol: "XTLB",
    timestamp: 3,
    eventType: "breakout",
    progressLabel: "improving",
    directionalReturnPct: 2.1,
    entryPrice: 3.75,
    currentPrice: 3.83,
  });

  const bodies = [
    snapshot,
    `${followThrough.title}\n${followThrough.body}`,
    `${progress.title}\n${progress.body}`,
  ];

  for (const body of bodies) {
    assertTraderVisibleReplayText(body);
  }

  assert.match(snapshot, /4\.44-4\.54 zone/);
});
