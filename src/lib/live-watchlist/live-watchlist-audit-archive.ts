import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  writeFileAtomically,
  writeFileAtomicallySync,
} from "../persistence/atomic-file-write.js";

import type {
  LiveWatchlistCardContent,
  LiveWatchlistCardPatch,
  LiveWatchlistExtendedQuote,
  LiveWatchlistHealthPatch,
  LiveWatchlistLevelMap,
  LiveWatchlistMarketDataStatus,
  LiveWatchlistPublishedPatch,
  LiveWatchlistPublisher,
  LiveWatchlistStatus,
  LiveWatchlistTickerDataPatch,
} from "./live-watchlist-types.js";

export const DEFAULT_LIVE_WATCHLIST_AUDIT_ARCHIVE_FILE = resolve(
  process.cwd(),
  "artifacts",
  "live-watchlist-level-quality-archive.json",
);

export type LiveWatchlistAuditArchiveSymbol = {
  symbol: string;
  status?: LiveWatchlistStatus | string;
  updatedAt?: number;
  firstSeenAt: number;
  lastSeenAt: number;
  archivedAt: number;
  firstPostedAt?: number | null;
  companyName?: string | null;
  latestPrice?: number | null;
  nearestSupport?: number | null;
  nearestResistance?: number | null;
  nearestSupportLabel?: string | null;
  nearestResistanceLabel?: string | null;
  latestTraderReadHeadline?: string | null;
  levelMap?: LiveWatchlistLevelMap | null;
  cards?: Partial<Record<string, LiveWatchlistCardContent | null>>;
  volume?: number | null;
  extendedQuote?: LiveWatchlistExtendedQuote | null;
  priorRegularClosePrice?: number | null;
  moveFromPriorRegularClosePct?: number | null;
  priorRegularCloseSource?: string | null;
};

export type LiveWatchlistAuditArchive = {
  version: 1;
  updatedAt: number;
  marketDataStatus?: LiveWatchlistMarketDataStatus | string;
  marketDataUpdatedAt?: number | null;
  symbols: LiveWatchlistAuditArchiveSymbol[];
};

export type LiveWatchlistAuditArchivePayloadSymbol =
  Partial<LiveWatchlistAuditArchiveSymbol> & { symbol: string };

export type LiveWatchlistAuditArchivePayload = {
  generatedAt?: number;
  marketDataStatus?: LiveWatchlistMarketDataStatus | string;
  marketDataUpdatedAt?: number | null;
  symbols: LiveWatchlistAuditArchivePayloadSymbol[];
};

type LiveWatchlistPatch =
  | LiveWatchlistCardPatch
  | LiveWatchlistHealthPatch
  | LiveWatchlistTickerDataPatch;

function normalizeSymbol(symbol: string | undefined): string {
  return symbol?.trim().toUpperCase() || "UNKNOWN";
}

