import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  buildLevelCandidateInventoryReviewVisibility,
  buildMissingCandidateInventoryReviewVisibility,
} from "../lib/levels/level-candidate-inventory-review-adapter.js";
import {
  assertLevelCandidateInventoryReviewVisibilityFactsOnly,
  validateLevelCandidateInventoryReviewVisibilityWrapper,
} from "../lib/levels/level-candidate-inventory-review-wiring.js";
import type {
  LevelCandidatePoolDiagnosticsReport,
  LevelCandidatePoolStage,
  LevelCandidatePoolStageSummary,
} from "../lib/levels/level-candidate-pool-diagnostics.js";
import type { Candle } from "../lib/market-data/candle-types.js";
import {
  buildLevelQualityReviewEntry,
  collectProhibitedLanguageHits,
  runLevelQualityReviewRunner,
  type LevelQualityReviewBaseline,
  type LevelQualityReviewBaselineEntry,
  type LevelQualityReviewRunnerEntry,
} from "../scripts/run-level-quality-review.js";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SAMPLE_ROOT = join(REPO_ROOT, "docs/examples/level-analysis-snapshot");
const GENERATED_AT = "2026-06-02T03:00:00.000Z";
const AS_OF = Date.parse("2026-05-01T10:20:00-04:00");

function sampleCandles(fileName: string): Candle[] {
  return JSON.parse(readFileSync(join(SAMPLE_ROOT, fileName), "utf8")) as Candle[];
}

function timestampOf(candle: Candle): number {
  return typeof candle.timestamp === "number" ? candle.timestamp : Date.parse(candle.timestamp);
}

function withTempDir<T>(callback: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "level-candidate-inventory-review-wiring-"));

  try {
    return callback(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeCacheEntry(params: {
  cacheRoot: string;
  symbol: string;
  timeframe: "5m" | "15m" | "4h" | "daily";
  candles: Candle[];
}): string {
  const lookbackBars = params.candles.length;
  const endTimeMs = params.timeframe === "5m"
    ? timestampOf(params.candles.at(-1)!) + 5 * 60_000
    : timestampOf(params.candles.at(-1)!);
  const relativePath = join(
    "stub",
    params.symbol,
    params.timeframe,
    `${lookbackBars}-${endTimeMs}.json`,
  );
  const absolutePath = join(params.cacheRoot, relativePath);

  mkdirSync(join(params.cacheRoot, "stub", params.symbol, params.timeframe), { recursive: true });
  writeFileSync(
    absolutePath,
    `${JSON.stringify({
      schemaVersion: 1,
      cachedAt: Date.parse(GENERATED_AT),
      request: {
        symbol: params.symbol,
        timeframe: params.timeframe,
        lookbackBars,
        endTimeMs,
        provider: "stub",
      },
      response: {
        provider: "stub",
        symbol: params.symbol,
        timeframe: params.timeframe,
        requestedLookbackBars: lookbackBars,
        candles: params.candles,
        fetchStartTimestamp: endTimeMs - 1,
        fetchEndTimestamp: endTimeMs,
        requestedStartTimestamp: timestampOf(params.candles[0]!),
        requestedEndTimestamp: endTimeMs,
        sessionMetadataAvailable: true,
        actualBarsReturned: lookbackBars,
        completenessStatus: "complete",
        stale: false,
        validationIssues: [],
        sessionSummary: null,
      },
    }, null, 2)}\n`,
    "utf8",
  );

  return relativePath.replaceAll("\\", "/");
}

function seedCache(cacheRoot: string): LevelQualityReviewBaselineEntry {
  return {
    symbol: "SNAP",
    provider: "stub",
    asOfTimestamp: AS_OF,
    asOfIso: new Date(AS_OF).toISOString(),
    referencePrice: 10.68,
    previousClose: 9.1,
    hasSupplied15m: true,
    sourceFiles: {
      "5m": writeCacheEntry({
        cacheRoot,
        symbol: "SNAP",
        timeframe: "5m",
        candles: sampleCandles("sample-5m-candles.json"),
      }),
      "15m": writeCacheEntry({
        cacheRoot,
        symbol: "SNAP",
        timeframe: "15m",
        candles: sampleCandles("sample-15m-candles.json"),
      }),
      "4h": writeCacheEntry({
        cacheRoot,
        symbol: "SNAP",
        timeframe: "4h",
        candles: sampleCandles("sample-4h-candles.json"),
      }),
      daily: writeCacheEntry({
        cacheRoot,
        symbol: "SNAP",
        timeframe: "daily",
        candles: sampleCandles("sample-daily-candles.json"),
      }),
    },
  };
}

function baselineEntryFromReview(entry: LevelQualityReviewRunnerEntry): LevelQualityReviewBaselineEntry {
  return {
    symbol: entry.symbol,
    provider: entry.provider,
    asOfTimestamp: entry.asOfTimestamp,
    asOfIso: entry.asOfIso,
    referencePrice: entry.referencePrice,
    previousClose: entry.previousClose,
    hasSupplied15m: entry.hasSupplied15m,
    sourceFiles: entry.sourceFiles,
    nearestLevels: entry.nearestLevels,
    bucketCounts: entry.bucketCounts,
    extensionCoverage: entry.extensionCoverage,
    syntheticContinuationMap: entry.syntheticContinuationMap,
    qualityAudit: entry.qualityAudit,
    diagnosticSemantics: entry.diagnosticSemantics,
    fifteenMinuteContext: entry.fifteenMinuteContext,
  };
}

function matchingBaseline(cacheRoot: string): LevelQualityReviewBaseline {
  const seed = seedCache(cacheRoot);
  const entry = buildLevelQualityReviewEntry({
    cacheRoot,
    provider: "stub",
    baselineEntry: seed,
  });

  return {
    schemaVersion: "level-quality-review-rerun-after-density-metric/v1",
    generatedAt: "2026-06-01T23:45:00.000Z",
    provider: "stub",
    reviewedSymbols: ["SNAP"],
    supplied15mSymbols: ["SNAP"],
    entries: [baselineEntryFromReview(entry)],
  };
}

function writeJson(dir: string, fileName: string, value: unknown): string {
  const filePath = join(dir, fileName);
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return filePath;
}

function hasRawCandleArray(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        "open" in item &&
        "high" in item &&
        "low" in item &&
        "close" in item &&
        "volume" in item,
    );
  }
  if (typeof value === "object" && value !== null) {
    return Object.values(value).some(hasRawCandleArray);
  }

  return false;
}

