import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { AlertIntelligenceEngine } from "../lib/alerts/alert-intelligence-engine.js";
import { formatIntelligentAlertAsPayload } from "../lib/alerts/alert-router.js";
import { DurableCandleWarehouse } from "../lib/candle-warehouse/index.js";
import type { Candle, CandleTimeframe } from "../lib/market-data/candle-types.js";
import type { LivePriceListener, LivePriceProvider } from "../lib/monitoring/live-price-types.js";
import { LevelStore } from "../lib/monitoring/level-store.js";
import type { MonitoringEvent, WatchlistEntry } from "../lib/monitoring/monitoring-types.js";
import { WatchlistMonitor } from "../lib/monitoring/watchlist-monitor.js";
import { buildSupportResistanceContextFromNormalizedCandles } from "../lib/support-resistance/build-support-resistance-context.js";

type ReplayCase = {
  symbol: string;
  date: string;
  time: string;
  note: string;
};

type StoryPost = {
  timestamp: number;
  eventType: string;
  zoneKind: "support" | "resistance";
  triggerPrice: number;
  shouldPost: boolean;
  deliveryReason: string;
  severity: string;
  confidence: string;
  score: number;
  shouldNotify: boolean;
  mapSide: "support" | "resistance" | null;
  mapLevelCount: number;
  mapTopPct: number | null;
  mapBottomPct: number | null;
  continuationMapSide: "support" | "resistance" | null;
  continuationMapLevelCount: number;
  continuationMapTopPct: number | null;
  continuationMapBottomPct: number | null;
  body: string;
};

const PROVIDER = "ibkr" as const;
const WAREHOUSE_ROOT = "data/candles";
const DEFAULT_OUT_DIR = "artifacts/support-resistance-story-replay";
const DEFAULT_HORIZON_HOURS = 5;

const DEFAULT_CASES: ReplayCase[] = [
  { symbol: "MNDR", date: "2026-05-04", time: "09:30", note: "today runner / map exhaustion concern" },
  { symbol: "RLYB", date: "2026-05-04", time: "08:00", note: "today Discord length/problem ticker" },
  { symbol: "CLNN", date: "2026-05-04", time: "08:15", note: "today clean reference post style" },
  { symbol: "ATXI", date: "2026-05-04", time: "09:30", note: "closest-level range concern" },
  { symbol: "AKAN", date: "2026-04-22", time: "11:00", note: "last-week fast runner" },
  { symbol: "SKLZ", date: "2026-04-23", time: "12:15", note: "last-week fast runner" },
  { symbol: "ATER", date: "2026-04-28", time: "08:50", note: "last-week active mover" },
  { symbol: "YAAS", date: "2026-04-27", time: "09:15", note: "last-week premarket mover" },
];

async function loadReplayCases(): Promise<ReplayCase[]> {
  const casesPath = argValue("--cases");
  if (!casesPath) {
    return DEFAULT_CASES;
  }

  const parsed = JSON.parse(await readFile(casesPath, "utf8")) as ReplayCase[] | { cases?: ReplayCase[] };
  const cases = Array.isArray(parsed) ? parsed : parsed.cases;
  if (!cases || cases.length === 0) {
    throw new Error(`No replay cases found in ${casesPath}`);
  }
  return cases.map((item) => ({
    symbol: item.symbol.toUpperCase(),
    date: item.date,
    time: item.time,
    note: item.note ?? "queued support/resistance story replay",
  }));
}

class HistoricalReplayLivePriceProvider implements LivePriceProvider {
  constructor(private readonly candlesBySymbol: ReadonlyMap<string, readonly Candle[]>) {}

  private candlePath(candle: Candle): number[] {
    const middlePath = candle.close >= candle.open
      ? [candle.low, candle.high]
      : [candle.high, candle.low];
    const prices = [candle.open, ...middlePath, candle.close]
      .filter((price) => Number.isFinite(price) && price > 0);
    return prices.filter((price, index) => index === 0 || Math.abs(price - prices[index - 1]!) > 0.000001);
  }

