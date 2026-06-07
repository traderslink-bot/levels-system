import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildJournalTradeContextFiveMinuteDayPolicy } from "../lib/analysis/journal-trade-context-5m-day-policy.js";
import { CandleFetchService, StubHistoricalCandleProvider } from "../lib/market-data/candle-fetch-service.js";
import type {
  CandleProviderName,
  CandleProviderResponse,
} from "../lib/market-data/candle-types.js";
import { IbkrHistoricalCandleProvider } from "../lib/market-data/ibkr-historical-candle-provider.js";
import type { HistoricalFetchRequest } from "../lib/market-data/provider-types.js";
import { TwelveDataHistoricalCandleProvider } from "../lib/market-data/providers/twelve-data-historical-candle-provider.js";
import { waitForIbkrConnection } from "./shared/ibkr-connection.js";
import { createIbkrClient } from "./shared/ibkr-runtime.js";

export type JournalTradeContextFiveMinuteDayCacheRuntimeEnv = Record<string, string | undefined>;

export type JournalTradeContextFiveMinuteDayCacheRequest = {
  symbol: string;
  tradeContextTimestamp: number;
};

export type JournalTradeContextFiveMinuteDayCacheEntry = {
  schemaVersion: 1;
  cachedAt: number;
  request: {
    symbol: string;
    timeframe: "5m";
    lookbackBars: number;
    endTimeMs: number;
    provider: CandleProviderName;
  };
  response: CandleProviderResponse;
  journalTradeContextPolicy: {
    cacheKey: string;
    localDate: string;
    timezone: string;
    sessionStartTimestamp: number;
    sessionEndTimestamp: number;
    sourceTradeContextTimestamps: number[];
    safety: {
      fullDayFetchOnly: true;
      snapshotStillFiltersAsOf: true;
      noTradeSpecificCandleExpansion: true;
      noLevelEngineBehaviorChange: true;
    };
  };
};

export type JournalTradeContextFiveMinuteDayCacheFetcher = (
  request: HistoricalFetchRequest,
) => Promise<CandleProviderResponse>;

export type JournalTradeContextFiveMinuteDayCacheFetcherCleanup = () => Promise<void> | void;

export type JournalTradeContextFiveMinuteDayCacheFetcherBundle = {
  fetcher: JournalTradeContextFiveMinuteDayCacheFetcher;
  cleanup?: JournalTradeContextFiveMinuteDayCacheFetcherCleanup;
};

export type CollectJournalTradeContextFiveMinuteDayCacheMode = "dry_run" | "write";

export type CollectJournalTradeContextFiveMinuteDayCacheOptions = {
  cacheRoot: string;
  provider: CandleProviderName;
  requests: JournalTradeContextFiveMinuteDayCacheRequest[];
  mode?: CollectJournalTradeContextFiveMinuteDayCacheMode;
  overwrite?: boolean;
  generatedAt?: string;
  timezone?: string;
  sessionStartHour?: number;
  sessionEndHour?: number;
  fetcher?: JournalTradeContextFiveMinuteDayCacheFetcher;
  fetcherCleanup?: JournalTradeContextFiveMinuteDayCacheFetcherCleanup;
  runtimeEnv?: JournalTradeContextFiveMinuteDayCacheRuntimeEnv;
};

export type CollectJournalTradeContextFiveMinuteDayCacheCliOptions =
  Omit<
    CollectJournalTradeContextFiveMinuteDayCacheOptions,
    "fetcher" | "fetcherCleanup" | "mode" | "runtimeEnv" | "requests"
  > & {
    requests: JournalTradeContextFiveMinuteDayCacheRequest[];
    dryRun: boolean;
    write: boolean;
    mode: CollectJournalTradeContextFiveMinuteDayCacheMode;
  };

export type CollectJournalTradeContextFiveMinuteDayCacheItemStatus =
  | "planned"
  | "written"
  | "skipped_existing"
  | "failed";

