// 2026-04-14 10:18 PM America/Toronto
// Phase 3 alert intelligence engine that enriches, scores, filters, and formats monitoring events.

import type { FinalLevelZone, LevelEngineOutput } from "../levels/level-types.js";
import type { MonitoringEvent } from "../monitoring/monitoring-types.js";
import { DEFAULT_ALERT_INTELLIGENCE_CONFIG, type AlertIntelligenceConfig } from "./alert-config.js";
import { filterAlerts } from "./alert-filter.js";
import { formatIntelligentAlert } from "./alert-formatter.js";
import { scoreMonitoringEventToAlert } from "./alert-scorer.js";
import type { IntelligentAlert } from "./alert-types.js";

function allZones(output: LevelEngineOutput): FinalLevelZone[] {
  return [
    ...output.majorSupport,
    ...output.majorResistance,
    ...output.intermediateSupport,
    ...output.intermediateResistance,
    ...output.intradaySupport,
    ...output.intradayResistance,
  ];
}

export class AlertIntelligenceEngine {
  constructor(
    private readonly config: AlertIntelligenceConfig = DEFAULT_ALERT_INTELLIGENCE_CONFIG,
  ) {}

  private findZoneForEvent(
    event: MonitoringEvent,
    levels: LevelEngineOutput | undefined,
  ): FinalLevelZone | undefined {
    if (!levels) {
      return undefined;
    }

    return allZones(levels).find((zone) => zone.id === event.zoneId);
  }

  processEvent(
    event: MonitoringEvent,
    levels: LevelEngineOutput | undefined,
  ): {
    rawAlert: IntelligentAlert;
    formatted: ReturnType<typeof formatIntelligentAlert> | null;
  } {
    const zone = this.findZoneForEvent(event, levels);
    const rawAlert = scoreMonitoringEventToAlert({
      event,
      zone,
      config: this.config,
    });

    const kept = filterAlerts([rawAlert]);
    if (kept.length === 0) {
      return {
        rawAlert,
        formatted: null,
      };
    }

    return {
      rawAlert,
      formatted: formatIntelligentAlert(kept[0]),
    };
  }
}
