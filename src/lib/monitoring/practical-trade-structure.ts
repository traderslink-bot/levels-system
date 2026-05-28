import type { FinalLevelZone } from "../levels/level-types.js";
import type {
  MonitoringEvent,
  MonitoringEventType,
  PracticalTradeArea,
  PracticalTradeStructureContext,
  PracticalTradeStructureState,
  SymbolMonitoringState,
} from "./monitoring-types.js";

const RECENT_STRUCTURE_WINDOW_MS = 60 * 60 * 1000;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function formatLevel(value: number): string {
  return value >= 1 ? value.toFixed(2) : value.toFixed(4);
}

function areaTolerancePct(referencePrice: number): number {
  if (referencePrice < 1) {
    return 0.045;
  }
  if (referencePrice < 2) {
    return 0.04;
  }
  if (referencePrice < 10) {
    return 0.03;
  }
  if (referencePrice < 50) {
    return 0.022;
  }
  return 0.018;
}

function areaToleranceAbs(referencePrice: number): number {
  if (referencePrice < 1) {
    return 0.015;
  }
  if (referencePrice < 2) {
    return 0.025;
  }
  if (referencePrice < 10) {
    return 0.06;
  }
  if (referencePrice < 50) {
    return 0.35;
  }
  return 0.75;
}

function zoneLow(zone: FinalLevelZone): number {
  return Math.min(zone.zoneLow, zone.zoneHigh, zone.representativePrice);
}

function zoneHigh(zone: FinalLevelZone): number {
  return Math.max(zone.zoneLow, zone.zoneHigh, zone.representativePrice);
}

function zoneRepresentative(zone: FinalLevelZone): number {
  return zone.representativePrice;
}

function sourceLabel(zone: FinalLevelZone): string | undefined {
  if (zone.timeframeBias === "daily" && zone.confluenceCount > 1) {
    return "daily confluence";
  }
  if (zone.timeframeBias === "daily") {
    return "daily structure";
  }
  if (zone.timeframeBias === "4h" && zone.confluenceCount > 1) {
    return "4h confluence";
  }
  if (zone.timeframeBias === "4h") {
    return "4h structure";
  }
  if (zone.freshness === "fresh") {
    return "fresh intraday";
  }
  return "intraday structure";
}

