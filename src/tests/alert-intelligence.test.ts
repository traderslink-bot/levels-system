import test from "node:test";
import assert from "node:assert/strict";

import type { LevelEngineOutput } from "../lib/levels/level-types.js";
import type { MonitoringEvent } from "../lib/monitoring/monitoring-types.js";
import { AlertIntelligenceEngine } from "../lib/alerts/alert-intelligence-engine.js";

const levels: LevelEngineOutput = {
  symbol: "ALBT",
  generatedAt: 1,
  majorSupport: [],
  majorResistance: [
    {
      id: "zone-major-resistance",
      symbol: "ALBT",
      kind: "resistance",
      timeframeBias: "mixed",
      zoneLow: 100,
      zoneHigh: 101,
      representativePrice: 100.5,
      strengthScore: 60,
      strengthLabel: "major",
      touchCount: 8,
      confluenceCount: 3,
      sourceTypes: ["swing_high"],
      timeframeSources: ["5m", "4h", "daily"],
      reactionQualityScore: 0.9,
      rejectionScore: 0.55,
      displacementScore: 0.8,
      sessionSignificanceScore: 0.4,
      followThroughScore: 0.88,
      gapContinuationScore: 0.22,
      sourceEvidenceCount: 3,
      firstTimestamp: 1,
      lastTimestamp: 2,
      isExtension: false,
      freshness: "fresh",
      notes: ["Major resistance."],
    },
  ],
  intermediateSupport: [],
  intermediateResistance: [],
  intradaySupport: [
    {
      id: "zone-weak-support",
      symbol: "ALBT",
      kind: "support",
      timeframeBias: "5m",
      zoneLow: 98,
      zoneHigh: 98.2,
      representativePrice: 98.1,
      strengthScore: 5,
      strengthLabel: "weak",
      touchCount: 2,
      confluenceCount: 1,
      sourceTypes: ["swing_low"],
      timeframeSources: ["5m"],
      reactionQualityScore: 0.35,
      rejectionScore: 0.25,
      displacementScore: 0.25,
      sessionSignificanceScore: 0.2,
      followThroughScore: 0.34,
      gapContinuationScore: 0,
      sourceEvidenceCount: 1,
      firstTimestamp: 1,
      lastTimestamp: 2,
      isExtension: false,
      freshness: "fresh",
      notes: ["Weak support."],
    },
  ],
  intradayResistance: [],
  extensionLevels: {
    support: [],
    resistance: [
      {
        id: "zone-extension-resistance",
        symbol: "ALBT",
        kind: "resistance",
        timeframeBias: "5m",
        zoneLow: 3.25,
        zoneHigh: 3.35,
        representativePrice: 3.3,
        strengthScore: 28,
        strengthLabel: "strong",
        touchCount: 3,
        confluenceCount: 1,
        sourceTypes: ["swing_high"],
        timeframeSources: ["5m", "4h"],
        reactionQualityScore: 0.72,
        rejectionScore: 0.44,
        displacementScore: 0.64,
        sessionSignificanceScore: 0.25,
        followThroughScore: 0.79,
        gapContinuationScore: 0.18,
        sourceEvidenceCount: 2,
        firstTimestamp: 1,
        lastTimestamp: 2,
        isExtension: true,
        freshness: "fresh",
        notes: ["Extension resistance."],
      },
    ],
  },
  metadata: {
    providerByTimeframe: {},
    dataQualityFlags: [],
    freshness: "fresh",
  },
  specialLevels: {},
};

