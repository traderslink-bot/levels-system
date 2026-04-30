// 2026-04-17 11:28 PM America/Toronto
// Run a deterministic side-by-side comparison between the old bucketed level ranking path and the newer strength ranking layer.

import type { Candle, CandleTimeframe } from "../lib/market-data/candle-types.js";
import {
  compareLevelRankingPaths,
  CURRENT_OLD_LEVEL_RUNTIME_PATH,
  type LevelRankingComparisonInput,
  type LevelRankingComparisonResult,
} from "../lib/levels/level-ranking-comparison.js";

type ComparisonFixture = LevelRankingComparisonInput;

function buildOscillatingCandles(params: {
  bars: number;
  startTimestamp: number;
  stepMs: number;
  base: number;
  trendPerBar: number;
  amplitude: number;
  cycle: number;
  noise: number;
  volumeBase: number;
  volumeStep: number;
}): Candle[] {
  return Array.from({ length: params.bars }, (_, index) => {
    const anchor =
      params.base +
      index * params.trendPerBar +
      Math.sin(index / params.cycle) * params.amplitude +
      Math.cos(index / (params.cycle * 0.7)) * params.noise;
    const close = Number(anchor.toFixed(4));
    const open = Number((close - params.amplitude * 0.08 * Math.sin((index + 1) / params.cycle)).toFixed(4));
    const high = Number((Math.max(open, close) + params.amplitude * 0.35 + (index % 9 === 0 ? params.amplitude * 0.5 : 0)).toFixed(4));
    const low = Number((Math.min(open, close) - params.amplitude * 0.35 - (index % 11 === 0 ? params.amplitude * 0.4 : 0)).toFixed(4));
    const volume = Math.round(
      params.volumeBase +
        index * params.volumeStep +
        Math.abs(Math.sin(index / params.cycle)) * params.volumeBase * 0.35 +
        (index % 13 === 0 ? params.volumeBase * 0.4 : 0),
    );

    return {
      timestamp: params.startTimestamp + index * params.stepMs,
      open,
      high,
      low,
      close,
      volume,
    };
  });
}

function buildFixtures(): ComparisonFixture[] {
  const now = Date.parse("2026-04-17T20:00:00Z");

  const albtDaily = buildOscillatingCandles({
    bars: 90,
    startTimestamp: now - 90 * 24 * 60 * 60 * 1000,
    stepMs: 24 * 60 * 60 * 1000,
    base: 2.2,
    trendPerBar: 0.01,
    amplitude: 0.22,
    cycle: 4.8,
    noise: 0.05,
    volumeBase: 180_000,
    volumeStep: 900,
  });
  const albt4h = buildOscillatingCandles({
    bars: 140,
    startTimestamp: now - 140 * 4 * 60 * 60 * 1000,
    stepMs: 4 * 60 * 60 * 1000,
    base: 2.7,
    trendPerBar: 0.004,
    amplitude: 0.13,
    cycle: 5.5,
    noise: 0.04,
    volumeBase: 65_000,
    volumeStep: 220,
  });
  const albt5m = buildOscillatingCandles({
    bars: 180,
    startTimestamp: now - 180 * 5 * 60 * 1000,
    stepMs: 5 * 60 * 1000,
    base: 3.02,
    trendPerBar: 0.0008,
    amplitude: 0.055,
    cycle: 7,
    noise: 0.018,
    volumeBase: 14_000,
    volumeStep: 25,
  });

  const gxaiDaily = buildOscillatingCandles({
    bars: 85,
    startTimestamp: now - 85 * 24 * 60 * 60 * 1000,
    stepMs: 24 * 60 * 60 * 1000,
    base: 1.1,
    trendPerBar: 0.007,
    amplitude: 0.28,
    cycle: 4.2,
    noise: 0.06,
    volumeBase: 240_000,
    volumeStep: 1200,
  });
  const gxai4h = buildOscillatingCandles({
    bars: 150,
    startTimestamp: now - 150 * 4 * 60 * 60 * 1000,
    stepMs: 4 * 60 * 60 * 1000,
    base: 1.45,
    trendPerBar: 0.003,
    amplitude: 0.15,
    cycle: 5.1,
    noise: 0.03,
    volumeBase: 72_000,
    volumeStep: 180,
  });
  const gxai5m = buildOscillatingCandles({
    bars: 190,
    startTimestamp: now - 190 * 5 * 60 * 1000,
    stepMs: 5 * 60 * 1000,
    base: 1.88,
    trendPerBar: 0.0007,
    amplitude: 0.07,
    cycle: 6.3,
    noise: 0.022,
    volumeBase: 21_000,
    volumeStep: 22,
  });

  const tovxDaily = buildOscillatingCandles({
    bars: 95,
    startTimestamp: now - 95 * 24 * 60 * 60 * 1000,
    stepMs: 24 * 60 * 60 * 1000,
    base: 0.23,
    trendPerBar: 0.0009,
    amplitude: 0.045,
    cycle: 5.4,
    noise: 0.01,
    volumeBase: 390_000,
    volumeStep: 1800,
  });
  const tovx4h = buildOscillatingCandles({
    bars: 140,
    startTimestamp: now - 140 * 4 * 60 * 60 * 1000,
    stepMs: 4 * 60 * 60 * 1000,
    base: 0.27,
    trendPerBar: 0.00035,
    amplitude: 0.03,
    cycle: 4.8,
    noise: 0.008,
    volumeBase: 150_000,
    volumeStep: 420,
  });
  const tovx5m = buildOscillatingCandles({
    bars: 220,
    startTimestamp: now - 220 * 5 * 60 * 1000,
    stepMs: 5 * 60 * 1000,
    base: 0.332,
    trendPerBar: 0.00008,
    amplitude: 0.012,
    cycle: 7.4,
    noise: 0.004,
    volumeBase: 38_000,
    volumeStep: 18,
  });

  return [
    {
      symbol: "ALBT",
      currentPrice: albt5m.at(-1)?.close ?? 3.05,
      candlesByTimeframe: {
        daily: albtDaily,
        "4h": albt4h,
        "5m": albt5m,
      },
      currentTimeframe: "5m",
      maxComparableLevels: 6,
    },
    {
      symbol: "GXAI",
      currentPrice: gxai5m.at(-1)?.close ?? 1.9,
      candlesByTimeframe: {
        daily: gxaiDaily,
        "4h": gxai4h,
        "5m": gxai5m,
      },
      currentTimeframe: "5m",
      maxComparableLevels: 6,
    },
    {
      symbol: "TOVX",
      currentPrice: tovx5m.at(-1)?.close ?? 0.332,
      candlesByTimeframe: {
        daily: tovxDaily,
        "4h": tovx4h,
        "5m": tovx5m,
      },
      currentTimeframe: "5m",
      maxComparableLevels: 6,
    },
  ];
}

