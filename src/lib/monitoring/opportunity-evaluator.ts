import type { RankedOpportunity } from "./opportunity-engine.js";

export type OpportunityFollowThroughLabel =
  | "strong"
  | "working"
  | "stalled"
  | "failed"
  | "unknown";

export type OpportunityProgressLabel =
  | "improving"
  | "stalling"
  | "degrading";

export type OpportunityProgressUpdate = {
  symbol: string;
  eventType: string;
  timestamp: number;
  entryPrice: number;
  currentPrice: number;
  directionalReturnPct: number | null;
  progressLabel: OpportunityProgressLabel;
};

export type EvaluatedOpportunity = {
  symbol: string;
  timestamp: number;
  evaluatedAt: number;
  entryPrice: number;
  outcomePrice: number;
  returnPct: number;
  directionalReturnPct: number | null;
  followThroughLabel: OpportunityFollowThroughLabel;
  success: boolean;
  eventType: string;
};

export type EventTypeExpectancySummary = {
  totalEvaluated: number;
  wins: number;
  losses: number;
  winRate: number;
  lossRate: number;
  averageWinPct: number;
  averageLossPct: number;
  expectancy: number;
};

export type RollingExpectancySummary = {
  windowSize: number;
  sampleSize: number;
  expectancy: number;
};

export type PerformanceDriftSummary = {
  declining: boolean;
  currentExpectancy: number;
  previousExpectancy: number;
  delta: number;
};

export type OpportunityEvaluationSummary = {
  totalEvaluated: number;
  wins: number;
  losses: number;
  winRate: number;
  lossRate: number;
  expectancy: number;
  averageReturnPct: number;
  averageWinPct: number;
  averageLossPct: number;
  maxDrawdownPct: number;
  signalAccuracy: number;
  expectancyByEventType: Record<string, EventTypeExpectancySummary>;
  rollingExpectancy: RollingExpectancySummary;
  performanceDrift: PerformanceDriftSummary;
};

type PendingOpportunity = {
  id: string;
  opportunity: RankedOpportunity;
  entryPrice: number;
  trackedAt: number;
  evaluateAt: number;
  peakPrice: number;
  troughPrice: number;
  bestDirectionalReturnPct?: number | null;
  worstDirectionalReturnPct?: number | null;
  lastProgressLabel?: OpportunityProgressLabel;
  lastProgressDirectionalReturnPct?: number | null;
  lastProgressUpdatedAt?: number;
};

const DEFAULT_EVALUATION_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_SUMMARY_INTERVAL = 10;
const DEFAULT_SUCCESS_THRESHOLD_PCT = 0.3;
const DEFAULT_EARLY_EXIT_THRESHOLD_PCT = 0.3;
const DEFAULT_ROLLING_WINDOW_SIZE = 20;

function clamp(value: number, min: number = 0, max: number = 1): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, decimals: number = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function resolveOpportunityEventType(opportunity: RankedOpportunity): string {
  return opportunity.eventType ?? opportunity.type;
}

function isBullishType(type: string): boolean {
  return type === "breakout" || type === "reclaim" || type === "fake_breakdown";
}

function isBearishType(type: string): boolean {
  return type === "breakdown" || type === "rejection" || type === "fake_breakout";
}

function buildTrackedId(opportunity: RankedOpportunity): string {
  return `${opportunity.symbol}|${resolveOpportunityEventType(opportunity)}|${opportunity.timestamp}|${opportunity.level}`;
}

function computeReturnPct(entryPrice: number, outcomePrice: number): number {
  if (entryPrice <= 0) {
    return 0;
  }

  return ((outcomePrice - entryPrice) / entryPrice) * 100;
}

function directionalReturnPct(eventType: string, returnPct: number): number | null {
  if (!Number.isFinite(returnPct)) {
    return null;
  }

  if (isBullishType(eventType)) {
    return returnPct;
  }

  if (isBearishType(eventType)) {
    return -1 * returnPct;
  }

  return Math.abs(returnPct);
}

function deriveFollowThroughLabel(
  eventType: string,
  returnPct: number,
  success: boolean,
): OpportunityFollowThroughLabel {
  const directional = directionalReturnPct(eventType, returnPct);
  if (directional === null) {
    return "unknown";
  }

  if (success && directional >= 1.0) {
    return "strong";
  }

  if (success && directional >= 0.3) {
    return "working";
  }

  if (directional >= -0.2) {
    return "stalled";
  }

  return "failed";
}

