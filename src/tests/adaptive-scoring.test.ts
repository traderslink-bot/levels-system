import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AdaptiveScoringEngine,
  buildAdaptiveTargetState,
  type AdaptiveScoringConfig,
} from "../lib/monitoring/adaptive-scoring.js";
import type { RankedOpportunity } from "../lib/monitoring/opportunity-engine.js";
import type { OpportunityEvaluationSummary } from "../lib/monitoring/opportunity-evaluator.js";

function makeOpportunity(params: {
  type?: string;
  timestamp?: number;
} = {}): RankedOpportunity {
  return {
    symbol: "AAPL",
    type: params.type ?? "breakout",
    level: 100,
    strength: 0.8,
    confidence: 0.75,
    priority: 80,
    bias: "bullish",
    pressureScore: 0.6,
    structureType: null,
    structureStrength: 0,
    timestamp: params.timestamp ?? 1_000_000,
    score: 0.72,
    normalizedScore: 0.9,
    classification: "medium",
  };
}

function makeSummary(overrides?: Partial<OpportunityEvaluationSummary>): OpportunityEvaluationSummary {
  return {
    totalEvaluated: 20,
    wins: 12,
    losses: 8,
    winRate: 60,
    lossRate: 40,
    expectancy: 0.2,
    averageReturnPct: 0.2,
    averageWinPct: 0.7,
    averageLossPct: -0.55,
    maxDrawdownPct: 1.2,
    signalAccuracy: 0.6,
    expectancyByEventType: {
      breakout: {
        totalEvaluated: 12,
        wins: 8,
        losses: 4,
        winRate: 0.6667,
        lossRate: 0.3333,
        averageWinPct: 0.8,
        averageLossPct: -0.4,
        expectancy: 0.4,
      },
      rejection: {
        totalEvaluated: 12,
        wins: 4,
        losses: 8,
        winRate: 0.3333,
        lossRate: 0.6667,
        averageWinPct: -0.7,
        averageLossPct: 0.3,
        expectancy: -0.35,
      },
    },
    rollingExpectancy: {
      windowSize: 10,
      sampleSize: 10,
      expectancy: 0.18,
    },
    performanceDrift: {
      declining: false,
      currentExpectancy: 0.18,
      previousExpectancy: 0.24,
      delta: -0.06,
    },
    ...overrides,
  };
}

describe("adaptive scoring", () => {
  it("builds positive event-type target boosts and negative penalties", () => {
    const targetState = buildAdaptiveTargetState(
      [makeOpportunity({ type: "breakout" }), makeOpportunity({ type: "rejection" })],
      makeSummary(),
    );

    assert.ok(targetState.eventTypeTargets.breakout!.targetMultiplier > 1);
    assert.ok(targetState.eventTypeTargets.rejection!.targetMultiplier < 1);
    assert.equal(targetState.eventTypeTargets.rejection!.disableIntent, true);
  });

  it("applies global expectancy boost and drift penalty in target state", () => {
    const boosted = buildAdaptiveTargetState(
      [makeOpportunity()],
      makeSummary({ expectancy: 0.4, performanceDrift: { declining: false, currentExpectancy: 0.4, previousExpectancy: 0.2, delta: 0.2 } }),
    );
    const penalized = buildAdaptiveTargetState(
      [makeOpportunity()],
      makeSummary({ expectancy: -0.2, performanceDrift: { declining: true, currentExpectancy: -0.2, previousExpectancy: 0.1, delta: -0.3 } }),
    );

    assert.ok(boosted.targetGlobalMultiplier > 1);
    assert.ok(penalized.targetGlobalMultiplier < 1);
  });

  it("clamps raw target multipliers to configured bounds", () => {
    const config: AdaptiveScoringConfig = {
      positiveExpectancyThreshold: 0.05,
      positiveExpectancyBoost: 1.2,
      negativeExpectancyPenalty: 1.2,
      disableBelowExpectancy: -0.1,
      globalPositiveThreshold: 0.05,
      globalPositiveBoost: 1.1,
      globalNegativePenalty: 1.1,
      driftPenalty: 0.4,
      minMultiplier: 0.4,
      maxMultiplier: 1.4,
    };
    const targetState = buildAdaptiveTargetState(
      [makeOpportunity({ type: "breakout" }), makeOpportunity({ type: "rejection" })],
      makeSummary({
        expectancy: 3,
        expectancyByEventType: {
          breakout: {
            totalEvaluated: 20,
            wins: 15,
            losses: 5,
            winRate: 0.75,
            lossRate: 0.25,
            averageWinPct: 1.3,
            averageLossPct: -0.1,
            expectancy: 3,
          },
          rejection: {
            totalEvaluated: 20,
            wins: 2,
            losses: 18,
            winRate: 0.1,
            lossRate: 0.9,
            averageWinPct: -0.2,
            averageLossPct: 0.9,
            expectancy: -3,
          },
        },
      }),
      config,
    );

    assert.equal(targetState.targetGlobalMultiplier, 1.4);
    assert.equal(targetState.eventTypeTargets.breakout?.targetMultiplier, 1.4);
    assert.equal(targetState.eventTypeTargets.rejection?.targetMultiplier, 0.4);
  });

  it("keeps raw disable intent in diagnostics while live disable waits for stability", () => {
    const engine = new AdaptiveScoringEngine();
    const result = engine.adaptWithDiagnostics(
      [makeOpportunity({ type: "rejection" })],
      makeSummary(),
    );

    assert.equal(result.diagnostics.targetState.eventTypeTargets.rejection?.disableIntent, true);
    assert.equal(result.opportunities.length, 1);
    assert.equal(result.opportunities[0]?.disabled, false);
  });
});