test("AlertIntelligenceEngine formats strong alerts that pass filtering", () => {
  const engine = new AlertIntelligenceEngine();
  const event: MonitoringEvent = {
    id: "evt-breakout",
    episodeId: "evt-breakout-episode",
    symbol: "ALBT",
    type: "breakout",
    eventType: "breakout",
    zoneId: "zone-major-resistance",
    zoneKind: "resistance",
    level: 100.5,
    triggerPrice: 101.4,
    strength: 0.92,
    confidence: 0.88,
    priority: 92,
    bias: "bullish",
    pressureScore: 0.74,
    eventContext: {
      monitoredZoneId: "monitored-zone-major-resistance",
      canonicalZoneId: "zone-major-resistance",
      zoneFreshness: "fresh",
      zoneOrigin: "canonical",
      remapStatus: "preserved",
      remappedFromZoneIds: ["legacy-zone-major-resistance"],
      dataQualityDegraded: false,
      recentlyRefreshed: true,
      recentlyPromotedExtension: false,
      ladderPosition: "outermost",
      zoneStrengthLabel: "major",
      sourceGeneratedAt: 1,
    },
    timestamp: 10,
    notes: ["Confirmed breakout."],
  };

  const result = engine.processEvent(event, levels);

  assert.equal(result.rawAlert.severity, "critical");
  assert.equal(result.rawAlert.confidence, "high");
  assert.ok(result.formatted);
  assert.equal(result.formatted?.title, "ALBT breakout");
  assert.equal(
    result.formatted?.body,
    [
      "bullish breakout through major resistance 100.00-101.00",
      "why now: price cleared the outermost resistance instead of stalling underneath it",
      "movement: price is still just above the zone high, so the breakout is early (0.4%)",
      "pressure: buyers still have strong control (0.74), backing the move",
      "context: major resistance | outermost | fresh | 5m/4h/daily confluence | recently refreshed",
      "quality: resistance still looks firm, so a clean break matters more",
      "trigger quality: clean trigger with early participation, strong control, and unclear room",
      "trade map: risk to invalidation is about 1.4%; next directional barrier still needs confirmation",
      "watch: hold above 101.00; invalidates back below 100.00",
    ].join("\n"),
  );
  assert.equal(result.rawAlert.tacticalRead, "firm");
  assert.ok(result.rawAlert.tags.includes("outermost"));
  assert.ok(result.rawAlert.scoreComponents.ladderPosition > 0);
  assert.equal(result.rawAlert.scoreComponents.tacticalRead, -6);
});

test("AlertIntelligenceEngine suppresses weak low-confidence compression alerts", () => {
  const engine = new AlertIntelligenceEngine();
  const event: MonitoringEvent = {
    id: "evt-compression",
    episodeId: "evt-compression-episode",
    symbol: "ALBT",
    type: "consolidation",
    eventType: "compression",
    zoneId: "zone-weak-support",
    zoneKind: "support",
    level: 98.1,
    triggerPrice: 98.1,
    strength: 0.22,
    confidence: 0.18,
    priority: 18,
    bias: "neutral",
    pressureScore: 0.21,
    eventContext: {
      monitoredZoneId: "monitored-zone-weak-support",
      canonicalZoneId: "zone-weak-support",
      zoneFreshness: "fresh",
      zoneOrigin: "canonical",
      remapStatus: "new",
      remappedFromZoneIds: [],
      dataQualityDegraded: false,
      recentlyRefreshed: false,
      recentlyPromotedExtension: false,
      ladderPosition: "inner",
      zoneStrengthLabel: "weak",
      sourceGeneratedAt: 1,
    },
    timestamp: 11,
    notes: ["Compression near weak support."],
  };

  const result = engine.processEvent(event, levels);

  assert.equal(result.rawAlert.shouldNotify, false);
  assert.equal(result.rawAlert.confidence, "low");
  assert.equal(result.formatted, null);
});

