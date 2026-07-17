import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildLiveWatchlistLevelQualityReport,
  type WatchlistQualityStatePayload,
} from "../lib/review/live-watchlist-level-quality-report.js";

function payloadWithSymbol(symbol: WatchlistQualityStatePayload["symbols"][number]): WatchlistQualityStatePayload {
  return {
    generatedAt: 1_000,
    marketDataStatus: "live",
    symbols: [symbol],
  };
}

test("live watchlist level QA flags a stronger nearby structural level hidden by weaker visible support", () => {
  const report = buildLiveWatchlistLevelQualityReport(payloadWithSymbol({
    symbol: "ZBAO",
    latestPrice: 0.4215,
    nearestSupport: 0.41,
    nearestResistance: null,
    levelMap: {
      currentPrice: 0.4215,
      rangeState: "normal",
      nearestSupport: {
        side: "support",
        price: 0.41,
        distancePct: -0.027283511269276362,
        strengthLabel: "moderate",
        sourceLabel: "4h structure",
        roleFlipFromSide: null,
        label: "0.4100 (-2.7%, moderate, 4h structure)",
      },
      nearestResistance: null,
      nextStrongSupport: null,
      nextStrongResistance: null,
      supportLevels: [
        {
          side: "support",
          price: 0.41,
          distancePct: -0.027283511269276362,
          strengthLabel: "moderate",
          sourceLabel: "4h structure",
          roleFlipFromSide: null,
          label: "0.4100 (-2.7%, moderate, 4h structure)",
        },
        {
          side: "support",
          price: 0.296,
          distancePct: -0.2977461447212337,
          strengthLabel: "moderate",
          sourceLabel: "4h structure",
          roleFlipFromSide: null,
          label: "0.2960 (-29.8%, moderate, 4h structure)",
        },
      ],
      resistanceLevels: [],
    },
    cards: {
      fullLadder: {
        title: "Full Ladder",
        source: "level_snapshot",
        updatedAt: 1_000,
        priceWhenPosted: 0.4215,
        body: [
          "Resistance:",
          "none",
          "",
          "Support:",
          "0.4100 (-2.7%, moderate, 4h structure)",
          "0.2960 (-29.8%, moderate, 4h structure)",
          "0.2910 (-31.0%, strong, daily confluence)",
        ].join("\n"),
      },
    },
  }));

  assert.equal(report.totals.majorFindings, 1);
  assert.equal(report.findings[0]?.kind, "stronger_nearby_hidden");
  assert.equal(report.findings[0]?.symbol, "ZBAO");
  assert.equal(report.findings[0]?.price, 0.291);
});

test("live watchlist level QA flags the same boundary on both sides", () => {
  const report = buildLiveWatchlistLevelQualityReport(payloadWithSymbol({
    symbol: "YMAT",
    latestPrice: 2.438,
    nearestSupport: 2.44,
    nearestResistance: 2.44,
    nearestSupportLabel: "2.44 (+0.1%, major, daily confluence)",
    nearestResistanceLabel: "2.44 (+0.1%, major, daily confluence)",
    levelMap: {
      currentPrice: 2.438,
      rangeState: "tight",
      nearestSupport: {
        side: "support",
        price: 2.44,
        distancePct: 0.0008203445447086947,
        strengthLabel: "major",
        sourceLabel: "daily confluence",
        roleFlipFromSide: null,
        label: "2.44 (+0.1%, major, daily confluence)",
      },
      nearestResistance: {
        side: "resistance",
        price: 2.44,
        distancePct: 0.0008203445447086947,
        strengthLabel: "major",
        sourceLabel: "daily confluence",
        roleFlipFromSide: null,
        label: "2.44 (+0.1%, major, daily confluence)",
      },
      nextStrongSupport: null,
      nextStrongResistance: null,
      supportLevels: [
        {
          side: "support",
          price: 2.44,
          distancePct: 0.0008203445447086947,
          strengthLabel: "major",
          sourceLabel: "daily confluence",
          roleFlipFromSide: null,
          label: "2.44 (+0.1%, major, daily confluence)",
        },
      ],
      resistanceLevels: [
        {
          side: "resistance",
          price: 2.44,
          distancePct: 0.0008203445447086947,
          strengthLabel: "major",
          sourceLabel: "daily confluence",
          roleFlipFromSide: null,
          label: "2.44 (+0.1%, major, daily confluence)",
        },
      ],
    },
    cards: {},
  }));

  assert.equal(report.totals.majorFindings, 1);
  assert.equal(report.findings[0]?.kind, "same_boundary_both_sides");
});

