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
  buildLevelQualityReviewCacheFingerprint,
} from "../lib/analysis/level-quality-review-cache-fingerprint-builder.js";
import {
  assertLevelQualityReviewCacheFingerprintFactsOnly,
  summarizeLevelQualityReviewCacheFingerprints,
  validateLevelQualityReviewCacheFingerprintSet,
  type LevelQualityReviewCacheFingerprintSet,
} from "../lib/analysis/level-quality-review-cache-fingerprint.js";
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
const GENERATED_AT = "2026-06-06T12:00:00.000Z";
const AS_OF = Date.parse("2026-05-01T10:20:00-04:00");

function sampleCandles(fileName: string): Candle[] {
  return JSON.parse(readFileSync(join(SAMPLE_ROOT, fileName), "utf8")) as Candle[];
}

function timestampOf(candle: Candle): number {
  return typeof candle.timestamp === "number" ? candle.timestamp : Date.parse(candle.timestamp);
}

function withTempDir<T>(callback: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "level-quality-review-cache-fingerprint-wiring-"));

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
  cachedAtOffset?: number;
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
    cachedAt: Date.parse(GENERATED_AT) + (params.cachedAtOffset ?? 0),
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

function seedCache(cacheRoot: string, cachedAtOffset = 0): LevelQualityReviewBaselineEntry {
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
        cachedAtOffset,
      }),
      "15m": writeCacheEntry({
        cacheRoot,
        symbol: "SNAP",
        timeframe: "15m",
        candles: sampleCandles("sample-15m-candles.json"),
        cachedAtOffset,
      }),
      "4h": writeCacheEntry({
        cacheRoot,
        symbol: "SNAP",
        timeframe: "4h",
        candles: sampleCandles("sample-4h-candles.json"),
        cachedAtOffset,
      }),
      daily: writeCacheEntry({
        cacheRoot,
        symbol: "SNAP",
        timeframe: "daily",
        candles: sampleCandles("sample-daily-candles.json"),
        cachedAtOffset,
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
    schemaVersion: "level-quality-review-cache-fingerprint-wiring-test/v1",
    generatedAt: "2026-06-06T11:55:00.000Z",
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

function containsAnyKey(value: unknown, keys: readonly string[]): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => containsAnyKey(item, keys));
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).some(([key, child]) => keys.includes(key) || containsAnyKey(child, keys));
  }

  return false;
}

function assertNoProhibitedLanguage(value: unknown): void {
  const text = JSON.stringify(value).toLowerCase();
  for (const [label, pattern] of [
    ["buy", /\bbuy\b/],
    ["sell", /\bsell\b/],
    ["hold", /\bhold\b/],
    ["recommendation", /\brecommendation\b/],
    ["trade advice", /\btrade\s+advice\b/],
    ["grade", /\bgrade\b|\bgrading\b/],
    ["coaching", /\bcoaching\b|\bcoach\b/],
    ["p/l", /\bp\/l\b|\bpnl\b/],
    ["giveback", /\bgiveback\b/],
    ["behavior score", /\bbehavior score\b|\bbehavior scoring\b/],
    ["good trade", /\bgood trade\b/],
    ["bad trade", /\bbad trade\b/],
    ["should have", /\bshould have\b/],
    ["mistake", /\bmistake\b/],
    ["discipline", /\bdiscipline\b/],
  ] as const) {
    assert.equal(pattern.test(text), false, `Unexpected ${label} wording`);
  }
}

test("packaged review output includes a valid cache fingerprint set", () =>
  withTempDir((dir) => {
    const cacheRoot = join(dir, "cache");
    const baseline = matchingBaseline(cacheRoot);
    const baselinePath = writeJson(dir, "baseline.json", baseline);
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
    assert.equal(validateLevelQualityReviewCacheFingerprintSet(result.cacheFingerprintSet).valid, true);
    assertLevelQualityReviewCacheFingerprintFactsOnly(result.cacheFingerprintSet);
    assert.deepEqual(
      result.cacheFingerprintSummary,
      summarizeLevelQualityReviewCacheFingerprints(result.cacheFingerprintSet),
    );
    assert.equal(result.cacheFingerprintSet.fingerprints.length, 4);
    assert.equal(result.summary.cacheFingerprintCount, 4);
    assert.equal(result.summary.cacheFingerprintSymbolCount, 1);
    assert.equal(result.summary.cacheFingerprintLevelEngineInputCount, 3);
    assert.equal(result.summary.cacheFingerprintContextOnlyCount, 1);
    assert.equal(result.summary.cacheFingerprintFifteenMinuteContextOnlyCount, 1);
    assert.equal(result.summary.mismatchCount, 0);
    assert.match(readFileSync(outTextPath, "utf8"), /Cache fingerprint count: 4/);
  }));

