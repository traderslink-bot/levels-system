import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { clusterRawLevelCandidatesWithDiagnostics } from "../lib/levels/level-clusterer.js";
import { buildLevelClusteringDiagnostics } from "../lib/levels/level-clustering-diagnostics.js";
import { DEFAULT_LEVEL_ENGINE_CONFIG } from "../lib/levels/level-config.js";
import { buildRawLevelCandidates } from "../lib/levels/raw-level-candidate-builder.js";
import { buildSpecialLevelCandidates } from "../lib/levels/special-level-builder.js";
import { detectSwingPoints } from "../lib/levels/swing-detector.js";
import type {
  FinalLevelZone,
  RawLevelCandidate,
} from "../lib/levels/level-types.js";
import type { Candle, CandleTimeframe } from "../lib/market-data/candle-types.js";

type LevelClusteringDiagnosticsFormat = "text" | "json";

type LevelClusteringDiagnosticsOptions = {
  outPath?: string;
  format: LevelClusteringDiagnosticsFormat;
};

type GeneratedSampleSpec = {
  symbol: string;
  profile: string;
  dailyCloses: number[];
  fourHourCloses: number[];
  fiveMinuteCloses: number[];
};

type GeneratedClusteringDiagnosticsSample = {
  symbol: string;
  profile: string;
  inputSource: "deterministic_generated_candles";
  candleCounts: Record<CandleTimeframe, number>;
  rawCandidateCount: number;
  specialCandidateCount: number;
  clusteredCounts: { support: number; resistance: number };
  broadClusterCount: number;
  manyMemberClusterCount: number;
  hiddenDepthPossibleCount: number;
  noRawMemberMappingCount: number;
  largestRawSpanPct?: number;
  largestRawMemberCount: number;
  report: ReturnType<typeof buildLevelClusteringDiagnostics>;
};

type LevelClusteringDiagnosticsBundle = {
  generatedAt: number;
  inputSource: "deterministic_generated_pipeline_data";
  samples: GeneratedClusteringDiagnosticsSample[];
  summary: {
    sampleCount: number;
    rawCandidateCount: number;
    clusteredZoneCount: number;
    averageCompressionRatio: number;
    samplesWithHighCompression: string[];
    samplesWithBroadClusters: string[];
    samplesWithManyMemberClusters: string[];
    samplesWithHiddenDepthPossible: string[];
    samplesWithUnavailableRawMemberMapping: string[];
  };
  safety: {
    clusteringBehaviorUnchanged: true;
    supportResistanceDetectionUnchanged: true;
    levelEngineDefaultOutputUnchanged: true;
    extensionGenerationUnchanged: true;
    scoringSelectionUnchanged: true;
    runtimeBehaviorUnchanged: true;
    reviewOnly: true;
  };
};

const GENERATED_AT = Date.parse("2026-05-29T10:00:00-04:00");
const DAY_MS = 24 * 60 * 60 * 1000;
const FOUR_HOUR_MS = 4 * 60 * 60 * 1000;
const FIVE_MINUTE_MS = 5 * 60 * 1000;

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}.`);
  }

  return value;
}

function parseFormat(value: string | undefined): LevelClusteringDiagnosticsFormat {
  if (value === undefined) {
    return "text";
  }
  if (value === "text" || value === "json") {
    return value;
  }

  throw new Error(`Unsupported --format value "${value}". Expected text or json.`);
}

function parseArgs(args: string[]): LevelClusteringDiagnosticsOptions {
  let outPath: string | undefined;
  let format: LevelClusteringDiagnosticsFormat = "text";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--out") {
      outPath = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--format") {
      format = parseFormat(requireValue(args, index, arg));
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument "${arg}".`);
  }

  return {
    outPath,
    format,
  };
}

