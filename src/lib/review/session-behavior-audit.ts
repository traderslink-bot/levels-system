import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import type { Candle, CandleFetchTimeframe, CandleProviderName } from "../market-data/candle-types.js";
import {
  generateMissedMeaningfulMoveAudit,
  type MissedMeaningfulMoveAuditReport,
  type ReviewedCandleMove,
} from "./missed-meaningful-move-audit.js";

type AuditRow = {
  type?: string;
  operation?: string;
  status?: string;
  timestamp?: number;
  sourceTimestamp?: number;
  symbol?: string;
  title?: string;
  body?: string;
  bodyPreview?: string;
  messageKind?: string;
  eventType?: string;
  triggerPrice?: number;
  targetPrice?: number;
  supportCount?: number;
  resistanceCount?: number;
  rangeBoxLabel?: string;
  acceptanceLabel?: string;
  behaviorBudgetLabel?: string;
  levelImportanceLabel?: string;
  failedLevelOutcome?: string;
  whyPosted?: string;
  runtimeVersion?: string;
  runtimeStartedAt?: string;
  runtimePid?: number;
};

type CachedCandleEntry = {
  cachedAt?: number;
  request?: {
    symbol?: string;
    timeframe?: CandleFetchTimeframe;
    lookbackBars?: number;
    endTimeMs?: number;
    provider?: CandleProviderName;
  };
  response?: {
    symbol?: string;
    timeframe?: CandleFetchTimeframe;
    candles?: Candle[];
  };
  candles?: Candle[];
};

export type CandleFreshnessStatus = "fresh" | "usable" | "stale" | "missing";
export type CandleReadinessStatus = "ready" | "partial" | "blocked";
export type FirstPostScoreLabel = "strong" | "usable" | "weak" | "missing";
export type ThreadBalanceVerdict = "balanced" | "too_noisy" | "possibly_too_quiet" | "mixed_review" | "data_unproven";
export type SessionBehaviorProfile =
  | "range_chop"
  | "clean_runner"
  | "volatile_runner"
  | "thin_low_activity"
  | "failed_runner"
  | "accumulating_under_resistance"
  | "mixed_unknown";

export type CandleTimeframeFreshness = {
  timeframe: CandleFetchTimeframe;
  candleCount: number;
  latestCandleTimestamp: number | null;
  latestCandleIso: string | null;
  latestCacheAt: number | null;
  lagToLastPostMinutes: number | null;
  status: CandleFreshnessStatus;
};

export type FirstPostTradeMapScore = {
  label: FirstPostScoreLabel;
  score: number;
  title?: string;
  timestamp: number | null;
  strengths: string[];
  issues: string[];
  excerpt: string | null;
};

export type ScoreFirstPostTradeMapTextInput = {
  title?: string;
  body: string;
  timestamp?: number | null;
};

export type CandleSyncedTimelineItem = {
  timestamp: number;
  timestampIso: string;
  kind: "post" | "candle_move";
  title: string;
  detail: string;
};

export type SessionBehaviorAuditSymbol = {
  symbol: string;
  firstPostAt: number | null;
  lastPostAt: number | null;
  postCount: number;
  alertCount: number;
  candleReadiness: CandleReadinessStatus;
  candleFreshness: CandleTimeframeFreshness[];
  firstPostScore: FirstPostTradeMapScore;
  threadBalance: {
    verdict: ThreadBalanceVerdict;
    expectedMaxPosts: number;
    missedCandidates: number;
    majorMissedCandidates: number;
    repeatedStorySignals: number;
    reasons: string[];
  };
  behaviorProfile: {
    label: SessionBehaviorProfile;
    priceRangePct: number | null;
    maxFiveMinuteMovePct: number | null;
    reviewedCandleCount: number;
    reasons: string[];
  };
  operatorRecapPreview: string[];
  timeline: CandleSyncedTimelineItem[];
};

export type SessionBehaviorAuditReport = {
  generatedAt: string;
  sourceAuditPath: string;
  cacheDirectoryPath: string;
  provider: CandleProviderName;
  totals: {
    symbols: number;
    ready: number;
    partial: number;
    blocked: number;
    tooNoisy: number;
    possiblyTooQuiet: number;
    mixedReview: number;
    dataUnproven: number;
    weakFirstPosts: number;
    missingRuntimeMarkers: number;
  };
  runtimeMarkers: Array<{
    runtimeVersion?: string;
    runtimeStartedAt?: string;
    runtimePid?: number;
    rowCount: number;
  }>;
  symbols: SessionBehaviorAuditSymbol[];
};

