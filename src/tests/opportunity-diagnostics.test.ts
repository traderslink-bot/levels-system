import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  analyzeOpportunityDiagnosticsRecovery,
  aggregateOpportunityDiagnosticsRuns,
  buildOpportunityDiagnosticsLogEntry,
  summarizeOpportunityDiagnostics,
} from "../lib/monitoring/opportunity-diagnostics.js";
import type { OpportunityRuntimeSnapshot } from "../lib/monitoring/opportunity-runtime-controller.js";

function makeSnapshot(): OpportunityRuntimeSnapshot {
  return {
    ranked: [],
    adapted: [
      {
        symbol: "AAPL",
        type: "breakout",
        eventType: "breakout",
        level: 100,
        strength: 0.8,
        confidence: 0.75,
        priority: 80,
        bias: "bullish",
        pressureScore: 0.6,
        structureType: null,
        structureStrength: 0,
        timestamp: 1_000_000,
        score: 0.72,
        normalizedScore: 0.9,
        classification: "medium",
        adaptiveScore: 0.79,
        adaptiveMultiplier: 1.1,
        eventTypeExpectancy: 0.2,
        disabled: false,
        disableReason: null,
      },
    ],
    top: [
      {
        symbol: "AAPL",
        type: "breakout",
        eventType: "breakout",
        level: 100,
        strength: 0.8,
        confidence: 0.75,
        priority: 80,
        bias: "bullish",
        pressureScore: 0.6,
        structureType: null,
        structureStrength: 0,
        timestamp: 1_000_000,
        score: 0.72,
        normalizedScore: 0.9,
        classification: "medium",
        adaptiveScore: 0.79,
        adaptiveMultiplier: 1.1,
        eventTypeExpectancy: 0.2,
        disabled: false,
        disableReason: null,
      },
    ],
    interpretations: [
      {
        symbol: "AAPL",
        message: "watching pullback into support near 100.00",
        type: "pre_zone",
        confidence: 0.79,
        tags: ["pre_zone", "breakout", "support", "no_structure"],
        timestamp: 1_000_000,
      },
    ],
    summary: {
      totalEvaluated: 3,
      wins: 2,
      losses: 1,
      winRate: 66.67,
      lossRate: 33.33,
      expectancy: 0.15,
      averageReturnPct: 0.15,
      averageWinPct: 0.4,
      averageLossPct: -0.3,
      maxDrawdownPct: 0.8,
      signalAccuracy: 0.6667,
      expectancyByEventType: {},
      rollingExpectancy: {
        windowSize: 2,
        sampleSize: 2,
        expectancy: 0.1,
      },
      performanceDrift: {
        declining: false,
        currentExpectancy: 0.1,
        previousExpectancy: 0.05,
        delta: 0.05,
      },
    },
    adaptiveDiagnostics: {
      targetGlobalMultiplier: 1.04,
      appliedGlobalMultiplier: 1.01,
      globalConfidence: 0.4,
      globalDeltaApplied: 0.01,
      driftDampeningActive: false,
      eventTypes: {
        breakout: {
          targetMultiplier: 1.1,
          appliedMultiplier: 1.05,
          sampleSize: 3,
          confidence: 0.3,
          disableIntent: false,
          disabled: false,
          disableReason: null,
          weakUpdateStreak: 0,
          deltaApplied: 0.02,
          disableProtected: false,
        },
      },
    },
    newOpportunity: {
      symbol: "AAPL",
      type: "breakout",
      eventType: "breakout",
      level: 100,
      strength: 0.8,
      confidence: 0.75,
      priority: 80,
      bias: "bullish",
      pressureScore: 0.6,
      structureType: null,
      structureStrength: 0,
      timestamp: 1_000_000,
      score: 0.72,
      normalizedScore: 0.9,
      classification: "medium",
      adaptiveScore: 0.79,
      adaptiveMultiplier: 1.1,
      eventTypeExpectancy: 0.2,
      disabled: false,
      disableReason: null,
    },
    completedEvaluations: [],
  };
}

