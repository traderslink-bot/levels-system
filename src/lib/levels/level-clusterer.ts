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

function timeframeRank(timeframe: CandleTimeframe): number {
  switch (timeframe) {
    case "daily":
      return 3;
    case "4h":
      return 2;
    default:
      return 1;
  }
}

export type LevelClusterRawMemberDiagnostic = {
  id: string;
  price: number;
  sourceType: RawLevelCandidate["sourceType"];
  timeframe: RawLevelCandidate["timeframe"];
};

export type LevelClusterHiddenDepthCandidate = LevelClusterRawMemberDiagnostic & {
  distanceFromRepresentativePct: number;
  depthSide: "below_representative" | "above_representative";
};

export type LevelClusterMemberDiagnostic = {
  clusterId: string;
  clusterIndex: number;
  kind: "support" | "resistance";
  representativePrice: number;
  zoneLow: number;
  zoneHigh: number;
  rawMemberMapping: "tracked_from_clusterer_diagnostics";
  rawMemberCount: number;
  rawMemberIds: string[];
  rawMemberPrices: number[];
  rawMembers: LevelClusterRawMemberDiagnostic[];
  minRawMemberPrice?: number;
  maxRawMemberPrice?: number;
  rawPriceSpanPct?: number;
  sourceTypes: RawLevelCandidate["sourceType"][];
  timeframeSources: RawLevelCandidate["timeframe"][];
  firstPassClusterIds: string[];
  mergedFirstPassClusterCount: number;
  materialPriceSpanPct: number;
  membersSpanMateriallyDifferentPrices: boolean;
  hiddenDepthCandidates: LevelClusterHiddenDepthCandidate[];
  potentialExtensionDepthMemberIds: string[];
};

export type LevelClusterMemberTrackingDiagnostics = {
  symbol: string;
  kind: "support" | "resistance";
  rawCandidateCount: number;
  filteredCandidateCount: number;
  firstPassClusterCount: number;
  finalClusterCount: number;
  materialPriceSpanThresholdPct: number;
  clusters: LevelClusterMemberDiagnostic[];
  diagnostics: string[];
  safety: {
    diagnosticOnly: true;
    clusteringBehaviorUnchanged: true;
    normalClusterOutputUnchanged: true;
  };
};

export type ClusterRawLevelCandidatesWithDiagnosticsResult = {
  zones: FinalLevelZone[];
  diagnostics: LevelClusterMemberTrackingDiagnostics;
};

type TrackedLevelClusterZone = {
  zone: FinalLevelZone;
  rawMembers: RawLevelCandidate[];
  firstPassClusterIds: string[];
};

