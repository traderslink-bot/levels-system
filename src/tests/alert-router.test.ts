import assert from "node:assert/strict";
import test from "node:test";

import {
  formatContinuityUpdateAsPayload,
  DiscordAlertRouter,
  formatFollowThroughStateUpdateAsPayload,
  formatFollowThroughUpdateAsPayload,
  formatIntelligentAlertAsPayload,
  formatLevelExtensionMessage,
  formatLevelSnapshotMessage,
  formatSymbolRecapAsPayload,
} from "../lib/alerts/alert-router.js";
import type {
  AlertPayload,
  DiscordThread,
  LevelExtensionPayload,
  LevelSnapshotPayload,
} from "../lib/alerts/alert-types.js";

class FakeDiscordThreadGateway {
  public readonly threads = new Map<string, DiscordThread>();
  public readonly sentMessages: Array<{ threadId: string; payload: AlertPayload }> = [];
  public readonly levelSnapshots: Array<{ threadId: string; payload: LevelSnapshotPayload }> = [];
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

  assert.match(payload.body, /What to watch:\n- nearby support reaction area: light support 1\.06; buyers need stabilization there or a reclaim of 1\.24/);
  assert.match(payload.body, /Hold \/ failure map:\n- 1\.24 is the reclaim line for the long setup; below it, risk stays open toward light support 1\.06 unless buyers stabilize first\./);
  assert.match(payload.body, /Key levels:\n- Reclaim area: moderate resistance 1\.24\n- Nearby support: light support 1\.06/);
  assert.doesNotMatch(payload.body, /Risk support/);
  assert.doesNotMatch(payload.body, /dip-buy/i);
  assert.doesNotMatch(payload.body, /Nearby resistance/);
  assert.doesNotMatch(payload.body, /\b(Buy|Sell|buy at|sell if|take profit|stop out)\b/);
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
  assert.match(payload.body, /buyers need acceptance above 2\.64/);
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
      "watch: buyers stabilize into 2.90-2.93; losing it keeps risk open lower",
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
      "watch: buyers stabilize at 2.91-2.93; losing it keeps risk open lower",
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
      line: "follow-through: support-loss warning faded",
    },
  });

  assert.equal(payload.title, "ALBT support-loss warning follow-through");
  assert.match(payload.body, /support-loss warning faded/);
  assert.match(payload.body, /price change from trigger: -1\.66%/);
  assert.doesNotMatch(payload.body, /breakdown failed|after the alert|alert direction/);
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
      "",
      "What price is doing now:",
      "- Price is between support 2.40 and resistance 2.60.",
      "- Room is fairly balanced between the nearest support and resistance.",
      "",
      "Closest levels to watch:",
      "Resistance:",
      "2.60 (+3.6%, major, 4h confluence)",
      "2.75 (+9.6%, moderate, extension)",
      "",
      "Support:",
      "2.40 (-4.4%, heavy, daily structure)",
      "2.25 (-10.4%, light, fresh intraday)",
      "",
      "More support and resistance:",
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

  assert.match(message, /2\.39-2\.47 zone \(\+0\.8% to \+4\.2%, major, clustered levels\)/);
  assert.doesNotMatch(message, /2\.39 \(\+0\.8%/);
  assert.doesNotMatch(message, /2\.43 \(\+2\.5%/);
  assert.doesNotMatch(message, /2\.47 \(\+4\.2%/);
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
