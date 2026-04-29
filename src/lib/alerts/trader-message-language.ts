// 2026-04-22 02:10 PM America/Toronto
// Trader-facing wording helpers so downstream alerts explain level quality and setup intent more clearly.

import type { FinalLevelZone } from "../levels/level-types.js";
import { deriveZoneTacticalRead } from "../levels/zone-tactical-read.js";
import type { MonitoringEvent } from "../monitoring/monitoring-types.js";
import type {
  TraderDipBuyQualityContext,
  TraderExhaustionContext,
  TraderFailureRiskContext,
  TraderFollowThroughContext,
  TraderMovementContext,
  TraderNextBarrierContext,
  TraderPathQualityContext,
  TraderPressureContext,
  TraderSetupStateContext,
  TraderTriggerQualityContext,
  TraderTargetContext,
  TraderTradeMapContext,
  TraderZoneTacticalRead,
} from "./alert-types.js";

function formatLevel(level: number): string {
  return level >= 1 ? level.toFixed(2) : level.toFixed(4);
}

export function describeZoneStrength(
  strengthLabel: FinalLevelZone["strengthLabel"],
): "light" | "moderate" | "heavy" | "major" {
  switch (strengthLabel) {
    case "weak":
      return "light";
    case "strong":
      return "heavy";
    case "major":
      return "major";
    default:
      return "moderate";
  }
}

export function describeZoneStrengthWithKind(
  strengthLabel: FinalLevelZone["strengthLabel"],
  zoneKind: "support" | "resistance",
): string {
  return `${describeZoneStrength(strengthLabel)} ${zoneKind}`;
}

export function deriveTraderZoneTacticalRead(
  zone?: FinalLevelZone,
  freshnessOverride?: FinalLevelZone["freshness"],
): TraderZoneTacticalRead | undefined {
  return deriveZoneTacticalRead(zone, freshnessOverride);
}

function formatZoneRange(zone: FinalLevelZone): string {
  if (Math.abs(zone.zoneHigh - zone.zoneLow) <= Math.max(zone.zoneHigh * 0.001, 0.001)) {
    return formatLevel(zone.representativePrice);
  }

  return `${formatLevel(zone.zoneLow)}-${formatLevel(zone.zoneHigh)}`;
}

function clearanceDirectionForSide(side: "support" | "resistance"): string {
  return side === "resistance" ? "overhead" : "downside";
}

function isLongCautionEvent(event: MonitoringEvent): boolean {
  return (
    event.eventType === "breakdown" ||
    event.eventType === "fake_breakout" ||
    (event.eventType === "rejection" && event.zoneKind === "resistance")
  );
}

function formatBarrierPct(
  side: "support" | "resistance",
  distancePct: number,
): string {
  return `${side === "resistance" ? "+" : "-"}${(distancePct * 100).toFixed(1)}%`;
}

function describeBarrierRoom(nextBarrier: TraderNextBarrierContext): string {
  const pctText = formatBarrierPct(nextBarrier.side, nextBarrier.distancePct);
  const sideText = clearanceDirectionForSide(nextBarrier.side);
  const clutterText =
    nextBarrier.clutterLabel === "dense"
      ? `; ${sideText} gets dense quickly (${nextBarrier.nearbyBarrierCount ?? 0} nearby levels)`
      : nextBarrier.clutterLabel === "stacked"
        ? `; ${sideText} is stacked just beyond the first barrier`
        : "";

  switch (nextBarrier.clearanceLabel) {
    case "tight":
      return `room: tight ${sideText} into next ${nextBarrier.side} ${formatLevel(nextBarrier.price)} (${pctText})${clutterText}`;
    case "limited":
      return `room: limited ${sideText} into next ${nextBarrier.side} ${formatLevel(nextBarrier.price)} (${pctText})${clutterText}`;
    case "open":
      return `room: open ${sideText} path to next ${nextBarrier.side} ${formatLevel(nextBarrier.price)} (${pctText})${clutterText}`;
    default:
      return `room: next ${nextBarrier.side} ${formatLevel(nextBarrier.price)} (${pctText})${clutterText}`;
  }
}

function describeLongCautionBarrierRoom(nextBarrier: TraderNextBarrierContext): string {
  const pctText = formatBarrierPct(nextBarrier.side, nextBarrier.distancePct);
  const clutterText =
    nextBarrier.clutterLabel === "dense"
      ? `; nearby levels are dense (${nextBarrier.nearbyBarrierCount ?? 0} nearby levels)`
      : nextBarrier.clutterLabel === "stacked"
        ? "; nearby levels are stacked"
        : "";

  if (nextBarrier.side === "support") {
    switch (nextBarrier.clearanceLabel) {
      case "tight":
        return `risk: next support is close at ${formatLevel(nextBarrier.price)} (${pctText}), so longs have little room for error${clutterText}`;
      case "limited":
        return `risk: next support is ${formatLevel(nextBarrier.price)} (${pctText}); long setups need price to stabilize first${clutterText}`;
      case "open":
        return `risk: open air to next support near ${formatLevel(nextBarrier.price)} (${pctText}) if buyers do not reclaim the level${clutterText}`;
      default:
        return `risk: next support is ${formatLevel(nextBarrier.price)} (${pctText})${clutterText}`;
    }
  }

  return describeBarrierRoom(nextBarrier);
}