  async start(entries: WatchlistEntry[], onUpdate: LivePriceListener): Promise<void> {
    for (const entry of entries) {
      if (!entry.active) {
        continue;
      }
      const symbol = entry.symbol.toUpperCase();
      for (const candle of this.candlesBySymbol.get(symbol) ?? []) {
        const path = this.candlePath(candle);
        for (const [index, price] of path.entries()) {
          onUpdate({
            symbol,
            timestamp: candle.timestamp + index,
            lastPrice: price,
            volume: candle.volume,
          });
        }
      }
    }
  }

  async stop(): Promise<void> {}
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function numberArg(flag: string, fallback: number): number {
  const parsed = Number.parseFloat(argValue(flag) ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function integerArg(flag: string, fallback: number): number {
  const parsed = Number.parseInt(argValue(flag) ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseEasternTimestamp(date: string, time: string): number {
  return Date.parse(`${date}T${time}:00-04:00`);
}

function startOfEasternDay(date: string): number {
  return Date.parse(`${date}T00:00:00-04:00`);
}

function timeframeMs(timeframe: CandleTimeframe): number {
  if (timeframe === "daily") {
    return 24 * 60 * 60 * 1000;
  }
  if (timeframe === "4h") {
    return 4 * 60 * 60 * 1000;
  }
  return 5 * 60 * 1000;
}

function formatLevel(price: number | null | undefined): string {
  if (typeof price !== "number" || !Number.isFinite(price)) {
    return "n/a";
  }
  return price >= 1 ? price.toFixed(2) : price.toFixed(4);
}

function formatPct(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}%` : "n/a";
}

function formatEasternTime(timestamp: number | null | undefined): string {
  if (!timestamp) {
    return "n/a";
  }
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Toronto",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

async function readWarehouseCandles(
  warehouse: DurableCandleWarehouse,
  symbol: string,
  timeframe: CandleTimeframe,
  startTimestamp: number,
  endTimestamp: number,
): Promise<Candle[]> {
  return warehouse.getCandles({
    provider: PROVIDER,
    symbol,
    timeframe,
    startTimestamp,
    endTimestamp,
  });
}

async function buildLevelStoreAt(warehouse: DurableCandleWarehouse, item: ReplayCase, timestamp: number) {
  const symbol = item.symbol.toUpperCase();
  const dayStart = startOfEasternDay(item.date);
  const daily = await readWarehouseCandles(warehouse, symbol, "daily", dayStart - 420 * timeframeMs("daily"), dayStart - 1);
  const fourHour = await readWarehouseCandles(warehouse, symbol, "4h", timestamp - 220 * timeframeMs("4h"), timestamp);
  const fiveMinute = await readWarehouseCandles(warehouse, symbol, "5m", timestamp - 420 * timeframeMs("5m"), timestamp);
  const currentPrice = fiveMinute.at(-1)?.close ?? fourHour.at(-1)?.close ?? daily.at(-1)?.close;

  if (!currentPrice || daily.length === 0 || fourHour.length === 0) {
    return {
      status: "missing_candles" as const,
      currentPrice: currentPrice ?? null,
      dailyCount: daily.length,
      fourHourCount: fourHour.length,
      fiveMinuteCount: fiveMinute.length,
    };
  }

  const context = await buildSupportResistanceContextFromNormalizedCandles({
    symbol,
    candlesByTimeframe: {
      daily,
      "4h": fourHour,
      "5m": fiveMinute,
    },
    asOfTimestamp: timestamp,
    sessionDate: item.date,
    currentPrice,
  });
  const store = new LevelStore();
  store.setLevels(context.levels);
  return {
    status: "ok" as const,
    currentPrice,
    dailyCount: daily.length,
    fourHourCount: fourHour.length,
    fiveMinuteCount: fiveMinute.length,
    store,
  };
}

function summarizeStoryPost(event: MonitoringEvent, alertResult: ReturnType<AlertIntelligenceEngine["processEvent"]>): StoryPost {
  const payload = formatIntelligentAlertAsPayload(alertResult.rawAlert);
  const planningLevels = alertResult.rawAlert.nextBarrier?.planningLevels ?? [];
  const mapSide = alertResult.rawAlert.nextBarrier?.side ?? null;
  const continuationPlanningLevels = alertResult.rawAlert.continuationBarrier?.planningLevels ?? [];
  const continuationMapSide = alertResult.rawAlert.continuationBarrier?.side ?? null;
  const mapTopPct =
    mapSide === "resistance" && planningLevels.length > 0
      ? Math.max(...planningLevels.map((level) => level.distancePct * 100))
      : null;
  const mapBottomPct =
    mapSide === "support" && planningLevels.length > 0
      ? Math.max(...planningLevels.map((level) => level.distancePct * 100))
      : null;
  const continuationMapTopPct =
    continuationMapSide === "resistance" && continuationPlanningLevels.length > 0
      ? Math.max(...continuationPlanningLevels.map((level) => level.distancePct * 100))
      : null;
  const continuationMapBottomPct =
    continuationMapSide === "support" && continuationPlanningLevels.length > 0
      ? Math.max(...continuationPlanningLevels.map((level) => level.distancePct * 100))
      : null;
  return {
    timestamp: event.timestamp,
    eventType: event.eventType,
    zoneKind: event.zoneKind,
    triggerPrice: event.triggerPrice,
    shouldPost: alertResult.delivery.shouldPost,
    deliveryReason: alertResult.delivery.reason,
    severity: alertResult.rawAlert.severity,
    confidence: alertResult.rawAlert.confidence,
    score: alertResult.rawAlert.score,
    shouldNotify: alertResult.rawAlert.shouldNotify,
    mapSide,
    mapLevelCount: planningLevels.length,
    mapTopPct,
    mapBottomPct,
    continuationMapSide,
    continuationMapLevelCount: continuationPlanningLevels.length,
    continuationMapTopPct,
    continuationMapBottomPct,
    body: payload.body,
  };
}

function storyPostResistanceMapReach(post: StoryPost): number | null {
  const reaches = [post.mapTopPct, post.continuationMapTopPct]
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return reaches.length > 0 ? Math.max(...reaches) : null;
}

function storyPostSupportMapReach(post: StoryPost): number | null {
  const reaches = [post.mapBottomPct, post.continuationMapBottomPct]
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return reaches.length > 0 ? Math.max(...reaches) : null;
}

async function replayCase(warehouse: DurableCandleWarehouse, item: ReplayCase, horizonHours: number) {
  const symbol = item.symbol.toUpperCase();
  const startTimestamp = parseEasternTimestamp(item.date, item.time);
  const endTimestamp = startTimestamp + horizonHours * 60 * 60 * 1000;
  const levels = await buildLevelStoreAt(warehouse, item, startTimestamp);
  if (levels.status !== "ok") {
    return {
      symbol,
      item,
      ...levels,
    };
  }

  const replayCandles = await readWarehouseCandles(warehouse, symbol, "5m", startTimestamp, endTimestamp);
  const forwardHigh = replayCandles.reduce<Candle | null>((best, candle) => (!best || candle.high > best.high ? candle : best), null);
  const forwardLow = replayCandles.reduce<Candle | null>((best, candle) => (!best || candle.low < best.low ? candle : best), null);
  const monitor = new WatchlistMonitor(
    levels.store,
    new HistoricalReplayLivePriceProvider(new Map([[symbol, replayCandles]])),
  );
  const intelligence = new AlertIntelligenceEngine();
  const posts: StoryPost[] = [];
  const events: MonitoringEvent[] = [];

  await monitor.start(
    [{ symbol, active: true, priority: 1, tags: ["support-resistance-story-replay"] }],
    (event) => {
      events.push(event);
      const alertResult = intelligence.processEvent(event, levels.store.getLevels(symbol));
      if (["level_touch", "breakout", "breakdown", "reclaim", "rejection", "fake_breakout", "fake_breakdown"].includes(event.eventType)) {
        posts.push(summarizeStoryPost(event, alertResult));
      }
    },
  );
  await monitor.stop();

  const posted = posts.filter((post) => post.shouldPost);
  const resistancePosts = posted.filter((post) => storyPostResistanceMapReach(post) !== null);
  const supportPosts = posted.filter((post) => storyPostSupportMapReach(post) !== null);
  const candidateResistancePosts = posts.filter((post) => storyPostResistanceMapReach(post) !== null);
  const candidateSupportPosts = posts.filter((post) => storyPostSupportMapReach(post) !== null);
  const widestResistanceMap = resistancePosts.reduce<number | null>(
    (widest, post) => Math.max(widest ?? 0, storyPostResistanceMapReach(post) ?? 0),
    null,
  );
  const widestSupportMap = supportPosts.reduce<number | null>(
    (widest, post) => Math.max(widest ?? 0, storyPostSupportMapReach(post) ?? 0),
    null,
  );
  const widestCandidateResistanceMap = candidateResistancePosts.reduce<number | null>(
    (widest, post) => Math.max(widest ?? 0, storyPostResistanceMapReach(post) ?? 0),
    null,
  );
  const widestCandidateSupportMap = candidateSupportPosts.reduce<number | null>(
    (widest, post) => Math.max(widest ?? 0, storyPostSupportMapReach(post) ?? 0),
    null,
  );
  const maxHighPct = forwardHigh ? ((forwardHigh.high / levels.currentPrice) - 1) * 100 : null;
  const minLowPct = forwardLow ? ((forwardLow.low / levels.currentPrice) - 1) * 100 : null;

  return {
    symbol,
    item,
    status: "ok" as const,
    startTimestamp,
    endTimestamp,
    currentPrice: levels.currentPrice,
    dailyCount: levels.dailyCount,
    fourHourCount: levels.fourHourCount,
    fiveMinuteCount: levels.fiveMinuteCount,
    replayCandleCount: replayCandles.length,
    emittedEventCount: events.length,
    storyCandidateCount: posts.length,
    postedStoryCount: posted.length,
    maxForwardHigh: forwardHigh?.high ?? null,
    maxForwardHighAt: forwardHigh?.timestamp ?? null,
    maxHighPct,
    minForwardLow: forwardLow?.low ?? null,
    minForwardLowAt: forwardLow?.timestamp ?? null,
    minLowPct,
    widestResistanceMap,
    widestSupportMap,
    widestCandidateResistanceMap,
    widestCandidateSupportMap,
    posts,
  };
}

function mapAdequacyLine(result: Awaited<ReturnType<typeof replayCase>>): string {
  if (result.status !== "ok") {
    return `Missing candles: daily=${result.dailyCount}, 4h=${result.fourHourCount}, 5m=${result.fiveMinuteCount}`;
  }
  const concerns: string[] = [];
  const maxRun = result.maxHighPct ?? 0;
  if (maxRun >= 25 && (result.widestCandidateResistanceMap ?? 0) < 22) {
    concerns.push(`upside map did not reach 25% while replay ran ${formatPct(maxRun)}`);
  }
  if (maxRun >= 35 && (result.widestCandidateResistanceMap ?? 0) < 27) {
    concerns.push(`upside map stayed materially short while replay ran ${formatPct(maxRun)}`);
  }
  if (result.postedStoryCount === 0 && result.emittedEventCount > 0) {
    concerns.push("events existed but no trader-facing story posts passed policy");
  }
  if (concerns.length === 0) {
    return "Map coverage looked acceptable for this replay window.";
  }
  return `Concern: ${concerns.join("; ")}.`;
}

function formatMarkdown(results: Array<Awaited<ReturnType<typeof replayCase>>>): string {
  const lines = [
    "# Support/Resistance Story Replay",
    "",
    "Generated: 2026-05-04 America/Toronto",
    "",
    "Scope: support/resistance story quality only. Volume, VWAP, EMA, P/L, and AI commentary quality are intentionally ignored here.",
    "",
  ];

  for (const result of results) {
    lines.push(`## ${result.symbol}`, "");
    lines.push(`- Case: ${result.item.date} ${result.item.time} ET, ${result.item.note}`);
    if (result.status !== "ok") {
      lines.push(`- Status: ${mapAdequacyLine(result)}`, "");
      continue;
    }

    lines.push(`- Start price: ${formatLevel(result.currentPrice)}`);
    lines.push(`- Replay candles: ${result.replayCandleCount}; emitted events: ${result.emittedEventCount}; story candidates: ${result.storyCandidateCount}; posted story posts: ${result.postedStoryCount}`);
    lines.push(`- Forward high: ${formatLevel(result.maxForwardHigh)} (${formatPct(result.maxHighPct)}) at ${formatEasternTime(result.maxForwardHighAt)}`);
    lines.push(`- Forward low: ${formatLevel(result.minForwardLow)} (${formatPct(result.minLowPct)}) at ${formatEasternTime(result.minForwardLowAt)}`);
    lines.push(`- Widest candidate resistance map: ${formatPct(result.widestCandidateResistanceMap)}`);
    lines.push(`- Widest candidate support map: ${formatPct(result.widestCandidateSupportMap)}`);
    lines.push(`- Widest posted resistance map: ${formatPct(result.widestResistanceMap)}`);
    lines.push(`- Widest posted support map: ${formatPct(result.widestSupportMap)}`);
    lines.push(`- Read: ${mapAdequacyLine(result)}`, "");

    const previewPosts = result.posts;
    if (previewPosts.length === 0) {
      lines.push("No support/resistance story candidates were emitted in this replay window.", "");
      continue;
    }

    for (const [index, post] of previewPosts.slice(0, 8).entries()) {
      lines.push(`### Post ${index + 1} - ${formatEasternTime(post.timestamp)} - ${post.eventType} - ${formatLevel(post.triggerPrice)}`, "");
      lines.push(`- Delivery: ${post.shouldPost ? "posted" : `filtered (${post.deliveryReason})`}`);
      lines.push(`- Alert quality: ${post.severity} / ${post.confidence} / score ${post.score.toFixed(1)} / notify ${post.shouldNotify ? "yes" : "no"}`);
      lines.push(`- Map side/count: ${post.mapSide ?? "none"} / ${post.mapLevelCount}`);
      lines.push(`- Continuation map side/count: ${post.continuationMapSide ?? "none"} / ${post.continuationMapLevelCount}`);
      lines.push(`- Map reach: resistance ${formatPct(post.mapTopPct)}, support ${formatPct(post.mapBottomPct)}`, "");
      lines.push(`- Continuation reach: resistance ${formatPct(post.continuationMapTopPct)}, support ${formatPct(post.continuationMapBottomPct)}`, "");
      lines.push("```text");
      lines.push(post.body);
      lines.push("```", "");
    }
  }

  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const outDir = argValue("--out") ?? DEFAULT_OUT_DIR;
  const horizonHours = numberArg("--hours", DEFAULT_HORIZON_HOURS);
  const offset = integerArg("--offset", 0);
  const limit = integerArg("--limit", Number.POSITIVE_INFINITY);
  const warehouse = new DurableCandleWarehouse(WAREHOUSE_ROOT);
  const cases = (await loadReplayCases()).slice(offset, Number.isFinite(limit) ? offset + limit : undefined);
  const results = [];

  for (const item of cases) {
    results.push(await replayCase(warehouse, item, horizonHours));
  }

  await mkdir(outDir, { recursive: true });
  const jsonPath = join(outDir, "support-resistance-story-replay.json");
  const markdownPath = join(outDir, "support-resistance-story-replay.md");
  await writeFile(jsonPath, `${JSON.stringify(results, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, formatMarkdown(results), "utf8");
  console.log(`Wrote ${jsonPath}`);
  console.log(`Wrote ${markdownPath}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
