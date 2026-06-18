import "dotenv/config";

import { EventName, WhatToShow } from "@stoqey/ib";

import type { CandleFetchTimeframe } from "../lib/market-data/candle-types.js";
import { buildHistoricalFetchPlan } from "../lib/market-data/fetch-planning.js";
import { waitForIbkrConnection } from "./shared/ibkr-connection.js";
import {
  createIbkrClient,
  DEFAULT_IBKR_HOST,
  DEFAULT_IBKR_PORT,
  DEFAULT_IBKR_CLIENT_ID,
} from "./shared/ibkr-runtime.js";

type DiagnosticIbClient = {
  on: (event: EventName | string, listener: (...args: any[]) => void) => void;
  off: (event: EventName | string, listener: (...args: any[]) => void) => void;
  reqHistoricalData: (
    reqId: number,
    contract: Record<string, unknown>,
    endDateTime: string,
    durationStr: string,
    barSizeSetting: string,
    whatToShow: string,
    useRTH: number | boolean,
    formatDate: number,
    keepUpToDate: boolean,
  ) => void;
  cancelHistoricalData: (reqId: number) => void;
  disconnect: () => void;
};

const HISTORICAL_DATA_END_EVENT = "historicalDataEnd";

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function parseTimeframe(raw: string | undefined): CandleFetchTimeframe {
  return raw === "1m" || raw === "5m" || raw === "4h" || raw === "daily" ? raw : "5m";
}

