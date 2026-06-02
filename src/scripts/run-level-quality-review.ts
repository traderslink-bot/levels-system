import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildLevelAnalysisSnapshotFromCandles,
} from "../lib/analysis/level-analysis-snapshot-from-candles.js";
import type {
  LevelAnalysisSnapshot,
  LevelAnalysisSnapshotNearestLevel,
} from "../lib/analysis/level-analysis-snapshot.js";
import { DEFAULT_LEVEL_ENGINE_CONFIG, type LevelEngineConfig } from "../lib/levels/level-config.js";
import { clusterRawLevelCandidates } from "../lib/levels/level-clusterer.js";
import { buildLevelCandidatePoolDiagnostics } from "../lib/levels/level-candidate-pool-diagnostics.js";
import { buildLevelCandidateInventoryReviewVisibility } from "../lib/levels/level-candidate-inventory-review-adapter.js";
import {
  validateLevelCandidateInventoryReviewVisibilityWrapper,
  type LevelCandidateInventoryReviewVisibilityWrapper,
} from "../lib/levels/level-candidate-inventory-review-wiring.js";
import type { LevelQualityDensityMetric } from "../lib/levels/level-quality-density-metric.js";
import type { LevelQualityDiagnosticDescription } from "../lib/levels/level-quality-audit-wording.js";
import { scoreLevelZones } from "../lib/levels/level-scorer.js";
import { buildRawLevelCandidates } from "../lib/levels/raw-level-candidate-builder.js";
import { buildSpecialLevelCandidates } from "../lib/levels/special-level-builder.js";
import { detectSwingPoints } from "../lib/levels/swing-detector.js";
import type { LevelEngineOutput, RawLevelCandidate } from "../lib/levels/level-types.js";
import { filterCandlesByCloseAsOf } from "../lib/market-data/candle-as-of-filter.js";
import type { Candle, CandleProviderName, CandleTimeframe } from "../lib/market-data/candle-types.js";

type ReviewTimeframe = "5m" | "15m" | "4h" | "daily";

type CompactNearestLevel = {
  levelId: string;
  bucket: string;
  price: number;
  distancePct: number;
  isExtension: boolean;
};

type CompactBucketCounts = {
  majorSupport: number;
  majorResistance: number;
  intermediateSupport: number;
  intermediateResistance: number;
  intradaySupport: number;
  intradayResistance: number;
  extensionSupport: number;
  extensionResistance: number;
  total: number;
};

type CompactExtensionCoverage = {
  support: number;
  resistance: number;
  lowestSupportExtension?: number;
  highestResistanceExtension?: number;
  downsideCoveragePct?: number;
  upsideCoveragePct?: number;
  warnings: string[];
};

type CompactSyntheticContinuationMap = {
  count: number;
  clearlyMarkedCount: number;
  entries: Array<{
    levelId: string;
    side: "support" | "resistance";
    price: number;
    extensionSource: string;
    generationMethod?: string;
    evidenceLimitations: string[];
  }>;
};

type CompactDiagnosticSemantics = {
  present: boolean;
  codesMatchDiagnostics: boolean;
  allFactualOnly: boolean;
  categories: Record<string, number>;
  severities: Record<string, number>;
  prohibitedLanguageHits: string[];
};

type CompactFifteenMinuteContext = {
  inputProvided: boolean;
  filteredCandleCount: number;
  factsPresent: boolean;
  providerMetadataHas15m: boolean;
  stillContextOnly: boolean;
};

type CompactDensityMetric =
  | ({
      present: true;
    } & LevelQualityDensityMetric)
  | {
      present: false;
    };

type CompactCandidateInventorySummary = {
  presentCount: number;
  validCount: number;
  missingCount: number;
  closerUnsurfacedCount: number;
  supportCloserUnsurfacedCount: number;
  resistanceCloserUnsurfacedCount: number;
  truthfulMarketContextCount: number;
  supportTruthfulMarketContextCount: number;
  resistanceTruthfulMarketContextCount: number;
};

type CompactQualityAudit = {
  diagnostics: string[];
  diagnosticSemantics: LevelQualityDiagnosticDescription[];
  summary: LevelAnalysisSnapshot["levelQualityAudit"]["summary"];
  enrichmentBreakdown?: LevelAnalysisSnapshot["levelQualityAudit"]["enrichmentBreakdown"];
  extensionCoverage: LevelAnalysisSnapshot["levelQualityAudit"]["extensionCoverage"];
  densityMetric?: CompactDensityMetric;
  clusteredAreaCount: number;
  possibleClutterLevelCount: number;
};

export type LevelQualityReviewBaselineEntry = {
  symbol: string;
  provider?: string;
  asOfTimestamp: number;
  asOfIso?: string;
  referencePrice?: number;
  previousClose?: number;
  hasSupplied15m?: boolean;
  sourceFiles: Partial<Record<ReviewTimeframe, string>>;
  nearestLevels?: {
    support?: CompactNearestLevel | null;
    resistance?: CompactNearestLevel | null;
  };
  bucketCounts?: CompactBucketCounts;
  extensionCoverage?: Partial<CompactExtensionCoverage>;
  syntheticContinuationMap?: Partial<CompactSyntheticContinuationMap>;
  qualityAudit?: Partial<CompactQualityAudit>;
  diagnosticSemantics?: Partial<CompactDiagnosticSemantics>;
  fifteenMinuteContext?: Partial<CompactFifteenMinuteContext>;
};

export type LevelQualityReviewBaseline = {
  schemaVersion?: string;
  generatedAt?: string;
  provider?: string;
  cacheRoot?: string;
  reviewedSymbols?: string[];
  supplied15mSymbols?: string[];
  entries: LevelQualityReviewBaselineEntry[];
};