function finiteTimestamp(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function emptyArchive(now = 0): LiveWatchlistAuditArchive {
  return {
    version: 1,
    updatedAt: now,
    symbols: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeCards(value: unknown): Partial<Record<string, LiveWatchlistCardContent | null>> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const cards: Partial<Record<string, LiveWatchlistCardContent | null>> = {};
  for (const [key, card] of Object.entries(value)) {
    cards[key] = card === null || isRecord(card) ? cloneJson(card as LiveWatchlistCardContent | null) : null;
  }
  return cards;
}

function normalizeArchiveSymbol(value: unknown, now: number): LiveWatchlistAuditArchiveSymbol | null {
  if (!isRecord(value) || typeof value.symbol !== "string") {
    return null;
  }
  const symbol = normalizeSymbol(value.symbol);
  if (symbol === "UNKNOWN") {
    return null;
  }
  const lastSeenAt = finiteTimestamp(value.lastSeenAt) ?? finiteTimestamp(value.updatedAt) ?? now;
  return {
    symbol,
    ...(typeof value.status === "string" ? { status: value.status } : {}),
    ...(finiteTimestamp(value.updatedAt) !== null ? { updatedAt: finiteTimestamp(value.updatedAt)! } : {}),
    firstSeenAt: finiteTimestamp(value.firstSeenAt) ?? lastSeenAt,
    lastSeenAt,
    archivedAt: finiteTimestamp(value.archivedAt) ?? now,
    ...(value.firstPostedAt === null || finiteTimestamp(value.firstPostedAt) !== null
      ? { firstPostedAt: value.firstPostedAt === null ? null : finiteTimestamp(value.firstPostedAt)! }
      : {}),
    ...(typeof value.companyName === "string" || value.companyName === null
      ? { companyName: value.companyName }
      : {}),
    ...(finiteTimestamp(value.latestPrice) !== null || value.latestPrice === null
      ? { latestPrice: value.latestPrice === null ? null : finiteTimestamp(value.latestPrice)! }
      : {}),
    ...(finiteTimestamp(value.nearestSupport) !== null || value.nearestSupport === null
      ? { nearestSupport: value.nearestSupport === null ? null : finiteTimestamp(value.nearestSupport)! }
      : {}),
    ...(finiteTimestamp(value.nearestResistance) !== null || value.nearestResistance === null
      ? { nearestResistance: value.nearestResistance === null ? null : finiteTimestamp(value.nearestResistance)! }
      : {}),
    ...(typeof value.nearestSupportLabel === "string" || value.nearestSupportLabel === null
      ? { nearestSupportLabel: value.nearestSupportLabel }
      : {}),
    ...(typeof value.nearestResistanceLabel === "string" || value.nearestResistanceLabel === null
      ? { nearestResistanceLabel: value.nearestResistanceLabel }
      : {}),
    ...(typeof value.latestTraderReadHeadline === "string" || value.latestTraderReadHeadline === null
      ? { latestTraderReadHeadline: value.latestTraderReadHeadline }
      : {}),
    ...("levelMap" in value ? { levelMap: cloneJson(value.levelMap as LiveWatchlistLevelMap | null) } : {}),
    ...(normalizeCards(value.cards) ? { cards: normalizeCards(value.cards) } : {}),
    ...(finiteTimestamp(value.volume) !== null || value.volume === null
      ? { volume: value.volume === null ? null : finiteTimestamp(value.volume)! }
      : {}),
    ...("extendedQuote" in value ? { extendedQuote: cloneJson(value.extendedQuote as LiveWatchlistExtendedQuote | null) } : {}),
    ...(finiteTimestamp(value.priorRegularClosePrice) !== null || value.priorRegularClosePrice === null
      ? {
          priorRegularClosePrice:
            value.priorRegularClosePrice === null ? null : finiteTimestamp(value.priorRegularClosePrice)!,
        }
      : {}),
    ...(finiteTimestamp(value.moveFromPriorRegularClosePct) !== null || value.moveFromPriorRegularClosePct === null
      ? {
          moveFromPriorRegularClosePct:
            value.moveFromPriorRegularClosePct === null ? null : finiteTimestamp(value.moveFromPriorRegularClosePct)!,
        }
      : {}),
    ...(typeof value.priorRegularCloseSource === "string" || value.priorRegularCloseSource === null
      ? { priorRegularCloseSource: value.priorRegularCloseSource }
      : {}),
  };
}

function normalizeArchive(value: unknown, now: number): LiveWatchlistAuditArchive | null {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.symbols)) {
    return null;
  }
  const symbols = value.symbols
    .map((symbol) => normalizeArchiveSymbol(symbol, now))
    .filter((symbol): symbol is LiveWatchlistAuditArchiveSymbol => Boolean(symbol));
  return {
    version: 1,
    updatedAt: finiteTimestamp(value.updatedAt) ?? now,
    ...(typeof value.marketDataStatus === "string" ? { marketDataStatus: value.marketDataStatus } : {}),
    ...(finiteTimestamp(value.marketDataUpdatedAt) !== null || value.marketDataUpdatedAt === null
      ? {
          marketDataUpdatedAt:
            value.marketDataUpdatedAt === null ? null : finiteTimestamp(value.marketDataUpdatedAt)!,
        }
      : {}),
    symbols,
  };
}

function symbolMap(archive: LiveWatchlistAuditArchive): Map<string, LiveWatchlistAuditArchiveSymbol> {
  return new Map(archive.symbols.map((symbol) => [symbol.symbol, cloneJson(symbol)]));
}

function sortArchiveSymbols(symbols: LiveWatchlistAuditArchiveSymbol[]): LiveWatchlistAuditArchiveSymbol[] {
  return [...symbols].sort((left, right) => {
    const activeDiff = Number(right.status === "live") - Number(left.status === "live");
    if (activeDiff !== 0) return activeDiff;
    return right.lastSeenAt - left.lastSeenAt || left.symbol.localeCompare(right.symbol);
  });
}

