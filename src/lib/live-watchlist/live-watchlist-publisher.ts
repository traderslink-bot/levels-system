import {
  formatLevelExtensionMessage,
  formatLevelLadderMessage,
  formatLevelSnapshotMessage,
} from "../alerts/alert-router.js";
import type {
  AlertPayload,
  LevelSnapshotDisplayZone,
  LevelSnapshotPayload,
} from "../alerts/alert-types.js";
import { refreshTechnicalContextForPrice } from "../technical-context/technical-context.js";
import type { TechnicalContext } from "../technical-context/technical-context-types.js";
import { formatPotentialMoveRead } from "../monitoring/potential-move-read.js";
import { buildLiveWatchlistPullbackRead, type LiveWatchlistPullbackVolumeRead } from "./pullback-read.js";
import {
  buildLiveWatchlistTradeSetupRead,
  resolveLiveWatchlistTradeSetupReadMode,
  type LiveWatchlistTradeSetupReadMode,
} from "./trade-setup-read.js";
import {
  ArchivedLiveWatchlistPublisher,
  DEFAULT_LIVE_WATCHLIST_AUDIT_ARCHIVE_FILE,
  LiveWatchlistAuditArchivePersistence,
} from "./live-watchlist-audit-archive.js";
import type {
  LiveWatchlistExtendedQuote,
  LiveWatchlistCardContent,
  LiveWatchlistCardPatch,
  LiveWatchlistHealthPatch,
  LiveWatchlistLevelMap,
  LiveWatchlistLevelMapLevel,
  LiveWatchlistHttpPublisherOptions,
  LiveWatchlistPublisher,
  LiveWatchlistStatus,
  LiveWatchlistTickerDataPatch,
} from "./live-watchlist-types.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRY_ATTEMPTS = 1;
const DEFAULT_RETRY_DELAY_MS = 750;
const LEVEL_MAP_MAX_LEVELS_PER_SIDE = 8;
const LEVEL_MAP_FULL_CONTEXT_NEAREST_LEVELS_PER_SIDE = 6;
const LEVEL_MAP_STACKED_LEVEL_DISTANCE_PCT = 0.02;
const LEVEL_MAP_SOFT_PATH_DISTANCE_PCT = 0.3;
const LEVEL_MAP_EXTREME_GAP_SESSION_EXTENSION_PCT = 0.4;
const LEVEL_MAP_MIN_LOGICAL_BEYOND_GAP_PCT = 0.2;
const LEVEL_MAP_LOGICAL_GAP_MULTIPLIER = 2.5;
const LEVEL_MAP_ROLE_FLIP_CONFIRM_PCT = 0.0025;
const TIGHT_LEVEL_GAP_PCT = 0.03;
const WIDE_LEVEL_GAP_PCT = 0.12;
const NEARBY_TACTICAL_LEVEL_DISPLAY_MAX_DISTANCE_PCT = 0.15;
const LOW_PRICED_NEARBY_TACTICAL_LEVEL_DISPLAY_MAX_DISTANCE_PCT = 0.2;
const HIGHER_PRICED_TACTICAL_LEVEL_PRICE = 10;
const LEVEL_MAP_MAX_TACTICAL_LEVELS_PER_SIDE = 2;
const COMPANY_INFO_UNAVAILABLE_BODY = "couldn't get company info";
const EXTREME_GAP_RISK_MIN_MOVE_PCT = 1;

type LevelMapDisplayZone = Pick<
  LevelSnapshotDisplayZone,
  | "representativePrice"
  | "lowPrice"
  | "highPrice"
  | "strengthLabel"
  | "sourceLabel"
  | "freshness"
  | "marketDataProvenance"
  | "touchCount"
  | "confluenceCount"
  | "reactionQualityScore"
  | "rejectionScore"
  | "displacementScore"
  | "sessionSignificanceScore"
  | "sourceEvidenceCount"
>;

type LevelMapInputZone = LevelMapDisplayZone & {
  originalSide: "support" | "resistance";
};

type LevelMapSelectionMode = "potential_path" | "full_context" | "trade_setup";

type LevelMapRoleFlipContext = NonNullable<LevelSnapshotPayload["roleFlipContext"]>;

function appendUniqueDisplayZones(
  zones: LevelSnapshotDisplayZone[],
  additions: LevelSnapshotDisplayZone[],
): LevelSnapshotDisplayZone[] {
  const merged = [...zones];
  for (const addition of additions) {
    const duplicate = merged.some((zone) =>
      Math.abs(zone.representativePrice - addition.representativePrice) /
        Math.max(zone.representativePrice, addition.representativePrice, 0.0001) < 0.003,
    );
    if (!duplicate) {
      merged.push(addition);
    }
  }
  return merged;
}

export function buildLiveWatchlistExtremeGapRiskZones(args: {
  currentPrice: number;
  priorRegularClosePrice?: number | null;
  specialLevels?: LevelSnapshotPayload["specialLevels"];
}): LevelSnapshotDisplayZone[] {
  const priorClose = args.priorRegularClosePrice;
  if (
    typeof priorClose !== "number" ||
    !Number.isFinite(priorClose) ||
    priorClose <= 0 ||
    !Number.isFinite(args.currentPrice) ||
    args.currentPrice <= 0
  ) {
    return [];
  }

  const premarketLow = args.specialLevels?.premarketLow;
  const gapReference =
    typeof premarketLow === "number" && Number.isFinite(premarketLow) && premarketLow > 0
      ? premarketLow
      : args.currentPrice;
  const gapMovePct = (gapReference - priorClose) / priorClose;
  const currentMovePct = (args.currentPrice - priorClose) / priorClose;
  if (gapMovePct < EXTREME_GAP_RISK_MIN_MOVE_PCT && currentMovePct < EXTREME_GAP_RISK_MIN_MOVE_PCT) {
    return [];
  }

  const candidates: Array<{
    price: number | null | undefined;
    sourceLabel: string;
    strengthLabel: LevelSnapshotDisplayZone["strengthLabel"];
    freshness?: LevelSnapshotDisplayZone["freshness"];
  }> = [
    {
      price: args.specialLevels?.openingRangeLow,
      sourceLabel: "opening range low risk boundary",
      strengthLabel: "moderate",
      freshness: "fresh",
    },
    {
      price: args.specialLevels?.currentSessionLow,
      sourceLabel: "session low risk boundary",
      strengthLabel: "moderate",
      freshness: "fresh",
    },
    {
      price: premarketLow,
      sourceLabel: "premarket gap floor",
      strengthLabel: "moderate",
      freshness: "fresh",
    },
    {
      price: priorClose,
      sourceLabel: "prior-close gap origin",
      strengthLabel: "weak",
    },
  ];

  return candidates
    .filter((candidate): candidate is typeof candidate & { price: number } =>
      typeof candidate.price === "number" &&
      Number.isFinite(candidate.price) &&
      candidate.price > 0,
    )
    .sort((left, right) => right.price - left.price)
    .reduce<LevelSnapshotDisplayZone[]>((zones, candidate) => {
      const duplicate = zones.some((zone) =>
        Math.abs(zone.representativePrice - candidate.price) /
          Math.max(zone.representativePrice, candidate.price, 0.0001) < 0.003,
      );
      if (!duplicate) {
        zones.push({
          representativePrice: candidate.price,
          lowPrice: candidate.price,
          highPrice: candidate.price,
          strengthLabel: candidate.strengthLabel,
          ...(candidate.freshness ? { freshness: candidate.freshness } : {}),
          sourceLabel: candidate.sourceLabel,
          sessionSignificanceScore: 0.96,
          sourceEvidenceCount: 1,
        });
      }
      return zones;
    }, []);
}

export function buildLiveWatchlistExtremeGapResistanceZones(args: {
  currentPrice: number;
  priorRegularClosePrice?: number | null;
  specialLevels?: LevelSnapshotPayload["specialLevels"];
}): LevelSnapshotDisplayZone[] {
  if (buildLiveWatchlistExtremeGapRiskZones(args).length === 0) {
    return [];
  }

  const candidates: Array<{
    price: number | null | undefined;
    sourceLabel: string;
  }> = [
    {
      price: args.specialLevels?.openingRangeHigh,
      sourceLabel: "opening range high resistance",
    },
    {
      price: args.specialLevels?.currentSessionHigh,
      sourceLabel: "session high resistance",
    },
  ];

  return candidates
    .filter((candidate): candidate is typeof candidate & { price: number } =>
      typeof candidate.price === "number" &&
      Number.isFinite(candidate.price) &&
      candidate.price > 0,
    )
    .sort((left, right) => left.price - right.price)
    .reduce<LevelSnapshotDisplayZone[]>((zones, candidate) => {
      const duplicate = zones.some((zone) =>
        Math.abs(zone.representativePrice - candidate.price) /
          Math.max(zone.representativePrice, candidate.price, 0.0001) < 0.003,
      );
      if (!duplicate) {
        zones.push({
          representativePrice: candidate.price,
          lowPrice: candidate.price,
          highPrice: candidate.price,
          strengthLabel: "moderate",
          freshness: "fresh",
          sourceLabel: candidate.sourceLabel,
          sessionSignificanceScore: 0.96,
          sourceEvidenceCount: 1,
        });
      }
      return zones;
    }, []);
}

