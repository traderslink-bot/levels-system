import assert from "node:assert/strict";
import test from "node:test";
import { remainingGeneratedSectionOmissions } from "../lib/ai/traderslink-ai-read-review-omissions.js";
import type { ReviewState } from "../lib/ai/traderslink-ai-read-review-store.js";

const original = { pullbackPlans: { shallow: null, deep: { firstObjectivePrice: null } }, currentRead: "", riskSummary: [], targets: [], downsideCheckpoints: [] };
function review(payload: Record<string, unknown>, decisions: Record<string, unknown>[], edited?: Record<string, unknown>): ReviewState {
  return { events: [
    { revision: 1, body: { kind: "original", generationId: "g1", payload, validationDecisions: decisions } },
    ...(edited ? [{ revision: 2, body: { kind: "edit", parentDraft: 1, payload: edited } }] : []),
    { revision: 3, body: { kind: "original", generationId: "g2", payload: {}, validationDecisions: [] } },
  ] } as unknown as ReviewState;
}
test("natural optional absence does not imply a validation omission", () => {
  assert.deepEqual(remainingGeneratedSectionOmissions(review(original, []), 1), []);
});
test("reconciles rejected sections and objectives with the selected owner's revision, not another generation", () => {
  const decisions = [{ stage: "optional_sections", issues: [
    { path: "pullbackPlans.shallow.zoneHigh", action: "omit_section" },
    { path: "pullbackPlans.deep.firstObjectivePrice", action: "omit_objective" },
  ] }];
  const restored = { ...original, pullbackPlans: { shallow: { zoneLow: 0.44, zoneHigh: 0.46 }, deep: { firstObjectivePrice: 0.65 } } };
  const state = review(original, decisions, restored);
  const before = JSON.stringify(state);
  assert.deepEqual(remainingGeneratedSectionOmissions(state, 1), ["pullbackPlans.shallow", "pullbackPlans.deep.firstObjectivePrice"]);
  assert.deepEqual(remainingGeneratedSectionOmissions(state, 2), []);
  assert.equal(JSON.stringify(state), before);
  assert.deepEqual(remainingGeneratedSectionOmissions(review(original, decisions, { ...restored, ownerHiddenSections: ["shallow"] }), 2), ["pullbackPlans.shallow"]);
});
test("tracks explicit overview and removed point omissions without treating a text normalization as removal", () => {
  const decisions = [
    { stage: "optional_overview", issues: [{ path: "currentRead", action: "omit_text" }, { path: "riskSummary.0", action: "omit_text" }] },
    { stage: "observable_evidence_normalization", before: { downsideCheckpoints: [{ price: 0.4 }] }, after: { downsideCheckpoints: [] } },
    { stage: "observable_evidence_normalization", before: { targets: [{ price: 0.6 }] }, after: { targets: [{ price: 0.6, condition: "Observed" }] } },
  ];
  assert.deepEqual(remainingGeneratedSectionOmissions(review(original, decisions), 1), ["currentRead", "riskSummary", "downsideCheckpoints"]);
  const edited = { ...original, currentRead: "Owner overview", riskSummary: ["Owner note"], downsideCheckpoints: [{ price: 0.39 }] };
  assert.deepEqual(remainingGeneratedSectionOmissions(review(original, decisions, edited), 2), []);
});
