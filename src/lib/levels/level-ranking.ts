// 2026-04-17 10:12 PM America/Toronto
// Orchestrate the full level strength scoring flow from analyzed candidates to ranked support and resistance outputs.

import { computeActiveRelevanceScore } from "./level-active-scoring.js";
import { applyClusterPenalties, clusterLevels } from "./level-clustering.js";
import type { LevelScoreConfig } from "./level-score-config.js";
import { LEVEL_SCORE_CONFIG } from "./level-score-config.js";
import { explainLevelScore } from "./level-score-explainer.js";
import { deriveLevelState } from "./level-state-engine.js";
import { computeStructuralStrengthScore } from "./level-structural-scoring.js";
import { analyzeLevelTouches } from "./level-touch-analysis.js";
import type {
  LevelCandidate,
  LevelScoreBreakdown,
  LevelScoringContext,
  RankedLevel,
  RankedLevelsOutput,
} from "./level-types.js";
import { buildZoneBounds, clamp } from "./level-zone-utils.js";

type NormalizedLevel = Omit<
  RankedLevel,
  "structuralStrengthScore" | "activeRelevanceScore" | "finalLevelScore" | "score" | "rank" | "confidence" | "state" | "explanation" | "scoreBreakdown"
>;

function uniqueTimeframes(level: LevelCandidate): LevelCandidate["sourceTimeframes"] {
  return [...new Set(level.sourceTimeframes)];
}

function normalizeLevel(level: LevelCandidate, context: LevelScoringContext, config: LevelScoreConfig): NormalizedLevel {
  const zoneBounds =
    level.zoneLow !== undefined && level.zoneHigh !== undefined
      ? { zoneLow: level.zoneLow, zoneHigh: level.zoneHigh }
      : buildZoneBounds(level.price);
  const baseAnalysis =
    level.touches !== undefined && level.touchCount !== undefined
      ? {
          touches: level.touches,
          touchCount: level.touchCount,
          meaningfulTouchCount: level.meaningfulTouchCount ?? 0,
          rejectionCount: level.rejectionCount ?? 0,
          failedBreakCount: level.failedBreakCount ?? 0,
          cleanBreakCount: level.cleanBreakCount ?? 0,
          reclaimCount: level.reclaimCount ?? 0,
          strongestReactionMovePct: level.strongestReactionMovePct ?? 0,
          averageReactionMovePct: level.averageReactionMovePct ?? 0,
          bestVolumeRatio: level.bestVolumeRatio ?? 1,
          averageVolumeRatio: level.averageVolumeRatio ?? 1,
          cleanlinessStdDevPct: level.cleanlinessStdDevPct ?? 0,
          ageInBars: level.ageInBars ?? 0,
          barsSinceLastReaction: level.barsSinceLastReaction ?? 0,
        }
      : analyzeLevelTouches(
          {
            price: level.price,
            type: level.type,
            zoneLow: zoneBounds.zoneLow,
            zoneHigh: zoneBounds.zoneHigh,
          },
          level.analysisCandles ?? context.recentCandles ?? [],
          context.currentTimeframe,
          config,
        );

  return {
    id: level.id,
    symbol: level.symbol,
    type: level.type,
    price: level.price,
    zoneLow: zoneBounds.zoneLow,
    zoneHigh: zoneBounds.zoneHigh,
    sourceTimeframes: uniqueTimeframes(level),
    originKinds: [...new Set(level.originKinds)],
    touches: baseAnalysis.touches,
    touchCount: baseAnalysis.touchCount,
    meaningfulTouchCount: baseAnalysis.meaningfulTouchCount,
    rejectionCount: baseAnalysis.rejectionCount,
    failedBreakCount: baseAnalysis.failedBreakCount,
    cleanBreakCount: baseAnalysis.cleanBreakCount,
    reclaimCount: baseAnalysis.reclaimCount,
    roleFlipCount: level.roleFlipCount ?? (level.originKinds.includes("role_flip") ? 1 : 0),
    strongestReactionMovePct: baseAnalysis.strongestReactionMovePct,
    averageReactionMovePct: baseAnalysis.averageReactionMovePct,
    bestVolumeRatio: baseAnalysis.bestVolumeRatio,
    averageVolumeRatio: baseAnalysis.averageVolumeRatio,
    cleanlinessStdDevPct: baseAnalysis.cleanlinessStdDevPct,
    ageInBars: baseAnalysis.ageInBars,
    barsSinceLastReaction: baseAnalysis.barsSinceLastReaction,
    clusterId: level.clusterId ?? null,
    isClusterRepresentative: level.isClusterRepresentative ?? true,
  };
}

