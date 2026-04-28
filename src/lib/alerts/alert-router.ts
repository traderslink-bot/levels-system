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

function stripLinePrefix(line: string): string {
  const index = line.indexOf(":");
  if (index < 0) {
    return line;
  }

  return line.slice(index + 1).trim();
}

function pickBodyLine(lines: string[], prefix: string): string | null {
  return lines.find((line) => line.startsWith(prefix)) ?? null;
}

function pickLine(lines: string[], prefix: string, fallback?: { line?: string } | null): string | null {
  return pickBodyLine(lines, prefix) ?? fallback?.line ?? null;
}

function lowercaseFirst(value: string): string {
  return value.length > 0 ? `${value[0]?.toLowerCase()}${value.slice(1)}` : value;
}

function formatAlertLevel(level: number | undefined): string | null {
  return typeof level === "number" && Number.isFinite(level)
    ? level >= 1
      ? level.toFixed(2)
      : level.toFixed(4)
    : null;
}

function signalText(value: string): string {
  return value.toLowerCase();
}

function eventStatusLabel(eventType: MonitoringEvent["eventType"]): string {
  switch (eventType) {
    case "level_touch":
      return "Testing";
    case "breakout":
    case "reclaim":
      return "Cleared";
    case "breakdown":
      return "Lost";
    case "rejection":
    case "fake_breakout":
      return "Rejected";
    case "fake_breakdown":
      return "Reclaimed";
    case "compression":
      return "Building";
    default:
      return "Watching";
  }
}

function simplifyTraderRead(line: string): string {
  return line
    .replace(/^buyers still have workable control, but follow-through still matters$/i, "buyers have some control, but the move still needs follow-through")
    .replace(/^buyers still have strong control, backing the move$/i, "buyers are in control right now")
    .replace(/^buying and selling pressure still look balanced$/i, "buyers and sellers are still balanced")
    .replace(/^avoid longs until price reclaims (.+)$/i, "long setup stays risky until price reclaims $1")
    .replace(/^hold above /i, "confirmation: hold above ");
}

function isLongCautionEventType(eventType: MonitoringEvent["eventType"]): boolean {
  return eventType === "breakdown" || eventType === "fake_breakout" || eventType === "rejection";
}

function buildPotentialDipBuyLine(alert: IntelligentAlert, level: string | null): string | null {
  if (!level || !isLongCautionEventType(alert.event.eventType) || alert.nextBarrier?.side !== "support") {
    return null;
  }

  const reclaimLevel = formatAlertLevel(alert.zone?.zoneHigh);
  if (alert.event.eventType === "breakdown" && reclaimLevel) {
    return `possible dip-buy area: ${level}, only if buyers stabilize there or reclaim ${reclaimLevel}`;
  }

  return `possible dip-buy area: ${level}, only if buyers stabilize there first`;
}

function buildHoldFailureMapLine(alert: IntelligentAlert, nextSupportLevel: string | null): string | null {
  if (!isLongCautionEventType(alert.event.eventType) || alert.nextBarrier?.side !== "support") {
    return null;
  }

  const reclaimLevel = formatAlertLevel(alert.zone?.zoneHigh);
  if (!reclaimLevel || !nextSupportLevel) {
    return null;
  }

  return `${reclaimLevel} is the reclaim line for the long setup; below it, risk stays open toward ${nextSupportLevel} unless buyers stabilize first.`;
}

function splitWatchLine(watch: string | null): { confirm: string | null; invalidation: string | null } {
  if (!watch) {
    return { confirm: null, invalidation: null };
  }

  const text = stripLinePrefix(watch);
  const [confirmRaw, invalidationRaw] = text.split(/;\s*/);
  return {
    confirm: confirmRaw ? simplifyTraderRead(confirmRaw.trim()) : null,
    invalidation: invalidationRaw ? invalidationRaw.trim() : null,
  };
}

