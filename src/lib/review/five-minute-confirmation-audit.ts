import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Candle, CandleProviderResponse } from "../market-data/candle-types.js";
import {
  describeLiveVolumeExpansionConfirmationQuality,
  evaluateLiveVolumeExpansionConfirmationQuality,
} from "../monitoring/live-confirmation-quality.js";

export type FiveMinuteConfirmationOutcome =
  | "target_hit"
  | "partial_progress"
  | "invalidated"
  | "no_progress";

export type FiveMinuteConfirmationRead = {
  present: boolean;
  volumeRatio: number | null;
  latestRangePct: number | null;
  priorRangePct: number | null;
  closeExtensionPct: number | null;
  triggerPrice: number | null;
  invalidationPrice: number | null;
  qualityRejectReasons: string[];
  summary: string;
};

export type FiveMinuteConfirmationSample = {
  symbol: string;
  cutoffTimestamp: number;
  cutoffIso: string;
  currentPrice: number;
  read: FiveMinuteConfirmationRead;
  outcome: FiveMinuteConfirmationOutcome;
  bestForwardPct: number;
  worstForwardPct: number;
  forwardBars: number;
  barsToTarget: number | null;
  invalidatedBeforeTarget: boolean;
  summary: string;
};

export type FiveMinuteConfirmationAuditSymbolInput = {
  symbol: string;
  fiveMinuteResponse: CandleProviderResponse | undefined;
};

export type BuildFiveMinuteConfirmationAuditOptions = {
  symbols: FiveMinuteConfirmationAuditSymbolInput[];
  source?: string;
  horizonBars?: number;
  targetMovePct?: number;
  partialMovePct?: number;
  maxExamples?: number;
};

export type FiveMinuteConfirmationAuditReport = {
  generatedAt: string;
  source: string;
  settings: {
    horizonBars: number;
    targetMovePct: number;
    partialMovePct: number;
  };
  totals: {
    symbols: number;
    symbolsWithUsable5m: number;
    evaluatedCutoffs: number;
    confirmationSamples: number;
    targetHit: number;
    partialProgress: number;
    invalidated: number;
    noProgress: number;
    avgBestForwardPct: number | null;
    avgWorstForwardPct: number | null;
  };
  samples: FiveMinuteConfirmationSample[];
  bestExamples: FiveMinuteConfirmationSample[];
  failedExamples: FiveMinuteConfirmationSample[];
};

export type WriteFiveMinuteConfirmationAuditOptions = BuildFiveMinuteConfirmationAuditOptions & {
  outputDirectory: string;
};

const DEFAULT_HORIZON_BARS = 24;
const DEFAULT_TARGET_MOVE_PCT = 15;
const DEFAULT_PARTIAL_MOVE_PCT = 8;

function formatPrice(value: number): string {
  return value >= 1 ? value.toFixed(2) : value.toFixed(4);
}

