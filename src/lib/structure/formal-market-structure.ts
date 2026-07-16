import type { Candle } from "../market-data/candle-types.js";
import { filterCandlesByCloseAsOf } from "../market-data/candle-as-of-filter.js";

export type FormalStructureTimeframe = "5m" | "4h" | "daily";
export type FormalStructureBias =
  | "bullish"
  | "bearish"
  | "bullish_transition"
  | "bearish_transition"
  | "range"
  | "unknown";
export type FormalStructureEventType =
  | "bos_bullish"
  | "bos_bearish"
  | "choch_bullish"
  | "choch_bearish"
  | "liquidity_sweep_high"
  | "liquidity_sweep_low"
  | "failed_break_high"
  | "failed_break_low"
  | "none";
export type FormalSwingKind = "high" | "low";
export type FormalSwingLabel = "HH" | "HL" | "LH" | "LL" | "EH" | "EL" | "H" | "L";
export type FormalSwingScope = "internal" | "external";
export type FormalBreakConfirmation =
  | "close_confirmed"
  | "displacement_confirmed"
  | "follow_through_confirmed"
  | "wick_only"
  | "failed"
  | "none";
export type FormalStructureConfidenceLabel = "low" | "medium" | "high";

export interface FormalMarketStructureDiagnostic {
  code: string;
  message: string;
}

export interface FormalMarketStructureOptions {
  minCandles?: number;
  internalLeftBars?: number;
  internalRightBars?: number;
  externalLeftBars?: number;
  externalRightBars?: number;
  equalLevelTolerancePct?: number;
  displacementRangeMultiplier?: number;
  followThroughBars?: number;
}

export interface FormalStructureSwing {
  id: string;
  timeframe: FormalStructureTimeframe;
  kind: FormalSwingKind;
  scope: FormalSwingScope;
  label: FormalSwingLabel;
  price: number;
  timestamp: string;
  candleIndex: number;
  confirmedAt: string;
  moveStrengthPct: number;
}

export interface FormalStructureEvent {
  type: FormalStructureEventType;
  timeframe: FormalStructureTimeframe;
  biasBefore: FormalStructureBias;
  biasAfter: FormalStructureBias;
  triggerTimestamp: string | null;
  triggerClose: number | null;
  brokenSwingId: string | null;
  brokenSwingPrice: number | null;
  sweptSwingId: string | null;
  sweptSwingPrice: number | null;
  protectedHighId: string | null;
  protectedHighPrice: number | null;
  protectedLowId: string | null;
  protectedLowPrice: number | null;
  confirmation: FormalBreakConfirmation;
  closeBeyondPct: number;
  confidenceScore: number;
  confidence: FormalStructureConfidenceLabel;
  reasonCodes: string[];
  traderLine: string;
}

export type FormalLivePricePressureType =
  | "above_protected_high"
  | "below_protected_low"
  | "testing_protected_high"
  | "testing_protected_low";

export interface FormalLivePricePressure {
  type: FormalLivePricePressureType;
  timeframe: FormalStructureTimeframe;
  currentPrice: number;
  levelPrice: number;
  levelId: string;
  distanceFromLevelPct: number;
  confirmation: "unconfirmed_live_price";
  traderLine: string;
}

export interface FormalMarketStructureContext {
  symbol: string;
  timeframe: FormalStructureTimeframe;
  candleCount: number;
  evaluatedAt: string | null;
  bias: FormalStructureBias;
  previousBias: FormalStructureBias | null;
  swings: FormalStructureSwing[];
  internalSwings: FormalStructureSwing[];
  externalSwings: FormalStructureSwing[];
  latestHigh: FormalStructureSwing | null;
  latestLow: FormalStructureSwing | null;
  protectedHigh: FormalStructureSwing | null;
  protectedLow: FormalStructureSwing | null;
  latestEvent: FormalStructureEvent;
  livePricePressure: FormalLivePricePressure | null;
  diagnostics: FormalMarketStructureDiagnostic[];
}

export interface BuildFormalMarketStructureRequest {
  symbol: string;
  candles: Candle[];
  timeframe?: FormalStructureTimeframe;
  asOfTimestamp?: number | string | Date;
  currentPrice?: number;
  options?: FormalMarketStructureOptions;
}

interface ResolvedFormalMarketStructureOptions {
  minCandles: number;
  internalLeftBars: number;
  internalRightBars: number;
  externalLeftBars: number;
  externalRightBars: number;
  equalLevelTolerancePct: number;
  displacementRangeMultiplier: number;
  followThroughBars: number;
}

interface SwingAnalysis {
  swings: FormalStructureSwing[];
  internalSwings: FormalStructureSwing[];
  externalSwings: FormalStructureSwing[];
  latestHigh: FormalStructureSwing | null;
  latestLow: FormalStructureSwing | null;
  protectedHigh: FormalStructureSwing | null;
  protectedLow: FormalStructureSwing | null;
  bias: FormalStructureBias;
  diagnostics: FormalMarketStructureDiagnostic[];
}

const DEFAULT_MIN_CANDLES = 24;
const DEFAULT_INTERNAL_LEFT_BARS = 2;
const DEFAULT_INTERNAL_RIGHT_BARS = 2;
const DEFAULT_EXTERNAL_LEFT_BARS = 4;
const DEFAULT_EXTERNAL_RIGHT_BARS = 4;
const DEFAULT_EQUAL_LEVEL_TOLERANCE_PCT = 0.004;
const DEFAULT_DISPLACEMENT_RANGE_MULTIPLIER = 0.6;
const DEFAULT_FOLLOW_THROUGH_BARS = 2;

