import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { DurableCandleWarehouse } from "../lib/candle-warehouse/index.js";
import type { Candle, CandleTimeframe } from "../lib/market-data/candle-types.js";

type ReplayCase = {
  symbol: string;
  date: string;
  time: string;
  note: string;
};

type QueueCandidate = ReplayCase & {
  batch: number;
  score: number;
  fiveMinuteCount: number;
  dailyCount: number;
  fourHourCount: number;
  startPrice: number;
  forwardHigh: number;
  forwardHighPct: number;
  forwardLow: number;
  forwardLowPct: number;
  forwardRangePct: number;
  startTimestamp: number;
  endTimestamp: number;
};

const PROVIDER = "ibkr" as const;
const WAREHOUSE_ROOT = "data/candles";
const OUT_DIR = "artifacts/support-resistance-story-test-queue";
const DOC_PATH = "docs/support-resistance-story-test-queue.md";
const HORIZON_HOURS = 5;
const MIN_WINDOW_CANDLES = 18;
const MIN_DAILY_CANDLES = 40;
const MIN_FOUR_HOUR_CANDLES = 20;
const MIN_SCORE = 22;
const MAX_CASES = 80;
const BATCH_SIZE = 10;

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function numberArg(flag: string, fallback: number): number {
  const parsed = Number.parseFloat(argValue(flag) ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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

function easternDate(timestamp: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}

function easternTime(timestamp: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Toronto",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

function easternDateTime(timestamp: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Toronto",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function formatPrice(price: number): string {
  return price >= 1 ? price.toFixed(2) : price.toFixed(4);
}

function formatPct(value: number): string {
  return `${value.toFixed(1)}%`;
}

function startOfEasternDay(date: string): number {
  return Date.parse(`${date}T00:00:00-04:00`);
}

async function readRows(path: string): Promise<Candle[]> {
  try {
    const raw = await readFile(path, "utf8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const parsed = JSON.parse(line) as Candle;
          return Number.isFinite(parsed.timestamp) &&
            Number.isFinite(parsed.open) &&
            Number.isFinite(parsed.high) &&
            Number.isFinite(parsed.low) &&
            Number.isFinite(parsed.close)
            ? [parsed]
            : [];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

async function readAllFiveMinuteCandles(symbol: string): Promise<Candle[]> {
  const dir = join(WAREHOUSE_ROOT, PROVIDER, symbol, "5m");
  if (!existsSync(dir)) {
    return [];
  }
  const files = (await readdir(dir)).filter((file) => file.endsWith(".jsonl"));
  const candles = [];
  for (const file of files) {
    candles.push(...await readRows(join(dir, file)));
  }
  return candles.sort((left, right) => left.timestamp - right.timestamp);
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

function scoreWindow(params: {
  startPrice: number;
  forwardHigh: number;
  forwardLow: number;
}): { score: number; forwardHighPct: number; forwardLowPct: number; forwardRangePct: number } {
  const startPrice = Math.max(params.startPrice, 0.0001);
  const forwardHighPct = ((params.forwardHigh / startPrice) - 1) * 100;
  const forwardLowPct = (1 - (params.forwardLow / startPrice)) * 100;
  const forwardRangePct = ((params.forwardHigh - params.forwardLow) / Math.max(params.forwardLow, 0.0001)) * 100;
  return {
    forwardHighPct,
    forwardLowPct,
    forwardRangePct,
    score: Math.max(forwardHighPct, forwardLowPct * 0.9, forwardRangePct * 0.72),
  };
}

async function bestCandidateForDay(params: {
  warehouse: DurableCandleWarehouse;
  symbol: string;
  date: string;
  candles: Candle[];
  horizonHours: number;
}): Promise<QueueCandidate | null> {
  const horizonMs = params.horizonHours * 60 * 60 * 1000;
  let best: QueueCandidate | null = null;

  for (let index = 0; index < params.candles.length; index += 3) {
    const start = params.candles[index]!;
    const endTimestamp = start.timestamp + horizonMs;
    const window = params.candles.filter((candle) => candle.timestamp >= start.timestamp && candle.timestamp <= endTimestamp);
    if (window.length < MIN_WINDOW_CANDLES) {
      continue;
    }
    const startPrice = start.close || start.open;
    if (!Number.isFinite(startPrice) || startPrice <= 0) {
      continue;
    }
    const forwardHigh = Math.max(...window.map((candle) => candle.high));
    const forwardLow = Math.min(...window.map((candle) => candle.low));
    const scored = scoreWindow({ startPrice, forwardHigh, forwardLow });
    if (scored.score < MIN_SCORE) {
      continue;
    }

    const dayStart = startOfEasternDay(params.date);
    const [daily, fourHour] = await Promise.all([
      readWarehouseCandles(
        params.warehouse,
        params.symbol,
        "daily",
        dayStart - 420 * timeframeMs("daily"),
        dayStart - 1,
      ),
      readWarehouseCandles(
        params.warehouse,
        params.symbol,
        "4h",
        start.timestamp - 220 * timeframeMs("4h"),
        start.timestamp,
      ),
    ]);
    if (daily.length < MIN_DAILY_CANDLES || fourHour.length < MIN_FOUR_HOUR_CANDLES) {
      continue;
    }

    const candidate: QueueCandidate = {
      symbol: params.symbol,
      date: params.date,
      time: easternTime(start.timestamp),
      note: `warehouse range QA: ${formatPct(scored.forwardHighPct)} high / ${formatPct(scored.forwardLowPct)} low over ${params.horizonHours}h`,
      batch: 0,
      score: scored.score,
      fiveMinuteCount: window.length,
      dailyCount: daily.length,
      fourHourCount: fourHour.length,
      startPrice,
      forwardHigh,
      forwardHighPct: scored.forwardHighPct,
      forwardLow,
      forwardLowPct: scored.forwardLowPct,
      forwardRangePct: scored.forwardRangePct,
      startTimestamp: start.timestamp,
      endTimestamp,
    };

    if (!best || candidate.score > best.score) {
      best = candidate;
    }
  }

  return best;
}

function groupByEasternDay(candles: Candle[]): Map<string, Candle[]> {
  const byDay = new Map<string, Candle[]>();
  for (const candle of candles) {
    const date = easternDate(candle.timestamp);
    byDay.set(date, [...(byDay.get(date) ?? []), candle]);
  }
  for (const [date, items] of byDay) {
    byDay.set(date, items.sort((left, right) => left.timestamp - right.timestamp));
  }
  return byDay;
}

async function buildQueue(): Promise<QueueCandidate[]> {
  const maxCases = numberArg("--max", MAX_CASES);
  const horizonHours = numberArg("--hours", HORIZON_HOURS);
  const warehouse = new DurableCandleWarehouse(WAREHOUSE_ROOT);
  const symbols = (await readdir(join(WAREHOUSE_ROOT, PROVIDER), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name.toUpperCase())
    .sort();
  const candidates: QueueCandidate[] = [];

  for (const symbol of symbols) {
    const candles = await readAllFiveMinuteCandles(symbol);
    const byDay = groupByEasternDay(candles);
    for (const [date, dayCandles] of byDay) {
      if (dayCandles.length < MIN_WINDOW_CANDLES) {
        continue;
      }
      const candidate = await bestCandidateForDay({
        warehouse,
        symbol,
        date,
        candles: dayCandles,
        horizonHours,
      });
      if (candidate) {
        candidates.push(candidate);
      }
    }
  }

  return candidates
    .sort((left, right) => right.score - left.score)
    .slice(0, maxCases)
    .map((candidate, index) => ({
      ...candidate,
      batch: Math.floor(index / BATCH_SIZE) + 1,
    }));
}

function formatMarkdown(queue: QueueCandidate[]): string {
  const lines = [
    "# Support/Resistance Story Test Queue",
    "",
    "Generated: 2026-05-04 America/Toronto",
    "",
    "Purpose: replay stored warehouse candles where the stock had enough movement to stress the support/resistance story map. This queue is for S/R story testing only.",
    "",
    `Batch size: ${BATCH_SIZE}`,
    "",
  ];

  const batches = new Map<number, QueueCandidate[]>();
  for (const item of queue) {
    batches.set(item.batch, [...(batches.get(item.batch) ?? []), item]);
  }

  for (const [batch, items] of batches) {
    lines.push(`## Batch ${batch}`, "");
    lines.push("| Symbol | Date | Start ET | Start | 5h high | 5h low | Score | Candles |");
    lines.push("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |");
    for (const item of items) {
      lines.push(
        `| ${item.symbol} | ${item.date} | ${item.time} | ${formatPrice(item.startPrice)} | ` +
          `${formatPrice(item.forwardHigh)} (${formatPct(item.forwardHighPct)}) | ` +
          `${formatPrice(item.forwardLow)} (-${formatPct(item.forwardLowPct)}) | ` +
          `${formatPct(item.score)} | ${item.fiveMinuteCount} |`,
      );
    }
    lines.push("");
  }

  lines.push("## Replay Cases JSON", "");
  lines.push("Use the artifact JSON with:");
  lines.push("");
  lines.push("```powershell");
  lines.push("npx tsx src/scripts/run-support-resistance-story-replay.ts --cases artifacts/support-resistance-story-test-queue/support-resistance-story-test-cases.json --offset 0 --limit 10 --hours 5 --out artifacts/support-resistance-story-replay-batch-1");
  lines.push("```", "");
  lines.push("## Selection Notes", "");
  lines.push("- Candidates require stored 5m candles plus enough prior daily and 4h candles for level generation.");
  lines.push("- The score favors large upside moves first, then large downside moves, then wide intraday range.");
  lines.push("- Start times are chosen from stored candles to maximize the next five-hour test window.");
  lines.push("- Very extreme historical runners are deliberately included because they reveal whether story posts run out of map.");
  lines.push("");
  lines.push("## Raw Queue", "");
  for (const item of queue) {
    lines.push(
      `- Batch ${item.batch}: ${item.symbol} ${item.date} ${item.time} ET, ` +
        `start ${formatPrice(item.startPrice)}, high ${formatPrice(item.forwardHigh)} (${formatPct(item.forwardHighPct)}), ` +
        `low ${formatPrice(item.forwardLow)} (-${formatPct(item.forwardLowPct)}), score ${formatPct(item.score)}, ` +
        `window ${easternDateTime(item.startTimestamp)} to ${easternDateTime(item.endTimestamp)}`,
    );
  }

  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const queue = await buildQueue();
  const cases: ReplayCase[] = queue.map((item) => ({
    symbol: item.symbol,
    date: item.date,
    time: item.time,
    note: item.note,
  }));

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(join(OUT_DIR, "support-resistance-story-test-queue.json"), `${JSON.stringify(queue, null, 2)}\n`, "utf8");
  await writeFile(join(OUT_DIR, "support-resistance-story-test-cases.json"), `${JSON.stringify(cases, null, 2)}\n`, "utf8");
  await writeFile(DOC_PATH, formatMarkdown(queue), "utf8");
  console.log(`Wrote ${DOC_PATH}`);
  console.log(`Wrote ${join(OUT_DIR, "support-resistance-story-test-queue.json")}`);
  console.log(`Wrote ${join(OUT_DIR, "support-resistance-story-test-cases.json")}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