function deriveDirectionalTradePlan(
  event: MonitoringEvent,
  zone?: FinalLevelZone,
): {
  invalidationLevel: number;
  preferredBarrierSide: "support" | "resistance";
} | null {
  if (!zone) {
    return null;
  }

  switch (event.eventType) {
    case "breakout":
    case "reclaim":
    case "fake_breakdown":
      return {
        invalidationLevel: zone.zoneLow,
        preferredBarrierSide: "resistance",
      };
    case "breakdown":
    case "fake_breakout":
      return {
        invalidationLevel: zone.zoneHigh,
        preferredBarrierSide: "support",
      };
    case "rejection":
    case "level_touch":
      return zone.kind === "support"
        ? {
            invalidationLevel: zone.zoneLow,
            preferredBarrierSide: "resistance",
          }
        : {
            invalidationLevel: zone.zoneHigh,
            preferredBarrierSide: "support",
          };
    default:
      return null;
  }
}

function formatPct(pct: number): string {
  return `${(pct * 100).toFixed(1)}%`;
}

function ratioLabel(ratio: number): TraderTradeMapContext["label"] {
  if (ratio >= 2) {
    return "favorable";
  }
  if (ratio >= 1) {
    return "workable";
  }
  return "tight";
}

function movementStageLine(
  movementPct: number,
  earlyText: string,
  buildingText: string,
  extendedText: string,
): TraderMovementContext {
  if (movementPct <= 0.005) {
    return {
      label: "early",
      movementPct,
      line: `${earlyText} (${formatPct(movementPct)})`,
    };
  }

  if (movementPct <= 0.015) {
    return {
      label: "building",
      movementPct,
      line: `${buildingText} (${formatPct(movementPct)})`,
    };
  }

  return {
    label: "extended",
    movementPct,
    line: `${extendedText} (${formatPct(movementPct)})`,
  };
}

export function deriveTraderPressureContext(
  event: MonitoringEvent,
): TraderPressureContext {
  const score = Math.max(0, Math.min(1, event.pressureScore));

  if (event.bias === "neutral") {
    return {
      label: "balanced",
      pressureScore: score,
      line: "pressure: buying and selling pressure still look balanced",
    };
  }

  if (event.bias === "bearish") {
    if (score >= 0.7) {
      return {
        label: "strong",
        pressureScore: score,
        line: "pressure: buyers do not have control right now",
      };
    }

    if (score >= 0.45) {
      return {
        label: "moderate",
        pressureScore: score,
        line: "pressure: buyers still need to reclaim control",
      };
    }

    return {
      label: "tentative",
      pressureScore: score,
      line: "pressure: buyers are not showing clear control yet",
    };
  }

  if (score >= 0.7) {
    return {
      label: "strong",
      pressureScore: score,
      line: "pressure: buyers still have strong control, backing the move",
    };
  }

  if (score >= 0.45) {
    return {
      label: "moderate",
      pressureScore: score,
      line: "pressure: buyers still have workable control, but follow-through still matters",
    };
  }

  return {
    label: "tentative",
    pressureScore: score,
    line: "pressure: buyers are present, but control still looks tentative",
  };
}

export function deriveTraderTriggerQualityContext(params: {
  event: MonitoringEvent;
  movement?: TraderMovementContext | null;
  pressure: TraderPressureContext;
  nextBarrier?: TraderNextBarrierContext | null;
}): TraderTriggerQualityContext | null {
  const { event, movement, pressure, nextBarrier } = params;
  if (event.eventType === "compression") {
    return null;
  }

  const pressureText =
    pressure.label === "strong"
      ? "strong control"
      : pressure.label === "moderate"
        ? "workable control"
        : pressure.label === "tentative"
          ? "tentative control"
          : "balanced control";

  const roomText =
    nextBarrier?.clearanceLabel === "open"
      ? "open room"
      : nextBarrier?.clearanceLabel === "limited"
        ? "limited room"
        : nextBarrier?.clearanceLabel === "tight"
          ? "tight room"
          : "unclear room";

  if (movement?.label === "extended") {
    return {
      label: "late",
      line: `trigger quality: late trigger because price is already extended and chase risk is higher`,
    };
  }

  if (
    nextBarrier?.clearanceLabel === "tight" ||
    nextBarrier?.clutterLabel === "dense" ||
    pressure.label === "tentative"
  ) {
    return {
      label: "crowded",
      line: `trigger quality: crowded trigger with ${pressureText} and ${roomText}${nextBarrier?.clutterLabel === "dense" ? ", plus dense pathing" : ""}`,
    };
  }

  if (
    (movement?.label === "early" || movement?.label === "building") &&
    pressure.label === "strong"
  ) {
    return {
      label: "clean",
      line: `trigger quality: clean trigger with early movement, ${pressureText}, and ${roomText}`,
    };
  }

  return {
    label: "workable",
    line: `trigger quality: workable trigger with ${pressureText}, but follow-through still needs to prove itself`,
  };
}