function buildReadableIntelligentAlertBody(alert: IntelligentAlert): string {
  const lines = alert.body.split("\n").map((line) => line.trim()).filter(Boolean);
  const lead = lines[0] ?? alert.title;
  const whyNow = pickBodyLine(lines, "why now:");
  const movement = pickLine(lines, "movement:", alert.movement);
  const pressure = pickLine(lines, "pressure:", alert.pressure);
  const room = pickBodyLine(lines, "room:");
  const watch = pickBodyLine(lines, "watch:");
  const failureRisk = pickLine(lines, "failure risk:", alert.failureRisk);
  const targetLevel = formatAlertLevel(alert.target?.price);
  const barrierLevel = formatAlertLevel(alert.nextBarrier?.price);
  const eventType = alert.event.eventType;
  const status = eventStatusLabel(eventType);
  const watchParts = splitWatchLine(watch);
  const potentialDipBuyLine = buildPotentialDipBuyLine(alert, barrierLevel);
  const holdFailureMapLine = buildHoldFailureMapLine(alert, barrierLevel);
  const readLines: string[] = [];

  if (eventType === "breakout") {
    readLines.push(
      movement
        ? simplifyTraderRead(lowercaseFirst(stripLinePrefix(movement)))
        : "price is trying to turn resistance into support",
    );
    if (whyNow) {
      readLines.push(simplifyTraderRead(lowercaseFirst(stripLinePrefix(whyNow))));
    }
    if (room) {
      readLines.push(simplifyTraderRead(lowercaseFirst(stripLinePrefix(room))));
    }
  } else if (eventType === "breakdown") {
    readLines.push(
      movement
        ? simplifyTraderRead(lowercaseFirst(stripLinePrefix(movement)))
        : "price is trying to turn support into resistance",
    );
    if (whyNow) {
      readLines.push(simplifyTraderRead(lowercaseFirst(stripLinePrefix(whyNow))));
    }
    if (room) {
      readLines.push(simplifyTraderRead(lowercaseFirst(stripLinePrefix(room))));
    }
  } else if (eventType === "level_touch") {
    readLines.push(
      pressure
        ? simplifyTraderRead(lowercaseFirst(stripLinePrefix(pressure)))
        : whyNow
          ? simplifyTraderRead(lowercaseFirst(stripLinePrefix(whyNow)))
          : "price is testing a key zone",
    );
    if (whyNow) {
      readLines.push(simplifyTraderRead(lowercaseFirst(stripLinePrefix(whyNow))));
    }
    if (room) {
      readLines.push(simplifyTraderRead(lowercaseFirst(stripLinePrefix(room))));
    }
  } else {
    if (whyNow) {
      readLines.push(simplifyTraderRead(lowercaseFirst(stripLinePrefix(whyNow))));
    }
    if (movement) {
      readLines.push(simplifyTraderRead(lowercaseFirst(stripLinePrefix(movement))));
    }
  }

  if (readLines.length < 3 && failureRisk && alert.failureRisk?.label === "high") {
    readLines.push(`risk is high: ${stripLinePrefix(failureRisk).replace(/^high because /, "")}`);
  }

  const nearbyLevels: string[] = [];
  const seenNearbyLevelKeys = new Set<string>();
  const pushNearbyLevel = (label: string, side: string, level: string | null): void => {
    if (!level) {
      return;
    }
    const key = `${side}:${level}`;
    if (seenNearbyLevelKeys.has(key)) {
      return;
    }
    seenNearbyLevelKeys.add(key);
    nearbyLevels.push(`${label} ${side}: ${level}`);
  };
  if (isLongCautionEventType(eventType)) {
    if (potentialDipBuyLine) {
      nearbyLevels.push(`Possible dip-buy area: ${barrierLevel}`);
    }
  } else {
    pushNearbyLevel("First", alert.target?.side ?? "", targetLevel);
    pushNearbyLevel("Next", alert.nextBarrier?.side ?? "", barrierLevel);
  }

  const output = [lead];
  output.push("", `Status: ${status}`);
  if (readLines.length > 0) {
    output.push("", "What it means:", ...readLines.slice(0, 3).map((line) => `- ${line}`));
  }
  if (watchParts.confirm || watchParts.invalidation || potentialDipBuyLine) {
    output.push("", "What to watch:");
    if (watchParts.confirm) {
      output.push(`- ${watchParts.confirm}`);
    }
    if (watchParts.invalidation) {
      output.push(`- invalidation: ${watchParts.invalidation.replace(/^invalidates\s*/i, "")}`);
    }
    if (potentialDipBuyLine) {
      output.push(`- ${potentialDipBuyLine}`);
    }
  }
  if (holdFailureMapLine) {
    output.push("", "Hold / failure map:", `- ${holdFailureMapLine}`);
  }
  if (nearbyLevels.length > 0) {
    output.push("", "Next levels:", ...nearbyLevels.map((line) => `- ${line}`));
  }
  output.push(
    "",
    `Signal: ${signalText(alert.severity)} severity | ${signalText(alert.confidence)} confidence`,
    `Trigger: ${alert.event.triggerPrice >= 1 ? alert.event.triggerPrice.toFixed(2) : alert.event.triggerPrice.toFixed(4)}`,
  );
  return output.join("\n");
}

