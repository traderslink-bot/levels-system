import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import {
  LevelEngine,
  type LevelRuntimeComparisonDetails,
  type LevelRuntimeRoleFlipComparisonDetail,
} from "../lib/levels/level-engine.js";
import type { LevelRuntimeComparisonLogEntry } from "../lib/levels/level-runtime-comparison-logger.js";
import type { LevelEngineOutput } from "../lib/levels/level-types.js";
import { CandleFetchService } from "../lib/market-data/candle-fetch-service.js";
import { filterCandlesByCloseAsOf } from "../lib/market-data/candle-as-of-filter.js";
import type {
  BaseCandleProviderResponse,
  CandleProviderName,
  CandleProviderResponse,
  CandleTimeframe,
} from "../lib/market-data/candle-types.js";
import type {
  HistoricalCandleProvider,
  HistoricalFetchPlan,
  HistoricalFetchRequest,
} from "../lib/market-data/provider-types.js";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const BASELINE_ARTIFACT_PATH = join(
  REPO_ROOT,
  "artifacts",
  "qa-engineer-pass-20260715",
  "level-quality-review.json",
);
const DEFAULT_EODHD_CORPUS_PATH = join(
  REPO_ROOT,
  "src",
  "tests",
  "fixtures",
  "eodhd-validation-corpus",
  "v1",
  "corpus.json",
);
const DEFAULT_OUTPUT_DIRECTORY = join(
  REPO_ROOT,
  "artifacts",
  "qa-engineer-pass-20260715-next-steps",
);
type SourceKind = "ibkr_cache_baseline" | "eodhd_fixture_corpus" | "eodhd_live_capture";

type CachedCandleWrapper = {
  schemaVersion: number;
  request: {
    symbol: string;
    timeframe: CandleTimeframe;
    lookbackBars: number;
    endTimeMs: number;
    provider: CandleProviderName;
  };
  response: CandleProviderResponse;
};

type BaselineEntry = {
  symbol: string;
  asOfTimestamp: number;
  referencePrice: number;
  sourceFiles: Record<"5m" | "4h" | "daily", string> & { "15m"?: string };
};

type BaselineArtifact = {
  schemaVersion: string;
  generatedAt: string;
  provider: CandleProviderName;
  cacheRoot: string;
  reviewedSymbols: string[];
  entries: BaselineEntry[];
};

type EodhdCorpusCase = {
  symbol: string;
  referencePrice: number;
  lookbacks: Record<CandleTimeframe, number>;
  responses: Record<CandleTimeframe, CandleProviderResponse>;
};

type EodhdCorpus = {
  schemaVersion: string;
  capturedAt: string;
  endTimeMs: number;
  provenance?: {
    source?: string;
  };
  cases: EodhdCorpusCase[];
};

type OfflineComparisonInput = {
  source: SourceKind;
  provider: CandleProviderName;
  symbol: string;
  referencePrice: number;
  evaluationTimestamp: number;
  requests: Record<CandleTimeframe, HistoricalFetchRequest>;
  responses: Record<CandleTimeframe, CandleProviderResponse>;
  sourceFiles: Partial<Record<CandleTimeframe, string>>;
};

type ComparisonDisagreements = {
  topSupportChanged: boolean;
  topResistanceChanged: boolean;
  nearestSupportChanged: boolean;
  nearestResistanceChanged: boolean;
  visibleSupportCountChanged: boolean;
  visibleResistanceCountChanged: boolean;
  any: boolean;
};

type RuntimeRowReview = {
  id: string;
  side: "support" | "resistance";
  bucket: "major" | "intermediate" | "intraday" | "extension";
  price: number;
  zoneLow: number;
  zoneHigh: number;
  strengthLabel: string;
  strengthScore: number;
  state: string | null;
  sourceTimeframes: CandleTimeframe[];
  isExtension: boolean;
};

type ComparisonReviewEntry = {
  source: SourceKind;
  provider: CandleProviderName;
  symbol: string;
  evaluationTimestamp: number;
  evaluationIso: string;
  referencePrice: number;
  sourceFiles: Partial<Record<CandleTimeframe, string>>;
  inputBars: Record<CandleTimeframe, number>;
  dataQualityFlags: string[];
  priceBasisByTimeframe: Partial<Record<CandleTimeframe, string>>;
  splitBasisMismatchByTimeframe: Partial<Record<CandleTimeframe, boolean>>;
  comparison: LevelRuntimeComparisonLogEntry;
  confirmedRoleFlips: LevelRuntimeRoleFlipComparisonDetail[];
  disagreements: ComparisonDisagreements;
  higherTimeframeCloseCutoffApplied: boolean;
  higherTimeframeCloseSafetyNotes: string[];
  projectedRuntimeOwnershipVerified: boolean;
  oldPathRollbackVerified: boolean;
  oldVisibleRows: RuntimeRowReview[];
  projectedVisibleRows: RuntimeRowReview[];
  oldExtensionRows: RuntimeRowReview[];
  projectedExtensionRows: RuntimeRowReview[];
};

