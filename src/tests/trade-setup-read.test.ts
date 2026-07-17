import assert from "node:assert/strict";
import test from "node:test";

import type { ChartThesisRead, LevelSnapshotPayload } from "../lib/alerts/alert-types.js";
import {
  buildLiveWatchlistLevelMap,
  buildLiveWatchlistPullbackReadPatch,
  buildLiveWatchlistSnapshotPatch,
} from "../lib/live-watchlist/live-watchlist-publisher.js";
import {
  buildLiveWatchlistTradeSetupRead,
  resolveLiveWatchlistTradeSetupReadMode,
} from "../lib/live-watchlist/trade-setup-read.js";
import type {
  FormalMarketStructureRuntimeContext,
  RuntimeMarketStructureSnapshot,
  StableMarketStructureRuntimeContext,
} from "../lib/monitoring/monitoring-types.js";
import type { TechnicalContext } from "../lib/technical-context/technical-context-types.js";

const evaluatedAt = Date.UTC(2026, 6, 14, 15, 0, 0);

const technicalContext: TechnicalContext = {
  source: "levels_system_intraday",
  sourceTimeframe: "5m",
  provider: "yahoo",
  sessionDate: "2026-07-14",
  updatedAt: evaluatedAt,
  candleCount: 48,
  currentPrice: 0.72,
  vwap: 0.702,
  ema9: 0.708,
  ema20: 0.695,
  priceVsVwapPct: 2.56,
  priceVsEma9Pct: 1.69,
  priceVsEma20Pct: 3.6,
  aboveVwap: true,
  aboveEma9: true,
  aboveEma20: true,
  confidence: "high",
  diagnostics: [],
};

function thesis(overrides: Partial<ChartThesisRead> = {}): ChartThesisRead {
  return {
    type: "failed_breakdown_reclaim",
    label: "Failed breakdown reclaim",
    timeframe: "4h",
    status: "active",
    confidence: "high",
    score: 88,
    triggerLow: 0.7,
    triggerHigh: 0.7,
    targetLow: 0.84,
    targetHigh: 0.86,
    invalidationLevel: 0.66,
    buyerResponseLow: 0.665,
    roomToTargetPct: 16.7,
    evidence: ["swept support and reclaimed"],
    activeRunnerTape: {
      latestCandleAt: evaluatedAt - 300_000,
      classification: "steady_5m_support",
      structure: "upper_range_control",
      volumeRatio: 1.4,
      latestRangePct: 4,
      extensionPct: 2.8,
      latestCloseLocationPct: 76,
      latestUpperWickPct: 12,
      line: "Latest 5m structure is holding its upper range.",
      riskFlags: [],
    },
    lines: [],
    ...overrides,
  };
}

function levelMap(currentPrice = 0.72, resistancePrice = 0.84) {
  return buildLiveWatchlistLevelMap({
    currentPrice,
    supportZones: [
      {
        representativePrice: 0.7,
        lowPrice: 0.697,
        highPrice: 0.703,
        strengthLabel: "strong",
        sourceLabel: "daily confluence",
        freshness: "fresh",
        marketDataProvenance: {
          formedAt: evaluatedAt - 86_400_000,
          sourceLastSeenAt: evaluatedAt,
          lastConfirmedAt: evaluatedAt - 3_600_000,
        },
      },
    ],
    resistanceZones: [
      {
        representativePrice: resistancePrice,
        strengthLabel: "strong",
        sourceLabel: "daily structure",
      },
    ],
    preferStructuralLevels: true,
  });
}

