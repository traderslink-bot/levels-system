import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { buildLevelCandidatePoolDiagnostics } from "../lib/levels/level-candidate-pool-diagnostics.js";
import { clusterRawLevelCandidates } from "../lib/levels/level-clusterer.js";
import { DEFAULT_LEVEL_ENGINE_CONFIG } from "../lib/levels/level-config.js";
import { rankLevelZones } from "../lib/levels/level-ranker.js";
import { scoreLevelZones } from "../lib/levels/level-scorer.js";
import { buildRawLevelCandidates } from "../lib/levels/raw-level-candidate-builder.js";
import { buildSpecialLevelCandidates } from "../lib/levels/special-level-builder.js";
import { detectSwingPoints } from "../lib/levels/swing-detector.js";
import type { Candle, CandleTimeframe } from "../lib/market-data/candle-types.js";
import type {
  FinalLevelZone,
  LevelDataFreshness,
  RawLevelCandidate,
} from "../lib/levels/level-types.js";

type CandidatePoolDiagnosticsFormat = "text" | "json";

type CandidatePoolDiagnosticsOptions = {
  outPath?: string;
  format: CandidatePoolDiagnosticsFormat;
};

type GeneratedSampleSpec = {
  symbol: string;
  profile: string;
  dailyCloses: number[];
  fourHourCloses: number[];
  fiveMinuteCloses: number[];
};

type GeneratedPipelineSample = {
  symbol: string;
  profile: string;
  inputSource: "deterministic_generated_candles";
  candleCounts: Record<CandleTimeframe, number>;
  swingCounts: Record<CandleTimeframe, { support: number; resistance: number; total: number }>;
  rawCandidateCount: number;
  specialCandidateCount: number;
  clusteredCounts: { support: number; resistance: number };
  scoredCounts: { support: number; resistance: number };
  report: ReturnType<typeof buildLevelCandidatePoolDiagnostics>;
};

