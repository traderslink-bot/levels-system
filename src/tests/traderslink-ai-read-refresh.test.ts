import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildTradersLinkAiReadRefreshState,
  decideTradersLinkAiReadRefresh,
  parseArchivedTradersLinkAiReadRefreshState,
} from "../lib/monitoring/manual-watchlist-runtime-manager.js";

const GENERATED_AT = Date.parse("2026-07-17T14:00:00.000Z");

function state(currentPrice = 1.98) {
  return {
    generatedAt: GENERATED_AT,
    currentPrice,
    upperBoundary: 2,
    lowerBoundary: 1.05,
  };
}

describe("TradersLink AI Read refresh decisions", () => {
  it("keeps the outer profit and downside targets as the read boundaries", () => {
    const refreshState = buildTradersLinkAiReadRefreshState({
      generatedAt: GENERATED_AT,
      currentPrice: 3.95,
      breakoutContinuation: {
        label: "Breakout continuation",
        price: 4.2,
        rationale: "Acceptance confirms the setup.",
      },
      momentumFailure: {
        label: "Momentum failure",
        price: 3.77,
        rationale: "A loss invalidates the setup.",
      },
      targets: [
        { label: "Where the trade could go", price: 4.43, condition: "Above continuation." },
      ],
      downsideCheckpoints: [
        { label: "Lower checkpoint", price: 3.5, condition: "Below momentum failure." },
      ],
    });

    assert.deepEqual(refreshState, {
      generatedAt: GENERATED_AT,
      currentPrice: 3.95,
      upperBoundary: 4.43,
      lowerBoundary: 3.5,
    });
  });

  it("recovers the same outer boundaries from an already-published AI card", () => {
    const recovered = parseArchivedTradersLinkAiReadRefreshState(JSON.stringify({
      generatedAt: GENERATED_AT,
      currentPrice: 3.95,
      breakoutContinuation: { price: 4.2 },
      momentumFailure: { price: 3.77 },
      targets: [{ label: "Premarket high", price: 4.43 }],
      downsideCheckpoints: [{ label: "Lower checkpoint", price: 3.5 }],
    }));

    assert.deepEqual(recovered, {
      generatedAt: GENERATED_AT,
      currentPrice: 3.95,
      upperBoundary: 4.43,
      lowerBoundary: 3.5,
    });
  });

  it("suppresses an initial automatic read when startup generation is disabled", () => {
    const decision = decideTradersLinkAiReadRefresh({
      previous: null,
      currentPrice: 1.36,
      dataAsOf: GENERATED_AT,
      force: false,
      requestedTrigger: "automatic",
      allowInitialGeneration: false,
    });

    assert.deepEqual(decision, {
      shouldRefresh: false,
      trigger: "startup",
      automaticRefreshRegime: null,
    });
  });

  it("still allows an explicitly requested initial read", () => {
    const decision = decideTradersLinkAiReadRefresh({
      previous: null,
      currentPrice: 1.36,
      dataAsOf: GENERATED_AT,
      force: true,
      requestedTrigger: "manual",
      allowInitialGeneration: false,
    });

    assert.deepEqual(decision, {
      shouldRefresh: true,
      trigger: "manual",
      automaticRefreshRegime: null,
    });
  });

  it("refreshes immediately when price exits above the outer upside target", () => {
    const decision = decideTradersLinkAiReadRefresh({
      previous: state(),
      currentPrice: 2.01,
      dataAsOf: GENERATED_AT + 5 * 60_000,
      force: false,
      requestedTrigger: "automatic",
    });

    assert.deepEqual(decision, {
      shouldRefresh: true,
      trigger: "boundary_cross",
      automaticRefreshRegime: "upper:2",
    });
  });

  it("refreshes immediately when price exits below the outer downside checkpoint", () => {
    const decision = decideTradersLinkAiReadRefresh({
      previous: state(1.06),
      currentPrice: 1.04,
      dataAsOf: GENERATED_AT + 5 * 60_000,
      force: false,
      requestedTrigger: "automatic",
    });

    assert.deepEqual(decision, {
      shouldRefresh: true,
      trigger: "boundary_cross",
      automaticRefreshRegime: "lower:1.05",
    });
  });

  it("refreshes near the upside edge before the old map runs out", () => {
    const decision = decideTradersLinkAiReadRefresh({
      previous: {
        ...state(1.36),
        lowerBoundary: 1.05,
      },
      currentPrice: 1.91,
      dataAsOf: GENERATED_AT + 10 * 60_000,
      force: false,
      requestedTrigger: "automatic",
    });

    assert.deepEqual(decision, {
      shouldRefresh: true,
      trigger: "range_edge",
      automaticRefreshRegime: "upper:2",
    });
  });

  it("refreshes near the downside edge before the old map runs out", () => {
    const decision = decideTradersLinkAiReadRefresh({
      previous: {
        ...state(1.36),
        lowerBoundary: 1.05,
      },
      currentPrice: 1.09,
      dataAsOf: GENERATED_AT + 10 * 60_000,
      force: false,
      requestedTrigger: "automatic",
    });

    assert.deepEqual(decision, {
      shouldRefresh: true,
      trigger: "range_edge",
      automaticRefreshRegime: "lower:1.05",
    });
  });

  it("does not refresh for a routine five-percent small-cap move inside the analyzed range", () => {
    const decision = decideTradersLinkAiReadRefresh({
      previous: state(1.5),
      currentPrice: 1.58,
      dataAsOf: GENERATED_AT + 5 * 60_000,
      force: false,
      requestedTrigger: "automatic",
    });

    assert.deepEqual(decision, {
      shouldRefresh: false,
      trigger: "scheduled",
      automaticRefreshRegime: null,
    });
  });

  it("does not spend on a time-only refresh while price remains inside the analyzed range", () => {
    const decision = decideTradersLinkAiReadRefresh({
      previous: state(1.5),
      currentPrice: 1.52,
      dataAsOf: GENERATED_AT + 6 * 60 * 60_000,
      force: false,
      requestedTrigger: "automatic",
    });

    assert.deepEqual(decision, {
      shouldRefresh: false,
      trigger: "scheduled",
      automaticRefreshRegime: null,
    });
  });

  it("does not buy a second automatic read for a boundary regime the published map already serviced", () => {
    const decision = decideTradersLinkAiReadRefresh({
      previous: {
        ...state(),
        lastAutomaticRefreshRegime: "upper:2",
      },
      currentPrice: 2.01,
      dataAsOf: GENERATED_AT + 10 * 60_000,
      force: false,
      requestedTrigger: "automatic",
    });

    assert.deepEqual(decision, {
      shouldRefresh: false,
      trigger: "boundary_cross",
      automaticRefreshRegime: "upper:2",
    });
  });
});
