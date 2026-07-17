import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AutoWatchlistSelector,
  type AutoWatchlistSessionActivityLookup,
} from "../lib/auto-watchlist/auto-watchlist-selector.js";
import type { FinnhubClient } from "../lib/stock-context/finnhub-client.js";

const NOW = Date.parse("2026-07-16T15:00:00Z");
const NO_CATALYST_LOOKUP = async (input: { symbols: string[] }) => ({
  available: true,
  articlesBySymbol: Object.fromEntries(input.symbols.map((symbol) => [symbol, []])),
});
const FINNHUB = {
  getCompanyProfile: async (symbol: string) => ({
    ticker: symbol,
    marketCapitalization: 10,
    shareOutstanding: 10,
  }),
} as unknown as FinnhubClient;

type RuntimeEntry = {
  symbol: string;
  tags: string[];
  note?: string;
  activatedAt: number;
};

function writeConfig(path: string, input: {
  thresholds: Record<string, unknown>;
  symbols?: string[];
}): void {
  const symbols = input.symbols ?? [];
  writeFileSync(path, JSON.stringify({
    version: 1,
    enabled: true,
    lastUpdated: NOW,
    tradingDay: "2026-07-16",
    mainSessionAddedToday: symbols,
    thresholds: input.thresholds,
    managedEntries: symbols.map((symbol, index) => ({
      symbol,
      bucket: "main",
      state: "active",
      firstAddedAt: NOW - (index + 1) * 3_600_000,
      lastActivatedAt: NOW - 3_600_000,
      addedSession: index === 0 ? "premarket" : "regular",
      lastSession: "regular",
      lastRankingScore: 50 + index * 10,
      lastQualifiedAt: NOW - 60_000,
      retentionFailures: 0,
      standbyAt: null,
      statusReason: "restored",
    })),
  }));
}

function screenerResponse(symbols: Array<{ symbol: string; gain: number; volume?: number }>): Response {
  return new Response(JSON.stringify({
    data: {
      rows: symbols.map(({ symbol, gain, volume = 1_000_000 }) => ({
        symbol,
        name: `${symbol} Common Stock`,
        lastsale: "$2.00",
        pctchange: `${gain}%`,
        volume: String(volume),
        marketCap: "10000000",
      })),
    },
  }), { status: 200 });
}

function automaticRuntimeEntry(symbol: string): RuntimeEntry {
  return {
    symbol,
    tags: ["auto", "auto-main"],
    note: "Auto-selected during regular: test",
    activatedAt: NOW - 3_600_000,
  };
}

