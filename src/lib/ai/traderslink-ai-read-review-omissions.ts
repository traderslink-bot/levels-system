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
  const removedCounts = { targets: 0, downsideCheckpoints: 0, riskSummary: 0 };
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
      removedCounts.riskSummary += removedRisks;
    }
    if (decision.stage === "checkpoint_spacing" || decision.stage === "observable_evidence_normalization") {
      for (const key of ["targets", "downsideCheckpoints"] as const) {
        const before = at(decision.before, key), after = at(decision.after, key);
        if (Array.isArray(before) && Array.isArray(after)) removedCounts[key] += Math.max(0, before.length - after.length);
      }
    }
    if (decision.stage === "breakout_selection") {
      const parsing = Array.isArray(decision.parsingIssues) ? decision.parsingIssues : [];
      const rejected = Array.isArray(decision.decisions) && decision.decisions.length > 0;
      if (decision.selectedCandidateId === null && (rejected || parsing.length) &&
        (hidden("breakoutContinuation") || (!populated(at(payload, "breakoutContinuation.price")) &&
          !populated(at(payload, "breakoutContinuation.rationale"))))) omissions.add("breakoutContinuation");
      if (decision.selectedCandidateId === "primary" || decision.selectedCandidateId === "alternate") {
        const prefix = `breakoutCandidates.${decision.selectedCandidateId}.targets`;
        removedCounts.targets += parsing.filter(raw => {
          const path = object(raw)?.path;
          return typeof path === "string" && (path === prefix || path.startsWith(prefix + "."));
        }).length;
      }
      if (populated(at(decision.omittedNarrative, "currentRead")) &&
        (hidden("currentRead") || !populated(payload.currentRead))) omissions.add("currentRead");
      const risks = at(decision.omittedNarrative, "riskSummary");
      if (Array.isArray(risks)) removedCounts.riskSummary += risks.length;
    }
    if (decision.stage === "outer_daily_resistance" && decision.action === "omit_objective" && Array.isArray(decision.omitted)) {
      removedCounts.targets += decision.omitted.length;
    }
  }
  for (const key of ["targets", "downsideCheckpoints", "riskSummary"] as const) {
    const originalCount = Array.isArray(origin.body.payload[key]) ? origin.body.payload[key].length : 0;
    const finalCount = Array.isArray(payload[key]) ? payload[key].length : 0;
    if (removedCounts[key] && (hidden(key) || finalCount < originalCount + removedCounts[key])) omissions.add(key);
  }
  return [...omissions];
}
