import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import type { Candle, CandleFetchTimeframe, CandleProviderName } from "../market-data/candle-types.js";
import type { FinalLevelZone, LevelEngineOutput } from "../levels/level-types.js";
import {
  buildSupportResistanceContextFromCandles,
  DurableCandleWarehouse,
  type SupportResistanceContext,
} from "../support-resistance/index.js";
import {
  buildCandleMarketStructureContext,
  type CandleMarketStructureConfidence,
  type CandleMarketStructureState,
} from "../structure/index.js";
import {
  validateForwardReactions,
  type ForwardReactionLevelResult,
  type ForwardReactionSummary,
  type ForwardReactionValidationReport,
  type ForwardReactionVolumeSummary,
} from "../validation/forward-reaction-validator.js";

type AuditRow = {
  operation?: string;
  status?: string;
  timestamp?: number;
  sourceTimestamp?: number;
  symbol?: string;
  title?: string;
  body?: string;
  bodyPreview?: string;
};

type CachedCandleEntry = {
  request?: {
    symbol?: string;
    timeframe?: CandleFetchTimeframe;
    provider?: CandleProviderName;
  };
  response?: {
    symbol?: string;
    timeframe?: CandleFetchTimeframe;
    candles?: Candle[];
  };
  candles?: Candle[];
};

export type SupportResistanceCalibrationVerdict = "trusted" | "watch" | "broken" | "unproven";
export type SupportResistanceCalibrationCoveragePriority = "fetch_first" | "fetch_next" | "fetch_later";

export type SupportResistanceCalibrationCoverageGap = {
  symbol: string;
  sessionDate: string | null;
  timeframe: CandleFetchTimeframe;
  priority: SupportResistanceCalibrationCoveragePriority;
  reason: string;
  suggestedStartAt: number | null;
  suggestedEndAt: number | null;
  storedCandles: number;
  minimumUsefulCandles: number;
};

export type SupportResistanceCalibrationLevelSummary = {
  price: number;
  kind: "support" | "resistance";
  strengthLabel: FinalLevelZone["strengthLabel"];
  timeframeBias: FinalLevelZone["timeframeBias"];
  source: "surfaced" | "extension";
};

export type SupportResistanceForwardLadderAudit = {
  verdict: SupportResistanceCalibrationVerdict;
  nearestSupport: SupportResistanceCalibrationLevelSummary | null;
  nearestResistance: SupportResistanceCalibrationLevelSummary | null;
  nextSupport: SupportResistanceCalibrationLevelSummary | null;
  nextResistance: SupportResistanceCalibrationLevelSummary | null;
  firstSupportGapPct: number | null;
  firstResistanceGapPct: number | null;
  tightSupportClusterCount: number;
  tightResistanceClusterCount: number;
  futureHighPct: number | null;
  futureLowPct: number | null;
  reasons: string[];
};

export type SupportResistanceForwardReactionAudit = {
  verdict: SupportResistanceCalibrationVerdict;
  totalLevelsEvaluated: number;
  surfacedLevelsEvaluated: number;
  extensionLevelsEvaluated: number;
  surfacedTouchRate: number;
  surfacedUsefulWhenTouchedRate: number;
  surfacedBreakRate: number;
  extensionTouchRate: number;
  extensionUsefulWhenTouchedRate: number;
  extensionBreakRate: number;
  volumeEvidence: ForwardReactionVolumeSummary;
  examples: ForwardReactionLevelResult[];
  reasons: string[];
};

export type SupportResistanceRankingProofBucket = {
  bucket: string;
  evaluated: number;
  touched: number;
  usefulnessRate: number;
  usefulWhenTouchedRate: number;
  breakRate: number;
  conclusion: SupportResistanceCalibrationVerdict;
};

export type SupportResistanceRankingProof = {
  verdict: SupportResistanceCalibrationVerdict;
  buckets: SupportResistanceRankingProofBucket[];
  strongestEvidence: string[];
  weakestEvidence: string[];
};

export type SupportResistanceMarketStructureLink = {
  state: CandleMarketStructureState | "unavailable";
  confidenceLabel: CandleMarketStructureConfidence["label"] | "none";
  confidenceScore: number;
  rangeLow: number | null;
  rangeHigh: number | null;
  rangeWidthPct: number | null;
  latestSwingLow: number | null;
  latestSwingHigh: number | null;
  alignment: "supports_ladder" | "questions_ladder" | "neutral" | "insufficient";
  reasons: string[];
};

export type SupportResistanceCalibrationSymbolReport = {
  symbol: string;
  verdict: SupportResistanceCalibrationVerdict;
  postCount: number;
  firstPostAt: number | null;
  lastPostAt: number | null;
  currentPrice: number | null;
  candles: {
    daily: number;
    fourHour: number;
    fiveMinute: number;
    futureFiveMinute: number;
  };
  levelCounts: {
    surfacedSupport: number;
    surfacedResistance: number;
    extensionSupport: number;
    extensionResistance: number;
  };
  forwardReaction: SupportResistanceForwardReactionAudit;
  forwardLadder: SupportResistanceForwardLadderAudit;
  rankingProof: SupportResistanceRankingProof;
  marketStructure: SupportResistanceMarketStructureLink;
  coverageGaps: SupportResistanceCalibrationCoverageGap[];
  examples: string[];
};

export type SupportResistanceCalibrationReport = {
  generatedAt: string;
  sourceAuditPath: string;
  sourceAuditPaths: string[];
  cacheDirectoryPath: string;
  warehouseDirectoryPath: string | null;
  provider: CandleProviderName;
  symbolsReviewed: number;
  totals: {
    trusted: number;
    watch: number;
    broken: number;
    unproven: number;
    missingCandleSymbols: number;
    wideForwardGapSymbols: number;
    noForwardResistanceSymbols: number;
    noForwardSupportSymbols: number;
    crowdedForwardSymbols: number;
    coverageGapTasks: number;
    fetchFirstCoverageGaps: number;
    rankingWatchSymbols: number;
    structureQuestionSymbols: number;
  };
  symbols: SupportResistanceCalibrationSymbolReport[];
};

export type SupportResistanceCalibrationGateStatus = "pass" | "review" | "fail";

export type SupportResistanceCalibrationGateOptions = {
  maxBrokenSymbols?: number;
  maxWatchSymbols?: number;
  maxUnprovenPct?: number;
  maxFetchFirstCoverageGaps?: number;
  maxNoForwardResistanceSymbols?: number;
  maxRankingWatchSymbols?: number;
  maxStructureQuestionSymbols?: number;
};

export type SupportResistanceCalibrationGateViolation = {
  status: Exclude<SupportResistanceCalibrationGateStatus, "pass">;
  code: string;
  reason: string;
  observed: number;
  allowed: number;
};

export type SupportResistanceCalibrationGateResult = {
  generatedAt: string;
  status: SupportResistanceCalibrationGateStatus;
  sourceAuditPath: string;
  totals: SupportResistanceCalibrationReport["totals"] & {
    symbolsReviewed: number;
    unprovenPct: number;
  };
  thresholds: Required<SupportResistanceCalibrationGateOptions>;
  violations: SupportResistanceCalibrationGateViolation[];
};

export type BuildSupportResistanceCalibrationReportOptions = {
  auditPath: string;
  cacheDirectoryPath?: string;
  warehouseDirectoryPath?: string;
  provider?: CandleProviderName;
  maxSymbols?: number;
  maxAuditFiles?: number;
};

export type WriteSupportResistanceCalibrationReportOptions =
  BuildSupportResistanceCalibrationReportOptions & {
    jsonPath: string;
    markdownPath: string;
  };

const DEFAULT_CACHE_DIRECTORY = ".validation-cache/candles";
const FIVE_MINUTES = 5 * 60_000;
const DAY = 24 * 60 * 60_000;

const newYorkDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function round(value: number | null | undefined, decimals = 4): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Number(value.toFixed(decimals)) : null;
}

function pctChange(from: number | null | undefined, to: number | null | undefined): number | null {
  if (typeof from !== "number" || !Number.isFinite(from) || from === 0) {
    return null;
  }
  if (typeof to !== "number" || !Number.isFinite(to)) {
    return null;
  }
  return ((to - from) / from) * 100;
}