export type LevelQualityReviewRunnerOptions = {
  cacheRoot: string;
  baselinePath: string;
  outJsonPath: string;
  outTextPath: string;
  generatedAt: string;
  provider: CandleProviderName;
};

export type LevelQualityReviewRunnerEntry = {
  symbol: string;
  provider: CandleProviderName;
  asOfTimestamp: number;
  asOfIso: string;
  referencePrice?: number;
  previousClose?: number;
  hasSupplied15m: boolean;
  sourceFiles: Partial<Record<ReviewTimeframe, string>>;
  nearestLevels: {
    support: CompactNearestLevel | null;
    resistance: CompactNearestLevel | null;
  };
  bucketCounts: CompactBucketCounts;
  extensionCoverage: CompactExtensionCoverage;
  syntheticContinuationMap: CompactSyntheticContinuationMap;
  qualityAudit: CompactQualityAudit;
  diagnosticSemantics: CompactDiagnosticSemantics;
  fifteenMinuteContext: CompactFifteenMinuteContext;
  candidateInventoryVisibility: LevelCandidateInventoryReviewVisibilityWrapper;
  safety: {
    noLookaheadApplied: boolean;
    levelOutputUnchanged: boolean;
    noRuntimeBehaviorChange: boolean;
    syntheticExtensionsClearlyMarked: boolean;
  };
  parity: {
    nearestSupport: boolean;
    nearestResistance: boolean;
    bucketCounts: boolean;
    extensionCounts: boolean;
    syntheticContinuationMapCount: boolean;
    syntheticContinuationMapMarking: boolean;
    diagnosticsUnchanged: boolean;
    diagnosticSemanticsUnchanged: boolean;
    enrichmentBreakdown: boolean;
    extensionCoverageWarnings: boolean;
    clusteredDensityDiagnostics: boolean;
    fifteenMinuteStillContextOnly: boolean;
  };
  mismatches: string[];
};

export type LevelQualityReviewRunnerResult = {
  schemaVersion: "level-quality-review-process/v1";
  generatedAt: string;
  provider: CandleProviderName;
  cacheRoot: string;
  baselinePath: string;
  baselineGeneratedAt?: string;
  reviewedSymbols: string[];
  supplied15mSymbols: string[];
  summary: {
    totalSymbols: number;
    nearestSupportParityCount: number;
    nearestResistanceParityCount: number;
    bucketCountParityCount: number;
    extensionCountParityCount: number;
    syntheticCountParityCount: number;
    syntheticMarkingParityCount: number;
    diagnosticsParityCount: number;
    diagnosticSemanticsParityCount: number;
    enrichmentBreakdownParityCount: number;
    extensionCoverageWarningParityCount: number;
    clusteredDensityDiagnosticParityCount: number;
    fifteenMinuteContextOnlyCount: number;
    densityMetricPresentCount: number;
    candidateInventoryPresentCount: number;
    candidateInventoryValidCount: number;
    candidateInventoryCloserUnsurfacedCount: number;
    candidateInventorySupportCloserUnsurfacedCount: number;
    candidateInventoryResistanceCloserUnsurfacedCount: number;
    candidateInventoryTruthfulMarketContextCount: number;
    candidateInventorySupportTruthfulMarketContextCount: number;
    candidateInventoryResistanceTruthfulMarketContextCount: number;
    candidateInventoryMissingCount: number;
    mismatchCount: number;
    prohibitedLanguageHitCount: number;
  };
  entries: LevelQualityReviewRunnerEntry[];
  prohibitedLanguageHits: string[];
  safety: {
    readOnlyCacheReview: true;
    rawCandlesWritten: false;
    fullSnapshotsWritten: false;
    cacheFilesWritten: false;
    providerCallsMade: false;
    supportResistanceDetectionChanged: false;
    levelEngineScoringRankingClusteringChanged: false;
    surfacedLevelsChanged: false;
    extensionGenerationChanged: false;
    fifteenMinuteFedIntoLevelEngine: false;
  };
  content: string;
};

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}.`);
  }

  return value;
}

function parseGeneratedAt(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`Invalid --generated-at value "${value}". Expected ISO date.`);
  }

  return new Date(timestamp).toISOString();
}

function parseProvider(value: string | undefined): CandleProviderName {
  if (value === undefined || value === "ibkr") {
    return "ibkr";
  }
  if (value === "stub" || value === "twelve_data") {
    return value;
  }

  throw new Error(`Unsupported --provider value "${value}".`);
}

export function parseLevelQualityReviewRunnerArgs(args: string[]): LevelQualityReviewRunnerOptions {
  let cacheRoot: string | undefined;
  let baselinePath: string | undefined;
  let outJsonPath: string | undefined;
  let outTextPath: string | undefined;
  let generatedAt = new Date().toISOString();
  let provider: CandleProviderName = "ibkr";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--cache-root") {
      cacheRoot = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--baseline") {
      baselinePath = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--out-json") {
      outJsonPath = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--out-text") {
      outTextPath = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--generated-at") {
      generatedAt = parseGeneratedAt(requireValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--provider") {
      provider = parseProvider(requireValue(args, index, arg));
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument "${arg}".`);
  }

  if (!cacheRoot) {
    throw new Error("Missing required --cache-root <path>.");
  }
  if (!baselinePath) {
    throw new Error("Missing required --baseline <path>.");
  }
  if (!outJsonPath) {
    throw new Error("Missing required --out-json <path>.");
  }
  if (!outTextPath) {
    throw new Error("Missing required --out-text <path>.");
  }

  return {
    cacheRoot,
    baselinePath,
    outJsonPath,
    outTextPath,
    generatedAt,
    provider,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseCandleTimestamp(value: unknown, filePath: string, index: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  throw new Error(`Candle ${index} in ${filePath} has invalid timestamp.`);
}

function parseCandleNumber(
  value: unknown,
  field: "open" | "high" | "low" | "close" | "volume",
  filePath: string,
  index: number,
): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  throw new Error(`Candle ${index} in ${filePath} has invalid ${field}.`);
}

