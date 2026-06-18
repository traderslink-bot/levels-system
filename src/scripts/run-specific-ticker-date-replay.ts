import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  formatLevelLadderMessage,
  formatLevelSnapshotMessage,
} from "../lib/alerts/alert-router.js";
import type {
  LevelSnapshotAudit,
  LevelSnapshotAuditZone,
  LevelSnapshotDisplayZone,
  LevelSnapshotPayload,
} from "../lib/alerts/alert-types.js";
import { DurableCandleWarehouse } from "../lib/candle-warehouse/index.js";
import type { Candle, CandleTimeframe } from "../lib/market-data/candle-types.js";
import type { FinalLevelZone } from "../lib/levels/level-types.js";
import { LevelStore } from "../lib/monitoring/level-store.js";
import { buildSupportResistanceContextFromNormalizedCandles } from "../lib/support-resistance/build-support-resistance-context.js";

type ReplayCase = {
  symbol: string;
  date: string;
  time: string;
};

const DEFAULT_OUT_DIR = "artifacts/specific-ticker-date-replay";
const WAREHOUSE_ROOT = "data/candles";
const PROVIDER = "ibkr" as const;
const SNAPSHOT_PRICE_TOLERANCE_PCT = 0.001;
const SNAPSHOT_PRICE_TOLERANCE_ABSOLUTE = 0.001;
const SNAPSHOT_DISPLAY_COMPACTION_PCT = 0.0075;
const SNAPSHOT_DISPLAY_COMPACTION_ABSOLUTE = 0.01;
const SNAPSHOT_FORWARD_RESISTANCE_RANGE_PCT = 0.5;
const LOW_PRICE_SNAPSHOT_FORWARD_RESISTANCE_RANGE_PCT = 1;
const SNAPSHOT_CONTINUATION_MAP_MIN_GAP_PCT = 0.18;
const SNAPSHOT_CONTINUATION_MAP_TARGET_PCT = 0.55;
const SNAPSHOT_CONTINUATION_MAP_MIN_STEP_PCT = 0.03;
const SNAPSHOT_CONTINUATION_MAP_MAX_LEVELS = 4;
const DEFAULT_HORIZON_HOURS = 5;
const MAP_EXHAUSTION_BUFFER_PCT = 0.005;
const DEFAULT_CASES: ReplayCase[] = [
  { symbol: "AKAN", date: "2026-04-22", time: "11:00" },
  { symbol: "YCBD", date: "2026-04-22", time: "12:00" },
  { symbol: "AIXI", date: "2026-04-22", time: "09:30" },
  { symbol: "SKLZ", date: "2026-04-23", time: "12:15" },
  { symbol: "CAST", date: "2026-04-24", time: "08:00" },
  { symbol: "YAAS", date: "2026-04-27", time: "09:15" },
  { symbol: "SEGG", date: "2026-04-28", time: "08:25" },
  { symbol: "ATER", date: "2026-04-28", time: "08:50" },
];

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function numberArg(flag: string, fallback: number): number {
  const parsed = Number.parseFloat(argValue(flag) ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseEasternTimestamp(date: string, time: string): number {
  return Date.parse(`${date}T${time}:00-04:00`);
}

function startOfEasternDay(date: string): number {
  return Date.parse(`${date}T00:00:00-04:00`);
}

function timeframeMs(timeframe: CandleTimeframe): number {
  if (timeframe === "daily") {
    return 24 * 60 * 60 * 1000;
  }
  if (timeframe === "4h") {
    return 4 * 60 * 60 * 1000;
  }
  return 5 * 60 * 1000;
}

function snapshotPriceTolerance(price: number): number {
  return Math.max(price * SNAPSHOT_PRICE_TOLERANCE_PCT, SNAPSHOT_PRICE_TOLERANCE_ABSOLUTE);
}

function snapshotDisplayCompactionTolerance(price: number): number {
  return Math.max(price * SNAPSHOT_DISPLAY_COMPACTION_PCT, SNAPSHOT_DISPLAY_COMPACTION_ABSOLUTE);
}

function formatSnapshotLevel(level: number): string {
  return level >= 1 ? level.toFixed(2) : level.toFixed(4);
}

function formatPercent(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}%` : "n/a";
}

function formatEasternTime(timestamp: number | null | undefined): string {
  if (!timestamp) {
    return "n/a";
  }
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Toronto",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function snapshotForwardResistanceRangePct(currentPrice: number): number {
  return currentPrice < 2
    ? LOW_PRICE_SNAPSHOT_FORWARD_RESISTANCE_RANGE_PCT
    : SNAPSHOT_FORWARD_RESISTANCE_RANGE_PCT;
}

function decimalPlacesForIncrement(increment: number): number {
  const text = increment.toString();
  const dotIndex = text.indexOf(".");
  return dotIndex === -1 ? 0 : text.length - dotIndex - 1;
}

function normalizeSnapshotContinuationPrice(price: number, increment: number): number {
  return Number(price.toFixed(Math.max(decimalPlacesForIncrement(increment), price >= 1 ? 2 : 4)));
}

function snapshotResistancePlanningIncrement(price: number): number {
  if (price < 0.5) return 0.025;
  if (price < 1) return 0.05;
  if (price < 2) return 0.1;
  if (price < 5) return 0.25;
  if (price < 10) return 0.5;
  if (price < 25) return 1;
  if (price < 50) return 2.5;
  return 5;
}

function nextSnapshotContinuationResistance(basePrice: number): number {
  const increment = snapshotResistancePlanningIncrement(basePrice);
  const rounded = Math.ceil((basePrice + increment * 0.05) / increment) * increment;
  return normalizeSnapshotContinuationPrice(rounded, increment);
}

function deriveSnapshotLevelSourceLabel(zone: FinalLevelZone): string {
  if (zone.notes.includes("snapshot_continuation_map")) {
    return "continuation map";
  }

  if (zone.isExtension) {
    return "extension";
  }
  const sources = new Set(zone.timeframeSources);
  if (sources.has("daily")) {
    return zone.timeframeSources.length > 1 ? "daily confluence" : "daily structure";
  }
  if (sources.has("4h")) {
    return zone.timeframeSources.length > 1 ? "4h confluence" : "4h structure";
  }
  if (sources.has("5m")) {
    return zone.freshness === "fresh" ? "fresh intraday" : "intraday";
  }
  return "price structure";
}

function freshnessRank(freshness: FinalLevelZone["freshness"]): number {
  return freshness === "fresh" ? 2 : freshness === "aging" ? 1 : 0;
}

function timeframeRank(timeframeBias: FinalLevelZone["timeframeBias"]): number {
  return timeframeBias === "mixed" ? 3 : timeframeBias === "daily" ? 2 : timeframeBias === "4h" ? 1 : 0;
}

function isBetterSnapshotRepresentative(
  challenger: FinalLevelZone,
  incumbent: FinalLevelZone,
  currentPrice: number,
  side: "support" | "resistance",
): boolean {
  const challengerDistance = Math.abs(challenger.representativePrice - currentPrice);
  const incumbentDistance = Math.abs(incumbent.representativePrice - currentPrice);
  const nearPriceDistance = Math.max(currentPrice, 0.0001) * 0.03;
  if (
    side === "resistance" &&
    (challengerDistance <= nearPriceDistance || incumbentDistance <= nearPriceDistance) &&
    challengerDistance !== incumbentDistance
  ) {
    return challengerDistance < incumbentDistance;
  }
  if (challenger.strengthScore !== incumbent.strengthScore) {
    return challenger.strengthScore > incumbent.strengthScore;
  }
  if (challenger.confluenceCount !== incumbent.confluenceCount) {
    return challenger.confluenceCount > incumbent.confluenceCount;
  }
  if (challenger.sourceEvidenceCount !== incumbent.sourceEvidenceCount) {
    return challenger.sourceEvidenceCount > incumbent.sourceEvidenceCount;
  }
  if (timeframeRank(challenger.timeframeBias) !== timeframeRank(incumbent.timeframeBias)) {
    return timeframeRank(challenger.timeframeBias) > timeframeRank(incumbent.timeframeBias);
  }
  if (freshnessRank(challenger.freshness) !== freshnessRank(incumbent.freshness)) {
    return freshnessRank(challenger.freshness) > freshnessRank(incumbent.freshness);
  }
  if (challengerDistance !== incumbentDistance) {
    return challengerDistance < incumbentDistance;
  }
  return side === "support"
    ? challenger.representativePrice > incumbent.representativePrice
    : challenger.representativePrice < incumbent.representativePrice;
}

function sortSnapshotZones(zones: FinalLevelZone[], side: "support" | "resistance"): FinalLevelZone[] {
  return [...zones].sort((left, right) =>
    side === "support"
      ? right.representativePrice - left.representativePrice
      : left.representativePrice - right.representativePrice,
  );
}

function compactSnapshotZones(
  zones: FinalLevelZone[],
  currentPrice: number,
  side: "support" | "resistance",
): FinalLevelZone[] {
  const compacted: FinalLevelZone[] = [];
  const tolerance = snapshotDisplayCompactionTolerance(Math.max(currentPrice, 0.0001));
  for (const zone of sortSnapshotZones(zones, side)) {
    const last = compacted.at(-1);
    if (!last) {
      compacted.push(zone);
      continue;
    }
    const sameDisplayPrice =
      formatSnapshotLevel(last.representativePrice) === formatSnapshotLevel(zone.representativePrice);
    const veryClose = Math.abs(last.representativePrice - zone.representativePrice) <= tolerance;
    if (!sameDisplayPrice && !veryClose) {
      compacted.push(zone);
      continue;
    }
    if (isBetterSnapshotRepresentative(zone, last, currentPrice, side)) {
      compacted[compacted.length - 1] = zone;
    }
  }
  return compacted;
}

function isImportantAtPriceDecisionZone(
  zone: FinalLevelZone,
  currentPrice: number,
  tolerance: number,
  side: "support" | "resistance",
): boolean {
  const important =
    zone.strengthLabel === "major" ||
    zone.strengthLabel === "strong" ||
    zone.strengthScore >= 25 ||
    zone.confluenceCount >= 2 ||
    zone.sourceEvidenceCount >= 3;
  const lowPricedStructuralShelf =
    currentPrice < 1 &&
    zone.strengthLabel === "moderate" &&
    zone.strengthScore >= 15 &&
    zone.timeframeSources.some((timeframe) => timeframe === "daily" || timeframe === "4h");
  if (!important && !lowPricedStructuralShelf) {
    return false;
  }

  const nearDecisionTolerance = Math.max(tolerance, currentPrice * 0.006);
  if (side === "support") {
    if (zone.zoneLow <= currentPrice && zone.zoneHigh >= currentPrice) {
      return true;
    }
    return zone.zoneHigh <= currentPrice && currentPrice - zone.zoneHigh <= nearDecisionTolerance;
  }

  if (zone.zoneLow <= currentPrice && zone.zoneHigh >= currentPrice) {
    return true;
  }
  return zone.zoneLow >= currentPrice && zone.zoneLow - currentPrice <= nearDecisionTolerance;
}

function isSnapshotZoneDisplayableForSide(
  zone: FinalLevelZone,
  currentPrice: number,
  tolerance: number,
  side: "support" | "resistance",
): boolean {
  const zoneWidth = Math.abs(zone.zoneHigh - zone.zoneLow);
  const wideEnoughToMatterAtPrice = zoneWidth >= tolerance * 2;
  return side === "support"
    ? zone.representativePrice < currentPrice - tolerance ||
        (zone.zoneLow < currentPrice && wideEnoughToMatterAtPrice) ||
        isImportantAtPriceDecisionZone(zone, currentPrice, tolerance, side)
    : zone.representativePrice > currentPrice + tolerance ||
        (zone.zoneHigh > currentPrice && wideEnoughToMatterAtPrice) ||
        isImportantAtPriceDecisionZone(zone, currentPrice, tolerance, side);
}

function buildSnapshotDisplayZones(
  zones: FinalLevelZone[],
  _currentPrice: number,
  side: "support" | "resistance",
): LevelSnapshotDisplayZone[] {
  return sortSnapshotZones(zones, side).map((zone) => ({
    representativePrice: zone.representativePrice,
    strengthLabel: zone.strengthLabel,
    freshness: zone.freshness,
    isExtension: zone.isExtension,
    sourceLabel: deriveSnapshotLevelSourceLabel(zone),
  }));
}

function flipWrongSideSnapshotZone(
  zone: FinalLevelZone,
  side: "support" | "resistance",
): FinalLevelZone {
  return {
    ...zone,
    id: `${zone.id}-as-${side}`,
    kind: side,
    notes: [...zone.notes, `snapshot_role_flip:${zone.kind}_as_${side}`],
  };
}

function buildSnapshotSideZones(params: {
  primaryZones: FinalLevelZone[];
  oppositeZones: FinalLevelZone[];
  currentPrice: number;
  tolerance: number;
  side: "support" | "resistance";
  maxForwardResistancePrice: number;
}): FinalLevelZone[] {
  const maxFlipDistancePct = params.side === "support" ? 0.12 : 0.08;
  const roleFlippedZones = params.oppositeZones
    .map((zone) => flipWrongSideSnapshotZone(zone, params.side))
    .filter((zone) =>
      isSnapshotZoneDisplayableForSide(
        zone,
        params.currentPrice,
        params.tolerance,
        params.side,
      ),
    )
    .filter((zone) =>
      params.side === "resistance"
        ? zone.zoneLow <= params.maxForwardResistancePrice
        : true,
    )
    .filter((zone) =>
      params.side === "resistance"
        ? zone.representativePrice > params.currentPrice + params.tolerance ||
            isImportantAtPriceDecisionZone(zone, params.currentPrice, params.tolerance, params.side)
        : zone.representativePrice < params.currentPrice - params.tolerance ||
            isImportantAtPriceDecisionZone(zone, params.currentPrice, params.tolerance, params.side),
    )
    .filter((zone) => {
      const distancePct =
        Math.abs(zone.representativePrice - params.currentPrice) /
        Math.max(params.currentPrice, 0.0001);
      return distancePct <= maxFlipDistancePct;
    })
    .sort((left, right) =>
      params.side === "support"
        ? right.representativePrice - left.representativePrice
        : left.representativePrice - right.representativePrice,
    )
    .slice(0, 2);

  return [...params.primaryZones, ...roleFlippedZones];
}

function hasNearbySnapshotZone(zones: FinalLevelZone[], price: number): boolean {
  return zones.some((zone) => {
    if (formatSnapshotLevel(zone.representativePrice) === formatSnapshotLevel(price)) {
      return true;
    }

    const distancePct =
      Math.abs(zone.representativePrice - price) /
      Math.max(Math.max(zone.representativePrice, price), 0.0001);
    return distancePct <= SNAPSHOT_CONTINUATION_MAP_MIN_STEP_PCT;
  });
}

function buildSnapshotContinuationMapZone(params: {
  symbol: string;
  price: number;
  currentPrice: number;
  timestamp: number;
}): FinalLevelZone {
  return {
    id: `${params.symbol}-snapshot-continuation-resistance-${formatSnapshotLevel(params.price)}`,
    symbol: params.symbol,
    kind: "resistance",
    timeframeBias: "5m",
    zoneLow: params.price,
    zoneHigh: params.price,
    representativePrice: params.price,
    strengthScore: 0,
    strengthLabel: "weak",
    touchCount: 0,
    confluenceCount: 0,
    sourceTypes: ["swing_high"],
    timeframeSources: ["5m"],
    reactionQualityScore: 0,
    rejectionScore: 0,
    displacementScore: 0,
    sessionSignificanceScore: 0,
    followThroughScore: 0,
    gapContinuationScore: 0,
    sourceEvidenceCount: 0,
    firstTimestamp: params.timestamp,
    lastTimestamp: params.timestamp,
    isExtension: false,
    freshness: "fresh",
    notes: [
      "snapshot_continuation_map",
      `snapshotContinuationFrom=${formatSnapshotLevel(params.currentPrice)}`,
    ],
  };
}

function addSnapshotContinuationResistanceMap(params: {
  zones: FinalLevelZone[];
  currentPrice: number;
  maxForwardResistancePrice: number;
  symbol: string;
  timestamp: number;
}): FinalLevelZone[] {
  if (
    !Number.isFinite(params.currentPrice) ||
    params.currentPrice <= 0 ||
    params.currentPrice >= 30
  ) {
    return params.zones;
  }

  const sorted = sortSnapshotZones(params.zones, "resistance").filter(
    (zone) =>
      Number.isFinite(zone.representativePrice) &&
      zone.representativePrice > params.currentPrice &&
      zone.zoneLow <= params.maxForwardResistancePrice,
  );
  const additions: FinalLevelZone[] = [];

  for (
    let index = 0;
    index < sorted.length - 1 && additions.length < SNAPSHOT_CONTINUATION_MAP_MAX_LEVELS;
    index += 1
  ) {
    const left = sorted[index]!;
    const right = sorted[index + 1]!;
    const gapPct =
      (right.representativePrice - left.representativePrice) /
      Math.max(params.currentPrice, 0.0001);

    if (gapPct < SNAPSHOT_CONTINUATION_MAP_MIN_GAP_PCT) {
      continue;
    }

    const ceiling = Math.min(
      right.representativePrice * 0.999,
      params.maxForwardResistancePrice,
      params.currentPrice * (1 + SNAPSHOT_CONTINUATION_MAP_TARGET_PCT),
    );
    let basePrice = left.representativePrice;

    for (
      let guard = 0;
      guard < 24 && additions.length < SNAPSHOT_CONTINUATION_MAP_MAX_LEVELS;
      guard += 1
    ) {
      const nextPrice = nextSnapshotContinuationResistance(basePrice);
      if (!Number.isFinite(nextPrice) || nextPrice <= basePrice || nextPrice >= ceiling) {
        break;
      }

      basePrice = nextPrice;
      if (hasNearbySnapshotZone([...sorted, ...additions], nextPrice)) {
        continue;
      }

      additions.push(
        buildSnapshotContinuationMapZone({
          symbol: params.symbol,
          price: nextPrice,
          currentPrice: params.currentPrice,
          timestamp: params.timestamp,
        }),
      );
    }
  }

  return additions.length > 0
    ? sortSnapshotZones([...params.zones, ...additions], "resistance")
    : params.zones;
}

function buildSnapshotAuditZones(params: {
  zones: FinalLevelZone[];
  displayedZoneIds: Set<string>;
  side: "support" | "resistance";
  bucket: "surfaced" | "extension";
  currentPrice: number;
  tolerance: number;
  maxForwardResistancePrice: number;
}): LevelSnapshotAuditZone[] {
  return sortSnapshotZones(params.zones, params.side).map((zone) => {
    const displayed = params.displayedZoneIds.has(zone.id);
    const wrongSide = !isSnapshotZoneDisplayableForSide(zone, params.currentPrice, params.tolerance, params.side);
    const outsideForwardRange = params.side === "resistance" && zone.zoneLow > params.maxForwardResistancePrice;
    return {
      id: zone.id,
      side: params.side,
      bucket: params.bucket,
      representativePrice: zone.representativePrice,
      zoneLow: zone.zoneLow,
      zoneHigh: zone.zoneHigh,
      strengthLabel: zone.strengthLabel,
      strengthScore: zone.strengthScore,
      confluenceCount: zone.confluenceCount,
      sourceEvidenceCount: zone.sourceEvidenceCount,
      timeframeBias: zone.timeframeBias,
      timeframeSources: [...zone.timeframeSources],
      sourceTypes: [...zone.sourceTypes],
      sourceLabel: deriveSnapshotLevelSourceLabel(zone),
      freshness: zone.freshness,
      isExtension: zone.isExtension,
      displayed,
      omittedReason: displayed
        ? "displayed"
        : wrongSide
          ? "wrong_side"
          : outsideForwardRange
            ? "outside_forward_range"
            : "compacted",
    };
  });
}

function buildSnapshotPayload(params: {
  symbol: string;
  levels: ReturnType<LevelStore["getLevels"]>;
  supportZones: FinalLevelZone[];
  resistanceZones: FinalLevelZone[];
  timestamp: number;
  currentPrice: number;
}): LevelSnapshotPayload {
  const currentPrice = Math.max(params.currentPrice, 0);
  const tolerance = snapshotPriceTolerance(Math.max(currentPrice, 0.0001));
  const maxForwardResistancePrice = currentPrice * (1 + snapshotForwardResistanceRangePct(currentPrice));
  const extensionResistanceCandidates = params.levels?.extensionLevels.resistance ?? [];
  const extensionResistanceZones = extensionResistanceCandidates.filter(
    (zone) =>
      isSnapshotZoneDisplayableForSide(zone, currentPrice, tolerance, "resistance") &&
      zone.zoneLow <= maxForwardResistancePrice,
  );
  const supportCandidatesForDisplay = buildSnapshotSideZones({
    primaryZones: params.supportZones.filter((zone) =>
      isSnapshotZoneDisplayableForSide(zone, currentPrice, tolerance, "support"),
    ),
    oppositeZones: params.resistanceZones,
    currentPrice,
    tolerance,
    side: "support",
    maxForwardResistancePrice,
  });
  const resistanceCandidatesForDisplay = buildSnapshotSideZones({
    primaryZones: [...params.resistanceZones, ...extensionResistanceZones].filter(
      (zone) =>
        isSnapshotZoneDisplayableForSide(zone, currentPrice, tolerance, "resistance") &&
        zone.zoneLow <= maxForwardResistancePrice,
    ),
    oppositeZones: params.supportZones,
    currentPrice,
    tolerance,
    side: "resistance",
    maxForwardResistancePrice,
  });
  const resistanceCandidatesWithContinuationMap = addSnapshotContinuationResistanceMap({
    zones: resistanceCandidatesForDisplay,
    currentPrice,
    maxForwardResistancePrice,
    symbol: params.symbol,
    timestamp: params.timestamp,
  });
  const supportZones = compactSnapshotZones(
    supportCandidatesForDisplay,
    currentPrice,
    "support",
  );
  const resistanceZones = compactSnapshotZones(
    resistanceCandidatesWithContinuationMap,
    currentPrice,
    "resistance",
  );
  const ladderSupportZones = sortSnapshotZones(
    supportCandidatesForDisplay,
    "support",
  );
  const ladderResistanceZones = sortSnapshotZones(
    resistanceCandidatesWithContinuationMap,
    "resistance",
  );
  const displayedSupportIds = supportZones.map((zone) => zone.id);
  const displayedResistanceIds = resistanceZones.map((zone) => zone.id);
  const displayedSupportIdSet = new Set([
    ...displayedSupportIds,
    ...displayedResistanceIds
      .filter((id) => id.endsWith("-as-resistance"))
      .map((id) => id.slice(0, -"-as-resistance".length)),
  ]);
  const displayedResistanceIdSet = new Set([
    ...displayedResistanceIds,
    ...displayedSupportIds
      .filter((id) => id.endsWith("-as-support"))
      .map((id) => id.slice(0, -"-as-support".length)),
  ]);
  const audit: LevelSnapshotAudit = {
    referencePrice: currentPrice,
    displayTolerance: tolerance,
    forwardResistanceLimit: maxForwardResistancePrice,
    displayedSupportIds,
    displayedResistanceIds,
    supportCandidates: buildSnapshotAuditZones({
      zones: params.supportZones,
      displayedZoneIds: displayedSupportIdSet,
      side: "support",
      bucket: "surfaced",
      currentPrice,
      tolerance,
      maxForwardResistancePrice,
    }),
    resistanceCandidates: [
      ...buildSnapshotAuditZones({
        zones: params.resistanceZones,
        displayedZoneIds: displayedResistanceIdSet,
        side: "resistance",
        bucket: "surfaced",
        currentPrice,
        tolerance,
        maxForwardResistancePrice,
      }),
      ...buildSnapshotAuditZones({
        zones: extensionResistanceCandidates,
        displayedZoneIds: displayedResistanceIdSet,
        side: "resistance",
        bucket: "extension",
        currentPrice,
        tolerance,
        maxForwardResistancePrice,
      }),
    ],
    omittedSupportCount: 0,
    omittedResistanceCount: 0,
  };
  audit.omittedSupportCount = audit.supportCandidates.filter((candidate) => !candidate.displayed).length;
  audit.omittedResistanceCount = audit.resistanceCandidates.filter((candidate) => !candidate.displayed).length;
  return {
    symbol: params.symbol,
    currentPrice,
    supportZones: buildSnapshotDisplayZones(supportZones, currentPrice, "support"),
    resistanceZones: buildSnapshotDisplayZones(resistanceZones, currentPrice, "resistance"),
    ladderSupportZones: buildSnapshotDisplayZones(ladderSupportZones, currentPrice, "support"),
    ladderResistanceZones: buildSnapshotDisplayZones(ladderResistanceZones, currentPrice, "resistance"),
    timestamp: params.timestamp,
    audit,
  };
}

async function readWarehouseCandles(
  warehouse: DurableCandleWarehouse,
  symbol: string,
  timeframe: CandleTimeframe,
  startTimestamp: number,
  endTimestamp: number,
): Promise<Candle[]> {
  return warehouse.getCandles({
    provider: PROVIDER,
    symbol,
    timeframe,
    startTimestamp,
    endTimestamp,
  });
}

async function buildReplayPayloadAt(
  warehouse: DurableCandleWarehouse,
  item: ReplayCase,
  timestamp: number,
) {
  const symbol = item.symbol.toUpperCase();
  const dayStart = startOfEasternDay(item.date);
  const daily = await readWarehouseCandles(
    warehouse,
    symbol,
    "daily",
    dayStart - 420 * timeframeMs("daily"),
    dayStart - 1,
  );
  const fourHour = await readWarehouseCandles(
    warehouse,
    symbol,
    "4h",
    timestamp - 220 * timeframeMs("4h"),
    timestamp,
  );
  const fiveMinute = await readWarehouseCandles(
    warehouse,
    symbol,
    "5m",
    timestamp - 420 * timeframeMs("5m"),
    timestamp,
  );
  const currentPrice = fiveMinute.at(-1)?.close ?? fourHour.at(-1)?.close ?? daily.at(-1)?.close;
  if (!currentPrice || daily.length === 0 || fourHour.length === 0) {
    return {
      symbol,
      status: "missing_candles" as const,
      asOf: timestamp,
      dailyCount: daily.length,
      fourHourCount: fourHour.length,
      fiveMinuteCount: fiveMinute.length,
      currentPrice: currentPrice ?? null,
    };
  }
  const context = await buildSupportResistanceContextFromNormalizedCandles({
    symbol,
    candlesByTimeframe: {
      daily,
      "4h": fourHour,
      "5m": fiveMinute,
    },
    asOfTimestamp: timestamp,
    sessionDate: item.date,
    currentPrice,
  });
  const store = new LevelStore();
  store.setLevels(context.levels);
  const payload = buildSnapshotPayload({
    symbol,
    levels: store.getLevels(symbol),
    supportZones: store.getSupportZones(symbol),
    resistanceZones: store.getResistanceZones(symbol),
    timestamp,
    currentPrice,
  });
  return {
    symbol,
    status: "ok" as const,
    date: item.date,
    time: item.time,
    asOf: timestamp,
    dailyCount: daily.length,
    fourHourCount: fourHour.length,
    fiveMinuteCount: fiveMinute.length,
    currentPrice,
    payload,
    snapshot: formatLevelSnapshotMessage(payload),
    ladder: formatLevelLadderMessage(payload),
    audit: payload.audit,
  };
}

function displayedResistanceTop(payload: LevelSnapshotPayload): number | null {
  const displayed = payload.audit?.resistanceCandidates.filter((zone) => zone.displayed) ?? [];
  const values = displayed.map((zone) => zone.zoneHigh || zone.representativePrice);
  return values.length > 0 ? Math.max(...values) : null;
}

function displayedSupportBottom(payload: LevelSnapshotPayload): number | null {
  const displayed = payload.audit?.supportCandidates.filter((zone) => zone.displayed) ?? [];
  const values = displayed.map((zone) => zone.zoneLow || zone.representativePrice);
  return values.length > 0 ? Math.min(...values) : null;
}

function ladderResistanceTop(payload: LevelSnapshotPayload): number | null {
  const values = payload.ladderResistanceZones?.map((zone) => zone.representativePrice) ?? [];
  return values.length > 0 ? Math.max(...values) : null;
}

function ladderSupportBottom(payload: LevelSnapshotPayload): number | null {
  const values = payload.ladderSupportZones?.map((zone) => zone.representativePrice) ?? [];
  return values.length > 0 ? Math.min(...values) : null;
}

async function buildForwardExhaustionAudit(params: {
  warehouse: DurableCandleWarehouse;
  item: ReplayCase;
  startPayload: LevelSnapshotPayload;
  asOf: number;
  horizonHours: number;
}) {
  const symbol = params.item.symbol.toUpperCase();
  const endTimestamp = params.asOf + params.horizonHours * 60 * 60 * 1000;
  const forwardCandles = await readWarehouseCandles(
    params.warehouse,
    symbol,
    "5m",
    params.asOf + 1,
    endTimestamp,
  );
  const resistanceTop = displayedResistanceTop(params.startPayload);
  const supportBottom = displayedSupportBottom(params.startPayload);
  const fullLadderResistanceTop = ladderResistanceTop(params.startPayload);
  const fullLadderSupportBottom = ladderSupportBottom(params.startPayload);
  const maxHighCandle = forwardCandles.reduce<Candle | null>(
    (best, candle) => (!best || candle.high > best.high ? candle : best),
    null,
  );
  const minLowCandle = forwardCandles.reduce<Candle | null>(
    (best, candle) => (!best || candle.low < best.low ? candle : best),
    null,
  );
  const firstResistanceHit = resistanceTop
    ? forwardCandles.find((candle) => candle.high >= resistanceTop * (1 - MAP_EXHAUSTION_BUFFER_PCT)) ?? null
    : null;
  const firstResistanceBreak = resistanceTop
    ? forwardCandles.find((candle) => candle.high > resistanceTop * (1 + MAP_EXHAUSTION_BUFFER_PCT)) ?? null
    : null;
  const firstSupportHit = supportBottom
    ? forwardCandles.find((candle) => candle.low <= supportBottom * (1 + MAP_EXHAUSTION_BUFFER_PCT)) ?? null
    : null;
  const firstSupportBreak = supportBottom
    ? forwardCandles.find((candle) => candle.low < supportBottom * (1 - MAP_EXHAUSTION_BUFFER_PCT)) ?? null
    : null;
  const refreshAtResistanceHit = firstResistanceHit
    ? await buildReplayPayloadAt(params.warehouse, params.item, firstResistanceHit.timestamp)
    : null;
  const refreshAtSupportHit = firstSupportHit
    ? await buildReplayPayloadAt(params.warehouse, params.item, firstSupportHit.timestamp)
    : null;
  const refreshResistanceTop =
    refreshAtResistanceHit && refreshAtResistanceHit.status === "ok"
      ? displayedResistanceTop(refreshAtResistanceHit.payload)
      : null;
  const refreshSupportBottom =
    refreshAtSupportHit && refreshAtSupportHit.status === "ok"
      ? displayedSupportBottom(refreshAtSupportHit.payload)
      : null;

  return {
    horizonHours: params.horizonHours,
    forwardCandleCount: forwardCandles.length,
    startDisplayedResistanceTop: resistanceTop,
    startDisplayedSupportBottom: supportBottom,
    startFullLadderResistanceTop: fullLadderResistanceTop,
    startFullLadderSupportBottom: fullLadderSupportBottom,
    maxForwardHigh: maxHighCandle?.high ?? null,
    maxForwardHighAt: maxHighCandle?.timestamp ?? null,
    minForwardLow: minLowCandle?.low ?? null,
    minForwardLowAt: minLowCandle?.timestamp ?? null,
    resistanceTopPctFromStart:
      resistanceTop && params.startPayload.currentPrice
        ? ((resistanceTop / params.startPayload.currentPrice) - 1) * 100
        : null,
    fullLadderResistanceTopPctFromStart:
      fullLadderResistanceTop && params.startPayload.currentPrice
        ? ((fullLadderResistanceTop / params.startPayload.currentPrice) - 1) * 100
        : null,
    maxForwardHighPctFromStart:
      maxHighCandle && params.startPayload.currentPrice
        ? ((maxHighCandle.high / params.startPayload.currentPrice) - 1) * 100
        : null,
    minForwardLowPctFromStart:
      minLowCandle && params.startPayload.currentPrice
        ? ((minLowCandle.low / params.startPayload.currentPrice) - 1) * 100
        : null,
    firstResistanceHitAt: firstResistanceHit?.timestamp ?? null,
    firstResistanceBreakAt: firstResistanceBreak?.timestamp ?? null,
    firstSupportHitAt: firstSupportHit?.timestamp ?? null,
    firstSupportBreakAt: firstSupportBreak?.timestamp ?? null,
    refreshResistanceTop,
    refreshSupportBottom,
    closestResistanceMapExhausted: Boolean(firstResistanceBreak),
    closestSupportMapExhausted: Boolean(firstSupportBreak),
    fullResistanceLadderExhausted: Boolean(
      fullLadderResistanceTop && maxHighCandle && maxHighCandle.high > fullLadderResistanceTop * (1 + MAP_EXHAUSTION_BUFFER_PCT),
    ),
    fullSupportLadderExhausted: Boolean(
      fullLadderSupportBottom && minLowCandle && minLowCandle.low < fullLadderSupportBottom * (1 - MAP_EXHAUSTION_BUFFER_PCT),
    ),
    refreshWouldAddHigherResistance: Boolean(
      resistanceTop && refreshResistanceTop && refreshResistanceTop > resistanceTop * (1 + MAP_EXHAUSTION_BUFFER_PCT),
    ),
    refreshWouldAddLowerSupport: Boolean(
      supportBottom && refreshSupportBottom && refreshSupportBottom < supportBottom * (1 - MAP_EXHAUSTION_BUFFER_PCT),
    ),
  };
}

async function replayCase(warehouse: DurableCandleWarehouse, item: ReplayCase, horizonHours: number) {
  const start = await buildReplayPayloadAt(warehouse, item, parseEasternTimestamp(item.date, item.time));
  if (start.status !== "ok") {
    return start;
  }
  return {
    ...start,
    forwardAudit: await buildForwardExhaustionAudit({
      warehouse,
      item,
      startPayload: start.payload,
      asOf: start.asOf,
      horizonHours,
    }),
  };
}

function formatMarkdown(results: Array<Awaited<ReturnType<typeof replayCase>>>): string {
  const lines = [
    "# Specific Ticker Date Replay",
    "",
    "Generated: 2026-05-04 America/Toronto",
    "",
    "No-lookahead rules: daily uses completed prior daily candles only; 4h and 5m use candles at or before the requested timestamp.",
    "",
  ];
  for (const result of results) {
    lines.push(`## ${result.symbol}`, "");
    if (result.status !== "ok") {
      lines.push(
        `Status: ${result.status}`,
        `Candles: daily ${result.dailyCount}, 4h ${result.fourHourCount}, 5m ${result.fiveMinuteCount}`,
        "",
      );
      continue;
    }
    lines.push(
      `Requested: ${result.date} ${result.time} ET`,
      `Replay price: ${result.currentPrice}`,
      `Candles: daily ${result.dailyCount}, 4h ${result.fourHourCount}, 5m ${result.fiveMinuteCount}`,
      `Snapshot omitted resistance: ${result.audit?.omittedResistanceCount ?? 0}`,
      "",
      "### Snapshot Preview",
      "",
      "```text",
      result.snapshot,
      "```",
      "",
      "### Full Ladder Preview",
      "",
      "```text",
      result.ladder ?? "No ladder message generated.",
      "```",
      "",
    );
    if (result.forwardAudit) {
      const audit = result.forwardAudit;
      const findings = [
        audit.closestResistanceMapExhausted ? "closest resistance map was exhausted" : null,
        audit.fullResistanceLadderExhausted ? "full resistance ladder was exhausted" : null,
        audit.refreshWouldAddHigherResistance ? "refresh would add higher resistance" : null,
        audit.closestSupportMapExhausted ? "closest support map was exhausted" : null,
        audit.fullSupportLadderExhausted ? "full support ladder was exhausted" : null,
        audit.refreshWouldAddLowerSupport ? "refresh would add lower support" : null,
      ].filter(Boolean);
      lines.push(
        "### Forward Exhaustion Audit",
        "",
        `Window: ${audit.horizonHours}h after requested start`,
        `Forward 5m candles: ${audit.forwardCandleCount}`,
        `Max high: ${audit.maxForwardHigh ?? "n/a"} (${formatPercent(audit.maxForwardHighPctFromStart)}) at ${formatEasternTime(audit.maxForwardHighAt)}`,
        `Min low: ${audit.minForwardLow ?? "n/a"} (${formatPercent(audit.minForwardLowPctFromStart)}) at ${formatEasternTime(audit.minForwardLowAt)}`,
        `Start closest resistance top: ${audit.startDisplayedResistanceTop ?? "n/a"} (${formatPercent(audit.resistanceTopPctFromStart)})`,
        `Start full ladder resistance top: ${audit.startFullLadderResistanceTop ?? "n/a"} (${formatPercent(audit.fullLadderResistanceTopPctFromStart)})`,
        `First hit/break of closest resistance top: ${formatEasternTime(audit.firstResistanceHitAt)} / ${formatEasternTime(audit.firstResistanceBreakAt)}`,
        `Resistance refresh top at first hit: ${audit.refreshResistanceTop ?? "n/a"}`,
        `Start closest support bottom: ${audit.startDisplayedSupportBottom ?? "n/a"}`,
        `Start full ladder support bottom: ${audit.startFullLadderSupportBottom ?? "n/a"}`,
        `First hit/break of closest support bottom: ${formatEasternTime(audit.firstSupportHitAt)} / ${formatEasternTime(audit.firstSupportBreakAt)}`,
        `Support refresh bottom at first hit: ${audit.refreshSupportBottom ?? "n/a"}`,
        `Finding: ${findings.length > 0 ? findings.join("; ") : "no map exhaustion inside this replay window"}`,
        "",
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

const outDir = argValue("--out-dir") ?? DEFAULT_OUT_DIR;
const horizonHours = numberArg("--horizon-hours", DEFAULT_HORIZON_HOURS);
await mkdir(outDir, { recursive: true });
const warehouse = new DurableCandleWarehouse(WAREHOUSE_ROOT);
const results = [];
for (const item of DEFAULT_CASES) {
  results.push(await replayCase(warehouse, item, horizonHours));
}
await writeFile(join(outDir, "specific-ticker-date-replay.json"), `${JSON.stringify(results, null, 2)}\n`);
await writeFile(join(outDir, "specific-ticker-date-replay.md"), formatMarkdown(results));
console.log(`Specific ticker replay wrote ${join(outDir, "specific-ticker-date-replay.md")}`);
