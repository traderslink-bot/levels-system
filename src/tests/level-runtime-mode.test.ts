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
import { LevelStore } from "../lib/monitoring/level-store.js";
import type { FinalLevelZone, LevelEngineOutput } from "../lib/levels/level-types.js";

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

const FIXED_PARITY_FIXTURE_END_TIMESTAMP = Date.parse("2026-05-01T20:00:00.000Z");

const LEVEL_OUTPUT_ARRAY_KEYS = [
  "majorSupport",
  "majorResistance",
  "intermediateSupport",
  "intermediateResistance",
  "intradaySupport",
  "intradayResistance",
] as const;

const LEVEL_OUTPUT_TOP_LEVEL_KEYS = [
  "extensionLevels",
  "generatedAt",
  "intradayResistance",
  "intradaySupport",
  "intermediateResistance",
  "intermediateSupport",
  "majorResistance",
  "majorSupport",
  "metadata",
  "specialLevels",
  "symbol",
] as const;

const FINAL_LEVEL_ZONE_REQUIRED_KEYS = [
  "confluenceCount",
  "firstTimestamp",
  "followThroughScore",
  "freshness",
  "id",
  "isExtension",
  "kind",
  "lastTimestamp",
  "notes",
  "reactionQualityScore",
  "rejectionScore",
  "representativePrice",
  "sourceEvidenceCount",
  "sourceTypes",
  "strengthLabel",
  "strengthScore",
  "symbol",
  "timeframeBias",
  "timeframeSources",
  "touchCount",
  "zoneHigh",
  "zoneLow",
] as const;

const APPROVED_PARITY_GAP_CODES = new Set([
  "bucket_count_mismatch",
  "extension_ladder_gap",
  "nearest_support_gap",
  "nearest_resistance_gap",
]);

type ApprovedParityGapCode =
  | "bucket_count_mismatch"
  | "extension_ladder_gap"
  | "nearest_support_gap"
  | "nearest_resistance_gap";

type RuntimeBucketCountSummary = {
  major: number;
  intermediate: number;
  intraday: number;
  extension: number;
  extensionSupport: number;
  extensionResistance: number;
};

type RuntimeNearestSummary = {
  oldPrice: number | null;
  newPrice: number | null;
  distancePct: number | null;
};

type RuntimeParityReport = {
  bucketCounts: {
    old: RuntimeBucketCountSummary;
    new: RuntimeBucketCountSummary;
  };
  nearest: {
    support: RuntimeNearestSummary;
    resistance: RuntimeNearestSummary;
  };
  specialLevelsMatch: boolean;
  approvedGaps: Array<{
    code: ApprovedParityGapCode;
    detail: string;
  }>;
};

function buildFixedRequest(symbol: string, endTimeMs = FIXED_PARITY_FIXTURE_END_TIMESTAMP) {
  return {
    symbol,
    historicalRequests: {
      daily: { symbol, timeframe: "daily" as const, lookbackBars: 260, endTimeMs },
      "4h": { symbol, timeframe: "4h" as const, lookbackBars: 220, endTimeMs },
      "5m": { symbol, timeframe: "5m" as const, lookbackBars: 140, endTimeMs },
    },
  };
}

function allRuntimeZones(output: LevelEngineOutput): FinalLevelZone[] {
  return [
    ...output.majorSupport,
    ...output.majorResistance,
    ...output.intermediateSupport,
    ...output.intermediateResistance,
    ...output.intradaySupport,
    ...output.intradayResistance,
    ...output.extensionLevels.support,
    ...output.extensionLevels.resistance,
  ];
}

function assertFinalLevelZoneCompatible(zone: FinalLevelZone): void {
  for (const key of FINAL_LEVEL_ZONE_REQUIRED_KEYS) {
    assert.ok(key in zone, `FinalLevelZone is missing required key ${key}`);
  }

  assert.ok(zone.kind === "support" || zone.kind === "resistance");
  assert.ok(["weak", "moderate", "strong", "major"].includes(zone.strengthLabel));
  assert.ok(Array.isArray(zone.sourceTypes));
  assert.ok(Array.isArray(zone.timeframeSources));
  assert.ok(Array.isArray(zone.notes));
  assert.equal(typeof zone.representativePrice, "number");
  assert.equal(typeof zone.strengthScore, "number");
  assert.equal(typeof zone.isExtension, "boolean");
}