function normalizeCandle(value: unknown, filePath: string, index: number): Candle {
  if (!isRecord(value)) {
    throw new Error(`Candle ${index} in ${filePath} must be an object.`);
  }

  const candle: Candle = {
    timestamp: parseCandleTimestamp(value.timestamp, filePath, index),
    open: parseCandleNumber(value.open, "open", filePath, index),
    high: parseCandleNumber(value.high, "high", filePath, index),
    low: parseCandleNumber(value.low, "low", filePath, index),
    close: parseCandleNumber(value.close, "close", filePath, index),
    volume: parseCandleNumber(value.volume, "volume", filePath, index),
  };

  if (candle.high < candle.low) {
    throw new Error(`Candle ${index} in ${filePath} has high below low.`);
  }

  return candle;
}

function extractCandleArray(parsed: unknown, filePath: string): unknown[] {
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (isRecord(parsed) && Array.isArray(parsed.candles)) {
    return parsed.candles;
  }
  if (isRecord(parsed) && isRecord(parsed.response) && Array.isArray(parsed.response.candles)) {
    return parsed.response.candles;
  }

  throw new Error(
    `Candle cache JSON from ${filePath} must be an array, object with candles array, or validation-cache response.`,
  );
}

function readCacheCandles(filePath: string): Candle[] {
  const parsed = JSON.parse(readFileSync(filePath, "utf8"));
  return extractCandleArray(parsed, filePath).map((item, index) =>
    normalizeCandle(item, filePath, index),
  );
}

function filterEngineCandles(params: {
  timeframe: CandleTimeframe;
  candles: Candle[];
  asOfTimestamp: number;
}): Candle[] {
  return filterCandlesByCloseAsOf({
    candles: structuredClone(params.candles),
    timeframe: params.timeframe,
    asOfTimestamp: params.asOfTimestamp,
  }).candles;
}

function buildCandidatePoolDiagnosticsForReview(params: {
  symbol: string;
  asOfTimestamp: number;
  referencePrice?: number;
  candles5m: Candle[];
  fourHourCandles: Candle[];
  dailyCandles: Candle[];
  levelOutput: LevelEngineOutput;
  config?: LevelEngineConfig;
}) {
  const config = params.config ?? DEFAULT_LEVEL_ENGINE_CONFIG;
  const series: Array<{ timeframe: CandleTimeframe; candles: Candle[] }> = [
    {
      timeframe: "daily",
      candles: filterEngineCandles({
        timeframe: "daily",
        candles: params.dailyCandles,
        asOfTimestamp: params.asOfTimestamp,
      }),
    },
    {
      timeframe: "4h",
      candles: filterEngineCandles({
        timeframe: "4h",
        candles: params.fourHourCandles,
        asOfTimestamp: params.asOfTimestamp,
      }),
    },
    {
      timeframe: "5m",
      candles: filterEngineCandles({
        timeframe: "5m",
        candles: params.candles5m,
        asOfTimestamp: params.asOfTimestamp,
      }),
    },
  ];
  const rawCandidates: RawLevelCandidate[] = [];

  for (const item of series) {
    if (item.candles.length === 0) {
      continue;
    }
    const timeframeConfig = config.timeframeConfig[item.timeframe];
    const swings = detectSwingPoints(item.candles, {
      swingWindow: timeframeConfig.swingWindow,
      minimumDisplacementPct: timeframeConfig.minimumDisplacementPct,
      minimumSeparationBars: timeframeConfig.minimumSwingSeparationBars,
    });

    rawCandidates.push(
      ...buildRawLevelCandidates({
        symbol: params.symbol,
        timeframe: item.timeframe,
        candles: item.candles,
        swings,
      }),
    );
  }

  const fiveMinute = series.find((item) => item.timeframe === "5m")?.candles ?? [];
  const special = buildSpecialLevelCandidates(params.symbol, fiveMinute);
  rawCandidates.push(...special.candidates);

  const tolerance = Math.max(
    config.timeframeConfig.daily.clusterTolerancePct,
    config.timeframeConfig["4h"].clusterTolerancePct,
  );
  const clusteredSupportZones = clusterRawLevelCandidates(
    params.symbol,
    "support",
    rawCandidates,
    tolerance,
    config,
  );
  const clusteredResistanceZones = clusterRawLevelCandidates(
    params.symbol,
    "resistance",
    rawCandidates,
    tolerance,
    config,
  );
  const scoredSupportZones = scoreLevelZones(clusteredSupportZones, config);
  const scoredResistanceZones = scoreLevelZones(clusteredResistanceZones, config);

  return buildLevelCandidatePoolDiagnostics({
    symbol: params.symbol,
    referencePrice: params.referencePrice,
    rawCandidates,
    clusteredSupportZones,
    clusteredResistanceZones,
    scoredSupportZones,
    scoredResistanceZones,
    levelOutput: params.levelOutput,
  });
}

export function loadLevelQualityReviewBaseline(filePath: string): LevelQualityReviewBaseline {
  const parsed = JSON.parse(readFileSync(filePath, "utf8"));
  if (!isRecord(parsed) || !Array.isArray(parsed.entries)) {
    throw new Error(`Baseline ${filePath} must contain an entries array.`);
  }

  return parsed as LevelQualityReviewBaseline;
}

