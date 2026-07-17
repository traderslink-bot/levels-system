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
import type {
  LiveWatchlistCardContent,
  LiveWatchlistCardPatch,
  LiveWatchlistHealthPatch,
  LiveWatchlistHttpPublisherOptions,
  LiveWatchlistLevelMap,
  LiveWatchlistLevelMapLevel,
  LiveWatchlistNearestLevel,
  LiveWatchlistPublisher,
  LiveWatchlistStatus,
  LiveWatchlistTickerDataPatch,
  TradersLinkAiReadPayload,
} from "./live-watchlist-types.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRY_ATTEMPTS = 1;
const DEFAULT_RETRY_DELAY_MS = 750;
const MAX_PULLBACK_ZONE_DISTANCE_PCT = 0.3;
const POTENTIAL_PATH_SOFT_DISTANCE_PCT = 0.3;
const POTENTIAL_PATH_MAX_LEVELS_PER_SIDE = 8;
const POTENTIAL_PATH_CLUSTER_DISTANCE_PCT = 0.02;
const POTENTIAL_PATH_MIN_LOGICAL_OUTER_GAP_PCT = 0.2;
const POTENTIAL_PATH_LOGICAL_GAP_MULTIPLIER = 2.5;

type DisplayLevelZone = Pick<
  LevelSnapshotDisplayZone,
  | "representativePrice"
  | "lowPrice"
  | "highPrice"
  | "strengthLabel"
  | "freshness"
  | "touchCount"
  | "confluenceCount"
  | "sourceEvidenceCount"
  | "firstEvidenceAt"
  | "lastEvidenceAt"
  | "timeframeSources"
  | "isExtension"
  | "isSynthetic"
  | "sourceLabel"
  | "roleFlipEvidence"
>;

export type LiveWatchlistPotentialPathCoverage = {
  levelCount: number;
  nearestDistancePct: number | null;
  outerDistancePct: number | null;
  prices: number[];
};

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

function nearestLevel(
  zones: Array<Pick<LevelSnapshotDisplayZone, "representativePrice" | "strengthLabel" | "sourceLabel">>,
  currentPrice: number,
  side: "support" | "resistance",
): LiveWatchlistNearestLevel | null {
  const candidates = levelsByDistance(zones, currentPrice, side);
  const selected = candidates[0];
  if (!selected) {
    return null;
  }

  return {
    price: selected.representativePrice,
    distancePct:
      Math.abs(selected.representativePrice - currentPrice) /
      Math.max(currentPrice, 0.0001),
    strengthLabel: selected.strengthLabel,
    sourceLabel: selected.sourceLabel,
  };
}

function levelsByDistance(
  zones: DisplayLevelZone[],
  currentPrice: number,
  side: "support" | "resistance",
): DisplayLevelZone[] {
  return zones
    .filter((zone) =>
      side === "support"
        ? zone.representativePrice < currentPrice
        : zone.representativePrice > currentPrice,
    )
    .sort((left, right) =>
      side === "support"
        ? right.representativePrice - left.representativePrice
        : left.representativePrice - right.representativePrice,
    );
}

function potentialPathStrengthRank(
  strength: LevelSnapshotDisplayZone["strengthLabel"],
): number {
  switch (strength) {
    case "major":
      return 4;
    case "strong":
      return 3;
    case "moderate":
      return 2;
    case "weak":
      return 1;
    default:
      return 0;
  }
}

function isStructuralPotentialPathZone(zone: DisplayLevelZone): boolean {
  const source = zone.sourceLabel?.toLowerCase() ?? "";
  return source.includes("daily") || source.includes("4h");
}

function isMeaningfulOuterPotentialPathZone(zone: DisplayLevelZone): boolean {
  return (
    potentialPathStrengthRank(zone.strengthLabel) >=
      potentialPathStrengthRank("strong") &&
    isStructuralPotentialPathZone(zone)
  );
}

