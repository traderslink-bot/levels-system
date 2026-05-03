import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFollowThroughStoryRecord,
  buildFollowThroughStoryKey,
  buildIntelligentAlertStoryKey,
  buildIntelligentAlertStoryRecord,
  buildThreadStoryPhaseRecord,
  classifyLiveThreadMessage,
  decideAiSignalPost,
  decideCriticalLivePost,
  decideFollowThroughPost,
  decideIntelligentAlertPost,
  decideNarrationBurst,
  decideOptionalLivePost,
  decideThreadStoryPhasePost,
  deriveThreadStoryPhase,
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
    directionalReturnPct: -4.1,
    returnPct: -4.1,
  });

  assert.equal(buildFollowThroughStoryKey(first), "breakdown|1.25");
  assert.deepEqual(decideFollowThroughPost({ records: [record], evaluation: repeat }), {
    shouldPost: false,
    reason: "not_materially_new",
    storyKey: "breakdown|1.25",
  });
  assert.deepEqual(decideFollowThroughPost({ records: [record], evaluation: material }), {
    shouldPost: true,
    reason: "materially_new",
    storyKey: "breakdown|1.25",
  });
});

test("follow-through policy treats small-cap one-percent wiggles as too minor for a fresh update", () => {
  assert.deepEqual(decideFollowThroughPost({
    records: [],
    evaluation: evaluation({
      eventType: "breakout",
      entryPrice: 6.03,
      outcomePrice: 5.93,
      followThroughLabel: "failed",
      directionalReturnPct: -1.66,
      returnPct: -1.66,
    }),
  }), {
    shouldPost: false,
    reason: "minor_initial_move",
    storyKey: "breakout|5.97",
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
    storyKey: "level_touch|1.05",
  });
});

test("follow-through policy groups nearby level-touch updates into the same story", () => {
  const first = evaluation({
    eventType: "level_touch",
    entryPrice: 27.62,
    followThroughLabel: "strong",
    directionalReturnPct: 1.67,
    returnPct: 1.67,
  });
  const record = buildFollowThroughStoryRecord(first);
  const nearbyRepeat = evaluation({
    eventType: "level_touch",
    entryPrice: 27.78,
    evaluatedAt: 12 * 60 * 1000,
    timestamp: 12 * 60 * 1000,
    followThroughLabel: "strong",
    directionalReturnPct: 1.76,
    returnPct: 1.76,
  });

  assert.deepEqual(decideFollowThroughPost({ records: [record], evaluation: nearbyRepeat }), {
    shouldPost: false,
    reason: "not_materially_new",
    storyKey: buildFollowThroughStoryKey(nearbyRepeat),
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
      storyKey: "breakdown|1.25",
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
    storyKey: "breakdown|1.63",
    zoneKey: "1.63",
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
    storyKey: "reclaim|1.63",
    zoneKey: "1.63",
  });
});

test("intelligent alert policy suppresses range-bound chop after repeated same-band posts", () => {
  const records = [
    buildIntelligentAlertStoryRecord({
      timestamp: 0,
      eventType: "level_touch",
      level: 1.0162,
      triggerPrice: 1.02,
      severity: "high",
      score: 56,
    }),
    buildIntelligentAlertStoryRecord({
      timestamp: 16 * 60 * 1000,
      eventType: "breakdown",
      level: 1.00,
      triggerPrice: 1.00,
      severity: "high",
      score: 58,
    }),
    buildIntelligentAlertStoryRecord({
      timestamp: 50 * 60 * 1000,
      eventType: "level_touch",
      level: 1.0162,
      triggerPrice: 1.02,
      severity: "high",
      score: 57,
    }),
    buildIntelligentAlertStoryRecord({
      timestamp: 80 * 60 * 1000,
      eventType: "breakdown",
      level: 0.9898,
      triggerPrice: 0.99,
      severity: "high",
      score: 59,
    }),
  ];

  assert.deepEqual(decideIntelligentAlertPost({
    records,
    timestamp: 95 * 60 * 1000,
    eventType: "level_touch",
    level: 1.0162,
    triggerPrice: 1.01,
    severity: "high",
    score: 60,
  }), {
    shouldPost: false,
    reason: "same_story_not_material",
    storyKey: "level_touch|1.00",
    zoneKey: "1.00",
  });
});