type CandidatePoolDiagnosticsBundle = {
  generatedAt: number;
  inputSource: "deterministic_generated_pipeline_data";
  samples: GeneratedPipelineSample[];
  summary: {
    sampleCount: number;
    rawCandidateCount: number;
    clusteredZoneCount: number;
    scoredZoneCount: number;
    surfacedLevelCount: number;
    extensionCandidateCount: number;
    selectedExtensionCount: number;
    samplesWithNoSupportExtensionCandidates: string[];
    samplesWithNoResistanceExtensionCandidates: string[];
    samplesWithRawToClusteredNarrowing: string[];
    samplesWithScoredToExtensionNarrowing: string[];
  };
  safety: {
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

function parseFormat(value: string | undefined): CandidatePoolDiagnosticsFormat {
  if (value === undefined) {
    return "text";
  }
  if (value === "text" || value === "json") {
    return value;
  }

  throw new Error(`Unsupported --format value "${value}". Expected text or json.`);
}

function parseArgs(args: string[]): CandidatePoolDiagnosticsOptions {
  let outPath: string | undefined;
  let format: CandidatePoolDiagnosticsFormat = "text";

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

function swingCounts(
  swings: ReturnType<typeof detectSwingPoints>,
): { support: number; resistance: number; total: number } {
  return {
    support: swings.filter((swing) => swing.kind === "support").length,
    resistance: swings.filter((swing) => swing.kind === "resistance").length,
    total: swings.length,
  };
}

function metadataForSeries(series: Record<CandleTimeframe, Candle[]>): {
  providerByTimeframe: Partial<Record<CandleTimeframe, string>>;
  dataQualityFlags: string[];
  freshness: LevelDataFreshness;
  referencePrice?: number;
} {
  return {
    providerByTimeframe: {
      daily: "deterministic-fixture",
      "4h": "deterministic-fixture",
      "5m": "deterministic-fixture",
    },
    dataQualityFlags: [],
    freshness: "fresh",
    referencePrice: series["5m"].at(-1)?.close ?? series["4h"].at(-1)?.close ?? series.daily.at(-1)?.close,
  };
}

function buildGeneratedPipelineSample(spec: GeneratedSampleSpec): GeneratedPipelineSample {
  const symbol = spec.symbol.toUpperCase();
  const series = buildSeries(spec);
  const rawCandidates: RawLevelCandidate[] = [];
  const swingSummary = {} as Record<CandleTimeframe, { support: number; resistance: number; total: number }>;

  for (const timeframe of ["daily", "4h", "5m"] as const) {
    const swings = detectSwingPoints(series[timeframe], {
      swingWindow: DEFAULT_LEVEL_ENGINE_CONFIG.timeframeConfig[timeframe].swingWindow,
      minimumDisplacementPct:
        DEFAULT_LEVEL_ENGINE_CONFIG.timeframeConfig[timeframe].minimumDisplacementPct,
      minimumSeparationBars:
        DEFAULT_LEVEL_ENGINE_CONFIG.timeframeConfig[timeframe].minimumSwingSeparationBars,
    });
    swingSummary[timeframe] = swingCounts(swings);
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

  const supportTolerance = Math.max(
    DEFAULT_LEVEL_ENGINE_CONFIG.timeframeConfig.daily.clusterTolerancePct,
    DEFAULT_LEVEL_ENGINE_CONFIG.timeframeConfig["4h"].clusterTolerancePct,
  );
  const resistanceTolerance = supportTolerance;
  const clusteredSupportZones = clusterRawLevelCandidates(
    symbol,
    "support",
    rawCandidates,
    supportTolerance,
    DEFAULT_LEVEL_ENGINE_CONFIG,
  );
  const clusteredResistanceZones = clusterRawLevelCandidates(
    symbol,
    "resistance",
    rawCandidates,
    resistanceTolerance,
    DEFAULT_LEVEL_ENGINE_CONFIG,
  );
  const scoredSupportZones = scoreLevelZones(clusteredSupportZones, DEFAULT_LEVEL_ENGINE_CONFIG);
  const scoredResistanceZones = scoreLevelZones(clusteredResistanceZones, DEFAULT_LEVEL_ENGINE_CONFIG);
  const metadata = metadataForSeries(series);
  const levelOutput = rankLevelZones({
    symbol,
    supportZones: scoredSupportZones,
    resistanceZones: scoredResistanceZones,
    specialLevels: special.summary,
    metadata,
    config: DEFAULT_LEVEL_ENGINE_CONFIG,
  });
  const report = buildLevelCandidatePoolDiagnostics({
    symbol,
    referencePrice: metadata.referencePrice,
    rawCandidates,
    clusteredSupportZones,
    clusteredResistanceZones,
    scoredSupportZones,
    scoredResistanceZones,
    levelOutput,
  });

  return {
    symbol,
    profile: spec.profile,
    inputSource: "deterministic_generated_candles",
    candleCounts: {
      daily: series.daily.length,
      "4h": series["4h"].length,
      "5m": series["5m"].length,
    },
    swingCounts: swingSummary,
    rawCandidateCount: rawCandidates.length,
    specialCandidateCount: special.candidates.length,
    clusteredCounts: {
      support: clusteredSupportZones.length,
      resistance: clusteredResistanceZones.length,
    },
    scoredCounts: {
      support: scoredSupportZones.length,
      resistance: scoredResistanceZones.length,
    },
    report,
  };
}

function buildBundle(): CandidatePoolDiagnosticsBundle {
  const originalNow = Date.now;
  Date.now = () => GENERATED_AT;
  try {
    const samples = generatedSamples().map(buildGeneratedPipelineSample);

    return {
      generatedAt: GENERATED_AT,
      inputSource: "deterministic_generated_pipeline_data",
      samples,
      summary: {
        sampleCount: samples.length,
        rawCandidateCount: samples.reduce((sum, sample) => sum + sample.report.summary.rawCandidateCount, 0),
        clusteredZoneCount: samples.reduce((sum, sample) => sum + sample.report.summary.clusteredZoneCount, 0),
        scoredZoneCount: samples.reduce((sum, sample) => sum + sample.report.summary.scoredZoneCount, 0),
        surfacedLevelCount: samples.reduce((sum, sample) => sum + sample.report.summary.surfacedLevelCount, 0),
        extensionCandidateCount: samples.reduce((sum, sample) => sum + sample.report.summary.extensionCandidateCount, 0),
        selectedExtensionCount: samples.reduce((sum, sample) => sum + sample.report.summary.selectedExtensionCount, 0),
        samplesWithNoSupportExtensionCandidates: samples
          .filter((sample) => sample.report.support.extensionCandidates.total === 0)
          .map((sample) => sample.symbol),
        samplesWithNoResistanceExtensionCandidates: samples
          .filter((sample) => sample.report.resistance.extensionCandidates.total === 0)
          .map((sample) => sample.symbol),
        samplesWithRawToClusteredNarrowing: samples
          .filter((sample) =>
            sample.report.narrowing.some(
              (entry) => entry.from === "raw" && entry.to === "clustered" && entry.narrowed,
            ),
          )
          .map((sample) => sample.symbol),
        samplesWithScoredToExtensionNarrowing: samples
          .filter((sample) =>
            sample.report.narrowing.some(
              (entry) =>
                entry.from === "scored" &&
                entry.to === "extension_candidate" &&
                entry.narrowed,
            ),
          )
          .map((sample) => sample.symbol),
      },
      safety: {
        supportResistanceDetectionUnchanged: true,
        levelEngineDefaultOutputUnchanged: true,
        extensionGenerationUnchanged: true,
        scoringSelectionUnchanged: true,
        runtimeBehaviorUnchanged: true,
        reviewOnly: true,
      },
    };
  } finally {
    Date.now = originalNow;
  }
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

function formatNarrowing(sample: GeneratedPipelineSample): string[] {
  return sample.report.narrowing
    .filter((entry) => entry.narrowed)
    .map(
      (entry) =>
        `  - ${entry.side} ${entry.note}: ${entry.fromCount} -> ${entry.toCount} (${entry.delta} fewer)`,
    );
}

function renderText(bundle: CandidatePoolDiagnosticsBundle): string {
  const lines: string[] = [
    "Level candidate pool diagnostics review",
    "",
    "## Input Source",
    "- Deterministic generated candle fixtures.",
    "- Each sample runs the existing pipeline: swing detection, raw candidate building, special levels, clustering, scoring, ranking, and candidate-pool diagnostics.",
    "- Output-only LevelEngine fixtures are not used as full-pipeline inputs because they do not contain raw, clustered, or scored inventories.",
    "",
    "## Summary",
    `- Sample count: ${bundle.summary.sampleCount}`,
    `- Raw candidates: ${bundle.summary.rawCandidateCount}`,
    `- Clustered zones: ${bundle.summary.clusteredZoneCount}`,
    `- Scored zones: ${bundle.summary.scoredZoneCount}`,
    `- Surfaced levels: ${bundle.summary.surfacedLevelCount}`,
    `- Extension candidates: ${bundle.summary.extensionCandidateCount}`,
    `- Selected extensions: ${bundle.summary.selectedExtensionCount}`,
    `- Samples with no support extension candidates: ${formatList(bundle.summary.samplesWithNoSupportExtensionCandidates)}`,
    `- Samples with no resistance extension candidates: ${formatList(bundle.summary.samplesWithNoResistanceExtensionCandidates)}`,
    `- Samples with raw-to-clustered narrowing: ${formatList(bundle.summary.samplesWithRawToClusteredNarrowing)}`,
    `- Samples with scored-to-extension narrowing: ${formatList(bundle.summary.samplesWithScoredToExtensionNarrowing)}`,
    "",
    "## Samples",
  ];

  for (const sample of bundle.samples) {
    const report = sample.report;
    lines.push(`### ${sample.symbol} - ${sample.profile}`);
    lines.push(`- Reference price: ${formatNumber(report.referencePrice)}`);
    lines.push(`- Candles: daily ${sample.candleCounts.daily}, 4h ${sample.candleCounts["4h"]}, 5m ${sample.candleCounts["5m"]}`);
    lines.push(`- Swings: daily ${sample.swingCounts.daily.total}, 4h ${sample.swingCounts["4h"].total}, 5m ${sample.swingCounts["5m"].total}`);
    lines.push(`- Raw candidates: ${report.summary.rawCandidateCount}`);
    lines.push(`- Clustered zones: ${report.summary.clusteredZoneCount}`);
    lines.push(`- Scored zones: ${report.summary.scoredZoneCount}`);
    lines.push(`- Surfaced levels: ${report.summary.surfacedLevelCount}`);
    lines.push(`- Extension candidates: ${report.summary.extensionCandidateCount}`);
    lines.push(`- Selected extensions: ${report.summary.selectedExtensionCount}`);
    lines.push(`- Support raw/clustered/scored/surfaced/ext-candidate/selected: ${report.support.raw.total}/${report.support.clustered.total}/${report.support.scored.total}/${report.support.surfaced.total}/${report.support.extensionCandidates.total}/${report.support.selectedExtensions.total}`);
    lines.push(`- Resistance raw/clustered/scored/surfaced/ext-candidate/selected: ${report.resistance.raw.total}/${report.resistance.clustered.total}/${report.resistance.scored.total}/${report.resistance.surfaced.total}/${report.resistance.extensionCandidates.total}/${report.resistance.selectedExtensions.total}`);
    lines.push(`- Support depth below reference: ${report.support.scored.depth.belowReferenceCount} levels, deepest ${formatNumber(report.support.scored.depth.deepestBelowReferencePct, "%")}`);
    lines.push(`- Resistance depth above reference: ${report.resistance.scored.depth.aboveReferenceCount} levels, highest ${formatNumber(report.resistance.scored.depth.highestAboveReferencePct, "%")}`);
    lines.push(`- Support warnings: ${formatList(report.support.warnings)}`);
    lines.push(`- Resistance warnings: ${formatList(report.resistance.warnings)}`);
    lines.push("- Narrowing:");
    const narrowing = formatNarrowing(sample);
    lines.push(...(narrowing.length > 0 ? narrowing : ["  - none"]));
    lines.push("");
  }

  lines.push("## Safety");
  lines.push(`- Support/resistance detection unchanged: ${bundle.safety.supportResistanceDetectionUnchanged}`);
  lines.push(`- LevelEngine default output unchanged: ${bundle.safety.levelEngineDefaultOutputUnchanged}`);
  lines.push(`- Extension generation unchanged: ${bundle.safety.extensionGenerationUnchanged}`);
  lines.push(`- Scoring/selection unchanged: ${bundle.safety.scoringSelectionUnchanged}`);
  lines.push(`- Runtime behavior unchanged: ${bundle.safety.runtimeBehaviorUnchanged}`);
  lines.push(`- Review only: ${bundle.safety.reviewOnly}`);

  return `${lines.join("\n").trimEnd()}\n`;
}

function run(options: CandidatePoolDiagnosticsOptions): string {
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
