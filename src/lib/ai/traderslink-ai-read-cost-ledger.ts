import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type { TradersLinkAiReadPayload, TradersLinkAiReadUsage } from "../live-watchlist/live-watchlist-types.js";
import type { TradersLinkAiReadAttempt } from "./traderslink-ai-read-service.js";

export type TradersLinkAiReadCostTrigger =
  | "activation"
  | "startup"
  | "scheduled"
  | "price_move"
  | "range_edge"
  | "boundary_cross"
  | "manual"
  | "visibility_enabled";

export type TradersLinkAiReadCostLedgerEntry = {
  version: 1 | 2;
  symbol: string;
  generatedAt: number;
  dataAsOf: number;
  model: string;
  trigger: TradersLinkAiReadCostTrigger;
  marketSession: TradersLinkAiReadPayload["marketSession"];
  usedWebSearch: boolean;
  usage: TradersLinkAiReadUsage;
  generationId?: string;
  requestId?: string;
  clientRequestId?: string;
  attemptType?: TradersLinkAiReadAttempt["attemptType"] | "publication";
  status?: TradersLinkAiReadAttempt["status"] | "publish_error";
  receivedAt?: number;
  startedAt?: number;
  durationMs?: number;
  timeoutMs?: number;
  timeoutOverrunMs?: number;
  error?: string | null;
  failureStage?: TradersLinkAiReadAttempt["failureStage"];
  rejectedDraft?: TradersLinkAiReadAttempt["rejectedDraft"];
};

export type TradersLinkAiReadCostTotals = {
  requestCount: number;
  tickerCount: number;
  webSearchCallCount: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  tokenCostUsd: number;
  webSearchCostUsd: number;
  estimatedTotalCostUsd: number;
  unpricedRequestCount: number;
};

export type TradersLinkAiReadTickerCostSummary = TradersLinkAiReadCostTotals & {
  symbol: string;
  planGenerationCount: number;
  averageCostPerRequestUsd: number;
  lastGeneratedAt: number;
  lastTrigger: TradersLinkAiReadCostTrigger;
  lastEstimatedCostUsd: number;
};

export type TradersLinkAiReadCostSummary = {
  generatedAt: number;
  currency: "USD";
  estimateNotice: string;
  accountingHealth: {
    healthy: boolean;
    corruptLineCount: number;
    lastLoadError: string | null;
  };
  windows: {
    today: TradersLinkAiReadCostTotals;
    last7Days: TradersLinkAiReadCostTotals;
    last30Days: TradersLinkAiReadCostTotals;
    allTime: TradersLinkAiReadCostTotals;
  };
  todayPerTicker: TradersLinkAiReadTickerCostSummary[];
  perTicker: TradersLinkAiReadTickerCostSummary[];
  tickerWindows: {
    today: TradersLinkAiReadTickerCostSummary[];
    last7Days: TradersLinkAiReadTickerCostSummary[];
    last30Days: TradersLinkAiReadTickerCostSummary[];
    allTime: TradersLinkAiReadTickerCostSummary[];
  };
  byTrigger: Array<{ trigger: TradersLinkAiReadCostTrigger; totals: TradersLinkAiReadCostTotals }>;
  byModel: Array<{ model: string; totals: TradersLinkAiReadCostTotals }>;
  recentFailures: Array<Pick<TradersLinkAiReadCostLedgerEntry,
    "symbol" | "generatedAt" | "dataAsOf" | "model" | "trigger" | "attemptType" |
    "status" | "error" | "failureStage" | "rejectedDraft" | "generationId" | "requestId"
  >>;
};

export type TradersLinkAiReadDailyCostBudgetStatus = {
  enabled: boolean;
  dailyLimitUsd: number;
  spentUsd: number;
  guardedSpendUsd: number;
  unpricedRequestCount: number;
  unpricedReserveUsd: number;
  projectedNextRequestUsd: number;
  remainingUsd: number;
  canStartRequest: boolean;
  blockReason: string | null;
};