function resolveOptions(options?: FormalMarketStructureOptions): ResolvedFormalMarketStructureOptions {
  return {
    minCandles: Math.max(6, Math.floor(options?.minCandles ?? DEFAULT_MIN_CANDLES)),
    internalLeftBars: Math.max(1, Math.floor(options?.internalLeftBars ?? DEFAULT_INTERNAL_LEFT_BARS)),
    internalRightBars: Math.max(1, Math.floor(options?.internalRightBars ?? DEFAULT_INTERNAL_RIGHT_BARS)),
    externalLeftBars: Math.max(1, Math.floor(options?.externalLeftBars ?? DEFAULT_EXTERNAL_LEFT_BARS)),
    externalRightBars: Math.max(1, Math.floor(options?.externalRightBars ?? DEFAULT_EXTERNAL_RIGHT_BARS)),
    equalLevelTolerancePct: Math.max(0.0001, options?.equalLevelTolerancePct ?? DEFAULT_EQUAL_LEVEL_TOLERANCE_PCT),
    displacementRangeMultiplier: Math.max(
      0,
      options?.displacementRangeMultiplier ?? DEFAULT_DISPLACEMENT_RANGE_MULTIPLIER,
    ),
    followThroughBars: Math.max(1, Math.floor(options?.followThroughBars ?? DEFAULT_FOLLOW_THROUGH_BARS)),
  };
}

function parseTimestamp(value: Date | string | number): number {
  const parsed = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function timestampToIso(value: Date | string | number): string {
  const parsed = parseTimestamp(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date(0).toISOString();
}

function sortedUsableCandles(
  candles: Candle[],
  timeframe: FormalStructureTimeframe,
  asOfTimestamp?: number,
): {
  candles: Candle[];
  diagnostics: FormalMarketStructureDiagnostic[];
} {
  const usable = candles
    .filter((candle) => {
      const parsed = parseTimestamp(candle.timestamp);
      return (
        Number.isFinite(parsed) &&
        Number.isFinite(candle.open) &&
        Number.isFinite(candle.high) &&
        Number.isFinite(candle.low) &&
        Number.isFinite(candle.close) &&
        candle.high >= candle.low
      );
    })
    .slice()
    .sort((a, b) => parseTimestamp(a.timestamp) - parseTimestamp(b.timestamp));
  const filtered = filterCandlesByCloseAsOf({
    candles: usable,
    timeframe,
    asOfTimestamp,
  });
  return {
    candles: filtered.candles,
    diagnostics: filtered.diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      message: diagnostic.message,
    })),
  };
}

function roundPrice(price: number | null | undefined): number | null {
  if (!Number.isFinite(price ?? Number.NaN)) return null;
  return Math.round((price as number) * 10000) / 10000;
}

function formatPrice(price: number | null | undefined): string {
  const rounded = roundPrice(price);
  if (rounded === null) return "n/a";
  if (Math.abs(rounded) >= 100) return rounded.toFixed(2);
  if (Math.abs(rounded) >= 10) return rounded.toFixed(3);
  return rounded.toFixed(4);
}

function median(values: number[]): number {
  const finiteValues = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (finiteValues.length === 0) return 0;
  const middle = Math.floor(finiteValues.length / 2);
  if (finiteValues.length % 2 === 0) {
    return (finiteValues[middle - 1]! + finiteValues[middle]!) / 2;
  }
  return finiteValues[middle]!;
}

function medianCandleRange(candles: Candle[]): number {
  return median(candles.map((candle) => Math.max(0, candle.high - candle.low)));
}

function equalLevelTolerance(price: number, options: ResolvedFormalMarketStructureOptions): number {
  return Math.max(Math.abs(price) * options.equalLevelTolerancePct, 0.0001);
}

function breakToleranceForPrice(price: number, options: ResolvedFormalMarketStructureOptions): number {
  return Math.max(Math.abs(price) * (options.equalLevelTolerancePct * 0.5), 0.0001);
}

function closeBeyondPct(close: number, level: number): number {
  if (!Number.isFinite(close) || !Number.isFinite(level) || level === 0) return 0;
  return Math.abs(close - level) / Math.abs(level);
}

function localMoveStrengthPct(candles: Candle[], index: number): number {
  const candle = candles[index];
  if (!candle) return 0;
  const left = candles[index - 1];
  const right = candles[index + 1];
  const nearestOpposite = candle.high - candle.low;
  const nearbyRange =
    (left ? Math.max(left.high - left.low, 0) : 0) +
    Math.max(candle.high - candle.low, 0) +
    (right ? Math.max(right.high - right.low, 0) : 0);
  const denominator = Math.max(Math.abs(candle.close), Math.abs(candle.high), Math.abs(candle.low), 0.0001);
  return Math.max(nearestOpposite, nearbyRange / 3) / denominator;
}

function isPivotHigh(candles: Candle[], index: number, leftBars: number, rightBars: number): boolean {
  const candle = candles[index];
  if (!candle) return false;
  for (let offset = 1; offset <= leftBars; offset += 1) {
    if (!candles[index - offset] || candles[index - offset]!.high >= candle.high) return false;
  }
  for (let offset = 1; offset <= rightBars; offset += 1) {
    if (!candles[index + offset] || candles[index + offset]!.high > candle.high) return false;
  }
  return true;
}

function isPivotLow(candles: Candle[], index: number, leftBars: number, rightBars: number): boolean {
  const candle = candles[index];
  if (!candle) return false;
  for (let offset = 1; offset <= leftBars; offset += 1) {
    if (!candles[index - offset] || candles[index - offset]!.low <= candle.low) return false;
  }
  for (let offset = 1; offset <= rightBars; offset += 1) {
    if (!candles[index + offset] || candles[index + offset]!.low < candle.low) return false;
  }
  return true;
}

