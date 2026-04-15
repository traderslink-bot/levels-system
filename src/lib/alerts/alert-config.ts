// 2026-04-14 10:18 PM America/Toronto
// Config for Phase 3 alert intelligence.

import type { MonitoringEventType } from "../monitoring/monitoring-types.js";

export type AlertIntelligenceConfig = {
  eventBaseScores: Record<MonitoringEventType, number>;
  strengthLabelScores: {
    weak: number;
    moderate: number;
    strong: number;
    major: number;
  };
  timeframeConfluenceBonus: number;
  weakZonePenalty: number;
  weak5mOnlyPenalty: number;
  notifyThreshold: number;
  severityThresholds: {
    critical: number;
    high: number;
    medium: number;
  };
  confidenceThresholds: {
    high: number;
    medium: number;
  };
};

export const DEFAULT_ALERT_INTELLIGENCE_CONFIG: AlertIntelligenceConfig = {
  eventBaseScores: {
    breakout: 32,
    breakdown: 32,
    rejection: 24,
    fake_breakout: 38,
    fake_breakdown: 38,
    reclaim: 28,
    compression: 14,
  },
  strengthLabelScores: {
    weak: 0,
    moderate: 8,
    strong: 16,
    major: 24,
  },
  timeframeConfluenceBonus: 4,
  weakZonePenalty: 10,
  weak5mOnlyPenalty: 12,
  notifyThreshold: 32,
  severityThresholds: {
    critical: 64,
    high: 48,
    medium: 28,
  },
  confidenceThresholds: {
    high: 52,
    medium: 32,
  },
};
