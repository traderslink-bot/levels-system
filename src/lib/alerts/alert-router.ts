// 2026-04-14 09:28 PM America/Toronto
// Phase 2 starter alert router that formats console-friendly alert text.

import type { MonitoringEvent } from "../monitoring/monitoring-types.js";
import type { AlertPayload } from "./alert-types.js";

export function formatMonitoringEventAsAlert(event: MonitoringEvent): AlertPayload {
  return {
    title: `${event.symbol} ${event.eventType.replaceAll("_", " ")}`,
    body: `${event.zoneKind} zone ${event.zoneId} at ${event.triggerPrice}`,
    event,
  };
}
