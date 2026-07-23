import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  advanceTradersLinkAiReadForwardHorizonStates,
  buildTradersLinkAiReadRefreshState,
  decideTradersLinkAiReadActivationSchedule,
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
  it("uses the canonical v4 forward plan and advances horizon state without buying another read", () => {
    const horizon = (label: string, price: number) => ({
      label,
      available: true,
      price,
      condition: "Acceptance keeps this branch active.",
      basisType: "measured_move",
      basisSummary: "Projected from the supplied move.",
      sourceFacts: ["supplied impulse"],
      unavailableReasonCode: null,
      unavailableReason: null,
    });
    const refreshState = buildTradersLinkAiReadRefreshState({
      version: 4,
      generationId: "PN-v4-test",
      symbol: "PN",
      generatedAt: GENERATED_AT,
      dataAsOf: GENERATED_AT,
      currentPrice: 5,
      marketSession: "regular",
      bias: "bullish",
      confidence: "medium",
      currentRead: "Momentum remains conditional.",
      needsToHold: { label: "Hold", price: 4.8, rationale: "Hold the shelf." },
      cautionBelow: { label: "Caution", price: 4.6, rationale: "Weakens below." },
      momentumFailure: { label: "Failure", price: 4.4, rationale: "Invalid below." },
      mustClear: { label: "Clear", price: 5.2, rationale: "Accept above." },
      breakoutContinuation: { label: "Continue", price: 5.5, rationale: "Continue above." },
      forwardPlan: {
        nearestRealistic: horizon("Nearest", 6),
        continuedMomentum: horizon("Continued", 7),
        strongExpansion: horizon("Strong", 8.5),
        extremeMomentum: horizon("Extreme", 10),
        additionalObservedOutcomes: [],
      },
      targets: [{ label: "Legacy", price: 6, condition: "Compatibility only." }],
      downsideCheckpoints: [],
      pullbackPlans: { shallow: null, deep: null },
      failureRecovery: null,
      catalystRealityCheck: { summary: "None", status: "none", dayTradeRelevance: "None", sourceUrls: [] },
      dilutionRisk: {
        level: "unknown", summary: "Unknown", dayTradeRelevance: "Unknown", sourceUrls: [],
        canCompanyIssueToday: null,
        companyIssuance: { status: "unknown", earliestDate: null, trigger: "unknown", summary: "Unknown" },
        publicResale: { status: "unknown", earliestDate: null, trigger: "unknown", summary: "Unknown" },
      },
      listingStatus: { status: "none", immediacy: "background", summary: "None", dayTradeRelevance: "None", sourceUrls: [] },
      riskSummary: [],
      sources: [],
      model: "fixture",
      externalResearchEnabled: false,
      usedWebSearch: false,
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimatedCostUsd: 0 },
    });

    assert.equal(refreshState.upperBoundary, 10);
    assert.equal(refreshState.priorCompletePlan?.horizonStates.nearestRealistic, "approaching");
    const testing = advanceTradersLinkAiReadForwardHorizonStates(refreshState, 6.01);
    assert.equal(testing.priorCompletePlan?.horizonStates.nearestRealistic, "testing");
    const accepted = advanceTradersLinkAiReadForwardHorizonStates(testing, 6.01);
    assert.equal(accepted.priorCompletePlan?.horizonStates.nearestRealistic, "accepted");
    const achieved = advanceTradersLinkAiReadForwardHorizonStates(accepted, 6.1);
    assert.equal(achieved.priorCompletePlan?.horizonStates.nearestRealistic, "achieved");
  });

  it("keeps the outer profit and downside targets as the read boundaries", () => {
    const refreshState = buildTradersLinkAiReadRefreshState({
      generatedAt: GENERATED_AT,
      currentPrice: 3.95,
      breakoutContinuation: {
        label: "Breakout continuation",
        price: 4.2,
        rationale: "Acceptance confirms the setup.",
      },
      needsToHold: {
        label: "Needs to hold",
        price: 3.9,
        rationale: "The opening shelf needs to hold.",
      },
      cautionBelow: {
        label: "Caution below",
        price: 3.82,
        rationale: "A loss weakens the shelf.",
      },
      momentumFailure: {
        label: "Momentum failure",
        price: 3.77,
        rationale: "A loss invalidates the setup.",
      },
      mustClear: {
        label: "Must clear",
        price: 4.05,
        rationale: "The intraday pivot needs acceptance.",
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
      boundaries: [
        { role: "needsToHold", side: "downside", price: 3.9, impact: "hold" },
        { role: "cautionBelow", side: "downside", price: 3.82, impact: "caution" },
        { role: "momentumFailure", side: "downside", price: 3.77, impact: "invalidates" },
        { role: "mustClear", side: "upside", price: 4.05, impact: "improves" },
        { role: "breakoutContinuation", side: "upside", price: 4.2, impact: "improves" },
        { role: "upsideTarget", side: "upside", price: 4.43, impact: "exhausts" },
        { role: "downsideCheckpoint", side: "downside", price: 3.5, impact: "exhausts" },
      ],
    });
  });

  it("falls back to the outermost usable mapped levels when targets are missing", () => {
    const refreshState = buildTradersLinkAiReadRefreshState({
      generatedAt: GENERATED_AT,
      currentPrice: 1.6289,
      breakoutContinuation: {
        label: "Breakout continuation",
        price: null,
        rationale: "No separate continuation level.",
      },
      needsToHold: {
        label: "Needs to hold",
        price: 1.5,
        rationale: "The shelf needs to hold.",
      },
      cautionBelow: {
        label: "Caution below",
        price: 1.4,
        rationale: "A loss weakens the shelf.",
      },
      momentumFailure: {
        label: "Momentum failure",
        price: 1.19,
        rationale: "A loss invalidates the setup.",
      },
      mustClear: {
        label: "Must clear",
        price: 1.79,
        rationale: "The pivot needs acceptance.",
      },
      targets: [],
      downsideCheckpoints: [],
    });

    assert.equal(refreshState.upperBoundary, 1.79);
    assert.equal(refreshState.lowerBoundary, 1.19);
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
      boundaries: [
        { role: "momentumFailure", side: "downside", price: 3.77, impact: "invalidates" },
        { role: "breakoutContinuation", side: "upside", price: 4.2, impact: "improves" },
        { role: "upsideTarget", side: "upside", price: 4.43, impact: "exhausts" },
        { role: "downsideCheckpoint", side: "downside", price: 3.5, impact: "exhausts" },
      ],
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

  it("holds a small upside boundary poke pending instead of refreshing immediately", () => {
    const decision = decideTradersLinkAiReadRefresh({
      previous: state(),
      currentPrice: 2.01,
      dataAsOf: GENERATED_AT + 5 * 60_000,
      force: false,
      requestedTrigger: "automatic",
    });

    assert.deepEqual(decision, {
      shouldRefresh: false,
      trigger: "boundary_cross",
      automaticRefreshRegime: "upper:2",
      pendingBoundaryCross: {
        regime: "upper:2",
        direction: "upper",
        boundary: 2,
        firstObservedAt: GENERATED_AT + 5 * 60_000,
        lastObservedAt: GENERATED_AT + 5 * 60_000,
        observationCount: 1,
        furthestPrice: 2.01,
        confirmationBufferPct: 0.01,
      },
    });
  });

  it("holds a small downside boundary poke pending instead of refreshing immediately", () => {
    const decision = decideTradersLinkAiReadRefresh({
      previous: state(1.06),
      currentPrice: 1.04,
      dataAsOf: GENERATED_AT + 5 * 60_000,
      force: false,
      requestedTrigger: "automatic",
    });

    assert.deepEqual(decision, {
      shouldRefresh: false,
      trigger: "boundary_cross",
      automaticRefreshRegime: "lower:1.05",
      pendingBoundaryCross: {
        regime: "lower:1.05",
        direction: "lower",
        boundary: 1.05,
        firstObservedAt: GENERATED_AT + 5 * 60_000,
        lastObservedAt: GENERATED_AT + 5 * 60_000,
        observationCount: 1,
        furthestPrice: 1.04,
        confirmationBufferPct: 0.01,
      },
    });
  });

  it("confirms a sustained small cross after two observations spanning thirty seconds", () => {
    const firstObservedAt = GENERATED_AT + 5 * 60_000;
    const decision = decideTradersLinkAiReadRefresh({
      previous: {
        ...state(),
        pendingAutomaticBoundaryCross: {
          regime: "upper:2",
          direction: "upper",
          boundary: 2,
          firstObservedAt,
          lastObservedAt: firstObservedAt,
          observationCount: 1,
          furthestPrice: 2.01,
          confirmationBufferPct: 0.01,
        },
      },
      currentPrice: 2.012,
      dataAsOf: firstObservedAt + 30_000,
      force: false,
      requestedTrigger: "automatic",
    });

    assert.deepEqual(decision, {
      shouldRefresh: true,
      trigger: "boundary_cross",
      automaticRefreshRegime: "upper:2",
      pendingBoundaryCross: null,
      confirmedPriorBoundary: {
        direction: "upper",
        price: 2,
        priorPlanGeneratedAt: GENERATED_AT,
      },
    });
  });

  it("cancels a pending cross when price quickly returns inside the prior plan", () => {
    const decision = decideTradersLinkAiReadRefresh({
      previous: {
        ...state(),
        pendingAutomaticBoundaryCross: {
          regime: "upper:2",
          direction: "upper",
          boundary: 2,
          firstObservedAt: GENERATED_AT + 5 * 60_000,
          lastObservedAt: GENERATED_AT + 5 * 60_000,
          observationCount: 1,
          furthestPrice: 2.01,
          confirmationBufferPct: 0.01,
        },
      },
      currentPrice: 1.99,
      dataAsOf: GENERATED_AT + 5 * 60_000 + 10_000,
      force: false,
      requestedTrigger: "automatic",
    });

    assert.deepEqual(decision, {
      shouldRefresh: false,
      trigger: "scheduled",
      automaticRefreshRegime: null,
      pendingBoundaryCross: null,
    });
  });

  it("refreshes immediately for a decisive excursion beyond the adaptive buffer", () => {
    const decision = decideTradersLinkAiReadRefresh({
      previous: state(),
      currentPrice: 2.1,
      dataAsOf: GENERATED_AT + 5 * 60_000,
      force: false,
      requestedTrigger: "automatic",
      atrPct: 0.1,
      tickSize: 0.01,
    });

    assert.deepEqual(decision, {
      shouldRefresh: true,
      trigger: "boundary_cross",
      automaticRefreshRegime: "upper:2",
      pendingBoundaryCross: null,
      confirmedPriorBoundary: {
        direction: "upper",
        price: 2,
        priorPlanGeneratedAt: GENERATED_AT,
      },
    });
  });

  it("repairs a persisted null upper boundary from the outermost mapped upside level", () => {
    const decision = decideTradersLinkAiReadRefresh({
      previous: {
        generatedAt: GENERATED_AT,
        currentPrice: 1.6289,
        upperBoundary: null,
        lowerBoundary: 0.698,
        boundaries: [
          { role: "mustClear", side: "upside", price: 1.79, impact: "improves" },
          { role: "momentumFailure", side: "downside", price: 1.19, impact: "invalidates" },
          { role: "downsideCheckpoint", side: "downside", price: 0.698, impact: "exhausts" },
        ],
      },
      currentPrice: 2.6406,
      dataAsOf: GENERATED_AT + 5 * 60_000,
      force: false,
      requestedTrigger: "automatic",
    });

    assert.deepEqual(decision, {
      shouldRefresh: true,
      trigger: "boundary_cross",
      automaticRefreshRegime: "upper:1.79",
      pendingBoundaryCross: null,
      confirmedPriorBoundary: {
        direction: "upper",
        price: 1.79,
        priorPlanGeneratedAt: GENERATED_AT,
      },
    });
  });

  it("carries a crossed prior boundary into an explicit manual refresh", () => {
    const decision = decideTradersLinkAiReadRefresh({
      previous: {
        generatedAt: GENERATED_AT,
        currentPrice: 1.6289,
        upperBoundary: null,
        lowerBoundary: 0.698,
        boundaries: [
          { role: "mustClear", side: "upside", price: 1.79, impact: "improves" },
        ],
      },
      currentPrice: 2.9355,
      dataAsOf: GENERATED_AT + 5 * 60_000,
      force: true,
      requestedTrigger: "manual",
    });

    assert.deepEqual(decision, {
      shouldRefresh: true,
      trigger: "manual",
      automaticRefreshRegime: null,
      confirmedPriorBoundary: {
        direction: "upper",
        price: 1.79,
        priorPlanGeneratedAt: GENERATED_AT,
      },
    });
  });

  it("does not refresh at momentum failure while lower downside checkpoints remain mapped", () => {
    const decision = decideTradersLinkAiReadRefresh({
      previous: {
        generatedAt: GENERATED_AT,
        currentPrice: 3.95,
        upperBoundary: 4.43,
        lowerBoundary: 3.5,
        boundaries: [
          { role: "momentumFailure", side: "downside", price: 3.77, impact: "invalidates" },
          { role: "downsideCheckpoint", side: "downside", price: 3.5, impact: "exhausts" },
        ],
      },
      currentPrice: 3.7,
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

  it("does not refresh when price only touches and reclaims the momentum-failure boundary", () => {
    const decision = decideTradersLinkAiReadRefresh({
      previous: {
        generatedAt: GENERATED_AT,
        currentPrice: 3.95,
        upperBoundary: 4.43,
        lowerBoundary: 3.5,
        boundaries: [
          { role: "momentumFailure", side: "downside", price: 3.77, impact: "invalidates" },
        ],
      },
      currentPrice: 3.77,
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

  it("does not refresh repeatedly while price remains between momentum failure and the outer downside checkpoint", () => {
    const decision = decideTradersLinkAiReadRefresh({
      previous: {
        generatedAt: GENERATED_AT,
        currentPrice: 3.95,
        upperBoundary: 4.43,
        lowerBoundary: 3.5,
        boundaries: [
          { role: "momentumFailure", side: "downside", price: 3.77, impact: "invalidates" },
        ],
      },
      currentPrice: 3.6,
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

  it("does not refresh near the upside edge while price remains inside the published map", () => {
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
      shouldRefresh: false,
      trigger: "scheduled",
      automaticRefreshRegime: null,
    });
  });

  it("does not refresh near the downside edge while price remains inside the published map", () => {
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
      shouldRefresh: false,
      trigger: "scheduled",
      automaticRefreshRegime: null,
    });
  });

  it("reuses a persisted plan on reactivation and only schedules a boundary check", () => {
    assert.deepEqual(decideTradersLinkAiReadActivationSchedule(state(1.5)), {
      force: false,
      trigger: "automatic",
    });
    assert.deepEqual(decideTradersLinkAiReadActivationSchedule(null), {
      force: true,
      trigger: "activation",
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

  it("refreshes a fifteen-percent extension only after thirty seconds when no higher boundary exists", () => {
    const firstObservedAt = GENERATED_AT + 5 * 60_000;
    const previous = {
      generatedAt: GENERATED_AT,
      currentPrice: 1,
      upperBoundary: null,
      lowerBoundary: 0.8,
      boundaries: [
        { role: "momentumFailure" as const, side: "downside" as const, price: 0.8, impact: "invalidates" as const },
      ],
    };
    const first = decideTradersLinkAiReadRefresh({
      previous,
      currentPrice: 1.15,
      dataAsOf: firstObservedAt,
      force: false,
      requestedTrigger: "automatic",
    });
    assert.equal(first.shouldRefresh, false);
    assert.equal(first.automaticRefreshRegime, "extension:upper:1.15");

    const confirmed = decideTradersLinkAiReadRefresh({
      previous: {
        ...previous,
        pendingAutomaticBoundaryCross: first.pendingBoundaryCross ?? undefined,
      },
      currentPrice: 1.16,
      dataAsOf: firstObservedAt + 30_000,
      force: false,
      requestedTrigger: "automatic",
    });

    assert.equal(confirmed.shouldRefresh, true);
    assert.equal(confirmed.confirmedPriorBoundary?.price, 1.15);
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
