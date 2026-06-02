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
import { buildLevelQualityAuditReport } from "../lib/levels/level-quality-audit-runner.js";
import {
  assertLevelQualityDensityMetricFactsOnly,
  validateLevelQualityDensityMetric,
} from "../lib/levels/level-quality-density-metric.js";
import type { FinalLevelZone, LevelEngineOutput } from "../lib/levels/level-types.js";
import type { Candle } from "../lib/market-data/candle-types.js";
import {
  buildLevelQualityReviewEntry,
  collectProhibitedLanguageHits,
  runLevelQualityReviewRunner,
  type LevelQualityReviewBaseline,
  type LevelQualityReviewBaselineEntry,
  type LevelQualityReviewRunnerEntry,
} from "../scripts/run-level-quality-review.js";
import { buildValidationZone } from "./helpers/level-validation-fixtures.js";

const GENERATED_AT = Date.parse("2026-06-01T16:00:00.000Z");
const REVIEW_GENERATED_AT = "2026-06-01T23:45:00.000Z";
const REVIEW_AS_OF = Date.parse("2026-05-01T10:20:00-04:00");
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SAMPLE_ROOT = join(REPO_ROOT, "docs/examples/level-analysis-snapshot");

function zone(
  params: Partial<FinalLevelZone> & Pick<FinalLevelZone, "id" | "kind" | "representativePrice">,
): FinalLevelZone {
  const zoneWidth = Math.max(params.representativePrice * 0.0025, 0.01);

  return buildValidationZone({
    symbol: "DMET",
    timeframeBias: "5m",
    timeframeSources: ["5m"],
    zoneLow: params.representativePrice - zoneWidth,
    zoneHigh: params.representativePrice + zoneWidth,
    strengthScore: 58,
    strengthLabel: "moderate",
    touchCount: 2,
    confluenceCount: 1,
    reactionQualityScore: 0.52,
    rejectionScore: 0.4,
    displacementScore: 0.35,
    followThroughScore: 0.38,
    sourceEvidenceCount: 2,
    ...params,
  });
}

function extensionZone(
  id: string,
  kind: "support" | "resistance",
  representativePrice: number,
  syntheticContinuationMap = false,
): FinalLevelZone {
  return zone({
    id,
    kind,
    representativePrice,
    isExtension: true,
    touchCount: syntheticContinuationMap ? 0 : 2,
    confluenceCount: syntheticContinuationMap ? 0 : 1,
    extensionMetadata: syntheticContinuationMap
      ? {
          extensionSource: "synthetic_continuation_map",
          generationMethod: "percentage_ladder",
          evidenceLimitations: [
            "not_historical_support_resistance",
            "no_touch_or_rejection_history",
          ],
        }
      : { extensionSource: "historical_candidate" },
  });
}

function output(overrides: Partial<LevelEngineOutput> = {}): LevelEngineOutput {
  const base: LevelEngineOutput = {
    symbol: "DMET",
    generatedAt: GENERATED_AT,
    metadata: {
      providerByTimeframe: { "5m": "fixture", "4h": "fixture", daily: "fixture" },
      dataQualityFlags: [],
      freshness: "fresh",
      referencePrice: 10,
    },
    majorSupport: [zone({ id: "major-support-850", kind: "support", representativePrice: 8.5 })],
    majorResistance: [zone({ id: "major-resistance-1150", kind: "resistance", representativePrice: 11.5 })],
    intermediateSupport: [zone({ id: "intermediate-support-920", kind: "support", representativePrice: 9.2 })],
    intermediateResistance: [zone({ id: "intermediate-resistance-1080", kind: "resistance", representativePrice: 10.8 })],
    intradaySupport: [zone({ id: "intraday-support-970", kind: "support", representativePrice: 9.7 })],
    intradayResistance: [zone({ id: "intraday-resistance-1030", kind: "resistance", representativePrice: 10.3 })],
    extensionLevels: {
      support: [extensionZone("extension-support-700", "support", 7)],
      resistance: [extensionZone("extension-resistance-1300", "resistance", 13)],
    },
    specialLevels: {},
  };

  return {
    ...base,
    ...overrides,
    metadata: {
      ...base.metadata,
      ...overrides.metadata,
    },
    extensionLevels: overrides.extensionLevels ?? base.extensionLevels,
    specialLevels: overrides.specialLevels ?? base.specialLevels,
  };
}

