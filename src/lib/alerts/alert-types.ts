// 2026-04-14 09:28 PM America/Toronto
// Downstream alert types for routing and Phase 3 alert intelligence.

import type { FinalLevelZone } from "../levels/level-types.js";
import type { MonitoringEvent } from "../monitoring/monitoring-types.js";

export type AlertSeverity = "low" | "medium" | "high" | "critical";

export type AlertConfidence = "low" | "medium" | "high";

export type AlertPayload = {
  title: string;
  body: string;
  event: MonitoringEvent;
};

export type IntelligentAlert = {
  id: string;
  symbol: string;
  title: string;
  body: string;
  severity: AlertSeverity;
  confidence: AlertConfidence;
  score: number;
  shouldNotify: boolean;
  tags: string[];
  event: MonitoringEvent;
  zone?: FinalLevelZone;
};