export function formatIntelligentAlertAsPayload(alert: IntelligentAlert): AlertPayload {
  return {
    title: alert.title,
    body: buildReadableIntelligentAlertBody(alert),
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
      pathConstraintScore: alert.pathQuality?.pathConstraintScore,
      pathWindowDistancePct: alert.pathQuality?.pathWindowDistancePct,
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
      `Status: ${followThrough.label}`,
      "",
      "What it means:",
      `- ${stripLinePrefix(followThrough.line)}`,
      `- alert direction move: ${directionalText}`,
      "",
      "Path:",
      `- ${entryPrice >= 1 ? entryPrice.toFixed(2) : entryPrice.toFixed(4)} -> ${outcomePrice >= 1 ? outcomePrice.toFixed(2) : outcomePrice.toFixed(4)} (${rawText} price move)`,
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
      ? `${eventType.replaceAll("_", " ")} is improving since the alert`
      : progressLabel === "stalling"
        ? `${eventType.replaceAll("_", " ")} is stalling and needs fresh follow-through`
        : `${eventType.replaceAll("_", " ")} is degrading and needs to stabilize`;

  return {
    title: `${symbol} ${eventType.replaceAll("_", " ")} state update`,
    body: [
      `Status: ${progressLabel}`,
      "",
      "What it means:",
      `- ${line}`,
      `- alert direction move: ${directionalText}`,
      "",
      "Path:",
      `- ${entryPrice >= 1 ? entryPrice.toFixed(2) : entryPrice.toFixed(4)} -> ${currentPrice >= 1 ? currentPrice.toFixed(2) : currentPrice.toFixed(4)}`,
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
  interpretation?: OpportunityInterpretation;
  update?: {
    symbol: string;
    timestamp: number;
    continuityType: string;
    message: string;
    confidence?: number;
  };
}): AlertPayload {
  const interpretation =
    params.interpretation ??
    (params.update
      ? {
          symbol: params.update.symbol,
          timestamp: params.update.timestamp,
          type: params.update.continuityType,
          message: params.update.message,
          confidence: params.update.confidence ?? 0.5,
          tags: [],
        }
      : null);

  if (!interpretation) {
    throw new Error("formatContinuityUpdateAsPayload requires an interpretation or update.");
  }

  return {
    title: `${interpretation.symbol} setup update`,
    body: interpretation.message,
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
      skew = "support-side risk";
    } else if (ratio >= 1.2) {
      skew = "bullish room";
    } else {
      skew = "balanced room";
    }
  } else if (nearestResistance) {
    skew = "support-side risk";
  } else if (nearestSupport) {
    skew = "bullish room";
  } else {
    skew = "no nearby ladder";
  }

  return `MAP: nearest support ${supportText} | nearest resistance ${resistanceText} | ${skew}`;
}

function buildSnapshotReadLines(payload: LevelSnapshotPayload): string[] {
  const nearestSupport = nearestSnapshotLevel(payload.supportZones, payload.currentPrice, "support");
  const nearestResistance = nearestSnapshotLevel(payload.resistanceZones, payload.currentPrice, "resistance");
  const lines: string[] = [];

  if (nearestSupport && nearestResistance) {
    const supportDistance = Math.abs(nearestSupport.representativePrice - payload.currentPrice) / Math.max(payload.currentPrice, 0.0001);
    const resistanceDistance = Math.abs(nearestResistance.representativePrice - payload.currentPrice) / Math.max(payload.currentPrice, 0.0001);
    lines.push(
      `Price is between support ${formatLevel(nearestSupport.representativePrice)} and resistance ${formatLevel(nearestResistance.representativePrice)}.`,
    );

    if (resistanceDistance < supportDistance * 0.8) {
      lines.push(
        `Upside room is tight until ${payload.symbol} clears ${formatLevel(nearestResistance.representativePrice)}.`,
      );
    } else if (supportDistance < resistanceDistance * 0.8) {
      lines.push(
        `Support is close while ${payload.symbol} holds above ${formatLevel(nearestSupport.representativePrice)}.`,
      );
    } else {
      lines.push("Room is fairly balanced between the nearest support and resistance.");
    }
    return lines;
  }

  if (nearestResistance) {
    lines.push(
      `Nearest resistance is ${formatLevel(nearestResistance.representativePrice)}; no nearby support is in the current ladder.`,
    );
    return lines;
  }

  if (nearestSupport) {
    lines.push(
      `Nearest support is ${formatLevel(nearestSupport.representativePrice)}; no nearby resistance is in the current ladder.`,
    );
    return lines;
  }

  return ["No nearby support or resistance is available in the current ladder."];
}

function formatSnapshotLevelList(
  zones: LevelSnapshotDisplayZone[],
  currentPrice: number,
  limit?: number,
): string {
  const selected = limit === undefined ? zones : zones.slice(0, limit);
  return selected.length > 0
    ? selected.map((zone) => formatSnapshotDisplayZone(zone, currentPrice)).join(", ")
    : "none";
}

export function formatLevelSnapshotMessage(payload: LevelSnapshotPayload): string {
  const keySupportLine = formatSnapshotLevelList(payload.supportZones, payload.currentPrice, 3);
  const keyResistanceLine = formatSnapshotLevelList(payload.resistanceZones, payload.currentPrice, 3);
  const supportLine = formatSnapshotLevelList(payload.supportZones, payload.currentPrice);
  const resistanceLine = formatSnapshotLevelList(payload.resistanceZones, payload.currentPrice);

  return [
    `LEVEL SNAPSHOT: ${payload.symbol}`,
    `PRICE: ${formatLevel(payload.currentPrice)}`,
    "",
    "CURRENT READ:",
    ...buildSnapshotReadLines(payload).map((line) => `- ${line}`),
    "",
    "KEY LEVELS:",
    `- Resistance: ${keyResistanceLine}`,
    `- Support: ${keySupportLine}`,
    "",
    "FULL LADDER:",
    `- Support: ${supportLine}`,
    `- Resistance: ${resistanceLine}`,
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
