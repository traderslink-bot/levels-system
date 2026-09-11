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

test("checkpoint dependency omissions remain visible until owner replacements are saved", () => {
  const decisions = [{ stage: "checkpoint_dependencies", field: "downsideCheckpoints", issues: [{}, {}] }];
  const baseline = { ...original, downsideCheckpoints: [{ price: 0.4 }] };
  assert.deepEqual(remainingGeneratedSectionOmissions(review(baseline, decisions), 1), ["downsideCheckpoints"]);
  const corrected = { ...baseline, downsideCheckpoints: [{ price: 0.4 }, { price: 0.35 }, { price: 0.3 }] };
  assert.deepEqual(remainingGeneratedSectionOmissions(review(baseline, decisions, corrected), 2), []);
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
  assert.deepEqual(remainingGeneratedSectionOmissions(review(original, decisions), 1), ["currentRead", "downsideCheckpoints", "riskSummary"]);
  const edited = { ...original, currentRead: "Owner overview", riskSummary: ["Owner note"], downsideCheckpoints: [{ price: 0.39 }] };
  assert.deepEqual(remainingGeneratedSectionOmissions(review(original, decisions, edited), 2), []);
});

test("valid backup selection does not itself count as an omission; rejected absent breakout does", () => {
  const candidate = { ...original, breakoutContinuation: { price: 0.54, rationale: "Owner breakout" } };
  const backup = [{ stage: "breakout_selection", selectedCandidateId: "alternate", decisions: [{ id: "primary", selected: false }],
    parsingIssues: [{ path: "breakoutCandidates.primary.targets.bad", reason: "Bad primary target" }] }];
  assert.deepEqual(remainingGeneratedSectionOmissions(review(candidate, backup), 1), []);
  const absent = [{ stage: "breakout_selection", selectedCandidateId: null, decisions: [{ id: "primary", selected: false }], parsingIssues: [] }];
  assert.deepEqual(remainingGeneratedSectionOmissions(review(original, absent), 1), ["breakoutContinuation"]);
  assert.deepEqual(remainingGeneratedSectionOmissions(review(original, absent, candidate), 2), []);
  assert.deepEqual(remainingGeneratedSectionOmissions(review(original, [{ stage: "breakout_selection", selectedCandidateId: null, decisions: [], parsingIssues: [] }]), 1), []);
});

test("selected-branch and outer-extension losses accumulate until the owner supplies replacements", () => {
  const decisions = [
    { stage: "breakout_selection", selectedCandidateId: "alternate", parsingIssues: [{ path: "breakoutCandidates.alternate.targets.bad" }],
      omittedNarrative: { currentRead: "Removed overview", riskSummary: ["Removed note"] } },
    { stage: "outer_daily_resistance", action: "omit_objective", omitted: [{ price: 0.85 }] },
  ];
  assert.deepEqual(remainingGeneratedSectionOmissions(review(original, decisions), 1), ["currentRead", "targets", "riskSummary"]);
  const edited = { ...original, currentRead: "Owner overview", riskSummary: ["Owner note"], targets: [{ price: 0.7 }] };
  assert.deepEqual(remainingGeneratedSectionOmissions(review(original, decisions, edited), 2), ["targets"]);
  assert.deepEqual(remainingGeneratedSectionOmissions(review(original, decisions, { ...edited, targets: [{ price: 0.7 }, { price: 0.9 }] }), 2), []);
});

test("sequential point removals are cumulative rather than cleared by replacing only one", () => {
  const decisions = [
    { stage: "checkpoint_spacing", before: { downsideCheckpoints: [1, 2, 3] }, after: { downsideCheckpoints: [1, 3] } },
    { stage: "observable_evidence_normalization", before: { downsideCheckpoints: [1, 3] }, after: { downsideCheckpoints: [1] } },
  ];
  const baseline = { ...original, downsideCheckpoints: [{ price: 0.4 }] };
  assert.deepEqual(remainingGeneratedSectionOmissions(review(baseline, decisions, { ...baseline, downsideCheckpoints: [{ price: 0.4 }, { price: 0.3 }] }), 2), ["downsideCheckpoints"]);
});
