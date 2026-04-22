// 2026-04-22 02:10 PM America/Toronto
// Trader-facing wording helpers so downstream alerts explain level quality and setup intent more clearly.

import type { FinalLevelZone } from "../levels/level-types.js";
import type { MonitoringEvent } from "../monitoring/monitoring-types.js";
import type { TraderNextBarrierContext } from "./alert-types.js";

function formatLevel(level: number): string {
  return level >= 1 ? level.toFixed(2) : level.toFixed(4);
}

export function describeZoneStrength(
  strengthLabel: FinalLevelZone["strengthLabel"],
): "light" | "moderate" | "heavy" | "major" {
  switch (strengthLabel) {
    case "weak":
      return "light";
    case "strong":
      return "heavy";
    case "major":
      return "major";
    default:
      return "moderate";
  }
}

export function describeZoneStrengthWithKind(
  strengthLabel: FinalLevelZone["strengthLabel"],
  zoneKind: "support" | "resistance",
): string {
  return `${describeZoneStrength(strengthLabel)} ${zoneKind}`;
}

function formatZoneRange(zone: FinalLevelZone): string {
  return `${formatLevel(zone.zoneLow)}-${formatLevel(zone.zoneHigh)}`;
}

function clearanceDirectionForSide(side: "support" | "resistance"): string {
  return side === "resistance" ? "overhead" : "downside";
}

function describeBarrierRoom(nextBarrier: TraderNextBarrierContext): string {
  const pctText = `${nextBarrier.side === "resistance" ? "+" : "-"}${(nextBarrier.distancePct * 100).toFixed(1)}%`;
  const sideText = clearanceDirectionForSide(nextBarrier.side);

  switch (nextBarrier.clearanceLabel) {
    case "tight":
      return `room: tight ${sideText} into next ${nextBarrier.side} ${formatLevel(nextBarrier.price)} (${pctText})`;
    case "limited":
      return `room: limited ${sideText} into next ${nextBarrier.side} ${formatLevel(nextBarrier.price)} (${pctText})`;
    case "open":
      return `room: open ${sideText} path to next ${nextBarrier.side} ${formatLevel(nextBarrier.price)} (${pctText})`;
    default:
      return `room: next ${nextBarrier.side} ${formatLevel(nextBarrier.price)} (${pctText})`;
  }
}

function describeZonePlacement(
  event: MonitoringEvent,
): string | null {
  if (event.eventContext.zoneOrigin === "promoted_extension") {
    return "promoted extension";
  }

  if (event.eventContext.ladderPosition === "outermost") {
    return "outermost";
  }

  if (event.eventContext.ladderPosition === "extension") {
    return "extension";
  }

  return "inner";
}

function describeZoneContext(event: MonitoringEvent, zone: FinalLevelZone): string {
  const placement = describeZonePlacement(event);
  const freshness = event.eventContext.zoneFreshness;
  const timeframeContext =
    zone.timeframeSources.length > 1
      ? `${zone.timeframeSources.join("/")} confluence`
      : `${zone.timeframeSources[0]} driven`;
  const refreshed = event.eventContext.recentlyRefreshed ? "recently refreshed" : null;
  const degraded = event.eventContext.dataQualityDegraded ? "data quality degraded" : null;

  return [
    `${describeZoneStrengthWithKind(zone.strengthLabel, zone.kind)}${placement ? ` | ${placement}` : ""}`,
    freshness,
    timeframeContext,
    refreshed,
    degraded,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" | ");
}

function buildLeadLine(event: MonitoringEvent, zone?: FinalLevelZone): string {
  if (!zone) {
    return `${event.eventType.replaceAll("_", " ")} at ${formatLevel(event.triggerPrice)}`;
  }

  const descriptor = describeZoneStrengthWithKind(zone.strengthLabel, zone.kind);
  const zoneRange = formatZoneRange(zone);

  switch (event.eventType) {
    case "breakout":
      return `bullish breakout through ${descriptor} ${zoneRange}`;
    case "breakdown":
      return `bearish breakdown through ${descriptor} ${zoneRange}`;
    case "reclaim":
      return `reclaim back above ${descriptor} ${zoneRange}`;
    case "fake_breakout":
      return `failed breakout at ${descriptor} ${zoneRange}`;
    case "fake_breakdown":
      return `failed breakdown at ${descriptor} ${zoneRange}`;
    case "rejection":
      return zone.kind === "resistance"
        ? `sellers defended ${descriptor} ${zoneRange}`
        : `buyers defended ${descriptor} ${zoneRange}`;
    case "compression":
      return `price compressing into ${descriptor} ${zoneRange}`;
    case "level_touch":
      if (
        zone.kind === "support" &&
        (zone.strengthLabel === "strong" || zone.strengthLabel === "major")
      ) {
        return `dip-buy test at ${descriptor} ${zoneRange}`;
      }
      return `price testing ${descriptor} ${zoneRange}`;
    default:
      return `setup at ${descriptor} ${zoneRange}`;
  }
}

function buildWatchLine(event: MonitoringEvent, zone?: FinalLevelZone): string | null {
  if (!zone) {
    return null;
  }

  const zoneLow = formatLevel(zone.zoneLow);
  const zoneHigh = formatLevel(zone.zoneHigh);

  switch (event.eventType) {
    case "breakout":
      return `watch: hold above ${zoneHigh}; invalidates back below ${zoneLow}`;
    case "breakdown":
      return `watch: stay below ${zoneLow}; invalidates back above ${zoneHigh}`;
    case "reclaim":
      return `watch: hold above ${zoneHigh}; invalidates back below ${zoneLow}`;
    case "fake_breakout":
      return `watch: rejection continuation below ${zoneHigh}; invalidates on acceptance back above it`;
    case "fake_breakdown":
      return `watch: rebound continuation above ${zoneLow}; invalidates on loss of that support`;
    case "rejection":
      return zone.kind === "resistance"
        ? `watch: sellers keep price below ${zoneHigh}; invalidates on clean acceptance above it`
        : `watch: buyers keep price above ${zoneLow}; invalidates on clean loss below it`;
    case "compression":
      return zone.kind === "resistance"
        ? `watch: breakout through ${zoneHigh} or rejection from ${zoneLow}-${zoneHigh}`
        : `watch: breakdown through ${zoneLow} or bounce from ${zoneLow}-${zoneHigh}`;
    case "level_touch":
      return zone.kind === "support"
        ? `watch: buyers defend ${zoneLow}-${zoneHigh} before momentum fades`
        : `watch: sellers defend ${zoneLow}-${zoneHigh} before breakout pressure builds`;
    default:
      return null;
  }
}

export function buildTraderAlertBody(
  event: MonitoringEvent,
  zone?: FinalLevelZone,
  nextBarrier?: TraderNextBarrierContext | null,
): string {
  if (!zone) {
    return buildLeadLine(event, zone);
  }

  const roomLine = nextBarrier
    ? describeBarrierRoom(nextBarrier)
    : null;

  return [
    buildLeadLine(event, zone),
    `context: ${describeZoneContext(event, zone)}`,
    roomLine,
    buildWatchLine(event, zone),
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");
}
