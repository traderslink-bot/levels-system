// 2026-04-16 02:03 PM America/Toronto
// Phase 3 alert intelligence engine that enriches, scores, filters, formats, and applies delivery policy.

import type { FinalLevelZone, LevelEngineOutput } from "../levels/level-types.js";
import type { MonitoringEvent } from "../monitoring/monitoring-types.js";
import { DEFAULT_ALERT_INTELLIGENCE_CONFIG, type AlertIntelligenceConfig } from "./alert-config.js";
import { shouldSuppressAlert } from "./alert-filter.js";
import { formatIntelligentAlert } from "./alert-formatter.js";
import {
  appendPostedAlertHistory,
  evaluateAlertPostingPolicy,
  prunePostedAlertHistory,
} from "./posting-policy.js";
import { scoreMonitoringEventToAlert } from "./alert-scorer.js";
import type { AlertPostingDecision, IntelligentAlert } from "./alert-types.js";

type PostedAlertRecord = {
  alert: IntelligentAlert;
  family: NonNullable<AlertPostingDecision["family"]>;
  scopeKey: string;
  stateKey: string;
  timestamp: number;
};

function allZones(output: LevelEngineOutput): FinalLevelZone[] {
  return [
    ...output.majorSupport,
    ...output.majorResistance,
    ...output.intermediateSupport,
    ...output.intermediateResistance,
    ...output.intradaySupport,
    ...output.intradayResistance,
    ...output.extensionLevels.support,
    ...output.extensionLevels.resistance,
  ];
}

export class AlertIntelligenceEngine {
  private postedAlertHistory: PostedAlertRecord[] = [];

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

    const canonicalZoneId = event.eventContext.canonicalZoneId;
    return allZones(levels).find(
      (zone) => zone.id === canonicalZoneId || zone.id === event.zoneId,
    );
  }

  processEvent(
    event: MonitoringEvent,
    levels: LevelEngineOutput | undefined,
  ): {
    rawAlert: IntelligentAlert;
    formatted: ReturnType<typeof formatIntelligentAlert> | null;
    delivery: AlertPostingDecision;
  } {
    const zone = this.findZoneForEvent(event, levels);
    const rawAlert = scoreMonitoringEventToAlert({
      event,
      zone,
      config: this.config,
    });
    this.postedAlertHistory = prunePostedAlertHistory(
      this.postedAlertHistory,
      event.timestamp,
      this.config,
    );

    if (shouldSuppressAlert(rawAlert)) {
      return {
        rawAlert,
        formatted: null,
        delivery: {
          shouldPost: false,
          reason: "filtered",
        },
      };
    }

    const delivery = evaluateAlertPostingPolicy({
      alert: rawAlert,
      history: this.postedAlertHistory,
      config: this.config,
    });

    if (!delivery.shouldPost) {
      return {
        rawAlert,
        formatted: null,
        delivery,
      };
    }

    this.postedAlertHistory = appendPostedAlertHistory({
      alert: rawAlert,
      history: this.postedAlertHistory,
      config: this.config,
    }) as PostedAlertRecord[];

    return {
      rawAlert,
      formatted: formatIntelligentAlert(rawAlert),
      delivery,
    };
  }
}