export function deriveTraderSetupStateContext(params: {
  event: MonitoringEvent;
  movement?: TraderMovementContext | null;
}): TraderSetupStateContext | null {
  const { event, movement } = params;

  switch (event.eventType) {
    case "compression":
    case "level_touch":
      return {
        label: "building",
        line: "setup state: building, so the zone still needs a real decision move",
      };
    case "breakout":
    case "breakdown":
    case "reclaim":
      if (movement?.label === "early") {
        return {
          label: "confirmation",
          line: "setup state: confirmation, so the move still needs acceptance to hold",
        };
      }

      return {
        label: "continuation",
        line: "setup state: continuation, so the move has started and now needs follow-through",
      };
    case "rejection":
      return {
        label: "weakening",
        line: "setup state: weakening, so the active test is fading but not fully failed yet",
      };
    case "fake_breakout":
    case "fake_breakdown":
      return {
        label: "failed",
        line: "setup state: failed, so the prior break attempt already lost structure",
      };
    default:
      return null;
  }
}

export function deriveTraderFailureRiskContext(params: {
  event: MonitoringEvent;
  zone?: FinalLevelZone;
  pressure: TraderPressureContext;
  triggerQuality?: TraderTriggerQualityContext | null;
  nextBarrier?: TraderNextBarrierContext | null;
}): TraderFailureRiskContext | null {
  const { event, zone, pressure, triggerQuality, nextBarrier } = params;
  if (!zone || event.eventType === "compression") {
    return null;
  }

  const reasons: string[] = [];
  let riskScore = 0;
  const tacticalRead = deriveTraderZoneTacticalRead(zone, event.eventContext.zoneFreshness);
  const directionalResolution =
    event.eventType === "breakout" ||
    event.eventType === "breakdown" ||
    event.eventType === "reclaim" ||
    event.eventType === "fake_breakout" ||
    event.eventType === "fake_breakdown";

  if (triggerQuality?.label === "late") {
    reasons.push("late trigger");
    riskScore += 2;
  } else if (triggerQuality?.label === "crowded") {
    reasons.push("crowded trigger");
    riskScore += 1;
  }

  if (nextBarrier?.clearanceLabel === "tight") {
    reasons.push("tight room");
    riskScore += 1;
  }

  if (nextBarrier?.clutterLabel === "dense") {
    reasons.push("dense nearby barriers");
    riskScore += 1;
  } else if (nextBarrier?.clutterLabel === "stacked") {
    reasons.push("stacked nearby barriers");
    riskScore += 1;
  }

  if (pressure.label === "tentative") {
    reasons.push("tentative control");
    riskScore += 1;
  } else if (pressure.label === "balanced") {
    reasons.push("balanced control");
    riskScore += 1;
  }

  if (tacticalRead === "tired") {
    reasons.push("tired structure");
    riskScore += 1;
  }

  if (event.eventContext.dataQualityDegraded) {
    reasons.push("degraded data");
    riskScore += 1;
  }

  if (directionalResolution && event.eventContext.ladderPosition === "inner") {
    reasons.push("inner setup");
    riskScore += 1;
  }

  if (riskScore <= 0) {
    return {
      label: "contained",
      reasons,
      line: "failure risk: still relatively contained while price holds this area",
    };
  }

  const reasonText = reasons.join(", ");
  if (riskScore === 1) {
    return {
      label: "watchful",
      reasons,
      line: `failure risk: watchful because ${reasonText}`,
    };
  }

  if (riskScore === 2) {
    return {
      label: "elevated",
      reasons,
      line: `failure risk: elevated because ${reasonText}`,
    };
  }

  return {
    label: "high",
    reasons,
    line: `failure risk: high because ${reasonText}`,
  };
}

