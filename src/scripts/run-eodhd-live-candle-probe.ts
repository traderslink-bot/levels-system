import "dotenv/config";

import type { Candle } from "../lib/market-data/candle-types.js";

type ProbeTick = {
  symbol: string;
  price: number;
  timestamp: number;
  volume: number | null;
  darkPool: boolean;
  raw: unknown;
};

type RestCandle = {
  timestamp?: unknown;
  datetime?: unknown;
  open?: unknown;
  high?: unknown;
  low?: unknown;
  close?: unknown;
  volume?: unknown;
};

const DEFAULT_ENDPOINT_URL = "wss://ws.eodhistoricaldata.com/ws/us";
const DEFAULT_REST_BASE_URL = "https://eodhd.com/api";
const DEFAULT_DURATION_MS = 90_000;
const DEFAULT_SYMBOLS = ["FTRK", "QTTB"];

function parseArgs(): { symbols: string[]; durationMs: number } {
  const args = process.argv.slice(2);
  const symbolsArg = args.find((arg) => arg.startsWith("--symbols="))?.slice("--symbols=".length);
  const durationArg = args.find((arg) => arg.startsWith("--duration-ms="))?.slice("--duration-ms=".length);
  const positionalSymbols = args.filter((arg) => !arg.startsWith("--"));
  const symbols = (symbolsArg ? symbolsArg.split(",") : positionalSymbols.length ? positionalSymbols : DEFAULT_SYMBOLS)
    .map((symbol) => symbol.trim().toUpperCase().replace(/\.US$/, ""))
    .filter(Boolean);
  const durationMs = Number.parseInt(durationArg ?? "", 10);

  return {
    symbols: [...new Set(symbols)],
    durationMs: Number.isInteger(durationMs) && durationMs > 0 ? durationMs : DEFAULT_DURATION_MS,
  };
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseTick(message: unknown): ProbeTick | null {
  if (!message || typeof message !== "object") {
    return null;
  }
  const record = message as Record<string, unknown>;
  const symbol = typeof record.s === "string" ? record.s.trim().toUpperCase().replace(/\.US$/, "") : "";
  const price = finiteNumber(record.p);
  const timestamp = finiteNumber(record.t);
  if (!symbol || price === null || price <= 0) {
    return null;
  }

  return {
    symbol,
    price,
    timestamp: timestamp !== null && timestamp > 0 ? timestamp : Date.now(),
    volume: finiteNumber(record.v),
    darkPool: record.dp === true,
    raw: message,
  };
}

function bucketTimestamp(timestamp: number, bucketMs: number): number {
  return Math.floor(timestamp / bucketMs) * bucketMs;
}

function deriveCandlesFromTicks(ticks: ProbeTick[], bucketMs: number): Candle[] {
  const candles = new Map<number, Candle>();
  const sorted = [...ticks].sort((left, right) => left.timestamp - right.timestamp);
  let previousVolume: number | null = null;

  for (const tick of sorted) {
    const timestamp = bucketTimestamp(tick.timestamp, bucketMs);
    const volume =
      tick.volume !== null && tick.volume >= 0 && previousVolume !== null && tick.volume >= previousVolume
        ? Math.round(tick.volume - previousVolume)
        : 0;
    if (tick.volume !== null && tick.volume >= 0) {
      previousVolume = tick.volume;
    }

    const existing = candles.get(timestamp);
    if (!existing) {
      candles.set(timestamp, {
        timestamp,
        open: tick.price,
        high: tick.price,
        low: tick.price,
        close: tick.price,
        volume,
      });
      continue;
    }

    existing.high = Math.max(existing.high, tick.price);
    existing.low = Math.min(existing.low, tick.price);
    existing.close = tick.price;
    existing.volume += volume;
  }

  return [...candles.values()].sort((left, right) => left.timestamp - right.timestamp);
}

function parseRestCandle(bar: RestCandle): Candle | null {
  const timestampSeconds = finiteNumber(bar.timestamp);
  const timestamp =
    timestampSeconds !== null
      ? timestampSeconds * 1000
      : typeof bar.datetime === "string"
        ? Date.parse(`${bar.datetime.trim().replace(" ", "T")}Z`)
        : Number.NaN;
  const open = finiteNumber(bar.open);
  const high = finiteNumber(bar.high);
  const low = finiteNumber(bar.low);
  const close = finiteNumber(bar.close);
  const volume = finiteNumber(bar.volume) ?? 0;

  if (
    !Number.isFinite(timestamp) ||
    open === null ||
    high === null ||
    low === null ||
    close === null ||
    open <= 0 ||
    high <= 0 ||
    low <= 0 ||
    close <= 0 ||
    high < low ||
    high < open ||
    high < close ||
    low > open ||
    low > close
  ) {
    return null;
  }

  return {
    timestamp,
    open,
    high,
    low,
    close,
    volume: Math.max(0, Math.round(volume)),
  };
}

function aggregateOneMinuteToFiveMinute(candles: Candle[]): Candle[] {
  const buckets = new Map<number, Candle>();
  for (const candle of [...candles].sort((left, right) => left.timestamp - right.timestamp)) {
    const timestamp = bucketTimestamp(candle.timestamp, 5 * 60_000);
    const existing = buckets.get(timestamp);
    if (!existing) {
      buckets.set(timestamp, { ...candle, timestamp });
      continue;
    }
    existing.high = Math.max(existing.high, candle.high);
    existing.low = Math.min(existing.low, candle.low);
    existing.close = candle.close;
    existing.volume += candle.volume;
  }
  return [...buckets.values()].sort((left, right) => left.timestamp - right.timestamp);
}

async function fetchRestCandles(
  symbol: string,
  interval: "1m" | "5m",
  token: string,
  now: number,
): Promise<Candle[]> {
  const baseUrl = process.env.EODHD_BASE_URL?.trim() || process.env.LEVEL_EODHD_BASE_URL?.trim() || DEFAULT_REST_BASE_URL;
  const eodhdSymbol = symbol.includes(".") ? symbol : `${symbol}.US`;
  const url = new URL(`${baseUrl.replace(/\/$/, "")}/intraday/${encodeURIComponent(eodhdSymbol)}`);
  url.searchParams.set("api_token", token);
  url.searchParams.set("fmt", "json");
  url.searchParams.set("interval", interval);
  url.searchParams.set("from", String(Math.floor((now - 3 * 60 * 60_000) / 1000)));
  url.searchParams.set("to", String(Math.floor(now / 1000)));

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const payload = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error(`non-array payload: ${JSON.stringify(payload).slice(0, 200)}`);
  }
  return payload.map(parseRestCandle).filter((candle): candle is Candle => Boolean(candle));
}