function formatLevel(level: LevelRankingComparisonResult["oldPath"]["topSupport"]): string {
  if (!level) {
    return "none";
  }

  const extras: string[] = [];
  if (typeof level.score === "number") {
    extras.push(`score=${level.score.toFixed(2)}`);
  }
  if (level.confidence !== undefined) {
    extras.push(`confidence=${level.confidence.toFixed(0)}`);
  }
  if (level.state) {
    extras.push(`state=${level.state}`);
  }
  if (level.bucket) {
    extras.push(`bucket=${level.bucket}`);
  }

  return `${level.price.toFixed(level.price >= 1 ? 2 : 4)} [${extras.join(" | ")}]`;
}

function classifyResult(result: LevelRankingComparisonResult): "improvement" | "regression" | "mixed" {
  if (result.migrationReadiness.regressions.length === 0 && result.migrationReadiness.improvements.length > 0) {
    return "improvement";
  }

  if (result.migrationReadiness.regressions.length > result.migrationReadiness.improvements.length) {
    return "regression";
  }

  return "mixed";
}

async function main(): Promise<void> {
  const fixtures = buildFixtures();
  const results = fixtures.map((fixture) => compareLevelRankingPaths(fixture));

  console.log("LEVEL RANKING COMPARISON");
  console.log(`Old producer: ${CURRENT_OLD_LEVEL_RUNTIME_PATH.producer.file} -> ${CURRENT_OLD_LEVEL_RUNTIME_PATH.producer.functionName}`);
  console.log("");

  for (const result of results) {
    console.log(`SYMBOL: ${result.symbol} | price=${result.currentPrice.toFixed(result.currentPrice >= 1 ? 2 : 4)} | candidates=${result.rawCandidateCount}`);
    console.log(`OLD top support: ${formatLevel(result.oldPath.topSupport)}`);
    console.log(`NEW top support: ${formatLevel(result.newPath.topSupport)}`);
    console.log(`OLD top resistance: ${formatLevel(result.oldPath.topResistance)}`);
    console.log(`NEW top resistance: ${formatLevel(result.newPath.topResistance)}`);
    console.log(
      `Top changes: support=${result.differences.changedTopSupport ? "yes" : "no"} | resistance=${result.differences.changedTopResistance ? "yes" : "no"}`,
    );
    console.log(
      `Duplicates: old=${result.differences.oldNearbyDuplicateCount} | new=${result.differences.newNearbyDuplicateCount} | improved=${result.differences.duplicateSuppressionImproved ? "yes" : "no"}`,
    );
    console.log(
      `Summary: ${classifyResult(result)} | readiness=${result.migrationReadiness.category}`,
    );
    if (result.differences.noteworthyDisagreements.length > 0) {
      console.log(`Notable: ${result.differences.noteworthyDisagreements.join(" ; ")}`);
    }
    console.log("");
  }

  const topSupportChanged = results.filter((result) => result.differences.changedTopSupport).length;
  const topResistanceChanged = results.filter((result) => result.differences.changedTopResistance).length;
  const duplicateImproved = results.filter((result) => result.differences.duplicateSuppressionImproved).length;
  const clearlyBetter = results.filter((result) => classifyResult(result) === "improvement").length;
  const needsManualReview = results.filter(
    (result) =>
      result.differences.changedTopSupport ||
      result.differences.changedTopResistance ||
      result.migrationReadiness.category !== "ready_for_optional_runtime_flag",
  ).length;

  console.log("AGGREGATE SUMMARY");
  console.log(`Symbols compared: ${results.length}`);
  console.log(`Top support changed: ${topSupportChanged}`);
  console.log(`Top resistance changed: ${topResistanceChanged}`);
  console.log(`Duplicate suppression improved: ${duplicateImproved}`);
  console.log(`New ranking appears clearly better: ${clearlyBetter}`);
  console.log(`Needs manual review: ${needsManualReview}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