function audit(engineOutput: LevelEngineOutput, clusterThresholdPct = 1) {
  return buildLevelQualityAuditReport({
    output: engineOutput,
    clusterThresholdPct,
    nearbyThresholdPct: 8,
    extensionCoverageWarningPct: 20,
    maxItems: 12,
  });
}

function allSurfacedLevels(engineOutput: LevelEngineOutput): FinalLevelZone[] {
  return [
    ...engineOutput.majorSupport,
    ...engineOutput.majorResistance,
    ...engineOutput.intermediateSupport,
    ...engineOutput.intermediateResistance,
    ...engineOutput.intradaySupport,
    ...engineOutput.intradayResistance,
  ];
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

function sampleCandles(fileName: string): Candle[] {
  return JSON.parse(readFileSync(join(SAMPLE_ROOT, fileName), "utf8")) as Candle[];
}

function timestampOf(candle: Candle): number {
  return typeof candle.timestamp === "number" ? candle.timestamp : Date.parse(candle.timestamp);
}

function withTempDir<T>(callback: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "density-metric-report-wiring-"));

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
      cachedAt: Date.parse(REVIEW_GENERATED_AT),
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
    asOfTimestamp: REVIEW_AS_OF,
    asOfIso: new Date(REVIEW_AS_OF).toISOString(),
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

test("audit report includes additive densityMetric without changing existing diagnostics or semantics", () => {
  const report = audit(output());

  assert.ok(report.densityMetric);
  assert.equal(report.densityMetric.schemaVersion, "level-quality-density-metric/v1");
  assert.equal(report.densityMetric.classification, "balanced");
  assert.equal(report.densityMetric.totalRows, report.summary.totalLevels);
  assertLevelQualityDensityMetricFactsOnly(report.densityMetric);
  assert.deepEqual(
    report.diagnosticSemantics?.map((semantic) => semantic.code).sort(),
    [...report.diagnostics].sort(),
  );
  assert.equal(report.diagnostics.some((diagnostic) => diagnostic.startsWith("density_classification:")), false);
  assert.equal(report.diagnostics.includes("dense_but_separated_level_map"), false);
  assertNoProhibitedLanguage(report.densityMetric);
});