function resolveCachePath(cacheRoot: string, sourceFile: string): string {
  return isAbsolute(sourceFile) ? sourceFile : join(cacheRoot, sourceFile);
}

function requireSourceFile(
  entry: LevelQualityReviewBaselineEntry,
  timeframe: Exclude<ReviewTimeframe, "15m">,
): string {
  const sourceFile = entry.sourceFiles[timeframe];
  if (!sourceFile) {
    throw new Error(`Baseline entry for ${entry.symbol} is missing ${timeframe} source file.`);
  }

  return sourceFile;
}

function round(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function compactNearest(
  nearest: LevelAnalysisSnapshotNearestLevel | null,
  referencePrice: number | undefined,
): CompactNearestLevel | null {
  if (!nearest) {
    return null;
  }

  const distancePct =
    referencePrice === undefined || referencePrice === 0
      ? round(nearest.distanceFromReferencePct * 100)
      : round((Math.abs(nearest.representativePrice - referencePrice) / Math.abs(referencePrice)) * 100);

  return {
    levelId: nearest.levelId,
    bucket: nearest.bucket,
    price: round(nearest.representativePrice),
    distancePct,
    isExtension: nearest.isExtension,
  };
}

function compactBucketCounts(snapshot: LevelAnalysisSnapshot): CompactBucketCounts {
  const output = snapshot.levelEngineOutput;
  const counts = {
    majorSupport: output.majorSupport.length,
    majorResistance: output.majorResistance.length,
    intermediateSupport: output.intermediateSupport.length,
    intermediateResistance: output.intermediateResistance.length,
    intradaySupport: output.intradaySupport.length,
    intradayResistance: output.intradayResistance.length,
    extensionSupport: output.extensionLevels.support.length,
    extensionResistance: output.extensionLevels.resistance.length,
  };

  return {
    ...counts,
    total: Object.values(counts).reduce((sum, value) => sum + value, 0),
  };
}

function compactExtensionCoverage(snapshot: LevelAnalysisSnapshot): CompactExtensionCoverage {
  const coverage = snapshot.levelQualityAudit.extensionCoverage;
  return {
    support: coverage.supportExtensions,
    resistance: coverage.resistanceExtensions,
    ...(coverage.lowestSupportExtension === undefined ? {} : { lowestSupportExtension: round(coverage.lowestSupportExtension) }),
    ...(coverage.highestResistanceExtension === undefined ? {} : { highestResistanceExtension: round(coverage.highestResistanceExtension) }),
    ...(coverage.downsideCoveragePct === undefined ? {} : { downsideCoveragePct: round(coverage.downsideCoveragePct) }),
    ...(coverage.upsideCoveragePct === undefined ? {} : { upsideCoveragePct: round(coverage.upsideCoveragePct) }),
    warnings: [...coverage.warnings].sort(),
  };
}

function syntheticIsClearlyMarked(level: {
  isExtension: boolean;
  touchCount: number;
  confluenceCount: number;
  extensionMetadata?: {
    evidenceLimitations?: string[];
  };
}): boolean {
  const limitations = level.extensionMetadata?.evidenceLimitations ?? [];
  return (
    level.isExtension === true &&
    level.touchCount === 0 &&
    level.confluenceCount === 0 &&
    limitations.includes("not_historical_support_resistance") &&
    limitations.includes("no_touch_or_rejection_history")
  );
}

function compactSyntheticContinuationMap(snapshot: LevelAnalysisSnapshot): CompactSyntheticContinuationMap {
  const synthetic = [
    ...snapshot.levelEngineOutput.extensionLevels.support,
    ...snapshot.levelEngineOutput.extensionLevels.resistance,
  ].filter((level) => level.extensionMetadata?.extensionSource === "synthetic_continuation_map");

  return {
    count: synthetic.length,
    clearlyMarkedCount: synthetic.filter(syntheticIsClearlyMarked).length,
    entries: synthetic.map((level) => ({
      levelId: level.id,
      side: level.kind,
      price: round(level.representativePrice),
      extensionSource: level.extensionMetadata?.extensionSource ?? "synthetic_continuation_map",
      ...(level.extensionMetadata?.generationMethod
        ? { generationMethod: level.extensionMetadata.generationMethod }
        : {}),
      evidenceLimitations: [...(level.extensionMetadata?.evidenceLimitations ?? [])].sort(),
    })),
  };
}

function countBy<T extends string>(items: T[]): Record<string, number> {
  return items.reduce<Record<string, number>>((acc, item) => {
    acc[item] = (acc[item] ?? 0) + 1;
    return acc;
  }, {});
}

function collectStringValues(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStringValues(item, out);
    }
    return out;
  }
  if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value)) {
      collectStringValues(item, out);
    }
  }

  return out;
}

export function collectProhibitedLanguageHits(value: unknown): string[] {
  const text = collectStringValues(value).join("\n").toLowerCase();
  const hits: string[] = [];

  for (const [label, pattern] of [
    ["grade", /\bgrade\b|\bgrading\b/],
    ["coaching", /\bcoaching\b|\bcoach\b/],
    ["pnl", /\bp\/l\b|\bpnl\b/],
    ["giveback", /\bgiveback\b/],
    ["behavior score", /\bbehavior score\b|\bbehavior scoring\b/],
    ["recommendation", /\brecommendation\b/],
    ["buy", /\bbuy\b/],
    ["sell", /\bsell\b/],
    ["hold", /\bhold\b/],
    ["entry decision", /\bentry decision\b/],
    ["exit decision", /\bexit decision\b/],
    ["advice", /\btrade\s+advice\b/],
    ["mistake", /\bmistake\b/],
    ["discipline", /\bdiscipline\b/],
    ["good trade", /\bgood trade\b/],
    ["bad trade", /\bbad trade\b/],
    ["should have", /\bshould have\b/],
  ] as const) {
    if (pattern.test(text)) {
      hits.push(label);
    }
  }

  return hits;
}

