import type { FormalStructureTimeframe } from "../structure/index.js";
import type {
  FormalMarketStructureRuntimeContext,
  RuntimeMarketStructureSnapshot,
  RuntimeMarketStructureTimeframeSnapshot,
  StableMarketStructureRuntimeContext,
} from "./monitoring-types.js";

export type MarketStructureStoryDecisionReason =
  | "pending_fresh_structure"
  | "current_material_structure"
  | "quiet_structure";

export type MarketStructureStoryDecision = {
  snapshot: RuntimeMarketStructureSnapshot | null;
  includeStory: boolean;
  reason: MarketStructureStoryDecisionReason;
  keys: string[];
};

export type MarketStructureStoryMemoryOptions = {
  pendingTtlMs?: number;
  postedWindowMs?: number;
};

export type ExpiredMarketStructureStory = {
  key: string;
  snapshot: RuntimeMarketStructureSnapshot;
  capturedAt: number;
  expiresAt: number;
  expiredAt: number;
};

type PendingStructureStory = {
  key: string;
  snapshot: RuntimeMarketStructureSnapshot;
  capturedAt: number;
  expiresAt: number;
};

type PostedStructureStory = {
  key: string;
  postedAt: number;
};

export type MarketStructureStoryMemorySnapshot = {
  version: 1;
  generatedAt: number;
  pending: Array<{
    symbol: string;
    key: string;
    snapshot: RuntimeMarketStructureSnapshot;
    capturedAt: number;
    expiresAt: number;
  }>;
  posted: Array<{
    symbol: string;
    key: string;
    postedAt: number;
  }>;
};

const DEFAULT_PENDING_TTL_MS = 60 * 60 * 1000;
const DEFAULT_POSTED_WINDOW_MS = 6 * 60 * 60 * 1000;

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function finiteTimestamp(timestamp: number): number {
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}

function isRuntimeMarketStructureSnapshot(value: unknown): value is RuntimeMarketStructureSnapshot {
  return Boolean(value && typeof value === "object");
}

function formatPriceKey(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "na";
  }

  if (value >= 10) {
    return value.toFixed(2);
  }
  if (value >= 1) {
    return value.toFixed(3);
  }
  return value.toFixed(4);
}

function fallbackFormalStructureKey(formal: FormalMarketStructureRuntimeContext): string {
  return [
    formal.eventType,
    formal.bias,
    formal.confirmation,
    formal.triggerTimestamp ?? "na",
    formatPriceKey(formal.brokenSwingPrice),
    formatPriceKey(formal.sweptSwingPrice),
    formatPriceKey(formal.protectedHigh),
    formatPriceKey(formal.protectedLow),
  ].join("|");
}

function formalStoryKey(
  timeframe: FormalStructureTimeframe,
  formal: FormalMarketStructureRuntimeContext | undefined,
): string | null {
  if (!formal || formal.eventType === "none") {
    return null;
  }

  if (formal.materialChange !== true || formal.eventFreshness !== "fresh") {
    return null;
  }

  return `${timeframe}|formal|${formal.structureKey || fallbackFormalStructureKey(formal)}`;
}

function stableStoryKey(
  timeframe: FormalStructureTimeframe,
  stable: StableMarketStructureRuntimeContext | undefined,
): string | null {
  if (!stable?.materialChange) {
    return null;
  }

  return `${timeframe}|stable|${stable.structureKey}`;
}

function isFreshFormalBosChoch(formal: FormalMarketStructureRuntimeContext | undefined): boolean {
  return (
    formal?.materialChange === true &&
    formal.eventFreshness === "fresh" &&
    (
      formal.eventType === "bos_bullish" ||
      formal.eventType === "bos_bearish" ||
      formal.eventType === "choch_bullish" ||
      formal.eventType === "choch_bearish"
    )
  );
}

function timeframePriority(timeframe: FormalStructureTimeframe): number {
  switch (timeframe) {
    case "daily":
      return 0;
    case "4h":
      return 1;
    case "5m":
      return 2;
    default:
      return 10;
  }
}

