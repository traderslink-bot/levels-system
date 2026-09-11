import type { ReviewState } from "./traderslink-ai-read-review-store.js";

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const at = (value: unknown, path: string): unknown => path.split(".").reduce<unknown>((current, key) => object(current)?.[key], value);
const populated = (value: unknown): boolean => value !== null && value !== undefined &&
  (typeof value !== "string" || value.trim().length > 0) && (!Array.isArray(value) || value.length > 0);

/** Display-only reconciliation with the exact saved revision, never an edit or
 * publication gate. Natural optional absence without a recorded omission is
 * not a failure. Original decisions remain immutable when an owner restores it.
 */
export function remainingGeneratedSectionOmissions(review: ReviewState, draftRevision: number): string[] {
  const draft = review.events.find(event => event.revision === draftRevision);
  if (draft?.body.kind !== "original" && draft?.body.kind !== "edit") return [];
  const payload = draft.body.payload;
  let origin = draft;
  const visited = new Set<number>();
  while (origin.body.kind === "edit") {
    if (visited.has(origin.revision)) return [];
    visited.add(origin.revision);
    const parent = review.events.find(event => event.revision === (origin.body as { parentDraft: number }).parentDraft);
    if (!parent) return [];
    origin = parent;
  }
  if (origin.body.kind !== "original") return [];
  const omissions = new Set<string>();
  const sections = ["pullbackPlans.shallow", "pullbackPlans.deep", "failureRecovery", "mustClear", "breakoutContinuation"];
  const hidden = (path: string) => Array.isArray(payload.ownerHiddenSections) &&
    payload.ownerHiddenSections.includes(path.replace("pullbackPlans.", ""));
  for (const decision of origin.body.validationDecisions ?? []) {
    if (decision.stage === "optional_sections" && Array.isArray(decision.issues)) {
      for (const raw of decision.issues) {
        const issue = object(raw);
        if (!issue || typeof issue.path !== "string") continue;
        const section = sections.find(path => issue.path === path || (issue.path as string).startsWith(path + "."));
        if (!section) continue;
        if (issue.action === "omit_objective") {
          if (hidden(section) || !populated(at(payload, issue.path))) omissions.add(issue.path);
        } else if (issue.action === "omit_section") {
          const value = at(payload, section);
          const absentLevel = (section === "mustClear" || section === "breakoutContinuation") &&
            !populated(at(value, "price")) && !populated(at(value, "rationale"));
          if (hidden(section) || !populated(value) || absentLevel) omissions.add(section);
        }
      }
    }
    if (decision.stage === "optional_overview" && Array.isArray(decision.issues)) {
      const overviewRemoved = decision.issues.some(raw => object(raw)?.path === "currentRead");
      if (overviewRemoved && (hidden("currentRead") || !populated(payload.currentRead))) omissions.add("currentRead");
      const removedRisks = decision.issues.filter(raw => String(object(raw)?.path).startsWith("riskSummary.")).length;
      const originalRisks = Array.isArray(origin.body.payload.riskSummary) ? origin.body.payload.riskSummary.length : 0;
      const finalRisks = Array.isArray(payload.riskSummary) ? payload.riskSummary.length : 0;
      if (removedRisks && (hidden("riskSummary") || finalRisks < originalRisks + removedRisks)) omissions.add("riskSummary");
    }
    if (decision.stage === "checkpoint_spacing" || decision.stage === "observable_evidence_normalization") {
      for (const key of ["targets", "downsideCheckpoints"]) {
        const before = at(decision.before, key), after = at(decision.after, key), final = payload[key];
        if (Array.isArray(before) && Array.isArray(after) && before.length > after.length &&
          (hidden(key) || !Array.isArray(final) || final.length < before.length)) omissions.add(key);
      }
    }
  }
  return [...omissions];
}