function preferPotentialPathZone(
  challenger: DisplayLevelZone,
  incumbent: DisplayLevelZone,
): boolean {
  const strengthDifference =
    potentialPathStrengthRank(challenger.strengthLabel) -
    potentialPathStrengthRank(incumbent.strengthLabel);
  if (strengthDifference !== 0) {
    return strengthDifference > 0;
  }
  if (isStructuralPotentialPathZone(challenger) !== isStructuralPotentialPathZone(incumbent)) {
    return isStructuralPotentialPathZone(challenger);
  }
  return false;
}

function clusterPotentialPathZones(
  zones: DisplayLevelZone[],
  currentPrice: number,
): DisplayLevelZone[] {
  const selected: DisplayLevelZone[] = [];
  for (const zone of zones) {
    const existingIndex = selected.findIndex(
      (existing) =>
        Math.abs(existing.representativePrice - zone.representativePrice) /
          Math.max(currentPrice, 0.0001) <=
        POTENTIAL_PATH_CLUSTER_DISTANCE_PCT,
    );
    if (existingIndex === -1) {
      selected.push(zone);
      continue;
    }
    const existing = selected[existingIndex]!;
    const preferred = preferPotentialPathZone(zone, existing) ? zone : existing;
    const lowPrice = Math.min(
      existing.lowPrice ?? existing.representativePrice,
      existing.representativePrice,
      zone.lowPrice ?? zone.representativePrice,
      zone.representativePrice,
    );
    const highPrice = Math.max(
      existing.highPrice ?? existing.representativePrice,
      existing.representativePrice,
      zone.highPrice ?? zone.representativePrice,
      zone.representativePrice,
    );
    const evidenceCount =
      Math.max(existing.sourceEvidenceCount ?? 1, 0) +
      Math.max(zone.sourceEvidenceCount ?? 1, 0);
    const firstEvidenceAt = [existing.firstEvidenceAt, zone.firstEvidenceAt]
      .filter((value): value is number => typeof value === "number" && value > 0)
      .sort((left, right) => left - right)[0];
    const lastEvidenceAt = [existing.lastEvidenceAt, zone.lastEvidenceAt]
      .filter((value): value is number => typeof value === "number" && value > 0)
      .sort((left, right) => right - left)[0];
    const timeframeSources = [
      ...new Set([...(existing.timeframeSources ?? []), ...(zone.timeframeSources ?? [])]),
    ];
    const clusteredSourceLabel = timeframeSources.length > 1
      ? `${timeframeSources.join("/")} clustered confluence`
      : timeframeSources[0] === "5m"
        ? "intraday clustered levels"
        : timeframeSources[0]
          ? `${timeframeSources[0]} structure clustered levels`
          : "clustered levels";

    selected[existingIndex] = {
      ...preferred,
      lowPrice,
      highPrice,
      sourceEvidenceCount: evidenceCount,
      // Nearby display rows can describe the same underlying reactions. Keep
      // the strongest observed count instead of claiming duplicate touches.
      touchCount: Math.max(existing.touchCount ?? 0, zone.touchCount ?? 0),
      confluenceCount: Math.max(
        timeframeSources.length,
        existing.confluenceCount ?? 0,
        zone.confluenceCount ?? 0,
      ),
      ...(firstEvidenceAt ? { firstEvidenceAt } : {}),
      ...(lastEvidenceAt ? { lastEvidenceAt } : {}),
      timeframeSources,
      isExtension: Boolean(existing.isExtension && zone.isExtension),
      isSynthetic: Boolean(existing.isSynthetic && zone.isSynthetic),
      sourceLabel: clusteredSourceLabel,
      roleFlipEvidence:
        preferred.roleFlipEvidence ??
        existing.roleFlipEvidence ??
        zone.roleFlipEvidence,
    };
  }
  return selected.sort(
    (left, right) =>
      Math.abs(left.representativePrice - currentPrice) -
      Math.abs(right.representativePrice - currentPrice),
  );
}

function lowerMedian(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) / 2)]!;
}

