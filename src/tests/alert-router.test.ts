import assert from "node:assert/strict";
import test from "node:test";

import {
  formatContinuityUpdateAsPayload,
  DiscordAlertRouter,
  formatFollowThroughStateUpdateAsPayload,
  formatFollowThroughUpdateAsPayload,
  formatIntelligentAlertAsPayload,
  formatLevelExtensionMessage,
  formatLevelLadderMessage,
  formatLevelSnapshotMessage,
  formatMarketStructureUpdateAsPayload,
  formatSymbolRecapAsPayload,
  isWatchlistTraderReadAiEnabled,
  WATCHLIST_TRADER_READ_AI_ENABLED_ENV,
} from "../lib/alerts/alert-router.js";
import type {
  AlertPayload,
  DiscordThread,
  LevelExtensionPayload,
  LevelSnapshotPayload,
} from "../lib/alerts/alert-types.js";
import type { MonitoringEvent } from "../lib/monitoring/monitoring-types.js";

class FakeDiscordThreadGateway {
  public readonly threads = new Map<string, DiscordThread>();
  public readonly sentMessages: Array<{ threadId: string; payload: AlertPayload }> = [];
  public readonly levelSnapshots: Array<{ threadId: string; payload: LevelSnapshotPayload }> = [];
  public readonly levelLadders: Array<{ threadId: string; payload: LevelSnapshotPayload }> = [];
  public readonly levelExtensions: Array<{ threadId: string; payload: LevelExtensionPayload }> = [];

  async getThreadById(threadId: string): Promise<DiscordThread | null> {
    return this.threads.get(threadId) ?? null;
  }

  async findThreadByName(name: string): Promise<DiscordThread | null> {
    return [...this.threads.values()].find((thread) => thread.name === name) ?? null;
  }

  async createThread(name: string): Promise<DiscordThread> {
    const thread = {
      id: `thread-${this.threads.size + 1}`,
      name,
    };
    this.threads.set(thread.id, thread);
    return thread;
  }

  async sendMessage(threadId: string, payload: AlertPayload): Promise<void> {
    this.sentMessages.push({ threadId, payload });
  }

  async sendLevelSnapshot(threadId: string, payload: LevelSnapshotPayload): Promise<void> {
    this.levelSnapshots.push({ threadId, payload });
  }

  async sendLevelLadder(threadId: string, payload: LevelSnapshotPayload): Promise<void> {
    this.levelLadders.push({ threadId, payload });
  }

  async sendLevelExtension(threadId: string, payload: LevelExtensionPayload): Promise<void> {
    this.levelExtensions.push({ threadId, payload });
  }
}

const samplePayload: AlertPayload = {
  title: "ALBT breakout",
  body: "resistance zone R1 at 2.4",
  event: {
    id: "evt-1",
    episodeId: "ep-1",
    symbol: "ALBT",
    type: "breakout",
    eventType: "breakout",
    zoneId: "R1",
    zoneKind: "resistance",
    level: 2.4,
    triggerPrice: 2.41,
    strength: 0.8,
    confidence: 0.8,
    priority: 1,
    bias: "bullish",
    pressureScore: 0.7,
    eventContext: {
      monitoredZoneId: "R1",
      canonicalZoneId: "R1",
      zoneFreshness: "fresh",
      zoneOrigin: "canonical",
      remapStatus: "new",
      remappedFromZoneIds: [],
      dataQualityDegraded: false,
      recentlyRefreshed: false,
      recentlyPromotedExtension: false,
      ladderPosition: "inner",
      zoneStrengthLabel: "strong",
    },
    timestamp: 1,
    notes: ["test"],
  },
};

const DISCORD_SYSTEM_LANGUAGE_PATTERN =
  /Status:|Signal:|Decision area|setup update|state update|state recap|setup move|alert direction|after the alert|thread stayed|mapped|remapped|operator-only|policy|suppression|replay|simulation|runtime-only|not a price target/i;

const DISCORD_DIRECT_ADVICE_PATTERN =
  /\b(?:buy here|buy now|sell now|sell here|take profit|stop out|trim here|add here|exit now|short setup|best entry|safe entry|can buy|should add|should trim|should exit|longs should|traders should|wait for)\b/i;

function assertTraderFacingDiscordText(payload: AlertPayload): void {
  const visibleText = `${payload.title}\n${payload.body}`;
  assert.doesNotMatch(visibleText, DISCORD_SYSTEM_LANGUAGE_PATTERN);
  assert.doesNotMatch(visibleText, DISCORD_DIRECT_ADVICE_PATTERN);
}

function mixedBiyaMarketStructure(): NonNullable<LevelSnapshotPayload["marketStructure"]> {
  return {
    timeframes: {
      "4h": {
        formal: {
          timeframe: "4h",
          bias: "range",
          previousBias: "range",
          eventType: "failed_break_low",
          eventFreshness: "prior",
          confirmation: "failed",
          confidence: "medium",
          confidenceScore: 0.55,
          materialChange: false,
          brokenSwingPrice: null,
          sweptSwingPrice: 0.785,
          protectedHigh: 0.8999,
          protectedLow: 0.785,
          latestHigh: 0.8999,
          latestLow: 0.785,
          swingSequence: ["LH", "LL"],
          structureKey: "4h|failed_break_low|range|none|BIYA:4h:external:low|0.7850",
          traderLine: "4h structure failed to hold below 0.7850.",
          debug: { candleCount: 116, reasons: ["failed_break"] },
        },
      },
      "5m": {
        formal: {
          timeframe: "5m",
          bias: "bullish_transition",
          previousBias: "range",
          eventType: "bos_bullish",
          eventFreshness: "fresh",
          confirmation: "displacement_confirmed",
          confidence: "medium",
          confidenceScore: 0.71,
          materialChange: true,
          brokenSwingPrice: 1.24,
          sweptSwingPrice: null,
          protectedHigh: 1.17,
          protectedLow: 1.11,
          latestHigh: 1.17,
          latestLow: 1.11,
          swingSequence: ["HL", "HH"],
          structureKey: "5m|bos_bullish|bullish_transition|BIYA:5m:external:high|1.240",
          traderLine: "5m structure printed bullish BOS above 1.24.",
          debug: { candleCount: 60, reasons: ["displacement_confirmed"] },
        },
      },
    },
  };
}

test("DiscordAlertRouter reuses an existing stored thread id when available", async () => {
  const gateway = new FakeDiscordThreadGateway();
  gateway.threads.set("thread-1", { id: "thread-1", name: "ALBT" });
  const router = new DiscordAlertRouter(gateway);

  const result = await router.ensureThread("albt", "thread-1");
  assert.deepEqual(result, {
    threadId: "thread-1",
    reused: true,
    recovered: false,
    created: false,
  });
});

test("DiscordAlertRouter attempts one recovery path by symbol name when stored thread reuse fails", async () => {
  const gateway = new FakeDiscordThreadGateway();
  gateway.threads.set("thread-2", { id: "thread-2", name: "BIRD" });
  const router = new DiscordAlertRouter(gateway);

  const result = await router.ensureThread("bird", "missing-thread");
  assert.deepEqual(result, {
    threadId: "thread-2",
    reused: false,
    recovered: true,
    created: false,
  });
});

test("DiscordAlertRouter creates a new symbol-named thread when no reusable thread exists", async () => {
  const gateway = new FakeDiscordThreadGateway();
  const router = new DiscordAlertRouter(gateway);

  const result = await router.ensureThread("hubc");
  assert.deepEqual(result, {
    threadId: "thread-1",
    reused: false,
    recovered: false,
    created: true,
  });
  assert.equal(gateway.threads.get("thread-1")?.name, "HUBC");
});

test("DiscordAlertRouter recovers an exact-name thread even without a stored thread id", async () => {
  const gateway = new FakeDiscordThreadGateway();
  gateway.threads.set("thread-7", { id: "thread-7", name: "CANG" });
  const router = new DiscordAlertRouter(gateway);

  const result = await router.ensureThread("cang");
  assert.deepEqual(result, {
    threadId: "thread-7",
    reused: false,
    recovered: true,
    created: false,
  });
});

test("DiscordAlertRouter routes alerts through the gateway without changing payload", async () => {
  const gateway = new FakeDiscordThreadGateway();
  const router = new DiscordAlertRouter(gateway);

  await router.routeAlert("thread-9", samplePayload);

  assert.deepEqual(gateway.sentMessages, [
    {
      threadId: "thread-9",
      payload: samplePayload,
    },
  ]);
});

test("formatIntelligentAlertAsPayload adds delivery-ready trader context", () => {
  const payload = formatIntelligentAlertAsPayload({
    id: "int-1",
    symbol: "ALBT",
    title: "ALBT breakout",
    body: "breakout resistance 2.40-2.50 | strong outermost | fresh",
    severity: "high",
    confidence: "medium",
    score: 52.345,
    shouldNotify: true,
    tags: [],
    scoreComponents: {},
    event: samplePayload.event!,
    nextBarrier: {
      side: "resistance",
      price: 2.5,
      distancePct: 0.036,
      clearanceLabel: "limited",
      clutterLabel: "stacked",
      nearbyBarrierCount: 2,
    },
    tacticalRead: "firm",
    movement: {
      label: "building",
      movementPct: 0.008,
      line: "movement: price is pushing farther above the zone high and follow-through is building (0.8%)",
    },
    pressure: {
      label: "strong",
      pressureScore: 0.74,
      line: "pressure: buyers still have strong control, backing the move",
    },
    triggerQuality: {
      label: "clean",
      line: "trigger quality: clean trigger with early movement, strong control, and limited room",
    },
    pathQuality: {
      label: "layered",
      barrierCount: 2,
      pathConstraintScore: 0.53,
      pathWindowDistancePct: 0.081,
      line: "path quality: layered route with 2 nearby barriers inside the first 8.1%, so the move may need to work through steps",
    },
    dipBuyQuality: null,
    exhaustion: {
      label: "tested",
      line: "support exhaustion: tested a few times, so it still matters but no longer behaves like untouched structure",
    },
    setupState: {
      label: "continuation",
      line: "setup state: continuation, so the move has started and now needs follow-through",
    },
    failureRisk: {
      label: "contained",
      reasons: [],
      line: "failure risk: still relatively contained while price holds this area",
    },
    target: {
      side: "resistance",
      price: 2.5,
      distancePct: 0.036,
      line: "target: first upside objective 2.50 (+3.6%)",
    },
    tradeMap: {
      label: "favorable",
      riskPct: 0.012,
      roomPct: 0.036,
      roomToRiskRatio: 3,
      line: "trade map: risk to invalidation 1.2%; room to next resistance 3.6% (~3.0x, favorable skew)",
    },
  });

  assert.equal(payload.title, "ALBT breakout");
  assert.equal(
    payload.body,
    [
      "breakout resistance 2.40-2.50 | strong outermost | fresh",
      "",
      "Price is above resistance for now.",
      "",
      "What it means:",
      "- price is pushing farther above the zone high and follow-through is building (0.8%)",
      "",
      "Key levels:",
      "- First resistance: 2.50",
      "",
      "Triggered near: 2.41",
    ].join("\n"),
  );
  assertTraderFacingDiscordText(payload);
  assert.equal(payload.metadata?.clearanceLabel, "limited");
  assert.equal(payload.metadata?.barrierClutterLabel, "stacked");
  assert.equal(payload.metadata?.nearbyBarrierCount, 2);
  assert.equal(payload.metadata?.nextBarrierSide, "resistance");
  assert.equal(payload.metadata?.nextBarrierDistancePct, 0.036);
  assert.equal(payload.metadata?.tacticalRead, "firm");
  assert.equal(payload.metadata?.movementLabel, "building");
  assert.equal(payload.metadata?.movementPct, 0.008);
  assert.equal(payload.metadata?.pressureLabel, "strong");
  assert.equal(payload.metadata?.pressureScore, 0.74);
  assert.equal(payload.metadata?.triggerQualityLabel, "clean");
  assert.equal(payload.metadata?.pathQualityLabel, "layered");
  assert.equal(payload.metadata?.pathConstraintScore, 0.53);
  assert.equal(payload.metadata?.pathWindowDistancePct, 0.081);
  assert.equal(payload.metadata?.dipBuyQualityLabel, undefined);
  assert.equal(payload.metadata?.exhaustionLabel, "tested");
  assert.equal(payload.metadata?.setupStateLabel, "continuation");
  assert.equal(payload.metadata?.failureRiskLabel, "contained");
  assert.equal(payload.metadata?.tradeMapLabel, "favorable");
  assert.equal(payload.metadata?.riskPct, 0.012);
  assert.equal(payload.metadata?.roomToRiskRatio, 3);
  assert.equal(payload.metadata?.targetSide, "resistance");
  assert.equal(payload.metadata?.targetPrice, 2.5);
  assert.equal(payload.metadata?.targetDistancePct, 0.036);
});

test("formatIntelligentAlertAsPayload shows the sixth planning level when needed for the story map", () => {
  const payload = formatIntelligentAlertAsPayload({
    id: "int-planning-six",
    symbol: "ALBT",
    title: "ALBT breakout",
    body: [
      "bullish breakout through strong resistance 2.40",
      "movement: price is pushing farther above the zone high and follow-through is building (1.0%)",
      "why now: price pushed through resistance instead of stalling under the zone",
      "room: limited overhead into next resistance 2.50 (+3.7%)",
      "watch: hold above 2.40; invalidates back below 2.40",
    ].join("\n"),
    severity: "high",
    confidence: "high",
    score: 80,
    shouldNotify: true,
    tags: [],
    scoreComponents: {},
    event: samplePayload.event!,
    zone: undefined,
    nextBarrier: {
      side: "resistance",
      price: 2.5,
      distancePct: 0.037,
      planningLevels: [
        { price: 2.5, distancePct: 0.037 },
        { price: 2.62, distancePct: 0.087 },
        { price: 2.75, distancePct: 0.141 },
        { price: 2.91, distancePct: 0.207 },
        { price: 3.06, distancePct: 0.27 },
        { price: 3.17, distancePct: 0.315 },
      ],
    },
    movement: null,
    pressure: null,
    triggerQuality: null,
    pathQuality: null,
    dipBuyQuality: null,
    exhaustion: null,
    setupState: null,
    failureRisk: null,
    target: null,
    tradeMap: null,
  });

  assert.match(payload.body, /Resistance map: 2\.50 \(\+3\.7%\) -> .* -> 3\.17 \(\+31\.5%\)/);
  assertTraderFacingDiscordText(payload);
});