function parsePositiveInteger(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseTimestamp(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }
  const numeric = Number(raw);
  const parsed = Number.isFinite(numeric) ? numeric : Date.parse(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid --end timestamp: ${raw}`);
  }
  return parsed;
}

function formatIbkrEndDate(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  const hour = `${date.getUTCHours()}`.padStart(2, "0");
  const minute = `${date.getUTCMinutes()}`.padStart(2, "0");
  const second = `${date.getUTCSeconds()}`.padStart(2, "0");
  return `${year}${month}${day} ${hour}:${minute}:${second} UTC`;
}

function normalizeErrorArgs(args: unknown[]): {
  reqId: number | null;
  code: number | null;
  message: string;
} {
  const firstNumber = args.find((arg) => typeof arg === "number") as number | undefined;
  const secondNumber = args.filter((arg) => typeof arg === "number")[1] as number | undefined;
  const error = args.find((arg) => arg instanceof Error) as Error | undefined;
  const text = args.find((arg) => typeof arg === "string") as string | undefined;
  return {
    reqId: Number.isInteger(firstNumber) && firstNumber! >= 0 ? firstNumber! : null,
    code: Number.isInteger(secondNumber) ? secondNumber! : Number.isInteger(firstNumber) && firstNumber! >= 100 ? firstNumber! : null,
    message: error?.message ?? text ?? args.map((arg) => String(arg)).join(" | "),
  };
}

const symbol = (argValue("--symbol") ?? process.argv[2] ?? "AIOS").trim().toUpperCase();
const timeframe = parseTimeframe(argValue("--timeframe"));
const lookbackBars = parsePositiveInteger(argValue("--lookback-bars"), 181);
const timeoutMs = parsePositiveInteger(argValue("--timeout-ms"), 120_000);
const connectTimeoutMs = parsePositiveInteger(argValue("--connect-timeout-ms"), 15_000);
const clientId = parsePositiveInteger(argValue("--client-id"), parsePositiveInteger(process.env.LEVEL_VALIDATION_IBKR_CLIENT_ID, DEFAULT_IBKR_CLIENT_ID));
const host = argValue("--host") ?? process.env.LEVEL_VALIDATION_IBKR_HOST ?? DEFAULT_IBKR_HOST;
const port = parsePositiveInteger(argValue("--port"), parsePositiveInteger(process.env.LEVEL_VALIDATION_IBKR_PORT, DEFAULT_IBKR_PORT));
const endTimeMs = parseTimestamp(argValue("--end")) ?? Date.now();
const useRth = hasFlag("--rth");
const reqId = parsePositiveInteger(argValue("--req-id"), 70_000 + Math.floor(Math.random() * 10_000));
const plan = buildHistoricalFetchPlan({ symbol, timeframe, lookbackBars, endTimeMs }, "ibkr");
const endDateTime = formatIbkrEndDate(plan.requestEndTimestamp);
const contract = {
  symbol,
  secType: "STK",
  exchange: argValue("--exchange") ?? "SMART",
  currency: argValue("--currency") ?? "USD",
  ...(argValue("--primary-exchange") ? { primaryExchange: argValue("--primary-exchange") } : {}),
};

console.log("IBKR historical diagnostic");
console.log(JSON.stringify({
  symbol,
  timeframe,
  lookbackBars,
  timeoutMs,
  clientId,
  host,
  port,
  reqId,
  endTimeMs,
  endIso: new Date(endTimeMs).toISOString(),
  endDateTime,
  durationStr: plan.providerRequest.durationStr,
  barSizeSetting: plan.providerRequest.barSizeSetting,
  useRth,
  contract,
}, null, 2));

const ib = createIbkrClient(clientId, host, port) as unknown as DiagnosticIbClient;
const bars: unknown[] = [];
let settled = false;

const cleanup = (): void => {
  clearTimeout(timeoutHandle);
  ib.off(EventName.historicalData, onHistoricalData);
  ib.off(HISTORICAL_DATA_END_EVENT, onHistoricalDataEnd);
  ib.off(EventName.error, onError);
};

const finish = (status: "completed" | "timeout" | "error", details?: unknown): void => {
  if (settled) {
    return;
  }
  settled = true;
  cleanup();
  if (status !== "completed") {
    try {
      ib.cancelHistoricalData(reqId);
    } catch {
      // Ignore diagnostic cleanup failures.
    }
  }
  console.log(JSON.stringify({
    status,
    barsReceived: bars.length,
    firstBar: bars[0] ?? null,
    lastBar: bars.at(-1) ?? null,
    details: details ?? null,
  }, null, 2));
  ib.disconnect();
};

const onHistoricalData = (...args: unknown[]): void => {
  if (args[0] !== reqId) {
    return;
  }
  if (typeof args[1] === "string" && args[1].startsWith("finished")) {
    finish("completed", { event: "historicalData finished marker" });
    return;
  }
  bars.push(args.slice(1));
  if (bars.length <= 3 || bars.length % 50 === 0) {
    console.log(`bar ${bars.length}: ${JSON.stringify(args.slice(1))}`);
  }
};

const onHistoricalDataEnd = (...args: unknown[]): void => {
  if (args[0] !== reqId) {
    return;
  }
  finish("completed", { event: HISTORICAL_DATA_END_EVENT, args });
};

const onError = (...args: unknown[]): void => {
  const normalized = normalizeErrorArgs(args);
  console.log(`IBKR error event: ${JSON.stringify(normalized)} raw=${JSON.stringify(args.map((arg) => arg instanceof Error ? arg.message : arg))}`);
  if (normalized.reqId === reqId || args.includes(reqId)) {
    finish("error", normalized);
  }
};

const timeoutHandle = setTimeout(() => {
  finish("timeout", { timeoutMs });
}, timeoutMs);

try {
  await waitForIbkrConnection(ib as any, connectTimeoutMs);
  ib.on(EventName.historicalData, onHistoricalData);
  ib.on(HISTORICAL_DATA_END_EVENT, onHistoricalDataEnd);
  ib.on(EventName.error, onError);
  ib.reqHistoricalData(
    reqId,
    contract,
    endDateTime,
    plan.providerRequest.durationStr ?? "3 D",
    plan.providerRequest.barSizeSetting,
    WhatToShow.TRADES,
    useRth,
    2,
    false,
  );
} catch (error) {
  finish("error", error instanceof Error ? error.message : String(error));
}
