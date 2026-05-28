import assert from "node:assert/strict";
import test from "node:test";

import {
  isSignalCategoryEnabledForSurface,
  resolveSignalSurfaceMatrix,
} from "../lib/signals/signal-category-config.js";

test("signal category profiles keep market structure live only in structure-aware profiles", () => {
  assert.equal(
    isSignalCategoryEnabledForSurface("market_structure", "liveDiscord", "levels_only"),
    false,
  );
  assert.equal(
    isSignalCategoryEnabledForSurface("market_structure", "liveDiscord", "levels_plus_structure"),
    true,
  );
  assert.equal(
    isSignalCategoryEnabledForSurface("market_structure", "liveDiscord", "trader_balanced"),
    true,
  );
});

test("signal category profiles keep noisy interpretive categories out of live Discord", () => {
  const matrix = resolveSignalSurfaceMatrix("operator_full");

  assert.equal(matrix.candle_meaning.operatorArtifacts, true);
  assert.equal(matrix.candle_meaning.internalScoring, true);
  assert.equal(matrix.candle_meaning.liveDiscord, false);
  assert.equal(matrix.volume_activity.operatorArtifacts, true);
  assert.equal(matrix.volume_activity.internalScoring, true);
  assert.equal(matrix.volume_activity.liveDiscord, false);
  assert.equal(matrix.liquidity_tradability.liveDiscord, false);
  assert.equal(matrix.volatility_context.liveDiscord, false);
  assert.equal(matrix.catalyst_context.liveDiscord, false);
  assert.equal(matrix.session_context.liveDiscord, false);
  assert.equal(matrix.opening_range.liveDiscord, false);
  assert.equal(matrix.halt_awareness.liveDiscord, false);
  assert.equal(matrix.move_extension.liveDiscord, false);
  assert.equal(matrix.level_calibration.liveDiscord, false);
  assert.equal(matrix.data_quality.liveDiscord, false);
  assert.equal(matrix.trade_idea_summary.liveDiscord, false);
  assert.equal(matrix.no_post_explainer.liveDiscord, false);
  assert.equal(matrix.story_memory.liveDiscord, false);
  assert.equal(matrix.pattern_context.liveDiscord, false);
  assert.equal(matrix.operator_review.liveDiscord, false);
  assert.equal(matrix.range_compression.liveDiscord, false);
});

test("signal category profiles expose pivots and structure without enabling standalone noisy categories", () => {
  const matrix = resolveSignalSurfaceMatrix("levels_plus_structure");

  assert.equal(matrix.pivots.liveDiscord, true);
  assert.equal(matrix.market_structure.liveDiscord, true);
  assert.equal(matrix.breakout_reclaim_quality.liveDiscord, true);
  assert.equal(matrix.reaction_quality.liveDiscord, true);
  assert.equal(matrix.range_compression.liveDiscord, false);
});

test("volume activity stays internal/operator by default but can be live-gated for tests", () => {
  const previous = process.env.SIGNAL_CATEGORY_VOLUME_ACTIVITY_LIVE_DISCORD;
  try {
    delete process.env.SIGNAL_CATEGORY_VOLUME_ACTIVITY_LIVE_DISCORD;
    assert.equal(
      isSignalCategoryEnabledForSurface("volume_activity", "liveDiscord", "trader_balanced"),
      false,
    );
    assert.equal(
      isSignalCategoryEnabledForSurface("volume_activity", "internalScoring", "trader_balanced"),
      true,
    );

    process.env.SIGNAL_CATEGORY_VOLUME_ACTIVITY_LIVE_DISCORD = "true";
    assert.equal(
      isSignalCategoryEnabledForSurface("volume_activity", "liveDiscord", "trader_balanced"),
      true,
    );
  } finally {
    if (previous === undefined) {
      delete process.env.SIGNAL_CATEGORY_VOLUME_ACTIVITY_LIVE_DISCORD;
    } else {
      process.env.SIGNAL_CATEGORY_VOLUME_ACTIVITY_LIVE_DISCORD = previous;
    }
  }
});

test("unknown signal category profile falls back to trader balanced", () => {
  assert.equal(
    isSignalCategoryEnabledForSurface("market_structure", "liveDiscord", "unknown"),
    true,
  );
});
