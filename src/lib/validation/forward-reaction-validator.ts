import type { Candle } from "../market-data/candle-types.js";
import type { FinalLevelZone, LevelEngineOutput } from "../levels/level-types.js";

export type ForwardReactionValidatorOptions = {
  touchTolerancePct?: number;
  touchToleranceAbsolute?: number;
  reactionMovePct?: number;
  resolutionLookaheadBars?: number;
};

export type ForwardReactionOutcome =
  | "untouched"
  | "respected"
  | "broken"
  | "touched_no_resolution";

export type ForwardReactionLevelResult = {
  zoneId: string;
  kind: "support" | "resistance";
  source: "surfaced" | "extension";
  timeframeBias: FinalLevelZone["timeframeBias"];
  strengthLabel: FinalLevelZone["strengthLabel"];
  representativePrice: number;
  outcome: ForwardReactionOutcome;
  touched: boolean;
  respected: boolean;
  broken: boolean;
  firstTouchTimestamp?: number;
  resolutionTimestamp?: number;
  reactionMagnitudePct?: number;
};

export type ForwardReactionValidationReport = {
  totalLevelsEvaluated: number;
  surfacedLevelsEvaluated: number;
  extensionLevelsEvaluated: number;
  surfacedTouchRate: number;
  extensionTouchRate: number;
  surfacedRespectRate: number;
  extensionRespectRate: number;
  surfacedBreakRate: number;
  extensionBreakRate: number;
  byStrengthLabel: Record<
    FinalLevelZone["strengthLabel"],
    {
      evaluated: number;
      touchRate: number;
      respectRate: number;
      breakRate: number;
    }
  >;
  levelResults: ForwardReactionLevelResult[];
};

const DEFAULT_TOUCH_TOLERANCE_PCT = 0.0035;
const DEFAULT_TOUCH_TOLERANCE_ABSOLUTE = 0.01;
const DEFAULT_REACTION_MOVE_PCT = 0.02;
const DEFAULT_RESOLUTION_LOOKAHEAD_BARS = 12;

function roundMetric(value: number): number {
  return Number(value.toFixed(4));
}

function rate(numerator: number, denominator: number): number {
  if (denominator === 0) {
    return 0;
  }

  return roundMetric(numerator / denominator);
}

function touchTolerance(price: number, options: ForwardReactionValidatorOptions): number {
  const pct = options.touchTolerancePct ?? DEFAULT_TOUCH_TOLERANCE_PCT;
  const absolute = options.touchToleranceAbsolute ?? DEFAULT_TOUCH_TOLERANCE_ABSOLUTE;
  return Math.max(price * pct, absolute);
}

function reactionMovePct(options: ForwardReactionValidatorOptions): number {
  return options.reactionMovePct ?? DEFAULT_REACTION_MOVE_PCT;
}

function resolutionLookaheadBars(options: ForwardReactionValidatorOptions): number {
  return options.resolutionLookaheadBars ?? DEFAULT_RESOLUTION_LOOKAHEAD_BARS;
}

function buildEvaluationLevels(output: LevelEngineOutput): Array<{
  zone: FinalLevelZone;
  source: "surfaced" | "extension";
}> {
  return [
    ...output.majorSupport.map((zone) => ({ zone, source: "surfaced" as const })),
    ...output.intermediateSupport.map((zone) => ({ zone, source: "surfaced" as const })),
    ...output.intradaySupport.map((zone) => ({ zone, source: "surfaced" as const })),
    ...output.majorResistance.map((zone) => ({ zone, source: "surfaced" as const })),
    ...output.intermediateResistance.map((zone) => ({ zone, source: "surfaced" as const })),
    ...output.intradayResistance.map((zone) => ({ zone, source: "surfaced" as const })),
    ...output.extensionLevels.support.map((zone) => ({ zone, source: "extension" as const })),
    ...output.extensionLevels.resistance.map((zone) => ({ zone, source: "extension" as const })),
  ];
}