function formatPct(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function candleRange(candle: Candle): number {
  return candle.high - candle.low;
}

function upperCloseRatio(candle: Candle): number {
  const range = candleRange(candle);
  return range <= 0 ? 0 : (candle.close - candle.low) / range;
}

function isValidCandle(candle: Candle): boolean {
  return (
    Number.isFinite(candle.timestamp) &&
    Number.isFinite(candle.open) &&
    Number.isFinite(candle.high) &&
    Number.isFinite(candle.low) &&
    Number.isFinite(candle.close) &&
    Number.isFinite(candle.volume) &&
    candle.open > 0 &&
    candle.high > 0 &&
    candle.low > 0 &&
    candle.close > 0 &&
    candle.high >= candle.low &&
    candle.volume >= 0
  );
}

function normalizeCandles(candles: Candle[]): Candle[] {
  const byTimestamp = new Map<number, Candle>();
  for (const candle of candles) {
    if (!isValidCandle(candle)) {
      continue;
    }
    const existing = byTimestamp.get(candle.timestamp);
    if (!existing || candle.volume >= existing.volume) {
      byTimestamp.set(candle.timestamp, candle);
    }
  }
  return [...byTimestamp.values()].sort((left, right) => left.timestamp - right.timestamp);
}

function candleDateKey(candle: Candle): string {
  return new Date(candle.timestamp).toISOString().slice(0, 10);
}

function sameSessionCandles(candles: Candle[], cutoffIndex: number): Candle[] {
  const cutoff = candles[cutoffIndex];
  if (!cutoff) {
    return [];
  }
  const dateKey = candleDateKey(cutoff);
  return candles
    .slice(0, cutoffIndex + 1)
    .filter((candle) => candleDateKey(candle) === dateKey)
    .slice(-120);
}

function emptyRead(summary: string): FiveMinuteConfirmationRead {
  return {
    present: false,
    volumeRatio: null,
    latestRangePct: null,
    priorRangePct: null,
    closeExtensionPct: null,
    triggerPrice: null,
    invalidationPrice: null,
    qualityRejectReasons: [],
    summary,
  };
}

export function buildFiveMinuteConfirmationRead(candles: Candle[], cutoffIndex: number): FiveMinuteConfirmationRead {
  const session = sameSessionCandles(candles, cutoffIndex);
  const latest = session.at(-1);
  if (!latest || session.length < 18) {
    return emptyRead("Not enough same-session 5m candles for live confirmation.");
  }

  const prior = session.slice(-18, -1);
  const positiveVolumeCandles = prior.filter((candle) => candle.volume > 0);
  if (positiveVolumeCandles.length < 8 || latest.volume <= 0) {
    return emptyRead("Not enough usable 5m volume to confirm the move.");
  }

  const priorHigh = Math.max(...prior.map((candle) => candle.high));
  const priorLow = Math.min(...prior.map((candle) => candle.low));
  const priorRange = priorHigh - priorLow;
  const priorRangePct = (priorRange / Math.max(priorLow, 0.0001)) * 100;
  const latestRange = candleRange(latest);
  const latestRangePct = (latestRange / Math.max(latest.low, 0.0001)) * 100;
  const averagePriorVolume =
    positiveVolumeCandles.reduce((sum, candle) => sum + candle.volume, 0) / positiveVolumeCandles.length;
  const volumeRatio = latest.volume / Math.max(averagePriorVolume, 1);
  const currentPrice = latest.close;
  const brokeShortRange = latest.high >= priorHigh * 1.01 && currentPrice >= priorHigh * 0.995;
  const holdingExpansion = currentPrice >= Math.max(priorHigh * 0.995, latest.low + latestRange * 0.52);
  const strongClose = upperCloseRatio(latest) >= 0.58 || latest.close >= priorHigh;
  const closeExtensionPct = ((currentPrice - priorHigh) / Math.max(priorHigh, 0.0001)) * 100;
  const quality = evaluateLiveVolumeExpansionConfirmationQuality({
    currentPrice,
    latestRangePct,
    priorRangePct,
    closeExtensionPct,
    latestTimestamp: latest.timestamp,
  });
  const present =
    quality.passed &&
    brokeShortRange &&
    holdingExpansion &&
    strongClose &&
    volumeRatio >= 2;
  const invalidationPrice = Math.min(latest.low, priorHigh * 0.96);

  return {
    present,
    volumeRatio,
    latestRangePct,
    priorRangePct,
    closeExtensionPct,
    triggerPrice: priorHigh,
    invalidationPrice,
    qualityRejectReasons: quality.rejectReasons,
    summary: present
      ? `5m expansion confirmed above ${formatPrice(priorHigh)} on ${volumeRatio.toFixed(1)}x recent volume.`
      : `No live confirmation: ${volumeRatio.toFixed(1)}x volume, ${formatPct(latestRangePct)} latest 5m range, ${formatPct(closeExtensionPct)} extension, trigger ${formatPrice(priorHigh)}${
          quality.rejectReasons.length > 0 ? ` (${quality.rejectReasons.join("; ")})` : ""
        }.`,
  };
}

function evaluateForward(params: {
  currentPrice: number;
  invalidationPrice: number | null;
  forwardCandles: Candle[];
  targetMovePct: number;
  partialMovePct: number;
}): Pick<
  FiveMinuteConfirmationSample,
  "outcome" | "bestForwardPct" | "worstForwardPct" | "barsToTarget" | "invalidatedBeforeTarget" | "forwardBars"
> {
  const highs = params.forwardCandles.map((candle) => candle.high);
  const lows = params.forwardCandles.map((candle) => candle.low);
  const bestHigh = highs.length > 0 ? Math.max(...highs) : params.currentPrice;
  const worstLow = lows.length > 0 ? Math.min(...lows) : params.currentPrice;
  const bestForwardPct = ((bestHigh - params.currentPrice) / Math.max(params.currentPrice, 0.0001)) * 100;
  const worstForwardPct = ((worstLow - params.currentPrice) / Math.max(params.currentPrice, 0.0001)) * 100;
  let barsToTarget: number | null = null;
  let invalidatedBeforeTarget = false;

  for (let index = 0; index < params.forwardCandles.length; index += 1) {
    const candle = params.forwardCandles[index]!;
    if (params.invalidationPrice !== null && candle.low <= params.invalidationPrice && barsToTarget === null) {
      invalidatedBeforeTarget = true;
      break;
    }
    const forwardPct = ((candle.high - params.currentPrice) / Math.max(params.currentPrice, 0.0001)) * 100;
    if (forwardPct >= params.targetMovePct) {
      barsToTarget = index + 1;
      break;
    }
  }

  const outcome: FiveMinuteConfirmationOutcome = barsToTarget !== null
    ? "target_hit"
    : bestForwardPct >= params.partialMovePct
      ? "partial_progress"
      : invalidatedBeforeTarget
        ? "invalidated"
        : "no_progress";

  return {
    outcome,
    bestForwardPct,
    worstForwardPct,
    barsToTarget,
    invalidatedBeforeTarget,
    forwardBars: params.forwardCandles.length,
  };
}

function buildSample(params: {
  symbol: string;
  candles: Candle[];
  cutoffIndex: number;
  horizonBars: number;
  targetMovePct: number;
  partialMovePct: number;
}): FiveMinuteConfirmationSample | null {
  const read = buildFiveMinuteConfirmationRead(params.candles, params.cutoffIndex);
  if (!read.present) {
    return null;
  }

  const cutoff = params.candles[params.cutoffIndex]!;
  const currentPrice = cutoff.close;
  const evaluation = evaluateForward({
    currentPrice,
    invalidationPrice: read.invalidationPrice,
    forwardCandles: params.candles.slice(params.cutoffIndex + 1, params.cutoffIndex + 1 + params.horizonBars),
    targetMovePct: params.targetMovePct,
    partialMovePct: params.partialMovePct,
  });

  return {
    symbol: params.symbol,
    cutoffTimestamp: cutoff.timestamp,
    cutoffIso: new Date(cutoff.timestamp).toISOString(),
    currentPrice,
    read,
    ...evaluation,
    summary: `${params.symbol} had ${read.summary} Forward ${params.horizonBars}x5m best move was ${formatPct(evaluation.bestForwardPct)}; outcome ${evaluation.outcome}.`,
  };
}

function average(values: number[]): number | null {
  const finite = values.filter((value) => Number.isFinite(value));
  return finite.length === 0 ? null : finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

export function buildFiveMinuteConfirmationAudit(
  options: BuildFiveMinuteConfirmationAuditOptions,
): FiveMinuteConfirmationAuditReport {
  const horizonBars = Math.max(1, Math.floor(options.horizonBars ?? DEFAULT_HORIZON_BARS));
  const targetMovePct = Math.max(1, options.targetMovePct ?? DEFAULT_TARGET_MOVE_PCT);
  const partialMovePct = Math.max(1, Math.min(targetMovePct, options.partialMovePct ?? DEFAULT_PARTIAL_MOVE_PCT));
  const samples: FiveMinuteConfirmationSample[] = [];
  let evaluatedCutoffs = 0;
  let symbolsWithUsable5m = 0;

  for (const symbolInput of options.symbols) {
    const candles = normalizeCandles(symbolInput.fiveMinuteResponse?.candles ?? []);
    if (candles.length >= 18 + horizonBars) {
      symbolsWithUsable5m += 1;
    }

    for (let cutoffIndex = 17; cutoffIndex < candles.length - horizonBars; cutoffIndex += 1) {
      evaluatedCutoffs += 1;
      const sample = buildSample({
        symbol: symbolInput.symbol.toUpperCase(),
        candles,
        cutoffIndex,
        horizonBars,
        targetMovePct,
        partialMovePct,
      });
      if (sample) {
        samples.push(sample);
      }
    }
  }

  const maxExamples = Math.max(1, options.maxExamples ?? 20);
  return {
    generatedAt: new Date().toISOString(),
    source: options.source ?? "in-memory 5m candle series",
    settings: {
      horizonBars,
      targetMovePct,
      partialMovePct,
    },
    totals: {
      symbols: options.symbols.length,
      symbolsWithUsable5m,
      evaluatedCutoffs,
      confirmationSamples: samples.length,
      targetHit: samples.filter((sample) => sample.outcome === "target_hit").length,
      partialProgress: samples.filter((sample) => sample.outcome === "partial_progress").length,
      invalidated: samples.filter((sample) => sample.outcome === "invalidated").length,
      noProgress: samples.filter((sample) => sample.outcome === "no_progress").length,
      avgBestForwardPct: average(samples.map((sample) => sample.bestForwardPct)),
      avgWorstForwardPct: average(samples.map((sample) => sample.worstForwardPct)),
    },
    samples,
    bestExamples: [...samples]
      .sort((left, right) => right.bestForwardPct - left.bestForwardPct)
      .slice(0, maxExamples),
    failedExamples: samples
      .filter((sample) => sample.outcome === "invalidated" || sample.outcome === "no_progress")
      .sort((left, right) => left.bestForwardPct - right.bestForwardPct)
      .slice(0, maxExamples),
  };
}

function renderSample(sample: FiveMinuteConfirmationSample): string[] {
  return [
    `- ${sample.summary}`,
    `  - Cutoff: ${sample.cutoffIso}`,
    `  - Current: ${formatPrice(sample.currentPrice)}`,
    `  - Trigger: ${sample.read.triggerPrice === null ? "n/a" : formatPrice(sample.read.triggerPrice)}, invalidation: ${sample.read.invalidationPrice === null ? "n/a" : formatPrice(sample.read.invalidationPrice)}`,
    `  - Volume/range: ${sample.read.volumeRatio === null ? "n/a" : `${sample.read.volumeRatio.toFixed(1)}x`} volume, latest range ${sample.read.latestRangePct === null ? "n/a" : formatPct(sample.read.latestRangePct)}, prior range ${sample.read.priorRangePct === null ? "n/a" : formatPct(sample.read.priorRangePct)}, close extension ${sample.read.closeExtensionPct === null ? "n/a" : formatPct(sample.read.closeExtensionPct)}`,
    `  - Forward: best ${formatPct(sample.bestForwardPct)}, worst ${formatPct(sample.worstForwardPct)}, bars to target ${sample.barsToTarget ?? "n/a"}`,
  ];
}

function renderMarkdown(report: FiveMinuteConfirmationAuditReport): string {
  const lines: string[] = [];
  lines.push("# 5m Live Confirmation Audit");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Source: ${report.source}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Symbols scanned: ${report.totals.symbols}`);
  lines.push(`- Symbols with usable 5m: ${report.totals.symbolsWithUsable5m}`);
  lines.push(`- 5m cutoffs evaluated: ${report.totals.evaluatedCutoffs}`);
  lines.push(`- Confirmation samples: ${report.totals.confirmationSamples}`);
  lines.push(`- Target hit: ${report.totals.targetHit}`);
  lines.push(`- Partial progress: ${report.totals.partialProgress}`);
  lines.push(`- Invalidated: ${report.totals.invalidated}`);
  lines.push(`- No progress: ${report.totals.noProgress}`);
  lines.push(`- Average best forward: ${report.totals.avgBestForwardPct === null ? "n/a" : formatPct(report.totals.avgBestForwardPct)}`);
  lines.push(`- Average worst forward: ${report.totals.avgWorstForwardPct === null ? "n/a" : formatPct(report.totals.avgWorstForwardPct)}`);
  lines.push(`- Horizon: ${report.settings.horizonBars} forward 5m bars`);
  lines.push(`- Target move: ${formatPct(report.settings.targetMovePct)}`);
  lines.push(`- Partial move: ${formatPct(report.settings.partialMovePct)}`);
  lines.push(`- Quality gate: ${describeLiveVolumeExpansionConfirmationQuality()}`);
  lines.push("");
  lines.push("## Best Examples");
  lines.push("");
  if (report.bestExamples.length === 0) {
    lines.push("No 5m confirmation examples found.");
  } else {
    for (const sample of report.bestExamples) {
      lines.push(...renderSample(sample));
    }
  }
  lines.push("");
  lines.push("## Failed Or Noisy Examples");
  lines.push("");
  if (report.failedExamples.length === 0) {
    lines.push("No failed/noisy 5m confirmation examples found.");
  } else {
    for (const sample of report.failedExamples) {
      lines.push(...renderSample(sample));
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function writeFiveMinuteConfirmationAudit(
  options: WriteFiveMinuteConfirmationAuditOptions,
): FiveMinuteConfirmationAuditReport {
  const report = buildFiveMinuteConfirmationAudit(options);
  mkdirSync(options.outputDirectory, { recursive: true });
  writeFileSync(join(options.outputDirectory, "five-minute-confirmation-audit.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(options.outputDirectory, "five-minute-confirmation-audit.md"), renderMarkdown(report));
  return report;
}
