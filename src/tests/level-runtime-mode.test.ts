import assert from "node:assert/strict";
import test from "node:test";

import { CandleFetchService, StubHistoricalCandleProvider } from "../lib/market-data/candle-fetch-service.js";
import { LevelEngine } from "../lib/levels/level-engine.js";
import type { LevelRuntimeComparisonLogEntry } from "../lib/levels/level-runtime-comparison-logger.js";
import { buildNewRuntimeCompatibleLevelOutput } from "../lib/levels/level-runtime-output-adapter.js";
import {
  LEVEL_RUNTIME_COMPARE_ACTIVE_PATH_ENV,
  LEVEL_RUNTIME_MODE_ENV,
  resolveLevelRuntimeCompareActivePath,
  resolveLevelRuntimeMode,
  resolveLevelRuntimeSettings,
} from "../lib/levels/level-runtime-mode.js";
import { buildDefaultSurfacedShadowCases } from "../lib/levels/level-surfaced-shadow-evaluation.js";
import { normalizeOldPathOutput } from "../lib/levels/level-ranking-comparison.js";
import type { CandleTimeframe } from "../lib/market-data/candle-types.js";
import type { LevelEngineOutput } from "../lib/levels/level-types.js";

async function fetchCandlesByTimeframe(
  symbol: string,
): Promise<Record<CandleTimeframe, Awaited<ReturnType<CandleFetchService["fetchCandles"]>>>> {
  const service = new CandleFetchService(new StubHistoricalCandleProvider());
  const [daily, fourHour, fiveMinute] = await Promise.all([
    service.fetchCandles({ symbol, timeframe: "daily", lookbackBars: 220 }),
    service.fetchCandles({ symbol, timeframe: "4h", lookbackBars: 180 }),
    service.fetchCandles({ symbol, timeframe: "5m", lookbackBars: 100 }),
  ]);

  return {
    daily,
    "4h": fourHour,
    "5m": fiveMinute,
  };
}

function flattenOutput(output: LevelEngineOutput): string[] {
  return [
    ...output.majorSupport,
    ...output.intermediateSupport,
    ...output.intradaySupport,
    ...output.majorResistance,
    ...output.intermediateResistance,
    ...output.intradayResistance,
    ...output.extensionLevels.support,
    ...output.extensionLevels.resistance,
  ].map((zone) => `${zone.kind}:${zone.representativePrice.toFixed(4)}:${zone.strengthLabel}`);
}

function buildRequest(symbol: string) {
  return {
    symbol,
    historicalRequests: {
      daily: { symbol, timeframe: "daily" as const, lookbackBars: 220 },
      "4h": { symbol, timeframe: "4h" as const, lookbackBars: 180 },
      "5m": { symbol, timeframe: "5m" as const, lookbackBars: 100 },
    },
  };
}

test("mode resolution defaults to old and falls back safely on invalid values", () => {
  assert.equal(resolveLevelRuntimeMode(undefined), "old");
  assert.equal(resolveLevelRuntimeMode("new"), "new");
  assert.equal(resolveLevelRuntimeMode("compare"), "compare");
  assert.equal(resolveLevelRuntimeMode("weird"), "old");
  assert.equal(resolveLevelRuntimeCompareActivePath(undefined), "old");
  assert.equal(resolveLevelRuntimeCompareActivePath("new"), "new");
  assert.equal(resolveLevelRuntimeCompareActivePath("bad"), "old");

  const settings = resolveLevelRuntimeSettings({
    [LEVEL_RUNTIME_MODE_ENV]: "compare",
    [LEVEL_RUNTIME_COMPARE_ACTIVE_PATH_ENV]: "new",
  });
  assert.equal(settings.mode, "compare");
  assert.equal(settings.compareActivePath, "new");
  assert.equal(settings.compareLoggingEnabled, true);
});

test("old mode behavior is preserved when runtime mode remains old", async () => {
  const service = new CandleFetchService(new StubHistoricalCandleProvider());
  const defaultEngine = new LevelEngine(service);
  const explicitOldEngine = new LevelEngine(service, undefined, {
    runtimeMode: "old",
  });

  const [defaultOutput, explicitOldOutput] = await Promise.all([
    defaultEngine.generateLevels(buildRequest("AAPL")),
    explicitOldEngine.generateLevels(buildRequest("AAPL")),
  ]);

  assert.deepEqual(flattenOutput(defaultOutput), flattenOutput(explicitOldOutput));
  assert.deepEqual(defaultOutput.metadata, explicitOldOutput.metadata);
});

