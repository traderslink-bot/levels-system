// 2026-04-14 09:28 PM America/Toronto
// Alert formatting plus deterministic Discord thread routing.

import type { MonitoringEvent } from "../monitoring/monitoring-types.js";
import type { OpportunityInterpretation } from "../monitoring/opportunity-interpretation.js";
import type {
  AlertPayload,
  DiscordThread,
  TraderFollowThroughContext,
  LevelExtensionPayload,
  LevelSnapshotDisplayZone,
  LevelSnapshotPayload,
  DiscordThreadRoutingResult,
  IntelligentAlert,
} from "./alert-types.js";
import { describeZoneStrength } from "./trader-message-language.js";

export function formatMonitoringEventAsAlert(event: MonitoringEvent): AlertPayload {
  return {
    title: `${event.symbol} ${event.eventType.replaceAll("_", " ")}`,
    body: `${event.zoneKind} zone ${event.eventContext.canonicalZoneId} at ${event.triggerPrice}`,
    event,
    symbol: event.symbol,
    timestamp: event.timestamp,
  };
}

export function formatIntelligentAlertAsPayload(alert: IntelligentAlert): AlertPayload {
  const severityText = alert.severity.toUpperCase();
  const confidenceText = alert.confidence.toUpperCase();
  const scoreText = alert.score.toFixed(2);

  return {
    title: alert.title,
    body: [
      alert.body,
      `severity ${severityText} | confidence ${confidenceText} | score ${scoreText}`,
      `trigger ${alert.event.triggerPrice >= 1 ? alert.event.triggerPrice.toFixed(2) : alert.event.triggerPrice.toFixed(4)}`,
    ].join("\n"),
    event: alert.event,
    symbol: alert.event.symbol,
    timestamp: alert.event.timestamp,
    metadata: {
      messageKind: "intelligent_alert",
      eventType: alert.event.eventType,
      severity: alert.severity,
      confidence: alert.confidence,
      score: alert.score,
      clearanceLabel: alert.nextBarrier?.clearanceLabel,
      barrierClutterLabel: alert.nextBarrier?.clutterLabel,
      nearbyBarrierCount: alert.nextBarrier?.nearbyBarrierCount,
      nextBarrierSide: alert.nextBarrier?.side,
      nextBarrierDistancePct: alert.nextBarrier?.distancePct,
      tacticalRead: alert.tacticalRead,
      movementLabel: alert.movement?.label,
      movementPct: alert.movement?.movementPct,
      pressureLabel: alert.pressure?.label,
      pressureScore: alert.pressure?.pressureScore,
      triggerQualityLabel: alert.triggerQuality?.label,
      pathQualityLabel: alert.pathQuality?.label,
      dipBuyQualityLabel: alert.dipBuyQuality?.label,
      exhaustionLabel: alert.exhaustion?.label,
      setupStateLabel: alert.setupState?.label,
      failureRiskLabel: alert.failureRisk?.label,
      tradeMapLabel: alert.tradeMap?.label,
      riskPct: alert.tradeMap?.riskPct,
      roomToRiskRatio: alert.tradeMap?.roomToRiskRatio ?? undefined,
      targetSide: alert.target?.side,
      targetPrice: alert.target?.price,
      targetDistancePct: alert.target?.distancePct,
    },
  };
}

function formatPct(value: number): string {
  const sign = value >= 0 ? "+" : "-";
  return `${sign}${Math.abs(value).toFixed(2)}%`;
}

export function formatFollowThroughUpdateAsPayload(params: {
  symbol: string;
  timestamp: number;
  followThrough: TraderFollowThroughContext;
  entryPrice: number;
  outcomePrice: number;
}): AlertPayload {
  const { symbol, timestamp, followThrough, entryPrice, outcomePrice } = params;
  const directionalText =
    followThrough.directionalReturnPct === null
      ? "n/a"
      : formatPct(followThrough.directionalReturnPct);
  const rawText =
    followThrough.rawReturnPct === null
      ? "n/a"
      : formatPct(followThrough.rawReturnPct);

  return {
    title: `${symbol} ${followThrough.eventType.replaceAll("_", " ")} follow-through`,
    body: [
      followThrough.line,
      `status: ${followThrough.label} | directional ${directionalText} | raw ${rawText}`,
      `path: tracked from ${entryPrice >= 1 ? entryPrice.toFixed(2) : entryPrice.toFixed(4)} to ${outcomePrice >= 1 ? outcomePrice.toFixed(2) : outcomePrice.toFixed(4)}`,
    ].join("\n"),
    symbol,
    timestamp,
    metadata: {
      messageKind: "follow_through_update",
      eventType: followThrough.eventType as MonitoringEvent["eventType"],
      followThroughLabel: followThrough.label,
      directionalReturnPct: followThrough.directionalReturnPct,
      rawReturnPct: followThrough.rawReturnPct,
    },
  };
}

