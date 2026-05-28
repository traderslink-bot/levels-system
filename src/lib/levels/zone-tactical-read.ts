import type { FinalLevelZone, LevelDataFreshness, LevelKind } from "./level-types.js";

export type ZoneTacticalRead = "firm" | "balanced" | "tired";
export type ZoneTacticalBias = "tailwind" | "neutral" | "headwind";

type ZoneTacticalEventType =
  | "level_touch"
  | "breakout"
  | "breakdown"
  | "rejection"
  | "fake_breakout"
  | "fake_breakdown"
  | "reclaim"
  | "compression";

export function deriveZoneTacticalRead(
  zone?: Pick<
    FinalLevelZone,
    "freshness" | "followThroughScore" | "reactionQualityScore" | "touchCount" | "rejectionScore"
  >,
  freshnessOverride?: LevelDataFreshness,
): ZoneTacticalRead | undefined {
  if (!zone) {
    return undefined;
  }

  const freshness = freshnessOverride ?? zone.freshness;
  const lowFollowThrough = zone.followThroughScore < 0.42;
  const lowReactionQuality = zone.reactionQualityScore < 0.58;
  const heavyRetestPressure = zone.touchCount >= 5 && zone.rejectionScore < 0.45;
  if (
    freshness === "stale" ||
    (lowFollowThrough && lowReactionQuality) ||
    heavyRetestPressure
  ) {
    return "tired";
  }

  if (
    freshness === "fresh" &&
    zone.followThroughScore >= 0.68 &&
    zone.reactionQualityScore >= 0.7 &&
    zone.rejectionScore >= 0.48
  ) {
    return "firm";
  }

  return "balanced";
}

export function resolveZoneTacticalBias(params: {
  zoneKind: LevelKind;
  eventType: ZoneTacticalEventType;
  tacticalRead?: ZoneTacticalRead;
}): ZoneTacticalBias {
  const { zoneKind, eventType, tacticalRead } = params;
  if (!tacticalRead || tacticalRead === "balanced" || eventType === "compression") {
    return "neutral";
  }

  const supportHoldEvent =
    zoneKind === "support" &&
    (eventType === "level_touch" ||
      eventType === "reclaim" ||
      eventType === "fake_breakdown");
  const supportBreakEvent = zoneKind === "support" && eventType === "breakdown";
  const resistanceHoldEvent =
    zoneKind === "resistance" &&
    (eventType === "level_touch" ||
      eventType === "rejection" ||
      eventType === "fake_breakout");
  const resistanceBreakEvent = zoneKind === "resistance" && eventType === "breakout";

  if (tacticalRead === "firm") {
    if (supportHoldEvent || resistanceHoldEvent) {
      return "tailwind";
    }
    if (supportBreakEvent || resistanceBreakEvent) {
      return "headwind";
    }
    return "neutral";
  }

  if (supportHoldEvent || resistanceHoldEvent) {
    return "headwind";
  }
  if (supportBreakEvent || resistanceBreakEvent) {
    return "tailwind";
  }

  return "neutral";
}
