// 2026-04-14 09:28 PM America/Toronto
// Alert formatting plus deterministic Discord thread routing.

import type { MonitoringEvent } from "../monitoring/monitoring-types.js";
import type { OpportunityInterpretation } from "../monitoring/opportunity-interpretation.js";
import type {
  AlertPayload,
  DiscordThread,
  TraderFollowThroughContext,
  TraderNextBarrierContext,
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

function formatAlertZoneRange(alert: IntelligentAlert): string | null {
  const low = formatAlertLevel(alert.zone?.zoneLow);
  const high = formatAlertLevel(alert.zone?.zoneHigh);
  const representative = formatAlertLevel(alert.zone?.representativePrice ?? alert.event.level);
  if (low && high) {
    return low === high ? low : `${low}-${high}`;
  }
  return representative;
}

function simplifyTraderRead(line: string): string {
  return line
    .replace(/^buyers still have workable control, but follow-through still matters$/i, "buyers have some control, but the move still needs follow-through")
    .replace(/^buyers still have strong control, backing the move$/i, "buyers are in control right now")
    .replace(/^buying and selling pressure still look balanced$/i, "buyers and sellers are still balanced")
    .replace(/^avoid longs until price reclaims (.+)$/i, "long setup stays risky until price reclaims $1")
    .replace(/^hold above /i, "confirmation: hold above ");
}

function buildCurrentReadLine(alert: IntelligentAlert): string {
  switch (alert.event.eventType) {
    case "level_touch":
      if (
        alert.event.zoneKind === "support" &&
        alert.zone !== undefined &&
        alert.event.triggerPrice > alert.zone.zoneHigh
      ) {
        return "Price is nearing support.";
      }
      return `Price is testing ${alert.event.zoneKind}.`;
    case "breakout":
    case "reclaim":
      return "Price is above resistance for now.";
    case "breakdown":
      return "Support is lost for now.";
    case "rejection":
    case "fake_breakout":
      return "Resistance is still pushing back.";
    case "fake_breakdown":
      return "Price reclaimed support for now.";
    case "compression":
      return "Price is tightening into a decision zone.";
    default:
      return "Price is near an important level.";
  }
}

function isLongCautionEventType(eventType: MonitoringEvent["eventType"]): boolean {
  return eventType === "breakdown" || eventType === "fake_breakout" || eventType === "rejection";
}

function formatBarrierWithStrength(barrier: TraderNextBarrierContext | null | undefined): string | null {
  if (!barrier) {
    return null;
  }

  const level = formatAlertLevel(barrier.price);
  if (!level) {
    return null;
  }

  if (barrier.strengthLabel) {
    return `${describeZoneStrength(barrier.strengthLabel)} ${barrier.side} ${level}`;
  }

  return `${barrier.side} near ${level}`;
}

function formatLostSupportAsResistance(alert: IntelligentAlert): string | null {
  if (!isLongCautionEventType(alert.event.eventType)) {
    return null;
  }

  const zoneRange = formatAlertZoneRange(alert);
  if (!zoneRange) {
    return null;
  }

  return alert.zone?.strengthLabel
    ? `${describeZoneStrength(alert.zone.strengthLabel)} resistance ${zoneRange}`
    : `resistance ${zoneRange}`;
}

function buildSupportReactionLine(alert: IntelligentAlert, barrierText: string | null): string | null {
  if (!barrierText || !isLongCautionEventType(alert.event.eventType) || alert.nextBarrier?.side !== "support") {
    return null;
  }

  const reclaimLevel = formatAlertLevel(alert.zone?.zoneHigh);
  if (alert.event.eventType === "breakdown" && reclaimLevel) {
    return `nearby support reaction area: ${barrierText}; buyers need stabilization there or a reclaim of ${reclaimLevel}`;
  }

  return `nearby support reaction area: ${barrierText}; buyers need stabilization there first`;
}

function buildHoldFailureMapLine(alert: IntelligentAlert, nextSupportText: string | null): string | null {
  if (!isLongCautionEventType(alert.event.eventType) || alert.nextBarrier?.side !== "support") {
    return null;
  }

  const reclaimLevel = formatAlertLevel(alert.zone?.zoneHigh);
  if (!reclaimLevel || !nextSupportText) {
    return null;
  }

  return `${reclaimLevel} is the reclaim line for the long setup; below it, risk stays open toward ${nextSupportText} unless buyers stabilize first.`;
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
  const barrierText = formatBarrierWithStrength(alert.nextBarrier);
  const eventType = alert.event.eventType;
  const watchParts = splitWatchLine(watch);
  const supportReactionLine = buildSupportReactionLine(alert, barrierText);
  const holdFailureMapLine = buildHoldFailureMapLine(alert, barrierText);
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
    const reclaimArea = formatLostSupportAsResistance(alert);
    if (reclaimArea) {
      nearbyLevels.push(`Reclaim area: ${reclaimArea}`);
    }
    if (alert.nextBarrier?.side === "support" && barrierText) {
      nearbyLevels.push(`Nearby support: ${barrierText}`);
    }
  } else if (eventType === "level_touch") {
    const zoneRange = formatAlertZoneRange(alert);
    const supportApproach =
      alert.event.zoneKind === "support" &&
      alert.zone !== undefined &&
      alert.event.triggerPrice > alert.zone.zoneHigh;
    pushNearbyLevel(supportApproach ? "Nearby" : "Testing", alert.event.zoneKind, zoneRange);
    pushNearbyLevel("Nearby", alert.nextBarrier?.side ?? "", barrierLevel);
  } else {
    pushNearbyLevel("First", alert.target?.side ?? "", targetLevel);
    pushNearbyLevel("Nearby", alert.nextBarrier?.side ?? "", barrierLevel);
  }

  const output = [lead];
  output.push("", buildCurrentReadLine(alert));
  if (readLines.length > 0) {
    output.push("", "What it means:", ...readLines.slice(0, 3).map((line) => `- ${line}`));
  }
  if (watchParts.confirm || watchParts.invalidation || supportReactionLine) {
    output.push("", "What to watch:");
    if (watchParts.confirm) {
      output.push(`- ${watchParts.confirm}`);
    }
    if (watchParts.invalidation) {
      output.push(`- invalidation: ${watchParts.invalidation.replace(/^invalidates\s*/i, "")}`);
    }
    if (supportReactionLine) {
      output.push(`- ${supportReactionLine}`);
    }
  }
  if (holdFailureMapLine) {
    output.push("", "Hold / failure map:", `- ${holdFailureMapLine}`);
  }
  if (nearbyLevels.length > 0) {
    output.push("", "Key levels:", ...nearbyLevels.map((line) => `- ${line}`));
  }
  output.push(
    "",
    `Triggered near: ${alert.event.triggerPrice >= 1 ? alert.event.triggerPrice.toFixed(2) : alert.event.triggerPrice.toFixed(4)}`,
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

function formatAlertPrice(value: number): string {
  return value >= 1 ? value.toFixed(2) : value.toFixed(4);
}

function followThroughEventLabel(eventType: string): string {
  if (eventType === "breakdown") {
    return "support-loss warning";
  }

  if (eventType === "fake_breakout") {
    return "failed-breakout warning";
  }

  if (eventType === "rejection") {
    return "rejection warning";
  }

  return eventType.replaceAll("_", " ");
}

function followThroughDecisionArea(params: {
  eventType: string;
  label: TraderFollowThroughContext["label"];
  entryPrice: number;
}): string {
  const eventType = followThroughEventLabel(params.eventType);
  const level = formatAlertPrice(params.entryPrice);
  if (params.label === "failed") {
    return `${eventType} is no longer confirmed; a reclaim of ${level} would make the setup cleaner for longs.`;
  }

  if (params.label === "strong") {
    return `${eventType} has expanded from ${level}; that level should keep holding for the move to stay clean.`;
  }

  if (params.label === "working") {
    return `${eventType} is still active; ${level} remains the key level to hold or reclaim before the next clean read.`;
  }

  if (params.label === "stalled") {
    return `${eventType} has stopped making progress; ${level} is the key level to watch for either recovery or fading momentum.`;
  }

  return `${eventType} is unresolved; ${level} remains the key level for the next clean read.`;
}

function followThroughStatusLine(label: TraderFollowThroughContext["label"]): string {
  switch (label) {
    case "strong":
      return "The move is holding up well.";
    case "working":
      return "The move is still holding up.";
    case "stalled":
      return "The move has stalled.";
    case "failed":
      return "The move lost momentum and the setup weakened.";
    default:
      return "The move is still unresolved.";
  }
}

function followThroughProgressLine(progressLabel: "improving" | "stalling" | "degrading"): string {
  switch (progressLabel) {
    case "improving":
      return "The move is improving.";
    case "stalling":
      return "The move is stalling.";
    case "degrading":
      return "The move is weakening.";
    default:
      return "The move is still developing.";
  }
}

export function formatFollowThroughUpdateAsPayload(params: {
  symbol: string;
  timestamp: number;
  followThrough: TraderFollowThroughContext;
  entryPrice: number;
  outcomePrice: number;
  repeatedOutcomeUpdate?: boolean;
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
  const eventType = followThroughEventLabel(followThrough.eventType);
  const entryText = formatAlertPrice(entryPrice);
  const outcomeText = formatAlertPrice(outcomePrice);

  return {
    title: `${symbol} ${eventType} follow-through`,
    body: [
      followThroughStatusLine(followThrough.label),
      "",
      "What changed:",
      `- ${stripLinePrefix(followThrough.line)}`,
      `- price change from trigger: ${directionalText}`,
      "",
      "Level to watch closely:",
      `- ${followThroughDecisionArea({
        eventType: followThrough.eventType,
        label: followThrough.label,
        entryPrice,
      })}`,
      "",
      "Path:",
      `- ${entryText} -> ${outcomeText} (${rawText} price move)`,
    ].join("\n"),
    symbol,
    timestamp,
    metadata: {
      messageKind: "follow_through_update",
      eventType: followThrough.eventType as MonitoringEvent["eventType"],
      followThroughLabel: followThrough.label,
      targetPrice: entryPrice,
      directionalReturnPct: followThrough.directionalReturnPct,
      rawReturnPct: followThrough.rawReturnPct,
      repeatedOutcomeUpdate: params.repeatedOutcomeUpdate ?? false,
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
  const eventLabel = followThroughEventLabel(eventType);
  const directionalText =
    directionalReturnPct === null
      ? "n/a"
      : formatPct(directionalReturnPct);
  const line =
    progressLabel === "improving"
      ? `${eventLabel} is improving`
      : progressLabel === "stalling"
        ? `${eventLabel} is stalling and needs a better reaction`
        : `${eventLabel} is degrading and needs to stabilize`;

  return {
    title: `${symbol} ${eventLabel} progress check`,
    body: [
      followThroughProgressLine(progressLabel),
      "",
      "What it means:",
      `- ${line}`,
      `- price change from trigger: ${directionalText}`,
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
    eventType?: string | null;
    level?: number;
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
          eventType: params.update.eventType ?? undefined,
          level: params.update.level,
          tags: [],
        }
      : null);

  if (!interpretation) {
    throw new Error("formatContinuityUpdateAsPayload requires an interpretation or update.");
  }

  return {
    title: `${interpretation.symbol} what changed`,
    body: interpretation.message,
    symbol: interpretation.symbol,
    timestamp: interpretation.timestamp,
    metadata: {
      messageKind: "continuity_update",
      eventType: interpretation.eventType as MonitoringEvent["eventType"] | undefined,
      targetPrice: interpretation.level,
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
    title: `${params.symbol} current read`,
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
  const descriptorParts = [descriptor, zone.sourceLabel, extension]
    .filter((value): value is string => Boolean(value))
    .filter((value, index, values) => values.indexOf(value) === index);
  const descriptorText = descriptorParts.join(", ");
  const suffix = [distance, descriptorText].filter((value): value is string => Boolean(value)).join(", ");

  if (!suffix) {
    return formatLevel(zone.representativePrice);
  }

  return `${formatLevel(zone.representativePrice)} (${suffix})`;
}

type SnapshotDisplayEntry =
  | { type: "single"; zone: LevelSnapshotDisplayZone }
  | {
      type: "cluster";
      zones: LevelSnapshotDisplayZone[];
      lowPrice: number;
      highPrice: number;
      representativePrice: number;
      strengthLabel?: LevelSnapshotDisplayZone["strengthLabel"];
    };

function strengthRank(label: LevelSnapshotDisplayZone["strengthLabel"]): number {
  switch (label) {
    case "major":
      return 4;
    case "strong":
      return 3;
    case "moderate":
      return 2;
    case "weak":
      return 1;
    default:
      return 0;
  }
}

function pickClusterStrength(zones: LevelSnapshotDisplayZone[]): LevelSnapshotDisplayZone["strengthLabel"] | undefined {
  return [...zones].sort((left, right) => strengthRank(right.strengthLabel) - strengthRank(left.strengthLabel))[0]?.strengthLabel;
}

function compactSnapshotDisplayEntries(
  zones: LevelSnapshotDisplayZone[],
  side: "support" | "resistance",
): SnapshotDisplayEntry[] {
  const sorted = [...zones].sort((left, right) =>
    side === "support"
      ? right.representativePrice - left.representativePrice
      : left.representativePrice - right.representativePrice,
  );
  const entries: SnapshotDisplayEntry[] = [];
  let index = 0;

  while (index < sorted.length) {
    const group = [sorted[index]!];
    let cursor = index + 1;

    while (cursor < sorted.length) {
      const candidate = sorted[cursor]!;
      const prices = [...group.map((zone) => zone.representativePrice), candidate.representativePrice];
      const lowPrice = Math.min(...prices);
      const highPrice = Math.max(...prices);
      const widthPct = (highPrice - lowPrice) / Math.max(lowPrice, 0.0001);
      if (widthPct > 0.04) {
        break;
      }
      group.push(candidate);
      cursor += 1;
    }

    if (group.length >= 3) {
      const prices = group.map((zone) => zone.representativePrice);
      const lowPrice = Math.min(...prices);
      const highPrice = Math.max(...prices);
      entries.push({
        type: "cluster",
        zones: group,
        lowPrice,
        highPrice,
        representativePrice: side === "support" ? highPrice : lowPrice,
        strengthLabel: pickClusterStrength(group),
      });
      index += group.length;
      continue;
    }

    entries.push({ type: "single", zone: sorted[index]! });
    index += 1;
  }

  return entries;
}

function formatDistanceRangeFromPrice(lowPrice: number, highPrice: number, currentPrice: number): string | null {
  const lowDistance = formatDistancePctFromPrice(lowPrice, currentPrice);
  const highDistance = formatDistancePctFromPrice(highPrice, currentPrice);
  if (!lowDistance || !highDistance) {
    return null;
  }
  return lowDistance === highDistance ? lowDistance : `${lowDistance} to ${highDistance}`;
}

function formatSnapshotDisplayEntry(
  entry: SnapshotDisplayEntry,
  currentPrice: number,
): string {
  if (entry.type === "single") {
    return formatSnapshotDisplayZone(entry.zone, currentPrice);
  }

  const distance = formatDistanceRangeFromPrice(entry.lowPrice, entry.highPrice, currentPrice);
  const descriptor = entry.strengthLabel ? describeZoneStrength(entry.strengthLabel) : null;
  const suffix = [distance, descriptor, "clustered levels"]
    .filter((value): value is string => Boolean(value))
    .join(", ");
  return `${formatLevel(entry.lowPrice)}-${formatLevel(entry.highPrice)} zone (${suffix})`;
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

  return `Nearest support and resistance: support ${supportText} | resistance ${resistanceText} | ${skew}`;
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

function formatSnapshotLevelBlock(
  label: "Resistance" | "Support",
  zones: LevelSnapshotDisplayZone[],
  currentPrice: number,
  limit?: number,
): string[] {
  const side = label === "Resistance" ? "resistance" : "support";
  const entries = compactSnapshotDisplayEntries(zones, side);
  const selected = limit === undefined ? entries : entries.slice(0, limit);
  if (selected.length === 0) {
    return [`${label}:`, "none"];
  }

  return [
    `${label}:`,
    ...selected.map((entry) => formatSnapshotDisplayEntry(entry, currentPrice)),
  ];
}

export function formatLevelSnapshotMessage(payload: LevelSnapshotPayload): string {
  const keyResistanceLines = formatSnapshotLevelBlock("Resistance", payload.resistanceZones, payload.currentPrice, 3);
  const keySupportLines = formatSnapshotLevelBlock("Support", payload.supportZones, payload.currentPrice, 3);
  const fullResistanceLines = formatSnapshotLevelBlock("Resistance", payload.resistanceZones, payload.currentPrice);
  const fullSupportLines = formatSnapshotLevelBlock("Support", payload.supportZones, payload.currentPrice);

  return [
    `${payload.symbol} support and resistance`,
    `Price: ${formatLevel(payload.currentPrice)}`,
    "",
    "What price is doing now:",
    ...buildSnapshotReadLines(payload).map((line) => `- ${line}`),
    "",
    "Closest levels to watch:",
    ...keyResistanceLines,
    "",
    ...keySupportLines,
    "",
    "More support and resistance:",
    ...fullResistanceLines,
    "",
    ...fullSupportLines,
  ].join("\n");
}

export function formatLevelExtensionMessage(payload: LevelExtensionPayload): string {
  const levelsLine =
    payload.levels.length > 0
      ? payload.levels.map((level) => formatLevel(level)).join(", ")
      : "none";

  return [
    `${payload.symbol} next levels to watch`,
    payload.side === "resistance"
      ? `Overhead resistance levels: ${levelsLine}`
      : `Lower support levels: ${levelsLine}`,
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
