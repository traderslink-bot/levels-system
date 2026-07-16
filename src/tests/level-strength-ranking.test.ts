import assert from "node:assert/strict";
import test from "node:test";

import { computeActiveRelevanceScore } from "../lib/levels/level-active-scoring.js";
import { applyClusterPenalties, chooseClusterRepresentative, clusterLevels } from "../lib/levels/level-clustering.js";
import { LEVEL_SCORE_CONFIG } from "../lib/levels/level-score-config.js";
import { explainLevelScore } from "../lib/levels/level-score-explainer.js";
import { deriveLevelState } from "../lib/levels/level-state-engine.js";
import { computeStructuralStrengthScore } from "../lib/levels/level-structural-scoring.js";
import { analyzeLevelTouches } from "../lib/levels/level-touch-analysis.js";
import type { LevelCandidate, LevelTouch, LevelType, RankedLevel, SourceTimeframe } from "../lib/levels/level-types.js";
import { rankLevels } from "../lib/levels/level-ranking.js";
import { selectSurfacedLevels } from "../lib/levels/level-surfaced-selection.js";

function makeTouch(overrides: Partial<LevelTouch> = {}): LevelTouch {
  return {
    candleTimestamp: 1,
    timeframe: "daily",
    reactionType: "rejection",
    touchDistancePct: 0.0012,
    reactionMovePct: 0.032,
    reactionMoveCandles: 2,
    volumeRatio: 1.55,
    closedAwayFromLevel: true,
    wickRejectStrength: 0.72,
    bodyRejectStrength: 0.58,
    ...overrides,
  };
}

function summarizeTouches(touches: LevelTouch[]) {
  const meaningfulTouches = touches.filter(
    (touch) =>
      touch.reactionMovePct >= LEVEL_SCORE_CONFIG.touchThresholds.minReactionMovePct ||
      touch.volumeRatio >= LEVEL_SCORE_CONFIG.touchThresholds.minVolumeRatioForMeaningfulReaction ||
      (touch.closedAwayFromLevel && (touch.wickRejectStrength >= 0.4 || touch.bodyRejectStrength >= 0.4)) ||
      touch.reactionType === "failed_break" ||
      touch.reactionType === "reclaim",
  );
  const reactionMoves = meaningfulTouches.map((touch) => touch.reactionMovePct);
  const volumeRatios = meaningfulTouches.map((touch) => touch.volumeRatio);

  return {
    touches,
    touchCount: touches.length,
    meaningfulTouchCount: meaningfulTouches.length,
    rejectionCount: touches.filter((touch) => touch.reactionType === "rejection").length,
    failedBreakCount: touches.filter((touch) => touch.reactionType === "failed_break").length,
    cleanBreakCount: touches.filter((touch) => touch.reactionType === "clean_break").length,
    reclaimCount: touches.filter((touch) => touch.reactionType === "reclaim").length,
    strongestReactionMovePct: reactionMoves.length > 0 ? Math.max(...reactionMoves) : 0,
    averageReactionMovePct: reactionMoves.length > 0 ? reactionMoves.reduce((sum, value) => sum + value, 0) / reactionMoves.length : 0,
    bestVolumeRatio: volumeRatios.length > 0 ? Math.max(...volumeRatios) : 1,
    averageVolumeRatio: volumeRatios.length > 0 ? volumeRatios.reduce((sum, value) => sum + value, 0) / volumeRatios.length : 1,
    cleanlinessStdDevPct:
      touches.length > 1
        ? Math.sqrt(
            touches.reduce((sum, touch) => sum + (touch.touchDistancePct - touches.reduce((inner, item) => inner + item.touchDistancePct, 0) / touches.length) ** 2, 0) /
              touches.length,
          )
        : 0,
    ageInBars: 25,
    barsSinceLastReaction: 2,
  };
}

type CompleteLevelCandidate = LevelCandidate & {
  zoneLow: number;
  zoneHigh: number;
  touches: LevelTouch[];
  touchCount: number;
  meaningfulTouchCount: number;
  rejectionCount: number;
  failedBreakCount: number;
  cleanBreakCount: number;
  reclaimCount: number;
  roleFlipCount: number;
  strongestReactionMovePct: number;
  averageReactionMovePct: number;
  bestVolumeRatio: number;
  averageVolumeRatio: number;
  cleanlinessStdDevPct: number;
  ageInBars: number;
  barsSinceLastReaction: number;
};