function classifyLabel(
  kind: FormalSwingKind,
  price: number,
  previousSameKind: FormalStructureSwing | null,
  options: ResolvedFormalMarketStructureOptions,
): FormalSwingLabel {
  if (!previousSameKind) return kind === "high" ? "H" : "L";
  const tolerance = equalLevelTolerance(previousSameKind.price, options);
  if (kind === "high") {
    if (price > previousSameKind.price + tolerance) return "HH";
    if (price < previousSameKind.price - tolerance) return "LH";
    return "EH";
  }
  if (price < previousSameKind.price - tolerance) return "LL";
  if (price > previousSameKind.price + tolerance) return "HL";
  return "EL";
}

function buildScopedSwings(
  symbol: string,
  timeframe: FormalStructureTimeframe,
  candles: Candle[],
  scope: FormalSwingScope,
  leftBars: number,
  rightBars: number,
  options: ResolvedFormalMarketStructureOptions,
): FormalStructureSwing[] {
  const swings: FormalStructureSwing[] = [];
  let previousHigh: FormalStructureSwing | null = null;
  let previousLow: FormalStructureSwing | null = null;

  for (let index = leftBars; index < candles.length - rightBars; index += 1) {
    const candle = candles[index]!;
    const confirmedAt = candles[index + rightBars]!;
    const highPivot = isPivotHigh(candles, index, leftBars, rightBars);
    const lowPivot = isPivotLow(candles, index, leftBars, rightBars);

    if (highPivot) {
      const label = classifyLabel("high", candle.high, previousHigh, options);
      const swing: FormalStructureSwing = {
        id: `${symbol}:${timeframe}:${scope}:high:${timestampToIso(candle.timestamp)}`,
        timeframe,
        kind: "high",
        scope,
        label,
        price: candle.high,
        timestamp: timestampToIso(candle.timestamp),
        candleIndex: index,
        confirmedAt: timestampToIso(confirmedAt.timestamp),
        moveStrengthPct: localMoveStrengthPct(candles, index),
      };
      swings.push(swing);
      previousHigh = swing;
    }

    if (lowPivot) {
      const label = classifyLabel("low", candle.low, previousLow, options);
      const swing: FormalStructureSwing = {
        id: `${symbol}:${timeframe}:${scope}:low:${timestampToIso(candle.timestamp)}`,
        timeframe,
        kind: "low",
        scope,
        label,
        price: candle.low,
        timestamp: timestampToIso(candle.timestamp),
        candleIndex: index,
        confirmedAt: timestampToIso(confirmedAt.timestamp),
        moveStrengthPct: localMoveStrengthPct(candles, index),
      };
      swings.push(swing);
      previousLow = swing;
    }
  }

  return swings.sort((a, b) => a.candleIndex - b.candleIndex || (a.kind === "high" ? -1 : 1));
}

function mergeSwings(internalSwings: FormalStructureSwing[], externalSwings: FormalStructureSwing[]): FormalStructureSwing[] {
  const byKey = new Map<string, FormalStructureSwing>();
  for (const swing of internalSwings) {
    byKey.set(`${swing.kind}:${swing.timestamp}`, swing);
  }
  for (const swing of externalSwings) {
    byKey.set(`${swing.kind}:${swing.timestamp}`, swing);
  }
  return Array.from(byKey.values()).sort((a, b) => a.candleIndex - b.candleIndex || (a.kind === "high" ? -1 : 1));
}

function mostRecentSwing(swings: FormalStructureSwing[], kind: FormalSwingKind): FormalStructureSwing | null {
  for (let index = swings.length - 1; index >= 0; index -= 1) {
    const swing = swings[index]!;
    if (swing.kind === kind) return swing;
  }
  return null;
}

function latestByLabels(swings: FormalStructureSwing[], kind: FormalSwingKind, labels: FormalSwingLabel[]): FormalStructureSwing | null {
  const allowed = new Set(labels);
  for (let index = swings.length - 1; index >= 0; index -= 1) {
    const swing = swings[index]!;
    if (swing.kind === kind && allowed.has(swing.label)) return swing;
  }
  return null;
}

function boundarySwing(swings: FormalStructureSwing[], kind: FormalSwingKind): FormalStructureSwing | null {
  const sameKind = swings.filter((swing) => swing.kind === kind);
  if (sameKind.length === 0) return null;
  return sameKind.reduce((best, swing) => {
    if (kind === "high") {
      if (swing.price > best.price) return swing;
      if (swing.price === best.price && swing.candleIndex > best.candleIndex) return swing;
      return best;
    }
    if (swing.price < best.price) return swing;
    if (swing.price === best.price && swing.candleIndex > best.candleIndex) return swing;
    return best;
  });
}

function deriveBias(scopedSwings: FormalStructureSwing[]): FormalStructureBias {
  const recent = scopedSwings.slice(-8);
  const highLabels = new Set(recent.filter((swing) => swing.kind === "high").map((swing) => swing.label));
  const lowLabels = new Set(recent.filter((swing) => swing.kind === "low").map((swing) => swing.label));
  const bullishSignals = Number(highLabels.has("HH")) + Number(lowLabels.has("HL"));
  const bearishSignals = Number(highLabels.has("LH")) + Number(lowLabels.has("LL"));
  const equalSignals =
    Number(highLabels.has("EH")) +
    Number(lowLabels.has("EL")) +
    Number(highLabels.has("H")) +
    Number(lowLabels.has("L"));

  if (recent.length < 4) return "unknown";
  if (bullishSignals >= 2 && bearishSignals === 0) return "bullish";
  if (bearishSignals >= 2 && bullishSignals === 0) return "bearish";
  if (bullishSignals >= 1 && bearishSignals === 0) return "bullish_transition";
  if (bearishSignals >= 1 && bullishSignals === 0) return "bearish_transition";
  if (bullishSignals > 0 && bearishSignals > 0) return "range";
  if (equalSignals >= 2) return "range";
  return "unknown";
}