function hasFullSnapshotOrCandidateArrays(value: unknown): boolean {
  const text = JSON.stringify(value);
  return [
    "levelEngineOutput",
    "rawCandidates",
    "clusteredSupportZones",
    "clusteredResistanceZones",
    "scoredSupportZones",
    "scoredResistanceZones",
    "closedCandles",
  ].some((key) => text.includes(key));
}

function runPackagedReview(dir: string, baseline: LevelQualityReviewBaseline) {
  const baselinePath = writeJson(dir, "baseline.json", baseline);
  const outJsonPath = join(dir, "review.json");
  const outTextPath = join(dir, "review.txt");

  const result = runLevelQualityReviewRunner({
    cacheRoot: join(dir, "cache"),
    baselinePath,
    outJsonPath,
    outTextPath,
    generatedAt: GENERATED_AT,
    provider: "stub",
  });

  return {
    result,
    parsedJson: JSON.parse(readFileSync(outJsonPath, "utf8")) as unknown,
    outJsonPath,
    outTextPath,
  };
}

function stage(
  stageName: LevelCandidatePoolStage,
  prices: number[],
  referencePrice = 10,
): LevelCandidatePoolStageSummary {
  const below = prices.filter((price) => price < referencePrice);
  const above = prices.filter((price) => price > referencePrice);
  const sorted = [...prices].sort((left, right) => left - right);

  return {
    stage: stageName,
    total: sorted.length,
    prices: sorted,
    byTimeframe: {},
    byTimeframeBias: {},
    bySourceType: {},
    bySourceTypeSet: {},
    depth: {
      referencePrice,
      belowReferenceCount: below.length,
      atReferenceCount: prices.filter((price) => price === referencePrice).length,
      aboveReferenceCount: above.length,
      nearestBelowReference: below.length > 0 ? Math.max(...below) : undefined,
      nearestAboveReference: above.length > 0 ? Math.min(...above) : undefined,
    },
  };
}

function hcpLikeDiagnostics(): LevelCandidatePoolDiagnosticsReport {
  const support = {
    side: "support" as const,
    raw: stage("raw", [8.2, 9.05, 9.8]),
    clustered: stage("clustered", [9.05, 9.8]),
    scored: stage("scored", [9.05, 9.8]),
    surfaced: stage("surfaced", [9.05]),
    extensionCandidates: stage("extension_candidate", [8.2]),
    selectedExtensions: stage("extension_selected", [8.2]),
    narrowing: [],
    warnings: [],
  };
  const resistance = {
    side: "resistance" as const,
    raw: stage("raw", [13.4]),
    clustered: stage("clustered", [13.4]),
    scored: stage("scored", [13.4]),
    surfaced: stage("surfaced", [13.4]),
    extensionCandidates: stage("extension_candidate", []),
    selectedExtensions: stage("extension_selected", []),
    narrowing: [],
    warnings: [],
  };

  return {
    symbol: "GAPVIS",
    referencePrice: 10,
    summary: {
      rawCandidateCount: 4,
      clusteredZoneCount: 3,
      scoredZoneCount: 3,
      surfacedLevelCount: 2,
      extensionCandidateCount: 1,
      selectedExtensionCount: 1,
    },
    surfacedBucketCounts: {
      majorSupport: 0,
      majorResistance: 0,
      intermediateSupport: 0,
      intermediateResistance: 0,
      intradaySupport: 1,
      intradayResistance: 1,
    },
    support,
    resistance,
    narrowing: [],
    diagnostics: ["candidate_pool_diagnostics_only"],
    safety: {
      diagnosticOnly: true,
      levelOutputUnchanged: true,
      extensionGenerationUnchanged: true,
      noRuntimeBehaviorChange: true,
    },
  };
}