test("intelligent alert policy suppresses same practical area without material change", () => {
  const record = buildIntelligentAlertStoryRecord({
    timestamp: 0,
    eventType: "level_touch",
    level: 1.0162,
    triggerPrice: 1.02,
    severity: "medium",
    score: 42,
    practicalZoneKey: "1.00-1.02",
    acceptanceLabel: "testing",
    levelImportanceLabel: "useful_reference",
  });

  assert.deepEqual(decideIntelligentAlertPost({
    records: [record],
    timestamp: 22 * 60 * 1000,
    eventType: "level_touch",
    level: 1.0162,
    triggerPrice: 1.01,
    severity: "medium",
    score: 43,
    practicalZoneKey: "1.00-1.02",
    acceptanceLabel: "testing",
    levelImportanceLabel: "useful_reference",
  }), {
    shouldPost: false,
    reason: "same_story_not_material",
    storyKey: "level_touch|1.00",
    zoneKey: "1.00",
  });

  assert.equal(decideIntelligentAlertPost({
    records: [record],
    timestamp: 22 * 60 * 1000,
    eventType: "level_touch",
    level: 1.0162,
    triggerPrice: 1.01,
    severity: "medium",
    score: 43,
    practicalZoneKey: "1.00-1.02",
    acceptanceLabel: "accepted",
    levelImportanceLabel: "major_decision",
  }).shouldPost, true);
});

test("intelligent alert policy keeps a locked main trade area quiet across the structure window", () => {
  const record = buildIntelligentAlertStoryRecord({
    timestamp: 0,
    eventType: "level_touch",
    level: 1.02,
    triggerPrice: 1.01,
    severity: "medium",
    score: 44,
    practicalZoneKey: "range:0.98-1.06",
    acceptanceLabel: "testing",
    behaviorBudgetLabel: "boring_range",
    primaryTradeAreaLocked: true,
    primaryTradeAreaEscapeSide: "none",
    primaryTradeAreaEscapeConfidence: "none",
  });

  assert.deepEqual(decideIntelligentAlertPost({
    records: [record],
    timestamp: 2 * 60 * 60 * 1000,
    eventType: "breakout",
    level: 1.06,
    triggerPrice: 1.065,
    severity: "high",
    score: 58,
    practicalZoneKey: "range:0.98-1.06",
    acceptanceLabel: "testing",
    behaviorBudgetLabel: "boring_range",
    primaryTradeAreaLocked: true,
    primaryTradeAreaEscapeSide: "up",
    primaryTradeAreaEscapeConfidence: "testing",
  }), {
    shouldPost: false,
    reason: "primary_area_lock",
    storyKey: "breakout|1.05",
    zoneKey: "1.05",
  });

  assert.equal(decideIntelligentAlertPost({
    records: [record],
    timestamp: 2 * 60 * 60 * 1000,
    eventType: "breakout",
    level: 1.06,
    triggerPrice: 1.1,
    severity: "high",
    score: 58,
    practicalZoneKey: "range:0.98-1.06",
    acceptanceLabel: "accepted",
    behaviorBudgetLabel: "boring_range",
    primaryTradeAreaLocked: true,
    primaryTradeAreaEscapeSide: "up",
    primaryTradeAreaEscapeConfidence: "accepted",
  }).shouldPost, true);
});

test("intelligent alert policy suppresses stale same-level stories without a material change", () => {
  const record = buildIntelligentAlertStoryRecord({
    timestamp: 0,
    eventType: "breakout",
    level: 29.8,
    triggerPrice: 29.92,
    severity: "high",
    score: 58,
  });

  assert.deepEqual(decideIntelligentAlertPost({
    records: [record],
    timestamp: 45 * 60 * 1000,
    eventType: "breakout",
    level: 29.8,
    triggerPrice: 30.05,
    severity: "high",
    score: 60,
  }), {
    shouldPost: false,
    reason: "same_story_not_material",
    storyKey: "breakout|29.68",
    zoneKey: "29.68",
  });

  assert.deepEqual(decideIntelligentAlertPost({
    records: [record],
    timestamp: 45 * 60 * 1000,
    eventType: "breakout",
    level: 29.8,
    triggerPrice: 30.55,
    severity: "high",
    score: 60,
  }), {
    shouldPost: true,
    reason: "new_story",
    storyKey: "breakout|29.68",
    zoneKey: "29.68",
  });
});