export function deriveTraderDipBuyQualityContext(params: {
  event: MonitoringEvent;
  zone?: FinalLevelZone;
  pressure: TraderPressureContext;
  nextBarrier?: TraderNextBarrierContext | null;
}): TraderDipBuyQualityContext | null {
  const { event, zone, pressure, nextBarrier } = params;
  if (!zone || event.eventType !== "level_touch" || zone.kind !== "support") {
    return null;
  }

  const tacticalRead = deriveTraderZoneTacticalRead(zone, event.eventContext.zoneFreshness);
  const exhaustion = deriveTraderExhaustionContext(event, zone);
  const pathQuality = deriveTraderPathQualityContext(nextBarrier);
  const limitedRoute =
    nextBarrier?.clearanceLabel === "limited" ||
    nextBarrier?.clutterLabel === "stacked" ||
    pathQuality?.label === "layered";
  const crowdedRoute =
    pathQuality?.label === "choppy" ||
    (pathQuality?.label === "layered" && (pathQuality.barrierCount >= 3 || (pathQuality.pathConstraintScore ?? 0) >= 0.55));
  const tooWorn =
    tacticalRead === "tired" ||
    exhaustion?.label === "worn" ||
    exhaustion?.label === "spent";
  const testedButCrowded = exhaustion?.label === "tested" && limitedRoute;
  const weakBuyerControl = pressure.label === "tentative" || pressure.label === "balanced";
  if (
    tooWorn ||
    testedButCrowded ||
    (weakBuyerControl && limitedRoute) ||
    nextBarrier?.clearanceLabel === "tight" ||
    nextBarrier?.clutterLabel === "dense" ||
    crowdedRoute
  ) {
    return {
      label: "poor",
      line:
        tooWorn
          ? "support reaction quality: tactically poor because support is still on the chart but looks too worn to lean on"
          : testedButCrowded
            ? "support reaction quality: tactically poor because support is still there, but repeated testing plus nearby overhead make it more watchable than actionable"
            : weakBuyerControl && limitedRoute
              ? "support reaction quality: tactically poor because buyer control is still too soft for the amount of nearby overhead"
              : "support reaction quality: tactically poor because the upside path is too messy for a clean support reaction",
    };
  }

  if (
    (zone.strengthLabel === "strong" || zone.strengthLabel === "major") &&
    tacticalRead === "firm" &&
    exhaustion?.label !== "tested" &&
    pressure.label !== "tentative" &&
    pressure.label !== "balanced" &&
    nextBarrier?.clearanceLabel === "open" &&
    nextBarrier?.clutterLabel !== "stacked" &&
    pathQuality?.label === "clean"
  ) {
    return {
      label: "actionable",
      line: "support reaction quality: actionable while structure and nearby room still support a bounce",
    };
  }

  return {
    label: "watch_only",
    line:
      exhaustion?.label === "tested"
        ? "support reaction quality: watch-only because support still matters, but repeated testing means buyers still need to lift overhead cleanly first"
        : "support reaction quality: watch-only until buyers prove they can lift through nearby overhead cleanly",
  };
}

export function deriveTraderPathQualityContext(
  nextBarrier?: TraderNextBarrierContext | null,
): TraderPathQualityContext | null {
  if (!nextBarrier?.pathQualityLabel || !nextBarrier.pathBarrierCount) {
    return null;
  }

  const barrierCountText = `${nextBarrier.pathBarrierCount} nearby barrier${nextBarrier.pathBarrierCount === 1 ? "" : "s"}`;
  const pathWindowText =
    typeof nextBarrier.pathWindowDistancePct === "number"
      ? ` inside the first ${formatPct(nextBarrier.pathWindowDistancePct)}`
      : "";

  if (nextBarrier.pathQualityLabel === "clean") {
    return {
      label: "clean",
      barrierCount: nextBarrier.pathBarrierCount,
      pathConstraintScore: nextBarrier.pathConstraintScore,
      pathWindowDistancePct: nextBarrier.pathWindowDistancePct,
      line: `path quality: cleaner route with ${barrierCountText}${pathWindowText}, so follow-through has room to trend`,
    };
  }

  if (nextBarrier.pathQualityLabel === "layered") {
    return {
      label: "layered",
      barrierCount: nextBarrier.pathBarrierCount,
      pathConstraintScore: nextBarrier.pathConstraintScore,
      pathWindowDistancePct: nextBarrier.pathWindowDistancePct,
      line: `path quality: layered route with ${barrierCountText}${pathWindowText}, so the move may need to work through steps`,
    };
  }

  return {
    label: "choppy",
    barrierCount: nextBarrier.pathBarrierCount,
    pathConstraintScore: nextBarrier.pathConstraintScore,
    pathWindowDistancePct: nextBarrier.pathWindowDistancePct,
    line: `path quality: choppy route with ${barrierCountText}${pathWindowText}, so price may chop even if the first barrier clears`,
  };
}

