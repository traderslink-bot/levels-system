import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import type { Candle } from "../lib/market-data/candle-types.js";
import type { VolumeActivityDirection, VolumeActivityLabel } from "../lib/monitoring/volume-activity.js";

type AuditRow = {
  type?: string;
  operation?: string;
  status?: string;
  timestamp?: number;
  symbol?: string;
  title?: string;
  body?: string;
  messageKind?: string;
  eventType?: string;
};

type CachedCandleFile = {
  response?: {
    candles?: Candle[];
  };
};

type VolumeReplaySample = {
  symbol: string;
  timestamp: number;
  title?: string;
  eventType?: string;
  candleTimestamp: number;
  candleClose: number;
  candleVolume: number;
  baselineAverageVolume: number;
  relativeVolumeRatio: number;
  direction: VolumeActivityDirection;
  label: VolumeActivityLabel;
  reason: string;
};

type SymbolVolumeReplaySummary = {
  symbol: string;
  samples: number;
  matchedAlerts: number;
  unmatchedAlerts: number;
  byLabel: Record<VolumeActivityLabel, number>;
  averageRelativeVolumeRatio: number | null;
  strongestSamples: VolumeReplaySample[];
  thinnestSamples: VolumeReplaySample[];
};

type VolumeReplayReport = {
  generatedAt: string;
  sourceAuditPath: string;
  cacheDirectory: string;
  approximate: true;
  note: string;
  totals: {
    alertRows: number;
    matchedAlerts: number;
    unmatchedAlerts: number;
    symbolsWithMatches: number;
    byLabel: Record<VolumeActivityLabel, number>;
  };
  perSymbol: SymbolVolumeReplaySummary[];
  notableSamples: {
    strongOrExpanding: VolumeReplaySample[];
    thinOrFading: VolumeReplaySample[];
  };
};

const LABELS: VolumeActivityLabel[] = ["strong", "expanding", "normal", "thin", "fading", "unknown"];
const FIVE_MINUTES_MS = 5 * 60 * 1000;
const DEFAULT_MAX_TIMESTAMP_DRIFT_MS = 90 * 60 * 1000;
const DEFAULT_BASELINE_BARS = 20;
const MIN_BASELINE_BARS = 10;

function emptyLabelCounts(): Record<VolumeActivityLabel, number> {
  return LABELS.reduce((counts, label) => {
    counts[label] = 0;
    return counts;
  }, {} as Record<VolumeActivityLabel, number>);
}