function makeLevel(overrides: Partial<CompleteLevelCandidate> = {}): CompleteLevelCandidate {
  const touches =
    overrides.touches ??
    [
      makeTouch({ candleTimestamp: 1 }),
      makeTouch({ candleTimestamp: 2, timeframe: "4h" }),
      makeTouch({ candleTimestamp: 3, reactionType: "failed_break" }),
    ];
  const summary = summarizeTouches(touches);

  const level: CompleteLevelCandidate = {
    id: "level-1",
    symbol: "TEST",
    type: "support",
    price: 10,
    zoneLow: 9.975,
    zoneHigh: 10.025,
    sourceTimeframes: ["daily"],
    originKinds: ["swing_low"],
    ...summary,
    roleFlipCount: 0,
    ...overrides,
  };

  return level;
}

function makeContext(overrides: Partial<Parameters<typeof rankLevels>[1]> = {}) {
  return {
    symbol: "TEST",
    currentPrice: 10.5,
    latestTimestamp: Date.parse("2026-04-17T14:30:00Z"),
    currentTimeframe: "5m" as const,
    recentCandles: [],
    ...overrides,
  };
}

test("higher timeframe level outranks lower timeframe level with equal reactions", () => {
  const dailyLevel = makeLevel({
    id: "daily",
    sourceTimeframes: ["daily"],
  });
  const lowerLevel = makeLevel({
    id: "5m",
    sourceTimeframes: ["5m"],
    price: 10.04,
    zoneLow: 10.01,
    zoneHigh: 10.07,
  });

  const ranked = rankLevels([lowerLevel, dailyLevel], makeContext());

  assert.equal(ranked.supports[0]?.id, "daily");
});

test("candidate candles retain their higher-timeframe identity during touch analysis", () => {
  const candidate: LevelCandidate = {
    id: "daily-analysis-candles",
    symbol: "TEST",
    type: "support",
    price: 10,
    zoneLow: 9.975,
    zoneHigh: 10.025,
    sourceTimeframes: ["daily"],
    originKinds: ["swing_low"],
    analysisCandles: [
      { timestamp: 1, open: 10.1, high: 10.2, low: 9.99, close: 10.15, volume: 100 },
      { timestamp: 2, open: 10.12, high: 10.3, low: 10.08, close: 10.25, volume: 120 },
    ],
  };

  const ranked = rankLevels([candidate], makeContext({ currentTimeframe: "5m" }));

  assert.ok((ranked.supports[0]?.touches.length ?? 0) > 0);
  assert.ok(ranked.supports[0]?.touches.every((touch) => touch.timeframe === "daily"));
});

test("context candles retain the context timeframe when a candidate has no own series", () => {
  const candidate: LevelCandidate = {
    id: "daily-candidate-context-candles",
    symbol: "TEST",
    type: "support",
    price: 10,
    zoneLow: 9.975,
    zoneHigh: 10.025,
    sourceTimeframes: ["daily"],
    originKinds: ["swing_low"],
  };
  const ranked = rankLevels([
    candidate,
  ], makeContext({
    currentTimeframe: "5m",
    recentCandles: [
      { timestamp: 1, open: 10.1, high: 10.2, low: 9.99, close: 10.15, volume: 100 },
      { timestamp: 2, open: 10.12, high: 10.3, low: 10.08, close: 10.25, volume: 120 },
    ],
  }));

  assert.ok((ranked.supports[0]?.touches.length ?? 0) > 0);
  assert.ok(ranked.supports[0]?.touches.every((touch) => touch.timeframe === "5m"));
});

test("multi timeframe confluence boosts timeframe score without breaking cap", () => {
  const single = computeStructuralStrengthScore(
    makeLevel({ sourceTimeframes: ["4h"] }),
  );
  const confluent = computeStructuralStrengthScore(
    makeLevel({ sourceTimeframes: ["4h", "1h"] }),
  );
  const capped = computeStructuralStrengthScore(
    makeLevel({ sourceTimeframes: ["daily", "4h"] }),
  );

  assert.ok(confluent.scoreBreakdown.timeframeScore > single.scoreBreakdown.timeframeScore);
  assert.equal(capped.scoreBreakdown.timeframeScore, 20);
});

