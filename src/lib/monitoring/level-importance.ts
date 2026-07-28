import type { FinalLevelZone } from "../levels/level-types.js";
import type { LevelSnapshotDisplayZone } from "../alerts/alert-types.js";

export type LevelImportanceLabel =
  | "major_decision"
  | "active_trade_boundary"
  | "useful_reference"
  | "minor_noise"
  | "extension_context"
  | "unknown";

export type LevelImportanceContext = {
  label: LevelImportanceLabel;
  score: number;
  reasons: string[];
};

type AssessParams = {
  price: number;
  side: "support" | "resistance";
  strengthLabel?: FinalLevelZone["strengthLabel"];
  sourceLabel?: string;
  timeframeBias?: FinalLevelZone["timeframeBias"];
  timeframeSources?: FinalLevelZone["timeframeSources"];
  zoneCount?: number;
  isExtension?: boolean;
  lowPrice?: number;
  highPrice?: number;
  representativePrice: number;
};

function strengthScore(strength?: FinalLevelZone["strengthLabel"]): number {
  switch (strength) {
    case "major":
      return 38;
    case "strong":
      return 30;
    case "moderate":
      return 20;
    case "weak":
      return 8;
    default:
      return 0;
  }
}

function timeframeScore(params: AssessParams): number {
  const sourceText = [
    params.sourceLabel,
    params.timeframeBias,
    ...(params.timeframeSources ?? []),
  ].filter(Boolean).join(" ").toLowerCase();
  let score = 0;
  if (sourceText.includes("daily")) {
    score += 28;
  }
  if (sourceText.includes("4h")) {
    score += 18;
  }
  if (sourceText.includes("confluence") || params.timeframeBias === "mixed") {
    score += 16;
  }
  if (sourceText.includes("fresh intraday") || params.timeframeBias === "5m") {
    score += 6;
  }
  return score;
}

function distanceScore(params: AssessParams): number {
  const level = params.side === "support"
    ? Math.max(params.highPrice ?? params.representativePrice, params.representativePrice)
    : Math.min(params.lowPrice ?? params.representativePrice, params.representativePrice);
  const distancePct = Math.abs(level - params.price) / Math.max(Math.abs(params.price), 0.0001);
  if (distancePct <= 0.04) {
    return 16;
  }
  if (distancePct <= 0.12) {
    return 10;
  }
  if (distancePct <= 0.35) {
    return 5;
  }
  return 0;
}

function smallCapNoisePenalty(params: AssessParams): number {
  const levelLow = params.lowPrice ?? params.representativePrice;
  const levelHigh = params.highPrice ?? params.representativePrice;
  const widthPct = Math.abs(levelHigh - levelLow) / Math.max(Math.min(levelLow, levelHigh), 0.0001);
  const distancePct = Math.abs(params.representativePrice - params.price) / Math.max(Math.abs(params.price), 0.0001);
  const isTinyPrice = params.price < 2;
  const isWeakIntraday =
    params.strengthLabel === "weak" &&
    (params.sourceLabel?.toLowerCase().includes("intraday") || params.timeframeBias === "5m");
  if (isTinyPrice && isWeakIntraday && distancePct <= 0.02 && widthPct <= 0.01) {
    return 18;
  }
  if (isTinyPrice && isWeakIntraday) {
    return 10;
  }
  return 0;
}

export function assessLevelImportance(params: AssessParams): LevelImportanceContext {
  const reasons: string[] = [];
  let score = strengthScore(params.strengthLabel);
  if (score > 0) {
    reasons.push(`${params.strengthLabel ?? "unknown"} strength`);
  }

  const tfScore = timeframeScore(params);
  score += tfScore;
  if (tfScore >= 28) {
    reasons.push("higher-timeframe evidence");
  } else if (tfScore > 0) {
    reasons.push("intraday/structure evidence");
  }

  const distScore = distanceScore(params);
  score += distScore;
  if (distScore >= 10) {
    reasons.push("near current trade area");
  }

  const zoneCount = params.zoneCount ?? 1;
  if (zoneCount >= 2) {
    score += 14;
    reasons.push("clustered practical area");
  }

  if (params.isExtension) {
    score -= 12;
    reasons.push("extension context");
  }

  const noisePenalty = smallCapNoisePenalty(params);
  score -= noisePenalty;
  if (noisePenalty > 0) {
    reasons.push("small-cap minor flicker risk");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  let label: LevelImportanceLabel = "unknown";
  if (params.isExtension && score < 45) {
    label = "extension_context";
  } else if (score >= 72) {
    label = "major_decision";
  } else if (score >= 52) {
    label = "active_trade_boundary";
  } else if (score >= 28) {
    label = "useful_reference";
  } else if (score > 0) {
    label = "minor_noise";
  }

  return { label, score, reasons };
}

export function assessFinalLevelImportance(params: {
  zone: FinalLevelZone;
  price: number;
  side?: "support" | "resistance";
}): LevelImportanceContext {
  return assessLevelImportance({
    price: params.price,
    side: params.side ?? params.zone.kind,
    strengthLabel: params.zone.strengthLabel,
    sourceLabel: params.zone.timeframeBias,
    timeframeBias: params.zone.timeframeBias,
    timeframeSources: params.zone.timeframeSources,
    zoneCount: params.zone.confluenceCount,
    isExtension: params.zone.isExtension,
    lowPrice: Math.min(params.zone.zoneLow, params.zone.zoneHigh, params.zone.representativePrice),
    highPrice: Math.max(params.zone.zoneLow, params.zone.zoneHigh, params.zone.representativePrice),
    representativePrice: params.zone.representativePrice,
  });
}

export function assessSnapshotDisplayLevelImportance(params: {
  zone: LevelSnapshotDisplayZone;
  price: number;
  side: "support" | "resistance";
  zoneCount?: number;
}): LevelImportanceContext {
  return assessLevelImportance({
    price: params.price,
    side: params.side,
    strengthLabel: params.zone.strengthLabel,
    sourceLabel: params.zone.sourceLabel,
    zoneCount: params.zoneCount,
    isExtension: params.zone.isExtension,
    lowPrice: params.zone.lowPrice,
    highPrice: params.zone.highPrice,
    representativePrice: params.zone.representativePrice,
  });
}