function upsertArchivedSymbol(
  archive: LiveWatchlistAuditArchive,
  symbolUpdate: Partial<LiveWatchlistAuditArchiveSymbol> & { symbol: string },
  now: number,
): LiveWatchlistAuditArchive {
  const symbol = normalizeSymbol(symbolUpdate.symbol);
  const map = symbolMap(archive);
  const existing = map.get(symbol);
  const updateTimestamp = finiteTimestamp(symbolUpdate.updatedAt) ?? finiteTimestamp(symbolUpdate.lastSeenAt) ?? now;
  const merged: LiveWatchlistAuditArchiveSymbol = {
    ...(existing ?? {
      symbol,
      firstSeenAt: updateTimestamp,
      lastSeenAt: updateTimestamp,
      archivedAt: now,
    }),
    ...cloneJson(symbolUpdate),
    symbol,
    firstSeenAt: existing?.firstSeenAt ?? finiteTimestamp(symbolUpdate.firstSeenAt) ?? updateTimestamp,
    lastSeenAt: Math.max(existing?.lastSeenAt ?? 0, finiteTimestamp(symbolUpdate.lastSeenAt) ?? updateTimestamp),
    archivedAt: now,
  };

  if (symbolUpdate.cards) {
    merged.cards = {
      ...(existing?.cards ?? {}),
      ...cloneJson(symbolUpdate.cards),
    };
  }

  map.set(symbol, merged);
  return {
    ...archive,
    updatedAt: now,
    symbols: sortArchiveSymbols([...map.values()]),
  };
}

function applyHealthPatch(
  archive: LiveWatchlistAuditArchive,
  patch: LiveWatchlistHealthPatch,
  now: number,
): LiveWatchlistAuditArchive {
  return {
    ...archive,
    updatedAt: now,
    marketDataStatus: patch.marketDataStatus,
    marketDataUpdatedAt: patch.marketDataUpdatedAt,
  };
}

function applyCardPatch(
  archive: LiveWatchlistAuditArchive,
  patch: LiveWatchlistCardPatch,
  now: number,
): LiveWatchlistAuditArchive {
  const levelMap = "levelMap" in patch ? cloneJson(patch.levelMap ?? null) : undefined;
  const update: Partial<LiveWatchlistAuditArchiveSymbol> & { symbol: string } = {
    symbol: patch.symbol,
    status: patch.status,
    updatedAt: patch.updatedAt,
    lastSeenAt: patch.updatedAt,
    ...(patch.firstPostedAt !== undefined ? { firstPostedAt: patch.firstPostedAt } : {}),
    ...(levelMap !== undefined ? { levelMap } : {}),
    ...(levelMap
      ? {
          latestPrice: levelMap.currentPrice,
          nearestSupport: levelMap.nearestSupport?.price ?? null,
          nearestResistance: levelMap.nearestResistance?.price ?? null,
          nearestSupportLabel: levelMap.nearestSupport?.label ?? null,
          nearestResistanceLabel: levelMap.nearestResistance?.label ?? null,
        }
      : {}),
    cards: cloneJson(patch.cards ?? {}),
  };
  if (patch.cards.liveTraderRead?.metadata?.headline !== undefined) {
    update.latestTraderReadHeadline = String(patch.cards.liveTraderRead.metadata.headline);
  }
  if (patch.cards.companyInfo?.metadata?.company !== undefined) {
    update.companyName =
      patch.cards.companyInfo.metadata.company === null
        ? null
        : String(patch.cards.companyInfo.metadata.company);
  }
  return upsertArchivedSymbol(archive, update, now);
}

function applyTickerDataPatch(
  archive: LiveWatchlistAuditArchive,
  patch: LiveWatchlistTickerDataPatch,
  now: number,
): LiveWatchlistAuditArchive {
  return upsertArchivedSymbol(archive, {
    symbol: patch.symbol,
    status: patch.status,
    updatedAt: patch.updatedAt,
    lastSeenAt: patch.updatedAt,
    latestPrice: patch.latestPrice,
    nearestSupport: patch.nearestSupport,
    nearestResistance: patch.nearestResistance,
    nearestSupportLabel: patch.nearestSupportLabel,
    nearestResistanceLabel: patch.nearestResistanceLabel,
    ...("levelMap" in patch ? { levelMap: cloneJson(patch.levelMap ?? null) } : {}),
    ...(patch.volume !== undefined ? { volume: patch.volume } : {}),
    ...(patch.extendedQuote !== undefined ? { extendedQuote: cloneJson(patch.extendedQuote) } : {}),
    ...(patch.priorRegularClosePrice !== undefined
      ? { priorRegularClosePrice: patch.priorRegularClosePrice }
      : {}),
    ...(patch.moveFromPriorRegularClosePct !== undefined
      ? { moveFromPriorRegularClosePct: patch.moveFromPriorRegularClosePct }
      : {}),
    ...(patch.priorRegularCloseSource !== undefined
      ? { priorRegularCloseSource: patch.priorRegularCloseSource }
      : {}),
  }, now);
}

