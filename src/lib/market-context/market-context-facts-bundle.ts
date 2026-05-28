import type { SessionMarketFactDiagnostic, SessionMarketFacts } from "../session/index.js";
import type { VolumeMarketFactDiagnostic, VolumeMarketFacts, VolumeShelf } from "../volume/index.js";

export type MarketContextFactsBundleNewsMetadata = {
  newsTimestamp?: number;
  pressReleaseTimestamp?: number;
  hasExplicitCatalyst: true;
};

export type MarketContextFactsBundleDiagnostics = {
  futureCandlesExcluded: number;
  partialCandlesExcluded: number;
  sessionDiagnostics: SessionMarketFactDiagnostic[];
  volumeDiagnostics: VolumeMarketFactDiagnostic[];
};

export type MarketContextFactsBundleSafetyFlags = {
  levelOutputUnchanged: true;
  shelvesAreFactsOnly: true;
  vwapFactsOnly: true;
};

export type MarketContextFactsBundle = {
  symbol: string;
  asOfTimestamp: number;
  referencePrice?: number;
  sessionFacts: SessionMarketFacts;
  volumeFacts: VolumeMarketFacts;
  volumeShelves: VolumeShelf[];
  news?: MarketContextFactsBundleNewsMetadata;
  diagnostics: MarketContextFactsBundleDiagnostics;
  levelOutputUnchanged: true;
  shelvesAreFactsOnly: true;
  vwapFactsOnly: true;
};

export type BuildMarketContextFactsBundleRequest = {
  sessionFacts: SessionMarketFacts;
  volumeFacts: VolumeMarketFacts;
  volumeShelves?: VolumeShelf[];
  symbol?: string;
  asOfTimestamp?: number;
  referencePrice?: number;
  newsTimestamp?: number;
  pressReleaseTimestamp?: number;
};

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function isUsableNumber(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value);
}

function resolveSymbol(request: BuildMarketContextFactsBundleRequest): string {
  return (request.symbol ?? request.sessionFacts.symbol ?? request.volumeFacts.symbol).toUpperCase();
}

function resolveAsOfTimestamp(request: BuildMarketContextFactsBundleRequest): number {
  return request.asOfTimestamp ?? request.sessionFacts.asOfTimestamp ?? request.volumeFacts.asOfTimestamp;
}

function resolveReferencePrice(request: BuildMarketContextFactsBundleRequest): number | undefined {
  const candidates = [
    request.referencePrice,
    request.sessionFacts.currentPrice,
    request.sessionFacts.highOfDay,
    request.sessionFacts.regularSessionOpen,
    request.sessionFacts.previousClose,
    request.sessionFacts.vwap,
  ];

  return candidates.find(isUsableNumber);
}

function cloneSessionDiagnostic(diagnostic: SessionMarketFactDiagnostic): SessionMarketFactDiagnostic {
  return { ...diagnostic };
}

function cloneVolumeDiagnostic(diagnostic: VolumeMarketFactDiagnostic): VolumeMarketFactDiagnostic {
  return { ...diagnostic };
}

function cloneSessionFacts(facts: SessionMarketFacts): SessionMarketFacts {
  const clone: SessionMarketFacts = {
    ...facts,
    diagnostics: facts.diagnostics.map(cloneSessionDiagnostic),
  };

  if (facts.firstConsolidationRange) {
    clone.firstConsolidationRange = { ...facts.firstConsolidationRange };
  }

  return clone;
}

function cloneVolumeFacts(facts: VolumeMarketFacts): VolumeMarketFacts {
  return {
    ...facts,
    diagnostics: facts.diagnostics.map(cloneVolumeDiagnostic),
  };
}

function cloneVolumeShelf(shelf: VolumeShelf): VolumeShelf {
  return { ...shelf };
}

function countExcludedDiagnostics(
  diagnostics: Array<SessionMarketFactDiagnostic | VolumeMarketFactDiagnostic>,
  code: "future_candles_filtered" | "partial_candles_filtered",
): number {
  return diagnostics
    .filter((diagnostic) => diagnostic.code === code)
    .reduce((sum, diagnostic) => sum + (diagnostic.excludedCount ?? 0), 0);
}

function newsMetadata(
  request: BuildMarketContextFactsBundleRequest,
): MarketContextFactsBundleNewsMetadata | undefined {
  if (!hasValue(request.newsTimestamp) && !hasValue(request.pressReleaseTimestamp)) {
    return undefined;
  }

  const metadata: MarketContextFactsBundleNewsMetadata = {
    hasExplicitCatalyst: true,
  };

  if (hasValue(request.newsTimestamp)) {
    metadata.newsTimestamp = request.newsTimestamp;
  }
  if (hasValue(request.pressReleaseTimestamp)) {
    metadata.pressReleaseTimestamp = request.pressReleaseTimestamp;
  }

  return metadata;
}

export function buildMarketContextFactsBundle(
  request: BuildMarketContextFactsBundleRequest,
): MarketContextFactsBundle {
  const sessionFacts = cloneSessionFacts(request.sessionFacts);
  const volumeFacts = cloneVolumeFacts(request.volumeFacts);
  const volumeShelves = (request.volumeShelves ?? []).map(cloneVolumeShelf);
  const diagnostics = [...sessionFacts.diagnostics, ...volumeFacts.diagnostics];
  const bundle: MarketContextFactsBundle = {
    symbol: resolveSymbol(request),
    asOfTimestamp: resolveAsOfTimestamp(request),
    sessionFacts,
    volumeFacts,
    volumeShelves,
    diagnostics: {
      futureCandlesExcluded: countExcludedDiagnostics(diagnostics, "future_candles_filtered"),
      partialCandlesExcluded: countExcludedDiagnostics(diagnostics, "partial_candles_filtered"),
      sessionDiagnostics: sessionFacts.diagnostics,
      volumeDiagnostics: volumeFacts.diagnostics,
    },
    levelOutputUnchanged: true,
    shelvesAreFactsOnly: true,
    vwapFactsOnly: true,
  };
  const referencePrice = resolveReferencePrice(request);
  const news = newsMetadata(request);

  if (referencePrice !== undefined) {
    bundle.referencePrice = referencePrice;
  }
  if (news) {
    bundle.news = news;
  }

  return bundle;
}
