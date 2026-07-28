import assert from "node:assert/strict";
import test from "node:test";

import { deriveTraderMarketStructureContext } from "../lib/alerts/trader-message-language.js";
import type { FinalLevelZone } from "../lib/levels/level-types.js";
import type { MonitoringEvent } from "../lib/monitoring/monitoring-types.js";

const DISCORD_SYSTEM_LANGUAGE_PATTERN =
  /Status:|Signal:|Decision area|setup update|state update|state recap|setup move|alert direction|after the alert|thread stayed|mapped|remapped|operator-only|policy|suppression|replay|simulation|runtime-only|not a price target/i;

const DISCORD_DIRECT_ADVICE_PATTERN =
  /\b(?:buy here|buy now|sell now|sell here|take profit|stop out|trim here|add here|exit now|short setup|best entry|safe entry|can buy|should add|should trim|should exit|longs should|traders should|wait for)\b/i;

const resistanceZone: FinalLevelZone = {
  id: "R1",
  symbol: "TEST",
  kind: "resistance",
  timeframeBias: "5m",
  zoneLow: 2.4,
  zoneHigh: 2.5,
  representativePrice: 2.45,
  strengthScore: 80,
  strengthLabel: "major",
  touchCount: 4,
  confluenceCount: 2,
  sourceTypes: ["swing_high"],
  timeframeSources: ["5m"],
  reactionQualityScore: 0.7,
  rejectionScore: 0.5,
  displacementScore: 0.6,
  sessionSignificanceScore: 0.6,
  followThroughScore: 0.6,
  gapContinuationScore: 0,
  sourceEvidenceCount: 4,
  firstTimestamp: 1,
  lastTimestamp: 2,
  isExtension: false,
  freshness: "fresh",
  notes: [],
};

function eventWithContext(
  eventContext: Partial<MonitoringEvent["eventContext"]>,
): MonitoringEvent {
  return {
    id: "event-1",
    episodeId: "episode-1",
    symbol: "TEST",
    type: "breakout",
    eventType: "breakout",
    zoneId: resistanceZone.id,
    zoneKind: "resistance",
    level: resistanceZone.representativePrice,
    triggerPrice: 2.52,
    strength: 0.7,
    confidence: 0.7,
    priority: 60,
    bias: "bullish",
    pressureScore: 0.7,
    eventContext: {
      monitoredZoneId: resistanceZone.id,
      canonicalZoneId: resistanceZone.id,
      zoneFreshness: "fresh",
      zoneOrigin: "canonical",
      remapStatus: "new",
      remappedFromZoneIds: [],
      dataQualityDegraded: false,
      recentlyRefreshed: false,
      recentlyPromotedExtension: false,
      ladderPosition: "inner",
      zoneStrengthLabel: "major",
      ...eventContext,
    },
    timestamp: 1,
    notes: [],
  };
}

function withMarketStructureLiveDiscord<T>(run: () => T): T {
  const previous = process.env.SIGNAL_CATEGORY_MARKET_STRUCTURE_LIVE_DISCORD;
  try {
    process.env.SIGNAL_CATEGORY_MARKET_STRUCTURE_LIVE_DISCORD = "true";
    return run();
  } finally {
    if (previous === undefined) {
      delete process.env.SIGNAL_CATEGORY_MARKET_STRUCTURE_LIVE_DISCORD;
    } else {
      process.env.SIGNAL_CATEGORY_MARKET_STRUCTURE_LIVE_DISCORD = previous;
    }
  }
}

function assertTraderLine(line: string): void {
  assert.doesNotMatch(line, DISCORD_SYSTEM_LANGUAGE_PATTERN);
  assert.doesNotMatch(line, DISCORD_DIRECT_ADVICE_PATTERN);
}

test("stable 5m material structure changes can surface as trader-facing context", () => {
  const context = withMarketStructureLiveDiscord(() =>
    deriveTraderMarketStructureContext(
      eventWithContext({
        stableMarketStructureState: "breakout_holding",
        stableMarketStructurePreviousState: "pressing_range_high",
        stableMarketStructureMaterialChange: true,
        stableMarketStructureConfidence: "high",
        stableMarketStructureMaterialityScore: 0.82,
      }),
      resistanceZone,
    ),
  );

  assert.ok(context);
  assert.equal(context.label, "bullish_building");
  assert.match(context.line, /5m structure is trying to hold above the prior range/);
  assertTraderLine(context.line);
});

test("low-confidence stable 5m structure does not replace existing trader wording", () => {
  const context = withMarketStructureLiveDiscord(() =>
    deriveTraderMarketStructureContext(
      eventWithContext({
        stableMarketStructureState: "breakout_holding",
        stableMarketStructurePreviousState: "pressing_range_high",
        stableMarketStructureMaterialChange: true,
        stableMarketStructureConfidence: "low",
        stableMarketStructureMaterialityScore: 0.82,
      }),
      resistanceZone,
    ),
  );

  assert.ok(context);
  assert.match(context.line, /resistance is trying to become support/);
  assert.doesNotMatch(context.line, /5m structure/);
  assertTraderLine(context.line);
});