function sessionDate(timestamp: number | null): string | null {
  return timestamp === null ? null : newYorkDateFormatter.format(new Date(timestamp));
}

function lookbackMs(timeframe: CandleFetchTimeframe): number {
  if (timeframe === "daily") {
    return 520 * DAY;
  }
  if (timeframe === "4h") {
    return 180 * 4 * 60 * 60_000;
  }
  if (timeframe === "1m") {
    return 480 * 60_000;
  }
  return 180 * FIVE_MINUTES;
}

function minimumUsefulCandles(timeframe: CandleFetchTimeframe): number {
  if (timeframe === "daily") {
    return 120;
  }
  if (timeframe === "4h") {
    return 60;
  }
  if (timeframe === "1m") {
    return 60;
  }
  return 48;
}

function limitAuditPaths(paths: string[], maxAuditFiles?: number): string[] {
  if (typeof maxAuditFiles !== "number" || !Number.isFinite(maxAuditFiles) || maxAuditFiles <= 0) {
    return paths;
  }
  return paths.slice(0, Math.floor(maxAuditFiles));
}

function resolveAuditPaths(pathOrDirectory: string, maxAuditFiles?: number): string[] {
  const path = resolve(pathOrDirectory);
  if (path.endsWith(".jsonl")) {
    return [path];
  }
  const direct = join(path, "discord-delivery-audit.jsonl");
  if (existsSync(direct)) {
    return [direct];
  }
  if (!existsSync(path)) {
    return [direct];
  }
  return limitAuditPaths(readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(path, entry.name, "discord-delivery-audit.jsonl"))
    .filter((candidate) => existsSync(candidate))
    .sort(), maxAuditFiles);
}

function readRows(path: string): AuditRow[] {
  if (!existsSync(path)) {
    return [];
  }
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as AuditRow];
      } catch {
        return [];
      }
    });
}

function rowTimestamp(row: AuditRow): number | null {
  const timestamp = row.sourceTimestamp ?? row.timestamp;
  return typeof timestamp === "number" && Number.isFinite(timestamp) ? timestamp : null;
}

function isPosted(row: AuditRow): boolean {
  return (
    (row.status === "posted" || row.status === "success") &&
    ["post_alert", "post_level_snapshot", "post_level_extension"].includes(String(row.operation))
  );
}

function isLevelSnapshotRow(row: AuditRow): boolean {
  return isPosted(row) && row.operation === "post_level_snapshot";
}

function symbolOf(row: AuditRow): string {
  return row.symbol?.trim().toUpperCase() || "UNKNOWN";
}

function textOf(row: AuditRow): string {
  return [row.title, row.body, row.bodyPreview].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function excerpt(row: AuditRow, maxLength = 220): string {
  const text = textOf(row);
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
}

function priceFromRow(row: AuditRow): number | null {
  const text = textOf(row);
  const patterns = [
    /\bPrice:\s*([0-9]+(?:\.[0-9]+)?)/i,
    /\bTriggered near:\s*([0-9]+(?:\.[0-9]+)?)/i,
    /\bprice\s+(?:pushed above|slipped below|testing|near|at)?\s*([0-9]+(?:\.[0-9]+)?)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const value = Number(match[1]);
      if (Number.isFinite(value) && value > 0) {
        return value;
      }
    }
  }
  return null;
}

function walkJsonFiles(directoryPath: string): string[] {
  if (!existsSync(directoryPath)) {
    return [];
  }
  const output: string[] = [];
  for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
    const path = join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      output.push(...walkJsonFiles(path));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      output.push(path);
    }
  }
  return output;
}

function parseCacheEntry(path: string): CachedCandleEntry | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as CachedCandleEntry;
  } catch {
    return null;
  }
}

function normalizeCandles(candles: Candle[]): Candle[] {
  const byTimestamp = new Map<number, Candle>();
  for (const candle of candles) {
    if (
      typeof candle.timestamp === "number" &&
      Number.isFinite(candle.timestamp) &&
      Number.isFinite(candle.open) &&
      Number.isFinite(candle.high) &&
      Number.isFinite(candle.low) &&
      Number.isFinite(candle.close) &&
      Number.isFinite(candle.volume)
    ) {
      byTimestamp.set(candle.timestamp, candle);
    }
  }
  return [...byTimestamp.values()].sort((left, right) => left.timestamp - right.timestamp);
}

function readCachedCandles(params: {
  cacheDirectoryPath: string;
  provider: CandleProviderName;
  symbol: string;
  timeframe: CandleFetchTimeframe;
}): Candle[] {
  const directory = join(params.cacheDirectoryPath, params.provider, params.symbol, params.timeframe);
  const candles: Candle[] = [];
  for (const path of walkJsonFiles(directory)) {
    const parsed = parseCacheEntry(path);
    const entrySymbol = parsed?.response?.symbol ?? parsed?.request?.symbol;
    const entryTimeframe = parsed?.response?.timeframe ?? parsed?.request?.timeframe;
    if (
      entrySymbol?.toUpperCase() === params.symbol &&
      entryTimeframe === params.timeframe
    ) {
      candles.push(...(parsed?.response?.candles ?? parsed?.candles ?? []));
    }
  }
  return normalizeCandles(candles);
}

async function readWarehouseCandles(params: {
  warehouseDirectoryPath?: string;
  provider: CandleProviderName;
  symbol: string;
  timeframe: CandleFetchTimeframe;
  firstPostAt: number | null;
  lastPostAt: number | null;
}): Promise<Candle[]> {
  if (!params.warehouseDirectoryPath) {
    return [];
  }

  const anchor = params.firstPostAt ?? params.lastPostAt ?? Date.now();
  const latest = Math.max(params.lastPostAt ?? anchor, anchor);
  const forwardWindow =
    params.timeframe === "5m" || params.timeframe === "1m"
      ? 8 * 60 * 60_000
      : params.timeframe === "4h"
        ? 7 * DAY
        : 14 * DAY;
  const warehouse = new DurableCandleWarehouse(params.warehouseDirectoryPath);
  return warehouse.getCandles({
    provider: params.provider,
    symbol: params.symbol,
    timeframe: params.timeframe,
    startTimestamp: anchor - lookbackMs(params.timeframe),
    endTimestamp: latest + forwardWindow,
  });
}

async function readCalibrationCandles(params: {
  cacheDirectoryPath: string;
  warehouseDirectoryPath?: string;
  provider: CandleProviderName;
  symbol: string;
  timeframe: CandleFetchTimeframe;
  firstPostAt: number | null;
  lastPostAt: number | null;
}): Promise<Candle[]> {
  const [cached, warehouse] = await Promise.all([
    Promise.resolve(readCachedCandles(params)),
    readWarehouseCandles(params),
  ]);
  return normalizeCandles([...cached, ...warehouse]);
}

function latestCloseAtOrBefore(candles: Candle[], timestamp: number | null): number | null {
  if (timestamp === null) {
    return candles.at(-1)?.close ?? null;
  }
  return candles.filter((candle) => candle.timestamp <= timestamp).at(-1)?.close ?? null;
}

function surfaceSupport(output: LevelEngineOutput): FinalLevelZone[] {
  return [...output.majorSupport, ...output.intermediateSupport, ...output.intradaySupport];
}

function surfaceResistance(output: LevelEngineOutput): FinalLevelZone[] {
  return [...output.majorResistance, ...output.intermediateResistance, ...output.intradayResistance];
}

function allSupport(output: LevelEngineOutput): Array<{ zone: FinalLevelZone; source: "surfaced" | "extension" }> {
  return [
    ...surfaceSupport(output).map((zone) => ({ zone, source: "surfaced" as const })),
    ...output.extensionLevels.support.map((zone) => ({ zone, source: "extension" as const })),
  ];
}

function allResistance(output: LevelEngineOutput): Array<{ zone: FinalLevelZone; source: "surfaced" | "extension" }> {
  return [
    ...surfaceResistance(output).map((zone) => ({ zone, source: "surfaced" as const })),
    ...output.extensionLevels.resistance.map((zone) => ({ zone, source: "extension" as const })),
  ];
}

