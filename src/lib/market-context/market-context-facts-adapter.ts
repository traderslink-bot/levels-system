import type { SessionMarketFactDiagnostic, SessionMarketFacts } from "../session/index.js";
import type {
  VolumeMarketFactDiagnostic,
  VolumeMarketFacts,
  VolumeShelf,
  VolumeShelfDetectorDiagnostic,
} from "../volume/index.js";
import {
  classifyMarketContext,
  type ClassifyMarketContextInput,
  type MarketContextProfile,
  type MarketContextWarning,
} from "./market-context-classifier.js";

export type MarketContextFactsAdapterRequest = {
  sessionFacts: SessionMarketFacts;
  volumeFacts?: VolumeMarketFacts;
  volumeShelves?: VolumeShelf[];
  volumeShelfDiagnostics?: VolumeShelfDetectorDiagnostic[];
  symbol?: string;
  asOfTimestamp?: number;
  referencePrice?: number;
  newsTimestamp?: number;
  pressReleaseTimestamp?: number;
};

export type MarketContextFactsSummary = {
  session: {
    previousClose?: number;
    regularSessionOpen?: number;
    currentPrice?: number;
    premarketHigh?: number;
    premarketLow?: number;
    openingRangeHigh?: number;
    openingRangeLow?: number;
    highOfDay?: number;
    lowOfDay?: number;
    vwap?: number;
    aboveVWAP?: boolean;
    percentFromVWAP?: number;
  };
  volume?: {
    currentVolume?: number;
    rollingAverageVolume?: number;
    relativeVolume?: number;
    dollarVolume?: number;
    volumeState: VolumeMarketFacts["volumeState"];
    liquidityQuality: VolumeMarketFacts["liquidityQuality"];
    accelerationState: VolumeMarketFacts["accelerationState"];
    pullbackVolumeState: VolumeMarketFacts["pullbackVolumeState"];
    breakoutVolumeState: VolumeMarketFacts["breakoutVolumeState"];
  };
  volumeShelves: VolumeShelf[];
};

export type MarketContextFactsAnalysisMetadata = {
  generatedAsOfTimestamp: number;
  source: "market_context_facts_adapter";
  version: 1;
  profile: MarketContextProfile;
  inputSummary: {
    symbol: string;
    hasSessionFacts: true;
    hasVolumeFacts: boolean;
    volumeShelfCount: number;
    hasPreviousClose: boolean;
    hasVWAPFact: boolean;
    hasRelativeVolume: boolean;
    hasDollarVolume: boolean;
    hasExplicitCatalyst: boolean;
  };
  facts: MarketContextFactsSummary;
  diagnostics: {
    futureCandlesExcluded: number;
    partialCandlesExcluded: number;
    sessionDiagnostics: SessionMarketFactDiagnostic[];
    volumeDiagnostics: VolumeMarketFactDiagnostic[];
    volumeShelfDiagnostics: VolumeShelfDetectorDiagnostic[];
    warnings: MarketContextWarning[];
  };
};

export type MarketContextFactsAdapterResult = {
  input: ClassifyMarketContextInput;
  inputSummary: MarketContextFactsAnalysisMetadata["inputSummary"];
  facts: MarketContextFactsSummary;
  diagnostics: Omit<MarketContextFactsAnalysisMetadata["diagnostics"], "warnings">;
};

export type MarketContextFactsIntegrationResult = {
  marketContext: MarketContextFactsAnalysisMetadata;
  levelOutputUnchanged: true;
  volumeShelvesAreFactsOnly: true;
};

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function isUsableNumber(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value);
}

function resolveSymbol(request: MarketContextFactsAdapterRequest): string {
  return (request.symbol ?? request.sessionFacts.symbol ?? request.volumeFacts?.symbol ?? "").toUpperCase();
}

function resolveAsOfTimestamp(request: MarketContextFactsAdapterRequest): number {
  return request.asOfTimestamp ?? request.sessionFacts.asOfTimestamp ?? request.volumeFacts?.asOfTimestamp ?? 0;
}

function resolveReferencePrice(request: MarketContextFactsAdapterRequest): number {
  const candidates = [
    request.referencePrice,
    request.sessionFacts.currentPrice,
    request.sessionFacts.highOfDay,
    request.sessionFacts.regularSessionOpen,
    request.sessionFacts.previousClose,
    request.sessionFacts.vwap,
  ];

  return candidates.find(isUsableNumber) ?? 0;
}

function countExcludedDiagnostics(
  diagnostics: Array<SessionMarketFactDiagnostic | VolumeMarketFactDiagnostic | VolumeShelfDetectorDiagnostic>,
  code: "future_candles_filtered" | "partial_candles_filtered",
): number {
  return diagnostics
    .filter((diagnostic) => diagnostic.code === code)
    .reduce((sum, diagnostic) => sum + (diagnostic.excludedCount ?? 0), 0);
}

