import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_LEVEL_ENGINE_CONFIG } from "../lib/levels/level-config.js";
import { scoreLevelZones } from "../lib/levels/level-scorer.js";
import type { FinalLevelZone } from "../lib/levels/level-types.js";

function zone(overrides: Partial<FinalLevelZone> = {}): FinalLevelZone {
  return {
    id: "TEST-resistance-1",
    symbol: "TEST",
    kind: "resistance",
    timeframeBias: "4h",
    zoneLow: 1.49,
    zoneHigh: 1.51,
    representativePrice: 1.5,
    strengthScore: 0,
    strengthLabel: "weak",
    touchCount: 1,
    confluenceCount: 1,
    sourceTypes: ["swing_high"],
    timeframeSources: ["4h"],
    reactionQualityScore: 0.2,
    rejectionScore: 0.42,
    displacementScore: 0.2,
    sessionSignificanceScore: 0.1,
    followThroughScore: 0.68,
    sourceEvidenceCount: 1,
    firstTimestamp: Date.now() - 60_000,
    lastTimestamp: Date.now() - 60_000,
    isExtension: false,
    freshness: "fresh",
    notes: [],
    ...overrides,
  };
}

test("scoreLevelZones floors decisive daily/4h single-timeframe reactions to moderate", () => {
  const [scored] = scoreLevelZones([zone()], DEFAULT_LEVEL_ENGINE_CONFIG);

  assert.equal(scored?.strengthLabel, "moderate");
  assert.ok((scored?.strengthScore ?? 0) >= DEFAULT_LEVEL_ENGINE_CONFIG.scoreThresholds.moderate);
  assert.ok(scored?.notes.some((note) => /^decisiveSingleTimeframeFloor=/.test(note)));
});

test("scoreLevelZones keeps low-quality single-timeframe levels weak", () => {
  const [scored] = scoreLevelZones([
    zone({
      touchCount: 0,
      confluenceCount: 0,
      sourceTypes: [],
      followThroughScore: 0,
      rejectionScore: 0,
      reactionQualityScore: 0,
      displacementScore: 0,
      sessionSignificanceScore: 0,
      sourceEvidenceCount: 0,
      freshness: "stale",
    }),
  ], DEFAULT_LEVEL_ENGINE_CONFIG);

  assert.equal(scored?.strengthLabel, "weak");
});

test("scoreLevelZones floors constructive daily/4h swing levels near moderate", () => {
  const [scored] = scoreLevelZones([
    zone({
      timeframeBias: "daily",
      timeframeSources: ["daily"],
      sourceTypes: ["swing_high"],
      reactionQualityScore: 0.16,
      rejectionScore: 0.27,
      followThroughScore: 0.66,
      displacementScore: 0.31,
      sessionSignificanceScore: 0.1,
    }),
  ], DEFAULT_LEVEL_ENGINE_CONFIG);

  assert.equal(scored?.strengthLabel, "moderate");
  assert.ok((scored?.strengthScore ?? 0) >= DEFAULT_LEVEL_ENGINE_CONFIG.scoreThresholds.moderate);
  assert.ok(scored?.notes.some((note) => /^constructiveSingleTimeframeFloor=/.test(note)));
});

test("scoreLevelZones keeps non-constructive higher-timeframe levels weak", () => {
  const [scored] = scoreLevelZones([
    zone({
      timeframeBias: "daily",
      timeframeSources: ["daily"],
      sourceTypes: ["swing_high"],
      touchCount: 1,
      confluenceCount: 0,
      sourceEvidenceCount: 1,
      reactionQualityScore: 0.12,
      rejectionScore: 0.12,
      followThroughScore: 0.2,
      displacementScore: 0.12,
      sessionSignificanceScore: 0,
      freshness: "stale",
    }),
  ], DEFAULT_LEVEL_ENGINE_CONFIG);

  assert.equal(scored?.strengthLabel, "weak");
});

