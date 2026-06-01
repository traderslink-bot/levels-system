import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Candle, CandleProviderName } from "../lib/market-data/candle-types.js";
import { buildProviderHistoricalFetchPlan } from "../lib/market-data/fetch-planning.js";
import { IbkrHistoricalCandleProvider } from "../lib/market-data/ibkr-historical-candle-provider.js";
import type {
  BaseProviderCandleResponse,
  ProviderHistoricalFetchPlan,
  ProviderHistoricalFetchRequest,
} from "../lib/market-data/provider-types.js";
import { TwelveDataHistoricalCandleProvider } from "../lib/market-data/providers/twelve-data-historical-candle-provider.js";
import { waitForIbkrConnection } from "./shared/ibkr-connection.js";
import { createIbkrClient } from "./shared/ibkr-runtime.js";

type FifteenMinuteTimeframe = "15m";
type FifteenMinuteValidationCacheRuntimeEnv = Record<string, string | undefined>;
type FifteenMinuteProviderFetcher = {
  readonly providerName: CandleProviderName;
  fetchCandles(
    request: ProviderHistoricalFetchRequest,
    plan: ProviderHistoricalFetchPlan,
  ): Promise<BaseProviderCandleResponse>;
};
type FifteenMinuteValidationCacheFetcherCleanup = () => Promise<void> | void;
type FifteenMinuteValidationCacheFetcherBundle = {
  fetcher: FifteenMinuteValidationCacheFetcher;
  cleanup?: FifteenMinuteValidationCacheFetcherCleanup;
};

export type FifteenMinuteValidationCacheFetchRequest = {
  symbol: string;
  timeframe: FifteenMinuteTimeframe;
  lookbackBars: number;
  endTimeMs: number;
  provider: CandleProviderName;
};

export type FifteenMinuteValidationCacheProviderResponse = {
  provider: CandleProviderName;
  symbol: string;
  timeframe: FifteenMinuteTimeframe;
  requestedLookbackBars: number;
  candles: Candle[];
  fetchStartTimestamp: number;
  fetchEndTimestamp: number;
  requestedStartTimestamp: number;
  requestedEndTimestamp: number;
  sessionMetadataAvailable: boolean;
  providerMetadata?: Record<string, string | number | boolean | null>;
  actualBarsReturned: number;
  completenessStatus: "complete" | "partial" | "empty";
  stale: boolean;
  validationIssues: unknown[];
  sessionSummary: null;
};

export type FifteenMinuteValidationCacheEntry = {
  schemaVersion: 1;
  cachedAt: number;
  request: {
    symbol: string;
    timeframe: FifteenMinuteTimeframe;
    lookbackBars: number;
    endTimeMs: number;
    provider: CandleProviderName;
  };
  response: FifteenMinuteValidationCacheProviderResponse;
};

export type FifteenMinuteValidationCacheFetcher = (
  request: FifteenMinuteValidationCacheFetchRequest,
) => Promise<FifteenMinuteValidationCacheProviderResponse>;

export type CollectFifteenMinuteValidationCacheMode = "dry_run" | "write";

export type CollectFifteenMinuteValidationCacheOptions = {
  cacheRoot: string;
  symbols: string[];
  provider: CandleProviderName;
  lookbackBars: number;
  endTimeMs: number;
  mode?: CollectFifteenMinuteValidationCacheMode;
  overwrite?: boolean;
  generatedAt?: string;
  fetcher?: FifteenMinuteValidationCacheFetcher;
  fetcherCleanup?: FifteenMinuteValidationCacheFetcherCleanup;
  runtimeEnv?: FifteenMinuteValidationCacheRuntimeEnv;
};

export type CollectFifteenMinuteValidationCacheCliOptions =
  Omit<
    CollectFifteenMinuteValidationCacheOptions,
    "fetcher" | "mode" | "runtimeEnv" | "symbols"
  > & {
    symbols: string[];
    dryRun: boolean;
    write: boolean;
    mode: CollectFifteenMinuteValidationCacheMode;
  };

export type CollectFifteenMinuteValidationCacheItemStatus =
  | "planned"
  | "written"
  | "skipped_existing"
  | "failed";