function summarizeZone(
  entry: { zone: FinalLevelZone; source: "surfaced" | "extension" } | undefined,
): SupportResistanceCalibrationLevelSummary | null {
  if (!entry) {
    return null;
  }
  return {
    price: round(entry.zone.representativePrice, 4) ?? entry.zone.representativePrice,
    kind: entry.zone.kind,
    strengthLabel: entry.zone.strengthLabel,
    timeframeBias: entry.zone.timeframeBias,
    source: entry.source,
  };
}

function forwardCandidates(
  levels: Array<{ zone: FinalLevelZone; source: "surfaced" | "extension" }>,
  currentPrice: number | null,
  side: "support" | "resistance",
): Array<{ zone: FinalLevelZone; source: "surfaced" | "extension" }> {
  if (currentPrice === null || !Number.isFinite(currentPrice)) {
    return [];
  }
  return levels
    .filter((entry) =>
      side === "support"
        ? entry.zone.representativePrice < currentPrice
        : entry.zone.representativePrice > currentPrice,
    )
    .sort((left, right) =>
      side === "support"
        ? right.zone.representativePrice - left.zone.representativePrice
        : left.zone.representativePrice - right.zone.representativePrice,
    );
}

function firstGapPct(
  first: SupportResistanceCalibrationLevelSummary | null,
  second: SupportResistanceCalibrationLevelSummary | null,
  currentPrice: number | null,
): number | null {
  if (!first || !second || currentPrice === null || currentPrice <= 0) {
    return null;
  }
  return round(Math.abs(((second.price - first.price) / currentPrice) * 100), 2);
}

function tightClusterCount(
  candidates: Array<{ zone: FinalLevelZone; source: "surfaced" | "extension" }>,
  currentPrice: number | null,
): number {
  if (currentPrice === null || currentPrice <= 0) {
    return 0;
  }
  const nearby = candidates
    .filter((entry) => Math.abs(((entry.zone.representativePrice - currentPrice) / currentPrice) * 100) <= 12)
    .slice(0, 6);
  if (nearby.length < 2) {
    return nearby.length;
  }
  let longest = 1;
  let current = 1;
  for (let index = 1; index < nearby.length; index += 1) {
    const previous = nearby[index - 1]!.zone.representativePrice;
    const next = nearby[index]!.zone.representativePrice;
    const gapPct = Math.abs(((next - previous) / currentPrice) * 100);
    if (gapPct <= 2.5) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 1;
    }
  }
  return longest >= 2 ? longest : 0;
}

function worstVerdict(values: SupportResistanceCalibrationVerdict[]): SupportResistanceCalibrationVerdict {
  if (values.includes("broken")) {
    return "broken";
  }
  if (values.includes("unproven")) {
    return "unproven";
  }
  if (values.includes("watch")) {
    return "watch";
  }
  return "trusted";
}

function buildForwardReactionAudit(
  report: ForwardReactionValidationReport | null,
  futureCandles: Candle[],
  reasons: string[],
): SupportResistanceForwardReactionAudit {
  const emptyVolumeEvidence: ForwardReactionVolumeSummary = {
    touched: 0,
    reliable: 0,
    unreliable: 0,
    highVolumeTouches: 0,
    lightVolumeTouches: 0,
    highVolumeUsefulWhenTouchedRate: 0,
    highVolumeRespectRate: 0,
    highVolumeBreakRate: 0,
    lightVolumeUsefulWhenTouchedRate: 0,
    lightVolumeRespectRate: 0,
    lightVolumeBreakRate: 0,
  };

  if (!report || futureCandles.length === 0 || report.totalLevelsEvaluated === 0) {
    return {
      verdict: "unproven",
      totalLevelsEvaluated: report?.totalLevelsEvaluated ?? 0,
      surfacedLevelsEvaluated: report?.surfacedLevelsEvaluated ?? 0,
      extensionLevelsEvaluated: report?.extensionLevelsEvaluated ?? 0,
      surfacedTouchRate: report?.surfacedTouchRate ?? 0,
      surfacedUsefulWhenTouchedRate: report?.surfacedUsefulWhenTouchedRate ?? 0,
      surfacedBreakRate: report?.surfacedBreakRate ?? 0,
      extensionTouchRate: report?.extensionTouchRate ?? 0,
      extensionUsefulWhenTouchedRate: report?.extensionUsefulWhenTouchedRate ?? 0,
      extensionBreakRate: report?.extensionBreakRate ?? 0,
      volumeEvidence: report?.volumeEvidence ?? emptyVolumeEvidence,
      examples: [],
      reasons: reasons.length > 0 ? reasons : ["future 5m candle evidence was unavailable"],
    };
  }

  const touched = report.levelResults.filter((result) => result.touched);
  const verdict: SupportResistanceCalibrationVerdict =
    touched.length >= 3 && report.surfacedUsefulWhenTouchedRate < 0.25 && report.surfacedBreakRate > 0.5
      ? "broken"
      : touched.length > 0 && report.surfacedUsefulWhenTouchedRate >= 0.5
        ? "trusted"
        : "watch";

  const examplePriority: ForwardReactionLevelResult["outcome"][] = [
    "broken",
    "respected",
    "partial_respect",
    "touched_no_resolution",
    "untouched",
  ];
  const examples = [...report.levelResults]
    .sort((left, right) => {
      const outcomeDelta = examplePriority.indexOf(left.outcome) - examplePriority.indexOf(right.outcome);
      if (outcomeDelta !== 0) {
        return outcomeDelta;
      }
      return left.closestApproachPct - right.closestApproachPct;
    })
    .slice(0, 8);

  return {
    verdict,
    totalLevelsEvaluated: report.totalLevelsEvaluated,
    surfacedLevelsEvaluated: report.surfacedLevelsEvaluated,
    extensionLevelsEvaluated: report.extensionLevelsEvaluated,
    surfacedTouchRate: report.surfacedTouchRate,
    surfacedUsefulWhenTouchedRate: report.surfacedUsefulWhenTouchedRate,
    surfacedBreakRate: report.surfacedBreakRate,
    extensionTouchRate: report.extensionTouchRate,
    extensionUsefulWhenTouchedRate: report.extensionUsefulWhenTouchedRate,
    extensionBreakRate: report.extensionBreakRate,
    volumeEvidence: report.volumeEvidence,
    examples,
    reasons:
      verdict === "trusted"
        ? ["touched surfaced levels had useful forward reactions"]
        : verdict === "broken"
          ? ["multiple touched surfaced levels broke without useful reaction"]
          : ["forward reaction evidence needs review or more touches"],
  };
}

function conclusionFromSummary(summary: ForwardReactionSummary): SupportResistanceCalibrationVerdict {
  if (summary.evaluated === 0 || summary.touched === 0) {
    return "unproven";
  }
  if (summary.breakRate >= 0.5 && summary.usefulWhenTouchedRate < 0.25) {
    return "broken";
  }
  if (summary.usefulWhenTouchedRate >= 0.5 || summary.respectRate + summary.partialRespectRate >= 0.5) {
    return "trusted";
  }
  return "watch";
}

function summarizeLevelResults(results: ForwardReactionLevelResult[]): ForwardReactionSummary {
  const touched = results.filter((result) => result.touched).length;
  const useful = results.filter((result) => result.useful).length;
  const rate = (numerator: number, denominator: number): number =>
    denominator <= 0 ? 0 : Number((numerator / denominator).toFixed(4));
  return {
    evaluated: results.length,
    touched,
    touchRate: rate(touched, results.length),
    closestApproachPct: results.length === 0
      ? 0
      : Number(Math.min(...results.map((result) => result.closestApproachPct)).toFixed(4)),
    usefulnessRate: rate(useful, results.length),
    usefulWhenTouchedRate: rate(useful, touched),
    respectRate: rate(results.filter((result) => result.respected).length, results.length),
    partialRespectRate: rate(results.filter((result) => result.partialRespected).length, results.length),
    breakRate: rate(results.filter((result) => result.broken).length, results.length),
  };
}

