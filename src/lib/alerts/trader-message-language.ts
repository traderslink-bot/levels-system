// 2026-04-22 02:10 PM America/Toronto
// Trader-facing wording helpers so downstream alerts explain level quality and setup intent more clearly.

import type { FinalLevelZone } from "../levels/level-types.js";
import { deriveZoneTacticalRead } from "../levels/zone-tactical-read.js";
import type { MonitoringEvent } from "../monitoring/monitoring-types.js";
import type {
  TraderFailureRiskContext,
  TraderMovementContext,
  TraderNextBarrierContext,
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
  return `${formatLevel(zone.zoneLow)}-${formatLevel(zone.zoneHigh)}`;
}

function clearanceDirectionForSide(side: "support" | "resistance"): string {
  return side === "resistance" ? "overhead" : "downside";
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

  switch (nextBarrier.clearanceLabel) {
    case "tight":
      return `room: tight ${sideText} into next ${nextBarrier.side} ${formatLevel(nextBarrier.price)} (${pctText})`;
    case "limited":
      return `room: limited ${sideText} into next ${nextBarrier.side} ${formatLevel(nextBarrier.price)} (${pctText})`;
    case "open":
      return `room: open ${sideText} path to next ${nextBarrier.side} ${formatLevel(nextBarrier.price)} (${pctText})`;
    default:
      return `room: next ${nextBarrier.side} ${formatLevel(nextBarrier.price)} (${pctText})`;
  }
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
      line: `pressure: buying and selling pressure still look balanced (${score.toFixed(2)})`,
    };
  }

  const actor = event.bias === "bullish" ? "buyers" : "sellers";
  const direction =
    event.bias === "bullish"
      ? "backing the move"
      : "pressing the move";

  if (score >= 0.7) {
    return {
      label: "strong",
      pressureScore: score,
      line: `pressure: ${actor} still have strong control (${score.toFixed(2)}), ${direction}`,
    };
  }

  if (score >= 0.45) {
    return {
      label: "moderate",
      pressureScore: score,
      line: `pressure: ${actor} still have workable control (${score.toFixed(2)}), but follow-through still matters`,
    };
  }

  return {
    label: "tentative",
    pressureScore: score,
    line: `pressure: ${actor} are present (${score.toFixed(2)}), but control still looks tentative`,
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

  if (nextBarrier?.clearanceLabel === "tight" || pressure.label === "tentative") {
    return {
      label: "crowded",
      line: `trigger quality: crowded trigger with ${pressureText} and ${roomText}`,
    };
  }

  if (
    (movement?.label === "early" || movement?.label === "building") &&
    pressure.label === "strong"
  ) {
    return {
      label: "clean",
      line: `trigger quality: clean trigger with early participation, ${pressureText}, and ${roomText}`,
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
      return `bearish breakdown through ${descriptor} ${zoneRange}`;
    case "reclaim":
      return `reclaim back above ${descriptor} ${zoneRange}`;
    case "fake_breakout":
      return `failed breakout at ${descriptor} ${zoneRange}`;
    case "fake_breakdown":
      return `failed breakdown at ${descriptor} ${zoneRange}`;
    case "rejection":
      return zone.kind === "resistance"
        ? `sellers defended ${descriptor} ${zoneRange}`
        : `buyers defended ${descriptor} ${zoneRange}`;
    case "compression":
      return `price compressing into ${descriptor} ${zoneRange}`;
    case "level_touch":
      if (
        zone.kind === "support" &&
        (zone.strengthLabel === "strong" || zone.strengthLabel === "major")
      ) {
        return `dip-buy test at ${descriptor} ${zoneRange}`;
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
        ? "why now: price lost the outermost support instead of bouncing cleanly off it"
        : "why now: price slipped through support instead of holding the zone";
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
        ? "why now: sellers responded at resistance before breakout acceptance could build"
        : "why now: buyers responded at support before breakdown acceptance could build";
    case "compression":
      return "why now: repeated near-zone tests are tightening the range into a decision point";
    case "level_touch":
      return zone.kind === "support"
        ? "why now: price came back into defended support instead of drifting mid-range"
        : "why now: price is back at resistance where sellers need to prove control";
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
        "movement: price is still just below the zone low, so the breakdown is early",
        "movement: price is slipping farther below the zone low and downside follow-through is building",
        "movement: price is already well below the zone low and getting extended from the breakdown zone",
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
          line: `movement: price is fading below the resistance edge after the seller response (${formatPct(movementPct)})`,
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
    nextBarrier && nextBarrier.side === tradePlan.preferredBarrierSide
      ? nextBarrier.distancePct
      : null;

  if (roomPct === null) {
    return {
      label: "workable",
      riskPct,
      roomPct: null,
      roomToRiskRatio: null,
      line: `trade map: risk to invalidation is about ${formatPct(riskPct)}; next directional barrier still needs confirmation`,
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
      `trade map: risk to invalidation ${formatPct(riskPct)}; room to next ${tradePlan.preferredBarrierSide} ${formatPct(roomPct)} ` +
      `(~${roomToRiskRatio.toFixed(1)}x, ${label} skew)`,
  };
}

export function deriveTraderTargetContext(
  event: MonitoringEvent,
  zone?: FinalLevelZone,
  nextBarrier?: TraderNextBarrierContext | null,
): TraderTargetContext | null {
  const tradePlan = deriveDirectionalTradePlan(event, zone);
  if (!tradePlan || !nextBarrier || nextBarrier.side !== tradePlan.preferredBarrierSide) {
    return null;
  }

  const pctText = formatBarrierPct(nextBarrier.side, nextBarrier.distancePct);
  return {
    side: nextBarrier.side,
    price: nextBarrier.price,
    distancePct: nextBarrier.distancePct,
    line: `target: first ${nextBarrier.side} objective ${formatLevel(nextBarrier.price)} (${pctText})`,
  };
}

function buildWatchLine(event: MonitoringEvent, zone?: FinalLevelZone): string | null {
  if (!zone) {
    return null;
  }

  const zoneLow = formatLevel(zone.zoneLow);
  const zoneHigh = formatLevel(zone.zoneHigh);

  switch (event.eventType) {
    case "breakout":
      return `watch: hold above ${zoneHigh}; invalidates back below ${zoneLow}`;
    case "breakdown":
      return `watch: stay below ${zoneLow}; invalidates back above ${zoneHigh}`;
    case "reclaim":
      return `watch: hold above ${zoneHigh}; invalidates back below ${zoneLow}`;
    case "fake_breakout":
      return `watch: rejection continuation below ${zoneHigh}; invalidates on acceptance back above it`;
    case "fake_breakdown":
      return `watch: rebound continuation above ${zoneLow}; invalidates on loss of that support`;
    case "rejection":
      return zone.kind === "resistance"
        ? `watch: sellers keep price below ${zoneHigh}; invalidates on clean acceptance above it`
        : `watch: buyers keep price above ${zoneLow}; invalidates on clean loss below it`;
    case "compression":
      return zone.kind === "resistance"
        ? `watch: breakout through ${zoneHigh} or rejection from ${zoneLow}-${zoneHigh}`
        : `watch: breakdown through ${zoneLow} or bounce from ${zoneLow}-${zoneHigh}`;
    case "level_touch":
      return zone.kind === "support"
        ? `watch: buyers defend ${zoneLow}-${zoneHigh} before momentum fades`
        : `watch: sellers defend ${zoneLow}-${zoneHigh} before breakout pressure builds`;
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
    ? describeBarrierRoom(nextBarrier)
    : null;
  const movement = deriveTraderMovementContext(event, zone);
  const pressure = deriveTraderPressureContext(event);
  const target = deriveTraderTargetContext(event, zone, nextBarrier);
  const triggerQuality = deriveTraderTriggerQualityContext({
    event,
    movement,
    pressure,
    nextBarrier,
  });
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
    target?.line ?? null,
    triggerQuality?.line ?? null,
    setupState?.line ?? null,
    failureRisk?.line ?? null,
    tradeMap?.line ?? null,
    buildWatchLine(event, zone),
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");
}
