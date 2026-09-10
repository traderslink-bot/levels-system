import assert from "node:assert/strict";
import test from "node:test";
import { publicationPreviewHash, renderApprovedAnalysisDiscord, splitApprovedAnalysisText } from "../lib/ai/traderslink-ai-read-publication-preview.js";
import type { TradersLinkAiReadPayload } from "../lib/live-watchlist/live-watchlist-types.js";

test("preview splitting preserves every character, including surrogate pairs and long owner lines", () => {
  for (const text of ["a".repeat(1999) + "🚀" + "b".repeat(2200), ("VWAP confirmation\nEMA support\n").repeat(200)]) {
    const chunks = splitApprovedAnalysisText(text);
    assert.equal(chunks.join(""), text);
    assert.ok(chunks.every((chunk) => chunk.length <= 2000 && !/[\uD800-\uDBFF]$/.test(chunk)));
  }
});

test("preview retains optional scenario identity and owner text without private provenance", () => {
  const level = { label: "Owner label", price: 0.4555, rationale: "Owner rationale" };
  const read = {
    symbol: "PDSB", currentPrice: 0.5, bias: "bullish", confidence: "medium", currentRead: "Owner analysis",
    needsToHold: level, cautionBelow: level, momentumFailure: level, mustClear: level, breakoutContinuation: level,
    targets: [{ label: "Next", price: 0.7, condition: "Above pivot" }], downsideCheckpoints: [],
    pullbackPlans: { shallow: null, deep: { zoneLow: 0.4, zoneHigh: 0.42, confirmationPrice: 0.44, confirmation: "Reclaim", invalidationPrice: 0.38, firstObjectivePrice: null, rationale: "Deeper structure", evidenceIds: ["private-evidence"] } },
    failureRecovery: null, catalystRealityCheck: { summary: "News", dayTradeRelevance: "Context" },
    dilutionRisk: { summary: "Dilution", dayTradeRelevance: "Risk" }, listingStatus: { summary: "Listing", dayTradeRelevance: "Context" },
    riskSummary: ["Risk note"], model: "private-model", ownerHiddenSections: ["cautionBelow"],
  } as unknown as TradersLinkAiReadPayload;
  const body = renderApprovedAnalysisDiscord(read).join("");
  assert.match(body, /Deep pullback/);
  assert.doesNotMatch(body, /Shallow pullback|Caution below|private-evidence|private-model|\$null/);
  assert.match(body, /Owner label\n\$0\.4555\nOwner rationale/);
  assert.match(body, /Where the trade could go next/);
  const publication = { website: { symbol: "PDSB" }, discordChunks: [body] };
  assert.equal(publicationPreviewHash(publication), publicationPreviewHash(structuredClone(publication)));
  assert.notEqual(publicationPreviewHash(publication), publicationPreviewHash({ ...publication, discordChunks: [body + " change"] }));
});