function summarizeSessionFacts(sessionFacts: SessionMarketFacts): MarketContextFactsSummary["session"] {
  return {
    previousClose: sessionFacts.previousClose,
    regularSessionOpen: sessionFacts.regularSessionOpen,
    currentPrice: sessionFacts.currentPrice,
    premarketHigh: sessionFacts.premarketHigh,
    premarketLow: sessionFacts.premarketLow,
    openingRangeHigh: sessionFacts.openingRangeHigh,
    openingRangeLow: sessionFacts.openingRangeLow,
    highOfDay: sessionFacts.highOfDay,
    lowOfDay: sessionFacts.lowOfDay,
    vwap: sessionFacts.vwap,
    aboveVWAP: sessionFacts.aboveVWAP,
    percentFromVWAP: sessionFacts.percentFromVWAP,
  };
}

function summarizeVolumeFacts(volumeFacts: VolumeMarketFacts | undefined): MarketContextFactsSummary["volume"] {
  if (!volumeFacts) {
    return undefined;
  }

  return {
    currentVolume: volumeFacts.currentVolume,
    rollingAverageVolume: volumeFacts.rollingAverageVolume,
    relativeVolume: volumeFacts.relativeVolume,
    dollarVolume: volumeFacts.dollarVolume,
    volumeState: volumeFacts.volumeState,
    liquidityQuality: volumeFacts.liquidityQuality,
    accelerationState: volumeFacts.accelerationState,
    pullbackVolumeState: volumeFacts.pullbackVolumeState,
    breakoutVolumeState: volumeFacts.breakoutVolumeState,
  };
}

export function buildMarketContextClassifierInputFromFacts(
  request: MarketContextFactsAdapterRequest,
): MarketContextFactsAdapterResult {
  const symbol = resolveSymbol(request);
  const asOfTimestamp = resolveAsOfTimestamp(request);
  const referencePrice = resolveReferencePrice(request);
  const volumeShelves = [...(request.volumeShelves ?? [])];
  const volumeShelfDiagnostics = [...(request.volumeShelfDiagnostics ?? [])];
  const diagnostics = [
    ...request.sessionFacts.diagnostics,
    ...(request.volumeFacts?.diagnostics ?? []),
    ...volumeShelfDiagnostics,
  ];
  const hasExplicitCatalyst = hasValue(request.newsTimestamp) || hasValue(request.pressReleaseTimestamp);
  const input: ClassifyMarketContextInput = {
    symbol,
    asOfTimestamp,
    referencePrice,
    previousClose: request.sessionFacts.previousClose,
    vwap: request.sessionFacts.vwap,
    relativeVolume: request.volumeFacts?.relativeVolume,
    dollarVolume: request.volumeFacts?.dollarVolume,
    newsTimestamp: request.newsTimestamp,
    pressReleaseTimestamp: request.pressReleaseTimestamp,
  };

  return {
    input,
    inputSummary: {
      symbol,
      hasSessionFacts: true,
      hasVolumeFacts: request.volumeFacts !== undefined,
      volumeShelfCount: volumeShelves.length,
      hasPreviousClose: hasValue(request.sessionFacts.previousClose),
      hasVWAPFact: hasValue(request.sessionFacts.vwap),
      hasRelativeVolume: hasValue(request.volumeFacts?.relativeVolume),
      hasDollarVolume: hasValue(request.volumeFacts?.dollarVolume),
      hasExplicitCatalyst,
    },
    facts: {
      session: summarizeSessionFacts(request.sessionFacts),
      volume: summarizeVolumeFacts(request.volumeFacts),
      volumeShelves,
    },
    diagnostics: {
      futureCandlesExcluded: countExcludedDiagnostics(diagnostics, "future_candles_filtered"),
      partialCandlesExcluded: countExcludedDiagnostics(diagnostics, "partial_candles_filtered"),
      sessionDiagnostics: [...request.sessionFacts.diagnostics],
      volumeDiagnostics: [...(request.volumeFacts?.diagnostics ?? [])],
      volumeShelfDiagnostics,
    },
  };
}

export function buildMarketContextAnalysisFromFacts(
  request: MarketContextFactsAdapterRequest,
): MarketContextFactsIntegrationResult {
  const adapted = buildMarketContextClassifierInputFromFacts(request);
  const profile = classifyMarketContext(adapted.input);

  return {
    marketContext: {
      generatedAsOfTimestamp: adapted.input.asOfTimestamp,
      source: "market_context_facts_adapter",
      version: 1,
      profile,
      inputSummary: adapted.inputSummary,
      facts: adapted.facts,
      diagnostics: {
        ...adapted.diagnostics,
        warnings: profile.warnings,
      },
    },
    levelOutputUnchanged: true,
    volumeShelvesAreFactsOnly: true,
  };
}