function assertLevelEngineOutputCompatible(output: LevelEngineOutput): void {
  assert.deepEqual(Object.keys(output).sort(), [...LEVEL_OUTPUT_TOP_LEVEL_KEYS].sort());
  assert.equal(typeof output.symbol, "string");
  assert.equal(typeof output.generatedAt, "number");
  assert.ok(output.metadata);
  assert.ok(output.specialLevels);
  assert.deepEqual(Object.keys(output.extensionLevels).sort(), ["resistance", "support"]);
  assert.ok(Array.isArray(output.extensionLevels.support));
  assert.ok(Array.isArray(output.extensionLevels.resistance));

  for (const key of LEVEL_OUTPUT_ARRAY_KEYS) {
    assert.ok(Array.isArray(output[key]), `${key} must be an array`);
  }

  for (const zone of allRuntimeZones(output)) {
    assertFinalLevelZoneCompatible(zone);
  }
}

function bucketCounts(output: LevelEngineOutput): RuntimeBucketCountSummary {
  return {
    major: output.majorSupport.length + output.majorResistance.length,
    intermediate: output.intermediateSupport.length + output.intermediateResistance.length,
    intraday: output.intradaySupport.length + output.intradayResistance.length,
    extension: output.extensionLevels.support.length + output.extensionLevels.resistance.length,
    extensionSupport: output.extensionLevels.support.length,
    extensionResistance: output.extensionLevels.resistance.length,
  };
}

function nearestRuntimeLevel(
  output: LevelEngineOutput,
  kind: FinalLevelZone["kind"],
  referencePrice: number,
): FinalLevelZone | null {
  const candidates = allRuntimeZones(output)
    .filter((zone) => zone.kind === kind)
    .filter((zone) =>
      kind === "support"
        ? zone.representativePrice <= referencePrice
        : zone.representativePrice >= referencePrice,
    )
    .sort((left, right) =>
      Math.abs(left.representativePrice - referencePrice) -
      Math.abs(right.representativePrice - referencePrice),
    );
  return candidates[0] ?? null;
}

function priceDistancePct(left: number | null, right: number | null): number | null {
  if (left === null || right === null) {
    return left === right ? 0 : null;
  }
  return Math.abs(left - right) / Math.max(Math.abs(left), Math.abs(right), 0.0001);
}

function nearestSummary(
  oldOutput: LevelEngineOutput,
  newOutput: LevelEngineOutput,
  kind: FinalLevelZone["kind"],
  referencePrice: number,
): RuntimeNearestSummary {
  const oldLevel = nearestRuntimeLevel(oldOutput, kind, referencePrice);
  const newLevel = nearestRuntimeLevel(newOutput, kind, referencePrice);
  const oldPrice = oldLevel?.representativePrice ?? null;
  const newPrice = newLevel?.representativePrice ?? null;

  return {
    oldPrice,
    newPrice,
    distancePct: priceDistancePct(oldPrice, newPrice),
  };
}

function runtimeCountsDiffer(left: RuntimeBucketCountSummary, right: RuntimeBucketCountSummary): boolean {
  return Object.keys(left).some((key) =>
    left[key as keyof RuntimeBucketCountSummary] !== right[key as keyof RuntimeBucketCountSummary],
  );
}