function inferredTickSize(price: number): number {
  return price < 1 ? 0.0001 : 0.01;
}

export function deriveRoleFlipConfirmationPct(
  currentPrice: number,
  context: LevelMapRoleFlipContext | undefined,
): number {
  const tickSize = typeof context?.tickSize === "number" && context.tickSize > 0
    ? context.tickSize
    : inferredTickSize(currentPrice);
  const spreadPct =
    typeof context?.bidPrice === "number" &&
    typeof context.askPrice === "number" &&
    context.askPrice >= context.bidPrice &&
    context.bidPrice > 0
      ? (context.askPrice - context.bidPrice) / currentPrice
      : 0;
  const atrAllowance = typeof context?.atrPct === "number" && context.atrPct > 0
    ? context.atrPct * 0.12
    : 0;
  return Math.min(
    0.03,
    Math.max(LEVEL_MAP_ROLE_FLIP_CONFIRM_PCT, spreadPct, atrAllowance, (tickSize * 2) / currentPrice),
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeSymbol(symbol: string | undefined): string {
  return symbol?.trim().toUpperCase() || "UNKNOWN";
}

function formatPrice(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "n/a";
  }
  return value >= 1 ? value.toFixed(2) : value.toFixed(4);
}

function formatLevelSourceLabel(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized.includes("intraday") || normalized.includes("5m")) {
    return "intraday";
  }
  if (normalized.includes("4h")) {
    return normalized.includes("confluence") ? "4h confluence" : "4h structure";
  }
  if (normalized.includes("daily")) {
    return normalized.includes("confluence") ? "daily confluence" : "daily structure";
  }
  return value?.trim() ?? null;
}

function strengthRank(value: LevelSnapshotDisplayZone["strengthLabel"] | undefined): number {
  if (value === "major") return 4;
  if (value === "strong") return 3;
  if (value === "moderate") return 2;
  if (value === "weak") return 1;
  return 0;
}

function formatWatchlistStrengthLabel(
  value: LevelSnapshotDisplayZone["strengthLabel"] | undefined,
): string | null {
  return value ?? null;
}

function sourceRank(value: string | null | undefined): number {
  const sourceLabel = formatLevelSourceLabel(value);
  if (sourceLabel === "daily confluence") return 5;
  if (sourceLabel === "daily structure") return 4;
  if (sourceLabel === "4h confluence") return 3;
  if (sourceLabel === "4h structure") return 2;
  if (sourceLabel === "intraday") return 1;
  return 0;
}

function zoneQualityRank(zone: {
  strengthLabel?: LevelSnapshotDisplayZone["strengthLabel"];
  sourceLabel?: string | null;
}): number {
  return strengthRank(zone.strengthLabel) * 10 + sourceRank(zone.sourceLabel);
}

function signedDistancePct(price: number, currentPrice: number): number {
  return (price - currentPrice) / Math.max(currentPrice, 0.0001);
}