test("non reactive contacts do not inflate meaningfulTouchCount and stronger reactions outrank weak taps", () => {
  const baseTimestamp = Date.parse("2026-04-17T13:30:00Z");
  const weakTapCandles = Array.from({ length: 8 }, (_, index) => ({
    timestamp: baseTimestamp + index * 60_000,
    open: 10.02,
    high: 10.03,
    low: 9.995,
    close: 10.01,
    volume: 1000,
  }));
  const meaningfulCandles = [
    { timestamp: baseTimestamp, open: 10.3, high: 10.32, low: 10.12, close: 10.22, volume: 1000 },
    { timestamp: baseTimestamp + 60_000, open: 10.18, high: 10.2, low: 9.99, close: 10.15, volume: 1800 },
    { timestamp: baseTimestamp + 120_000, open: 10.16, high: 10.48, low: 10.12, close: 10.44, volume: 1500 },
    { timestamp: baseTimestamp + 180_000, open: 10.4, high: 10.41, low: 10.18, close: 10.3, volume: 900 },
    { timestamp: baseTimestamp + 240_000, open: 10.25, high: 10.28, low: 9.98, close: 10.16, volume: 1900 },
    { timestamp: baseTimestamp + 300_000, open: 10.18, high: 10.52, low: 10.15, close: 10.5, volume: 1550 },
    { timestamp: baseTimestamp + 360_000, open: 10.46, high: 10.47, low: 10.21, close: 10.26, volume: 950 },
    { timestamp: baseTimestamp + 420_000, open: 10.22, high: 10.25, low: 9.97, close: 10.18, volume: 2000 },
    { timestamp: baseTimestamp + 480_000, open: 10.2, high: 10.58, low: 10.18, close: 10.56, volume: 1700 },
  ];

  const weakAnalysis = analyzeLevelTouches({ price: 10, type: "support" }, weakTapCandles, "5m");
  const strongAnalysis = analyzeLevelTouches({ price: 10, type: "support" }, meaningfulCandles, "5m");

  assert.equal(weakAnalysis.meaningfulTouchCount, 0);
  assert.ok(strongAnalysis.meaningfulTouchCount >= 3);

  const ranked = rankLevels(
    [
      makeLevel({ id: "weak", sourceTimeframes: ["5m"], ...weakAnalysis }),
      makeLevel({ id: "strong", sourceTimeframes: ["5m"], ...strongAnalysis }),
    ],
    makeContext({ currentPrice: 10.2 }),
  );

  assert.equal(ranked.supports[0]?.id, "strong");
});

test("zero-volume five-minute placeholders do not count as level touches", () => {
  const baseTimestamp = Date.parse("2026-07-01T13:30:00Z");
  const candles = Array.from({ length: 6 }, (_, index) => ({
    timestamp: baseTimestamp + index * 5 * 60_000,
    open: 10,
    high: 10.05,
    low: 9.95,
    close: 10,
    volume: index === 2 ? 500 : 0,
  }));

  const analysis = analyzeLevelTouches(
    { price: 10, type: "support", zoneLow: 9.95, zoneHigh: 10.05 },
    candles,
    "5m",
  );

  assert.equal(analysis.touchCount, 1);
});

test("one break episode counts once until the level is reclaimed", () => {
  const baseTimestamp = Date.parse("2026-07-01T13:30:00Z");
  const candles = [
    { timestamp: baseTimestamp, open: 10.2, high: 10.3, low: 9.9, close: 10.1, volume: 1000 },
    { timestamp: baseTimestamp + 60_000, open: 10, high: 10.05, low: 9.6, close: 9.7, volume: 1000 },
    { timestamp: baseTimestamp + 120_000, open: 9.7, high: 9.8, low: 9.4, close: 9.5, volume: 1000 },
    { timestamp: baseTimestamp + 180_000, open: 9.5, high: 9.7, low: 9.2, close: 9.4, volume: 1000 },
    { timestamp: baseTimestamp + 240_000, open: 9.4, high: 9.6, low: 9.1, close: 9.3, volume: 1000 },
  ];

  const analysis = analyzeLevelTouches(
    { price: 10, type: "support", zoneLow: 9.95, zoneHigh: 10.05 },
    candles,
    "5m",
  );

  assert.equal(analysis.cleanBreakCount, 1);
});