test("formatIntelligentAlertAsPayload adds upside resistance map to resistance-touch stories", () => {
  const touchEvent: MonitoringEvent = {
    ...samplePayload.event!,
    id: "evt-resistance-touch-map",
    episodeId: "ep-resistance-touch-map",
    type: "level_touch",
    eventType: "level_touch",
    zoneKind: "resistance",
    level: 2.4,
    triggerPrice: 2.41,
  };
  const payload = formatIntelligentAlertAsPayload({
    id: "int-resistance-touch-map",
    symbol: "ALBT",
    title: "ALBT level touch",
    body: [
      "price testing strong resistance 2.40",
      "why now: price is back at resistance; buyers need acceptance above the zone",
      "room: limited lower support into support near 2.25 (-6.6%)",
      "watch: buyers need acceptance above 2.40 before breakout pressure builds",
    ].join("\n"),
    severity: "medium",
    confidence: "medium",
    score: 48,
    shouldNotify: true,
    tags: [],
    scoreComponents: {},
    event: touchEvent,
    zone: {
      zoneLow: 2.38,
      zoneHigh: 2.42,
      representativePrice: 2.4,
      strengthLabel: "strong",
      kind: "resistance",
    } as any,
    nextBarrier: {
      side: "support",
      price: 2.25,
      distancePct: 0.066,
      planningLevels: [
        { price: 2.25, distancePct: 0.066 },
        { price: 2.08, distancePct: 0.137 },
        { price: 1.95, distancePct: 0.191 },
      ],
    },
    continuationBarrier: {
      side: "resistance",
      price: 2.55,
      distancePct: 0.058,
      planningLevels: [
        { price: 2.55, distancePct: 0.058 },
        { price: 2.75, distancePct: 0.141 },
        { price: 2.98, distancePct: 0.237 },
        { price: 3.17, distancePct: 0.315 },
      ],
    },
    movement: null,
    pressure: null,
    triggerQuality: null,
    pathQuality: null,
    dipBuyQuality: null,
    exhaustion: null,
    setupState: null,
    failureRisk: null,
    target: null,
    tradeMap: null,
  });

  assert.match(payload.body, /Key levels:\n- Testing resistance: 2\.38-2\.42\n- Nearby support: 2\.25\n- Resistance map: 2\.55 \(\+5\.8%\).*3\.17 \(\+31\.5%\)\n- Support map: 2\.25 \(-6\.6%\)/);
  assert.equal(payload.metadata?.continuationBarrierSide, "resistance");
  assertTraderFacingDiscordText(payload);
});

test("formatIntelligentAlertAsPayload keeps quiet market structure in metadata without repeating the story", () => {
  const payload = formatIntelligentAlertAsPayload({
    id: "int-structure",
    symbol: "ALBT",
    title: "ALBT breakout",
    body: "bullish breakout through heavy resistance 2.40-2.50\nmarket structure: resistance is trying to become support; holding above 2.50 keeps the structure improving",
    severity: "high",
    confidence: "medium",
    score: 55,
    shouldNotify: true,
    tags: [],
    scoreComponents: {},
    event: {
      ...samplePayload.event!,
      eventContext: {
        ...samplePayload.event!.eventContext,
        marketStructureType: "breakout_setup",
        marketStructureStrength: 0.86,
      },
    },
    zone: {
      id: "R1",
      symbol: "ALBT",
      kind: "resistance",
      timeframeBias: "5m",
      zoneLow: 2.4,
      zoneHigh: 2.5,
      representativePrice: 2.45,
      strengthScore: 75,
      strengthLabel: "strong",
      touchCount: 3,
      confluenceCount: 1,
      sourceTypes: ["swing_high"],
      timeframeSources: ["5m"],
      reactionQualityScore: 0.7,
      rejectionScore: 0.4,
      displacementScore: 0.6,
      sessionSignificanceScore: 0.4,
      followThroughScore: 0.65,
      gapContinuationScore: 0,
      sourceEvidenceCount: 3,
      firstTimestamp: 1,
      lastTimestamp: 1,
      isExtension: false,
      freshness: "fresh",
      notes: [],
    },
    nextBarrier: {
      side: "resistance",
      price: 2.82,
      distancePct: 0.13,
      clearanceLabel: "open",
      clutterLabel: "clear",
      nearbyBarrierCount: 1,
    },
    movement: {
      label: "early",
      movementPct: 0.004,
      line: "movement: price is still just above the zone high, so the breakout is early (0.4%)",
    },
    pressure: {
      label: "moderate",
      pressureScore: 0.58,
      line: "pressure: buyers still have workable control, but follow-through still matters",
    },
    marketStructure: {
      label: "bullish_building",
      structureType: "breakout_setup",
      strength: 0.86,
      line: "market structure: resistance is trying to become support; holding above 2.50 keeps the structure improving",
    },
  });

  assert.doesNotMatch(payload.body, /resistance is trying to become support; holding above 2\.50 keeps the structure improving/);
  assert.equal(payload.metadata?.marketStructureLabel, "bullish_building");
  assert.equal(payload.metadata?.marketStructureType, "breakout_setup");
  assert.equal(payload.metadata?.marketStructureStrength, 0.86);
  assert.equal(payload.metadata?.marketStructureStoryVisible, false);
  assertTraderFacingDiscordText(payload);
});

test("formatIntelligentAlertAsPayload keeps market structure visible when summary bullets are full", () => {
  const payload = formatIntelligentAlertAsPayload({
    id: "int-structure-full-summary",
    symbol: "ALBT",
    title: "ALBT breakout",
    body: [
      "bullish breakout through heavy resistance 2.40-2.50",
      "why now: price cleared resistance instead of stalling underneath it",
      "movement: price is pushing farther above the zone high and follow-through is building (1.1%)",
      "room: open room into next resistance 2.82 (+12.0%)",
      "market structure: 5m structure is trying to hold above the prior range; staying above 2.50 keeps the breakout attempt cleaner",
      "watch: hold above 2.50; invalidates back below 2.40",
    ].join("\n"),
    severity: "high",
    confidence: "high",
    score: 78,
    shouldNotify: true,
    tags: [],
    scoreComponents: {},
    event: {
      ...samplePayload.event!,
      eventContext: {
        ...samplePayload.event!.eventContext,
        stableMarketStructureState: "breakout_holding",
        stableMarketStructurePreviousState: "pressing_range_high",
        stableMarketStructureMaterialChange: true,
        stableMarketStructureConfidence: "high",
        stableMarketStructureMaterialityScore: 0.82,
      },
    },
    nextBarrier: {
      side: "resistance",
      price: 2.82,
      distancePct: 0.12,
      clearanceLabel: "open",
      clutterLabel: "clear",
      nearbyBarrierCount: 1,
    },
    movement: {
      label: "building",
      movementPct: 0.011,
      line: "movement: price is pushing farther above the zone high and follow-through is building (1.1%)",
    },
    pressure: {
      label: "strong",
      pressureScore: 0.74,
      line: "pressure: buyers still have strong control, backing the move",
    },
    marketStructure: {
      label: "bullish_building",
      line: "market structure: 5m structure is trying to hold above the prior range; staying above 2.50 keeps the breakout attempt cleaner",
    },
  });

  assert.match(
    payload.body,
    /Structure:\n- 5m structure is trying to hold above the prior range; staying above 2\.50 keeps the breakout attempt cleaner/,
  );
  assert.equal(payload.metadata?.stableMarketStructureState, "breakout_holding");
  assert.equal(payload.metadata?.stableMarketStructureMaterialChange, true);
  assertTraderFacingDiscordText(payload);
});

test("formatIntelligentAlertAsPayload shows structure section from event metadata even without trader marketStructure text", () => {
  const payload = formatIntelligentAlertAsPayload({
    id: "int-structure-metadata-visible",
    symbol: "ALBT",
    title: "ALBT breakout",
    body: [
      "bullish breakout through heavy resistance 2.40-2.50",
      "movement: price is pushing farther above the zone high and follow-through is building (1.1%)",
      "why now: price cleared resistance instead of stalling underneath it",
      "room: open room into next resistance 2.82 (+12.0%)",
    ].join("\n"),
    severity: "high",
    confidence: "high",
    score: 78,
    shouldNotify: true,
    tags: [],
    scoreComponents: {},
    event: {
      ...samplePayload.event!,
      eventContext: {
        ...samplePayload.event!.eventContext,
        formalStructureTimeframe: "5m",
        formalStructureBias: "bullish",
        formalStructurePreviousBias: "bullish",
        formalStructureEventType: "bos_bullish",
        formalStructureConfirmation: "close_confirmed",
        formalStructureConfidence: "medium",
        formalStructureConfidenceScore: 0.65,
        formalStructureMaterialChange: true,
        formalStructureBrokenSwingPrice: 2.37,
        formalStructureProtectedLow: 2.22,
        stableMarketStructureState: "breakout_holding",
        stableMarketStructurePreviousState: "pressing_range_high",
        stableMarketStructureMaterialChange: true,
        stableMarketStructureConfidence: "high",
        stableMarketStructureLatestSwingLow: 2.22,
        stableMarketStructureLatestSwingHigh: 2.37,
      },
    },
    nextBarrier: {
      side: "resistance",
      price: 2.82,
      distancePct: 0.12,
      clearanceLabel: "open",
      clutterLabel: "clear",
      nearbyBarrierCount: 1,
    },
    movement: {
      label: "building",
      movementPct: 0.011,
      line: "movement: price is pushing farther above the zone high and follow-through is building (1.1%)",
    },
  });

  assert.match(payload.body, /Structure:/);
  assert.match(payload.body, /formal 5m: bos bullish \(medium, close confirmed\); bias bullish; broken 2\.37, protected low 2\.22/);
  assert.match(payload.body, /stable 5m: breakout holding \(high\); previous pressing range high; material yes; latest low 2\.22, latest high 2\.37/);
  assert.equal(payload.metadata?.marketStructureStoryVisible, true);
  assert.equal(payload.metadata?.formalStructureEventType, "bos_bullish");
  assert.equal(payload.metadata?.stableMarketStructureState, "breakout_holding");
  assertTraderFacingDiscordText(payload);
});

test("formatIntelligentAlertAsPayload shows explicit HTF gap when only tactical structure is available", () => {
  const payload = formatIntelligentAlertAsPayload({
    id: "int-structure-tactical-only",
    symbol: "ALBT",
    title: "ALBT breakout",
    body: [
      "bullish breakout through heavy resistance 2.40-2.50",
      "movement: price is pushing farther above the zone high and follow-through is building (1.1%)",
      "why now: price cleared resistance instead of stalling underneath it",
    ].join("\n"),
    severity: "high",
    confidence: "high",
    score: 78,
    shouldNotify: true,
    tags: [],
    scoreComponents: {},
    event: {
      ...samplePayload.event!,
      eventContext: {
        ...samplePayload.event!.eventContext,
        runtimeMarketStructure: {
          stable: {
            state: "breakout_holding",
            previousState: "pressing_range_high",
            structureKey: "breakout_holding|low:2.22|high:2.37",
            materialChange: true,
            confidence: "high",
            materialityScore: 0.82,
            rawState: "breakout_holding",
            reason: "high_materiality_change",
            candleCount: 32,
            latestSwingLow: 2.22,
            latestSwingHigh: 2.37,
          },
          timeframes: {
            "5m": {
              stable: {
                state: "breakout_holding",
                previousState: "pressing_range_high",
                structureKey: "breakout_holding|low:2.22|high:2.37",
                materialChange: true,
                confidence: "high",
                materialityScore: 0.82,
                rawState: "breakout_holding",
                reason: "high_materiality_change",
                candleCount: 32,
                latestSwingLow: 2.22,
                latestSwingHigh: 2.37,
              },
            },
          },
        },
      },
    },
    nextBarrier: {
      side: "resistance",
      price: 2.82,
      distancePct: 0.12,
      clearanceLabel: "open",
      clutterLabel: "clear",
      nearbyBarrierCount: 1,
    },
  });

  assert.match(payload.body, /HTF 4h: waiting for seeded\/historical candles/);
  assert.match(payload.body, /Tactical 5m: stable breakout holding \(high\); latest low 2\.22, latest high 2\.37/);
  assert.equal(payload.metadata?.marketStructureStoryVisible, true);
  assert.equal(payload.metadata?.runtimeMarketStructure?.timeframes?.["5m"]?.stable?.state, "breakout_holding");
  assertTraderFacingDiscordText(payload);
});

test("formatIntelligentAlertAsPayload scopes visible runtime structure to story keys", () => {
  const storyKeys = ["5m|formal|5m|bos_bullish|bullish_transition|BIYA:5m:external:high|1.240"];
  const payload = formatIntelligentAlertAsPayload({
    id: "int-structure-scoped-story",
    symbol: "BIYA",
    title: "BIYA breakout",
    body: [
      "bullish breakout through resistance near 1.24",
      "movement: price cleared the nearby resistance and is trying to hold above it",
      "why now: fresh 5m structure confirmed the break",
    ].join("\n"),
    severity: "high",
    confidence: "high",
    score: 80,
    shouldNotify: true,
    tags: [],
    scoreComponents: {},
    event: {
      ...samplePayload.event!,
      symbol: "BIYA",
      triggerPrice: 1.25,
      eventContext: {
        ...samplePayload.event!.eventContext,
        runtimeMarketStructure: mixedBiyaMarketStructure(),
      },
    },
    nextBarrier: {
      side: "resistance",
      price: 1.32,
      distancePct: 0.056,
      clearanceLabel: "open",
      clutterLabel: "clear",
      nearbyBarrierCount: 1,
    },
  }, {
    marketStructureStoryVisibility: "always",
    marketStructureStoryKeys: storyKeys,
  });

  assert.doesNotMatch(payload.body, /HTF 4h:/);
  assert.doesNotMatch(payload.body, /0\.7850/);
  assert.match(payload.body, /Tactical 5m: fresh bullish BOS \(medium, displacement confirmed\)/);
  assert.match(payload.body, /broken 1\.24, protected low 1\.11/);
  assert.deepEqual(payload.metadata?.marketStructureStoryKeys, storyKeys);
  assertTraderFacingDiscordText(payload);
});