test("AlertIntelligenceEngine preserves promoted extension significance without flattening it into a normal inner touch", () => {
  const engine = new AlertIntelligenceEngine();
  const outerExtensionEvent: MonitoringEvent = {
    id: "evt-extension-touch",
    episodeId: "evt-extension-touch-episode",
    symbol: "ALBT",
    type: "level_touch",
    eventType: "level_touch",
    zoneId: "ALBT-resistance-monitored-9",
    zoneKind: "resistance",
    level: 3.3,
    triggerPrice: 3.31,
    strength: 0.69,
    confidence: 0.63,
    priority: 70,
    bias: "bullish",
    pressureScore: 0.67,
    eventContext: {
      monitoredZoneId: "ALBT-resistance-monitored-9",
      canonicalZoneId: "zone-extension-resistance",
      zoneFreshness: "fresh",
      zoneOrigin: "promoted_extension",
      remapStatus: "new",
      remappedFromZoneIds: [],
      dataQualityDegraded: false,
      recentlyRefreshed: false,
      recentlyPromotedExtension: true,
      ladderPosition: "extension",
      zoneStrengthLabel: "strong",
      sourceGeneratedAt: 1,
    },
    timestamp: 12,
    notes: ["Promoted extension touch."],
  };
  const weakInnerTouch: MonitoringEvent = {
    id: "evt-inner-touch",
    episodeId: "evt-inner-touch-episode",
    symbol: "ALBT",
    type: "level_touch",
    eventType: "level_touch",
    zoneId: "zone-weak-support",
    zoneKind: "support",
    level: 98.1,
    triggerPrice: 98.12,
    strength: 0.42,
    confidence: 0.36,
    priority: 32,
    bias: "neutral",
    pressureScore: 0.28,
    eventContext: {
      monitoredZoneId: "zone-weak-support",
      canonicalZoneId: "zone-weak-support",
      zoneFreshness: "fresh",
      zoneOrigin: "canonical",
      remapStatus: "new",
      remappedFromZoneIds: [],
      dataQualityDegraded: false,
      recentlyRefreshed: false,
      recentlyPromotedExtension: false,
      ladderPosition: "inner",
      zoneStrengthLabel: "weak",
      sourceGeneratedAt: 1,
    },
    timestamp: 13,
    notes: ["Weak inner touch."],
  };

  const extensionResult = engine.processEvent(outerExtensionEvent, levels);
  const weakResult = engine.processEvent(weakInnerTouch, levels);

  assert.ok(extensionResult.rawAlert.score > weakResult.rawAlert.score);
  assert.ok(extensionResult.formatted);
  assert.equal(
    extensionResult.formatted?.body,
    [
      "price testing heavy resistance 3.25-3.35",
      "why now: price is back at resistance where sellers need to prove control",
      "movement: price is testing inside resistance below the upper edge (1.2%)",
      "pressure: buyers still have workable control (0.67), but follow-through still matters",
      "context: heavy resistance | promoted extension | fresh | 5m/4h confluence",
      "trigger quality: workable trigger with workable control, but follow-through still needs to prove itself",
      "trade map: risk to invalidation is about 1.2%; next directional barrier still needs confirmation",
      "watch: sellers defend 3.25-3.35 before breakout pressure builds",
    ].join("\n"),
  );
  assert.ok(extensionResult.rawAlert.tags.includes("promoted_extension"));
});

test("AlertIntelligenceEngine penalizes degraded data quality and preserves remap context in output", () => {
  const engine = new AlertIntelligenceEngine();
  const cleanEvent: MonitoringEvent = {
    id: "evt-clean",
    episodeId: "evt-clean-episode",
    symbol: "ALBT",
    type: "reclaim",
    eventType: "reclaim",
    zoneId: "zone-major-resistance",
    zoneKind: "resistance",
    level: 100.5,
    triggerPrice: 101.2,
    strength: 0.78,
    confidence: 0.75,
    priority: 81,
    bias: "bullish",
    pressureScore: 0.62,
    eventContext: {
      monitoredZoneId: "monitored-clean",
      canonicalZoneId: "zone-major-resistance",
      zoneFreshness: "aging",
      zoneOrigin: "canonical",
      remapStatus: "merged",
      remappedFromZoneIds: ["old-1", "old-2"],
      dataQualityDegraded: false,
      recentlyRefreshed: true,
      recentlyPromotedExtension: false,
      ladderPosition: "outermost",
      zoneStrengthLabel: "major",
      sourceGeneratedAt: 1,
    },
    timestamp: 14,
    notes: ["Clean reclaim."],
  };
  const degradedEvent: MonitoringEvent = {
    ...cleanEvent,
    id: "evt-degraded",
    episodeId: "evt-degraded-episode",
    eventContext: {
      ...cleanEvent.eventContext,
      dataQualityDegraded: true,
    },
  };

  const cleanResult = engine.processEvent(cleanEvent, levels);
  const degradedResult = engine.processEvent(degradedEvent, levels);

  assert.ok(cleanResult.rawAlert.score > degradedResult.rawAlert.score);
  assert.ok(cleanResult.formatted);
  assert.equal(
    cleanResult.formatted?.body,
    [
      "reclaim back above major resistance 100.00-101.00",
      "why now: buyers got price back above the zone after a real break attempt",
      "movement: price is back just above the zone high, so the reclaim is still early (0.2%)",
      "pressure: buyers still have workable control (0.62), but follow-through still matters",
      "context: major resistance | outermost | aging | 5m/4h/daily confluence | recently refreshed",
      "trigger quality: workable trigger with workable control, but follow-through still needs to prove itself",
      "trade map: risk to invalidation is about 1.2%; next directional barrier still needs confirmation",
      "watch: hold above 101.00; invalidates back below 100.00",
    ].join("\n"),
  );
  assert.ok(cleanResult.formatted?.meta.context.includes("remap:merged"));
  assert.ok(degradedResult.formatted?.meta.context.includes("data_quality_degraded"));
});