function assertNoProhibitedLanguage(value: unknown): void {
  assert.deepEqual(collectProhibitedLanguageHits(value), []);
}

test("packaged review output includes candidateInventoryVisibility wrappers", () =>
  withTempDir((dir) => {
    const baseline = matchingBaseline(join(dir, "cache"));
    const { result, parsedJson, outJsonPath, outTextPath } = runPackagedReview(dir, baseline);
    const entry = result.entries[0]!;

    assert.equal(existsSync(outJsonPath), true);
    assert.equal(existsSync(outTextPath), true);
    assert.equal(entry.candidateInventoryVisibility.present, true);
    assert.equal(
      validateLevelCandidateInventoryReviewVisibilityWrapper(entry.candidateInventoryVisibility).valid,
      true,
    );
    assertLevelCandidateInventoryReviewVisibilityFactsOnly(entry.candidateInventoryVisibility);
    assert.equal(result.summary.candidateInventoryPresentCount, 1);
    assert.equal(result.summary.candidateInventoryValidCount, 1);
    assert.equal(result.summary.candidateInventoryMissingCount, 0);
    assert.match(readFileSync(outTextPath, "utf8"), /candidateInventory=present:true/);
    assert.equal(hasRawCandleArray(parsedJson), false);
    assert.equal(hasFullSnapshotOrCandidateArrays(parsedJson), false);
  }));

test("candidate inventory is excluded from old baseline mismatch counts", () =>
  withTempDir((dir) => {
    const baseline = matchingBaseline(join(dir, "cache"));
    (baseline.entries[0] as unknown as { candidateInventoryVisibility: unknown }).candidateInventoryVisibility = {
      present: false,
      diagnostics: ["candidate_inventory_visibility_not_available"],
      limitations: ["raw_clustered_scored_inventory_not_available"],
    };
    const { result } = runPackagedReview(dir, baseline);

    assert.equal(result.summary.mismatchCount, 0);
    assert.deepEqual(result.entries[0]?.mismatches, []);
    assert.equal(result.summary.nearestSupportParityCount, 1);
    assert.equal(result.summary.bucketCountParityCount, 1);
  }));

test("missing wrapper remains valid when candidate inventory cannot be rebuilt", () => {
  const wrapper = buildMissingCandidateInventoryReviewVisibility();

  assert.equal(wrapper.present, false);
  assert.equal(validateLevelCandidateInventoryReviewVisibilityWrapper(wrapper).valid, true);
  assertLevelCandidateInventoryReviewVisibilityFactsOnly(wrapper);
});

test("HCWB PHOE-like closer-unsurfaced support visibility is representable", () => {
  const wrapper = buildLevelCandidateInventoryReviewVisibility({
    symbol: "GAPVIS",
    provider: "fixture",
    asOfTimestamp: Date.parse(GENERATED_AT),
    asOfIso: GENERATED_AT,
    referencePrice: 10,
    sourceFiles: {
      "5m": "fixture/GAPVIS/5m.json",
      "4h": "fixture/GAPVIS/4h.json",
      daily: "fixture/GAPVIS/daily.json",
    },
    candidatePoolDiagnostics: hcpLikeDiagnostics(),
  });

  assert.equal(wrapper.present, true);
  assert.equal(wrapper.gapSummary.support, "closer_unsurfaced_candidate");
  assert.equal(wrapper.gapSummary.resistance, "truthful_market_context_gap");
  assert.equal(wrapper.visibility.unsurfacedCloser.support.count, 1);
});

test("candidate inventory review wiring output remains facts-only", () =>
  withTempDir((dir) => {
    const baseline = matchingBaseline(join(dir, "cache"));
    const { result, parsedJson } = runPackagedReview(dir, baseline);

    assertNoProhibitedLanguage(result);
    assertNoProhibitedLanguage(parsedJson);
  }));

test("candidate inventory review wiring source avoids provider alert monitoring Discord and journal paths", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../scripts/run-level-quality-review.ts", import.meta.url)),
    "utf8",
  ).toLowerCase();

  for (const blocked of [
    "../alerts/",
    "../monitoring/",
    "../trader-context/",
    "discord",
    "provider-factory",
    "fetch(",
    "trade advice",
    "journal",
  ]) {
    assert.equal(source.includes(blocked), false, `Unexpected source reference: ${blocked}`);
  }
});