test("formatIntelligentAlertAsPayload can expose full market structure debug details when enabled", () => {
  const previous = process.env.MARKET_STRUCTURE_DISCORD_DEBUG;
  process.env.MARKET_STRUCTURE_DISCORD_DEBUG = "1";
  try {
    const payload = formatIntelligentAlertAsPayload({
      id: "int-structure-debug",
      symbol: "ALBT",
      title: "ALBT breakout",
      body: [
        "bullish breakout through heavy resistance 2.40-2.50",
        "market structure: 5m structure is trying to hold above the prior range; staying above 2.50 keeps the breakout attempt cleaner",
      ].join("\n"),
      severity: "high",
      confidence: "high",
      score: 78,
      shouldNotify: true,
      tags: [],
      scoreComponents: {},
      event: {
        ...samplePayload.event!,
        eventContext: {
          ...samplePayload.event!.eventContext,
          stableMarketStructureState: "breakout_holding",
          stableMarketStructureRawState: "breakout_attempt",
          stableMarketStructurePreviousState: "pressing_range_high",
          stableMarketStructureMaterialChange: true,
          stableMarketStructureConfidence: "high",
          stableMarketStructureMaterialityScore: 0.82,
          stableMarketStructureReason: "high_materiality_change",
          stableMarketStructureCandleCount: 32,
          stableMarketStructureRawRunLength: 2,
          stableMarketStructureTrendDirection: "uptrend",
          stableMarketStructureHigherLowCount: 3,
          stableMarketStructureHigherHighCount: 2,
          stableMarketStructureLowerHighCount: 0,
          stableMarketStructureLowerLowCount: 0,
          stableMarketStructureLatestSwingLow: 2.31,
          stableMarketStructureLatestSwingHigh: 2.48,
          stableMarketStructurePriorSwingLow: 2.18,
          stableMarketStructurePriorSwingHigh: 2.4,
          stableMarketStructureActiveRangeLow: 2.18,
          stableMarketStructureActiveRangeHigh: 2.5,
          stableMarketStructureActiveRangeWidthPct: 0.1468,
          stableMarketStructureActiveRangeQuality: "clean",
          stableMarketStructurePivotEventType: "reclaim",
          stableMarketStructurePivotEventTriggerPrice: 2.5,
          stableMarketStructureKey: "breakout_holding|range:2.18-2.50",
        },
      },
      marketStructure: {
        label: "bullish_building",
        line: "market structure: 5m structure is trying to hold above the prior range; staying above 2.50 keeps the breakout attempt cleaner",
      },
    });

    assert.match(payload.body, /Structure details:/);
    assert.match(payload.body, /state=breakout_holding; raw=breakout_attempt; previous=pressing_range_high; material=yes/);
    assert.match(payload.body, /trend=uptrend; HL=3; HH=2; LH=0; LL=0/);
    assert.match(payload.body, /pivots=latest low 2\.31, high 2\.48; prior low 2\.18, high 2\.40/);
    assert.match(payload.body, /range=2\.18-2\.50; width=14\.7%; quality=clean/);
    assert.match(payload.body, /pivot_event=reclaim; trigger=2\.50/);
    assert.equal(payload.metadata?.stableMarketStructureTrendDirection, "uptrend");
    assert.equal(payload.metadata?.stableMarketStructureLatestSwingLow, 2.31);
    assertTraderFacingDiscordText(payload);
  } finally {
    if (previous === undefined) {
      delete process.env.MARKET_STRUCTURE_DISCORD_DEBUG;
    } else {
      process.env.MARKET_STRUCTURE_DISCORD_DEBUG = previous;
    }
  }
});

test("formatIntelligentAlertAsPayload includes formal BOS/CHOCH metadata and debug details", () => {
  const previous = process.env.MARKET_STRUCTURE_DISCORD_DEBUG;
  process.env.MARKET_STRUCTURE_DISCORD_DEBUG = "1";
  try {
    const payload = formatIntelligentAlertAsPayload({
      id: "int-formal-structure-debug",
      symbol: "ALBT",
      title: "ALBT breakout",
      body: [
        "bullish breakout through heavy resistance 2.40-2.50",
        "market structure: 5m structure printed bullish BOS above 2.36; 2.08 is the protected structure low.",
      ].join("\n"),
      severity: "high",
      confidence: "high",
      score: 82,
      shouldNotify: true,
      tags: [],
      scoreComponents: {},
      event: {
        ...samplePayload.event!,
        eventContext: {
          ...samplePayload.event!.eventContext,
          formalStructureTimeframe: "5m",
          formalStructureBias: "bullish",
          formalStructurePreviousBias: "bullish",
          formalStructureEventType: "bos_bullish",
          formalStructureConfirmation: "displacement_confirmed",
          formalStructureConfidence: "high",
          formalStructureConfidenceScore: 0.88,
          formalStructureMaterialChange: true,
          formalStructureBrokenSwingPrice: 2.36,
          formalStructureProtectedHigh: 2.36,
          formalStructureProtectedLow: 2.08,
          formalStructureLatestHigh: 2.36,
          formalStructureLatestLow: 2.18,
          formalStructureSwingSequence: ["H", "L", "HH", "HL", "HH"],
          formalStructureKey: "5m|bos_bullish|bullish|bullish|event",
          formalStructureDebugReasons: ["trend_continuation", "displacement_confirmed"],
          selectedFormalStructureTimeframe: "5m",
          selectedFormalStructureBias: "bullish",
          selectedFormalStructurePreviousBias: "bullish",
          selectedFormalStructureEventType: "bos_bullish",
          selectedFormalStructureConfirmation: "displacement_confirmed",
          selectedFormalStructureConfidence: "high",
          selectedFormalStructureConfidenceScore: 0.88,
          selectedFormalStructureMaterialChange: true,
          selectedFormalStructureBrokenSwingPrice: 2.36,
          selectedFormalStructureProtectedLow: 2.08,
          selectedFormalStructureKey: "5m|bos_bullish|bullish|bullish|event",
        },
      },
      marketStructure: {
        label: "bullish_building",
        line: "market structure: 5m structure printed bullish BOS above 2.36; 2.08 is the protected structure low.",
      },
    });

    assert.match(payload.body, /Structure details:/);
    assert.match(payload.body, /formal=5m bos_bullish; bias=bullish->bullish; material=yes/);
    assert.match(payload.body, /formal_confidence=high; score=0\.880; confirmation=displacement_confirmed/);
    assert.match(payload.body, /formal_levels=broken 2\.36, swept n\/a; protected high 2\.36, low 2\.08; latest high 2\.36, low 2\.18/);
    assert.match(payload.body, /formal_swings=H -> L -> HH -> HL -> HH/);
    assert.match(payload.body, /formal_reasons=trend_continuation,displacement_confirmed/);
    assert.equal(payload.metadata?.formalStructureEventType, "bos_bullish");
    assert.equal(payload.metadata?.formalStructureMaterialChange, true);
    assert.equal(payload.metadata?.formalStructureBrokenSwingPrice, 2.36);
    assert.equal(payload.metadata?.selectedFormalStructureEventType, "bos_bullish");
    assert.equal(payload.metadata?.selectedFormalStructureTimeframe, "5m");
    assert.equal(payload.metadata?.selectedFormalStructureBrokenSwingPrice, 2.36);
    assert.match(payload.metadata?.whyPosted ?? "", /formal 5m bos_bullish event/);
    assertTraderFacingDiscordText(payload);
  } finally {
    if (previous === undefined) {
      delete process.env.MARKET_STRUCTURE_DISCORD_DEBUG;
    } else {
      process.env.MARKET_STRUCTURE_DISCORD_DEBUG = previous;
    }
  }
});

test("formatIntelligentAlertAsPayload can include gated volume activity context", () => {
  const payload = formatIntelligentAlertAsPayload({
    id: "int-volume",
    symbol: "ALBT",
    title: "ALBT breakout",
    body: [
      "bullish breakout through heavy resistance 2.40-2.50",
      "activity: activity is expanding into the move, which makes the breakout attempt more meaningful",
    ].join("\n"),
    severity: "high",
    confidence: "medium",
    score: 55,
    shouldNotify: true,
    tags: [],
    scoreComponents: {},
    event: {
      ...samplePayload.event!,
      eventContext: {
        ...samplePayload.event!.eventContext,
        volumeActivity: {
          label: "expanding",
          reliability: "reliable",
          currentBucketVolume: 1500,
          baselineAverageVolume: 1000,
          relativeVolumeRatio: 1.5,
          direction: "increasing",
          reason: "current 5m bucket is 1.50x recent average",
          traderLine:
            "activity: activity is expanding into the move, which makes the breakout attempt more meaningful",
        },
      },
    },
    volumeActivity: {
      label: "expanding",
      reliability: "reliable",
      currentBucketVolume: 1500,
      baselineAverageVolume: 1000,
      relativeVolumeRatio: 1.5,
      direction: "increasing",
      reason: "current 5m bucket is 1.50x recent average",
      traderLine:
        "activity: activity is expanding into the move, which makes the breakout attempt more meaningful",
    },
  });

  assert.match(payload.body, /activity is expanding into the move/);
  assert.doesNotMatch(payload.body, /confirms|guarantees|best entry|buy now/i);
  assert.equal(payload.metadata?.volumeActivityLabel, "expanding");
  assert.equal(payload.metadata?.volumeActivityReliability, "reliable");
  assert.equal(payload.metadata?.volumeActivityRatio, 1.5);
  assert.equal(payload.metadata?.volumeActivityDirection, "increasing");
  assert.equal(payload.metadata?.volumeActivityShown, true);
  assertTraderFacingDiscordText(payload);
});

test("formatIntelligentAlertAsPayload shows reclaim area and nearby support for long-caution alerts", () => {
  const breakdownEvent = {
    ...samplePayload.event!,
    id: "evt-breakdown",
    episodeId: "ep-breakdown",
    type: "breakdown" as const,
    eventType: "breakdown" as const,
    zoneKind: "support" as const,
    triggerPrice: 1.23,
    bias: "bearish" as const,
  };
  const payload = formatIntelligentAlertAsPayload({
    id: "int-breakdown",
    symbol: "ATER",
    title: "ATER breakdown",
    body: "support lost at moderate support 1.24",
    severity: "medium",
    confidence: "medium",
    score: 45.8,
    shouldNotify: true,
    tags: [],
    scoreComponents: {},
    event: breakdownEvent,
    zone: {
      id: "S1",
      symbol: "ATER",
      kind: "support",
      timeframeBias: "5m",
      zoneLow: 1.24,
      zoneHigh: 1.24,
      representativePrice: 1.24,
      strengthScore: 10,
      strengthLabel: "moderate",
      touchCount: 1,
      confluenceCount: 1,
      sourceTypes: ["swing_low"],
      timeframeSources: ["5m"],
      reactionQualityScore: 0.5,
      rejectionScore: 0.4,
      displacementScore: 0.4,
      sessionSignificanceScore: 0.2,
      followThroughScore: 0.5,
      gapContinuationScore: 0,
      sourceEvidenceCount: 1,
      firstTimestamp: 1,
      lastTimestamp: 1,
      isExtension: false,
      freshness: "fresh",
      notes: [],
    },
    nextBarrier: {
      side: "support",
      price: 1.06,
      strengthLabel: "weak",
      distancePct: 0.138,
      clearanceLabel: "open",
      clutterLabel: "clear",
      nearbyBarrierCount: 1,
    },
    movement: {
      label: "building",
      movementPct: 0.01,
      line: "movement: price is moving farther below support, increasing risk for longs (1.0%)",
    },
    pressure: {
      label: "moderate",
      pressureScore: 0.55,
      line: "pressure: buyers still need to reclaim control",
    },
    triggerQuality: null,
    pathQuality: null,
    dipBuyQuality: null,
    exhaustion: null,
    setupState: null,
    failureRisk: null,
    target: null,
    tradeMap: null,
  });

  assert.match(payload.body, /What to watch:\n- nearby support reaction area: light support 1\.06; buyers need stabilization there or a reclaim of the lost support area/);
  assert.match(payload.body, /Hold \/ failure map:\n- 1\.24 is the repair area for the long setup; if that whole area keeps failing cleanly, next broader support is light support 1\.06\./);
  assert.match(payload.body, /Key levels:\n- Reclaim area: moderate resistance 1\.24\n- Nearby support: light support 1\.06/);
  assert.doesNotMatch(payload.body, /Risk support/);
  assert.doesNotMatch(payload.body, /dip-buy/i);
  assert.doesNotMatch(payload.body, /Nearby resistance/);
  assert.doesNotMatch(payload.body, /\b(Buy|Sell|buy at|sell if|take profit|stop out)\b/);
  assertTraderFacingDiscordText(payload);
});