function formalStructure(
  timeframe: "5m" | "4h" | "daily",
  eventType: "bos_bullish" | "bos_bearish" | "choch_bullish" | "choch_bearish",
): FormalMarketStructureRuntimeContext {
  const bullish = eventType.endsWith("_bullish");
  return {
    timeframe,
    bias: bullish ? "bullish" : "bearish",
    previousBias: null,
    eventType,
    eventFreshness: "fresh",
    triggerTimestamp: new Date(evaluatedAt - 300_000).toISOString(),
    confirmation: "close_confirmed",
    confidence: "high",
    confidenceScore: 0.86,
    materialChange: true,
    brokenSwingPrice: bullish ? 0.7 : 0.68,
    sweptSwingPrice: null,
    protectedHigh: 0.84,
    protectedLow: 0.66,
    latestHigh: 0.75,
    latestLow: 0.68,
    swingSequence: bullish ? ["HL", "HH"] : ["LH", "LL"],
    structureKey: `${timeframe}|${eventType}|test`,
    traderLine: `${timeframe} ${eventType}`,
    debug: { candleCount: 60, reasons: [] },
  };
}

function stable5mStructure(
  state: StableMarketStructureRuntimeContext["state"],
): StableMarketStructureRuntimeContext {
  return {
    state,
    previousState: "range_bound",
    structureKey: `5m|${state}|test`,
    materialChange: true,
    confidence: "high",
    materialityScore: 0.88,
    rawState: state,
    reason: "high_materiality_change",
    candleCount: 48,
  };
}

function marketStructureSnapshot(args: {
  timeframe?: "5m" | "4h" | "daily";
  eventType?: "bos_bullish" | "bos_bearish" | "choch_bullish" | "choch_bearish";
  stableState?: StableMarketStructureRuntimeContext["state"];
}): RuntimeMarketStructureSnapshot {
  const timeframe = args.timeframe ?? "5m";
  const formal = args.eventType ? formalStructure(timeframe, args.eventType) : undefined;
  const stable = args.stableState ? stable5mStructure(args.stableState) : undefined;
  const context = {
    ...(formal ? { formal } : {}),
    ...(stable ? { stable } : {}),
  };
  return {
    ...(timeframe === "5m" ? context : {}),
    timeframes: {
      [timeframe]: context,
    },
  };
}

test("trade setup read requires independent zone evidence and produces a risk-qualified triggered setup", () => {
  const read = buildLiveWatchlistTradeSetupRead({
    symbol: "REAL",
    currentPrice: 0.72,
    evaluatedAt,
    thesis: thesis(),
    levelMap: levelMap(),
    technicalContext,
    bidPrice: 0.718,
    askPrice: 0.721,
  });

  assert.equal(read.state, "triggered");
  assert.equal(read.actionable, true);
  assert.equal(read.metadata.tradeSetupStateBeforeBlockers, "triggered");
  assert.ok(read.zone);
  assert.deepEqual(read.zone.categories.sort(), ["dynamic", "structure", "thesis"]);
  assert.ok((read.firstTargetRewardRiskRatio ?? 0) >= 1.5);
  assert.match(read.body, /Potential dip-buy zone:/);
  assert.match(read.body, /Confirmation trigger:/);
  assert.match(read.body, /Invalidation:/);
  assert.match(read.body, /T1:/);
});

test("trade setup read refuses to invent a dip zone from a thesis trigger alone", () => {
  const read = buildLiveWatchlistTradeSetupRead({
    symbol: "SOLO",
    currentPrice: 0.72,
    evaluatedAt,
    thesis: thesis(),
    levelMap: null,
    technicalContext: null,
  });

  assert.equal(read.state, "no_trade");
  assert.equal(read.actionable, false);
  assert.equal(read.metadata.tradeSetupStateBeforeBlockers, null);
  assert.equal(read.zone, null);
  assert.match(read.blockers[0] ?? "", /two independent evidence categories/);
});