function compactDiagnosticSemantics(
  diagnostics: string[],
  semantics: LevelQualityDiagnosticDescription[] | undefined,
): CompactDiagnosticSemantics {
  const semanticItems = semantics ?? [];
  const semanticCodes = semanticItems.map((item) => item.code).sort();

  return {
    present: semanticItems.length > 0,
    codesMatchDiagnostics: JSON.stringify(semanticCodes) === JSON.stringify([...diagnostics].sort()),
    allFactualOnly: semanticItems.every((item) => item.factualOnly === true),
    categories: countBy(semanticItems.map((item) => item.category)),
    severities: countBy(semanticItems.map((item) => item.severity)),
    prohibitedLanguageHits: collectProhibitedLanguageHits(semanticItems),
  };
}

function compactQualityAudit(snapshot: LevelAnalysisSnapshot): CompactQualityAudit {
  const audit = snapshot.levelQualityAudit;
  return {
    diagnostics: [...audit.diagnostics].sort(),
    diagnosticSemantics: [...(audit.diagnosticSemantics ?? [])],
    summary: structuredClone(audit.summary),
    ...(audit.enrichmentBreakdown ? { enrichmentBreakdown: structuredClone(audit.enrichmentBreakdown) } : {}),
    extensionCoverage: structuredClone(audit.extensionCoverage),
    ...(audit.densityMetric
      ? {
          densityMetric: {
            present: true,
            ...structuredClone(audit.densityMetric),
            diagnostics: [...audit.densityMetric.diagnostics].sort(),
          },
        }
      : {
          densityMetric: {
            present: false,
          },
        }),
    clusteredAreaCount: audit.clusteredAreas.length,
    possibleClutterLevelCount: audit.possibleClutterLevels.length,
  };
}

function compactFifteenMinuteContext(snapshot: LevelAnalysisSnapshot): CompactFifteenMinuteContext {
  const metadata = snapshot.levelEngineOutput.metadata.providerByTimeframe as Record<string, unknown>;
  const input = snapshot.inputSummary.timeframes["15m"];
  const providerMetadataHas15m = metadata["15m"] !== undefined;
  return {
    inputProvided: input.provided,
    filteredCandleCount: input.filteredCandleCount,
    factsPresent: snapshot.timeframeFacts?.["15m"] !== undefined,
    providerMetadataHas15m,
    stillContextOnly: providerMetadataHas15m === false,
  };
}

function candidateInventorySourceFiles(
  sourceFiles: Partial<Record<ReviewTimeframe, string>>,
): Partial<Record<ReviewTimeframe, string>> {
  return {
    ...(sourceFiles["5m"] ? { "5m": sourceFiles["5m"] } : {}),
    ...(sourceFiles["4h"] ? { "4h": sourceFiles["4h"] } : {}),
    ...(sourceFiles.daily ? { daily: sourceFiles.daily } : {}),
  };
}

function candidateInventorySummary(
  entries: LevelQualityReviewRunnerEntry[],
): CompactCandidateInventorySummary {
  const wrappers = entries.map((entry) => entry.candidateInventoryVisibility);
  const present = wrappers.filter((wrapper) => wrapper.present);

  return {
    presentCount: present.length,
    validCount: wrappers.filter((wrapper) => validateLevelCandidateInventoryReviewVisibilityWrapper(wrapper).valid).length,
    missingCount: wrappers.filter((wrapper) => !wrapper.present).length,
    closerUnsurfacedCount: present.filter((wrapper) => wrapper.gapSummary.overall === "closer_unsurfaced_candidate").length,
    supportCloserUnsurfacedCount: present.filter((wrapper) => wrapper.gapSummary.support === "closer_unsurfaced_candidate").length,
    resistanceCloserUnsurfacedCount: present.filter((wrapper) => wrapper.gapSummary.resistance === "closer_unsurfaced_candidate").length,
    truthfulMarketContextCount: present.filter((wrapper) => wrapper.gapSummary.overall === "truthful_market_context_gap").length,
    supportTruthfulMarketContextCount: present.filter((wrapper) => wrapper.gapSummary.support === "truthful_market_context_gap").length,
    resistanceTruthfulMarketContextCount: present.filter((wrapper) => wrapper.gapSummary.resistance === "truthful_market_context_gap").length,
  };
}

function stable(value: unknown): string {
  return JSON.stringify(value);
}

function sameValue(left: unknown, right: unknown): boolean {
  return stable(left) === stable(right);
}

function sameStringSet(left: string[] | undefined, right: string[] | undefined): boolean {
  return stable([...(left ?? [])].sort()) === stable([...(right ?? [])].sort());
}

function clusteredDensityDiagnostics(diagnostics: string[] | undefined): string[] {
  return [...(diagnostics ?? [])].filter((item) =>
    item === "clustered_level_areas_present" || item.includes("density"),
  ).sort();
}

function collectMismatches(parity: LevelQualityReviewRunnerEntry["parity"]): string[] {
  return Object.entries(parity)
    .filter(([, value]) => value === false)
    .map(([key]) => key);
}