test("startup migrates both legacy main-session and session-labelled automatic notes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "auto-watchlist-legacy-notes-"));
  const activeEntries: RuntimeEntry[] = [
    {
      symbol: "MAIN",
      tags: ["manual"],
      note: "Auto-selected: score 70; 40.0% gain.",
      activatedAt: NOW - 3_600_000,
    },
    {
      symbol: "POST",
      tags: ["manual"],
      note: "Auto-selected during postmarket: score 70; 30.0% gain.",
      activatedAt: NOW - 1_800_000,
    },
  ];
  const configPath = join(directory, "config.json");
  writeFileSync(configPath, JSON.stringify({
    version: 1,
    enabled: false,
    lastUpdated: NOW,
    tradingDay: "2026-07-16",
    thresholds: {},
  }));
  const selector = new AutoWatchlistSelector({
    yahooClient: null,
    finnhubClient: FINNHUB,
    fetchImpl: async () => screenerResponse([]),
    configPath,
    now: () => NOW,
    getActiveSymbols: () => activeEntries.map((entry) => entry.symbol),
    getActiveEntries: () => activeEntries,
    isRuntimeReady: () => true,
    activateSymbol: async () => undefined,
    deactivateSymbol: async () => undefined,
    catalystLookup: NO_CATALYST_LOOKUP,
  });
  try {
    selector.start();
    const status = selector.getStatus();
    assert.deepEqual(status.activeMainSessionSymbols, ["MAIN"]);
    assert.deepEqual(status.activePostmarketSymbols, ["POST"]);
  } finally {
    selector.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a faded incumbent moves to standby and frees a full slot for a sustained runner", async () => {
  const directory = await mkdtemp(join(tmpdir(), "auto-watchlist-fade-"));
  const configPath = join(directory, "config.json");
  writeConfig(configPath, {
    symbols: ["OLD"],
    thresholds: {
      consecutivePassesRequired: 2,
      maxAddsPerTradingDay: 1,
      maxActiveMainSessionTickers: 1,
      maxMainSessionReplacementsPerTradingDay: 3,
      minimumAutoHoldMinutes: 0,
      regularOpenProtectionMinutes: 0,
      retentionFailureScansRequired: 3,
      replacementRankingMargin: 100,
      obviousRunnerOverrideEnabled: false,
    },
  });
  const activeEntries = [automaticRuntimeEntry("OLD")];
  const activityLookup: AutoWatchlistSessionActivityLookup = async ({ symbols, session }) =>
    Object.fromEntries(symbols.map((symbol) => [symbol, symbol === "OLD" ? {
      symbol,
      session,
      price: 1.1,
      gainPct: 1,
      sessionVolume: 200_000,
      sessionDollarVolume: 220_000,
      recent15mVolume: 0,
      recent15mDollarVolume: 0,
      volumeAcceleration: 0.2,
      quoteTime: Math.floor(NOW / 1000),
      quoteAgeMinutes: 0,
      available: true,
    } : {
      symbol,
      session,
      price: 2,
      gainPct: 40,
      sessionVolume: 2_000_000,
      sessionDollarVolume: 4_000_000,
      recent15mVolume: 250_000,
      recent15mDollarVolume: 500_000,
      volumeAcceleration: 2.5,
      quoteTime: Math.floor(NOW / 1000),
      quoteAgeMinutes: 0,
      available: true,
    }]));
  const selector = new AutoWatchlistSelector({
    yahooClient: null,
    finnhubClient: FINNHUB,
    fetchImpl: async () => screenerResponse([{ symbol: "NEW", gain: 40, volume: 2_000_000 }]),
    configPath,
    now: () => NOW,
    getActiveSymbols: () => activeEntries.map((entry) => entry.symbol),
    getActiveEntries: () => activeEntries,
    isRuntimeReady: () => true,
    activateSymbol: async ({ symbol, source, note }) => {
      assert.equal(source, "auto");
      activeEntries.push({ ...automaticRuntimeEntry(symbol), note });
    },
    deactivateSymbol: async (symbol) => {
      const index = activeEntries.findIndex((entry) => entry.symbol === symbol);
      if (index >= 0) activeEntries.splice(index, 1);
    },
    catalystLookup: NO_CATALYST_LOOKUP,
    sessionActivityLookup: activityLookup,
  });
  try {
    await selector.runNow({ activate: true });
    await selector.runNow({ activate: true });
    assert.deepEqual(activeEntries.map((entry) => entry.symbol), ["OLD"]);
    const status = await selector.runNow({ activate: true });
    assert.deepEqual(activeEntries.map((entry) => entry.symbol), ["NEW"]);
    assert.deepEqual(status.activeMainSessionSymbols, ["NEW"]);
    assert.equal(status.standbyToday.find((entry) => entry.symbol === "OLD")?.state, "standby");
    assert.match(status.recentReplacements[0]?.reason ?? "", /NEW replaced OLD/);
  } finally {
    selector.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("manual entries are pinned outside the automatic active-slot limit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "auto-watchlist-manual-"));
  const activeEntries: RuntimeEntry[] = [{
    symbol: "PIN",
    tags: ["manual"],
    note: "manual",
    activatedAt: NOW - 3_600_000,
  }];
  const deactivated: string[] = [];
  const selector = new AutoWatchlistSelector({
    yahooClient: null,
    finnhubClient: FINNHUB,
    fetchImpl: async () => screenerResponse([{ symbol: "AUTO", gain: 30 }]),
    configPath: join(directory, "config.json"),
    thresholds: {
      consecutivePassesRequired: 1,
      maxActiveMainSessionTickers: 1,
      minimumAutoHoldMinutes: 0,
      regularOpenProtectionMinutes: 0,
    },
    now: () => NOW,
    getActiveSymbols: () => activeEntries.map((entry) => entry.symbol),
    getActiveEntries: () => activeEntries,
    isRuntimeReady: () => true,
    activateSymbol: async ({ symbol, note }) => activeEntries.push({
      ...automaticRuntimeEntry(symbol),
      note,
    }),
    deactivateSymbol: async (symbol) => {
      deactivated.push(symbol);
    },
    catalystLookup: NO_CATALYST_LOOKUP,
    sessionActivityLookup: async ({ symbols, session }) => Object.fromEntries(
      symbols.map((symbol) => [symbol, {
        symbol,
        session,
        price: 2,
        gainPct: 30,
        sessionVolume: 1_000_000,
        sessionDollarVolume: 2_000_000,
        recent15mVolume: 100_000,
        recent15mDollarVolume: 200_000,
        volumeAcceleration: 2,
        quoteTime: Math.floor(NOW / 1000),
        quoteAgeMinutes: 0,
        available: true,
      }]),
    ),
  });
  try {
    const status = await selector.updateConfiguration({ enabled: true });
    assert.deepEqual(activeEntries.map((entry) => entry.symbol).sort(), ["AUTO", "PIN"]);
    assert.deepEqual(deactivated, []);
    assert.deepEqual(status.activeMainSessionSymbols, ["AUTO"]);
  } finally {
    selector.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("lowering the automatic slot count retires the weakest excess incumbent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "auto-watchlist-resize-"));
  const configPath = join(directory, "config.json");
  const symbols = ["WEAK", "MID", "BEST"];
  writeConfig(configPath, {
    symbols,
    thresholds: { maxActiveMainSessionTickers: 2, consecutivePassesRequired: 1 },
  });
  const activeEntries = symbols.map(automaticRuntimeEntry);
  const selector = new AutoWatchlistSelector({
    yahooClient: null,
    finnhubClient: FINNHUB,
    fetchImpl: async () => screenerResponse(symbols.map((symbol, index) => ({ symbol, gain: 10 + index * 15 }))),
    configPath,
    now: () => NOW,
    getActiveSymbols: () => activeEntries.map((entry) => entry.symbol),
    getActiveEntries: () => activeEntries,
    isRuntimeReady: () => true,
    activateSymbol: async () => undefined,
    deactivateSymbol: async (symbol) => {
      const index = activeEntries.findIndex((entry) => entry.symbol === symbol);
      if (index >= 0) activeEntries.splice(index, 1);
    },
    catalystLookup: NO_CATALYST_LOOKUP,
    sessionActivityLookup: async ({ symbols: requested, session }) => Object.fromEntries(
      requested.map((symbol) => [symbol, {
        symbol,
        session,
        price: 2,
        gainPct: symbol === "WEAK" ? 6 : symbol === "MID" ? 20 : 40,
        sessionVolume: symbol === "WEAK" ? 200_000 : 1_000_000,
        sessionDollarVolume: symbol === "WEAK" ? 400_000 : 2_000_000,
        recent15mVolume: symbol === "WEAK" ? 30_000 : 150_000,
        recent15mDollarVolume: symbol === "WEAK" ? 60_000 : 300_000,
        volumeAcceleration: symbol === "WEAK" ? 0.7 : 2,
        quoteTime: Math.floor(NOW / 1000),
        quoteAgeMinutes: 0,
        available: true,
      }]),
    ),
  });
  try {
    const status = await selector.runNow({ activate: true });
    assert.equal(activeEntries.length, 2);
    assert.equal(activeEntries.some((entry) => entry.symbol === "WEAK"), false);
    assert.match(
      status.standbyToday.find((entry) => entry.symbol === "WEAK")?.statusReason ?? "",
      /slot limit was reduced to 2/,
    );
  } finally {
    selector.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("an obvious runner replaces a healthy auto incumbent after one scan but leaves manual entries alone", async () => {
  const directory = await mkdtemp(join(tmpdir(), "auto-watchlist-obvious-"));
  const configPath = join(directory, "config.json");
  writeConfig(configPath, {
    symbols: ["OLD"],
    thresholds: {
      consecutivePassesRequired: 2,
      maxActiveMainSessionTickers: 1,
      minimumAutoHoldMinutes: 0,
      regularOpenProtectionMinutes: 0,
      obviousRunnerOverrideEnabled: true,
      obviousRunnerRecentDollarVolumeMultiplier: 2,
      obviousRunnerMinVolumeAcceleration: 1.5,
      obviousRunnerReplacementMargin: 8,
    },
  });
  const activeEntries: RuntimeEntry[] = [
    { symbol: "PIN", tags: ["manual"], note: "manual", activatedAt: NOW - 7_200_000 },
    automaticRuntimeEntry("OLD"),
  ];
  const selector = new AutoWatchlistSelector({
    yahooClient: null,
    finnhubClient: FINNHUB,
    fetchImpl: async () => screenerResponse([
      { symbol: "OLD", gain: 20 },
      { symbol: "NEW", gain: 60, volume: 3_000_000 },
    ]),
    configPath,
    now: () => NOW,
    getActiveSymbols: () => activeEntries.map((entry) => entry.symbol),
    getActiveEntries: () => activeEntries,
    isRuntimeReady: () => true,
    activateSymbol: async ({ symbol, note }) => activeEntries.push({ ...automaticRuntimeEntry(symbol), note }),
    deactivateSymbol: async (symbol) => {
      const index = activeEntries.findIndex((entry) => entry.symbol === symbol);
      if (index >= 0) activeEntries.splice(index, 1);
    },
    catalystLookup: NO_CATALYST_LOOKUP,
    sessionActivityLookup: async ({ symbols, session }) => Object.fromEntries(
      symbols.map((symbol) => [symbol, symbol === "NEW" ? {
        symbol,
        session,
        price: 3,
        gainPct: 60,
        sessionVolume: 3_000_000,
        sessionDollarVolume: 9_000_000,
        recent15mVolume: 300_000,
        recent15mDollarVolume: 900_000,
        volumeAcceleration: 3,
        quoteTime: Math.floor(NOW / 1000),
        quoteAgeMinutes: 0,
        available: true,
      } : {
        symbol,
        session,
        price: 2,
        gainPct: 20,
        sessionVolume: 1_000_000,
        sessionDollarVolume: 2_000_000,
        recent15mVolume: 30_000,
        recent15mDollarVolume: 60_000,
        volumeAcceleration: 1.1,
        quoteTime: Math.floor(NOW / 1000),
        quoteAgeMinutes: 0,
        available: true,
      }]),
    ),
  });
  try {
    const status = await selector.runNow({ activate: true });
    assert.deepEqual(activeEntries.map((entry) => entry.symbol).sort(), ["NEW", "PIN"]);
    assert.match(status.recentReplacements[0]?.reason ?? "", /obvious runner/);
  } finally {
    selector.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
