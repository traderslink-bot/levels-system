import { classifyIntradayCandleTimestamp } from "../market-data/candle-session-classifier.js";
import type {
  TradersLinkAiReadForwardHorizon,
  TradersLinkAiReadForwardHorizonName,
  TradersLinkAiReadForwardPlan,
} from "../live-watchlist/live-watchlist-types.js";
import type {
  TradersLinkAiReadMarketRegimeProfile,
  TradersLinkAiReadPriceActionContext,
} from "./traderslink-ai-read-price-action.js";

export type TradersLinkAiReadForwardDiagnostics = {
  forwardCoveragePct: number | null;
  outerCoverageLimitPct: number;
  outerCoverageExceedsLimit: boolean;
  realizedExpansionPct: number;
  coverageToRealizedExpansionRatio: number | null;
  outerDistanceInAverageDailyRanges: number | null;
  representedHorizons: number;
  outerBasisType: string | null;
  outerIsProjected: boolean;
  currentPriceAtFreshHigh: boolean;
  hasUnavailableReason: boolean;
};

export type TradersLinkAiReadValidationFailure = {
  code: string;
  branch: string;
  message: string;
  details?: Record<string, unknown>;
};

export class TradersLinkAiReadValidationError extends Error {
  constructor(
    public readonly failures: TradersLinkAiReadValidationFailure[],
    public readonly diagnostics: TradersLinkAiReadForwardDiagnostics,
  ) {
    super(failures.map((failure) => `${failure.code}: ${failure.message}`).join(" | "));
    this.name = "TradersLinkAiReadValidationError";
  }
}

const HORIZON_NAMES: TradersLinkAiReadForwardHorizonName[] = [
  "nearestRealistic",
  "continuedMomentum",
  "strongExpansion",
  "extremeMomentum",
];
const OBSERVED_BASIS = new Set([
  "observed_intraday",
  "observed_prior_session",
  "observed_daily",
  "failed_spike",
]);
const PROJECTED_BASIS = new Set([
  "psychological_boundary",
  "measured_move",
  "volatility_projection",
  "combined",
]);
const OBSERVED_STRUCTURE_PHRASE =
  "(?:observed|historical|traded|printed|tested)\\s+(?:daily\\s+|intraday\\s+|prior[- ]session\\s+)?(?:resistance|high|supply|price)";
const SELECTED_PRICE_PHRASE =
  "(?:selected|chosen|proposed|horizon|scenario|target)\\s+price";
const FALSE_OBSERVED_SELECTED_PRICE_LANGUAGE = new RegExp(
  `\\b(?:${OBSERVED_STRUCTURE_PHRASE})\\b[^.!?]{0,24}\\b(?:${SELECTED_PRICE_PHRASE})\\b|` +
    `\\b(?:${SELECTED_PRICE_PHRASE})\\b[^.!?]{0,24}\\b(?:${OBSERVED_STRUCTURE_PHRASE})\\b`,
  "i",
);

function round(value: number): number {
  return Number(value.toFixed(2));
}

function availableHorizons(plan: TradersLinkAiReadForwardPlan): TradersLinkAiReadForwardHorizon[] {
  return HORIZON_NAMES
    .map((name) => plan[name])
    .filter((horizon) => horizon.available && horizon.price !== null);
}

