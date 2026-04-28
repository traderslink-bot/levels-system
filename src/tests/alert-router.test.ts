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
      "Status: Cleared",
      "",
      "What it means:",
      "- price is pushing farther above the zone high and follow-through is building (0.8%)",
      "",
      "Next levels:",
      "- First resistance: 2.50",
      "",
      "Signal: high severity | medium confidence",
      "Trigger: 2.41",
    ].join("\n"),
  );
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

test("formatIntelligentAlertAsPayload shows conditional dip-buy area for long-caution alerts", () => {
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

  assert.match(payload.body, /What to watch:\n- possible dip-buy area: 1\.06, only if buyers stabilize there or reclaim 1\.24/);
  assert.match(payload.body, /Hold \/ failure map:\n- 1\.24 is the reclaim line for the long setup; below it, risk stays open toward 1\.06 unless buyers stabilize first\./);
  assert.match(payload.body, /Next levels:\n- Possible dip-buy area: 1\.06/);
  assert.doesNotMatch(payload.body, /Risk support/);
  assert.doesNotMatch(payload.body, /\b(Buy|Sell|buy at|sell if|take profit|stop out)\b/);
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
  assert.equal(payload.metadata?.progressLabel, "improving");
  assert.equal(payload.metadata?.directionalReturnPct, 0.42);
  assert.match(payload.body, /improving since the alert/);
});

test("formatContinuityUpdateAsPayload adds continuity metadata", () => {
  const payload = formatContinuityUpdateAsPayload({
    interpretation: {
      symbol: "ALBT",
      message: "buyers reacting at support near 2.40",
      type: "confirmation",
      eventType: "level_touch",
      confidence: 0.82,
      tags: [],
      timestamp: 12,
    },
  });

  assert.equal(payload.metadata?.messageKind, "continuity_update");
  assert.equal(payload.metadata?.continuityType, "confirmation");
  assert.match(payload.body, /buyers reacting at support near 2.40/);
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
      line: "follow-through: breakout is still working after the alert",
    },
  });

  assert.equal(payload.title, "ALBT breakout follow-through");
  assert.equal(
    payload.body,
    [
      "Status: working",
      "",
      "What it means:",
      "- breakout is still working after the alert",
      "- alert direction move: +2.90%",
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
  assert.equal(payload.metadata?.directionalReturnPct, 2.9);
  assert.equal(payload.metadata?.rawReturnPct, 2.9);
});

test("formatLevelSnapshotMessage uses deterministic formatting", () => {
  assert.equal(
    formatLevelSnapshotMessage({
      symbol: "ALBT",
      currentPrice: 2.51,
      supportZones: [
        { representativePrice: 2.4, strengthLabel: "strong" },
        { representativePrice: 2.25, lowPrice: 2.2, highPrice: 2.28, strengthLabel: "weak" },
      ],
      resistanceZones: [
        { representativePrice: 2.6, lowPrice: 2.58, highPrice: 2.62, strengthLabel: "major" },
        { representativePrice: 2.75, strengthLabel: "moderate", isExtension: true },
      ],
      timestamp: 1,
    }),
    [
      "LEVEL SNAPSHOT: ALBT",
      "PRICE: 2.51",
      "",
      "CURRENT READ:",
      "- Price is between support 2.40 and resistance 2.60.",
      "- Room is fairly balanced between the nearest support and resistance.",
      "",
      "KEY LEVELS:",
      "- Resistance: 2.60 (+3.6%, major), 2.75 (+9.6%, moderate extension)",
      "- Support: 2.40 (-4.4%, heavy), 2.25 (-10.4%, light)",
      "",
      "FULL LADDER:",
      "- Support: 2.40 (-4.4%, heavy), 2.25 (-10.4%, light)",
      "- Resistance: 2.60 (+3.6%, major), 2.75 (+9.6%, moderate extension)",
    ].join("\n"),
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
      "NEXT LEVELS: ALBT",
      "SIDE: RESISTANCE",
      "LEVELS: 2.90, 3.15",
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
