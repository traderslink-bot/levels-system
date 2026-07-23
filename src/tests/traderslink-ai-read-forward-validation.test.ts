import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  TradersLinkAiReadValidationError,
  validateTradersLinkAiReadForwardPlan,
} from "../lib/ai/traderslink-ai-read-forward-validation.js";
import type { TradersLinkAiReadMarketRegimeProfile } from "../lib/ai/traderslink-ai-read-price-action.js";
import type {
  TradersLinkAiReadForwardBasisType,
  TradersLinkAiReadForwardHorizon,
  TradersLinkAiReadForwardPlan,
} from "../lib/live-watchlist/live-watchlist-types.js";

const DATA_AS_OF = Date.parse("2026-07-22T16:00:00.000Z");

function profile(): TradersLinkAiReadMarketRegimeProfile {
  return {
    available: true,
    dailyHistoryCount: 60,
    gainFromPriorClosePct: 100,
    gainFromRegularSessionOpenPct: 80,
    gainFromCurrentSessionLowPct: 90,
    currentSessionRangePct: 100,
    latestSignificantImpulsePct: 75,
    broaderSessionMovePct: 100,
    averageDailyRange10Pct: 40,
    averageDailyRange20Pct: 40,
    largestDailyRange20Pct: 110,
    currentRangeVsAverageDailyRange: 2.5,
    currentPriceLocationInSessionRangePct: 99,
    currentPriceAtOrNearSessionHigh: true,
    currentPriceAboveHighestSuppliedDailyHigh: true,
    highestObservedUpsidePrice: 9.9,
    highestObservedUpsidePriceType: "recent_daily",
    distanceToHighestObservedUpsidePct: -1,
    regime: "extreme_expansion",
    limitations: [],
  };
}

function horizon(price: number, basisType: TradersLinkAiReadForwardBasisType = "measured_move"):
  TradersLinkAiReadForwardHorizon {
  return {
    available: true,
    price,
    condition: "This branch requires sustained acceptance and volume confirmation.",
    basisType,
    basisSummary: "A conditional scenario derived from supplied range and volatility facts.",
    sourceFacts: ["supplied session range", "supplied realized impulse"],
    unavailableReasonCode: null,
    unavailableReason: null,
  };
}

function plan(prices: [number, number, number, number]): TradersLinkAiReadForwardPlan {
  return {
    nearestRealistic: horizon(prices[0]),
    continuedMomentum: horizon(prices[1]),
    strongExpansion: horizon(prices[2], "volatility_projection"),
    extremeMomentum: horizon(prices[3], "combined"),
    additionalObservedOutcomes: [],
  };
}

function priceAction() {
  return {
    source: "fixture",
    fetchedAt: DATA_AS_OF,
    priorRegularClose: 5,
    oneMinuteCandles: [],
    intradayCandles: [{
      timestamp: DATA_AS_OF - 60_000,
      open: 9.5,
      high: 10,
      low: 9,
      close: 9.9,
      volume: 1_000,
    }],
    dailyCandles: [{
      timestamp: DATA_AS_OF - 86_400_000,
      open: 8,
      high: 10,
      low: 7,
      close: 9,
      volume: 10_000,
    }],
  };
}

function validate(forwardPlan: TradersLinkAiReadForwardPlan) {
  return validateTradersLinkAiReadForwardPlan({
    currentPrice: 10,
    mustClearPrice: null,
    breakoutContinuationPrice: null,
    forwardPlan,
    marketProfile: profile(),
    priceAction: priceAction(),
    dataAsOf: DATA_AS_OF,
  });
}

function failureCodes(error: unknown): string[] {
  assert.ok(error instanceof TradersLinkAiReadValidationError);
  return error.failures.map((failure) => failure.code);
}

describe("TradersLink AI Read complete-wide forward validation", () => {
  it("rejects a superficially complete but suspiciously compressed high-expansion map", () => {
    assert.throws(
      () => validate(plan([10.5, 11, 11.5, 12])),
      (error) => failureCodes(error).includes("FORWARD_MAP_SUSPICIOUSLY_COMPRESSED"),
    );
  });

  it("allows a materially wider conditional map without using a fixed maximum", () => {
    const diagnostics = validate(plan([12, 15, 18, 22]));
    assert.equal(diagnostics.representedHorizons, 4);
    assert.equal(diagnostics.forwardCoveragePct, 120);
  });

  it("rejects observed labels whose exact price is absent from supplied candles", () => {
    const forwardPlan = plan([12, 15, 18, 22]);
    forwardPlan.nearestRealistic = horizon(12, "observed_daily");
    assert.throws(
      () => validate(forwardPlan),
      (error) => failureCodes(error).includes("FORWARD_OBSERVED_PRICE_UNSUPPORTED"),
    );
  });

  it("rejects an empty fresh-high map even when unavailable objects are shaped correctly", () => {
    const unavailable = (): TradersLinkAiReadForwardHorizon => ({
      available: false,
      price: null,
      condition: "Unavailable until trustworthy history is supplied.",
      basisType: "unavailable",
      basisSummary: "No trustworthy basis is available.",
      sourceFacts: [],
      unavailableReasonCode: "insufficient_history",
      unavailableReason: "The supplied history cannot support this horizon.",
    });
    assert.throws(
      () => validate({
        nearestRealistic: unavailable(),
        continuedMomentum: unavailable(),
        strongExpansion: unavailable(),
        extremeMomentum: unavailable(),
        additionalObservedOutcomes: [],
      }),
      (error) => failureCodes(error).includes("FORWARD_MAP_EMPTY"),
    );
  });

  it("rejects projected prices described as observed structure", () => {
    const forwardPlan = plan([12, 15, 18, 22]);
    forwardPlan.nearestRealistic.basisSummary = "Observed daily resistance at the selected price.";
    assert.throws(
      () => validate(forwardPlan),
      (error) => failureCodes(error).includes("FORWARD_PROJECTED_PRICE_MISLABELED"),
    );
  });

  it("allows a projected horizon to explain that no observed resistance remains", () => {
    const forwardPlan = plan([12, 15, 18, 22]);
    forwardPlan.nearestRealistic.basisSummary =
      "No observed resistance remains above the current price, so this is a measured-move scenario.";
    forwardPlan.nearestRealistic.sourceFacts = [
      "The highest observed daily high is 10; the selected 12 outcome is projected.",
    ];
    assert.doesNotThrow(() => validate(forwardPlan));
  });

  it("still rejects a projected horizon that assigns its exact price to observed resistance", () => {
    const forwardPlan = plan([12, 15, 18, 22]);
    forwardPlan.nearestRealistic.basisSummary = "Observed daily resistance is $12.00.";
    assert.throws(
      () => validate(forwardPlan),
      (error) => failureCodes(error).includes("FORWARD_PROJECTED_PRICE_MISLABELED"),
    );
  });
});