test("material stable 5m damage can override stale practical range wording", () => {
  const context = withMarketStructureLiveDiscord(() =>
    deriveTraderMarketStructureContext(
      eventWithContext({
        tradeStructure: {
          state: "range_bound",
          structureKey: "range_bound|2.30-2.50",
          practicalZoneKey: "2.30-2.50",
          traderLine:
            "market structure: TEST is still range-bound between 2.30 and 2.50; small moves inside that band are lower-quality noise",
          reason: "same practical range",
          isMaterialStateChange: false,
        },
        stableMarketStructureState: "trend_damaged",
        stableMarketStructurePreviousState: "higher_lows_intact",
        stableMarketStructureMaterialChange: true,
        stableMarketStructureConfidence: "medium",
        stableMarketStructureMaterialityScore: 0.76,
      }),
      resistanceZone,
    ),
  );

  assert.ok(context);
  assert.equal(context.label, "damaged");
  assert.match(context.line, /5m structure is damaged after losing a pivot/);
  assertTraderLine(context.line);
});

test("material formal BOS/CHOCH structure overrides stale practical wording", () => {
  const context = withMarketStructureLiveDiscord(() =>
    deriveTraderMarketStructureContext(
      eventWithContext({
        tradeStructure: {
          state: "range_bound",
          structureKey: "range_bound|2.30-2.50",
          practicalZoneKey: "2.30-2.50",
          traderLine:
            "market structure: TEST is still range-bound between 2.30 and 2.50; small moves inside that band are lower-quality noise",
          reason: "same practical range",
          isMaterialStateChange: false,
        },
        formalStructureTimeframe: "5m",
        formalStructureBias: "bullish",
        formalStructurePreviousBias: "bullish",
        formalStructureEventType: "bos_bullish",
        formalStructureConfirmation: "displacement_confirmed",
        formalStructureConfidence: "high",
        formalStructureConfidenceScore: 0.88,
        formalStructureMaterialChange: true,
        formalStructureBrokenSwingPrice: 2.36,
        formalStructureProtectedLow: 2.08,
        formalStructureTraderLine:
          "5m structure printed bullish BOS above 2.36; 2.08 is the protected structure low.",
      }),
      resistanceZone,
    ),
  );

  assert.ok(context);
  assert.equal(context.label, "bullish_building");
  assert.match(context.line, /market structure: 5m structure printed bullish BOS/);
  assert.doesNotMatch(context.line, /range-bound between 2\.30 and 2\.50/);
  assertTraderLine(context.line);
});

test("deduped formal structure does not keep replacing the practical structure line", () => {
  const context = withMarketStructureLiveDiscord(() =>
    deriveTraderMarketStructureContext(
      eventWithContext({
        tradeStructure: {
          state: "range_bound",
          structureKey: "range_bound|2.30-2.50",
          practicalZoneKey: "2.30-2.50",
          traderLine:
            "market structure: TEST is still range-bound between 2.30 and 2.50; small moves inside that band are lower-quality noise",
          reason: "same practical range",
          isMaterialStateChange: false,
        },
        formalStructureTimeframe: "5m",
        formalStructureBias: "bullish",
        formalStructurePreviousBias: "bullish",
        formalStructureEventType: "bos_bullish",
        formalStructureConfirmation: "displacement_confirmed",
        formalStructureConfidence: "high",
        formalStructureConfidenceScore: 0.88,
        formalStructureMaterialChange: false,
        formalStructureBrokenSwingPrice: 2.36,
        formalStructureProtectedLow: 2.08,
        formalStructureTraderLine:
          "5m structure printed bullish BOS above 2.36; 2.08 is the protected structure low.",
      }),
      resistanceZone,
    ),
  );

  assert.ok(context);
  assert.equal(context.label, "compression");
  assert.match(context.line, /still range-bound between 2\.30 and 2\.50/);
  assertTraderLine(context.line);
});

test("unchanged stable 5m structure keeps the practical trade structure line", () => {
  const context = withMarketStructureLiveDiscord(() =>
    deriveTraderMarketStructureContext(
      eventWithContext({
        tradeStructure: {
          state: "range_bound",
          structureKey: "range_bound|2.30-2.50",
          practicalZoneKey: "2.30-2.50",
          traderLine:
            "market structure: TEST is still range-bound between 2.30 and 2.50; small moves inside that band are lower-quality noise",
          reason: "same practical range",
          isMaterialStateChange: false,
        },
        stableMarketStructureState: "range_bound",
        stableMarketStructurePreviousState: "range_bound",
        stableMarketStructureMaterialChange: false,
        stableMarketStructureConfidence: "high",
        stableMarketStructureMaterialityScore: 0.12,
      }),
      resistanceZone,
    ),
  );

  assert.ok(context);
  assert.equal(context.label, "compression");
  assert.match(context.line, /still range-bound between 2\.30 and 2\.50/);
  assert.doesNotMatch(context.line, /5m structure/);
  assertTraderLine(context.line);
});