function iso(timestamp: number | null | undefined): string {
  return typeof timestamp === "number" && Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString()
    : "n/a";
}

function candleSummary(candles: Candle[], now: number): string {
  const latest = candles.at(-1);
  if (!latest) {
    return "bars=0";
  }
  const ageSec = Math.round((now - latest.timestamp) / 1000);
  return [
    `bars=${candles.length}`,
    `latest=${iso(latest.timestamp)}`,
    `ageSec=${ageSec}`,
    `ohlc=${latest.open}/${latest.high}/${latest.low}/${latest.close}`,
    `vol=${latest.volume}`,
  ].join(" | ");
}

async function captureWebsocketTicks(symbols: string[], durationMs: number, token: string): Promise<{
  ticks: ProbeTick[];
  rawCount: number;
  open: boolean;
  closeInfo: string | null;
  errorInfo: string | null;
}> {
  const endpoint = process.env.EODHD_WEBSOCKET_URL?.trim() || process.env.LEVEL_EODHD_WEBSOCKET_URL?.trim() || DEFAULT_ENDPOINT_URL;
  const url = new URL(endpoint);
  url.searchParams.set("api_token", token);
  const WebSocketCtor = globalThis.WebSocket;
  if (!WebSocketCtor) {
    throw new Error("Global WebSocket is unavailable.");
  }

  const ticks: ProbeTick[] = [];
  let rawCount = 0;
  let open = false;
  let closeInfo: string | null = null;
  let errorInfo: string | null = null;
  const socket = new WebSocketCtor(url.toString());

  socket.addEventListener("open", () => {
    open = true;
    socket.send(JSON.stringify({ action: "subscribe", symbols: symbols.join(",") }));
  });
  socket.addEventListener("message", (event) => {
    rawCount += 1;
    let payload: unknown;
    try {
      payload = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
    } catch {
      return;
    }
    const messages = Array.isArray(payload) ? payload : [payload];
    for (const message of messages) {
      const tick = parseTick(message);
      if (tick && symbols.includes(tick.symbol) && !tick.darkPool) {
        ticks.push(tick);
      }
    }
  });
  socket.addEventListener("error", (event) => {
    errorInfo = String((event as ErrorEvent).message || "websocket error");
  });
  socket.addEventListener("close", (event) => {
    closeInfo = `code=${event.code} reason=${event.reason || "n/a"}`;
  });

  await new Promise((resolve) => setTimeout(resolve, durationMs));
  socket.close();

  return { ticks, rawCount, open, closeInfo, errorInfo };
}