function deriveProgressLabel(
  eventType: string,
  returnPct: number,
  bestDirectionalReturnPct?: number | null,
): OpportunityProgressLabel {
  const directional = directionalReturnPct(eventType, returnPct);
  if (directional === null) {
    return "stalling";
  }

  const priorBest = bestDirectionalReturnPct ?? directional;
  const retraceFromBest = priorBest - directional;

  if (directional <= -0.25 || (priorBest >= 0.35 && retraceFromBest >= 0.75)) {
    return "degrading";
  }

  if (
    (priorBest >= 0.35 && retraceFromBest >= 0.35) ||
    (directional > -0.1 && directional < 0.2)
  ) {
    return "stalling";
  }

  if (directional >= 0.3) {
    return "improving";
  }

  return "stalling";
}

function determineSuccessWithThreshold(
  opportunity: RankedOpportunity,
  returnPct: number,
  successThresholdPct: number,
): boolean {
  const eventType = resolveOpportunityEventType(opportunity);

  if (isBullishType(eventType)) {
    return returnPct >= successThresholdPct;
  }

  if (isBearishType(eventType)) {
    return returnPct <= -successThresholdPct;
  }

  return Math.abs(returnPct) >= successThresholdPct;
}

function shouldExitEarly(
  opportunity: RankedOpportunity,
  returnPct: number,
  exitThresholdPct: number,
): boolean {
  const eventType = resolveOpportunityEventType(opportunity);

  if (isBullishType(eventType)) {
    return returnPct >= exitThresholdPct || returnPct <= -exitThresholdPct;
  }

  if (isBearishType(eventType)) {
    return returnPct <= -exitThresholdPct || returnPct >= exitThresholdPct;
  }

  return Math.abs(returnPct) >= exitThresholdPct;
}

function approximateDrawdownPct(pending: PendingOpportunity): number {
  if (pending.entryPrice <= 0) {
    return 0;
  }

  const eventType = resolveOpportunityEventType(pending.opportunity);

  if (isBullishType(eventType)) {
    return ((pending.troughPrice - pending.entryPrice) / pending.entryPrice) * 100;
  }

  if (isBearishType(eventType)) {
    return ((pending.entryPrice - pending.peakPrice) / pending.entryPrice) * 100;
  }

  const worstDistance = Math.max(
    Math.abs(pending.peakPrice - pending.entryPrice),
    Math.abs(pending.troughPrice - pending.entryPrice),
  );

  return -(worstDistance / pending.entryPrice) * 100;
}

function computeAverageReturn(
  evaluated: EvaluatedOpportunity[],
  predicate?: (item: EvaluatedOpportunity) => boolean,
): number {
  const filtered = predicate ? evaluated.filter(predicate) : evaluated;

  if (filtered.length === 0) {
    return 0;
  }

  return round(filtered.reduce((sum, item) => sum + item.returnPct, 0) / filtered.length);
}

function computeExpectancy(evaluated: EvaluatedOpportunity[]): number {
  if (evaluated.length === 0) {
    return 0;
  }

  const wins = evaluated.filter((item) => item.success);
  const losses = evaluated.filter((item) => !item.success);
  const winRate = wins.length / evaluated.length;
  const lossRate = losses.length / evaluated.length;
  const averageWinPct = computeAverageReturn(wins);
  const averageLossPct = computeAverageReturn(losses);

  return round(winRate * averageWinPct + lossRate * averageLossPct);
}

function buildEventTypeExpectancySummary(
  evaluated: EvaluatedOpportunity[],
): Record<string, EventTypeExpectancySummary> {
  const summaries = new Map<string, EvaluatedOpportunity[]>();

  for (const item of evaluated) {
    const bucket = summaries.get(item.eventType) ?? [];
    bucket.push(item);
    summaries.set(item.eventType, bucket);
  }

  return Object.fromEntries(
    [...summaries.entries()].map(([eventType, items]) => {
      const wins = items.filter((item) => item.success);
      const losses = items.filter((item) => !item.success);
      const totalEvaluated = items.length;
      const winRate = totalEvaluated === 0 ? 0 : wins.length / totalEvaluated;
      const lossRate = totalEvaluated === 0 ? 0 : losses.length / totalEvaluated;

      return [
        eventType,
        {
          totalEvaluated,
          wins: wins.length,
          losses: losses.length,
          winRate: round(winRate, 4),
          lossRate: round(lossRate, 4),
          averageWinPct: computeAverageReturn(wins),
          averageLossPct: computeAverageReturn(losses),
          expectancy: computeExpectancy(items),
        },
      ];
    }),
  );
}