function bucketFromSummary(bucket: string, summary: ForwardReactionSummary): SupportResistanceRankingProofBucket {
  return {
    bucket,
    evaluated: summary.evaluated,
    touched: summary.touched,
    usefulnessRate: summary.usefulnessRate,
    usefulWhenTouchedRate: summary.usefulWhenTouchedRate,
    breakRate: summary.breakRate,
    conclusion: conclusionFromSummary(summary),
  };
}

function buildRankingProof(report: ForwardReactionValidationReport | null): SupportResistanceRankingProof {
  if (!report || report.totalLevelsEvaluated === 0) {
    return {
      verdict: "unproven",
      buckets: [],
      strongestEvidence: ["no forward reaction evidence was available for ranking proof"],
      weakestEvidence: [],
    };
  }

  const byBucket = new Map<string, ForwardReactionLevelResult[]>();
  for (const result of report.levelResults) {
    const key = result.source === "extension"
      ? `extension ${result.kind}`
      : `${result.surfacedBucket ?? result.timeframeBias} ${result.kind}`;
    byBucket.set(key, [...(byBucket.get(key) ?? []), result]);
  }

  const buckets = [
    bucketFromSummary("surfaced support", report.byKindSource.surfacedSupport),
    bucketFromSummary("surfaced resistance", report.byKindSource.surfacedResistance),
    bucketFromSummary("extension support", report.byKindSource.extensionSupport),
    bucketFromSummary("extension resistance", report.byKindSource.extensionResistance),
    ...[...byBucket.entries()].map(([bucket, results]) => bucketFromSummary(bucket, summarizeLevelResults(results))),
    ...Object.entries(report.byStrengthLabel).map(([bucket, summary]) => bucketFromSummary(`strength ${bucket}`, summary)),
    ...Object.entries(report.byDistanceBand).map(([bucket, summary]) => bucketFromSummary(`distance ${bucket}`, summary)),
  ].filter((bucket) => bucket.evaluated > 0);

  const materialBuckets = buckets.filter((bucket) => bucket.touched > 0);
  const brokenBuckets = materialBuckets.filter((bucket) => bucket.conclusion === "broken");
  const watchBuckets = materialBuckets.filter((bucket) => bucket.conclusion === "watch");
  const trustedBuckets = materialBuckets.filter((bucket) => bucket.conclusion === "trusted");
  const verdict: SupportResistanceCalibrationVerdict =
    brokenBuckets.length >= 2 && trustedBuckets.length === 0 ? "broken" :
    brokenBuckets.length > 0 ? "watch" :
    watchBuckets.length > trustedBuckets.length ? "watch" :
    trustedBuckets.length > 0 ? "trusted" :
    "unproven";

  const sortedStrong = [...materialBuckets]
    .sort((left, right) =>
      right.usefulWhenTouchedRate - left.usefulWhenTouchedRate ||
      right.touched - left.touched,
    )
    .slice(0, 4)
    .map((bucket) =>
      `${bucket.bucket}: touched ${bucket.touched}/${bucket.evaluated}, usefulWhenTouched ${bucket.usefulWhenTouchedRate.toFixed(4)}, break ${bucket.breakRate.toFixed(4)}`,
    );
  const sortedWeak = [...materialBuckets]
    .sort((left, right) =>
      right.breakRate - left.breakRate ||
      left.usefulWhenTouchedRate - right.usefulWhenTouchedRate,
    )
    .slice(0, 4)
    .map((bucket) =>
      `${bucket.bucket}: touched ${bucket.touched}/${bucket.evaluated}, usefulWhenTouched ${bucket.usefulWhenTouchedRate.toFixed(4)}, break ${bucket.breakRate.toFixed(4)}`,
    );

  return {
    verdict,
    buckets,
    strongestEvidence: sortedStrong.length > 0 ? sortedStrong : ["no touched bucket had enough proof yet"],
    weakestEvidence: sortedWeak,
  };
}

function buildForwardLadderAudit(params: {
  output: LevelEngineOutput | null;
  currentPrice: number | null;
  futureCandles: Candle[];
  buildReasons: string[];
}): SupportResistanceForwardLadderAudit {
  if (!params.output || params.currentPrice === null) {
    return {
      verdict: "unproven",
      nearestSupport: null,
      nearestResistance: null,
      nextSupport: null,
      nextResistance: null,
      firstSupportGapPct: null,
      firstResistanceGapPct: null,
      tightSupportClusterCount: 0,
      tightResistanceClusterCount: 0,
      futureHighPct: null,
      futureLowPct: null,
      reasons: params.buildReasons.length > 0 ? params.buildReasons : ["level output or current price unavailable"],
    };
  }

  const supportCandidates = forwardCandidates(allSupport(params.output), params.currentPrice, "support");
  const resistanceCandidates = forwardCandidates(allResistance(params.output), params.currentPrice, "resistance");
  const nearestSupport = summarizeZone(supportCandidates[0]);
  const nearestResistance = summarizeZone(resistanceCandidates[0]);
  const nextSupport = summarizeZone(supportCandidates[1]);
  const nextResistance = summarizeZone(resistanceCandidates[1]);
  const firstSupportGapPct = firstGapPct(nearestSupport, nextSupport, params.currentPrice);
  const firstResistanceGapPct = firstGapPct(nearestResistance, nextResistance, params.currentPrice);
  const tightSupportClusterCount = tightClusterCount(supportCandidates, params.currentPrice);
  const tightResistanceClusterCount = tightClusterCount(resistanceCandidates, params.currentPrice);
  const futureHigh = params.futureCandles.length > 0 ? Math.max(...params.futureCandles.map((candle) => candle.high)) : null;
  const futureLow = params.futureCandles.length > 0 ? Math.min(...params.futureCandles.map((candle) => candle.low)) : null;
  const futureHighPct = round(pctChange(params.currentPrice, futureHigh), 2);
  const futureLowPct = round(pctChange(params.currentPrice, futureLow), 2);
  const reasons: string[] = [];
  const noForwardResistance = nearestResistance === null;
  const noForwardSupport = nearestSupport === null;
  const wideResistanceGap = firstResistanceGapPct !== null && firstResistanceGapPct >= 20;
  const wideSupportGap = firstSupportGapPct !== null && firstSupportGapPct >= 20;
  const crowded = tightSupportClusterCount >= 3 || tightResistanceClusterCount >= 3;

  if (noForwardResistance) {
    reasons.push("no forward resistance in generated ladder");
  }
  if (noForwardSupport) {
    reasons.push("no forward support in generated ladder");
  }
  if (wideResistanceGap) {
    reasons.push(`wide first resistance gap ${firstResistanceGapPct}%`);
  }
  if (wideSupportGap) {
    reasons.push(`wide first support gap ${firstSupportGapPct}%`);
  }
  if (crowded) {
    reasons.push(`crowded nearby levels support=${tightSupportClusterCount} resistance=${tightResistanceClusterCount}`);
  }

  const missingForwardMattered =
    (noForwardResistance && futureHighPct !== null && futureHighPct >= 8) ||
    (noForwardSupport && futureLowPct !== null && futureLowPct <= -8);
  const verdict: SupportResistanceCalibrationVerdict =
    missingForwardMattered ? "broken" :
    reasons.length > 0 ? "watch" :
    "trusted";

  return {
    verdict,
    nearestSupport,
    nearestResistance,
    nextSupport,
    nextResistance,
    firstSupportGapPct,
    firstResistanceGapPct,
    tightSupportClusterCount,
    tightResistanceClusterCount,
    futureHighPct,
    futureLowPct,
    reasons: reasons.length > 0 ? reasons : ["forward ladder has support and resistance context"],
  };
}