function isLogicalOuterPotentialPathZone(
  inBandZones: DisplayLevelZone[],
  candidate: DisplayLevelZone,
  currentPrice: number,
): boolean {
  const distances = inBandZones
    .map(
      (zone) =>
        Math.abs(zone.representativePrice - currentPrice) /
        Math.max(currentPrice, 0.0001),
    )
    .sort((left, right) => left - right);
  const lastDistance = distances.at(-1) ?? 0;
  const normalGaps = distances
    .slice(1)
    .map((distance, index) => distance - distances[index]!);
  const allowedGap = Math.max(
    POTENTIAL_PATH_MIN_LOGICAL_OUTER_GAP_PCT,
    lowerMedian(normalGaps) * POTENTIAL_PATH_LOGICAL_GAP_MULTIPLIER,
  );
  const candidateDistance =
    Math.abs(candidate.representativePrice - currentPrice) /
    Math.max(currentPrice, 0.0001);
  return candidateDistance - lastDistance <= allowedGap;
}

function selectPotentialPathZones(
  zones: DisplayLevelZone[],
  currentPrice: number,
  side: "support" | "resistance",
): DisplayLevelZone[] {
  const clustered = clusterPotentialPathZones(
    levelsByDistance(zones, currentPrice, side),
    currentPrice,
  );
  const inBand = clustered.filter(
    (zone) =>
      Math.abs(zone.representativePrice - currentPrice) /
        Math.max(currentPrice, 0.0001) <=
      POTENTIAL_PATH_SOFT_DISTANCE_PCT,
  );
  if (inBand.length === 0) {
    const nearest = clustered[0];
    if (!nearest) {
      return [];
    }
    const remaining = clustered.slice(1);
    const nextCheckpoint =
      remaining.find(isMeaningfulOuterPotentialPathZone) ??
      remaining.find(isStructuralPotentialPathZone) ??
      remaining[0];
    return nextCheckpoint ? [nearest, nextCheckpoint] : [nearest];
  }

  const outerAnchor = clustered.find(
    (zone) =>
      Math.abs(zone.representativePrice - currentPrice) /
          Math.max(currentPrice, 0.0001) >
        POTENTIAL_PATH_SOFT_DISTANCE_PCT &&
      isMeaningfulOuterPotentialPathZone(zone),
  );
  if (outerAnchor && isLogicalOuterPotentialPathZone(inBand, outerAnchor, currentPrice)) {
    return [
      ...inBand.slice(0, POTENTIAL_PATH_MAX_LEVELS_PER_SIDE - 1),
      outerAnchor,
    ];
  }
  return inBand.slice(0, POTENTIAL_PATH_MAX_LEVELS_PER_SIDE);
}

export function buildLiveWatchlistPotentialPathCoverage(args: {
  zones: DisplayLevelZone[];
  currentPrice: number;
  side: "support" | "resistance";
}): LiveWatchlistPotentialPathCoverage {
  if (!Number.isFinite(args.currentPrice) || args.currentPrice <= 0) {
    return {
      levelCount: 0,
      nearestDistancePct: null,
      outerDistancePct: null,
      prices: [],
    };
  }

  const selected = selectPotentialPathZones(
    args.zones,
    args.currentPrice,
    args.side,
  );
  const distances = selected.map(
    (zone) =>
      Math.abs(zone.representativePrice - args.currentPrice) /
      Math.max(args.currentPrice, 0.0001),
  );

  return {
    levelCount: selected.length,
    nearestDistancePct: distances[0] ?? null,
    outerDistancePct: distances.at(-1) ?? null,
    prices: selected.map((zone) => zone.representativePrice),
  };
}

function formatLevelSourceLabel(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (
    normalized.includes("cluster") ||
    normalized.includes("confluence") ||
    normalized.includes("synthetic") ||
    normalized.includes("historical extension")
  ) {
    return value?.trim() ?? null;
  }
  if (normalized.includes("intraday") || normalized.includes("5m")) {
    return "intraday";
  }
  if (normalized.includes("4h")) {
    return "4h structure";
  }
  if (normalized.includes("daily")) {
    return "daily structure";
  }
  return value?.trim() ?? null;
}