function buildConfidence(level: RankedLevel): number {
  let confidence =
    level.meaningfulTouchCount * 12 +
    level.sourceTimeframes.length * 10 +
    level.scoreBreakdown.cleanlinessScore * 3 -
    Math.abs(level.scoreBreakdown.clusterPenalty) * 4;

  if (level.sourceTimeframes.length === 1 && level.sourceTimeframes[0] === "5m") {
    confidence -= 8;
  }

  if (level.state === "heavily_tested") {
    confidence -= 6;
  } else if (level.state === "weakened") {
    confidence -= 12;
  } else if (level.state === "broken") {
    confidence -= 20;
  }

  if (level.durabilityLabel === "reinforced") {
    confidence += 8;
  } else if (level.durabilityLabel === "durable") {
    confidence += 4;
  } else if (level.durabilityLabel === "fragile") {
    confidence -= 10;
  }

  return clamp(confidence, 0, 100);
}

function mergeBreakdowns(
  structural: LevelScoreBreakdown,
  active: Pick<
    LevelScoreBreakdown,
    | "distanceToPriceScore"
    | "freshReactionScore"
    | "intradayPressureScore"
    | "recentVolumeActivityScore"
    | "currentInteractionScore"
    | "activeRelevanceScore"
  >,
  finalLevelScore: number,
): LevelScoreBreakdown {
  return {
    ...structural,
    ...active,
    finalLevelScore,
  };
}

function finalizeSide(levels: RankedLevel[]): RankedLevel[] {
  return [...levels]
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.structuralStrengthScore - left.structuralStrengthScore ||
        right.activeRelevanceScore - left.activeRelevanceScore ||
        right.confidence - left.confidence,
    )
    .map((level, index) => ({
      ...level,
      rank: index + 1,
    }));
}

export function rankLevels(
  levels: LevelCandidate[],
  context: LevelScoringContext,
  config: LevelScoreConfig = LEVEL_SCORE_CONFIG,
): RankedLevelsOutput {
  const normalized = levels.map((level) => normalizeLevel(level, context, config));

  const baseStructurals = normalized.map((level) => {
    const structural = computeStructuralStrengthScore(level, config);
    return {
      ...level,
      structuralStrengthScore: structural.structuralStrengthScore,
      durabilityLabel: structural.durabilityLabel,
      scoreBreakdown: structural.scoreBreakdown,
    };
  });

  const clusters = clusterLevels(baseStructurals, config);
  const clustered = applyClusterPenalties(baseStructurals, clusters, config);

  const ranked = clustered.map((level) => {
    const structural = computeStructuralStrengthScore(level, config);
    const active = computeActiveRelevanceScore(level, context, config);
    const finalLevelScore = clamp(
      structural.structuralStrengthScore * config.combineWeights.structural +
        active.activeRelevanceScore * config.combineWeights.active,
      0,
      100,
    );
    const mergedBreakdown = mergeBreakdowns(structural.scoreBreakdown, active.scoreBreakdown, finalLevelScore);
    const provisional: RankedLevel = {
      ...level,
      structuralStrengthScore: structural.structuralStrengthScore,
      activeRelevanceScore: active.activeRelevanceScore,
      finalLevelScore,
      score: finalLevelScore,
      rank: 0,
      confidence: 0,
      state: "fresh",
      durabilityLabel: structural.durabilityLabel,
      explanation: "",
      scoreBreakdown: mergedBreakdown,
    };
    const state = deriveLevelState(provisional, config);
    const confidence = buildConfidence({
      ...provisional,
      state,
    });

    const finalized: RankedLevel = {
      ...provisional,
      state,
      confidence,
    };

    return {
      ...finalized,
      explanation: explainLevelScore(finalized),
    };
  });

  const supports = finalizeSide(ranked.filter((level) => level.type === "support"));
  const resistances = finalizeSide(ranked.filter((level) => level.type === "resistance"));

  return {
    symbol: context.symbol,
    currentPrice: context.currentPrice,
    supports,
    resistances,
    topSupport: supports[0],
    topResistance: resistances[0],
    computedAt: Date.now(),
  };
}