export function deriveTraderExhaustionContext(
  event: MonitoringEvent,
  zone?: FinalLevelZone,
): TraderExhaustionContext | null {
  if (!zone) {
    return null;
  }

  const exhaustion = event.eventContext.exhaustionLabel;
  if (!exhaustion) {
    return null;
  }

  const noun = zone.kind;
  switch (exhaustion) {
    case "fresh":
      return {
        label: "fresh",
        line: `${noun} exhaustion: still relatively fresh and not overworked yet`,
      };
    case "tested":
      return {
        label: "tested",
        line: `${noun} exhaustion: tested a few times, so it still matters but no longer behaves like untouched structure`,
      };
    case "worn":
      return {
        label: "worn",
        line: `${noun} exhaustion: this level still matters structurally, but repeated tests are wearing down its tradeability`,
      };
    case "spent":
      return {
        label: "spent",
        line: `${noun} exhaustion: this level now looks spent tactically, so it is easier to watch than to trust for a fresh reaction`,
      };
  }
}

export function deriveTraderFollowThroughContext(params: {
  eventType: string;
  returnPct: number | null;
  directionalReturnPct: number | null;
  followThroughLabel: TraderFollowThroughContext["label"];
}): TraderFollowThroughContext {
  const { eventType, returnPct, directionalReturnPct, followThroughLabel } = params;
  const longCautionLabel =
    eventType === "breakdown"
      ? "support-loss warning"
      : eventType === "fake_breakout"
        ? "failed-breakout warning"
        : eventType === "rejection"
          ? "rejection warning"
          : null;
  const eventLabel = longCautionLabel ?? eventType.replaceAll("_", " ");
  const line =
    followThroughLabel === "strong"
      ? `follow-through: ${eventLabel} stayed strong`
      : followThroughLabel === "working"
        ? `follow-through: ${eventLabel} is still working`
        : followThroughLabel === "stalled"
          ? `follow-through: ${eventLabel} stalled and needs a better reaction`
          : followThroughLabel === "failed"
            ? `follow-through: ${longCautionLabel ? `${eventLabel} faded` : `${eventLabel} failed`}`
            : `follow-through: ${eventLabel} outcome is still unclear`;

  return {
    label: followThroughLabel,
    eventType,
    directionalReturnPct,
    rawReturnPct: returnPct,
    line,
  };
}

function describeZonePlacement(
  event: MonitoringEvent,
): string | null {
  if (event.eventContext.zoneOrigin === "promoted_extension") {
    return "promoted extension";
  }

  if (event.eventContext.ladderPosition === "outermost") {
    return "outermost";
  }

  if (event.eventContext.ladderPosition === "extension") {
    return "extension";
  }

  return "inner";
}

function describeZoneContext(event: MonitoringEvent, zone: FinalLevelZone): string {
  const placement = describeZonePlacement(event);
  const freshness = event.eventContext.zoneFreshness;
  const timeframeContext =
    zone.timeframeSources.length > 1
      ? `${zone.timeframeSources.join("/")} confluence`
      : `${zone.timeframeSources[0]} driven`;
  const refreshed = event.eventContext.recentlyRefreshed ? "recently refreshed" : null;
  const degraded = event.eventContext.dataQualityDegraded ? "data quality degraded" : null;

  return [
    `${describeZoneStrengthWithKind(zone.strengthLabel, zone.kind)}${placement ? ` | ${placement}` : ""}`,
    freshness,
    timeframeContext,
    refreshed,
    degraded,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" | ");
}

function buildTacticalReadLine(zone: FinalLevelZone): string | null {
  const tacticalRead = deriveTraderZoneTacticalRead(zone, zone.freshness);
  switch (tacticalRead) {
    case "firm":
      return zone.kind === "support"
        ? "quality: support still looks firm with healthy follow-through"
        : "quality: resistance still looks firm, so a clean break matters more";
    case "tired":
      return zone.kind === "support"
        ? "quality: support looks structurally important but tactically tired"
        : "quality: resistance looked tactically tired before this test";
    default:
      return null;
  }
}

