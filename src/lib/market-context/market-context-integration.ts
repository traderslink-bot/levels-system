import type { Candle } from "../market-data/candle-types.js";
import {
  filterCandlesByCloseAsOf,
  type CandleAsOfFilterDiagnostic,
} from "../market-data/candle-as-of-filter.js";
import { classifyCandleSessions } from "../market-data/candle-session-classifier.js";
import {
  classifyMarketContext,
  type ClassifyMarketContextInput,
  type MarketContextHigherTimeframeStructure,
  type MarketContextProfile,
  type MarketContextWarning,
} from "./market-context-classifier.js";

export type MarketContextAnalysisMetadata = {
  generatedAsOfTimestamp: number;
  source: "market_context_classifier";
  version: 1;
  profile: MarketContextProfile;
  inputSummary: {
    symbol: string;
    closedFiveMinuteCandles: number;
    premarketCandles: number;
    regularSessionCandles: number;
    hasPreviousClose: boolean;
    hasVWAPFact: boolean;
    hasRelativeVolume: boolean;
    hasDollarVolume: boolean;
    hasExplicitCatalyst: boolean;
  };
  diagnostics: {
    futureCandlesExcluded: number;
    partialCandlesExcluded: number;
    filterDiagnostics: CandleAsOfFilterDiagnostic[];
    warnings: MarketContextWarning[];
  };
};

export type MarketContextClassifierInputAdapterRequest = {
  symbol: string;
  asOfTimestamp: number;
  referencePrice: number;
  candles5m: Candle[];
  previousClose?: number;
  vwap?: number;
  relativeVolume?: number;
  dollarVolume?: number;
  failedHighOfDayAttempts?: number;
  newsTimestamp?: number;
  pressReleaseTimestamp?: number;
  higherTimeframeStructure?: MarketContextHigherTimeframeStructure;
};

export type MarketContextClassifierInputAdapterResult = {
  input: ClassifyMarketContextInput;
  inputSummary: MarketContextAnalysisMetadata["inputSummary"];
  diagnostics: Omit<MarketContextAnalysisMetadata["diagnostics"], "warnings">;
};

export type MarketContextClassifierInputAdapter = (
  request: MarketContextClassifierInputAdapterRequest,
) => MarketContextClassifierInputAdapterResult;

export type MarketContextIntegrationResult = {
  marketContext: MarketContextAnalysisMetadata;
  levelOutputUnchanged: true;
};

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function deriveSessionCandles(candles: Candle[]): {
  premarketCandles: Candle[];
  regularSessionCandles: Candle[];
} {
  const annotated = classifyCandleSessions(candles, "5m");
  return {
    premarketCandles: annotated
      .filter((item) => item.session === "premarket")
      .map((item) => item.candle),
    regularSessionCandles: annotated
      .filter((item) => item.session === "opening_range" || item.session === "regular")
      .map((item) => item.candle),
  };
}

export const buildMarketContextClassifierInput: MarketContextClassifierInputAdapter = (
  request,
): MarketContextClassifierInputAdapterResult => {
  const filtered = filterCandlesByCloseAsOf({
    candles: request.candles5m,
    timeframe: "5m",
    asOfTimestamp: request.asOfTimestamp,
  });
  const { premarketCandles, regularSessionCandles } = deriveSessionCandles(filtered.candles);
  const hasExplicitCatalyst = hasValue(request.newsTimestamp) || hasValue(request.pressReleaseTimestamp);
  const input: ClassifyMarketContextInput = {
    symbol: request.symbol,
    asOfTimestamp: request.asOfTimestamp,
    referencePrice: request.referencePrice,
    candles5m: filtered.candles,
    premarketCandles,
    regularSessionCandles,
    previousClose: request.previousClose,
    vwap: request.vwap,
    relativeVolume: request.relativeVolume,
    dollarVolume: request.dollarVolume,
    failedHighOfDayAttempts: request.failedHighOfDayAttempts,
    newsTimestamp: request.newsTimestamp,
    pressReleaseTimestamp: request.pressReleaseTimestamp,
    higherTimeframeStructure: request.higherTimeframeStructure,
  };

  return {
    input,
    inputSummary: {
      symbol: request.symbol.toUpperCase(),
      closedFiveMinuteCandles: filtered.candles.length,
      premarketCandles: premarketCandles.length,
      regularSessionCandles: regularSessionCandles.length,
      hasPreviousClose: hasValue(request.previousClose),
      hasVWAPFact: hasValue(request.vwap),
      hasRelativeVolume: hasValue(request.relativeVolume),
      hasDollarVolume: hasValue(request.dollarVolume),
      hasExplicitCatalyst,
    },
    diagnostics: {
      futureCandlesExcluded: filtered.excludedFutureCount,
      partialCandlesExcluded: filtered.excludedPartialCount,
      filterDiagnostics: filtered.diagnostics,
    },
  };
};

export function buildMarketContextAnalysis(
  request: MarketContextClassifierInputAdapterRequest,
): MarketContextIntegrationResult {
  const adapted = buildMarketContextClassifierInput(request);
  const profile = classifyMarketContext(adapted.input);

  return {
    marketContext: {
      generatedAsOfTimestamp: request.asOfTimestamp,
      source: "market_context_classifier",
      version: 1,
      profile,
      inputSummary: adapted.inputSummary,
      diagnostics: {
        ...adapted.diagnostics,
        warnings: profile.warnings,
      },
    },
    levelOutputUnchanged: true,
  };
}
