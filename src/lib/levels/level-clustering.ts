// 2026-04-17 09:45 PM America/Toronto
// Cluster nearby levels so one representative carries the strongest score while weaker duplicates are discounted.

import type { LevelScoreConfig } from "./level-score-config.js";
import { LEVEL_SCORE_CONFIG } from "./level-score-config.js";
import type { LevelCandidate, LevelCluster, RankedLevel, SourceTimeframe } from "./level-types.js";
import { clamp, overlapRatio, priceDistancePct, safeDivide, zonesOverlap } from "./level-zone-utils.js";

type ClusterComparableLevel = Pick<
  RankedLevel,
  | "id"
  | "type"
  | "price"
  | "zoneLow"
  | "zoneHigh"
  | "sourceTimeframes"
  | "originKinds"
  | "roleFlipCount"
  | "roleFlipEvidence"
  | "firstTimestamp"
  | "lastTimestamp"
  | "strongestReactionMovePct"
  | "cleanlinessStdDevPct"
  | "barsSinceLastReaction"
  | "structuralStrengthScore"
> & {
  clusterPenalty?: number;
  clusterId?: string | null;
  isClusterRepresentative?: boolean;
};

function mergeRepresentativeEvidence<T extends ClusterComparableLevel>(
  representative: T,
  members: T[],
): T {
  const roleFlipEvidence = representative.roleFlipEvidence ?? [...members]
    .filter((member) => member.roleFlipEvidence !== undefined)
    .sort((left, right) => {
      const leftEvidence = left.roleFlipEvidence!;
      const rightEvidence = right.roleFlipEvidence!;
      const timeframePriorityDifference =
        timeframePriority([rightEvidence.timeframe]) -
        timeframePriority([leftEvidence.timeframe]);
      return timeframePriorityDifference ||
        rightEvidence.reactionTimestamp - leftEvidence.reactionTimestamp;
    })[0]?.roleFlipEvidence;
  const firstTimestamps = members
    .map((member) => member.firstTimestamp)
    .filter((timestamp): timestamp is number => typeof timestamp === "number");
  const lastTimestamps = members
    .map((member) => member.lastTimestamp)
    .filter((timestamp): timestamp is number => typeof timestamp === "number");

  return {
    ...representative,
    sourceTimeframes: [...new Set(members.flatMap((member) => member.sourceTimeframes))],
    originKinds: [...new Set(members.flatMap((member) => member.originKinds))],
    // Nearby multi-timeframe candidates describe one price area. Preserve a
    // confirmed flip without pretending duplicate detections are multiple
    // independent flips.
    roleFlipCount: Math.max(...members.map((member) => member.roleFlipCount)),
    ...(firstTimestamps.length > 0 ? { firstTimestamp: Math.min(...firstTimestamps) } : {}),
    ...(lastTimestamps.length > 0 ? { lastTimestamp: Math.max(...lastTimestamps) } : {}),
    ...(roleFlipEvidence ? { roleFlipEvidence: { ...roleFlipEvidence } } : {}),
  } as T;
}

function timeframePriority(timeframes: SourceTimeframe[]): number {
  const rank: Record<SourceTimeframe, number> = {
    daily: 5,
    "4h": 4,
    "1h": 3,
    "15m": 2,
    "5m": 1,
  };

  return timeframes.reduce((best, timeframe) => Math.max(best, rank[timeframe]), 0);
}

export function chooseClusterRepresentative<T extends ClusterComparableLevel>(clusterLevels: T[]): T {
  return [...clusterLevels].sort(
    (left, right) =>
      right.structuralStrengthScore - left.structuralStrengthScore ||
      timeframePriority(right.sourceTimeframes) - timeframePriority(left.sourceTimeframes) ||
      left.cleanlinessStdDevPct - right.cleanlinessStdDevPct ||
      right.strongestReactionMovePct - left.strongestReactionMovePct ||
      left.barsSinceLastReaction - right.barsSinceLastReaction,
  )[0]!;
}

