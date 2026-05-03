// 2026-04-14 09:28 PM America/Toronto
// Alert formatting plus deterministic Discord thread routing.

import type { MonitoringEvent } from "../monitoring/monitoring-types.js";
import type { OpportunityInterpretation } from "../monitoring/opportunity-interpretation.js";
import {
  isAlertPrimaryCategoryLiveEnabled,
  isSignalCategoryLiveEnabled,
  resolvePrimarySignalCategoryForAlert,
  resolveSupportingSignalCategoriesForAlert,
  routeMessageKindToSignalCategory,
} from "../signals/signal-category-routing.js";
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
import { assessFinalLevelImportance, assessSnapshotDisplayLevelImportance } from "../monitoring/level-importance.js";

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

function classifyPostBudgetSymbolType(price: number | undefined): string {
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
    return "unknown";
  }
  if (price < 2) {
    return "low_priced_small_cap";
  }
  if (price < 10) {
    return "small_cap";
  }
  return "higher_priced_runner";
}

function whyIntelligentAlertPosted(alert: IntelligentAlert): string {
  const structure = alert.event.eventContext.tradeStructure?.state;
  if (alert.event.eventContext.stableMarketStructureMaterialChange) {
    return "material 5m structure change";
  }
  if (structure) {
    return `event passed policy with ${structure} structure`;
  }
  return `event passed ${alert.event.eventType} policy`;
}

function simplifyTraderRead(line: string): string {
  return line
    .replace(/^buyers still have workable control, but follow-through still matters$/i, "buyers have some control, but the move still needs follow-through")
    .replace(/^buyers still have strong control, backing the move$/i, "buyers are in control right now")
    .replace(/^buying and selling pressure still look balanced$/i, "buyers still need stronger acceptance")
    .replace(/^price is moving farther below support, increasing risk for longs \((.+)\)$/i, "price is below support; the lost area needs a cleaner reclaim ($1)")
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
      return "Price is above resistance for now.";
    case "reclaim":
      return "Price reclaimed support for now.";
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

function formatBarrierKeyLevelLabel(barrier: TraderNextBarrierContext | null | undefined): string {
  if (barrier?.side === "support" && barrier.roleFlipFromSide === "resistance") {
    return "Nearby hold area";
  }

  if (barrier?.side === "resistance" && barrier.roleFlipFromSide === "support") {
    return "Nearby reclaim area";
  }

  return "Nearby";
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
    if (alert.nextBarrier.distancePct < 0.025) {
      return `nearby support is still part of a tight support cluster around this area; buyers need stabilization or a reclaim of the lost support area`;
    }
    return `nearby support reaction area: ${barrierText}; buyers need stabilization there or a reclaim of the lost support area`;
  }

  return `nearby support reaction area: ${barrierText}; buyers need stabilization there first`;
}

