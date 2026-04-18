// 2026-04-17 09:48 PM America/Toronto
// Deterministic level state assignment based on touch history and structural deterioration.

import type { LevelScoreConfig } from "./level-score-config.js";
import { LEVEL_SCORE_CONFIG } from "./level-score-config.js";
import type { RankedLevel, LevelCandidate, LevelState, LevelTouch } from "./level-types.js";

type StatefulLevel = Pick<
  RankedLevel,
  | "touchCount"
  | "meaningfulTouchCount"
  | "cleanBreakCount"
  | "reclaimCount"
  | "roleFlipCount"
  | "averageReactionMovePct"
  | "barsSinceLastReaction"
  | "touches"
> &
  Partial<Pick<LevelCandidate, "originKinds">>;

function meaningfulReactionTrend(touches: LevelTouch[]): "stable" | "shrinking" {
  const meaningful = touches
    .filter((touch) => touch.reactionMovePct > 0)
    .map((touch) => touch.reactionMovePct)
    .slice(-3);

  if (meaningful.length < 3) {
    return "stable";
  }

  return meaningful[2]! <= meaningful[1]! && meaningful[1]! <= meaningful[0]! * 1.05 ? "shrinking" : "stable";
}

export function deriveLevelState(
  level: StatefulLevel,
  config: LevelScoreConfig = LEVEL_SCORE_CONFIG,
): LevelState {
  const latestTouch = level.touches[level.touches.length - 1];
  const recentMeaningfulTrend = meaningfulReactionTrend(level.touches);
  const shallowAverageReaction = level.averageReactionMovePct <= config.stateThresholds.shallowReactionPct;
  const hasRoleFlipOrigin = level.originKinds?.includes("role_flip") ?? false;

  if (level.reclaimCount > 0 && latestTouch?.reactionType === "reclaim") {
    return "reclaimed";
  }

  if (
    level.cleanBreakCount > level.reclaimCount &&
    (latestTouch?.reactionType === "clean_break" || level.barsSinceLastReaction <= config.recencyBars.recent)
  ) {
    return "broken";
  }

  if (level.roleFlipCount > 0 || hasRoleFlipOrigin) {
    return "flipped";
  }

  if (
    level.touchCount >= config.stateThresholds.weakenedTouchCount &&
    (recentMeaningfulTrend === "shrinking" || shallowAverageReaction)
  ) {
    return "weakened";
  }

  if (level.touchCount >= config.stateThresholds.heavilyTestedTouchCount) {
    return "heavily_tested";
  }

  if (level.meaningfulTouchCount >= config.stateThresholds.respectedMeaningfulTouches) {
    return "respected";
  }

  return "fresh";
}