function round(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function priceSpanPct(prices: number[]): number | undefined {
  if (prices.length === 0) {
    return undefined;
  }

  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const midpoint = (min + max) / 2;

  return round(((max - min) / Math.max(midpoint, 0.0001)) * 100);
}

function distanceFromRepresentativePct(price: number, representativePrice: number): number {
  return round(
    (Math.abs(price - representativePrice) / Math.max(representativePrice, 0.0001)) * 100,
  );
}

function uniqueRawMembers(members: RawLevelCandidate[]): RawLevelCandidate[] {
  const byId = new Map<string, RawLevelCandidate>();

  for (const member of members) {
    byId.set(member.id, member);
  }

  return [...byId.values()].sort((left, right) => left.price - right.price || left.id.localeCompare(right.id));
}

function preferRawCandidateRepresentative(
  challenger: RawLevelCandidate,
  incumbent: RawLevelCandidate,
  kind: "support" | "resistance",
): boolean {
  if (timeframeRank(challenger.timeframe) !== timeframeRank(incumbent.timeframe)) {
    return timeframeRank(challenger.timeframe) > timeframeRank(incumbent.timeframe);
  }

  if (challenger.rejectionScore !== incumbent.rejectionScore) {
    return challenger.rejectionScore > incumbent.rejectionScore;
  }

  if (challenger.followThroughScore !== incumbent.followThroughScore) {
    return challenger.followThroughScore > incumbent.followThroughScore;
  }

  if (challenger.reactionQuality !== incumbent.reactionQuality) {
    return challenger.reactionQuality > incumbent.reactionQuality;
  }

  if (challenger.displacementScore !== incumbent.displacementScore) {
    return challenger.displacementScore > incumbent.displacementScore;
  }

  if (challenger.touchCount !== incumbent.touchCount) {
    return challenger.touchCount > incumbent.touchCount;
  }

  if (challenger.repeatedReactionCount !== incumbent.repeatedReactionCount) {
    return challenger.repeatedReactionCount > incumbent.repeatedReactionCount;
  }

  if (challenger.lastTimestamp !== incumbent.lastTimestamp) {
    return challenger.lastTimestamp > incumbent.lastTimestamp;
  }

  return kind === "resistance"
    ? challenger.price > incumbent.price
    : challenger.price < incumbent.price;
}

function pickRepresentativeCandidate(
  group: RawLevelCandidate[],
  kind: "support" | "resistance",
): RawLevelCandidate {
  return group.reduce((best, candidate) =>
    preferRawCandidateRepresentative(candidate, best, kind) ? candidate : best,
  );
}

function preferZoneRepresentative(
  challenger: FinalLevelZone,
  incumbent: FinalLevelZone,
): boolean {
  const challengerPrimary = dominantTimeframe(challenger.timeframeSources);
  const incumbentPrimary = dominantTimeframe(incumbent.timeframeSources);

  const challengerRank = challengerPrimary === "mixed" ? 4 : timeframeRank(challengerPrimary);
  const incumbentRank = incumbentPrimary === "mixed" ? 4 : timeframeRank(incumbentPrimary);
  if (challengerRank !== incumbentRank) {
    return challengerRank > incumbentRank;
  }

  if (challenger.confluenceCount !== incumbent.confluenceCount) {
    return challenger.confluenceCount > incumbent.confluenceCount;
  }

  if (challenger.rejectionScore !== incumbent.rejectionScore) {
    return challenger.rejectionScore > incumbent.rejectionScore;
  }

  if (challenger.followThroughScore !== incumbent.followThroughScore) {
    return challenger.followThroughScore > incumbent.followThroughScore;
  }

  if (challenger.reactionQualityScore !== incumbent.reactionQualityScore) {
    return challenger.reactionQualityScore > incumbent.reactionQualityScore;
  }

  if (challenger.displacementScore !== incumbent.displacementScore) {
    return challenger.displacementScore > incumbent.displacementScore;
  }

  if (challenger.sourceEvidenceCount !== incumbent.sourceEvidenceCount) {
    return challenger.sourceEvidenceCount > incumbent.sourceEvidenceCount;
  }

  if (challenger.touchCount !== incumbent.touchCount) {
    return challenger.touchCount > incumbent.touchCount;
  }

  if (challenger.lastTimestamp !== incumbent.lastTimestamp) {
    return challenger.lastTimestamp > incumbent.lastTimestamp;
  }

  return challenger.kind === "resistance"
    ? challenger.representativePrice > incumbent.representativePrice
    : challenger.representativePrice < incumbent.representativePrice;
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
  const representativeCandidate = pickRepresentativeCandidate(group, kind);

  return {
    id: `${symbol}-${kind}-zone-${index + 1}`,
    symbol,
    kind,
    timeframeBias: dominantTimeframe(timeframeSources),
    zoneLow: Number(Math.min(...prices).toFixed(4)),
    zoneHigh: Number(Math.max(...prices).toFixed(4)),
    representativePrice: Number(representativeCandidate.price.toFixed(4)),
    strengthScore: 0,
    strengthLabel: "weak",
    // Candidate touch windows overlap heavily inside one price cluster. A sum
    // claims the same candle repeatedly (once per nearby swing). Keep the
    // strongest observed interaction count and let confluence/source evidence
    // represent independent corroboration.
    touchCount: Math.max(...group.map((item) => item.touchCount)),
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

function mergeTrackedZones(
  symbol: string,
  kind: "support" | "resistance",
  zones: TrackedLevelClusterZone[],
): TrackedLevelClusterZone[] {
  return zones.map((tracked, index) => ({
    ...tracked,
    zone: {
      ...tracked.zone,
      id: `${symbol}-${kind}-zone-${index + 1}`,
    },
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
      const representativeZone = preferZoneRepresentative(next, current) ? next : current;
      current = {
        ...current,
        zoneLow: Number(Math.min(current.zoneLow, next.zoneLow).toFixed(4)),
        zoneHigh: Number(Math.max(current.zoneHigh, next.zoneHigh).toFixed(4)),
        representativePrice: representativeZone.representativePrice,
        touchCount: Math.max(current.touchCount, next.touchCount),
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

function secondPassMergeTrackedZones(
  symbol: string,
  kind: "support" | "resistance",
  initialZones: TrackedLevelClusterZone[],
  config: LevelEngineConfig,
): TrackedLevelClusterZone[] {
  if (initialZones.length <= 1) {
    return mergeTrackedZones(symbol, kind, initialZones);
  }

  const sorted = [...initialZones].sort((a, b) => a.zone.zoneLow - b.zone.zoneLow);
  const merged: TrackedLevelClusterZone[] = [];
  let current = sorted[0];

  for (let i = 1; i < sorted.length; i += 1) {
    const next = sorted[i];
    const baseTolerancePct =
      Math.max(
        ...unique([...current.zone.timeframeSources, ...next.zone.timeframeSources]).map(
          (timeframe) => config.timeframeConfig[timeframe].clusterTolerancePct,
        ),
      ) * config.secondPassMergeToleranceMultiplier;

    const closeEnough = zonesAreCloseOrOverlapping(
      current.zone,
      next.zone,
      baseTolerancePct,
      config.overlapMergeTolerancePct,
    );

    const tooWideIfMerged = exceedsMaxMergedWidth(
      current.zone,
      next.zone,
      config.maxMergedZoneWidthPct,
    );

    if (closeEnough && !tooWideIfMerged) {
      const representativeZone = preferZoneRepresentative(next.zone, current.zone)
        ? next.zone
        : current.zone;
      const mergedZone = {
        ...current.zone,
        zoneLow: Number(Math.min(current.zone.zoneLow, next.zone.zoneLow).toFixed(4)),
        zoneHigh: Number(Math.max(current.zone.zoneHigh, next.zone.zoneHigh).toFixed(4)),
        representativePrice: representativeZone.representativePrice,
        touchCount: Math.max(current.zone.touchCount, next.zone.touchCount),
        confluenceCount: unique([
          ...current.zone.timeframeSources,
          ...next.zone.timeframeSources,
        ]).length,
        sourceTypes: unique([...current.zone.sourceTypes, ...next.zone.sourceTypes]),
        timeframeSources: unique([
          ...current.zone.timeframeSources,
          ...next.zone.timeframeSources,
        ]),
        reactionQualityScore: Number(
          (
            (current.zone.reactionQualityScore * current.zone.sourceEvidenceCount +
              next.zone.reactionQualityScore * next.zone.sourceEvidenceCount) /
            Math.max(current.zone.sourceEvidenceCount + next.zone.sourceEvidenceCount, 1)
          ).toFixed(4),
        ),
        rejectionScore: Number(
          (
            (current.zone.rejectionScore * current.zone.sourceEvidenceCount +
              next.zone.rejectionScore * next.zone.sourceEvidenceCount) /
            Math.max(current.zone.sourceEvidenceCount + next.zone.sourceEvidenceCount, 1)
          ).toFixed(4),
        ),
        displacementScore: Number(
          (
            (current.zone.displacementScore * current.zone.sourceEvidenceCount +
              next.zone.displacementScore * next.zone.sourceEvidenceCount) /
            Math.max(current.zone.sourceEvidenceCount + next.zone.sourceEvidenceCount, 1)
          ).toFixed(4),
        ),
        sessionSignificanceScore: Number(
          Math.max(current.zone.sessionSignificanceScore, next.zone.sessionSignificanceScore).toFixed(4),
        ),
        followThroughScore: Number(
          (
            (current.zone.followThroughScore * current.zone.sourceEvidenceCount +
              next.zone.followThroughScore * next.zone.sourceEvidenceCount) /
            Math.max(current.zone.sourceEvidenceCount + next.zone.sourceEvidenceCount, 1)
          ).toFixed(4),
        ),
        gapContinuationScore: Number(
          (
            ((current.zone.gapContinuationScore ?? 0) * current.zone.sourceEvidenceCount +
              (next.zone.gapContinuationScore ?? 0) * next.zone.sourceEvidenceCount) /
            Math.max(current.zone.sourceEvidenceCount + next.zone.sourceEvidenceCount, 1)
          ).toFixed(4),
        ),
        sourceEvidenceCount: current.zone.sourceEvidenceCount + next.zone.sourceEvidenceCount,
        firstTimestamp: Math.min(current.zone.firstTimestamp, next.zone.firstTimestamp),
        lastTimestamp: Math.max(current.zone.lastTimestamp, next.zone.lastTimestamp),
        sessionDate: current.zone.sessionDate ?? next.zone.sessionDate,
        isExtension: current.zone.isExtension || next.zone.isExtension,
        freshness: zoneFreshness(Math.max(current.zone.lastTimestamp, next.zone.lastTimestamp)),
        notes: unique([...current.zone.notes, ...next.zone.notes, "Merged in second clustering pass."]),
        timeframeBias: dominantTimeframe(
          unique([...current.zone.timeframeSources, ...next.zone.timeframeSources]),
        ),
      };

      current = {
        zone: mergedZone,
        rawMembers: uniqueRawMembers([...current.rawMembers, ...next.rawMembers]),
        firstPassClusterIds: unique([
          ...current.firstPassClusterIds,
          ...next.firstPassClusterIds,
        ]),
      };
    } else {
      merged.push(current);
      current = next;
    }
  }

  merged.push(current);

  return mergeTrackedZones(symbol, kind, merged);
}

function toRawMemberDiagnostic(member: RawLevelCandidate): LevelClusterRawMemberDiagnostic {
  return {
    id: member.id,
    price: round(member.price),
    sourceType: member.sourceType,
    timeframe: member.timeframe,
  };
}

function buildHiddenDepthCandidates(params: {
  zone: FinalLevelZone;
  rawMembers: RawLevelCandidate[];
  materialPriceSpanThresholdPct: number;
}): LevelClusterHiddenDepthCandidate[] {
  return params.rawMembers
    .filter((member) => {
      const distancePct = distanceFromRepresentativePct(
        member.price,
        params.zone.representativePrice,
      );

      if (distancePct < params.materialPriceSpanThresholdPct) {
        return false;
      }

      return params.zone.kind === "support"
        ? member.price < params.zone.representativePrice
        : member.price > params.zone.representativePrice;
    })
    .map((member) => ({
      ...toRawMemberDiagnostic(member),
      distanceFromRepresentativePct: distanceFromRepresentativePct(
        member.price,
        params.zone.representativePrice,
      ),
      depthSide:
        member.price < params.zone.representativePrice
          ? "below_representative"
          : "above_representative",
    }));
}

function buildMemberDiagnostic(params: {
  tracked: TrackedLevelClusterZone;
  clusterIndex: number;
  materialPriceSpanThresholdPct: number;
}): LevelClusterMemberDiagnostic {
  const rawMembers = uniqueRawMembers(params.tracked.rawMembers);
  const rawMemberPrices = rawMembers.map((member) => round(member.price));
  const rawPriceSpan = priceSpanPct(rawMemberPrices);
  const hiddenDepthCandidates = buildHiddenDepthCandidates({
    zone: params.tracked.zone,
    rawMembers,
    materialPriceSpanThresholdPct: params.materialPriceSpanThresholdPct,
  });

  return {
    clusterId: params.tracked.zone.id,
    clusterIndex: params.clusterIndex,
    kind: params.tracked.zone.kind,
    representativePrice: round(params.tracked.zone.representativePrice),
    zoneLow: round(params.tracked.zone.zoneLow),
    zoneHigh: round(params.tracked.zone.zoneHigh),
    rawMemberMapping: "tracked_from_clusterer_diagnostics",
    rawMemberCount: rawMembers.length,
    rawMemberIds: rawMembers.map((member) => member.id),
    rawMemberPrices,
    rawMembers: rawMembers.map(toRawMemberDiagnostic),
    minRawMemberPrice:
      rawMemberPrices.length > 0 ? round(Math.min(...rawMemberPrices)) : undefined,
    maxRawMemberPrice:
      rawMemberPrices.length > 0 ? round(Math.max(...rawMemberPrices)) : undefined,
    rawPriceSpanPct: rawPriceSpan,
    sourceTypes: unique(rawMembers.map((member) => member.sourceType)).sort(),
    timeframeSources: unique(rawMembers.map((member) => member.timeframe)).sort(),
    firstPassClusterIds: [...params.tracked.firstPassClusterIds].sort(),
    mergedFirstPassClusterCount: params.tracked.firstPassClusterIds.length,
    materialPriceSpanPct: rawPriceSpan ?? 0,
    membersSpanMateriallyDifferentPrices:
      (rawPriceSpan ?? 0) >= params.materialPriceSpanThresholdPct,
    hiddenDepthCandidates,
    potentialExtensionDepthMemberIds: hiddenDepthCandidates.map((candidate) => candidate.id),
  };
}

export function clusterRawLevelCandidates(
  symbol: string,
  kind: "support" | "resistance",
  candidates: RawLevelCandidate[],
  tolerancePct: number,
  config: LevelEngineConfig,
  _referenceTimestamp?: number,
): FinalLevelZone[] {
  const filtered = candidates.filter((candidate) => candidate.kind === kind);
  const firstPassGroups = firstPassCluster(filtered, tolerancePct);
  const firstPassZones = firstPassGroups.map((group, index) =>
    buildZoneFromGroup(symbol, kind, group, index),
  );

  return secondPassMergeZones(symbol, kind, firstPassZones, config);
}

export function clusterRawLevelCandidatesWithDiagnostics(
  symbol: string,
  kind: "support" | "resistance",
  candidates: RawLevelCandidate[],
  tolerancePct: number,
  config: LevelEngineConfig,
  _referenceTimestamp?: number,
): ClusterRawLevelCandidatesWithDiagnosticsResult {
  const filtered = candidates.filter((candidate) => candidate.kind === kind);
  const firstPassGroups = firstPassCluster(filtered, tolerancePct);
  const firstPassTrackedZones = firstPassGroups.map((group, index) => ({
    zone: buildZoneFromGroup(symbol, kind, group, index),
    rawMembers: uniqueRawMembers(group),
    firstPassClusterIds: [`${symbol}-${kind}-first-pass-${index + 1}`],
  }));
  const trackedZones = secondPassMergeTrackedZones(
    symbol,
    kind,
    firstPassTrackedZones,
    config,
  );
  const materialPriceSpanThresholdPct = round(config.extensionSpacingPct * 100);

  return {
    zones: trackedZones.map((tracked) => tracked.zone),
    diagnostics: {
      symbol,
      kind,
      rawCandidateCount: candidates.length,
      filteredCandidateCount: filtered.length,
      firstPassClusterCount: firstPassGroups.length,
      finalClusterCount: trackedZones.length,
      materialPriceSpanThresholdPct,
      clusters: trackedZones.map((tracked, index) =>
        buildMemberDiagnostic({
          tracked,
          clusterIndex: index,
          materialPriceSpanThresholdPct,
        }),
      ),
      diagnostics: [
        "cluster_member_tracking_diagnostics_only",
        "normal_cluster_output_is_returned_unchanged_as_zones",
      ],
      safety: {
        diagnosticOnly: true,
        clusteringBehaviorUnchanged: true,
        normalClusterOutputUnchanged: true,
      },
    },
  };
}
