import "dotenv/config";

import { EventName, WhatToShow } from "@stoqey/ib";
import { join, resolve } from "node:path";

import type { CandleFetchTimeframe } from "../lib/market-data/candle-types.js";
import { buildHistoricalFetchPlan } from "../lib/market-data/fetch-planning.js";
import {
  buildIbkrSmallCapReadinessReport,
  type IbkrSmallCapReadinessProbe,
  writeIbkrSmallCapReadinessReport,
} from "../lib/review/ibkr-small-cap-readiness-report.js";
import { waitForIbkrConnection } from "./shared/ibkr-connection.js";
import {
  createIbkrClient,
  DEFAULT_IBKR_CLIENT_ID,
  DEFAULT_IBKR_HOST,
  DEFAULT_IBKR_PORT,
} from "./shared/ibkr-runtime.js";

type ReadinessIbClient = {
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

type NormalizedIbkrError = {
  reqId: number | null;
  code: number | null;
  message: string;
};

const HISTORICAL_DATA_END_EVENT = "historicalDataEnd";
const DEFAULT_SYMBOLS = ["BIYA", "AUUD", "SEGG", "ATER", "AIXI", "AKAN"];

function readFlag(name: string): string | undefined {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`))?.split("=")[1];
  if (inline !== undefined) {
    return inline;
  }
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function parseTimeframe(raw: string | undefined): CandleFetchTimeframe {
  return raw === "1m" || raw === "5m" || raw === "4h" || raw === "daily" ? raw : "5m";
}

function parsePositiveInteger(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseSymbols(): string[] {
  const raw = readFlag("--symbols");
  if (!raw) {
    return DEFAULT_SYMBOLS;
  }
  const symbols = raw
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter((symbol) => symbol.length > 0);
  return [...new Set(symbols)];
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

function normalizeErrorArgs(args: unknown[]): NormalizedIbkrError {
  const numbers = args.filter((arg): arg is number => typeof arg === "number");
  const error = args.find((arg) => arg instanceof Error) as Error | undefined;
  const text = args.find((arg) => typeof arg === "string") as string | undefined;
  const firstNumber = numbers[0];
  const secondNumber = numbers[1];
  return {
    reqId: Number.isInteger(firstNumber) && firstNumber >= 0 ? firstNumber : null,
    code: Number.isInteger(secondNumber)
      ? secondNumber
      : Number.isInteger(firstNumber) && firstNumber >= 100
        ? firstNumber
        : null,
    message: error?.message ?? text ?? args.map((arg) => String(arg)).join(" | "),
  };
}

async function fetchHistoricalProbe(params: {
  ib: ReadinessIbClient;
  symbol: string;
  timeframe: CandleFetchTimeframe;
  lookbackBars: number;
  timeoutMs: number;
  endTimeMs: number;
  reqId: number;
  exchange: string;
  currency: string;
  primaryExchange?: string;
  useRth: boolean;
}): Promise<IbkrSmallCapReadinessProbe> {
  const startedAt = Date.now();
  const plan = buildHistoricalFetchPlan(
    {
      symbol: params.symbol,
      timeframe: params.timeframe,
      lookbackBars: params.lookbackBars,
      endTimeMs: params.endTimeMs,
    },
    "ibkr",
  );
  const contract = {
    symbol: params.symbol,
    secType: "STK",
    exchange: params.exchange,
    currency: params.currency,
    ...(params.primaryExchange ? { primaryExchange: params.primaryExchange } : {}),
  };
  const bars: unknown[] = [];

  return await new Promise<IbkrSmallCapReadinessProbe>((resolve) => {
    let settled = false;

    const cleanup = (): void => {
      clearTimeout(timeoutHandle);
      params.ib.off(EventName.historicalData, onHistoricalData);
      params.ib.off(HISTORICAL_DATA_END_EVENT, onHistoricalDataEnd);
      params.ib.off(EventName.error, onError);
    };

    const finish = (
      status: IbkrSmallCapReadinessProbe["status"],
      details: unknown,
    ): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      if (status !== "completed") {
        try {
          params.ib.cancelHistoricalData(params.reqId);
        } catch {
          // Diagnostic cleanup should not hide the readiness result.
        }
      }
      resolve({
        symbol: params.symbol,
        timeframe: params.timeframe,
        status,
        barsReceived: bars.length,
        firstBar: bars[0] ?? null,
        lastBar: bars.at(-1) ?? null,
        durationMs: Date.now() - startedAt,
        details,
      });
    };

    const onHistoricalData = (...args: unknown[]): void => {
      if (args[0] !== params.reqId) {
        return;
      }
      if (typeof args[1] === "string" && args[1].startsWith("finished")) {
        finish("completed", { event: "historicalData finished marker" });
        return;
      }
      bars.push(args.slice(1));
    };

    const onHistoricalDataEnd = (...args: unknown[]): void => {
      if (args[0] !== params.reqId) {
        return;
      }
      finish("completed", { event: HISTORICAL_DATA_END_EVENT, args });
    };

    const onError = (...args: unknown[]): void => {
      const normalized = normalizeErrorArgs(args);
      if (normalized.reqId === params.reqId || args.includes(params.reqId)) {
        finish("error", normalized);
      }
    };

    const timeoutHandle = setTimeout(() => {
      finish("timeout", { timeoutMs: params.timeoutMs });
    }, params.timeoutMs);

    params.ib.on(EventName.historicalData, onHistoricalData);
    params.ib.on(HISTORICAL_DATA_END_EVENT, onHistoricalDataEnd);
    params.ib.on(EventName.error, onError);
    params.ib.reqHistoricalData(
      params.reqId,
      contract,
      formatIbkrEndDate(plan.requestEndTimestamp),
      plan.providerRequest.durationStr ?? "1 D",
      plan.providerRequest.barSizeSetting,
      WhatToShow.TRADES,
      params.useRth,
      2,
      false,
    );
  });
}

const symbols = parseSymbols();
const timeframe = parseTimeframe(readFlag("--timeframe"));
const lookbackBars = parsePositiveInteger(readFlag("--lookback-bars"), 50);
const minimumReadyBars = parsePositiveInteger(readFlag("--minimum-ready-bars"), lookbackBars);
const timeoutMs = parsePositiveInteger(readFlag("--timeout-ms"), 60_000);
const connectTimeoutMs = parsePositiveInteger(readFlag("--connect-timeout-ms"), 15_000);
const clientId = parsePositiveInteger(
  readFlag("--client-id"),
  parsePositiveInteger(process.env.LEVEL_VALIDATION_IBKR_CLIENT_ID, DEFAULT_IBKR_CLIENT_ID),
);
const host = readFlag("--host") ?? process.env.LEVEL_VALIDATION_IBKR_HOST ?? DEFAULT_IBKR_HOST;
const port = parsePositiveInteger(
  readFlag("--port"),
  parsePositiveInteger(process.env.LEVEL_VALIDATION_IBKR_PORT, DEFAULT_IBKR_PORT),
);
const exchange = readFlag("--exchange") ?? "SMART";
const currency = readFlag("--currency") ?? "USD";
const primaryExchange = readFlag("--primary-exchange");
const endTimeMs = parseTimestamp(readFlag("--end")) ?? Date.now();
const useRth = hasFlag("--rth");
const outDir = resolve(readFlag("--output") ?? "artifacts/ibkr-small-cap-readiness");

console.log(
  `IBKR small-cap readiness: symbols=${symbols.join(",")}, timeframe=${timeframe}, lookback=${lookbackBars}, timeout=${timeoutMs}ms.`,
);

const ib = createIbkrClient(clientId, host, port) as unknown as ReadinessIbClient;
const probes: IbkrSmallCapReadinessProbe[] = [];

try {
  await waitForIbkrConnection(ib as any, connectTimeoutMs);
  for (const [index, symbol] of symbols.entries()) {
    const reqId = 80_000 + index;
    const probe = await fetchHistoricalProbe({
      ib,
      symbol,
      timeframe,
      lookbackBars,
      timeoutMs,
      endTimeMs,
      reqId,
      exchange,
      currency,
      primaryExchange,
      useRth,
    });
    probes.push(probe);
    console.log(`${symbol}: ${probe.status}, bars=${probe.barsReceived}, duration=${probe.durationMs}ms`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  for (const symbol of symbols) {
    probes.push({
      symbol,
      timeframe,
      status: "error",
      barsReceived: 0,
      firstBar: null,
      lastBar: null,
      durationMs: 0,
      details: message,
    });
  }
} finally {
  ib.disconnect();
}

const report = buildIbkrSmallCapReadinessReport({
  probes,
  timeframe,
  requestedLookbackBars: lookbackBars,
  minimumReadyBars,
  timeoutMs,
});
writeIbkrSmallCapReadinessReport({
  report,
  jsonPath: join(outDir, "ibkr-small-cap-readiness.json"),
  markdownPath: join(outDir, "ibkr-small-cap-readiness.md"),
});

console.log(
  `Readiness report: ready=${report.totals.ready}, thin=${report.totals.thinHistory}, unavailable=${report.totals.providerUnavailable}.`,
);
console.log(`JSON: ${join(outDir, "ibkr-small-cap-readiness.json")}`);
console.log(`Markdown: ${join(outDir, "ibkr-small-cap-readiness.md")}`);