describe("opportunity diagnostics", () => {
  it("formats runtime snapshots into structured log entries", () => {
    const entry = buildOpportunityDiagnosticsLogEntry("opportunity_snapshot", makeSnapshot(), {
      symbol: "AAPL",
      timestamp: 1_000_000,
    });

    assert.equal(entry.type, "opportunity_snapshot");
    assert.equal(entry.evaluationSummary.totalEvaluated, 3);
    assert.equal(entry.adaptiveDiagnostics.eventTypes.breakout?.appliedMultiplier, 1.05);
    assert.equal(entry.opportunity?.symbol, "AAPL");
    assert.equal(entry.topOpportunities.length, 1);
  });

  it("summarizes diagnostic entries for replay validation review", () => {
    const snapshot = makeSnapshot();
    const entries = [
      buildOpportunityDiagnosticsLogEntry("opportunity_snapshot", snapshot, {
        symbol: "AAPL",
        timestamp: 1_000_000,
      }),
      buildOpportunityDiagnosticsLogEntry("evaluation_update", {
        ...snapshot,
        completedEvaluations: [
          {
            symbol: "AAPL",
            timestamp: 1_000_000,
            evaluatedAt: 1_060_000,
            entryPrice: 100,
            outcomePrice: 100.5,
            returnPct: 0.5,
            directionalReturnPct: 0.5,
            followThroughLabel: "working",
            success: true,
            eventType: "breakout",
          },
        ],
      }, {
        symbol: "AAPL",
        timestamp: 1_060_000,
      }),
    ];
    const summary = summarizeOpportunityDiagnostics(entries);

    assert.equal(summary.entryCount, 2);
    assert.equal(summary.snapshotCount, 1);
    assert.equal(summary.evaluationUpdateCount, 1);
    assert.equal(summary.symbols[0], "AAPL");
    assert.equal(summary.maxAppliedGlobalMultiplier, 1.01);
  });

  it("aggregates multiple diagnostic runs into a cross-run report", () => {
    const snapshot = makeSnapshot();
    const aggregate = aggregateOpportunityDiagnosticsRuns([
      {
        source: "aapl.ndjson",
        entries: [
          buildOpportunityDiagnosticsLogEntry("opportunity_snapshot", snapshot, {
            symbol: "AAPL",
            timestamp: 1_000_000,
          }),
        ],
      },
      {
        source: "msft.ndjson",
        entries: [
          buildOpportunityDiagnosticsLogEntry("evaluation_update", {
            ...snapshot,
            adaptiveDiagnostics: {
              ...snapshot.adaptiveDiagnostics,
              driftDampeningActive: true,
              eventTypes: {
                breakout: {
                  ...snapshot.adaptiveDiagnostics.eventTypes.breakout!,
                  disableIntent: true,
                  disabled: true,
                  weakUpdateStreak: 3,
                },
              },
            },
          }, {
            symbol: "MSFT",
            timestamp: 1_060_000,
          }),
        ],
      },
    ]);

    assert.equal(aggregate.runCount, 2);
    assert.equal(aggregate.symbols.length, 2);
    assert.equal(aggregate.maxWeakStreak, 3);
    assert.equal(aggregate.runsWithDisableIntent[0], "msft.ndjson");
    assert.equal(aggregate.runsWithDriftActivation[0], "msft.ndjson");
  });

  it("detects disabled and weak recovery paths in diagnostic entries", () => {
    const snapshot = makeSnapshot();
    const entries = [
      buildOpportunityDiagnosticsLogEntry("evaluation_update", {
        ...snapshot,
        adaptiveDiagnostics: {
          ...snapshot.adaptiveDiagnostics,
          eventTypes: {
            breakout: {
              ...snapshot.adaptiveDiagnostics.eventTypes.breakout!,
              disableIntent: true,
              weakUpdateStreak: 2,
              appliedMultiplier: 0.95,
            },
          },
        },
      }, {
        symbol: "AAPL",
        timestamp: 1_000_000,
      }),
      buildOpportunityDiagnosticsLogEntry("evaluation_update", {
        ...snapshot,
        adaptiveDiagnostics: {
          ...snapshot.adaptiveDiagnostics,
          eventTypes: {
            breakout: {
              ...snapshot.adaptiveDiagnostics.eventTypes.breakout!,
              disableIntent: true,
              disabled: true,
              disableReason: "negative_expectancy",
              weakUpdateStreak: 3,
              appliedMultiplier: 0.94,
            },
          },
        },
      }, {
        symbol: "AAPL",
        timestamp: 1_060_000,
      }),
      buildOpportunityDiagnosticsLogEntry("evaluation_update", {
        ...snapshot,
        adaptiveDiagnostics: {
          ...snapshot.adaptiveDiagnostics,
          eventTypes: {
            breakout: {
              ...snapshot.adaptiveDiagnostics.eventTypes.breakout!,
              disableIntent: false,
              disabled: false,
              disableReason: null,
              weakUpdateStreak: 0,
              appliedMultiplier: 0.98,
            },
          },
        },
      }, {
        symbol: "AAPL",
        timestamp: 1_120_000,
      }),
    ];

    const recovery = analyzeOpportunityDiagnosticsRecovery(entries);

    assert.deepEqual(recovery.disabledEventTypesEver, ["breakout"]);
    assert.deepEqual(recovery.recoveredEventTypes, ["breakout"]);
    assert.deepEqual(recovery.weakRecoveryEventTypes, ["breakout"]);
  });
});