function formatSignedDistance(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(1)}%`;
}

function formatPercent(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "n/a";
  }
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function buildLevelMapLevel(
  zone: LevelMapDisplayZone,
  currentPrice: number,
  side: "support" | "resistance",
  options: {
    sourceLabelOverride?: string;
    roleFlipFromSide?: "support" | "resistance" | null;
    roleFlipState?: LiveWatchlistLevelMapLevel["roleFlipState"];
  } = {},
): LiveWatchlistLevelMapLevel {
  const sourceLabel = options.sourceLabelOverride ?? formatLevelSourceLabel(zone.sourceLabel);
  const distancePct = signedDistancePct(zone.representativePrice, currentPrice);
  const parts = [
    formatSignedDistance(distancePct),
    formatWatchlistStrengthLabel(zone.strengthLabel),
    sourceLabel,
  ].filter((value): value is string => Boolean(value));
  return {
    side,
    price: zone.representativePrice,
    ...(typeof zone.lowPrice === "number" ? { lowPrice: zone.lowPrice } : {}),
    ...(typeof zone.highPrice === "number" ? { highPrice: zone.highPrice } : {}),
    distancePct,
    strengthLabel: zone.strengthLabel,
    freshness: zone.freshness,
    ...(typeof zone.touchCount === "number" ? { touchCount: zone.touchCount } : {}),
    ...(typeof zone.confluenceCount === "number" ? { confluenceCount: zone.confluenceCount } : {}),
    ...(typeof zone.reactionQualityScore === "number" ? { reactionQualityScore: zone.reactionQualityScore } : {}),
    ...(typeof zone.rejectionScore === "number" ? { rejectionScore: zone.rejectionScore } : {}),
    ...(typeof zone.displacementScore === "number" ? { displacementScore: zone.displacementScore } : {}),
    ...(typeof zone.sessionSignificanceScore === "number" ? { sessionSignificanceScore: zone.sessionSignificanceScore } : {}),
    ...(typeof zone.sourceEvidenceCount === "number" ? { sourceEvidenceCount: zone.sourceEvidenceCount } : {}),
    sourceLabel,
    ...(zone.marketDataProvenance
      ? { marketDataProvenance: { ...zone.marketDataProvenance } }
      : {}),
    roleFlipFromSide: options.roleFlipFromSide ?? null,
    roleFlipState: options.roleFlipState ?? "original",
    label: `${formatPrice(zone.representativePrice)} (${parts.join(", ")})`,
  };
}

function isStructuralLevelMapLevel(level: LiveWatchlistLevelMapLevel): boolean {
  return /daily|4h|continuation map|extension/i.test(level.sourceLabel ?? "");
}

function isNearbyTacticalLevelMapLevel(level: LiveWatchlistLevelMapLevel, currentPrice: number): boolean {
  if (isStructuralLevelMapLevel(level)) {
    return false;
  }
  const maxDistance = currentPrice >= HIGHER_PRICED_TACTICAL_LEVEL_PRICE
    ? NEARBY_TACTICAL_LEVEL_DISPLAY_MAX_DISTANCE_PCT
    : LOW_PRICED_NEARBY_TACTICAL_LEVEL_DISPLAY_MAX_DISTANCE_PCT;
  const isFreshIntraday =
    level.sourceLabel === "intraday" ||
    level.freshness === "fresh";
  return isFreshIntraday && Math.abs(level.distancePct) <= maxDistance;
}

function isExtremeGapSessionLandmark(level: Pick<LiveWatchlistLevelMapLevel, "sourceLabel">): boolean {
  return /premarket gap floor|opening range (?:low risk boundary|high resistance)|session (?:low risk boundary|high resistance)/i
    .test(level.sourceLabel ?? "");
}

function isStackedNearLevel(
  candidate: Pick<LiveWatchlistLevelMapLevel, "price">,
  existing: Pick<LiveWatchlistLevelMapLevel, "price">,
): boolean {
  const priceDistancePct =
    Math.abs(candidate.price - existing.price) /
    Math.max(Math.abs(candidate.price), Math.abs(existing.price), 0.0001);
  return priceDistancePct <= LEVEL_MAP_STACKED_LEVEL_DISTANCE_PCT;
}

function isStructuralLevelMapZone(zone: Pick<LevelSnapshotDisplayZone, "sourceLabel">): boolean {
  return sourceRank(zone.sourceLabel) >= sourceRank("4h structure");
}

function sortedLevelMapLevels(
  zones: LevelMapInputZone[],
  currentPrice: number,
  side: "support" | "resistance",
  options: {
    preferStructuralLevels?: boolean;
    roleFlipConfirmationPct: number;
    clusterTolerancePct: number;
    selectionMode?: LevelMapSelectionMode;
  },
): LiveWatchlistLevelMapLevel[] {
  const candidateZones = dedupeLevelMapZones(
    zones.filter((zone) => isLevelMapZoneOnDisplaySide(zone, currentPrice, side, options.roleFlipConfirmationPct)),
    side,
    options.clusterTolerancePct,
  );
  const levels = candidateZones
    .filter((zone) => isLevelMapZoneOnDisplaySide(zone, currentPrice, side, options.roleFlipConfirmationPct))
    .sort((left, right) =>
      side === "support"
        ? right.representativePrice - left.representativePrice
        : left.representativePrice - right.representativePrice,
    )
    .map((zone) =>
      buildLevelMapLevel(zone, currentPrice, side, {
        roleFlipFromSide: zone.originalSide === side ? null : zone.originalSide,
        roleFlipState: zone.originalSide === side
          ? isLevelMapZoneTesting(zone, currentPrice)
            ? "testing"
            : "original"
          : "confirmed",
      }),
    );
  return selectDisplayedLevelMapLevels(levels, currentPrice, options);
}

function isLevelMapZoneOnDisplaySide(
  zone: LevelMapInputZone,
  currentPrice: number,
  displaySide: "support" | "resistance",
  confirmationPct: number,
): boolean {
  const levelPrice = zone.representativePrice;
  if (zone.originalSide === displaySide) {
    return displaySide === "support"
      ? currentPrice >= levelPrice * (1 - confirmationPct)
      : currentPrice <= levelPrice * (1 + confirmationPct);
  }

  return displaySide === "support"
    ? currentPrice > levelPrice * (1 + confirmationPct)
    : currentPrice < levelPrice * (1 - confirmationPct);
}

function isLevelMapZoneTesting(zone: LevelMapInputZone, currentPrice: number): boolean {
  return zone.originalSide === "support"
    ? currentPrice < zone.representativePrice
    : currentPrice > zone.representativePrice;
}

function dedupeLevelMapZones(
  zones: LevelMapInputZone[],
  displaySide: "support" | "resistance",
  clusterTolerancePct = LEVEL_MAP_STACKED_LEVEL_DISTANCE_PCT,
): LevelMapInputZone[] {
  const selectedZones: LevelMapInputZone[] = [];
  for (const zone of zones) {
    const existingIndex = selectedZones.findIndex((existing) =>
      shouldDedupeLevelMapZone(zone, existing, displaySide, clusterTolerancePct),
    );
    if (existingIndex === -1) {
      selectedZones.push(zone);
      continue;
    }

    const existing = selectedZones[existingIndex]!;
    if (isPreferredLevelMapZone(zone, existing, displaySide)) {
      selectedZones[existingIndex] = zone;
    }
  }
  return selectedZones;
}

function shouldDedupeLevelMapZone(
  candidate: LevelMapInputZone,
  existing: LevelMapInputZone,
  displaySide: "support" | "resistance",
  clusterTolerancePct: number,
): boolean {
  if (candidate.representativePrice.toFixed(6) === existing.representativePrice.toFixed(6)) {
    return true;
  }

  const priceDistancePct =
    Math.abs(candidate.representativePrice - existing.representativePrice) /
    Math.max(Math.abs(candidate.representativePrice), Math.abs(existing.representativePrice), 0.0001);
  if (priceDistancePct > clusterTolerancePct) {
    return false;
  }

  const preferred = isPreferredLevelMapZone(candidate, existing, displaySide) ? candidate : existing;
  const weaker = preferred === candidate ? existing : candidate;
  return (
    isStructuralLevelMapZone(preferred) &&
    strengthRank(preferred.strengthLabel) >= strengthRank("strong") &&
    zoneQualityRank(preferred) > zoneQualityRank(weaker)
  );
}

function isPreferredLevelMapZone(
  candidate: LevelMapInputZone,
  existing: LevelMapInputZone,
  displaySide: "support" | "resistance",
): boolean {
  const qualityDiff = zoneQualityRank(candidate) - zoneQualityRank(existing);
  if (qualityDiff !== 0) {
    return qualityDiff > 0;
  }

  const strengthDiff = strengthRank(candidate.strengthLabel) - strengthRank(existing.strengthLabel);
  if (strengthDiff !== 0) {
    return strengthDiff > 0;
  }

  const candidateMatchesDisplaySide = candidate.originalSide === displaySide;
  const existingMatchesDisplaySide = existing.originalSide === displaySide;
  if (candidateMatchesDisplaySide !== existingMatchesDisplaySide) {
    return candidateMatchesDisplaySide;
  }

  return Boolean(candidate.sourceLabel) && !existing.sourceLabel;
}

function freshnessRank(value: LiveWatchlistLevelMapLevel["freshness"]): number {
  if (value === "fresh") return 3;
  if (value === "aging") return 2;
  if (value === "stale") return 1;
  return 0;
}

function potentialPathEvidenceRank(level: LiveWatchlistLevelMapLevel): number {
  const provenance = level.marketDataProvenance;
  if (provenance?.lastConfirmedAt !== undefined) return 3;
  if (provenance?.lastTestedAt !== undefined) return 2;
  if (provenance?.formedAt !== undefined) return 1;
  return 0;
}

function potentialPathEvidenceTimestamp(level: LiveWatchlistLevelMapLevel): number {
  const provenance = level.marketDataProvenance;
  return provenance?.lastConfirmedAt ??
    provenance?.lastTestedAt ??
    provenance?.formedAt ??
    0;
}

function isPreferredPotentialPathLevel(
  candidate: LiveWatchlistLevelMapLevel,
  incumbent: LiveWatchlistLevelMapLevel,
): boolean {
  const qualityDiff = zoneQualityRank(candidate) - zoneQualityRank(incumbent);
  if (qualityDiff !== 0) {
    return qualityDiff > 0;
  }

  const evidenceDiff = potentialPathEvidenceRank(candidate) - potentialPathEvidenceRank(incumbent);
  if (evidenceDiff !== 0) {
    return evidenceDiff > 0;
  }

  const freshnessDiff = freshnessRank(candidate.freshness) - freshnessRank(incumbent.freshness);
  if (freshnessDiff !== 0) {
    return freshnessDiff > 0;
  }

  const evidenceTimestampDiff =
    potentialPathEvidenceTimestamp(candidate) - potentialPathEvidenceTimestamp(incumbent);
  if (evidenceTimestampDiff !== 0) {
    return evidenceTimestampDiff > 0;
  }

  return Math.abs(candidate.distancePct) < Math.abs(incumbent.distancePct);
}

function clusterPotentialPathLevels(
  levels: LiveWatchlistLevelMapLevel[],
): LiveWatchlistLevelMapLevel[] {
  const selected: LiveWatchlistLevelMapLevel[] = [];
  for (const level of levels) {
    const existingIndex = selected.findIndex((existing) => isStackedNearLevel(level, existing));
    if (existingIndex === -1) {
      selected.push(level);
      continue;
    }

    const existing = selected[existingIndex]!;
    if (isPreferredPotentialPathLevel(level, existing)) {
      selected[existingIndex] = level;
    }
  }

  return selected.sort(
    (left, right) => Math.abs(left.distancePct) - Math.abs(right.distancePct),
  );
}

function lowerMedian(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) / 2)]!;
}

function isMeaningfulBeyondSoftPathLevel(level: LiveWatchlistLevelMapLevel): boolean {
  return (
    strengthRank(level.strengthLabel) >= strengthRank("strong") &&
    isStructuralLevelMapLevel(level)
  );
}

function isLogicalNextLevelBeyondSoftPath(
  inBandLevels: LiveWatchlistLevelMapLevel[],
  candidate: LiveWatchlistLevelMapLevel,
): boolean {
  const distances = inBandLevels
    .map((level) => Math.abs(level.distancePct))
    .sort((left, right) => left - right);
  const lastDistance = distances.at(-1) ?? 0;
  const normalGaps = distances
    .slice(1)
    .map((distance, index) => distance - distances[index]!);
  const allowedGap = Math.max(
    LEVEL_MAP_MIN_LOGICAL_BEYOND_GAP_PCT,
    lowerMedian(normalGaps) * LEVEL_MAP_LOGICAL_GAP_MULTIPLIER,
  );
  return Math.abs(candidate.distancePct) - lastDistance <= allowedGap;
}

function selectDisplayedLevelMapLevels(
  levels: LiveWatchlistLevelMapLevel[],
  currentPrice: number,
  options: {
    preferStructuralLevels?: boolean;
    selectionMode?: LevelMapSelectionMode;
  } = {},
): LiveWatchlistLevelMapLevel[] {
  if (levels.length === 0) {
    return levels;
  }

  if (options.preferStructuralLevels) {
    const structuralLevels = levels.filter(isStructuralLevelMapLevel);
    if (structuralLevels.length > 0) {
      const nearbyTacticalLevels = levels
        .filter((level) =>
          isNearbyTacticalLevelMapLevel(level, currentPrice) &&
          !isExtremeGapSessionLandmark(level) &&
          !structuralLevels.some((structuralLevel) => isStackedNearLevel(level, structuralLevel)),
        )
        .slice(0, LEVEL_MAP_MAX_TACTICAL_LEVELS_PER_SIDE);
      const extremeGapSessionLandmarks = levels.filter((level) =>
        isExtremeGapSessionLandmark(level) &&
        !structuralLevels.some((structuralLevel) => isStackedNearLevel(level, structuralLevel)),
      );
      const preferredLevels = levels.filter((level) =>
        structuralLevels.includes(level) ||
        nearbyTacticalLevels.includes(level) ||
        extremeGapSessionLandmarks.includes(level),
      );
      return selectDisplayedLevelMapLevels(preferredLevels, currentPrice, {
        selectionMode: options.selectionMode,
      });
    }
  }

  if (options.selectionMode === "full_context" || options.selectionMode === "trade_setup") {
    const nearestLevels = levels.slice(0, LEVEL_MAP_FULL_CONTEXT_NEAREST_LEVELS_PER_SIDE);
    const deeperStructuralLevels = levels
      .slice(LEVEL_MAP_FULL_CONTEXT_NEAREST_LEVELS_PER_SIDE)
      .filter(isMeaningfulBeyondSoftPathLevel);
    for (const anchor of [deeperStructuralLevels[0], deeperStructuralLevels.at(-1)]) {
      if (
        anchor &&
        nearestLevels.length < LEVEL_MAP_MAX_LEVELS_PER_SIDE &&
        !nearestLevels.some((level) => isSameDisplayedLevelPrice(level, anchor))
      ) {
        nearestLevels.push(anchor);
      }
    }
    return nearestLevels.sort(
      (left, right) => Math.abs(left.distancePct) - Math.abs(right.distancePct),
    );
  }

  const clusteredLevels = clusterPotentialPathLevels(levels);
  const inBandLevels = clusteredLevels.filter(
    (level) =>
      Math.abs(level.distancePct) <= LEVEL_MAP_SOFT_PATH_DISTANCE_PCT ||
      (
        isExtremeGapSessionLandmark(level) &&
        Math.abs(level.distancePct) <= LEVEL_MAP_EXTREME_GAP_SESSION_EXTENSION_PCT
      ),
  );

  // A real price vacuum is still useful context: when nothing exists inside the
  // soft band, keep the nearest mapped level and one additional meaningful
  // checkpoint so the Potential Path does not collapse to a single row.
  if (inBandLevels.length === 0) {
    const nearest = clusteredLevels[0];
    if (!nearest) {
      return [];
    }
    const remainingLevels = clusteredLevels.slice(1);
    const nextCheckpoint =
      remainingLevels.find(isMeaningfulBeyondSoftPathLevel) ??
      remainingLevels.find(isStructuralLevelMapLevel) ??
      remainingLevels[0];
    return nextCheckpoint ? [nearest, nextCheckpoint] : [nearest];
  }

  const nextMeaningfulBeyond = clusteredLevels.find(
    (level) =>
      Math.abs(level.distancePct) > LEVEL_MAP_SOFT_PATH_DISTANCE_PCT &&
      isMeaningfulBeyondSoftPathLevel(level),
  );
  const hasMeaningfulStructuralCoverageInBand = inBandLevels.some(
    isMeaningfulBeyondSoftPathLevel,
  );
  if (
    nextMeaningfulBeyond &&
    (
      !hasMeaningfulStructuralCoverageInBand ||
      isLogicalNextLevelBeyondSoftPath(inBandLevels, nextMeaningfulBeyond)
    )
  ) {
    const selected = inBandLevels.slice(0, LEVEL_MAP_MAX_LEVELS_PER_SIDE - 1);
    selected.push(nextMeaningfulBeyond);
    return selected.sort(
      (left, right) => Math.abs(left.distancePct) - Math.abs(right.distancePct),
    );
  }

  return inBandLevels.slice(0, LEVEL_MAP_MAX_LEVELS_PER_SIDE).sort(
    (left, right) => Math.abs(left.distancePct) - Math.abs(right.distancePct),
  );
}

function isSameDisplayedLevelPrice(
  left: LiveWatchlistLevelMapLevel,
  right: LiveWatchlistLevelMapLevel,
): boolean {
  return left.price.toFixed(6) === right.price.toFixed(6);
}

function removeCrossSideDuplicateLevelMapLevels(
  supportLevels: LiveWatchlistLevelMapLevel[],
  resistanceLevels: LiveWatchlistLevelMapLevel[],
  currentPrice: number,
): {
  supportLevels: LiveWatchlistLevelMapLevel[];
  resistanceLevels: LiveWatchlistLevelMapLevel[];
} {
  const supportIndexesToRemove = new Set<number>();
  const resistanceIndexesToRemove = new Set<number>();

  supportLevels.forEach((support, supportIndex) => {
    resistanceLevels.forEach((resistance, resistanceIndex) => {
      if (!isSameDisplayedLevelPrice(support, resistance)) {
        return;
      }
      if (support.price > currentPrice) {
        supportIndexesToRemove.add(supportIndex);
      } else {
        resistanceIndexesToRemove.add(resistanceIndex);
      }
    });
  });

  return {
    supportLevels: supportLevels.filter((_, index) => !supportIndexesToRemove.has(index)),
    resistanceLevels: resistanceLevels.filter((_, index) => !resistanceIndexesToRemove.has(index)),
  };
}

function deriveRangeState(
  currentPrice: number,
  nearestSupport: LiveWatchlistLevelMapLevel | null,
  nearestResistance: LiveWatchlistLevelMapLevel | null,
): LiveWatchlistLevelMap["rangeState"] {
  if (!nearestSupport || !nearestResistance) {
    return "normal";
  }
  const gapPct = (nearestResistance.price - nearestSupport.price) / Math.max(currentPrice, 0.0001);
  if (gapPct <= TIGHT_LEVEL_GAP_PCT) {
    return "tight";
  }
  if (gapPct >= WIDE_LEVEL_GAP_PCT) {
    return "wide";
  }
  return "normal";
}

export function buildLiveWatchlistLevelMap(args: {
  currentPrice: number;
  supportZones: LevelMapDisplayZone[];
  resistanceZones: LevelMapDisplayZone[];
  preferStructuralLevels?: boolean;
  specialLevels?: LevelSnapshotPayload["specialLevels"];
  technicalContext?: TechnicalContext | null;
  dataQuality?: LevelSnapshotPayload["levelDataQuality"];
  roleFlipContext?: LevelSnapshotPayload["roleFlipContext"];
  selectionMode?: LevelMapSelectionMode;
  priorRegularClosePrice?: number | null;
}): LiveWatchlistLevelMap | null {
  if (!Number.isFinite(args.currentPrice) || args.currentPrice <= 0) {
    return null;
  }
  const gapRiskZones = buildLiveWatchlistExtremeGapRiskZones({
    currentPrice: args.currentPrice,
    priorRegularClosePrice: args.priorRegularClosePrice,
    specialLevels: args.specialLevels,
  });
  const gapResistanceZones = buildLiveWatchlistExtremeGapResistanceZones({
    currentPrice: args.currentPrice,
    priorRegularClosePrice: args.priorRegularClosePrice,
    specialLevels: args.specialLevels,
  });
  const zones = [
    ...appendUniqueDisplayZones(args.supportZones, gapRiskZones)
      .map((zone): LevelMapInputZone => ({ ...zone, originalSide: "support" })),
    ...appendUniqueDisplayZones(args.resistanceZones, gapResistanceZones)
      .map((zone): LevelMapInputZone => ({ ...zone, originalSide: "resistance" })),
  ];
  const roleFlipConfirmationPct = deriveRoleFlipConfirmationPct(args.currentPrice, args.roleFlipContext);
  const levelOptions = {
    preferStructuralLevels: args.preferStructuralLevels,
    selectionMode: args.selectionMode,
    roleFlipConfirmationPct,
    clusterTolerancePct: args.selectionMode === "trade_setup"
      ? 0
      : Math.min(
          0.035,
          Math.max(LEVEL_MAP_STACKED_LEVEL_DISTANCE_PCT, roleFlipConfirmationPct * 1.5),
        ),
  };
  const rawSupportLevels = sortedLevelMapLevels(zones, args.currentPrice, "support", levelOptions);
  const rawResistanceLevels = sortedLevelMapLevels(zones, args.currentPrice, "resistance", levelOptions);
  const { supportLevels, resistanceLevels } = removeCrossSideDuplicateLevelMapLevels(
    rawSupportLevels,
    rawResistanceLevels,
    args.currentPrice,
  );
  const nearestSupport = supportLevels[0] ?? null;
  const nearestResistance = resistanceLevels[0] ?? null;
  const nextStrongSupport = supportLevels.find(
    (level) => level !== nearestSupport && strengthRank(level.strengthLabel) >= strengthRank("strong"),
  ) ?? null;
  const nextStrongResistance = resistanceLevels.find(
    (level) => level !== nearestResistance && strengthRank(level.strengthLabel) >= strengthRank("strong"),
  ) ?? null;
  const referenceLevels = buildLiveWatchlistReferenceLevels(args.specialLevels, args.technicalContext);
  const rangeState = deriveRangeState(args.currentPrice, nearestSupport, nearestResistance);

  return {
    currentPrice: args.currentPrice,
    rangeState,
    nearestSupport,
    nearestResistance,
    nextStrongSupport,
    nextStrongResistance,
    supportLevels,
    resistanceLevels,
    roleFlipConfirmationPct,
    tradePlan: {
      needsToHold: nearestSupport,
      failureBelow: supportLevels[1] ?? nextStrongSupport,
      mustClear: nearestResistance,
      targets: resistanceLevels.slice(1, 3),
      openAir: nearestResistance === null || rangeState === "wide",
    },
    ...(args.dataQuality ? { dataQuality: args.dataQuality } : {}),
    ...(referenceLevels.length > 0 ? { referenceLevels } : {}),
  };
}

function buildLiveWatchlistReferenceLevels(
  specialLevels: LevelSnapshotPayload["specialLevels"],
  technicalContext: TechnicalContext | null | undefined,
): NonNullable<LiveWatchlistLevelMap["referenceLevels"]> {
  const references: NonNullable<LiveWatchlistLevelMap["referenceLevels"]> = [];
  const add = (
    key: NonNullable<LiveWatchlistLevelMap["referenceLevels"]>[number]["key"],
    label: string,
    price: number | null | undefined,
    kind: "session" | "dynamic" = "session",
  ): void => {
    if (typeof price === "number" && Number.isFinite(price) && price > 0) {
      references.push({ key, label, price, kind });
    }
  };
  add("pmh", "PMH", specialLevels?.premarketHigh);
  add("pml", "PML", specialLevels?.premarketLow);
  add("orh", "ORH", specialLevels?.openingRangeHigh);
  add("orl", "ORL", specialLevels?.openingRangeLow);
  add("hod", "HOD", specialLevels?.currentSessionHigh);
  add("lod", "LOD", specialLevels?.currentSessionLow);
  add("pdh", "PDH", specialLevels?.previousDayHigh);
  add("pdl", "PDL", specialLevels?.previousDayLow);
  add("pdc", "PDC", specialLevels?.previousDayClose);
  add("vwap", "VWAP", technicalContext?.vwap, "dynamic");
  return references;
}

function formatPotentialPathLevelsCardBody(levelMap: LiveWatchlistLevelMap): string {
  const supportPath = levelMap.supportLevels.length > 0
    ? levelMap.supportLevels.map((level) => `- ${level.label}`).join("\n")
    : "- No mapped support available";
  const resistancePath = levelMap.resistanceLevels.length > 0
    ? levelMap.resistanceLevels.map((level) => `- ${level.label}`).join("\n")
    : "- No mapped resistance available";
  return `Support path:\n${supportPath}\n\nResistance path:\n${resistancePath}`;
}

function levelMapLevelToSnapshotZone(level: LiveWatchlistLevelMapLevel): LevelSnapshotDisplayZone {
  return {
    representativePrice: level.price,
    lowPrice: level.lowPrice,
    highPrice: level.highPrice,
    strengthLabel: level.strengthLabel,
    freshness: level.freshness,
    ...(typeof level.touchCount === "number" ? { touchCount: level.touchCount } : {}),
    ...(typeof level.confluenceCount === "number" ? { confluenceCount: level.confluenceCount } : {}),
    ...(typeof level.reactionQualityScore === "number" ? { reactionQualityScore: level.reactionQualityScore } : {}),
    ...(typeof level.rejectionScore === "number" ? { rejectionScore: level.rejectionScore } : {}),
    ...(typeof level.displacementScore === "number" ? { displacementScore: level.displacementScore } : {}),
    ...(typeof level.sessionSignificanceScore === "number" ? { sessionSignificanceScore: level.sessionSignificanceScore } : {}),
    ...(typeof level.sourceEvidenceCount === "number" ? { sourceEvidenceCount: level.sourceEvidenceCount } : {}),
    sourceLabel: level.sourceLabel ?? undefined,
    ...(level.marketDataProvenance
      ? { marketDataProvenance: { ...level.marketDataProvenance } }
      : {}),
  };
}

function buildLevelMapTraderReadPayload(
  payload: LevelSnapshotPayload,
  levelMap: LiveWatchlistLevelMap | null,
): LevelSnapshotPayload {
  if (!levelMap) {
    return payload;
  }

  const {
    ladderSupportZones: _ladderSupportZones,
    ladderResistanceZones: _ladderResistanceZones,
    ...basePayload
  } = payload;

  return {
    ...basePayload,
    supportZones: levelMap.supportLevels.map(levelMapLevelToSnapshotZone),
    resistanceZones: levelMap.resistanceLevels.map(levelMapLevelToSnapshotZone),
  };
}

function parseStockContextLine(body: string, label: string): string | null {
  const prefix = `${label}:`;
  const line = body.split("\n").find((item) => item.startsWith(prefix));
  return line ? line.slice(prefix.length).trim() || null : null;
}

function isHighRiskCountry(country: string | null): boolean {
  const normalized = country?.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized === "china" ||
    normalized === "cn" ||
    normalized === "singapore" ||
    normalized === "sg" ||
    normalized === "israel" ||
    normalized === "il"
  );
}

function formatStockContextBodyForWebsite(body: string, country: string | null): string {
  const cleanedBody = body
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => !/^Current price:/i.test(line.trim()))
    .filter((line) => !/^Levels are loading\.?$/i.test(line.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!country || !isHighRiskCountry(country)) {
    return cleanedBody;
  }
  return cleanedBody.replace(
    /^Country:\s*(.+)$/im,
    (_line, value: string) => `Country: ${value.trim()} (High Risk Country)`,
  );
}

function hasUsableCompanyInfo(body: string, symbol: string, company: string): boolean {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const normalizedCompany = company.trim().toUpperCase();
  if (normalizedCompany && normalizedCompany !== normalizedSymbol) {
    return true;
  }

  return [
    "Exchange",
    "Industry",
    "Country",
    "Website",
    "Market cap",
    "Shares outstanding",
  ].some((label) => Boolean(parseStockContextLine(body, label)));
}

function extractSection(body: string, startHeading: string, endHeadings: string[]): string | null {
  const normalized = body.replace(/\r\n/g, "\n");
  const startPattern = new RegExp(`^${startHeading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*$`, "im");
  const startMatch = normalized.match(startPattern);
  if (!startMatch || startMatch.index === undefined) {
    return null;
  }

  const startIndex = startMatch.index + startMatch[0].length;
  const rest = normalized.slice(startIndex);
  const endIndexes = endHeadings
    .map((heading) => {
      const pattern = new RegExp(`\\n${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*`, "i");
      const match = rest.match(pattern);
      return match?.index ?? -1;
    })
    .filter((index) => index >= 0);
  const endIndex = endIndexes.length > 0 ? Math.min(...endIndexes) : rest.length;
  const section = rest.slice(0, endIndex).trim();
  return section || null;
}

function removeLeadingTitleLine(body: string, title: string): string {
  const normalizedTitle = title.trim().toLowerCase();
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim().toLowerCase() === normalizedTitle) {
    return lines.slice(1).join("\n").trim();
  }
  return body.trim();
}

function cleanFullLadderBody(body: string, title: string): string {
  let section = "";
  const displayedPricesBySection = new Set<string>();
  return removeLeadingTitleLine(body, title)
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (/^(Support|Resistance):$/i.test(trimmed)) {
        section = trimmed.toLowerCase();
        return true;
      }
      if (/^Price:\s*/i.test(trimmed)) {
        return false;
      }
      const displayedPrice = trimmed.match(/^([0-9]+(?:\.[0-9]+)?(?:\s*[-–]\s*[0-9]+(?:\.[0-9]+)?)?)\s+\(/)?.[1];
      if (!displayedPrice || !section) {
        return true;
      }
      const key = `${section}:${displayedPrice.replace(/\s+/g, "")}`;
      if (displayedPricesBySection.has(key)) {
        return false;
      }
      displayedPricesBySection.add(key);
      return true;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function deriveTraderReadHeadline(body: string): string | null {
  const line = body
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((item) => item.trim())
    .find(Boolean);
  if (!line) {
    return null;
  }
  return line.length > 140 ? `${line.slice(0, 137).trimEnd()}...` : line;
}

function formatLiveTraderReadBody(args: {
  baseRead: string;
  pullbackRead: ReturnType<typeof buildLiveWatchlistPullbackRead>;
  baseReadKind: "chart_thesis" | "level_read";
}): string {
  if (!args.pullbackRead) {
    return args.baseRead;
  }
  const baseRead = args.baseRead.trim();
  if (!baseRead) {
    return args.pullbackRead.body;
  }
  if (args.baseReadKind === "chart_thesis") {
    return `${baseRead}\n\nPullback / Tape Read:\n${args.pullbackRead.body}`;
  }
  return args.pullbackRead.body;
}

function buildCard(args: {
  title: string;
  body: string;
  updatedAt: number;
  priceWhenPosted?: number | null;
  source: string;
  metadata?: Record<string, string | number | boolean | null>;
}): LiveWatchlistCardContent {
  return {
    title: args.title,
    body: args.body,
    updatedAt: args.updatedAt,
    priceWhenPosted: args.priceWhenPosted ?? null,
    source: args.source,
    ...(args.metadata ? { metadata: args.metadata } : {}),
  };
}

function formatTechnicalContextLevelsLine(context: TechnicalContext): string {
  return [
    `VWAP ${formatPrice(context.vwap)} (${formatPercent(context.priceVsVwapPct)})`,
    `EMA9 ${formatPrice(context.ema9)} (${formatPercent(context.priceVsEma9Pct)})`,
    `EMA20 ${formatPrice(context.ema20)} (${formatPercent(context.priceVsEma20Pct)})`,
  ].join(" | ");
}

function formatEmaExplanation(context: TechnicalContext): string {
  if (context.ema9 === null || context.ema20 === null || context.aboveEma9 === null || context.aboveEma20 === null) {
    return "EMA read: not enough intraday candles yet to calculate EMA9 and EMA20 cleanly.";
  }

  if (context.aboveEma9 && context.aboveEma20) {
    return "EMA read: bullish short-term posture. Price is above EMA9 and EMA20.";
  }

  if (!context.aboveEma9 && !context.aboveEma20) {
    return "EMA read: bearish short-term posture. Price is below EMA9 and EMA20.";
  }

  return context.aboveEma9
    ? "EMA read: mixed but improving. Price is above EMA9 but still below EMA20."
    : "EMA read: mixed and cooling. Price is below EMA9 but still above EMA20.";
}

function formatVwapExplanation(context: TechnicalContext): string {
  if (context.vwap === null || context.aboveVwap === null) {
    return "VWAP read: not enough usable volume-bearing candles yet to calculate VWAP cleanly.";
  }

  const relation = context.aboveVwap ? "above" : "below";
  const posture = context.aboveVwap ? "bullish intraday posture" : "bearish intraday posture";
  return `VWAP read: ${posture}. Price is ${formatPercent(context.priceVsVwapPct)} ${relation} VWAP.`;
}

function formatTechnicalContextBody(context: TechnicalContext): string {
  return [
    `Levels: ${formatTechnicalContextLevelsLine(context)}.`,
    formatEmaExplanation(context),
    formatVwapExplanation(context),
  ].join("\n");
}

function isTechnicalContextDisplayReady(context: TechnicalContext): boolean {
  return (
    context.confidence !== "unavailable" &&
    context.vwap !== null &&
    context.ema9 !== null &&
    context.ema20 !== null &&
    context.aboveVwap !== null &&
    context.aboveEma9 !== null &&
    context.aboveEma20 !== null
  );
}

export function buildLiveWatchlistTechnicalContextPatch(args: {
  symbol: string;
  timestamp: number;
  currentPrice: number;
  technicalContext: TechnicalContext | null | undefined;
}): LiveWatchlistCardPatch | null {
  if (!args.technicalContext) {
    return null;
  }
  const context = refreshTechnicalContextForPrice(args.technicalContext, args.currentPrice);
  if (!isTechnicalContextDisplayReady(context)) {
    return {
      symbol: normalizeSymbol(args.symbol),
      status: "live",
      updatedAt: args.timestamp,
      cards: {
        technicalContext: null,
      },
    };
  }

  return {
    symbol: normalizeSymbol(args.symbol),
    status: "live",
    updatedAt: args.timestamp,
    cards: {
      technicalContext: buildCard({
        title: "Technical Context",
        body: formatTechnicalContextBody(context),
        updatedAt: args.timestamp,
        priceWhenPosted: context.currentPrice,
        source: "levels_system_intraday",
        metadata: {
          confidence: context.confidence,
          provider: context.provider,
          sourceTimeframe: context.sourceTimeframe,
          candleCount: context.candleCount,
          vwap: context.vwap,
          ema9: context.ema9,
          ema20: context.ema20,
          priceVsVwapPct: context.priceVsVwapPct,
          priceVsEma9Pct: context.priceVsEma9Pct,
          priceVsEma20Pct: context.priceVsEma20Pct,
          aboveVwap: context.aboveVwap,
          aboveEma9: context.aboveEma9,
          aboveEma20: context.aboveEma20,
          sessionDate: context.sessionDate,
          latestCandleAt: context.updatedAt,
        },
      }),
    },
  };
}

export function buildLiveWatchlistLevelsUnavailablePatch(args: {
  symbol: string;
  timestamp: number;
  currentPrice?: number | null;
}): LiveWatchlistCardPatch {
  return {
    symbol: normalizeSymbol(args.symbol),
    status: "live",
    updatedAt: args.timestamp,
    levelMap: null,
    cards: {
      fullLadder: null,
      nearestSupportResistance: buildCard({
        title: "Potential Path Levels",
        body: "Levels are temporarily unavailable because no usable candle history was returned. Do not treat the map as open air; confirm the chart manually before planning the trade.",
        updatedAt: args.timestamp,
        priceWhenPosted: args.currentPrice ?? null,
        source: "level_data_unavailable",
        metadata: {
          dataQualityStatus: "unavailable",
        },
      }),
    },
  };
}

export function buildLiveWatchlistSnapshotPatch(
  payload: LevelSnapshotPayload,
  options: {
    pullbackReadEnabled?: boolean;
    tradeSetupReadMode?: LiveWatchlistTradeSetupReadMode;
  } = {},
): LiveWatchlistCardPatch {
  const updatedAt = payload.timestamp;
  const gapRiskZones = buildLiveWatchlistExtremeGapRiskZones({
    currentPrice: payload.currentPrice,
    priorRegularClosePrice: payload.priorRegularClosePrice,
    specialLevels: payload.specialLevels,
  });
  const gapResistanceZones = buildLiveWatchlistExtremeGapResistanceZones({
    currentPrice: payload.currentPrice,
    priorRegularClosePrice: payload.priorRegularClosePrice,
    specialLevels: payload.specialLevels,
  });
  const closestSupportZones = payload.ladderSupportZones ?? payload.supportZones;
  const closestResistanceZones = payload.ladderResistanceZones ?? payload.resistanceZones;
  const levelMap = buildLiveWatchlistLevelMap({
    currentPrice: payload.currentPrice,
    supportZones: closestSupportZones,
    resistanceZones: closestResistanceZones,
    preferStructuralLevels: true,
    specialLevels: payload.specialLevels,
    technicalContext: payload.technicalContext,
    dataQuality: payload.levelDataQuality,
    roleFlipContext: payload.roleFlipContext,
    priorRegularClosePrice: payload.priorRegularClosePrice,
  });
  const traderReadLevelMap = buildLiveWatchlistLevelMap({
    currentPrice: payload.currentPrice,
    supportZones: closestSupportZones,
    resistanceZones: closestResistanceZones,
    preferStructuralLevels: true,
    specialLevels: payload.specialLevels,
    technicalContext: payload.technicalContext,
    dataQuality: payload.levelDataQuality,
    roleFlipContext: payload.roleFlipContext,
    selectionMode: "full_context",
    priorRegularClosePrice: payload.priorRegularClosePrice,
  });
  const tradeSetupLevelMap = buildLiveWatchlistLevelMap({
    currentPrice: payload.currentPrice,
    supportZones: closestSupportZones,
    resistanceZones: closestResistanceZones,
    preferStructuralLevels: true,
    specialLevels: payload.specialLevels,
    technicalContext: payload.technicalContext,
    dataQuality: payload.levelDataQuality,
    roleFlipContext: payload.roleFlipContext,
    selectionMode: "trade_setup",
    priorRegularClosePrice: payload.priorRegularClosePrice,
  });
  const ladder = formatLevelLadderMessage({
    ...payload,
    supportZones: appendUniqueDisplayZones(
      appendUniqueDisplayZones(
        payload.supportZones,
        gapRiskZones.filter((zone) => zone.representativePrice <= payload.currentPrice),
      ),
      gapResistanceZones.filter((zone) => zone.representativePrice <= payload.currentPrice),
    ),
    ladderSupportZones: appendUniqueDisplayZones(
      appendUniqueDisplayZones(
        closestSupportZones,
        gapRiskZones.filter((zone) => zone.representativePrice <= payload.currentPrice),
      ),
      gapResistanceZones.filter((zone) => zone.representativePrice <= payload.currentPrice),
    ),
    ladderResistanceZones: appendUniqueDisplayZones(
      appendUniqueDisplayZones(
        closestResistanceZones,
        gapRiskZones.filter((zone) => zone.representativePrice > payload.currentPrice),
      ),
      gapResistanceZones.filter((zone) => zone.representativePrice > payload.currentPrice),
    ),
  });
  const ladderTitle = `${payload.symbol} full level ladder`;
  const snapshotMessage = formatLevelSnapshotMessage(payload);
  const traderReadSnapshotMessage = formatLevelSnapshotMessage(
    buildLevelMapTraderReadPayload(payload, traderReadLevelMap),
  );
  const marketStructure = extractSection(snapshotMessage, "Market structure", [
    "Trade map",
    "Closest levels to watch",
    "More support and resistance",
  ]);
  const tradeMapRead = extractSection(traderReadSnapshotMessage, "Trade map", [
    "Closest levels to watch",
    "More support and resistance",
  ]);
  const potentialMoveRead = formatPotentialMoveRead(payload.potentialMoveRead).join("\n").trim();
  const liveTraderRead = potentialMoveRead || tradeMapRead || snapshotMessage;
  const liveTraderReadKind = potentialMoveRead ? "chart_thesis" : "level_read";
  const technicalContext = payload.technicalContext
    ? refreshTechnicalContextForPrice(payload.technicalContext, payload.currentPrice)
    : null;
  const pullbackRead = options.pullbackReadEnabled !== false
    ? buildLiveWatchlistPullbackRead({
        symbol: payload.symbol,
        currentPrice: payload.currentPrice,
        levelMap: traderReadLevelMap,
        technicalContext,
        priorRegularClosePrice: payload.priorRegularClosePrice,
      })
    : null;
  const fallbackTraderReadBody = formatLiveTraderReadBody({
    baseRead: liveTraderRead,
    pullbackRead,
    baseReadKind: liveTraderReadKind,
  });
  const tradeSetupReadMode = options.tradeSetupReadMode ?? resolveLiveWatchlistTradeSetupReadMode();
  const tradeSetupThesis = tradeSetupReadMode === "observe"
    ? payload.tradeSetupThesisRead ?? payload.potentialMoveRead
    : payload.potentialMoveRead;
  const tradeSetupThesisSource =
    tradeSetupReadMode === "observe" && payload.tradeSetupThesisRead
      ? "v2_observation"
      : "legacy";
  const tradeSetupRead = tradeSetupReadMode === "off"
    ? null
    : buildLiveWatchlistTradeSetupRead({
        symbol: payload.symbol,
        currentPrice: payload.currentPrice,
        evaluatedAt: updatedAt,
        thesis: tradeSetupThesis,
        levelMap: tradeSetupLevelMap,
        technicalContext,
        marketStructure: payload.marketStructure,
        bidPrice: payload.roleFlipContext?.bidPrice,
        askPrice: payload.roleFlipContext?.askPrice,
      });
  const liveTraderReadBody = tradeSetupReadMode === "active" && tradeSetupRead
    ? tradeSetupRead.body
    : fallbackTraderReadBody;

  return {
    symbol: normalizeSymbol(payload.symbol),
    status: "live",
    updatedAt,
    levelMap,
    cards: {
      levelMap: null,
      fullLadder: ladder
        ? buildCard({
            title: ladderTitle,
            body: cleanFullLadderBody(ladder, ladderTitle),
            updatedAt,
            priceWhenPosted: payload.currentPrice,
            source: "level_snapshot",
          })
        : null,
      nearestSupportResistance: levelMap
        ? buildCard({
            title: "Potential Path Levels",
            body: formatPotentialPathLevelsCardBody(levelMap),
            updatedAt,
            priceWhenPosted: payload.currentPrice,
            source: "level_snapshot",
            metadata: {
              nearestSupport: levelMap.nearestSupport?.price ?? null,
              nearestSupportDistancePct: levelMap.nearestSupport?.distancePct ?? null,
              nearestSupportLabel: levelMap.nearestSupport?.label ?? null,
              nearestResistance: levelMap.nearestResistance?.price ?? null,
              nearestResistanceDistancePct: levelMap.nearestResistance?.distancePct ?? null,
              nearestResistanceLabel: levelMap.nearestResistance?.label ?? null,
              supportCount: closestSupportZones.length,
              resistanceCount: closestResistanceZones.length,
            },
          })
        : null,
      liveTraderRead: buildCard({
        title: "Live Trader Read",
        body: liveTraderReadBody,
        updatedAt,
        priceWhenPosted: payload.currentPrice,
        source: tradeSetupReadMode === "active" && tradeSetupRead
          ? "trade_setup_read"
          : "level_snapshot",
        metadata: {
          headline: deriveTraderReadHeadline(liveTraderReadBody),
          ...(pullbackRead?.metadata ?? {}),
          ...(tradeSetupRead
            ? {
                tradeSetupReadMode,
                tradeSetupThesisSource,
                ...tradeSetupRead.metadata,
              }
            : {}),
        },
      }),
      marketStructure: marketStructure
        ? buildCard({
            title: "Market Structure",
            body: marketStructure,
            updatedAt,
            priceWhenPosted: payload.currentPrice,
            source: "level_snapshot",
          })
        : null,
      technicalContext: buildLiveWatchlistTechnicalContextPatch({
        symbol: payload.symbol,
          timestamp: updatedAt,
          currentPrice: payload.currentPrice,
          technicalContext,
        })?.cards.technicalContext ?? null,
    },
  };
}

export function buildLiveWatchlistPullbackReadPatch(args: {
  symbol: string;
  timestamp: number;
  currentPrice: number;
  supportZones: LevelMapDisplayZone[];
  resistanceZones: LevelMapDisplayZone[];
  technicalContext: TechnicalContext | null | undefined;
  volumeRead?: LiveWatchlistPullbackVolumeRead | null;
  specialLevels?: LevelSnapshotPayload["specialLevels"];
  dataQuality?: LevelSnapshotPayload["levelDataQuality"];
  roleFlipContext?: LevelSnapshotPayload["roleFlipContext"];
  potentialMoveRead?: LevelSnapshotPayload["potentialMoveRead"];
  tradeSetupThesisRead?: LevelSnapshotPayload["tradeSetupThesisRead"];
  marketStructure?: LevelSnapshotPayload["marketStructure"];
  tradeSetupReadMode?: LiveWatchlistTradeSetupReadMode;
  pullbackReadEnabled?: boolean;
  priorRegularClosePrice?: number | null;
}): LiveWatchlistCardPatch | null {
  const levelMap = buildLiveWatchlistLevelMap({
    currentPrice: args.currentPrice,
    supportZones: args.supportZones,
    resistanceZones: args.resistanceZones,
    preferStructuralLevels: true,
    specialLevels: args.specialLevels,
    technicalContext: args.technicalContext,
    dataQuality: args.dataQuality,
    roleFlipContext: args.roleFlipContext,
    priorRegularClosePrice: args.priorRegularClosePrice,
  });
  const technicalContext = args.technicalContext
    ? refreshTechnicalContextForPrice(args.technicalContext, args.currentPrice)
    : null;
  const tradeSetupLevelMap = buildLiveWatchlistLevelMap({
    currentPrice: args.currentPrice,
    supportZones: args.supportZones,
    resistanceZones: args.resistanceZones,
    preferStructuralLevels: true,
    specialLevels: args.specialLevels,
    technicalContext: args.technicalContext,
    dataQuality: args.dataQuality,
    roleFlipContext: args.roleFlipContext,
    selectionMode: "trade_setup",
    priorRegularClosePrice: args.priorRegularClosePrice,
  });
  const pullbackRead = args.pullbackReadEnabled === false
    ? null
    : buildLiveWatchlistPullbackRead({
        symbol: args.symbol,
        currentPrice: args.currentPrice,
        levelMap,
        technicalContext,
        volumeRead: args.volumeRead,
        priorRegularClosePrice: args.priorRegularClosePrice,
      });
  const tradeSetupReadMode = args.tradeSetupReadMode ?? resolveLiveWatchlistTradeSetupReadMode();
  const tradeSetupThesis = tradeSetupReadMode === "observe"
    ? args.tradeSetupThesisRead ?? args.potentialMoveRead
    : args.potentialMoveRead;
  const tradeSetupThesisSource =
    tradeSetupReadMode === "observe" && args.tradeSetupThesisRead
      ? "v2_observation"
      : "legacy";
  const tradeSetupRead = tradeSetupReadMode === "off"
    ? null
    : buildLiveWatchlistTradeSetupRead({
        symbol: args.symbol,
        currentPrice: args.currentPrice,
        evaluatedAt: args.timestamp,
        thesis: tradeSetupThesis,
        levelMap: tradeSetupLevelMap,
        technicalContext,
        marketStructure: args.marketStructure,
        volumeRead: args.volumeRead,
        bidPrice: args.roleFlipContext?.bidPrice,
        askPrice: args.roleFlipContext?.askPrice,
      });
  if (!pullbackRead && !(tradeSetupReadMode === "active" && tradeSetupRead)) {
    return null;
  }
  const body = tradeSetupReadMode === "active" && tradeSetupRead
    ? tradeSetupRead.body
    : pullbackRead!.body;

  return {
    symbol: normalizeSymbol(args.symbol),
    status: "live",
    updatedAt: args.timestamp,
    levelMap,
    cards: {
      liveTraderRead: buildCard({
        title: "Live Trader Read",
        body,
        updatedAt: args.timestamp,
        priceWhenPosted: args.currentPrice,
        source: tradeSetupReadMode === "active" && tradeSetupRead
          ? "trade_setup_read"
          : "pullback_read",
        metadata: {
          headline: deriveTraderReadHeadline(body),
          ...(pullbackRead?.metadata ?? {}),
          ...(tradeSetupRead
            ? {
                tradeSetupReadMode,
                tradeSetupThesisSource,
                ...tradeSetupRead.metadata,
              }
            : {}),
        },
      }),
    },
  };
}

export function buildLiveWatchlistExtensionPatch(
  payload: Parameters<typeof formatLevelExtensionMessage>[0],
): LiveWatchlistCardPatch {
  return {
    symbol: normalizeSymbol(payload.symbol),
    status: "live",
    updatedAt: payload.timestamp,
    cards: {
      nearestSupportResistance: buildCard({
        title: `${payload.symbol} next ${payload.side} levels`,
        body: formatLevelExtensionMessage(payload),
        updatedAt: payload.timestamp,
        priceWhenPosted: null,
        source: "level_extension",
        metadata: {
          side: payload.side,
          levelCount: payload.levels.length,
          firstLevel: payload.levels[0] ?? null,
        },
      }),
    },
  };
}

export function buildLiveWatchlistAlertPatch(
  payload: AlertPayload,
): LiveWatchlistCardPatch | null {
  const symbol = normalizeSymbol(payload.symbol ?? payload.event?.symbol);
  if (symbol === "UNKNOWN") {
    return null;
  }

  const updatedAt = payload.timestamp ?? payload.event?.timestamp ?? Date.now();
  const messageKind = payload.metadata?.messageKind;
  const title = payload.title.trim() || symbol;
  const body = payload.title.trim()
    ? `${payload.title.trim()}\n${payload.body}`
    : payload.body;

  if (messageKind === "stock_context") {
    const currentPrice = parseStockContextLine(payload.body, "Current price");
    const company = parseStockContextLine(payload.body, "Company") ?? symbol;
    const country = parseStockContextLine(payload.body, "Country");
    const usableCompanyInfo = hasUsableCompanyInfo(payload.body, symbol, company);
    const bodyWithRiskWarning = usableCompanyInfo
      ? formatStockContextBodyForWebsite(payload.body, country)
      : COMPANY_INFO_UNAVAILABLE_BODY;
    return {
      symbol,
      status: "live",
      updatedAt,
      firstPostedAt: updatedAt,
      cards: {
        companyInfo: buildCard({
          title: usableCompanyInfo ? company : "Company Info",
          body: bodyWithRiskWarning,
          updatedAt,
          priceWhenPosted: currentPrice ? Number.parseFloat(currentPrice) : null,
          source: "stock_context",
          metadata: {
            company: usableCompanyInfo ? company : null,
            exchange: usableCompanyInfo ? parseStockContextLine(payload.body, "Exchange") : null,
            industry: usableCompanyInfo ? parseStockContextLine(payload.body, "Industry") : null,
            country: usableCompanyInfo ? country : null,
            marketCap: usableCompanyInfo ? parseStockContextLine(payload.body, "Market cap") : null,
            highRiskCountry: usableCompanyInfo ? isHighRiskCountry(country) : false,
          },
        }),
      },
    };
  }

  if (messageKind === "market_structure_update") {
    return {
      symbol,
      status: "live",
      updatedAt,
      cards: {
        marketStructure: buildCard({
          title,
          body,
          updatedAt,
          priceWhenPosted:
            typeof payload.event?.triggerPrice === "number"
              ? payload.event.triggerPrice
              : null,
          source: "market_structure_update",
        }),
      },
    };
  }

  return {
    symbol,
    status: "live",
    updatedAt,
    cards: {
      liveTraderRead: buildCard({
        title,
        body,
        updatedAt,
        priceWhenPosted:
          typeof payload.event?.triggerPrice === "number"
            ? payload.event.triggerPrice
            : null,
        source: typeof messageKind === "string" ? messageKind : "live_alert",
        metadata: {
          eventType: payload.metadata?.eventType ?? payload.event?.eventType ?? null,
          severity: payload.metadata?.severity ?? null,
          confidence: payload.metadata?.confidence ?? null,
          score: payload.metadata?.score ?? null,
          whyPosted: payload.metadata?.whyPosted ?? null,
        },
      }),
    },
  };
}

export function buildLiveWatchlistTickerDataPatch(args: {
  symbol: string;
  lastPrice: number;
  timestamp: number;
  supportZones: LevelMapDisplayZone[];
  resistanceZones: LevelMapDisplayZone[];
  volume?: number | null;
  extendedQuote?: LiveWatchlistExtendedQuote | null;
  priorRegularClosePrice?: number | null;
  priorRegularCloseSource?: string | null;
  specialLevels?: LevelSnapshotPayload["specialLevels"];
  technicalContext?: TechnicalContext | null;
  dataQuality?: LevelSnapshotPayload["levelDataQuality"];
  roleFlipContext?: LevelSnapshotPayload["roleFlipContext"];
}): LiveWatchlistTickerDataPatch | null {
  if (!Number.isFinite(args.lastPrice) || args.lastPrice <= 0) {
    return null;
  }
  const levelMap = buildLiveWatchlistLevelMap({
    currentPrice: args.lastPrice,
    supportZones: args.supportZones,
    resistanceZones: args.resistanceZones,
    preferStructuralLevels: true,
    specialLevels: args.specialLevels,
    technicalContext: args.technicalContext,
    dataQuality: args.dataQuality,
    roleFlipContext: args.roleFlipContext,
    priorRegularClosePrice:
      args.priorRegularClosePrice ?? args.extendedQuote?.previousClosePrice ?? null,
  });
  const nearestSupport = levelMap?.nearestSupport ?? null;
  const nearestResistance = levelMap?.nearestResistance ?? null;
  const rawPriorRegularClosePrice =
    args.priorRegularClosePrice !== undefined
      ? args.priorRegularClosePrice
      : args.extendedQuote?.previousClosePrice;
  const priorRegularClosePrice =
    typeof rawPriorRegularClosePrice === "number" &&
    Number.isFinite(rawPriorRegularClosePrice) &&
    rawPriorRegularClosePrice > 0
      ? rawPriorRegularClosePrice
      : null;
  const moveFromPriorRegularClosePct =
    priorRegularClosePrice === null
      ? null
      : ((args.lastPrice - priorRegularClosePrice) / priorRegularClosePrice) * 100;
  const priorRegularCloseSource =
    args.priorRegularCloseSource !== undefined
      ? args.priorRegularCloseSource
      : args.extendedQuote?.previousClosePrice
        ? "EODHD regular close"
        : null;

  return {
    type: "tickerData",
    symbol: normalizeSymbol(args.symbol),
    status: "live",
    updatedAt: args.timestamp,
    latestPrice: args.lastPrice,
    nearestSupport: nearestSupport?.price ?? null,
    nearestResistance: nearestResistance?.price ?? null,
    nearestSupportLabel: nearestSupport?.label ?? null,
    nearestResistanceLabel: nearestResistance?.label ?? null,
    levelMap,
    ...(args.volume !== undefined
      ? { volume: Number.isFinite(args.volume) && args.volume !== null && args.volume >= 0 ? args.volume : null }
      : {}),
    ...(args.extendedQuote !== undefined ? { extendedQuote: args.extendedQuote } : {}),
    ...(args.priorRegularClosePrice !== undefined ||
    args.priorRegularCloseSource !== undefined ||
    args.extendedQuote?.previousClosePrice !== undefined
      ? {
          priorRegularClosePrice,
          moveFromPriorRegularClosePct,
          priorRegularCloseSource:
            priorRegularClosePrice === null ? null : priorRegularCloseSource?.trim() || null,
        }
      : {}),
  };
}

export function buildLiveWatchlistStatusPatch(args: {
  symbol: string;
  status: LiveWatchlistStatus;
  updatedAt?: number;
  firstPostedAt?: number | null;
}): LiveWatchlistCardPatch {
  return {
    symbol: normalizeSymbol(args.symbol),
    status: args.status,
    updatedAt: args.updatedAt ?? Date.now(),
    ...(args.firstPostedAt !== undefined ? { firstPostedAt: args.firstPostedAt } : {}),
    cards: {},
  };
}

export class LiveWatchlistHttpPublisher implements LiveWatchlistPublisher {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly retryAttempts: number;
  private readonly retryDelayMs: number;

  constructor(private readonly options: LiveWatchlistHttpPublisherOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retryAttempts = Math.max(0, Math.floor(options.retryAttempts ?? DEFAULT_RETRY_ATTEMPTS));
    this.retryDelayMs = Math.max(0, Math.floor(options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS));
  }

  async publish(patch: LiveWatchlistCardPatch): Promise<void> {
    await this.publishPayload(patch);
  }

  async publishHealth(patch: LiveWatchlistHealthPatch): Promise<void> {
    await this.publishPayload(patch);
  }

  async publishTickerData(patch: LiveWatchlistTickerDataPatch): Promise<void> {
    await this.publishPayload(patch);
  }

  private async publishPayload(
    patch: LiveWatchlistCardPatch | LiveWatchlistHealthPatch | LiveWatchlistTickerDataPatch,
  ): Promise<void> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= this.retryAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(this.options.ingestUrl, {
          method: "POST",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${this.options.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(patch),
        });
        if (!response.ok) {
          throw new Error(`Live watchlist ingest failed with ${response.status}.`);
        }
        return;
      } catch (error) {
        lastError = error;
        if (attempt < this.retryAttempts) {
          await delay(this.retryDelayMs);
        }
      } finally {
        clearTimeout(timeout);
      }
    }

    this.options.onError?.(lastError, patch);
    if (!this.options.onError) {
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    }
  }
}

export function createLiveWatchlistPublisherFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): LiveWatchlistPublisher | null {
  const ingestUrl = env.TRADERSLINK_WATCHLIST_INGEST_URL?.trim();
  const token = env.TRADERSLINK_WATCHLIST_PUBLISHER_TOKEN?.trim();
  if (!ingestUrl || !token) {
    return null;
  }

  const publisher = new LiveWatchlistHttpPublisher({
    ingestUrl,
    token,
    timeoutMs: Number(env.TRADERSLINK_WATCHLIST_PUBLISH_TIMEOUT_MS ?? "") || undefined,
    retryAttempts: Number(env.TRADERSLINK_WATCHLIST_PUBLISH_RETRY_ATTEMPTS ?? "") || undefined,
    retryDelayMs: Number(env.TRADERSLINK_WATCHLIST_PUBLISH_RETRY_DELAY_MS ?? "") || undefined,
    onError: (error, patch) => {
      const message = error instanceof Error ? error.message : String(error);
      const payloadLabel = "symbol" in patch ? `${patch.symbol} update` : "health update";
      console.warn(
        `[LiveWatchlistPublisher] Failed to publish ${payloadLabel}: ${message}`,
      );
    },
  });

  if (env.LIVE_WATCHLIST_AUDIT_ARCHIVE_DISABLED === "1") {
    return publisher;
  }

  return new ArchivedLiveWatchlistPublisher(
    publisher,
    new LiveWatchlistAuditArchivePersistence(
      env.LIVE_WATCHLIST_AUDIT_ARCHIVE_PATH?.trim() || DEFAULT_LIVE_WATCHLIST_AUDIT_ARCHIVE_FILE,
    ),
  );
}