function buildCoverageGaps(params: {
  symbol: string;
  firstPostAt: number | null;
  lastPostAt: number | null;
  daily: Candle[];
  fourHour: Candle[];
  fiveMinute: Candle[];
  futureFiveMinute: Candle[];
  postCount: number;
  buildReasons: string[];
}): SupportResistanceCalibrationCoverageGap[] {
  const gaps: SupportResistanceCalibrationCoverageGap[] = [];
  const end = params.firstPostAt ?? params.lastPostAt;
  const date = sessionDate(params.firstPostAt ?? params.lastPostAt);

  function add(paramsForGap: {
    timeframe: CandleFetchTimeframe;
    priority: SupportResistanceCalibrationCoveragePriority;
    reason: string;
    storedCandles: number;
    startAt?: number | null;
    endAt?: number | null;
  }): void {
    const suggestedEnd = paramsForGap.endAt ?? end;
    gaps.push({
      symbol: params.symbol,
      sessionDate: date,
      timeframe: paramsForGap.timeframe,
      priority: paramsForGap.priority,
      reason: paramsForGap.reason,
      suggestedStartAt: paramsForGap.startAt ?? (suggestedEnd === null ? null : suggestedEnd - lookbackMs(paramsForGap.timeframe)),
      suggestedEndAt: suggestedEnd,
      storedCandles: paramsForGap.storedCandles,
      minimumUsefulCandles: minimumUsefulCandles(paramsForGap.timeframe),
    });
  }

  if (params.daily.length < minimumUsefulCandles("daily")) {
    add({
      timeframe: "daily",
      priority: "fetch_first",
      reason: `daily candle coverage has ${params.daily.length} candle(s); support/resistance needs higher-timeframe proof`,
      storedCandles: params.daily.length,
    });
  }
  if (params.fourHour.length < minimumUsefulCandles("4h")) {
    add({
      timeframe: "4h",
      priority: "fetch_first",
      reason: `4h candle coverage has ${params.fourHour.length} candle(s); forward ladder confluence is unproven`,
      storedCandles: params.fourHour.length,
    });
  }
  if (params.fiveMinute.length < minimumUsefulCandles("5m")) {
    add({
      timeframe: "5m",
      priority: "fetch_first",
      reason: `5m candle coverage has ${params.fiveMinute.length} candle(s); forward reaction and market-structure proof are unproven`,
      storedCandles: params.fiveMinute.length,
    });
  } else if (params.firstPostAt !== null && params.futureFiveMinute.length < 12) {
    add({
      timeframe: "5m",
      priority: params.postCount >= 10 ? "fetch_first" : "fetch_next",
      reason: `only ${params.futureFiveMinute.length} future 5m candle(s) after the first post; level reaction proof needs after-post coverage`,
      storedCandles: params.fiveMinute.length,
      startAt: params.firstPostAt + FIVE_MINUTES,
      endAt: Math.max(params.lastPostAt ?? params.firstPostAt + 12 * FIVE_MINUTES, params.firstPostAt + 12 * FIVE_MINUTES),
    });
  }

  if (params.buildReasons.some((reason) => /missing/i.test(reason)) && gaps.length === 0) {
    add({
      timeframe: "5m",
      priority: "fetch_next",
      reason: `calibration build was unproven: ${params.buildReasons.join("; ")}`,
      storedCandles: params.fiveMinute.length,
    });
  }

  return gaps;
}

function buildMarketStructureLink(params: {
  symbol: string;
  fiveMinute: Candle[];
  firstPostAt: number | null;
  currentPrice: number | null;
  forwardLadder: SupportResistanceForwardLadderAudit;
}): SupportResistanceMarketStructureLink {
  if (params.fiveMinute.length < 12 || params.firstPostAt === null) {
    return {
      state: "unavailable",
      confidenceLabel: "none",
      confidenceScore: 0,
      rangeLow: null,
      rangeHigh: null,
      rangeWidthPct: null,
      latestSwingLow: null,
      latestSwingHigh: null,
      alignment: "insufficient",
      reasons: ["not enough 5m candle evidence to link market structure to the ladder"],
    };
  }

  const context = buildCandleMarketStructureContext({
    symbol: params.symbol,
    candles: params.fiveMinute,
    asOfTimestamp: params.firstPostAt,
    currentPrice: params.currentPrice ?? undefined,
  });
  const reasons: string[] = [];
  const noForwardResistance = params.forwardLadder.nearestResistance === null;
  const noForwardSupport = params.forwardLadder.nearestSupport === null;
  const futureUpside = params.forwardLadder.futureHighPct ?? 0;
  const futureDownside = params.forwardLadder.futureLowPct ?? 0;
  const trendStates: CandleMarketStructureState[] = [
    "pressing_range_high",
    "breakout_attempt",
    "breakout_holding",
    "higher_lows_intact",
    "trend_intact",
  ];
  const damagedStates: CandleMarketStructureState[] = ["trend_damaged", "pivot_lost", "failed_breakout"];

  let alignment: SupportResistanceMarketStructureLink["alignment"] = "neutral";
  if (context.state === "insufficient_data") {
    alignment = "insufficient";
    reasons.push("market structure is insufficient at the first post");
  } else if (noForwardResistance && trendStates.includes(context.state) && futureUpside >= 5) {
    alignment = "questions_ladder";
    reasons.push(`structure was ${context.state} while the ladder had no forward resistance and later traded ${futureUpside.toFixed(2)}% higher`);
  } else if (noForwardSupport && damagedStates.includes(context.state) && futureDownside <= -5) {
    alignment = "questions_ladder";
    reasons.push(`structure was ${context.state} while the ladder had no forward support and later traded ${futureDownside.toFixed(2)}% lower`);
  } else if (context.range?.active && (params.forwardLadder.tightSupportClusterCount >= 3 || params.forwardLadder.tightResistanceClusterCount >= 3)) {
    alignment = "supports_ladder";
    reasons.push("range-bound structure explains crowded nearby levels as a practical zone");
  } else if (trendStates.includes(context.state) && params.forwardLadder.nearestResistance !== null) {
    alignment = "supports_ladder";
    reasons.push(`constructive ${context.state} structure still had forward resistance context`);
  } else if (damagedStates.includes(context.state) && params.forwardLadder.nearestSupport !== null) {
    alignment = "supports_ladder";
    reasons.push(`${context.state} structure still had forward support context`);
  } else {
    reasons.push(`market structure was ${context.state}; no direct ladder conflict was found`);
  }

  return {
    state: context.state,
    confidenceLabel: context.confidence.label,
    confidenceScore: context.confidence.score,
    rangeLow: round(context.range?.low, 4),
    rangeHigh: round(context.range?.high, 4),
    rangeWidthPct: round(context.range?.widthPct ? context.range.widthPct * 100 : null, 2),
    latestSwingLow: round(context.pivots.latestSwingLow?.price, 4),
    latestSwingHigh: round(context.pivots.latestSwingHigh?.price, 4),
    alignment,
    reasons,
  };
}

