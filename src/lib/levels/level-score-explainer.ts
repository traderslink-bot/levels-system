// 2026-04-17 10:04 PM America/Toronto
// Translate score drivers into trader-readable explanations that reflect real ranking inputs.

import type { RankedLevel, SourceTimeframe } from "./level-types.js";

function strongestTimeframe(timeframes: SourceTimeframe[]): SourceTimeframe {
  const order: SourceTimeframe[] = ["daily", "4h", "1h", "15m", "5m"];
  return order.find((timeframe) => timeframes.includes(timeframe)) ?? "5m";
}

function strengthLabel(score: number): string {
  if (score >= 75) {
    return "Strong";
  }
  if (score >= 55) {
    return "Solid";
  }
  if (score >= 35) {
    return "Moderate";
  }

  return "Weak";
}

function buildDriverPhrases(level: RankedLevel): string[] {
  const phrases: string[] = [];

  if (level.durabilityLabel === "reinforced") {
    phrases.push("reinforced defense history");
  } else if (level.durabilityLabel === "durable") {
    phrases.push("durable reaction history");
  } else if (level.durabilityLabel === "fragile") {
    phrases.push("fragility from repeated retests");
  }

  if (level.meaningfulTouchCount >= 3) {
    phrases.push(`${level.meaningfulTouchCount} meaningful ${level.type === "support" ? "defenses" : "rejections"}`);
  }

  if (level.reclaimCount > 0) {
    phrases.push(`${level.reclaimCount} reclaim${level.reclaimCount > 1 ? "s" : ""}`);
  } else if (level.failedBreakCount > 0) {
    phrases.push(`${level.failedBreakCount} failed break${level.failedBreakCount > 1 ? "s" : ""}`);
  }

  if (level.bestVolumeRatio >= 1.5 || level.averageVolumeRatio >= 1.3) {
    phrases.push("elevated reaction volume");
  }

  if (level.sourceTimeframes.length > 1) {
    phrases.push("multi timeframe confluence");
  }

  if (level.cleanlinessStdDevPct <= 0.0025) {
    phrases.push("clean reaction clustering");
  }

  if (level.scoreBreakdown.distanceToPriceScore >= 28) {
    phrases.push("high current proximity");
  }

  if (level.scoreBreakdown.intradayPressureScore >= 12) {
    phrases.push(`${level.type === "resistance" ? "compression into resistance" : "compression into support"}`);
  }

  return phrases;
}

export function explainLevelScore(level: RankedLevel): string {
  const timeframe = strongestTimeframe(level.sourceTimeframes);
  const durabilityDescriptor =
    level.durabilityLabel === "reinforced"
      ? "reinforced"
      : level.durabilityLabel === "durable"
        ? "durable"
        : level.durabilityLabel === "fragile"
          ? "fragile"
          : null;
  const statePrefix =
    level.state === "broken"
      ? "Previously strong"
      : level.state === "reclaimed"
        ? "Recovered"
        : level.state === "flipped"
          ? "Flipped"
          : level.state === "weakened"
            ? "Previously solid"
            : strengthLabel(level.score);
  const drivers = buildDriverPhrases(level);

  if (level.state === "broken") {
    return `${statePrefix} ${durabilityDescriptor ? `${durabilityDescriptor} ` : ""}${timeframe} ${level.type} now broken after ${level.cleanBreakCount} clean break${level.cleanBreakCount === 1 ? "" : "s"}`;
  }

  if (level.state === "reclaimed") {
    return `${statePrefix} ${durabilityDescriptor ? `${durabilityDescriptor} ` : ""}${timeframe} ${level.type} after ${level.reclaimCount} reclaim${level.reclaimCount === 1 ? "" : "s"} and renewed defense`;
  }

  if (level.state === "weakened") {
    return `${statePrefix} ${durabilityDescriptor ? `${durabilityDescriptor} ` : ""}${timeframe} ${level.type} now weakened after repeated shallow tests`;
  }

  if (level.state === "flipped") {
    return `${statePrefix} ${durabilityDescriptor ? `${durabilityDescriptor} ` : ""}${timeframe} ${level.type} with role-flip history and active defense`;
  }

  if (drivers.length === 0) {
    return `${statePrefix} ${durabilityDescriptor ? `${durabilityDescriptor} ` : ""}${timeframe} ${level.type} with limited confirmed reaction quality`;
  }

  return `${statePrefix} ${durabilityDescriptor ? `${durabilityDescriptor} ` : ""}${timeframe} ${level.type} with ${drivers.slice(0, 2).join(" and ")}`;
}