function buildHoldFailureMapLine(alert: IntelligentAlert, nextSupportText: string | null): string | null {
  if (!isLongCautionEventType(alert.event.eventType) || alert.nextBarrier?.side !== "support") {
    return null;
  }

  const zoneRange = formatAlertZoneRange(alert);
  if (!zoneRange || !nextSupportText) {
    return null;
  }

  if (alert.nextBarrier.distancePct < 0.025) {
    return `${zoneRange} is part of a tight support cluster; the story changes only on a clean loss of the broader area.`;
  }

  return `${zoneRange} is the repair area for the long setup; if that whole area keeps failing cleanly, next broader support is ${nextSupportText}.`;
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

function buildSupportTouchPrimaryRead(alert: IntelligentAlert): string | null {
  if (
    alert.event.eventType !== "level_touch" ||
    alert.event.zoneKind !== "support" ||
    !alert.zone
  ) {
    return null;
  }

  if (alert.event.triggerPrice > alert.zone.zoneHigh) {
    return "price is nearing support; buyers need stabilization before the setup improves";
  }

  if (alert.event.triggerPrice < alert.zone.zoneLow) {
    return "price is below support; buyers need a reclaim before risk improves";
  }

  return "price is testing support after the pullback; buyers need stabilization here";
}

function buildReadableIntelligentAlertBody(alert: IntelligentAlert): string {
  const lines = alert.body.split("\n").map((line) => line.trim()).filter(Boolean);
  const lead = lines[0] ?? alert.title;
  const whyNow = pickBodyLine(lines, "why now:");
  const movement = pickLine(lines, "movement:", alert.movement);
  const pressure = pickLine(lines, "pressure:", alert.pressure);
  const marketStructure = pickLine(lines, "market structure:", alert.marketStructure);
  const volumeActivity = pickBodyLine(lines, "activity:") ?? alert.volumeActivity?.traderLine ?? null;
  const room = pickBodyLine(lines, "room:");
  const watch = pickBodyLine(lines, "watch:");
  const failureRisk = pickLine(lines, "failure risk:", alert.failureRisk);
  const targetLevel = formatAlertLevel(alert.target?.price);
  const barrierLevel = formatAlertLevel(alert.nextBarrier?.price);
  const barrierText = formatBarrierWithStrength(alert.nextBarrier);
  const barrierKeyLevelLabel = formatBarrierKeyLevelLabel(alert.nextBarrier);
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
    if (marketStructure && readLines.length < 3) {
      readLines.push(simplifyTraderRead(lowercaseFirst(stripLinePrefix(marketStructure))));
    }
    if (volumeActivity && readLines.length < 3) {
      readLines.push(simplifyTraderRead(lowercaseFirst(stripLinePrefix(volumeActivity))));
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
    if (marketStructure && readLines.length < 3) {
      readLines.push(simplifyTraderRead(lowercaseFirst(stripLinePrefix(marketStructure))));
    }
    if (volumeActivity && readLines.length < 3) {
      readLines.push(simplifyTraderRead(lowercaseFirst(stripLinePrefix(volumeActivity))));
    }
  } else if (eventType === "level_touch") {
    const supportTouchRead = buildSupportTouchPrimaryRead(alert);
    readLines.push(
      supportTouchRead ??
      (pressure
        ? simplifyTraderRead(lowercaseFirst(stripLinePrefix(pressure)))
        : whyNow
          ? simplifyTraderRead(lowercaseFirst(stripLinePrefix(whyNow)))
          : "price is testing a key zone"),
    );
    if (whyNow) {
      readLines.push(simplifyTraderRead(lowercaseFirst(stripLinePrefix(whyNow))));
    }
    if (room) {
      readLines.push(simplifyTraderRead(lowercaseFirst(stripLinePrefix(room))));
    }
    if (marketStructure && readLines.length < 3) {
      readLines.push(simplifyTraderRead(lowercaseFirst(stripLinePrefix(marketStructure))));
    }
    if (volumeActivity && readLines.length < 3) {
      readLines.push(simplifyTraderRead(lowercaseFirst(stripLinePrefix(volumeActivity))));
    }
  } else {
    if (whyNow) {
      readLines.push(simplifyTraderRead(lowercaseFirst(stripLinePrefix(whyNow))));
    }
    if (movement) {
      readLines.push(simplifyTraderRead(lowercaseFirst(stripLinePrefix(movement))));
    }
    if (marketStructure && readLines.length < 3) {
      readLines.push(simplifyTraderRead(lowercaseFirst(stripLinePrefix(marketStructure))));
    }
    if (volumeActivity && readLines.length < 3) {
      readLines.push(simplifyTraderRead(lowercaseFirst(stripLinePrefix(volumeActivity))));
    }
  }

  if (readLines.length < 3 && failureRisk && alert.failureRisk?.label === "high") {
    readLines.push(`setup is fragile here: ${stripLinePrefix(failureRisk).replace(/^high because /, "")}`);
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
    nearbyLevels.push(side ? `${label} ${side}: ${level}` : `${label}: ${level}`);
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
    pushNearbyLevel(
      barrierKeyLevelLabel,
      alert.nextBarrier?.roleFlipFromSide ? "" : alert.nextBarrier?.side ?? "",
      barrierLevel,
    );
  } else {
    pushNearbyLevel("First", alert.target?.side ?? "", targetLevel);
    pushNearbyLevel(
      barrierKeyLevelLabel,
      alert.nextBarrier?.roleFlipFromSide ? "" : alert.nextBarrier?.side ?? "",
      barrierLevel,
    );
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
  const signalCategory = resolvePrimarySignalCategoryForAlert(alert);
  const levelImportance = alert.zone
    ? assessFinalLevelImportance({
        zone: alert.zone,
        price: alert.event.triggerPrice,
      })
    : null;
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
      signalCategory,
      signalCategoryLiveEnabled: isAlertPrimaryCategoryLiveEnabled(alert),
      supportingSignalCategories: resolveSupportingSignalCategoriesForAlert(alert),
      clearanceLabel: alert.nextBarrier?.clearanceLabel,
      barrierClutterLabel: alert.nextBarrier?.clutterLabel,
      nearbyBarrierCount: alert.nextBarrier?.nearbyBarrierCount,
      nextBarrierSide: alert.nextBarrier?.side,
      nextBarrierDistancePct: alert.nextBarrier?.distancePct,
      nextBarrierRoleFlipFromSide: alert.nextBarrier?.roleFlipFromSide,
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
      marketStructureLabel: alert.marketStructure?.label,
      marketStructureType: alert.marketStructure?.structureType,
      marketStructureStrength: alert.marketStructure?.strength,
      practicalStructureState: alert.event.eventContext.tradeStructure?.state,
      practicalStructureKey: alert.event.eventContext.tradeStructure?.structureKey,
      practicalZoneKey: alert.event.eventContext.tradeStructure?.practicalZoneKey,
      practicalStructureMaterialChange: alert.event.eventContext.tradeStructure?.isMaterialStateChange,
      stableMarketStructureState: alert.event.eventContext.stableMarketStructureState,
      stableMarketStructurePreviousState: alert.event.eventContext.stableMarketStructurePreviousState,
      stableMarketStructureKey: alert.event.eventContext.stableMarketStructureKey,
      stableMarketStructureMaterialChange: alert.event.eventContext.stableMarketStructureMaterialChange,
      stableMarketStructureConfidence: alert.event.eventContext.stableMarketStructureConfidence,
      stableMarketStructureMaterialityScore: alert.event.eventContext.stableMarketStructureMaterialityScore,
      volumeActivityLabel: alert.event.eventContext.volumeActivity?.label,
      volumeActivityReliability: alert.event.eventContext.volumeActivity?.reliability,
      volumeActivityRatio: alert.event.eventContext.volumeActivity?.relativeVolumeRatio,
      volumeActivityDirection: alert.event.eventContext.volumeActivity?.direction,
      volumeActivityShown: Boolean(alert.volumeActivity?.traderLine),
      volumeActivitySuppressedReason: alert.volumeActivity?.traderLine
        ? undefined
        : alert.event.eventContext.volumeActivity?.reason,
      tradeStoryState: alert.event.eventContext.tradeStoryState,
      rangeBoxLabel: alert.event.eventContext.rangeBox?.label,
      rangeBoxWidthPct: alert.event.eventContext.rangeBox?.widthPct,
      acceptanceLabel: alert.event.eventContext.acceptance?.label,
      acceptanceBeyondZonePct: alert.event.eventContext.acceptance?.beyondZonePct,
      supportImportanceLabel: alert.event.eventContext.supportImportance?.label,
      behaviorBudgetLabel: alert.event.eventContext.behaviorBudget?.label,
      behaviorBudgetMaxUsefulPosts: alert.event.eventContext.behaviorBudget?.maxUsefulPostsPerDay,
      primaryTradeAreaLocked: alert.event.eventContext.primaryTradeArea?.locked,
      primaryTradeAreaEscapeSide: alert.event.eventContext.primaryTradeArea?.escapeSide,
      primaryTradeAreaEscapeConfidence: alert.event.eventContext.primaryTradeArea?.escapeConfidence,
      failedLevelOutcome: alert.event.eventContext.failedLevelMemory?.outcome,
      failedLevelFailureCount: alert.event.eventContext.failedLevelMemory?.failureCount,
      levelImportanceLabel: levelImportance?.label,
      levelImportanceScore: levelImportance?.score,
      failureRiskLabel: alert.failureRisk?.label,
      tradeMapLabel: alert.tradeMap?.label,
      riskPct: alert.tradeMap?.riskPct,
      roomToRiskRatio: alert.tradeMap?.roomToRiskRatio ?? undefined,
      targetSide: alert.target?.side,
      targetPrice: alert.target?.price,
      targetDistancePct: alert.target?.distancePct,
      whyPosted: whyIntelligentAlertPosted(alert),
      postBudgetSymbolType: classifyPostBudgetSymbolType(alert.event.triggerPrice),
      noLevelReason: alert.nextBarrier ? undefined : "next barrier not available in alert context",
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
    return "support loss";
  }

  if (eventType === "fake_breakout") {
    return "failed breakout";
  }

  if (eventType === "rejection") {
    return "rejection";
  }

  return eventType.replaceAll("_", " ");
}

function isCompressionFollowThrough(eventType: string): boolean {
  return eventType === "compression";
}

function followThroughDecisionArea(params: {
  eventType: string;
  label: TraderFollowThroughContext["label"];
  entryPrice: number;
}): string {
  const eventType = followThroughEventLabel(params.eventType);
  const level = formatAlertPrice(params.entryPrice);
  if (isCompressionFollowThrough(params.eventType)) {
    if (params.label === "failed") {
      return `compression reaction has faded; ${level} remains the comparison level for the next clean read.`;
    }

    if (params.label === "strong") {
      return `compression expanded from ${level}; compare price against that area before the next clean read.`;
    }

    if (params.label === "working") {
      return `compression is still reacting around ${level}; that area remains the comparison level.`;
    }

    if (params.label === "stalled") {
      return `compression has stopped making progress; ${level} is the level to compare against next.`;
    }
  }

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

function followThroughStatusLine(label: TraderFollowThroughContext["label"], eventType?: string): string {
  if (eventType !== undefined && isCompressionFollowThrough(eventType)) {
    switch (label) {
      case "strong":
        return "Compression produced a stronger reaction.";
      case "working":
        return "Compression is still reacting around the level.";
      case "stalled":
        return "Compression reaction has stalled.";
      case "failed":
        return "Compression reaction faded.";
      default:
        return "Compression is still unresolved.";
    }
  }

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

function followThroughChangedLine(followThrough: TraderFollowThroughContext): string {
  if (isCompressionFollowThrough(followThrough.eventType)) {
    switch (followThrough.label) {
      case "strong":
        return "compression produced a stronger reaction";
      case "working":
        return "compression is still reacting around the level";
      case "stalled":
        return "compression reaction stalled";
      case "failed":
        return "compression reaction faded";
      default:
        return "compression outcome is still unclear";
    }
  }

  return stripLinePrefix(followThrough.line);
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
  const isCompression = isCompressionFollowThrough(followThrough.eventType);
  const displayedChangeText = isCompression ? rawText : directionalText;
  const displayedChangeLabel = isCompression ? "price move from trigger" : "price change from trigger";

  const signalCategory = routeMessageKindToSignalCategory({
    messageKind: "follow_through_update",
    eventType: followThrough.eventType as MonitoringEvent["eventType"],
  }).primaryCategory;
  return {
    title: `${symbol} ${eventType} follow-through`,
    body: [
      followThroughStatusLine(followThrough.label, followThrough.eventType),
      "",
      "What changed:",
      `- ${followThroughChangedLine(followThrough)}`,
      `- ${displayedChangeLabel}: ${displayedChangeText}`,
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
      signalCategory,
      signalCategoryLiveEnabled: isSignalCategoryLiveEnabled(signalCategory),
      followThroughLabel: followThrough.label,
      targetPrice: entryPrice,
      directionalReturnPct: followThrough.directionalReturnPct,
      rawReturnPct: followThrough.rawReturnPct,
      repeatedOutcomeUpdate: params.repeatedOutcomeUpdate ?? false,
      whyPosted: params.repeatedOutcomeUpdate
        ? "material follow-through update after prior outcome"
        : "new follow-through outcome",
      postBudgetSymbolType: classifyPostBudgetSymbolType(entryPrice),
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

  const signalCategory = routeMessageKindToSignalCategory({
    messageKind: "follow_through_state_update",
    eventType: eventType as MonitoringEvent["eventType"],
  }).primaryCategory;

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
      signalCategory,
      signalCategoryLiveEnabled: isSignalCategoryLiveEnabled(signalCategory),
      progressLabel,
      directionalReturnPct,
      whyPosted: `${progressLabel} follow-through progress`,
      postBudgetSymbolType: classifyPostBudgetSymbolType(entryPrice),
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

  const signalCategory = routeMessageKindToSignalCategory({
    messageKind: "continuity_update",
    eventType: interpretation.eventType as MonitoringEvent["eventType"] | undefined,
  }).primaryCategory;

  return {
    title: `${interpretation.symbol} what changed`,
    body: interpretation.message,
    symbol: interpretation.symbol,
    timestamp: interpretation.timestamp,
    metadata: {
      messageKind: "continuity_update",
      eventType: interpretation.eventType as MonitoringEvent["eventType"] | undefined,
      signalCategory,
      signalCategoryLiveEnabled: isSignalCategoryLiveEnabled(signalCategory),
      targetPrice: interpretation.level,
      continuityType: interpretation.type,
      whyPosted: `continuity changed to ${interpretation.type}`,
      postBudgetSymbolType: classifyPostBudgetSymbolType(interpretation.level),
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
      signalCategory: "trader_commentary",
      signalCategoryLiveEnabled: isSignalCategoryLiveEnabled("trader_commentary"),
      aiGenerated: params.aiGenerated ?? false,
      whyPosted: params.aiGenerated ? "AI-enhanced symbol recap passed optional context policy" : "symbol recap passed optional context policy",
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

function snapshotEntryLow(entry: SnapshotDisplayEntry): number {
  return entry.type === "single"
    ? entry.zone.lowPrice ?? entry.zone.representativePrice
    : entry.lowPrice;
}

function snapshotEntryHigh(entry: SnapshotDisplayEntry): number {
  return entry.type === "single"
    ? entry.zone.highPrice ?? entry.zone.representativePrice
    : entry.highPrice;
}

function snapshotEntryRepresentative(entry: SnapshotDisplayEntry, side: "support" | "resistance"): number {
  if (entry.type === "single") {
    return entry.zone.representativePrice;
  }

  return side === "support" ? entry.highPrice : entry.lowPrice;
}

function snapshotEntryStrength(entry: SnapshotDisplayEntry): LevelSnapshotDisplayZone["strengthLabel"] | undefined {
  return entry.type === "single" ? entry.zone.strengthLabel : entry.strengthLabel;
}

function snapshotEntrySourceLabels(entry: SnapshotDisplayEntry): string[] {
  if (entry.type === "single") {
    return entry.zone.sourceLabel ? [entry.zone.sourceLabel] : [];
  }

  return [...new Set(entry.zones.flatMap((zone) => zone.sourceLabel ? [zone.sourceLabel] : []))];
}

function snapshotEntryZones(entry: SnapshotDisplayEntry): LevelSnapshotDisplayZone[] {
  return entry.type === "single" ? [entry.zone] : entry.zones;
}

function formatSnapshotEntryPrice(entry: SnapshotDisplayEntry): string {
  if (entry.type === "single") {
    const low = snapshotEntryLow(entry);
    const high = snapshotEntryHigh(entry);
    if (Math.abs(high - low) > Math.max(Math.abs(entry.zone.representativePrice) * 0.004, 0.005)) {
      return `${formatLevel(low)}-${formatLevel(high)}`;
    }
    return formatLevel(entry.zone.representativePrice);
  }

  return `${formatLevel(entry.lowPrice)}-${formatLevel(entry.highPrice)}`;
}

function formatSnapshotEntryLabel(entry: SnapshotDisplayEntry, side: "support" | "resistance"): string {
  const strength = snapshotEntryStrength(entry);
  const strengthText = strength ? `${describeZoneStrength(strength)} ` : "";
  const areaText = entry.type === "cluster" || formatSnapshotEntryPrice(entry).includes("-") ? "area" : "";
  return `${strengthText}${side} ${formatSnapshotEntryPrice(entry)}${areaText ? ` ${areaText}` : ""}`;
}

function formatSnapshotEntryDistance(entry: SnapshotDisplayEntry, currentPrice: number, side: "support" | "resistance"): string | null {
  if (entry.type === "cluster" || formatSnapshotEntryPrice(entry).includes("-")) {
    return formatDistanceRangeFromPrice(snapshotEntryLow(entry), snapshotEntryHigh(entry), currentPrice);
  }

  const level = snapshotEntryRepresentative(entry, side);
  return formatDistancePctFromPrice(level, currentPrice);
}

function formatSnapshotEntryLabelWithDistance(
  entry: SnapshotDisplayEntry,
  currentPrice: number,
  side: "support" | "resistance",
): string {
  const label = formatSnapshotEntryLabel(entry, side);
  const distance = formatSnapshotEntryDistance(entry, currentPrice, side);
  return distance ? `${label} (${distance})` : label;
}

function snapshotEntryImportance(
  entry: SnapshotDisplayEntry,
  currentPrice: number,
  side: "support" | "resistance",
) {
  if (entry.type === "single") {
    return assessSnapshotDisplayLevelImportance({
      zone: entry.zone,
      price: currentPrice,
      side,
      zoneCount: 1,
    });
  }

  const strongest = [...entry.zones]
    .sort((left, right) => strengthRank(right.strengthLabel) - strengthRank(left.strengthLabel))[0]!;
  return assessSnapshotDisplayLevelImportance({
    zone: {
      ...strongest,
      representativePrice: entry.representativePrice,
      lowPrice: entry.lowPrice,
      highPrice: entry.highPrice,
      strengthLabel: entry.strengthLabel,
    },
    price: currentPrice,
    side,
    zoneCount: entry.zones.length,
  });
}

function formatTradeMapImportancePrefix(
  entry: SnapshotDisplayEntry,
  currentPrice: number,
  side: "support" | "resistance",
): string {
  const importance = snapshotEntryImportance(entry, currentPrice, side);
  if (importance.label === "major_decision" || importance.label === "active_trade_boundary") {
    return side === "support" ? "Main support" : "Main resistance";
  }
  if (importance.label === "minor_noise") {
    return side === "support" ? "Minor support reference" : "Minor resistance reference";
  }
  return side === "support" ? "Useful support" : "Useful resistance";
}

function isIntradaySnapshotEntry(entry: SnapshotDisplayEntry): boolean {
  return snapshotEntrySourceLabels(entry).some((label) => /intraday|5m/i.test(label));
}

function nearestSnapshotEntry(
  zones: LevelSnapshotDisplayZone[],
  currentPrice: number,
  side: "support" | "resistance",
): SnapshotDisplayEntry | null {
  const entries = compactSnapshotDisplayEntries(zones, side)
    .filter((entry) =>
      side === "support"
        ? snapshotEntryHigh(entry) < currentPrice
        : snapshotEntryLow(entry) > currentPrice,
    )
    .sort((left, right) =>
      side === "support"
        ? snapshotEntryHigh(right) - snapshotEntryHigh(left)
        : snapshotEntryLow(left) - snapshotEntryLow(right),
    );

  return entries[0] ?? null;
}

function nextSnapshotEntryAfter(
  zones: LevelSnapshotDisplayZone[],
  currentEntry: SnapshotDisplayEntry,
  side: "support" | "resistance",
): SnapshotDisplayEntry | null {
  const entries = compactSnapshotDisplayEntries(zones, side)
    .filter((entry) => {
      if (entry === currentEntry) {
        return false;
      }

      return side === "support"
        ? snapshotEntryHigh(entry) < snapshotEntryLow(currentEntry)
        : snapshotEntryLow(entry) > snapshotEntryHigh(currentEntry);
    })
    .sort((left, right) =>
      side === "support"
        ? snapshotEntryHigh(right) - snapshotEntryHigh(left)
        : snapshotEntryLow(left) - snapshotEntryLow(right),
    );

  return entries[0] ?? null;
}

function nearestIntradaySupportEntry(
  zones: LevelSnapshotDisplayZone[],
  currentPrice: number,
): SnapshotDisplayEntry | null {
  return compactSnapshotDisplayEntries(zones, "support")
    .filter((entry) => snapshotEntryHigh(entry) < currentPrice && isIntradaySnapshotEntry(entry))
    .sort((left, right) => snapshotEntryHigh(right) - snapshotEntryHigh(left))[0] ?? null;
}

function practicalAreaWidthLimit(currentPrice: number): { pct: number; absolute: number } {
  if (currentPrice < 2) {
    return { pct: 0.04, absolute: 0.035 };
  }

  if (currentPrice < 10) {
    return { pct: 0.03, absolute: 0.12 };
  }

  return { pct: 0.025, absolute: currentPrice * 0.025 };
}

function buildPracticalSnapshotAreaEntry(
  zones: LevelSnapshotDisplayZone[],
  currentPrice: number,
  side: "support" | "resistance",
): SnapshotDisplayEntry | null {
  const entries = compactSnapshotDisplayEntries(zones, side)
    .filter((entry) =>
      side === "support"
        ? snapshotEntryHigh(entry) < currentPrice
        : snapshotEntryLow(entry) > currentPrice,
    )
    .sort((left, right) =>
      side === "support"
        ? snapshotEntryHigh(right) - snapshotEntryHigh(left)
        : snapshotEntryLow(left) - snapshotEntryLow(right),
    );

  const first = entries[0];
  if (!first) {
    return null;
  }

  const limits = practicalAreaWidthLimit(currentPrice);
  const group = [first];

  for (const candidate of entries.slice(1, 3)) {
    const lowPrice = Math.min(...group.map(snapshotEntryLow), snapshotEntryLow(candidate));
    const highPrice = Math.max(...group.map(snapshotEntryHigh), snapshotEntryHigh(candidate));
    const width = highPrice - lowPrice;
    const widthPct = width / Math.max(lowPrice, 0.0001);
    if (widthPct > limits.pct || width > limits.absolute) {
      break;
    }

    group.push(candidate);
  }

  if (group.length < 2) {
    return first;
  }

  const lowPrice = Math.min(...group.map(snapshotEntryLow));
  const highPrice = Math.max(...group.map(snapshotEntryHigh));
  const groupedZones = group.flatMap(snapshotEntryZones);
  return {
    type: "cluster",
    zones: groupedZones,
    lowPrice,
    highPrice,
    representativePrice: side === "support" ? highPrice : lowPrice,
    strengthLabel: pickClusterStrength(groupedZones),
  };
}

function buildSnapshotTradeMapLines(payload: LevelSnapshotPayload): string[] {
  const support = buildPracticalSnapshotAreaEntry(payload.supportZones, payload.currentPrice, "support");
  const resistance = buildPracticalSnapshotAreaEntry(payload.resistanceZones, payload.currentPrice, "resistance");
  const nextResistance = resistance
    ? nextSnapshotEntryAfter(payload.resistanceZones, resistance, "resistance")
    : null;
  const deeperSupport = support
    ? nextSnapshotEntryAfter(payload.supportZones, support, "support")
    : null;
  const intradaySupport = nearestIntradaySupportEntry(payload.supportZones, payload.currentPrice);
  const lines: string[] = [];
  const supportLabel = support ? formatSnapshotEntryLabel(support, "support") : null;
  const supportLabelWithDistance = support
    ? formatSnapshotEntryLabelWithDistance(support, payload.currentPrice, "support")
    : null;
  const resistanceLabel = resistance ? formatSnapshotEntryLabel(resistance, "resistance") : null;
  const resistanceLabelWithDistance = resistance
    ? formatSnapshotEntryLabelWithDistance(resistance, payload.currentPrice, "resistance")
    : null;
  const nextResistanceLabelWithDistance = nextResistance
    ? formatSnapshotEntryLabelWithDistance(nextResistance, payload.currentPrice, "resistance")
    : null;
  const deeperSupportLabelWithDistance = deeperSupport
    ? formatSnapshotEntryLabelWithDistance(deeperSupport, payload.currentPrice, "support")
    : null;
  const supportPrefix = support ? formatTradeMapImportancePrefix(support, payload.currentPrice, "support") : null;
  const resistancePrefix = resistance ? formatTradeMapImportancePrefix(resistance, payload.currentPrice, "resistance") : null;

  if (support && resistance && supportLabel && resistanceLabel) {
    const supportLine = snapshotEntryHigh(support);
    const resistanceLine = snapshotEntryLow(resistance);
    const supportDistance = Math.abs(payload.currentPrice - supportLine) / Math.max(payload.currentPrice, 0.0001);
    const resistanceDistance = Math.abs(resistanceLine - payload.currentPrice) / Math.max(payload.currentPrice, 0.0001);
    const bandWidth = (resistanceLine - supportLine) / Math.max(payload.currentPrice, 0.0001);

    if (bandWidth <= 0.12) {
      lines.push(
        `Current structure: ${payload.symbol} is range-bound between ${supportLabel} and ${resistanceLabel}.`,
      );
      lines.push(`${resistancePrefix}: ${resistanceLabel} is the upside area that needs acceptance.`);
      lines.push(`${supportPrefix}: ${supportLabel} is the area buyers need to keep holding for the range to stay constructive.`);
      lines.push("Small pushes inside this band can be noise; the cleaner read comes from expansion above resistance or a clean loss of support.");
    } else if (resistanceDistance <= 0.035) {
      lines.push(`Current structure: ${payload.symbol} is pressing ${resistanceLabel}.`);
      lines.push(`${resistancePrefix}: buyers need acceptance above ${resistanceLabel} before the breakout read is cleaner.`);
      lines.push(`${supportPrefix}: a clean loss of ${supportLabel} would weaken the setup.`);
    } else if (supportDistance <= 0.035) {
      lines.push(`Current structure: ${payload.symbol} is pulling into ${supportLabel}.`);
      lines.push(`${supportPrefix}: buyers need ${supportLabel} to stabilize before the next resistance test matters.`);
      lines.push(`${resistancePrefix}: ${resistanceLabel} is the next resistance area above.`);
    } else {
      lines.push(
        `Current structure: ${payload.symbol} is trading between ${supportLabel} and ${resistanceLabel}.`,
      );
      lines.push(`${supportPrefix}: ${supportLabel}.`);
      lines.push(`${resistancePrefix}: ${resistanceLabel}.`);
    }
  } else if (resistance && resistanceLabel) {
    lines.push(`Current structure: ${payload.symbol} is below ${resistanceLabel}.`);
    lines.push(`${resistancePrefix}: ${resistanceLabel} is the first area buyers need to clear.`);
  } else if (support && supportLabel) {
    lines.push(`Current structure: ${payload.symbol} is above ${supportLabel}.`);
    lines.push(`${supportPrefix}: ${supportLabel} is the first area buyers need to keep holding.`);
  } else {
    lines.push("Current structure: no nearby support or resistance is available in this snapshot.");
  }

  if (resistance && resistanceLabelWithDistance) {
    if (nextResistanceLabelWithDistance) {
      lines.push(
        `Cleaner above: acceptance above ${resistanceLabelWithDistance} would shift attention toward ${nextResistanceLabelWithDistance}.`,
      );
    } else {
      lines.push(
        `Cleaner above: acceptance above ${resistanceLabelWithDistance} would be constructive; higher resistance needs a fresh level check before treating the path as open.`,
      );
    }
  }

  if (support && supportLabelWithDistance) {
    lines.push(`Support that matters: ${supportLabelWithDistance} is the first practical area buyers need to keep defending.`);
    if (deeperSupportLabelWithDistance) {
      lines.push(
        `Broader support: a clean loss of ${supportLabel} as a whole area would shift attention toward ${deeperSupportLabelWithDistance}.`,
      );
    }
  }

  if (intradaySupport && (!support || formatSnapshotEntryPrice(intradaySupport) !== formatSnapshotEntryPrice(support))) {
    lines.push(
      `Short-term momentum support: ${formatSnapshotEntryLabelWithDistance(intradaySupport, payload.currentPrice, "support")}.`,
    );
  } else if (intradaySupport) {
    lines.push(`Short-term momentum support is the same area: ${formatSnapshotEntryLabel(intradaySupport, "support")}.`);
  }

  if (support && resistance) {
    const supportLine = snapshotEntryHigh(support);
    const resistanceLine = snapshotEntryLow(resistance);
    const bandWidth = (resistanceLine - supportLine) / Math.max(payload.currentPrice, 0.0001);
    const supportDistance = Math.abs(payload.currentPrice - supportLine) / Math.max(payload.currentPrice, 0.0001);
    if (bandWidth <= 0.12) {
      lines.push("Setup quality: mixed and range-bound; better information comes from a clean expansion or a clean support failure.");
    } else if (supportDistance >= 0.15) {
      lines.push("Setup quality: extended from support; cleaner continuation needs acceptance above resistance or a controlled pullback that holds structure.");
    } else {
      lines.push("Setup quality: cleaner while price respects support and works toward the next resistance area.");
    }
  }

  return lines;
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

function formatSnapshotReadLevel(
  zone: LevelSnapshotDisplayZone,
  side: "support" | "resistance",
): string {
  const strength = zone.strengthLabel ? `${describeZoneStrength(zone.strengthLabel)} ` : "";
  return `${strength}${side} ${formatLevel(zone.representativePrice)}`;
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
    skew = "no nearby levels";
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
      `Price is between ${formatSnapshotReadLevel(nearestSupport, "support")} and ${formatSnapshotReadLevel(nearestResistance, "resistance")}.`,
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
      `Nearest resistance is ${formatSnapshotReadLevel(nearestResistance, "resistance")}; nearby support was not available from this snapshot.`,
    );
    return lines;
  }

  if (nearestSupport) {
    lines.push(
      `Nearest support is ${formatSnapshotReadLevel(nearestSupport, "support")}; nearby resistance was not available from this snapshot.`,
    );
    return lines;
  }

  return ["No nearby support or resistance is available in this snapshot."];
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

function formatLevelContextLine(payload: LevelSnapshotPayload): string {
  const supportCount = payload.audit?.supportCandidates.length ?? payload.supportZones.length;
  const resistanceCount = payload.audit?.resistanceCandidates.length ?? payload.resistanceZones.length;
  if (supportCount >= 5 && resistanceCount >= 5) {
    return "Level context: nearby support and resistance are well defined.";
  }
  if (supportCount >= 3 && resistanceCount >= 3) {
    return "Level context: nearby levels are usable, but reactions still matter more than exact pennies.";
  }
  if (supportCount > 0 || resistanceCount > 0) {
    return "Level context: the nearby ladder is thin, so the strongest areas matter more than every small level.";
  }
  return "Level context: nearby levels are limited in this snapshot.";
}

export function formatLevelSnapshotMessage(payload: LevelSnapshotPayload): string {
  const keyResistanceLines = formatSnapshotLevelBlock("Resistance", payload.resistanceZones, payload.currentPrice, 3);
  const keySupportLines = formatSnapshotLevelBlock("Support", payload.supportZones, payload.currentPrice, 3);
  const fullResistanceLines = formatSnapshotLevelBlock("Resistance", payload.resistanceZones, payload.currentPrice);
  const fullSupportLines = formatSnapshotLevelBlock("Support", payload.supportZones, payload.currentPrice);
  const tradeMapLines = buildSnapshotTradeMapLines(payload);
  const tradePlanLines = payload.tradePlan?.lines.filter((line) => line.trim().length > 0) ?? [];

  return [
    `${payload.symbol} support and resistance`,
    `Price: ${formatLevel(payload.currentPrice)}`,
    formatLevelContextLine(payload),
    "",
    ...(tradePlanLines.length > 0
      ? [
          payload.tradePlan?.title ?? "Trade plan:",
          ...tradePlanLines,
          "",
        ]
      : []),
    "Trade map:",
    ...tradeMapLines,
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