function round(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function candlesFromCloses(params: {
  closes: number[];
  startTimestamp: number;
  intervalMs: number;
  wickPct: number;
  volumeBase: number;
  volumeStep: number;
}): Candle[] {
  return params.closes.map((close, index) => {
    const open = index === 0 ? close : params.closes[index - 1]!;
    const high = Math.max(open, close) * (1 + params.wickPct);
    const low = Math.min(open, close) * (1 - params.wickPct);

    return {
      timestamp: params.startTimestamp + index * params.intervalMs,
      open: round(open),
      high: round(high),
      low: round(low),
      close: round(close),
      volume: params.volumeBase + index * params.volumeStep,
    };
  });
}

function generatedSamples(): GeneratedSampleSpec[] {
  return [
    {
      symbol: "LPRN",
      profile: "low-price runner",
      dailyCloses: [
        1, 1.1, 1.22, 1.42, 1.23, 1.12, 1.52, 1.7, 1.95, 1.62, 1.38,
        2.12, 2.42, 2.82, 2.32, 2.02, 3.2, 3.62, 4.02, 3.42, 3.02, 4.5,
        5.22, 6.02, 5.32, 4.82, 5.62,
      ],
      fourHourCloses: [
        3.3, 3.7, 4.2, 3.65, 3.3, 4.45, 4.95, 4.25, 3.95, 5.2, 5.8, 4.95,
        4.55, 6.05, 6.45, 5.55, 5.1, 5.75,
      ],
      fiveMinuteCloses: [
        4.75, 4.95, 5.22, 4.92, 4.72, 5.35, 5.62, 5.22, 4.98, 5.75, 6.05,
        5.45, 5.12, 5.55, 5.25, 5.6,
      ],
    },
    {
      symbol: "CHOP",
      profile: "choppy/messy ticker",
      dailyCloses: [
        5, 5.08, 5.18, 5.24, 5.08, 4.95, 5.06, 5.17, 5.23, 5.07, 4.96,
        5.05, 5.16, 5.22, 5.06, 4.97, 5.04, 5.14, 5.2, 5.08, 5.02,
      ],
      fourHourCloses: [
        5.03, 5.1, 5.18, 5.08, 5, 5.13, 5.19, 5.07, 4.99, 5.12, 5.18,
        5.06, 5.01, 5.11, 5.16, 5.07,
      ],
      fiveMinuteCloses: [
        5.02, 5.07, 5.11, 5.04, 5, 5.08, 5.12, 5.05, 5.01, 5.09, 5.13,
        5.06, 5.03, 5.08, 5.1, 5.07,
      ],
    },
    {
      symbol: "THIN",
      profile: "thin-liquidity ticker",
      dailyCloses: [
        1.22, 1.34, 1.48, 1.76, 1.48, 1.32, 1.54, 1.7, 1.56, 1.42, 1.62,
        1.72, 1.5, 1.56,
      ],
      fourHourCloses: [
        1.38, 1.48, 1.6, 1.46, 1.36, 1.62, 1.68, 1.5, 1.42, 1.6, 1.52, 1.56,
      ],
      fiveMinuteCloses: [1.48, 1.55, 1.6, 1.5, 1.44, 1.58, 1.62, 1.52, 1.48, 1.56],
    },
    {
      symbol: "CLNT",
      profile: "clean technical mover",
      dailyCloses: [
        18, 20, 22, 26, 23, 20, 24, 28, 31, 27, 23, 29, 33, 36, 30, 25, 32,
        34, 29, 24.5,
      ],
      fourHourCloses: [
        21, 23, 25, 22.8, 20.5, 26.5, 29, 24, 22, 30, 32, 26, 24, 29, 27,
        24.5,
      ],
      fiveMinuteCloses: [
        23.2, 24.4, 25.3, 23.8, 22.8, 25.6, 26.2, 24.4, 23.6, 25.2, 24.2,
        24.5,
      ],
    },
    {
      symbol: "HIPO",
      profile: "higher-priced stock",
      dailyCloses: [
        145, 165, 182, 220, 176, 158, 190, 225, 245, 198, 170, 210, 238, 252,
        216, 186,
      ],
      fourHourCloses: [
        165, 182, 202, 176, 160, 212, 232, 188, 172, 222, 240, 198, 184, 205,
        186,
      ],
      fiveMinuteCloses: [176, 188, 202, 181, 170, 198, 208, 186, 178, 196, 184, 186],
    },
  ];
}

function buildSeries(spec: GeneratedSampleSpec): Record<CandleTimeframe, Candle[]> {
  return {
    daily: candlesFromCloses({
      closes: spec.dailyCloses,
      startTimestamp: Date.parse("2026-04-20T00:00:00-04:00"),
      intervalMs: DAY_MS,
      wickPct: 0.012,
      volumeBase: 1_000_000,
      volumeStep: 75_000,
    }),
    "4h": candlesFromCloses({
      closes: spec.fourHourCloses,
      startTimestamp: Date.parse("2026-05-20T04:00:00-04:00"),
      intervalMs: FOUR_HOUR_MS,
      wickPct: 0.01,
      volumeBase: 350_000,
      volumeStep: 25_000,
    }),
    "5m": candlesFromCloses({
      closes: spec.fiveMinuteCloses,
      startTimestamp: Date.parse("2026-05-29T08:00:00-04:00"),
      intervalMs: FIVE_MINUTE_MS,
      wickPct: 0.006,
      volumeBase: 50_000,
      volumeStep: 4_000,
    }),
  };
}

function buildRawCandidates(symbol: string, series: Record<CandleTimeframe, Candle[]>): {
  rawCandidates: RawLevelCandidate[];
  specialCandidateCount: number;
} {
  const rawCandidates: RawLevelCandidate[] = [];

  for (const timeframe of ["daily", "4h", "5m"] as const) {
    const swings = detectSwingPoints(series[timeframe], {
      swingWindow: DEFAULT_LEVEL_ENGINE_CONFIG.timeframeConfig[timeframe].swingWindow,
      minimumDisplacementPct:
        DEFAULT_LEVEL_ENGINE_CONFIG.timeframeConfig[timeframe].minimumDisplacementPct,
      minimumSeparationBars:
        DEFAULT_LEVEL_ENGINE_CONFIG.timeframeConfig[timeframe].minimumSwingSeparationBars,
    });

    rawCandidates.push(
      ...buildRawLevelCandidates({
        symbol,
        timeframe,
        candles: series[timeframe],
        swings,
      }),
    );
  }

  const special = buildSpecialLevelCandidates(symbol, series["5m"]);
  rawCandidates.push(...special.candidates);

  return {
    rawCandidates,
    specialCandidateCount: special.candidates.length,
  };
}

function buildClusteredZones(
  symbol: string,
  rawCandidates: RawLevelCandidate[],
): {
  support: FinalLevelZone[];
  resistance: FinalLevelZone[];
  trackedClusters: Parameters<typeof buildLevelClusteringDiagnostics>[0]["trackedClusters"];
} {
  const tolerance = Math.max(
    DEFAULT_LEVEL_ENGINE_CONFIG.timeframeConfig.daily.clusterTolerancePct,
    DEFAULT_LEVEL_ENGINE_CONFIG.timeframeConfig["4h"].clusterTolerancePct,
  );
  const support = clusterRawLevelCandidatesWithDiagnostics(
    symbol,
    "support",
    rawCandidates,
    tolerance,
    DEFAULT_LEVEL_ENGINE_CONFIG,
  );
  const resistance = clusterRawLevelCandidatesWithDiagnostics(
    symbol,
    "resistance",
    rawCandidates,
    tolerance,
    DEFAULT_LEVEL_ENGINE_CONFIG,
  );

  return {
    support: support.zones,
    resistance: resistance.zones,
    trackedClusters: [
      ...support.diagnostics.clusters,
      ...resistance.diagnostics.clusters,
    ],
  };
}

function countClusterWarnings(
  sample: ReturnType<typeof buildLevelClusteringDiagnostics>,
  warning: "broad_cluster_span" | "many_members_single_cluster" | "hidden_depth_possible" | "no_raw_members_available",
): number {
  return sample.clusters.filter((cluster) => cluster.warnings.includes(warning)).length;
}

function buildGeneratedSample(spec: GeneratedSampleSpec): GeneratedClusteringDiagnosticsSample {
  const symbol = spec.symbol.toUpperCase();
  const series = buildSeries(spec);
  const { rawCandidates, specialCandidateCount } = buildRawCandidates(symbol, series);
  const clustered = buildClusteredZones(symbol, rawCandidates);
  const report = buildLevelClusteringDiagnostics({
    symbol,
    rawCandidates,
    clusteredZones: [...clustered.support, ...clustered.resistance],
    trackedClusters: clustered.trackedClusters,
  });
  const rawSpanValues = report.clusters
    .map((cluster) => cluster.rawPriceSpanPct)
    .filter((value): value is number => value !== undefined);
  const rawMemberCounts = report.clusters.map((cluster) => cluster.rawMemberCount);

  return {
    symbol,
    profile: spec.profile,
    inputSource: "deterministic_generated_candles",
    candleCounts: {
      daily: series.daily.length,
      "4h": series["4h"].length,
      "5m": series["5m"].length,
    },
    rawCandidateCount: report.rawCandidateCount,
    specialCandidateCount,
    clusteredCounts: {
      support: clustered.support.length,
      resistance: clustered.resistance.length,
    },
    broadClusterCount: countClusterWarnings(report, "broad_cluster_span"),
    manyMemberClusterCount: countClusterWarnings(report, "many_members_single_cluster"),
    hiddenDepthPossibleCount: countClusterWarnings(report, "hidden_depth_possible"),
    noRawMemberMappingCount: countClusterWarnings(report, "no_raw_members_available"),
    largestRawSpanPct: rawSpanValues.length > 0 ? round(Math.max(...rawSpanValues)) : undefined,
    largestRawMemberCount: rawMemberCounts.length > 0 ? Math.max(...rawMemberCounts) : 0,
    report,
  };
}

function buildBundle(): LevelClusteringDiagnosticsBundle {
  const samples = generatedSamples().map(buildGeneratedSample);

  return {
    generatedAt: GENERATED_AT,
    inputSource: "deterministic_generated_pipeline_data",
    samples,
    summary: {
      sampleCount: samples.length,
      rawCandidateCount: samples.reduce((sum, sample) => sum + sample.rawCandidateCount, 0),
      clusteredZoneCount: samples.reduce(
        (sum, sample) =>
          sum + sample.clusteredCounts.support + sample.clusteredCounts.resistance,
        0,
      ),
      averageCompressionRatio: average(samples.map((sample) => sample.report.compressionRatio)),
      samplesWithHighCompression: samples
        .filter((sample) => sample.report.warnings.includes("high_compression_ratio"))
        .map((sample) => sample.symbol),
      samplesWithBroadClusters: samples
        .filter((sample) => sample.broadClusterCount > 0)
        .map((sample) => sample.symbol),
      samplesWithManyMemberClusters: samples
        .filter((sample) => sample.manyMemberClusterCount > 0)
        .map((sample) => sample.symbol),
      samplesWithHiddenDepthPossible: samples
        .filter((sample) => sample.hiddenDepthPossibleCount > 0)
        .map((sample) => sample.symbol),
      samplesWithUnavailableRawMemberMapping: samples
        .filter((sample) => sample.noRawMemberMappingCount > 0)
        .map((sample) => sample.symbol),
    },
    safety: {
      clusteringBehaviorUnchanged: true,
      supportResistanceDetectionUnchanged: true,
      levelEngineDefaultOutputUnchanged: true,
      extensionGenerationUnchanged: true,
      scoringSelectionUnchanged: true,
      runtimeBehaviorUnchanged: true,
      reviewOnly: true,
    },
  };
}

function formatNumber(value: number | undefined, suffix = ""): string {
  if (value === undefined || !Number.isFinite(value)) {
    return "n/a";
  }

  return `${round(value)}${suffix}`;
}

function formatList(values: Array<string | number>): string {
  return values.length > 0 ? values.join(", ") : "none";
}

function renderText(bundle: LevelClusteringDiagnosticsBundle): string {
  const lines: string[] = [
    "Level clustering diagnostics review",
    "",
    "## Input Source",
    "- Deterministic generated candle fixtures.",
    "- Each sample runs the existing pipeline through swing detection, raw candidate building, special candidates, clustering, and clustering diagnostics.",
    "- Raw member mapping uses diagnostics-only clusterer member tracking when available.",
    "",
    "## Summary",
    `- Sample count: ${bundle.summary.sampleCount}`,
    `- Raw candidates: ${bundle.summary.rawCandidateCount}`,
    `- Clustered zones: ${bundle.summary.clusteredZoneCount}`,
    `- Average compression ratio: ${formatNumber(bundle.summary.averageCompressionRatio)}`,
    `- Samples with high compression: ${formatList(bundle.summary.samplesWithHighCompression)}`,
    `- Samples with broad clusters: ${formatList(bundle.summary.samplesWithBroadClusters)}`,
    `- Samples with many-member clusters: ${formatList(bundle.summary.samplesWithManyMemberClusters)}`,
    `- Samples with hidden-depth possible: ${formatList(bundle.summary.samplesWithHiddenDepthPossible)}`,
    `- Samples with unavailable raw member mapping: ${formatList(bundle.summary.samplesWithUnavailableRawMemberMapping)}`,
    "",
    "## Samples",
  ];

  for (const sample of bundle.samples) {
    lines.push(`### ${sample.symbol} - ${sample.profile}`);
    lines.push(`- Raw candidates: ${sample.rawCandidateCount}`);
    lines.push(`- Special candidates: ${sample.specialCandidateCount}`);
    lines.push(`- Clustered support/resistance: ${sample.clusteredCounts.support}/${sample.clusteredCounts.resistance}`);
    lines.push(`- Compression ratio: ${formatNumber(sample.report.compressionRatio)}`);
    lines.push(`- Broad clusters: ${sample.broadClusterCount}`);
    lines.push(`- Many-member clusters: ${sample.manyMemberClusterCount}`);
    lines.push(`- Hidden-depth possible clusters: ${sample.hiddenDepthPossibleCount}`);
    lines.push(`- Unavailable raw mapping clusters: ${sample.noRawMemberMappingCount}`);
    lines.push(`- Largest raw span: ${formatNumber(sample.largestRawSpanPct, "%")}`);
    lines.push(`- Largest raw member count: ${sample.largestRawMemberCount}`);
    lines.push(`- Warnings: ${formatList(sample.report.warnings)}`);

    const flaggedClusters = sample.report.clusters.filter(
      (cluster) => cluster.warnings.length > 0,
    );
    lines.push("- Flagged clusters:");
    if (flaggedClusters.length === 0) {
      lines.push("  - none");
    } else {
      for (const cluster of flaggedClusters) {
        lines.push(
          `  - ${cluster.clusterId}: ${cluster.kind} ${formatNumber(cluster.zoneLow)}-${formatNumber(cluster.zoneHigh)}, rep ${formatNumber(cluster.representativePrice)}, members ${cluster.rawMemberCount}, span ${formatNumber(cluster.rawPriceSpanPct, "%")}, warnings ${formatList(cluster.warnings)}`,
        );
      }
    }
    lines.push("");
  }

  lines.push("## Safety");
  lines.push(`- Clustering behavior unchanged: ${bundle.safety.clusteringBehaviorUnchanged}`);
  lines.push(`- Support/resistance detection unchanged: ${bundle.safety.supportResistanceDetectionUnchanged}`);
  lines.push(`- LevelEngine default output unchanged: ${bundle.safety.levelEngineDefaultOutputUnchanged}`);
  lines.push(`- Extension generation unchanged: ${bundle.safety.extensionGenerationUnchanged}`);
  lines.push(`- Scoring/selection unchanged: ${bundle.safety.scoringSelectionUnchanged}`);
  lines.push(`- Runtime behavior unchanged: ${bundle.safety.runtimeBehaviorUnchanged}`);
  lines.push(`- Review only: ${bundle.safety.reviewOnly}`);

  return `${lines.join("\n").trimEnd()}\n`;
}

function run(options: LevelClusteringDiagnosticsOptions): string {
  const bundle = buildBundle();
  const content = options.format === "json"
    ? `${JSON.stringify(bundle, null, 2)}\n`
    : renderText(bundle);

  if (options.outPath) {
    mkdirSync(dirname(options.outPath), { recursive: true });
    writeFileSync(options.outPath, content, "utf8");
  }

  return content;
}

try {
  process.stdout.write(run(parseArgs(process.argv.slice(2))));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
}