type ComparisonReview = {
  schemaVersion: "level-runtime-comparison-review/v1";
  generatedAt: string;
  inputs: {
    baselineArtifact: string;
    baselineSchemaVersion: string;
    eodhdCorpus: string;
    eodhdCorpusSchemaVersion: string;
    ibkrCacheRoot: string;
    ibkrSymbols: string[];
    eodhdSymbols: string[];
  };
  safety: {
    activePath: "old";
    projectedPath: "new";
    offlineOnly: true;
    networkProviderCallsMade: false;
    liveRuntimeTouched: false;
    cacheFilesWritten: false;
    sourceCandlesEmbeddedInArtifact: false;
    deterministicPerInputEvaluationClock: true;
    higherTimeframeCloseGuardEvaluated: true;
    higherTimeframeCloseCutoffObserved: boolean;
    projectedRuntimeOwnershipVerified: boolean;
    oldPathRollbackVerified: boolean;
    userFacingRoleFlipCutoverSafe: boolean;
  };
  summary: {
    totalCases: number;
    uniqueSymbols: number;
    ibkrCases: number;
    eodhdCases: number;
    headlineComparisonParityCount: number;
    anyDisagreementCount: number;
    topSupportDisagreementCount: number;
    topResistanceDisagreementCount: number;
    nearestSupportDisagreementCount: number;
    nearestResistanceDisagreementCount: number;
    visibleSupportCountDisagreementCount: number;
    visibleResistanceCountDisagreementCount: number;
    projectedSupportCountHigher: number;
    projectedSupportCountLower: number;
    projectedResistanceCountHigher: number;
    projectedResistanceCountLower: number;
    projectedTopRoleFlipContextCount: number;
    confirmedRoleFlipCount: number;
    casesWithConfirmedRoleFlips: number;
    higherTimeframeCloseCutoffObservedCount: number;
  };
  cutoverBlockers: string[];
  safetyNotes: string[];
  entries: ComparisonReviewEntry[];
};

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function resolveArgumentPath(value: string | undefined, fallback: string): string {
  if (!value) {
    return fallback;
  }
  return isAbsolute(value) ? value : resolve(REPO_ROOT, value);
}

function normalizeArtifactPath(path: string): string {
  return relative(REPO_ROOT, path).replaceAll("\\", "/");
}

function resolveCacheRoot(configuredPath: string): string {
  if (isAbsolute(configuredPath)) {
    return configuredPath;
  }
  return resolve(REPO_ROOT, configuredPath);
}

function cloneBaseResponse(response: CandleProviderResponse): BaseCandleProviderResponse {
  return {
    provider: response.provider,
    symbol: response.symbol,
    timeframe: response.timeframe,
    requestedLookbackBars: response.requestedLookbackBars,
    candles: response.candles.map((candle) => ({ ...candle })),
    fetchStartTimestamp: response.fetchStartTimestamp,
    fetchEndTimestamp: response.fetchEndTimestamp,
    requestedStartTimestamp: response.requestedStartTimestamp,
    requestedEndTimestamp: response.requestedEndTimestamp,
    sessionMetadataAvailable: response.sessionMetadataAvailable,
    ...(response.providerMetadata
      ? { providerMetadata: { ...response.providerMetadata } }
      : {}),
  };
}

class OfflineSavedResponseProvider implements HistoricalCandleProvider {
  readonly requests: HistoricalFetchRequest[] = [];

  constructor(
    readonly providerName: CandleProviderName,
    private readonly responses: Record<CandleTimeframe, CandleProviderResponse>,
  ) {}

  async fetchCandles(
    request: HistoricalFetchRequest,
    _plan: HistoricalFetchPlan,
  ): Promise<BaseCandleProviderResponse> {
    const response = this.responses[request.timeframe];
    this.requests.push({ ...request });

    if (request.symbol.trim().toUpperCase() !== response.symbol.trim().toUpperCase()) {
      throw new Error(
        `Offline comparison cache miss: requested ${request.symbol} but fixture contains ${response.symbol}.`,
      );
    }
    if (request.lookbackBars !== response.requestedLookbackBars) {
      throw new Error(
        `Offline comparison cache miss for ${request.symbol} ${request.timeframe}: ` +
          `requested ${request.lookbackBars}, fixture contains ${response.requestedLookbackBars}.`,
      );
    }

    return cloneBaseResponse(response);
  }
}