test("trade setup read marks an otherwise valid setup as chase risk when price is far above the zone", () => {
  const context = { ...technicalContext, currentPrice: 0.9, vwap: 0.702, ema9: 0.82, ema20: 0.75 };
  const read = buildLiveWatchlistTradeSetupRead({
    symbol: "CHASE",
    currentPrice: 0.9,
    evaluatedAt,
    thesis: thesis({
      targetLow: 1.1,
      targetHigh: 1.15,
      activeRunnerTape: {
        ...thesis().activeRunnerTape!,
        classification: "extended_chase_risk",
        structure: "weak_close_or_heavy_wick",
      },
    }),
    levelMap: levelMap(0.9, 1.1),
    technicalContext: context,
  });

  assert.equal(read.state, "extended_risk");
  assert.equal(read.actionable, false);
  assert.match(read.blockers.join(" "), /too extended/);
});

test("trade setup read keeps an unconfirmed nearby reclaim armed instead of presenting it as an entry", () => {
  const read = buildLiveWatchlistTradeSetupRead({
    symbol: "ARMED",
    currentPrice: 0.72,
    evaluatedAt,
    thesis: thesis({
      status: "watch",
      triggerLow: 0.74,
      triggerHigh: 0.74,
      targetLow: 0.95,
      targetHigh: 1.05,
      invalidationLevel: 0.69,
      activeRunnerTape: undefined,
    }),
    levelMap: levelMap(0.72, 0.95),
    technicalContext,
  });

  assert.equal(read.state, "armed");
  assert.equal(read.actionable, false);
  assert.equal(read.triggerPrice, 0.74);
  assert.match(read.triggerCondition ?? "", /5-minute close above 0\.7400/);
});

test("trade setup read will not certify a trigger from stale 5-minute tape", () => {
  const read = buildLiveWatchlistTradeSetupRead({
    symbol: "STALE",
    currentPrice: 0.72,
    evaluatedAt,
    thesis: thesis({
      activeRunnerTape: {
        ...thesis().activeRunnerTape!,
        latestCandleAt: evaluatedAt - 60 * 60_000,
      },
    }),
    levelMap: levelMap(),
    technicalContext,
  });

  assert.equal(read.state, "armed");
  assert.equal(read.actionable, false);
});

test("trade setup read refuses to manufacture an invalidation under the selected zone", () => {
  const read = buildLiveWatchlistTradeSetupRead({
    symbol: "NOINV",
    currentPrice: 0.72,
    evaluatedAt,
    thesis: thesis({ invalidationLevel: 0.705 }),
    levelMap: levelMap(),
    technicalContext,
  });

  assert.equal(read.state, "no_trade");
  assert.equal(read.invalidationCondition, null);
  assert.match(read.blockers.join(" "), /structural invalidation below/);
});

test("trade setup read rejects a nearby target that does not pay for structural risk", () => {
  const read = buildLiveWatchlistTradeSetupRead({
    symbol: "NORR",
    currentPrice: 0.705,
    evaluatedAt,
    thesis: thesis({
      invalidationLevel: 0.68,
      targetLow: 0.9,
      targetHigh: 0.95,
      activeRunnerTape: {
        ...thesis().activeRunnerTape!,
        extensionPct: 0.7,
      },
    }),
    levelMap: levelMap(0.705, 0.72),
    technicalContext: { ...technicalContext, currentPrice: 0.705 },
  });

  assert.equal(read.state, "no_trade");
  assert.equal(read.actionable, false);
  assert.match(read.blockers.join(" "), /offers only|before the setup can pay 1R/);
});

