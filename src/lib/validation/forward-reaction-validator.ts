import type { Candle } from "../market-data/candle-types.js";
import type { FinalLevelZone, LevelEngineOutput } from "../levels/level-types.js";

export type ForwardReactionValidatorOptions = {
  touchTolerancePct?: number;
  touchToleranceAbsolute?: number;
  reactionMovePct?: number;
  partialReactionMovePct?: number;
  resolutionLookaheadBars?: number;
  nearBandDistancePct?: number;
  intermediateBandDistancePct?: number;
};

export type ForwardReactionOutcome =
  | "untouched"
  | "respected"
  | "partial_respect"
  | "broken"
  | "touched_no_resolution";

export type ForwardReactionDistanceBand = "near" | "intermediate" | "far";

export type ForwardReactionSummary = {
  evaluated: number;
  touchRate: number;
  usefulnessRate: number;
  respectRate: number;
  partialRespectRate: number;
  breakRate: number;
};

export type ForwardReactionLevelResult = {
  zoneId: string;
  kind: "support" | "resistance";
  source: "surfaced" | "extension";
  timeframeBias: FinalLevelZone["timeframeBias"];
  strengthLabel: FinalLevelZone["strengthLabel"];
  representativePrice: number;
  distanceBand: ForwardReactionDistanceBand;
  outcome: ForwardReactionOutcome;
  touched: boolean;
  useful: boolean;
  respected: boolean;
  partialRespected: boolean;
  broken: boolean;
  brokeAfterPartial: boolean;
  firstTouchTimestamp?: number;
  resolutionTimestamp?: number;
  maxFavorableExcursionPct?: number;
  maxAdverseExcursionPct?: number;
};

export type ForwardReactionValidationReport = {
  totalLevelsEvaluated: number;
  surfacedLevelsEvaluated: number;
  extensionLevelsEvaluated: number;
  surfacedTouchRate: number;
  extensionTouchRate: number;
  surfacedUsefulnessRate: number;
  extensionUsefulnessRate: number;
  surfacedRespectRate: number;
  extensionRespectRate: number;
  surfacedPartialRespectRate: number;
  extensionPartialRespectRate: number;
  surfacedBreakRate: number;
  extensionBreakRate: number;
  byKindSource: {
    surfacedSupport: ForwardReactionSummary;
    surfacedResistance: ForwardReactionSummary;
    extensionSupport: ForwardReactionSummary;
    extensionResistance: ForwardReactionSummary;
  };
  byDistanceBand: Record<ForwardReactionDistanceBand, ForwardReactionSummary>;
  byStrengthLabel: Record<FinalLevelZone["strengthLabel"], ForwardReactionSummary>;
  levelResults: ForwardReactionLevelResult[];
};

const DEFAULT_TOUCH_TOLERANCE_PCT = 0.0035;
const DEFAULT_TOUCH_TOLERANCE_ABSOLUTE = 0.01;
const DEFAULT_REACTION_MOVE_PCT = 0.02;
const DEFAULT_PARTIAL_REACTION_MOVE_PCT = 0.01;
const DEFAULT_RESOLUTION_LOOKAHEAD_BARS = 12;
const DEFAULT_NEAR_BAND_DISTANCE_PCT = 0.035;
const DEFAULT_INTERMEDIATE_BAND_DISTANCE_PCT = 0.12;

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