function loadIbkrInputs(artifact: BaselineArtifact): OfflineComparisonInput[] {
  const cacheRoot = resolveCacheRoot(artifact.cacheRoot);

  return artifact.entries.map((entry) => {
    const wrappers = Object.fromEntries(
      (["daily", "4h", "5m"] as const).map((timeframe) => {
        const sourceFile = entry.sourceFiles[timeframe];
        if (!sourceFile) {
          throw new Error(`Baseline entry ${entry.symbol} is missing ${timeframe} sourceFile.`);
        }
        return [
          timeframe,
          readJson<CachedCandleWrapper>(join(cacheRoot, sourceFile)),
        ];
      }),
    ) as Record<CandleTimeframe, CachedCandleWrapper>;

    const requests = Object.fromEntries(
      (["daily", "4h", "5m"] as const).map((timeframe) => {
        const wrapper = wrappers[timeframe];
        return [
          timeframe,
          {
            symbol: entry.symbol,
            timeframe,
            lookbackBars: wrapper.request.lookbackBars,
            endTimeMs: wrapper.request.endTimeMs,
            preferredProvider: "ibkr" as const,
          },
        ];
      }),
    ) as Record<CandleTimeframe, HistoricalFetchRequest>;

    return {
      source: "ibkr_cache_baseline",
      provider: "ibkr",
      symbol: entry.symbol.toUpperCase(),
      referencePrice: entry.referencePrice,
      // The reference price comes from this saved 5m series. Some baseline
      // entries also carry a later 15m-context as-of time; using that unrelated
      // clock made the report label May chart reads as June observations.
      evaluationTimestamp: wrappers["5m"].response.requestedEndTimestamp,
      requests,
      responses: {
        daily: wrappers.daily.response,
        "4h": wrappers["4h"].response,
        "5m": wrappers["5m"].response,
      },
      sourceFiles: {
        daily: entry.sourceFiles.daily,
        "4h": entry.sourceFiles["4h"],
        "5m": entry.sourceFiles["5m"],
      },
    };
  });
}

function loadEodhdInputs(
  corpus: EodhdCorpus,
  corpusPath: string,
): OfflineComparisonInput[] {
  const source: SourceKind = corpus.provenance?.source === "live_eodhd_provider_capture"
    ? "eodhd_live_capture"
    : "eodhd_fixture_corpus";
  return corpus.cases.map((fixtureCase) => ({
    source,
    provider: "eodhd",
    symbol: fixtureCase.symbol.toUpperCase(),
    referencePrice: fixtureCase.referencePrice,
    evaluationTimestamp: corpus.endTimeMs,
    requests: {
      daily: {
        symbol: fixtureCase.symbol,
        timeframe: "daily",
        lookbackBars: fixtureCase.lookbacks.daily,
        endTimeMs: corpus.endTimeMs,
        preferredProvider: "eodhd",
      },
      "4h": {
        symbol: fixtureCase.symbol,
        timeframe: "4h",
        lookbackBars: fixtureCase.lookbacks["4h"],
        endTimeMs: corpus.endTimeMs,
        preferredProvider: "eodhd",
      },
      "5m": {
        symbol: fixtureCase.symbol,
        timeframe: "5m",
        lookbackBars: fixtureCase.lookbacks["5m"],
        endTimeMs: corpus.endTimeMs,
        preferredProvider: "eodhd",
      },
    },
    responses: fixtureCase.responses,
    sourceFiles: {
      daily: `${normalizeArtifactPath(corpusPath)}#${fixtureCase.symbol}.responses.daily`,
      "4h": `${normalizeArtifactPath(corpusPath)}#${fixtureCase.symbol}.responses.4h`,
      "5m": `${normalizeArtifactPath(corpusPath)}#${fixtureCase.symbol}.responses.5m`,
    },
  }));
}

