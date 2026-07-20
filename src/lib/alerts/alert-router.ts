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

export function formatMonitoringEventAsAlert(event: MonitoringEvent): AlertPayload {
  return {
    title: `${event.symbol} ${event.eventType.replaceAll("_", " ")}`,
    body: `${event.zoneKind} zone ${event.eventContext.canonicalZoneId} at ${event.triggerPrice}`,
    event,
  };
}

export function formatIntelligentAlertAsPayload(alert: IntelligentAlert): AlertPayload {
  return {
    symbol: alert.symbol,
    timestamp: alert.event.timestamp,
    title: alert.title,
    body: alert.body,
    event: alert.event,
    metadata: {
      eventType: alert.event.eventType,
      severity: alert.severity,
      confidence: alert.confidence,
      score: alert.score,
    },
  };
}

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

export interface DiscordThreadGateway {
  ensureSymbolRoute?(
    symbol: string,
    storedRouteId?: string | null,
  ): Promise<DiscordThreadRoutingResult>;
  announceTickerAdded?(symbol: string): Promise<void>;
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

function formatSnapshotDisplayZone(zone: LevelSnapshotDisplayZone): string {
  return formatLevel(zone.representativePrice);
}

export function formatLevelLadderMessage(payload: LevelSnapshotPayload): string {
  const resistanceLines = payload.resistanceZones.length > 0
    ? payload.resistanceZones.map((zone) => formatSnapshotDisplayZone(zone))
    : ["none"];
  const supportLines = payload.supportZones.length > 0
    ? payload.supportZones.map((zone) => formatSnapshotDisplayZone(zone))
    : ["none"];

  return [
    `${payload.symbol} full level ladder`,
    `Price: ${formatLevel(payload.currentPrice)}`,
    "",
    "Resistance:",
    ...resistanceLines,
    "",
    "Support:",
    ...supportLines,
  ].join("\n");
}

export function formatLevelSnapshotMessage(payload: LevelSnapshotPayload): string {
  const supportLine =
    payload.supportZones.length > 0
      ? payload.supportZones.map((zone) => formatSnapshotDisplayZone(zone)).join(", ")
      : "none";
  const resistanceLine =
    payload.resistanceZones.length > 0
      ? payload.resistanceZones.map((zone) => formatSnapshotDisplayZone(zone)).join(", ")
      : "none";

  const lines = [
    `LEVEL SNAPSHOT: ${payload.symbol}`,
    `PRICE: ${formatLevel(payload.currentPrice)}`,
    `SUPPORT: ${supportLine}`,
    `RESISTANCE: ${resistanceLine}`,
  ];

  if (payload.marketStructure?.trim()) {
    lines.push("", "Market structure:", payload.marketStructure.trim());
  }

  return lines.join("\n");
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

    if (this.gateway.ensureSymbolRoute) {
      return this.gateway.ensureSymbolRoute(normalizedSymbol, storedThreadId);
    }

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