test("AlertIntelligenceEngine frames strong support touches as dip-buy tests", () => {
  const engine = new AlertIntelligenceEngine();
  const event: MonitoringEvent = {
    id: "evt-dip-buy",
    episodeId: "evt-dip-buy-episode",
    symbol: "ALBT",
    type: "level_touch",
    eventType: "level_touch",
    zoneId: "zone-major-support",
    zoneKind: "support",
    level: 98.1,
    triggerPrice: 98.14,
    strength: 0.74,
    confidence: 0.7,
    priority: 76,
    bias: "bullish",
    pressureScore: 0.51,
    eventContext: {
      monitoredZoneId: "zone-major-support",
      canonicalZoneId: "zone-major-support",
      zoneFreshness: "fresh",
      zoneOrigin: "canonical",
      remapStatus: "new",
      remappedFromZoneIds: [],
      dataQualityDegraded: false,
      recentlyRefreshed: false,
      recentlyPromotedExtension: false,
      ladderPosition: "outermost",
      zoneStrengthLabel: "strong",
      sourceGeneratedAt: 1,
    },
    timestamp: 18,
    notes: ["Support touch."],
  };
  const supportLevels: LevelEngineOutput = {
    ...levels,
    majorSupport: [
      {
        ...levels.majorResistance[0]!,
        id: "zone-major-support",
        kind: "support",
        zoneLow: 97.8,
        zoneHigh: 98.2,
        representativePrice: 98.1,
        strengthLabel: "strong",
      },
    ],
  };

  const result = engine.processEvent(event, supportLevels);

  assert.equal(
    result.formatted?.body,
    [
      "dip-buy test at heavy support 97.80-98.20",
      "why now: price came back into defended support instead of drifting mid-range",
      "movement: price is testing inside support above the lower edge (0.3%)",
      "pressure: buyers still have workable control (0.51), but follow-through still matters",
      "context: heavy support | outermost | fresh | 5m/4h/daily confluence",
      "quality: support still looks firm with healthy follow-through",
      "room: limited overhead into next resistance 100.50 (+2.4%)",
      "target: first resistance objective 100.50 (+2.4%)",
      "trigger quality: workable trigger with workable control, but follow-through still needs to prove itself",
      "trade map: risk to invalidation 0.3%; room to next resistance 2.4% (~6.9x, favorable skew)",
      "watch: buyers defend 97.80-98.20 before momentum fades",
    ].join("\n"),
  );
  assert.equal(result.rawAlert.tacticalRead, "firm");
  assert.equal(result.rawAlert.scoreComponents.tacticalRead, 4);
});

test("AlertIntelligenceEngine calls out tired structure when a strong-looking zone is tactically fading", () => {
  const engine = new AlertIntelligenceEngine();
  const tiredLevels: LevelEngineOutput = {
    ...levels,
    majorResistance: [
      {
        ...levels.majorResistance[0]!,
        id: "zone-tired-resistance",
        strengthLabel: "strong",
        touchCount: 6,
        reactionQualityScore: 0.46,
        rejectionScore: 0.32,
        followThroughScore: 0.24,
        freshness: "aging",
      },
    ],
  };
  const event: MonitoringEvent = {
    id: "evt-tired-breakout",
    episodeId: "evt-tired-breakout-episode",
    symbol: "ALBT",
    type: "breakout",
    eventType: "breakout",
    zoneId: "zone-tired-resistance",
    zoneKind: "resistance",
    level: 100.5,
    triggerPrice: 101.08,
    strength: 0.71,
    confidence: 0.69,
    priority: 74,
    bias: "bullish",
    pressureScore: 0.58,
    eventContext: {
      monitoredZoneId: "monitored-zone-tired-resistance",
      canonicalZoneId: "zone-tired-resistance",
      zoneFreshness: "aging",
      zoneOrigin: "canonical",
      remapStatus: "preserved",
      remappedFromZoneIds: ["legacy-zone-tired-resistance"],
      dataQualityDegraded: false,
      recentlyRefreshed: false,
      recentlyPromotedExtension: false,
      ladderPosition: "outermost",
      zoneStrengthLabel: "strong",
      sourceGeneratedAt: 1,
    },
    timestamp: 28,
    notes: ["Breakout through tiring resistance."],
  };

  const result = engine.processEvent(event, tiredLevels);

  assert.ok(result.formatted);
  assert.equal(result.rawAlert.tacticalRead, "tired");
  assert.equal(result.rawAlert.scoreComponents.tacticalRead, 4);
  assert.equal(
    result.formatted?.body,
    [
      "bullish breakout through heavy resistance 100.00-101.00",
      "why now: price cleared the outermost resistance instead of stalling underneath it",
      "movement: price is still just above the zone high, so the breakout is early (0.1%)",
      "pressure: buyers still have workable control (0.58), but follow-through still matters",
      "context: heavy resistance | outermost | aging | 5m/4h/daily confluence",
      "quality: resistance looked tactically tired before this test",
      "trigger quality: workable trigger with workable control, but follow-through still needs to prove itself",
      "trade map: risk to invalidation is about 1.1%; next directional barrier still needs confirmation",
      "watch: hold above 101.00; invalidates back below 100.00",
    ].join("\n"),
  );
});