export function summarizeLevelQualitySnapshot(
  params: {
    baselineEntry: LevelQualityReviewBaselineEntry;
    snapshot: LevelAnalysisSnapshot;
    provider: CandleProviderName;
  },
): Omit<LevelQualityReviewRunnerEntry, "candidateInventoryVisibility" | "parity" | "mismatches"> {
  const nearestLevels = {
    support: compactNearest(params.snapshot.nearestSupport, params.snapshot.referencePrice),
    resistance: compactNearest(params.snapshot.nearestResistance, params.snapshot.referencePrice),
  };
  const bucketCounts = compactBucketCounts(params.snapshot);
  const extensionCoverage = compactExtensionCoverage(params.snapshot);
  const syntheticContinuationMap = compactSyntheticContinuationMap(params.snapshot);
  const qualityAudit = compactQualityAudit(params.snapshot);
  const diagnosticSemantics = compactDiagnosticSemantics(
    qualityAudit.diagnostics,
    qualityAudit.diagnosticSemantics,
  );
  const fifteenMinuteContext = compactFifteenMinuteContext(params.snapshot);

  return {
    symbol: params.snapshot.symbol,
    provider: params.provider,
    asOfTimestamp: params.snapshot.asOfTimestamp,
    asOfIso: new Date(params.snapshot.asOfTimestamp).toISOString(),
    ...(params.snapshot.referencePrice === undefined ? {} : { referencePrice: params.snapshot.referencePrice }),
    ...(params.baselineEntry.previousClose === undefined ? {} : { previousClose: params.baselineEntry.previousClose }),
    hasSupplied15m: params.baselineEntry.sourceFiles["15m"] !== undefined,
    sourceFiles: structuredClone(params.baselineEntry.sourceFiles),
    nearestLevels,
    bucketCounts,
    extensionCoverage,
    syntheticContinuationMap,
    qualityAudit,
    diagnosticSemantics,
    fifteenMinuteContext,
    safety: {
      noLookaheadApplied: params.snapshot.safety.noLookaheadApplied,
      levelOutputUnchanged: params.snapshot.safety.levelOutputUnchanged,
      noRuntimeBehaviorChange: params.snapshot.safety.noRuntimeBehaviorChange,
      syntheticExtensionsClearlyMarked: params.snapshot.safety.syntheticExtensionsClearlyMarked,
    },
  };
}

function buildParity(
  baselineEntry: LevelQualityReviewBaselineEntry,
  entry: Omit<LevelQualityReviewRunnerEntry, "candidateInventoryVisibility" | "parity" | "mismatches">,
): LevelQualityReviewRunnerEntry["parity"] {
  return {
    nearestSupport: sameValue(baselineEntry.nearestLevels?.support ?? null, entry.nearestLevels.support),
    nearestResistance: sameValue(baselineEntry.nearestLevels?.resistance ?? null, entry.nearestLevels.resistance),
    bucketCounts: sameValue(baselineEntry.bucketCounts, entry.bucketCounts),
    extensionCounts:
      baselineEntry.extensionCoverage?.support === entry.extensionCoverage.support &&
      baselineEntry.extensionCoverage?.resistance === entry.extensionCoverage.resistance,
    syntheticContinuationMapCount:
      baselineEntry.syntheticContinuationMap?.count === entry.syntheticContinuationMap.count,
    syntheticContinuationMapMarking:
      baselineEntry.syntheticContinuationMap?.clearlyMarkedCount === entry.syntheticContinuationMap.clearlyMarkedCount,
    diagnosticsUnchanged: sameValue(
      [...(baselineEntry.qualityAudit?.diagnostics ?? [])].sort(),
      entry.qualityAudit.diagnostics,
    ),
    diagnosticSemanticsUnchanged: sameValue(
      baselineEntry.qualityAudit?.diagnosticSemantics ?? [],
      entry.qualityAudit.diagnosticSemantics,
    ),
    enrichmentBreakdown: sameValue(
      baselineEntry.qualityAudit?.enrichmentBreakdown,
      entry.qualityAudit.enrichmentBreakdown,
    ),
    extensionCoverageWarnings: sameStringSet(
      baselineEntry.extensionCoverage?.warnings,
      entry.extensionCoverage.warnings,
    ),
    clusteredDensityDiagnostics: sameValue(
      clusteredDensityDiagnostics(baselineEntry.qualityAudit?.diagnostics),
      clusteredDensityDiagnostics(entry.qualityAudit.diagnostics),
    ),
    fifteenMinuteStillContextOnly: entry.fifteenMinuteContext.stillContextOnly,
  };
}