export type CollectFifteenMinuteValidationCacheItem = {
  symbol: string;
  provider: CandleProviderName;
  timeframe: FifteenMinuteTimeframe;
  lookbackBars: number;
  endTimeMs: number;
  outputPath: string;
  status: CollectFifteenMinuteValidationCacheItemStatus;
  dryRun: boolean;
  candleCount?: number;
  error?: string;
};

export type CollectFifteenMinuteValidationCacheSummary = {
  generatedAt: string;
  cacheRoot: string;
  provider: CandleProviderName;
  timeframe: FifteenMinuteTimeframe;
  lookbackBars: number;
  endTimeMs: number;
  dryRun: boolean;
  write: boolean;
  overwrite: boolean;
  totalSymbols: number;
  plannedCount: number;
  writtenCount: number;
  skippedExistingCount: number;
  failedCount: number;
};

export type CollectFifteenMinuteValidationCacheResult = {
  summary: CollectFifteenMinuteValidationCacheSummary;
  items: CollectFifteenMinuteValidationCacheItem[];
};

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const SYMBOL_PATTERN = /^[A-Z][A-Z0-9.-]{0,15}$/;
const ENABLE_IBKR_LIVE_15M_ENV = "LEVEL_15M_CACHE_ENABLE_IBKR";
const IBKR_HOST_ENV = "LEVEL_15M_CACHE_IBKR_HOST";
const IBKR_PORT_ENV = "LEVEL_15M_CACHE_IBKR_PORT";
const IBKR_CLIENT_ID_ENV = "LEVEL_15M_CACHE_IBKR_CLIENT_ID";
const IBKR_CONNECTION_TIMEOUT_ENV = "LEVEL_15M_CACHE_IBKR_CONNECTION_TIMEOUT_MS";
const IBKR_HISTORICAL_TIMEOUT_ENV = "LEVEL_VALIDATION_IBKR_TIMEOUT_MS";
const TWELVE_DATA_API_KEY_ENV = "TWELVE_DATA_API_KEY";

function normalizeEndTimeMs(rawEndTimeMs: number): number {
  return Math.floor(rawEndTimeMs / FIFTEEN_MINUTES_MS) * FIFTEEN_MINUTES_MS;
}

function parseEndTime(value: string): number {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return normalizeEndTimeMs(numeric);
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid --end-time value "${value}". Expected epoch milliseconds or ISO timestamp.`);
  }

  return normalizeEndTimeMs(parsed);
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer.`);
  }

  return parsed;
}

function parseProvider(value: string): CandleProviderName {
  if (value === "ibkr" || value === "stub" || value === "twelve_data") {
    return value;
  }

  throw new Error(`Unsupported --provider value "${value}".`);
}

function resolveOptionalPositiveInteger(
  value: string | undefined,
  label: string,
): number | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer when supplied.`);
  }

  return parsed;
}

function isTruthy(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export function parseFifteenMinuteCacheSymbols(value: string): string[] {
  const symbols = value
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);

  if (symbols.length === 0) {
    throw new Error("--symbols must include at least one symbol.");
  }

  for (const symbol of symbols) {
    if (!SYMBOL_PATTERN.test(symbol)) {
      throw new Error(`Invalid symbol "${symbol}". Symbols must be explicit ticker-like values.`);
    }
  }

  return [...new Set(symbols)];
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}.`);
  }

  return value;
}

