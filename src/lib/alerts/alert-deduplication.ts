// 2026-04-16 02:03 PM America/Toronto
// Deterministic alert posting keys and family semantics.

import type { MonitoringEvent } from "../monitoring/monitoring-types.js";
import type { AlertPostingFamily, IntelligentAlert } from "./alert-types.js";

export function alertPostingFamilyForEvent(event: MonitoringEvent): AlertPostingFamily {
  switch (event.eventType) {
    case "breakout":
    case "reclaim":
    case "fake_breakdown":
      return "bullish_resolution";
    case "breakdown":
      return "bearish_resolution";
    case "rejection":
    case "fake_breakout":
      return "failure";
    case "compression":
    case "level_touch":
    default:
      return "zone_context";
  }
}

export function alertPostingFamilyPriority(family: AlertPostingFamily): number {
  switch (family) {
    case "zone_context":
      return 1;
    case "bullish_resolution":
    case "bearish_resolution":
      return 3;
    case "failure":
      return 4;
    default:
      return 1;
  }
}

export function buildAlertScopeKey(alert: IntelligentAlert): string {
  const context = alert.event.eventContext;
  return [
    alert.symbol,
    context.canonicalZoneId,
    alert.event.zoneKind,
    context.ladderPosition,
    context.zoneOrigin,
  ].join("|");
}

export function buildAlertStateKey(alert: IntelligentAlert, family: AlertPostingFamily): string {
  const context = alert.event.eventContext;
  return [
    buildAlertScopeKey(alert),
    family,
    context.zoneFreshness,
    context.zoneStrengthLabel,
    context.remapStatus,
    context.recentlyRefreshed ? "refreshed" : "steady",
    context.recentlyPromotedExtension ? "promoted" : "stable",
    context.dataQualityDegraded ? "degraded" : "clean",
  ].join("|");
}

export function isMateriallyNewAlertState(current: IntelligentAlert, previous: IntelligentAlert): boolean {
  const currentContext = current.event.eventContext;
  const previousContext = previous.event.eventContext;

  return (
    currentContext.canonicalZoneId !== previousContext.canonicalZoneId ||
    currentContext.zoneOrigin !== previousContext.zoneOrigin ||
    currentContext.ladderPosition !== previousContext.ladderPosition ||
    currentContext.zoneFreshness !== previousContext.zoneFreshness ||
    currentContext.remapStatus !== previousContext.remapStatus ||
    currentContext.recentlyRefreshed !== previousContext.recentlyRefreshed ||
    currentContext.recentlyPromotedExtension !== previousContext.recentlyPromotedExtension ||
    currentContext.dataQualityDegraded !== previousContext.dataQualityDegraded
  );
}