export function buildLevelQualityReviewEntry(
  params: {
    cacheRoot: string;
    provider: CandleProviderName;
    baselineEntry: LevelQualityReviewBaselineEntry;
  },
): LevelQualityReviewRunnerEntry {
  const baselineEntry = params.baselineEntry;
  const fiveMinutePath = resolveCachePath(params.cacheRoot, requireSourceFile(baselineEntry, "5m"));
  const fourHourPath = resolveCachePath(params.cacheRoot, requireSourceFile(baselineEntry, "4h"));
  const dailyPath = resolveCachePath(params.cacheRoot, requireSourceFile(baselineEntry, "daily"));
  const fifteenMinuteSource = baselineEntry.sourceFiles["15m"];
  const candles5m = readCacheCandles(fiveMinutePath);
  const fourHourCandles = readCacheCandles(fourHourPath);
  const dailyCandles = readCacheCandles(dailyPath);
  const candles15m = fifteenMinuteSource
    ? readCacheCandles(resolveCachePath(params.cacheRoot, fifteenMinuteSource))
    : undefined;
  const snapshot = buildLevelAnalysisSnapshotFromCandles({
    symbol: baselineEntry.symbol,
    asOfTimestamp: baselineEntry.asOfTimestamp,
    referencePrice: baselineEntry.referencePrice,
    candles5m,
    ...(candles15m ? { candles15m } : {}),
    fourHourCandles,
    dailyCandles,
    previousClose: baselineEntry.previousClose,
  });
  const candidatePoolDiagnostics = buildCandidatePoolDiagnosticsForReview({
    symbol: baselineEntry.symbol.toUpperCase(),
    asOfTimestamp: baselineEntry.asOfTimestamp,
    referencePrice: snapshot.referencePrice,
    candles5m,
    fourHourCandles,
    dailyCandles,
    levelOutput: snapshot.levelEngineOutput,
  });
  const candidateInventoryVisibility = buildLevelCandidateInventoryReviewVisibility({
    symbol: baselineEntry.symbol,
    provider: params.provider,
    asOfTimestamp: baselineEntry.asOfTimestamp,
    asOfIso: new Date(baselineEntry.asOfTimestamp).toISOString(),
    referencePrice: snapshot.referencePrice,
    sourceFiles: candidateInventorySourceFiles(baselineEntry.sourceFiles),
    candidatePoolDiagnostics,
  });
  const compact = summarizeLevelQualitySnapshot({
    baselineEntry,
    snapshot,
    provider: params.provider,
  });
  const parity = buildParity(baselineEntry, compact);

  return {
    ...compact,
    candidateInventoryVisibility,
    parity,
    mismatches: collectMismatches(parity),
  };
}

function summarizeEntries(entries: LevelQualityReviewRunnerEntry[]) {
  const candidateInventory = candidateInventorySummary(entries);

  return {
    totalSymbols: entries.length,
    nearestSupportParityCount: entries.filter((entry) => entry.parity.nearestSupport).length,
    nearestResistanceParityCount: entries.filter((entry) => entry.parity.nearestResistance).length,
    bucketCountParityCount: entries.filter((entry) => entry.parity.bucketCounts).length,
    extensionCountParityCount: entries.filter((entry) => entry.parity.extensionCounts).length,
    syntheticCountParityCount: entries.filter((entry) => entry.parity.syntheticContinuationMapCount).length,
    syntheticMarkingParityCount: entries.filter((entry) => entry.parity.syntheticContinuationMapMarking).length,
    diagnosticsParityCount: entries.filter((entry) => entry.parity.diagnosticsUnchanged).length,
    diagnosticSemanticsParityCount: entries.filter((entry) => entry.parity.diagnosticSemanticsUnchanged).length,
    enrichmentBreakdownParityCount: entries.filter((entry) => entry.parity.enrichmentBreakdown).length,
    extensionCoverageWarningParityCount: entries.filter((entry) => entry.parity.extensionCoverageWarnings).length,
    clusteredDensityDiagnosticParityCount: entries.filter((entry) => entry.parity.clusteredDensityDiagnostics).length,
    fifteenMinuteContextOnlyCount: entries.filter((entry) => entry.parity.fifteenMinuteStillContextOnly).length,
    densityMetricPresentCount: entries.filter((entry) => entry.qualityAudit.densityMetric?.present === true).length,
    candidateInventoryPresentCount: candidateInventory.presentCount,
    candidateInventoryValidCount: candidateInventory.validCount,
    candidateInventoryCloserUnsurfacedCount: candidateInventory.closerUnsurfacedCount,
    candidateInventorySupportCloserUnsurfacedCount: candidateInventory.supportCloserUnsurfacedCount,
    candidateInventoryResistanceCloserUnsurfacedCount: candidateInventory.resistanceCloserUnsurfacedCount,
    candidateInventoryTruthfulMarketContextCount: candidateInventory.truthfulMarketContextCount,
    candidateInventorySupportTruthfulMarketContextCount: candidateInventory.supportTruthfulMarketContextCount,
    candidateInventoryResistanceTruthfulMarketContextCount: candidateInventory.resistanceTruthfulMarketContextCount,
    candidateInventoryMissingCount: candidateInventory.missingCount,
    mismatchCount: entries.reduce((sum, entry) => sum + entry.mismatches.length, 0),
    prohibitedLanguageHitCount: 0,
  };
}

function renderCandidateInventoryLine(
  wrapper: LevelCandidateInventoryReviewVisibilityWrapper,
): string {
  if (!wrapper.present) {
    return `candidateInventory=present:false; limitations=${wrapper.limitations.join("|")}`;
  }

  return [
    `candidateInventory=present:true`,
    `gap=${wrapper.gapSummary.overall}`,
    `supportCloser=${wrapper.visibility.unsurfacedCloser.support.count}`,
    `resistanceCloser=${wrapper.visibility.unsurfacedCloser.resistance.count}`,
  ].join("; ");
}

