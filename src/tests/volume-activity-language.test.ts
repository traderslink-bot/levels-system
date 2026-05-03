import assert from "node:assert/strict";
import test from "node:test";

import type { FinalLevelZone } from "../lib/levels/level-types.js";
import type { MonitoringEvent } from "../lib/monitoring/monitoring-types.js";
import { deriveTraderVolumeActivityContext } from "../lib/alerts/trader-message-language.js";

const zone: FinalLevelZone = {
  id: "R1",
  symbol: "TEST",
  kind: "resistance",
  timeframeBias: "5m",
  zoneLow: 1.2,
  zoneHigh: 1.22,
  representativePrice: 1.21,
  strengthScore: 10,
  strengthLabel: "strong",
  touchCount: 3,
  confluenceCount: 1,
  sourceTypes: ["swing_high"],
  timeframeSources: ["5m"],
  reactionQualityScore: 0.5,
  rejectionScore: 0.5,
  displacementScore: 0.5,
  sessionSignificanceScore: 0.5,
  followThroughScore: 0.5,
  gapContinuationScore: 0,
  sourceEvidenceCount: 3,
  firstTimestamp: 1,
  lastTimestamp: 2,
  isExtension: false,
  freshness: "fresh",
  notes: [],
};

function eventWithVolume(
  volumeActivity: MonitoringEvent["eventContext"]["volumeActivity"],
): MonitoringEvent {
  return {
    id: "event-1",
    episodeId: "episode-1",
    symbol: "TEST",
    type: "breakout",
    eventType: "breakout",
    zoneId: zone.id,
    zoneKind: "resistance",
    level: zone.representativePrice,
    triggerPrice: 1.23,
    strength: 0.7,
    confidence: 0.7,
    priority: 60,
    bias: "bullish",
    pressureScore: 0.7,
    eventContext: {
      monitoredZoneId: zone.id,
      canonicalZoneId: zone.id,
      zoneFreshness: "fresh",
      zoneOrigin: "canonical",
      remapStatus: "new",
      remappedFromZoneIds: [],
      dataQualityDegraded: false,
      recentlyRefreshed: false,
      recentlyPromotedExtension: false,
      ladderPosition: "inner",
      zoneStrengthLabel: "strong",
      volumeActivity,
    },
    timestamp: 1,
    notes: [],
  };
}

function withVolumeLiveDiscord<T>(value: string | undefined, run: () => T): T {
  const previous = process.env.SIGNAL_CATEGORY_VOLUME_ACTIVITY_LIVE_DISCORD;
  try {
    if (value === undefined) {
      delete process.env.SIGNAL_CATEGORY_VOLUME_ACTIVITY_LIVE_DISCORD;
    } else {
      process.env.SIGNAL_CATEGORY_VOLUME_ACTIVITY_LIVE_DISCORD = value;
    }
    return run();
  } finally {
    if (previous === undefined) {
      delete process.env.SIGNAL_CATEGORY_VOLUME_ACTIVITY_LIVE_DISCORD;
    } else {
      process.env.SIGNAL_CATEGORY_VOLUME_ACTIVITY_LIVE_DISCORD = previous;
    }
  }
}

test("volume activity trader wording is off by default", () => {
  const context = withVolumeLiveDiscord(undefined, () =>
    deriveTraderVolumeActivityContext(
      eventWithVolume({
        label: "expanding",
        reliability: "reliable",
        currentBucketVolume: 1500,
        baselineAverageVolume: 1000,
        relativeVolumeRatio: 1.5,
        direction: "increasing",
        reason: "current 5m bucket is 1.50x recent average",
        traderLine: "activity: volume is expanding compared with recent 5-minute activity",
      }),
      zone,
    ),
  );

  assert.equal(context, null);
});

test("volume activity trader wording requires reliable data and safe text", () => {
  const unreliable = withVolumeLiveDiscord("true", () =>
    deriveTraderVolumeActivityContext(
      eventWithVolume({
        label: "unknown",
        reliability: "unreliable",
        currentBucketVolume: null,
        baselineAverageVolume: 1000,
        relativeVolumeRatio: null,
        direction: "unknown",
        reason: "live volume moved backward or reset",
      }),
      zone,
    ),
  );
  assert.equal(unreliable, null);

  const reliable = withVolumeLiveDiscord("true", () =>
    deriveTraderVolumeActivityContext(
      eventWithVolume({
        label: "expanding",
        reliability: "reliable",
        currentBucketVolume: 1500,
        baselineAverageVolume: 1000,
        relativeVolumeRatio: 1.5,
        direction: "increasing",
        reason: "current 5m bucket is 1.50x recent average",
        traderLine: "activity: volume is expanding compared with recent 5-minute activity",
      }),
      zone,
    ),
  );

  assert.match(reliable?.traderLine ?? "", /activity is expanding/);
  assert.doesNotMatch(reliable?.traderLine ?? "", /confirms|guarantees|best entry|buy|sell/i);
});