function signedDistancePct(price: number, currentPrice: number): number {
  return (price - currentPrice) / Math.max(currentPrice, 0.0001);
}

function normalizedZoneBounds(zone: DisplayLevelZone): { lowPrice: number; highPrice: number } {
  return {
    lowPrice: Math.min(zone.lowPrice ?? zone.representativePrice, zone.representativePrice),
    highPrice: Math.max(zone.highPrice ?? zone.representativePrice, zone.representativePrice),
  };
}

function formatZonePriceRange(lowPrice: number, highPrice: number): string {
  const low = formatPrice(lowPrice);
  const high = formatPrice(highPrice);
  return low === high ? low : `${low}-${high} zone`;
}

function formatSignedDistancePct(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(1)}%`;
}

function formatZoneDistanceRange(lowDistancePct: number, highDistancePct: number): string {
  const low = formatSignedDistancePct(lowDistancePct);
  const high = formatSignedDistancePct(highDistancePct);
  return low === high ? low : `${low} to ${high}`;
}

function buildLevelMapLevel(
  zone: DisplayLevelZone,
  currentPrice: number,
  side: "support" | "resistance",
): LiveWatchlistLevelMapLevel {
  const { lowPrice, highPrice } = normalizedZoneBounds(zone);
  const distancePct = signedDistancePct(zone.representativePrice, currentPrice);
  const lowDistancePct = signedDistancePct(lowPrice, currentPrice);
  const highDistancePct = signedDistancePct(highPrice, currentPrice);
  const sourceLabel = formatLevelSourceLabel(zone.sourceLabel);
  const evidenceCount = Math.max(zone.sourceEvidenceCount ?? 0, 0);
  const isClustered = evidenceCount > 1 || /cluster|confluence/i.test(sourceLabel ?? "");
  const evidenceStatus = zone.isSynthetic || /synthetic/i.test(sourceLabel ?? "")
    ? "synthetic_planning" as const
    : (zone.touchCount ?? 0) > 0
      ? "historically_tested" as const
      : "detected_structure" as const;
  const details = [
    formatZoneDistanceRange(lowDistancePct, highDistancePct),
    zone.strengthLabel ?? null,
    sourceLabel,
  ].filter((value): value is string => Boolean(value));

  return {
    side,
    price: zone.representativePrice,
    lowPrice,
    highPrice,
    distancePct,
    lowDistancePct,
    highDistancePct,
    strengthLabel: zone.strengthLabel,
    freshness: zone.freshness,
    sourceLabel,
    ...(evidenceCount > 0 ? { evidenceCount } : {}),
    ...(zone.firstEvidenceAt ? { firstEvidenceAt: zone.firstEvidenceAt } : {}),
    ...(zone.lastEvidenceAt ? { lastEvidenceAt: zone.lastEvidenceAt } : {}),
    ...(zone.timeframeSources?.length
      ? { timeframes: [...new Set(zone.timeframeSources)] }
      : {}),
    isClustered,
    evidenceStatus,
    roleFlipState: zone.roleFlipEvidence ? "confirmed" : "original",
    label: `${formatZonePriceRange(lowPrice, highPrice)} (${details.join(", ")})`,
  };
}

function deriveLevelMapRangeState(
  currentPrice: number,
  nearestSupport: LiveWatchlistLevelMapLevel | null,
  nearestResistance: LiveWatchlistLevelMapLevel | null,
): LiveWatchlistLevelMap["rangeState"] {
  if (!nearestSupport || !nearestResistance) {
    return "normal";
  }
  const gapPct =
    (nearestResistance.price - nearestSupport.price) / Math.max(currentPrice, 0.0001);
  if (gapPct <= 0.03) {
    return "tight";
  }
  if (gapPct >= 0.12) {
    return "wide";
  }
  return "normal";
}

function buildLevelMap(args: {
  currentPrice: number;
  supportZones: DisplayLevelZone[];
  resistanceZones: DisplayLevelZone[];
}): LiveWatchlistLevelMap {
  const supportLevels = args.supportZones.map((zone) =>
    buildLevelMapLevel(zone, args.currentPrice, "support"),
  );
  const resistanceLevels = args.resistanceZones.map((zone) =>
    buildLevelMapLevel(zone, args.currentPrice, "resistance"),
  );
  const nearestSupport = supportLevels[0] ?? null;
  const nearestResistance = resistanceLevels[0] ?? null;
  const nextStrongSupport = supportLevels.find(
    (level) => level !== nearestSupport && potentialPathStrengthRank(level.strengthLabel) >= 3,
  ) ?? null;
  const nextStrongResistance = resistanceLevels.find(
    (level) => level !== nearestResistance && potentialPathStrengthRank(level.strengthLabel) >= 3,
  ) ?? null;

  return {
    currentPrice: args.currentPrice,
    rangeState: deriveLevelMapRangeState(
      args.currentPrice,
      nearestSupport,
      nearestResistance,
    ),
    nearestSupport,
    nearestResistance,
    nextStrongSupport,
    nextStrongResistance,
    supportLevels,
    resistanceLevels,
  };
}

function formatNearestLevelLabel(
  level: LiveWatchlistNearestLevel | null,
  side: "support" | "resistance",
): string | null {
  if (!level) {
    return null;
  }
  const sign = side === "support" ? "-" : "+";
  const parts = [
    `${sign}${(level.distancePct * 100).toFixed(1)}%`,
    level.strengthLabel ?? null,
    formatLevelSourceLabel(level.sourceLabel),
  ].filter((value): value is string => Boolean(value));
  return `${formatPrice(level.price)} (${parts.join(", ")})`;
}

function buildNearestFromZone(
  zone: Pick<LevelSnapshotDisplayZone, "representativePrice" | "strengthLabel" | "sourceLabel"> | undefined,
  currentPrice: number,
): LiveWatchlistNearestLevel | null {
  if (!zone) {
    return null;
  }
  return {
    price: zone.representativePrice,
    distancePct: Math.abs(zone.representativePrice - currentPrice) / Math.max(currentPrice, 0.0001),
    strengthLabel: zone.strengthLabel,
    sourceLabel: zone.sourceLabel,
  };
}

function formatLevelRows(
  zones: DisplayLevelZone[],
  currentPrice: number,
  side: "support" | "resistance",
): string[] {
  const rows = zones.map((zone) => buildLevelMapLevel(zone, currentPrice, side).label);
  return rows.length > 0 ? rows : ["none"];
}

function buildLevelsBody(args: {
  supportZones: DisplayLevelZone[];
  resistanceZones: DisplayLevelZone[];
  currentPrice: number;
  supportLimit?: number;
  resistanceLimit?: number;
  maxDistancePct?: number;
}): string {
  const withinDistance = (
    zone: Pick<LevelSnapshotDisplayZone, "representativePrice">,
  ): boolean => {
    if (args.maxDistancePct === undefined) {
      return true;
    }
    const distancePct =
      Math.abs(zone.representativePrice - args.currentPrice) /
      Math.max(args.currentPrice, 0.0001);
    return distancePct <= args.maxDistancePct;
  };
  const filteredResistanceZones = args.resistanceZones.filter(withinDistance);
  const filteredSupportZones = args.supportZones.filter(withinDistance);
  const resistanceZones = args.resistanceLimit === undefined
    ? filteredResistanceZones
    : filteredResistanceZones.slice(0, args.resistanceLimit);
  const supportZones = args.supportLimit === undefined
    ? filteredSupportZones
    : filteredSupportZones.slice(0, args.supportLimit);

  return [
    "Resistance:",
    ...formatLevelRows(resistanceZones, args.currentPrice, "resistance"),
    "",
    "Support:",
    ...formatLevelRows(supportZones, args.currentPrice, "support"),
  ].join("\n");
}

function buildDeterministicTraderRead(payload: LevelSnapshotPayload): string {
  const symbol = normalizeSymbol(payload.symbol);
  const supports = levelsByDistance(payload.supportZones, payload.currentPrice, "support");
  const resistances = levelsByDistance(payload.resistanceZones, payload.currentPrice, "resistance");
  const firstSupport = buildNearestFromZone(supports[0], payload.currentPrice);
  const deeperSupportCandidate = buildNearestFromZone(supports[1], payload.currentPrice);
  const deeperSupport =
    deeperSupportCandidate &&
    deeperSupportCandidate.distancePct <= MAX_PULLBACK_ZONE_DISTANCE_PCT
      ? deeperSupportCandidate
      : null;
  const breakoutResistance = buildNearestFromZone(resistances[0], payload.currentPrice);
  const nextResistance = buildNearestFromZone(resistances[1], payload.currentPrice);
  const firstSupportLabel = formatNearestLevelLabel(firstSupport, "support");
  const deeperSupportLabel = formatNearestLevelLabel(deeperSupport, "support");
  const breakoutLabel = formatNearestLevelLabel(breakoutResistance, "resistance");
  const nextResistanceLabel = formatNearestLevelLabel(nextResistance, "resistance");

  const currentRead = firstSupportLabel && breakoutLabel
    ? `${symbol} is trading between nearby support at ${firstSupportLabel} and nearby resistance at ${breakoutLabel}. The cleaner read comes from acceptance outside that area, not noise inside it.`
    : breakoutLabel
      ? `${symbol} has a cleaner upside level to watch at ${breakoutLabel}, but nearby support is not clearly defined from the current snapshot.`
      : firstSupportLabel
        ? `${symbol} has nearby support at ${firstSupportLabel}, but the next clean resistance is not clearly defined from the current snapshot.`
        : `${symbol} does not have a clean nearby support/resistance map from the current snapshot yet.`;

  const breakoutArea = breakoutLabel
    ? `A cleaner breakout attempt starts with acceptance above ${breakoutLabel}. A quick push into that level without hold-through can still be a trap in a fast small-cap move.`
    : "No clean nearby breakout level is available from the current ladder snapshot.";

  const pullbackZones = [
    firstSupportLabel ? `First pullback area: ${firstSupportLabel}.` : null,
    deeperSupportLabel ? `Deeper pullback area: ${deeperSupportLabel}.` : null,
  ].filter((line): line is string => Boolean(line)).join("\n") ||
    "No clean pullback zone is available from the current ladder snapshot.";

  const continuationPath = breakoutLabel && nextResistanceLabel
    ? `If price accepts above ${breakoutLabel}, attention shifts toward ${nextResistanceLabel}.`
    : breakoutLabel
      ? `If price accepts above ${breakoutLabel}, wait for the next ladder refresh before assuming a clear continuation path.`
      : "Continuation is not cleanly mapped until a nearby breakout area is established.";

  const weakens = firstSupportLabel
    ? `The setup weakens if price loses ${firstSupportLabel} and cannot reclaim it. That is structure failure context, not a stop-loss instruction.`
    : "The setup weakens if price cannot hold a constructive range after the next support refresh.";

  const cautionParts = [
    "Small-cap stocks can move quickly and levels can fail fast.",
    deeperSupportCandidate && !deeperSupport
      ? "The next lower support is far from current price, so a failed nearby support can leave a wide downside air pocket."
      : null,
    "Do not treat this read as a target or buy/sell signal; wait for your own setup and manage risk.",
  ].filter((part): part is string => Boolean(part));

  return [
    `Current Read: ${currentRead}`,
    "",
    `Breakout Area To Watch: ${breakoutArea}`,
    "",
    `Pullback Zones:\n${pullbackZones}`,
    "",
    `Continuation Path: ${continuationPath}`,
    "",
    `Setup Weakens If: ${weakens}`,
    "",
    `Quality / Caution: ${cautionParts.join(" ")}`,
  ].join("\n");
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
      const displayedPrice = trimmed.match(
        /^([0-9]+(?:\.[0-9]+)?(?:\s*[-–]\s*[0-9]+(?:\.[0-9]+)?)?)\s+\(/,
      )?.[1];
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

export function buildLiveWatchlistSnapshotPatch(
  payload: LevelSnapshotPayload,
): LiveWatchlistCardPatch {
  const updatedAt = payload.timestamp;
  const nearestSupport = nearestLevel(payload.supportZones, payload.currentPrice, "support");
  const nearestResistance = nearestLevel(
    payload.resistanceZones,
    payload.currentPrice,
    "resistance",
  );
  const ladderTitle = `${payload.symbol} full level ladder`;
  const snapshotMessage = formatLevelSnapshotMessage(payload);
  const sortedSupports = levelsByDistance(payload.supportZones, payload.currentPrice, "support");
  const sortedResistances = levelsByDistance(
    payload.resistanceZones,
    payload.currentPrice,
    "resistance",
  );
  const potentialPathSupports = selectPotentialPathZones(
    sortedSupports,
    payload.currentPrice,
    "support",
  );
  const potentialPathResistances = selectPotentialPathZones(
    sortedResistances,
    payload.currentPrice,
    "resistance",
  );
  const levelMap = buildLevelMap({
    currentPrice: payload.currentPrice,
    supportZones: potentialPathSupports,
    resistanceZones: potentialPathResistances,
  });
  const ladder = buildLevelsBody({
    supportZones: sortedSupports,
    resistanceZones: sortedResistances,
    currentPrice: payload.currentPrice,
  });
  const potentialPath = buildLevelsBody({
    supportZones: potentialPathSupports,
    resistanceZones: potentialPathResistances,
    currentPrice: payload.currentPrice,
  });
  const marketStructure = payload.marketStructure?.trim() ||
    extractSection(snapshotMessage, "Market structure", [
      "Trade map",
      "Closest levels to watch",
      "More support and resistance",
    ]);
  const liveTraderRead =
    extractSection(snapshotMessage, "Trade map", [
      "Closest levels to watch",
      "More support and resistance",
    ]) ?? buildDeterministicTraderRead(payload);

  return {
    symbol: normalizeSymbol(payload.symbol),
    status: "live",
    updatedAt,
    levelMap,
    cards: {
      fullLadder: ladder
        ? buildCard({
            title: ladderTitle,
            body: cleanFullLadderBody(ladder, ladderTitle),
            updatedAt,
            priceWhenPosted: payload.currentPrice,
            source: "level_snapshot",
          })
        : null,
      nearestSupportResistance: buildCard({
        title: "Potential Path Levels",
        body: potentialPath,
        updatedAt,
        priceWhenPosted: payload.currentPrice,
        source: "level_snapshot",
        metadata: {
          nearestSupport: nearestSupport?.price ?? null,
          nearestSupportDistancePct: nearestSupport?.distancePct ?? null,
          nearestSupportLabel: formatNearestLevelLabel(nearestSupport, "support"),
          nearestResistance: nearestResistance?.price ?? null,
          nearestResistanceDistancePct: nearestResistance?.distancePct ?? null,
          nearestResistanceLabel: formatNearestLevelLabel(nearestResistance, "resistance"),
          supportCount: potentialPathSupports.length,
          resistanceCount: potentialPathResistances.length,
        },
      }),
      liveTraderRead: buildCard({
        title: "Live Trader Read",
        body: liveTraderRead,
        updatedAt,
        priceWhenPosted: payload.currentPrice,
        source: "level_snapshot",
        metadata: {
          headline: deriveTraderReadHeadline(liveTraderRead),
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
    const bodyWithRiskWarning = formatStockContextBodyForWebsite(payload.body, country);
    return {
      symbol,
      status: "live",
      updatedAt,
      cards: {
        companyInfo: buildCard({
          title: company,
          body: bodyWithRiskWarning,
          updatedAt,
          priceWhenPosted: currentPrice ? Number.parseFloat(currentPrice) : null,
          source: "stock_context",
          metadata: {
            company,
            exchange: parseStockContextLine(payload.body, "Exchange"),
            industry: parseStockContextLine(payload.body, "Industry"),
            country,
            marketCap: parseStockContextLine(payload.body, "Market cap"),
            highRiskCountry: isHighRiskCountry(country),
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
  supportZones: Array<Pick<LevelSnapshotDisplayZone, "representativePrice" | "strengthLabel" | "sourceLabel">>;
  resistanceZones: Array<Pick<LevelSnapshotDisplayZone, "representativePrice" | "strengthLabel" | "sourceLabel">>;
}): LiveWatchlistTickerDataPatch | null {
  if (!Number.isFinite(args.lastPrice) || args.lastPrice <= 0) {
    return null;
  }
  const nearestSupport = nearestLevel(args.supportZones, args.lastPrice, "support");
  const nearestResistance = nearestLevel(args.resistanceZones, args.lastPrice, "resistance");

  return {
    type: "tickerData",
    symbol: normalizeSymbol(args.symbol),
    status: "live",
    updatedAt: args.timestamp,
    latestPrice: args.lastPrice,
    nearestSupport: nearestSupport?.price ?? null,
    nearestResistance: nearestResistance?.price ?? null,
    nearestSupportLabel: formatNearestLevelLabel(nearestSupport, "support"),
    nearestResistanceLabel: formatNearestLevelLabel(nearestResistance, "resistance"),
  };
}

export function buildLiveWatchlistStatusPatch(args: {
  symbol: string;
  status: LiveWatchlistStatus;
  updatedAt?: number;
}): LiveWatchlistCardPatch {
  return {
    symbol: normalizeSymbol(args.symbol),
    status: args.status,
    updatedAt: args.updatedAt ?? Date.now(),
    cards: {},
  };
}

export function buildTradersLinkAiReadPatch(args: {
  read: TradersLinkAiReadPayload;
  visible?: boolean;
}): LiveWatchlistCardPatch {
  const { read } = args;
  return {
    symbol: normalizeSymbol(read.symbol),
    status: "live",
    updatedAt: read.generatedAt,
    tradersLinkAiReadCardVisible: args.visible !== false,
    cards: {
      tradersLinkAiRead: buildCard({
        title: "TradersLink AI Read",
        body: JSON.stringify(read),
        updatedAt: read.generatedAt,
        priceWhenPosted: read.currentPrice,
        source: read.usedWebSearch
          ? "openai_responses_press_sec_database_web_search"
          : "openai_responses_press_sec_database",
        metadata: {
          model: read.model,
          externalResearchEnabled: read.externalResearchEnabled,
          bias: read.bias,
          confidence: read.confidence,
          listingStatus: read.listingStatus.status,
          listingImmediacy: read.listingStatus.immediacy,
          sourceCount: read.sources.length,
          databaseSourceCount: read.sources.filter(
            (source) => source.sourceType === "press_release_sec_database",
          ).length,
          usedWebSearch: read.usedWebSearch,
          webSearchCallCount: read.usage.webSearchCallCount,
          inputTokens: read.usage.inputTokens,
          outputTokens: read.usage.outputTokens,
          estimatedCostUsd: read.usage.estimatedTotalCostUsd,
          dataAsOf: read.dataAsOf,
        },
      }),
    },
  };
}

export function buildTradersLinkAiReadVisibilityPatch(args: {
  symbol: string;
  visible: boolean;
  updatedAt?: number;
}): LiveWatchlistCardPatch {
  return {
    symbol: normalizeSymbol(args.symbol),
    status: "live",
    updatedAt: args.updatedAt ?? Date.now(),
    tradersLinkAiReadCardVisible: args.visible,
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

  return new LiveWatchlistHttpPublisher({
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
}