function touchMatches(zone: FinalLevelZone, candle: Candle, tolerance: number): boolean {
  const low = zone.zoneLow - tolerance;
  const high = zone.zoneHigh + tolerance;
  return candle.high >= low && candle.low <= high;
}

function reactionMagnitude(
  zone: FinalLevelZone,
  candle: Candle,
): number {
  if (zone.kind === "resistance") {
    return Math.max(zone.representativePrice - candle.close, 0) / Math.max(zone.representativePrice, 0.0001);
  }

  return Math.max(candle.close - zone.representativePrice, 0) / Math.max(zone.representativePrice, 0.0001);
}

function resolutionMatches(
  zone: FinalLevelZone,
  candle: Candle,
  tolerance: number,
  reactionThresholdPct: number,
): { respected: boolean; broken: boolean; magnitudePct: number } {
  if (zone.kind === "resistance") {
    const respected =
      candle.close <= zone.representativePrice * (1 - reactionThresholdPct);
    const broken = candle.close >= zone.representativePrice + tolerance;
    return {
      respected,
      broken,
      magnitudePct: reactionMagnitude(zone, candle),
    };
  }

  const respected = candle.close >= zone.representativePrice * (1 + reactionThresholdPct);
  const broken = candle.close <= zone.representativePrice - tolerance;
  return {
    respected,
    broken,
    magnitudePct: reactionMagnitude(zone, candle),
  };
}

function evaluateLevelForwardReaction(params: {
  zone: FinalLevelZone;
  source: "surfaced" | "extension";
  futureCandles: Candle[];
  options: ForwardReactionValidatorOptions;
}): ForwardReactionLevelResult {
  const tolerance = touchTolerance(params.zone.representativePrice, params.options);
  const reactionThresholdPct = reactionMovePct(params.options);
  const lookaheadBars = resolutionLookaheadBars(params.options);
  const firstTouchIndex = params.futureCandles.findIndex((candle) =>
    touchMatches(params.zone, candle, tolerance),
  );

  if (firstTouchIndex < 0) {
    return {
      zoneId: params.zone.id,
      kind: params.zone.kind,
      source: params.source,
      timeframeBias: params.zone.timeframeBias,
      strengthLabel: params.zone.strengthLabel,
      representativePrice: params.zone.representativePrice,
      outcome: "untouched",
      touched: false,
      respected: false,
      broken: false,
    };
  }

  const touchedCandle = params.futureCandles[firstTouchIndex]!;
  const resolutionWindow = params.futureCandles.slice(
    firstTouchIndex,
    firstTouchIndex + lookaheadBars,
  );

  for (const candle of resolutionWindow) {
    const resolution = resolutionMatches(
      params.zone,
      candle,
      tolerance,
      reactionThresholdPct,
    );

    if (resolution.respected) {
      return {
        zoneId: params.zone.id,
        kind: params.zone.kind,
        source: params.source,
        timeframeBias: params.zone.timeframeBias,
        strengthLabel: params.zone.strengthLabel,
        representativePrice: params.zone.representativePrice,
        outcome: "respected",
        touched: true,
        respected: true,
        broken: false,
        firstTouchTimestamp: touchedCandle.timestamp,
        resolutionTimestamp: candle.timestamp,
        reactionMagnitudePct: roundMetric(resolution.magnitudePct),
      };
    }

    if (resolution.broken) {
      return {
        zoneId: params.zone.id,
        kind: params.zone.kind,
        source: params.source,
        timeframeBias: params.zone.timeframeBias,
        strengthLabel: params.zone.strengthLabel,
        representativePrice: params.zone.representativePrice,
        outcome: "broken",
        touched: true,
        respected: false,
        broken: true,
        firstTouchTimestamp: touchedCandle.timestamp,
        resolutionTimestamp: candle.timestamp,
        reactionMagnitudePct: roundMetric(resolution.magnitudePct),
      };
    }
  }

  return {
    zoneId: params.zone.id,
    kind: params.zone.kind,
    source: params.source,
    timeframeBias: params.zone.timeframeBias,
    strengthLabel: params.zone.strengthLabel,
    representativePrice: params.zone.representativePrice,
    outcome: "touched_no_resolution",
    touched: true,
    respected: false,
    broken: false,
    firstTouchTimestamp: touchedCandle.timestamp,
  };
}