function partialReactionMovePct(options: ForwardReactionValidatorOptions): number {
  return options.partialReactionMovePct ?? DEFAULT_PARTIAL_REACTION_MOVE_PCT;
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

function favorableExcursionPct(zone: FinalLevelZone, candle: Candle): number {
  if (zone.kind === "resistance") {
    return Math.max(zone.representativePrice - candle.low, 0) / Math.max(zone.representativePrice, 0.0001);
  }

  return Math.max(candle.high - zone.representativePrice, 0) / Math.max(zone.representativePrice, 0.0001);
}

function adverseExcursionPct(zone: FinalLevelZone, candle: Candle): number {
  if (zone.kind === "resistance") {
    return Math.max(candle.high - zone.representativePrice, 0) / Math.max(zone.representativePrice, 0.0001);
  }

  return Math.max(zone.representativePrice - candle.low, 0) / Math.max(zone.representativePrice, 0.0001);
}

function breakMatches(
  zone: FinalLevelZone,
  candle: Candle,
  tolerance: number,
): boolean {
  if (zone.kind === "resistance") {
    return candle.close >= zone.representativePrice + tolerance;
  }

  return candle.close <= zone.representativePrice - tolerance;
}

function distanceBand(
  zone: FinalLevelZone,
  referencePrice: number | undefined,
  options: ForwardReactionValidatorOptions,
): ForwardReactionDistanceBand {
  const safeReference = referencePrice && referencePrice > 0 ? referencePrice : zone.representativePrice;
  const distancePct =
    Math.abs(zone.representativePrice - safeReference) / Math.max(safeReference, 0.0001);
  const nearThreshold = options.nearBandDistancePct ?? DEFAULT_NEAR_BAND_DISTANCE_PCT;
  const intermediateThreshold =
    options.intermediateBandDistancePct ?? DEFAULT_INTERMEDIATE_BAND_DISTANCE_PCT;

  if (distancePct <= nearThreshold) {
    return "near";
  }

  if (distancePct <= intermediateThreshold) {
    return "intermediate";
  }

  return "far";
}

function summarize(results: ForwardReactionLevelResult[]): ForwardReactionSummary {
  return {
    evaluated: results.length,
    touchRate: rate(results.filter((result) => result.touched).length, results.length),
    usefulnessRate: rate(results.filter((result) => result.useful).length, results.length),
    respectRate: rate(results.filter((result) => result.respected).length, results.length),
    partialRespectRate: rate(
      results.filter((result) => result.partialRespected).length,
      results.length,
    ),
    breakRate: rate(results.filter((result) => result.broken).length, results.length),
  };
}

function evaluateLevelForwardReaction(params: {
  zone: FinalLevelZone;
  source: "surfaced" | "extension";
  referencePrice: number | undefined;
  futureCandles: Candle[];
  options: ForwardReactionValidatorOptions;
}): ForwardReactionLevelResult {
  const tolerance = touchTolerance(params.zone.representativePrice, params.options);
  const fullReactionThresholdPct = reactionMovePct(params.options);
  const partialReactionThresholdPct = partialReactionMovePct(params.options);
  const lookaheadBars = resolutionLookaheadBars(params.options);
  const band = distanceBand(params.zone, params.referencePrice, params.options);
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
      distanceBand: band,
      outcome: "untouched",
      touched: false,
      useful: false,
      respected: false,
      partialRespected: false,
      broken: false,
      brokeAfterPartial: false,
    };
  }

  const touchedCandle = params.futureCandles[firstTouchIndex]!;
  const resolutionWindow = params.futureCandles.slice(
    firstTouchIndex,
    firstTouchIndex + lookaheadBars,
  );
  let maxFavorablePct = 0;
  let maxAdversePct = 0;
  let partialTimestamp: number | undefined;

  for (const candle of resolutionWindow) {
    maxFavorablePct = Math.max(maxFavorablePct, favorableExcursionPct(params.zone, candle));
    maxAdversePct = Math.max(maxAdversePct, adverseExcursionPct(params.zone, candle));

    if (maxFavorablePct >= fullReactionThresholdPct) {
      return {
        zoneId: params.zone.id,
        kind: params.zone.kind,
        source: params.source,
        timeframeBias: params.zone.timeframeBias,
        strengthLabel: params.zone.strengthLabel,
        representativePrice: params.zone.representativePrice,
        distanceBand: band,
        outcome: "respected",
        touched: true,
        useful: true,
        respected: true,
        partialRespected: false,
        broken: false,
        brokeAfterPartial: false,
        firstTouchTimestamp: touchedCandle.timestamp,
        resolutionTimestamp: candle.timestamp,
        maxFavorableExcursionPct: roundMetric(maxFavorablePct),
        maxAdverseExcursionPct: roundMetric(maxAdversePct),
      };
    }

    if (partialTimestamp === undefined && maxFavorablePct >= partialReactionThresholdPct) {
      partialTimestamp = candle.timestamp;
    }

    if (breakMatches(params.zone, candle, tolerance)) {
      if (partialTimestamp !== undefined) {
        return {
          zoneId: params.zone.id,
          kind: params.zone.kind,
          source: params.source,
          timeframeBias: params.zone.timeframeBias,
          strengthLabel: params.zone.strengthLabel,
          representativePrice: params.zone.representativePrice,
          distanceBand: band,
          outcome: "partial_respect",
          touched: true,
          useful: true,
          respected: false,
          partialRespected: true,
          broken: true,
          brokeAfterPartial: true,
          firstTouchTimestamp: touchedCandle.timestamp,
          resolutionTimestamp: candle.timestamp,
          maxFavorableExcursionPct: roundMetric(maxFavorablePct),
          maxAdverseExcursionPct: roundMetric(maxAdversePct),
        };
      }

      return {
        zoneId: params.zone.id,
        kind: params.zone.kind,
        source: params.source,
        timeframeBias: params.zone.timeframeBias,
        strengthLabel: params.zone.strengthLabel,
        representativePrice: params.zone.representativePrice,
        distanceBand: band,
        outcome: "broken",
        touched: true,
        useful: false,
        respected: false,
        partialRespected: false,
        broken: true,
        brokeAfterPartial: false,
        firstTouchTimestamp: touchedCandle.timestamp,
        resolutionTimestamp: candle.timestamp,
        maxFavorableExcursionPct: roundMetric(maxFavorablePct),
        maxAdverseExcursionPct: roundMetric(maxAdversePct),
      };
    }
  }

  if (partialTimestamp !== undefined) {
    return {
      zoneId: params.zone.id,
      kind: params.zone.kind,
      source: params.source,
      timeframeBias: params.zone.timeframeBias,
      strengthLabel: params.zone.strengthLabel,
      representativePrice: params.zone.representativePrice,
      distanceBand: band,
      outcome: "partial_respect",
      touched: true,
      useful: true,
      respected: false,
      partialRespected: true,
      broken: false,
      brokeAfterPartial: false,
      firstTouchTimestamp: touchedCandle.timestamp,
      resolutionTimestamp: partialTimestamp,
      maxFavorableExcursionPct: roundMetric(maxFavorablePct),
      maxAdverseExcursionPct: roundMetric(maxAdversePct),
    };
  }

  return {
    zoneId: params.zone.id,
    kind: params.zone.kind,
    source: params.source,
    timeframeBias: params.zone.timeframeBias,
    strengthLabel: params.zone.strengthLabel,
    representativePrice: params.zone.representativePrice,
    distanceBand: band,
    outcome: "touched_no_resolution",
    touched: true,
    useful: false,
    respected: false,
    partialRespected: false,
    broken: false,
    brokeAfterPartial: false,
    firstTouchTimestamp: touchedCandle.timestamp,
    maxFavorableExcursionPct: roundMetric(maxFavorablePct),
    maxAdverseExcursionPct: roundMetric(maxAdversePct),
  };
}