function buildRollingExpectancySummary(
  evaluated: EvaluatedOpportunity[],
  rollingWindowSize: number,
): RollingExpectancySummary {
  const recent = evaluated.slice(-rollingWindowSize);

  return {
    windowSize: rollingWindowSize,
    sampleSize: recent.length,
    expectancy: computeExpectancy(recent),
  };
}

function buildPerformanceDriftSummary(
  evaluated: EvaluatedOpportunity[],
  rollingWindowSize: number,
): PerformanceDriftSummary {
  const currentWindow = evaluated.slice(-rollingWindowSize);
  const previousWindow =
    evaluated.length > rollingWindowSize
      ? evaluated.slice(-rollingWindowSize * 2, -rollingWindowSize)
      : [];
  const currentExpectancy = computeExpectancy(currentWindow);
  const previousExpectancy = computeExpectancy(previousWindow);
  const delta = round(currentExpectancy - previousExpectancy);

  return {
    declining: previousWindow.length > 0 && delta < 0,
    currentExpectancy,
    previousExpectancy,
    delta,
  };
}

export class OpportunityEvaluator {
  private readonly pending = new Map<string, PendingOpportunity>();
  private readonly evaluated: EvaluatedOpportunity[] = [];
  private readonly drawdowns: number[] = [];

  constructor(
    private readonly evaluationWindowMs: number = DEFAULT_EVALUATION_WINDOW_MS,
    private readonly debug: boolean = false,
    private readonly summaryInterval: number = DEFAULT_SUMMARY_INTERVAL,
    private readonly successThresholdPct: number = DEFAULT_SUCCESS_THRESHOLD_PCT,
    private readonly earlyExitThresholdPct: number = DEFAULT_EARLY_EXIT_THRESHOLD_PCT,
    private readonly rollingWindowSize: number = DEFAULT_ROLLING_WINDOW_SIZE,
  ) {}

  track(opportunity: RankedOpportunity, entryPrice: number): void {
    const normalizedEntry = round(entryPrice);

    this.pending.set(buildTrackedId(opportunity), {
      id: buildTrackedId(opportunity),
      opportunity,
      entryPrice: normalizedEntry,
      trackedAt: opportunity.timestamp,
      evaluateAt: opportunity.timestamp + this.evaluationWindowMs,
      peakPrice: normalizedEntry,
      troughPrice: normalizedEntry,
      bestDirectionalReturnPct: null,
      worstDirectionalReturnPct: null,
      lastProgressLabel: undefined,
      lastProgressDirectionalReturnPct: null,
      lastProgressUpdatedAt: undefined,
    });
  }