test("AlertIntelligenceEngine suppresses near-duplicate alerts for the same structural situation", () => {
  const engine = new AlertIntelligenceEngine();
  const firstEvent: MonitoringEvent = {
    id: "evt-dup-1",
    episodeId: "evt-dup-episode",
    symbol: "ALBT",
    type: "level_touch",
    eventType: "level_touch",
    zoneId: "zone-major-resistance",
    zoneKind: "resistance",
    level: 100.5,
    triggerPrice: 100.9,
    strength: 0.72,
    confidence: 0.68,
    priority: 72,
    bias: "bullish",
    pressureScore: 0.58,
    eventContext: {
      monitoredZoneId: "monitored-dup",
      canonicalZoneId: "zone-major-resistance",
      zoneFreshness: "fresh",
      zoneOrigin: "canonical",
      remapStatus: "preserved",
      remappedFromZoneIds: ["legacy-dup"],
      dataQualityDegraded: false,
      recentlyRefreshed: true,
      recentlyPromotedExtension: false,
      ladderPosition: "outermost",
      zoneStrengthLabel: "major",
      sourceGeneratedAt: 1,
    },
    timestamp: 20,
    notes: ["Initial outermost touch."],
  };
  const duplicateEvent: MonitoringEvent = {
    ...firstEvent,
    id: "evt-dup-2",
    timestamp: 40,
    triggerPrice: 100.92,
  };

  const firstResult = engine.processEvent(firstEvent, levels);
  const duplicateResult = engine.processEvent(duplicateEvent, levels);

  assert.ok(firstResult.formatted);
  assert.equal(firstResult.delivery.reason, "posted");
  assert.equal(duplicateResult.formatted, null);
  assert.equal(duplicateResult.delivery.reason, "duplicate_context");
});

test("AlertIntelligenceEngine preserves materially new remap state instead of suppressing it as a duplicate", () => {
  const engine = new AlertIntelligenceEngine();
  const preservedEvent: MonitoringEvent = {
    id: "evt-preserved",
    episodeId: "evt-remap-episode",
    symbol: "ALBT",
    type: "breakout",
    eventType: "breakout",
    zoneId: "zone-major-resistance",
    zoneKind: "resistance",
    level: 100.5,
    triggerPrice: 101.25,
    strength: 0.84,
    confidence: 0.8,
    priority: 84,
    bias: "bullish",
    pressureScore: 0.7,
    eventContext: {
      monitoredZoneId: "monitored-remap",
      canonicalZoneId: "zone-major-resistance",
      zoneFreshness: "fresh",
      zoneOrigin: "canonical",
      remapStatus: "preserved",
      remappedFromZoneIds: ["legacy-remap"],
      dataQualityDegraded: false,
      recentlyRefreshed: true,
      recentlyPromotedExtension: false,
      ladderPosition: "outermost",
      zoneStrengthLabel: "major",
      sourceGeneratedAt: 1,
    },
    timestamp: 100,
    notes: ["Preserved breakout."],
  };
  const replacedEvent: MonitoringEvent = {
    ...preservedEvent,
    id: "evt-replaced",
    timestamp: 110,
    eventContext: {
      ...preservedEvent.eventContext,
      remapStatus: "replaced",
      remappedFromZoneIds: ["monitored-old-extension"],
    },
    notes: ["Replaced breakout after remap."],
  };

  const firstResult = engine.processEvent(preservedEvent, levels);
  const secondResult = engine.processEvent(replacedEvent, levels);

  assert.ok(firstResult.formatted);
  assert.ok(secondResult.formatted);
  assert.equal(secondResult.delivery.reason, "posted");
  assert.ok(secondResult.formatted?.meta.context.includes("remap:replaced"));
});
