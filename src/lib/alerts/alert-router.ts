// 2026-04-14 09:28 PM America/Toronto
// Alert formatting plus deterministic Discord thread routing.

import type { MonitoringEvent } from "../monitoring/monitoring-types.js";
import type {
  AlertPayload,
  DiscordThread,
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
    metadata: {
      eventType: alert.event.eventType,
      severity: alert.severity,
      confidence: alert.confidence,
      score: alert.score,
      clearanceLabel: alert.nextBarrier?.clearanceLabel,
      nextBarrierSide: alert.nextBarrier?.side,
      nextBarrierDistancePct: alert.nextBarrier?.distancePct,
      tacticalRead: alert.tacticalRead,
      movementLabel: alert.movement?.label,
      movementPct: alert.movement?.movementPct,
      pressureLabel: alert.pressure?.label,
      pressureScore: alert.pressure?.pressureScore,
      triggerQualityLabel: alert.triggerQuality?.label,
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