function structuralSwingsForBias(analysis: SwingAnalysis): FormalStructureSwing[] {
  return analysis.externalSwings.length >= 4 ? analysis.externalSwings : analysis.internalSwings;
}

function deriveSwingAnalysis(
  symbol: string,
  timeframe: FormalStructureTimeframe,
  candles: Candle[],
  options: ResolvedFormalMarketStructureOptions,
): SwingAnalysis {
  const internalSwings = buildScopedSwings(
    symbol,
    timeframe,
    candles,
    "internal",
    options.internalLeftBars,
    options.internalRightBars,
    options,
  );
  const externalSwings = buildScopedSwings(
    symbol,
    timeframe,
    candles,
    "external",
    options.externalLeftBars,
    options.externalRightBars,
    options,
  );
  const swings = mergeSwings(internalSwings, externalSwings);
  const biasScope = externalSwings.length >= 4 ? externalSwings : internalSwings;
  const bias = deriveBias(biasScope);
  const analysis: SwingAnalysis = {
    swings,
    internalSwings,
    externalSwings,
    latestHigh: mostRecentSwing(swings, "high"),
    latestLow: mostRecentSwing(swings, "low"),
    protectedHigh: null,
    protectedLow: null,
    bias,
    diagnostics: [],
  };

  if (bias === "bullish" || bias === "bullish_transition") {
    analysis.protectedLow =
      latestByLabels(externalSwings, "low", ["HL"]) ??
      latestByLabels(internalSwings, "low", ["HL"]) ??
      mostRecentSwing(swings, "low");
    analysis.protectedHigh = mostRecentSwing(swings, "high");
  } else if (bias === "bearish" || bias === "bearish_transition") {
    analysis.protectedHigh =
      latestByLabels(externalSwings, "high", ["LH"]) ??
      latestByLabels(internalSwings, "high", ["LH"]) ??
      mostRecentSwing(swings, "high");
    analysis.protectedLow = mostRecentSwing(swings, "low");
  } else {
    analysis.protectedHigh = mostRecentSwing(swings, "high");
    analysis.protectedLow = mostRecentSwing(swings, "low");
  }

  if (externalSwings.length < 4 && internalSwings.length >= 4) {
    analysis.diagnostics.push({
      code: "internal_fallback",
      message: "External swing sequence is not mature enough; internal pivots are carrying the current structure read.",
    });
  }
  if (swings.length < 4) {
    analysis.diagnostics.push({
      code: "insufficient_swings",
      message: "Not enough confirmed pivots to produce a strong formal structure read.",
    });
  }

  return analysis;
}

function isBullishBreak(candle: Candle, level: number, options: ResolvedFormalMarketStructureOptions): boolean {
  return candle.close > level + breakToleranceForPrice(level, options);
}

function isBearishBreak(candle: Candle, level: number, options: ResolvedFormalMarketStructureOptions): boolean {
  return candle.close < level - breakToleranceForPrice(level, options);
}

function isBullishSweep(candle: Candle, level: number, options: ResolvedFormalMarketStructureOptions): boolean {
  const tolerance = breakToleranceForPrice(level, options);
  return candle.high > level + tolerance && candle.close <= level + tolerance;
}

function isBearishSweep(candle: Candle, level: number, options: ResolvedFormalMarketStructureOptions): boolean {
  const tolerance = breakToleranceForPrice(level, options);
  return candle.low < level - tolerance && candle.close >= level - tolerance;
}

function confirmedFollowThrough(
  candles: Candle[],
  level: number,
  direction: "bullish" | "bearish",
  options: ResolvedFormalMarketStructureOptions,
): boolean {
  if (candles.length < options.followThroughBars) return false;
  const recent = candles.slice(-options.followThroughBars);
  return recent.every((candle) =>
    direction === "bullish" ? isBullishBreak(candle, level, options) : isBearishBreak(candle, level, options),
  );
}

function breakConfirmation(
  candles: Candle[],
  evaluationCandle: Candle,
  level: number,
  direction: "bullish" | "bearish",
  options: ResolvedFormalMarketStructureOptions,
): FormalBreakConfirmation {
  if (confirmedFollowThrough(candles, level, direction, options)) return "follow_through_confirmed";
  const medianRange = medianCandleRange(candles.slice(-Math.max(8, options.minCandles)));
  const beyond = Math.abs(evaluationCandle.close - level);
  if (medianRange > 0 && beyond >= medianRange * options.displacementRangeMultiplier) {
    return "displacement_confirmed";
  }
  return "close_confirmed";
}

function confirmationReasons(confirmation: FormalBreakConfirmation): string[] {
  if (confirmation === "follow_through_confirmed") return ["follow_through_confirmed"];
  if (confirmation === "displacement_confirmed") return ["displacement_confirmed"];
  if (confirmation === "close_confirmed") return ["close_confirmed"];
  if (confirmation === "wick_only") return ["wick_only"];
  if (confirmation === "failed") return ["failed_break"];
  return [];
}

function confidenceFromScore(score: number): FormalStructureConfidenceLabel {
  if (score >= 0.72) return "high";
  if (score >= 0.42) return "medium";
  return "low";
}