async function buildSymbolReport(params: {
  symbol: string;
  rows: AuditRow[];
  cacheDirectoryPath: string;
  warehouseDirectoryPath?: string;
  provider: CandleProviderName;
}): Promise<SupportResistanceCalibrationSymbolReport> {
  const snapshotRows = params.rows.filter(isLevelSnapshotRow);
  const anchorRows = snapshotRows.length > 0 ? snapshotRows : params.rows;
  const anchorTimestamps = anchorRows.map(rowTimestamp).filter((value): value is number => value !== null);
  const allTimestamps = params.rows.map(rowTimestamp).filter((value): value is number => value !== null);
  const firstPostAt = anchorTimestamps.length > 0 ? Math.min(...anchorTimestamps) : null;
  const lastPostAt = allTimestamps.length > 0 ? Math.max(...allTimestamps) : firstPostAt;
  const [daily, fourHour, fiveMinute] = await Promise.all([
    readCalibrationCandles({ ...params, timeframe: "daily", firstPostAt, lastPostAt }),
    readCalibrationCandles({ ...params, timeframe: "4h", firstPostAt, lastPostAt }),
    readCalibrationCandles({ ...params, timeframe: "5m", firstPostAt, lastPostAt }),
  ]);
  const currentPrice =
    anchorRows.map(priceFromRow).find((value): value is number => value !== null) ??
    params.rows.map(priceFromRow).find((value): value is number => value !== null) ??
    latestCloseAtOrBefore(fiveMinute, firstPostAt);
  const futureFiveMinute = firstPostAt === null
    ? []
    : fiveMinute.filter((candle) => candle.timestamp > firstPostAt);
  const examples = params.rows.slice(0, 3).map((row) => excerpt(row));
  const missingReasons: string[] = [];
  if (firstPostAt === null) {
    missingReasons.push("no saved post timestamp");
  }
  if (daily.length === 0) {
    missingReasons.push("missing daily candles");
  }
  if (fourHour.length === 0) {
    missingReasons.push("missing 4h candles");
  }
  if (fiveMinute.length === 0) {
    missingReasons.push("missing 5m candles");
  }

  let context: SupportResistanceContext | null = null;
  const buildReasons = [...missingReasons];
  if (missingReasons.length === 0 && firstPostAt !== null) {
    try {
      context = await buildSupportResistanceContextFromCandles({
        symbol: params.symbol,
        candlesByTimeframe: {
          daily,
          "4h": fourHour,
          "5m": fiveMinute,
        },
        asOfTimestamp: firstPostAt,
        currentPrice: currentPrice ?? undefined,
      });
    } catch (error) {
      buildReasons.push(error instanceof Error ? error.message : String(error));
    }
  }

  let forwardReport: ForwardReactionValidationReport | null = null;
  if (context && futureFiveMinute.length > 0) {
    forwardReport = validateForwardReactions({
      output: context.levels,
      futureCandles: futureFiveMinute,
      baselineCandles: fiveMinute.filter((candle) =>
        firstPostAt === null ? true : candle.timestamp <= firstPostAt,
      ),
    });
  }

  const forwardReaction = buildForwardReactionAudit(forwardReport, futureFiveMinute, buildReasons);
  const forwardLadder = buildForwardLadderAudit({
    output: context?.levels ?? null,
    currentPrice,
    futureCandles: futureFiveMinute,
    buildReasons,
  });
  const rankingProof = buildRankingProof(forwardReport);
  const marketStructure = buildMarketStructureLink({
    symbol: params.symbol,
    fiveMinute,
    firstPostAt,
    currentPrice,
    forwardLadder,
  });
  const coverageGaps = buildCoverageGaps({
    symbol: params.symbol,
    firstPostAt,
    lastPostAt,
    daily,
    fourHour,
    fiveMinute,
    futureFiveMinute,
    postCount: params.rows.length,
    buildReasons,
  });
  const verdict = worstVerdict([forwardReaction.verdict, forwardLadder.verdict, rankingProof.verdict]);
  const levels = context?.levels;

  return {
    symbol: params.symbol,
    verdict,
    postCount: params.rows.length,
    firstPostAt,
    lastPostAt,
    currentPrice: round(currentPrice, 4),
    candles: {
      daily: daily.length,
      fourHour: fourHour.length,
      fiveMinute: fiveMinute.length,
      futureFiveMinute: futureFiveMinute.length,
    },
    levelCounts: {
      surfacedSupport: levels ? surfaceSupport(levels).length : 0,
      surfacedResistance: levels ? surfaceResistance(levels).length : 0,
      extensionSupport: levels?.extensionLevels.support.length ?? 0,
      extensionResistance: levels?.extensionLevels.resistance.length ?? 0,
    },
    forwardReaction,
    forwardLadder,
    rankingProof,
    marketStructure,
    coverageGaps,
    examples,
  };
}

function groupRows(rows: AuditRow[]): Map<string, AuditRow[]> {
  const grouped = new Map<string, AuditRow[]>();
  for (const row of rows.filter(isPosted)) {
    const symbol = symbolOf(row);
    const entries = grouped.get(symbol) ?? [];
    entries.push(row);
    grouped.set(symbol, entries);
  }
  return grouped;
}

function buildTotals(symbols: SupportResistanceCalibrationSymbolReport[]): SupportResistanceCalibrationReport["totals"] {
  return {
    trusted: symbols.filter((symbol) => symbol.verdict === "trusted").length,
    watch: symbols.filter((symbol) => symbol.verdict === "watch").length,
    broken: symbols.filter((symbol) => symbol.verdict === "broken").length,
    unproven: symbols.filter((symbol) => symbol.verdict === "unproven").length,
    missingCandleSymbols: symbols.filter(
      (symbol) => symbol.candles.daily === 0 || symbol.candles.fourHour === 0 || symbol.candles.fiveMinute === 0,
    ).length,
    wideForwardGapSymbols: symbols.filter(
      (symbol) =>
        (symbol.forwardLadder.firstResistanceGapPct ?? 0) >= 20 ||
        (symbol.forwardLadder.firstSupportGapPct ?? 0) >= 20,
    ).length,
    noForwardResistanceSymbols: symbols.filter((symbol) => symbol.forwardLadder.nearestResistance === null).length,
    noForwardSupportSymbols: symbols.filter((symbol) => symbol.forwardLadder.nearestSupport === null).length,
    crowdedForwardSymbols: symbols.filter(
      (symbol) =>
        symbol.forwardLadder.tightResistanceClusterCount >= 3 ||
        symbol.forwardLadder.tightSupportClusterCount >= 3,
    ).length,
    coverageGapTasks: symbols.reduce((sum, symbol) => sum + symbol.coverageGaps.length, 0),
    fetchFirstCoverageGaps: symbols.reduce(
      (sum, symbol) => sum + symbol.coverageGaps.filter((gap) => gap.priority === "fetch_first").length,
      0,
    ),
    rankingWatchSymbols: symbols.filter(
      (symbol) => symbol.rankingProof.verdict === "watch" || symbol.rankingProof.verdict === "broken",
    ).length,
    structureQuestionSymbols: symbols.filter((symbol) => symbol.marketStructure.alignment === "questions_ladder").length,
  };
}

export async function buildSupportResistanceCalibrationReport(
  options: BuildSupportResistanceCalibrationReportOptions,
): Promise<SupportResistanceCalibrationReport> {
  const auditPaths = resolveAuditPaths(options.auditPath, options.maxAuditFiles);
  const rows = auditPaths.flatMap(readRows);
  const grouped = groupRows(rows);
  const selected = [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, options.maxSymbols);
  const cacheDirectoryPath = options.cacheDirectoryPath ?? DEFAULT_CACHE_DIRECTORY;
  const warehouseDirectoryPath = options.warehouseDirectoryPath;
  const provider = options.provider ?? "ibkr";
  const symbols: SupportResistanceCalibrationSymbolReport[] = [];

  for (const [symbol, symbolRows] of selected) {
    symbols.push(await buildSymbolReport({
      symbol,
      rows: symbolRows,
      cacheDirectoryPath,
      warehouseDirectoryPath,
      provider,
    }));
  }

  return {
    generatedAt: new Date().toISOString(),
    sourceAuditPath: auditPaths.length === 1 ? auditPaths[0]! : resolve(options.auditPath),
    sourceAuditPaths: auditPaths,
    cacheDirectoryPath,
    warehouseDirectoryPath: warehouseDirectoryPath ?? null,
    provider,
    symbolsReviewed: symbols.length,
    totals: buildTotals(symbols),
    symbols,
  };
}

function formatPct(value: number | null): string {
  return value === null ? "n/a" : `${value.toFixed(2)}%`;
}

function formatLevel(level: SupportResistanceCalibrationLevelSummary | null): string {
  if (!level) {
    return "none";
  }
  return `${level.price.toFixed(level.price >= 1 ? 2 : 4)} ${level.strengthLabel} ${level.kind} (${level.timeframeBias}, ${level.source})`;
}

function formatTimestamp(timestamp: number | null): string {
  return timestamp === null ? "n/a" : new Date(timestamp).toISOString();
}

