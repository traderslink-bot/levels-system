import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AdaptiveScoringEngine } from "../lib/monitoring/adaptive-scoring.js";
import type { MonitoringEvent } from "../lib/monitoring/monitoring-types.js";
import { OpportunityEvaluator } from "../lib/monitoring/opportunity-evaluator.js";
import { OpportunityRuntimeController } from "../lib/monitoring/opportunity-runtime-controller.js";

function makeEvent(params: {
  symbol?: string;
  type?: MonitoringEvent["type"];
  eventType?: MonitoringEvent["eventType"];
  timestamp: number;
  triggerPrice?: number;
  level?: number;
}): MonitoringEvent {
  const eventType = params.eventType ?? "breakout";
  const symbol = params.symbol ?? "ALBT";

  return {
    id: `${symbol}-${eventType}-${params.timestamp}`,
    episodeId: `${symbol}-${eventType}-episode-${params.timestamp}`,
    symbol,
    type: params.type ?? (eventType === "compression" ? "consolidation" : eventType),
    eventType,
    zoneId: `${symbol}-zone`,
    zoneKind: "resistance",
    level: params.level ?? 100,
    triggerPrice: params.triggerPrice ?? 100,
    strength: 0.82,
    confidence: 0.76,
    priority: 82,
    bias: eventType === "rejection" ? "bearish" : "bullish",
    pressureScore: 0.62,
    eventContext: {
      monitoredZoneId: `${symbol}-zone`,
      canonicalZoneId: `${symbol}-zone`,
      zoneFreshness: "fresh",
      zoneOrigin: "canonical",
      remapStatus: "new",
      remappedFromZoneIds: [],
      dataQualityDegraded: false,
      recentlyRefreshed: false,
      recentlyPromotedExtension: false,
      ladderPosition: "inner",
      zoneStrengthLabel: "strong",
    },
    timestamp: params.timestamp,
    notes: ["Runtime integration test event."],
  };
}