function eventConfidence(
  type: FormalStructureEventType,
  analysis: SwingAnalysis,
  brokenOrSweptSwing: FormalStructureSwing | null,
  confirmation: FormalBreakConfirmation,
  baseReasons: string[],
  options: ResolvedFormalMarketStructureOptions,
  candles: Candle[],
): { score: number; label: FormalStructureConfidenceLabel } {
  if (type === "none") return { score: 0.15, label: "low" };
  let score = 0.25;

  if (type.startsWith("bos_") || type.startsWith("choch_")) score += 0.12;
  if (type.startsWith("choch_")) score += 0.08;
  if (brokenOrSweptSwing?.scope === "external") score += 0.16;
  if (brokenOrSweptSwing?.scope === "internal") score += 0.08;
  if (analysis.externalSwings.length >= 4) score += 0.1;
  if (analysis.swings.length >= 6) score += 0.08;
  if (confirmation === "follow_through_confirmed") score += 0.18;
  if (confirmation === "displacement_confirmed") score += 0.12;
  if (confirmation === "close_confirmed") score += 0.06;
  if (analysis.bias === "bullish" || analysis.bias === "bearish") score += 0.08;
  if (analysis.protectedHigh && analysis.protectedLow) score += 0.06;
  if (candles.length >= options.minCandles * 1.5) score += 0.04;

  if (baseReasons.includes("internal_fallback")) score -= 0.08;
  if (baseReasons.includes("range_break_initial_bias")) score -= 0.08;
  if (analysis.bias === "range" || analysis.bias === "unknown") score -= 0.08;
  if (confirmation === "wick_only" || confirmation === "failed") score -= 0.06;

  score = Math.max(0.05, Math.min(0.94, score));
  if (baseReasons.includes("range_break_initial_bias")) {
    score = Math.min(score, 0.64);
  }
  return { score, label: confidenceFromScore(score) };
}

function timeframeLabel(timeframe: FormalStructureTimeframe): string {
  if (timeframe === "daily") return "daily";
  return timeframe;
}

function biasAfterEvent(type: FormalStructureEventType, priorBias: FormalStructureBias): FormalStructureBias {
  if (type === "bos_bullish") return priorBias === "range" || priorBias === "unknown" ? "bullish_transition" : "bullish";
  if (type === "bos_bearish") return priorBias === "range" || priorBias === "unknown" ? "bearish_transition" : "bearish";
  if (type === "choch_bullish") return "bullish_transition";
  if (type === "choch_bearish") return "bearish_transition";
  return priorBias;
}

function traderLineForEvent(
  type: FormalStructureEventType,
  timeframe: FormalStructureTimeframe,
  level: number | null,
  protectedHigh: FormalStructureSwing | null,
  protectedLow: FormalStructureSwing | null,
  reasons: string[],
): string {
  const tf = timeframeLabel(timeframe);
  if (type === "bos_bullish") {
    if (reasons.includes("range_break_initial_bias")) {
      return `${tf} structure made an initial range expansion above ${formatPrice(level)}; it still needs follow-through before treating it like established trend continuation.`;
    }
    return `${tf} structure printed bullish BOS above ${formatPrice(level)}; ${formatPrice(
      protectedLow?.price,
    )} is the protected structure low.`;
  }
  if (type === "bos_bearish") {
    if (reasons.includes("range_break_initial_bias")) {
      return `${tf} structure made an initial range expansion below ${formatPrice(level)}; it still needs follow-through before treating it like established trend continuation.`;
    }
    return `${tf} structure printed bearish BOS below ${formatPrice(level)}; ${formatPrice(
      protectedHigh?.price,
    )} is the protected structure high.`;
  }
  if (type === "choch_bullish") {
    return `${tf} structure printed bullish CHOCH above ${formatPrice(level)}; sellers lost the protected high.`;
  }
  if (type === "choch_bearish") {
    return `${tf} structure printed bearish CHOCH below ${formatPrice(level)}; buyers need a reclaim to repair the setup.`;
  }
  if (type === "liquidity_sweep_high") {
    return `${tf} structure swept the prior high near ${formatPrice(level)} but closed back inside; watch for failed upside continuation.`;
  }
  if (type === "liquidity_sweep_low") {
    return `${tf} structure swept the prior low near ${formatPrice(level)} but closed back inside; watch for failed downside continuation.`;
  }
  if (type === "failed_break_high") {
    return `${tf} structure failed to hold above ${formatPrice(level)}; upside break needs a fresh close to confirm.`;
  }
  if (type === "failed_break_low") {
    return `${tf} structure failed to hold below ${formatPrice(level)}; downside break needs a fresh close to confirm.`;
  }
  return `${tf} structure has no confirmed BOS or CHOCH on the latest completed candle.`;
}

function livePressureTraderLine(
  type: FormalLivePricePressureType,
  timeframe: FormalStructureTimeframe,
  currentPrice: number,
  levelPrice: number,
): string {
  const tf = timeframeLabel(timeframe);
  if (type === "above_protected_high") {
    return `live price ${formatPrice(currentPrice)} is above protected high ${formatPrice(levelPrice)} before the ${tf} candle has confirmed.`;
  }
  if (type === "below_protected_low") {
    return `live price ${formatPrice(currentPrice)} is below protected low ${formatPrice(levelPrice)} before the ${tf} candle has confirmed.`;
  }
  if (type === "testing_protected_high") {
    return `live price ${formatPrice(currentPrice)} is testing protected high ${formatPrice(levelPrice)} before the ${tf} candle has confirmed.`;
  }
  return `live price ${formatPrice(currentPrice)} is testing protected low ${formatPrice(levelPrice)} before the ${tf} candle has confirmed.`;
}