function readFlag(name: string): string | undefined {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`))?.split("=")[1];
  if (inline !== undefined) {
    return inline;
  }
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function resolveAuditPath(input: string): string {
  const resolved = resolve(input);
  if (!existsSync(resolved)) {
    throw new Error(`Path not found: ${resolved}`);
  }
  if (statSync(resolved).isDirectory()) {
    return join(resolved, "discord-delivery-audit.jsonl");
  }
  return resolved;
}

function readAuditRows(auditPath: string): AuditRow[] {
  return readFileSync(auditPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as AuditRow)
    .filter((row) => row.type === "discord_delivery_audit");
}

function readCachedCandlesForSymbol(params: {
  cacheDirectory: string;
  provider: string;
  symbol: string;
  timeframe: string;
}): Candle[] {
  const symbolDirectory = join(
    params.cacheDirectory,
    params.provider,
    params.symbol.toUpperCase(),
    params.timeframe,
  );
  if (!existsSync(symbolDirectory)) {
    return [];
  }

  const candlesByTimestamp = new Map<number, Candle>();
  for (const file of readdirSync(symbolDirectory, { withFileTypes: true })) {
    if (!file.isFile() || !file.name.endsWith(".json")) {
      continue;
    }
    const fullPath = join(symbolDirectory, file.name);
    const parsed = JSON.parse(readFileSync(fullPath, "utf8")) as CachedCandleFile;
    for (const candle of parsed.response?.candles ?? []) {
      if (
        Number.isFinite(candle.timestamp) &&
        Number.isFinite(candle.volume) &&
        candle.volume >= 0
      ) {
        candlesByTimestamp.set(candle.timestamp, candle);
      }
    }
  }

  return [...candlesByTimestamp.values()].sort((left, right) => left.timestamp - right.timestamp);
}

function classifyDirection(currentVolume: number, previousVolume: number | undefined): VolumeActivityDirection {
  if (!Number.isFinite(previousVolume) || previousVolume === undefined || previousVolume <= 0) {
    return "unknown";
  }
  if (currentVolume <= previousVolume * 0.8) {
    return "fading";
  }
  if (currentVolume >= previousVolume * 1.15) {
    return "increasing";
  }
  return "flat";
}

function classifyLabel(ratio: number, direction: VolumeActivityDirection): VolumeActivityLabel {
  if (direction === "fading" && ratio < 1) {
    return "fading";
  }
  if (ratio >= 2) {
    return "strong";
  }
  if (ratio >= 1.4 && direction !== "fading") {
    return "expanding";
  }
  if (ratio < 0.75) {
    return direction === "fading" ? "fading" : "thin";
  }
  return "normal";
}

function replayVolumeForAlert(params: {
  row: AuditRow;
  candles: Candle[];
  baselineBars: number;
  maxTimestampDriftMs: number;
}): VolumeReplaySample | null {
  if (!params.row.timestamp || !params.row.symbol) {
    return null;
  }

  let candleIndex = -1;
  for (let index = params.candles.length - 1; index >= 0; index -= 1) {
    if (params.candles[index]!.timestamp <= params.row.timestamp) {
      candleIndex = index;
      break;
    }
  }
  if (candleIndex < 0) {
    return null;
  }

  const candle = params.candles[candleIndex]!;
  if (Math.abs(params.row.timestamp - candle.timestamp) > params.maxTimestampDriftMs) {
    return null;
  }

  const baselineWindow = params.candles
    .slice(Math.max(0, candleIndex - params.baselineBars), candleIndex)
    .filter((baselineCandle) => baselineCandle.volume > 0);
  if (baselineWindow.length < MIN_BASELINE_BARS || candle.volume <= 0) {
    return null;
  }

  const baselineAverageVolume =
    baselineWindow.reduce((sum, baselineCandle) => sum + baselineCandle.volume, 0) /
    baselineWindow.length;
  if (!Number.isFinite(baselineAverageVolume) || baselineAverageVolume <= 0) {
    return null;
  }

  const previousVolume = params.candles[candleIndex - 1]?.volume;
  const direction = classifyDirection(candle.volume, previousVolume);
  const relativeVolumeRatio = candle.volume / baselineAverageVolume;
  const label = classifyLabel(relativeVolumeRatio, direction);
  return {
    symbol: params.row.symbol.toUpperCase(),
    timestamp: params.row.timestamp,
    title: params.row.title,
    eventType: params.row.eventType,
    candleTimestamp: candle.timestamp,
    candleClose: candle.close,
    candleVolume: candle.volume,
    baselineAverageVolume,
    relativeVolumeRatio: Number(relativeVolumeRatio.toFixed(4)),
    direction,
    label,
    reason: `5m candle volume was ${relativeVolumeRatio.toFixed(2)}x the prior ${baselineWindow.length}-bar average`,
  };
}

function buildReport(params: {
  auditPath: string;
  cacheDirectory: string;
  provider: string;
  baselineBars: number;
  maxTimestampDriftMs: number;
}): VolumeReplayReport {
  const rows = readAuditRows(params.auditPath);
  const alertRows = rows.filter(
    (row) =>
      row.operation === "post_alert" &&
      row.status === "posted" &&
      row.symbol &&
      row.timestamp &&
      (row.messageKind === "intelligent_alert" || row.messageKind === "level_clear_update"),
  );
  const symbols = [...new Set(alertRows.map((row) => row.symbol!.toUpperCase()))].sort();
  const candlesBySymbol = new Map(
    symbols.map((symbol) => [
      symbol,
      readCachedCandlesForSymbol({
        cacheDirectory: params.cacheDirectory,
        provider: params.provider,
        symbol,
        timeframe: "5m",
      }),
    ]),
  );

  const samples: VolumeReplaySample[] = [];
  let unmatchedAlerts = 0;
  for (const row of alertRows) {
    const candles = candlesBySymbol.get(row.symbol!.toUpperCase()) ?? [];
    const sample = replayVolumeForAlert({
      row,
      candles,
      baselineBars: params.baselineBars,
      maxTimestampDriftMs: params.maxTimestampDriftMs,
    });
    if (sample) {
      samples.push(sample);
    } else {
      unmatchedAlerts += 1;
    }
  }

  const byLabel = emptyLabelCounts();
  for (const sample of samples) {
    byLabel[sample.label] += 1;
  }

  const perSymbol = symbols
    .map((symbol): SymbolVolumeReplaySummary => {
      const symbolSamples = samples.filter((sample) => sample.symbol === symbol);
      const symbolRows = alertRows.filter((row) => row.symbol?.toUpperCase() === symbol);
      const symbolByLabel = emptyLabelCounts();
      for (const sample of symbolSamples) {
        symbolByLabel[sample.label] += 1;
      }
      return {
        symbol,
        samples: symbolSamples.length,
        matchedAlerts: symbolSamples.length,
        unmatchedAlerts: Math.max(0, symbolRows.length - symbolSamples.length),
        byLabel: symbolByLabel,
        averageRelativeVolumeRatio:
          symbolSamples.length > 0
            ? Number(
                (
                  symbolSamples.reduce((sum, sample) => sum + sample.relativeVolumeRatio, 0) /
                  symbolSamples.length
                ).toFixed(4),
              )
            : null,
        strongestSamples: [...symbolSamples]
          .sort((left, right) => right.relativeVolumeRatio - left.relativeVolumeRatio)
          .slice(0, 5),
        thinnestSamples: [...symbolSamples]
          .sort((left, right) => left.relativeVolumeRatio - right.relativeVolumeRatio)
          .slice(0, 5),
      };
    })
    .filter((summary) => summary.samples > 0 || summary.unmatchedAlerts > 0)
    .sort((left, right) => right.samples - left.samples || left.symbol.localeCompare(right.symbol));

  return {
    generatedAt: new Date().toISOString(),
    sourceAuditPath: params.auditPath,
    cacheDirectory: params.cacheDirectory,
    approximate: true,
    note:
      "This replays saved alert timestamps against cached completed 5-minute candle volume. It is useful for old-session sanity checks, but it is not an exact replay of live IBKR cumulative volume ticks.",
    totals: {
      alertRows: alertRows.length,
      matchedAlerts: samples.length,
      unmatchedAlerts,
      symbolsWithMatches: perSymbol.filter((summary) => summary.samples > 0).length,
      byLabel,
    },
    perSymbol,
    notableSamples: {
      strongOrExpanding: samples
        .filter((sample) => sample.label === "strong" || sample.label === "expanding")
        .sort((left, right) => right.relativeVolumeRatio - left.relativeVolumeRatio)
        .slice(0, 20),
      thinOrFading: samples
        .filter((sample) => sample.label === "thin" || sample.label === "fading")
        .sort((left, right) => left.relativeVolumeRatio - right.relativeVolumeRatio)
        .slice(0, 20),
    },
  };
}

function formatSample(sample: VolumeReplaySample): string {
  return `${new Date(sample.timestamp).toISOString()} ${sample.symbol} ${sample.title ?? sample.eventType ?? "alert"}: ${sample.label} (${sample.relativeVolumeRatio.toFixed(2)}x, ${sample.direction})`;
}

function formatMarkdown(report: VolumeReplayReport): string {
  const lines = [
    "# Volume Activity Candle Replay",
    "",
    `Generated: ${report.generatedAt}`,
    `Source audit: ${report.sourceAuditPath}`,
    `Cache: ${report.cacheDirectory}`,
    "",
    "> Approximate: this uses completed cached 5-minute candle volume near old alert timestamps, not the exact live IBKR cumulative volume stream.",
    "",
    "## Totals",
    "",
    `- alert rows checked: ${report.totals.alertRows}`,
    `- matched alerts: ${report.totals.matchedAlerts}`,
    `- unmatched alerts: ${report.totals.unmatchedAlerts}`,
    `- symbols with matches: ${report.totals.symbolsWithMatches}`,
    `- labels: strong ${report.totals.byLabel.strong}, expanding ${report.totals.byLabel.expanding}, normal ${report.totals.byLabel.normal}, thin ${report.totals.byLabel.thin}, fading ${report.totals.byLabel.fading}`,
    "",
    "## Strong / Expanding Examples",
    "",
    ...(report.notableSamples.strongOrExpanding.length > 0
      ? report.notableSamples.strongOrExpanding.map((sample) => `- ${formatSample(sample)}`)
      : ["- none"]),
    "",
    "## Thin / Fading Examples",
    "",
    ...(report.notableSamples.thinOrFading.length > 0
      ? report.notableSamples.thinOrFading.map((sample) => `- ${formatSample(sample)}`)
      : ["- none"]),
    "",
    "## Per Symbol",
    "",
  ];

  for (const summary of report.perSymbol) {
    lines.push(
      `### ${summary.symbol}`,
      "",
      `- matched / unmatched: ${summary.matchedAlerts} / ${summary.unmatchedAlerts}`,
      `- average relative volume: ${summary.averageRelativeVolumeRatio ?? "n/a"}`,
      `- labels: strong ${summary.byLabel.strong}, expanding ${summary.byLabel.expanding}, normal ${summary.byLabel.normal}, thin ${summary.byLabel.thin}, fading ${summary.byLabel.fading}`,
      "",
    );
  }

  return `${lines.join("\n")}\n`;
}