export function applyLiveWatchlistPatchToArchive(
  archive: LiveWatchlistAuditArchive,
  patch: LiveWatchlistPatch,
  now = Date.now(),
): LiveWatchlistAuditArchive {
  if ("type" in patch && patch.type === "health") {
    return applyHealthPatch(archive, patch, now);
  }
  if ("type" in patch && patch.type === "tickerData") {
    return applyTickerDataPatch(archive, patch, now);
  }
  return applyCardPatch(archive, patch, now);
}

export function mergeLiveWatchlistPayloadWithArchive<T extends LiveWatchlistAuditArchivePayload>(
  payload: T,
  archive: LiveWatchlistAuditArchive,
): T {
  const now = finiteTimestamp(payload.generatedAt) ?? Date.now();
  const merged = new Map<string, LiveWatchlistAuditArchiveSymbol>();
  for (const archivedSymbol of archive.symbols) {
    merged.set(archivedSymbol.symbol, cloneJson(archivedSymbol));
  }
  for (const symbol of payload.symbols) {
    const normalizedSymbol = normalizeArchiveSymbol({
      ...symbol,
      symbol: normalizeSymbol(symbol.symbol),
      firstSeenAt: finiteTimestamp(symbol.firstSeenAt) ?? finiteTimestamp(symbol.updatedAt) ?? now,
      lastSeenAt: finiteTimestamp(symbol.lastSeenAt) ?? finiteTimestamp(symbol.updatedAt) ?? now,
      archivedAt: finiteTimestamp(symbol.archivedAt) ?? now,
    }, now);
    if (normalizedSymbol) {
      merged.set(normalizedSymbol.symbol, normalizedSymbol);
    }
  }

  return {
    ...payload,
    marketDataStatus: payload.marketDataStatus ?? archive.marketDataStatus,
    marketDataUpdatedAt: payload.marketDataUpdatedAt ?? archive.marketDataUpdatedAt,
    symbols: sortArchiveSymbols([...merged.values()]),
  };
}

export function payloadFromLiveWatchlistArchive(
  archive: LiveWatchlistAuditArchive,
): LiveWatchlistAuditArchivePayload {
  return {
    generatedAt: archive.updatedAt,
    marketDataStatus: archive.marketDataStatus,
    marketDataUpdatedAt: archive.marketDataUpdatedAt,
    symbols: sortArchiveSymbols(archive.symbols),
  };
}

export class LiveWatchlistAuditArchivePersistence {
  constructor(private readonly filePath = DEFAULT_LIVE_WATCHLIST_AUDIT_ARCHIVE_FILE) {}

  getFilePath(): string {
    return this.filePath;
  }