test("formatIntelligentAlertAsPayload describes high failure risk as fragile setup quality", () => {
  const breakdownEvent = {
    ...samplePayload.event!,
    id: "evt-breakdown-risk",
    episodeId: "ep-breakdown-risk",
    type: "breakdown" as const,
    eventType: "breakdown" as const,
    zoneKind: "support" as const,
    level: 1.02,
    triggerPrice: 1,
    bias: "bearish" as const,
  };
  const payload = formatIntelligentAlertAsPayload({
    id: "int-breakdown-risk",
    symbol: "CYCU",
    title: "CYCU breakdown",
    body: "support lost at major support 1.01-1.02",
    severity: "high",
    confidence: "medium",
    score: 54,
    shouldNotify: true,
    tags: [],
    scoreComponents: {},
    event: breakdownEvent,
    zone: {
      zoneLow: 1.01,
      zoneHigh: 1.02,
      representativePrice: 1.02,
      strengthLabel: "major",
      kind: "support",
    } as any,
    movement: {
      label: "early",
      movementPct: 0.005,
      line: "movement: price is still just below the support floor, so the setup needs a reclaim (0.5%)",
    },
    failureRisk: {
      label: "high",
      reasons: ["crowded trigger", "tight room", "dense nearby barriers", "degraded data", "inner setup"],
      line: "failure risk: high because crowded trigger, tight room, dense nearby barriers, degraded data, inner setup",
    },
  });

  assert.match(payload.body, /setup is fragile here: crowded trigger, tight room, dense nearby barriers, degraded data, inner setup/);
  assert.doesNotMatch(payload.body, /risk is high:/);
  assertTraderFacingDiscordText(payload);
});

test("formatIntelligentAlertAsPayload does not overstate high risk for tiny small-cap probes inside a box", () => {
  const breakdownEvent: MonitoringEvent = {
    ...samplePayload.event!,
    id: "evt-small-probe-risk",
    episodeId: "ep-small-probe-risk",
    type: "breakdown" as const,
    eventType: "breakdown" as const,
    zoneKind: "support" as const,
    level: 1.02,
    triggerPrice: 1,
    bias: "bearish" as const,
    eventContext: {
      ...samplePayload.event!.eventContext,
      acceptance: { label: "weak_probe", beyondZonePct: 0.5, reasons: [] },
      rangeBox: { label: "active", low: 0.98, high: 1.06, widthPct: 8, recentInsidePostCount: 4 },
      behaviorBudget: { label: "boring_range", maxUsefulPostsPerDay: 6, maxRangePosts: 2, reasons: [] },
    },
  };
  const payload = formatIntelligentAlertAsPayload({
    id: "int-small-probe-risk",
    symbol: "CYCU",
    title: "CYCU breakdown",
    body: "support lost at major support 1.01-1.02",
    severity: "high",
    confidence: "medium",
    score: 54,
    shouldNotify: true,
    tags: [],
    scoreComponents: {},
    event: breakdownEvent,
    zone: {
      zoneLow: 1.01,
      zoneHigh: 1.02,
      representativePrice: 1.02,
      strengthLabel: "major",
      kind: "support",
    } as any,
    movement: {
      label: "early",
      movementPct: 0.005,
      line: "movement: price is only slightly below support, so the support loss still needs proof",
    },
    failureRisk: {
      label: "high",
      reasons: ["crowded trigger", "tight room", "dense nearby barriers", "degraded data", "inner setup"],
      line: "failure risk: high because crowded trigger, tight room, dense nearby barriers, degraded data, inner setup",
    },
    tradeMap: {
      label: "tight_risk",
      riskPct: 0.01,
      roomToRiskRatio: 1,
      line: "trade map: tight risk",
    } as any,
  });

  assert.doesNotMatch(payload.body, /setup is fragile here/);
  assertTraderFacingDiscordText(payload);
});

test("formatIntelligentAlertAsPayload describes support reclaims without resistance status wording", () => {
  const reclaimEvent = {
    ...samplePayload.event!,
    id: "evt-reclaim",
    episodeId: "ep-reclaim",
    type: "reclaim" as const,
    eventType: "reclaim" as const,
    zoneKind: "support" as const,
    level: 1.24,
    triggerPrice: 1.27,
    bias: "bullish" as const,
  };

  const payload = formatIntelligentAlertAsPayload({
    id: "int-reclaim",
    symbol: "ATER",
    title: "ATER reclaim",
    body: "reclaim back above moderate support 1.24",
    severity: "medium",
    confidence: "medium",
    score: 48,
    shouldNotify: true,
    tags: [],
    scoreComponents: {},
    event: reclaimEvent,
    zone: {
      zoneLow: 1.22,
      zoneHigh: 1.24,
      representativePrice: 1.24,
    } as any,
  });

  assert.match(payload.body, /Price reclaimed support for now\./);
  assert.doesNotMatch(payload.body, /Price is above resistance for now/);
  assertTraderFacingDiscordText(payload);
});

test("formatIntelligentAlertAsPayload shows tested resistance and nearby support for resistance touches", () => {
  const touchEvent = {
    ...samplePayload.event!,
    id: "evt-touch",
    episodeId: "ep-touch",
    type: "level_touch" as const,
    eventType: "level_touch" as const,
    zoneKind: "resistance" as const,
    level: 2.62,
    triggerPrice: 2.61,
    bias: "neutral" as const,
  };
  const payload = formatIntelligentAlertAsPayload({
    id: "int-touch",
    symbol: "SAGT",
    title: "SAGT level touch",
    body: [
      "price testing major resistance 2.61-2.64",
      "pressure: buying and selling pressure still look balanced",
      "why now: price is back at resistance; buyers need acceptance above the zone",
      "room: open lower support path to support near 2.16 (-17.2%)",
      "watch: buyers need acceptance above 2.64 before breakout pressure builds",
    ].join("\n"),
    severity: "critical",
    confidence: "high",
    score: 72,
    shouldNotify: true,
    tags: [],
    scoreComponents: {},
    event: touchEvent,
    zone: {
      id: "R1",
      symbol: "SAGT",
      kind: "resistance",
      timeframeBias: "5m",
      zoneLow: 2.61,
      zoneHigh: 2.64,
      representativePrice: 2.62,
      strengthScore: 10,
      strengthLabel: "major",
      touchCount: 1,
      confluenceCount: 1,
      sourceTypes: ["swing_high"],
      timeframeSources: ["5m"],
      reactionQualityScore: 0.5,
      rejectionScore: 0.4,
      displacementScore: 0.4,
      sessionSignificanceScore: 0.2,
      followThroughScore: 0.5,
      gapContinuationScore: 0,
      sourceEvidenceCount: 1,
      firstTimestamp: 1,
      lastTimestamp: 1,
      isExtension: false,
      freshness: "fresh",
      notes: [],
    },
    nextBarrier: {
      side: "support",
      price: 2.16,
      distancePct: -0.172,
      clearanceLabel: "open",
      clutterLabel: "clear",
      nearbyBarrierCount: 1,
    },
    movement: null,
    pressure: {
      label: "balanced",
      pressureScore: 0.5,
      line: "pressure: buying and selling pressure still look balanced",
    },
    triggerQuality: null,
    pathQuality: null,
    dipBuyQuality: null,
    exhaustion: null,
    setupState: null,
    failureRisk: null,
    target: null,
    tradeMap: null,
  });

  assert.match(payload.body, /Key levels:\n- Testing resistance: 2\.61-2\.64\n- Nearby support: 2\.16/);
  assert.doesNotMatch(payload.body, /Next levels:/);
  assert.match(payload.body, /buyers still need stronger acceptance/);
  assert.doesNotMatch(payload.body, /buyers and sellers are still balanced/);
  assert.match(payload.body, /buyers need acceptance above 2\.64/);
  assertTraderFacingDiscordText(payload);
});

test("formatIntelligentAlertAsPayload shows cleared resistance below price as a hold area", () => {
  const payload = formatIntelligentAlertAsPayload({
    id: "int-role-flip",
    symbol: "AKAN",
    title: "AKAN level touch",
    body: [
      "price testing moderate resistance 62.55",
      "pressure: buyers are present, but control still looks tentative",
      "why now: price is back at resistance; buyers need acceptance above the zone",
      "room: open lower path to hold area near 55.13 (-11.9%)",
      "watch: buyers need acceptance above 62.55 before breakout pressure builds",
    ].join("\n"),
    severity: "high",
    confidence: "high",
    score: 61.38,
    shouldNotify: true,
    tags: [],
    scoreComponents: {},
    event: {
      ...samplePayload.event!,
      symbol: "AKAN",
      eventType: "level_touch",
      type: "level_touch",
      zoneId: "R-test",
      zoneKind: "resistance",
      level: 62.55,
      triggerPrice: 62.49,
    },
    zone: {
      id: "R-test",
      symbol: "AKAN",
      kind: "resistance",
      timeframeBias: "daily",
      zoneLow: 62.4,
      zoneHigh: 62.55,
      representativePrice: 62.55,
      strengthScore: 35,
      strengthLabel: "moderate",
      touchCount: 3,
      confluenceCount: 1,
      sourceTypes: ["swing_high"],
      timeframeSources: ["daily"],
      reactionQualityScore: 0.62,
      rejectionScore: 0.4,
      displacementScore: 0.55,
      sessionSignificanceScore: 0.25,
      followThroughScore: 0.7,
      gapContinuationScore: 0,
      sourceEvidenceCount: 2,
      firstTimestamp: 1,
      lastTimestamp: 2,
      isExtension: false,
      freshness: "fresh",
      notes: [],
    },
    nextBarrier: {
      side: "support",
      price: 55.13,
      distancePct: 0.119,
      strengthLabel: "strong",
      roleFlipFromSide: "resistance",
      clearanceLabel: "open",
      clutterLabel: "clear",
      nearbyBarrierCount: 1,
    },
  });

  assert.match(payload.body, /hold area near 55\.13/);
  assert.match(payload.body, /Key levels:\n- Testing resistance: 62\.40-62\.55\n- Nearby hold area: 55\.13/);
  assert.doesNotMatch(payload.body, /Nearby support: 42\.41/);
  assertTraderFacingDiscordText(payload);
});

test("formatIntelligentAlertAsPayload uses nearing-support wording for support approaches", () => {
  const touchEvent = {
    ...samplePayload.event!,
    id: "evt-support-approach",
    episodeId: "ep-support-approach",
    type: "level_touch" as const,
    eventType: "level_touch" as const,
    zoneKind: "support" as const,
    level: 2.93,
    triggerPrice: 2.95,
    bias: "neutral" as const,
  };
  const payload = formatIntelligentAlertAsPayload({
    id: "int-support-approach",
    symbol: "FATN",
    title: "FATN level touch",
    body: [
      "price nearing major support 2.90-2.93",
      "pressure: buyers still need to reclaim control",
      "why now: price is approaching support, making this the next reaction area",
      "room: open overhead path to next resistance 3.28 (+11.2%)",
      "watch: buyers stabilize into 2.90-2.93; a clean loss of the whole area weakens the setup",
    ].join("\n"),
    severity: "high",
    confidence: "high",
    score: 58,
    shouldNotify: true,
    tags: [],
    scoreComponents: {},
    event: touchEvent,
    zone: {
      id: "S1",
      symbol: "FATN",
      kind: "support",
      timeframeBias: "daily",
      zoneLow: 2.90,
      zoneHigh: 2.93,
      representativePrice: 2.93,
      strengthScore: 36,
      strengthLabel: "major",
      touchCount: 4,
      confluenceCount: 2,
      sourceTypes: ["swing_low"],
      timeframeSources: ["daily"],
      reactionQualityScore: 0.7,
      rejectionScore: 0.4,
      displacementScore: 0.4,
      sessionSignificanceScore: 0.4,
      followThroughScore: 0.6,
      gapContinuationScore: 0,
      sourceEvidenceCount: 2,
      firstTimestamp: 1,
      lastTimestamp: 1,
      isExtension: false,
      freshness: "fresh",
      notes: [],
    },
    nextBarrier: {
      side: "resistance",
      price: 3.28,
      distancePct: 0.112,
      clearanceLabel: "open",
      clutterLabel: "clear",
      nearbyBarrierCount: 1,
    },
    movement: {
      label: "inside_band",
      movementPct: 0.0068,
      line: "movement: price is still above the support band but close enough for a support reaction watch (0.7%)",
    },
    pressure: {
      label: "moderate",
      pressureScore: 0.45,
      line: "pressure: buyers still need to reclaim control",
    },
    triggerQuality: null,
    pathQuality: null,
    dipBuyQuality: null,
    exhaustion: null,
    setupState: null,
    failureRisk: null,
    target: null,
    tradeMap: null,
  });

  assert.match(payload.body, /^price nearing major support 2\.90-2\.93/);
  assert.match(payload.body, /Price is nearing support\./);
  assert.match(payload.body, /Key levels:\n- Nearby support: 2\.90-2\.93\n- Nearby resistance: 3\.28/);
  assert.doesNotMatch(payload.body, /Testing support/);
  assertTraderFacingDiscordText(payload);
});

test("formatIntelligentAlertAsPayload avoids generic balanced wording for support touches after pullbacks", () => {
  const touchEvent = {
    ...samplePayload.event!,
    id: "evt-support-touch",
    episodeId: "ep-support-touch",
    type: "level_touch" as const,
    eventType: "level_touch" as const,
    zoneKind: "support" as const,
    level: 2.93,
    triggerPrice: 2.92,
    bias: "neutral" as const,
  };
  const payload = formatIntelligentAlertAsPayload({
    id: "int-support-touch",
    symbol: "FATN",
    title: "FATN level touch",
    body: [
      "price testing major support 2.91-2.93",
      "pressure: buying and selling pressure still look balanced",
      "why now: price is back at support, so buyers need to stabilize before the setup improves",
      "room: limited overhead into next resistance 2.98 (+2.1%)",
      "watch: buyers stabilize at 2.91-2.93; a clean loss of the whole area weakens the setup",
    ].join("\n"),
    severity: "high",
    confidence: "high",
    score: 58,
    shouldNotify: true,
    tags: [],
    scoreComponents: {},
    event: touchEvent,
    zone: {
      id: "S1",
      symbol: "FATN",
      kind: "support",
      timeframeBias: "daily",
      zoneLow: 2.91,
      zoneHigh: 2.93,
      representativePrice: 2.93,
      strengthScore: 36,
      strengthLabel: "major",
      touchCount: 4,
      confluenceCount: 2,
      sourceTypes: ["swing_low"],
      timeframeSources: ["daily"],
      reactionQualityScore: 0.7,
      rejectionScore: 0.4,
      displacementScore: 0.4,
      sessionSignificanceScore: 0.4,
      followThroughScore: 0.6,
      gapContinuationScore: 0,
      sourceEvidenceCount: 2,
      firstTimestamp: 1,
      lastTimestamp: 1,
      isExtension: false,
      freshness: "fresh",
      notes: [],
    },
    nextBarrier: {
      side: "resistance",
      price: 2.98,
      distancePct: 0.021,
      clearanceLabel: "limited",
      clutterLabel: "clear",
      nearbyBarrierCount: 1,
    },
    movement: null,
    pressure: {
      label: "balanced",
      pressureScore: 0.5,
      line: "pressure: buying and selling pressure still look balanced",
    },
    triggerQuality: null,
    pathQuality: null,
    dipBuyQuality: null,
    exhaustion: null,
    setupState: null,
    failureRisk: null,
    target: null,
    tradeMap: null,
  });

  assert.match(payload.body, /price is testing support after the pullback; buyers need stabilization here/);
  assert.match(payload.body, /buyers need to stabilize/);
  assert.doesNotMatch(payload.body, /buyers and sellers are still balanced/);
  assertTraderFacingDiscordText(payload);
});