test("intelligent alert policy allows same-level stories when practical structure changes", () => {
  const record = buildIntelligentAlertStoryRecord({
    timestamp: 0,
    eventType: "level_touch",
    level: 1.06,
    triggerPrice: 1.055,
    severity: "high",
    score: 58,
    practicalStructureState: "range_bound",
    practicalZoneKey: "support:0.9898-1.02|resistance:1.06-1.06",
  });

  assert.deepEqual(decideIntelligentAlertPost({
    records: [record],
    timestamp: 35 * 60 * 1000,
    eventType: "level_touch",
    level: 1.06,
    triggerPrice: 1.058,
    severity: "high",
    score: 59,
    practicalStructureState: "pressing_resistance",
    practicalZoneKey: "support:0.9898-1.02|resistance:1.06-1.06",
    practicalStructureMaterialChange: true,
  }), {
    shouldPost: true,
    reason: "new_story",
    storyKey: "level_touch|1.05",
    zoneKey: "1.05",
  });
});

test("intelligent alert policy allows same-level stories when stable 5m structure changes materially", () => {
  const record = buildIntelligentAlertStoryRecord({
    timestamp: 0,
    eventType: "level_touch",
    level: 1.06,
    triggerPrice: 1.055,
    severity: "high",
    score: 58,
    stableMarketStructureState: "range_bound",
    stableMarketStructureKey: "range_bound|1.00-1.06",
  });

  assert.deepEqual(decideIntelligentAlertPost({
    records: [record],
    timestamp: 35 * 60 * 1000,
    eventType: "level_touch",
    level: 1.06,
    triggerPrice: 1.058,
    severity: "high",
    score: 59,
    stableMarketStructureState: "pressing_range_high",
    stableMarketStructureKey: "pressing_range_high|1.00-1.06",
    stableMarketStructureMaterialChange: true,
  }), {
    shouldPost: true,
    reason: "new_story",
    storyKey: "level_touch|1.05",
    zoneKey: "1.05",
  });
});

test("intelligent alert policy uses stable 5m structure to suppress unchanged range chatter", () => {
  const records = [
    buildIntelligentAlertStoryRecord({
      timestamp: 0,
      eventType: "level_touch",
      level: 1.02,
      triggerPrice: 1.02,
      severity: "high",
      score: 56,
      stableMarketStructureState: "range_bound",
      stableMarketStructureKey: "range_bound|0.99-1.06",
    }),
    buildIntelligentAlertStoryRecord({
      timestamp: 20 * 60 * 1000,
      eventType: "breakdown",
      level: 1.00,
      triggerPrice: 1.00,
      severity: "high",
      score: 57,
      stableMarketStructureState: "range_bound",
      stableMarketStructureKey: "range_bound|0.99-1.06",
    }),
    buildIntelligentAlertStoryRecord({
      timestamp: 32 * 60 * 1000,
      eventType: "rejection",
      level: 1.03,
      triggerPrice: 1.03,
      severity: "high",
      score: 57,
      stableMarketStructureState: "range_bound",
      stableMarketStructureKey: "range_bound|0.99-1.06",
    }),
  ];

  assert.deepEqual(decideIntelligentAlertPost({
    records,
    timestamp: 45 * 60 * 1000,
    eventType: "compression",
    level: 1.01,
    triggerPrice: 1.01,
    severity: "high",
    score: 58,
    stableMarketStructureState: "range_bound",
    stableMarketStructureKey: "range_bound|0.99-1.06",
  }), {
    shouldPost: false,
    reason: "structure_budget",
    storyKey: "compression|1.00",
    zoneKey: "1.00",
  });
});

test("intelligent alert policy still allows real expansion out of a prior chop band", () => {
  const records = Array.from({ length: 4 }, (_, index) => buildIntelligentAlertStoryRecord({
    timestamp: index * 20 * 60 * 1000,
    eventType: index % 2 === 0 ? "level_touch" : "breakdown",
    level: index % 2 === 0 ? 1.0162 : 1.00,
    triggerPrice: index % 2 === 0 ? 1.02 : 1.00,
    severity: "high",
    score: 56 + index,
  }));

  assert.deepEqual(decideIntelligentAlertPost({
    records,
    timestamp: 95 * 60 * 1000,
    eventType: "breakout",
    level: 1.12,
    triggerPrice: 1.12,
    severity: "high",
    score: 62,
  }), {
    shouldPost: true,
    reason: "new_story",
    storyKey: "breakout|1.10",
    zoneKey: "1.10",
  });
});

