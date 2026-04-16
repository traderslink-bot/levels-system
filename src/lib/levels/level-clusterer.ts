// 2026-04-14 09:12 PM America/Toronto
// Hotfix for final phase 1 clustering refinement with controlled second-pass merges.

import type { CandleTimeframe } from "../market-data/candle-types.js";
import type { LevelEngineConfig } from "./level-config.js";
import type { FinalLevelZone, LevelDataFreshness, RawLevelCandidate } from "./level-types.js";

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function dominantTimeframe(timeframes: CandleTimeframe[]): CandleTimeframe | "mixed" {
  const counts = new Map<CandleTimeframe, number>();

  for (const timeframe of timeframes) {
    counts.set(timeframe, (counts.get(timeframe) ?? 0) + 1);
  }

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  if (sorted.length === 0) {
    return "mixed";
  }

  if (sorted.length > 1 && sorted[0][1] === sorted[1][1]) {
    return "mixed";
  }

  return sorted[0][0];
}

function zoneFreshness(lastTimestamp: number): LevelDataFreshness {
  const hoursAgo = (Date.now() - lastTimestamp) / (1000 * 60 * 60);
  if (hoursAgo <= 24) {
    return "fresh";
  }

  if (hoursAgo <= 24 * 7) {
    return "aging";
  }

  return "stale";
}

function buildZoneFromGroup(
  symbol: string,
  kind: "support" | "resistance",
  group: RawLevelCandidate[],
  index: number,
): FinalLevelZone {
  const prices = group.map((item) => item.price);
  const sourceTypes = unique(group.map((item) => item.sourceType));
  const timeframeSources = unique(group.map((item) => item.timeframe));
  const notes = unique(group.flatMap((item) => item.notes));

  return {
    id: `${symbol}-${kind}-zone-${index + 1}`,
    symbol,
    kind,
    timeframeBias: dominantTimeframe(timeframeSources),
    zoneLow: Number(Math.min(...prices).toFixed(4)),
    zoneHigh: Number(Math.max(...prices).toFixed(4)),
    representativePrice: Number(
      (prices.reduce((sum, price) => sum + price, 0) / prices.length).toFixed(4),
    ),
    strengthScore: 0,
    strengthLabel: "weak",
    touchCount: group.reduce((sum, item) => sum + item.touchCount, 0),
    confluenceCount: timeframeSources.length,
    sourceTypes,
    timeframeSources,
    reactionQualityScore: Number(
      (
        group.reduce((sum, item) => sum + item.reactionQuality, 0) /
        Math.max(group.length, 1)
      ).toFixed(4),
    ),
    rejectionScore: Number(
      (
        group.reduce((sum, item) => sum + item.rejectionScore, 0) /
        Math.max(group.length, 1)
      ).toFixed(4),
    ),
    displacementScore: Number(
      (
        group.reduce((sum, item) => sum + item.displacementScore, 0) /
        Math.max(group.length, 1)
      ).toFixed(4),
    ),
    sessionSignificanceScore: Number(
      Math.max(...group.map((item) => item.sessionSignificance)).toFixed(4),
    ),
    followThroughScore: Number(
      (
        group.reduce((sum, item) => sum + item.followThroughScore, 0) /
        Math.max(group.length, 1)
      ).toFixed(4),
    ),
    gapContinuationScore: Number(
      (
        group.reduce((sum, item) => sum + (item.gapContinuationScore ?? 0), 0) /
        Math.max(group.length, 1)
      ).toFixed(4),
    ),
    sourceEvidenceCount: group.length,
    firstTimestamp: Math.min(...group.map((item) => item.firstTimestamp)),
    lastTimestamp: Math.max(...group.map((item) => item.lastTimestamp)),
    sessionDate: undefined,
    isExtension: false,
    freshness: zoneFreshness(Math.max(...group.map((item) => item.lastTimestamp))),
    notes,
  };
}