test("densityMetric classifies sparse separated clustered and side-heavy audit reports", () => {
  const sparse = audit(output({
    majorSupport: [zone({ id: "support-1", kind: "support", representativePrice: 9.4 })],
    majorResistance: [zone({ id: "resistance-1", kind: "resistance", representativePrice: 10.6 })],
    intermediateSupport: [],
    intermediateResistance: [],
    intradaySupport: [],
    intradayResistance: [],
    extensionLevels: { support: [], resistance: [] },
  }));
  const denseSeparated = audit(output({
    majorSupport: [zone({ id: "support-a", kind: "support", representativePrice: 8.1 })],
    intermediateSupport: [
      zone({ id: "support-b", kind: "support", representativePrice: 8.7 }),
      zone({ id: "support-c", kind: "support", representativePrice: 9.1 }),
    ],
    intradaySupport: [
      zone({ id: "support-d", kind: "support", representativePrice: 9.5 }),
      zone({ id: "support-e", kind: "support", representativePrice: 9.8 }),
    ],
    majorResistance: [zone({ id: "resistance-a", kind: "resistance", representativePrice: 10.2 })],
    intermediateResistance: [
      zone({ id: "resistance-b", kind: "resistance", representativePrice: 10.6 }),
      zone({ id: "resistance-c", kind: "resistance", representativePrice: 11.0 }),
    ],
    intradayResistance: [
      zone({ id: "resistance-d", kind: "resistance", representativePrice: 11.4 }),
      zone({ id: "resistance-e", kind: "resistance", representativePrice: 11.8 }),
    ],
    extensionLevels: { support: [], resistance: [] },
  }));
  const denseClustered = audit(output({
    majorSupport: [zone({ id: "cluster-support-a", kind: "support", representativePrice: 9.82 })],
    intermediateSupport: [
      zone({ id: "cluster-support-b", kind: "support", representativePrice: 9.86 }),
      zone({ id: "cluster-support-c", kind: "support", representativePrice: 9.9 }),
    ],
    intradaySupport: [
      zone({ id: "cluster-support-d", kind: "support", representativePrice: 9.94 }),
      zone({ id: "cluster-support-e", kind: "support", representativePrice: 9.98 }),
    ],
    majorResistance: [zone({ id: "cluster-resistance-a", kind: "resistance", representativePrice: 10.02 })],
    intermediateResistance: [
      zone({ id: "cluster-resistance-b", kind: "resistance", representativePrice: 10.06 }),
      zone({ id: "cluster-resistance-c", kind: "resistance", representativePrice: 10.1 }),
    ],
    intradayResistance: [
      zone({ id: "cluster-resistance-d", kind: "resistance", representativePrice: 10.14 }),
      zone({ id: "cluster-resistance-e", kind: "resistance", representativePrice: 10.18 }),
    ],
    extensionLevels: { support: [], resistance: [] },
  }), 3);
  const supportHeavy = audit(output({
    majorSupport: [zone({ id: "support-a", kind: "support", representativePrice: 8.8 })],
    intermediateSupport: [
      zone({ id: "support-b", kind: "support", representativePrice: 9.0 }),
      zone({ id: "support-c", kind: "support", representativePrice: 9.2 }),
    ],
    intradaySupport: [
      zone({ id: "support-d", kind: "support", representativePrice: 9.4 }),
      zone({ id: "support-e", kind: "support", representativePrice: 9.6 }),
    ],
    majorResistance: [zone({ id: "resistance-a", kind: "resistance", representativePrice: 10.4 })],
    intermediateResistance: [],
    intradayResistance: [zone({ id: "resistance-b", kind: "resistance", representativePrice: 10.8 })],
    extensionLevels: { support: [], resistance: [] },
  }));

  assert.equal(sparse.densityMetric?.classification, "sparse");
  assert.equal(denseSeparated.densityMetric?.classification, "dense_separated");
  assert.equal(denseSeparated.densityMetric?.flags.denseButSeparated, true);
  assert.equal(denseClustered.densityMetric?.classification, "dense_clustered");
  assert.equal(denseClustered.densityMetric?.flags.clusteredAreasPresent, true);
  assert.equal(supportHeavy.densityMetric?.sideBias, "support_heavy");
});

test("densityMetric represents extension-heavy and synthetic-present cases separately", () => {
  const report = audit(output({
    majorSupport: [zone({ id: "support-1", kind: "support", representativePrice: 9.2 })],
    majorResistance: [zone({ id: "resistance-1", kind: "resistance", representativePrice: 10.8 })],
    intermediateSupport: [],
    intermediateResistance: [],
    intradaySupport: [],
    intradayResistance: [],
    extensionLevels: {
      support: [
        extensionZone("extension-support-1", "support", 8.8),
        extensionZone("extension-support-2", "support", 8.4),
      ],
      resistance: [
        extensionZone("extension-resistance-1", "resistance", 11.2),
        extensionZone("synthetic-resistance-1", "resistance", 11.6, true),
      ],
    },
  }));

  assert.equal(report.densityMetric?.flags.extensionHeavy, true);
  assert.equal(report.densityMetric?.flags.syntheticPresent, true);
  assert.equal(report.densityMetric?.densityBuckets.extension, 3);
  assert.equal(report.densityMetric?.densityBuckets.synthetic, 1);
  assert.equal(report.densityMetric?.counts.historical, 2);
  assert.equal(report.densityMetric?.diagnostics.includes("synthetic_rows_present"), true);
});

