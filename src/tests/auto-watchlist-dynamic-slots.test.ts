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
  holdProtectedSymbols?: string[];
  followupSymbols?: string[];
}): void {
  const symbols = input.symbols ?? [];
  const followupSymbols = input.followupSymbols ?? [];
  writeFileSync(path, JSON.stringify({
    version: 1,
    enabled: true,
    lastUpdated: NOW,
    tradingDay: "2026-07-16",
    mainSessionAddedToday: [...symbols, ...followupSymbols],
    thresholds: input.thresholds,
    managedEntries: [
      ...symbols.map((symbol, index) => ({
      symbol,
      bucket: "main",
      state: "active",
      firstAddedAt: NOW - (index + 1) * 3_600_000,
      lastActivatedAt: NOW - 3_600_000,
      addedSession: index === 0 ? "premarket" : "regular",
      lastSession: "regular",
      lastRankingScore: 50 + index * 10,
      lastQualifiedAt: NOW - 60_000,
      holdProtectionEarnedAt: input.holdProtectedSymbols?.includes(symbol)
        ? NOW - 3_600_000
        : null,
      holdProtectionReason: input.holdProtectedSymbols?.includes(symbol)
        ? "earned during prior qualifying observations"
        : null,
      retentionFailures: 0,
      standbyAt: null,
      statusReason: "restored",
      })),
      ...followupSymbols.map((symbol, index) => ({
        symbol,
        bucket: "main",
        state: "followup",
        firstAddedAt: NOW - (index + 5) * 3_600_000,
        lastActivatedAt: NOW - 3_600_000,
        addedSession: "regular",
        lastSession: "regular",
        lastRankingScore: 30 + index,
        lastSlotSurvivalScore: 30 + index,
        lastQualifiedAt: NOW - 3_600_000,
        holdProtectionEarnedAt: null,
        holdProtectionReason: null,
        retentionFailures: 3,
        followupAt: NOW - (index + 1) * 60_000,
        vacatedSlotAt: NOW - (index + 1) * 60_000,
        standbyAt: null,
        statusReason: "ordinary follow-up",
      })),
    ],
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

function setRuntimeFollowup(entries: RuntimeEntry[], symbol: string, followup: boolean): void {
  const entry = entries.find((candidate) => candidate.symbol === symbol);
  if (!entry) return;
  entry.tags = followup
    ? [...new Set([...entry.tags, "auto-followup"])]
    : entry.tags.filter((tag) => tag !== "auto-followup");
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

test("a faded incumbent moves to follow-up and frees a full slot for a sustained runner", async () => {
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
    setSymbolFollowup: async (symbol, followup) => {
      setRuntimeFollowup(activeEntries, symbol, followup);
    },
    catalystLookup: NO_CATALYST_LOOKUP,
    sessionActivityLookup: activityLookup,
  });
  try {
    await selector.runNow({ activate: true });
    await selector.runNow({ activate: true });
    assert.deepEqual(activeEntries.map((entry) => entry.symbol), ["OLD"]);
    const status = await selector.runNow({ activate: true });
    assert.deepEqual(activeEntries.map((entry) => entry.symbol), ["OLD", "NEW"]);
    assert.deepEqual(status.activeMainSessionSymbols, ["NEW"]);
    assert.deepEqual(status.followupSymbols, ["OLD"]);
    assert.match(status.recentReplacements[0]?.reason ?? "", /NEW filled the active slot vacated by OLD/);
  } finally {
    selector.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("an unfilled faded slot remains a replacement opening across later scans and restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "auto-watchlist-pending-replacement-"));
  const configPath = join(directory, "config.json");
  writeConfig(configPath, {
    symbols: ["OLD"],
    thresholds: {
      consecutivePassesRequired: 1,
      maxAddsPerTradingDay: 1,
      maxActiveMainSessionTickers: 1,
      maxMainSessionReplacementsPerTradingDay: 3,
      minimumAutoHoldMinutes: 0,
      regularOpenProtectionMinutes: 0,
      retentionFailureScansRequired: 1,
      obviousRunnerOverrideEnabled: false,
    },
  });
  const activeEntries = [automaticRuntimeEntry("OLD")];
  let discoverySymbol = "OLD";
  const activityLookup: AutoWatchlistSessionActivityLookup = async ({ symbols, session }) =>
    Object.fromEntries(symbols.map((symbol) => [symbol, symbol === "OLD" ? {
      symbol,
      session,
      price: 1,
      gainPct: 1,
      sessionVolume: 100_000,
      sessionDollarVolume: 100_000,
      recent15mVolume: 0,
      recent15mDollarVolume: 0,
      volumeAcceleration: 0.1,
      quoteTime: Math.floor(NOW / 1000),
      quoteAgeMinutes: 0,
      available: true,
    } : {
      symbol,
      session,
      price: 2,
      gainPct: 50,
      sessionVolume: 2_000_000,
      sessionDollarVolume: 4_000_000,
      recent15mVolume: 300_000,
      recent15mDollarVolume: 600_000,
      volumeAcceleration: 3,
      quoteTime: Math.floor(NOW / 1000),
      quoteAgeMinutes: 0,
      available: true,
    }]));
  const options = () => ({
    yahooClient: null,
    finnhubClient: FINNHUB,
    fetchImpl: async () => screenerResponse([{ symbol: discoverySymbol, gain: discoverySymbol === "OLD" ? 1 : 50 }]),
    configPath,
    now: () => NOW,
    getActiveSymbols: () => activeEntries.map((entry) => entry.symbol),
    getActiveEntries: () => activeEntries,
    isRuntimeReady: () => true,
    activateSymbol: async ({ symbol, note }: { symbol: string; note?: string }) => {
      activeEntries.push({ ...automaticRuntimeEntry(symbol), note });
    },
    deactivateSymbol: async (symbol: string) => {
      const index = activeEntries.findIndex((entry) => entry.symbol === symbol);
      if (index >= 0) activeEntries.splice(index, 1);
    },
    setSymbolFollowup: async (symbol: string, followup: boolean) => {
      setRuntimeFollowup(activeEntries, symbol, followup);
    },
    catalystLookup: NO_CATALYST_LOOKUP,
    sessionActivityLookup: activityLookup,
  });

  try {
    const firstSelector = new AutoWatchlistSelector(options());
    const faded = await firstSelector.runNow({ activate: true });
    firstSelector.stop();
    assert.deepEqual(activeEntries.map((entry) => entry.symbol), ["OLD"]);
    assert.deepEqual(faded.followupSymbols, ["OLD"]);
    assert.deepEqual(faded.pendingReplacementSymbols, ["OLD"]);
    assert.equal(faded.recentReplacements.length, 0);

    discoverySymbol = "NEW";
    const restartedSelector = new AutoWatchlistSelector(options());
    const replaced = await restartedSelector.runNow({ activate: true });
    restartedSelector.stop();
    assert.deepEqual(activeEntries.map((entry) => entry.symbol), ["OLD", "NEW"]);
    assert.deepEqual(replaced.followupSymbols, ["OLD"]);
    assert.deepEqual(replaced.mainSessionAddedToday.sort(), ["NEW", "OLD"]);
    assert.deepEqual(replaced.pendingReplacementSymbols, []);
    assert.equal(replaced.recentReplacements[0]?.incomingSymbol, "NEW");
    assert.equal(replaced.recentReplacements[0]?.outgoingSymbol, "OLD");
  } finally {
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
    thresholds: {
      maxActiveMainSessionTickers: 2,
      maxAddsPerTradingDay: 3,
      lateMainSessionAdmissionReserve: 0,
      consecutivePassesRequired: 1,
    },
  });
  const activeEntries = symbols.map(automaticRuntimeEntry);
  const selector = new AutoWatchlistSelector({
    yahooClient: null,
    finnhubClient: FINNHUB,
    fetchImpl: async () => screenerResponse([
      ...symbols.map((symbol, index) => ({ symbol, gain: 10 + index * 15 })),
      { symbol: "EXPAND", gain: 50, volume: 2_000_000 },
    ]),
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
    setSymbolFollowup: async (symbol, followup) => {
      setRuntimeFollowup(activeEntries, symbol, followup);
    },
    catalystLookup: NO_CATALYST_LOOKUP,
    sessionActivityLookup: async ({ symbols: requested, session }) => Object.fromEntries(
      requested.map((symbol) => [symbol, {
        symbol,
        session,
        price: 2,
        gainPct: symbol === "WEAK" ? 6 : symbol === "MID" ? 20 : symbol === "BEST" ? 40 : 50,
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
    const expanded = await selector.updateConfiguration({
      enabled: true,
      thresholds: { maxActiveMainSessionTickers: 3 },
    });
    assert.equal(activeEntries.some((entry) => entry.symbol === "EXPAND"), false);
    assert.equal(expanded.recentReplacements.some((entry) => entry.incomingSymbol === "EXPAND"), false);
  } finally {
    selector.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("an obvious runner bypasses an exhausted replacement cap and leaves manual entries alone", async () => {
  const directory = await mkdtemp(join(tmpdir(), "auto-watchlist-obvious-"));
  const configPath = join(directory, "config.json");
  writeConfig(configPath, {
    symbols: ["OLD"],
    holdProtectedSymbols: ["OLD"],
    followupSymbols: ["F1", "F2", "F3"],
    thresholds: {
      consecutivePassesRequired: 2,
      maxActiveMainSessionTickers: 1,
      maxMainSessionReplacementsPerTradingDay: 0,
      lateMainSessionAdmissionReserve: 0,
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
    ...["F1", "F2", "F3"].map((symbol) => ({
      ...automaticRuntimeEntry(symbol),
      tags: ["auto", "auto-main", "auto-followup"],
    })),
  ];
  let maximumConcurrentAutomaticEntries = 1;
  const followupTransitions: Array<{
    symbol: string;
    eligible: boolean;
  }> = [];
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
    activateSymbol: async ({ symbol, note }) => {
      activeEntries.push({ ...automaticRuntimeEntry(symbol), note });
      maximumConcurrentAutomaticEntries = Math.max(
        maximumConcurrentAutomaticEntries,
        activeEntries.filter((entry) => entry.tags.includes("auto")).length,
      );
    },
    deactivateSymbol: async (symbol) => {
      const index = activeEntries.findIndex((entry) => entry.symbol === symbol);
      if (index >= 0) activeEntries.splice(index, 1);
    },
    setSymbolFollowup: async (symbol, followup, options) => {
      setRuntimeFollowup(activeEntries, symbol, followup);
      if (followup) {
        followupTransitions.push({
          symbol,
          eligible: options?.reversalWatchEligible === true,
        });
      }
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
    assert.deepEqual(activeEntries.map((entry) => entry.symbol).sort(), ["F2", "F3", "NEW", "OLD", "PIN"]);
    assert.deepEqual(status.activeMainSessionSymbols, ["NEW"]);
    assert.deepEqual(status.followupSymbols.sort(), ["F2", "F3", "OLD"]);
    assert.equal(maximumConcurrentAutomaticEntries, 5);
    assert.equal(
      followupTransitions.find((transition) => transition.symbol === "OLD")?.eligible,
      false,
    );
    assert.equal(followupTransitions.every((transition) => transition.eligible === false), true);
    assert.match(status.recentReplacements[0]?.reason ?? "", /obvious runner/);
    assert.equal(status.firstPassEvidence.find((entry) => entry.symbol === "NEW")?.observedAt, NOW);
  } finally {
    selector.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a failed full-slot challenger restores the incumbent without exceeding the automatic ceiling", async () => {
  const directory = await mkdtemp(join(tmpdir(), "auto-watchlist-replacement-rollback-"));
  const configPath = join(directory, "config.json");
  writeConfig(configPath, {
    symbols: ["OLD"],
    thresholds: {
      consecutivePassesRequired: 1,
      maxActiveMainSessionTickers: 1,
      minimumAutoHoldMinutes: 0,
      regularOpenProtectionMinutes: 0,
      obviousRunnerOverrideEnabled: true,
      obviousRunnerRecentDollarVolumeMultiplier: 1,
      obviousRunnerMinVolumeAcceleration: 1,
      obviousRunnerReplacementMargin: 1,
    },
  });
  const activeEntries = [automaticRuntimeEntry("OLD")];
  const activationAttempts: string[] = [];
  let maximumConcurrentAutomaticEntries = 1;
  const selector = new AutoWatchlistSelector({
    yahooClient: null,
    finnhubClient: FINNHUB,
    fetchImpl: async () => screenerResponse([
      { symbol: "OLD", gain: 10 },
      { symbol: "NEW", gain: 60, volume: 3_000_000 },
    ]),
    configPath,
    now: () => NOW,
    getActiveSymbols: () => activeEntries.map((entry) => entry.symbol),
    getActiveEntries: () => activeEntries,
    isRuntimeReady: () => true,
    activateSymbol: async ({ symbol }) => {
      activationAttempts.push(symbol);
      if (symbol === "NEW") throw new Error("challenger readiness failed");
      activeEntries.push(automaticRuntimeEntry(symbol));
      maximumConcurrentAutomaticEntries = Math.max(
        maximumConcurrentAutomaticEntries,
        activeEntries.length,
      );
    },
    deactivateSymbol: async (symbol) => {
      const index = activeEntries.findIndex((entry) => entry.symbol === symbol);
      if (index >= 0) activeEntries.splice(index, 1);
    },
    setSymbolFollowup: async (symbol, followup) => {
      setRuntimeFollowup(activeEntries, symbol, followup);
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
        gainPct: 10,
        sessionVolume: 500_000,
        sessionDollarVolume: 1_000_000,
        recent15mVolume: 20_000,
        recent15mDollarVolume: 40_000,
        volumeAcceleration: 0.5,
        quoteTime: Math.floor(NOW / 1000),
        quoteAgeMinutes: 0,
        available: true,
      }]),
    ),
  });
  try {
    const status = await selector.runNow({ activate: true });
    assert.deepEqual(activationAttempts, ["NEW"]);
    assert.deepEqual(activeEntries.map((entry) => entry.symbol), ["OLD"]);
    assert.equal(maximumConcurrentAutomaticEntries, 1);
    assert.deepEqual(status.activeMainSessionSymbols, ["OLD"]);
    assert.match(status.lastActivationErrors[0]?.error ?? "", /challenger readiness failed/);
  } finally {
    selector.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a Nasdaq-confirmed halt freezes failed-retention counting for an active runner", async () => {
  const directory = await mkdtemp(join(tmpdir(), "auto-watchlist-halt-retention-"));
  const configPath = join(directory, "config.json");
  writeConfig(configPath, {
    symbols: ["ZYBT"],
    thresholds: {
      maxActiveMainSessionTickers: 1,
      minimumAutoHoldMinutes: 0,
      regularOpenProtectionMinutes: 0,
      retentionFailureScansRequired: 1,
    },
  });
  const activeEntries = [automaticRuntimeEntry("ZYBT")];
  let resumed = false;
  const selector = new AutoWatchlistSelector({
    yahooClient: null,
    finnhubClient: FINNHUB,
    fetchImpl: async () => screenerResponse([{ symbol: "ZYBT", gain: 781, volume: 73_000_000 }]),
    configPath,
    now: () => NOW,
    getActiveSymbols: () => activeEntries.map((entry) => entry.symbol),
    getActiveEntries: () => activeEntries,
    isRuntimeReady: () => true,
    activateSymbol: async () => undefined,
    setSymbolFollowup: async (symbol, followup) => setRuntimeFollowup(activeEntries, symbol, followup),
    catalystLookup: NO_CATALYST_LOOKUP,
    sessionActivityLookup: async ({ symbols, session, now }) => Object.fromEntries(symbols.map((symbol) => [symbol, {
      symbol,
      session,
      price: 6.15,
      gainPct: 781,
      sessionVolume: 73_000_000,
      sessionDollarVolume: 150_000_000,
      recent15mVolume: resumed ? 500_000 : 0,
      recent15mDollarVolume: resumed ? 3_000_000 : 0,
      volumeAcceleration: resumed ? 1.2 : null,
      quoteTime: Math.floor((now - (resumed ? 0 : 20 * 60_000)) / 1000),
      quoteAgeMinutes: resumed ? 0 : 20,
      available: true,
    }])),
    tradingHaltLookup: async ({ symbols, now }) => ({
      checkedAt: now,
      available: true,
      cacheAgeMs: 0,
      error: null,
      bySymbol: Object.fromEntries(symbols.map((symbol) => [symbol, {
        symbol,
        state: "halted" as const,
        haltDate: "07/20/2026",
        haltTime: "15:25:20.970",
        reasonCode: "LUDP",
        resumptionDate: "07/20/2026",
        resumptionQuoteTime: "15:25:20",
        resumptionTradeTime: null,
        source: "nasdaq_trader_rss" as const,
      }])),
    }),
  });
  try {
    const halted = await selector.runNow({ activate: true });
    assert.deepEqual(halted.activeMainSessionSymbols, ["ZYBT"]);
    assert.deepEqual(halted.followupSymbols, []);
    assert.equal(halted.managedEntries[0]?.retentionFailures, 0);
    assert.equal(halted.recentDecisions[0]?.haltRetentionProtected, true);
    assert.match(halted.managedEntries[0]?.statusReason ?? "", /Nasdaq Trader confirms an active trading halt/);

    resumed = true;
    const tradingAgain = await selector.runNow({ activate: true });
    assert.equal(tradingAgain.recentDecisions[0]?.qualified, true);
    assert.equal(tradingAgain.recentDecisions[0]?.tradingHaltState, "not_checked");
    assert.equal(tradingAgain.managedEntries[0]?.retentionFailures, 0);
  } finally {
    selector.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a confirmed halt restores a recently demoted follow-up without rewriting admission evidence", async () => {
  const postmarketNow = Date.parse("2026-07-16T20:09:00Z");
  const directory = await mkdtemp(join(tmpdir(), "auto-watchlist-halt-restore-"));
  const configPath = join(directory, "config.json");
  writeFileSync(configPath, JSON.stringify({
    version: 1,
    enabled: true,
    lastUpdated: NOW,
    tradingDay: "2026-07-16",
    mainSessionAddedToday: ["ZYBT"],
    thresholds: {
      maxActiveMainSessionTickers: 1,
      minimumAutoHoldMinutes: 0,
      regularOpenProtectionMinutes: 0,
      retentionFailureScansRequired: 1,
    },
    managedEntries: [{
      symbol: "ZYBT",
      bucket: "main",
      state: "followup",
      firstAddedAt: NOW - 3_600_000,
      lastActivatedAt: NOW - 3_600_000,
      addedSession: "regular",
      lastSession: "regular",
      lastRankingScore: 75,
      lastSlotSurvivalScore: 105,
      admissionAt: NOW - 3_600_000,
      admissionQualificationScore: 75,
      admissionRankingScore: 90,
      admissionSlotSurvivalScore: 90,
      lastQualifiedAt: NOW - 10 * 60_000,
      retentionFailures: 3,
      followupAt: NOW - 60_000,
      vacatedSlotAt: NOW - 60_000,
      standbyAt: null,
      statusReason: "moved to follow-up after 3 failed retention scans",
    }],
  }));
  const activeEntries = [{ ...automaticRuntimeEntry("ZYBT"), tags: ["auto", "auto-main", "auto-followup"] }];
  const selector = new AutoWatchlistSelector({
    yahooClient: null,
    finnhubClient: FINNHUB,
    fetchImpl: async () => screenerResponse([{ symbol: "ZYBT", gain: 781, volume: 73_000_000 }]),
    configPath,
    now: () => postmarketNow,
    getActiveSymbols: () => activeEntries.map((entry) => entry.symbol),
    getActiveEntries: () => activeEntries,
    isRuntimeReady: () => true,
    activateSymbol: async () => undefined,
    setSymbolFollowup: async (symbol, followup) => setRuntimeFollowup(activeEntries, symbol, followup),
    catalystLookup: NO_CATALYST_LOOKUP,
    sessionActivityLookup: async ({ symbols, session, now }) => Object.fromEntries(symbols.map((symbol) => [symbol, {
      symbol,
      session,
      price: 6.15,
      gainPct: 781,
      sessionVolume: 73_000_000,
      sessionDollarVolume: 150_000_000,
      recent15mVolume: 0,
      recent15mDollarVolume: 0,
      volumeAcceleration: null,
      quoteTime: Math.floor((now - 20 * 60_000) / 1000),
      quoteAgeMinutes: 20,
      available: true,
    }])),
    tradingHaltLookup: async ({ symbols, now }) => ({
      checkedAt: now,
      available: true,
      cacheAgeMs: 0,
      error: null,
      bySymbol: Object.fromEntries(symbols.map((symbol) => [symbol, {
        symbol,
        state: "halted" as const,
        haltDate: "07/20/2026",
        haltTime: "15:25:20.970",
        reasonCode: "LUDP",
        resumptionDate: "07/20/2026",
        resumptionQuoteTime: "15:25:20",
        resumptionTradeTime: null,
        source: "nasdaq_trader_rss" as const,
      }])),
    }),
  });
  try {
    const status = await selector.runNow({ activate: true });
    const managed = status.managedEntries.find((entry) => entry.symbol === "ZYBT");
    assert.deepEqual(status.activeMainSessionSymbols, ["ZYBT"]);
    assert.deepEqual(status.followupSymbols, []);
    assert.doesNotMatch(activeEntries[0]?.tags.join(" ") ?? "", /auto-followup/);
    assert.equal(managed?.retentionFailures, 0);
    assert.equal(managed?.admissionQualificationScore, 75);
    assert.equal(managed?.admissionRankingScore, 90);
    assert.equal(managed?.admissionSlotSurvivalScore, 90);
  } finally {
    selector.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