function shouldMergeGroupsByCenter(
  leftGroup: RawLevelCandidate[],
  rightGroup: RawLevelCandidate[],
  tolerancePct: number,
): boolean {
  const leftCenter = leftGroup.reduce((sum, item) => sum + item.price, 0) / leftGroup.length;
  const rightCenter = rightGroup.reduce((sum, item) => sum + item.price, 0) / rightGroup.length;

  const pctDiff = Math.abs(leftCenter - rightCenter) / Math.max(leftCenter, 0.0001);
  return pctDiff <= tolerancePct;
}

function firstPassCluster(
  candidates: RawLevelCandidate[],
  tolerancePct: number,
): RawLevelCandidate[][] {
  const sorted = [...candidates].sort((a, b) => a.price - b.price);
  const groups: RawLevelCandidate[][] = [];

  for (const candidate of sorted) {
    const lastGroup = groups.at(-1);

    if (!lastGroup) {
      groups.push([candidate]);
      continue;
    }

    if (shouldMergeGroupsByCenter(lastGroup, [candidate], tolerancePct)) {
      lastGroup.push(candidate);
    } else {
      groups.push([candidate]);
    }
  }

  return groups;
}

function zonesAreCloseOrOverlapping(
  left: FinalLevelZone,
  right: FinalLevelZone,
  tolerancePct: number,
  overlapMergeTolerancePct: number,
): boolean {
  const overlap =
    right.zoneLow <= left.zoneHigh ||
    Math.abs(right.zoneLow - left.zoneHigh) / Math.max(left.representativePrice, 0.0001) <=
      overlapMergeTolerancePct;

  if (overlap) {
    return true;
  }

  const centerDiff =
    Math.abs(left.representativePrice - right.representativePrice) /
    Math.max(left.representativePrice, 0.0001);

  return centerDiff <= tolerancePct;
}

function exceedsMaxMergedWidth(
  left: FinalLevelZone,
  right: FinalLevelZone,
  maxMergedZoneWidthPct: number,
): boolean {
  const mergedLow = Math.min(left.zoneLow, right.zoneLow);
  const mergedHigh = Math.max(left.zoneHigh, right.zoneHigh);
  const mergedMid = (mergedLow + mergedHigh) / 2;
  const mergedWidthPct = (mergedHigh - mergedLow) / Math.max(mergedMid, 0.0001);

  return mergedWidthPct > maxMergedZoneWidthPct;
}

function mergeZones(
  symbol: string,
  kind: "support" | "resistance",
  zones: FinalLevelZone[],
): FinalLevelZone[] {
  return zones.map((zone, index) => ({
    ...zone,
    id: `${symbol}-${kind}-zone-${index + 1}`,
  }));
}