export type CollectJournalTradeContextFiveMinuteDayCacheItem = {
  symbol: string;
  provider: CandleProviderName;
  timeframe: "5m";
  localDate: string;
  timezone: string;
  lookbackBars: number;
  endTimeMs: number;
  cacheKey: string;
  sourceTradeContextTimestamps: number[];
  outputPath: string;
  status: CollectJournalTradeContextFiveMinuteDayCacheItemStatus;
  dryRun: boolean;
  candleCount?: number;
  error?: string;
};

export type CollectJournalTradeContextFiveMinuteDayCacheSummary = {
  generatedAt: string;
  cacheRoot: string;
  provider: CandleProviderName;
  timeframe: "5m";
  dryRun: boolean;
  write: boolean;
  overwrite: boolean;
  requestedTradeContexts: number;
  uniqueDayRequests: number;
  plannedCount: number;
  writtenCount: number;
  skippedExistingCount: number;
  failedCount: number;
};

export type CollectJournalTradeContextFiveMinuteDayCacheResult = {
  summary: CollectJournalTradeContextFiveMinuteDayCacheSummary;
  items: CollectJournalTradeContextFiveMinuteDayCacheItem[];
};

const ENABLE_IBKR_LIVE_5M_DAY_ENV = "LEVEL_JOURNAL_5M_DAY_CACHE_ENABLE_IBKR";
const IBKR_HOST_ENV = "LEVEL_JOURNAL_5M_DAY_CACHE_IBKR_HOST";
const IBKR_PORT_ENV = "LEVEL_JOURNAL_5M_DAY_CACHE_IBKR_PORT";
const IBKR_CLIENT_ID_ENV = "LEVEL_JOURNAL_5M_DAY_CACHE_IBKR_CLIENT_ID";
const IBKR_CONNECTION_TIMEOUT_ENV = "LEVEL_JOURNAL_5M_DAY_CACHE_IBKR_CONNECTION_TIMEOUT_MS";
const IBKR_HISTORICAL_TIMEOUT_ENV = "LEVEL_VALIDATION_IBKR_TIMEOUT_MS";
const TWELVE_DATA_API_KEY_ENV = "TWELVE_DATA_API_KEY";

type DisconnectableIbkrClient = {
  disconnect: () => void;
};

type PlannedDayRequest = {
  symbol: string;
  localDate: string;
  timezone: string;
  cacheKey: string;
  fetchRequest: HistoricalFetchRequest;
  outputPath: string;
  sourceTradeContextTimestamps: number[];
  policy: ReturnType<typeof buildJournalTradeContextFiveMinuteDayPolicy>;
};

function isTruthy(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
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

function parseTradeContextTimestamp(value: string): number {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric;
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid trade context timestamp "${value}".`);
  }

  return parsed;
}

export function parseJournalTradeContextFiveMinuteDayRequests(
  value: string,
): JournalTradeContextFiveMinuteDayCacheRequest[] {
  const requests = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const separatorIndex = item.indexOf("@");
      if (separatorIndex <= 0 || separatorIndex === item.length - 1) {
        throw new Error(
          `Invalid trade context request "${item}". Expected SYMBOL@timestamp.`,
        );
      }

      return {
        symbol: item.slice(0, separatorIndex).trim(),
        tradeContextTimestamp: parseTradeContextTimestamp(item.slice(separatorIndex + 1).trim()),
      };
    });

  if (requests.length === 0) {
    throw new Error("--requests must include at least one SYMBOL@timestamp item.");
  }

  return requests;
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}.`);
  }

  return value;
}