export function formatFollowThroughStateUpdateAsPayload(params: {
  symbol: string;
  timestamp: number;
  eventType: string;
  progressLabel: "improving" | "stalling" | "degrading";
  directionalReturnPct: number | null;
  entryPrice: number;
  currentPrice: number;
}): AlertPayload {
  const { symbol, timestamp, eventType, progressLabel, directionalReturnPct, entryPrice, currentPrice } = params;
  const directionalText =
    directionalReturnPct === null
      ? "n/a"
      : formatPct(directionalReturnPct);
  const line =
    progressLabel === "improving"
      ? `live follow-through: ${eventType.replaceAll("_", " ")} is improving since the alert`
      : progressLabel === "stalling"
        ? `live follow-through: ${eventType.replaceAll("_", " ")} is stalling and needs fresh follow-through`
        : `live follow-through: ${eventType.replaceAll("_", " ")} is degrading and needs to stabilize quickly`;

  return {
    title: `${symbol} ${eventType.replaceAll("_", " ")} state update`,
    body: [
      line,
      `status: ${progressLabel} | directional ${directionalText}`,
      `path: ${entryPrice >= 1 ? entryPrice.toFixed(2) : entryPrice.toFixed(4)} -> ${currentPrice >= 1 ? currentPrice.toFixed(2) : currentPrice.toFixed(4)}`,
    ].join("\n"),
    symbol,
    timestamp,
    metadata: {
      messageKind: "follow_through_state_update",
      eventType: eventType as MonitoringEvent["eventType"],
      progressLabel,
      directionalReturnPct,
    },
  };
}

export function formatContinuityUpdateAsPayload(params: {
  interpretation: OpportunityInterpretation;
}): AlertPayload {
  const { interpretation } = params;
  return {
    title: `${interpretation.symbol} setup update`,
    body: [
      interpretation.message,
      `continuity: ${interpretation.type.replaceAll("_", " ")} | confidence ${interpretation.confidence.toFixed(2)}`,
    ].join("\n"),
    symbol: interpretation.symbol,
    timestamp: interpretation.timestamp,
    metadata: {
      messageKind: "continuity_update",
      continuityType: interpretation.type,
    },
  };
}

export function formatSymbolRecapAsPayload(params: {
  symbol: string;
  timestamp: number;
  body: string;
  aiGenerated?: boolean;
}): AlertPayload {
  return {
    title: `${params.symbol} state recap`,
    body: params.body,
    symbol: params.symbol,
    timestamp: params.timestamp,
    metadata: {
      messageKind: "symbol_recap",
      aiGenerated: params.aiGenerated ?? false,
    },
  };
}

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

export interface DiscordThreadGateway {
  getThreadById(threadId: string): Promise<DiscordThread | null>;
  findThreadByName(name: string): Promise<DiscordThread | null>;
  createThread(name: string): Promise<DiscordThread>;
  sendMessage(threadId: string, payload: AlertPayload): Promise<void>;
  sendLevelSnapshot(threadId: string, payload: LevelSnapshotPayload): Promise<void>;
  sendLevelExtension(threadId: string, payload: LevelExtensionPayload): Promise<void>;
}

function formatLevel(level: number): string {
  return level >= 1 ? level.toFixed(2) : level.toFixed(4);
}

function formatDistancePctFromPrice(level: number, currentPrice: number): string | null {
  if (!Number.isFinite(level) || !Number.isFinite(currentPrice) || currentPrice <= 0) {
    return null;
  }

  const distancePct = (level - currentPrice) / currentPrice;
  const sign = distancePct >= 0 ? "+" : "-";
  return `${sign}${(Math.abs(distancePct) * 100).toFixed(1)}%`;
}

function formatSnapshotDisplayZone(
  zone: LevelSnapshotDisplayZone,
  currentPrice: number,
): string {
  const distance = formatDistancePctFromPrice(zone.representativePrice, currentPrice);
  const descriptor = zone.strengthLabel ? describeZoneStrength(zone.strengthLabel) : null;
  const extension = zone.isExtension ? "extension" : null;
  const descriptorText = [descriptor, extension].filter((value): value is string => Boolean(value)).join(" ");
  const suffix = [distance, descriptorText].filter((value): value is string => Boolean(value)).join(", ");

  if (!suffix) {
    return formatLevel(zone.representativePrice);
  }

  return `${formatLevel(zone.representativePrice)} (${suffix})`;
}

function nearestSnapshotLevel(
  zones: LevelSnapshotDisplayZone[],
  currentPrice: number,
  side: "support" | "resistance",
): LevelSnapshotDisplayZone | null {
  const candidates = zones
    .filter((zone) =>
      side === "support"
        ? zone.representativePrice < currentPrice
        : zone.representativePrice > currentPrice,
    )
    .sort((left, right) =>
      side === "support"
        ? right.representativePrice - left.representativePrice
        : left.representativePrice - right.representativePrice,
    );

  return candidates[0] ?? null;
}

