import {
  AdaptiveStabilityLayer,
  type AdaptiveEventTypeTarget,
  type AdaptiveStabilityConfig,
  type AdaptiveStabilityResult,
  type AdaptiveStabilityState,
  type AdaptiveTargetState,
  DEFAULT_ADAPTIVE_STABILITY_CONFIG,
} from "./adaptive-stability.js";
import type { RankedOpportunity } from "./opportunity-engine.js";
import type { OpportunityEvaluationSummary } from "./opportunity-evaluator.js";

export type AdaptiveScoringConfig = {
  positiveExpectancyThreshold: number;
  positiveExpectancyBoost: number;
  negativeExpectancyPenalty: number;
  disableBelowExpectancy: number;
  globalPositiveThreshold: number;
  globalPositiveBoost: number;
  globalNegativePenalty: number;
  driftPenalty: number;
  minMultiplier: number;
  maxMultiplier: number;
};

export type AdaptedOpportunity = RankedOpportunity & {
  adaptiveScore: number;
  adaptiveMultiplier: number;
  eventTypeExpectancy: number;
  disabled: boolean;
  disableReason: string | null;
};

export type AdaptiveScoringDiagnostics = {
  targetState: AdaptiveTargetState;
  stability: AdaptiveStabilityResult;
};

export type AdaptiveScoringResult = {
  opportunities: AdaptedOpportunity[];
  diagnostics: AdaptiveScoringDiagnostics;
};

