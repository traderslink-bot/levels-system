import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { RankedOpportunity } from "../lib/monitoring/opportunity-engine.js";
import { OpportunityEvaluator } from "../lib/monitoring/opportunity-evaluator.js";

function makeOpportunity(params: {
  symbol?: string;
  type?: string;
  timestamp: number;
  level?: number;
}): RankedOpportunity {
  return {
    symbol: params.symbol ?? "AAPL",
    type: params.type ?? "breakout",
    level: params.level ?? 100,
    strength: 0.8,
    confidence: 0.75,
    priority: 80,
    bias: "bullish",
    pressureScore: 0.6,
    structureType: null,
    structureStrength: 0,
    timestamp: params.timestamp,
    score: 0.72,
    normalizedScore: 0.9,
    classification: "medium",
  };
}

describe("opportunity evaluator", () => {
  it("computes expectancy and per-event-type summaries from evaluated opportunities", () => {
    const evaluator = new OpportunityEvaluator(60_000, false, 10, 0.3, 10, 2);
    const start = 1_000_000;

    evaluator.track(makeOpportunity({ timestamp: start, type: "breakout" }), 100);
    evaluator.updatePrice("AAPL", 100.6, start + 70_000);

    evaluator.track(makeOpportunity({ timestamp: start + 100_000, type: "breakout" }), 100);
    evaluator.updatePrice("AAPL", 99.6, start + 170_000);

    evaluator.track(makeOpportunity({ timestamp: start + 200_000, type: "rejection" }), 100);
    evaluator.updatePrice("AAPL", 99.4, start + 270_000);

    const summary = evaluator.getSummary();

    assert.equal(summary.totalEvaluated, 3);
    assert.equal(summary.wins, 2);
    assert.equal(summary.losses, 1);
    assert.equal(summary.expectancy, -0.1333);
    assert.equal(summary.expectancyByEventType.breakout?.totalEvaluated, 2);
    assert.equal(summary.expectancyByEventType.rejection?.wins, 1);
  });

  it("supports early exit and tracks drawdown before completion", () => {
    const evaluator = new OpportunityEvaluator(10 * 60 * 1000, false, 10, 0.3, 0.3, 5);
    const start = 2_000_000;

    evaluator.track(makeOpportunity({ timestamp: start, type: "breakout" }), 100);
    assert.equal(evaluator.updatePrice("AAPL", 99.8, start + 30_000).completed.length, 0);

    const completed = evaluator.updatePrice("AAPL", 100.4, start + 60_000).completed;
    const summary = evaluator.getSummary();

    assert.equal(completed.length, 1);
    assert.equal(completed[0]?.success, true);
    assert.equal(summary.maxDrawdownPct, 0.2);
  });

  it("computes rolling expectancy and flags declining drift across windows", () => {
    const evaluator = new OpportunityEvaluator(60_000, false, 10, 0.3, 10, 2);
    const start = 3_000_000;

    evaluator.track(makeOpportunity({ timestamp: start, type: "breakout" }), 100);
    evaluator.updatePrice("AAPL", 100.7, start + 70_000);

    evaluator.track(makeOpportunity({ timestamp: start + 100_000, type: "breakout" }), 100);
    evaluator.updatePrice("AAPL", 99.6, start + 170_000);

    evaluator.track(makeOpportunity({ timestamp: start + 200_000, type: "breakout" }), 100);
    evaluator.updatePrice("AAPL", 99.4, start + 270_000);

    const summary = evaluator.getSummary();

    assert.equal(summary.rollingExpectancy.windowSize, 2);
    assert.equal(summary.rollingExpectancy.sampleSize, 2);
    assert.ok(summary.rollingExpectancy.expectancy < 0);
    assert.equal(summary.performanceDrift.declining, true);
    assert.ok(summary.performanceDrift.delta < 0);
  });

  it("emits live progress updates before final evaluation", () => {
    const evaluator = new OpportunityEvaluator(10 * 60 * 1000, false, 10, 0.3, 1.5, 5);
    const start = 4_000_000;

    evaluator.track(makeOpportunity({ timestamp: start, type: "breakout" }), 100);

    const first = evaluator.updatePrice("AAPL", 100.35, start + 70_000);
    const second = evaluator.updatePrice("AAPL", 100.12, start + 220_000);

    assert.equal(first.completed.length, 0);
    assert.equal(first.progressUpdates.length, 1);
    assert.equal(first.progressUpdates[0]?.progressLabel, "improving");
    assert.equal(second.completed.length, 0);
    assert.equal(second.progressUpdates.length, 1);
    assert.equal(second.progressUpdates[0]?.progressLabel, "stalling");
  });
});