function buildSnapshotMapLine(payload: LevelSnapshotPayload): string {
  const nearestSupport = nearestSnapshotLevel(payload.supportZones, payload.currentPrice, "support");
  const nearestResistance = nearestSnapshotLevel(payload.resistanceZones, payload.currentPrice, "resistance");

  const supportText =
    nearestSupport
      ? `${formatLevel(nearestSupport.representativePrice)} (${formatDistancePctFromPrice(nearestSupport.representativePrice, payload.currentPrice)})`
      : "none";
  const resistanceText =
    nearestResistance
      ? `${formatLevel(nearestResistance.representativePrice)} (${formatDistancePctFromPrice(nearestResistance.representativePrice, payload.currentPrice)})`
      : "none";

  let skew = "balanced room";
  if (nearestSupport && nearestResistance) {
    const supportDistance = Math.abs(nearestSupport.representativePrice - payload.currentPrice) / Math.max(payload.currentPrice, 0.0001);
    const resistanceDistance = Math.abs(nearestResistance.representativePrice - payload.currentPrice) / Math.max(payload.currentPrice, 0.0001);
    const ratio = resistanceDistance / Math.max(supportDistance, 0.0001);
    if (ratio <= 0.8) {
      skew = "bearish room";
    } else if (ratio >= 1.2) {
      skew = "bullish room";
    } else {
      skew = "balanced room";
    }
  } else if (nearestResistance) {
    skew = "bearish room";
  } else if (nearestSupport) {
    skew = "bullish room";
  } else {
    skew = "no nearby ladder";
  }

  return `MAP: nearest support ${supportText} | nearest resistance ${resistanceText} | ${skew}`;
}

export function formatLevelSnapshotMessage(payload: LevelSnapshotPayload): string {
  const supportLine =
    payload.supportZones.length > 0
      ? payload.supportZones.map((zone) => formatSnapshotDisplayZone(zone, payload.currentPrice)).join(", ")
      : "none";
  const resistanceLine =
    payload.resistanceZones.length > 0
      ? payload.resistanceZones.map((zone) => formatSnapshotDisplayZone(zone, payload.currentPrice)).join(", ")
      : "none";

  return [
    `LEVEL SNAPSHOT: ${payload.symbol}`,
    `PRICE: ${formatLevel(payload.currentPrice)}`,
    buildSnapshotMapLine(payload),
    `SUPPORT: ${supportLine}`,
    `RESISTANCE: ${resistanceLine}`,
  ].join("\n");
}

export function formatLevelExtensionMessage(payload: LevelExtensionPayload): string {
  const levelsLine =
    payload.levels.length > 0
      ? payload.levels.map((level) => formatLevel(level)).join(", ")
      : "none";

  return [
    `NEXT LEVELS: ${payload.symbol}`,
    `SIDE: ${payload.side.toUpperCase()}`,
    `LEVELS: ${levelsLine}`,
  ].join("\n");
}

export class DiscordAlertRouter {
  constructor(private readonly gateway: DiscordThreadGateway) {}

  async ensureThread(
    symbol: string,
    storedThreadId?: string | null,
  ): Promise<DiscordThreadRoutingResult> {
    const normalizedSymbol = normalizeSymbol(symbol);

    if (storedThreadId) {
      const existingThread = await this.gateway.getThreadById(storedThreadId);
      if (existingThread && existingThread.name === normalizedSymbol) {
        return {
          threadId: existingThread.id,
          reused: true,
          recovered: false,
          created: false,
        };
      }

      const recoveredThread = await this.gateway.findThreadByName(normalizedSymbol);
      if (recoveredThread) {
        return {
          threadId: recoveredThread.id,
          reused: false,
          recovered: true,
          created: false,
        };
      }
    }

    const recoveredThread = await this.gateway.findThreadByName(normalizedSymbol);
    if (recoveredThread) {
      return {
        threadId: recoveredThread.id,
        reused: false,
        recovered: true,
        created: false,
      };
    }

    const createdThread = await this.gateway.createThread(normalizedSymbol);
    return {
      threadId: createdThread.id,
      reused: false,
      recovered: false,
      created: true,
    };
  }

  async routeAlert(threadId: string, payload: AlertPayload): Promise<void> {
    await this.gateway.sendMessage(threadId, payload);
  }

  async routeLevelSnapshot(threadId: string, payload: LevelSnapshotPayload): Promise<void> {
    await this.gateway.sendLevelSnapshot(threadId, payload);
  }

  async routeLevelExtension(threadId: string, payload: LevelExtensionPayload): Promise<void> {
    await this.gateway.sendLevelExtension(threadId, payload);
  }
}