function run(): void {
  const input = process.argv[2];
  if (!input) {
    console.error(
      "Usage: npm run volume:replay -- <session-folder-or-discord-audit.jsonl> [--output artifacts\\volume-replay] [--cache .validation-cache\\candles]",
    );
    process.exit(1);
  }

  const auditPath = resolveAuditPath(input);
  if (!existsSync(auditPath)) {
    throw new Error(`Discord audit file not found: ${auditPath}`);
  }

  const cacheDirectory = resolve(readFlag("--cache") ?? join(".validation-cache", "candles"));
  const outputDirectory = resolve(readFlag("--output") ?? join(dirname(auditPath), "volume-activity-replay"));
  const provider = readFlag("--provider") ?? "ibkr";
  const baselineBars = Number.parseInt(readFlag("--baseline-bars") ?? String(DEFAULT_BASELINE_BARS), 10);
  const maxTimestampDriftMs = Number.parseInt(readFlag("--max-drift-ms") ?? String(DEFAULT_MAX_TIMESTAMP_DRIFT_MS), 10);
  const report = buildReport({
    auditPath,
    cacheDirectory,
    provider,
    baselineBars,
    maxTimestampDriftMs,
  });

  mkdirSync(outputDirectory, { recursive: true });
  const jsonPath = join(outputDirectory, "volume-activity-replay.json");
  const markdownPath = join(outputDirectory, "volume-activity-replay.md");
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(markdownPath, formatMarkdown(report));

  console.log(`Volume replay checked ${report.totals.alertRows} alert rows.`);
  console.log(`Matched ${report.totals.matchedAlerts}; unmatched ${report.totals.unmatchedAlerts}.`);
  console.log(
    `Labels: strong ${report.totals.byLabel.strong}, expanding ${report.totals.byLabel.expanding}, normal ${report.totals.byLabel.normal}, thin ${report.totals.byLabel.thin}, fading ${report.totals.byLabel.fading}.`,
  );
  console.log(`Wrote ${jsonPath}`);
  console.log(`Wrote ${markdownPath}`);
}

run();
