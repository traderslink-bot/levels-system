import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type {
  LiveWatchlistCardPatch,
  LiveWatchlistHealthPatch,
  LiveWatchlistPublisher,
  LiveWatchlistTickerDataPatch,
} from "./live-watchlist-types.js";

type PublishPayload =
  | LiveWatchlistCardPatch
  | LiveWatchlistHealthPatch
  | LiveWatchlistTickerDataPatch;

type OutboxEntry = {
  id: string;
  queuedAt: number;
  payload: PublishPayload;
};

export const DEFAULT_LIVE_WATCHLIST_PUBLISH_OUTBOX_FILE = resolve(
  process.cwd(),
  "artifacts",
  "live-watchlist-publish-outbox.json",
);

function isPayload(value: unknown): value is PublishPayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.type === "health") return typeof candidate.marketDataStatus === "string";
  if (candidate.type === "tickerData") return typeof candidate.symbol === "string";
  return typeof candidate.symbol === "string" && typeof candidate.cards === "object";
}

function parseEntries(raw: string): OutboxEntry[] {
  const value = JSON.parse(raw) as unknown;
  if (!Array.isArray(value)) throw new Error("Live watchlist publish outbox is not an array.");
  return value.map((item) => {
    const candidate = item as Partial<OutboxEntry>;
    if (
      typeof candidate.id !== "string" ||
      typeof candidate.queuedAt !== "number" ||
      !isPayload(candidate.payload)
    ) {
      throw new Error("Live watchlist publish outbox contains an invalid entry.");
    }
    return candidate as OutboxEntry;
  });
}

export class DurableLiveWatchlistPublisher implements LiveWatchlistPublisher {
  private operationQueue: Promise<void> = Promise.resolve();
  private sequence = 0;

  constructor(
    private readonly delegate: LiveWatchlistPublisher,
    private readonly filePath = DEFAULT_LIVE_WATCHLIST_PUBLISH_OUTBOX_FILE,
  ) {}

  publish(patch: LiveWatchlistCardPatch): Promise<void> {
    return this.enqueue(patch);
  }

  publishHealth(patch: LiveWatchlistHealthPatch): Promise<void> {
    return this.enqueue(patch);
  }

  publishTickerData(patch: LiveWatchlistTickerDataPatch): Promise<void> {
    return this.enqueue(patch);
  }

  replayPending(): Promise<void> {
    return this.serialize(() => this.flush());
  }

  pendingCount(): number {
    return this.load().length;
  }

  private enqueue(payload: PublishPayload): Promise<void> {
    return this.serialize(async () => {
      const entries = this.load();
      const now = Date.now();
      entries.push({
        id: `${now}-${process.pid}-${++this.sequence}`,
        queuedAt: now,
        payload,
      });
      this.save(entries);
      await this.flush(entries);
    });
  }

  private serialize(operation: () => Promise<void>): Promise<void> {
    const task = this.operationQueue.catch(() => undefined).then(operation);
    this.operationQueue = task;
    return task;
  }

  private async flush(initialEntries?: OutboxEntry[]): Promise<void> {
    const entries = initialEntries ?? this.load();
    while (entries.length > 0) {
      const next = entries[0]!;
      await this.publishPayload(next.payload);
      entries.shift();
      this.save(entries);
    }
  }

  private async publishPayload(payload: PublishPayload): Promise<void> {
    if ("type" in payload && payload.type === "health") {
      if (!this.delegate.publishHealth) throw new Error("Health publisher is unavailable.");
      await this.delegate.publishHealth(payload);
      return;
    }
    if ("type" in payload && payload.type === "tickerData") {
      if (!this.delegate.publishTickerData) throw new Error("Ticker-data publisher is unavailable.");
      await this.delegate.publishTickerData(payload);
      return;
    }
    await this.delegate.publish(payload);
  }

  private load(): OutboxEntry[] {
    try {
      return parseEntries(readFileSync(this.filePath, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
      throw error;
    }
  }

  private save(entries: OutboxEntry[]): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
    renameSync(temporaryPath, this.filePath);
  }
}