function buildLeadLine(event: MonitoringEvent, zone?: FinalLevelZone): string {
  if (!zone) {
    return `${event.eventType.replaceAll("_", " ")} at ${formatLevel(event.triggerPrice)}`;
  }

  const descriptor = describeZoneStrengthWithKind(zone.strengthLabel, zone.kind);
  const zoneRange = formatZoneRange(zone);

  switch (event.eventType) {
    case "breakout":
      return `bullish breakout through ${descriptor} ${zoneRange}`;
    case "breakdown":
      return `support lost at ${descriptor} ${zoneRange}`;
    case "reclaim":
      return `reclaim back above ${descriptor} ${zoneRange}`;
    case "fake_breakout":
      return `failed breakout at ${descriptor} ${zoneRange}`;
    case "fake_breakdown":
      return `failed breakdown at ${descriptor} ${zoneRange}`;
    case "rejection":
      return zone.kind === "resistance"
        ? `breakout rejected at ${descriptor} ${zoneRange}`
        : `buyers defended ${descriptor} ${zoneRange}`;
    case "compression":
      return `price compressing into ${descriptor} ${zoneRange}`;
    case "level_touch":
      if (
        zone.kind === "support" &&
        (zone.strengthLabel === "strong" || zone.strengthLabel === "major")
      ) {
        return `price testing ${descriptor} ${zoneRange}`;
      }
      return `price testing ${descriptor} ${zoneRange}`;
    default:
      return `setup at ${descriptor} ${zoneRange}`;
  }
}

function buildWhyNowLine(
  event: MonitoringEvent,
  zone?: FinalLevelZone,
): string | null {
  if (!zone) {
    return null;
  }

  switch (event.eventType) {
    case "breakout":
      return event.eventContext.ladderPosition === "outermost"
        ? "why now: price cleared the outermost resistance instead of stalling underneath it"
        : "why now: price pushed through resistance instead of stalling under the zone";
    case "breakdown":
      return event.eventContext.ladderPosition === "outermost"
        ? "why now: price lost the outermost support, so the setup needs a reclaim before it looks cleaner"
        : "why now: price slipped through support instead of holding the zone, raising risk for longs";
    case "reclaim":
      return zone.kind === "support"
        ? "why now: buyers got price back above support after a real break attempt"
        : "why now: buyers got price back above the zone after a real break attempt";
    case "fake_breakout":
      return "why now: breakout pressure failed and price slipped back into resistance";
    case "fake_breakdown":
      return "why now: breakdown pressure failed and buyers reclaimed support quickly";
    case "rejection":
      return zone.kind === "resistance"
        ? "why now: resistance rejected the breakout attempt before buyers could prove acceptance"
        : "why now: buyers responded at support before breakdown acceptance could build";
    case "compression":
      return "why now: repeated near-zone tests are tightening the range into a decision point";
    case "level_touch":
      return zone.kind === "support"
        ? "why now: price came back into defended support instead of drifting mid-range"
        : "why now: price is back at resistance; buyers need acceptance above the zone";
    default:
      return null;
  }
}

export function deriveTraderMovementContext(
  event: MonitoringEvent,
  zone?: FinalLevelZone,
): TraderMovementContext | null {
  if (!zone) {
    return null;
  }

  const triggerPrice = Math.max(event.triggerPrice, 0.0001);
  const zoneHigh = Math.max(zone.zoneHigh, 0.0001);
  const zoneLow = Math.max(zone.zoneLow, 0.0001);

  switch (event.eventType) {
    case "breakout":
      return movementStageLine(
        Math.max(0, event.triggerPrice - zone.zoneHigh) / zoneHigh,
        "movement: price is still just above the zone high, so the breakout is early",
        "movement: price is pushing farther above the zone high and follow-through is building",
        "movement: price is already well above the zone high and getting extended from the breakout zone",
      );
    case "breakdown":
      return movementStageLine(
        Math.max(0, zone.zoneLow - event.triggerPrice) / zoneLow,
        "movement: price is still just below the support floor, so the setup needs a reclaim",
        "movement: price is moving farther below support, increasing risk for longs",
        "movement: price is already well below support and extended away from the lost zone",
      );
    case "reclaim":
      return movementStageLine(
        Math.max(0, event.triggerPrice - zone.zoneHigh) / zoneHigh,
        "movement: price is back just above the zone high, so the reclaim is still early",
        "movement: price is climbing farther back above the zone high and reclaim follow-through is building",
        "movement: price is well back above the zone high and the reclaim is already extended away from the band",
      );
    case "fake_breakout": {
      const movementPct = Math.max(0, zone.zoneHigh - event.triggerPrice) / zoneHigh;
      return {
        label: "back_inside",
        movementPct,
        line: `movement: price is back under the zone high after the failed break (${formatPct(movementPct)})`,
      };
    }
    case "fake_breakdown": {
      const movementPct = Math.max(0, event.triggerPrice - zone.zoneLow) / zoneLow;
      return {
        label: "back_inside",
        movementPct,
        line: `movement: price is back above the zone low after the failed break (${formatPct(movementPct)})`,
      };
    }
    case "rejection":
      if (zone.kind === "resistance") {
        const movementPct = Math.max(0, zone.zoneHigh - event.triggerPrice) / zoneHigh;
        return {
          label: "holding_from_edge",
          movementPct,
          line: `movement: price is fading below the resistance edge after the rejected breakout (${formatPct(movementPct)})`,
        };
      }

      return {
        label: "holding_from_edge",
        movementPct: Math.max(0, event.triggerPrice - zone.zoneLow) / zoneLow,
        line: `movement: price is holding above the support floor after the buyer response (${formatPct(Math.max(0, event.triggerPrice - zone.zoneLow) / zoneLow)})`,
      };
    case "level_touch":
    case "compression":
      if (zone.kind === "support") {
        if (event.triggerPrice < zone.zoneLow) {
          const movementPct = Math.max(0, zone.zoneLow - event.triggerPrice) / zoneLow;
          return {
            label: "inside_band",
            movementPct,
            line: `movement: price is below the support band and trying to reclaim it (${formatPct(movementPct)})`,
          };
        }

        const movementPct = Math.max(0, event.triggerPrice - zone.zoneLow) / zoneLow;
        return {
          label: "inside_band",
          movementPct,
          line: `movement: price is testing inside support above the lower edge (${formatPct(movementPct)})`,
        };
      }

      if (event.triggerPrice > zone.zoneHigh) {
        const movementPct = Math.max(0, event.triggerPrice - zone.zoneHigh) / zoneHigh;
        return {
          label: "inside_band",
          movementPct,
          line: `movement: price is above the resistance band while still near the test area (${formatPct(movementPct)})`,
        };
      }

      return {
        label: "inside_band",
        movementPct: Math.max(0, zone.zoneHigh - event.triggerPrice) / zoneHigh,
        line: `movement: price is testing inside resistance below the upper edge (${formatPct(Math.max(0, zone.zoneHigh - event.triggerPrice) / zoneHigh)})`,
      };
    default:
      return {
        label: "inside_band",
        movementPct: Math.abs(event.triggerPrice - zone.representativePrice) / Math.max(zone.representativePrice, 0.0001),
        line: `movement: price is active near the zone at ${formatLevel(triggerPrice)}`,
      };
  }
}

