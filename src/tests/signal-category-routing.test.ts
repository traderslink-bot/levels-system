import assert from "node:assert/strict";
import test from "node:test";

import type { IntelligentAlert } from "../lib/alerts/alert-types.js";
import { shouldSuppressAlert } from "../lib/alerts/alert-filter.js";
import {
  getSignalCategoryContract,
  validateSignalCategoryContracts,
} from "../lib/signals/signal-category-contracts.js";
import {
  routeMonitoringEventToSignalCategory,
  routeThreadMessageKindToSignalCategory,
} from "../lib/signals/signal-category-routing.js";

function makeAlert(eventType: IntelligentAlert["event"]["eventType"]): IntelligentAlert {
  return {
    id: `alert-${eventType}`,
    symbol: "TEST",
    title: `TEST ${eventType}`,
    body: "test body",
    severity: "high",
    confidence: "high",
    score: 80,
    shouldNotify: true,
    tags: [],
    scoreComponents: {},
    event: {
      id: `event-${eventType}`,
      episodeId: `episode-${eventType}`,
      symbol: "TEST",
      type: eventType === "compression" ? "consolidation" : eventType,
      eventType,
      zoneId: "zone-1",
      zoneKind: "resistance",
      level: 1,
      triggerPrice: 1.01,
      strength: 0.8,
      confidence: 0.8,
      priority: 80,
      bias: "bullish",
      pressureScore: 0.7,
      eventContext: {
        monitoredZoneId: "zone-1",
        canonicalZoneId: "zone-1",
        zoneFreshness: "fresh",
        zoneOrigin: "canonical",
        remapStatus: "new",
        remappedFromZoneIds: [],
        dataQualityDegraded: false,
        recentlyRefreshed: false,
        recentlyPromotedExtension: false,
        ladderPosition: "outermost",
        zoneStrengthLabel: "major",
      },
      timestamp: 1,
      notes: [],
    },
  } as IntelligentAlert;
}

test("signal category contracts cover every configured category", () => {
  assert.deepEqual(validateSignalCategoryContracts(), []);
  assert.equal(getSignalCategoryContract("volume_activity").standaloneDiscordAllowed, false);
  assert.equal(getSignalCategoryContract("liquidity_tradability").liveBehavior, "enrichment_only");
  assert.equal(getSignalCategoryContract("data_quality").liveBehavior, "operator_only");
  assert.equal(getSignalCategoryContract("trade_idea_summary").standaloneDiscordAllowed, false);
  assert.equal(getSignalCategoryContract("no_post_explainer").liveBehavior, "operator_only");
  assert.equal(getSignalCategoryContract("story_memory").liveBehavior, "operator_only");
  assert.equal(getSignalCategoryContract("range_compression").liveBehavior, "operator_only");
});

test("monitoring events route to explicit primary categories", () => {
  assert.equal(routeMonitoringEventToSignalCategory("level_touch").primaryCategory, "reaction_quality");
  assert.equal(routeMonitoringEventToSignalCategory("breakout").primaryCategory, "breakout_reclaim_quality");
  assert.equal(routeMonitoringEventToSignalCategory("breakdown").primaryCategory, "breakout_reclaim_quality");
  assert.equal(routeMonitoringEventToSignalCategory("compression").primaryCategory, "range_compression");
  assert.ok(routeMonitoringEventToSignalCategory("breakout").supportingCategories.includes("candle_meaning"));
  assert.ok(routeMonitoringEventToSignalCategory("breakout").supportingCategories.includes("liquidity_tradability"));
  assert.ok(routeMonitoringEventToSignalCategory("breakout").supportingCategories.includes("move_extension"));
  assert.ok(routeMonitoringEventToSignalCategory("breakout").supportingCategories.includes("volatility_context"));
  assert.ok(routeMonitoringEventToSignalCategory("breakout").supportingCategories.includes("data_quality"));
  assert.ok(routeMonitoringEventToSignalCategory("breakout").supportingCategories.includes("trade_idea_summary"));
  assert.ok(routeMonitoringEventToSignalCategory("breakout").supportingCategories.includes("no_post_explainer"));
});

test("thread message kinds route to trader-facing category ownership", () => {
  assert.equal(
    routeThreadMessageKindToSignalCategory({ messageKind: "level_snapshot" }).primaryCategory,
    "support_resistance",
  );
  assert.equal(
    routeThreadMessageKindToSignalCategory({ messageKind: "follow_through_update" }).primaryCategory,
    "follow_through",
  );
  assert.equal(
    routeThreadMessageKindToSignalCategory({ messageKind: "ai_signal_commentary" }).primaryCategory,
    "trader_commentary",
  );
  assert.ok(
    routeThreadMessageKindToSignalCategory({ messageKind: "stock_context" }).supportingCategories.includes("catalyst_context"),
  );
});

test("live alert filter enforces category surface profile for compression", () => {
  const previous = process.env.SIGNAL_CATEGORY_RANGE_COMPRESSION_LIVE_DISCORD;
  try {
    delete process.env.SIGNAL_CATEGORY_RANGE_COMPRESSION_LIVE_DISCORD;
    assert.equal(shouldSuppressAlert(makeAlert("compression")), true);

    process.env.SIGNAL_CATEGORY_RANGE_COMPRESSION_LIVE_DISCORD = "true";
    assert.equal(shouldSuppressAlert(makeAlert("compression")), false);
  } finally {
    if (previous === undefined) {
      delete process.env.SIGNAL_CATEGORY_RANGE_COMPRESSION_LIVE_DISCORD;
    } else {
      process.env.SIGNAL_CATEGORY_RANGE_COMPRESSION_LIVE_DISCORD = previous;
    }
  }
});

test("live alert filter keeps core level decision categories live by default", () => {
  assert.equal(shouldSuppressAlert(makeAlert("level_touch")), false);
  assert.equal(shouldSuppressAlert(makeAlert("breakout")), false);
  assert.equal(shouldSuppressAlert(makeAlert("breakdown")), false);
});