test("cache fingerprint output is compact and contains no raw candles wrappers or snapshots", () =>
  withTempDir((dir) => {
    const cacheRoot = join(dir, "cache");
    const baseline = matchingBaseline(cacheRoot);
    const result = runLevelQualityReviewRunner({
      cacheRoot,
      baselinePath: writeJson(dir, "baseline.json", baseline),
      outJsonPath: join(dir, "review.json"),
      outTextPath: join(dir, "review.txt"),
      generatedAt: GENERATED_AT,
      provider: "stub",
    });

    assert.equal(hasRawCandleArray(result.cacheFingerprintSet), false);
    assert.equal(
      containsAnyKey(result.cacheFingerprintSet, [
        "candles",
        "request",
        "response",
        "cacheWrapper",
        "rawCacheWrapper",
        "rawCacheWrapperPayload",
        "fullSnapshot",
        "levelAnalysisSnapshot",
        "levelEngineOutput",
      ]),
      false,
    );
  }));

test("15m fingerprints remain context-only and outside LevelEngine input", () =>
  withTempDir((dir) => {
    const cacheRoot = join(dir, "cache");
    const baseline = matchingBaseline(cacheRoot);
    const result = runLevelQualityReviewRunner({
      cacheRoot,
      baselinePath: writeJson(dir, "baseline.json", baseline),
      outJsonPath: join(dir, "review.json"),
      outTextPath: join(dir, "review.txt"),
      generatedAt: GENERATED_AT,
      provider: "stub",
    });
    const fifteenMinute = result.cacheFingerprintSet.fingerprints.find((fingerprint) => fingerprint.timeframe === "15m");

    assert(fifteenMinute);
    assert.equal(fifteenMinute.contextOnly, true);
    assert.equal(fifteenMinute.includedInLevelEngine, false);
    assert.equal(fifteenMinute.safety.fifteenMinuteFedIntoLevelEngine, false);
    assert.equal(result.summary.fifteenMinuteContextOnlyCount, 1);
  }));

test("fingerprint-only wrapper differences do not count as level quality mismatches", () =>
  withTempDir((dir) => {
    const cacheRoot = join(dir, "cache");
    const baseline = matchingBaseline(cacheRoot);
    const firstResult = runLevelQualityReviewRunner({
      cacheRoot,
      baselinePath: writeJson(dir, "baseline.json", baseline),
      outJsonPath: join(dir, "review-1.json"),
      outTextPath: join(dir, "review-1.txt"),
      generatedAt: GENERATED_AT,
      provider: "stub",
    });
    seedCache(cacheRoot, 1);
    const secondResult = runLevelQualityReviewRunner({
      cacheRoot,
      baselinePath: writeJson(dir, "baseline-2.json", baseline),
      outJsonPath: join(dir, "review-2.json"),
      outTextPath: join(dir, "review-2.txt"),
      generatedAt: GENERATED_AT,
      provider: "stub",
    });

    assert.equal(firstResult.summary.mismatchCount, 0);
    assert.equal(secondResult.summary.mismatchCount, 0);
    assert.deepEqual(secondResult.entries[0]?.nearestLevels, firstResult.entries[0]?.nearestLevels);
    assert.notDeepEqual(
      secondResult.cacheFingerprintSet.fingerprints.map((fingerprint) => fingerprint.sha256),
      firstResult.cacheFingerprintSet.fingerprints.map((fingerprint) => fingerprint.sha256),
    );
  }));

test("cache fingerprint builder does not mutate parsed wrapper inputs", () =>
  withTempDir((dir) => {
    const cacheRoot = join(dir, "cache");
    const seed = seedCache(cacheRoot);
    const source = seed.sourceFiles["5m"];
    assert(source);
    const rawCacheWrapper = readFileSync(join(cacheRoot, source), "utf8");
    const parsedCacheWrapper = JSON.parse(rawCacheWrapper);
    const before = structuredClone(parsedCacheWrapper);

    const fingerprint = buildLevelQualityReviewCacheFingerprint({
      relativePath: source,
      rawCacheWrapper,
      parsedCacheWrapper,
      provider: "stub",
      symbol: "SNAP",
      timeframe: "5m",
      asOfTimestamp: AS_OF,
      includedInLevelEngine: true,
      contextOnly: false,
    });

    assert.equal(fingerprint.timeframe, "5m");
    assert.deepEqual(parsedCacheWrapper, before);
  }));

test("cache fingerprint wiring remains facts-only", () =>
  withTempDir((dir) => {
    const cacheRoot = join(dir, "cache");
    const baseline = matchingBaseline(cacheRoot);
    const result = runLevelQualityReviewRunner({
      cacheRoot,
      baselinePath: writeJson(dir, "baseline.json", baseline),
      outJsonPath: join(dir, "review.json"),
      outTextPath: join(dir, "review.txt"),
      generatedAt: GENERATED_AT,
      provider: "stub",
    });

    assert.deepEqual(collectProhibitedLanguageHits(result), []);
    assertNoProhibitedLanguage(result.cacheFingerprintSet);
  }));

test("cache fingerprint wiring source stays isolated from providers cache writes alert monitoring Discord and journal paths", () => {
  const builderSource = readFileSync(
    fileURLToPath(new URL("../lib/analysis/level-quality-review-cache-fingerprint-builder.ts", import.meta.url)),
    "utf8",
  ).toLowerCase();

  for (const blocked of [
    "../alerts/",
    "../monitoring/",
    "../trader-context/",
    "provider-factory",
    "fetch(",
    "writefile",
    "discord",
    "journal",
  ]) {
    assert.equal(builderSource.includes(blocked), false, `Unexpected source reference: ${blocked}`);
  }
});