  updatePrice(symbol: string, price: number, timestamp: number): {
    completed: EvaluatedOpportunity[];
    progressUpdates: OpportunityProgressUpdate[];
  } {
    const normalizedPrice = round(price);
    const completed: EvaluatedOpportunity[] = [];
    const progressUpdates: OpportunityProgressUpdate[] = [];

    for (const [id, pending] of this.pending) {
      if (pending.opportunity.symbol !== symbol) {
        continue;
      }

      pending.peakPrice = Math.max(pending.peakPrice, normalizedPrice);
      pending.troughPrice = Math.min(pending.troughPrice, normalizedPrice);

      const returnPct = round(computeReturnPct(pending.entryPrice, normalizedPrice));
      const resolvedEventType = resolveOpportunityEventType(pending.opportunity);
      const directional = directionalReturnPct(resolvedEventType, returnPct);
      const priorBestDirectional = pending.bestDirectionalReturnPct;
      const progressLabel = deriveProgressLabel(
        resolvedEventType,
        returnPct,
        priorBestDirectional,
      );
      if (directional !== null) {
        pending.bestDirectionalReturnPct =
          pending.bestDirectionalReturnPct === null || pending.bestDirectionalReturnPct === undefined
            ? directional
            : Math.max(pending.bestDirectionalReturnPct, directional);
        pending.worstDirectionalReturnPct =
          pending.worstDirectionalReturnPct === null || pending.worstDirectionalReturnPct === undefined
            ? directional
            : Math.min(pending.worstDirectionalReturnPct, directional);
      }
      const shouldEmitProgress =
        (pending.lastProgressLabel === undefined ||
          progressLabel !== pending.lastProgressLabel ||
          (directional !== null &&
            pending.lastProgressDirectionalReturnPct != null &&
            Math.abs(directional - pending.lastProgressDirectionalReturnPct) >=
              (progressLabel === "improving" ? 0.55 : progressLabel === "stalling" ? 0.45 : 0.35))) &&
        (pending.lastProgressUpdatedAt === undefined ||
          timestamp - pending.lastProgressUpdatedAt >=
            (progressLabel === "stalling" ? 2 * 60 * 1000 : 60 * 1000));

      if (shouldEmitProgress) {
        progressUpdates.push({
          symbol: pending.opportunity.symbol,
          eventType: resolvedEventType,
          timestamp,
          entryPrice: pending.entryPrice,
          currentPrice: normalizedPrice,
          directionalReturnPct: directional,
          progressLabel,
        });
        pending.lastProgressLabel = progressLabel;
        pending.lastProgressDirectionalReturnPct = directional;
        pending.lastProgressUpdatedAt = timestamp;
      }

      const reachedMaxWindow = timestamp >= pending.evaluateAt;
      const reachedEarlyExit = shouldExitEarly(
        pending.opportunity,
        returnPct,
        this.earlyExitThresholdPct,
      );

      if (!reachedMaxWindow && !reachedEarlyExit) {
        continue;
      }

      const success = determineSuccessWithThreshold(
        pending.opportunity,
        returnPct,
        this.successThresholdPct,
      );
      const evaluatedOpportunity: EvaluatedOpportunity = {
        symbol: pending.opportunity.symbol,
        timestamp: pending.opportunity.timestamp,
        evaluatedAt: timestamp,
        entryPrice: pending.entryPrice,
        outcomePrice: normalizedPrice,
        returnPct,
        directionalReturnPct: directionalReturnPct(resolvedEventType, returnPct),
        followThroughLabel: deriveFollowThroughLabel(
          resolvedEventType,
          returnPct,
          success,
        ),
        success,
        eventType: resolvedEventType,
      };

      this.evaluated.push(evaluatedOpportunity);
      this.drawdowns.push(round(approximateDrawdownPct(pending)));
      this.pending.delete(id);
      completed.push(evaluatedOpportunity);
    }

    if (
      this.debug &&
      completed.length > 0 &&
      this.summaryInterval > 0 &&
      this.evaluated.length % this.summaryInterval === 0
    ) {
      this.logSummary();
    }

    return {
      completed,
      progressUpdates,
    };
  }

  getPendingCount(): number {
    return this.pending.size;
  }

  getEvaluated(): EvaluatedOpportunity[] {
    return [...this.evaluated];
  }

  getSummary(): OpportunityEvaluationSummary {
    const totalEvaluated = this.evaluated.length;
    const wins = this.evaluated.filter((item) => item.success).length;
    const losses = totalEvaluated - wins;
    const winRate = totalEvaluated === 0 ? 0 : wins / totalEvaluated;
    const lossRate = totalEvaluated === 0 ? 0 : losses / totalEvaluated;
    const averageWinPct = computeAverageReturn(this.evaluated, (item) => item.success);
    const averageLossPct = computeAverageReturn(this.evaluated, (item) => !item.success);
    const expectancy = computeExpectancy(this.evaluated);
    const worstDrawdown = this.drawdowns.length === 0 ? 0 : Math.min(...this.drawdowns);
    const signalAccuracy = totalEvaluated === 0 ? 0 : round(winRate, 4);

    return {
      totalEvaluated,
      wins,
      losses,
      winRate: round(clamp(winRate) * 100, 2),
      lossRate: round(clamp(lossRate) * 100, 2),
      expectancy,
      averageReturnPct: expectancy,
      averageWinPct,
      averageLossPct,
      maxDrawdownPct: round(Math.abs(worstDrawdown), 4),
      signalAccuracy,
      expectancyByEventType: buildEventTypeExpectancySummary(this.evaluated),
      rollingExpectancy: buildRollingExpectancySummary(this.evaluated, this.rollingWindowSize),
      performanceDrift: buildPerformanceDriftSummary(this.evaluated, this.rollingWindowSize),
    };
  }

  logSummary(): void {
    const summary = this.getSummary();
    console.log("[OpportunityEvaluator]", JSON.stringify(summary));
  }
}
