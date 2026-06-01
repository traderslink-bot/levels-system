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

import type { Candle } from "../lib/market-data/candle-types.js";
import {
  buildLevelQualityReviewEntry,
  collectProhibitedLanguageHits,
  parseLevelQualityReviewRunnerArgs,
  runLevelQualityReviewRunner,
  type LevelQualityReviewBaseline,
  type LevelQualityReviewBaselineEntry,
  type LevelQualityReviewRunnerEntry,
} from "../scripts/run-level-quality-review.js";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SAMPLE_ROOT = join(REPO_ROOT, "docs/examples/level-analysis-snapshot");
const GENERATED_AT = "2026-06-01T22:45:00.000Z";
const AS_OF = Date.parse("2026-05-01T10:20:00-04:00");

function sampleCandles(fileName: string): Candle[] {
  return JSON.parse(readFileSync(join(SAMPLE_ROOT, fileName), "utf8")) as Candle[];
}

function timestampOf(candle: Candle): number {
  return typeof candle.timestamp === "number" ? candle.timestamp : Date.parse(candle.timestamp);
}

function withTempDir<T>(callback: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "level-quality-review-process-"));

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
  const wrapper = {
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
  };

  mkdirSync(join(params.cacheRoot, "stub", params.symbol, params.timeframe), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(wrapper, null, 2)}\n`, "utf8");
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

function writeJson(dir: string, fileName: string, value: unknown): string {
  const filePath = join(dir, fileName);
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return filePath;
}

function writeBaseline(dir: string, baseline: LevelQualityReviewBaseline): string {
  return writeJson(dir, "baseline.json", baseline);
}

function matchingBaseline(cacheRoot: string): LevelQualityReviewBaseline {
  const seed = seedCache(cacheRoot);
  const entry = buildLevelQualityReviewEntry({
    cacheRoot,
    provider: "stub",
    baselineEntry: seed,
  });

  return {
    schemaVersion: "level-engine-quality-review-rerun-after-fixture-packs/v1",
    generatedAt: "2026-06-01T21:45:00.000Z",
    provider: "stub",
    reviewedSymbols: ["SNAP"],
    supplied15mSymbols: ["SNAP"],
    entries: [baselineEntryFromReview(entry)],
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

test("parses level quality review process CLI options", () => {
  assert.deepEqual(
    parseLevelQualityReviewRunnerArgs([
      "--cache-root",
      "cache",
      "--baseline",
      "baseline.json",
      "--out-json",
      "out.json",
      "--out-text",
      "out.txt",
      "--generated-at",
      GENERATED_AT,
      "--provider",
      "stub",
    ]),
    {
      cacheRoot: "cache",
      baselinePath: "baseline.json",
      outJsonPath: "out.json",
      outTextPath: "out.txt",
      generatedAt: GENERATED_AT,
      provider: "stub",
    },
  );
});

test("review process writes compact JSON and text with baseline parity", () =>
  withTempDir((dir) => {
    const cacheRoot = join(dir, "cache");
    const baseline = matchingBaseline(cacheRoot);
    const baselinePath = writeBaseline(dir, baseline);
    const outJsonPath = join(dir, "review.json");
    const outTextPath = join(dir, "review.txt");

    const result = runLevelQualityReviewRunner({
      cacheRoot,
      baselinePath,
      outJsonPath,
      outTextPath,
      generatedAt: GENERATED_AT,
      provider: "stub",
    });

    assert.equal(existsSync(outJsonPath), true);
    assert.equal(existsSync(outTextPath), true);
    assert.equal(result.schemaVersion, "level-quality-review-process/v1");
    assert.equal(result.summary.totalSymbols, 1);
    assert.equal(result.summary.nearestSupportParityCount, 1);
    assert.equal(result.summary.nearestResistanceParityCount, 1);
    assert.equal(result.summary.bucketCountParityCount, 1);
    assert.equal(result.summary.extensionCountParityCount, 1);
    assert.equal(result.summary.diagnosticsParityCount, 1);
    assert.equal(result.summary.diagnosticSemanticsParityCount, 1);
    assert.equal(result.summary.enrichmentBreakdownParityCount, 1);
    assert.equal(result.summary.mismatchCount, 0);
    assert.equal(result.summary.prohibitedLanguageHitCount, 0);
    assert.equal(result.safety.cacheFilesWritten, false);
    assert.equal(result.safety.providerCallsMade, false);
    assert.equal(result.safety.fullSnapshotsWritten, false);
    assert.equal(hasRawCandleArray(JSON.parse(readFileSync(outJsonPath, "utf8"))), false);
    assert.match(readFileSync(outTextPath, "utf8"), /Level quality review complete/);
    assert.deepEqual(collectProhibitedLanguageHits(result), []);
  }));

test("review process reports compact mismatches when baseline fields change", () =>
  withTempDir((dir) => {
    const cacheRoot = join(dir, "cache");
    const baseline = matchingBaseline(cacheRoot);
    const support = baseline.entries[0]?.nearestLevels?.support;
    assert.ok(support);
    support.price = support.price + 0.25;
    const baselinePath = writeBaseline(dir, baseline);

    const result = runLevelQualityReviewRunner({
      cacheRoot,
      baselinePath,
      outJsonPath: join(dir, "review.json"),
      outTextPath: join(dir, "review.txt"),
      generatedAt: GENERATED_AT,
      provider: "stub",
    });

    assert.equal(result.summary.nearestSupportParityCount, 0);
    assert.equal(result.entries[0]?.parity.nearestSupport, false);
    assert.deepEqual(result.entries[0]?.mismatches, ["nearestSupport"]);
    assert.equal(result.summary.mismatchCount, 1);
  }));

test("package exposes the level quality review process command", () => {
  const packageJson = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };

  assert.equal(
    packageJson.scripts?.["review:level-quality"],
    "tsx src/scripts/run-level-quality-review.ts",
  );
});

test("review process source stays isolated from provider alert monitoring and journal paths", () => {
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
  ]) {
    assert.equal(source.includes(blocked), false, `Unexpected source reference: ${blocked}`);
  }
});