test("formatFollowThroughStateUpdateAsPayload adds live progress metadata", () => {
  const payload = formatFollowThroughStateUpdateAsPayload({
    symbol: "ALBT",
    timestamp: 11,
    eventType: "breakout",
    progressLabel: "improving",
    directionalReturnPct: 0.42,
    entryPrice: 2.41,
    currentPrice: 2.46,
  });

  assert.equal(payload.metadata?.messageKind, "follow_through_state_update");
  assert.equal(payload.title, "ALBT breakout progress check");
  assert.equal(payload.metadata?.progressLabel, "improving");
  assert.equal(payload.metadata?.directionalReturnPct, 0.42);
  assert.match(payload.body, /breakout is improving/);
  assert.match(payload.body, /price change from trigger: \+0\.42%/);
  assert.doesNotMatch(payload.body, /alert direction|since the alert/);
  assertTraderFacingDiscordText(payload);
});

test("formatContinuityUpdateAsPayload adds continuity metadata", () => {
  const payload = formatContinuityUpdateAsPayload({
    interpretation: {
      symbol: "ALBT",
      message: "buyers reacting at support near 2.40",
      type: "confirmation",
      eventType: "level_touch",
      level: 2.4,
      confidence: 0.82,
      tags: [],
      timestamp: 12,
    },
  });

  assert.equal(payload.metadata?.messageKind, "continuity_update");
  assert.equal(payload.metadata?.eventType, "level_touch");
  assert.equal(payload.metadata?.targetPrice, 2.4);
  assert.equal(payload.metadata?.continuityType, "confirmation");
  assert.match(payload.body, /buyers reacting at support near 2.40/);
  assertTraderFacingDiscordText(payload);
});

test("trader-facing continuity and recap titles avoid system-shaped wording", () => {
  const continuity = formatContinuityUpdateAsPayload({
    interpretation: {
      symbol: "ALBT",
      message: "buyers need acceptance above resistance before continuation looks cleaner",
      type: "confirmation",
      eventType: "breakout",
      level: 2.4,
      confidence: 0.82,
      tags: [],
      timestamp: 13,
    },
  });
  const recap = formatSymbolRecapAsPayload({
    symbol: "ALBT",
    timestamp: 14,
    body: "current read: breakout is still the lead idea near 2.40",
  });

  assert.equal(continuity.title, "ALBT what changed");
  assert.equal(recap.title, "ALBT current read");
  assertTraderFacingDiscordText(continuity);
  assertTraderFacingDiscordText(recap);
});

test("formatFollowThroughUpdateAsPayload adds trader-readable follow-through context", () => {
  const payload = formatFollowThroughUpdateAsPayload({
    symbol: "ALBT",
    timestamp: 9,
    entryPrice: 2.41,
    outcomePrice: 2.48,
    followThrough: {
      label: "working",
      eventType: "breakout",
      directionalReturnPct: 2.9,
      rawReturnPct: 2.9,
      line: "follow-through: breakout is still working",
    },
  });

  assert.equal(payload.title, "ALBT breakout follow-through");
  assert.equal(
    payload.body,
    [
      "The move is still holding up.",
      "",
      "What changed:",
      "- breakout is still working",
      "- price change from trigger: +2.90%",
      "",
      "Level to watch closely:",
      "- breakout is still active; 2.41 remains the key level to hold or reclaim before the next clean read.",
      "",
      "Path:",
      "- 2.41 -> 2.48 (+2.90% price move)",
    ].join("\n"),
  );
  assert.equal(payload.symbol, "ALBT");
  assert.equal(payload.timestamp, 9);
  assert.equal(payload.metadata?.messageKind, "follow_through_update");
  assert.equal(payload.metadata?.eventType, "breakout");
  assert.equal(payload.metadata?.followThroughLabel, "working");
  assert.equal(payload.metadata?.targetPrice, 2.41);
  assert.equal(payload.metadata?.directionalReturnPct, 2.9);
  assert.equal(payload.metadata?.rawReturnPct, 2.9);
  assert.equal(payload.metadata?.repeatedOutcomeUpdate, false);
  assertTraderFacingDiscordText(payload);
});

test("formatFollowThroughUpdateAsPayload keeps non-material structure in metadata only", () => {
  const payload = formatFollowThroughUpdateAsPayload({
    symbol: "ALBT",
    timestamp: 9,
    entryPrice: 2.41,
    outcomePrice: 2.48,
    followThrough: {
      label: "working",
      eventType: "breakout",
      directionalReturnPct: 2.9,
      rawReturnPct: 2.9,
      line: "follow-through: breakout is still working",
    },
    marketStructure: {
      timeframes: {
        "5m": {
          stable: {
            state: "breakout_holding",
            previousState: "breakout_holding",
            structureKey: "breakout_holding|low:2.22|high:2.37",
            materialChange: false,
            confidence: "medium",
            materialityScore: 0.42,
            rawState: "breakout_holding",
            reason: "same_state",
            candleCount: 32,
            latestSwingLow: 2.22,
            latestSwingHigh: 2.37,
          },
        },
      },
    },
  });

  assert.doesNotMatch(payload.body, /Market structure:/);
  assert.equal(payload.metadata?.marketStructureStoryVisible, false);
  assert.equal(payload.metadata?.runtimeMarketStructure?.timeframes?.["5m"]?.stable?.state, "breakout_holding");
  assertTraderFacingDiscordText(payload);
});

test("formatFollowThroughUpdateAsPayload scopes visible market structure to story keys", () => {
  const storyKeys = ["5m|formal|5m|bos_bullish|bullish_transition|BIYA:5m:external:high|1.240"];
  const payload = formatFollowThroughUpdateAsPayload({
    symbol: "BIYA",
    timestamp: 9,
    entryPrice: 1.24,
    outcomePrice: 1.29,
    followThrough: {
      label: "working",
      eventType: "breakout",
      directionalReturnPct: 4.03,
      rawReturnPct: 4.03,
      line: "follow-through: breakout is still working",
    },
    marketStructure: mixedBiyaMarketStructure(),
    includeMarketStructureStory: true,
    marketStructureStoryKeys: storyKeys,
  });

  assert.doesNotMatch(payload.body, /HTF 4h:/);
  assert.doesNotMatch(payload.body, /0\.7850/);
  assert.match(payload.body, /Tactical 5m: fresh bullish BOS \(medium, displacement confirmed\)/);
  assert.match(payload.body, /broken 1\.24, protected low 1\.11/);
  assert.deepEqual(payload.metadata?.marketStructureStoryKeys, storyKeys);
  assertTraderFacingDiscordText(payload);
});

test("formatFollowThroughUpdateAsPayload marks repeated outcome updates as existing setup updates", () => {
  const payload = formatFollowThroughUpdateAsPayload({
    symbol: "ALBT",
    timestamp: 10,
    entryPrice: 2.41,
    outcomePrice: 2.32,
    repeatedOutcomeUpdate: true,
    followThrough: {
      label: "failed",
      eventType: "breakout",
      directionalReturnPct: -3.7,
      rawReturnPct: -3.7,
      line: "follow-through: breakout failed",
    },
  });

  assert.doesNotMatch(payload.body, /Update type|existing setup update|not a new setup/);
  assert.match(payload.body, /a reclaim of 2\.41 would make the setup cleaner for longs/);
  assert.equal(payload.metadata?.repeatedOutcomeUpdate, true);
  assertTraderFacingDiscordText(payload);
});

test("formatFollowThroughUpdateAsPayload uses long-only wording for breakdown failures", () => {
  const payload = formatFollowThroughUpdateAsPayload({
    symbol: "ALBT",
    timestamp: 12,
    entryPrice: 2.41,
    outcomePrice: 2.45,
    followThrough: {
      label: "failed",
      eventType: "breakdown",
      directionalReturnPct: -1.66,
      rawReturnPct: 1.66,
      line: "follow-through: support loss faded",
    },
  });

  assert.equal(payload.title, "ALBT support loss follow-through");
  assert.match(payload.body, /support loss faded/);
  assert.match(payload.body, /price change from trigger: -1\.66%/);
  assert.doesNotMatch(payload.body, /breakdown failed|after the alert|alert direction/);
  assertTraderFacingDiscordText(payload);
});

test("formatFollowThroughUpdateAsPayload keeps compression follow-through neutral when price moves lower", () => {
  const payload = formatFollowThroughUpdateAsPayload({
    symbol: "OSRH",
    timestamp: 13,
    entryPrice: 0.6784,
    outcomePrice: 0.6708,
    followThrough: {
      label: "strong",
      eventType: "compression",
      directionalReturnPct: 1.12,
      rawReturnPct: -1.12,
      line: "follow-through: compression stayed strong",
    },
  });

  assert.equal(payload.title, "OSRH compression follow-through");
  assert.match(payload.body, /Compression produced a stronger reaction/);
  assert.match(payload.body, /compression produced a stronger reaction/);
  assert.match(payload.body, /price move from trigger: -1\.12%/);
  assert.match(payload.body, /0\.6784 -> 0\.6708 \(-1\.12% price move\)/);
  assert.doesNotMatch(payload.body, /holding up well|price change from trigger: \+1\.12%|should keep holding/);
  assertTraderFacingDiscordText(payload);
});

test("formatLevelSnapshotMessage uses deterministic formatting", () => {
  assert.equal(
    formatLevelSnapshotMessage({
      symbol: "ALBT",
      currentPrice: 2.51,
      supportZones: [
        { representativePrice: 2.4, strengthLabel: "strong", sourceLabel: "daily structure" },
        { representativePrice: 2.25, lowPrice: 2.2, highPrice: 2.28, strengthLabel: "weak", sourceLabel: "fresh intraday" },
      ],
      resistanceZones: [
        { representativePrice: 2.6, lowPrice: 2.58, highPrice: 2.62, strengthLabel: "major", sourceLabel: "4h confluence" },
        { representativePrice: 2.75, strengthLabel: "moderate", isExtension: true },
      ],
      timestamp: 1,
    }),
    [
      "ALBT support and resistance",
      "Price: 2.51",
      "Level context: the nearby ladder is thin, so the strongest areas matter more than every small level.",
      "",
      "Trade map:",
      "Current Read: ALBT is range-bound between heavy support 2.40 and major resistance 2.58-2.62 area; the better information comes from expansion above resistance or a clean support failure.",
      "",
      "Breakout Area To Watch: major resistance 2.58-2.62 area (+2.8% to +4.4%) is a nearby gate, not the material target; higher resistance needs a fresh level check before treating the path as open.",
      "",
      "Pullback Zones:",
      "- Nearby support gate: heavy support 2.40 (-4.4%); this is not a material small-cap pullback zone by itself.",
      "",
      "Continuation Path: above major resistance 2.58-2.62 area, higher resistance needs a fresh level check before the move can be treated as open.",
      "",
      "Setup Weakens If: price loses heavy support 2.40 as a whole area and cannot reclaim it. Below that, the next map area is light support 2.20-2.28 area (-12.4% to -9.2%).",
      "",
      "Quality / Caution: range-bound; small pushes inside the band can be noise.",
      "",
      "Closest levels to watch:",
      "Resistance:",
      "2.60 (+3.6%, major, 4h confluence)",
      "2.75 (+9.6%, moderate, extension)",
      "",
      "Support:",
      "2.40 (-4.4%, heavy, daily structure)",
      "2.25 (-10.4%, light, fresh intraday)",
    ].join("\n"),
  );
});

test("formatLevelSnapshotMessage shows seeded market structure when available", () => {
  const message = formatLevelSnapshotMessage({
    symbol: "ALBT",
    currentPrice: 2.51,
    supportZones: [
      { representativePrice: 2.4, strengthLabel: "strong", sourceLabel: "daily structure" },
    ],
    resistanceZones: [
      { representativePrice: 2.6, strengthLabel: "major", sourceLabel: "4h confluence" },
    ],
    timestamp: 1,
    marketStructure: {
      formal: {
        timeframe: "5m",
        bias: "bullish",
        previousBias: "range",
        eventType: "bos_bullish",
        confirmation: "close_confirmed",
        confidence: "high",
        confidenceScore: 0.81,
        materialChange: false,
        brokenSwingPrice: 2.5,
        sweptSwingPrice: null,
        protectedHigh: 2.6,
        protectedLow: 2.31,
        latestHigh: 2.6,
        latestLow: 2.31,
        swingSequence: ["HL", "HH"],
        structureKey: "5m|bos_bullish|bullish|2.50",
        traderLine: "5m structure printed bullish BOS above 2.50.",
        debug: {
          candleCount: 34,
          reasons: ["trend_continuation"],
        },
      },
      stable: {
        state: "breakout_holding",
        previousState: "pressing_range_high",
        structureKey: "breakout_holding|low:2.31|high:2.60",
        materialChange: false,
        confidence: "high",
        materialityScore: 0.72,
        rawState: "breakout_holding",
        reason: "initial_state",
        candleCount: 34,
        trendDirection: "uptrend",
        latestSwingLow: 2.31,
        latestSwingHigh: 2.6,
      },
    },
  });

  assert.match(message, /Market structure:/);
  assert.match(message, /Formal 5m: prior bullish BOS \(high, close confirmed\); bias range -> bullish; broken 2\.50, protected low 2\.31/);
  assert.match(message, /Stable 5m: breakout holding \(high\); trend uptrend; latest low 2\.31, latest high 2\.60/);
});