export type TradersLinkAiReadCostLedgerOptions = {
  filePath?: string;
};

const DEFAULT_LEDGER_FILE = resolve(
  process.cwd(),
  "artifacts",
  "traderslink-ai-read-costs.jsonl",
);
const DAY_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_NEXT_REQUEST_RESERVE_USD = 0.1;
// A request without token pricing is not treated as free. Keep a conservative
// allowance for provider-side billing that the response did not let us price.
const UNPRICED_REQUEST_RESERVE_USD = 0.25;
const RECENT_REQUEST_RESERVE_SAMPLE_SIZE = 8;

function roundUsd(value: number): number {
  return Math.round(value * 100_000_000) / 100_000_000;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUsage(value: unknown): value is TradersLinkAiReadUsage {
  if (!isRecord(value) || !isRecord(value.pricing)) {
    return false;
  }
  return [
    value.inputTokens,
    value.cachedInputTokens,
    value.outputTokens,
    value.totalTokens,
    value.webSearchCallCount,
    value.webSearchCostUsd,
  ].every((item) => typeof item === "number" && Number.isFinite(item) && item >= 0);
}

function isEntry(value: unknown): value is TradersLinkAiReadCostLedgerEntry {
  return (
    isRecord(value) &&
    (value.version === 1 || value.version === 2) &&
    typeof value.symbol === "string" &&
    value.symbol.length > 0 &&
    typeof value.generatedAt === "number" &&
    Number.isFinite(value.generatedAt) &&
    typeof value.dataAsOf === "number" &&
    Number.isFinite(value.dataAsOf) &&
    typeof value.model === "string" &&
    typeof value.trigger === "string" &&
    typeof value.usedWebSearch === "boolean" &&
    isUsage(value.usage)
  );
}

function emptyTotals(): TradersLinkAiReadCostTotals {
  return {
    requestCount: 0,
    tickerCount: 0,
    webSearchCallCount: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    tokenCostUsd: 0,
    webSearchCostUsd: 0,
    estimatedTotalCostUsd: 0,
    unpricedRequestCount: 0,
  };
}

function emptyUsage(template: TradersLinkAiReadUsage): TradersLinkAiReadUsage {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    webSearchCallCount: 0,
    tokenCostUsd: template.tokenCostUsd === null ? null : 0,
    webSearchCostUsd: 0,
    estimatedTotalCostUsd: template.estimatedTotalCostUsd === null ? null : 0,
    pricing: template.pricing,
  };
}

function totalsFor(entries: TradersLinkAiReadCostLedgerEntry[]): TradersLinkAiReadCostTotals {
  const totals = emptyTotals();
  const symbols = new Set<string>();
  for (const entry of entries) {
    const usage = entry.usage;
    if (entry.status !== "publish_error") {
      totals.requestCount += 1;
    }
    symbols.add(entry.symbol);
    totals.webSearchCallCount += usage.webSearchCallCount;
    totals.inputTokens += usage.inputTokens;
    totals.cachedInputTokens += usage.cachedInputTokens;
    totals.outputTokens += usage.outputTokens;
    totals.totalTokens += usage.totalTokens;
    totals.webSearchCostUsd += usage.webSearchCostUsd;
    if (usage.tokenCostUsd === null) {
      totals.unpricedRequestCount += 1;
    } else {
      totals.tokenCostUsd += usage.tokenCostUsd;
    }
  }
  totals.tickerCount = symbols.size;
  totals.tokenCostUsd = roundUsd(totals.tokenCostUsd);
  totals.webSearchCostUsd = roundUsd(totals.webSearchCostUsd);
  totals.estimatedTotalCostUsd = roundUsd(totals.tokenCostUsd + totals.webSearchCostUsd);
  return totals;
}

function planGenerationCountFor(entries: TradersLinkAiReadCostLedgerEntry[]): number {
  return new Set(entries.map((entry, index) =>
    entry.generationId ?? `legacy:${entry.generatedAt}:${entry.trigger}:${index}`
  )).size;
}

function easternDateKey(timestamp: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}