test("trade setup read treats an unaligned resistance level as an obstacle instead of inventing a target", () => {
  const read = buildLiveWatchlistTradeSetupRead({
    symbol: "TARGET",
    currentPrice: 0.72,
    evaluatedAt,
    thesis: thesis({ targetLow: 0.9, targetHigh: 0.98 }),
    levelMap: levelMap(0.72, 0.78),
    technicalContext,
  });

  assert.equal(read.targets[0]?.price, 0.9);
  assert.equal(read.metadata.tradeSetupFirstObstacle, 0.78);
  assert.match(read.body, /First obstacle: 0\.7800/);
  assert.match(read.body, /T1: 0\.9000 \(Failed breakdown reclaim target/);
});

test("trade setup read keeps a nearby session level as an obstacle and promotes the farther paying objective", () => {
  const map = levelMap(0.72, 0.9);
  assert.ok(map);
  map.referenceLevels = [
    { key: "hod", label: "HOD", price: 0.735, kind: "session" },
  ];
  const read = buildLiveWatchlistTradeSetupRead({
    symbol: "HIER",
    currentPrice: 0.72,
    evaluatedAt,
    thesis: thesis({ targetLow: 0.735, targetHigh: 0.9 }),
    levelMap: map,
    technicalContext,
  });

  assert.equal(read.targets[0]?.price, 0.9);
  assert.equal(read.metadata.tradeSetupNearestObjective, 0.735);
  assert.equal(read.metadata.tradeSetupFirstObstacle, 0.735);
  assert.match(read.blockers.join(" "), /HOD.*before the setup can pay 1R/);
  assert.match(read.body, /First obstacle: 0\.7350 \(HOD/);
  assert.match(read.body, /T1: 0\.9000/);
});

test("trade setup read does not label a sub-1.5R chart objective as T1 when no paying target exists", () => {
  const read = buildLiveWatchlistTradeSetupRead({
    symbol: "NOPAY",
    currentPrice: 0.72,
    evaluatedAt,
    thesis: thesis({ targetLow: 0.75, targetHigh: 0.76 }),
    levelMap: levelMap(0.72, 0.75),
    technicalContext,
  });

  assert.deepEqual(read.targets, []);
  assert.equal(read.firstTargetRewardRiskRatio, null);
  assert.match(read.blockers.join(" "), /no target clears 1\.5R/);
  assert.doesNotMatch(read.body, /\nT1:/);
});

test("fresh bearish higher-timeframe structure blocks an otherwise actionable long", () => {
  const read = buildLiveWatchlistTradeSetupRead({
    symbol: "BEAR",
    currentPrice: 0.72,
    evaluatedAt,
    thesis: thesis(),
    levelMap: levelMap(),
    technicalContext,
    marketStructure: marketStructureSnapshot({ timeframe: "4h", eventType: "bos_bearish" }),
  });

  assert.equal(read.state, "no_trade");
  assert.equal(read.actionable, false);
  assert.equal(read.metadata.tradeSetupMarketStructureBias, "bearish");
  assert.match(read.blockers.join(" "), /4h bearish BOS conflicts/);
  assert.match(read.body, /Market structure context: fresh 4h bearish BOS is bearish/);
});

test("fresh bullish higher-timeframe structure confirms but does not create setup geometry", () => {
  const baseline = buildLiveWatchlistTradeSetupRead({
    symbol: "BULL",
    currentPrice: 0.72,
    evaluatedAt,
    thesis: thesis(),
    levelMap: levelMap(),
    technicalContext,
  });
  const read = buildLiveWatchlistTradeSetupRead({
    symbol: "BULL",
    currentPrice: 0.72,
    evaluatedAt,
    thesis: thesis(),
    levelMap: levelMap(),
    technicalContext,
    marketStructure: marketStructureSnapshot({ timeframe: "4h", eventType: "choch_bullish" }),
  });

  assert.equal(read.state, "triggered");
  assert.equal(read.actionable, true);
  assert.deepEqual(read.zone, baseline.zone);
  assert.deepEqual(read.targets, baseline.targets);
  assert.equal(read.invalidationPrice, baseline.invalidationPrice);
  assert.match(read.evidence.join(" "), /4h bullish CHOCH supports/);
});

test("formal 5-minute BOS remains metadata-only and cannot certify a trigger", () => {
  const read = buildLiveWatchlistTradeSetupRead({
    symbol: "TACT",
    currentPrice: 0.72,
    evaluatedAt,
    thesis: thesis({ status: "watch", activeRunnerTape: undefined }),
    levelMap: levelMap(),
    technicalContext,
    marketStructure: marketStructureSnapshot({ timeframe: "5m", eventType: "bos_bullish" }),
  });

  assert.equal(read.state, "armed");
  assert.equal(read.actionable, false);
  assert.equal(read.metadata.tradeSetupMarketStructureBias, "neutral");
  assert.equal(read.metadata.tradeSetupMarketStructureTacticalFormalMetadataOnly, true);
  assert.doesNotMatch(read.body, /Market structure context:/);
});

test("fresh high-confidence stable 5-minute damage tells the long setup to wait for repair", () => {
  const read = buildLiveWatchlistTradeSetupRead({
    symbol: "DAMAGE",
    currentPrice: 0.72,
    evaluatedAt,
    thesis: thesis(),
    levelMap: levelMap(),
    technicalContext,
    marketStructure: marketStructureSnapshot({ stableState: "pivot_lost" }),
  });

  assert.equal(read.state, "no_trade");
  assert.equal(read.actionable, false);
  assert.match(read.blockers.join(" "), /5m structure just shifted to pivot lost/);
  assert.match(read.body, /5m pivot lost says wait for repair/);
});

test("reaction-backed support outranks a nearby weakly reacting level when zones compete", () => {
  const map = buildLiveWatchlistLevelMap({
    currentPrice: 0.75,
    supportZones: [
      {
        representativePrice: 0.7,
        strengthLabel: "strong",
        sourceLabel: "daily confluence",
        reactionQualityScore: 0.4,
        rejectionScore: 0.25,
        displacementScore: 0.25,
        touchCount: 6,
      },
      {
        representativePrice: 0.67,
        strengthLabel: "strong",
        sourceLabel: "daily confluence",
        reactionQualityScore: 0.82,
        rejectionScore: 0.58,
        displacementScore: 0.72,
        confluenceCount: 3,
        sourceEvidenceCount: 3,
        touchCount: 3,
      },
    ],
    resistanceZones: [
      { representativePrice: 0.9, strengthLabel: "strong", sourceLabel: "daily structure" },
    ],
    preferStructuralLevels: true,
  });
  const read = buildLiveWatchlistTradeSetupRead({
    symbol: "REACT",
    currentPrice: 0.75,
    evaluatedAt,
    thesis: thesis({
      triggerLow: 0.7,
      triggerHigh: 0.7,
      buyerResponseLow: 0.67,
      targetLow: 0.9,
      targetHigh: 0.95,
      invalidationLevel: 0.63,
      activeRunnerTape: undefined,
      status: "watch",
    }),
    levelMap: map,
    technicalContext: {
      ...technicalContext,
      currentPrice: 0.75,
      vwap: 0.671,
      ema9: null,
      ema20: null,
    },
  });

  assert.ok(read.zone);
  assert.ok(read.zone.high < 0.68);
  assert.match(read.zone.evidence.join(" "), /reaction-backed/);
});

test("trade setup mode defaults to observe and accepts explicit activation", () => {
  assert.equal(resolveLiveWatchlistTradeSetupReadMode({}), "observe");
  assert.equal(
    resolveLiveWatchlistTradeSetupReadMode({ LIVE_WATCHLIST_TRADE_SETUP_READ_MODE: "active" }),
    "active",
  );
  assert.equal(
    resolveLiveWatchlistTradeSetupReadMode({ LIVE_WATCHLIST_TRADE_SETUP_READ_MODE: "off" }),
    "off",
  );
});

test("snapshot integration records shadow analysis without changing copy and activates explicitly", () => {
  const payload: LevelSnapshotPayload = {
    symbol: "REAL",
    currentPrice: 0.72,
    timestamp: evaluatedAt,
    supportZones: [
      {
        representativePrice: 0.7,
        lowPrice: 0.697,
        highPrice: 0.703,
        strengthLabel: "strong",
        sourceLabel: "daily confluence",
        reactionQualityScore: 0.4,
        rejectionScore: 0.25,
        displacementScore: 0.25,
        touchCount: 6,
      },
      {
        representativePrice: 0.696,
        lowPrice: 0.694,
        highPrice: 0.698,
        strengthLabel: "moderate",
        sourceLabel: "daily structure",
        reactionQualityScore: 0.82,
        rejectionScore: 0.58,
        displacementScore: 0.72,
        confluenceCount: 3,
        sourceEvidenceCount: 3,
        touchCount: 3,
      },
    ],
    resistanceZones: [
      { representativePrice: 0.84, strengthLabel: "strong", sourceLabel: "daily structure" },
    ],
    potentialMoveRead: thesis(),
    tradeSetupThesisRead: thesis({
      type: "small_cap_first_pullback",
      label: "First pullback reclaim",
    }),
    marketStructure: marketStructureSnapshot({ timeframe: "4h", eventType: "choch_bullish" }),
    technicalContext,
  };

  const observed = buildLiveWatchlistSnapshotPatch(payload, {
    pullbackReadEnabled: false,
    tradeSetupReadMode: "observe",
  });
  assert.doesNotMatch(observed.cards.liveTraderRead?.body ?? "", /Trade Setup —/);
  assert.equal(observed.cards.liveTraderRead?.metadata?.tradeSetupReadMode, "observe");
  assert.equal(observed.cards.liveTraderRead?.metadata?.tradeSetupThesisSource, "v2_observation");
  assert.equal(observed.cards.liveTraderRead?.metadata?.tradeSetupType, "small_cap_first_pullback");
  assert.equal(observed.cards.liveTraderRead?.metadata?.tradeSetupState, "triggered");
  assert.equal(observed.cards.liveTraderRead?.metadata?.tradeSetupMarketStructureBias, "bullish");
  assert.equal(observed.levelMap?.supportLevels[0]?.reactionQualityScore, 0.4);
  assert.equal(observed.levelMap?.supportLevels.some((level) => level.price === 0.696), false);

  const active = buildLiveWatchlistSnapshotPatch(payload, {
    pullbackReadEnabled: false,
    tradeSetupReadMode: "active",
  });
  assert.match(active.cards.liveTraderRead?.body ?? "", /REAL Trade Setup — Triggered/);
  assert.equal(active.cards.liveTraderRead?.metadata?.tradeSetupThesisSource, "legacy");
  assert.equal(active.cards.liveTraderRead?.metadata?.tradeSetupType, "failed_breakdown_reclaim");
  assert.match(active.cards.liveTraderRead?.body ?? "", /0\.6960, reaction-backed/);
  assert.equal(active.cards.liveTraderRead?.source, "trade_setup_read");
  assert.deepEqual(active.levelMap, observed.levelMap);
  assert.equal(active.cards.fullLadder?.body, observed.cards.fullLadder?.body);
  assert.deepEqual(active.cards.marketStructure, observed.cards.marketStructure);
});

test("live refresh can publish the active trade setup even when legacy pullback copy is disabled", () => {
  const patch = buildLiveWatchlistPullbackReadPatch({
    symbol: "REAL",
    timestamp: evaluatedAt,
    currentPrice: 0.72,
    supportZones: [
      {
        representativePrice: 0.7,
        strengthLabel: "strong",
        sourceLabel: "daily confluence",
      },
    ],
    resistanceZones: [
      { representativePrice: 0.84, strengthLabel: "strong", sourceLabel: "daily structure" },
    ],
    technicalContext,
    potentialMoveRead: thesis(),
    pullbackReadEnabled: false,
    tradeSetupReadMode: "active",
  });

  assert.ok(patch);
  assert.match(patch.cards.liveTraderRead?.body ?? "", /REAL Trade Setup — Triggered/);
  assert.equal(patch.cards.liveTraderRead?.metadata?.tradeSetupActionable, true);
  assert.equal(patch.cards.liveTraderRead?.source, "trade_setup_read");
});
