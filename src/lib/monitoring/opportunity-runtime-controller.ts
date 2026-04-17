import {
  AdaptiveScoringEngine,
  type AdaptedOpportunity,
  type AdaptiveScoringDiagnostics,
} from "./adaptive-scoring.js";
import type { AdaptiveStatePersistence } from "./adaptive-state-persistence.js";
import type { LivePriceUpdate, MonitoringEvent } from "./monitoring-types.js";
import { OpportunityEngine, type RankedOpportunity } from "./opportunity-engine.js";
import {
  OpportunityEvaluator,
  type EvaluatedOpportunity,
  type OpportunityEvaluationSummary,
} from "./opportunity-evaluator.js";
import {
  OpportunityInterpretationLayer,
  type OpportunityInterpretation,
} from "./opportunity-interpretation.js";

export type OpportunityRuntimeSnapshot = {
  ranked: RankedOpportunity[];
  adapted: AdaptedOpportunity[];
  top: AdaptedOpportunity[];
  interpretations: OpportunityInterpretation[];
  summary: OpportunityEvaluationSummary;
  adaptiveDiagnostics: OpportunityRuntimeAdaptiveDiagnostics;
  newOpportunity?: AdaptedOpportunity;
  completedEvaluations: EvaluatedOpportunity[];
};

export type OpportunityRuntimeAdaptiveDiagnostics = {
  targetGlobalMultiplier: number;
  appliedGlobalMultiplier: number;
  globalConfidence: number;
  globalDeltaApplied: number;
  driftDampeningActive: boolean;
  eventTypes: Record<string, {
    targetMultiplier: number;
    appliedMultiplier: number;
    sampleSize: number;
    confidence: number;
    disableIntent: boolean;
    disabled: boolean;
    disableReason: string | null;
    weakUpdateStreak: number;
    deltaApplied: number;
    disableProtected: boolean;
  }>;
};

export type OpportunityRuntimeControllerOptions = {
  topLimit?: number;
  eventMemoryWindowMs?: number;
  opportunityEngine?: OpportunityEngine;
  adaptiveScoringEngine?: AdaptiveScoringEngine;
  evaluator?: OpportunityEvaluator;
  adaptiveStatePersistence?: AdaptiveStatePersistence;
};

const DEFAULT_TOP_LIMIT = 5;
const DEFAULT_EVENT_MEMORY_WINDOW_MS = 30 * 60 * 1000;

function buildOpportunityKey(input: {
  symbol: string;
  type: string;
  timestamp: number;
  level: number;
}): string {
  return `${input.symbol}|${input.type}|${input.timestamp}|${input.level}`;
}

export class OpportunityRuntimeController {
  private readonly recentEvents: MonitoringEvent[] = [];
  private readonly trackedOpportunityKeys = new Set<string>();
  private readonly topLimit: number;
  private readonly eventMemoryWindowMs: number;
  private readonly opportunityEngine: OpportunityEngine;
  private readonly adaptiveScoringEngine: AdaptiveScoringEngine;
  private readonly evaluator: OpportunityEvaluator;
  private readonly adaptiveStatePersistence?: AdaptiveStatePersistence;
  private readonly interpretationLayer = new OpportunityInterpretationLayer();

  constructor(options: OpportunityRuntimeControllerOptions = {}) {
    this.topLimit = options.topLimit ?? DEFAULT_TOP_LIMIT;
    this.eventMemoryWindowMs = options.eventMemoryWindowMs ?? DEFAULT_EVENT_MEMORY_WINDOW_MS;
    this.opportunityEngine = options.opportunityEngine ?? new OpportunityEngine();
    this.adaptiveScoringEngine = options.adaptiveScoringEngine ?? new AdaptiveScoringEngine();
    this.evaluator = options.evaluator ?? new OpportunityEvaluator();
    this.adaptiveStatePersistence = options.adaptiveStatePersistence;
  }

  private pruneEvents(referenceTimestamp: number): void {
    const minTimestamp = referenceTimestamp - this.eventMemoryWindowMs;
    for (let index = this.recentEvents.length - 1; index >= 0; index -= 1) {
      if (this.recentEvents[index]!.timestamp < minTimestamp) {
        this.recentEvents.splice(index, 1);
      }
    }
  }