export class TradersLinkAiReadCostLedger {
  private readonly filePath: string;
  private accountingHealth: TradersLinkAiReadCostSummary["accountingHealth"] = {
    healthy: true,
    corruptLineCount: 0,
    lastLoadError: null,
  };

  constructor(options: TradersLinkAiReadCostLedgerOptions = {}) {
    this.filePath = options.filePath ?? DEFAULT_LEDGER_FILE;
  }

  getFilePath(): string {
    return this.filePath;
  }

  record(args: {
    read: TradersLinkAiReadPayload;
    trigger: TradersLinkAiReadCostTrigger;
  }): void {
    const entry: TradersLinkAiReadCostLedgerEntry = {
      version: 1,
      symbol: args.read.symbol.trim().toUpperCase(),
      generatedAt: args.read.generatedAt,
      dataAsOf: args.read.dataAsOf,
      model: args.read.model,
      trigger: args.trigger,
      marketSession: args.read.marketSession,
      usedWebSearch: args.read.usedWebSearch,
      usage: args.read.usage,
    };
    this.append(entry);
  }

  recordAttempt(args: {
    attempt: TradersLinkAiReadAttempt;
    trigger: TradersLinkAiReadCostTrigger;
  }): void {
    this.append({
      version: 2,
      symbol: args.attempt.symbol,
      generatedAt: args.attempt.receivedAt,
      dataAsOf: args.attempt.dataAsOf,
      model: args.attempt.model,
      trigger: args.trigger,
      marketSession: args.attempt.marketSession,
      usedWebSearch: args.attempt.usedWebSearch,
      usage: args.attempt.usage,
      generationId: args.attempt.generationId,
      requestId: args.attempt.requestId,
      clientRequestId: args.attempt.clientRequestId,
      attemptType: args.attempt.attemptType,
      status: args.attempt.status,
      receivedAt: args.attempt.receivedAt,
      startedAt: args.attempt.startedAt,
      durationMs: args.attempt.durationMs,
      timeoutMs: args.attempt.timeoutMs,
      timeoutOverrunMs: args.attempt.timeoutOverrunMs,
      error: args.attempt.error,
      failureStage: args.attempt.failureStage,
      rejectedDraft: args.attempt.rejectedDraft,
    });
  }

  recordPublishFailure(args: {
    read: TradersLinkAiReadPayload;
    trigger: TradersLinkAiReadCostTrigger;
    error: unknown;
  }): void {
    this.append({
      version: 2,
      symbol: args.read.symbol,
      generatedAt: Date.now(),
      dataAsOf: args.read.dataAsOf,
      model: args.read.model,
      trigger: args.trigger,
      marketSession: args.read.marketSession,
      usedWebSearch: false,
      usage: emptyUsage(args.read.usage),
      attemptType: "publication",
      status: "publish_error",
      receivedAt: Date.now(),
      error: args.error instanceof Error ? args.error.message : String(args.error),
    });
  }

