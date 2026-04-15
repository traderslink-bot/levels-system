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

function normalizeExpectancy(expectancy: number): number {
  return clamp(expectancy / 2, -1, 1);
}

function buildGlobalMultiplier(
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

  return clamp(multiplier, config.minMultiplier, config.maxMultiplier);
}

function buildEventTypeMultiplier(
  expectancy: number,
  config: AdaptiveScoringConfig,
): {
  multiplier: number;
  disabled: boolean;
  disableReason: string | null;
} {
  if (expectancy <= config.disableBelowExpectancy) {
    return {
      multiplier: config.minMultiplier,
      disabled: true,
      disableReason: "negative_expectancy",
    };
  }

  let multiplier = 1;

  if (expectancy < 0) {
    multiplier -= config.negativeExpectancyPenalty * Math.abs(normalizeExpectancy(expectancy));
  } else if (expectancy > config.positiveExpectancyThreshold) {
    multiplier += config.positiveExpectancyBoost * normalizeExpectancy(expectancy);
  }

  return {
    multiplier: clamp(multiplier, config.minMultiplier, config.maxMultiplier),
    disabled: false,
    disableReason: null,
  };
}

export class AdaptiveScoringEngine {
  constructor(private readonly config: AdaptiveScoringConfig = DEFAULT_CONFIG) {}

  adapt(
    opportunities: RankedOpportunity[],
    summary: OpportunityEvaluationSummary,
  ): AdaptedOpportunity[] {
    if (opportunities.length === 0) {
      return [];
    }

    const globalMultiplier = buildGlobalMultiplier(summary, this.config);

    return opportunities
      .map((opportunity) => {
        const eventTypeExpectancy =
          summary.expectancyByEventType[opportunity.type]?.expectancy ?? summary.expectancy;
        const eventTypeAdjustment = buildEventTypeMultiplier(
          eventTypeExpectancy,
          this.config,
        );
        const adaptiveMultiplier = clamp(
          globalMultiplier * eventTypeAdjustment.multiplier,
          this.config.minMultiplier,
          this.config.maxMultiplier,
        );
        const adaptiveScore = round(opportunity.score * adaptiveMultiplier);

        return {
          ...opportunity,
          adaptiveScore,
          adaptiveMultiplier: round(adaptiveMultiplier),
          eventTypeExpectancy: round(eventTypeExpectancy),
          disabled: eventTypeAdjustment.disabled,
          disableReason: eventTypeAdjustment.disableReason,
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
  }
}
