import assert from "node:assert/strict";
import test from "node:test";
import { applyOwnerAnalysisEdit } from "../lib/ai/traderslink-ai-read-owner-edit.js";
import { renderApprovedAnalysisDiscord } from "../lib/ai/traderslink-ai-read-publication-preview.js";
import type { TradersLinkAiReadPayload } from "../lib/live-watchlist/live-watchlist-types.js";

const base = () => ({
  symbol: "PDSB", generationId: "original", generatedAt: 123, dataAsOf: 120, currentPrice: 0.5,
  currentRead: "Original", needsToHold: { label: "Hold", price: 0.45, rationale: "Base" },
  momentumFailure: { label: "Failure", price: 0.4, rationale: "Base failed" },
  pullbackPlans: { shallow: null, deep: null }, failureRecovery: null,
  catalystRealityCheck: { summary: "Original news", dayTradeRelevance: "Attention", sourceUrls: ["https://example.test/article"], status: "confirmed" },
  sources: [{ title: "Original source" }], usage: { totalTokens: 100 },
}) as unknown as TradersLinkAiReadPayload;

test("owner edits text and prices without changing generation provenance or original object", () => {
  const original = base();
  const edited = applyOwnerAnalysisEdit(original, { currentRead: "My analysis", needsToHold: { label: "Hold", price: 0.46, rationale: "My reasoning" } });
  assert.equal(edited.payload.currentRead, "My analysis");
  assert.equal(edited.payload.needsToHold.price, 0.46);
  assert.equal(original.currentRead, "Original");
  assert.deepEqual(edited.payload.sources, original.sources);
  assert.deepEqual(edited.payload.usage, original.usage);
  assert.equal(edited.payload.generationId, "original");
  assert.deepEqual(edited.changedPaths, ["currentRead", "needsToHold"]);
});

test("trading inconsistencies warn but preserve exactly the owner's values", () => {
  const { payload, warnings } = applyOwnerAnalysisEdit(base(), { pullbackPlans: { deep: {
    zoneLow: 0.46, zoneHigh: 0.44, confirmationPrice: 0.47, confirmation: "My setup",
    invalidationPrice: 0.48, firstObjectivePrice: 0.6, rationale: "Owner plan",
  } } });
  assert.equal(payload.pullbackPlans.deep?.zoneLow, 0.46);
  assert.equal(payload.pullbackPlans.deep?.zoneHigh, 0.44);
  assert.deepEqual(warnings, ["deep pullback low is above its high."]);
  assert.deepEqual(payload.pullbackPlans.deep?.evidenceIds, []);
});

test("technical malformed prices and forged provenance are rejected", () => {
  for (const patch of [{ symbol: "FTFT" }, { generationId: "new" }, { usage: {} }, { sources: [] },
    { needsToHold: { label: "Hold", price: Infinity, rationale: "Bad number" } }]) {
    assert.throws(() => applyOwnerAnalysisEdit(base(), patch));
  }
});

test("context text can change without replacing original source URLs and hidden sections are explicit", () => {
  const original = base();
  const { payload } = applyOwnerAnalysisEdit(original, {
    catalystRealityCheck: { summary: "My news context", dayTradeRelevance: "My interpretation" },
    ownerHiddenSections: ["deep", "listingStatus", "deep"],
  });
  assert.deepEqual(payload.catalystRealityCheck.sourceUrls, original.catalystRealityCheck.sourceUrls);
  assert.deepEqual(payload.ownerHiddenSections, ["deep", "listingStatus"]);
  assert.throws(() => applyOwnerAnalysisEdit(original, { ownerHiddenSections: ["unknown"] }));
});

test("owner restores omitted breakout and preview preserves the correction without AI evidence requirements", () => {
  const empty = { label: "", price: null, rationale: "" };
  const original = { ...base(), cautionBelow: empty, mustClear: { label: "Must clear", price: 0.52, rationale: "Prior pivot" },
    breakoutContinuation: empty, targets: [], downsideCheckpoints: [], riskSummary: [],
    dilutionRisk: { summary: "", dayTradeRelevance: "" }, listingStatus: { summary: "", dayTradeRelevance: "" },
    ownerHiddenSections: ["breakoutContinuation"] } as unknown as TradersLinkAiReadPayload;
  const correction = { label: "Breakout continuation", price: 0.54321, rationale: "My corrected confirmation above the pivot." };
  const edited = applyOwnerAnalysisEdit(original, { breakoutContinuation: correction, ownerHiddenSections: [] });
  assert.deepEqual(edited.payload.breakoutContinuation, correction);
  assert.equal(original.breakoutContinuation.price, null);
  assert.deepEqual(original.ownerHiddenSections, ["breakoutContinuation"]);
  assert.equal(edited.payload.generationId, original.generationId);
  assert.equal(edited.payload.generatedAt, original.generatedAt);
  assert.equal(edited.warnings.length, 0);
  const preview = renderApprovedAnalysisDiscord(edited.payload).join("");
  assert.match(preview, /PDSB/);
  assert.match(preview, /View PDSB details/);
  assert.doesNotMatch(preview, /My corrected confirmation/, "the Discord caption links to the complete analysis rather than copying its sections");
  const inconsistent = applyOwnerAnalysisEdit(edited.payload, { breakoutContinuation: { ...correction, price: 0.49 } });
  assert.equal(inconsistent.payload.breakoutContinuation.price, 0.49);
  assert.equal(inconsistent.warnings.length, 2);
});

test("summary-only catalyst patches save in detailed and simplified formats without the retired field", () => {
  const simple = {
    ...base(), analysisFormat: "simple", riskSummary: [], simpleAnalysis: {
      setup: "Owner setup", breakout: { price: 0.6, explanation: "Breakout", confirmation: "Volume" },
      pullbacks: [{ low: 0.4, high: 0.45, explanation: "Pullback", confirmation: "Hold", invalidation: null }],
      upside: [{ low: 0.7, high: 0.8, explanation: "Target" }], invalidation: null,
    },
  } as unknown as TradersLinkAiReadPayload;
  for (const original of [base(), simple]) {
    const edited = applyOwnerAnalysisEdit(original, { catalystRealityCheck: { summary: "My edited news context" } });
    assert.equal(edited.payload.catalystRealityCheck.summary, "My edited news context");
    assert.equal(edited.payload.catalystRealityCheck.dayTradeRelevance, original.catalystRealityCheck.dayTradeRelevance);
    assert.deepEqual(edited.payload.catalystRealityCheck.sourceUrls, original.catalystRealityCheck.sourceUrls);
    assert.equal(edited.payload.catalystRealityCheck.status, original.catalystRealityCheck.status);
    assert.equal(original.catalystRealityCheck.summary, "Original news");
    assert.equal(edited.payload.generationId, original.generationId);
    const legacy = applyOwnerAnalysisEdit(original, { catalystRealityCheck: { summary: "Legacy window", dayTradeRelevance: "Old editor value" } });
    assert.equal(legacy.payload.catalystRealityCheck.summary, "Legacy window");
    assert.equal(legacy.payload.catalystRealityCheck.dayTradeRelevance, original.catalystRealityCheck.dayTradeRelevance);
    assert.throws(() => applyOwnerAnalysisEdit(original, { catalystRealityCheck: { summary: "My text", sourceUrls: [] } }), /Unexpected analysis field/);
  }
});