export function parseCollectFifteenMinuteValidationCacheArgs(
  args: string[],
): CollectFifteenMinuteValidationCacheCliOptions {
  let cacheRoot: string | undefined;
  let symbols: string[] | undefined;
  let provider: CandleProviderName | undefined;
  let lookbackBars: number | undefined;
  let endTimeMs: number | undefined;
  let dryRun = false;
  let write = false;
  let overwrite = false;
  let generatedAt: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--cache-root") {
      cacheRoot = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--symbols") {
      symbols = parseFifteenMinuteCacheSymbols(requireValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--provider") {
      provider = parseProvider(requireValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--lookback-bars") {
      lookbackBars = parsePositiveInteger(requireValue(args, index, arg), arg);
      index += 1;
      continue;
    }
    if (arg === "--end-time") {
      endTimeMs = parseEndTime(requireValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--generated-at") {
      const value = requireValue(args, index, arg);
      if (Number.isNaN(Date.parse(value))) {
        throw new Error(`Invalid --generated-at value "${value}". Expected ISO timestamp.`);
      }
      generatedAt = new Date(value).toISOString();
      index += 1;
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--write") {
      write = true;
      continue;
    }
    if (arg === "--overwrite") {
      overwrite = true;
      continue;
    }

    throw new Error(`Unknown argument "${arg}".`);
  }

  if (!cacheRoot) {
    throw new Error("Missing required --cache-root <path>.");
  }
  if (!symbols) {
    throw new Error("Missing required --symbols <comma-separated>.");
  }
  if (!provider) {
    throw new Error("Missing required --provider <provider>.");
  }
  if (lookbackBars === undefined) {
    throw new Error("Missing required --lookback-bars <number>.");
  }
  if (endTimeMs === undefined) {
    throw new Error("Missing required --end-time <timestamp|ISO>.");
  }
  if (dryRun && write) {
    throw new Error("Use either --dry-run or --write, not both.");
  }

  const mode: CollectFifteenMinuteValidationCacheMode = write ? "write" : "dry_run";

  return {
    cacheRoot,
    symbols,
    provider,
    lookbackBars,
    endTimeMs,
    dryRun: mode === "dry_run",
    write: mode === "write",
    mode,
    overwrite,
    generatedAt,
  };
}

export function deriveFifteenMinuteValidationCachePath(input: {
  cacheRoot: string;
  provider: CandleProviderName;
  symbol: string;
  lookbackBars: number;
  endTimeMs: number;
}): string {
  return join(
    resolve(input.cacheRoot),
    input.provider,
    input.symbol.trim().toUpperCase(),
    "15m",
    `${input.lookbackBars}-${normalizeEndTimeMs(input.endTimeMs)}.json`,
  );
}

function buildCacheEntry(input: {
  request: FifteenMinuteValidationCacheFetchRequest;
  response: FifteenMinuteValidationCacheProviderResponse;
  cachedAt: number;
}): FifteenMinuteValidationCacheEntry {
  return {
    schemaVersion: 1,
    cachedAt: input.cachedAt,
    request: {
      symbol: input.request.symbol,
      timeframe: "15m",
      lookbackBars: input.request.lookbackBars,
      endTimeMs: input.request.endTimeMs,
      provider: input.request.provider,
    },
    response: input.response,
  };
}

function normalizeProviderResponse(
  response: FifteenMinuteValidationCacheProviderResponse,
  request: FifteenMinuteValidationCacheFetchRequest,
): FifteenMinuteValidationCacheProviderResponse {
  return {
    ...response,
    provider: request.provider,
    symbol: request.symbol,
    timeframe: "15m",
    requestedLookbackBars: request.lookbackBars,
    requestedStartTimestamp:
      response.requestedStartTimestamp ?? request.endTimeMs - request.lookbackBars * FIFTEEN_MINUTES_MS,
    requestedEndTimestamp: response.requestedEndTimestamp ?? request.endTimeMs,
    candles: [...response.candles],
    actualBarsReturned: response.actualBarsReturned ?? response.candles.length,
    completenessStatus:
      response.completenessStatus ?? (response.candles.length === 0 ? "empty" : "complete"),
    stale: response.stale ?? false,
    validationIssues: response.validationIssues ?? [],
    sessionSummary: null,
  };
}

function responseFromLiveProvider(
  response: BaseProviderCandleResponse,
  request: FifteenMinuteValidationCacheFetchRequest,
): FifteenMinuteValidationCacheProviderResponse {
  if (response.timeframe !== "15m") {
    throw new Error(
      `Live provider returned ${response.timeframe} candles for ${request.symbol}; expected 15m.`,
    );
  }

  return {
    provider: request.provider,
    symbol: request.symbol,
    timeframe: "15m",
    requestedLookbackBars: request.lookbackBars,
    candles: [...response.candles],
    fetchStartTimestamp: response.fetchStartTimestamp,
    fetchEndTimestamp: response.fetchEndTimestamp,
    requestedStartTimestamp: response.requestedStartTimestamp,
    requestedEndTimestamp: response.requestedEndTimestamp,
    sessionMetadataAvailable: response.sessionMetadataAvailable,
    providerMetadata: response.providerMetadata,
    actualBarsReturned: response.candles.length,
    completenessStatus:
      response.candles.length === 0
        ? "empty"
        : response.candles.length >= request.lookbackBars
          ? "complete"
          : "partial",
    stale: false,
    validationIssues: [],
    sessionSummary: null,
  };
}

function buildFifteenMinuteLiveProviderFetcher(
  provider: FifteenMinuteProviderFetcher,
): FifteenMinuteValidationCacheFetcher {
  return async (request) => {
    const providerRequest: ProviderHistoricalFetchRequest = {
      symbol: request.symbol,
      timeframe: "15m",
      lookbackBars: request.lookbackBars,
      endTimeMs: request.endTimeMs,
      preferredProvider: request.provider,
    };
    const plan = buildProviderHistoricalFetchPlan(providerRequest, request.provider);
    const response = await provider.fetchCandles(providerRequest, plan);
    return responseFromLiveProvider(response, request);
  };
}

function deterministicValue(seed: number): number {
  const value = Math.sin(seed) * 10000;
  return value - Math.floor(value);
}

async function fetchStubFifteenMinuteCandles(
  request: FifteenMinuteValidationCacheFetchRequest,
): Promise<FifteenMinuteValidationCacheProviderResponse> {
  const fetchStartTimestamp = Date.now();
  let price = 5 + request.symbol.length * 0.1;
  const candles: Candle[] = [];

  for (let index = request.lookbackBars - 1; index >= 0; index -= 1) {
    const seed = (index + 1) * (request.symbol.length + 11);
    const timestamp = request.endTimeMs - index * FIFTEEN_MINUTES_MS;
    const open = Math.max(0.05, price);
    const close = Math.max(0.05, open + (deterministicValue(seed) - 0.5) * 0.12);
    const range = 0.03 + deterministicValue(seed + 5) * 0.2;
    const high = Math.max(open, close) + range * 0.6;
    const low = Math.max(0.01, Math.min(open, close) - range * 0.4);

    candles.push({
      timestamp,
      open: Number(open.toFixed(4)),
      high: Number(high.toFixed(4)),
      low: Number(low.toFixed(4)),
      close: Number(close.toFixed(4)),
      volume: Math.round(100000 + deterministicValue(seed + 13) * 600000),
    });
    price = close;
  }

  return {
    provider: "stub",
    symbol: request.symbol,
    timeframe: "15m",
    requestedLookbackBars: request.lookbackBars,
    candles,
    fetchStartTimestamp,
    fetchEndTimestamp: Date.now(),
    requestedStartTimestamp: request.endTimeMs - request.lookbackBars * FIFTEEN_MINUTES_MS,
    requestedEndTimestamp: request.endTimeMs,
    sessionMetadataAvailable: true,
    providerMetadata: {
      source: "deterministic_15m_cache_collection_stub",
    },
    actualBarsReturned: candles.length,
    completenessStatus: candles.length === 0 ? "empty" : "complete",
    stale: false,
    validationIssues: [],
    sessionSummary: null,
  };
}

type DisconnectableIbkrClient = {
  disconnect: () => void;
};

function disconnectIbkrClient(ib: DisconnectableIbkrClient): void {
  try {
    ib.disconnect();
  } catch {
    // Ignore disconnect failures during operator cleanup.
  }
}

async function createIbkrFifteenMinuteFetcherBundle(
  env: FifteenMinuteValidationCacheRuntimeEnv,
): Promise<FifteenMinuteValidationCacheFetcherBundle> {
  if (!isTruthy(env[ENABLE_IBKR_LIVE_15M_ENV])) {
    throw new Error(
      `IBKR live 15m collection requires ${ENABLE_IBKR_LIVE_15M_ENV}=true. Dry-run remains available without IBKR config.`,
    );
  }

  const clientId = resolveOptionalPositiveInteger(env[IBKR_CLIENT_ID_ENV], IBKR_CLIENT_ID_ENV);
  const port = resolveOptionalPositiveInteger(env[IBKR_PORT_ENV], IBKR_PORT_ENV);
  const connectionTimeoutMs = resolveOptionalPositiveInteger(
    env[IBKR_CONNECTION_TIMEOUT_ENV],
    IBKR_CONNECTION_TIMEOUT_ENV,
  );
  const historicalTimeoutMs = resolveOptionalPositiveInteger(
    env[IBKR_HISTORICAL_TIMEOUT_ENV],
    IBKR_HISTORICAL_TIMEOUT_ENV,
  );
  const ib = createIbkrClient(clientId, env[IBKR_HOST_ENV], port);
  try {
    await waitForIbkrConnection(ib, connectionTimeoutMs);
  } catch (error) {
    disconnectIbkrClient(ib);
    throw error;
  }

  return {
    fetcher: buildFifteenMinuteLiveProviderFetcher(
      new IbkrHistoricalCandleProvider(ib, historicalTimeoutMs),
    ),
    cleanup: () => disconnectIbkrClient(ib),
  };
}

function createTwelveDataFifteenMinuteFetcherBundle(
  env: FifteenMinuteValidationCacheRuntimeEnv,
): FifteenMinuteValidationCacheFetcherBundle {
  const apiKey = env[TWELVE_DATA_API_KEY_ENV]?.trim();
  if (!apiKey) {
    throw new Error(
      `Twelve Data live 15m collection requires ${TWELVE_DATA_API_KEY_ENV}. Dry-run remains available without Twelve Data config.`,
    );
  }

  return {
    fetcher: buildFifteenMinuteLiveProviderFetcher(new TwelveDataHistoricalCandleProvider(apiKey)),
  };
}

export async function createDefaultFifteenMinuteValidationCacheFetcherBundle(
  provider: CandleProviderName,
  env: FifteenMinuteValidationCacheRuntimeEnv = process.env,
): Promise<FifteenMinuteValidationCacheFetcherBundle> {
  if (provider === "stub") {
    return {
      fetcher: fetchStubFifteenMinuteCandles,
    };
  }

  if (provider === "ibkr") {
    return createIbkrFifteenMinuteFetcherBundle(env);
  }

  return createTwelveDataFifteenMinuteFetcherBundle(env);
}

export async function createDefaultFifteenMinuteValidationCacheFetcher(
  provider: CandleProviderName,
  env: FifteenMinuteValidationCacheRuntimeEnv = process.env,
): Promise<FifteenMinuteValidationCacheFetcher> {
  const bundle = await createDefaultFifteenMinuteValidationCacheFetcherBundle(provider, env);
  return bundle.fetcher;
}

async function writeCacheEntry(path: string, entry: FifteenMinuteValidationCacheEntry): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(entry, null, 2)}\n`, "utf8");
}

export async function collectFifteenMinuteValidationCache(
  options: CollectFifteenMinuteValidationCacheOptions,
): Promise<CollectFifteenMinuteValidationCacheResult> {
  const generatedAt = new Date(options.generatedAt ?? Date.now()).toISOString();
  const cachedAt = Date.parse(generatedAt);
  const mode = options.mode ?? "dry_run";
  const dryRun = mode !== "write";
  const endTimeMs = normalizeEndTimeMs(options.endTimeMs);
  const symbols = [...new Set(options.symbols.map((symbol) => symbol.trim().toUpperCase()))];
  let cleanup: FifteenMinuteValidationCacheFetcherCleanup | undefined;
  let defaultFetcherPromise: Promise<FifteenMinuteValidationCacheFetcherBundle> | undefined;
  const resolveFetcher = async (): Promise<FifteenMinuteValidationCacheFetcher> => {
    if (options.fetcher) {
      cleanup ??= options.fetcherCleanup;
      return options.fetcher;
    }

    defaultFetcherPromise ??= createDefaultFifteenMinuteValidationCacheFetcherBundle(
      options.provider,
      options.runtimeEnv,
    );
    const bundle = await defaultFetcherPromise;
    cleanup ??= bundle.cleanup;
    return bundle.fetcher;
  };
  const items: CollectFifteenMinuteValidationCacheItem[] = [];

  try {
    for (const symbol of symbols) {
      const outputPath = deriveFifteenMinuteValidationCachePath({
        cacheRoot: options.cacheRoot,
        provider: options.provider,
        symbol,
        lookbackBars: options.lookbackBars,
        endTimeMs,
      });

      if (dryRun) {
        items.push({
          symbol,
          provider: options.provider,
          timeframe: "15m",
          lookbackBars: options.lookbackBars,
          endTimeMs,
          outputPath,
          status: "planned",
          dryRun: true,
        });
        continue;
      }

      if (existsSync(outputPath) && !options.overwrite) {
        items.push({
          symbol,
          provider: options.provider,
          timeframe: "15m",
          lookbackBars: options.lookbackBars,
          endTimeMs,
          outputPath,
          status: "skipped_existing",
          dryRun: false,
        });
        continue;
      }

      const request: FifteenMinuteValidationCacheFetchRequest = {
        symbol,
        timeframe: "15m",
        lookbackBars: options.lookbackBars,
        endTimeMs,
        provider: options.provider,
      };

      try {
        const fetcher = await resolveFetcher();
        const response = normalizeProviderResponse(await fetcher(request), request);
        if (response.candles.length === 0) {
          items.push({
            symbol,
            provider: options.provider,
            timeframe: "15m",
            lookbackBars: options.lookbackBars,
            endTimeMs,
            outputPath,
            status: "failed",
            dryRun: false,
            candleCount: 0,
            error: "Provider returned zero 15m candles.",
          });
          continue;
        }

        await writeCacheEntry(outputPath, buildCacheEntry({ request, response, cachedAt }));
        items.push({
          symbol,
          provider: options.provider,
          timeframe: "15m",
          lookbackBars: options.lookbackBars,
          endTimeMs,
          outputPath,
          status: "written",
          dryRun: false,
          candleCount: response.candles.length,
        });
      } catch (error) {
        items.push({
          symbol,
          provider: options.provider,
          timeframe: "15m",
          lookbackBars: options.lookbackBars,
          endTimeMs,
          outputPath,
          status: "failed",
          dryRun: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    if (cleanup) {
      await cleanup();
    }
  }

  return {
    summary: {
      generatedAt,
      cacheRoot: resolve(options.cacheRoot),
      provider: options.provider,
      timeframe: "15m",
      lookbackBars: options.lookbackBars,
      endTimeMs,
      dryRun,
      write: !dryRun,
      overwrite: options.overwrite ?? false,
      totalSymbols: items.length,
      plannedCount: items.filter((item) => item.status === "planned").length,
      writtenCount: items.filter((item) => item.status === "written").length,
      skippedExistingCount: items.filter((item) => item.status === "skipped_existing").length,
      failedCount: items.filter((item) => item.status === "failed").length,
    },
    items,
  };
}

export function formatCollectFifteenMinuteValidationCacheSummary(
  result: CollectFifteenMinuteValidationCacheResult,
): string {
  const { summary } = result;
  const lines = [
    "15m validation cache collection",
    `Generated at: ${summary.generatedAt}`,
    `Mode: ${summary.dryRun ? "dry-run" : "write"}`,
    `Cache root: ${summary.cacheRoot}`,
    `Provider: ${summary.provider}`,
    `Timeframe: ${summary.timeframe}`,
    `Lookback bars: ${summary.lookbackBars}`,
    `End time: ${summary.endTimeMs}`,
    `Overwrite: ${summary.overwrite}`,
    `Symbols: ${summary.totalSymbols}`,
    `Planned: ${summary.plannedCount}`,
    `Written: ${summary.writtenCount}`,
    `Skipped existing: ${summary.skippedExistingCount}`,
    `Failed: ${summary.failedCount}`,
    "Items:",
    ...result.items.map((item) => {
      const suffix =
        item.status === "failed"
          ? ` | ${item.error ?? "unknown error"}`
          : item.candleCount === undefined
            ? ""
            : ` | candles=${item.candleCount}`;
      return `- ${item.symbol}: ${item.status} -> ${item.outputPath}${suffix}`;
    }),
  ];

  return `${lines.join("\n")}\n`;
}

function isDirectRun(): boolean {
  const argvPath = process.argv[1];
  return argvPath !== undefined && fileURLToPath(import.meta.url) === resolve(argvPath);
}

if (isDirectRun()) {
  try {
    const options = parseCollectFifteenMinuteValidationCacheArgs(process.argv.slice(2));
    const result = await collectFifteenMinuteValidationCache(options);
    process.stdout.write(formatCollectFifteenMinuteValidationCacheSummary(result));
    if (result.summary.failedCount > 0 && result.summary.write) {
      process.exitCode = 1;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}
