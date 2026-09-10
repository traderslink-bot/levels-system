import type {
  TradersLinkAiReadPullbackScenario,
  TradersLinkAiReadFailureRecoveryPlan,
} from "../live-watchlist/live-watchlist-types.js";

export type AnalysisSectionIssue = {
  path: string;
  code: "invalid_number" | "low_confidence" | "zone_order" | "reference_order" |
    "missing_evidence" | "unknown_evidence" | "zone_evidence_mismatch" |
    "invalidation_order" | "confirmation_order" | "objective_order" |
    "momentum_failed" | "failure_order" | "reclaim_order" | "restore_order";
  action: "omit_section" | "omit_objective";
};

export type ScenarioValidationContext = {
  referencePrice: number;
  momentumFailure: number | null;
  confidence: "low" | "medium" | "high";
  candidates: ReadonlyArray<{ id: string; zoneLow: number; zoneHigh: number }>;
};

export type SectionValidationResult<T> = {
  value: T | null;
  issues: AnalysisSectionIssue[];
  // Callers must remove or revalidate prose depending on these exact paths.
  changedPaths: string[];
};

function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function evidenceIssues(
  path: string,
  ids: string[],
  low: number,
  high: number,
  context: ScenarioValidationContext,
): AnalysisSectionIssue[] {
  const issues: AnalysisSectionIssue[] = [];
  const add = (code: AnalysisSectionIssue["code"], field: string) =>
    issues.push({ path: `${path}.${field}`, code, action: "omit_section" });
  if (!ids.length) add("missing_evidence", "evidenceIds");
  const candidates = new Map(context.candidates.map((candidate) => [candidate.id, candidate]));
  if (ids.some((id) => !candidates.has(id))) add("unknown_evidence", "evidenceIds");
  const tolerance = Math.max(context.referencePrice * 0.005, 0.0001);
  if (!ids.some((id) => {
    const candidate = candidates.get(id);
    return candidate && Math.abs(candidate.zoneLow - low) <= tolerance &&
      Math.abs(candidate.zoneHigh - high) <= tolerance;
  })) add("zone_evidence_mismatch", "zone");
  return issues;
}

export function validatePullbackSection(
  name: "shallow" | "deep",
  scenario: TradersLinkAiReadPullbackScenario | null,
  context: ScenarioValidationContext,
): SectionValidationResult<TradersLinkAiReadPullbackScenario> {
  if (!scenario) return { value: null, issues: [], changedPaths: [] };
  const path = `pullbackPlans.${name}`;
  const issues = evidenceIssues(path, scenario.evidenceIds, scenario.zoneLow, scenario.zoneHigh, context);
  const add = (code: AnalysisSectionIssue["code"], field: string, action: AnalysisSectionIssue["action"] = "omit_section") =>
    issues.push({ path: `${path}.${field}`, code, action });
  const tolerance = Math.max(context.referencePrice * 0.005, 0.0001);
  for (const field of ["zoneLow", "zoneHigh", "invalidationPrice", "confirmationPrice"] as const) {
    if (!positive(scenario[field])) add("invalid_number", field);
  }
  if (!positive(context.referencePrice)) add("invalid_number", "referencePrice");
  if (context.confidence === "low") add("low_confidence", "confidence");
  if (scenario.zoneLow > scenario.zoneHigh) add("zone_order", "zone");
  if (scenario.zoneHigh >= context.referencePrice - tolerance) add("reference_order", "zoneHigh");
  if (scenario.invalidationPrice >= scenario.zoneLow - tolerance) add("invalidation_order", "invalidationPrice");
  if (scenario.confirmationPrice < scenario.zoneLow - tolerance) add("confirmation_order", "confirmationPrice");
  if (context.momentumFailure !== null) {
    if (context.referencePrice <= context.momentumFailure + tolerance) add("momentum_failed", "zone");
    if (name === "deep" && scenario.invalidationPrice < context.momentumFailure - tolerance) add("failure_order", "invalidationPrice");
  }
  if (scenario.firstObjectivePrice !== null &&
    (!positive(scenario.firstObjectivePrice) || scenario.firstObjectivePrice <= scenario.zoneHigh + tolerance)) {
    add("objective_order", "firstObjectivePrice", "omit_objective");
  }
  if (issues.some((issue) => issue.action === "omit_section")) return { value: null, issues, changedPaths: [path] };
  if (issues.length) {
    // Legacy prose has no field dependencies: omit these paragraphs instead
    // of guessing which sentence mentioned the rejected objective.
    return {
      value: { ...scenario, evidenceIds: [...scenario.evidenceIds], firstObjectivePrice: null, confirmation: "", rationale: "" },
      issues, changedPaths: [`${path}.firstObjectivePrice`, `${path}.confirmation`, `${path}.rationale`],
    };
  }
  return { value: { ...scenario, evidenceIds: [...scenario.evidenceIds] }, issues, changedPaths: [] };
}

export function validateRecoverySection(
  recovery: TradersLinkAiReadFailureRecoveryPlan | null,
  context: ScenarioValidationContext,
): SectionValidationResult<TradersLinkAiReadFailureRecoveryPlan> {
  if (!recovery) return { value: null, issues: [], changedPaths: [] };
  const path = "failureRecovery";
  const issues = evidenceIssues(path, recovery.evidenceIds, recovery.recoveryZoneLow, recovery.recoveryZoneHigh, context);
  const add = (code: AnalysisSectionIssue["code"], field: string, action: AnalysisSectionIssue["action"] = "omit_section") =>
    issues.push({ path: `${path}.${field}`, code, action });
  for (const field of ["recoveryZoneLow", "recoveryZoneHigh", "firstReclaimPrice", "setupRestorePrice"] as const) {
    if (!positive(recovery[field])) add("invalid_number", field);
  }
  if (!positive(context.referencePrice)) add("invalid_number", "referencePrice");
  if (recovery.recoveryZoneLow > recovery.recoveryZoneHigh) add("zone_order", "zone");
  const zoneTolerance = Math.max(recovery.recoveryZoneHigh * 0.005, 0.0001);
  const reclaimTolerance = Math.max(recovery.firstReclaimPrice * 0.005, 0.0001);
  const restoreTolerance = Math.max(recovery.setupRestorePrice * 0.005, 0.0001);
  if (recovery.firstReclaimPrice - recovery.recoveryZoneHigh <= zoneTolerance) add("reclaim_order", "firstReclaimPrice");
  if (recovery.setupRestorePrice - recovery.firstReclaimPrice <= reclaimTolerance) add("restore_order", "setupRestorePrice");
  if (recovery.firstObjectivePrice !== null && (
    !positive(recovery.firstObjectivePrice) ||
    recovery.firstObjectivePrice - recovery.firstReclaimPrice <= reclaimTolerance ||
    Math.abs(recovery.firstObjectivePrice - recovery.setupRestorePrice) <= restoreTolerance
  )) add("objective_order", "firstObjectivePrice", "omit_objective");
  if (issues.some((issue) => issue.action === "omit_section")) return { value: null, issues, changedPaths: [path] };
  if (issues.length) return {
    value: { ...recovery, evidenceIds: [...recovery.evidenceIds], firstObjectivePrice: null, rationale: "" },
    issues, changedPaths: [`${path}.firstObjectivePrice`, `${path}.rationale`],
  };
  return { value: { ...recovery, evidenceIds: [...recovery.evidenceIds] }, issues, changedPaths: [] };
}