export function renderLevelQualityReviewText(result: Omit<LevelQualityReviewRunnerResult, "content">): string {
  const lines = [
    "Level quality review complete",
    `Generated: ${result.generatedAt}`,
    `Provider: ${result.provider}`,
    `Baseline: ${result.baselinePath}`,
    `Symbols: ${result.summary.totalSymbols}`,
    `Nearest support parity: ${result.summary.nearestSupportParityCount}/${result.summary.totalSymbols}`,
    `Nearest resistance parity: ${result.summary.nearestResistanceParityCount}/${result.summary.totalSymbols}`,
    `Bucket count parity: ${result.summary.bucketCountParityCount}/${result.summary.totalSymbols}`,
    `Extension count parity: ${result.summary.extensionCountParityCount}/${result.summary.totalSymbols}`,
    `Synthetic count parity: ${result.summary.syntheticCountParityCount}/${result.summary.totalSymbols}`,
    `Synthetic marking parity: ${result.summary.syntheticMarkingParityCount}/${result.summary.totalSymbols}`,
    `Diagnostics parity: ${result.summary.diagnosticsParityCount}/${result.summary.totalSymbols}`,
    `Diagnostic semantics parity: ${result.summary.diagnosticSemanticsParityCount}/${result.summary.totalSymbols}`,
    `Enrichment breakdown parity: ${result.summary.enrichmentBreakdownParityCount}/${result.summary.totalSymbols}`,
    `Extension warning parity: ${result.summary.extensionCoverageWarningParityCount}/${result.summary.totalSymbols}`,
    `Cluster/density diagnostic parity: ${result.summary.clusteredDensityDiagnosticParityCount}/${result.summary.totalSymbols}`,
    `15m context-only count: ${result.summary.fifteenMinuteContextOnlyCount}/${result.summary.totalSymbols}`,
    `Density metric present count: ${result.summary.densityMetricPresentCount}/${result.summary.totalSymbols}`,
    `Candidate inventory present count: ${result.summary.candidateInventoryPresentCount}/${result.summary.totalSymbols}`,
    `Candidate inventory valid count: ${result.summary.candidateInventoryValidCount}/${result.summary.totalSymbols}`,
    `Candidate inventory missing count: ${result.summary.candidateInventoryMissingCount}/${result.summary.totalSymbols}`,
    `Candidate inventory closer-unsurfaced count: ${result.summary.candidateInventoryCloserUnsurfacedCount}`,
    `Candidate inventory support closer-unsurfaced count: ${result.summary.candidateInventorySupportCloserUnsurfacedCount}`,
    `Candidate inventory resistance closer-unsurfaced count: ${result.summary.candidateInventoryResistanceCloserUnsurfacedCount}`,
    `Candidate inventory overall truthful market-context count: ${result.summary.candidateInventoryTruthfulMarketContextCount}`,
    `Candidate inventory support truthful market-context count: ${result.summary.candidateInventorySupportTruthfulMarketContextCount}`,
    `Candidate inventory resistance truthful market-context count: ${result.summary.candidateInventoryResistanceTruthfulMarketContextCount}`,
    `Mismatch count: ${result.summary.mismatchCount}`,
    `Prohibited-language hits: ${result.summary.prohibitedLanguageHitCount}`,
    "",
    "Entries",
  ];

  for (const entry of result.entries) {
    const densityClassification = entry.qualityAudit.densityMetric?.present === true
      ? entry.qualityAudit.densityMetric.classification
      : "none";
    lines.push(
      `- ${entry.symbol}: mismatches=${entry.mismatches.length === 0 ? "none" : entry.mismatches.join(",")}; density=${densityClassification}; 15mContextOnly=${entry.fifteenMinuteContext.stillContextOnly}; ${renderCandidateInventoryLine(entry.candidateInventoryVisibility)}`,
    );
  }

  return `${lines.join("\n")}\n`;
}

function writeText(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, "utf8");
}

export function runLevelQualityReviewRunner(
  options: LevelQualityReviewRunnerOptions,
): LevelQualityReviewRunnerResult {
  const baseline = loadLevelQualityReviewBaseline(options.baselinePath);
  const entries = baseline.entries.map((baselineEntry) =>
    buildLevelQualityReviewEntry({
      cacheRoot: options.cacheRoot,
      provider: options.provider,
      baselineEntry,
    }),
  );
  const summary = summarizeEntries(entries);
  const resultWithoutContent = {
    schemaVersion: "level-quality-review-process/v1" as const,
    generatedAt: options.generatedAt,
    provider: options.provider,
    cacheRoot: options.cacheRoot,
    baselinePath: options.baselinePath,
    ...(baseline.generatedAt ? { baselineGeneratedAt: baseline.generatedAt } : {}),
    reviewedSymbols: baseline.reviewedSymbols ?? entries.map((entry) => entry.symbol),
    supplied15mSymbols: baseline.supplied15mSymbols ?? entries.filter((entry) => entry.hasSupplied15m).map((entry) => entry.symbol),
    summary,
    entries,
    prohibitedLanguageHits: [] as string[],
    safety: {
      readOnlyCacheReview: true as const,
      rawCandlesWritten: false as const,
      fullSnapshotsWritten: false as const,
      cacheFilesWritten: false as const,
      providerCallsMade: false as const,
      supportResistanceDetectionChanged: false as const,
      levelEngineScoringRankingClusteringChanged: false as const,
      surfacedLevelsChanged: false as const,
      extensionGenerationChanged: false as const,
      fifteenMinuteFedIntoLevelEngine: false as const,
    },
  };
  const hits = collectProhibitedLanguageHits(resultWithoutContent);
  const finalWithoutContent = {
    ...resultWithoutContent,
    summary: {
      ...summary,
      prohibitedLanguageHitCount: hits.length,
    },
    prohibitedLanguageHits: hits,
  };
  const content = renderLevelQualityReviewText(finalWithoutContent);
  const result = {
    ...finalWithoutContent,
    content,
  };

  writeText(options.outJsonPath, `${JSON.stringify(result, null, 2)}\n`);
  writeText(options.outTextPath, content);

  return result;
}

function isDirectRun(): boolean {
  const argvPath = process.argv[1];
  return argvPath !== undefined && fileURLToPath(import.meta.url) === resolve(argvPath);
}

if (isDirectRun()) {
  try {
    const result = runLevelQualityReviewRunner(
      parseLevelQualityReviewRunnerArgs(process.argv.slice(2)),
    );
    process.stdout.write(result.content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}