function storyKeyPriority(key: string): number {
  const [timeframe, storyType] = key.split("|", 2);
  const typeScore = storyType === "formal" ? 1_000 : 0;
  const timeframeScore =
    timeframe === "daily"
      ? 300
      : timeframe === "4h"
        ? 200
        : timeframe === "5m"
          ? 100
          : 0;
  return timeframeScore + typeScore;
}

function highestPriorityKey(keys: string[]): string | null {
  return keys.reduce<string | null>((best, key) => {
    if (best === null) {
      return key;
    }

    const keyPriority = storyKeyPriority(key);
    const bestPriority = storyKeyPriority(best);
    if (keyPriority !== bestPriority) {
      return keyPriority > bestPriority ? key : best;
    }
    return key < best ? key : best;
  }, null);
}

function getSnapshotTimeframeEntries(
  snapshot: RuntimeMarketStructureSnapshot,
): Array<{
  timeframe: FormalStructureTimeframe;
  context: RuntimeMarketStructureTimeframeSnapshot;
}> {
  const entries = Object.entries(snapshot.timeframes ?? {}) as Array<
    [FormalStructureTimeframe, RuntimeMarketStructureTimeframeSnapshot]
  >;

  if (!snapshot.timeframes?.["5m"] && (snapshot.stable || snapshot.formal)) {
    entries.push([
      "5m",
      {
        ...(snapshot.stable ? { stable: snapshot.stable } : {}),
        ...(snapshot.formal ? { formal: snapshot.formal } : {}),
      },
    ]);
  }

  return entries
    .filter(([, context]) => Boolean(context?.stable || context?.formal))
    .sort(([left], [right]) => timeframePriority(left) - timeframePriority(right))
    .map(([timeframe, context]) => ({ timeframe, context }));
}

export function getMaterialMarketStructureStoryKeys(
  snapshot: RuntimeMarketStructureSnapshot | null | undefined,
): string[] {
  if (!snapshot) {
    return [];
  }

  const keys: string[] = [];
  for (const { timeframe, context } of getSnapshotTimeframeEntries(snapshot)) {
    const formalKey = formalStoryKey(timeframe, context.formal);
    const stableKey = stableStoryKey(timeframe, context.stable);
    if (formalKey) {
      keys.push(formalKey);
    }
    if (stableKey) {
      keys.push(stableKey);
    }
  }

  return unique(keys);
}

export function getFreshFormalBosChochMarketStructureStoryKeys(
  snapshot: RuntimeMarketStructureSnapshot | null | undefined,
): string[] {
  if (!snapshot) {
    return [];
  }

  const keys: string[] = [];
  for (const { timeframe, context } of getSnapshotTimeframeEntries(snapshot)) {
    if (timeframe !== "4h" && timeframe !== "5m") {
      continue;
    }
    if (!isFreshFormalBosChoch(context.formal)) {
      continue;
    }

    const key = formalStoryKey(timeframe, context.formal);
    if (key) {
      keys.push(key);
    }
  }

  return unique(keys);
}

export class MarketStructureStoryMemory {
  private readonly pendingTtlMs: number;
  private readonly postedWindowMs: number;
  private readonly pendingBySymbol = new Map<string, PendingStructureStory[]>();
  private readonly postedBySymbol = new Map<string, PostedStructureStory[]>();

  constructor(options: MarketStructureStoryMemoryOptions = {}) {
    this.pendingTtlMs = options.pendingTtlMs ?? DEFAULT_PENDING_TTL_MS;
    this.postedWindowMs = options.postedWindowMs ?? DEFAULT_POSTED_WINDOW_MS;
  }

  capture(
    symbolInput: string,
    timestampInput: number,
    snapshot: RuntimeMarketStructureSnapshot | null | undefined,
  ): string[] {
    if (!snapshot) {
      return [];
    }

    const symbol = normalizeSymbol(symbolInput);
    const timestamp = finiteTimestamp(timestampInput);
    this.prune(symbol, timestamp);

    const keys = getMaterialMarketStructureStoryKeys(snapshot)
      .filter((key) => !this.wasPosted(symbol, key, timestamp));
    if (keys.length === 0) {
      return [];
    }

    const existing = this.pendingBySymbol.get(symbol) ?? [];
    const withoutDuplicates = existing.filter((entry) => !keys.includes(entry.key));
    const nextEntries = keys.map((key) => ({
      key,
      snapshot,
      capturedAt: timestamp,
      expiresAt: timestamp + this.pendingTtlMs,
    }));
    this.pendingBySymbol.set(symbol, [...withoutDuplicates, ...nextEntries]);
    return keys;
  }