export function deriveTraderTradeMapContext(
  event: MonitoringEvent,
  zone?: FinalLevelZone,
  nextBarrier?: TraderNextBarrierContext | null,
): TraderTradeMapContext | null {
  if (!zone || event.eventType === "compression") {
    return null;
  }

  const triggerPrice = Math.max(event.triggerPrice, 0.0001);
  const tradePlan = deriveDirectionalTradePlan(event, zone);
  if (!tradePlan || !Number.isFinite(tradePlan.invalidationLevel)) {
    return null;
  }

  const riskPct = Math.abs(triggerPrice - tradePlan.invalidationLevel) / triggerPrice;
  const roomPct =
    isLongCautionEvent(event)
      ? null
      : nextBarrier && nextBarrier.side === tradePlan.preferredBarrierSide
        ? nextBarrier.distancePct
        : null;

  const linePrefix = isLongCautionEvent(event) ? "long risk map" : "trade map";

  if (roomPct === null) {
    return {
      label: "workable",
      riskPct,
      roomPct: null,
      roomToRiskRatio: null,
      line: isLongCautionEvent(event)
        ? `${linePrefix}: reclaim/invalidation distance is about ${formatPct(riskPct)}; no long target is implied`
        : `${linePrefix}: risk to invalidation is about ${formatPct(riskPct)}; next upside barrier still needs confirmation`,
    };
  }

  const roomToRiskRatio = roomPct / Math.max(riskPct, 0.0001);
  const label = ratioLabel(roomToRiskRatio);
  return {
    label,
    riskPct,
    roomPct,
    roomToRiskRatio,
    line:
      `${linePrefix}: risk to invalidation ${formatPct(riskPct)}; room to next ${tradePlan.preferredBarrierSide} ${formatPct(roomPct)} ` +
      `(~${roomToRiskRatio.toFixed(1)}x, ${label} skew)`,
  };
}

export function deriveTraderTargetContext(
  event: MonitoringEvent,
  zone?: FinalLevelZone,
  nextBarrier?: TraderNextBarrierContext | null,
): TraderTargetContext | null {
  if (event && isLongCautionEvent(event)) {
    return null;
  }

  const tradePlan = deriveDirectionalTradePlan(event, zone);
  if (!tradePlan || !nextBarrier || nextBarrier.side !== tradePlan.preferredBarrierSide) {
    return null;
  }

  const pctText = formatBarrierPct(nextBarrier.side, nextBarrier.distancePct);
  return {
    side: nextBarrier.side,
    price: nextBarrier.price,
    distancePct: nextBarrier.distancePct,
    line: `target: first upside objective ${formatLevel(nextBarrier.price)} (${pctText})`,
  };
}