test("a reclaim permits a later break to begin a second episode", () => {
  const baseTimestamp = Date.parse("2026-07-01T13:30:00Z");
  const candles = [
    { timestamp: baseTimestamp, open: 10.1, high: 10.2, low: 9.9, close: 10.05, volume: 1000 },
    { timestamp: baseTimestamp + 60_000, open: 10, high: 10.02, low: 9.6, close: 9.7, volume: 1000 },
    { timestamp: baseTimestamp + 120_000, open: 9.7, high: 9.8, low: 9.4, close: 9.6, volume: 1000 },
    { timestamp: baseTimestamp + 180_000, open: 9.7, high: 10.3, low: 9.6, close: 10.2, volume: 1000 },
    { timestamp: baseTimestamp + 240_000, open: 10.1, high: 10.15, low: 9.6, close: 9.7, volume: 1000 },
    { timestamp: baseTimestamp + 300_000, open: 9.7, high: 9.8, low: 9.4, close: 9.6, volume: 1000 },
  ];

  const analysis = analyzeLevelTouches(
    { price: 10, type: "support", zoneLow: 9.95, zoneHigh: 10.05 },
    candles,
    "5m",
  );

  assert.equal(analysis.cleanBreakCount, 2);
  assert.equal(analysis.reclaimCount, 1);
});

test("tight repeated reaction zone scores higher than messy wide zone", () => {
  const clean = computeStructuralStrengthScore(
    makeLevel({ cleanlinessStdDevPct: 0.0008 }),
  );
  const messy = computeStructuralStrengthScore(
    makeLevel({ id: "messy", cleanlinessStdDevPct: 0.008 }),
  );

  assert.ok(clean.scoreBreakdown.cleanlinessScore > messy.scoreBreakdown.cleanlinessScore);
  assert.ok(clean.structuralStrengthScore > messy.structuralStrengthScore);
});

test("role flip adds structural bonus and repeated role flips cap at configured maximum", () => {
  const noFlip = computeStructuralStrengthScore(makeLevel({ roleFlipCount: 0 }));
  const oneFlip = computeStructuralStrengthScore(makeLevel({ roleFlipCount: 1 }));
  const manyFlips = computeStructuralStrengthScore(makeLevel({ roleFlipCount: 5 }));

  assert.ok(oneFlip.scoreBreakdown.roleFlipScore > noFlip.scoreBreakdown.roleFlipScore);
  assert.equal(manyFlips.scoreBreakdown.roleFlipScore, 8);
});

test("an unproven role_flip origin tag earns no flip score or flipped state", () => {
  const taggedOnly = makeLevel({
    originKinds: ["role_flip"],
    roleFlipCount: 0,
    touchCount: 1,
    meaningfulTouchCount: 0,
    touches: [makeTouch({
      reactionType: "tap",
      reactionMovePct: 0,
      volumeRatio: 1,
      closedAwayFromLevel: false,
      wickRejectStrength: 0,
      bodyRejectStrength: 0,
    })],
  });

  assert.equal(computeStructuralStrengthScore(taggedOnly).scoreBreakdown.roleFlipScore, 0);
  assert.notEqual(deriveLevelState(taggedOnly), "flipped");
});

test("repeated shallow tests reduce structural score and overtest penalty is stronger when reaction quality is weak", () => {
  const weaklyOvertested = computeStructuralStrengthScore(
    makeLevel({
      touchCount: 8,
      meaningfulTouchCount: 6,
      averageReactionMovePct: 0.009,
      strongestReactionMovePct: 0.015,
      rejectionCount: 1,
      failedBreakCount: 0,
      reclaimCount: 0,
    }),
  );
  const stronglyRetested = computeStructuralStrengthScore(
    makeLevel({
      id: "stronger",
      touchCount: 8,
      meaningfulTouchCount: 6,
      averageReactionMovePct: 0.04,
      strongestReactionMovePct: 0.08,
      rejectionCount: 4,
      failedBreakCount: 2,
      reclaimCount: 1,
    }),
  );

  assert.ok(Math.abs(weaklyOvertested.scoreBreakdown.overtestPenalty) > Math.abs(stronglyRetested.scoreBreakdown.overtestPenalty));
  assert.ok(weaklyOvertested.structuralStrengthScore < stronglyRetested.structuralStrengthScore);
});