function buildLivePricePressure(params: {
  timeframe: FormalStructureTimeframe;
  currentPrice: number | undefined;
  protectedHigh: FormalStructureSwing | null;
  protectedLow: FormalStructureSwing | null;
  options: ResolvedFormalMarketStructureOptions;
}): FormalLivePricePressure | null {
  const currentPrice = params.currentPrice;
  if (!Number.isFinite(currentPrice ?? Number.NaN) || (currentPrice ?? 0) <= 0) {
    return null;
  }
  const livePrice = currentPrice as number;

  const protectedHigh = params.protectedHigh;
  if (protectedHigh) {
    const breakTolerance = breakToleranceForPrice(protectedHigh.price, params.options);
    const testTolerance = Math.max(equalLevelTolerance(protectedHigh.price, params.options), breakTolerance * 2);
    const distanceFromLevelPct = closeBeyondPct(livePrice, protectedHigh.price);
    if (livePrice > protectedHigh.price + breakTolerance) {
      return {
        type: "above_protected_high",
        timeframe: params.timeframe,
        currentPrice: roundPrice(livePrice) ?? livePrice,
        levelPrice: roundPrice(protectedHigh.price) ?? protectedHigh.price,
        levelId: protectedHigh.id,
        distanceFromLevelPct,
        confirmation: "unconfirmed_live_price",
        traderLine: livePressureTraderLine(
          "above_protected_high",
          params.timeframe,
          livePrice,
          protectedHigh.price,
        ),
      };
    }
    if (Math.abs(livePrice - protectedHigh.price) <= testTolerance) {
      return {
        type: "testing_protected_high",
        timeframe: params.timeframe,
        currentPrice: roundPrice(livePrice) ?? livePrice,
        levelPrice: roundPrice(protectedHigh.price) ?? protectedHigh.price,
        levelId: protectedHigh.id,
        distanceFromLevelPct,
        confirmation: "unconfirmed_live_price",
        traderLine: livePressureTraderLine(
          "testing_protected_high",
          params.timeframe,
          livePrice,
          protectedHigh.price,
        ),
      };
    }
  }

  const protectedLow = params.protectedLow;
  if (protectedLow) {
    const breakTolerance = breakToleranceForPrice(protectedLow.price, params.options);
    const testTolerance = Math.max(equalLevelTolerance(protectedLow.price, params.options), breakTolerance * 2);
    const distanceFromLevelPct = closeBeyondPct(livePrice, protectedLow.price);
    if (livePrice < protectedLow.price - breakTolerance) {
      return {
        type: "below_protected_low",
        timeframe: params.timeframe,
        currentPrice: roundPrice(livePrice) ?? livePrice,
        levelPrice: roundPrice(protectedLow.price) ?? protectedLow.price,
        levelId: protectedLow.id,
        distanceFromLevelPct,
        confirmation: "unconfirmed_live_price",
        traderLine: livePressureTraderLine(
          "below_protected_low",
          params.timeframe,
          livePrice,
          protectedLow.price,
        ),
      };
    }
    if (Math.abs(livePrice - protectedLow.price) <= testTolerance) {
      return {
        type: "testing_protected_low",
        timeframe: params.timeframe,
        currentPrice: roundPrice(livePrice) ?? livePrice,
        levelPrice: roundPrice(protectedLow.price) ?? protectedLow.price,
        levelId: protectedLow.id,
        distanceFromLevelPct,
        confirmation: "unconfirmed_live_price",
        traderLine: livePressureTraderLine(
          "testing_protected_low",
          params.timeframe,
          livePrice,
          protectedLow.price,
        ),
      };
    }
  }

  return null;
}

function makeEvent(params: {
  type: FormalStructureEventType;
  timeframe: FormalStructureTimeframe;
  priorBias: FormalStructureBias;
  evaluationCandle: Candle | null;
  brokenSwing?: FormalStructureSwing | null;
  sweptSwing?: FormalStructureSwing | null;
  protectedHigh: FormalStructureSwing | null;
  protectedLow: FormalStructureSwing | null;
  confirmation: FormalBreakConfirmation;
  reasons: string[];
  confidenceScore: number;
  confidence: FormalStructureConfidenceLabel;
}): FormalStructureEvent {
  const level = params.brokenSwing?.price ?? params.sweptSwing?.price ?? null;
  return {
    type: params.type,
    timeframe: params.timeframe,
    biasBefore: params.priorBias,
    biasAfter: biasAfterEvent(params.type, params.priorBias),
    triggerTimestamp: params.evaluationCandle ? timestampToIso(params.evaluationCandle.timestamp) : null,
    triggerClose: params.evaluationCandle ? params.evaluationCandle.close : null,
    brokenSwingId: params.brokenSwing?.id ?? null,
    brokenSwingPrice: params.brokenSwing?.price ?? null,
    sweptSwingId: params.sweptSwing?.id ?? null,
    sweptSwingPrice: params.sweptSwing?.price ?? null,
    protectedHighId: params.protectedHigh?.id ?? null,
    protectedHighPrice: params.protectedHigh?.price ?? null,
    protectedLowId: params.protectedLow?.id ?? null,
    protectedLowPrice: params.protectedLow?.price ?? null,
    confirmation: params.confirmation,
    closeBeyondPct:
      params.evaluationCandle && level !== null ? closeBeyondPct(params.evaluationCandle.close, level) : 0,
    confidenceScore: params.confidenceScore,
    confidence: params.confidence,
    reasonCodes: params.reasons,
    traderLine: traderLineForEvent(
      params.type,
      params.timeframe,
      level,
      params.protectedHigh,
      params.protectedLow,
      params.reasons,
    ),
  };
}

function recentFailedBreak(
  candles: Candle[],
  level: number,
  direction: "bullish" | "bearish",
  options: ResolvedFormalMarketStructureOptions,
): boolean {
  const previous = candles.slice(-4, -1);
  if (previous.length === 0) return false;
  return previous.some((candle) =>
    direction === "bullish" ? isBullishBreak(candle, level, options) : isBearishBreak(candle, level, options),
  );
}