function displayedPrice(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const match = value.match(/^-?[0-9]+(?:\.[0-9]+)?/);
  if (!match) {
    return null;
  }
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function displayedPriceChanged(left: string | null, right: string | null): boolean {
  const leftPrice = displayedPrice(left);
  const rightPrice = displayedPrice(right);
  if (leftPrice === null || rightPrice === null) {
    return leftPrice !== rightPrice;
  }
  return Math.abs(leftPrice - rightPrice) > 0.0001;
}

function buildDisagreements(
  comparison: LevelRuntimeComparisonLogEntry,
): ComparisonDisagreements {
  const nearestSupportChanged = comparison.notableDifferences.some((item) =>
    item.toLowerCase().includes("nearest support differs"),
  );
  const nearestResistanceChanged = comparison.notableDifferences.some((item) =>
    item.toLowerCase().includes("nearest resistance differs"),
  );
  const disagreements = {
    topSupportChanged: displayedPriceChanged(
      comparison.activeTopSupport,
      comparison.alternateTopSupport,
    ),
    topResistanceChanged: displayedPriceChanged(
      comparison.activeTopResistance,
      comparison.alternateTopResistance,
    ),
    nearestSupportChanged,
    nearestResistanceChanged,
    visibleSupportCountChanged:
      comparison.activeVisibleCounts.support !== comparison.alternateVisibleCounts.support,
    visibleResistanceCountChanged:
      comparison.activeVisibleCounts.resistance !== comparison.alternateVisibleCounts.resistance,
    any: false,
  };
  disagreements.any = Object.entries(disagreements).some(
    ([key, value]) => key !== "any" && value,
  );
  return disagreements;
}

function metadataString(
  response: CandleProviderResponse,
  field: string,
): string | undefined {
  const value = response.providerMetadata?.[field];
  return typeof value === "string" ? value : undefined;
}

function metadataBoolean(
  response: CandleProviderResponse,
  field: string,
): boolean | undefined {
  const value = response.providerMetadata?.[field];
  return typeof value === "boolean" ? value : undefined;
}

function validateConfirmedRoleFlips(
  symbol: string,
  details: LevelRuntimeComparisonDetails,
): void {
  for (const flip of details.confirmedRoleFlips) {
    const evidence = flip.evidence;
    if (flip.type !== evidence.flippedType || flip.state === "broken") {
      throw new Error(
        `${symbol} emitted inconsistent role-flip state/type for ${flip.id}.`,
      );
    }
    if (!(
      evidence.formationTimestamp < evidence.firstBreakTimestamp &&
      evidence.firstBreakTimestamp < evidence.confirmationTimestamp &&
      evidence.confirmationTimestamp < evidence.retestTimestamp &&
      evidence.retestTimestamp < evidence.reactionTimestamp
    )) {
      throw new Error(
        `${symbol} emitted out-of-order role-flip evidence timestamps for ${flip.id}.`,
      );
    }
  }
}

function canonicalVisibleGeometry(output: LevelEngineOutput): string[] {
  const visible = [
    ...output.majorSupport,
    ...output.intermediateSupport,
    ...output.intradaySupport,
    ...output.majorResistance,
    ...output.intermediateResistance,
    ...output.intradayResistance,
  ];
  return visible
    .map((zone) => [
      zone.id,
      zone.kind,
      zone.representativePrice,
      zone.zoneLow,
      zone.zoneHigh,
    ].join("|"))
    .sort();
}

function canonicalSurfacedGeometry(
  details: LevelRuntimeComparisonDetails,
): string[] {
  return details.surfacedRows
    .map((level) => [
      level.id,
      level.type,
      level.price,
      level.zoneLow,
      level.zoneHigh,
    ].join("|"))
    .sort();
}

function reviewRuntimeRows(
  output: LevelEngineOutput,
  includeExtensions: boolean,
): RuntimeRowReview[] {
  const rows = includeExtensions
    ? [
        ...output.extensionLevels.support.map((zone) => ({ zone, bucket: "extension" as const })),
        ...output.extensionLevels.resistance.map((zone) => ({ zone, bucket: "extension" as const })),
      ]
    : [
        ...output.majorSupport.map((zone) => ({ zone, bucket: "major" as const })),
        ...output.majorResistance.map((zone) => ({ zone, bucket: "major" as const })),
        ...output.intermediateSupport.map((zone) => ({ zone, bucket: "intermediate" as const })),
        ...output.intermediateResistance.map((zone) => ({ zone, bucket: "intermediate" as const })),
        ...output.intradaySupport.map((zone) => ({ zone, bucket: "intraday" as const })),
        ...output.intradayResistance.map((zone) => ({ zone, bucket: "intraday" as const })),
      ];

  return rows
    .map(({ zone, bucket }) => ({
      id: zone.id,
      side: zone.kind,
      bucket,
      price: zone.representativePrice,
      zoneLow: zone.zoneLow,
      zoneHigh: zone.zoneHigh,
      strengthLabel: zone.strengthLabel,
      strengthScore: zone.strengthScore,
      state: zone.enrichedAnalysis?.state ?? null,
      sourceTimeframes: [...zone.timeframeSources],
      isExtension: zone.isExtension,
    }))
    .sort((left, right) =>
      left.side.localeCompare(right.side) ||
      (left.side === "support" ? right.price - left.price : left.price - right.price),
    );
}

async function compareInput(input: OfflineComparisonInput): Promise<ComparisonReviewEntry> {
  const provider = new OfflineSavedResponseProvider(input.provider, input.responses);
  const comparisonLogs: LevelRuntimeComparisonLogEntry[] = [];
  const comparisonDetails: LevelRuntimeComparisonDetails[] = [];
  const engine = new LevelEngine(new CandleFetchService(provider), undefined, {
    runtimeMode: "compare",
    compareActivePath: "old",
    onComparisonLog: (entry) => comparisonLogs.push(entry),
    onComparisonDetails: (details) => comparisonDetails.push(details),
  });
  const originalNow = Date.now;
  Date.now = () => input.evaluationTimestamp;

  try {
    const generation = await engine.generateLevelsWithSeries({
      symbol: input.symbol,
      referencePriceOverride: input.referencePrice,
      historicalRequests: input.requests,
    });
    const comparison = comparisonLogs[0];
    if (!comparison || comparisonLogs.length !== 1) {
      throw new Error(
        `Expected one compare-mode log for ${input.symbol}; received ${comparisonLogs.length}.`,
      );
    }
    const details = comparisonDetails[0];
    if (!details || comparisonDetails.length !== 1) {
      throw new Error(
        `Expected one compare-mode detail payload for ${input.symbol}; received ${comparisonDetails.length}.`,
      );
    }
    validateConfirmedRoleFlips(input.symbol, details);
    if (provider.requests.length !== 3) {
      throw new Error(
        `Expected three offline candle reads for ${input.symbol}; received ${provider.requests.length}.`,
      );
    }

    const rollbackProvider = new OfflineSavedResponseProvider(input.provider, input.responses);
    const rollbackGeneration = await new LevelEngine(
      new CandleFetchService(rollbackProvider),
      undefined,
      { runtimeMode: "old" },
    ).generateLevelsWithSeries({
      symbol: input.symbol,
      referencePriceOverride: input.referencePrice,
      historicalRequests: input.requests,
    });
    const oldPathRollbackVerified = isDeepStrictEqual(
      rollbackGeneration.output,
      generation.output,
    );
    if (!oldPathRollbackVerified) {
      throw new Error(`${input.symbol} old mode did not reproduce compare-mode old output.`);
    }

    const projectedProvider = new OfflineSavedResponseProvider(input.provider, input.responses);
    const projectedGeneration = await new LevelEngine(
      new CandleFetchService(projectedProvider),
      undefined,
      { runtimeMode: "new" },
    ).generateLevelsWithSeries({
      symbol: input.symbol,
      referencePriceOverride: input.referencePrice,
      historicalRequests: input.requests,
    });
    const projectedRuntimeOwnershipVerified = isDeepStrictEqual(
      canonicalVisibleGeometry(projectedGeneration.output),
      canonicalSurfacedGeometry(details),
    );
    if (!projectedRuntimeOwnershipVerified) {
      throw new Error(
        `${input.symbol} new runtime buckets do not exactly match projected surfaced rows.`,
      );
    }

    const closeCutoffResults = (["daily", "4h"] as const).map((timeframe) => ({
      timeframe,
      result: filterCandlesByCloseAsOf({
        candles: generation.seriesByTimeframe[timeframe].candles,
        timeframe,
        asOfTimestamp: generation.seriesByTimeframe[timeframe].requestedEndTimestamp,
      }),
    }));
    const excludedHigherTimeframeBars = closeCutoffResults.reduce(
      (count, item) =>
        count + item.result.excludedFutureCount + item.result.excludedPartialCount,
      0,
    );
    const safetyNotes = excludedHigherTimeframeBars > 0
      ? closeCutoffResults
          .filter((item) =>
            item.result.excludedFutureCount + item.result.excludedPartialCount > 0,
          )
          .map((item) =>
            `${item.timeframe} close cutoff excluded ${item.result.excludedFutureCount} future and ${item.result.excludedPartialCount} partial candle(s).`,
          )
      : [
          "Higher-timeframe close cutoffs were evaluated; this saved case contained no future or partial daily/4h candle to exclude.",
        ];
    return {
      source: input.source,
      provider: input.provider,
      symbol: input.symbol,
      evaluationTimestamp: input.evaluationTimestamp,
      evaluationIso: new Date(input.evaluationTimestamp).toISOString(),
      referencePrice: input.referencePrice,
      sourceFiles: input.sourceFiles,
      inputBars: {
        daily: generation.seriesByTimeframe.daily.candles.length,
        "4h": generation.seriesByTimeframe["4h"].candles.length,
        "5m": generation.seriesByTimeframe["5m"].candles.length,
      },
      dataQualityFlags: [...generation.output.metadata.dataQualityFlags].sort(),
      priceBasisByTimeframe: Object.fromEntries(
        (["daily", "4h", "5m"] as const)
          .map((timeframe) => [
            timeframe,
            metadataString(generation.seriesByTimeframe[timeframe], "priceBasisSource"),
          ])
          .filter((entry): entry is [CandleTimeframe, string] => entry[1] !== undefined),
      ),
      splitBasisMismatchByTimeframe: Object.fromEntries(
        (["daily", "4h", "5m"] as const)
          .map((timeframe) => [
            timeframe,
            metadataBoolean(
              generation.seriesByTimeframe[timeframe],
              "splitBasisMismatchDetected",
            ),
          ])
          .filter((entry): entry is [CandleTimeframe, boolean] => entry[1] !== undefined),
      ),
      comparison,
      confirmedRoleFlips: details.confirmedRoleFlips,
      disagreements: buildDisagreements(comparison),
      higherTimeframeCloseCutoffApplied: excludedHigherTimeframeBars > 0,
      higherTimeframeCloseSafetyNotes: safetyNotes,
      projectedRuntimeOwnershipVerified,
      oldPathRollbackVerified,
      oldVisibleRows: reviewRuntimeRows(generation.output, false),
      projectedVisibleRows: reviewRuntimeRows(projectedGeneration.output, false),
      oldExtensionRows: reviewRuntimeRows(generation.output, true),
      projectedExtensionRows: reviewRuntimeRows(projectedGeneration.output, true),
    };
  } finally {
    Date.now = originalNow;
  }
}

function projectedTopHasRoleFlipContext(entry: ComparisonReviewEntry): boolean {
  return [
    entry.comparison.newPathContext.topSupportExplanation,
    entry.comparison.newPathContext.topResistanceExplanation,
  ].some((value) => typeof value === "string" && /role[ -]?flip/i.test(value));
}

function summarize(entries: ComparisonReviewEntry[]): ComparisonReview["summary"] {
  return {
    totalCases: entries.length,
    uniqueSymbols: new Set(entries.map((entry) => entry.symbol)).size,
    ibkrCases: entries.filter((entry) => entry.provider === "ibkr").length,
    eodhdCases: entries.filter((entry) => entry.provider === "eodhd").length,
    headlineComparisonParityCount: entries.filter((entry) => !entry.disagreements.any).length,
    anyDisagreementCount: entries.filter((entry) => entry.disagreements.any).length,
    topSupportDisagreementCount: entries.filter(
      (entry) => entry.disagreements.topSupportChanged,
    ).length,
    topResistanceDisagreementCount: entries.filter(
      (entry) => entry.disagreements.topResistanceChanged,
    ).length,
    nearestSupportDisagreementCount: entries.filter(
      (entry) => entry.disagreements.nearestSupportChanged,
    ).length,
    nearestResistanceDisagreementCount: entries.filter(
      (entry) => entry.disagreements.nearestResistanceChanged,
    ).length,
    visibleSupportCountDisagreementCount: entries.filter(
      (entry) => entry.disagreements.visibleSupportCountChanged,
    ).length,
    visibleResistanceCountDisagreementCount: entries.filter(
      (entry) => entry.disagreements.visibleResistanceCountChanged,
    ).length,
    projectedSupportCountHigher: entries.filter(
      (entry) =>
        entry.comparison.alternateVisibleCounts.support >
        entry.comparison.activeVisibleCounts.support,
    ).length,
    projectedSupportCountLower: entries.filter(
      (entry) =>
        entry.comparison.alternateVisibleCounts.support <
        entry.comparison.activeVisibleCounts.support,
    ).length,
    projectedResistanceCountHigher: entries.filter(
      (entry) =>
        entry.comparison.alternateVisibleCounts.resistance >
        entry.comparison.activeVisibleCounts.resistance,
    ).length,
    projectedResistanceCountLower: entries.filter(
      (entry) =>
        entry.comparison.alternateVisibleCounts.resistance <
        entry.comparison.activeVisibleCounts.resistance,
    ).length,
    projectedTopRoleFlipContextCount: entries.filter(projectedTopHasRoleFlipContext).length,
    confirmedRoleFlipCount: entries.reduce(
      (count, entry) => count + entry.confirmedRoleFlips.length,
      0,
    ),
    casesWithConfirmedRoleFlips: entries.filter(
      (entry) => entry.confirmedRoleFlips.length > 0,
    ).length,
    higherTimeframeCloseCutoffObservedCount: entries.filter(
      (entry) => entry.higherTimeframeCloseCutoffApplied,
    ).length,
  };
}

function formatComparisonReview(review: ComparisonReview): string {
  const lines = [
    "Level runtime comparison review",
    `Generated at (deterministic input clock): ${review.generatedAt}`,
    `Inputs: ${review.summary.totalCases} cases / ${review.summary.uniqueSymbols} unique symbols (${review.summary.ibkrCases} IBKR cache, ${review.summary.eodhdCases} EODHD corpus)`,
    "Active path: old | Projected path: new | Mode: LevelEngine compare",
    "Network provider calls: 0 | Live runtime touched: no | Input caches written: no",
    "",
    "Summary",
    `Headline comparison parity (top/nearest/counts): ${review.summary.headlineComparisonParityCount}/${review.summary.totalCases}`,
    `Any disagreement: ${review.summary.anyDisagreementCount}/${review.summary.totalCases}`,
    `Top support disagreements: ${review.summary.topSupportDisagreementCount}`,
    `Top resistance disagreements: ${review.summary.topResistanceDisagreementCount}`,
    `Nearest support disagreements: ${review.summary.nearestSupportDisagreementCount}`,
    `Nearest resistance disagreements: ${review.summary.nearestResistanceDisagreementCount}`,
    `Visible support count disagreements: ${review.summary.visibleSupportCountDisagreementCount}`,
    `Visible resistance count disagreements: ${review.summary.visibleResistanceCountDisagreementCount}`,
    `Projected support count higher/lower: ${review.summary.projectedSupportCountHigher}/${review.summary.projectedSupportCountLower}`,
    `Projected resistance count higher/lower: ${review.summary.projectedResistanceCountHigher}/${review.summary.projectedResistanceCountLower}`,
    `Projected top levels with role-flip wording: ${review.summary.projectedTopRoleFlipContextCount}`,
    `Confirmed surfaced role flips: ${review.summary.confirmedRoleFlipCount} across ${review.summary.casesWithConfirmedRoleFlips} cases`,
    "",
    "Per-symbol comparison",
  ];

  for (const entry of review.entries) {
    const comparison = entry.comparison;
    lines.push(
      `${entry.symbol} | ${entry.provider} | ${entry.source}`,
      `  top support: old=${comparison.activeTopSupport ?? "none"} | new=${comparison.alternateTopSupport ?? "none"} | changed=${entry.disagreements.topSupportChanged}`,
      `  top resistance: old=${comparison.activeTopResistance ?? "none"} | new=${comparison.alternateTopResistance ?? "none"} | changed=${entry.disagreements.topResistanceChanged}`,
      `  nearest support: old=${comparison.activeNearestSupport ?? "none"} | new=${comparison.alternateNearestSupport ?? "none"} | changed=${entry.disagreements.nearestSupportChanged}`,
      `  nearest resistance: old=${comparison.activeNearestResistance ?? "none"} | new=${comparison.alternateNearestResistance ?? "none"} | changed=${entry.disagreements.nearestResistanceChanged}`,
      `  visible support: old=${comparison.activeVisibleCounts.support} | new=${comparison.alternateVisibleCounts.support}`,
      `  visible resistance: old=${comparison.activeVisibleCounts.resistance} | new=${comparison.alternateVisibleCounts.resistance}`,
      `  ownership/rollback: projected=${entry.projectedRuntimeOwnershipVerified} | old=${entry.oldPathRollbackVerified}`,
      `  notable: ${comparison.notableDifferences.join("; ") || "none"}`,
    );
    for (const flip of entry.confirmedRoleFlips) {
      lines.push(
        `  role flip: ${flip.type} ${flip.price} | ${flip.evidence.timeframe} | ` +
          `formed=${new Date(flip.evidence.formationTimestamp).toISOString()} | ` +
          `break=${new Date(flip.evidence.firstBreakTimestamp).toISOString()} | ` +
          `confirmed=${new Date(flip.evidence.confirmationTimestamp).toISOString()} | ` +
          `retest=${new Date(flip.evidence.retestTimestamp).toISOString()} | ` +
          `reaction=${new Date(flip.evidence.reactionTimestamp).toISOString()}`,
      );
    }
    if (entry.higherTimeframeCloseSafetyNotes.length > 0) {
      lines.push(
        `  HTF close cutoff: applied | ${entry.higherTimeframeCloseSafetyNotes.join(" ")}`,
      );
    }
  }

  lines.push("", "Cutover blockers");
  if (review.cutoverBlockers.length === 0) {
    lines.push("- none");
  } else {
    for (const blocker of review.cutoverBlockers) {
      lines.push(`- ${blocker}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const eodhdCorpusPath = resolveArgumentPath(
    argumentValue("--eodhd-corpus"),
    DEFAULT_EODHD_CORPUS_PATH,
  );
  const outputDirectory = resolveArgumentPath(
    argumentValue("--out-dir"),
    DEFAULT_OUTPUT_DIRECTORY,
  );
  const outputStem = argumentValue("--output-stem") ?? "level-runtime-comparison-review";
  const outputJsonPath = join(outputDirectory, `${outputStem}.json`);
  const outputTextPath = join(outputDirectory, `${outputStem}.txt`);
  const eodhdOnly = hasFlag("--eodhd-only");
  const baseline = readJson<BaselineArtifact>(BASELINE_ARTIFACT_PATH);
  const eodhdCorpus = readJson<EodhdCorpus>(eodhdCorpusPath);
  const inputs = [
    ...(eodhdOnly ? [] : loadIbkrInputs(baseline)),
    ...loadEodhdInputs(eodhdCorpus, eodhdCorpusPath),
  ];
  const entries: ComparisonReviewEntry[] = [];

  for (const input of inputs) {
    entries.push(await compareInput(input));
  }

  const safetyNotes = [
    "LevelEngine passes each validated series requestedEndTimestamp into the projected adapter, so role-flip evidence is evaluated at the data request cutoff rather than the later wall clock.",
    "Daily evidence uses the New York 16:00 session close and four-hour evidence uses candle start plus four hours. Actual future/partial exclusions are measured per saved case instead of inferred from provider name.",
  ];
  const summary = summarize(entries);
  const projectedRuntimeOwnershipVerified = entries.every(
    (entry) => entry.projectedRuntimeOwnershipVerified,
  );
  const oldPathRollbackVerified = entries.every(
    (entry) => entry.oldPathRollbackVerified,
  );
  const generatedAt = new Date(
    Math.max(...entries.map((entry) => entry.evaluationTimestamp)),
  ).toISOString();
  const review: ComparisonReview = {
    schemaVersion: "level-runtime-comparison-review/v1",
    generatedAt,
    inputs: {
      baselineArtifact: normalizeArtifactPath(BASELINE_ARTIFACT_PATH),
      baselineSchemaVersion: baseline.schemaVersion,
      eodhdCorpus: normalizeArtifactPath(eodhdCorpusPath),
      eodhdCorpusSchemaVersion: eodhdCorpus.schemaVersion,
      ibkrCacheRoot: baseline.cacheRoot,
      ibkrSymbols: entries
        .filter((entry) => entry.provider === "ibkr")
        .map((entry) => entry.symbol),
      eodhdSymbols: entries
        .filter((entry) => entry.provider === "eodhd")
        .map((entry) => entry.symbol),
    },
    safety: {
      activePath: "old",
      projectedPath: "new",
      offlineOnly: true,
      networkProviderCallsMade: false,
      liveRuntimeTouched: false,
      cacheFilesWritten: false,
      sourceCandlesEmbeddedInArtifact: false,
      deterministicPerInputEvaluationClock: true,
      higherTimeframeCloseGuardEvaluated: true,
      higherTimeframeCloseCutoffObserved:
        summary.higherTimeframeCloseCutoffObservedCount > 0,
      projectedRuntimeOwnershipVerified,
      oldPathRollbackVerified,
      userFacingRoleFlipCutoverSafe:
        projectedRuntimeOwnershipVerified &&
        oldPathRollbackVerified &&
        summary.nearestSupportDisagreementCount === 0 &&
        summary.nearestResistanceDisagreementCount === 0,
    },
    summary,
    cutoverBlockers:
      summary.nearestSupportDisagreementCount > 0 ||
      summary.nearestResistanceDisagreementCount > 0
        ? [
            `Nearest support representatives differ in ${summary.nearestSupportDisagreementCount} of ${summary.totalCases} comparison cases and nearest resistance representatives differ in ${summary.nearestResistanceDisagreementCount} of ${summary.totalCases}; some are shifts inside the same evidence area, but disjoint reads still require explicit chart review before enabling the projected path.`,
          ]
        : [],
    safetyNotes,
    entries,
  };

  mkdirSync(dirname(outputJsonPath), { recursive: true });
  writeFileSync(outputJsonPath, `${JSON.stringify(review, null, 2)}\n`, "utf8");
  writeFileSync(outputTextPath, formatComparisonReview(review), "utf8");
  console.log(formatComparisonReview(review).trimEnd());
  console.log(`JSON artifact: ${normalizeArtifactPath(outputJsonPath)}`);
  console.log(`Text artifact: ${normalizeArtifactPath(outputTextPath)}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