function buildRuntimeParityReport(
  oldOutput: LevelEngineOutput,
  newOutput: LevelEngineOutput,
  referencePrice = oldOutput.metadata.referencePrice ?? newOutput.metadata.referencePrice ?? 0,
): RuntimeParityReport {
  const oldCounts = bucketCounts(oldOutput);
  const newCounts = bucketCounts(newOutput);
  const support = nearestSummary(oldOutput, newOutput, "support", referencePrice);
  const resistance = nearestSummary(oldOutput, newOutput, "resistance", referencePrice);
  const approvedGaps: RuntimeParityReport["approvedGaps"] = [];

  if (runtimeCountsDiffer(oldCounts, newCounts)) {
    approvedGaps.push({
      code: "bucket_count_mismatch",
      detail: `old=${JSON.stringify(oldCounts)} new=${JSON.stringify(newCounts)}`,
    });
  }

  if (oldCounts.extension !== newCounts.extension) {
    approvedGaps.push({
      code: "extension_ladder_gap",
      detail:
        `old extensions=${oldCounts.extension} ` +
        `new extensions=${newCounts.extension}; new adapter currently maps deeper anchors only.`,
    });
  }

  if (support.distancePct === null || support.distancePct > 0.01) {
    approvedGaps.push({
      code: "nearest_support_gap",
      detail: `old=${support.oldPrice ?? "none"} new=${support.newPrice ?? "none"}`,
    });
  }

  if (resistance.distancePct === null || resistance.distancePct > 0.01) {
    approvedGaps.push({
      code: "nearest_resistance_gap",
      detail: `old=${resistance.oldPrice ?? "none"} new=${resistance.newPrice ?? "none"}`,
    });
  }

  return {
    bucketCounts: {
      old: oldCounts,
      new: newCounts,
    },
    nearest: {
      support,
      resistance,
    },
    specialLevelsMatch: JSON.stringify(oldOutput.specialLevels) === JSON.stringify(newOutput.specialLevels),
    approvedGaps,
  };
}

function assertOnlyApprovedParityGaps(report: RuntimeParityReport): void {
  for (const gap of report.approvedGaps) {
    assert.ok(APPROVED_PARITY_GAP_CODES.has(gap.code), `Unapproved parity gap: ${gap.code}`);
  }
}

function assertBucketCountSummary(summary: RuntimeBucketCountSummary): void {
  for (const value of Object.values(summary)) {
    assert.equal(Number.isInteger(value), true);
    assert.ok(value >= 0);
  }
}

async function generateRuntimeFixtureOutputs(symbol: string): Promise<{
  defaultOutput: LevelEngineOutput;
  oldOutput: LevelEngineOutput;
  newOutput: LevelEngineOutput;
  compareOldOutput: LevelEngineOutput;
  compareNewOutput: LevelEngineOutput;
  compareOldLogs: LevelRuntimeComparisonLogEntry[];
  compareNewLogs: LevelRuntimeComparisonLogEntry[];
}> {
  const request = buildFixedRequest(symbol);
  const service = new CandleFetchService(new StubHistoricalCandleProvider());
  const compareOldLogs: LevelRuntimeComparisonLogEntry[] = [];
  const compareNewLogs: LevelRuntimeComparisonLogEntry[] = [];

  const defaultEngine = new LevelEngine(service);
  const oldEngine = new LevelEngine(service, undefined, { runtimeMode: "old" });
  const newEngine = new LevelEngine(service, undefined, { runtimeMode: "new" });
  const compareOldEngine = new LevelEngine(service, undefined, {
    runtimeMode: "compare",
    compareActivePath: "old",
    onComparisonLog: (entry) => compareOldLogs.push(entry),
  });
  const compareNewEngine = new LevelEngine(service, undefined, {
    runtimeMode: "compare",
    compareActivePath: "new",
    onComparisonLog: (entry) => compareNewLogs.push(entry),
  });

  const [defaultOutput, oldOutput, newOutput, compareOldOutput, compareNewOutput] = await Promise.all([
    defaultEngine.generateLevels(request),
    oldEngine.generateLevels(request),
    newEngine.generateLevels(request),
    compareOldEngine.generateLevels(request),
    compareNewEngine.generateLevels(request),
  ]);

  return {
    defaultOutput,
    oldOutput,
    newOutput,
    compareOldOutput,
    compareNewOutput,
    compareOldLogs,
    compareNewLogs,
  };
}

function fixtureZone(params: {
  id: string;
  symbol: string;
  kind: FinalLevelZone["kind"];
  price: number;
  isExtension?: boolean;
}): FinalLevelZone {
  return {
    id: params.id,
    symbol: params.symbol,
    kind: params.kind,
    timeframeBias: "5m",
    zoneLow: Number((params.price * 0.995).toFixed(4)),
    zoneHigh: Number((params.price * 1.005).toFixed(4)),
    representativePrice: params.price,
    strengthScore: 50,
    strengthLabel: "moderate",
    touchCount: 2,
    confluenceCount: 1,
    sourceTypes: [params.kind === "support" ? "swing_low" : "swing_high"],
    timeframeSources: ["5m"],
    reactionQualityScore: 0.6,
    rejectionScore: 0.5,
    displacementScore: 0.5,
    sessionSignificanceScore: 0.4,
    followThroughScore: 0.5,
    gapContinuationScore: 0,
    sourceEvidenceCount: 1,
    firstTimestamp: 1,
    lastTimestamp: 2,
    isExtension: params.isExtension ?? false,
    freshness: "fresh",
    notes: [],
  };
}