test("nearby duplicate levels form one cluster and weaker duplicate receives a cluster penalty", () => {
  const stronger = {
    ...makeLevel({ id: "stronger", price: 10, zoneLow: 9.98, zoneHigh: 10.02, sourceTimeframes: ["daily"] }),
    structuralStrengthScore: 78,
    cleanlinessStdDevPct: 0.001,
  };
  const weaker = {
    ...makeLevel({ id: "weaker", price: 10.015, zoneLow: 9.995, zoneHigh: 10.035, sourceTimeframes: ["5m"] }),
    structuralStrengthScore: 52,
    cleanlinessStdDevPct: 0.004,
  };
  const clusters = clusterLevels([stronger, weaker]);
  const penalized = applyClusterPenalties([stronger, weaker], clusters);
  const representative = chooseClusterRepresentative([stronger, weaker]);
  const penalizedWeaker = penalized.find((level) => level.id === "weaker");

  assert.equal(clusters.length, 1);
  assert.equal(representative.id, "stronger");
  assert.ok((penalizedWeaker?.clusterPenalty ?? 0) < 0);
});

test("cluster representative preserves multi-timeframe confluence and one confirmed flip", () => {
  const daily = makeLevel({
    id: "daily-cluster-member",
    price: 10,
    zoneLow: 9.98,
    zoneHigh: 10.02,
    sourceTimeframes: ["daily"],
    originKinds: ["swing_low"],
    roleFlipCount: 0,
    touchCount: 3,
    meaningfulTouchCount: 3,
  });
  const fourHourFlip = makeLevel({
    id: "four-hour-flip-cluster-member",
    price: 10.01,
    zoneLow: 9.99,
    zoneHigh: 10.03,
    sourceTimeframes: ["4h"],
    originKinds: ["swing_high", "role_flip"],
    roleFlipCount: 1,
    roleFlipEvidence: {
      originalType: "resistance",
      flippedType: "support",
      timeframe: "4h",
      formationTimestamp: 1,
      firstBreakTimestamp: 2,
      confirmationTimestamp: 3,
      retestTimestamp: 4,
      reactionTimestamp: 5,
    },
    touchCount: 2,
    meaningfulTouchCount: 2,
  });

  const ranked = rankLevels(
    [daily, fourHourFlip],
    makeContext({ currentPrice: 10.5 }),
  );
  const surfaced = selectSurfacedLevels(ranked);
  const representative = surfaced.surfacedSupports[0];

  assert.equal(surfaced.surfacedSupports.length, 1);
  assert.equal(surfaced.suppressedNearDuplicates.length, 1);
  assert.ok(representative);
  assert.deepEqual([...representative.sourceTimeframes].sort(), ["4h", "daily"]);
  assert.ok(representative.originKinds.includes("role_flip"));
  assert.equal(representative.roleFlipCount, 1);
  assert.equal(representative.roleFlipEvidence?.reactionTimestamp, 5);
  assert.equal(representative.state, "flipped");
  assert.ok(representative.touchCount === 2 || representative.touchCount === 3);
});

test("support and resistance at the same price never share a duplicate cluster", () => {
  const support = makeLevel({
    id: "same-price-support",
    type: "support",
  });
  const resistance = makeLevel({
    id: "same-price-resistance",
    type: "resistance",
  });

  const clusters = clusterLevels([support, resistance]);

  assert.equal(clusters.length, 2);
  assert.deepEqual(clusters.map((cluster) => cluster.type).sort(), ["resistance", "support"]);
});

