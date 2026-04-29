import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFollowThroughStoryRecord,
  buildFollowThroughStoryKey,
  buildIntelligentAlertStoryRecord,
  classifyLiveThreadMessage,
  decideAiSignalPost,
  decideCriticalLivePost,
  decideFollowThroughPost,
  decideIntelligentAlertPost,
  decideNarrationBurst,
  decideOptionalLivePost,
  getLiveThreadPostingPolicySettings,
  resolveLiveThreadPostingProfile,
} from "../lib/monitoring/live-thread-post-policy.js";
import type { EvaluatedOpportunity } from "../lib/monitoring/opportunity-evaluator.js";

function evaluation(overrides: Partial<EvaluatedOpportunity> = {}): EvaluatedOpportunity {
  return {
    symbol: "ATER",
    timestamp: 1000,
    evaluatedAt: 1000,
    entryPrice: 1.23,
    outcomePrice: 1.21,
    returnPct: -1,
    directionalReturnPct: -1,
    followThroughLabel: "failed",
    success: false,
    eventType: "breakdown",
    ...overrides,
  };
}

test("live thread policy classifies output classes explicitly", () => {
  assert.equal(classifyLiveThreadMessage("follow_through_update"), "trader_critical");
  assert.equal(classifyLiveThreadMessage("ai_signal_commentary"), "trader_helpful_optional");
  assert.equal(classifyLiveThreadMessage(undefined), "operator_only");
});

test("posting profiles resolve safely and expose different output appetites", () => {
  assert.equal(resolveLiveThreadPostingProfile("quiet"), "quiet");
  assert.equal(resolveLiveThreadPostingProfile("ACTIVE"), "active");
  assert.equal(resolveLiveThreadPostingProfile("nope"), "balanced");

  const quiet = getLiveThreadPostingPolicySettings("quiet");
  const balanced = getLiveThreadPostingPolicySettings("balanced");
  const active = getLiveThreadPostingPolicySettings("active");
  assert.ok(quiet.minInitialFollowThroughMovePct > balanced.minInitialFollowThroughMovePct);
  assert.ok(active.minInitialFollowThroughMovePct < balanced.minInitialFollowThroughMovePct);
  assert.equal(quiet.allowMinorContinuity, false);
  assert.equal(active.allowMinorContinuity, true);
});

test("follow-through policy suppresses repeated same-story outcomes after cooldown until material change", () => {
  const first = evaluation();
  const record = buildFollowThroughStoryRecord(first);
  const repeat = evaluation({
    evaluatedAt: 10 * 60 * 1000,
    timestamp: 10 * 60 * 1000,
    directionalReturnPct: -1.2,
    returnPct: -1.2,
  });
  const material = evaluation({
    evaluatedAt: 11 * 60 * 1000,
    timestamp: 11 * 60 * 1000,
    directionalReturnPct: -3.2,
    returnPct: -3.2,
  });

  assert.equal(buildFollowThroughStoryKey(first), "breakdown|1.24");
  assert.deepEqual(decideFollowThroughPost({ records: [record], evaluation: repeat }), {
    shouldPost: false,
    reason: "not_materially_new",
    storyKey: "breakdown|1.24",
  });
  assert.deepEqual(decideFollowThroughPost({ records: [record], evaluation: material }), {
    shouldPost: true,
    reason: "materially_new",
    storyKey: "breakdown|1.24",
  });
});

test("follow-through policy suppresses tiny initial updates", () => {
  assert.deepEqual(decideFollowThroughPost({
    records: [],
    evaluation: evaluation({
      eventType: "level_touch",
      followThroughLabel: "working",
      entryPrice: 1.06,
      outcomePrice: 1.07,
      directionalReturnPct: 0.94,
      returnPct: 0.94,
    }),
  }), {
    shouldPost: false,
    reason: "minor_initial_move",
    storyKey: "level_touch|1.06",
  });
});

