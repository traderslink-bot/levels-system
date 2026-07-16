// 2026-04-14 09:28 PM America/Toronto
// Alert formatting plus deterministic Discord thread routing.

import type {
  MonitoringEvent,
  RuntimeMarketStructureTimeframeSnapshot,
} from "../monitoring/monitoring-types.js";
import type { FormalStructureTimeframe } from "../structure/index.js";
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
import { isActionableFormalBosChoch } from "../monitoring/market-structure-story-memory.js";
import { formatPotentialMoveRead } from "../monitoring/potential-move-read.js";

type FormalMarketStructureSnapshot = NonNullable<LevelSnapshotPayload["marketStructure"]>["formal"];
type MarketStructureStoryVisibility = "auto" | "always" | "material_only" | "metadata_only";
type MarketStructureStoryFormatOptions = {
  marketStructureStoryVisibility?: MarketStructureStoryVisibility;
  marketStructureStoryKeys?: string[];
};

export const WATCHLIST_TRADER_READ_AI_ENABLED_ENV = "WATCHLIST_TRADER_READ_AI_ENABLED";
let watchlistTraderReadAiNotImplementedWarningShown = false;

export function isWatchlistTraderReadAiEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[WATCHLIST_TRADER_READ_AI_ENABLED_ENV]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function warnIfWatchlistTraderReadAiRequested(): void {
  if (
    !watchlistTraderReadAiNotImplementedWarningShown &&
    isWatchlistTraderReadAiEnabled()
  ) {
    watchlistTraderReadAiNotImplementedWarningShown = true;
    console.warn(
      `[AlertRouter] ${WATCHLIST_TRADER_READ_AI_ENABLED_ENV} is enabled, but AI watchlist trader reads are not implemented yet; using deterministic trader read output.`,
    );
  }
}

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
  const context = alert.event.eventContext;
  const structure = context.tradeStructure?.state;
  const formalStructureMaterialChange =
    context.selectedFormalStructureMaterialChange ?? context.formalStructureMaterialChange;
  if (formalStructureMaterialChange) {
    return `formal ${context.selectedFormalStructureTimeframe ?? context.formalStructureTimeframe ?? "5m"} ${context.selectedFormalStructureEventType ?? context.formalStructureEventType ?? "structure"} event`;
  }
  if (context.stableMarketStructureMaterialChange) {
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

function formatBarrierDistance(side: "support" | "resistance", distancePct: number): string {
  const sign = side === "support" ? "-" : "+";
  return `${sign}${(distancePct * 100).toFixed(1)}%`;
}

function formatBarrierPlanningMap(
  barrier: TraderNextBarrierContext | null | undefined,
  labelOverride?: string,
): string | null {
  const levels = barrier?.planningLevels;
  if (!barrier || !levels || levels.length < 2) {
    return null;
  }

  const label = labelOverride ?? (barrier.side === "support" ? "Support map" : "Resistance map");
  const text = levels
    .slice(0, 6)
    .map((level) => {
      const price = formatAlertLevel(level.price);
      if (!price) {
        return null;
      }
      return `${price} (${formatBarrierDistance(barrier.side, level.distancePct)})`;
    })
    .filter((value): value is string => Boolean(value))
    .join(" -> ");

  return text ? `${label}: ${text}` : null;
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

function buildStructureSectionLine(marketStructure: string | null): string | null {
  if (!marketStructure) {
    return null;
  }

  return simplifyTraderRead(lowercaseFirst(stripLinePrefix(marketStructure)));
}

function formatStructureToken(value: string | undefined | null): string {
  return value ? value.replaceAll("_", " ") : "n/a";
}

function buildFormalStructureSectionLine(alert: IntelligentAlert): string | null {
  const context = alert.event.eventContext;
  const eventType = context.formalStructureEventType;
  if (!eventType) {
    return null;
  }

  const timeframe = context.formalStructureTimeframe ?? "5m";
  const confidence = context.formalStructureConfidence ?? "n/a";
  const confirmation = context.formalStructureConfirmation && context.formalStructureConfirmation !== "none"
    ? `, ${formatStructureToken(context.formalStructureConfirmation)}`
    : "";
  const biasText = context.formalStructurePreviousBias && context.formalStructureBias
    ? context.formalStructurePreviousBias === context.formalStructureBias
      ? `bias ${formatStructureToken(context.formalStructureBias)}`
      : `bias ${formatStructureToken(context.formalStructurePreviousBias)} -> ${formatStructureToken(context.formalStructureBias)}`
    : context.formalStructureBias
      ? `bias ${formatStructureToken(context.formalStructureBias)}`
      : null;

  const levelParts = [
    context.formalStructureBrokenSwingPrice !== undefined && context.formalStructureBrokenSwingPrice !== null
      ? `broken ${formatDebugPrice(context.formalStructureBrokenSwingPrice)}`
      : null,
    context.formalStructureSweptSwingPrice !== undefined && context.formalStructureSweptSwingPrice !== null
      ? `swept ${formatDebugPrice(context.formalStructureSweptSwingPrice)}`
      : null,
    context.formalStructureProtectedHigh !== undefined && context.formalStructureProtectedHigh !== null
      ? `protected high ${formatDebugPrice(context.formalStructureProtectedHigh)}`
      : null,
    context.formalStructureProtectedLow !== undefined && context.formalStructureProtectedLow !== null
      ? `protected low ${formatDebugPrice(context.formalStructureProtectedLow)}`
      : null,
  ].filter((value): value is string => Boolean(value));

  const eventText =
    eventType === "none"
      ? `no confirmed BOS/CHOCH`
      : formatStructureToken(eventType);
  const parts = [
    `formal ${timeframe}: ${eventText} (${confidence}${confirmation})`,
    biasText,
    levelParts.length > 0 ? levelParts.join(", ") : null,
  ].filter((value): value is string => Boolean(value));

  return parts.join("; ");
}

function buildStableStructureSectionLine(alert: IntelligentAlert): string | null {
  const context = alert.event.eventContext;
  const state = context.stableMarketStructureState;
  if (!state) {
    return null;
  }

  const pivotParts = [
    context.stableMarketStructureLatestSwingLow !== undefined
      ? `latest low ${formatDebugPrice(context.stableMarketStructureLatestSwingLow)}`
      : null,
    context.stableMarketStructureLatestSwingHigh !== undefined
      ? `latest high ${formatDebugPrice(context.stableMarketStructureLatestSwingHigh)}`
      : null,
  ].filter((value): value is string => Boolean(value));

  const parts = [
    `stable 5m: ${formatStructureToken(state)} (${context.stableMarketStructureConfidence ?? "n/a"})`,
    context.stableMarketStructurePreviousState
      ? `previous ${formatStructureToken(context.stableMarketStructurePreviousState)}`
      : null,
    `material ${context.stableMarketStructureMaterialChange === true ? "yes" : "no"}`,
    pivotParts.length > 0 ? pivotParts.join(", ") : null,
  ].filter((value): value is string => Boolean(value));

  return parts.join("; ");
}

function formatFormalEventName(eventType: string | undefined | null): string {
  switch (eventType) {
    case "bos_bullish":
      return "bullish BOS";
    case "bos_bearish":
      return "bearish BOS";
    case "choch_bullish":
      return "bullish CHOCH";
    case "choch_bearish":
      return "bearish CHOCH";
    case "liquidity_sweep_high":
      return "liquidity sweep high";
    case "liquidity_sweep_low":
      return "liquidity sweep low";
    case "failed_break_high":
      return "failed break high";
    case "failed_break_low":
      return "failed break low";
    case "none":
      return "no confirmed BOS/CHOCH";
    default:
      return eventType ? formatStructureToken(eventType) : "no confirmed BOS/CHOCH";
  }
}

export function buildMarketStructureDiscordLines(
  marketStructure: LevelSnapshotPayload["marketStructure"],
): string[] {
  const formal = marketStructure?.formal;
  const stable = marketStructure?.stable;
  const timeframes = marketStructure?.timeframes;
  const hasTimeframeMap = Boolean(timeframes && Object.values(timeframes).some((value) => value?.formal || value?.stable));

  if (hasTimeframeMap) {
    const orderedTimeframes = ["4h", "5m"] as const;
    return orderedTimeframes
      .map((timeframe) => {
        const context = timeframes?.[timeframe] ?? (timeframe === "5m" ? { formal, stable } : undefined);
        return buildTimeframeMarketStructureDiscordLine(timeframe, context);
      })
      .filter((value): value is string => Boolean(value));
  }

  const lines: string[] = [];

  if (formal) {
    lines.push(`Formal ${formal.timeframe}: ${formatFormalStructureSummary(formal)}`);
  }

  if (stable) {
    lines.push(`Stable 5m: ${formatStableStructureSummary(stable)}`);
  }

  return lines;
}

export function buildVisibleMarketStructureDiscordLines(
  marketStructure: LevelSnapshotPayload["marketStructure"],
  options: { includeWaitingPlaceholders?: boolean; storyKeys?: string[] } = {},
): string[] {
  const lines = buildMarketStructureDiscordLines(marketStructure);
  const storyKeys = options.storyKeys?.filter((key) => key.trim().length > 0) ?? [];
  const scopedLines = storyKeys.length > 0
    ? lines.filter((line) => {
        const timeframe = line.startsWith("HTF 4h:")
          ? "4h"
          : line.startsWith("Tactical 5m:") || line.startsWith("Formal 5m:") || line.startsWith("Stable 5m:")
            ? "5m"
            : null;
        return timeframe ? storyKeys.some((key) => key.startsWith(`${timeframe}|`)) : true;
      })
    : lines;

  const includeWaitingPlaceholders =
    options.includeWaitingPlaceholders === true && storyKeys.length === 0;
  if (!includeWaitingPlaceholders) {
    return scopedLines;
  }

  const visibleLines = [...scopedLines];
  const hasHigherTimeframe = visibleLines.some((line) => line.startsWith("HTF 4h:"));
  const hasTacticalTimeframe = visibleLines.some((line) =>
    line.startsWith("Tactical 5m:") ||
    line.startsWith("Formal 5m:") ||
    line.startsWith("Stable 5m:"),
  );

  if (!hasHigherTimeframe) {
    visibleLines.unshift(
      "HTF 4h: waiting for seeded/historical candles before higher-timeframe BOS/CHOCH can be confirmed.",
    );
  }

  if (!hasTacticalTimeframe) {
    visibleLines.push(
      "Tactical 5m: waiting for seeded/historical candles before intraday BOS/CHOCH can be confirmed.",
    );
  }

  return visibleLines;
}

function formatFormalStructureSummary(formal: FormalMarketStructureSnapshot): string {
  if (!formal) {
    return "waiting for confirmed BOS/CHOCH";
  }

  const confirmation = formal.confirmation && formal.confirmation !== "none"
    ? `, ${formatStructureToken(formal.confirmation)}`
    : "";
  const bias = formal.previousBias && formal.previousBias !== formal.bias
    ? `bias ${formatStructureToken(formal.previousBias)} -> ${formatStructureToken(formal.bias)}`
    : `bias ${formatStructureToken(formal.bias)}`;
  const eventFreshness =
    formal.eventType && formal.eventType !== "none"
      ? formal.eventFreshness === "fresh"
        ? "fresh "
        : "prior "
      : "";
  const showProtectedHigh =
    formal.eventType === "bos_bearish" ||
    formal.eventType === "choch_bullish" ||
    formal.eventType === "failed_break_high" ||
    formal.eventType === "liquidity_sweep_high" ||
    formal.eventType === "none";
  const showProtectedLow =
    formal.eventType === "bos_bullish" ||
    formal.eventType === "choch_bearish" ||
    formal.eventType === "failed_break_low" ||
    formal.eventType === "liquidity_sweep_low" ||
    formal.eventType === "none";
  const levels = [
    formal.brokenSwingPrice !== undefined && formal.brokenSwingPrice !== null
      ? `broken ${formatDebugPrice(formal.brokenSwingPrice)}`
      : null,
    formal.sweptSwingPrice !== undefined && formal.sweptSwingPrice !== null
      ? `swept ${formatDebugPrice(formal.sweptSwingPrice)}`
      : null,
    showProtectedHigh && formal.protectedHigh !== undefined && formal.protectedHigh !== null
      ? `protected high ${formatDebugPrice(formal.protectedHigh)}`
      : null,
    showProtectedLow && formal.protectedLow !== undefined && formal.protectedLow !== null
      ? `protected low ${formatDebugPrice(formal.protectedLow)}`
      : null,
  ].filter((value): value is string => Boolean(value));

  return [
    `${eventFreshness}${formatFormalEventName(formal.eventType)} (${formal.confidence}${confirmation})`,
    bias,
    levels.length > 0 ? levels.join(", ") : null,
  ].filter((value): value is string => Boolean(value)).join("; ");
}

function formatCondensedFormalStructureSummary(formal: FormalMarketStructureSnapshot): string {
  if (!formal) {
    return "waiting for confirmed BOS/CHOCH";
  }

  const isBullishBreak =
    formal.eventType === "bos_bullish" ||
    formal.eventType === "choch_bullish";
  const isBearishBreak =
    formal.eventType === "bos_bearish" ||
    formal.eventType === "choch_bearish";
  const eventFreshness =
    formal.eventType && formal.eventType !== "none"
      ? formal.eventFreshness === "fresh"
        ? "fresh "
        : "prior "
      : "";
  const breakLevel = formatDebugPrice(formal.brokenSwingPrice);
  const sweptLevel = formatDebugPrice(formal.sweptSwingPrice);
  const eventLevel =
    breakLevel && isBullishBreak
      ? ` above ${breakLevel}`
      : breakLevel && isBearishBreak
        ? ` below ${breakLevel}`
        : sweptLevel
          ? ` at ${sweptLevel}`
          : "";
  const showProtectedHigh =
    formal.eventType === "bos_bearish" ||
    formal.eventType === "choch_bullish" ||
    formal.eventType === "failed_break_high" ||
    formal.eventType === "liquidity_sweep_high" ||
    formal.eventType === "none";
  const showProtectedLow =
    formal.eventType === "bos_bullish" ||
    formal.eventType === "choch_bearish" ||
    formal.eventType === "failed_break_low" ||
    formal.eventType === "liquidity_sweep_low" ||
    formal.eventType === "none";
  const protectedLevels = [
    showProtectedHigh && formal.protectedHigh !== undefined && formal.protectedHigh !== null
      ? `protected high ${formatDebugPrice(formal.protectedHigh)}`
      : null,
    showProtectedLow && formal.protectedLow !== undefined && formal.protectedLow !== null
      ? `protected low ${formatDebugPrice(formal.protectedLow)}`
      : null,
  ].filter((value): value is string => Boolean(value));
  const bias = formal.previousBias && formal.previousBias !== formal.bias
    ? `bias ${formatStructureToken(formal.previousBias)} -> ${formatStructureToken(formal.bias)}`
    : `bias ${formatStructureToken(formal.bias)}`;

  return [
    `${eventFreshness}${formatFormalEventName(formal.eventType)}${eventLevel}`,
    protectedLevels.length > 0 ? protectedLevels.join(", ") : null,
    bias,
  ].filter((value): value is string => Boolean(value)).join("; ");
}

function formatStableStructureSummary(
  stable: NonNullable<LevelSnapshotPayload["marketStructure"]>["stable"],
): string {
  if (!stable) {
    return "waiting for confirmed pivot structure";
  }

  const pivots = [
    stable.latestSwingLow !== undefined ? `latest low ${formatDebugPrice(stable.latestSwingLow)}` : null,
    stable.latestSwingHigh !== undefined ? `latest high ${formatDebugPrice(stable.latestSwingHigh)}` : null,
  ].filter((value): value is string => Boolean(value));
  const range =
    stable.activeRangeLow !== undefined || stable.activeRangeHigh !== undefined
      ? `range ${formatDebugPrice(stable.activeRangeLow) ?? "n/a"}-${formatDebugPrice(stable.activeRangeHigh) ?? "n/a"}`
      : null;

  return [
    `${formatStructureToken(stable.state)} (${stable.confidence})`,
    stable.trendDirection ? `trend ${formatStructureToken(stable.trendDirection)}` : null,
    range,
    pivots.length > 0 ? pivots.join(", ") : null,
  ].filter((value): value is string => Boolean(value)).join("; ");
}

function buildTimeframeMarketStructureDiscordLine(
  timeframe: "4h" | "5m",
  context: RuntimeMarketStructureTimeframeSnapshot | undefined,
): string | null {
  if (!context?.formal && !context?.stable) {
    return null;
  }

  const label = timeframe === "4h" ? "HTF 4h" : "Tactical 5m";
  if (
    timeframe === "4h" &&
    context.formal &&
    context.formal.eventFreshness !== "fresh" &&
    !shouldShowMarketStructureDebug()
  ) {
    return `${label}: ${formatCondensedFormalStructureSummary(context.formal)}`;
  }

  const parts = [
    context.formal ? formatFormalStructureSummary(context.formal) : null,
    context.stable ? `stable ${formatStableStructureSummary(context.stable)}` : null,
  ].filter((value): value is string => Boolean(value));

  return `${label}: ${parts.join("; ")}`;
}

function buildStructureSectionLines(
  marketStructure: string | null,
  alert: IntelligentAlert,
  options: { storyKeys?: string[] } = {},
): string[] {
  const hasRuntimeMarketStructureField = Object.prototype.hasOwnProperty.call(
    alert.event.eventContext,
    "runtimeMarketStructure",
  );
  const runtimeMarketStructureLines = buildVisibleMarketStructureDiscordLines(
    alert.event.eventContext.runtimeMarketStructure,
    {
      includeWaitingPlaceholders: hasRuntimeMarketStructureField,
      storyKeys: options.storyKeys,
    },
  );
  if (runtimeMarketStructureLines.length > 0) {
    return [
      buildStructureSectionLine(marketStructure),
      ...runtimeMarketStructureLines,
    ].filter((value): value is string => Boolean(value));
  }

  const lines = [
    buildStructureSectionLine(marketStructure),
    buildFormalStructureSectionLine(alert),
    buildStableStructureSectionLine(alert),
  ].filter((value): value is string => Boolean(value));

  return [...new Set(lines)];
}

function isMeaningfulFormalStructureEvent(eventType: string | undefined | null): boolean {
  return Boolean(eventType && eventType !== "none");
}

function runtimeMarketStructureHasMaterialStory(
  marketStructure: LevelSnapshotPayload["marketStructure"],
): boolean {
  if (!marketStructure) {
    return false;
  }

  const timeframes = [
    marketStructure.timeframes?.["4h"],
    marketStructure.timeframes?.["5m"],
    {
      formal: marketStructure.formal,
      stable: marketStructure.stable,
    },
  ];

  return timeframes.some((timeframe) => {
    const formal = timeframe?.formal;
    const stable = timeframe?.stable;
    const actionableFormal = formal
      ? isActionableFormalBosChoch(formal.timeframe, formal, timeframe)
      : false;
    return (
      actionableFormal ||
      stable?.materialChange === true
    );
  });
}

function alertHasActionableFormalStructure(alert: IntelligentAlert): boolean {
  const context = alert.event.eventContext;
  const runtime = context.runtimeMarketStructure;
  const selectedTimeframe = context.selectedFormalStructureTimeframe ?? context.formalStructureTimeframe;
  const selectedKey = context.selectedFormalStructureKey ?? context.formalStructureKey;
  if (selectedTimeframe && selectedKey) {
    const timeframeContext = runtime?.timeframes?.[selectedTimeframe];
    const selectedFormal = timeframeContext?.formal;
    if (
      selectedFormal?.structureKey === selectedKey &&
      isActionableFormalBosChoch(selectedTimeframe, selectedFormal, timeframeContext)
    ) {
      return true;
    }
  }

  return Boolean(
    runtime &&
    Object.entries(runtime.timeframes ?? {}).some(([timeframe, timeframeContext]) =>
      isActionableFormalBosChoch(
        timeframe as FormalStructureTimeframe,
        timeframeContext.formal,
        timeframeContext,
      ),
    ),
  );
}

function shouldShowMarketStructureStory(
  alert: IntelligentAlert,
  visibility: MarketStructureStoryVisibility,
): boolean {
  if (visibility === "always") {
    return true;
  }
  if (visibility === "metadata_only") {
    return false;
  }

  const context = alert.event.eventContext;
  const formalStructureEventType = context.selectedFormalStructureEventType ?? context.formalStructureEventType;
  const formalStructureMaterialChange =
    context.selectedFormalStructureMaterialChange ?? context.formalStructureMaterialChange;

  return (
    context.tradeStructure?.isMaterialStateChange === true ||
    context.stableMarketStructureMaterialChange === true ||
    (
      formalStructureMaterialChange === true &&
      isMeaningfulFormalStructureEvent(formalStructureEventType) &&
      alertHasActionableFormalStructure(alert)
    ) ||
    runtimeMarketStructureHasMaterialStory(context.runtimeMarketStructure)
  );
}

function shouldShowMarketStructureDebug(): boolean {
  const raw = process.env.MARKET_STRUCTURE_DISCORD_DEBUG?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function formatDebugPrice(value: number | undefined | null): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return formatAlertLevel(value);
}

function formatDebugPct(value: number | undefined | null): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return `${(value * 100).toFixed(1)}%`;
}

function buildMarketStructureDebugLines(alert: IntelligentAlert): string[] {
  if (!shouldShowMarketStructureDebug()) {
    return [];
  }

  const context = alert.event.eventContext;
  if (!context.stableMarketStructureState && !context.formalStructureEventType) {
    return [];
  }

  const lines: string[] = [];

  if (context.formalStructureEventType) {
    lines.push(
      `formal=${context.formalStructureTimeframe ?? "5m"} ${context.formalStructureEventType}; bias=${context.formalStructurePreviousBias ?? "none"}->${context.formalStructureBias ?? "n/a"}; material=${context.formalStructureMaterialChange === true ? "yes" : "no"}`,
      `formal_confidence=${context.formalStructureConfidence ?? "n/a"}; score=${context.formalStructureConfidenceScore?.toFixed(3) ?? "n/a"}; confirmation=${context.formalStructureConfirmation ?? "n/a"}`,
    );

    const broken = formatDebugPrice(context.formalStructureBrokenSwingPrice);
    const swept = formatDebugPrice(context.formalStructureSweptSwingPrice);
    const protectedHigh = formatDebugPrice(context.formalStructureProtectedHigh);
    const protectedLow = formatDebugPrice(context.formalStructureProtectedLow);
    const latestHigh = formatDebugPrice(context.formalStructureLatestHigh);
    const latestLow = formatDebugPrice(context.formalStructureLatestLow);
    if (broken || swept || protectedHigh || protectedLow || latestHigh || latestLow) {
      lines.push(
        `formal_levels=broken ${broken ?? "n/a"}, swept ${swept ?? "n/a"}; protected high ${protectedHigh ?? "n/a"}, low ${protectedLow ?? "n/a"}; latest high ${latestHigh ?? "n/a"}, low ${latestLow ?? "n/a"}`,
      );
    }

    if (context.formalStructureSwingSequence?.length) {
      lines.push(`formal_swings=${context.formalStructureSwingSequence.join(" -> ")}`);
    }
    if (context.formalStructureDebugReasons?.length) {
      lines.push(`formal_reasons=${context.formalStructureDebugReasons.join(",")}`);
    }
    lines.push(`formal_key=${context.formalStructureKey ?? "n/a"}`);
  }

  if (
    context.selectedFormalStructureEventType &&
    context.selectedFormalStructureKey !== context.formalStructureKey
  ) {
    lines.push(
      `selected_formal=${context.selectedFormalStructureTimeframe ?? "n/a"} ${context.selectedFormalStructureEventType}; freshness=${context.selectedFormalStructureEventFreshness ?? "n/a"}; material=${context.selectedFormalStructureMaterialChange === true ? "yes" : "no"}`,
      `selected_formal_key=${context.selectedFormalStructureKey ?? "n/a"}`,
    );
  }

  if (context.stableMarketStructureState) {
    lines.push(
      `state=${context.stableMarketStructureState}; raw=${context.stableMarketStructureRawState ?? "n/a"}; previous=${context.stableMarketStructurePreviousState ?? "none"}; material=${context.stableMarketStructureMaterialChange === true ? "yes" : "no"}`,
      `confidence=${context.stableMarketStructureConfidence ?? "n/a"}; score=${context.stableMarketStructureMaterialityScore?.toFixed(3) ?? "n/a"}; reason=${context.stableMarketStructureReason ?? "n/a"}; candles=${context.stableMarketStructureCandleCount ?? "n/a"}; run=${context.stableMarketStructureRawRunLength ?? "n/a"}`,
      `trend=${context.stableMarketStructureTrendDirection ?? "n/a"}; HL=${context.stableMarketStructureHigherLowCount ?? 0}; HH=${context.stableMarketStructureHigherHighCount ?? 0}; LH=${context.stableMarketStructureLowerHighCount ?? 0}; LL=${context.stableMarketStructureLowerLowCount ?? 0}`,
    );

    const latestLow = formatDebugPrice(context.stableMarketStructureLatestSwingLow);
    const latestHigh = formatDebugPrice(context.stableMarketStructureLatestSwingHigh);
    const priorLow = formatDebugPrice(context.stableMarketStructurePriorSwingLow);
    const priorHigh = formatDebugPrice(context.stableMarketStructurePriorSwingHigh);
    if (latestLow || latestHigh || priorLow || priorHigh) {
      lines.push(
        `pivots=latest low ${latestLow ?? "n/a"}, high ${latestHigh ?? "n/a"}; prior low ${priorLow ?? "n/a"}, high ${priorHigh ?? "n/a"}`,
      );
    }

    const rangeLow = formatDebugPrice(context.stableMarketStructureActiveRangeLow);
    const rangeHigh = formatDebugPrice(context.stableMarketStructureActiveRangeHigh);
    if (rangeLow || rangeHigh) {
      lines.push(
        `range=${rangeLow ?? "n/a"}-${rangeHigh ?? "n/a"}; width=${formatDebugPct(context.stableMarketStructureActiveRangeWidthPct) ?? "n/a"}; quality=${context.stableMarketStructureActiveRangeQuality ?? "n/a"}`,
      );
    }

    if (context.stableMarketStructurePivotEventType) {
      lines.push(
        `pivot_event=${context.stableMarketStructurePivotEventType}; trigger=${formatDebugPrice(context.stableMarketStructurePivotEventTriggerPrice) ?? "n/a"}`,
      );
    }

    lines.push(`key=${context.stableMarketStructureKey ?? "n/a"}`);
  }

  return lines;
}

function buildReadableIntelligentAlertBody(
  alert: IntelligentAlert,
  options: MarketStructureStoryFormatOptions = {},
): string {
  const lines = alert.body.split("\n").map((line) => line.trim()).filter(Boolean);
  const lead = lines[0] ?? alert.title;
  const whyNow = pickBodyLine(lines, "why now:");
  const movement = pickLine(lines, "movement:", alert.movement);
  const pressure = pickLine(lines, "pressure:", alert.pressure);
  const visibleMarketStructureStory =
    shouldShowMarketStructureDebug() ||
    shouldShowMarketStructureStory(alert, options.marketStructureStoryVisibility ?? "auto");
  const marketStructure = visibleMarketStructureStory
    ? pickLine(lines, "market structure:", alert.marketStructure)
    : null;
  const volumeActivity = pickBodyLine(lines, "activity:") ?? alert.volumeActivity?.traderLine ?? null;
  const room = pickBodyLine(lines, "room:");
  const watch = pickBodyLine(lines, "watch:");
  const failureRisk = pickLine(lines, "failure risk:", alert.failureRisk);
  const targetLevel = formatAlertLevel(alert.target?.price);
  const barrierLevel = formatAlertLevel(alert.nextBarrier?.price);
  const barrierText = formatBarrierWithStrength(alert.nextBarrier);
  const barrierKeyLevelLabel = formatBarrierKeyLevelLabel(alert.nextBarrier);
  const barrierPlanningMap = formatBarrierPlanningMap(alert.nextBarrier);
  const continuationPlanningMap = formatBarrierPlanningMap(alert.continuationBarrier);
  const eventType = alert.event.eventType;
  const watchParts = splitWatchLine(watch);
  const supportReactionLine = buildSupportReactionLine(alert, barrierText);
  const holdFailureMapLine = buildHoldFailureMapLine(alert, barrierText);
  const structureSectionLines = visibleMarketStructureStory
    ? buildStructureSectionLines(marketStructure, alert, {
        storyKeys: options.marketStructureStoryKeys,
      })
    : [];
  const structureDebugLines = buildMarketStructureDebugLines(alert);
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

  if (readLines.length < 3 && failureRisk && shouldIncludeFragileSetupLine(alert)) {
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
    if (continuationPlanningMap && alert.event.zoneKind === "resistance") {
      nearbyLevels.push(continuationPlanningMap);
    }
    if (barrierPlanningMap) {
      nearbyLevels.push(barrierPlanningMap);
    }
  } else {
    pushNearbyLevel("First", alert.target?.side ?? "", targetLevel);
    pushNearbyLevel(
      barrierKeyLevelLabel,
      alert.nextBarrier?.roleFlipFromSide ? "" : alert.nextBarrier?.side ?? "",
      barrierLevel,
    );
    if (barrierPlanningMap) {
      nearbyLevels.push(barrierPlanningMap);
    }
  }

  const output = [lead];
  output.push("", buildCurrentReadLine(alert));
  if (readLines.length > 0) {
    output.push("", "What it means:", ...readLines.slice(0, 3).map((line) => `- ${line}`));
  }
  const visibleStructureLines = structureSectionLines.filter(
    (line) => !readLines.slice(0, 3).includes(line),
  );
  if (visibleStructureLines.length > 0) {
    output.push("", "Structure:", ...visibleStructureLines.map((line) => `- ${line}`));
  }
  if (structureDebugLines.length > 0) {
    output.push("", "Structure details:", ...structureDebugLines.map((line) => `- ${line}`));
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

function shouldIncludeFragileSetupLine(alert: IntelligentAlert): boolean {
  if (alert.failureRisk?.label !== "high") {
    return false;
  }

  const acceptanceLabel = alert.event.eventContext.acceptance?.label;
  const rangeBoxLabel = alert.event.eventContext.rangeBox?.label;
  const behaviorBudgetLabel = alert.event.eventContext.behaviorBudget?.label;
  const price = alert.event.triggerPrice;
  const riskPct = alert.tradeMap?.riskPct ?? null;
  const weakSmallCapProbe =
    price < 2 &&
    (acceptanceLabel === "weak_probe" || acceptanceLabel === "testing") &&
    (
      rangeBoxLabel === "active" ||
      behaviorBudgetLabel === "boring_range" ||
      (typeof riskPct === "number" && riskPct < 0.035)
    );

  return !weakSmallCapProbe;
}

export function formatIntelligentAlertAsPayload(
  alert: IntelligentAlert,
  options: MarketStructureStoryFormatOptions = {},
): AlertPayload {
  const signalCategory = resolvePrimarySignalCategoryForAlert(alert);
  const levelImportance = alert.zone
    ? assessFinalLevelImportance({
        zone: alert.zone,
        price: alert.event.triggerPrice,
      })
    : null;
  const marketStructureStoryVisible =
    shouldShowMarketStructureDebug() ||
    shouldShowMarketStructureStory(alert, options.marketStructureStoryVisibility ?? "auto");
  return {
    title: alert.title,
    body: buildReadableIntelligentAlertBody(alert, options),
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
      continuationBarrierSide: alert.continuationBarrier?.side,
      continuationBarrierDistancePct: alert.continuationBarrier?.distancePct,
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
      marketStructureStoryVisible,
      marketStructureStoryKeys: options.marketStructureStoryKeys,
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
      stableMarketStructureRawState: alert.event.eventContext.stableMarketStructureRawState,
      stableMarketStructureReason: alert.event.eventContext.stableMarketStructureReason,
      stableMarketStructureCandleCount: alert.event.eventContext.stableMarketStructureCandleCount,
      stableMarketStructureRawRunLength: alert.event.eventContext.stableMarketStructureRawRunLength,
      stableMarketStructureTrendDirection: alert.event.eventContext.stableMarketStructureTrendDirection,
      stableMarketStructureHigherLowCount: alert.event.eventContext.stableMarketStructureHigherLowCount,
      stableMarketStructureLowerHighCount: alert.event.eventContext.stableMarketStructureLowerHighCount,
      stableMarketStructureHigherHighCount: alert.event.eventContext.stableMarketStructureHigherHighCount,
      stableMarketStructureLowerLowCount: alert.event.eventContext.stableMarketStructureLowerLowCount,
      stableMarketStructureLatestSwingLow: alert.event.eventContext.stableMarketStructureLatestSwingLow,
      stableMarketStructureLatestSwingHigh: alert.event.eventContext.stableMarketStructureLatestSwingHigh,
      stableMarketStructurePriorSwingLow: alert.event.eventContext.stableMarketStructurePriorSwingLow,
      stableMarketStructurePriorSwingHigh: alert.event.eventContext.stableMarketStructurePriorSwingHigh,
      stableMarketStructureActiveRangeLow: alert.event.eventContext.stableMarketStructureActiveRangeLow,
      stableMarketStructureActiveRangeHigh: alert.event.eventContext.stableMarketStructureActiveRangeHigh,
      stableMarketStructureActiveRangeWidthPct: alert.event.eventContext.stableMarketStructureActiveRangeWidthPct,
      stableMarketStructureActiveRangeQuality: alert.event.eventContext.stableMarketStructureActiveRangeQuality,
      stableMarketStructurePivotEventType: alert.event.eventContext.stableMarketStructurePivotEventType,
      stableMarketStructurePivotEventTriggerPrice: alert.event.eventContext.stableMarketStructurePivotEventTriggerPrice,
      formalStructureTimeframe: alert.event.eventContext.formalStructureTimeframe,
      formalStructureBias: alert.event.eventContext.formalStructureBias,
      formalStructurePreviousBias: alert.event.eventContext.formalStructurePreviousBias,
      formalStructureEventType: alert.event.eventContext.formalStructureEventType,
      formalStructureEventFreshness: alert.event.eventContext.formalStructureEventFreshness,
      formalStructureTriggerTimestamp: alert.event.eventContext.formalStructureTriggerTimestamp,
      formalStructureConfirmation: alert.event.eventContext.formalStructureConfirmation,
      formalStructureConfidence: alert.event.eventContext.formalStructureConfidence,
      formalStructureConfidenceScore: alert.event.eventContext.formalStructureConfidenceScore,
      formalStructureMaterialChange: alert.event.eventContext.formalStructureMaterialChange,
      formalStructureBrokenSwingPrice: alert.event.eventContext.formalStructureBrokenSwingPrice,
      formalStructureSweptSwingPrice: alert.event.eventContext.formalStructureSweptSwingPrice,
      formalStructureProtectedHigh: alert.event.eventContext.formalStructureProtectedHigh,
      formalStructureProtectedLow: alert.event.eventContext.formalStructureProtectedLow,
      formalStructureLatestHigh: alert.event.eventContext.formalStructureLatestHigh,
      formalStructureLatestLow: alert.event.eventContext.formalStructureLatestLow,
      formalStructureSwingSequence: alert.event.eventContext.formalStructureSwingSequence,
      formalStructureKey: alert.event.eventContext.formalStructureKey,
      formalStructureTraderLine: alert.event.eventContext.formalStructureTraderLine,
      formalStructureDebugReasons: alert.event.eventContext.formalStructureDebugReasons,
      selectedFormalStructureTimeframe: alert.event.eventContext.selectedFormalStructureTimeframe,
      selectedFormalStructureBias: alert.event.eventContext.selectedFormalStructureBias,
      selectedFormalStructurePreviousBias: alert.event.eventContext.selectedFormalStructurePreviousBias,
      selectedFormalStructureEventType: alert.event.eventContext.selectedFormalStructureEventType,
      selectedFormalStructureEventFreshness: alert.event.eventContext.selectedFormalStructureEventFreshness,
      selectedFormalStructureTriggerTimestamp: alert.event.eventContext.selectedFormalStructureTriggerTimestamp,
      selectedFormalStructureConfirmation: alert.event.eventContext.selectedFormalStructureConfirmation,
      selectedFormalStructureConfidence: alert.event.eventContext.selectedFormalStructureConfidence,
      selectedFormalStructureConfidenceScore: alert.event.eventContext.selectedFormalStructureConfidenceScore,
      selectedFormalStructureMaterialChange: alert.event.eventContext.selectedFormalStructureMaterialChange,
      selectedFormalStructureBrokenSwingPrice: alert.event.eventContext.selectedFormalStructureBrokenSwingPrice,
      selectedFormalStructureSweptSwingPrice: alert.event.eventContext.selectedFormalStructureSweptSwingPrice,
      selectedFormalStructureProtectedHigh: alert.event.eventContext.selectedFormalStructureProtectedHigh,
      selectedFormalStructureProtectedLow: alert.event.eventContext.selectedFormalStructureProtectedLow,
      selectedFormalStructureLatestHigh: alert.event.eventContext.selectedFormalStructureLatestHigh,
      selectedFormalStructureLatestLow: alert.event.eventContext.selectedFormalStructureLatestLow,
      selectedFormalStructureSwingSequence: alert.event.eventContext.selectedFormalStructureSwingSequence,
      selectedFormalStructureKey: alert.event.eventContext.selectedFormalStructureKey,
      selectedFormalStructureTraderLine: alert.event.eventContext.selectedFormalStructureTraderLine,
      selectedFormalStructureDebugReasons: alert.event.eventContext.selectedFormalStructureDebugReasons,
      runtimeMarketStructure: alert.event.eventContext.runtimeMarketStructure,
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
  marketStructure?: LevelSnapshotPayload["marketStructure"];
  includeMarketStructureStory?: boolean;
  marketStructureStoryKeys?: string[];
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
  const hasMarketStructureField = Object.prototype.hasOwnProperty.call(params, "marketStructure");
  const includeMarketStructureStory =
    params.includeMarketStructureStory ?? runtimeMarketStructureHasMaterialStory(params.marketStructure);
  const marketStructureLines = includeMarketStructureStory
    ? buildVisibleMarketStructureDiscordLines(params.marketStructure, {
        includeWaitingPlaceholders: hasMarketStructureField,
        storyKeys: params.marketStructureStoryKeys,
      })
    : [];
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
      ...(marketStructureLines.length > 0
        ? [
            "",
            "Market structure:",
            ...marketStructureLines.map((line) => `- ${line}`),
          ]
        : []),
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
      marketStructureStoryVisible: includeMarketStructureStory && marketStructureLines.length > 0,
      marketStructureStoryKeys: params.marketStructureStoryKeys,
      runtimeMarketStructure: params.marketStructure,
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
  marketStructure?: LevelSnapshotPayload["marketStructure"];
  includeMarketStructureStory?: boolean;
  marketStructureStoryKeys?: string[];
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
  const hasMarketStructureField = Object.prototype.hasOwnProperty.call(params, "marketStructure");
  const includeMarketStructureStory =
    params.includeMarketStructureStory ?? runtimeMarketStructureHasMaterialStory(params.marketStructure);
  const marketStructureLines = includeMarketStructureStory
    ? buildVisibleMarketStructureDiscordLines(params.marketStructure, {
        includeWaitingPlaceholders: hasMarketStructureField,
        storyKeys: params.marketStructureStoryKeys,
      })
    : [];

  return {
    title: `${symbol} ${eventLabel} progress check`,
    body: [
      followThroughProgressLine(progressLabel),
      "",
      "What it means:",
      `- ${line}`,
      `- price change from trigger: ${directionalText}`,
      ...(marketStructureLines.length > 0
        ? [
            "",
            "Market structure:",
            ...marketStructureLines.map((item) => `- ${item}`),
          ]
        : []),
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
      marketStructureStoryVisible: includeMarketStructureStory && marketStructureLines.length > 0,
      marketStructureStoryKeys: params.marketStructureStoryKeys,
      runtimeMarketStructure: params.marketStructure,
      whyPosted: `${progressLabel} follow-through progress`,
      postBudgetSymbolType: classifyPostBudgetSymbolType(entryPrice),
    },
  };
}

export function formatMarketStructureUpdateAsPayload(params: {
  symbol: string;
  timestamp: number;
  marketStructure: LevelSnapshotPayload["marketStructure"];
  storyReason?: string;
  storyKeys?: string[];
  storySource?: string;
}): AlertPayload {
  const signalCategory = routeMessageKindToSignalCategory({
    messageKind: "market_structure_update",
  }).primaryCategory;
  const marketStructureLines = buildVisibleMarketStructureDiscordLines(params.marketStructure, {
    storyKeys: params.storyKeys,
  });

  return {
    title: `${params.symbol} market structure update`,
    body: [
      "Fresh BOS/CHOCH structure detected.",
      ...(marketStructureLines.length > 0
        ? [
            "",
            "Market structure:",
            ...marketStructureLines.map((line) => `- ${line}`),
          ]
        : []),
      "",
      "How to use it:",
      "- Treat this as chart context for the next level reaction, not an entry by itself.",
    ].join("\n"),
    symbol: params.symbol,
    timestamp: params.timestamp,
    metadata: {
      messageKind: "market_structure_update",
      signalCategory,
      signalCategoryLiveEnabled: isSignalCategoryLiveEnabled(signalCategory),
      marketStructureStoryVisible: marketStructureLines.length > 0,
      marketStructureStoryReason: params.storyReason,
      marketStructureStoryKeys: params.storyKeys,
      marketStructureStorySource: params.storySource ?? "standalone_structure_update",
      runtimeMarketStructure: params.marketStructure,
      whyPosted: "fresh formal BOS/CHOCH structure event",
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
  sendLevelLadder?(threadId: string, payload: LevelSnapshotPayload): Promise<void>;
  sendLevelExtension(threadId: string, payload: LevelExtensionPayload): Promise<void>;
}

function shouldPostFullLevelLadderToDiscord(): boolean {
  const raw = process.env.LEVEL_DISCORD_POST_FULL_LADDER?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
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

function formatOpenResistanceRangeLine(
  payload: LevelSnapshotPayload,
  ladderResistanceZones: LevelSnapshotDisplayZone[],
): string | null {
  const audit = payload.audit;
  if (
    !audit ||
    !Number.isFinite(audit.forwardResistanceLimit) ||
    !Number.isFinite(payload.currentPrice) ||
    payload.currentPrice <= 0 ||
    audit.forwardResistanceLimit <= payload.currentPrice ||
    audit.resistanceCandidates.some(
      (candidate) => !candidate.displayed && candidate.omittedReason !== "compacted",
    )
  ) {
    return null;
  }

  const highestResistance =
    ladderResistanceZones.length > 0
      ? Math.max(...ladderResistanceZones.map((zone) => zone.representativePrice))
      : payload.currentPrice;
  const uncoveredForwardRangePct =
    (audit.forwardResistanceLimit - highestResistance) / payload.currentPrice;

  if (uncoveredForwardRangePct < 0.08) {
    return null;
  }

  const distance = formatDistancePctFromPrice(audit.forwardResistanceLimit, payload.currentPrice);
  const suffix = distance ? ` (${distance})` : "";
  return `No additional resistance found below ${formatLevel(audit.forwardResistanceLimit)}${suffix}.`;
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

function snapshotDisplayClusterWidthPctLimit(
  lowPrice: number,
  side: "support" | "resistance",
): number {
  return side === "resistance" ? 0.05 : 0.04;
}

function isStructuralSnapshotZone(zone: LevelSnapshotDisplayZone): boolean {
  return /daily|4h|confluence|structure/i.test(zone.sourceLabel ?? "");
}

function isContinuationMapSnapshotZone(zone: LevelSnapshotDisplayZone): boolean {
  return /continuation map/i.test(zone.sourceLabel ?? "");
}

function snapshotEntryHasContinuationMap(entry: SnapshotDisplayEntry): boolean {
  return entry.type === "single"
    ? isContinuationMapSnapshotZone(entry.zone)
    : entry.zones.some(isContinuationMapSnapshotZone);
}

function shouldShowTwoLevelSnapshotCluster(
  group: LevelSnapshotDisplayZone[],
  lowPrice: number,
  highPrice: number,
  side: "support" | "resistance",
  currentPrice?: number,
  previousZone?: LevelSnapshotDisplayZone,
  nextZone?: LevelSnapshotDisplayZone,
): boolean {
  if (side !== "resistance" || group.length !== 2 || currentPrice === undefined) {
    return false;
  }

  const widthPct = (highPrice - lowPrice) / Math.max(lowPrice, 0.0001);
  const nearCurrentOpeningZone =
    !previousZone &&
    Boolean(nextZone) &&
    (lowPrice - currentPrice) / Math.max(currentPrice, 0.0001) <= 0.08;
  const surroundingGapPct = previousZone && nextZone
    ? (nextZone.representativePrice - previousZone.representativePrice) /
      Math.max(currentPrice, 0.0001)
    : 0;
  return (
    (nearCurrentOpeningZone || surroundingGapPct >= 0.12) &&
    widthPct >= 0.035 &&
    widthPct <= snapshotDisplayClusterWidthPctLimit(lowPrice, side) &&
    group.every(isStructuralSnapshotZone)
  );
}

function compactSnapshotDisplayEntries(
  zones: LevelSnapshotDisplayZone[],
  side: "support" | "resistance",
  currentPrice?: number,
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
      if (widthPct > snapshotDisplayClusterWidthPctLimit(lowPrice, side)) {
        break;
      }
      group.push(candidate);
      cursor += 1;
    }

    const prices = group.map((zone) => zone.representativePrice);
    const lowPrice = Math.min(...prices);
    const highPrice = Math.max(...prices);
    if (
      group.length >= 3 ||
      shouldShowTwoLevelSnapshotCluster(
        group,
        lowPrice,
        highPrice,
        side,
        currentPrice,
        sorted[index - 1],
        sorted[cursor],
      )
    ) {
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

function snapshotEntryDistanceRatio(
  entry: SnapshotDisplayEntry,
  currentPrice: number,
  side: "support" | "resistance",
): number {
  const reference = side === "support"
    ? snapshotEntryHigh(entry)
    : snapshotEntryLow(entry);
  return Math.abs(reference - currentPrice) / Math.max(currentPrice, 0.0001);
}

function practicalPullbackDistanceLimit(currentPrice: number, index: number): number {
  if (index === 0) {
    return currentPrice < 10 ? 0.3 : 0.2;
  }
  return currentPrice < 10 ? 0.3 : 0.2;
}

const SMALL_CAP_ORDINARY_TRADE_MAP_DISTANCE_RATIO = 0.15;
const SMALL_CAP_HIGH_QUALITY_TRADE_MAP_DISTANCE_RATIO = 0.1;
const TIGHT_SMALL_CAP_LEVEL_CLUSTER_RATIO = 0.04;
const MAX_ROUTINE_SMALL_CAP_PULLBACK_DISTANCE_RATIO = 0.12;

function isHighQualityTradeMapEntry(entry: SnapshotDisplayEntry): boolean {
  return (
    strengthRank(snapshotEntryStrength(entry)) >= strengthRank("strong") ||
    snapshotEntrySourceLabels(entry).some((label) => /daily|4h|confluence|structure/i.test(label)) ||
    snapshotEntryZones(entry).some((zone) => zone.freshness === "fresh")
  );
}

function isMaterialSmallCapTradeMapEntry(
  entry: SnapshotDisplayEntry,
  currentPrice: number,
  side: "support" | "resistance",
): boolean {
  const distance = snapshotEntryDistanceRatio(entry, currentPrice, side);
  return (
    distance >= SMALL_CAP_ORDINARY_TRADE_MAP_DISTANCE_RATIO ||
    (isHighQualityTradeMapEntry(entry) && distance >= SMALL_CAP_HIGH_QUALITY_TRADE_MAP_DISTANCE_RATIO)
  );
}

function firstMaterialSnapshotEntry(
  entries: LevelSnapshotDisplayZone[],
  firstEntry: SnapshotDisplayEntry | null,
  currentPrice: number,
  side: "support" | "resistance",
): SnapshotDisplayEntry | null {
  let cursor = firstEntry;
  for (let index = 0; index < 8 && cursor; index += 1) {
    if (isMaterialSmallCapTradeMapEntry(cursor, currentPrice, side)) {
      return cursor;
    }
    cursor = nextSnapshotEntryAfter(entries, cursor, side);
  }
  return null;
}

function collectPracticalPullbackEntries(
  payload: LevelSnapshotPayload,
  firstSupport: SnapshotDisplayEntry | null,
): SnapshotDisplayEntry[] {
  const entries: SnapshotDisplayEntry[] = [];
  let cursor = firstSupport;

  for (let index = 0; index < 3 && cursor; index += 1) {
    const distance = snapshotEntryDistanceRatio(cursor, payload.currentPrice, "support");
    if (
      distance > practicalPullbackDistanceLimit(payload.currentPrice, index) ||
      distance > MAX_ROUTINE_SMALL_CAP_PULLBACK_DISTANCE_RATIO
    ) {
      break;
    }
    if (isMaterialSmallCapTradeMapEntry(cursor, payload.currentPrice, "support")) {
      entries.push(cursor);
    }
    cursor = nextSnapshotEntryAfter(payload.supportZones, cursor, "support");
  }

  return entries;
}

function firstDeepMaterialSupportEntry(
  payload: LevelSnapshotPayload,
  firstSupport: SnapshotDisplayEntry | null,
): SnapshotDisplayEntry | null {
  let cursor = firstSupport;

  for (let index = 0; index < 8 && cursor; index += 1) {
    const distance = snapshotEntryDistanceRatio(cursor, payload.currentPrice, "support");
    if (
      distance > MAX_ROUTINE_SMALL_CAP_PULLBACK_DISTANCE_RATIO &&
      isMaterialSmallCapTradeMapEntry(cursor, payload.currentPrice, "support")
    ) {
      return cursor;
    }
    cursor = nextSnapshotEntryAfter(payload.supportZones, cursor, "support");
  }

  return null;
}

function formatSnapshotSetupPullbackLines(
  payload: LevelSnapshotPayload,
  firstSupport: SnapshotDisplayEntry | null,
): string[] {
  const pullbackEntries = collectPracticalPullbackEntries(payload, firstSupport);
  if (pullbackEntries.length === 0) {
    if (firstSupport) {
      const firstSupportDistance = snapshotEntryDistanceRatio(firstSupport, payload.currentPrice, "support");
      if (firstSupportDistance > practicalPullbackDistanceLimit(payload.currentPrice, 0)) {
        return [
          "Pullback Zones:",
          `- Nearest support is ${formatSnapshotEntryLabelWithDistance(firstSupport, payload.currentPrice, "support")}, but it is too far from price to call a clean pullback zone.`,
        ];
      }
      const lines = [
        "Pullback Zones:",
        `- Nearby support gate: ${formatSnapshotEntryLabelWithDistance(firstSupport, payload.currentPrice, "support")}; this is not a material small-cap pullback zone by itself.`,
      ];
      const deepSupport = firstDeepMaterialSupportEntry(payload, firstSupport);
      if (deepSupport) {
        lines.push(
          `- First real support below that is ${formatSnapshotEntryLabelWithDistance(deepSupport, payload.currentPrice, "support")}; that is a deeper reset area, not a routine pullback zone.`,
        );
      }
      return lines;
    }
    return [
      "Pullback Zones:",
      "- No clean support zone is available below price in this snapshot.",
    ];
  }

  const labels = [
    "First pullback area",
    "Deeper pullback area",
    "Last nearby support area",
  ];
  return [
    "Pullback Zones:",
    ...pullbackEntries.map((entry, index) =>
      `- ${labels[index]}: ${formatSnapshotEntryLabelWithDistance(entry, payload.currentPrice, "support")}.`,
    ),
  ];
}

function isTightSmallCapLevelCluster(
  support: SnapshotDisplayEntry,
  resistance: SnapshotDisplayEntry,
  currentPrice: number,
): boolean {
  const bandWidth =
    (snapshotEntryLow(resistance) - snapshotEntryHigh(support)) /
    Math.max(currentPrice, 0.0001);
  return bandWidth > 0 && bandWidth <= TIGHT_SMALL_CAP_LEVEL_CLUSTER_RATIO;
}

function buildSnapshotStructureQualityNote(payload: LevelSnapshotPayload): string | null {
  const stable =
    payload.marketStructure?.timeframes?.["5m"]?.stable ??
    payload.marketStructure?.stable;
  if (!stable) {
    return null;
  }
  if (stable.activeRangeQuality === "choppy") {
    return "5m structure is choppy, so middle-of-range pushes can be noisy";
  }
  if (stable.trendDirection === "damaged") {
    return "5m trend is damaged, so continuation needs cleaner acceptance";
  }
  if (stable.trendDirection === "uptrend" || stable.trendDirection === "building") {
    return "5m structure is constructive while higher lows continue to hold";
  }
  return null;
}

function buildSnapshotSetupQualityLine(
  payload: LevelSnapshotPayload,
  support: SnapshotDisplayEntry | null,
  resistance: SnapshotDisplayEntry | null,
): string {
  const notes: string[] = [];

  if (support && resistance) {
    const supportDistance = snapshotEntryDistanceRatio(support, payload.currentPrice, "support");
    const resistanceDistance = snapshotEntryDistanceRatio(resistance, payload.currentPrice, "resistance");
    const bandWidth =
      (snapshotEntryLow(resistance) - snapshotEntryHigh(support)) /
      Math.max(payload.currentPrice, 0.0001);

    if (isTightSmallCapLevelCluster(support, resistance, payload.currentPrice)) {
      notes.push("tight nearby level cluster; small pushes inside the band can be noise");
    } else if (bandWidth <= 0.12) {
      notes.push("range-bound; small pushes inside the band can be noise");
    } else if (supportDistance >= 0.15) {
      notes.push("extended from support; controlled pullback behavior matters");
    } else if (resistanceDistance <= 0.035) {
      notes.push("tight to resistance; breakout quality depends on acceptance above the area");
    } else {
      notes.push("cleaner while price respects support and works toward resistance");
    }
  } else if (resistance) {
    notes.push("support is not clear from this snapshot");
  } else if (support) {
    notes.push("higher resistance is not clear from this snapshot");
  } else {
    notes.push("nearby ladder is too limited for a clean setup read");
  }

  const supportCount = payload.audit?.supportCandidates.length ?? payload.supportZones.length;
  const resistanceCount = payload.audit?.resistanceCandidates.length ?? payload.resistanceZones.length;
  if (supportCount <= 1 || resistanceCount <= 1) {
    notes.push("ladder depth is thin");
  }

  if (
    typeof payload.audit?.livePriceAgeMs === "number" &&
    payload.audit.livePriceAgeMs > 120_000
  ) {
    notes.push("price reference may be stale");
  }

  const structureNote = buildSnapshotStructureQualityNote(payload);
  if (structureNote) {
    notes.push(structureNote);
  }

  return `Quality / Caution: ${[...new Set(notes)].join("; ")}.`;
}

function buildSnapshotTradeMapLines(payload: LevelSnapshotPayload): string[] {
  const support = buildPracticalSnapshotAreaEntry(payload.supportZones, payload.currentPrice, "support");
  const resistance = buildPracticalSnapshotAreaEntry(payload.resistanceZones, payload.currentPrice, "resistance");
  const nextResistance = resistance
    ? nextSnapshotEntryAfter(payload.resistanceZones, resistance, "resistance")
    : null;
  const materialResistance = firstMaterialSnapshotEntry(
    payload.resistanceZones,
    resistance,
    payload.currentPrice,
    "resistance",
  );
  const deeperSupport = support
    ? nextSnapshotEntryAfter(payload.supportZones, support, "support")
    : null;
  const lines: string[] = [];
  const supportLabel = support ? formatSnapshotEntryLabel(support, "support") : null;
  const resistanceLabel = resistance ? formatSnapshotEntryLabel(resistance, "resistance") : null;
  const resistanceLabelWithDistance = resistance
    ? formatSnapshotEntryLabelWithDistance(resistance, payload.currentPrice, "resistance")
    : null;
  const nextResistanceLabelWithDistance = nextResistance
    ? formatSnapshotEntryLabelWithDistance(nextResistance, payload.currentPrice, "resistance")
    : null;
  const materialResistanceLabelWithDistance =
    materialResistance && materialResistance !== resistance
      ? formatSnapshotEntryLabelWithDistance(materialResistance, payload.currentPrice, "resistance")
      : null;
  const deeperSupportLabelWithDistance = deeperSupport
    ? formatSnapshotEntryLabelWithDistance(deeperSupport, payload.currentPrice, "support")
    : null;

  if (support && resistance && supportLabel && resistanceLabel) {
    const supportDistance = snapshotEntryDistanceRatio(support, payload.currentPrice, "support");
    const resistanceDistance = snapshotEntryDistanceRatio(resistance, payload.currentPrice, "resistance");
    const bandWidth =
      (snapshotEntryLow(resistance) - snapshotEntryHigh(support)) /
      Math.max(payload.currentPrice, 0.0001);

    if (isTightSmallCapLevelCluster(support, resistance, payload.currentPrice)) {
      lines.push(
        `Current Read: ${payload.symbol} is inside a tight nearby level cluster from ${supportLabel} to ${resistanceLabel}; small pushes inside that band are noise. The useful read comes from acceptance above resistance or a clean loss/reclaim of support.`,
      );
    } else if (bandWidth <= 0.12) {
      lines.push(
        `Current Read: ${payload.symbol} is range-bound between ${supportLabel} and ${resistanceLabel}; the better information comes from expansion above resistance or a clean support failure.`,
      );
    } else if (resistanceDistance <= 0.035) {
      lines.push(
        `Current Read: ${payload.symbol} is a breakout-watch setup against ${resistanceLabel}; acceptance above that area matters more than small pushes just below it.`,
      );
    } else if (supportDistance <= 0.035) {
      lines.push(
        `Current Read: ${payload.symbol} is pulling into ${supportLabel}; the cleaner read comes from stabilization there before the next resistance test.`,
      );
    } else if (supportDistance >= 0.15) {
      lines.push(
        `Current Read: ${payload.symbol} is extended from the nearest support, so pullback behavior matters before continuation gets cleaner.`,
      );
    } else {
      lines.push(
        `Current Read: ${payload.symbol} is trading between ${supportLabel} and ${resistanceLabel}; the active idea is the next clean reaction at either side of the range.`,
      );
    }
  } else if (resistance && resistanceLabel) {
    lines.push(
      `Current Read: ${payload.symbol} is below ${resistanceLabel}; the cleaner upside read needs acceptance above that area.`,
    );
  } else if (support && supportLabel) {
    lines.push(
      `Current Read: ${payload.symbol} is above ${supportLabel}; the setup stays cleaner while that area holds.`,
    );
  } else {
    lines.push("Current Read: nearby levels are limited, so this read needs a fresh ladder before it becomes useful.");
  }

  lines.push("");

  if (resistance && resistanceLabelWithDistance) {
    if (!isMaterialSmallCapTradeMapEntry(resistance, payload.currentPrice, "resistance")) {
      if (materialResistanceLabelWithDistance) {
        lines.push(
          `Breakout Area To Watch: ${resistanceLabelWithDistance} is a nearby gate, not the material target; the first material upside map area is ${materialResistanceLabelWithDistance}.`,
        );
      } else {
        lines.push(
          `Breakout Area To Watch: ${resistanceLabelWithDistance} is a nearby gate, not the material target; higher resistance needs a fresh level check before treating the path as open.`,
        );
      }
    } else if (nextResistanceLabelWithDistance) {
      lines.push(
        `Breakout Area To Watch: ${resistanceLabelWithDistance} is the first upside area; acceptance above it shifts attention toward ${nextResistanceLabelWithDistance}.`,
      );
    } else {
      lines.push(
        `Breakout Area To Watch: ${resistanceLabelWithDistance} is the first upside area; higher resistance needs a fresh level check before treating the path as open.`,
      );
    }
  } else {
    lines.push("Breakout Area To Watch: no clean nearby resistance is available in this snapshot.");
  }

  lines.push("");
  lines.push(...formatSnapshotSetupPullbackLines(payload, support));
  lines.push("");

  if (resistance && resistanceLabel) {
    if (materialResistanceLabelWithDistance) {
      lines.push(
        `Continuation Path: above ${resistanceLabel}, the material upside map area is ${materialResistanceLabelWithDistance}; reactions there matter more than assuming open space.`,
      );
    } else if (nextResistanceLabelWithDistance && isMaterialSmallCapTradeMapEntry(resistance, payload.currentPrice, "resistance")) {
      lines.push(
        `Continuation Path: above ${resistanceLabel}, the next map area is ${nextResistanceLabelWithDistance}; reactions there matter more than assuming open space.`,
      );
    } else {
      lines.push(
        `Continuation Path: above ${resistanceLabel}, higher resistance needs a fresh level check before the move can be treated as open.`,
      );
    }
  } else {
    lines.push("Continuation Path: no continuation path is available until higher resistance is refreshed.");
  }

  lines.push("");

  if (support && supportLabel) {
    const nearbyDeeperSupportLabelWithDistance =
      deeperSupport &&
      deeperSupportLabelWithDistance &&
      snapshotEntryDistanceRatio(deeperSupport, payload.currentPrice, "support") <= 0.3
        ? deeperSupportLabelWithDistance
        : null;
    const reclaimText = nearbyDeeperSupportLabelWithDistance
      ? ` Below that, the next map area is ${nearbyDeeperSupportLabelWithDistance}.`
      : " A fresh support check matters below that area.";
    lines.push(
      `Setup Weakens If: price loses ${supportLabel} as a whole area and cannot reclaim it.${reclaimText}`,
    );
  } else {
    lines.push("Setup Weakens If: price loses the active range and the ladder still cannot identify usable support.");
  }

  lines.push("");
  lines.push(buildSnapshotSetupQualityLine(payload, support, resistance));

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
  options: { compact?: boolean } = {},
): string[] {
  const side = label === "Resistance" ? "resistance" : "support";
  const entries = options.compact === false
    ? [...zones]
        .sort((left, right) =>
          side === "support"
            ? right.representativePrice - left.representativePrice
            : left.representativePrice - right.representativePrice,
        )
        .map((zone): SnapshotDisplayEntry => ({ type: "single", zone }))
    : compactSnapshotDisplayEntries(zones, side, currentPrice);
  const selected = limit === undefined ? entries : entries.slice(0, limit);
  if (selected.length === 0) {
    return [`${label}:`, "none"];
  }

  return [
    `${label}:`,
    ...selected.map((entry) => formatSnapshotDisplayEntry(entry, currentPrice)),
  ];
}

function formatSnapshotResistanceBlock(
  zones: LevelSnapshotDisplayZone[],
  currentPrice: number,
): string[] {
  const entries = compactSnapshotDisplayEntries(zones, "resistance", currentPrice);
  if (entries.length === 0) {
    return ["Resistance:", "none"];
  }

  const minForwardCoveragePct = 0.3;
  const selected: SnapshotDisplayEntry[] = [];

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    selected.push(entry);

    const entryForwardPct =
      (snapshotEntryRepresentative(entry, "resistance") - currentPrice) /
      Math.max(currentPrice, 0.0001);
    if (
      selected.length >= 3 &&
      entryForwardPct >= minForwardCoveragePct
    ) {
      const nextEntry = entries[index + 1];
      const selectedHasContinuationMap = selected.some(snapshotEntryHasContinuationMap);
      if (selectedHasContinuationMap && snapshotEntryHasContinuationMap(entry) && nextEntry) {
        continue;
      }
      break;
    }
  }

  return [
    "Resistance:",
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
  warnIfWatchlistTraderReadAiRequested();
  const keyResistanceLines = formatSnapshotResistanceBlock(payload.resistanceZones, payload.currentPrice);
  const keySupportLines = formatSnapshotLevelBlock("Support", payload.supportZones, payload.currentPrice, 3);
  const tradeMapLines = buildSnapshotTradeMapLines(payload);
  const tradePlanLines = payload.tradePlan?.lines.filter((line) => line.trim().length > 0) ?? [];
  const potentialMoveReadLines = formatPotentialMoveRead(payload.potentialMoveRead);
  const hasMarketStructureField = Object.prototype.hasOwnProperty.call(payload, "marketStructure");
  const marketStructureLines = buildVisibleMarketStructureDiscordLines(payload.marketStructure, {
    includeWaitingPlaceholders: hasMarketStructureField,
  });
  const visibleMarketStructureLines = marketStructureLines;

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
    ...(visibleMarketStructureLines.length > 0
      ? [
          "Market structure:",
          ...visibleMarketStructureLines.map((line) => `- ${line}`),
          "",
        ]
      : []),
    ...(potentialMoveReadLines.length > 0
      ? [
          ...potentialMoveReadLines,
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
  ].join("\n");
}

export function formatLevelLadderMessage(payload: LevelSnapshotPayload): string | null {
  const ladderResistanceZones = payload.ladderResistanceZones ?? payload.resistanceZones;
  const ladderSupportZones = payload.ladderSupportZones ?? payload.supportZones;

  if (ladderResistanceZones.length === 0 && ladderSupportZones.length === 0) {
    return null;
  }

  const fullResistanceLines = formatSnapshotLevelBlock(
    "Resistance",
    ladderResistanceZones,
    payload.currentPrice,
    undefined,
    { compact: false },
  );
  const openResistanceRangeLine = formatOpenResistanceRangeLine(payload, ladderResistanceZones);
  const resistanceLines = openResistanceRangeLine
    ? [...fullResistanceLines, openResistanceRangeLine]
    : fullResistanceLines;
  const fullSupportLines = formatSnapshotLevelBlock(
    "Support",
    ladderSupportZones,
    payload.currentPrice,
    undefined,
    { compact: false },
  );

  return [
    `${payload.symbol} full level ladder`,
    `Price: ${formatLevel(payload.currentPrice)}`,
    "",
    ...resistanceLines,
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
    if (shouldPostFullLevelLadderToDiscord()) {
      await this.gateway.sendLevelLadder?.(threadId, payload);
    }
  }

  async routeLevelExtension(threadId: string, payload: LevelExtensionPayload): Promise<void> {
    await this.gateway.sendLevelExtension(threadId, payload);
  }
}