test("live watchlist level QA flags legacy heavy vocabulary in visible card copy", () => {
  const report = buildLiveWatchlistLevelQualityReport(payloadWithSymbol({
    symbol: "VOCAB",
    latestPrice: 1,
    nearestSupport: 0.95,
    nearestResistance: 1.08,
    nearestSupportLabel: "0.9500 (-5.0%, strong, daily confluence)",
    nearestResistanceLabel: "1.08 (+8.0%, major, daily confluence)",
    levelMap: {
      currentPrice: 1,
      rangeState: "normal",
      nearestSupport: {
        side: "support",
        price: 0.95,
        distancePct: -0.05,
        strengthLabel: "strong",
        sourceLabel: "daily confluence",
        roleFlipFromSide: null,
        label: "0.9500 (-5.0%, strong, daily confluence)",
      },
      nearestResistance: {
        side: "resistance",
        price: 1.08,
        distancePct: 0.08,
        strengthLabel: "major",
        sourceLabel: "daily confluence",
        roleFlipFromSide: null,
        label: "1.08 (+8.0%, major, daily confluence)",
      },
      nextStrongSupport: null,
      nextStrongResistance: null,
      supportLevels: [
        {
          side: "support",
          price: 0.95,
          distancePct: -0.05,
          strengthLabel: "strong",
          sourceLabel: "daily confluence",
          roleFlipFromSide: null,
          label: "0.9500 (-5.0%, strong, daily confluence)",
        },
      ],
      resistanceLevels: [
        {
          side: "resistance",
          price: 1.08,
          distancePct: 0.08,
          strengthLabel: "major",
          sourceLabel: "daily confluence",
          roleFlipFromSide: null,
          label: "1.08 (+8.0%, major, daily confluence)",
        },
      ],
    },
    cards: {
      liveTraderRead: {
        title: "Live Trader Read",
        source: "level_snapshot",
        updatedAt: 1_000,
        priceWhenPosted: 1,
        body: "Current Read: VOCAB is holding above heavy support 0.95.",
      },
    },
  }));

  assert.equal(report.totals.watchFindings, 1);
  assert.equal(report.findings[0]?.kind, "label_vocabulary_mismatch");
});

test("live watchlist level QA leaves a clean card alone", () => {
  const report = buildLiveWatchlistLevelQualityReport(payloadWithSymbol({
    symbol: "CLEAN",
    latestPrice: 1,
    nearestSupport: 0.95,
    nearestResistance: 1.08,
    nearestSupportLabel: "0.9500 (-5.0%, strong, daily confluence)",
    nearestResistanceLabel: "1.08 (+8.0%, major, daily confluence)",
    levelMap: {
      currentPrice: 1,
      rangeState: "normal",
      nearestSupport: {
        side: "support",
        price: 0.95,
        distancePct: -0.05,
        strengthLabel: "strong",
        sourceLabel: "daily confluence",
        roleFlipFromSide: null,
        label: "0.9500 (-5.0%, strong, daily confluence)",
      },
      nearestResistance: {
        side: "resistance",
        price: 1.08,
        distancePct: 0.08,
        strengthLabel: "major",
        sourceLabel: "daily confluence",
        roleFlipFromSide: null,
        label: "1.08 (+8.0%, major, daily confluence)",
      },
      nextStrongSupport: null,
      nextStrongResistance: null,
      supportLevels: [
        {
          side: "support",
          price: 0.95,
          distancePct: -0.05,
          strengthLabel: "strong",
          sourceLabel: "daily confluence",
          roleFlipFromSide: null,
          label: "0.9500 (-5.0%, strong, daily confluence)",
        },
      ],
      resistanceLevels: [
        {
          side: "resistance",
          price: 1.08,
          distancePct: 0.08,
          strengthLabel: "major",
          sourceLabel: "daily confluence",
          roleFlipFromSide: null,
          label: "1.08 (+8.0%, major, daily confluence)",
        },
      ],
    },
    cards: {
      fullLadder: {
        title: "Full Ladder",
        source: "level_snapshot",
        updatedAt: 1_000,
        priceWhenPosted: 1,
        body: [
          "Resistance:",
          "1.08 (+8.0%, major, daily confluence)",
          "",
          "Support:",
          "0.9500 (-5.0%, strong, daily confluence)",
        ].join("\n"),
      },
    },
  }));

  assert.equal(report.totals.findings, 0);
});

test("live watchlist level QA treats archived missing level maps as info", () => {
  const report = buildLiveWatchlistLevelQualityReport(payloadWithSymbol({
    symbol: "OLD",
    status: "deactivated",
    latestPrice: 1,
    levelMap: null,
    cards: {},
  }));

  assert.equal(report.totals.findings, 1);
  assert.equal(report.totals.majorFindings, 0);
  assert.equal(report.totals.infoFindings, 1);
  assert.equal(report.findings[0]?.kind, "missing_level_map");
  assert.equal(report.findings[0]?.severity, "info");
  assert.match(report.findings[0]?.summary ?? "", /archived\/inactive/);
});