test("follow-through policy blocks weak label transitions on the same level", () => {
  const record = buildFollowThroughStoryRecord(evaluation({
    followThroughLabel: "strong",
    directionalReturnPct: 3.4,
    returnPct: 3.4,
  }));

  assert.deepEqual(
    decideFollowThroughPost({
      records: [record],
      evaluation: evaluation({
        evaluatedAt: 12 * 60 * 1000,
        timestamp: 12 * 60 * 1000,
        followThroughLabel: "working",
        directionalReturnPct: 2.8,
        returnPct: 2.8,
      }),
    }),
    {
      shouldPost: false,
      reason: "weak_label_transition",
      storyKey: "breakdown|1.24",
    },
  );
});

test("intelligent alert policy suppresses same-zone chatter", () => {
  const record = buildIntelligentAlertStoryRecord({
    timestamp: 1000,
    eventType: "breakdown",
    level: 1.61,
    triggerPrice: 1.6,
    severity: "high",
    score: 52,
  });

  assert.deepEqual(decideIntelligentAlertPost({
    records: [record],
    timestamp: 2 * 60 * 1000,
    eventType: "breakdown",
    level: 1.61,
    triggerPrice: 1.6,
    severity: "high",
    score: 55,
  }), {
    shouldPost: false,
    reason: "same_story_cooldown",
    storyKey: "breakdown|1.62",
    zoneKey: "1.62",
  });

  assert.deepEqual(decideIntelligentAlertPost({
    records: [record],
    timestamp: 2 * 60 * 1000,
    eventType: "reclaim",
    level: 1.61,
    triggerPrice: 1.61,
    severity: "high",
    score: 55,
  }), {
    shouldPost: false,
    reason: "zone_chop",
    storyKey: "reclaim|1.62",
    zoneKey: "1.62",
  });
});

test("critical live post policy blocks bursts while allowing major changes", () => {
  const criticalPosts = Array.from({ length: 5 }, (_, index) => ({
    kind: "follow_through" as const,
    timestamp: 1000 + index * 1000,
    eventType: "breakdown",
  }));

  assert.deepEqual(
    decideCriticalLivePost({
      criticalPosts,
      timestamp: 7000,
      kind: "follow_through",
      eventType: "breakdown",
      majorChange: false,
    }),
    {
      shouldPost: false,
      reason: "critical_burst",
    },
  );

  assert.deepEqual(
    decideCriticalLivePost({
      criticalPosts,
      timestamp: 7000,
      kind: "follow_through",
      eventType: "breakdown",
      majorChange: true,
    }),
    {
      shouldPost: true,
      reason: "allowed",
    },
  );
});

test("AI signal policy blocks in-flight duplicate stories and low-value repeats", () => {
  const storyKey = "ATER|breakdown|1.23|ater breakdown";
  assert.equal(
    decideAiSignalPost({
      records: [{ storyKey, reservedAt: 1000 }],
      symbolAiRecords: [{ storyKey, reservedAt: 1000 }],
      timestamp: 1500,
      storyKey,
      severity: "high",
      confidence: "high",
      score: 60,
    }).reason,
    "in_flight_or_recent_story",
  );
  assert.equal(
    decideAiSignalPost({
      records: [],
      symbolAiRecords: [],
      timestamp: 2000,
      storyKey: "ATER|level_touch|1.23|ater level touch",
      severity: "medium",
      confidence: "medium",
      score: 35,
    }).reason,
    "low_value_repeat",
  );
});

test("optional live post policy blocks reactive same-event overlap and stale optional density", () => {
  assert.deepEqual(
    decideOptionalLivePost({
      criticalPosts: [],
      optionalPosts: [{ kind: "continuity", timestamp: 1000, eventType: "level_touch" }],
      narrationAttempts: [],
      timestamp: 1500,
      kind: "follow_through_state",
      majorChange: false,
      eventType: "level_touch",
      deliveryBackoffActive: false,
      optionalDensityLimit: 2,
      optionalKindLimit: 1,
      continuityCooldownMs: 5 * 60 * 1000,
      continuityMajorTransitionCooldownMs: 12 * 60 * 1000,
      narrationBurstWindowMs: 90 * 1000,
    }),
    {
      shouldPost: false,
      reason: "reactive_same_event_overlap",
    },
  );

  assert.equal(
    decideOptionalLivePost({
      criticalPosts: [{ kind: "intelligent_alert", timestamp: 0, eventType: "breakout" }],
      optionalPosts: [
        { kind: "continuity", timestamp: 1000, eventType: "breakout" },
        { kind: "recap", timestamp: 2000, eventType: "breakout" },
      ],
      narrationAttempts: [],
      timestamp: 10 * 60 * 1000,
      kind: "recap",
      majorChange: false,
      eventType: "breakout",
      deliveryBackoffActive: false,
      optionalDensityLimit: 2,
      optionalKindLimit: 1,
      continuityCooldownMs: 5 * 60 * 1000,
      continuityMajorTransitionCooldownMs: 12 * 60 * 1000,
      narrationBurstWindowMs: 90 * 1000,
    }).reason,
    "optional_density",
  );
});