function priceMatches(values: number[], price: number, referencePrice: number): boolean {
  const tolerance = Math.max(referencePrice * 0.005, price * 0.005, 0.0001);
  return values.some((value) => Math.abs(value - price) <= tolerance);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function projectedPriceIsDescribedAsObserved(
  horizon: TradersLinkAiReadForwardHorizon,
): boolean {
  const text = `${horizon.basisSummary} ${horizon.sourceFacts.join(" ")}`;
  if (FALSE_OBSERVED_SELECTED_PRICE_LANGUAGE.test(text)) {
    return true;
  }
  if (horizon.price === null) {
    return false;
  }
  const priceForms = new Set([
    String(horizon.price),
    horizon.price.toFixed(2),
    horizon.price.toFixed(4),
  ]);
  return [...priceForms].some((price) => {
    const escapedPrice = escapeRegex(price);
    const observedThenPrice = new RegExp(
      `\\b(?:${OBSERVED_STRUCTURE_PHRASE})\\b\\s*(?:at|near|around|of|is|was|=)\\s*\\$?${escapedPrice}\\b`,
      "i",
    );
    const priceThenObserved = new RegExp(
      `\\$?${escapedPrice}\\b\\s*(?:is|was|marks?|matches?|aligns? with)\\s*(?:an?\\s+)?\\b(?:${OBSERVED_STRUCTURE_PHRASE})\\b`,
      "i",
    );
    return observedThenPrice.test(text) || priceThenObserved.test(text);
  });
}

function candlePrices(
  horizon: TradersLinkAiReadForwardHorizon,
  context: TradersLinkAiReadPriceActionContext,
  dataAsOf: number,
): number[] {
  const currentSessionDate = classifyIntradayCandleTimestamp(dataAsOf).sessionDate;
  const intraday = context.intradayCandles.filter((candle) => {
    const sessionDate = classifyIntradayCandleTimestamp(candle.timestamp).sessionDate;
    if (horizon.basisType === "observed_intraday") return sessionDate === currentSessionDate;
    if (horizon.basisType === "observed_prior_session") return sessionDate !== currentSessionDate;
    return true;
  });
  const candles = horizon.basisType === "observed_daily" ? context.dailyCandles : intraday;
  return candles.flatMap((candle) => [candle.open, candle.high, candle.low, candle.close]);
}

function realizedExpansion(profile: TradersLinkAiReadMarketRegimeProfile): number {
  return Math.max(
    0,
    profile.gainFromPriorClosePct ?? 0,
    profile.gainFromRegularSessionOpenPct ?? 0,
    profile.gainFromCurrentSessionLowPct ?? 0,
    profile.currentSessionRangePct ?? 0,
    profile.latestSignificantImpulsePct ?? 0,
    profile.broaderSessionMovePct ?? 0,
  );
}

function outerCoverageLimitPct(profile: TradersLinkAiReadMarketRegimeProfile): number {
  switch (profile.regime) {
    case "extreme_expansion":
      return 100;
    case "high_expansion":
      return 80;
    case "elevated":
      return 65;
    case "normal":
    default:
      return 50;
  }
}

export function buildTradersLinkAiReadForwardDiagnostics(args: {
  currentPrice: number;
  forwardPlan: TradersLinkAiReadForwardPlan;
  marketProfile: TradersLinkAiReadMarketRegimeProfile;
}): TradersLinkAiReadForwardDiagnostics {
  const available = availableHorizons(args.forwardPlan);
  const outer = available.at(-1) ?? null;
  const forwardCoveragePct = outer?.price
    ? round((outer.price - args.currentPrice) / args.currentPrice * 100)
    : null;
  const coverageLimitPct = outerCoverageLimitPct(args.marketProfile);
  const realizedExpansionPct = round(realizedExpansion(args.marketProfile));
  const coverageToRealizedExpansionRatio = forwardCoveragePct !== null && realizedExpansionPct > 0
    ? Number((forwardCoveragePct / realizedExpansionPct).toFixed(3))
    : null;
  const adr = args.marketProfile.averageDailyRange20Pct;
  const outerDistanceInAverageDailyRanges = forwardCoveragePct !== null && adr && adr > 0
    ? Number((forwardCoveragePct / adr).toFixed(3))
    : null;
  return {
    forwardCoveragePct,
    outerCoverageLimitPct: coverageLimitPct,
    outerCoverageExceedsLimit:
      forwardCoveragePct !== null && forwardCoveragePct > coverageLimitPct + 1,
    realizedExpansionPct,
    coverageToRealizedExpansionRatio,
    outerDistanceInAverageDailyRanges,
    representedHorizons: available.length,
    outerBasisType: outer?.basisType ?? null,
    outerIsProjected: Boolean(outer && PROJECTED_BASIS.has(outer.basisType)),
    currentPriceAtFreshHigh:
      args.marketProfile.currentPriceAtOrNearSessionHigh ||
      args.marketProfile.currentPriceAboveHighestSuppliedDailyHigh,
    hasUnavailableReason: HORIZON_NAMES.some((name) =>
      !args.forwardPlan[name].available && Boolean(args.forwardPlan[name].unavailableReasonCode)
    ),
  };
}

export function validateTradersLinkAiReadForwardPlan(args: {
  currentPrice: number;
  mustClearPrice: number | null;
  breakoutContinuationPrice: number | null;
  forwardPlan: TradersLinkAiReadForwardPlan;
  marketProfile: TradersLinkAiReadMarketRegimeProfile;
  priceAction: TradersLinkAiReadPriceActionContext;
  dataAsOf: number;
  normalizationChanges?: string[];
}): TradersLinkAiReadForwardDiagnostics {
  const failures: TradersLinkAiReadValidationFailure[] = [];
  const diagnostics = buildTradersLinkAiReadForwardDiagnostics(args);
  let previousPrice = args.breakoutContinuationPrice ?? args.mustClearPrice ?? args.currentPrice;
  const seenPrices: number[] = [
    ...(args.mustClearPrice ? [args.mustClearPrice] : []),
    ...(args.breakoutContinuationPrice ? [args.breakoutContinuationPrice] : []),
  ];

  for (const name of HORIZON_NAMES) {
    const horizon = args.forwardPlan[name];
    if (!horizon.available) {
      if (!horizon.unavailableReasonCode || !horizon.unavailableReason) {
        failures.push({
          code: "FORWARD_HORIZON_UNAVAILABLE_REASON_MISSING",
          branch: `forwardPlan.${name}`,
          message: `${name} is unavailable without a precise reason code and explanation.`,
        });
      }
      if (horizon.price !== null || horizon.basisType !== "unavailable") {
        failures.push({
          code: "FORWARD_HORIZON_UNAVAILABLE_SHAPE_INVALID",
          branch: `forwardPlan.${name}`,
          message: `${name} must use a null price and unavailable basis when unavailable.`,
        });
      }
      continue;
    }
    if (horizon.price === null) {
      failures.push({
        code: "FORWARD_HORIZON_PRICE_MISSING",
        branch: `forwardPlan.${name}`,
        message: `${name} is available but has no price.`,
      });
      continue;
    }
    if (horizon.basisType === "unavailable" || horizon.unavailableReasonCode || horizon.unavailableReason) {
      failures.push({
        code: "FORWARD_HORIZON_AVAILABLE_SHAPE_INVALID",
        branch: `forwardPlan.${name}`,
        message: `${name} is available but carries unavailable-state fields.`,
      });
    }
    if (horizon.sourceFacts.length === 0) {
      failures.push({
        code: "FORWARD_HORIZON_SOURCE_FACTS_MISSING",
        branch: `forwardPlan.${name}`,
        message: `${name} has no supplied source facts.`,
      });
    }
    const tolerance = Math.max(args.currentPrice * 0.005, 0.0001);
    if (horizon.price <= previousPrice + tolerance) {
      failures.push({
        code: "FORWARD_HORIZON_ORDER_INVALID",
        branch: `forwardPlan.${name}`,
        message: `${name} at ${horizon.price} is not meaningfully above the prior tactical role at ${previousPrice}.`,
      });
    } else {
      previousPrice = horizon.price;
    }
    if (seenPrices.some((price) => Math.abs(price - horizon.price!) <= tolerance)) {
      failures.push({
        code: "FORWARD_HORIZON_DUPLICATE",
        branch: `forwardPlan.${name}`,
        message: `${name} duplicates must-clear, breakout continuation, or another horizon.`,
      });
    }
    seenPrices.push(horizon.price);
    if (OBSERVED_BASIS.has(horizon.basisType)) {
      const observedPrices = candlePrices(horizon, args.priceAction, args.dataAsOf);
      if (!priceMatches(observedPrices, horizon.price, args.currentPrice)) {
        failures.push({
          code: "FORWARD_OBSERVED_PRICE_UNSUPPORTED",
          branch: `forwardPlan.${name}`,
          message: `${name} labels ${horizon.price} as ${horizon.basisType}, but that price is not present in the supplied observations.`,
        });
      }
    } else if (horizon.basisType !== "combined" && PROJECTED_BASIS.has(horizon.basisType) &&
      projectedPriceIsDescribedAsObserved(horizon)) {
      failures.push({
        code: "FORWARD_PROJECTED_PRICE_MISLABELED",
        branch: `forwardPlan.${name}`,
        message: `${name} is projected but describes its selected price as observed structure.`,
      });
    }
  }

  if (diagnostics.representedHorizons === 0) {
    failures.push({
      code: "FORWARD_MAP_EMPTY",
      branch: "forwardPlan",
      message: "No available forward horizon was returned.",
    });
  }
  for (const [index, outcome] of args.forwardPlan.additionalObservedOutcomes.entries()) {
    if (!outcome.available || outcome.price === null || !OBSERVED_BASIS.has(outcome.basisType)) {
      failures.push({
        code: "ADDITIONAL_OBSERVED_OUTCOME_INVALID",
        branch: `forwardPlan.additionalObservedOutcomes.${index}`,
        message: "Additional observed outcomes must be available, priced, and use an observed basis.",
      });
    }
  }

  if (diagnostics.outerCoverageExceedsLimit) {
    failures.push({
      code: "FORWARD_MAP_IMPLAUSIBLY_WIDE",
      branch: "forwardPlan.extremeMomentum",
      message:
        `The outer day-trade scenario is ${diagnostics.forwardCoveragePct}% above the current price, ` +
        `beyond the ${diagnostics.outerCoverageLimitPct}% ${args.marketProfile.regime} ceiling. ` +
        "Keep more distant historical highs as context rather than active forward targets.",
      details: {
        ...diagnostics,
        regime: args.marketProfile.regime,
        normalizationChanges: args.normalizationChanges ?? [],
      },
    });
  }

  const highExpansion = args.marketProfile.regime === "high_expansion" ||
    args.marketProfile.regime === "extreme_expansion";
  const compressedByRealizedMove =
    diagnostics.coverageToRealizedExpansionRatio !== null &&
    diagnostics.coverageToRealizedExpansionRatio < 0.35;
  const compressedByDailyRange =
    diagnostics.outerDistanceInAverageDailyRanges !== null &&
    diagnostics.outerDistanceInAverageDailyRanges < 0.75;
  if (
    highExpansion &&
    diagnostics.representedHorizons === HORIZON_NAMES.length &&
    compressedByRealizedMove &&
    compressedByDailyRange
  ) {
    failures.push({
      code: "FORWARD_MAP_SUSPICIOUSLY_COMPRESSED",
      branch: "forwardPlan",
      message:
        `Realized expansion is ${diagnostics.realizedExpansionPct}% and the current range is ` +
        `${args.marketProfile.currentRangeVsAverageDailyRange ?? "unknown"}x normal, while returned outer coverage is ` +
        `${diagnostics.forwardCoveragePct ?? "none"}% with price at ` +
        `${args.marketProfile.currentPriceLocationInSessionRangePct ?? "unknown"}% of the session range.`,
      details: {
        ...diagnostics,
        regime: args.marketProfile.regime,
        observedOverheadAbsent:
          args.marketProfile.currentPriceAboveHighestSuppliedDailyHigh ||
          (args.marketProfile.distanceToHighestObservedUpsidePct ?? 0) <= 2,
        normalizationChanges: args.normalizationChanges ?? [],
      },
    });
  }

  if (failures.length > 0) {
    throw new TradersLinkAiReadValidationError(failures, diagnostics);
  }
  return diagnostics;
}