test("formatLevelSnapshotMessage separates 4h structure from tactical 5m structure", () => {
  const message = formatLevelSnapshotMessage({
    symbol: "ALBT",
    currentPrice: 2.51,
    supportZones: [
      { representativePrice: 2.4, strengthLabel: "strong", sourceLabel: "daily structure" },
    ],
    resistanceZones: [
      { representativePrice: 2.6, strengthLabel: "major", sourceLabel: "4h confluence" },
    ],
    timestamp: 1,
    marketStructure: {
      formal: {
        timeframe: "5m",
        bias: "bullish_transition",
        previousBias: "range",
        eventType: "bos_bullish",
        confirmation: "close_confirmed",
        confidence: "medium",
        confidenceScore: 0.68,
        materialChange: false,
        brokenSwingPrice: 2.5,
        sweptSwingPrice: null,
        protectedHigh: 2.6,
        protectedLow: 2.31,
        latestHigh: 2.6,
        latestLow: 2.31,
        swingSequence: ["HL", "HH"],
        structureKey: "5m|bos_bullish|bullish|2.50",
        traderLine: "5m structure printed bullish BOS above 2.50.",
        debug: {
          candleCount: 34,
          reasons: ["trend_continuation"],
        },
      },
      stable: {
        state: "breakout_holding",
        previousState: "pressing_range_high",
        structureKey: "breakout_holding|low:2.31|high:2.60",
        materialChange: false,
        confidence: "high",
        materialityScore: 0.72,
        rawState: "breakout_holding",
        reason: "initial_state",
        candleCount: 34,
        trendDirection: "uptrend",
        latestSwingLow: 2.31,
        latestSwingHigh: 2.6,
      },
      timeframes: {
        "4h": {
          formal: {
            timeframe: "4h",
            bias: "range",
            previousBias: "range",
            eventType: "none",
            confirmation: "none",
            confidence: "low",
            confidenceScore: 0.2,
            materialChange: false,
            protectedHigh: 3,
            protectedLow: 2.1,
            latestHigh: 3,
            latestLow: 2.1,
            swingSequence: ["HL", "LH"],
            structureKey: "4h|range",
            traderLine: "4h structure is range-bound.",
            debug: {
              candleCount: 80,
              reasons: [],
            },
          },
          stable: {
            state: "range_bound",
            previousState: "range_bound",
            structureKey: "range_bound|range:2.10-3.00",
            materialChange: false,
            confidence: "high",
            materialityScore: 0.78,
            rawState: "range_bound",
            reason: "same_state",
            candleCount: 80,
            trendDirection: "range",
            activeRangeLow: 2.1,
            activeRangeHigh: 3,
            latestSwingLow: 2.1,
            latestSwingHigh: 3,
          },
        },
        "5m": {
          formal: {
            timeframe: "5m",
            bias: "bullish_transition",
            previousBias: "range",
            eventType: "bos_bullish",
            confirmation: "close_confirmed",
            confidence: "medium",
            confidenceScore: 0.68,
            materialChange: false,
            brokenSwingPrice: 2.5,
            sweptSwingPrice: null,
            protectedHigh: 2.6,
            protectedLow: 2.31,
            latestHigh: 2.6,
            latestLow: 2.31,
            swingSequence: ["HL", "HH"],
            structureKey: "5m|bos_bullish|bullish|2.50",
            traderLine: "5m structure printed bullish BOS above 2.50.",
            debug: {
              candleCount: 34,
              reasons: ["trend_continuation"],
            },
          },
          stable: {
            state: "breakout_holding",
            previousState: "pressing_range_high",
            structureKey: "breakout_holding|low:2.31|high:2.60",
            materialChange: false,
            confidence: "high",
            materialityScore: 0.72,
            rawState: "breakout_holding",
            reason: "initial_state",
            candleCount: 34,
            trendDirection: "uptrend",
            latestSwingLow: 2.31,
            latestSwingHigh: 2.6,
          },
        },
      },
    },
  });

  assert.match(message, /HTF 4h: no confirmed BOS\/CHOCH; protected high 3\.00, protected low 2\.10; bias range/);
  assert.doesNotMatch(message, /HTF 4h: .*stable range bound/);
  assert.match(message, /Tactical 5m: prior bullish BOS \(medium, close confirmed\); bias range -> bullish transition; broken 2\.50, protected low 2\.31; stable breakout holding \(high\); trend uptrend/);
});

test("formatLevelSnapshotMessage keeps fresh 4h structure detailed", () => {
  const message = formatLevelSnapshotMessage({
    symbol: "ALBT",
    currentPrice: 2.51,
    supportZones: [
      { representativePrice: 2.4, strengthLabel: "strong", sourceLabel: "daily structure" },
    ],
    resistanceZones: [
      { representativePrice: 2.6, strengthLabel: "major", sourceLabel: "4h confluence" },
    ],
    timestamp: 1,
    marketStructure: {
      timeframes: {
        "4h": {
          formal: {
            timeframe: "4h",
            bias: "bullish",
            previousBias: "range",
            eventType: "bos_bullish",
            eventFreshness: "fresh",
            confirmation: "close_confirmed",
            confidence: "medium",
            confidenceScore: 0.68,
            materialChange: true,
            brokenSwingPrice: 2.5,
            sweptSwingPrice: null,
            protectedHigh: 2.6,
            protectedLow: 2.1,
            latestHigh: 2.6,
            latestLow: 2.1,
            swingSequence: ["HL", "HH"],
            structureKey: "4h|bos_bullish|bullish|2.50",
            traderLine: "4h structure printed bullish BOS above 2.50.",
            debug: {
              candleCount: 80,
              reasons: ["trend_continuation"],
            },
          },
          stable: {
            state: "breakout_holding",
            previousState: "range_bound",
            structureKey: "breakout_holding|low:2.10|high:2.60",
            materialChange: true,
            confidence: "high",
            materialityScore: 0.78,
            rawState: "breakout_holding",
            reason: "same_state",
            candleCount: 80,
            trendDirection: "uptrend",
            latestSwingLow: 2.1,
            latestSwingHigh: 2.6,
          },
        },
      },
    },
  });

  assert.match(message, /HTF 4h: fresh bullish BOS \(medium, close confirmed\); bias range -> bullish; broken 2\.50, protected low 2\.10; stable breakout holding \(high\); trend uptrend/);
});

test("formatMarketStructureUpdateAsPayload posts fresh BOS/CHOCH with audit metadata", () => {
  const payload = formatMarketStructureUpdateAsPayload({
    symbol: "ALBT",
    timestamp: 1,
    storyReason: "pending_fresh_structure",
    storyKeys: ["4h|formal|4h|bos_bullish|bullish|2.50"],
    storySource: "standalone_structure_update",
    marketStructure: {
      timeframes: {
        "4h": {
          formal: {
            timeframe: "4h",
            bias: "bullish",
            previousBias: "range",
            eventType: "bos_bullish",
            eventFreshness: "fresh",
            confirmation: "close_confirmed",
            confidence: "medium",
            confidenceScore: 0.68,
            materialChange: true,
            brokenSwingPrice: 2.5,
            sweptSwingPrice: null,
            protectedHigh: 2.6,
            protectedLow: 2.1,
            latestHigh: 2.6,
            latestLow: 2.1,
            swingSequence: ["HL", "HH"],
            structureKey: "4h|bos_bullish|bullish|2.50",
            traderLine: "4h structure printed bullish BOS above 2.50.",
            debug: {
              candleCount: 80,
              reasons: ["trend_continuation"],
            },
          },
        },
      },
    },
  });

  assert.equal(payload.metadata?.messageKind, "market_structure_update");
  assert.equal(payload.metadata?.signalCategory, "market_structure");
  assert.equal(payload.metadata?.marketStructureStoryVisible, true);
  assert.equal(payload.metadata?.marketStructureStoryReason, "pending_fresh_structure");
  assert.deepEqual(payload.metadata?.marketStructureStoryKeys, [
    "4h|formal|4h|bos_bullish|bullish|2.50",
  ]);
  assert.match(payload.body, /Fresh BOS\/CHOCH structure detected/);
  assert.match(payload.body, /HTF 4h: fresh bullish BOS/);
});

test("formatMarketStructureUpdateAsPayload focuses standalone BOS/CHOCH posts on the triggering timeframe", () => {
  const payload = formatMarketStructureUpdateAsPayload({
    symbol: "BIYA",
    timestamp: 1,
    storyReason: "pending_fresh_structure",
    storyKeys: ["5m|formal|5m|bos_bullish|bullish_transition|BIYA:5m:external:high|1.240"],
    storySource: "standalone_structure_update",
    marketStructure: {
      timeframes: {
        "4h": {
          formal: {
            timeframe: "4h",
            bias: "range",
            previousBias: "range",
            eventType: "failed_break_low",
            eventFreshness: "prior",
            confirmation: "failed",
            confidence: "medium",
            confidenceScore: 0.55,
            materialChange: false,
            brokenSwingPrice: null,
            sweptSwingPrice: 0.785,
            protectedHigh: 0.8999,
            protectedLow: 0.785,
            latestHigh: 0.8999,
            latestLow: 0.785,
            swingSequence: ["LH", "LL"],
            structureKey: "4h|failed_break_low|range|none|BIYA:4h:external:low|0.7850",
            traderLine: "4h structure failed to hold below 0.7850.",
            debug: { candleCount: 116, reasons: ["failed_break"] },
          },
        },
        "5m": {
          formal: {
            timeframe: "5m",
            bias: "bullish_transition",
            previousBias: "range",
            eventType: "bos_bullish",
            eventFreshness: "fresh",
            confirmation: "displacement_confirmed",
            confidence: "medium",
            confidenceScore: 0.71,
            materialChange: true,
            brokenSwingPrice: 1.24,
            sweptSwingPrice: null,
            protectedHigh: 1.17,
            protectedLow: 1.11,
            latestHigh: 1.17,
            latestLow: 1.11,
            swingSequence: ["HL", "HH"],
            structureKey: "5m|bos_bullish|bullish_transition|BIYA:5m:external:high|1.240",
            traderLine: "5m structure printed bullish BOS above 1.24.",
            debug: { candleCount: 60, reasons: ["displacement_confirmed"] },
          },
        },
      },
    },
  });

  assert.doesNotMatch(payload.body, /HTF 4h:/);
  assert.doesNotMatch(payload.body, /0\.7850/);
  assert.match(payload.body, /Tactical 5m: fresh bullish BOS \(medium, displacement confirmed\)/);
  assert.match(payload.body, /broken 1\.24, protected low 1\.11/);
});

test("formatLevelSnapshotMessage condenses prior 4h BOS to the useful protected side", () => {
  const message = formatLevelSnapshotMessage({
    symbol: "ALBT",
    currentPrice: 2.51,
    supportZones: [
      { representativePrice: 2.4, strengthLabel: "strong", sourceLabel: "daily structure" },
    ],
    resistanceZones: [
      { representativePrice: 2.6, strengthLabel: "major", sourceLabel: "4h confluence" },
    ],
    timestamp: 1,
    marketStructure: {
      timeframes: {
        "4h": {
          formal: {
            timeframe: "4h",
            bias: "bullish",
            previousBias: "range",
            eventType: "bos_bullish",
            eventFreshness: "prior",
            confirmation: "close_confirmed",
            confidence: "medium",
            confidenceScore: 0.68,
            materialChange: false,
            brokenSwingPrice: 2.5,
            sweptSwingPrice: null,
            protectedHigh: 2.6,
            protectedLow: 2.1,
            latestHigh: 2.6,
            latestLow: 2.1,
            swingSequence: ["HL", "HH"],
            structureKey: "4h|bos_bullish|bullish|2.50",
            traderLine: "4h structure printed bullish BOS above 2.50.",
            debug: {
              candleCount: 80,
              reasons: ["trend_continuation"],
            },
          },
        },
      },
    },
  });

  assert.match(message, /HTF 4h: prior bullish BOS above 2\.50; protected low 2\.10; bias range -> bullish/);
  assert.doesNotMatch(message, /HTF 4h: .*protected high 2\.60/);
});

test("formatLevelLadderMessage keeps the full support and resistance ladder list-only", () => {
  assert.equal(
    formatLevelLadderMessage({
      symbol: "ALBT",
      currentPrice: 2.51,
      supportZones: [
        { representativePrice: 2.4, strengthLabel: "strong", sourceLabel: "daily structure" },
        { representativePrice: 2.25, lowPrice: 2.2, highPrice: 2.28, strengthLabel: "weak", sourceLabel: "fresh intraday" },
      ],
      resistanceZones: [
        { representativePrice: 2.6, lowPrice: 2.58, highPrice: 2.62, strengthLabel: "major", sourceLabel: "4h confluence" },
        { representativePrice: 2.75, strengthLabel: "moderate", isExtension: true },
      ],
      timestamp: 1,
    }),
    [
      "ALBT full level ladder",
      "Price: 2.51",
      "",
      "Resistance:",
      "2.60 (+3.6%, major, 4h confluence)",
      "2.75 (+9.6%, moderate, extension)",
      "",
      "Support:",
      "2.40 (-4.4%, heavy, daily structure)",
      "2.25 (-10.4%, light, fresh intraday)",
    ].join("\n"),
  );
});