export function formatSupportResistanceCalibrationReport(report: SupportResistanceCalibrationReport): string {
  const lines = [
    "# Support / Resistance Calibration Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Provider: ${report.provider}`,
    `Cache: ${report.cacheDirectoryPath}`,
    `Warehouse: ${report.warehouseDirectoryPath ?? "none"}`,
    `Audit files: ${report.sourceAuditPaths.length}`,
    "",
    "## Totals",
    "",
    `- Symbols reviewed: ${report.symbolsReviewed}`,
    `- Trusted: ${report.totals.trusted}`,
    `- Watch: ${report.totals.watch}`,
    `- Broken: ${report.totals.broken}`,
    `- Unproven: ${report.totals.unproven}`,
    `- Missing candle symbols: ${report.totals.missingCandleSymbols}`,
    `- Wide forward gap symbols: ${report.totals.wideForwardGapSymbols}`,
    `- No forward resistance symbols: ${report.totals.noForwardResistanceSymbols}`,
    `- No forward support symbols: ${report.totals.noForwardSupportSymbols}`,
    `- Crowded forward symbols: ${report.totals.crowdedForwardSymbols}`,
    `- Coverage gap tasks: ${report.totals.coverageGapTasks}`,
    `- Fetch-first coverage gaps: ${report.totals.fetchFirstCoverageGaps}`,
    `- Ranking watch symbols: ${report.totals.rankingWatchSymbols}`,
    `- Structure-question symbols: ${report.totals.structureQuestionSymbols}`,
    "",
    "## Symbol Summary",
    "",
    "| Symbol | Verdict | Posts | Candles d/4h/5m/future | Levels S/R/ExtS/ExtR | Reaction | Ladder | Ranking | Structure | Gaps |",
    "| --- | --- | ---: | --- | --- | --- | --- | --- | --- | ---: |",
  ];

  for (const symbol of report.symbols) {
    lines.push(
      `| ${symbol.symbol} | ${symbol.verdict} | ${symbol.postCount} | ${symbol.candles.daily}/${symbol.candles.fourHour}/${symbol.candles.fiveMinute}/${symbol.candles.futureFiveMinute} | ${symbol.levelCounts.surfacedSupport}/${symbol.levelCounts.surfacedResistance}/${symbol.levelCounts.extensionSupport}/${symbol.levelCounts.extensionResistance} | ${symbol.forwardReaction.verdict} | ${symbol.forwardLadder.verdict} | ${symbol.rankingProof.verdict} | ${symbol.marketStructure.alignment} | ${symbol.coverageGaps.length} |`,
    );
  }

  lines.push("", "## Symbol Evidence", "");

  for (const symbol of report.symbols) {
    lines.push(
      `### ${symbol.symbol}`,
      "",
      `- Verdict: ${symbol.verdict}`,
      `- First post: ${formatTimestamp(symbol.firstPostAt)}`,
      `- Last post: ${formatTimestamp(symbol.lastPostAt)}`,
      `- Current price used: ${symbol.currentPrice ?? "n/a"}`,
      `- Candle counts: daily ${symbol.candles.daily}, 4h ${symbol.candles.fourHour}, 5m ${symbol.candles.fiveMinute}, future 5m ${symbol.candles.futureFiveMinute}`,
      `- Level counts: surfaced support ${symbol.levelCounts.surfacedSupport}, surfaced resistance ${symbol.levelCounts.surfacedResistance}, extension support ${symbol.levelCounts.extensionSupport}, extension resistance ${symbol.levelCounts.extensionResistance}`,
      "",
      "Forward reaction:",
      `- Verdict: ${symbol.forwardReaction.verdict}`,
      `- Levels evaluated: ${symbol.forwardReaction.totalLevelsEvaluated} (surfaced ${symbol.forwardReaction.surfacedLevelsEvaluated}, extension ${symbol.forwardReaction.extensionLevelsEvaluated})`,
      `- Surfaced touch/usefulWhenTouched/break: ${symbol.forwardReaction.surfacedTouchRate.toFixed(4)} / ${symbol.forwardReaction.surfacedUsefulWhenTouchedRate.toFixed(4)} / ${symbol.forwardReaction.surfacedBreakRate.toFixed(4)}`,
      `- Extension touch/usefulWhenTouched/break: ${symbol.forwardReaction.extensionTouchRate.toFixed(4)} / ${symbol.forwardReaction.extensionUsefulWhenTouchedRate.toFixed(4)} / ${symbol.forwardReaction.extensionBreakRate.toFixed(4)}`,
      `- Volume touched/reliable/high-volume: ${symbol.forwardReaction.volumeEvidence.touched} / ${symbol.forwardReaction.volumeEvidence.reliable} / ${symbol.forwardReaction.volumeEvidence.highVolumeTouches}`,
      `- High-volume useful/respect/break: ${symbol.forwardReaction.volumeEvidence.highVolumeUsefulWhenTouchedRate.toFixed(4)} / ${symbol.forwardReaction.volumeEvidence.highVolumeRespectRate.toFixed(4)} / ${symbol.forwardReaction.volumeEvidence.highVolumeBreakRate.toFixed(4)}`,
      `- Reasons: ${symbol.forwardReaction.reasons.join("; ")}`,
      "",
      "Forward ladder:",
      `- Verdict: ${symbol.forwardLadder.verdict}`,
      `- Nearest support: ${formatLevel(symbol.forwardLadder.nearestSupport)}`,
      `- Nearest resistance: ${formatLevel(symbol.forwardLadder.nearestResistance)}`,
      `- Next support: ${formatLevel(symbol.forwardLadder.nextSupport)}`,
      `- Next resistance: ${formatLevel(symbol.forwardLadder.nextResistance)}`,
      `- First support gap: ${formatPct(symbol.forwardLadder.firstSupportGapPct)}`,
      `- First resistance gap: ${formatPct(symbol.forwardLadder.firstResistanceGapPct)}`,
      `- Tight clusters: support ${symbol.forwardLadder.tightSupportClusterCount}, resistance ${symbol.forwardLadder.tightResistanceClusterCount}`,
      `- Future high/low from first post: ${formatPct(symbol.forwardLadder.futureHighPct)} / ${formatPct(symbol.forwardLadder.futureLowPct)}`,
      `- Reasons: ${symbol.forwardLadder.reasons.join("; ")}`,
      "",
      "Ranking proof:",
      `- Verdict: ${symbol.rankingProof.verdict}`,
      `- Strongest evidence: ${symbol.rankingProof.strongestEvidence.join("; ")}`,
      `- Weakest evidence: ${symbol.rankingProof.weakestEvidence.join("; ") || "none"}`,
      `- Buckets: ${symbol.rankingProof.buckets.slice(0, 8).map((bucket) => `${bucket.bucket} ${bucket.conclusion} touched ${bucket.touched}/${bucket.evaluated} usefulWhenTouched ${bucket.usefulWhenTouchedRate.toFixed(4)} break ${bucket.breakRate.toFixed(4)}`).join(" | ") || "none"}`,
      "",
      "Market-structure link:",
      `- State: ${symbol.marketStructure.state}; confidence ${symbol.marketStructure.confidenceLabel} ${symbol.marketStructure.confidenceScore.toFixed(2)}; alignment ${symbol.marketStructure.alignment}`,
      `- Range: ${symbol.marketStructure.rangeLow ?? "n/a"}-${symbol.marketStructure.rangeHigh ?? "n/a"} (${formatPct(symbol.marketStructure.rangeWidthPct)})`,
      `- Latest swing low/high: ${symbol.marketStructure.latestSwingLow ?? "n/a"} / ${symbol.marketStructure.latestSwingHigh ?? "n/a"}`,
      `- Reasons: ${symbol.marketStructure.reasons.join("; ")}`,
    );

    if (symbol.coverageGaps.length > 0) {
      lines.push("", "Coverage gaps / backfill hints:");
      for (const gap of symbol.coverageGaps) {
        lines.push(
          `- ${gap.priority} ${gap.timeframe}: ${gap.reason}; stored ${gap.storedCandles}/${gap.minimumUsefulCandles}; range ${formatTimestamp(gap.suggestedStartAt)} to ${formatTimestamp(gap.suggestedEndAt)}`,
        );
      }
    }

    if (symbol.forwardReaction.examples.length > 0) {
      lines.push("", "Reaction examples:");
      for (const example of symbol.forwardReaction.examples.slice(0, 5)) {
        lines.push(
          `- ${example.kind} ${example.representativePrice.toFixed(example.representativePrice >= 1 ? 2 : 4)} ${example.strengthLabel} ${example.source}: ${example.outcome}, score ${example.strengthScore.toFixed(2)}, touches ${example.touchCount}, evidence ${example.sourceEvidenceCount}, closest ${formatPct(example.closestApproachPct * 100)}, volume ${example.volumeContext.label}/${example.volumeContext.reliability}${example.volumeContext.relativeVolumeRatio === null ? "" : ` ${example.volumeContext.relativeVolumeRatio.toFixed(2)}x`}, favorable ${formatPct((example.maxFavorableExcursionPct ?? 0) * 100)}, adverse ${formatPct((example.maxAdverseExcursionPct ?? 0) * 100)}`,
        );
      }
    }

    if (symbol.examples.length > 0) {
      lines.push("", "Saved post examples:");
      for (const example of symbol.examples) {
        lines.push(`- ${example}`);
      }
    }

    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}

function gateThresholds(
  options: SupportResistanceCalibrationGateOptions = {},
): Required<SupportResistanceCalibrationGateOptions> {
  return {
    maxBrokenSymbols: options.maxBrokenSymbols ?? 0,
    maxWatchSymbols: options.maxWatchSymbols ?? 8,
    maxUnprovenPct: options.maxUnprovenPct ?? 0.5,
    maxFetchFirstCoverageGaps: options.maxFetchFirstCoverageGaps ?? 0,
    maxNoForwardResistanceSymbols: options.maxNoForwardResistanceSymbols ?? 8,
    maxRankingWatchSymbols: options.maxRankingWatchSymbols ?? 8,
    maxStructureQuestionSymbols: options.maxStructureQuestionSymbols ?? 0,
  };
}

function addGateViolation(params: {
  violations: SupportResistanceCalibrationGateViolation[];
  status: Exclude<SupportResistanceCalibrationGateStatus, "pass">;
  code: string;
  reason: string;
  observed: number;
  allowed: number;
}): void {
  if (params.observed <= params.allowed) {
    return;
  }
  params.violations.push({
    status: params.status,
    code: params.code,
    reason: params.reason,
    observed: params.observed,
    allowed: params.allowed,
  });
}

function strongestGateStatus(
  violations: SupportResistanceCalibrationGateViolation[],
): SupportResistanceCalibrationGateStatus {
  return violations.some((violation) => violation.status === "fail")
    ? "fail"
    : violations.length > 0
      ? "review"
      : "pass";
}

export function evaluateSupportResistanceCalibrationGate(
  report: SupportResistanceCalibrationReport,
  options: SupportResistanceCalibrationGateOptions = {},
): SupportResistanceCalibrationGateResult {
  const thresholds = gateThresholds(options);
  const unprovenPct = report.symbolsReviewed <= 0
    ? 0
    : Number((report.totals.unproven / report.symbolsReviewed).toFixed(4));
  const violations: SupportResistanceCalibrationGateViolation[] = [];

  addGateViolation({
    violations,
    status: "fail",
    code: "broken_symbols",
    reason: "broken support/resistance calibration symbols require level-engine review",
    observed: report.totals.broken,
    allowed: thresholds.maxBrokenSymbols,
  });
  addGateViolation({
    violations,
    status: "review",
    code: "watch_symbols",
    reason: "too many symbols need support/resistance evidence review",
    observed: report.totals.watch,
    allowed: thresholds.maxWatchSymbols,
  });
  addGateViolation({
    violations,
    status: "review",
    code: "unproven_pct",
    reason: "too much of the run is unproven because candle coverage or forward proof is missing",
    observed: Math.round(unprovenPct * 100),
    allowed: Math.round(thresholds.maxUnprovenPct * 100),
  });
  addGateViolation({
    violations,
    status: "review",
    code: "fetch_first_coverage_gaps",
    reason: "fetch-first candle gaps should be backfilled before treating the audit as complete",
    observed: report.totals.fetchFirstCoverageGaps,
    allowed: thresholds.maxFetchFirstCoverageGaps,
  });
  addGateViolation({
    violations,
    status: "review",
    code: "no_forward_resistance_symbols",
    reason: "many symbols have no forward resistance in the generated ladder",
    observed: report.totals.noForwardResistanceSymbols,
    allowed: thresholds.maxNoForwardResistanceSymbols,
  });
  addGateViolation({
    violations,
    status: "review",
    code: "ranking_watch_symbols",
    reason: "ranking proof found weak or broken forward reaction buckets",
    observed: report.totals.rankingWatchSymbols,
    allowed: thresholds.maxRankingWatchSymbols,
  });
  addGateViolation({
    violations,
    status: "review",
    code: "structure_question_symbols",
    reason: "market-structure context questioned the support/resistance ladder",
    observed: report.totals.structureQuestionSymbols,
    allowed: thresholds.maxStructureQuestionSymbols,
  });

  return {
    generatedAt: new Date().toISOString(),
    status: strongestGateStatus(violations),
    sourceAuditPath: report.sourceAuditPath,
    totals: {
      ...report.totals,
      symbolsReviewed: report.symbolsReviewed,
      unprovenPct,
    },
    thresholds,
    violations,
  };
}

export function formatSupportResistanceCalibrationGate(result: SupportResistanceCalibrationGateResult): string {
  const lines = [
    "# Support / Resistance Calibration Gate",
    "",
    `Generated: ${result.generatedAt}`,
    `Source audit: ${result.sourceAuditPath}`,
    `Status: ${result.status}`,
    "",
    "## Totals",
    "",
    `- symbols reviewed: ${result.totals.symbolsReviewed}`,
    `- trusted: ${result.totals.trusted}`,
    `- watch: ${result.totals.watch}`,
    `- broken: ${result.totals.broken}`,
    `- unproven: ${result.totals.unproven}`,
    `- unproven pct: ${(result.totals.unprovenPct * 100).toFixed(2)}%`,
    `- fetch-first coverage gaps: ${result.totals.fetchFirstCoverageGaps}`,
    `- no forward resistance symbols: ${result.totals.noForwardResistanceSymbols}`,
    `- ranking watch symbols: ${result.totals.rankingWatchSymbols}`,
    `- structure-question symbols: ${result.totals.structureQuestionSymbols}`,
    "",
    "## Thresholds",
    "",
    `- max broken symbols: ${result.thresholds.maxBrokenSymbols}`,
    `- max watch symbols: ${result.thresholds.maxWatchSymbols}`,
    `- max unproven pct: ${(result.thresholds.maxUnprovenPct * 100).toFixed(2)}%`,
    `- max fetch-first coverage gaps: ${result.thresholds.maxFetchFirstCoverageGaps}`,
    `- max no-forward-resistance symbols: ${result.thresholds.maxNoForwardResistanceSymbols}`,
    `- max ranking watch symbols: ${result.thresholds.maxRankingWatchSymbols}`,
    `- max structure-question symbols: ${result.thresholds.maxStructureQuestionSymbols}`,
    "",
    "## Violations",
    "",
  ];

  if (result.violations.length === 0) {
    lines.push("- none");
  } else {
    for (const violation of result.violations) {
      lines.push(
        `- ${violation.status} ${violation.code}: observed ${violation.observed}, allowed ${violation.allowed}; ${violation.reason}`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

export function writeSupportResistanceCalibrationGate(params: {
  report: SupportResistanceCalibrationReport;
  options?: SupportResistanceCalibrationGateOptions;
  jsonPath: string;
  markdownPath: string;
}): SupportResistanceCalibrationGateResult {
  const result = evaluateSupportResistanceCalibrationGate(params.report, params.options);
  mkdirSync(dirname(params.jsonPath), { recursive: true });
  mkdirSync(dirname(params.markdownPath), { recursive: true });
  writeFileSync(params.jsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  writeFileSync(params.markdownPath, formatSupportResistanceCalibrationGate(result), "utf8");
  return result;
}

export async function writeSupportResistanceCalibrationReport(
  options: WriteSupportResistanceCalibrationReportOptions,
): Promise<SupportResistanceCalibrationReport> {
  const report = await buildSupportResistanceCalibrationReport(options);
  mkdirSync(dirname(options.jsonPath), { recursive: true });
  mkdirSync(dirname(options.markdownPath), { recursive: true });
  writeFileSync(options.jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(options.markdownPath, formatSupportResistanceCalibrationReport(report), "utf8");
  return report;
}