  decide(
    symbolInput: string,
    timestampInput: number,
    currentSnapshot: RuntimeMarketStructureSnapshot | null | undefined,
  ): MarketStructureStoryDecision {
    const symbol = normalizeSymbol(symbolInput);
    const timestamp = finiteTimestamp(timestampInput);
    this.prune(symbol, timestamp);

    const pending = (this.pendingBySymbol.get(symbol) ?? [])
      .filter((entry) => !this.wasPosted(symbol, entry.key, timestamp));
    if (pending.length > 0) {
      const selected = pending.reduce((best, candidate) => {
        const candidatePriority = storyKeyPriority(candidate.key);
        const bestPriority = storyKeyPriority(best.key);
        if (candidatePriority !== bestPriority) {
          return candidatePriority > bestPriority ? candidate : best;
        }
        return candidate.capturedAt >= best.capturedAt ? candidate : best;
      });
      const pendingKeys = new Set(pending.map((entry) => entry.key));
      const selectedPriority = storyKeyPriority(selected.key);
      const selectedKeys = getMaterialMarketStructureStoryKeys(selected.snapshot)
        .filter((key) => pendingKeys.has(key) && storyKeyPriority(key) === selectedPriority);
      return {
        snapshot: selected.snapshot,
        includeStory: true,
        reason: "pending_fresh_structure",
        keys: selectedKeys.length > 0 ? selectedKeys : [selected.key],
      };
    }

    const currentKeys = getMaterialMarketStructureStoryKeys(currentSnapshot)
      .filter((key) => !this.wasPosted(symbol, key, timestamp));
    if (currentSnapshot && currentKeys.length > 0) {
      const priorityKey = highestPriorityKey(currentKeys);
      const selectedKeys = priorityKey
        ? getMaterialMarketStructureStoryKeys(currentSnapshot)
            .filter((key) => storyKeyPriority(key) === storyKeyPriority(priorityKey))
        : currentKeys;
      return {
        snapshot: currentSnapshot,
        includeStory: true,
        reason: "current_material_structure",
        keys: selectedKeys,
      };
    }

    return {
      snapshot: currentSnapshot ?? null,
      includeStory: false,
      reason: "quiet_structure",
      keys: [],
    };
  }

  markPosted(
    symbolInput: string,
    timestampInput: number,
    snapshot: RuntimeMarketStructureSnapshot | null | undefined,
    keysInput?: string[],
  ): string[] {
    const symbol = normalizeSymbol(symbolInput);
    const timestamp = finiteTimestamp(timestampInput);
    this.prune(symbol, timestamp);

    const keys = unique(
      keysInput && keysInput.length > 0
        ? keysInput
        : getMaterialMarketStructureStoryKeys(snapshot),
    );
    if (keys.length === 0) {
      return [];
    }

    const posted = this.postedBySymbol.get(symbol) ?? [];
    const dedupedPosted = posted.filter((entry) => !keys.includes(entry.key));
    this.postedBySymbol.set(symbol, [
      ...dedupedPosted,
      ...keys.map((key) => ({ key, postedAt: timestamp })),
    ]);

    const pending = this.pendingBySymbol.get(symbol) ?? [];
    this.pendingBySymbol.set(
      symbol,
      pending.filter((entry) => !keys.includes(entry.key)),
    );

    return keys;
  }

  consumeExpired(symbolInput: string, timestampInput: number): ExpiredMarketStructureStory[] {
    const symbol = normalizeSymbol(symbolInput);
    const timestamp = finiteTimestamp(timestampInput);
    return this.prune(symbol, timestamp);
  }

  clear(symbolInput: string): void {
    const symbol = normalizeSymbol(symbolInput);
    this.pendingBySymbol.delete(symbol);
    this.postedBySymbol.delete(symbol);
  }

