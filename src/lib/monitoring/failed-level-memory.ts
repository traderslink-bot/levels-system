import type { FinalLevelZone } from "../levels/level-types.js";
import type { MonitoringEvent, MonitoringEventType } from "./monitoring-types.js";

export type FailedLevelMemoryOutcome =
  | "probe_only"
  | "testing"
  | "accepted"
  | "failed"
  | "reclaimed"
  | "none";

export type FailedLevelMemoryContext = {
  outcome: FailedLevelMemoryOutcome;
  failureCount: number;
  lastAttemptAt: number | null;
  maxExtensionPct: number | null;
  traderLine?: string;
};

function zoneLow(zone: FinalLevelZone): number {
  return Math.min(zone.zoneLow, zone.zoneHigh, zone.representativePrice);
}

function zoneHigh(zone: FinalLevelZone): number {
  return Math.max(zone.zoneLow, zone.zoneHigh, zone.representativePrice);
}

function pctDistance(base: number, value: number): number {
  return ((value - base) / Math.max(Math.abs(base), 0.0001)) * 100;
}

function formatLevel(value: number): string {
  return value >= 1 ? value.toFixed(2) : value.toFixed(4);
}

function isRelevantEventForZone(event: MonitoringEvent, zone: FinalLevelZone): boolean {
  if (event.zoneId === zone.id) {
    return true;
  }
  const reference = zone.kind === "resistance" ? zoneHigh(zone) : zoneLow(zone);
  return Math.abs(event.level - reference) / Math.max(Math.abs(reference), 0.0001) <= 0.02;
}

export function buildFailedLevelMemoryContext(params: {
  zone: FinalLevelZone;
  eventType: MonitoringEventType;
  price: number;
  timestamp: number;
  recentEvents: MonitoringEvent[];
}): FailedLevelMemoryContext {
  const windowMs = 3 * 60 * 60 * 1000;
  const relevant = params.recentEvents
    .filter((event) =>
      params.timestamp - event.timestamp >= 0 &&
      params.timestamp - event.timestamp <= windowMs &&
      isRelevantEventForZone(event, params.zone),
    )
    .sort((left, right) => right.timestamp - left.timestamp);

  const failureEvents = relevant.filter((event) =>
    params.zone.kind === "resistance"
      ? event.eventType === "fake_breakout" || event.eventType === "rejection"
      : event.eventType === "fake_breakdown" || event.eventType === "reclaim",
  );
  const attemptEvents = relevant.filter((event) =>
    params.zone.kind === "resistance"
      ? event.eventType === "breakout"
      : event.eventType === "breakdown",
  );

  const boundary = params.zone.kind === "resistance" ? zoneHigh(params.zone) : zoneLow(params.zone);
  const rawExtensionPct = params.zone.kind === "resistance"
    ? pctDistance(boundary, params.price)
    : pctDistance(params.price, boundary);
  const maxExtensionPct = Number(Math.max(0, rawExtensionPct).toFixed(2));

  if (params.eventType === "breakout" || params.eventType === "breakdown") {
    if (maxExtensionPct >= 2.5) {
      return {
        outcome: "accepted",
        failureCount: failureEvents.length,
        lastAttemptAt: attemptEvents[0]?.timestamp ?? null,
        maxExtensionPct,
        traderLine: params.zone.kind === "resistance"
          ? `price has pushed far enough above ${formatLevel(boundary)} to treat the break as cleaner acceptance`
          : `price has moved far enough below ${formatLevel(boundary)} to treat support as cleanly lost for now`,
      };
    }
    return {
      outcome: failureEvents.length > 0 ? "testing" : "probe_only",
      failureCount: failureEvents.length,
      lastAttemptAt: attemptEvents[0]?.timestamp ?? null,
      maxExtensionPct,
      traderLine: params.zone.kind === "resistance"
        ? `${formatLevel(boundary)} is still being tested; the prior push has not proven clean acceptance yet`
        : `${formatLevel(boundary)} is still being tested; the support loss has not proven clean acceptance yet`,
    };
  }

  if (params.eventType === "fake_breakout" || params.eventType === "rejection") {
    return {
      outcome: "failed",
      failureCount: Math.max(1, failureEvents.length),
      lastAttemptAt: attemptEvents[0]?.timestamp ?? null,
      maxExtensionPct,
      traderLine: `${formatLevel(boundary)} is still acting like resistance after the failed push`,
    };
  }

  if (params.eventType === "fake_breakdown" || params.eventType === "reclaim") {
    return {
      outcome: "reclaimed",
      failureCount: Math.max(1, failureEvents.length),
      lastAttemptAt: attemptEvents[0]?.timestamp ?? null,
      maxExtensionPct,
      traderLine: `${formatLevel(boundary)} is still being repaired after the support test`,
    };
  }

  return {
    outcome: failureEvents.length > 0 ? "failed" : "none",
    failureCount: failureEvents.length,
    lastAttemptAt: attemptEvents[0]?.timestamp ?? null,
    maxExtensionPct: maxExtensionPct > 0 ? maxExtensionPct : null,
  };
}