test("scoreLevelZones lifts repeated near-moderate higher-timeframe swing reactions to moderate", () => {
  const scoredZones = scoreLevelZones([
    zone({
      id: "TEST-resistance-repeat",
      timeframeBias: "daily",
      timeframeSources: ["daily"],
      sourceTypes: ["swing_high"],
      touchCount: 2,
      sourceEvidenceCount: 1,
      reactionQualityScore: 0.2,
      rejectionScore: 0,
      followThroughScore: 0.58,
      displacementScore: 0.12,
      sessionSignificanceScore: 0.08,
      freshness: "stale",
    }),
    zone({
      id: "TEST-resistance-next",
      representativePrice: 1.515,
      zoneLow: 1.514,
      zoneHigh: 1.516,
      timeframeBias: "daily",
      timeframeSources: ["daily"],
      sourceTypes: ["swing_high"],
      touchCount: 1,
      sourceEvidenceCount: 1,
      reactionQualityScore: 0.1,
      rejectionScore: 0,
      followThroughScore: 0.45,
      displacementScore: 0.08,
      sessionSignificanceScore: 0.04,
      freshness: "stale",
    }),
  ], DEFAULT_LEVEL_ENGINE_CONFIG);
  const scored = scoredZones.find((item) => item.id === "TEST-resistance-repeat");

  assert.equal(scored?.strengthLabel, "moderate");
  assert.ok((scored?.strengthScore ?? 0) >= DEFAULT_LEVEL_ENGINE_CONFIG.scoreThresholds.moderate);
  assert.ok(scored?.notes.some((note) => /^repeatedHigherTimeframeSwingFloor=(?!0\.0000)/.test(note)));
});

test("scoreLevelZones keeps one-touch higher-timeframe swing reactions weak", () => {
  const [scored] = scoreLevelZones([
    zone({
      timeframeBias: "daily",
      timeframeSources: ["daily"],
      sourceTypes: ["swing_low"],
      touchCount: 1,
      sourceEvidenceCount: 1,
      reactionQualityScore: 0.12,
      rejectionScore: 0,
      followThroughScore: 0.56,
      displacementScore: 0.12,
      sessionSignificanceScore: 0.08,
      freshness: "stale",
    }),
  ], DEFAULT_LEVEL_ENGINE_CONFIG);

  assert.equal(scored?.strengthLabel, "weak");
});

test("scoreLevelZones does not floor 5m-only decisive levels", () => {
  const [scored] = scoreLevelZones([
    zone({
      timeframeBias: "5m",
      timeframeSources: ["5m"],
      reactionQualityScore: 0.8,
      rejectionScore: 0.65,
      followThroughScore: 0.72,
    }),
  ], DEFAULT_LEVEL_ENGINE_CONFIG);

  assert.equal(scored?.strengthLabel, "weak");
});

test("scoreLevelZones caps heavily reused soft-reaction levels below major", () => {
  const [scored] = scoreLevelZones([
    zone({
      touchCount: 32,
      sourceEvidenceCount: 8,
      confluenceCount: 2,
      timeframeSources: ["daily", "4h"],
      reactionQualityScore: 0.66,
      rejectionScore: 0.22,
      followThroughScore: 0.41,
      displacementScore: 0.48,
      sessionSignificanceScore: 0.42,
    }),
  ], DEFAULT_LEVEL_ENGINE_CONFIG);

  assert.equal(scored?.strengthLabel, "moderate");
  assert.ok((scored?.strengthScore ?? 0) < DEFAULT_LEVEL_ENGINE_CONFIG.scoreThresholds.strong);
  assert.ok(scored?.notes.some((note) => /^overTestedDecisionCap=-/.test(note)));
});

test("scoreLevelZones allows repeated high-quality confluence levels to remain major", () => {
  const [scored] = scoreLevelZones([
    zone({
      touchCount: 32,
      sourceEvidenceCount: 8,
      confluenceCount: 3,
      timeframeSources: ["daily", "4h", "5m"],
      reactionQualityScore: 0.7,
      rejectionScore: 0.52,
      followThroughScore: 0.64,
      displacementScore: 0.6,
      sessionSignificanceScore: 0.5,
    }),
  ], DEFAULT_LEVEL_ENGINE_CONFIG);

  assert.equal(scored?.strengthLabel, "major");
  assert.ok((scored?.strengthScore ?? 0) >= DEFAULT_LEVEL_ENGINE_CONFIG.scoreThresholds.major);
});

test("scoreLevelZones caps touch-inflated 5m/4h session anchors with soft follow-through below strong", () => {
  const [scored] = scoreLevelZones([
    zone({
      id: "TEST-support-1",
      kind: "support",
      timeframeBias: "mixed",
      timeframeSources: ["5m", "4h"],
      sourceTypes: ["premarket_low", "swing_low"],
      touchCount: 19,
      sourceEvidenceCount: 3,
      confluenceCount: 2,
      reactionQualityScore: 0.8892,
      rejectionScore: 0.4118,
      followThroughScore: 0.4376,
      displacementScore: 0.3,
      sessionSignificanceScore: 0.45,
      freshness: "fresh",
    }),
  ], DEFAULT_LEVEL_ENGINE_CONFIG);

  assert.equal(scored?.strengthLabel, "moderate");
  assert.ok((scored?.strengthScore ?? 0) < DEFAULT_LEVEL_ENGINE_CONFIG.scoreThresholds.strong);
  assert.ok(scored?.notes.some((note) => /^lowerTimeframeSoftConfluenceCap=-/.test(note)));
});
