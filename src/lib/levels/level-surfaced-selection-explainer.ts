// 2026-04-18 12:18 AM America/Toronto
// Human-readable explanations for why a level was surfaced, anchored, suppressed, or excluded.

import type { LevelType, RankedLevel } from "./level-types.js";

export type SurfacedSelectionExplanationInput = {
  level: RankedLevel;
  side: LevelType;
  distanceToPricePct: number;
  proximityBand: "immediate" | "near" | "local" | "extended" | "distant";
  selectionCategory: "actionable" | "anchor";
  redundantNearby: boolean;
};

export type SurfacedSuppressionExplanationInput = {
  level: RankedLevel;
  side: LevelType;
  reason:
    | "below_minimum_structural_quality"
    | "below_minimum_confidence"
    | "wrong_side_of_price"
    | "broken_state"
    | "nearby_stronger_level"
    | "outside_actionable_range"
    | "anchor_not_needed";
  suppressedByLevel?: RankedLevel;
};

function sideLabel(side: LevelType): string {
  return side === "support" ? "support" : "resistance";
}

function structuralDescriptor(level: RankedLevel): string {
  if (level.structuralStrengthScore >= 80) {
    return "very strong structural score";
  }
  if (level.structuralStrengthScore >= 65) {
    return "strong structural score";
  }
  if (level.structuralStrengthScore >= 50) {
    return "credible structural score";
  }
  return "borderline structural score";
}

function zoneBehaviorDescriptor(level: RankedLevel): string {
  if (level.state === "respected" || level.state === "reclaimed" || level.state === "flipped") {
    return "clean zone behavior";
  }
  if (level.state === "fresh") {
    return "fresh nearby context";
  }
  if (level.state === "weakened") {
    return "despite weakened recent behavior";
  }
  if (level.state === "heavily_tested") {
    return "despite heavy retesting";
  }
  return "recent structural context";
}

export function explainSurfacedSelection(input: SurfacedSelectionExplanationInput): string {
  const levelText = sideLabel(input.side);

  if (input.selectionCategory === "anchor") {
    return `Selected as deeper anchor ${levelText} because it kept a ${structuralDescriptor(input.level)} after nearer alternatives became weak or redundant.`;
  }

  if (input.proximityBand === "immediate" || input.proximityBand === "near") {
    return `Selected as nearest actionable ${levelText} because it stayed inside the practical interaction band with ${structuralDescriptor(input.level)} and ${zoneBehaviorDescriptor(input.level)}.`;
  }

  if (input.redundantNearby) {
    return `Selected as the best ${levelText} for this price band because nearby alternatives were redundant or structurally weaker.`;
  }

  return `Selected as actionable ${levelText} because it balanced ${structuralDescriptor(input.level)} with usable proximity to current price.`;
}

export function explainSuppressedSurfacedLevel(input: SurfacedSuppressionExplanationInput): string {
  const levelText = sideLabel(input.side);

  switch (input.reason) {
    case "below_minimum_structural_quality":
      return `Excluded because this ${levelText} did not meet the minimum structural quality threshold for surfaced output.`;
    case "below_minimum_confidence":
      return `Excluded because this ${levelText} did not meet the minimum confidence threshold for surfaced output.`;
    case "wrong_side_of_price":
      return `Excluded because this ${levelText} was on the wrong side of current price for actionable surfaced output.`;
    case "broken_state":
      return `Excluded because this ${levelText} is in a broken state and broken levels do not qualify as actionable surfaced output by default.`;
    case "outside_actionable_range":
      return `Suppressed because this ${levelText} sat too far from current price to be actionable right now.`;
    case "anchor_not_needed":
      return `Suppressed because this ${levelText} was only useful as deeper context and a better anchor was already selected.`;
    case "nearby_stronger_level":
    default: {
      if (input.suppressedByLevel) {
        return `Suppressed because a stronger nearby ${levelText} around ${input.suppressedByLevel.price.toFixed(4)} already covers this price band.`;
      }
      return `Suppressed because a stronger nearby ${levelText} already covers this price band.`;
    }
  }
}
