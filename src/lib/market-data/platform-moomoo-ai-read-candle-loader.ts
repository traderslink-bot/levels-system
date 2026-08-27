import type { Candle } from "./candle-types.js";

export type MoomooAiReadCandleWindow = Readonly<{
  oneMinuteCandles: readonly Candle[];
  fiveMinuteCandles: readonly Candle[];
}>;

export type MoomooAiReadCandleLoadFailure = "coverage_unavailable" | "bridge_unavailable";

export class MoomooAiReadCandleLoadError extends Error {
  constructor(
    readonly failure: MoomooAiReadCandleLoadFailure,
    message: string,
  ) {
    super(message);
    this.name = "MoomooAiReadCandleLoadError";
  }
}

export type MoomooAiReadCandleLoader = (input: Readonly<{
  symbol: string;
  asOfTimeMs: number;
}>) => Promise<MoomooAiReadCandleWindow>;

type RemoteCandle = Readonly<{
  timestamp?: unknown;
  open?: unknown;
  high?: unknown;
  low?: unknown;
  close?: unknown;
  volume?: unknown;
}>;

type RemoteResponse = Readonly<{
  status?: unknown;
  provider?: unknown;
  code?: unknown;
  candles?: unknown;
}>;

function moomooCandleUrl(ingestUrl: string): URL | null {
  try {
    const url = new URL(ingestUrl);
    if (!url.pathname.endsWith("/ingest")) return null;
    url.pathname = `${url.pathname.slice(0, -"/ingest".length)}/moomoo-candles`;
    url.search = "";
    return url;
  } catch {
    return null;
  }
}

function number(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCandles(value: unknown, asOfTimeMs: number): Candle[] {
  if (!Array.isArray(value)) throw new Error("Moomoo candle response was invalid.");
  const candles = new Map<number, Candle>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Moomoo candle response contained an invalid candle.");
    }
    const source = item as RemoteCandle;
    const timestamp = number(source.timestamp);
    const open = number(source.open);
    const high = number(source.high);
    const low = number(source.low);
    const close = number(source.close);
    const volume = number(source.volume);
    if (
      timestamp === null || !Number.isSafeInteger(timestamp) || timestamp <= 0 || timestamp > asOfTimeMs ||
      open === null || high === null || low === null || close === null || volume === null ||
      open <= 0 || high <= 0 || low <= 0 || close <= 0 || volume < 0 ||
      high < low || high < open || high < close || low > open || low > close
    ) {
      throw new Error("Moomoo candle response contained invalid OHLCV.");
    }
    const candle = Object.freeze({ timestamp, open, high, low, close, volume });
    const previous = candles.get(timestamp);
    if (previous && JSON.stringify(previous) !== JSON.stringify(candle)) {
      throw new Error("Moomoo candle response contained duplicate timestamps.");
    }
    candles.set(timestamp, candle);
  }
  return [...candles.values()].sort((left, right) => left.timestamp - right.timestamp);
}

function aggregateCompletedFiveMinuteCandles(
  candles: readonly Candle[],
  asOfTimeMs: number,
): Candle[] {
  const buckets = new Map<number, Candle[]>();
  for (const candle of candles) {
    const bucketStart = Math.floor(candle.timestamp / (5 * 60 * 1_000)) * 5 * 60 * 1_000;
    const bucket = buckets.get(bucketStart) ?? [];
    bucket.push(candle);
    buckets.set(bucketStart, bucket);
  }
  return [...buckets.entries()]
    .filter(([timestamp]) => timestamp + 5 * 60 * 1_000 <= asOfTimeMs)
    .sort(([left], [right]) => left - right)
    .map(([timestamp, bucket]) => ({
      timestamp,
      open: bucket[0]!.open,
      high: Math.max(...bucket.map((candle) => candle.high)),
      low: Math.min(...bucket.map((candle) => candle.low)),
      close: bucket.at(-1)!.close,
      volume: bucket.reduce((total, candle) => total + candle.volume, 0),
    }));
}

function newYorkDayStart(timeMs: number): number {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      hour12: false,
      minute: "2-digit",
      second: "2-digit",
      timeZone: "America/New_York",
    }).formatToParts(new Date(timeMs)).map((part) => [part.type, part.value]),
  );
  const hour = Number(values.hour);
  const minute = Number(values.minute);
  const second = Number(values.second);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || !Number.isInteger(second)) {
    throw new Error("Unable to resolve the New York candle session date.");
  }
  return timeMs - (hour * 60 * 60 + minute * 60 + second) * 1_000 - (timeMs % 1_000);
}

/**
 * Uses the local Watchlist publisher credential only to request normalized
 * candles. Moomoo OAuth remains encrypted and server-only in Platform.
 */
export function createPlatformMoomooAiReadCandleLoader(
  environment: NodeJS.ProcessEnv = process.env,
): MoomooAiReadCandleLoader | null {
  const endpoint = moomooCandleUrl(environment.TRADERSLINK_WATCHLIST_INGEST_URL?.trim() ?? "");
  const token = environment.TRADERSLINK_WATCHLIST_PUBLISHER_TOKEN?.trim();
  if (!endpoint || !token) return null;

  return async ({ symbol, asOfTimeMs }): Promise<MoomooAiReadCandleWindow> => {
    const endTimeMs = Math.min(asOfTimeMs, Date.now());
    const startTimeMs = newYorkDayStart(endTimeMs);
    const requestUrl = new URL(endpoint);
    requestUrl.search = new URLSearchParams({
      symbol: symbol.trim().toUpperCase(),
      start: String(Math.floor(startTimeMs / 1_000)),
      end: String(Math.floor(endTimeMs / 1_000)),
    }).toString();
    let response: Response;
    try {
      response = await fetch(requestUrl, {
        cache: "no-store",
        headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      });
    } catch {
      throw new MoomooAiReadCandleLoadError(
        "bridge_unavailable",
        "Moomoo Open API candle bridge request failed.",
      );
    }
    let payload: RemoteResponse;
    try {
      payload = await response.json() as RemoteResponse;
    } catch {
      throw new MoomooAiReadCandleLoadError(
        "bridge_unavailable",
        "Moomoo Open API candle bridge response was not JSON.",
      );
    }
    if (
      response.status === 503 &&
      payload.status === "unavailable" &&
      payload.code === "coverage_unavailable"
    ) {
      throw new MoomooAiReadCandleLoadError(
        "coverage_unavailable",
        "No current-session Moomoo candle coverage.",
      );
    }
    if (!response.ok || payload.status !== "ready" || payload.provider !== "moomoo_open_api") {
      throw new MoomooAiReadCandleLoadError(
        "bridge_unavailable",
        "Moomoo Open API candle bridge is unavailable.",
      );
    }
    const oneMinuteCandles = parseCandles(payload.candles, endTimeMs);
    if (oneMinuteCandles.length === 0) {
      throw new Error("Moomoo Open API returned no same-day candles.");
    }
    return Object.freeze({
      oneMinuteCandles: Object.freeze(oneMinuteCandles),
      fiveMinuteCandles: Object.freeze(
        aggregateCompletedFiveMinuteCandles(oneMinuteCandles, endTimeMs),
      ),
    });
  };
}