export function clusterLevels<T extends Pick<LevelCandidate, "id" | "type" | "price" | "zoneLow" | "zoneHigh">>(
  levels: T[],
  config: LevelScoreConfig = LEVEL_SCORE_CONFIG,
): LevelCluster[] {
  if (levels.length === 0) {
    return [];
  }

  const clusters: LevelCluster[] = [];

  // Cluster each role independently. Sorting both sides in one stream let an
  // interleaved opposite-side candidate split two otherwise-nearby supports
  // (or resistances), losing their confluence and merged evidence.
  for (const side of ["support", "resistance"] as const) {
    const sorted = levels
      .filter((level) => level.type === side)
      .sort((left, right) => left.price - right.price);
    if (sorted.length === 0) {
      continue;
    }

    let currentMembers: T[] = [sorted[0]!];
    let clusterLow = sorted[0]!.zoneLow ?? sorted[0]!.price;
    let clusterHigh = sorted[0]!.zoneHigh ?? sorted[0]!.price;

    const flushCluster = (): void => {
      const representative = currentMembers.reduce((best, member) =>
        member.price > best.price ? member : best,
      );
      clusters.push({
        id: `${side}-cluster-${clusters.length + 1}`,
        type: side,
        zoneLow: clusterLow,
        zoneHigh: clusterHigh,
        memberIds: currentMembers.map((level) => level.id),
        representativeId: representative.id,
      });
    };

    for (let index = 1; index < sorted.length; index += 1) {
      const candidate = sorted[index]!;
      const candidateLow = candidate.zoneLow ?? candidate.price;
      const candidateHigh = candidate.zoneHigh ?? candidate.price;
      const clusterZone = { zoneLow: clusterLow, zoneHigh: clusterHigh };
      const candidateZone = { zoneLow: candidateLow, zoneHigh: candidateHigh };
      const representativeDistancePct = priceDistancePct(
        (clusterLow + clusterHigh) / 2,
        (candidateLow + candidateHigh) / 2,
      );
      const enoughOverlap =
        overlapRatio(clusterZone, candidateZone) >= config.clustering.zoneOverlapThreshold;
      const practicallyNearby =
        representativeDistancePct <= config.clustering.maxRepresentativeDistancePct ||
        zonesOverlap(clusterZone, candidateZone);

      if (enoughOverlap || practicallyNearby) {
        currentMembers.push(candidate);
        clusterLow = Math.min(clusterLow, candidateLow);
        clusterHigh = Math.max(clusterHigh, candidateHigh);
        continue;
      }

      flushCluster();
      currentMembers = [candidate];
      clusterLow = candidateLow;
      clusterHigh = candidateHigh;
    }

    flushCluster();
  }

  return clusters.sort(
    (left, right) => left.zoneLow - right.zoneLow || left.type.localeCompare(right.type),
  );
}

export function applyClusterPenalties<T extends ClusterComparableLevel>(
  levels: T[],
  clusters: LevelCluster[],
  config: LevelScoreConfig = LEVEL_SCORE_CONFIG,
): T[] {
  const levelMap = new Map(levels.map((level) => [level.id, level] as const));

  return levels.map((level) => {
    const cluster = clusters.find((candidateCluster) => candidateCluster.memberIds.includes(level.id));
    if (!cluster) {
      return {
        ...level,
        clusterPenalty: 0,
        clusterId: null,
        isClusterRepresentative: true,
      };
    }

    const members = cluster.memberIds
      .map((memberId) => levelMap.get(memberId))
      .filter((member): member is T => member !== undefined);
    const representative = chooseClusterRepresentative(members);
    const isRepresentative = representative.id === level.id;

    if (isRepresentative || members.length === 1) {
      const mergedRepresentative = members.length > 1
        ? mergeRepresentativeEvidence(representative, members)
        : representative;
      return {
        ...mergedRepresentative,
        clusterPenalty: 0,
        clusterId: cluster.id,
        isClusterRepresentative: true,
      };
    }

    const representativeZone = { zoneLow: representative.zoneLow, zoneHigh: representative.zoneHigh };
    const levelZone = { zoneLow: level.zoneLow, zoneHigh: level.zoneHigh };
    const memberOverlap = overlapRatio(levelZone, representativeZone);
    const structuralGap = Math.max(representative.structuralStrengthScore - level.structuralStrengthScore, 0);
    const basePenalty = 2.5 + memberOverlap * 3.5 + clamp(structuralGap / 20, 0, 2);
    const clusterPenalty = -clamp(basePenalty, 0, config.penalties.clusterMax);

    return {
      ...level,
      clusterPenalty,
      clusterId: cluster.id,
      isClusterRepresentative: false,
    };
  });
}