const DEFAULT_CONFIG: AdaptiveScoringConfig = {
  positiveExpectancyThreshold: 0.15,
  positiveExpectancyBoost: 0.12,
  negativeExpectancyPenalty: 0.18,
  disableBelowExpectancy: -0.25,
  globalPositiveThreshold: 0.1,
  globalPositiveBoost: 0.05,
  globalNegativePenalty: 0.08,
  driftPenalty: 0.06,
  minMultiplier: 0.4,
  maxMultiplier: 1.4,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, decimals: number = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function resolveAdaptiveEventType(opportunity: RankedOpportunity): string {
  return opportunity.eventType ?? opportunity.type;
}

function normalizeExpectancy(expectancy: number): number {
  return clamp(expectancy / 2, -1, 1);
}

function buildGlobalTargetMultiplier(
  summary: OpportunityEvaluationSummary,
  config: AdaptiveScoringConfig,
): number {
  let multiplier = 1;

  if (summary.expectancy > config.globalPositiveThreshold) {
    multiplier += config.globalPositiveBoost * normalizeExpectancy(summary.expectancy);
  } else if (summary.expectancy < 0) {
    multiplier -= config.globalNegativePenalty * Math.abs(normalizeExpectancy(summary.expectancy));
  }

  if (summary.performanceDrift.declining) {
    multiplier -= config.driftPenalty * Math.abs(normalizeExpectancy(summary.performanceDrift.delta));
  }

  return round(clamp(multiplier, config.minMultiplier, config.maxMultiplier));
}

function buildEventTypeTarget(
  eventType: string,
  summary: OpportunityEvaluationSummary,
  config: AdaptiveScoringConfig,
): AdaptiveEventTypeTarget {
  const eventTypeSummary = summary.expectancyByEventType[eventType];
  const expectancy = eventTypeSummary?.expectancy ?? summary.expectancy;
  const sampleSize = eventTypeSummary?.totalEvaluated ?? 0;

  let targetMultiplier = 1;

  if (expectancy < 0) {
    targetMultiplier -= config.negativeExpectancyPenalty * Math.abs(normalizeExpectancy(expectancy));
  } else if (expectancy > config.positiveExpectancyThreshold) {
    targetMultiplier += config.positiveExpectancyBoost * normalizeExpectancy(expectancy);
  }

  return {
    eventType,
    targetMultiplier: round(clamp(targetMultiplier, config.minMultiplier, config.maxMultiplier)),
    disableIntent: expectancy <= config.disableBelowExpectancy,
    disableReason: expectancy <= config.disableBelowExpectancy ? "negative_expectancy" : null,
    expectancy: round(expectancy),
    sampleSize,
  };
}

export function buildAdaptiveTargetState(
  opportunities: RankedOpportunity[],
  summary: OpportunityEvaluationSummary,
  config: AdaptiveScoringConfig = DEFAULT_CONFIG,
): AdaptiveTargetState {
  const eventTypes = new Set(opportunities.map((opportunity) => resolveAdaptiveEventType(opportunity)));

  return {
    targetGlobalMultiplier: buildGlobalTargetMultiplier(summary, config),
    globalSampleSize: summary.totalEvaluated,
    driftDeclining: summary.performanceDrift.declining,
    driftDelta: round(summary.performanceDrift.delta),
    eventTypeTargets: Object.fromEntries(
      [...eventTypes].map((eventType) => [
        eventType,
        buildEventTypeTarget(eventType, summary, config),
      ]),
    ),
  };
}

export class AdaptiveScoringEngine {
  private readonly stabilityLayer: AdaptiveStabilityLayer;

  constructor(
    private readonly config: AdaptiveScoringConfig = DEFAULT_CONFIG,
    stabilityConfig: AdaptiveStabilityConfig = DEFAULT_ADAPTIVE_STABILITY_CONFIG,
    initialState?: AdaptiveStabilityState,
  ) {
    this.stabilityLayer = new AdaptiveStabilityLayer(config, stabilityConfig, initialState);
  }

  getState(): AdaptiveStabilityState {
    return this.stabilityLayer.getState();
  }

  adapt(
    opportunities: RankedOpportunity[],
    summary: OpportunityEvaluationSummary,
  ): AdaptedOpportunity[] {
    return this.adaptWithDiagnostics(opportunities, summary).opportunities;
  }

  adaptWithDiagnostics(
    opportunities: RankedOpportunity[],
    summary: OpportunityEvaluationSummary,
  ): AdaptiveScoringResult {
    if (opportunities.length === 0) {
      return {
        opportunities: [],
        diagnostics: {
          targetState: buildAdaptiveTargetState([], summary, this.config),
          stability: this.stabilityLayer.applyTargets({
            targetGlobalMultiplier: 1,
            globalSampleSize: summary.totalEvaluated,
            driftDeclining: summary.performanceDrift.declining,
            driftDelta: summary.performanceDrift.delta,
            eventTypeTargets: {},
          }),
        },
      };
    }

    const targetState = buildAdaptiveTargetState(opportunities, summary, this.config);
    const stability = this.stabilityLayer.applyTargets(targetState);

    const adapted = opportunities
      .map((opportunity) => {
        const eventType = resolveAdaptiveEventType(opportunity);
        const eventTypeTarget = targetState.eventTypeTargets[eventType];
        const eventTypeExpectancy = eventTypeTarget?.expectancy ?? round(summary.expectancy);
        const eventTypeMultiplier = stability.appliedEventTypeMultipliers[eventType] ?? 1;
        const disabledState = stability.disabledEventTypes[eventType] ?? {
          disabled: false,
          disableReason: null,
        };
        const adaptiveMultiplier = clamp(
          stability.appliedGlobalMultiplier * eventTypeMultiplier,
          this.config.minMultiplier,
          this.config.maxMultiplier,
        );

        return {
          ...opportunity,
          adaptiveScore: round(opportunity.score * adaptiveMultiplier),
          adaptiveMultiplier: round(adaptiveMultiplier),
          eventTypeExpectancy,
          disabled: disabledState.disabled,
          disableReason: disabledState.disableReason,
        };
      })
      .filter((opportunity) => !opportunity.disabled)
      .sort((left, right) => {
        if (right.adaptiveScore !== left.adaptiveScore) {
          return right.adaptiveScore - left.adaptiveScore;
        }

        if (right.normalizedScore !== left.normalizedScore) {
          return right.normalizedScore - left.normalizedScore;
        }

        return right.timestamp - left.timestamp;
      });

    return {
      opportunities: adapted,
      diagnostics: {
        targetState,
        stability,
      },
    };
  }
}

export { DEFAULT_CONFIG as DEFAULT_ADAPTIVE_SCORING_CONFIG };