function detectFormalEvent(
  symbol: string,
  timeframe: FormalStructureTimeframe,
  candles: Candle[],
  priorAnalysis: SwingAnalysis,
  options: ResolvedFormalMarketStructureOptions,
): FormalStructureEvent {
  void symbol;
  const evaluationCandle = candles[candles.length - 1] ?? null;
  if (!evaluationCandle) {
    return makeEvent({
      type: "none",
      timeframe,
      priorBias: priorAnalysis.bias,
      evaluationCandle: null,
      protectedHigh: priorAnalysis.protectedHigh,
      protectedLow: priorAnalysis.protectedLow,
      confirmation: "none",
      reasons: ["no_evaluation_candle"],
      confidenceScore: 0.1,
      confidence: "low",
    });
  }

  const reasons = [...priorAnalysis.diagnostics.map((diagnostic) => diagnostic.code)];
  const structuralSwings = structuralSwingsForBias(priorAnalysis);
  const structuralHigh = mostRecentSwing(structuralSwings, "high") ?? priorAnalysis.latestHigh;
  const structuralLow = mostRecentSwing(structuralSwings, "low") ?? priorAnalysis.latestLow;
  const rangeHigh = boundarySwing(structuralSwings, "high") ?? structuralHigh;
  const rangeLow = boundarySwing(structuralSwings, "low") ?? structuralLow;

  const tryConfirmedEvent = (
    type: FormalStructureEventType,
    swing: FormalStructureSwing,
    direction: "bullish" | "bearish",
    extraReasons: string[],
  ): FormalStructureEvent => {
    const confirmation = breakConfirmation(candles, evaluationCandle, swing.price, direction, options);
    const eventReasons = [...reasons, ...extraReasons, ...confirmationReasons(confirmation)];
    const confidence = eventConfidence(type, priorAnalysis, swing, confirmation, eventReasons, options, candles);
    return makeEvent({
      type,
      timeframe,
      priorBias: priorAnalysis.bias,
      evaluationCandle,
      brokenSwing: swing,
      protectedHigh: priorAnalysis.protectedHigh,
      protectedLow: priorAnalysis.protectedLow,
      confirmation,
      reasons: eventReasons,
      confidenceScore: confidence.score,
      confidence: confidence.label,
    });
  };

  if (
    (priorAnalysis.bias === "bullish" || priorAnalysis.bias === "bullish_transition") &&
    priorAnalysis.protectedLow &&
    isBearishBreak(evaluationCandle, priorAnalysis.protectedLow.price, options)
  ) {
    return tryConfirmedEvent("choch_bearish", priorAnalysis.protectedLow, "bearish", ["protected_low_break"]);
  }

  if (
    (priorAnalysis.bias === "bearish" || priorAnalysis.bias === "bearish_transition") &&
    priorAnalysis.protectedHigh &&
    isBullishBreak(evaluationCandle, priorAnalysis.protectedHigh.price, options)
  ) {
    return tryConfirmedEvent("choch_bullish", priorAnalysis.protectedHigh, "bullish", ["protected_high_break"]);
  }

  if (
    (priorAnalysis.bias === "bullish" || priorAnalysis.bias === "bullish_transition") &&
    structuralHigh &&
    isBullishBreak(evaluationCandle, structuralHigh.price, options)
  ) {
    return tryConfirmedEvent("bos_bullish", structuralHigh, "bullish", ["trend_continuation"]);
  }

  if (
    (priorAnalysis.bias === "bearish" || priorAnalysis.bias === "bearish_transition") &&
    structuralLow &&
    isBearishBreak(evaluationCandle, structuralLow.price, options)
  ) {
    return tryConfirmedEvent("bos_bearish", structuralLow, "bearish", ["trend_continuation"]);
  }

  if ((priorAnalysis.bias === "range" || priorAnalysis.bias === "unknown") && rangeHigh) {
    if (isBullishBreak(evaluationCandle, rangeHigh.price, options)) {
      return tryConfirmedEvent("bos_bullish", rangeHigh, "bullish", ["range_break_initial_bias"]);
    }
  }

  if ((priorAnalysis.bias === "range" || priorAnalysis.bias === "unknown") && rangeLow) {
    if (isBearishBreak(evaluationCandle, rangeLow.price, options)) {
      return tryConfirmedEvent("bos_bearish", rangeLow, "bearish", ["range_break_initial_bias"]);
    }
  }

  if (structuralHigh && recentFailedBreak(candles, structuralHigh.price, "bullish", options)) {
    const tolerance = breakToleranceForPrice(structuralHigh.price, options);
    if (evaluationCandle.close <= structuralHigh.price + tolerance) {
      const eventReasons = [...reasons, "failed_break", "close_back_inside"];
      const confidence = eventConfidence(
        "failed_break_high",
        priorAnalysis,
        structuralHigh,
        "failed",
        eventReasons,
        options,
        candles,
      );
      return makeEvent({
        type: "failed_break_high",
        timeframe,
        priorBias: priorAnalysis.bias,
        evaluationCandle,
        sweptSwing: structuralHigh,
        protectedHigh: priorAnalysis.protectedHigh,
        protectedLow: priorAnalysis.protectedLow,
        confirmation: "failed",
        reasons: eventReasons,
        confidenceScore: confidence.score,
        confidence: confidence.label,
      });
    }
  }

  if (structuralLow && recentFailedBreak(candles, structuralLow.price, "bearish", options)) {
    const tolerance = breakToleranceForPrice(structuralLow.price, options);
    if (evaluationCandle.close >= structuralLow.price - tolerance) {
      const eventReasons = [...reasons, "failed_break", "close_back_inside"];
      const confidence = eventConfidence(
        "failed_break_low",
        priorAnalysis,
        structuralLow,
        "failed",
        eventReasons,
        options,
        candles,
      );
      return makeEvent({
        type: "failed_break_low",
        timeframe,
        priorBias: priorAnalysis.bias,
        evaluationCandle,
        sweptSwing: structuralLow,
        protectedHigh: priorAnalysis.protectedHigh,
        protectedLow: priorAnalysis.protectedLow,
        confirmation: "failed",
        reasons: eventReasons,
        confidenceScore: confidence.score,
        confidence: confidence.label,
      });
    }
  }

  if (structuralHigh && isBullishSweep(evaluationCandle, structuralHigh.price, options)) {
    const eventReasons = [...reasons, "liquidity_sweep", "wick_through_close_back_inside"];
    const confidence = eventConfidence(
      "liquidity_sweep_high",
      priorAnalysis,
      structuralHigh,
      "wick_only",
      eventReasons,
      options,
      candles,
    );
    return makeEvent({
      type: "liquidity_sweep_high",
      timeframe,
      priorBias: priorAnalysis.bias,
      evaluationCandle,
      sweptSwing: structuralHigh,
      protectedHigh: priorAnalysis.protectedHigh,
      protectedLow: priorAnalysis.protectedLow,
      confirmation: "wick_only",
      reasons: eventReasons,
      confidenceScore: confidence.score,
      confidence: confidence.label,
    });
  }

  if (structuralLow && isBearishSweep(evaluationCandle, structuralLow.price, options)) {
    const eventReasons = [...reasons, "liquidity_sweep", "wick_through_close_back_inside"];
    const confidence = eventConfidence(
      "liquidity_sweep_low",
      priorAnalysis,
      structuralLow,
      "wick_only",
      eventReasons,
      options,
      candles,
    );
    return makeEvent({
      type: "liquidity_sweep_low",
      timeframe,
      priorBias: priorAnalysis.bias,
      evaluationCandle,
      sweptSwing: structuralLow,
      protectedHigh: priorAnalysis.protectedHigh,
      protectedLow: priorAnalysis.protectedLow,
      confirmation: "wick_only",
      reasons: eventReasons,
      confidenceScore: confidence.score,
      confidence: confidence.label,
    });
  }

  return makeEvent({
    type: "none",
    timeframe,
    priorBias: priorAnalysis.bias,
    evaluationCandle,
    protectedHigh: priorAnalysis.protectedHigh,
    protectedLow: priorAnalysis.protectedLow,
    confirmation: "none",
    reasons,
    confidenceScore: 0.15,
    confidence: "low",
  });
}