export function parseCollectJournalTradeContextFiveMinuteDayCacheArgs(
  args: string[],
): CollectJournalTradeContextFiveMinuteDayCacheCliOptions {
  let cacheRoot: string | undefined;
  let provider: CandleProviderName | undefined;
  let requests: JournalTradeContextFiveMinuteDayCacheRequest[] | undefined;
  let dryRun = false;
  let write = false;
  let overwrite = false;
  let generatedAt: string | undefined;
  let timezone: string | undefined;
  let sessionStartHour: number | undefined;
  let sessionEndHour: number | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--cache-root") {
      cacheRoot = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--provider") {
      provider = parseProvider(requireValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--requests") {
      requests = parseJournalTradeContextFiveMinuteDayRequests(requireValue(args, index, arg));
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
    if (arg === "--timezone") {
      timezone = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--session-start-hour") {
      sessionStartHour = parsePositiveInteger(requireValue(args, index, arg), arg);
      index += 1;
      continue;
    }
    if (arg === "--session-end-hour") {
      sessionEndHour = parsePositiveInteger(requireValue(args, index, arg), arg);
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
  if (!provider) {
    throw new Error("Missing required --provider <provider>.");
  }
  if (!requests) {
    throw new Error("Missing required --requests <SYMBOL@timestamp,...>.");
  }
  if (dryRun && write) {
    throw new Error("Use either --dry-run or --write, not both.");
  }

  const mode: CollectJournalTradeContextFiveMinuteDayCacheMode = write ? "write" : "dry_run";

  return {
    cacheRoot,
    provider,
    requests,
    dryRun: mode === "dry_run",
    write: mode === "write",
    mode,
    overwrite,
    generatedAt,
    timezone,
    sessionStartHour,
    sessionEndHour,
  };
}

export function deriveJournalTradeContextFiveMinuteDayCachePath(input: {
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
    "5m",
    `${input.lookbackBars}-${input.endTimeMs}.json`,
  );
}

function disconnectIbkrClient(ib: DisconnectableIbkrClient): void {
  try {
    ib.disconnect();
  } catch {
    // Ignore disconnect failures during operator cleanup.
  }
}

function buildServiceFetcher(service: CandleFetchService): JournalTradeContextFiveMinuteDayCacheFetcher {
  return (request) => service.fetchCandles(request);
}

async function createIbkrFetcherBundle(
  env: JournalTradeContextFiveMinuteDayCacheRuntimeEnv,
): Promise<JournalTradeContextFiveMinuteDayCacheFetcherBundle> {
  if (!isTruthy(env[ENABLE_IBKR_LIVE_5M_DAY_ENV])) {
    throw new Error(
      `IBKR live journal 5m day collection requires ${ENABLE_IBKR_LIVE_5M_DAY_ENV}=true. Dry-run remains available without IBKR config.`,
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
    fetcher: buildServiceFetcher(
      new CandleFetchService(new IbkrHistoricalCandleProvider(ib, historicalTimeoutMs)),
    ),
    cleanup: () => disconnectIbkrClient(ib),
  };
}

function createTwelveDataFetcherBundle(
  env: JournalTradeContextFiveMinuteDayCacheRuntimeEnv,
): JournalTradeContextFiveMinuteDayCacheFetcherBundle {
  const apiKey = env[TWELVE_DATA_API_KEY_ENV]?.trim();
  if (!apiKey) {
    throw new Error(
      `Twelve Data journal 5m day collection requires ${TWELVE_DATA_API_KEY_ENV}. Dry-run remains available without Twelve Data config.`,
    );
  }

  return {
    fetcher: buildServiceFetcher(
      new CandleFetchService(new TwelveDataHistoricalCandleProvider(apiKey)),
    ),
  };
}

export async function createDefaultJournalTradeContextFiveMinuteDayCacheFetcherBundle(
  provider: CandleProviderName,
  env: JournalTradeContextFiveMinuteDayCacheRuntimeEnv = process.env,
): Promise<JournalTradeContextFiveMinuteDayCacheFetcherBundle> {
  if (provider === "stub") {
    return {
      fetcher: buildServiceFetcher(new CandleFetchService(new StubHistoricalCandleProvider())),
    };
  }

  if (provider === "ibkr") {
    return createIbkrFetcherBundle(env);
  }

  return createTwelveDataFetcherBundle(env);
}

function buildPlannedDayRequests(
  options: CollectJournalTradeContextFiveMinuteDayCacheOptions,
): PlannedDayRequest[] {
  const grouped = new Map<string, PlannedDayRequest>();

  for (const request of options.requests) {
    const policy = buildJournalTradeContextFiveMinuteDayPolicy({
      symbol: request.symbol,
      tradeContextTimestamp: request.tradeContextTimestamp,
      timezone: options.timezone,
      sessionStartHour: options.sessionStartHour,
      sessionEndHour: options.sessionEndHour,
    });
    const existing = grouped.get(policy.cacheIdentity.key);
    if (existing) {
      existing.sourceTradeContextTimestamps.push(request.tradeContextTimestamp);
      existing.sourceTradeContextTimestamps.sort((left, right) => left - right);
      continue;
    }

    grouped.set(policy.cacheIdentity.key, {
      symbol: policy.symbol,
      localDate: policy.session.localDate,
      timezone: policy.session.timezone,
      cacheKey: policy.cacheIdentity.key,
      fetchRequest: {
        ...policy.fetchRequest,
        preferredProvider: options.provider,
      },
      outputPath: deriveJournalTradeContextFiveMinuteDayCachePath({
        cacheRoot: options.cacheRoot,
        provider: options.provider,
        symbol: policy.symbol,
        lookbackBars: policy.fetchRequest.lookbackBars,
        endTimeMs: policy.fetchRequest.endTimeMs!,
      }),
      sourceTradeContextTimestamps: [request.tradeContextTimestamp],
      policy,
    });
  }

  return [...grouped.values()].sort((left, right) => left.cacheKey.localeCompare(right.cacheKey));
}

function itemFromPlan(
  plan: PlannedDayRequest,
  provider: CandleProviderName,
  status: CollectJournalTradeContextFiveMinuteDayCacheItemStatus,
  dryRun: boolean,
  extra?: Pick<CollectJournalTradeContextFiveMinuteDayCacheItem, "candleCount" | "error">,
): CollectJournalTradeContextFiveMinuteDayCacheItem {
  return {
    symbol: plan.symbol,
    provider,
    timeframe: "5m",
    localDate: plan.localDate,
    timezone: plan.timezone,
    lookbackBars: plan.fetchRequest.lookbackBars,
    endTimeMs: plan.fetchRequest.endTimeMs!,
    cacheKey: plan.cacheKey,
    sourceTradeContextTimestamps: [...plan.sourceTradeContextTimestamps],
    outputPath: plan.outputPath,
    status,
    dryRun,
    ...extra,
  };
}

function buildCacheEntry(input: {
  plan: PlannedDayRequest;
  provider: CandleProviderName;
  response: CandleProviderResponse;
  cachedAt: number;
}): JournalTradeContextFiveMinuteDayCacheEntry {
  return {
    schemaVersion: 1,
    cachedAt: input.cachedAt,
    request: {
      symbol: input.plan.symbol,
      timeframe: "5m",
      lookbackBars: input.plan.fetchRequest.lookbackBars,
      endTimeMs: input.plan.fetchRequest.endTimeMs!,
      provider: input.provider,
    },
    response: input.response,
    journalTradeContextPolicy: {
      cacheKey: input.plan.cacheKey,
      localDate: input.plan.localDate,
      timezone: input.plan.timezone,
      sessionStartTimestamp: input.plan.policy.session.startTimestamp,
      sessionEndTimestamp: input.plan.policy.session.endTimestamp,
      sourceTradeContextTimestamps: [...input.plan.sourceTradeContextTimestamps],
      safety: input.plan.policy.safety,
    },
  };
}

async function writeCacheEntry(path: string, entry: JournalTradeContextFiveMinuteDayCacheEntry): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(entry, null, 2)}\n`, "utf8");
}

export async function collectJournalTradeContextFiveMinuteDayCache(
  options: CollectJournalTradeContextFiveMinuteDayCacheOptions,
): Promise<CollectJournalTradeContextFiveMinuteDayCacheResult> {
  const generatedAt = new Date(options.generatedAt ?? Date.now()).toISOString();
  const cachedAt = Date.parse(generatedAt);
  const mode = options.mode ?? "dry_run";
  const dryRun = mode !== "write";
  const plans = buildPlannedDayRequests(options);
  let cleanup: JournalTradeContextFiveMinuteDayCacheFetcherCleanup | undefined;
  let defaultFetcherPromise: Promise<JournalTradeContextFiveMinuteDayCacheFetcherBundle> | undefined;
  const resolveFetcher = async (): Promise<JournalTradeContextFiveMinuteDayCacheFetcher> => {
    if (options.fetcher) {
      cleanup ??= options.fetcherCleanup;
      return options.fetcher;
    }

    defaultFetcherPromise ??= createDefaultJournalTradeContextFiveMinuteDayCacheFetcherBundle(
      options.provider,
      options.runtimeEnv,
    );
    const bundle = await defaultFetcherPromise;
    cleanup ??= bundle.cleanup;
    return bundle.fetcher;
  };
  const items: CollectJournalTradeContextFiveMinuteDayCacheItem[] = [];

  try {
    for (const plan of plans) {
      if (dryRun) {
        items.push(itemFromPlan(plan, options.provider, "planned", true));
        continue;
      }

      if (existsSync(plan.outputPath) && !options.overwrite) {
        items.push(itemFromPlan(plan, options.provider, "skipped_existing", false));
        continue;
      }

      try {
        const fetcher = await resolveFetcher();
        const response = await fetcher(plan.fetchRequest);
        if (response.candles.length === 0) {
          items.push(
            itemFromPlan(plan, options.provider, "failed", false, {
              candleCount: 0,
              error: "Provider returned zero 5m candles.",
            }),
          );
          continue;
        }

        await writeCacheEntry(
          plan.outputPath,
          buildCacheEntry({
            plan,
            provider: options.provider,
            response,
            cachedAt,
          }),
        );
        items.push(
          itemFromPlan(plan, options.provider, "written", false, {
            candleCount: response.candles.length,
          }),
        );
      } catch (error) {
        items.push(
          itemFromPlan(plan, options.provider, "failed", false, {
            error: error instanceof Error ? error.message : String(error),
          }),
        );
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
      timeframe: "5m",
      dryRun,
      write: !dryRun,
      overwrite: options.overwrite ?? false,
      requestedTradeContexts: options.requests.length,
      uniqueDayRequests: plans.length,
      plannedCount: items.filter((item) => item.status === "planned").length,
      writtenCount: items.filter((item) => item.status === "written").length,
      skippedExistingCount: items.filter((item) => item.status === "skipped_existing").length,
      failedCount: items.filter((item) => item.status === "failed").length,
    },
    items,
  };
}

export function formatCollectJournalTradeContextFiveMinuteDayCacheSummary(
  result: CollectJournalTradeContextFiveMinuteDayCacheResult,
): string {
  const { summary } = result;
  const lines = [
    "Journal trade-context 5m day cache collection",
    `Generated at: ${summary.generatedAt}`,
    `Mode: ${summary.dryRun ? "dry-run" : "write"}`,
    `Cache root: ${summary.cacheRoot}`,
    `Provider: ${summary.provider}`,
    `Timeframe: ${summary.timeframe}`,
    `Requested trade contexts: ${summary.requestedTradeContexts}`,
    `Unique day requests: ${summary.uniqueDayRequests}`,
    `Overwrite: ${summary.overwrite}`,
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
      return `- ${item.symbol} ${item.localDate}: ${item.status} -> ${item.outputPath}${suffix}`;
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
    const options = parseCollectJournalTradeContextFiveMinuteDayCacheArgs(process.argv.slice(2));
    const result = await collectJournalTradeContextFiveMinuteDayCache(options);
    process.stdout.write(formatCollectJournalTradeContextFiveMinuteDayCacheSummary(result));
    if (result.summary.failedCount > 0 && result.summary.write) {
      process.exitCode = 1;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}
