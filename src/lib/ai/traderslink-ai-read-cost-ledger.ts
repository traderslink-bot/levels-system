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
  attemptType?: TradersLinkAiReadAttempt["attemptType"] | "publication";
  status?: TradersLinkAiReadAttempt["status"] | "publish_error";
  receivedAt?: number;
  error?: string | null;
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
  averageCostPerRequestUsd: number;
  lastGeneratedAt: number;
  lastTrigger: TradersLinkAiReadCostTrigger;
  lastEstimatedCostUsd: number;
};

export type TradersLinkAiReadCostSummary = {
  generatedAt: number;
  currency: "USD";
  estimateNotice: string;
  windows: {
    today: TradersLinkAiReadCostTotals;
    last7Days: TradersLinkAiReadCostTotals;
    last30Days: TradersLinkAiReadCostTotals;
    allTime: TradersLinkAiReadCostTotals;
  };
  perTicker: TradersLinkAiReadTickerCostSummary[];
  byTrigger: Array<{ trigger: TradersLinkAiReadCostTrigger; totals: TradersLinkAiReadCostTotals }>;
  byModel: Array<{ model: string; totals: TradersLinkAiReadCostTotals }>;
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
      attemptType: args.attempt.attemptType,
      status: args.attempt.status,
      receivedAt: args.attempt.receivedAt,
      error: args.attempt.error,
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
    try {
      const raw = readFileSync(this.filePath, "utf8");
      return raw
        .split(/\r?\n/)
        .filter(Boolean)
        .flatMap((line) => {
          try {
            const parsed = JSON.parse(line) as unknown;
            return isEntry(parsed) ? [parsed] : [];
          } catch {
            return [];
          }
        });
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[TradersLinkAiReadCostLedger] Failed to load usage: ${message}`);
      }
      return [];
    }
  }

  summarize(now = Date.now()): TradersLinkAiReadCostSummary {
    const entries = this.load().filter((entry) => entry.generatedAt <= now);
    const todayKey = easternDateKey(now);
    const grouped = <K extends string>(keyFor: (entry: TradersLinkAiReadCostLedgerEntry) => K) => {
      const map = new Map<K, TradersLinkAiReadCostLedgerEntry[]>();
      for (const entry of entries) {
        const key = keyFor(entry);
        map.set(key, [...(map.get(key) ?? []), entry]);
      }
      return map;
    };
    const byTicker = grouped((entry) => entry.symbol);
    const perTicker = [...byTicker.entries()].map(([symbol, tickerEntries]) => {
      const chronological = [...tickerEntries].sort((a, b) => a.generatedAt - b.generatedAt);
      const last = chronological.at(-1)!;
      const totals = totalsFor(tickerEntries);
      return {
        symbol,
        ...totals,
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

    return {
      generatedAt: now,
      currency: "USD",
      estimateNotice:
        "Estimated from API token usage and actual web-search tool calls. OpenAI billing remains the invoice authority; unpriced requests are flagged.",
      windows: {
        today: totalsFor(entries.filter((entry) => easternDateKey(entry.generatedAt) === todayKey)),
        last7Days: totalsFor(entries.filter((entry) => entry.generatedAt >= now - 7 * DAY_MS)),
        last30Days: totalsFor(entries.filter((entry) => entry.generatedAt >= now - 30 * DAY_MS)),
        allTime: totalsFor(entries),
      },
      perTicker,
      byTrigger: [...grouped((entry) => entry.trigger).entries()]
        .map(([trigger, triggerEntries]) => ({ trigger, totals: totalsFor(triggerEntries) }))
        .sort((a, b) => b.totals.estimatedTotalCostUsd - a.totals.estimatedTotalCostUsd),
      byModel: [...grouped((entry) => entry.model).entries()]
        .map(([model, modelEntries]) => ({ model, totals: totalsFor(modelEntries) }))
        .sort((a, b) => b.totals.estimatedTotalCostUsd - a.totals.estimatedTotalCostUsd),
    };
  }
}
