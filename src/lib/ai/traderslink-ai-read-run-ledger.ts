import type { WatchlistReasoningEffort } from "./watchlist-model-options.js";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type TradersLinkAiReadRunStage =
  | "activation"
  | "dispatch"
  | "preflight"
  | "boundary"
  | "preparation"
  | "request"
  | "attempt"
  | "validation"
  | "publishing"
  | "startup"
  | "unhandled";

export type TradersLinkAiReadRunOutcome =
  | "expected"
  | "started"
  | "request_started"
  | "success"
  | "published"
  | "failed"
  | "skipped"
  | "deferred"
  | "not_needed"
  | "missing";

export type TradersLinkAiReadRunEvent = {
  version: 1;
  eventId: string;
  occurredAt: number;
  symbol: string;
  trigger: string;
  stage: TradersLinkAiReadRunStage;
  outcome: TradersLinkAiReadRunOutcome;
  runId?: string;
  generationId?: string;
  requestId?: string;
  clientRequestId?: string;
  attemptType?: "primary" | "correction" | "fallback" | "publication";
  model?: string;
  reasoningEffort?: WatchlistReasoningEffort;
  marketSession?: string;
  dataAsOf?: number;
  startedAt?: number;
  receivedAt?: number;
  durationMs?: number;
  status?: string;
  failureStage?: string;
  estimatedCostUsd?: number | null;
  reason?: string;
  dedupeKey?: string;
};

export type TradersLinkAiReadRunLedgerOptions = {
  filePath?: string;
};

export type TradersLinkAiReadAuditSummary = {
  eventCount: number;
  byOutcome: Record<string, number>;
  byStage: Record<string, number>;
  bySymbol: Array<{ symbol: string; eventCount: number; lastOutcome: string; lastOccurredAt: number }>;
};

const DEFAULT_RUN_LEDGER_FILE = resolve(
  process.cwd(),
  "artifacts",
  "traderslink-ai-read-run-events.jsonl",
);

const boundaryDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
});

function parseLines(raw: string): TradersLinkAiReadRunEvent[] {
  const events: TradersLinkAiReadRunEvent[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line) as Partial<TradersLinkAiReadRunEvent>;
      if (
        value.version !== 1 ||
        typeof value.eventId !== "string" ||
        typeof value.occurredAt !== "number" ||
        typeof value.symbol !== "string" ||
        typeof value.trigger !== "string" ||
        typeof value.stage !== "string" ||
        typeof value.outcome !== "string"
      ) {
        continue;
      }
      events.push(value as TradersLinkAiReadRunEvent);
    } catch {
      // A partially written line should not prevent the admin audit from loading.
    }
  }
  return events;
}

export class TradersLinkAiReadRunLedger {
  readonly filePath: string;
  private readonly dedupeKeys = new Set<string>();
  private readonly boundaryRequests = new Map<string, Set<string>>();

  private indexBoundaryRequest(event: TradersLinkAiReadRunEvent): void {
    if (event.trigger !== "boundary_cross" || !event.generationId || !Number.isFinite(event.occurredAt) ||
      !["request", "attempt", "publishing"].includes(event.stage)) return;
    const date = boundaryDateFormatter.format(new Date(event.occurredAt));
    const key = `${event.symbol}:${date}`;
    const ids = this.boundaryRequests.get(key) ?? new Set<string>();
    ids.add(event.generationId);
    this.boundaryRequests.set(key, ids);
  }

  getAutomaticBoundaryRefreshCount(symbol: string, dateKey: string | null): number {
    if (!dateKey) return 0;
    return this.boundaryRequests.get(`${symbol}:${dateKey}`)?.size ?? 0;
  }

  constructor(options: TradersLinkAiReadRunLedgerOptions = {}) {
    this.filePath = options.filePath ?? DEFAULT_RUN_LEDGER_FILE;
    try {
      for (const event of parseLines(readFileSync(this.filePath, "utf8"))) {
        if (event.dedupeKey) this.dedupeKeys.add(event.dedupeKey);
        this.indexBoundaryRequest(event);
      }
    } catch {
      // The file is created on the first event.
    }
  }

  record(
    event: Omit<TradersLinkAiReadRunEvent, "version" | "eventId" | "occurredAt"> & {
      occurredAt?: number;
    },
  ): TradersLinkAiReadRunEvent | null {
    if (event.dedupeKey && this.dedupeKeys.has(event.dedupeKey)) {
      return null;
    }
    const recorded: TradersLinkAiReadRunEvent = {
      version: 1,
      eventId: `${event.symbol}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      occurredAt: event.occurredAt ?? Date.now(),
      ...event,
    };
    mkdirSync(dirname(this.filePath), { recursive: true });
    appendFileSync(this.filePath, `${JSON.stringify(recorded)}\n`, "utf8");
    this.indexBoundaryRequest(recorded);
    if (recorded.dedupeKey) this.dedupeKeys.add(recorded.dedupeKey);
    return recorded;
  }

  load(): TradersLinkAiReadRunEvent[] {
    try {
      return parseLines(readFileSync(this.filePath, "utf8"))
        .sort((left, right) => right.occurredAt - left.occurredAt);
    } catch {
      return [];
    }
  }

  recent(options: { symbol?: string; limit?: number } = {}): TradersLinkAiReadRunEvent[] {
    const symbol = options.symbol?.trim().toUpperCase();
    const limit = Math.min(500, Math.max(1, Math.floor(options.limit ?? 100)));
    return this.load()
      .filter((event) => !symbol || event.symbol === symbol)
      .slice(0, limit);
  }

  summarize(events = this.load()): TradersLinkAiReadAuditSummary {
    const byOutcome: Record<string, number> = {};
    const byStage: Record<string, number> = {};
    const bySymbol = new Map<string, { eventCount: number; lastOutcome: string; lastOccurredAt: number }>();
    for (const event of events) {
      byOutcome[event.outcome] = (byOutcome[event.outcome] ?? 0) + 1;
      byStage[event.stage] = (byStage[event.stage] ?? 0) + 1;
      const existing = bySymbol.get(event.symbol);
      if (!existing) {
        bySymbol.set(event.symbol, {
          eventCount: 1,
          lastOutcome: event.outcome,
          lastOccurredAt: event.occurredAt,
        });
      } else {
        existing.eventCount += 1;
        if (event.occurredAt > existing.lastOccurredAt) {
          existing.lastOutcome = event.outcome;
          existing.lastOccurredAt = event.occurredAt;
        }
      }
    }
    return {
      eventCount: events.length,
      byOutcome,
      byStage,
      bySymbol: [...bySymbol.entries()]
        .map(([symbol, summary]) => ({ symbol, ...summary }))
        .sort((left, right) => right.lastOccurredAt - left.lastOccurredAt),
    };
  }
}