test("intelligent alert policy groups small-cap penny-level flicker into the same story bucket", () => {
  assert.equal(
    buildIntelligentAlertStoryKey({ eventType: "breakdown", level: 1.00 }),
    buildIntelligentAlertStoryKey({ eventType: "breakdown", level: 1.02 }),
  );
  assert.notEqual(
    buildIntelligentAlertStoryKey({ eventType: "breakout", level: 1.06 }),
    buildIntelligentAlertStoryKey({ eventType: "breakout", level: 1.12 }),
  );
});

test("intelligent alert policy compares nearby levels directly instead of trusting bucket boundaries", () => {
  const record = buildIntelligentAlertStoryRecord({
    timestamp: 0,
    eventType: "breakout",
    level: 1.32,
    triggerPrice: 1.33,
    severity: "high",
    score: 58,
  });

  assert.deepEqual(decideIntelligentAlertPost({
    records: [record],
    timestamp: 45 * 60 * 1000,
    eventType: "breakout",
    level: 1.33,
    triggerPrice: 1.34,
    severity: "high",
    score: 59,
  }), {
    shouldPost: false,
    reason: "same_story_not_material",
    storyKey: "breakout|1.35",
    zoneKey: "1.35",
  });
});

test("intelligent alert policy compresses repeated breakout and reclaim cycling inside the same practical area", () => {
  const practicalZoneKey = "support:0.9898-1.02|resistance:1.06-1.06";
  const records = [
    buildIntelligentAlertStoryRecord({
      timestamp: 0,
      eventType: "level_touch",
      level: 1.02,
      triggerPrice: 1.02,
      severity: "high",
      score: 56,
      practicalStructureState: "range_bound",
      practicalZoneKey,
    }),
    buildIntelligentAlertStoryRecord({
      timestamp: 15 * 60 * 1000,
      eventType: "level_touch",
      level: 1.06,
      triggerPrice: 1.055,
      severity: "high",
      score: 57,
      practicalStructureState: "pressing_resistance",
      practicalZoneKey,
    }),
    buildIntelligentAlertStoryRecord({
      timestamp: 30 * 60 * 1000,
      eventType: "breakout",
      level: 1.06,
      triggerPrice: 1.062,
      severity: "high",
      score: 58,
      practicalStructureState: "breakout_attempt",
      practicalZoneKey,
    }),
    buildIntelligentAlertStoryRecord({
      timestamp: 45 * 60 * 1000,
      eventType: "reclaim",
      level: 1.02,
      triggerPrice: 1.028,
      severity: "high",
      score: 58,
      practicalStructureState: "reclaim_attempt",
      practicalZoneKey,
    }),
  ];

  assert.deepEqual(decideIntelligentAlertPost({
    records,
    timestamp: 60 * 60 * 1000,
    eventType: "breakout",
    level: 1.06,
    triggerPrice: 1.065,
    severity: "high",
    score: 59,
    practicalStructureState: "breakout_attempt",
    practicalZoneKey,
  }), {
    shouldPost: false,
    reason: "same_story_not_material",
    storyKey: "breakout|1.05",
    zoneKey: "1.05",
  });

  assert.deepEqual(decideIntelligentAlertPost({
    records,
    timestamp: 60 * 60 * 1000,
    eventType: "breakout",
    level: 1.18,
    triggerPrice: 1.18,
    severity: "high",
    score: 59,
    practicalStructureState: "breakout_attempt",
    practicalZoneKey,
  }), {
    shouldPost: true,
    reason: "new_story",
    storyKey: "breakout|1.20",
    zoneKey: "1.20",
  });
});