function secondPassMergeZones(
  symbol: string,
  kind: "support" | "resistance",
  initialZones: FinalLevelZone[],
  config: LevelEngineConfig,
): FinalLevelZone[] {
  if (initialZones.length <= 1) {
    return mergeZones(symbol, kind, initialZones);
  }

  const sorted = [...initialZones].sort((a, b) => a.zoneLow - b.zoneLow);
  const merged: FinalLevelZone[] = [];
  let current = sorted[0];

  for (let i = 1; i < sorted.length; i += 1) {
    const next = sorted[i];
    const baseTolerancePct =
      Math.max(
        ...unique([...current.timeframeSources, ...next.timeframeSources]).map(
          (timeframe) => config.timeframeConfig[timeframe].clusterTolerancePct,
        ),
      ) * config.secondPassMergeToleranceMultiplier;

    const closeEnough = zonesAreCloseOrOverlapping(
      current,
      next,
      baseTolerancePct,
      config.overlapMergeTolerancePct,
    );

    const tooWideIfMerged = exceedsMaxMergedWidth(
      current,
      next,
      config.maxMergedZoneWidthPct,
    );

    if (closeEnough && !tooWideIfMerged) {
      current = {
        ...current,
        zoneLow: Number(Math.min(current.zoneLow, next.zoneLow).toFixed(4)),
        zoneHigh: Number(Math.max(current.zoneHigh, next.zoneHigh).toFixed(4)),
        representativePrice: Number(
          (
            (current.representativePrice * current.touchCount +
              next.representativePrice * next.touchCount) /
            Math.max(current.touchCount + next.touchCount, 1)
          ).toFixed(4),
        ),
        touchCount: current.touchCount + next.touchCount,
        confluenceCount: unique([
          ...current.timeframeSources,
          ...next.timeframeSources,
        ]).length,
        sourceTypes: unique([...current.sourceTypes, ...next.sourceTypes]),
        timeframeSources: unique([...current.timeframeSources, ...next.timeframeSources]),
        reactionQualityScore: Number(
          (
            (current.reactionQualityScore * current.sourceEvidenceCount +
              next.reactionQualityScore * next.sourceEvidenceCount) /
            Math.max(current.sourceEvidenceCount + next.sourceEvidenceCount, 1)
          ).toFixed(4),
        ),
        rejectionScore: Number(
          (
            (current.rejectionScore * current.sourceEvidenceCount +
              next.rejectionScore * next.sourceEvidenceCount) /
            Math.max(current.sourceEvidenceCount + next.sourceEvidenceCount, 1)
          ).toFixed(4),
        ),
        displacementScore: Number(
          (
            (current.displacementScore * current.sourceEvidenceCount +
              next.displacementScore * next.sourceEvidenceCount) /
            Math.max(current.sourceEvidenceCount + next.sourceEvidenceCount, 1)
          ).toFixed(4),
        ),
        sessionSignificanceScore: Number(
          Math.max(current.sessionSignificanceScore, next.sessionSignificanceScore).toFixed(4),
        ),
        followThroughScore: Number(
          (
            (current.followThroughScore * current.sourceEvidenceCount +
              next.followThroughScore * next.sourceEvidenceCount) /
            Math.max(current.sourceEvidenceCount + next.sourceEvidenceCount, 1)
          ).toFixed(4),
        ),
        gapContinuationScore: Number(
          (
            ((current.gapContinuationScore ?? 0) * current.sourceEvidenceCount +
              (next.gapContinuationScore ?? 0) * next.sourceEvidenceCount) /
            Math.max(current.sourceEvidenceCount + next.sourceEvidenceCount, 1)
          ).toFixed(4),
        ),
        sourceEvidenceCount: current.sourceEvidenceCount + next.sourceEvidenceCount,
        firstTimestamp: Math.min(current.firstTimestamp, next.firstTimestamp),
        lastTimestamp: Math.max(current.lastTimestamp, next.lastTimestamp),
        sessionDate: current.sessionDate ?? next.sessionDate,
        isExtension: current.isExtension || next.isExtension,
        freshness: zoneFreshness(Math.max(current.lastTimestamp, next.lastTimestamp)),
        notes: unique([...current.notes, ...next.notes, "Merged in second clustering pass."]),
        timeframeBias: dominantTimeframe(
          unique([...current.timeframeSources, ...next.timeframeSources]),
        ),
      };
    } else {
      merged.push(current);
      current = next;
    }
  }

  merged.push(current);

  return mergeZones(symbol, kind, merged);
}

export function clusterRawLevelCandidates(
  symbol: string,
  kind: "support" | "resistance",
  candidates: RawLevelCandidate[],
  tolerancePct: number,
  config: LevelEngineConfig,
): FinalLevelZone[] {
  const filtered = candidates.filter((candidate) => candidate.kind === kind);
  const firstPassGroups = firstPassCluster(filtered, tolerancePct);
  const firstPassZones = firstPassGroups.map((group, index) =>
    buildZoneFromGroup(symbol, kind, group, index),
  );

  return secondPassMergeZones(symbol, kind, firstPassZones, config);
}