test("formatLevelLadderMessage does not compact close resistance shelves in the full ladder", () => {
  const message = formatLevelLadderMessage({
    symbol: "GV",
    currentPrice: 0.2075,
    supportZones: [
      { representativePrice: 0.2, strengthLabel: "major", sourceLabel: "daily confluence" },
    ],
    resistanceZones: [
      { representativePrice: 0.2098, lowPrice: 0.2098, highPrice: 0.21, strengthLabel: "major", sourceLabel: "daily confluence" },
      { representativePrice: 0.2161, strengthLabel: "major", sourceLabel: "4h confluence" },
      { representativePrice: 0.2225, lowPrice: 0.2208, highPrice: 0.2225, strengthLabel: "strong", sourceLabel: "4h confluence" },
      { representativePrice: 0.2287, strengthLabel: "strong", sourceLabel: "daily confluence" },
    ],
    timestamp: 1,
  });

  assert.match(message ?? "", /Resistance:\n0\.2098/);
  assert.match(message ?? "", /0\.2161 \(\+4\.1%, major, 4h confluence\)/);
  assert.match(message ?? "", /0\.2225/);
  assert.match(message ?? "", /0\.2287/);
  assert.doesNotMatch(message ?? "", /0\.2098-0\.2287 zone/);
});

test("formatLevelLadderMessage prefers dedicated full-ladder zones over compact snapshot zones", () => {
  const message = formatLevelLadderMessage({
    symbol: "GNS",
    currentPrice: 0.2972,
    supportZones: [
      { representativePrice: 0.285, strengthLabel: "major", sourceLabel: "daily confluence" },
    ],
    resistanceZones: [
      { representativePrice: 0.31, strengthLabel: "major", sourceLabel: "daily confluence" },
      { representativePrice: 0.347, strengthLabel: "major", sourceLabel: "daily confluence" },
    ],
    ladderResistanceZones: [
      { representativePrice: 0.305, strengthLabel: "moderate", sourceLabel: "fresh intraday" },
      { representativePrice: 0.31, strengthLabel: "major", sourceLabel: "daily confluence" },
      { representativePrice: 0.319, strengthLabel: "strong", sourceLabel: "daily confluence" },
      { representativePrice: 0.34, strengthLabel: "moderate", sourceLabel: "4h structure" },
      { representativePrice: 0.347, strengthLabel: "major", sourceLabel: "daily confluence" },
    ],
    timestamp: 1,
  });

  assert.match(message ?? "", /Resistance:\n0\.3050/);
  assert.match(message ?? "", /0\.3190/);
  assert.match(message ?? "", /0\.3400/);
});

test("formatLevelLadderMessage calls out open overhead range when no more resistance is available", () => {
  const message = formatLevelLadderMessage({
    symbol: "AUUD",
    currentPrice: 1.8698,
    supportZones: [
      { representativePrice: 1.85, strengthLabel: "strong", sourceLabel: "fresh intraday" },
    ],
    resistanceZones: [
      { representativePrice: 1.9, strengthLabel: "moderate", sourceLabel: "fresh intraday" },
      { representativePrice: 1.92, strengthLabel: "moderate", sourceLabel: "fresh intraday" },
      { representativePrice: 1.95, strengthLabel: "weak", isExtension: true },
    ],
    timestamp: 1,
    audit: {
      referencePrice: 1.8698,
      displayTolerance: 0.0018698,
      forwardResistanceLimit: 3.7396,
      displayedSupportIds: ["s1"],
      displayedResistanceIds: ["r1", "r2", "r3"],
      supportCandidates: [],
      resistanceCandidates: [
        {
          id: "r2-compacted",
          side: "resistance",
          bucket: "surfaced",
          representativePrice: 1.92,
          zoneLow: 1.92,
          zoneHigh: 1.92,
          strengthLabel: "moderate",
          strengthScore: 18,
          confluenceCount: 1,
          sourceEvidenceCount: 1,
          timeframeBias: "5m",
          timeframeSources: ["5m"],
          sourceTypes: ["swing_high"],
          sourceLabel: "fresh intraday",
          freshness: "fresh",
          isExtension: false,
          displayed: false,
          omittedReason: "compacted",
        },
      ],
      omittedSupportCount: 0,
      omittedResistanceCount: 1,
    },
  });

  assert.match(message ?? "", /No additional resistance found below 3\.74 \(\+100\.0%\)\./);
});

test("formatLevelSnapshotMessage can include a first-post trade plan without changing level formatting", () => {
  const message = formatLevelSnapshotMessage({
    symbol: "PLAN",
    currentPrice: 1.12,
    supportZones: [
      { representativePrice: 1.03, strengthLabel: "weak", sourceLabel: "fresh intraday" },
    ],
    resistanceZones: [
      { representativePrice: 1.24, strengthLabel: "strong", sourceLabel: "daily confluence" },
    ],
    timestamp: 1,
    tradePlan: {
      title: "Trade plan:",
      lines: [
        "Primary read: PLAN is a breakout watch, but buyers still need acceptance above resistance.",
        "Quality check: data quality is trusted.",
        "Volatility: normal small-cap movement; ignore penny-by-penny noise inside the level band.",
      ],
    },
  });

  assert.match(message, /Trade plan:\nPrimary read: PLAN is a breakout watch/);
  assert.match(message, /Trade map:\nCurrent Read: PLAN is trading between/);
  assert.match(message, /Breakout Area To Watch: heavy resistance 1\.24/);
  assert.doesNotMatch(message, /\bbuy\b|\bsell\b|best entry|should enter/i);
});