  load(): LiveWatchlistAuditArchive {
    if (!existsSync(this.filePath)) {
      return emptyArchive();
    }
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8").replace(/^\uFEFF/, "")) as unknown;
      return normalizeArchive(parsed, Date.now()) ?? emptyArchive();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[LiveWatchlistAuditArchive] Failed to load ${this.filePath}: ${message}`);
      return emptyArchive();
    }
  }

  async loadAsync(): Promise<LiveWatchlistAuditArchive> {
    try {
      const parsed = JSON.parse((await readFile(this.filePath, "utf8")).replace(/^\uFEFF/, "")) as unknown;
      return normalizeArchive(parsed, Date.now()) ?? emptyArchive();
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
        return emptyArchive();
      }
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[LiveWatchlistAuditArchive] Failed to load ${this.filePath}: ${message}`);
      return emptyArchive();
    }
  }

  save(archive: LiveWatchlistAuditArchive): void {
    writeFileAtomicallySync(this.filePath, `${JSON.stringify(archive)}\n`);
  }

  async saveAsync(archive: LiveWatchlistAuditArchive): Promise<void> {
    await writeFileAtomically(this.filePath, `${JSON.stringify(archive)}\n`);
  }

  recordPatch(patch: LiveWatchlistPatch, now = Date.now()): LiveWatchlistAuditArchive {
    const archive = applyLiveWatchlistPatchToArchive(this.load(), patch, now);
    this.save(archive);
    return archive;
  }

  recordPatches(
    patches: LiveWatchlistPatch[],
    now = Date.now(),
  ): LiveWatchlistAuditArchive {
    let archive = this.load();
    for (const patch of patches) {
      archive = applyLiveWatchlistPatchToArchive(archive, patch, now);
    }
    this.save(archive);
    return archive;
  }

  async recordPatchesAsync(
    patches: LiveWatchlistPatch[],
    now = Date.now(),
  ): Promise<LiveWatchlistAuditArchive> {
    let archive = await this.loadAsync();
    for (const patch of patches) {
      archive = applyLiveWatchlistPatchToArchive(archive, patch, now);
    }
    await this.saveAsync(archive);
    return archive;
  }

  recordPayload(payload: LiveWatchlistAuditArchivePayload, now = Date.now()): LiveWatchlistAuditArchive {
    const base: LiveWatchlistAuditArchive = {
      ...this.load(),
      updatedAt: now,
      marketDataStatus: payload.marketDataStatus,
      marketDataUpdatedAt: payload.marketDataUpdatedAt,
    };
    const archived = payload.symbols.reduce(
      (archive, symbol) => upsertArchivedSymbol(archive, {
        ...cloneJson(symbol),
        symbol: symbol.symbol,
        lastSeenAt: finiteTimestamp(symbol.updatedAt) ?? finiteTimestamp(payload.generatedAt) ?? now,
      }, now),
      base,
    );
    this.save(archived);
    return archived;
  }
}

export class ArchivedLiveWatchlistPublisher implements LiveWatchlistPublisher {
  private readonly pendingArchivePatches: LiveWatchlistPatch[] = [];
  private archiveFlushTimer: NodeJS.Timeout | null = null;
  private archiveFlushPromise: Promise<void> | null = null;

  constructor(
    private readonly delegate: LiveWatchlistPublisher,
    private readonly archive = new LiveWatchlistAuditArchivePersistence(),
    private readonly archiveFlushDelayMs = 1_000,
  ) {}

  async publish(patch: LiveWatchlistCardPatch): Promise<void> {
    await this.delegate.publish(patch);
    this.recordPatch(patch);
  }

  async publishHealth(patch: LiveWatchlistHealthPatch): Promise<void> {
    if (!this.delegate.publishHealth) {
      return;
    }
    await this.delegate.publishHealth(patch);
    this.recordPatch(patch);
  }

  async publishTickerData(patch: LiveWatchlistTickerDataPatch): Promise<void> {
    if (!this.delegate.publishTickerData) {
      return;
    }
    await this.delegate.publishTickerData(patch);
    this.recordPatch(patch);
  }

  onPublished(listener: (patch: LiveWatchlistPublishedPatch) => void): () => void {
    return this.delegate.onPublished?.(listener) ?? (() => undefined);
  }

  replayPending(): Promise<void> {
    return this.delegate.replayPending?.() ?? Promise.resolve();
  }

  async flushPending(): Promise<void> {
    if (this.archiveFlushTimer) {
      clearTimeout(this.archiveFlushTimer);
      this.archiveFlushTimer = null;
    }
    await this.flushArchivePatches();
    await this.delegate.flushPending?.();
  }

  private recordPatch(patch: LiveWatchlistPatch): void {
    this.pendingArchivePatches.push(patch);
    this.scheduleArchiveFlush();
  }

  private scheduleArchiveFlush(): void {
    if (this.archiveFlushTimer || this.archiveFlushPromise) {
      return;
    }
    this.archiveFlushTimer = setTimeout(() => {
      this.archiveFlushTimer = null;
      void this.flushArchivePatches();
    }, Math.max(0, this.archiveFlushDelayMs));
  }

  private async flushArchivePatches(): Promise<void> {
    if (this.archiveFlushPromise) {
      await this.archiveFlushPromise;
      return;
    }
    const patches = this.pendingArchivePatches.splice(0);
    if (patches.length === 0) {
      return;
    }
    this.archiveFlushPromise = this.archive.recordPatchesAsync(patches)
      .then(() => undefined)
      .catch((error) => {
        this.pendingArchivePatches.unshift(...patches);
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[LiveWatchlistAuditArchive] Failed to archive website patches: ${message}`);
      })
      .finally(() => {
        this.archiveFlushPromise = null;
        this.scheduleArchiveFlush();
      });
    try {
      await this.archiveFlushPromise;
    } finally {
      // The promise's finally callback schedules the next coalesced write if one arrived mid-flush.
    }
  }
}