test("intelligent alert policy compresses repeated small-cap breakout/reclaim flicker inside one range", () => {
  const records = [
    buildIntelligentAlertStoryRecord({
      timestamp: 0,
      eventType: "level_touch",
      level: 1.01,
      triggerPrice: 1.02,
      severity: "high",
      score: 58,
      practicalStructureState: "range_bound",
    }),
    buildIntelligentAlertStoryRecord({
      timestamp: 15 * 60 * 1000,
      eventType: "breakout",
      level: 1.06,
      triggerPrice: 1.065,
      severity: "high",
      score: 59,
      practicalStructureState: "breakout_attempt",
    }),
    buildIntelligentAlertStoryRecord({
      timestamp: 35 * 60 * 1000,
      eventType: "reclaim",
      level: 1.01,
      triggerPrice: 1.02,
      severity: "high",
      score: 58,
      practicalStructureState: "reclaim_attempt",
    }),
  ];

  assert.deepEqual(decideIntelligentAlertPost({
    records,
    timestamp: 55 * 60 * 1000,
    eventType: "breakout",
    level: 1.06,
    triggerPrice: 1.07,
    severity: "high",
    score: 59,
    practicalStructureState: "breakout_attempt",
  }), {
    shouldPost: false,
    reason: "same_story_not_material",
    storyKey: "breakout|1.05",
    zoneKey: "1.05",
  });

  assert.deepEqual(decideIntelligentAlertPost({
    records,
    timestamp: 60 * 60 * 1000,
    eventType: "breakout",
    level: 1.18,
    triggerPrice: 1.2,
    severity: "high",
    score: 59,
    practicalStructureState: "breakout_attempt",
  }), {
    shouldPost: true,
    reason: "new_story",
    storyKey: "breakout|1.20",
    zoneKey: "1.20",
  });
});

test("intelligent alert policy does not treat practical-zone key drift as a fresh same-level story", () => {
  const record = buildIntelligentAlertStoryRecord({
    timestamp: 0,
    eventType: "level_touch",
    level: 1.02,
    triggerPrice: 1.02,
    severity: "high",
    score: 58,
    practicalStructureState: "pressing_resistance",
    practicalZoneKey: "support:1.00|resistance:1.05",
  });

  assert.deepEqual(decideIntelligentAlertPost({
    records: [record],
    timestamp: 45 * 60 * 1000,
    eventType: "level_touch",
    level: 1.02,
    triggerPrice: 1.025,
    severity: "high",
    score: 59,
    practicalStructureState: "pressing_resistance",
    practicalZoneKey: "support:1.00|resistance:1.10",
  }), {
    shouldPost: false,
    reason: "same_story_not_material",
    storyKey: "level_touch|1.00",
    zoneKey: "1.00",
  });
});

test("intelligent alert policy applies a practical structure post budget inside the same trade area", () => {
  const records = [
    buildIntelligentAlertStoryRecord({
      timestamp: 0,
      eventType: "level_touch",
      level: 1.02,
      triggerPrice: 1.02,
      severity: "high",
      score: 56,
      practicalStructureState: "range_bound",
      practicalZoneKey: "support:0.9898-1.02|resistance:1.06-1.06",
    }),
    buildIntelligentAlertStoryRecord({
      timestamp: 25 * 60 * 1000,
      eventType: "compression",
      level: 1.04,
      triggerPrice: 1.04,
      severity: "high",
      score: 58,
      practicalStructureState: "range_bound",
      practicalZoneKey: "support:0.9898-1.02|resistance:1.06-1.06",
    }),
  ];

  assert.deepEqual(decideIntelligentAlertPost({
    records,
    timestamp: 55 * 60 * 1000,
    eventType: "level_touch",
    level: 1.06,
    triggerPrice: 1.058,
    severity: "high",
    score: 59,
    practicalStructureState: "range_bound",
    practicalZoneKey: "support:0.9898-1.02|resistance:1.06-1.06",
  }), {
    shouldPost: false,
    reason: "range_bound_chop",
    storyKey: "level_touch|1.05",
    zoneKey: "1.05",
  });
});

