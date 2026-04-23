// 2026-04-16 02:03 PM America/Toronto
// Phase 3 alert intelligence engine that enriches, scores, filters, formats, and applies delivery policy.

import type { FinalLevelZone, LevelEngineOutput } from "../levels/level-types.js";
import { DEFAULT_MONITORING_CONFIG } from "../monitoring/monitoring-config.js";
import { deriveBarrierClearanceLabel } from "../monitoring/monitoring-event-scoring.js";
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
import type {
  AlertPostingDecision,
  IntelligentAlert,
  TraderNextBarrierContext,
} from "./alert-types.js";

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

  private resolveNextBarrierSide(event: MonitoringEvent): "support" | "resistance" {
    if (
      event.eventType === "breakout" ||
      event.eventType === "reclaim" ||
      event.eventType === "fake_breakdown"
    ) {
      return "resistance";
    }

    if (
      event.eventType === "breakdown" ||
      event.eventType === "fake_breakout"
    ) {
      return "support";
    }

    if (event.eventType === "level_touch" || event.eventType === "rejection") {
      return event.zoneKind === "support" ? "resistance" : "support";
    }

    if (event.eventType === "compression") {
      return event.zoneKind === "support" ? "resistance" : "support";
    }

    return event.bias === "bearish" ? "support" : "resistance";
  }

  private findNextBarrier(
    event: MonitoringEvent,
    levels: LevelEngineOutput | undefined,
  ): TraderNextBarrierContext | null {
    if (
      event.eventContext.nextBarrierKind &&
      typeof event.eventContext.nextBarrierLevel === "number" &&
      typeof event.eventContext.nextBarrierDistancePct === "number"
    ) {
      return {
        side: event.eventContext.nextBarrierKind,
        price: event.eventContext.nextBarrierLevel,
        distancePct: event.eventContext.nextBarrierDistancePct,
        clearanceLabel: event.eventContext.clearanceLabel,
        clutterLabel: event.eventContext.barrierClutterLabel,
        nearbyBarrierCount: event.eventContext.nearbyBarrierCount,
        pathQualityLabel: event.eventContext.pathQualityLabel,
        pathBarrierCount: event.eventContext.pathBarrierCount,
        pathConstraintScore: event.eventContext.pathConstraintScore,
        pathWindowDistancePct: event.eventContext.pathWindowDistancePct,
      };
    }

    if (!levels || event.triggerPrice <= 0) {
      return null;
    }

    const barrierSide = this.resolveNextBarrierSide(event);
    const candidates = allZones(levels)
      .filter((zone) => zone.kind === barrierSide)
      .filter((zone) =>
        barrierSide === "resistance"
          ? zone.representativePrice > event.triggerPrice
          : zone.representativePrice < event.triggerPrice,
      )
      .sort((left, right) =>
        barrierSide === "resistance"
          ? left.representativePrice - right.representativePrice
          : right.representativePrice - left.representativePrice,
      );

    const nextBarrier = candidates[0];
    if (!nextBarrier) {
      return null;
    }

    const clusteredDistancePct = Math.max(DEFAULT_MONITORING_CONFIG.limitedClearancePct * 2, 0.06);
    const nearbyBarrierCount = candidates.filter((candidate) =>
      Math.abs(candidate.representativePrice - event.triggerPrice) / Math.max(event.triggerPrice, 0.0001) <= clusteredDistancePct
    ).length;
    const pathWindowDistancePct =
      candidates
        .slice(0, Math.min(nearbyBarrierCount, 4))
        .at(-1)
        ? Math.abs(candidates.slice(0, Math.min(nearbyBarrierCount, 4)).at(-1)!.representativePrice - event.triggerPrice) /
          Math.max(event.triggerPrice, 0.0001)
        : undefined;
    const clutterLabel =
      nearbyBarrierCount >= 3
        ? "dense"
        : nearbyBarrierCount >= 2
          ? "stacked"
          : "clear";

    return {
      side: barrierSide,
      price: nextBarrier.representativePrice,
      distancePct:
        Math.abs(nextBarrier.representativePrice - event.triggerPrice) /
        Math.max(event.triggerPrice, 0.0001),
      clearanceLabel: deriveBarrierClearanceLabel(
        Math.abs(nextBarrier.representativePrice - event.triggerPrice) /
          Math.max(event.triggerPrice, 0.0001),
        DEFAULT_MONITORING_CONFIG,
      ),
      clutterLabel,
      nearbyBarrierCount,
      pathQualityLabel:
        nearbyBarrierCount >= 3
          ? "choppy"
          : nearbyBarrierCount >= 2
            ? "layered"
            : "clean",
      pathBarrierCount: nearbyBarrierCount,
      pathConstraintScore:
        nearbyBarrierCount >= 3
          ? 0.8
          : nearbyBarrierCount >= 2
            ? 0.5
            : 0.2,
      pathWindowDistancePct,
    };
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
    const nextBarrier = this.findNextBarrier(event, levels);
    const rawAlert = scoreMonitoringEventToAlert({
      event,
      zone,
      nextBarrier,
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