export function buildFormalMarketStructureContext(
  request: BuildFormalMarketStructureRequest,
): FormalMarketStructureContext {
  const timeframe = request.timeframe ?? "5m";
  const options = resolveOptions(request.options);
  const asOfTimestamp =
    request.asOfTimestamp === undefined ? undefined : parseTimestamp(request.asOfTimestamp);
  const { candles, diagnostics: filterDiagnostics } = sortedUsableCandles(
    request.candles,
    timeframe,
    asOfTimestamp,
  );
  const diagnostics: FormalMarketStructureDiagnostic[] = [...filterDiagnostics];

  if (candles.length < options.minCandles) {
    diagnostics.push({
      code: "insufficient_candles",
      message: `Formal ${timeframe} structure needs at least ${options.minCandles} completed candles.`,
    });
    const emptyAnalysis = deriveSwingAnalysis(request.symbol, timeframe, candles, options);
    const event = makeEvent({
      type: "none",
      timeframe,
      priorBias: emptyAnalysis.bias,
      evaluationCandle: candles[candles.length - 1] ?? null,
      protectedHigh: emptyAnalysis.protectedHigh,
      protectedLow: emptyAnalysis.protectedLow,
      confirmation: "none",
      reasons: diagnostics.map((diagnostic) => diagnostic.code),
      confidenceScore: 0.1,
      confidence: "low",
    });
    const livePricePressure = buildLivePricePressure({
      timeframe,
      currentPrice: request.currentPrice,
      protectedHigh: emptyAnalysis.protectedHigh,
      protectedLow: emptyAnalysis.protectedLow,
      options,
    });
    return {
      symbol: request.symbol,
      timeframe,
      candleCount: candles.length,
      evaluatedAt: candles.length > 0 ? timestampToIso(candles[candles.length - 1]!.timestamp) : null,
      bias: emptyAnalysis.bias,
      previousBias: null,
      swings: emptyAnalysis.swings,
      internalSwings: emptyAnalysis.internalSwings,
      externalSwings: emptyAnalysis.externalSwings,
      latestHigh: emptyAnalysis.latestHigh,
      latestLow: emptyAnalysis.latestLow,
      protectedHigh: emptyAnalysis.protectedHigh,
      protectedLow: emptyAnalysis.protectedLow,
      latestEvent: event,
      livePricePressure,
      diagnostics: [...diagnostics, ...emptyAnalysis.diagnostics],
    };
  }

  const priorCandles = candles.slice(0, -1);
  const priorAnalysis = deriveSwingAnalysis(request.symbol, timeframe, priorCandles, options);
  const displayAnalysis = deriveSwingAnalysis(request.symbol, timeframe, candles, options);
  const latestEvent = detectFormalEvent(request.symbol, timeframe, candles, priorAnalysis, options);
  const livePricePressure =
    latestEvent.type === "none"
      ? buildLivePricePressure({
          timeframe,
          currentPrice: request.currentPrice,
          protectedHigh: priorAnalysis.protectedHigh,
          protectedLow: priorAnalysis.protectedLow,
          options,
        })
      : null;
  const allDiagnostics = [...diagnostics, ...priorAnalysis.diagnostics, ...displayAnalysis.diagnostics];

  return {
    symbol: request.symbol,
    timeframe,
    candleCount: candles.length,
    evaluatedAt: timestampToIso(candles[candles.length - 1]!.timestamp),
    bias: latestEvent.biasAfter,
    previousBias: latestEvent.biasBefore,
    swings: displayAnalysis.swings,
    internalSwings: displayAnalysis.internalSwings,
    externalSwings: displayAnalysis.externalSwings,
    latestHigh: displayAnalysis.latestHigh,
    latestLow: displayAnalysis.latestLow,
    protectedHigh: priorAnalysis.protectedHigh,
    protectedLow: priorAnalysis.protectedLow,
    latestEvent,
    livePricePressure,
    diagnostics: allDiagnostics,
  };
}