test("formatLevelSnapshotMessage collapses crowded trader-facing levels into zones", () => {
  const message = formatLevelSnapshotMessage({
    symbol: "SAGT",
    currentPrice: 2.37,
    supportZones: [
      { representativePrice: 2.16, strengthLabel: "major", sourceLabel: "daily confluence" },
      { representativePrice: 1.85, strengthLabel: "moderate", sourceLabel: "4h structure" },
    ],
    resistanceZones: [
      { representativePrice: 2.39, strengthLabel: "weak", sourceLabel: "4h structure" },
      { representativePrice: 2.43, strengthLabel: "major", sourceLabel: "daily confluence" },
      { representativePrice: 2.47, strengthLabel: "moderate", sourceLabel: "4h structure" },
      { representativePrice: 2.64, strengthLabel: "major", sourceLabel: "daily confluence" },
    ],
    timestamp: 1,
  });

  const closestSection = message.split("\n\nMore support and resistance:")[0] ?? message;
  assert.match(message, /2\.39-2\.47 zone \(\+0\.8% to \+4\.2%, major, clustered levels\)/);
  assert.match(message, /SAGT is range-bound between major support 2\.16 and major resistance 2\.39-2\.47 area/);
  assert.doesNotMatch(closestSection, /2\.39 \(\+0\.8%/);
  assert.doesNotMatch(closestSection, /2\.43 \(\+2\.5%/);
  assert.doesNotMatch(closestSection, /2\.47 \(\+4\.2%/);
});

test("formatLevelSnapshotMessage treats low-priced dense overhead as one practical zone", () => {
  const message = formatLevelSnapshotMessage({
    symbol: "ATLN",
    currentPrice: 1.3599,
    supportZones: [
      { representativePrice: 1.34, strengthLabel: "moderate", sourceLabel: "daily confluence" },
      { representativePrice: 1.32, strengthLabel: "moderate", sourceLabel: "fresh intraday" },
      { representativePrice: 1.28, strengthLabel: "moderate", sourceLabel: "daily structure" },
    ],
    resistanceZones: [
      { representativePrice: 1.3692, strengthLabel: "strong", sourceLabel: "4h confluence" },
      { representativePrice: 1.4, strengthLabel: "strong", sourceLabel: "fresh intraday" },
      { representativePrice: 1.42, strengthLabel: "strong", sourceLabel: "daily confluence" },
      { representativePrice: 1.46, strengthLabel: "moderate", sourceLabel: "4h structure" },
    ],
    timestamp: 1,
  });

  const closestSection = message.split("\n\nMore support and resistance:")[0] ?? message;
  assert.match(message, /1\.37-1\.42 zone \(\+0\.7% to \+4\.4%, heavy, clustered levels\)/);
  assert.match(message, /ATLN is inside a tight nearby level cluster from moderate support 1\.32-1\.34 area to heavy resistance 1\.37-1\.42 area/);
  assert.doesNotMatch(message, /1\.36 \(\+0\.0%/);
  assert.doesNotMatch(closestSection, /1\.40 \(\+2\.9%/);
});

test("formatLevelSnapshotMessage does not turn tight nearby clutter and deep support into a pullback plan", () => {
  const message = formatLevelSnapshotMessage({
    symbol: "SDOT",
    currentPrice: 23.47,
    supportZones: [
      { representativePrice: 23.13, strengthLabel: "moderate", sourceLabel: "4h structure" },
      { representativePrice: 20.41, strengthLabel: "major", sourceLabel: "daily structure" },
      { representativePrice: 20.0, strengthLabel: "major", sourceLabel: "daily structure" },
    ],
    resistanceZones: [
      { representativePrice: 23.86, strengthLabel: "major", sourceLabel: "4h structure" },
      { representativePrice: 26.1, strengthLabel: "major", sourceLabel: "daily structure" },
    ],
    timestamp: 1,
  });

  assert.match(message, /Current Read: SDOT is inside a tight nearby level cluster from moderate support 23\.13 to major resistance 23\.86/);
  assert.match(message, /small pushes inside that band are noise/);
  assert.doesNotMatch(message, /range-bound between moderate support 23\.13 and major resistance 23\.86/);
  assert.match(message, /Breakout Area To Watch: major resistance 23\.86 \(\+1\.7%\) is a nearby gate, not the material target; the first material upside map area is major resistance 26\.10 \(\+11\.2%\)\./);
  assert.match(message, /- Nearby support gate: moderate support 23\.13 \(-1\.4%\); this is not a material small-cap pullback zone by itself\./);
  assert.match(message, /- First real support below that is major support 20\.41 \(-13\.0%\); that is a deeper reset area, not a routine pullback zone\./);
  assert.doesNotMatch(message, /First pullback area: major support 20\.41/);
  assert.match(message, /Quality \/ Caution: tight nearby level cluster; small pushes inside the band can be noise\./);
  assert.doesNotMatch(message, /\bbuy\b|\bsell\b|best entry|should enter|price target/i);
});

test("formatLevelSnapshotMessage keeps resistance visible until at least thirty percent overhead", () => {
  const message = formatLevelSnapshotMessage({
    symbol: "ATXI",
    currentPrice: 0.608,
    supportZones: [
      { representativePrice: 0.56, strengthLabel: "strong", sourceLabel: "daily confluence" },
    ],
    resistanceZones: [
      { representativePrice: 0.62, strengthLabel: "moderate", sourceLabel: "daily structure" },
      { representativePrice: 0.64, strengthLabel: "strong", sourceLabel: "daily confluence" },
      { representativePrice: 0.65, strengthLabel: "strong", sourceLabel: "daily confluence" },
      { representativePrice: 0.6683, strengthLabel: "strong", sourceLabel: "daily confluence" },
      { representativePrice: 0.68, strengthLabel: "moderate", sourceLabel: "daily confluence" },
      { representativePrice: 0.7, strengthLabel: "moderate", sourceLabel: "daily structure" },
      { representativePrice: 0.75, strengthLabel: "moderate", sourceLabel: "daily structure" },
      { representativePrice: 0.79, strengthLabel: "moderate", sourceLabel: "daily structure" },
      { representativePrice: 0.8, strengthLabel: "moderate", sourceLabel: "daily structure" },
      { representativePrice: 0.8428, strengthLabel: "moderate", sourceLabel: "daily structure" },
    ],
    timestamp: 1,
  });

  assert.match(message, /Resistance:\n0\.6200/);
  assert.match(message, /0\.7900 \(\+29\.9%, moderate, daily structure\)/);
  assert.match(message, /0\.8000 \(\+31\.6%, moderate, daily structure\)/);
  assert.doesNotMatch(message.split("\n\nMore support and resistance:")[0] ?? message, /0\.8428/);
});

test("formatLevelSnapshotMessage does not stop just below thirty percent when another resistance is available", () => {
  const message = formatLevelSnapshotMessage({
    symbol: "IKT",
    currentPrice: 1.925,
    supportZones: [
      { representativePrice: 1.9, strengthLabel: "major", sourceLabel: "daily confluence" },
    ],
    resistanceZones: [
      1.94,
      1.97,
      2.05,
      2.09,
      2.16,
      2.22,
      2.29,
      2.37,
      2.43,
      2.5,
      2.58,
      2.65,
    ].map((representativePrice) => ({
      representativePrice,
      strengthLabel: "moderate" as const,
      sourceLabel: "daily structure",
    })),
    timestamp: 1,
  });

  assert.match(message, /2\.50 \(\+29\.9%, moderate, daily structure\)/);
  assert.match(message, /2\.58 \(\+34\.0%, moderate, daily structure\)/);
  assert.doesNotMatch(message.split("\n\nMore support and resistance:")[0] ?? message, /2\.65/);
});

test("formatLevelSnapshotMessage keeps a meaningful two-level structural zone inside a wide resistance gap", () => {
  const message = formatLevelSnapshotMessage({
    symbol: "PMAX",
    currentPrice: 4.6591,
    supportZones: [
      { representativePrice: 4.25, strengthLabel: "strong", sourceLabel: "4h structure" },
      { representativePrice: 4.17, strengthLabel: "strong", sourceLabel: "fresh intraday" },
      { representativePrice: 3.95, strengthLabel: "strong", sourceLabel: "4h structure" },
    ],
    resistanceZones: [
      { representativePrice: 4.81, strengthLabel: "moderate", sourceLabel: "4h structure" },
      { representativePrice: 4.97, strengthLabel: "moderate", sourceLabel: "daily structure" },
      { representativePrice: 5.4, strengthLabel: "moderate", sourceLabel: "4h structure" },
      { representativePrice: 5.691, strengthLabel: "moderate", sourceLabel: "daily structure" },
      { representativePrice: 5.93, strengthLabel: "moderate", sourceLabel: "4h structure" },
      { representativePrice: 6.14, strengthLabel: "moderate", sourceLabel: "daily structure" },
    ],
    timestamp: 1,
  });

  assert.match(message, /5\.69-5\.93 zone \(\+22\.1% to \+27\.3%, moderate, clustered levels\)/);
  assert.match(message, /6\.14 \(\+31\.8%, moderate, daily structure\)/);
});

test("formatLevelSnapshotMessage keeps continuation map checkpoints before a far historical resistance anchor", () => {
  const message = formatLevelSnapshotMessage({
    symbol: "AUUD",
    currentPrice: 1.9402,
    supportZones: [
      { representativePrice: 1.92, strengthLabel: "strong", sourceLabel: "4h structure" },
    ],
    resistanceZones: [
      { representativePrice: 1.95, strengthLabel: "moderate", sourceLabel: "daily confluence" },
      { representativePrice: 2.04, strengthLabel: "weak", sourceLabel: "fresh intraday" },
      { representativePrice: 2.10, strengthLabel: "moderate", sourceLabel: "fresh intraday" },
      { representativePrice: 2.25, strengthLabel: "weak", sourceLabel: "continuation map" },
      { representativePrice: 2.50, strengthLabel: "weak", sourceLabel: "continuation map" },
      { representativePrice: 2.75, strengthLabel: "weak", sourceLabel: "continuation map" },
      { representativePrice: 3.00, strengthLabel: "weak", sourceLabel: "continuation map" },
      { representativePrice: 3.59, strengthLabel: "moderate", sourceLabel: "daily structure" },
      { representativePrice: 3.68, strengthLabel: "moderate", sourceLabel: "daily structure" },
      { representativePrice: 3.75, strengthLabel: "moderate", sourceLabel: "daily structure" },
    ],
    timestamp: 1,
  });

  assert.match(message, /2\.25 \(\+16\.0%, light, continuation map\)/);
  assert.match(message, /2\.50 \(\+28\.9%, light, continuation map\)/);
  assert.match(message, /2\.75 \(\+41\.7%, light, continuation map\)/);
  assert.match(message, /3\.00 \(\+54\.6%, light, continuation map\)/);
  assert.match(message, /3\.59-3\.75 zone \(\+85\.0% to \+93\.3%, moderate, clustered levels\)/);
});

test("formatLevelSnapshotMessage does not cluster two noisy intraday resistance levels", () => {
  const message = formatLevelSnapshotMessage({
    symbol: "NOISE",
    currentPrice: 4.66,
    supportZones: [
      { representativePrice: 4.25, strengthLabel: "strong", sourceLabel: "4h structure" },
    ],
    resistanceZones: [
      { representativePrice: 5.69, strengthLabel: "moderate", sourceLabel: "fresh intraday" },
      { representativePrice: 5.93, strengthLabel: "moderate", sourceLabel: "fresh intraday" },
      { representativePrice: 6.14, strengthLabel: "moderate", sourceLabel: "daily structure" },
    ],
    timestamp: 1,
  });

  assert.doesNotMatch(message, /5\.69-5\.93 zone/);
  assert.match(message, /5\.69 \(\+22\.1%, moderate, fresh intraday\)/);
});

test("formatLevelSnapshotMessage uses practical small-cap zones instead of penny-by-penny risk wording", () => {
  const message = formatLevelSnapshotMessage({
    symbol: "CYCU",
    currentPrice: 1.03,
    supportZones: [
      { representativePrice: 1.02, strengthLabel: "major", sourceLabel: "daily confluence" },
      { representativePrice: 1.00, strengthLabel: "moderate", sourceLabel: "fresh intraday" },
      { representativePrice: 0.9898, strengthLabel: "moderate", sourceLabel: "fresh intraday" },
      { representativePrice: 0.9522, strengthLabel: "major", sourceLabel: "daily confluence" },
    ],
    resistanceZones: [
      { representativePrice: 1.06, strengthLabel: "moderate", sourceLabel: "fresh intraday" },
      { representativePrice: 1.12, strengthLabel: "strong", sourceLabel: "daily confluence" },
    ],
    timestamp: 1,
  });

  assert.match(message, /Current Read: CYCU is inside a tight nearby level cluster from major support 0\.9898-1\.02 area to moderate resistance 1\.06/);
  assert.match(message, /Breakout Area To Watch: moderate resistance 1\.06 \(\+2\.9%\) is a nearby gate, not the material target/);
  assert.match(message, /- Nearby support gate: major support 0\.9898-1\.02 area \(-3\.9% to -1\.0%\); this is not a material small-cap pullback zone by itself\./);
  assert.match(message, /Setup Weakens If: price loses major support 0\.9898-1\.02 area as a whole area and cannot reclaim it\./);
  assert.match(message, /Quality \/ Caution: tight nearby level cluster; small pushes inside the band can be noise\./);
  assert.doesNotMatch(message, /If 1\.02 fails|If 1\.01 fails|risk opens toward 1\.00|\bbuy\b|\bsell\b|stop loss/i);
});

test("formatLevelSnapshotMessage treats close small-cap support levels as one practical support area in the trade map", () => {
  const message = formatLevelSnapshotMessage({
    symbol: "PENY",
    currentPrice: 1.05,
    supportZones: [
      { representativePrice: 1.02, strengthLabel: "moderate", sourceLabel: "fresh intraday" },
      { representativePrice: 1.00, strengthLabel: "major", sourceLabel: "daily confluence" },
      { representativePrice: 0.94, strengthLabel: "moderate", sourceLabel: "4h structure" },
    ],
    resistanceZones: [
      { representativePrice: 1.12, strengthLabel: "strong", sourceLabel: "daily confluence" },
      { representativePrice: 1.25, strengthLabel: "major", sourceLabel: "daily structure" },
    ],
    timestamp: 1,
  });

  assert.match(
    message,
    /- First pullback area: moderate support 0\.9400 \(-10\.5%\)\./,
  );
  assert.match(message, /Setup Weakens If: price loses major support 1\.00-1\.02 area as a whole area and cannot reclaim it\. Below that, the next map area is moderate support 0\.9400/);
  assert.match(message, /Closest levels to watch:[\s\S]*Support:\n1\.02 .*\n1\.00 .*\n0\.9400/);
  assert.doesNotMatch(message, /More support and resistance/);
  assert.doesNotMatch(message, /risk opens toward 1\.00|If 1\.02 fails/i);
});

test("formatLevelSnapshotMessage frames a close resistance test as a breakout-watch setup", () => {
  const message = formatLevelSnapshotMessage({
    symbol: "BOUT",
    currentPrice: 7.25,
    supportZones: [
      { representativePrice: 6.1, strengthLabel: "moderate", sourceLabel: "daily structure" },
    ],
    resistanceZones: [
      { representativePrice: 7.45, strengthLabel: "moderate", sourceLabel: "fresh intraday" },
      { representativePrice: 7.58, strengthLabel: "moderate", sourceLabel: "4h structure" },
    ],
    timestamp: 1,
  });

  assert.match(message, /Current Read: BOUT is a breakout-watch setup against moderate resistance 7\.45/);
  assert.match(message, /Breakout Area To Watch: moderate resistance 7\.45 \(\+2\.8%\) is a nearby gate, not the material target/);
  assert.match(message, /Continuation Path: above moderate resistance 7\.45, higher resistance needs a fresh level check before the move can be treated as open/);
  assert.doesNotMatch(message, /\bbuy\b|\bsell\b|best entry|should enter|price target/i);
});

test("formatLevelSnapshotMessage does not treat far lower support as a clean pullback zone", () => {
  const message = formatLevelSnapshotMessage({
    symbol: "FAR",
    currentPrice: 7.25,
    supportZones: [
      { representativePrice: 4.7, strengthLabel: "moderate", sourceLabel: "daily structure" },
    ],
    resistanceZones: [
      { representativePrice: 8.14, strengthLabel: "weak", sourceLabel: "fresh intraday" },
    ],
    timestamp: 1,
  });

  assert.match(message, /Current Read: FAR is extended from the nearest support/);
  assert.match(message, /Pullback Zones:\n- Nearest support is moderate support 4\.70 \(-35\.2%\), but it is too far from price to call a clean pullback zone\./);
  assert.doesNotMatch(message, /First pullback area: moderate support 4\.70/);
  assert.doesNotMatch(message, /Below that, the next map area is moderate support 4\.70/);
  assert.doesNotMatch(message, /\bbuy\b|\bsell\b|best entry|should enter|price target/i);
});

test("watchlist trader read AI flag defaults off and recognizes opt-in values", () => {
  assert.equal(isWatchlistTraderReadAiEnabled({}), false);
  assert.equal(isWatchlistTraderReadAiEnabled({ [WATCHLIST_TRADER_READ_AI_ENABLED_ENV]: "false" }), false);
  assert.equal(isWatchlistTraderReadAiEnabled({ [WATCHLIST_TRADER_READ_AI_ENABLED_ENV]: "true" }), true);
  assert.equal(isWatchlistTraderReadAiEnabled({ [WATCHLIST_TRADER_READ_AI_ENABLED_ENV]: "on" }), true);
});

test("formatLevelSnapshotMessage keeps deterministic output when the AI flag is enabled before AI exists", () => {
  const previous = process.env[WATCHLIST_TRADER_READ_AI_ENABLED_ENV];
  const previousWarn = console.warn;
  const warnings: string[] = [];
  process.env[WATCHLIST_TRADER_READ_AI_ENABLED_ENV] = "true";
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };

  try {
    const message = formatLevelSnapshotMessage({
      symbol: "NOAI",
      currentPrice: 2,
      supportZones: [
        { representativePrice: 1.9, strengthLabel: "moderate", sourceLabel: "fresh intraday" },
      ],
      resistanceZones: [
        { representativePrice: 2.1, strengthLabel: "moderate", sourceLabel: "fresh intraday" },
      ],
      timestamp: 1,
    });

    assert.match(message, /Current Read:/);
    assert.doesNotMatch(message, /AI note|OpenAI|generated by AI/i);
    assert.ok(warnings.some((line) => line.includes(WATCHLIST_TRADER_READ_AI_ENABLED_ENV)));
  } finally {
    console.warn = previousWarn;
    if (previous === undefined) {
      delete process.env[WATCHLIST_TRADER_READ_AI_ENABLED_ENV];
    } else {
      process.env[WATCHLIST_TRADER_READ_AI_ENABLED_ENV] = previous;
    }
  }
});

test("formatLevelSnapshotMessage keeps current no-level wording trader-facing", () => {
  const message = formatLevelSnapshotMessage({
    symbol: "OPEN",
    currentPrice: 9.8,
    supportZones: [
      { representativePrice: 8.9, strengthLabel: "moderate", sourceLabel: "daily structure" },
    ],
    resistanceZones: [
      { representativePrice: 10, strengthLabel: "major", sourceLabel: "daily confluence" },
    ],
    timestamp: 1,
  });

  assert.match(message, /higher resistance needs a fresh level check before treating the path as open/);
  assert.doesNotMatch(
    message,
    /surfaced ladder|no higher resistance|none currently surfaced|risk stays open toward|Status:|Signal:/i,
  );
});

test("DiscordAlertRouter routes level snapshots separately from alerts", async () => {
  const gateway = new FakeDiscordThreadGateway();
  const router = new DiscordAlertRouter(gateway);

  await router.routeLevelSnapshot("thread-3", {
    symbol: "IMMP",
    currentPrice: 3.31,
    supportZones: [{ representativePrice: 3.15 }],
    resistanceZones: [
      { representativePrice: 3.42 },
      { representativePrice: 3.55 },
    ],
    timestamp: 10,
  });

  assert.deepEqual(gateway.levelSnapshots, [
    {
      threadId: "thread-3",
      payload: {
        symbol: "IMMP",
        currentPrice: 3.31,
        supportZones: [{ representativePrice: 3.15 }],
        resistanceZones: [
          { representativePrice: 3.42 },
          { representativePrice: 3.55 },
        ],
        timestamp: 10,
      },
    },
  ]);
  assert.deepEqual(gateway.levelLadders, []);
});

test("DiscordAlertRouter can post full level ladders when operator flag is enabled", async () => {
  const previous = process.env.LEVEL_DISCORD_POST_FULL_LADDER;
  process.env.LEVEL_DISCORD_POST_FULL_LADDER = "1";
  try {
    const gateway = new FakeDiscordThreadGateway();
    const router = new DiscordAlertRouter(gateway);
    const payload = {
      symbol: "IMMP",
      currentPrice: 3.31,
      supportZones: [{ representativePrice: 3.15 }],
      resistanceZones: [
        { representativePrice: 3.42 },
        { representativePrice: 3.55 },
      ],
      timestamp: 10,
    };

    await router.routeLevelSnapshot("thread-3", payload);

    assert.deepEqual(gateway.levelLadders, [{ threadId: "thread-3", payload }]);
  } finally {
    if (previous === undefined) {
      delete process.env.LEVEL_DISCORD_POST_FULL_LADDER;
    } else {
      process.env.LEVEL_DISCORD_POST_FULL_LADDER = previous;
    }
  }
});

test("formatLevelExtensionMessage uses deterministic formatting", () => {
  assert.equal(
    formatLevelExtensionMessage({
      symbol: "ALBT",
      side: "resistance",
      levels: [2.9, 3.15],
      timestamp: 1,
    }),
    [
      "ALBT next levels to watch",
      "Overhead resistance levels: 2.90, 3.15",
    ].join("\n"),
  );
});

test("DiscordAlertRouter routes level extensions separately from other Discord message types", async () => {
  const gateway = new FakeDiscordThreadGateway();
  const router = new DiscordAlertRouter(gateway);

  await router.routeLevelExtension("thread-4", {
    symbol: "BIRD",
    side: "support",
    levels: [1.45, 1.32],
    timestamp: 12,
  });

  assert.deepEqual(gateway.levelExtensions, [
    {
      threadId: "thread-4",
      payload: {
        symbol: "BIRD",
        side: "support",
        levels: [1.45, 1.32],
        timestamp: 12,
      },
    },
  ]);
});