  clearAll(): void {
    this.pendingBySymbol.clear();
    this.postedBySymbol.clear();
  }

  toSnapshot(timestampInput: number = Date.now()): MarketStructureStoryMemorySnapshot {
    const generatedAt = finiteTimestamp(timestampInput);
    const pending: MarketStructureStoryMemorySnapshot["pending"] = [];
    const posted: MarketStructureStoryMemorySnapshot["posted"] = [];

    for (const [symbol, entries] of this.pendingBySymbol.entries()) {
      for (const entry of entries) {
        pending.push({ symbol, ...entry });
      }
    }
    for (const [symbol, entries] of this.postedBySymbol.entries()) {
      for (const entry of entries) {
        posted.push({ symbol, ...entry });
      }
    }

    return {
      version: 1,
      generatedAt,
      pending,
      posted,
    };
  }

  hydrate(snapshot: unknown, timestampInput: number = Date.now()): void {
    if (!snapshot || typeof snapshot !== "object") {
      return;
    }

    const payload = snapshot as Partial<MarketStructureStoryMemorySnapshot>;
    if (payload.version !== 1) {
      return;
    }

    const timestamp = finiteTimestamp(timestampInput);
    this.pendingBySymbol.clear();
    this.postedBySymbol.clear();

    const postedCutoff = timestamp - this.postedWindowMs;
    for (const entry of Array.isArray(payload.posted) ? payload.posted : []) {
      const symbol = normalizeSymbol(entry.symbol);
      if (!symbol || typeof entry.key !== "string" || !Number.isFinite(entry.postedAt)) {
        continue;
      }
      if (entry.postedAt < postedCutoff) {
        continue;
      }

      this.postedBySymbol.set(symbol, [
        ...(this.postedBySymbol.get(symbol) ?? []),
        {
          key: entry.key,
          postedAt: entry.postedAt,
        },
      ]);
    }

    for (const entry of Array.isArray(payload.pending) ? payload.pending : []) {
      const symbol = normalizeSymbol(entry.symbol);
      if (
        !symbol ||
        typeof entry.key !== "string" ||
        !Number.isFinite(entry.capturedAt) ||
        !Number.isFinite(entry.expiresAt) ||
        !isRuntimeMarketStructureSnapshot(entry.snapshot)
      ) {
        continue;
      }
      if (entry.expiresAt < timestamp || this.wasPosted(symbol, entry.key, timestamp)) {
        continue;
      }

      this.pendingBySymbol.set(symbol, [
        ...(this.pendingBySymbol.get(symbol) ?? []),
        {
          key: entry.key,
          snapshot: entry.snapshot,
          capturedAt: entry.capturedAt,
          expiresAt: entry.expiresAt,
        },
      ]);
    }
  }

  private prune(symbol: string, timestamp: number): ExpiredMarketStructureStory[] {
    const postedCutoff = timestamp - this.postedWindowMs;
    const posted = this.postedBySymbol.get(symbol) ?? [];
    this.postedBySymbol.set(
      symbol,
      posted.filter((entry) => entry.postedAt >= postedCutoff),
    );

    const pending = this.pendingBySymbol.get(symbol) ?? [];
    const expired: ExpiredMarketStructureStory[] = [];
    this.pendingBySymbol.set(
      symbol,
      pending.filter((entry) => {
        const postedAlready = this.wasPosted(symbol, entry.key, timestamp);
        if (!postedAlready && entry.expiresAt < timestamp) {
          expired.push({
            key: entry.key,
            snapshot: entry.snapshot,
            capturedAt: entry.capturedAt,
            expiresAt: entry.expiresAt,
            expiredAt: timestamp,
          });
        }

        return entry.expiresAt >= timestamp && !postedAlready;
      }),
    );
    return expired;
  }

  private wasPosted(symbol: string, key: string, timestamp: number): boolean {
    const postedCutoff = timestamp - this.postedWindowMs;
    return (this.postedBySymbol.get(symbol) ?? [])
      .some((entry) => entry.key === key && entry.postedAt >= postedCutoff);
  }
}