test("densityMetric wiring is immutable and preserves surfaced and extension levels", () => {
  const engineOutput = output();
  const before = JSON.stringify(engineOutput);
  const report = audit(engineOutput);

  assert.equal(JSON.stringify(engineOutput), before);
  assert.deepEqual(
    allSurfacedLevels(engineOutput).map((level) => level.id),
    [
      "major-support-850",
      "major-resistance-1150",
      "intermediate-support-920",
      "intermediate-resistance-1080",
      "intraday-support-970",
      "intraday-resistance-1030",
    ],
  );
  assert.deepEqual(
    [...engineOutput.extensionLevels.support, ...engineOutput.extensionLevels.resistance].map((level) => level.id),
    ["extension-support-700", "extension-resistance-1300"],
  );
  assert.equal(report.nearbyCoverage.nearestSupport?.levelId, "intraday-support-970");
  assert.equal(report.nearbyCoverage.nearestResistance?.levelId, "intraday-resistance-1030");
});

test("packaged review output includes compact density metric summary without raw snapshots", () =>
  withTempDir((dir) => {
    const cacheRoot = join(dir, "cache");
    const seed = seedCache(cacheRoot);
    const entry = buildLevelQualityReviewEntry({
      cacheRoot,
      provider: "stub",
      baselineEntry: seed,
    });
    const baseline: LevelQualityReviewBaseline = {
      schemaVersion: "level-quality-density-metric-report-wiring/v1",
      generatedAt: REVIEW_GENERATED_AT,
      provider: "stub",
      reviewedSymbols: ["SNAP"],
      supplied15mSymbols: ["SNAP"],
      entries: [baselineEntryFromReview(entry)],
    };
    const baselinePath = join(dir, "baseline.json");
    const outJsonPath = join(dir, "review.json");
    const outTextPath = join(dir, "review.txt");
    writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");

    const result = runLevelQualityReviewRunner({
      cacheRoot,
      baselinePath,
      outJsonPath,
      outTextPath,
      generatedAt: REVIEW_GENERATED_AT,
      provider: "stub",
    });
    const parsed = JSON.parse(readFileSync(outJsonPath, "utf8")) as typeof result;

    assert.equal(existsSync(outJsonPath), true);
    assert.equal(existsSync(outTextPath), true);
    assert.equal(result.summary.densityMetricPresentCount, 1);
    assert.equal(result.entries[0]?.qualityAudit.densityMetric?.present, true);
    assert.equal(parsed.entries[0]?.qualityAudit.densityMetric?.present, true);
    const parsedDensityMetric = parsed.entries[0]?.qualityAudit.densityMetric;
    assert.ok(parsedDensityMetric?.present);
    const validation = validateLevelQualityDensityMetric(parsedDensityMetric);
    assert.equal(validation.valid, true);
    assert.deepEqual(validation.errors, []);
    assertLevelQualityDensityMetricFactsOnly(parsedDensityMetric);
    assert.equal(JSON.stringify(parsed).includes("levelEngineOutput"), false);
    assert.match(readFileSync(outTextPath, "utf8"), /Density metric present count: 1\/1/);
    assert.match(readFileSync(outTextPath, "utf8"), /density=/);
    assert.deepEqual(collectProhibitedLanguageHits(result), []);
  }));

test("density report wiring source stays isolated from provider write alert monitoring Discord and journal paths", () => {
  const auditSource = readFileSync(
    fileURLToPath(new URL("../lib/levels/level-quality-audit-runner.ts", import.meta.url)),
    "utf8",
  ).toLowerCase();
  const reviewSource = readFileSync(
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
    assert.equal(auditSource.includes(blocked), false, `Unexpected audit source reference: ${blocked}`);
    assert.equal(reviewSource.includes(blocked), false, `Unexpected review source reference: ${blocked}`);
  }
});