describe("opportunity runtime integration", () => {
  it("tracks emitted opportunities and updates evaluator summary on price completion", () => {
    const controller = new OpportunityRuntimeController({
      evaluator: new OpportunityEvaluator(60_000, false, 10, 0.3, 10, 2),
      topLimit: 3,
    });
    const event = makeEvent({ timestamp: 1_000_000, triggerPrice: 100 });

    const firstSnapshot = controller.processMonitoringEvent(event);
    const noCompletion = controller.processPriceUpdate({
      symbol: "ALBT",
      timestamp: 1_030_000,
      lastPrice: 100.1,
    });
    const completed = controller.processPriceUpdate({
      symbol: "ALBT",
      timestamp: 1_070_000,
      lastPrice: 100.6,
    });

    assert.ok(firstSnapshot.newOpportunity);
    assert.ok(firstSnapshot.top.length >= 1);
    assert.ok(firstSnapshot.interpretations.length >= 1);
    assert.equal(firstSnapshot.interpretations[0]?.type, "pre_zone");
    assert.ok(firstSnapshot.adaptiveDiagnostics.targetGlobalMultiplier >= 0.4);
    assert.ok(firstSnapshot.adaptiveDiagnostics.appliedGlobalMultiplier >= 0.4);
    assert.ok(noCompletion);
    assert.equal(noCompletion?.completedEvaluations.length, 0);
    assert.equal(noCompletion?.progressUpdates.length, 1);
    assert.equal(noCompletion?.progressUpdates[0]?.progressLabel, "stalling");
    assert.ok(completed);
    assert.equal(completed?.completedEvaluations.length, 1);
    assert.equal(completed?.summary.totalEvaluated, 1);
    assert.ok(completed?.summary.expectancy > 0);
    assert.ok(completed?.adaptiveDiagnostics.eventTypes.breakout);
  });

  it("uses canonical monitoring event types for interpretation when alert labels differ", () => {
    const controller = new OpportunityRuntimeController({
      evaluator: new OpportunityEvaluator(60_000, false, 10, 0.3, 10, 2),
      topLimit: 3,
    });

    const snapshot = controller.processMonitoringEvent(
      makeEvent({
        timestamp: 1_500_000,
        type: "consolidation",
        eventType: "compression",
      }),
    );

    assert.ok(snapshot.interpretations.length >= 1);
    assert.equal(snapshot.interpretations[0]?.type, "pre_zone");
    assert.equal(
      snapshot.interpretations[0]?.message,
      "watching pullback into support near 100.00",
    );
    assert.ok(snapshot.adaptiveDiagnostics.eventTypes.compression);
  });

  it("uses stabilized adaptive state and does not disable on the first weak cycle", () => {
    const adaptiveEngine = new AdaptiveScoringEngine(
      undefined,
      {
        baseSmoothingFactor: 0.3,
        driftSmoothingFactor: 0.18,
        minSamplesForConfidence: 1,
        samplesForFullConfidence: 2,
        globalMinSamplesForConfidence: 1,
        globalSamplesForFullConfidence: 2,
        maxIncreasePerUpdate: 0.08,
        maxDecreasePerUpdate: 0.05,
        disableMinSamples: 1,
        disableWeakStreakThreshold: 3,
        protectedFloorMultiplier: 0.72,
        driftDampeningFactor: 0.65,
        driftDecreaseMultiplier: 0.75,
        driftDisableProtection: 0,
      },
    );
    const controller = new OpportunityRuntimeController({
      evaluator: new OpportunityEvaluator(60_000, false, 10, 0.3, 10, 2),
      adaptiveScoringEngine: adaptiveEngine,
      topLimit: 3,
    });
    const start = 2_000_000;

    controller.processMonitoringEvent(
      makeEvent({ timestamp: start, eventType: "rejection", type: "rejection", triggerPrice: 100 }),
    );
    controller.processPriceUpdate({
      symbol: "ALBT",
      timestamp: start + 70_000,
      lastPrice: 99.4,
    });

    const firstWeakCycle = controller.processMonitoringEvent(
      makeEvent({ timestamp: start + 100_000, eventType: "rejection", type: "rejection", triggerPrice: 100 }),
    );

    controller.processPriceUpdate({
      symbol: "ALBT",
      timestamp: start + 170_000,
      lastPrice: 99.3,
    });
    controller.processMonitoringEvent(
      makeEvent({ timestamp: start + 200_000, eventType: "rejection", type: "rejection", triggerPrice: 100 }),
    );
    controller.processPriceUpdate({
      symbol: "ALBT",
      timestamp: start + 270_000,
      lastPrice: 99.2,
    });
    const stabilizedDisable = controller.processMonitoringEvent(
      makeEvent({ timestamp: start + 300_000, eventType: "rejection", type: "rejection", triggerPrice: 100 }),
    );

    assert.ok(firstWeakCycle.newOpportunity);
    assert.ok(firstWeakCycle.adaptiveDiagnostics.eventTypes.rejection);
    assert.ok(
      firstWeakCycle.adaptiveDiagnostics.eventTypes.rejection!.appliedMultiplier >=
        firstWeakCycle.adaptiveDiagnostics.eventTypes.rejection!.targetMultiplier,
    );
    assert.ok(firstWeakCycle.adaptiveDiagnostics.eventTypes.rejection!.weakUpdateStreak >= 1);
    assert.equal(firstWeakCycle.adaptiveDiagnostics.eventTypes.rejection!.disableProtected, true);
    assert.equal(stabilizedDisable.newOpportunity, undefined);
    assert.ok(
      stabilizedDisable.adaptiveDiagnostics.eventTypes.rejection!.weakUpdateStreak >
        firstWeakCycle.adaptiveDiagnostics.eventTypes.rejection!.weakUpdateStreak,
    );
    assert.equal(stabilizedDisable.adaptiveDiagnostics.eventTypes.rejection!.disabled, true);
    assert.equal(stabilizedDisable.adapted.some((opportunity) => opportunity.type === "rejection"), false);
  });
});