test("new mode maps the surfaced adapter back into the runtime-compatible output shape", async () => {
  const brokenCase = buildDefaultSurfacedShadowCases().find(
    (shadowCase) => shadowCase.caseId === "broken-level-exclusion",
  );
  assert.ok(brokenCase);

  const candlesByTimeframe = await fetchCandlesByTimeframe(brokenCase.symbol);
  const projection = buildNewRuntimeCompatibleLevelOutput({
    symbol: brokenCase.symbol,
    rawCandidates: brokenCase.rawCandidates ?? [],
    levelCandidates: brokenCase.newCandidates,
    candlesByTimeframe: {
      daily: candlesByTimeframe.daily.candles,
      "4h": candlesByTimeframe["4h"].candles,
      "5m": candlesByTimeframe["5m"].candles,
    },
    metadata: {
      providerByTimeframe: {
        daily: "stub",
        "4h": "stub",
        "5m": "stub",
      },
      dataQualityFlags: [],
      freshness: "fresh",
      referencePrice: brokenCase.currentPrice,
    },
    specialLevels: {},
  });

  assert.equal(projection.output.symbol, brokenCase.symbol);
  assert.ok(Array.isArray(projection.output.majorSupport));
  assert.ok(Array.isArray(projection.output.majorResistance));
  assert.ok(Array.isArray(projection.output.extensionLevels.support));
  assert.ok(Array.isArray(projection.output.extensionLevels.resistance));

  const supportPrices = [
    ...projection.output.majorSupport,
    ...projection.output.intermediateSupport,
    ...projection.output.intradaySupport,
    ...projection.output.extensionLevels.support,
  ].map((zone) => zone.representativePrice.toFixed(2));

  assert.ok(!supportPrices.includes("7.96"));
});

test("compare mode keeps one active path, computes the alternate path, and emits a comparison log payload", async () => {
  const service = new CandleFetchService(new StubHistoricalCandleProvider());
  const compareLogs: LevelRuntimeComparisonLogEntry[] = [];
  const oldEngine = new LevelEngine(service, undefined, {
    runtimeMode: "old",
  });
  const compareEngine = new LevelEngine(service, undefined, {
    runtimeMode: "compare",
    compareActivePath: "old",
    onComparisonLog: (entry) => {
      compareLogs.push(entry);
    },
  });

  const [oldOutput, compareOutput] = await Promise.all([
    oldEngine.generateLevels(buildRequest("MSFT")),
    compareEngine.generateLevels(buildRequest("MSFT")),
  ]);

  assert.deepEqual(flattenOutput(oldOutput), flattenOutput(compareOutput));
  assert.equal(compareLogs.length, 1);
  assert.equal(compareLogs[0]?.activePath, "old");
  assert.equal(compareLogs[0]?.alternatePath, "new");
});

test("compare mode can keep the new path active while logging the old path observationally", async () => {
  const service = new CandleFetchService(new StubHistoricalCandleProvider());
  const compareLogs: LevelRuntimeComparisonLogEntry[] = [];
  const newEngine = new LevelEngine(service, undefined, {
    runtimeMode: "new",
  });
  const compareEngine = new LevelEngine(service, undefined, {
    runtimeMode: "compare",
    compareActivePath: "new",
    onComparisonLog: (entry) => {
      compareLogs.push(entry);
    },
  });

  const [newOutput, compareOutput] = await Promise.all([
    newEngine.generateLevels(buildRequest("NVDA")),
    compareEngine.generateLevels(buildRequest("NVDA")),
  ]);

  assert.deepEqual(flattenOutput(newOutput), flattenOutput(compareOutput));
  assert.equal(compareLogs.length, 1);
  assert.equal(compareLogs[0]?.activePath, "new");
  assert.equal(compareLogs[0]?.alternatePath, "old");
});

test("rollback to old mode is config-only and deterministic", async () => {
  const service = new CandleFetchService(new StubHistoricalCandleProvider());
  const newEngine = new LevelEngine(service, undefined, {
    runtimeMode: "new",
  });
  const oldEngine = new LevelEngine(service, undefined, {
    runtimeMode: "old",
  });
  const fallbackEngine = new LevelEngine(service, undefined, {
    runtimeMode: resolveLevelRuntimeMode("invalid"),
  });

  const [newOutput, oldOutput, fallbackOutput] = await Promise.all([
    newEngine.generateLevels(buildRequest("TSLA")),
    oldEngine.generateLevels(buildRequest("TSLA")),
    fallbackEngine.generateLevels(buildRequest("TSLA")),
  ]);

  assert.notDeepEqual(flattenOutput(newOutput), flattenOutput(oldOutput));
  assert.deepEqual(flattenOutput(oldOutput), flattenOutput(fallbackOutput));
  assert.deepEqual(
    normalizeOldPathOutput(oldOutput, oldOutput.metadata.referencePrice ?? 0, 8),
    normalizeOldPathOutput(fallbackOutput, fallbackOutput.metadata.referencePrice ?? 0, 8),
  );
});
