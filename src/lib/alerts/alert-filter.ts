// 2026-04-14 10:18 PM America/Toronto
// Filters low-value alerts before they reach the user.

import type { IntelligentAlert } from "./alert-types.js";

export function shouldSuppressAlert(alert: IntelligentAlert): boolean {
  if (!alert.shouldNotify && alert.confidence === "low") {
    return true;
  }

  if (alert.event.eventType === "compression" && alert.severity === "low") {
    return true;
  }

  if (alert.zone?.strengthLabel === "weak" && alert.confidence === "low") {
    return true;
  }

  if (
    alert.event.eventType === "compression" &&
    alert.event.eventContext.ladderPosition === "inner" &&
    alert.event.eventContext.zoneOrigin === "canonical" &&
    alert.severity !== "high" &&
    alert.severity !== "critical"
  ) {
    return true;
  }

  if (
    alert.event.eventType === "level_touch" &&
    alert.event.eventContext.ladderPosition === "inner" &&
    alert.event.eventContext.zoneStrengthLabel === "weak" &&
    alert.severity === "low"
  ) {
    return true;
  }

  if (alert.event.eventContext.dataQualityDegraded && alert.severity === "low") {
    return true;
  }

  return false;
}

export function filterAlerts(alerts: IntelligentAlert[]): IntelligentAlert[] {
  return alerts.filter((alert) => !shouldSuppressAlert(alert));
}