export function validateForwardReactions(
  params: {
    output: LevelEngineOutput;
    futureCandles: Candle[];
  },
  options: ForwardReactionValidatorOptions = {},
): ForwardReactionValidationReport {
  const referencePrice = params.output.metadata.referencePrice;
  const levelResults = buildEvaluationLevels(params.output).map(({ zone, source }) =>
    evaluateLevelForwardReaction({
      zone,
      source,
      referencePrice,
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
    surfacedTouchRate: summarize(surfacedResults).touchRate,
    extensionTouchRate: summarize(extensionResults).touchRate,
    surfacedUsefulnessRate: summarize(surfacedResults).usefulnessRate,
    extensionUsefulnessRate: summarize(extensionResults).usefulnessRate,
    surfacedRespectRate: summarize(surfacedResults).respectRate,
    extensionRespectRate: summarize(extensionResults).respectRate,
    surfacedPartialRespectRate: summarize(surfacedResults).partialRespectRate,
    extensionPartialRespectRate: summarize(extensionResults).partialRespectRate,
    surfacedBreakRate: summarize(surfacedResults).breakRate,
    extensionBreakRate: summarize(extensionResults).breakRate,
    byKindSource: {
      surfacedSupport: summarize(
        levelResults.filter((result) => result.source === "surfaced" && result.kind === "support"),
      ),
      surfacedResistance: summarize(
        levelResults.filter((result) => result.source === "surfaced" && result.kind === "resistance"),
      ),
      extensionSupport: summarize(
        levelResults.filter((result) => result.source === "extension" && result.kind === "support"),
      ),
      extensionResistance: summarize(
        levelResults.filter((result) => result.source === "extension" && result.kind === "resistance"),
      ),
    },
    byDistanceBand: {
      near: summarize(levelResults.filter((result) => result.distanceBand === "near")),
      intermediate: summarize(levelResults.filter((result) => result.distanceBand === "intermediate")),
      far: summarize(levelResults.filter((result) => result.distanceBand === "far")),
    },
    byStrengthLabel: Object.fromEntries(
      strengthLabels.map((label) => [
        label,
        summarize(levelResults.filter((result) => result.strengthLabel === label)),
      ]),
    ) as ForwardReactionValidationReport["byStrengthLabel"],
    levelResults,
  };
}

export function formatForwardReactionReport(
  report: ForwardReactionValidationReport,
): string[] {
  const lines = [
    `[LevelValidation] Levels evaluated: ${report.totalLevelsEvaluated} | surfaced=${report.surfacedLevelsEvaluated} | extension=${report.extensionLevelsEvaluated}`,
    `[LevelValidation] Surfaced forward outcome | touch=${report.surfacedTouchRate.toFixed(4)} | useful=${report.surfacedUsefulnessRate.toFixed(4)} | respect=${report.surfacedRespectRate.toFixed(4)} | partial=${report.surfacedPartialRespectRate.toFixed(4)} | break=${report.surfacedBreakRate.toFixed(4)}`,
    `[LevelValidation] Extension forward outcome | touch=${report.extensionTouchRate.toFixed(4)} | useful=${report.extensionUsefulnessRate.toFixed(4)} | respect=${report.extensionRespectRate.toFixed(4)} | partial=${report.extensionPartialRespectRate.toFixed(4)} | break=${report.extensionBreakRate.toFixed(4)}`,
    `[LevelValidation] By side/source | surfacedSupport=${report.byKindSource.surfacedSupport.usefulnessRate.toFixed(4)} | surfacedResistance=${report.byKindSource.surfacedResistance.usefulnessRate.toFixed(4)} | extensionSupport=${report.byKindSource.extensionSupport.usefulnessRate.toFixed(4)} | extensionResistance=${report.byKindSource.extensionResistance.usefulnessRate.toFixed(4)}`,
    `[LevelValidation] By distance band | near=${report.byDistanceBand.near.usefulnessRate.toFixed(4)} | intermediate=${report.byDistanceBand.intermediate.usefulnessRate.toFixed(4)} | far=${report.byDistanceBand.far.usefulnessRate.toFixed(4)}`,
  ];

  for (const label of ["weak", "moderate", "strong", "major"] as const) {
    const summary = report.byStrengthLabel[label];
    lines.push(
      `[LevelValidation] Strength ${label} | evaluated=${summary.evaluated} | useful=${summary.usefulnessRate.toFixed(4)} | respect=${summary.respectRate.toFixed(4)} | partial=${summary.partialRespectRate.toFixed(4)} | break=${summary.breakRate.toFixed(4)}`,
    );
  }

  return lines;
}