export type GenerateSessionBehaviorAuditOptions = {
  auditPath: string;
  cacheDirectoryPath?: string;
  provider?: CandleProviderName;
};

export type WriteSessionBehaviorAuditOptions = GenerateSessionBehaviorAuditOptions & {
  jsonPath: string;
  markdownPath: string;
};

const TIMEFRAMES: CandleFetchTimeframe[] = ["daily", "4h", "5m"];

function readRows(path: string): AuditRow[] {
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

function symbolOf(row: AuditRow): string {
  return row.symbol?.trim().toUpperCase() || "UNKNOWN";
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

function text(row: AuditRow): string {
  return [row.title, row.body, row.bodyPreview].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function excerpt(row: AuditRow, maxLength = 260): string {
  const value = text(row);
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

function pctChange(next: number, previous: number): number {
  if (!Number.isFinite(next) || !Number.isFinite(previous) || Math.abs(previous) <= 0.000001) {
    return 0;
  }
  return ((next - previous) / previous) * 100;
}

function formatPct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatPrice(value: number): string {
  return value >= 1 ? value.toFixed(2) : value.toFixed(4);
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

function walkJsonlFiles(directoryPath: string): string[] {
  if (!existsSync(directoryPath)) {
    return [];
  }
  const output: string[] = [];
  for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
    const path = join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      output.push(...walkJsonlFiles(path));
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
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

function readWarehouseCandles(path: string): Candle[] {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Candle];
      } catch {
        return [];
      }
    })
    .filter((candle) =>
      [candle.timestamp, candle.open, candle.high, candle.low, candle.close].every(
        (value) => typeof value === "number" && Number.isFinite(value),
      ),
    );
}

function extractCandles(entry: CachedCandleEntry | null): Candle[] {
  const candles = entry?.response?.candles ?? entry?.candles ?? [];
  return candles.filter((candle) =>
    [candle.timestamp, candle.open, candle.high, candle.low, candle.close].every(
      (value) => typeof value === "number" && Number.isFinite(value),
    ),
  );
}

function loadCacheEntries(params: {
  cacheDirectoryPath: string;
  provider: CandleProviderName;
  symbol: string;
  timeframe: CandleFetchTimeframe;
}): CachedCandleEntry[] {
  const directoryPath = join(params.cacheDirectoryPath, params.provider, params.symbol, params.timeframe);
  return walkJsonFiles(directoryPath)
    .map(parseCacheEntry)
    .filter((entry): entry is CachedCandleEntry => entry !== null);
}

function loadCandles(params: {
  cacheDirectoryPath: string;
  provider: CandleProviderName;
  symbol: string;
  timeframe: CandleFetchTimeframe;
}): { candles: Candle[]; latestCacheAt: number | null } {
  const byTimestamp = new Map<number, Candle>();
  let latestCacheAt: number | null = null;
  for (const entry of loadCacheEntries(params)) {
    if (typeof entry.cachedAt === "number" && Number.isFinite(entry.cachedAt)) {
      latestCacheAt = Math.max(latestCacheAt ?? entry.cachedAt, entry.cachedAt);
    }
    for (const candle of extractCandles(entry)) {
      byTimestamp.set(candle.timestamp, candle);
    }
  }
  const directoryPath = join(params.cacheDirectoryPath, params.provider, params.symbol, params.timeframe);
  for (const file of walkJsonlFiles(directoryPath)) {
    latestCacheAt = Math.max(latestCacheAt ?? statSync(file).mtimeMs, statSync(file).mtimeMs);
    for (const candle of readWarehouseCandles(file)) {
      byTimestamp.set(candle.timestamp, candle);
    }
  }
  return {
    candles: [...byTimestamp.values()].sort((left, right) => left.timestamp - right.timestamp),
    latestCacheAt,
  };
}

function freshnessFor(params: {
  cacheDirectoryPath: string;
  provider: CandleProviderName;
  symbol: string;
  timeframe: CandleFetchTimeframe;
  lastPostAt: number | null;
}): CandleTimeframeFreshness {
  const { candles, latestCacheAt } = loadCandles(params);
  const latest = candles.at(-1)?.timestamp ?? null;
  const lagToLastPostMinutes =
    latest !== null && params.lastPostAt !== null
      ? Math.round(((params.lastPostAt - latest) / 60_000) * 10) / 10
      : null;

  let status: CandleFreshnessStatus = "missing";
  if (latest !== null) {
    const freshLimit = params.timeframe === "5m" ? 15 : params.timeframe === "4h" ? 8 * 60 : 72 * 60;
    const usableLimit = params.timeframe === "5m" ? 45 : params.timeframe === "4h" ? 24 * 60 : 7 * 24 * 60;
    if (lagToLastPostMinutes !== null && lagToLastPostMinutes <= freshLimit) {
      status = "fresh";
    } else if (lagToLastPostMinutes !== null && lagToLastPostMinutes <= usableLimit) {
      status = "usable";
    } else {
      status = "stale";
    }
  }

  return {
    timeframe: params.timeframe,
    candleCount: candles.length,
    latestCandleTimestamp: latest,
    latestCandleIso: latest === null ? null : new Date(latest).toISOString(),
    latestCacheAt,
    lagToLastPostMinutes,
    status,
  };
}

function readinessFor(freshness: CandleTimeframeFreshness[]): CandleReadinessStatus {
  const five = freshness.find((item) => item.timeframe === "5m");
  const daily = freshness.find((item) => item.timeframe === "daily");
  const fourHour = freshness.find((item) => item.timeframe === "4h");
  if (!five || five.status === "missing" || !daily || daily.status === "missing" || !fourHour || fourHour.status === "missing") {
    return "blocked";
  }
  if (five.status === "fresh" && daily.status !== "stale" && fourHour.status !== "stale") {
    return "ready";
  }
  return "partial";
}

export function scoreFirstPostTradeMapText(input: ScoreFirstPostTradeMapTextInput | null | undefined): FirstPostTradeMapScore {
  if (!input) {
    return {
      label: "missing",
      score: 0,
      timestamp: null,
      strengths: [],
      issues: ["no saved first post"],
      excerpt: null,
    };
  }

  const body = input.body.trim();
  let score = 40;
  const strengths: string[] = [];
  const issues: string[] = [];
  const checks: Array<[RegExp, string, number]> = [
    [/Price:/i, "shows current price", 8],
    [/What price is doing now|Trade map|Current read/i, "frames current context", 10],
    [/Closest levels to watch/i, "shows closest levels", 10],
    [/More support and resistance/i, "preserves full ladder", 8],
    [/main support|support that matters|holding above|needs to hold|Support:\s*\n/i, "identifies practical support context", 8],
    [/cleaner above|clears|above .* resistance|Resistance:\s*\n/i, "identifies practical resistance context", 8],
    [/range-bound|runner|chop|extended|building|pressing|between .*support.*resistance/i, "frames the trade story without advice", 6],
    [/Resistance:\s*\n/i, "formats resistance line-by-line", 8],
    [/Support:\s*\n/i, "formats support line-by-line", 8],
    [/light support|moderate support|heavy support|major support/i, "labels support strength", 6],
    [/light resistance|moderate resistance|heavy resistance|major resistance/i, "labels resistance strength", 6],
  ];
  for (const [pattern, label, points] of checks) {
    if (pattern.test(body)) {
      score += points;
      strengths.push(label);
    } else {
      issues.push(`missing: ${label}`);
    }
  }
  if (/not a price target|best entry|can buy|should buy|should sell|should exit|short/i.test(body)) {
    score -= 20;
    issues.push("contains wording that is too advisory, defensive, or short-framed");
  }
  if (!/What price is doing now|Trade map|Current read/i.test(body)) {
    score -= 12;
    issues.push("missing: trader-readable current read section");
  }
  if (!/room|range-bound|range bound|runner|chop|extended|building|pressing|between .*support.*resistance/i.test(body)) {
    score -= 12;
    issues.push("missing: room, range, or behavior context");
  }
  if (/risk opens toward\s+\d+(?:\.\d+)?/i.test(body) && /\b0?\.\d{2,4}\b/.test(body)) {
    score -= 10;
    issues.push("may make penny-level risk sound too precise");
  }
  if (/risk opens toward/i.test(body) && !/major support|heavy support|structure low|range low/i.test(body)) {
    score -= 12;
    issues.push("risk language is not anchored to a meaningful support or structure level");
  }
  if (!/main support|support that matters|main decision|cleaner above|room above|room below|upside room|downside room|current structure|range-bound|range bound/i.test(body)) {
    score -= 8;
    issues.push("missing: practical trade-map lines beyond the raw ladder");
  }
  if (/no (higher|nearby)?\s*resistance|Resistance above: none/i.test(body)) {
    score -= 12;
    issues.push("forward resistance wording should be backed by explicit extension-cache or audit diagnostics");
  }
  score = Math.max(0, Math.min(100, score));
  const label: FirstPostScoreLabel = score >= 82 ? "strong" : score >= 65 ? "usable" : "weak";
  return {
    label,
    score,
    title: input.title,
    timestamp: input.timestamp ?? null,
    strengths,
    issues,
    excerpt: body.replace(/\s+/g, " ").length <= 260
      ? body.replace(/\s+/g, " ")
      : `${body.replace(/\s+/g, " ").slice(0, 257)}...`,
  };
}

function firstPostScore(rows: AuditRow[]): FirstPostTradeMapScore {
  const first = rows.find((row) => row.operation === "post_level_snapshot") ?? rows[0];
  return first
    ? scoreFirstPostTradeMapText({
        title: first.title,
        body: text(first),
        timestamp: rowTimestamp(first),
      })
    : scoreFirstPostTradeMapText(null);
}

function expectedPostBudget(profile: SessionBehaviorProfile): number {
  switch (profile) {
    case "range_chop":
    case "thin_low_activity":
    case "accumulating_under_resistance":
      return 10;
    case "clean_runner":
      return 26;
    case "volatile_runner":
      return 34;
    case "failed_runner":
      return 18;
    default:
      return 16;
  }
}

function repeatedStorySignals(rows: AuditRow[]): number {
  let repeats = 0;
  let previous = "";
  for (const row of rows) {
    const key = [
      row.operation,
      row.messageKind,
      row.eventType,
      row.rangeBoxLabel,
      row.acceptanceLabel,
      row.failedLevelOutcome,
      row.levelImportanceLabel,
    ].join("|");
    if (key === previous) {
      repeats += 1;
    }
    previous = key;
  }
  return repeats;
}

function candlesInsideWindow(candles: Candle[], firstPostAt: number | null, lastPostAt: number | null): Candle[] {
  if (firstPostAt === null || lastPostAt === null) {
    return candles;
  }
  const paddingMs = 10 * 60 * 1000;
  return candles.filter((candle) => candle.timestamp >= firstPostAt - paddingMs && candle.timestamp <= lastPostAt + paddingMs);
}

function behaviorProfile(params: {
  candles: Candle[];
  postRows: AuditRow[];
}): SessionBehaviorAuditSymbol["behaviorProfile"] {
  const candles = params.candles;
  const reasons: string[] = [];
  if (candles.length < 4) {
    return {
      label: "mixed_unknown",
      priceRangePct: null,
      maxFiveMinuteMovePct: null,
      reviewedCandleCount: candles.length,
      reasons: ["not enough candle evidence in the audited window"],
    };
  }
  const high = Math.max(...candles.map((candle) => candle.high));
  const low = Math.min(...candles.map((candle) => candle.low));
  const firstClose = candles[0]!.close;
  const lastClose = candles.at(-1)!.close;
  const priceRangePct = pctChange(high, low);
  let maxFiveMinuteMovePct = 0;
  for (let index = 1; index < candles.length; index += 1) {
    maxFiveMinuteMovePct = Math.max(
      maxFiveMinuteMovePct,
      Math.abs(pctChange(candles[index]!.close, candles[index - 1]!.close)),
    );
  }
  const netMovePct = pctChange(lastClose, firstClose);
  const rangeBoxCount = params.postRows.filter((row) => row.rangeBoxLabel === "active" || row.behaviorBudgetLabel === "boring_range").length;
  const breakoutCount = params.postRows.filter((row) => /breakout|resistance/i.test(`${row.eventType ?? ""} ${row.title ?? ""}`)).length;
  const breakdownCount = params.postRows.filter((row) => /breakdown|support lost|support crossed/i.test(`${row.eventType ?? ""} ${row.title ?? ""}`)).length;

  let label: SessionBehaviorProfile = "mixed_unknown";
  if (priceRangePct < 8 && rangeBoxCount >= 2) {
    label = "range_chop";
    reasons.push("tight range with repeated range-box evidence");
  } else if (priceRangePct >= 35 && maxFiveMinuteMovePct >= 12) {
    label = "volatile_runner";
    reasons.push("wide intraday range with large 5m expansion");
  } else if (priceRangePct >= 18 && netMovePct > 8 && breakoutCount >= breakdownCount) {
    label = "clean_runner";
    reasons.push("net upside expansion with breakout-heavy story");
  } else if (priceRangePct >= 18 && netMovePct < -6 && breakdownCount >= breakoutCount) {
    label = "failed_runner";
    reasons.push("wide range faded into support-loss/downside story");
  } else if (priceRangePct < 12 && breakoutCount > 0 && breakdownCount === 0) {
    label = "accumulating_under_resistance";
    reasons.push("contained range with resistance pressure evidence");
  } else if (priceRangePct < 6 && params.postRows.length <= 3) {
    label = "thin_low_activity";
    reasons.push("low movement and low saved post activity");
  } else {
    reasons.push("mixed evidence; keep human review in the loop");
  }

  return {
    label,
    priceRangePct,
    maxFiveMinuteMovePct,
    reviewedCandleCount: candles.length,
    reasons,
  };
}

function buildTimeline(params: {
  rows: AuditRow[];
  moves: ReviewedCandleMove[];
}): CandleSyncedTimelineItem[] {
  const postItems: CandleSyncedTimelineItem[] = params.rows.slice(0, 20).map((row) => {
    const timestamp = rowTimestamp(row) ?? row.timestamp ?? 0;
    return {
      timestamp,
      timestampIso: new Date(timestamp).toISOString(),
      kind: "post",
      title: row.title ?? row.operation ?? "post",
      detail: excerpt(row, 180),
    };
  });
  const moveItems: CandleSyncedTimelineItem[] = params.moves.slice(0, 10).map((move) => ({
    timestamp: move.timestamp,
    timestampIso: move.timestampIso,
    kind: "candle_move",
    title: "5m candle move",
    detail: `${formatPrice(move.previousClose)} -> ${formatPrice(move.close)} (${formatPct(move.closeMovePct)}), range ${formatPct(move.rangePct)}`,
  }));
  return [...postItems, ...moveItems]
    .sort((left, right) => left.timestamp - right.timestamp)
    .slice(0, 34);
}

function runtimeMarkers(rows: AuditRow[]): SessionBehaviorAuditReport["runtimeMarkers"] {
  const groups = new Map<string, SessionBehaviorAuditReport["runtimeMarkers"][number]>();
  for (const row of rows) {
    const key = [row.runtimeVersion ?? "missing", row.runtimeStartedAt ?? "missing", row.runtimePid ?? "missing"].join("|");
    const current = groups.get(key);
    if (current) {
      current.rowCount += 1;
    } else {
      groups.set(key, {
        runtimeVersion: row.runtimeVersion,
        runtimeStartedAt: row.runtimeStartedAt,
        runtimePid: row.runtimePid,
        rowCount: 1,
      });
    }
  }
  return [...groups.values()].sort((left, right) => right.rowCount - left.rowCount);
}

function threadBalance(params: {
  rows: AuditRow[];
  profile: SessionBehaviorProfile;
  missed: MissedMeaningfulMoveAuditReport["symbols"][number] | undefined;
  readiness: CandleReadinessStatus;
  repeats: number;
}): SessionBehaviorAuditSymbol["threadBalance"] {
  const expectedMaxPosts = expectedPostBudget(params.profile);
  const missedCandidates = params.missed?.missedCount ?? 0;
  const majorMissedCandidates = params.missed?.majorCount ?? 0;
  const reasons: string[] = [];
  let verdict: ThreadBalanceVerdict = "balanced";

  if (params.readiness !== "ready") {
    verdict = "data_unproven";
    reasons.push("candle evidence is not fully fresh/ready for this symbol");
  }
  if (params.rows.length > expectedMaxPosts * 1.35 && majorMissedCandidates === 0) {
    verdict = verdict === "data_unproven" ? "data_unproven" : "too_noisy";
    reasons.push(`post count ${params.rows.length} is above expected max ${expectedMaxPosts}`);
  }
  if (majorMissedCandidates > 0 || missedCandidates >= 3) {
    verdict = params.readiness === "ready" && verdict !== "too_noisy" ? "possibly_too_quiet" : "mixed_review";
    reasons.push(
      params.readiness === "ready"
        ? `${missedCandidates} missed candle-backed move candidates, ${majorMissedCandidates} major`
        : `${missedCandidates} missed candle-backed move candidates, ${majorMissedCandidates} major, but candle evidence is not fresh enough for a clean quiet-thread verdict`,
    );
  }
  if (params.repeats >= 4) {
    reasons.push(`${params.repeats} repeated adjacent story signals`);
  }
  if (!reasons.length) {
    reasons.push("post count and missed-move evidence look balanced");
  }

  return {
    verdict,
    expectedMaxPosts,
    missedCandidates,
    majorMissedCandidates,
    repeatedStorySignals: params.repeats,
    reasons,
  };
}

function buildOperatorRecapPreview(params: {
  symbol: string;
  postCount: number;
  readiness: CandleReadinessStatus;
  profile: SessionBehaviorAuditSymbol["behaviorProfile"];
  balance: SessionBehaviorAuditSymbol["threadBalance"];
  firstPost: FirstPostTradeMapScore;
}): string[] {
  const lines = [
    `${params.symbol}: ${params.profile.label} session with ${params.postCount}/${params.balance.expectedMaxPosts} posts against the current budget; audit verdict ${params.balance.verdict}.`,
  ];
  if (params.profile.priceRangePct !== null) {
    lines.push(
      `Reviewed candle range ${formatPct(params.profile.priceRangePct)}; max 5m close move ${formatPct(params.profile.maxFiveMinuteMovePct ?? 0)} across ${params.profile.reviewedCandleCount} candles.`,
    );
  } else {
    lines.push(`Only ${params.profile.reviewedCandleCount} reviewed 5m candles were available, so the behavior profile needs more evidence.`);
  }
  lines.push(`Candle readiness is ${params.readiness}; ${params.readiness === "ready" ? "post-budget conclusions can be reviewed normally." : "do not tune live posting policy from this symbol alone."}`);
  lines.push(`First post scored ${params.firstPost.label} (${params.firstPost.score}/100).`);
  if (params.balance.missedCandidates > 0) {
    lines.push(
      `${params.balance.missedCandidates} missed meaningful-move candidates were flagged (${params.balance.majorMissedCandidates} major); review these before tightening noise gates further.`,
    );
  }
  if (params.balance.repeatedStorySignals > 0) {
    lines.push(`${params.balance.repeatedStorySignals} adjacent repeated-story signals were detected; check whether the thread repeated the same level story.`);
  }
  return lines;
}

export function generateSessionBehaviorAudit(
  options: GenerateSessionBehaviorAuditOptions,
): SessionBehaviorAuditReport {
  const auditPath = resolve(options.auditPath);
  const cacheDirectoryPath = resolve(options.cacheDirectoryPath ?? join(process.cwd(), ".validation-cache", "candles"));
  const provider = options.provider ?? "ibkr";
  const rows = readRows(auditPath).filter(isPosted);
  const rowsBySymbol = new Map<string, AuditRow[]>();
  for (const row of rows) {
    const symbol = symbolOf(row);
    rowsBySymbol.set(symbol, [...(rowsBySymbol.get(symbol) ?? []), row]);
  }
  const missedReport = generateMissedMeaningfulMoveAudit({
    auditPath,
    cacheDirectoryPath,
    provider,
  });
  const missedBySymbol = new Map(missedReport.symbols.map((symbol) => [symbol.symbol, symbol]));

  const symbols: SessionBehaviorAuditSymbol[] = [...rowsBySymbol.entries()].map(([symbol, symbolRows]) => {
    const timestamps = symbolRows.map(rowTimestamp).filter((value): value is number => value !== null);
    const firstPostAt = timestamps.length ? Math.min(...timestamps) : null;
    const lastPostAt = timestamps.length ? Math.max(...timestamps) : null;
    const freshness = TIMEFRAMES.map((timeframe) =>
      freshnessFor({
        cacheDirectoryPath,
        provider,
        symbol,
        timeframe,
        lastPostAt,
      }),
    );
    const readiness = readinessFor(freshness);
    const fiveMinuteCandles = candlesInsideWindow(
      loadCandles({ cacheDirectoryPath, provider, symbol, timeframe: "5m" }).candles,
      firstPostAt,
      lastPostAt,
    );
    const profile = behaviorProfile({ candles: fiveMinuteCandles, postRows: symbolRows });
    const repeats = repeatedStorySignals(symbolRows);
    const missed = missedBySymbol.get(symbol);

    const balance = threadBalance({
      rows: symbolRows,
      profile: profile.label,
      missed,
      readiness,
      repeats,
    });
    const firstPost = firstPostScore(symbolRows);

    return {
      symbol,
      firstPostAt,
      lastPostAt,
      postCount: symbolRows.length,
      alertCount: symbolRows.filter((row) => row.operation === "post_alert").length,
      candleReadiness: readiness,
      candleFreshness: freshness,
      firstPostScore: firstPost,
      threadBalance: balance,
      behaviorProfile: profile,
      operatorRecapPreview: buildOperatorRecapPreview({
        symbol,
        postCount: symbolRows.length,
        readiness,
        profile,
        balance,
        firstPost,
      }),
      timeline: buildTimeline({
        rows: symbolRows,
        moves: missed?.largestReviewedMoves ?? [],
      }),
    };
  });

  const totals = symbols.reduce(
    (accumulator, symbol) => ({
      symbols: accumulator.symbols + 1,
      ready: accumulator.ready + (symbol.candleReadiness === "ready" ? 1 : 0),
      partial: accumulator.partial + (symbol.candleReadiness === "partial" ? 1 : 0),
      blocked: accumulator.blocked + (symbol.candleReadiness === "blocked" ? 1 : 0),
      tooNoisy: accumulator.tooNoisy + (symbol.threadBalance.verdict === "too_noisy" ? 1 : 0),
      possiblyTooQuiet: accumulator.possiblyTooQuiet + (symbol.threadBalance.verdict === "possibly_too_quiet" ? 1 : 0),
      mixedReview: accumulator.mixedReview + (symbol.threadBalance.verdict === "mixed_review" ? 1 : 0),
      dataUnproven: accumulator.dataUnproven + (symbol.threadBalance.verdict === "data_unproven" ? 1 : 0),
      weakFirstPosts: accumulator.weakFirstPosts + (symbol.firstPostScore.label === "weak" || symbol.firstPostScore.label === "missing" ? 1 : 0),
      missingRuntimeMarkers: accumulator.missingRuntimeMarkers,
    }),
    {
      symbols: 0,
      ready: 0,
      partial: 0,
      blocked: 0,
      tooNoisy: 0,
      possiblyTooQuiet: 0,
      mixedReview: 0,
      dataUnproven: 0,
      weakFirstPosts: 0,
      missingRuntimeMarkers: rows.filter((row) => !row.runtimeVersion).length,
    },
  );

  return {
    generatedAt: new Date().toISOString(),
    sourceAuditPath: auditPath,
    cacheDirectoryPath,
    provider,
    totals,
    runtimeMarkers: runtimeMarkers(rows),
    symbols: symbols.sort((left, right) => {
      const rank = {
        mixed_review: 0,
        possibly_too_quiet: 1,
        too_noisy: 2,
        data_unproven: 3,
        balanced: 4,
      } as const;
      return rank[left.threadBalance.verdict] - rank[right.threadBalance.verdict] || right.postCount - left.postCount;
    }),
  };
}

function renderFreshness(freshness: CandleTimeframeFreshness[]): string {
  return freshness
    .map((item) => `${item.timeframe}: ${item.status}${item.latestCandleIso ? ` through ${item.latestCandleIso}` : ""}`)
    .join("; ");
}

export function renderSessionBehaviorAuditMarkdown(report: SessionBehaviorAuditReport): string {
  const lines = [
    "# Session Behavior And Readiness Audit",
    "",
    "Operator-only report. It combines candle freshness/readiness, first-post quality, thread balance, candle-synced timeline evidence, and current-session behavior profiles.",
    "",
    `Generated: ${report.generatedAt}`,
    `Audit source: ${report.sourceAuditPath}`,
    `Candle cache: ${report.cacheDirectoryPath}`,
    `Provider: ${report.provider}`,
    "",
    "## Totals",
    "",
    `- Symbols: ${report.totals.symbols}`,
    `- Candle readiness: ${report.totals.ready} ready / ${report.totals.partial} partial / ${report.totals.blocked} blocked`,
    `- Thread balance: ${report.totals.tooNoisy} too noisy / ${report.totals.possiblyTooQuiet} possibly too quiet / ${report.totals.mixedReview} mixed review / ${report.totals.dataUnproven} data unproven`,
    `- Weak or missing first posts: ${report.totals.weakFirstPosts}`,
    `- Audit rows missing runtime markers: ${report.totals.missingRuntimeMarkers}`,
    "",
    "## Runtime Markers",
    "",
  ];

  if (report.runtimeMarkers.length) {
    lines.push("| Runtime version | Started at | PID | Rows |", "| --- | --- | ---: | ---: |");
    for (const marker of report.runtimeMarkers.slice(0, 8)) {
      lines.push(`| ${marker.runtimeVersion ?? "missing"} | ${marker.runtimeStartedAt ?? "missing"} | ${marker.runtimePid ?? "n/a"} | ${marker.rowCount} |`);
    }
  } else {
    lines.push("- none");
  }

  lines.push("", "## Symbol Scoreboard", "");
  lines.push("| Symbol | Readiness | Behavior | Balance | Posts | First post | Missed | Freshness |");
  lines.push("| --- | --- | --- | --- | ---: | --- | ---: | --- |");
  for (const symbol of report.symbols) {
    lines.push(
      `| ${symbol.symbol} | ${symbol.candleReadiness} | ${symbol.behaviorProfile.label} | ${symbol.threadBalance.verdict} | ${symbol.postCount} | ${symbol.firstPostScore.label} ${symbol.firstPostScore.score} | ${symbol.threadBalance.missedCandidates} | ${renderFreshness(symbol.candleFreshness)} |`,
    );
  }

  lines.push("", "## Review Details", "");
  for (const symbol of report.symbols.slice(0, 14)) {
    lines.push(`### ${symbol.symbol}`, "");
    lines.push(`- Candle readiness: ${symbol.candleReadiness}`);
    lines.push(`- Session behavior profile: ${symbol.behaviorProfile.label}; ${symbol.behaviorProfile.reasons.join("; ")}`);
    if (symbol.behaviorProfile.priceRangePct !== null) {
      lines.push(`- Reviewed candle range: ${formatPct(symbol.behaviorProfile.priceRangePct)}; max 5m close move: ${formatPct(symbol.behaviorProfile.maxFiveMinuteMovePct ?? 0)}`);
    }
    lines.push(`- Thread balance: ${symbol.threadBalance.verdict}; ${symbol.threadBalance.reasons.join("; ")}`);
    if (symbol.operatorRecapPreview.length) {
      lines.push("- Operator recap preview:");
      for (const line of symbol.operatorRecapPreview.slice(0, 6)) {
        lines.push(`  - ${line}`);
      }
    }
    lines.push(`- First post score: ${symbol.firstPostScore.label} ${symbol.firstPostScore.score}`);
    if (symbol.firstPostScore.issues.length) {
      lines.push(`- First post issues: ${symbol.firstPostScore.issues.slice(0, 4).join("; ")}`);
    }
    if (symbol.timeline.length) {
      lines.push("- Timeline sample:");
      for (const item of symbol.timeline.slice(0, 8)) {
        lines.push(`  - ${item.timestampIso} ${item.kind}: ${item.title} - ${item.detail}`);
      }
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

export function writeSessionBehaviorAudit(options: WriteSessionBehaviorAuditOptions): SessionBehaviorAuditReport {
  const report = generateSessionBehaviorAudit(options);
  mkdirSync(dirname(options.jsonPath), { recursive: true });
  writeFileSync(options.jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(options.markdownPath, renderSessionBehaviorAuditMarkdown(report), "utf8");
  return report;
}