test("intelligent alert policy lets real structure transitions through the practical budget", () => {
  const records = [
    buildIntelligentAlertStoryRecord({
      timestamp: 0,
      eventType: "level_touch",
      level: 1.02,
      triggerPrice: 1.02,
      severity: "high",
      score: 56,
      practicalStructureState: "range_bound",
      practicalZoneKey: "support:0.9898-1.02|resistance:1.06-1.06",
    }),
    buildIntelligentAlertStoryRecord({
      timestamp: 25 * 60 * 1000,
      eventType: "compression",
      level: 1.04,
      triggerPrice: 1.04,
      severity: "high",
      score: 58,
      practicalStructureState: "range_bound",
      practicalZoneKey: "support:0.9898-1.02|resistance:1.06-1.06",
    }),
  ];

  assert.deepEqual(decideIntelligentAlertPost({
    records,
    timestamp: 55 * 60 * 1000,
    eventType: "level_touch",
    level: 1.06,
    triggerPrice: 1.058,
    severity: "high",
    score: 59,
    practicalStructureState: "pressing_resistance",
    practicalZoneKey: "support:0.9898-1.02|resistance:1.06-1.06",
    practicalStructureMaterialChange: true,
  }), {
    shouldPost: true,
    reason: "new_story",
    storyKey: "level_touch|1.05",
    zoneKey: "1.05",
  });
});

