import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { decideTradersLinkAiReadRefresh } from "../lib/monitoring/manual-watchlist-runtime-manager.js";

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
  it("suppresses an initial automatic read when startup generation is disabled", () => {
    const decision = decideTradersLinkAiReadRefresh({
      previous: null,
      currentPrice: 1.36,
      dataAsOf: GENERATED_AT,
      force: false,
      requestedTrigger: "automatic",
      allowInitialGeneration: false,
    });

    assert.deepEqual(decision, { shouldRefresh: false, trigger: "startup" });
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

    assert.deepEqual(decision, { shouldRefresh: true, trigger: "manual" });
  });

  it("refreshes immediately when price exits above the highest continuation target", () => {
    const decision = decideTradersLinkAiReadRefresh({
      previous: state(),
      currentPrice: 2.01,
      dataAsOf: GENERATED_AT + 5 * 60_000,
      force: false,
      requestedTrigger: "automatic",
    });

    assert.deepEqual(decision, { shouldRefresh: true, trigger: "boundary_cross" });
  });

  it("refreshes immediately when price exits below the lowest downside checkpoint", () => {
    const decision = decideTradersLinkAiReadRefresh({
      previous: state(1.06),
      currentPrice: 1.04,
      dataAsOf: GENERATED_AT + 5 * 60_000,
      force: false,
      requestedTrigger: "automatic",
    });

    assert.deepEqual(decision, { shouldRefresh: true, trigger: "boundary_cross" });
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

    assert.deepEqual(decision, { shouldRefresh: true, trigger: "range_edge" });
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

    assert.deepEqual(decision, { shouldRefresh: true, trigger: "range_edge" });
  });

  it("does not refresh for a routine five-percent small-cap move inside the analyzed range", () => {
    const decision = decideTradersLinkAiReadRefresh({
      previous: state(1.5),
      currentPrice: 1.58,
      dataAsOf: GENERATED_AT + 5 * 60_000,
      force: false,
      requestedTrigger: "automatic",
    });

    assert.deepEqual(decision, { shouldRefresh: false, trigger: "scheduled" });
  });
});