function strengthRank(strength?: FinalLevelZone["strengthLabel"]): number {
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

function traderStrength(strength?: FinalLevelZone["strengthLabel"]): string {
  switch (strength) {
    case "weak":
      return "light";
    case "strong":
      return "heavy";
    case "moderate":
    case "major":
      return strength;
    default:
      return "";
  }
}

function isIntradayZone(zone: FinalLevelZone): boolean {
  return zone.timeframeBias === "5m" || zone.freshness === "fresh";
}

function chooseAreaStrength(zones: FinalLevelZone[]): FinalLevelZone["strengthLabel"] | undefined {
  return [...zones].sort((left, right) => strengthRank(right.strengthLabel) - strengthRank(left.strengthLabel))[0]?.strengthLabel;
}

function chooseAreaSource(zones: FinalLevelZone[]): string | undefined {
  const ranked = [...zones].sort((left, right) => {
    const leftSourceRank = left.timeframeBias === "daily" ? 3 : left.timeframeBias === "4h" ? 2 : 1;
    const rightSourceRank = right.timeframeBias === "daily" ? 3 : right.timeframeBias === "4h" ? 2 : 1;
    return rightSourceRank - leftSourceRank || right.confluenceCount - left.confluenceCount;
  })[0];
  return ranked ? sourceLabel(ranked) : undefined;
}

function buildArea(side: "support" | "resistance", zones: FinalLevelZone[]): PracticalTradeArea | undefined {
  if (zones.length === 0) {
    return undefined;
  }

  const low = Math.min(...zones.map(zoneLow));
  const high = Math.max(...zones.map(zoneHigh));
  const representative =
    side === "support"
      ? Math.max(...zones.map(zoneRepresentative))
      : Math.min(...zones.map(zoneRepresentative));

  return {
    side,
    low,
    high,
    representative,
    strengthLabel: chooseAreaStrength(zones),
    sourceLabel: chooseAreaSource(zones),
    zoneCount: zones.length,
  };
}

function clusterAroundZone(params: {
  zones: FinalLevelZone[];
  side: "support" | "resistance";
  anchor: FinalLevelZone;
  referencePrice: number;
}): PracticalTradeArea | undefined {
  const tolerancePct = areaTolerancePct(params.referencePrice);
  const toleranceAbs = areaToleranceAbs(params.referencePrice);
  const anchorMid = zoneRepresentative(params.anchor);
  const cluster = params.zones.filter((zone) => {
    const distance = Math.abs(zoneRepresentative(zone) - anchorMid);
    const pct = distance / Math.max(Math.abs(anchorMid), 0.0001);
    return distance <= toleranceAbs || pct <= tolerancePct;
  });
  return buildArea(params.side, cluster);
}

function nearestArea(params: {
  zones: FinalLevelZone[];
  side: "support" | "resistance";
  price: number;
}): PracticalTradeArea | undefined {
  const candidates = params.zones
    .filter((zone) => params.side === "support" ? zoneLow(zone) <= params.price : zoneHigh(zone) >= params.price)
    .sort((left, right) =>
      params.side === "support"
        ? zoneHigh(right) - zoneHigh(left)
        : zoneLow(left) - zoneLow(right),
    );
  const anchor = candidates[0];
  if (!anchor) {
    return undefined;
  }
  return clusterAroundZone({
    zones: params.zones,
    side: params.side,
    anchor,
    referencePrice: params.price,
  });
}

function nearestIntradaySupportArea(symbolState: SymbolMonitoringState, price: number): PracticalTradeArea | undefined {
  const candidates = symbolState.supportZones
    .filter((zone) => zoneHigh(zone) <= price && isIntradayZone(zone))
    .sort((left, right) => zoneHigh(right) - zoneHigh(left));
  const anchor = candidates[0];
  if (!anchor) {
    return undefined;
  }
  return clusterAroundZone({
    zones: symbolState.supportZones.filter(isIntradayZone),
    side: "support",
    anchor,
    referencePrice: price,
  });
}

function areaKey(area: PracticalTradeArea | undefined): string {
  if (!area) {
    return "none";
  }
  return `${area.side}:${formatLevel(area.low)}-${formatLevel(area.high)}`;
}

function formatArea(area: PracticalTradeArea | undefined, fallbackSide: "support" | "resistance"): string {
  if (!area) {
    return `${fallbackSide}`;
  }
  const strength = traderStrength(area.strengthLabel);
  const label = strength ? `${strength} ${area.side}` : area.side;
  if (Math.abs(area.high - area.low) <= Math.max(area.representative * 0.002, 0.005)) {
    return `${label} ${formatLevel(area.representative)}`;
  }
  return `${label} ${formatLevel(area.low)}-${formatLevel(area.high)} area`;
}

function recentEvents(symbolState: SymbolMonitoringState, timestamp: number): MonitoringEvent[] {
  return symbolState.recentEvents.filter((event) => timestamp - event.timestamp <= RECENT_STRUCTURE_WINDOW_MS);
}

function recentSameSideTests(events: MonitoringEvent[], side: "support" | "resistance"): number {
  return events.filter((event) =>
    event.zoneKind === side &&
    (event.eventType === "level_touch" || event.eventType === "compression"),
  ).length;
}

function recentFailures(events: MonitoringEvent[]): number {
  return events.filter((event) =>
    event.eventType === "fake_breakout" ||
    event.eventType === "fake_breakdown" ||
    event.eventType === "rejection",
  ).length;
}

function stateForEvent(params: {
  eventType: MonitoringEventType;
  zone: FinalLevelZone;
  price: number;
  supportArea?: PracticalTradeArea;
  resistanceArea?: PracticalTradeArea;
  recent: MonitoringEvent[];
  intradayDirection?: SymbolMonitoringState["intradayStructure"];
}): PracticalTradeStructureState {
  const { eventType, zone, price, supportArea, resistanceArea, recent, intradayDirection } = params;
  const resistanceTests = recentSameSideTests(recent, "resistance");
  const supportTests = recentSameSideTests(recent, "support");
  const failures = recentFailures(recent);
  const baseIsBuilding = intradayDirection?.direction === "building" && (intradayDirection?.higherLowCount ?? 0) >= 2;
  const baseIsFading = intradayDirection?.direction === "fading" && (intradayDirection?.lowerHighCount ?? 0) >= 2;

  if (eventType === "breakout") {
    return "breakout_attempt";
  }
  if (eventType === "reclaim") {
    return price >= (supportArea?.high ?? zoneHigh(zone)) ? "reclaim_holding" : "reclaim_attempt";
  }
  if (eventType === "fake_breakout" || eventType === "rejection") {
    return "breakout_failed";
  }
  if (eventType === "fake_breakdown") {
    return "reclaim_attempt";
  }
  if (eventType === "breakdown") {
    const areaLow = supportArea?.low ?? zoneLow(zone);
    const cleanLossPct = (areaLow - price) / Math.max(areaLow, 0.0001);
    return cleanLossPct >= 0.012 ? "structure_broken" : "support_failing";
  }
  if (eventType === "compression") {
    return zone.kind === "resistance" ? "pressing_resistance" : baseIsFading ? "pullback_to_support" : "building_base";
  }
  if (eventType === "level_touch") {
    if (zone.kind === "resistance") {
      return resistanceTests >= 1 ? "pressing_resistance" : "range_bound";
    }
    if (baseIsBuilding) {
      return "building_base";
    }
    if (supportTests >= 1 && failures === 0) {
      return "support_holding";
    }
    return "pullback_to_support";
  }

  if (supportArea && resistanceArea) {
    const bandPct = (resistanceArea.low - supportArea.high) / Math.max(price, 0.0001);
    return bandPct <= 0.12 ? "range_bound" : "building_base";
  }

  return "range_bound";
}

function stateLine(params: {
  symbol: string;
  state: PracticalTradeStructureState;
  supportArea?: PracticalTradeArea;
  resistanceArea?: PracticalTradeArea;
  momentumSupportArea?: PracticalTradeArea;
  intradayStructure?: SymbolMonitoringState["intradayStructure"];
}): string {
  const support = formatArea(params.supportArea, "support");
  const resistance = formatArea(params.resistanceArea, "resistance");
  const momentum = formatArea(params.momentumSupportArea, "support");
  const buildingSuffix =
    params.intradayStructure?.direction === "building" && params.intradayStructure.higherLowCount >= 2
      ? " Recent 5-minute structure is building higher lows."
      : "";
  const fadingSuffix =
    params.intradayStructure?.direction === "fading" && params.intradayStructure.lowerHighCount >= 2
      ? " Recent 5-minute structure is losing lower highs."
      : "";

  switch (params.state) {
    case "range_bound":
      return `market structure: ${params.symbol} is still range-bound between ${support} and ${resistance}; small moves inside that band are lower-quality noise`;
    case "building_base":
      return `market structure: buyers are trying to build a base above ${support}; the cleaner change comes from expansion through ${resistance}.${buildingSuffix}`;
    case "pressing_resistance":
      return `market structure: price is pressing ${resistance}; acceptance above the whole area would improve the setup`;
    case "breakout_attempt":
      return `market structure: price is trying to turn ${resistance} into support; holding that area keeps the breakout attempt cleaner`;
    case "breakout_holding":
      return `market structure: the breakout area is holding as support, keeping the structure constructive`;
    case "breakout_failed":
      return `market structure: the resistance push failed for now; reclaiming ${resistance} would repair the setup`;
    case "pullback_to_support":
      return `market structure: price is pulling into ${support}; the reaction matters more than tiny moves inside the area.${fadingSuffix}`;
    case "support_holding":
      return `market structure: buyers are still defending ${support}; losing the whole area would weaken the setup`;
    case "support_failing":
      return `market structure: ${support} is failing for now; buyers need a cleaner reclaim of the area`;
    case "structure_broken":
      return `market structure: the support area broke cleanly; the setup needs time to rebuild or reclaim that area`;
    case "reclaim_attempt":
      return `market structure: buyers are trying to reclaim the lost support area; holding above it would repair the setup`;
    case "reclaim_holding":
      return `market structure: buyers reclaimed the support area, which repairs the structure while it holds`;
    default:
      return `market structure: ${params.symbol} is trading between ${support} and ${resistance}`;
  }
}

function significantStateChange(
  previous: PracticalTradeStructureState | undefined,
  next: PracticalTradeStructureState,
): boolean {
  if (!previous || previous === next) {
    return false;
  }

  const rank: Record<PracticalTradeStructureState, number> = {
    range_bound: 0,
    building_base: 1,
    pullback_to_support: 1,
    support_holding: 2,
    pressing_resistance: 2,
    breakout_attempt: 3,
    breakout_holding: 4,
    reclaim_attempt: 3,
    reclaim_holding: 4,
    support_failing: -2,
    breakout_failed: -2,
    structure_broken: -4,
  };

  return Math.abs((rank[next] ?? 0) - (rank[previous] ?? 0)) >= 2;
}

export function derivePracticalTradeStructureContext(params: {
  symbolState: SymbolMonitoringState;
  zone: FinalLevelZone;
  eventType: MonitoringEventType;
  price: number;
  timestamp: number;
}): PracticalTradeStructureContext {
  const supportArea = params.zone.kind === "support"
    ? clusterAroundZone({
        zones: params.symbolState.supportZones,
        side: "support",
        anchor: params.zone,
        referencePrice: params.price,
      })
    : nearestArea({ zones: params.symbolState.supportZones, side: "support", price: params.price });
  const resistanceArea = params.zone.kind === "resistance"
    ? clusterAroundZone({
        zones: params.symbolState.resistanceZones,
        side: "resistance",
        anchor: params.zone,
        referencePrice: params.price,
      })
    : nearestArea({ zones: params.symbolState.resistanceZones, side: "resistance", price: params.price });
  const momentumSupportArea = nearestIntradaySupportArea(params.symbolState, params.price);
  const recent = recentEvents(params.symbolState, params.timestamp);
  const previousState = recent.at(-1)?.eventContext.tradeStructure?.state;
  const state = stateForEvent({
    eventType: params.eventType,
    zone: params.zone,
    price: params.price,
    supportArea,
    resistanceArea,
    recent,
    intradayDirection: params.symbolState.intradayStructure,
  });
  const practicalZoneKey = `${areaKey(supportArea)}|${areaKey(resistanceArea)}`;
  const structureKey = `${state}|${practicalZoneKey}`;

  return {
    state,
    previousState,
    supportArea,
    resistanceArea,
    momentumSupportArea,
    structureKey,
    practicalZoneKey,
    traderLine: stateLine({
      symbol: params.symbolState.symbol,
      state,
      supportArea,
      resistanceArea,
      momentumSupportArea,
      intradayStructure: params.symbolState.intradayStructure,
    }),
    reason: `derived from ${params.eventType} around ${params.zone.kind} ${formatLevel(params.zone.representativePrice)}`,
    isMaterialStateChange: significantStateChange(previousState, state),
  };
}

export function isPracticalStructureExpansion(params: {
  previousTrigger: number;
  nextTrigger: number;
  referencePrice: number;
}): boolean {
  const movePct = Math.abs(params.nextTrigger - params.previousTrigger) / Math.max(Math.abs(params.referencePrice), 0.0001);
  return movePct >= clamp(areaTolerancePct(params.referencePrice) * 0.5, 0.01, 0.025);
}
