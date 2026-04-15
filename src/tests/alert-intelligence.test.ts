import test from "node:test";
import assert from "node:assert/strict";

import type { LevelEngineOutput } from "../lib/levels/level-types.js";
import type { MonitoringEvent } from "../lib/monitoring/monitoring-types.js";
import { AlertIntelligenceEngine } from "../lib/alerts/alert-intelligence-engine.js";

const levels: LevelEngineOutput = {
  symbol: "AAPL",
  generatedAt: 1,
  majorSupport: [],
  majorResistance: [
    {
      id: "zone-major-resistance",
      symbol: "AAPL",
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
      firstTimestamp: 1,
      lastTimestamp: 2,
      notes: ["Major resistance."],
    },
  ],
  intermediateSupport: [],
  intermediateResistance: [],
  intradaySupport: [
    {
      id: "zone-weak-support",
      symbol: "AAPL",
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
      firstTimestamp: 1,
      lastTimestamp: 2,
      notes: ["Weak support."],
    },
  ],
  intradayResistance: [],
  specialLevels: {},
};

test("AlertIntelligenceEngine formats strong alerts that pass filtering", () => {
  const engine = new AlertIntelligenceEngine();
  const event: MonitoringEvent = {
    id: "evt-breakout",
    episodeId: "evt-breakout-episode",
    symbol: "AAPL",
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
    timestamp: 10,
    notes: ["Confirmed breakout."],
  };

  const result = engine.processEvent(event, levels);

  assert.equal(result.rawAlert.severity, "critical");
  assert.equal(result.rawAlert.confidence, "high");
  assert.ok(result.formatted);
  assert.equal(result.formatted?.title, "AAPL breakout");
});

test("AlertIntelligenceEngine suppresses weak low-confidence compression alerts", () => {
  const engine = new AlertIntelligenceEngine();
  const event: MonitoringEvent = {
    id: "evt-compression",
    episodeId: "evt-compression-episode",
    symbol: "AAPL",
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
    timestamp: 11,
    notes: ["Compression near weak support."],
  };

  const result = engine.processEvent(event, levels);

  assert.equal(result.rawAlert.shouldNotify, false);
  assert.equal(result.rawAlert.confidence, "low");
  assert.equal(result.formatted, null);
});