function buildWatchLine(event: MonitoringEvent, zone?: FinalLevelZone): string | null {
  if (!zone) {
    return null;
  }

  const zoneLow = formatLevel(zone.zoneLow);
  const zoneHigh = formatLevel(zone.zoneHigh);
  const zoneRange = formatZoneRange(zone);

  switch (event.eventType) {
    case "breakout":
      return `watch: hold above ${zoneHigh}; invalidates back below ${zoneLow}`;
    case "breakdown":
      return `watch: long setup stays risky until price reclaims ${zoneHigh}; risk stays elevated below ${zoneLow}`;
    case "reclaim":
      return `watch: hold above ${zoneHigh}; invalidates back below ${zoneLow}`;
    case "fake_breakout":
      return `watch: long setup needs acceptance back above ${zoneHigh} before risk improves`;
    case "fake_breakdown":
      return `watch: rebound continuation above ${zoneLow}; invalidates on loss of that support`;
    case "rejection":
      return zone.kind === "resistance"
        ? `watch: long setup needs acceptance above ${zoneHigh} before risk improves`
        : `watch: buyers keep price above ${zoneLow}; invalidates on clean loss below it`;
    case "compression":
      return zone.kind === "resistance"
        ? `watch: breakout through ${zoneHigh} or rejection from ${zoneRange}`
        : `watch: bounce from ${zoneRange}; caution if ${zoneLow} fails`;
    case "level_touch":
      return zone.kind === "support"
        ? `watch: buyers defend ${zoneRange} before momentum fades`
        : `watch: buyers need acceptance above ${zoneHigh} before breakout pressure builds`;
    default:
      return null;
  }
}

export function buildTraderAlertBody(
  event: MonitoringEvent,
  zone?: FinalLevelZone,
  nextBarrier?: TraderNextBarrierContext | null,
): string {
  if (!zone) {
    return buildLeadLine(event, zone);
  }

  const roomLine = nextBarrier
    ? isLongCautionEvent(event)
      ? describeLongCautionBarrierRoom(nextBarrier)
      : describeBarrierRoom(nextBarrier)
    : null;
  const movement = deriveTraderMovementContext(event, zone);
  const pressure = deriveTraderPressureContext(event);
  const pathQuality = deriveTraderPathQualityContext(nextBarrier);
  const target = deriveTraderTargetContext(event, zone, nextBarrier);
  const triggerQuality = deriveTraderTriggerQualityContext({
    event,
    movement,
    pressure,
    nextBarrier,
  });
  const dipBuyQuality = deriveTraderDipBuyQualityContext({
    event,
    zone,
    pressure,
    nextBarrier,
  });
  const exhaustion = deriveTraderExhaustionContext(event, zone);
  const setupState = deriveTraderSetupStateContext({
    event,
    movement,
  });
  const failureRisk = deriveTraderFailureRiskContext({
    event,
    zone,
    pressure,
    triggerQuality,
    nextBarrier,
  });
  const tradeMap = deriveTraderTradeMapContext(event, zone, nextBarrier);
  const includePathQuality =
    pathQuality &&
    !(
      pathQuality.label === "clean" &&
      pathQuality.barrierCount <= 1 &&
      nextBarrier &&
      nextBarrier.clearanceLabel !== "tight" &&
      nextBarrier.clutterLabel !== "dense" &&
      nextBarrier.clutterLabel !== "stacked"
    );
  const includeTriggerQuality =
    triggerQuality &&
    !(
      triggerQuality.label === "workable" &&
      pressure.label === "moderate" &&
      movement?.label !== "extended" &&
      (!nextBarrier ||
        (nextBarrier.clearanceLabel !== "tight" &&
          nextBarrier.clutterLabel !== "dense" &&
          nextBarrier.clutterLabel !== "stacked"))
    );
  const includeFailureRisk =
    failureRisk &&
    !(
      failureRisk.label === "contained" &&
      (!pathQuality || pathQuality.label === "clean") &&
      (!triggerQuality ||
        triggerQuality.label === "clean" ||
        triggerQuality.label === "workable") &&
      (!exhaustion || exhaustion.label === "fresh" || exhaustion.label === "tested")
    );

  return [
    buildLeadLine(event, zone),
    buildWhyNowLine(event, zone),
    movement?.line ?? null,
    pressure.line,
    `context: ${describeZoneContext(event, zone)}`,
    buildTacticalReadLine({
      ...zone,
      freshness: event.eventContext.zoneFreshness,
    }),
    roomLine,
    includePathQuality ? pathQuality?.line ?? null : null,
    exhaustion?.line ?? null,
    target?.line ?? null,
    includeTriggerQuality ? triggerQuality?.line ?? null : null,
    dipBuyQuality?.line ?? null,
    setupState?.line ?? null,
    includeFailureRisk ? failureRisk?.line ?? null : null,
    tradeMap?.line ?? null,
    buildWatchLine(event, zone),
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");
}