test("optional live post policy suppresses minor follow-through state chatter", () => {
  assert.deepEqual(
    decideOptionalLivePost({
      criticalPosts: [{ kind: "intelligent_alert", timestamp: 1000, eventType: "breakout" }],
      optionalPosts: [],
      narrationAttempts: [],
      timestamp: 2000,
      kind: "follow_through_state",
      majorChange: false,
      eventType: "breakout",
      progressLabel: "stalling",
      directionalReturnPct: 0.8,
      deliveryBackoffActive: false,
      optionalDensityLimit: 2,
      optionalKindLimit: 1,
      continuityCooldownMs: 5 * 60 * 1000,
      continuityMajorTransitionCooldownMs: 12 * 60 * 1000,
      narrationBurstWindowMs: 90 * 1000,
    }),
    {
      shouldPost: false,
      reason: "stalling_follow_through_state",
    },
  );

  assert.deepEqual(
    decideOptionalLivePost({
      criticalPosts: [{ kind: "intelligent_alert", timestamp: 1000, eventType: "breakout" }],
      optionalPosts: [],
      narrationAttempts: [],
      timestamp: 2000,
      kind: "follow_through_state",
      majorChange: false,
      eventType: "breakout",
      progressLabel: "improving",
      directionalReturnPct: 0.6,
      deliveryBackoffActive: false,
      optionalDensityLimit: 2,
      optionalKindLimit: 1,
      continuityCooldownMs: 5 * 60 * 1000,
      continuityMajorTransitionCooldownMs: 12 * 60 * 1000,
      narrationBurstWindowMs: 90 * 1000,
    }),
    {
      shouldPost: false,
      reason: "minor_follow_through_state",
    },
  );

  assert.equal(
    decideOptionalLivePost({
      criticalPosts: [{ kind: "intelligent_alert", timestamp: 1000, eventType: "breakout" }],
      optionalPosts: [],
      narrationAttempts: [],
      timestamp: 2000,
      kind: "follow_through_state",
      majorChange: false,
      eventType: "breakout",
      progressLabel: "improving",
      directionalReturnPct: 1.2,
      deliveryBackoffActive: false,
      optionalDensityLimit: 2,
      optionalKindLimit: 1,
      continuityCooldownMs: 5 * 60 * 1000,
      continuityMajorTransitionCooldownMs: 12 * 60 * 1000,
      narrationBurstWindowMs: 90 * 1000,
    }).reason,
    "allowed",
  );
});

test("narration burst policy limits recap and reactive clusters", () => {
  assert.equal(
    decideNarrationBurst({
      state: [
        { kind: "continuity", timestamp: 1000, eventType: "level_touch" },
        { kind: "follow_through_state", timestamp: 1200, eventType: "level_touch" },
      ],
      timestamp: 1300,
      kind: "recap",
      eventType: "level_touch",
      narrationBurstWindowMs: 90 * 1000,
      recapBurstWindowMs: 75 * 1000,
      continuityCooldownMs: 5 * 60 * 1000,
    }).reason,
    "burst_limit",
  );

  assert.equal(
    decideNarrationBurst({
      state: [{ kind: "continuity", timestamp: 1000, eventType: "breakout" }],
      timestamp: 1200,
      kind: "recap",
      eventType: "breakout",
      narrationBurstWindowMs: 90 * 1000,
      recapBurstWindowMs: 75 * 1000,
      continuityCooldownMs: 5 * 60 * 1000,
    }).reason,
    "recap_burst",
  );
});
