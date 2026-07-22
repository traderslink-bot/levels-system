import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

import {
  ArchivedLiveWatchlistPublisher,
  DEFAULT_LIVE_WATCHLIST_AUDIT_RETENTION_MS,
  LiveWatchlistAuditArchivePersistence,
  mergeLiveWatchlistPayloadWithArchive,
} from "../lib/live-watchlist/live-watchlist-audit-archive.js";
import type {
  LiveWatchlistCardPatch,
  LiveWatchlistHealthPatch,
  LiveWatchlistPublisher,
  LiveWatchlistTickerDataPatch,
} from "../lib/live-watchlist/live-watchlist-types.js";

test("live watchlist audit archive permanently drops deactivated symbols after three days", () => {
  const { directory, filePath } = tempArchivePath();
  const now = 10 * 24 * 60 * 60 * 1_000;
  try {
    const archive = new LiveWatchlistAuditArchivePersistence(filePath);
    archive.recordPatches([
      {
        symbol: "OLD",
        status: "deactivated",
        updatedAt: now - DEFAULT_LIVE_WATCHLIST_AUDIT_RETENTION_MS - 1,
        cards: {},
      },
      {
        symbol: "RECENT",
        status: "deactivated",
        updatedAt: now - DEFAULT_LIVE_WATCHLIST_AUDIT_RETENTION_MS + 1,
        cards: {},
      },
      {
        symbol: "LIVE",
        status: "live",
        updatedAt: now - DEFAULT_LIVE_WATCHLIST_AUDIT_RETENTION_MS - 1,
        cards: {},
      },
    ], now);

    assert.deepEqual(
      archive.load().symbols.map((symbol) => symbol.symbol).sort(),
      ["RECENT"],
    );
  } finally {
    cleanupTempArchive(directory);
  }
});

function tempArchivePath(): { directory: string; filePath: string } {
  const directory = mkdtempSync(join(tmpdir(), "live-watchlist-audit-archive-"));
  return {
    directory,
    filePath: join(directory, "archive.json"),
  };
}

function cleanupTempArchive(directory: string): void {
  rmSync(directory, { recursive: true, force: true });
}

const levelMap = {
  currentPrice: 0.42,
  rangeState: "normal" as const,
  nearestSupport: {
    side: "support" as const,
    price: 0.41,
    distancePct: -0.0238,
    strengthLabel: "major" as const,
    sourceLabel: "daily confluence",
    roleFlipFromSide: null,
    label: "0.4100 (-2.4%, major, daily confluence)",
  },
  nearestResistance: null,
  nextStrongSupport: null,
  nextStrongResistance: null,
  supportLevels: [{
    side: "support" as const,
    price: 0.41,
    distancePct: -0.0238,
    strengthLabel: "major" as const,
    sourceLabel: "daily confluence",
    roleFlipFromSide: null,
    label: "0.4100 (-2.4%, major, daily confluence)",
  }],
  resistanceLevels: [],
};

test("live watchlist audit archive keeps last levels after a status-only deactivation", () => {
  const { directory, filePath } = tempArchivePath();
  try {
    const archive = new LiveWatchlistAuditArchivePersistence(filePath);
    archive.recordPatch({
      symbol: "zbao",
      status: "live",
      updatedAt: 1000,
      levelMap,
      cards: {
        liveTraderRead: {
          title: "Live Trader Read",
          body: "ZBAO is testing major support 0.4100.",
          updatedAt: 1000,
          priceWhenPosted: 0.42,
          source: "level_snapshot",
        },
      },
    }, 1100);

    archive.recordPatch({
      symbol: "ZBAO",
      status: "deactivated",
      updatedAt: 2000,
      cards: {},
    }, 2100);

    const archivedSymbol = archive.load().symbols.find((symbol) => symbol.symbol === "ZBAO");
    assert.equal(archivedSymbol?.status, "deactivated");
    assert.equal(archivedSymbol?.levelMap?.nearestSupport?.price, 0.41);
    assert.equal(archivedSymbol?.nearestSupport, 0.41);
    assert.equal(archivedSymbol?.nearestSupportLabel, "0.4100 (-2.4%, major, daily confluence)");
    assert.equal(archivedSymbol?.cards?.liveTraderRead?.body, "ZBAO is testing major support 0.4100.");
  } finally {
    cleanupTempArchive(directory);
  }
});

