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

import { buildLevelAnalysisSnapshotFromCandles } from "../lib/analysis/level-analysis-snapshot-from-candles.js";
import { buildMissingCandidateInventoryReviewVisibility } from "../lib/levels/level-candidate-inventory-review-adapter.js";
import {
  assertLevelCandidateVolumeSessionContextFactsOnly,
  validateLevelCandidateVolumeSessionContext,
} from "../lib/levels/level-candidate-volume-session-context.js";
import type { Candle } from "../lib/market-data/candle-types.js";
import {
  buildCandidateVolumeSessionContextForReview,
  buildLevelQualityReviewEntry,
  collectProhibitedLanguageHits,
  runLevelQualityReviewRunner,
  type LevelQualityReviewBaseline,
  type LevelQualityReviewBaselineEntry,
  type LevelQualityReviewRunnerEntry,
} from "../scripts/run-level-quality-review.js";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SAMPLE_ROOT = join(REPO_ROOT, "docs/examples/level-analysis-snapshot");
const GENERATED_AT = "2026-06-02T04:00:00.000Z";
const AS_OF = Date.parse("2026-05-01T10:20:00-04:00");

function sampleCandles(fileName: string): Candle[] {
  return JSON.parse(readFileSync(join(SAMPLE_ROOT, fileName), "utf8")) as Candle[];
}

function timestampOf(candle: Candle): number {
  return typeof candle.timestamp === "number" ? candle.timestamp : Date.parse(candle.timestamp);
}

function withTempDir<T>(callback: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "level-volume-session-review-wiring-"));

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
    schemaVersion: "level-candidate-inventory-review-wiring/v1",
    generatedAt: "2026-06-02T03:45:00.000Z",
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

function assertNoProhibitedLanguage(value: unknown): void {
  assert.deepEqual(collectProhibitedLanguageHits(value), []);
}

test("packaged review output includes candidateVolumeSessionContext", () =>
  withTempDir((dir) => {
    const baseline = matchingBaseline(join(dir, "cache"));
    const { result, parsedJson, outJsonPath, outTextPath } = runPackagedReview(dir, baseline);
    const entry = result.entries[0]!;
    const context = entry.candidateVolumeSessionContext;

    assert.equal(existsSync(outJsonPath), true);
    assert.equal(existsSync(outTextPath), true);
    assert.equal(validateLevelCandidateVolumeSessionContext(context).valid, true);
    assertLevelCandidateVolumeSessionContextFactsOnly(context);
    assert.equal(result.summary.candidateVolumeSessionContextPresentCount, 1);
    assert.equal(result.summary.candidateVolumeSessionContextValidCount, 1);
    assert.equal(result.summary.candidateVolumeSessionContextMissingCount, 0);
    assert.equal(result.summary.candidateInventoryPresentCount, 1);
    assert.equal(result.summary.candidateInventoryValidCount, 1);
    assert.equal(result.summary.mismatchCount, 0);
    assert.match(readFileSync(outTextPath, "utf8"), /Candidate volume\/session context present count/);
    assert.match(readFileSync(outTextPath, "utf8"), /volumeSessionRows=/);
    assert.equal(hasRawCandleArray(parsedJson), false);
    assert.equal(hasFullSnapshotOrCandidateArrays(parsedJson), false);
  }));

test("candidate volume session context is excluded from old baseline mismatch counts", () =>
  withTempDir((dir) => {
    const baseline = matchingBaseline(join(dir, "cache"));
    (baseline.entries[0] as unknown as { candidateVolumeSessionContext: unknown }).candidateVolumeSessionContext = {
      present: false,
      diagnostics: ["candidate_volume_session_context_not_compared_to_old_baseline"],
    };
    const { result } = runPackagedReview(dir, baseline);

    assert.equal(result.summary.mismatchCount, 0);
    assert.deepEqual(result.entries[0]?.mismatches, []);
    assert.equal(result.summary.candidateInventoryPresentCount, 1);
    assert.equal(result.summary.candidateVolumeSessionContextValidCount, 1);
  }));

test("candidate volume session context reports safe unavailable row context", () => {
  const candles5m = sampleCandles("sample-5m-candles.json");
  const snapshot = buildLevelAnalysisSnapshotFromCandles({
    symbol: "SNAP",
    asOfTimestamp: AS_OF,
    referencePrice: 10.68,
    candles5m,
    candles15m: sampleCandles("sample-15m-candles.json"),
    fourHourCandles: sampleCandles("sample-4h-candles.json"),
    dailyCandles: sampleCandles("sample-daily-candles.json"),
    previousClose: 9.1,
  });
  const context = buildCandidateVolumeSessionContextForReview({
    symbol: "SNAP",
    provider: "stub",
    asOfTimestamp: AS_OF,
    asOfIso: new Date(AS_OF).toISOString(),
    referencePrice: 10.68,
    snapshot,
    candidateInventoryVisibility: buildMissingCandidateInventoryReviewVisibility(),
  });

  assert.equal(validateLevelCandidateVolumeSessionContext(context).valid, true);
  assertLevelCandidateVolumeSessionContextFactsOnly(context);
  assert.equal(context.contexts.length, 0);
  assert.equal(context.safety.noLevelSelectionChange, true);
  assert.equal(context.safety.volumeSessionFactsUsedForScoringOrSurfacedSelection, false);
  assert(context.diagnostics.includes("candidate_inventory_visibility_not_available"));
});

test("candidate volume session review wiring output remains facts-only", () =>
  withTempDir((dir) => {
    const baseline = matchingBaseline(join(dir, "cache"));
    const { result, parsedJson } = runPackagedReview(dir, baseline);

    assertNoProhibitedLanguage(result);
    assertNoProhibitedLanguage(parsedJson);
  }));

test("candidate volume session review wiring keeps 15m context-only", () =>
  withTempDir((dir) => {
    const baseline = matchingBaseline(join(dir, "cache"));
    const { result } = runPackagedReview(dir, baseline);
    const entry = result.entries[0]!;

    assert.equal(entry.fifteenMinuteContext.inputProvided, true);
    assert.equal(entry.fifteenMinuteContext.stillContextOnly, true);
    assert.equal(result.summary.fifteenMinuteContextOnlyCount, 1);
    assert.equal(entry.candidateVolumeSessionContext.safety.fifteenMinuteFedIntoLevelEngine, false);
  }));

test("candidate volume session review wiring source avoids provider alert monitoring Discord and journal paths", () => {
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