  private append(entry: TradersLinkAiReadCostLedgerEntry): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    appendFileSync(this.filePath, `${JSON.stringify(entry)}\n`, "utf8");
  }

  load(): TradersLinkAiReadCostLedgerEntry[] {
    let corruptLineCount = 0;
    try {
      const raw = readFileSync(this.filePath, "utf8");
      const entries = raw
        .split(/\r?\n/)
        .filter(Boolean)
        .flatMap((line) => {
          try {
            const parsed = JSON.parse(line) as unknown;
            if (isEntry(parsed)) {
              return [parsed];
            }
            corruptLineCount += 1;
            return [];
          } catch {
            corruptLineCount += 1;
            return [];
          }
        });
      this.accountingHealth = {
        healthy: corruptLineCount === 0,
        corruptLineCount,
        lastLoadError: corruptLineCount > 0
          ? `${corruptLineCount} malformed or unsupported ledger line(s) were excluded from totals.`
          : null,
      };
      return entries;
    } catch (error) {
      const missing = (error as NodeJS.ErrnoException)?.code === "ENOENT";
      if (!missing) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[TradersLinkAiReadCostLedger] Failed to load usage: ${message}`);
        this.accountingHealth = {
          healthy: false,
          corruptLineCount: 0,
          lastLoadError: message,
        };
      } else {
        this.accountingHealth = {
          healthy: true,
          corruptLineCount: 0,
          lastLoadError: null,
        };
      }
      return [];
    }
  }

  summarize(
    now = Date.now(),
    loadedEntries: TradersLinkAiReadCostLedgerEntry[] = this.load(),
  ): TradersLinkAiReadCostSummary {
    const entries = loadedEntries.filter((entry) => entry.generatedAt <= now);
    const todayKey = easternDateKey(now);
    const todayEntries = entries.filter((entry) => easternDateKey(entry.generatedAt) === todayKey);
    const grouped = <K extends string>(
      keyFor: (entry: TradersLinkAiReadCostLedgerEntry) => K,
      sourceEntries = entries,
    ) => {
      const map = new Map<K, TradersLinkAiReadCostLedgerEntry[]>();
      for (const entry of sourceEntries) {
        const key = keyFor(entry);
        map.set(key, [...(map.get(key) ?? []), entry]);
      }
      return map;
    };
    const summarizePerTicker = (sourceEntries: TradersLinkAiReadCostLedgerEntry[]) =>
      [...grouped((entry) => entry.symbol, sourceEntries).entries()].map(([symbol, tickerEntries]) => {
      const chronological = [...tickerEntries].sort((a, b) => a.generatedAt - b.generatedAt);
      const last = chronological.at(-1)!;
      const totals = totalsFor(tickerEntries);
      return {
        symbol,
        ...totals,
        planGenerationCount: planGenerationCountFor(chronological),
        averageCostPerRequestUsd: totals.requestCount > 0
          ? roundUsd(totals.estimatedTotalCostUsd / totals.requestCount)
          : 0,
        lastGeneratedAt: last.generatedAt,
        lastTrigger: last.trigger,
        lastEstimatedCostUsd: roundUsd(
          (last.usage.tokenCostUsd ?? 0) + last.usage.webSearchCostUsd,
        ),
      };
    }).sort((a, b) => b.estimatedTotalCostUsd - a.estimatedTotalCostUsd || a.symbol.localeCompare(b.symbol));
    const last7DaysEntries = entries.filter((entry) => entry.generatedAt >= now - 7 * DAY_MS);
    const last30DaysEntries = entries.filter((entry) => entry.generatedAt >= now - 30 * DAY_MS);
    const tickerWindows = {
      today: summarizePerTicker(todayEntries),
      last7Days: summarizePerTicker(last7DaysEntries),
      last30Days: summarizePerTicker(last30DaysEntries),
      allTime: summarizePerTicker(entries),
    };

    return {
      generatedAt: now,
      currency: "USD",
      estimateNotice:
        "Estimated from API token usage and actual web-search tool calls. OpenAI billing remains the invoice authority; unpriced requests are flagged.",
      accountingHealth: { ...this.accountingHealth },
      windows: {
        today: totalsFor(todayEntries),
        last7Days: totalsFor(last7DaysEntries),
        last30Days: totalsFor(last30DaysEntries),
        allTime: totalsFor(entries),
      },
      todayPerTicker: tickerWindows.today,
      perTicker: tickerWindows.allTime,
      tickerWindows,
      byTrigger: [...grouped((entry) => entry.trigger).entries()]
        .map(([trigger, triggerEntries]) => ({ trigger, totals: totalsFor(triggerEntries) }))
        .sort((a, b) => b.totals.estimatedTotalCostUsd - a.totals.estimatedTotalCostUsd),
      byModel: [...grouped((entry) => entry.model).entries()]
        .map(([model, modelEntries]) => ({ model, totals: totalsFor(modelEntries) }))
        .sort((a, b) => b.totals.estimatedTotalCostUsd - a.totals.estimatedTotalCostUsd),
      recentFailures: entries
        .filter((entry) => entry.status === "invalid_output" || entry.status === "transport_error")
        .sort((a, b) => b.generatedAt - a.generatedAt)
        .slice(0, 20)
        .map((entry) => ({
          symbol: entry.symbol,
          generatedAt: entry.generatedAt,
          dataAsOf: entry.dataAsOf,
          model: entry.model,
          trigger: entry.trigger,
          ...(entry.attemptType ? { attemptType: entry.attemptType } : {}),
          ...(entry.status ? { status: entry.status } : {}),
          ...(entry.error !== undefined ? { error: entry.error } : {}),
          ...(entry.failureStage ? { failureStage: entry.failureStage } : {}),
          ...(entry.rejectedDraft ? { rejectedDraft: entry.rejectedDraft } : {}),
          ...(entry.generationId ? { generationId: entry.generationId } : {}),
          ...(entry.requestId ? { requestId: entry.requestId } : {}),
        })),
    };
  }

  getDailyCostBudgetStatus(args: {
    enabled: boolean;
    dailyLimitUsd: number;
    now?: number;
  }, loadedEntries: TradersLinkAiReadCostLedgerEntry[] = this.load(),
  summary?: TradersLinkAiReadCostSummary): TradersLinkAiReadDailyCostBudgetStatus {
    const now = args.now ?? Date.now();
    const dailyLimitUsd = roundUsd(Math.max(0, args.dailyLimitUsd));
    const resolvedSummary = summary ?? this.summarize(now, loadedEntries);
    const spentUsd = resolvedSummary.windows.today.estimatedTotalCostUsd;
    const unpricedRequestCount = resolvedSummary.windows.today.unpricedRequestCount;
    const unpricedReserveUsd = roundUsd(unpricedRequestCount * UNPRICED_REQUEST_RESERVE_USD);
    const guardedSpendUsd = roundUsd(spentUsd + unpricedReserveUsd);
    const recentSuccessfulCosts = loadedEntries
      .filter((entry) =>
        entry.generatedAt <= now &&
        easternDateKey(entry.generatedAt) === easternDateKey(now) &&
        entry.status !== "publish_error" &&
        entry.usage.estimatedTotalCostUsd !== null,
      )
      .sort((left, right) => right.generatedAt - left.generatedAt)
      .slice(0, RECENT_REQUEST_RESERVE_SAMPLE_SIZE)
      .map((entry) => entry.usage.estimatedTotalCostUsd ?? 0)
      .filter((cost) => cost > 0);
    const projectedNextRequestUsd = roundUsd(
      recentSuccessfulCosts.length > 0
        ? Math.max(
            0.01,
            recentSuccessfulCosts.reduce((sum, cost) => sum + cost, 0) /
              recentSuccessfulCosts.length,
          )
        : DEFAULT_NEXT_REQUEST_RESERVE_USD,
    );
    const remainingUsd = roundUsd(Math.max(0, dailyLimitUsd - guardedSpendUsd));
    let blockReason: string | null = null;
    if (args.enabled && !resolvedSummary.accountingHealth.healthy) {
      blockReason = "Expense ledger is unhealthy, so the budget guard cannot safely estimate today's spend.";
    } else if (args.enabled && dailyLimitUsd <= 0) {
      blockReason = "A positive daily budget is required when the budget guard is enabled.";
    } else if (args.enabled && guardedSpendUsd + projectedNextRequestUsd > dailyLimitUsd) {
      blockReason = unpricedRequestCount > 0
        ? "Today's recorded spend plus the unpriced-request allowance and next-request reserve would exceed the daily budget."
        : "Today's recorded spend plus the next-request reserve would exceed the daily budget.";
    }
    return {
      enabled: args.enabled,
      dailyLimitUsd,
      spentUsd,
      guardedSpendUsd,
      unpricedRequestCount,
      unpricedReserveUsd,
      projectedNextRequestUsd,
      remainingUsd,
      canStartRequest: !args.enabled || blockReason === null,
      blockReason,
    };
  }
}