test("live watchlist audit archive merge keeps removed symbols auditable", () => {
  const { directory, filePath } = tempArchivePath();
  try {
    const archive = new LiveWatchlistAuditArchivePersistence(filePath);
    archive.recordPatch({
      symbol: "ZBAO",
      status: "deactivated",
      updatedAt: 2000,
      levelMap,
      cards: {
        liveTraderRead: {
          title: "Live Trader Read",
          body: "ZBAO archived read.",
          updatedAt: 2000,
          priceWhenPosted: 0.42,
          source: "level_snapshot",
        },
      },
    }, 2100);

    const merged = mergeLiveWatchlistPayloadWithArchive({
      generatedAt: 3000,
      marketDataStatus: "live",
      symbols: [{
        symbol: "GMM",
        status: "live",
        updatedAt: 3000,
        latestPrice: 4.1,
        levelMap: null,
        cards: {},
      }],
    }, archive.load());

    assert.deepEqual(merged.symbols.map((symbol) => symbol.symbol).sort(), ["GMM", "ZBAO"]);
    assert.equal(merged.symbols.find((symbol) => symbol.symbol === "ZBAO")?.status, "deactivated");
  } finally {
    cleanupTempArchive(directory);
  }
});

test("archived live watchlist publisher records successful website patches", async () => {
  const { directory, filePath } = tempArchivePath();
  try {
    const now = Date.now();
    const published: unknown[] = [];
    const delegate: LiveWatchlistPublisher = {
      async publish(patch: LiveWatchlistCardPatch): Promise<void> {
        published.push(patch);
      },
      async publishHealth(patch: LiveWatchlistHealthPatch): Promise<void> {
        published.push(patch);
      },
      async publishTickerData(patch: LiveWatchlistTickerDataPatch): Promise<void> {
        published.push(patch);
      },
    };
    const archive = new LiveWatchlistAuditArchivePersistence(filePath);
    const publisher = new ArchivedLiveWatchlistPublisher(delegate, archive, 0);

    await publisher.publishTickerData({
      type: "tickerData",
      symbol: "zbao",
      status: "live",
      updatedAt: now,
      latestPrice: 0.42,
      nearestSupport: 0.41,
      nearestResistance: 0.44,
      nearestSupportLabel: "0.4100 (-2.4%, major, daily confluence)",
      nearestResistanceLabel: "0.4400 (+4.8%, moderate, 4h structure)",
      levelMap,
    });
    await publisher.flushPending();

    assert.equal(published.length, 1);
    const archivedSymbol = archive.load().symbols.find((symbol) => symbol.symbol === "ZBAO");
    assert.equal(archivedSymbol?.latestPrice, 0.42);
    assert.equal(archivedSymbol?.nearestSupportLabel, "0.4100 (-2.4%, major, daily confluence)");
  } finally {
    cleanupTempArchive(directory);
  }
});

test("archived live watchlist publisher retries patches after a transient archive failure", async () => {
  const { directory, filePath } = tempArchivePath();
  class FailOnceArchive extends LiveWatchlistAuditArchivePersistence {
    attempts = 0;

    override async recordPatchesAsync(...args: Parameters<LiveWatchlistAuditArchivePersistence["recordPatchesAsync"]>) {
      this.attempts += 1;
      if (this.attempts === 1) {
        throw new Error("transient archive write failure");
      }
      return super.recordPatchesAsync(...args);
    }
  }
  try {
    const now = Date.now();
    const delegate: LiveWatchlistPublisher = {
      async publishTickerData(): Promise<void> {},
      async publish(): Promise<void> {},
    };
    const archive = new FailOnceArchive(filePath);
    const publisher = new ArchivedLiveWatchlistPublisher(delegate, archive, 60_000);
    await publisher.publishTickerData({
      type: "tickerData",
      symbol: "RETRY",
      status: "live",
      updatedAt: now,
      latestPrice: 1.25,
      nearestSupport: null,
      nearestResistance: null,
    });

    await publisher.flushPending();
    assert.equal(archive.attempts, 1);
    assert.equal(archive.load().symbols.length, 0);

    await publisher.flushPending();
    assert.equal(archive.attempts, 2);
    assert.equal(archive.load().symbols[0]?.symbol, "RETRY");
  } finally {
    cleanupTempArchive(directory);
  }
});