test("an interleaved opposite-side level cannot split same-side confluence", () => {
  const supportOne = makeLevel({
    id: "support-one",
    type: "support",
    price: 10,
    zoneLow: 9.98,
    zoneHigh: 10.02,
  });
  const resistance = makeLevel({
    id: "interleaved-resistance",
    type: "resistance",
    price: 10.01,
    zoneLow: 9.99,
    zoneHigh: 10.03,
  });
  const supportTwo = makeLevel({
    id: "support-two",
    type: "support",
    price: 10.02,
    zoneLow: 10,
    zoneHigh: 10.04,
  });

  const clusters = clusterLevels([supportOne, resistance, supportTwo]);
  const supportCluster = clusters.find((cluster) => cluster.type === "support");

  assert.equal(clusters.length, 2);
  assert.deepEqual(supportCluster?.memberIds, ["support-one", "support-two"]);
});

test("state engine covers fresh, respected, weakened, broken, reclaimed, and flipped transitions", () => {
  assert.equal(
    deriveLevelState(makeLevel({ touchCount: 1, meaningfulTouchCount: 0, touches: [makeTouch({ reactionType: "tap", reactionMovePct: 0.003, volumeRatio: 1, closedAwayFromLevel: false, wickRejectStrength: 0.1, bodyRejectStrength: 0.1 })] })),
    "fresh",
  );
  assert.equal(deriveLevelState(makeLevel({ touchCount: 3, meaningfulTouchCount: 3 })), "respected");
  assert.equal(
    deriveLevelState(
      makeLevel({
        touchCount: 6,
        meaningfulTouchCount: 5,
        averageReactionMovePct: 0.01,
        touches: [
          makeTouch({ reactionMovePct: 0.03 }),
          makeTouch({ reactionMovePct: 0.02 }),
          makeTouch({ reactionMovePct: 0.01 }),
        ],
      }),
    ),
    "weakened",
  );
  assert.equal(
    deriveLevelState(makeLevel({ cleanBreakCount: 1, reclaimCount: 0, touches: [makeTouch({ reactionType: "clean_break" })] })),
    "broken",
  );
  assert.equal(
    deriveLevelState(makeLevel({ cleanBreakCount: 1, reclaimCount: 1, touches: [makeTouch({ reactionType: "clean_break" }), makeTouch({ reactionType: "reclaim" })] })),
    "reclaimed",
  );
  assert.equal(
    deriveLevelState(makeLevel({ roleFlipCount: 1, originKinds: ["role_flip"] })),
    "flipped",
  );
});

test("a confirmed role flip can later become weakened without losing provenance", () => {
  const level = makeLevel({
    roleFlipCount: 1,
    originKinds: ["swing_high", "role_flip"],
    touchCount: 6,
    meaningfulTouchCount: 5,
    averageReactionMovePct: 0.01,
  });

  assert.equal(deriveLevelState(level), "weakened");
  assert.equal(level.roleFlipCount, 1);
  assert.ok(level.originKinds.includes("role_flip"));
});

test("closer level gets higher active score, recent interaction helps, and compression into resistance increases pressure", () => {
  const compressionCandles = [
    { timestamp: 1, open: 11.1, high: 11.7, low: 10.8, close: 11.3, volume: 1000 },
    { timestamp: 2, open: 11.25, high: 11.8, low: 10.95, close: 11.45, volume: 1100 },
    { timestamp: 3, open: 11.4, high: 11.88, low: 11.1, close: 11.6, volume: 1300 },
    { timestamp: 4, open: 11.55, high: 11.94, low: 11.28, close: 11.74, volume: 1500 },
    { timestamp: 5, open: 11.72, high: 11.98, low: 11.44, close: 11.88, volume: 1700 },
  ];
  const nearResistance = makeLevel({
    type: "resistance",
    price: 12,
    zoneLow: 11.97,
    zoneHigh: 12.03,
    sourceTimeframes: ["4h"],
  });
  const farResistance = makeLevel({
    id: "far",
    type: "resistance",
    price: 12.8,
    zoneLow: 12.77,
    zoneHigh: 12.83,
    sourceTimeframes: ["4h"],
  });
  const nearScore = computeActiveRelevanceScore(
    nearResistance as unknown as RankedLevel,
    makeContext({ currentPrice: 11.99, recentCandles: compressionCandles, currentSessionVolumeRatio: 1.6 }),
  );
  const farScore = computeActiveRelevanceScore(
    farResistance as unknown as RankedLevel,
    makeContext({ currentPrice: 11.99, recentCandles: compressionCandles, currentSessionVolumeRatio: 1.6 }),
  );

  assert.ok(nearScore.activeRelevanceScore > farScore.activeRelevanceScore);
  assert.ok(nearScore.scoreBreakdown.currentInteractionScore >= 6);
  assert.ok(nearScore.scoreBreakdown.intradayPressureScore >= 10);
});