  private buildAdaptiveDiagnostics(
    diagnostics: AdaptiveScoringDiagnostics,
  ): OpportunityRuntimeAdaptiveDiagnostics {
    return {
      targetGlobalMultiplier: diagnostics.targetState.targetGlobalMultiplier,
      appliedGlobalMultiplier: diagnostics.stability.appliedGlobalMultiplier,
      globalConfidence: diagnostics.stability.diagnostics.globalConfidence,
      globalDeltaApplied: diagnostics.stability.diagnostics.globalDeltaApplied,
      driftDampeningActive: diagnostics.stability.diagnostics.driftDampeningActive,
      eventTypes: Object.fromEntries(
        Object.entries(diagnostics.targetState.eventTypeTargets).map(([eventType, target]) => {
          const appliedState = diagnostics.stability.state.eventTypes[eventType];
          const eventDiagnostics = diagnostics.stability.diagnostics.eventTypeDiagnostics[eventType];

          return [
            eventType,
            {
              targetMultiplier: target.targetMultiplier,
              appliedMultiplier: diagnostics.stability.appliedEventTypeMultipliers[eventType] ?? 1,
              sampleSize: target.sampleSize,
              confidence: eventDiagnostics?.confidence ?? appliedState?.lastConfidence ?? 0,
              disableIntent: target.disableIntent,
              disabled: diagnostics.stability.disabledEventTypes[eventType]?.disabled ?? false,
              disableReason: diagnostics.stability.disabledEventTypes[eventType]?.disableReason ?? null,
              weakUpdateStreak: appliedState?.weakUpdateStreak ?? 0,
              deltaApplied: eventDiagnostics?.deltaApplied ?? 0,
              disableProtected: eventDiagnostics?.disableProtected ?? false,
            },
          ];
        }),
      ),
    };
  }

  private buildSnapshot(completedEvaluations: EvaluatedOpportunity[] = []): OpportunityRuntimeSnapshot {
    const ranked = this.opportunityEngine.rank(this.recentEvents);
    const summary = this.evaluator.getSummary();
    const adaptiveResult = this.adaptiveScoringEngine.adaptWithDiagnostics(ranked, summary);
    const top = this.opportunityEngine.selectTop(adaptiveResult.opportunities, this.topLimit);

    return {
      ranked,
      adapted: adaptiveResult.opportunities,
      top,
      interpretations: [],
      summary,
      adaptiveDiagnostics: this.buildAdaptiveDiagnostics(adaptiveResult.diagnostics),
      completedEvaluations,
    };
  }

  private emitInterpretations(snapshot: OpportunityRuntimeSnapshot): OpportunityInterpretation[] {
    const interpretations: OpportunityInterpretation[] = [];

    for (const opportunity of snapshot.top) {
      const eventType = opportunity.eventType ?? opportunity.type;
      const weakStreak = snapshot.adaptiveDiagnostics.eventTypes[eventType]?.weakUpdateStreak ?? 0;
      const interpretation = this.interpretationLayer.interpret(opportunity, weakStreak);

      if (!interpretation) {
        continue;
      }

      interpretations.push(interpretation);
    }

    return interpretations;
  }

  processMonitoringEvent(event: MonitoringEvent): OpportunityRuntimeSnapshot {
    this.recentEvents.push(event);
    this.pruneEvents(event.timestamp);

    const snapshot = this.buildSnapshot();
    const opportunityKey = buildOpportunityKey({
      symbol: event.symbol,
      type: event.type,
      timestamp: event.timestamp,
      level: event.level,
    });
    const newOpportunity = snapshot.adapted.find((opportunity) =>
      buildOpportunityKey(opportunity) === opportunityKey
    );

    if (newOpportunity && !this.trackedOpportunityKeys.has(opportunityKey)) {
      this.evaluator.track(newOpportunity, event.triggerPrice);
      this.trackedOpportunityKeys.add(opportunityKey);
    }

    const interpretations = this.emitInterpretations(snapshot);

    return {
      ...snapshot,
      interpretations,
      summary: this.evaluator.getSummary(),
      newOpportunity,
    };
  }

  processPriceUpdate(update: LivePriceUpdate): OpportunityRuntimeSnapshot | null {
    const completedEvaluations = this.evaluator.updatePrice(
      update.symbol,
      update.lastPrice,
      update.timestamp,
    );

    if (completedEvaluations.length === 0) {
      return null;
    }

    this.pruneEvents(update.timestamp);
    const snapshot = this.buildSnapshot(completedEvaluations);
    const interpretations = this.emitInterpretations(snapshot);
    this.adaptiveStatePersistence?.save(this.adaptiveScoringEngine.getState());
    return {
      ...snapshot,
      interpretations,
    };
  }

  getSummary(): OpportunityEvaluationSummary {
    return this.evaluator.getSummary();
  }
}