function fixtureOutput(
  symbol: string,
  overrides: Partial<LevelEngineOutput> = {},
): LevelEngineOutput {
  return {
    symbol,
    generatedAt: 1,
    metadata: {
      providerByTimeframe: { daily: "stub", "4h": "stub", "5m": "stub" },
      dataQualityFlags: [],
      freshness: "fresh",
      referencePrice: 0.31,
    },
    majorSupport: [],
    majorResistance: [],
    intermediateSupport: [],
    intermediateResistance: [],
    intradaySupport: [],
    intradayResistance: [],
    extensionLevels: {
      support: [],
      resistance: [],
    },
    specialLevels: {},
    ...overrides,
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

test("old, new, and compare modes all return LevelEngineOutput-compatible shapes", async () => {
  const {
    defaultOutput,
    oldOutput,
    newOutput,
    compareOldOutput,
    compareNewOutput,
  } = await generateRuntimeFixtureOutputs("PARI");

  for (const output of [defaultOutput, oldOutput, newOutput, compareOldOutput, compareNewOutput]) {
    assertLevelEngineOutputCompatible(output);
  }

  assert.deepEqual(flattenOutput(defaultOutput), flattenOutput(oldOutput));
});

test("runtime parity fixture compares old/new bucket counts and records approved current gaps", async () => {
  const { oldOutput, newOutput } = await generateRuntimeFixtureOutputs("BKT");
  const report = buildRuntimeParityReport(oldOutput, newOutput);

  assertBucketCountSummary(report.bucketCounts.old);
  assertBucketCountSummary(report.bucketCounts.new);
  assertOnlyApprovedParityGaps(report);
  assert.equal(
    report.approvedGaps.some((gap) => gap.code === "bucket_count_mismatch"),
    runtimeCountsDiffer(report.bucketCounts.old, report.bucketCounts.new),
  );
});

test("runtime parity fixture compares nearest support and resistance around reference price", async () => {
  const { oldOutput, newOutput } = await generateRuntimeFixtureOutputs("NEAR");
  const referencePrice = oldOutput.metadata.referencePrice ?? newOutput.metadata.referencePrice;
  assert.ok(referencePrice);

  const report = buildRuntimeParityReport(oldOutput, newOutput, referencePrice);

  assert.ok(
    report.nearest.support.oldPrice !== null || report.nearest.support.newPrice !== null,
    "fixture must expose a nearest support comparison",
  );
  assert.ok(
    report.nearest.resistance.oldPrice !== null || report.nearest.resistance.newPrice !== null,
    "fixture must expose a nearest resistance comparison",
  );
  assertOnlyApprovedParityGaps(report);
});

test("old/new runtime fixture keeps special levels identical", async () => {
  const { oldOutput, newOutput } = await generateRuntimeFixtureOutputs("SPEC");

  assert.ok(Object.keys(oldOutput.specialLevels).length > 0);
  assert.deepEqual(newOutput.specialLevels, oldOutput.specialLevels);
});

test("compareActivePath old returns old output while exposing comparison data", async () => {
  const { oldOutput, compareOldOutput, compareOldLogs } = await generateRuntimeFixtureOutputs("CMPO");
  const log = compareOldLogs[0];

  assert.deepEqual(flattenOutput(compareOldOutput), flattenOutput(oldOutput));
  assertLevelEngineOutputCompatible(compareOldOutput);
  assert.equal(compareOldLogs.length, 1);
  assert.ok(log);
  assert.equal(log.type, "level_runtime_compare");
  assert.equal(log.activePath, "old");
  assert.equal(log.alternatePath, "new");
  assert.equal(typeof log.activeVisibleCounts.support, "number");
  assert.equal(typeof log.activeVisibleCounts.resistance, "number");
  assert.equal(typeof log.alternateVisibleCounts.support, "number");
  assert.equal(typeof log.alternateVisibleCounts.resistance, "number");
  assert.ok(Array.isArray(log.notableDifferences));
  assert.ok("topSupportExplanation" in log.newPathContext);
  assert.ok("topResistanceExplanation" in log.newPathContext);
});

test("compareActivePath new returns new projected output without changing public output shape", async () => {
  const { oldOutput, newOutput, compareNewOutput, compareNewLogs } = await generateRuntimeFixtureOutputs("CMPN");
  const log = compareNewLogs[0];

  assert.deepEqual(flattenOutput(compareNewOutput), flattenOutput(newOutput));
  assert.deepEqual(Object.keys(compareNewOutput).sort(), Object.keys(oldOutput).sort());
  assertLevelEngineOutputCompatible(compareNewOutput);
  assert.equal(compareNewLogs.length, 1);
  assert.ok(log);
  assert.equal(log.activePath, "new");
  assert.equal(log.alternatePath, "old");
});

test("low-price runner extension parity gate documents old practical ladder coverage gap", () => {
  const oldOutput = fixtureOutput("LOW", {
    intradayResistance: [
      fixtureZone({ id: "LOW-intraday-resistance", symbol: "LOW", kind: "resistance", price: 0.33 }),
    ],
    extensionLevels: {
      support: [],
      resistance: [
        fixtureZone({ id: "LOW-old-extension-1", symbol: "LOW", kind: "resistance", price: 0.36, isExtension: true }),
        fixtureZone({ id: "LOW-old-extension-2", symbol: "LOW", kind: "resistance", price: 0.39, isExtension: true }),
        fixtureZone({ id: "LOW-old-extension-3", symbol: "LOW", kind: "resistance", price: 0.42, isExtension: true }),
      ],
    },
  });
  const newOutput = fixtureOutput("LOW", {
    intradayResistance: [
      fixtureZone({ id: "LOW-intraday-resistance", symbol: "LOW", kind: "resistance", price: 0.33 }),
    ],
    extensionLevels: {
      support: [],
      resistance: [
        fixtureZone({ id: "LOW-new-deeper-anchor", symbol: "LOW", kind: "resistance", price: 0.36, isExtension: true }),
      ],
    },
  });

  const report = buildRuntimeParityReport(oldOutput, newOutput, 0.31);

  assertOnlyApprovedParityGaps(report);
  assert.ok(report.approvedGaps.some((gap) => gap.code === "extension_ladder_gap"));
});

test("new projected strength-label mapping is deterministic and documented", async () => {
  const shadowCase = buildDefaultSurfacedShadowCases().find(
    (item) => item.caseId === "broken-level-exclusion",
  );
  assert.ok(shadowCase);
  const candlesByTimeframe = await fetchCandlesByTimeframe(shadowCase.symbol);
  const projectionInput = {
    symbol: shadowCase.symbol,
    rawCandidates: shadowCase.rawCandidates ?? [],
    levelCandidates: shadowCase.newCandidates,
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
      freshness: "fresh" as const,
      referencePrice: shadowCase.currentPrice,
    },
    specialLevels: {},
    generatedAt: 123,
  };

  const firstProjection = buildNewRuntimeCompatibleLevelOutput(projectionInput);
  const secondProjection = buildNewRuntimeCompatibleLevelOutput(projectionInput);
  const firstLabels = allRuntimeZones(firstProjection.output).map((zone) => `${zone.id}:${zone.strengthLabel}`);
  const secondLabels = allRuntimeZones(secondProjection.output).map((zone) => `${zone.id}:${zone.strengthLabel}`);

  assert.deepEqual(firstLabels, secondLabels);
  assert.ok(firstLabels.length > 0);
  assert.ok(
    firstProjection.mappingNotes.some((note) =>
      note.includes("Strength labels are approximated from surfaced-selection scores"),
    ),
  );
});

test("LevelEngineOutput JSON serialization and LevelStore storage remain compatible for old and new outputs", async () => {
  const { oldOutput, newOutput } = await generateRuntimeFixtureOutputs("STOR");

  for (const output of [oldOutput, newOutput]) {
    const serialized = JSON.stringify(output);
    const parsed = JSON.parse(serialized) as LevelEngineOutput;
    const store = new LevelStore();

    assertLevelEngineOutputCompatible(parsed);
    store.setLevels(parsed);
    assert.deepEqual(store.getLevels(parsed.symbol), parsed);
  }
});