export function validateForwardReactions(
  params: {
    output: LevelEngineOutput;
    futureCandles: Candle[];
  },
  options: ForwardReactionValidatorOptions = {},
): ForwardReactionValidationReport {
  const levelResults = buildEvaluationLevels(params.output).map(({ zone, source }) =>
    evaluateLevelForwardReaction({
      zone,
      source,
      futureCandles: params.futureCandles,
      options,
    }),
  );

  const surfacedResults = levelResults.filter((result) => result.source === "surfaced");
  const extensionResults = levelResults.filter((result) => result.source === "extension");
  const strengthLabels: FinalLevelZone["strengthLabel"][] = ["weak", "moderate", "strong", "major"];

  return {
    totalLevelsEvaluated: levelResults.length,
    surfacedLevelsEvaluated: surfacedResults.length,
    extensionLevelsEvaluated: extensionResults.length,
    surfacedTouchRate: rate(
      surfacedResults.filter((result) => result.touched).length,
      surfacedResults.length,
    ),
    extensionTouchRate: rate(
      extensionResults.filter((result) => result.touched).length,
      extensionResults.length,
    ),
    surfacedRespectRate: rate(
      surfacedResults.filter((result) => result.respected).length,
      surfacedResults.length,
    ),
    extensionRespectRate: rate(
      extensionResults.filter((result) => result.respected).length,
      extensionResults.length,
    ),
    surfacedBreakRate: rate(
      surfacedResults.filter((result) => result.broken).length,
      surfacedResults.length,
    ),
    extensionBreakRate: rate(
      extensionResults.filter((result) => result.broken).length,
      extensionResults.length,
    ),
    byStrengthLabel: Object.fromEntries(
      strengthLabels.map((label) => {
        const labeled = levelResults.filter((result) => result.strengthLabel === label);
        return [
          label,
          {
            evaluated: labeled.length,
            touchRate: rate(labeled.filter((result) => result.touched).length, labeled.length),
            respectRate: rate(labeled.filter((result) => result.respected).length, labeled.length),
            breakRate: rate(labeled.filter((result) => result.broken).length, labeled.length),
          },
        ];
      }),
    ) as ForwardReactionValidationReport["byStrengthLabel"],
    levelResults,
  };
}

export function formatForwardReactionReport(
  report: ForwardReactionValidationReport,
): string[] {
  const lines = [
    `[LevelValidation] Levels evaluated: ${report.totalLevelsEvaluated} | surfaced=${report.surfacedLevelsEvaluated} | extension=${report.extensionLevelsEvaluated}`,
    `[LevelValidation] Surfaced forward outcome | touch=${report.surfacedTouchRate.toFixed(4)} | respect=${report.surfacedRespectRate.toFixed(4)} | break=${report.surfacedBreakRate.toFixed(4)}`,
    `[LevelValidation] Extension forward outcome | touch=${report.extensionTouchRate.toFixed(4)} | respect=${report.extensionRespectRate.toFixed(4)} | break=${report.extensionBreakRate.toFixed(4)}`,
  ];

  for (const label of ["weak", "moderate", "strong", "major"] as const) {
    const summary = report.byStrengthLabel[label];
    lines.push(
      `[LevelValidation] Strength ${label} | evaluated=${summary.evaluated} | touch=${summary.touchRate.toFixed(4)} | respect=${summary.respectRate.toFixed(4)} | break=${summary.breakRate.toFixed(4)}`,
    );
  }

  return lines;
}