test("remote historical volume cannot masquerade as current active volume", () => {
  const remoteResistance = makeLevel({
    type: "resistance",
    price: 20,
    zoneLow: 19.95,
    zoneHigh: 20.05,
    averageVolumeRatio: 4,
    bestVolumeRatio: 5,
  });
  const context = makeContext({
    currentPrice: 10,
    currentSessionVolumeRatio: 3,
    recentCandles: [
      { timestamp: 1, open: 19.9, high: 20.1, low: 19.8, close: 20, volume: 1000 },
      { timestamp: 2, open: 20, high: 20.2, low: 19.9, close: 20.1, volume: 3000 },
    ],
  });

  const score = computeActiveRelevanceScore(
    remoteResistance as unknown as RankedLevel,
    context,
  );

  assert.equal(score.scoreBreakdown.recentVolumeActivityScore, 3);
});

test("final ranking combines structural and active scores correctly and still favors stronger structure over a slightly closer weak level", () => {
  const structurallyStrong = makeLevel({
    id: "structural",
    price: 10.15,
    zoneLow: 10.12,
    zoneHigh: 10.18,
    sourceTimeframes: ["daily", "4h"],
    averageReactionMovePct: 0.045,
    strongestReactionMovePct: 0.08,
    meaningfulTouchCount: 4,
    touchCount: 5,
    rejectionCount: 3,
    failedBreakCount: 2,
  });
  const closerButWeak = makeLevel({
    id: "closer",
    price: 10.42,
    zoneLow: 10.39,
    zoneHigh: 10.45,
    sourceTimeframes: ["5m"],
    averageReactionMovePct: 0.012,
    strongestReactionMovePct: 0.018,
    meaningfulTouchCount: 1,
    touchCount: 5,
    rejectionCount: 1,
    failedBreakCount: 0,
    reclaimCount: 0,
  });

  const ranked = rankLevels([closerButWeak, structurallyStrong], makeContext({ currentPrice: 10.5 }));
  const top = ranked.supports[0]!;
  const runnerUp = ranked.supports[1]!;

  assert.equal(top.id, "structural");
  assert.equal(
    Number(top.finalLevelScore.toFixed(4)),
    Number((top.structuralStrengthScore * 0.75 + top.activeRelevanceScore * 0.25).toFixed(4)),
  );
  assert.ok(top.score > runnerUp.score);
});

test("explanations mention actual drivers and weakened wording is appropriate", () => {
  const ranked = rankLevels(
    [
      makeLevel({
        id: "explained",
        type: "resistance",
        price: 12,
        zoneLow: 11.98,
        zoneHigh: 12.02,
        sourceTimeframes: ["daily", "4h"],
        meaningfulTouchCount: 3,
        rejectionCount: 3,
        bestVolumeRatio: 1.8,
        averageVolumeRatio: 1.45,
      }),
      makeLevel({
        id: "weakened",
        type: "resistance",
        price: 12.4,
        zoneLow: 12.37,
        zoneHigh: 12.43,
        sourceTimeframes: ["daily"],
        touchCount: 6,
        meaningfulTouchCount: 4,
        averageReactionMovePct: 0.01,
        touches: [
          makeTouch({ reactionMovePct: 0.03 }),
          makeTouch({ reactionMovePct: 0.02 }),
          makeTouch({ reactionMovePct: 0.01 }),
        ],
      }),
    ],
    makeContext({ currentPrice: 11.95 }),
  );
  const explained = ranked.resistances.find((level) => level.id === "explained")!;
  const weakened = ranked.resistances.find((level) => level.id === "weakened")!;

  assert.match(explained.explanation, /daily/i);
  assert.match(explained.explanation, /meaningful|volume|confluence/i);
  assert.match(weakened.explanation, /weakened/i);
  assert.match(explainLevelScore(weakened), /shallow tests/i);
});