test("critical live post policy blocks bursts while allowing major changes", () => {
  const mixedCriticalPosts = Array.from({ length: 4 }, (_, index) => ({
    kind: index % 2 === 0 ? "follow_through" as const : "intelligent_alert" as const,
    timestamp: 1000 + index * 1000,
    eventType: "breakdown",
  }));
  const repeatedFollowThroughPosts = Array.from({ length: 3 }, (_, index) => ({
    kind: "follow_through" as const,
    timestamp: 1000 + index * 1000,
    eventType: "breakdown",
  }));

  assert.deepEqual(
    decideCriticalLivePost({
      criticalPosts: mixedCriticalPosts,
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
      criticalPosts: repeatedFollowThroughPosts,
      timestamp: 7000,
      kind: "follow_through",
      eventType: "breakdown",
      majorChange: false,
    }),
    {
      shouldPost: false,
      reason: "critical_kind_burst",
    },
  );

  assert.deepEqual(
    decideCriticalLivePost({
      criticalPosts: repeatedFollowThroughPosts,
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

test("thread story phase policy suppresses repeated same-phase posts in the same area", () => {
  const record = buildThreadStoryPhaseRecord({
    timestamp: 0,
    phase: "pressing_resistance",
    areaKey: "support:0.9898-1.02|resistance:1.06-1.06",
    triggerPrice: 1.058,
    eventType: "level_touch",
  });

  assert.deepEqual(decideThreadStoryPhasePost({
    records: [record],
    timestamp: 20 * 60 * 1000,
    phase: "pressing_resistance",
    areaKey: "support:0.9898-1.02|resistance:1.06-1.06",
    triggerPrice: 1.06,
    eventType: "level_touch",
  }), {
    shouldPost: false,
    reason: "same_phase_repeat",
    phaseKey: "pressing_resistance|support:0.9898-1.02|resistance:1.06-1.06",
  });
});

test("thread story phase policy allows meaningful phase changes and expansion", () => {
  const record = buildThreadStoryPhaseRecord({
    timestamp: 0,
    phase: "range_bound",
    areaKey: "support:0.9898-1.02|resistance:1.06-1.06",
    triggerPrice: 1.02,
    eventType: "level_touch",
  });

  assert.equal(deriveThreadStoryPhase({
    eventType: "level_touch",
    practicalStructureState: "pressing_resistance",
  }), "pressing_resistance");

  assert.deepEqual(decideThreadStoryPhasePost({
    records: [record],
    timestamp: 20 * 60 * 1000,
    phase: "pressing_resistance",
    areaKey: "support:0.9898-1.02|resistance:1.06-1.06",
    triggerPrice: 1.06,
    eventType: "level_touch",
  }), {
    shouldPost: true,
    reason: "phase_changed",
    phaseKey: "pressing_resistance|support:0.9898-1.02|resistance:1.06-1.06",
  });

  assert.deepEqual(decideThreadStoryPhasePost({
    records: [buildThreadStoryPhaseRecord({
      timestamp: 0,
      phase: "breakout_holding",
      areaKey: "resistance:1.32",
      triggerPrice: 1.32,
      eventType: "breakout",
    })],
    timestamp: 20 * 60 * 1000,
    phase: "breakout_holding",
    areaKey: "resistance:1.32",
    triggerPrice: 1.45,
    eventType: "breakout",
  }), {
    shouldPost: true,
    reason: "phase_expansion",
    phaseKey: "breakout_holding|resistance:1.32",
  });
});

test("thread story phase policy suppresses non-progressive same-area phase churn", () => {
  const areaKey = "support:0.9898-1.02|resistance:1.06-1.06";
  const records = [
    buildThreadStoryPhaseRecord({
      timestamp: 0,
      phase: "pressing_resistance",
      areaKey,
      triggerPrice: 1.058,
      eventType: "level_touch",
    }),
    buildThreadStoryPhaseRecord({
      timestamp: 5 * 60 * 1000,
      phase: "breakout_attempt",
      areaKey,
      triggerPrice: 1.062,
      eventType: "breakout",
    }),
  ];

  assert.deepEqual(decideThreadStoryPhasePost({
    records,
    timestamp: 10 * 60 * 1000,
    phase: "reclaim_attempt",
    areaKey,
    triggerPrice: 1.02,
    eventType: "reclaim",
  }), {
    shouldPost: false,
    reason: "phase_churn",
    phaseKey: `reclaim_attempt|${areaKey}`,
  });

  assert.deepEqual(decideThreadStoryPhasePost({
    records,
    timestamp: 10 * 60 * 1000,
    phase: "breakout_holding",
    areaKey,
    triggerPrice: 1.09,
    eventType: "breakout",
  }), {
    shouldPost: true,
    reason: "phase_changed",
    phaseKey: `breakout_holding|${areaKey}`,
  });
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

test("AI signal policy keeps same-symbol reads quiet after a recent AI post", () => {
  const firstStory = "SAGT|breakout|2.90|sagt breakout";
  const secondStory = "SAGT|breakout|3.30|sagt breakout";

  assert.deepEqual(
    decideAiSignalPost({
      records: [],
      symbolAiRecords: [{ storyKey: firstStory, reservedAt: 1000 }],
      timestamp: 12 * 60 * 1000,
      storyKey: secondStory,
      severity: "critical",
      confidence: "high",
      score: 74,
    }),
    {
      shouldPost: false,
      reason: "recent_symbol_ai",
      storyKey: secondStory,
    },
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

test("intelligent alert policy suppresses weak probes inside an already-posted range box", () => {
  const records = [
    buildIntelligentAlertStoryRecord({
      timestamp: 1,
      eventType: "level_touch",
      level: 1.01,
      triggerPrice: 1.06,
      practicalZoneKey: "support:1.01-1.01|resistance:1.08-1.08",
      rangeBoxLabel: "active",
      acceptanceLabel: "testing",
      behaviorBudgetLabel: "boring_range",
    }),
  ];

  const decision = decideIntelligentAlertPost({
    records,
    timestamp: 2,
    eventType: "breakout",
    level: 1.08,
    triggerPrice: 1.09,
    practicalZoneKey: "support:1.01-1.01|resistance:1.08-1.08",
    rangeBoxLabel: "active",
    acceptanceLabel: "weak_probe",
    behaviorBudgetLabel: "boring_range",
  });

  assert.equal(decision.shouldPost, false);
  assert.equal(decision.reason, "range_box_chop");
});

test("intelligent alert policy allows accepted breaks even when boring-range budget is tight", () => {
  const records = Array.from({ length: 3 }, (_, index) =>
    buildIntelligentAlertStoryRecord({
      timestamp: index + 1,
      eventType: "level_touch",
      level: 1.08,
      triggerPrice: 1.04 + index * 0.01,
      practicalZoneKey: "support:1.01-1.01|resistance:1.08-1.08",
      rangeBoxLabel: "active",
      acceptanceLabel: "testing",
      behaviorBudgetLabel: "boring_range",
    }),
  );

  const decision = decideIntelligentAlertPost({
    records,
    timestamp: 20 * 60 * 1000,
    eventType: "breakout",
    level: 1.08,
    triggerPrice: 1.14,
    practicalZoneKey: "support:1.01-1.01|resistance:1.08-1.08",
    rangeBoxLabel: "active",
    acceptanceLabel: "accepted",
    behaviorBudgetLabel: "boring_range",
    practicalStructureMaterialChange: true,
  });

  assert.equal(decision.shouldPost, true);
});
