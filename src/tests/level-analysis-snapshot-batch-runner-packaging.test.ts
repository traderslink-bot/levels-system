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

import { validateLevelAnalysisSnapshotBatchManifest } from "../lib/analysis/level-analysis-snapshot-batch-manifest.js";
import {
  parseLevelAnalysisSnapshotRealCacheBatchRunnerArgs,
  runLevelAnalysisSnapshotRealCacheBatchRunner,
} from "../scripts/run-level-analysis-snapshot-real-cache-batch.js";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SAMPLE_ROOT = join(REPO_ROOT, "docs/examples/level-analysis-snapshot");

function loadSampleCandles(fileName: string): unknown[] {
  const parsed = JSON.parse(readFileSync(join(SAMPLE_ROOT, fileName), "utf8"));
  assert.equal(Array.isArray(parsed), true);
  return parsed as unknown[];
}

function timestampOf(value: unknown): number {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  const timestamp = (value as { timestamp?: unknown }).timestamp;
  if (typeof timestamp === "number") {
    return timestamp;
  }
  if (typeof timestamp === "string") {
    const parsed = Date.parse(timestamp);
    assert.equal(Number.isFinite(parsed), true);
    return parsed;
  }
  throw new Error("Sample candle timestamp is missing.");
}

function withTempDir<T>(callback: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "level-analysis-real-cache-batch-"));

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
  candles: unknown[];
}): void {
  const lookbackBars = params.candles.length;
  const lastTimestamp = timestampOf(params.candles.at(-1));
  const endTimeMs = params.timeframe === "5m" ? lastTimestamp + 5 * 60_000 : lastTimestamp;
  const dir = join(params.cacheRoot, "stub", params.symbol, params.timeframe);
  const entry = {
    schemaVersion: 1,
    cachedAt: Date.parse("2026-06-01T00:00:00.000Z"),
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
      requestedStartTimestamp: timestampOf(params.candles[0]),
      requestedEndTimestamp: endTimeMs,
      sessionMetadataAvailable: true,
      actualBarsReturned: lookbackBars,
      completenessStatus: "complete",
      stale: false,
      validationIssues: [],
      sessionSummary: null,
    },
  };

  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${lookbackBars}-${endTimeMs}.json`), `${JSON.stringify(entry, null, 2)}\n`, "utf8");
}

function seedFixtureCache(cacheRoot: string, symbol: string, include15m: boolean): void {
  writeCacheEntry({
    cacheRoot,
    symbol,
    timeframe: "5m",
    candles: loadSampleCandles("sample-5m-candles.json"),
  });
  if (include15m) {
    writeCacheEntry({
      cacheRoot,
      symbol,
      timeframe: "15m",
      candles: loadSampleCandles("sample-15m-candles.json"),
    });
  }
  writeCacheEntry({
    cacheRoot,
    symbol,
    timeframe: "4h",
    candles: loadSampleCandles("sample-4h-candles.json"),
  });
  writeCacheEntry({
    cacheRoot,
    symbol,
    timeframe: "daily",
    candles: loadSampleCandles("sample-daily-candles.json"),
  });
}

function collectText(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectText(item, out);
    }
    return out;
  }
  if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value)) {
      collectText(item, out);
    }
  }

  return out;
}

function assertNoProhibitedLanguage(value: unknown): void {
  const text = collectText(value).join("\n").toLowerCase();
  for (const [label, pattern] of [
    ["recommendation", /\brecommendation\b/],
    ["coaching", /\bcoaching\b/],
    ["grading", /\bgrading\b/],
    ["p/l", /\bp\/l\b|\bpnl\b/],
    ["giveback", /\bgiveback\b/],
    ["behavior score", /\bbehavior score\b|\bbehavior scoring\b/],
    ["entry decision", /\bentry decision\b/],
    ["exit decision", /\bexit decision\b/],
    ["trade advice", /\btrade advice\b/],
  ] as const) {
    assert.equal(pattern.test(text), false, `Unexpected ${label} language.`);
  }
}

test("real-cache batch runner parses explicit operator arguments", () => {
  const parsed = parseLevelAnalysisSnapshotRealCacheBatchRunnerArgs([
    "--cache-root",
    "cache",
    "--symbols",
    "snap,tiny,snap",
    "--out-root",
    "artifacts/out",
    "--batch-id",
    "fixture-batch",
    "--generated-at",
    "2026-06-01T00:00:00.000Z",
    "--provider",
    "stub",
  ]);

  assert.deepEqual(parsed.symbols, ["SNAP", "TINY"]);
  assert.equal(parsed.generatedAt, "2026-06-01T00:00:00.000Z");
  assert.equal(parsed.provider, "stub");
});

test("real-cache batch runner generates snapshot artifacts and a validated manifest from fixture cache", () =>
  withTempDir((dir) => {
    const cacheRoot = join(dir, "cache");
    const outRoot = join(dir, "artifacts", "level-analysis-snapshot-real-cache-batch");
    seedFixtureCache(cacheRoot, "SNAP", true);
    seedFixtureCache(cacheRoot, "TINY", false);

    const result = runLevelAnalysisSnapshotRealCacheBatchRunner({
      cacheRoot,
      symbols: ["SNAP", "TINY"],
      outRoot,
      batchId: "fixture-real-cache-batch",
      generatedAt: "2026-06-01T00:00:00.000Z",
      provider: "stub",
    });

    assert.equal(result.artifacts.length, 2);
    assert.equal(existsSync(result.manifestPath), true);
    assert.equal(validateLevelAnalysisSnapshotBatchManifest(result.manifest).valid, true);
    assert.equal(result.manifest.summary.totalEntries, 2);
    assert.equal(result.manifest.summary.acceptedCount, 2);
    assert.equal(result.manifest.summary.with15mInputCount, 1);
    assert.equal(result.manifest.summary.missing15mInputCount, 1);
    assert.equal(result.manifest.safety.noLookaheadAppliedForAccepted, true);
    assert.equal(result.manifest.safety.syntheticExtensionsClearlyMarkedForAccepted, true);
    assert.ok(result.summaryText.includes("Accepted: 2"));
    assert.ok(result.summaryText.includes("Missing 15m input: 1"));

    for (const artifact of result.artifacts) {
      assert.equal(existsSync(artifact.artifactPath), true);
      assert.equal(artifact.snapshot.schemaVersion, "level-analysis-snapshot/v1");
      assert.equal(artifact.snapshot.producer, "levels-system");
      assert.equal(artifact.snapshot.symbol, artifact.symbol);
      assert.equal(artifact.snapshot.safety.noLookaheadApplied, true);
      assert.equal(artifact.snapshot.safety.noRuntimeBehaviorChange, true);
      assert.equal(artifact.snapshot.levelEngineOutput.generatedAt, artifact.asOfTimestamp);
    }

    const snapEntry = result.manifest.entries.find((entry) => entry.symbol === "SNAP");
    const tinyEntry = result.manifest.entries.find((entry) => entry.symbol === "TINY");
    assert.equal(snapEntry?.has15mInput, true);
    assert.equal(snapEntry?.missing15mInput, false);
    assert.equal(tinyEntry?.has15mInput, false);
    assert.equal(tinyEntry?.missing15mInput, true);
    assertNoProhibitedLanguage(result.manifest);
  }));

test("real-cache batch runner requires 5m 4h and daily cached candles", () =>
  withTempDir((dir) => {
    const cacheRoot = join(dir, "cache");
    writeCacheEntry({
      cacheRoot,
      symbol: "MISS",
      timeframe: "5m",
      candles: loadSampleCandles("sample-5m-candles.json"),
    });

    assert.throws(
      () =>
        runLevelAnalysisSnapshotRealCacheBatchRunner({
          cacheRoot,
          symbols: ["MISS"],
          outRoot: join(dir, "artifacts"),
          batchId: "missing-required",
          generatedAt: "2026-06-01T00:00:00.000Z",
          provider: "stub",
        }),
      /Missing required cached candles for MISS 4h/,
    );
  }));

test("package exposes the real-cache batch runner command", () => {
  const packageJson = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };

  assert.equal(
    packageJson.scripts?.["snapshot:level-analysis:batch:real-cache"],
    "tsx src/scripts/run-level-analysis-snapshot-real-cache-batch.ts",
  );
});

test("real-cache batch runner stays isolated from network alert monitoring and trader behavior paths", () => {
  const source = readFileSync(
    fileURLToPath(
      new URL("../scripts/run-level-analysis-snapshot-real-cache-batch.ts", import.meta.url),
    ),
    "utf8",
  );

  for (const blocked of [
    "../alerts/",
    "../monitoring/",
    "../trader-context/",
    "discord",
    "provider-factory",
    "fetch(",
    "trade advice",
  ]) {
    assert.equal(source.toLowerCase().includes(blocked), false, `Unexpected source reference: ${blocked}`);
  }
});