async function main(): Promise<void> {
  const { symbols, durationMs } = parseArgs();
  const token = process.env.EODHD_API_TOKEN?.trim() || process.env.LEVEL_EODHD_API_TOKEN?.trim() || requiredEnv("EODHD_API_TOKEN");
  const startedAt = Date.now();

  console.log(`[probe] symbols=${symbols.join(",")} durationMs=${durationMs}`);
  const restBefore = new Map<string, { oneMinute: Candle[]; fiveMinute: Candle[] }>();
  for (const symbol of symbols) {
    const [oneMinute, fiveMinute] = await Promise.all([
      fetchRestCandles(symbol, "1m", token, startedAt).catch((error) => {
        console.log(`[rest-before] ${symbol} 1m error=${error instanceof Error ? error.message : String(error)}`);
        return [] as Candle[];
      }),
      fetchRestCandles(symbol, "5m", token, startedAt).catch((error) => {
        console.log(`[rest-before] ${symbol} 5m error=${error instanceof Error ? error.message : String(error)}`);
        return [] as Candle[];
      }),
    ]);
    restBefore.set(symbol, { oneMinute, fiveMinute });
    console.log(`[rest-before] ${symbol} 1m ${candleSummary(oneMinute, startedAt)}`);
    console.log(`[rest-before] ${symbol} 5m ${candleSummary(fiveMinute, startedAt)}`);
    console.log(`[rest-before] ${symbol} 1m->5m ${candleSummary(aggregateOneMinuteToFiveMinute(oneMinute), startedAt)}`);
  }

  const websocket = await captureWebsocketTicks(symbols, durationMs, token);
  const finishedAt = Date.now();
  console.log(`[ws] open=${websocket.open} rawMessages=${websocket.rawCount} parsedTicks=${websocket.ticks.length} error=${websocket.errorInfo ?? "none"} close=${websocket.closeInfo ?? "none"}`);

  for (const symbol of symbols) {
    const ticks = websocket.ticks.filter((tick) => tick.symbol === symbol);
    const first = ticks[0];
    const latest = ticks.at(-1);
    const volumes = ticks.map((tick) => tick.volume).filter((volume): volume is number => typeof volume === "number" && Number.isFinite(volume));
    const volumeDrops = volumes.filter((volume, index) => index > 0 && volume < volumes[index - 1]!).length;
    console.log(`[ws] ${symbol} ticks=${ticks.length} first=${iso(first?.timestamp)} latest=${iso(latest?.timestamp)} latestPrice=${latest?.price ?? "n/a"} volumeFields=${volumes.length} volumeDrops=${volumeDrops}`);
    console.log(`[ws-derived] ${symbol} 1m ${candleSummary(deriveCandlesFromTicks(ticks, 60_000), finishedAt)}`);
    console.log(`[ws-derived] ${symbol} 5m ${candleSummary(deriveCandlesFromTicks(ticks, 5 * 60_000), finishedAt)}`);
  }

  for (const symbol of symbols) {
    const [oneMinute, fiveMinute] = await Promise.all([
      fetchRestCandles(symbol, "1m", token, finishedAt).catch((error) => {
        console.log(`[rest-after] ${symbol} 1m error=${error instanceof Error ? error.message : String(error)}`);
        return [] as Candle[];
      }),
      fetchRestCandles(symbol, "5m", token, finishedAt).catch((error) => {
        console.log(`[rest-after] ${symbol} 5m error=${error instanceof Error ? error.message : String(error)}`);
        return [] as Candle[];
      }),
    ]);
    console.log(`[rest-after] ${symbol} 1m ${candleSummary(oneMinute, finishedAt)}`);
    console.log(`[rest-after] ${symbol} 5m ${candleSummary(fiveMinute, finishedAt)}`);
    console.log(`[rest-after] ${symbol} 1m->5m ${candleSummary(aggregateOneMinuteToFiveMinute(oneMinute), finishedAt)}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
