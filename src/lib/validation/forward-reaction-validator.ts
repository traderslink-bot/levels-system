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
  volumeBaselineBars?: number;
  minVolumeBaselineBars?: number;
  elevatedVolumeRatio?: number;
  heavyVolumeRatio?: number;
  lightVolumeRatio?: number;
};

export type ForwardReactionOutcome =
  | "untouched"
  | "respected"
  | "partial_respect"
  | "broken"
  | "touched_no_resolution";

export type ForwardReactionDistanceBand = "near" | "intermediate" | "far";
export type SurfacedForwardBucket = "daily" | "4h" | "5m";
export type ForwardReactionVolumeReliability = "reliable" | "watch" | "unavailable";
export type ForwardReactionVolumeLabel = "heavy" | "elevated" | "normal" | "light" | "unknown";

export type ForwardReactionVolumeContext = {
  reliability: ForwardReactionVolumeReliability;
  label: ForwardReactionVolumeLabel;
  touchVolume: number | null;
  baselineAverageVolume: number | null;
  relativeVolumeRatio: number | null;
  baselineBars: number;
  reason: string;
};

export type ForwardReactionSummary = {
  evaluated: number;
  touched: number;
  touchRate: number;
  closestApproachPct: number;
  usefulnessRate: number;
  usefulWhenTouchedRate: number;
  respectRate: number;
  partialRespectRate: number;
  breakRate: number;
};

export type ForwardReactionLevelResult = {
  zoneId: string;
  kind: "support" | "resistance";
  source: "surfaced" | "extension";
  surfacedBucket?: SurfacedForwardBucket;
  timeframeBias: FinalLevelZone["timeframeBias"];
  strengthLabel: FinalLevelZone["strengthLabel"];
  strengthScore: number;
  touchCount: number;
  confluenceCount: number;
  sourceEvidenceCount: number;
  timeframeSources: FinalLevelZone["timeframeSources"];
  sourceTypes: FinalLevelZone["sourceTypes"];
  reactionQualityScore: number;
  rejectionScore: number;
  followThroughScore: number;
  displacementScore: number;
  representativePrice: number;
  distanceBand: ForwardReactionDistanceBand;
  outcome: ForwardReactionOutcome;
  touched: boolean;
  useful: boolean;
  respected: boolean;
  partialRespected: boolean;
  broken: boolean;
  brokeAfterPartial: boolean;
  closestApproachPct: number;
  firstTouchTimestamp?: number;
  resolutionTimestamp?: number;
  maxFavorableExcursionPct?: number;
  maxAdverseExcursionPct?: number;
  volumeContext: ForwardReactionVolumeContext;
};

export type ForwardReactionVolumeSummary = {
  touched: number;
  reliable: number;
  unreliable: number;
  highVolumeTouches: number;
  lightVolumeTouches: number;
  highVolumeUsefulWhenTouchedRate: number;
  highVolumeRespectRate: number;
  highVolumeBreakRate: number;
  lightVolumeUsefulWhenTouchedRate: number;
  lightVolumeRespectRate: number;
  lightVolumeBreakRate: number;
};

export type ForwardReactionValidationReport = {
  totalLevelsEvaluated: number;
  surfacedLevelsEvaluated: number;
  extensionLevelsEvaluated: number;
  surfacedTouchRate: number;
  extensionTouchRate: number;
  surfacedUsefulnessRate: number;
  extensionUsefulnessRate: number;
  surfacedUsefulWhenTouchedRate: number;
  extensionUsefulWhenTouchedRate: number;
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
  bySurfacedSupportBucket: Record<SurfacedForwardBucket, ForwardReactionSummary>;
  byDistanceBand: Record<ForwardReactionDistanceBand, ForwardReactionSummary>;
  byStrengthLabel: Record<FinalLevelZone["strengthLabel"], ForwardReactionSummary>;
  byVolumeLabel: Record<ForwardReactionVolumeLabel, ForwardReactionSummary>;
  volumeEvidence: ForwardReactionVolumeSummary;
  levelResults: ForwardReactionLevelResult[];
};

const DEFAULT_TOUCH_TOLERANCE_PCT = 0.0035;
const DEFAULT_TOUCH_TOLERANCE_ABSOLUTE = 0.01;
const DEFAULT_REACTION_MOVE_PCT = 0.02;
const DEFAULT_PARTIAL_REACTION_MOVE_PCT = 0.01;
const DEFAULT_RESOLUTION_LOOKAHEAD_BARS = 12;
const DEFAULT_NEAR_BAND_DISTANCE_PCT = 0.035;
const DEFAULT_INTERMEDIATE_BAND_DISTANCE_PCT = 0.12;
const DEFAULT_VOLUME_BASELINE_BARS = 20;
const DEFAULT_MIN_VOLUME_BASELINE_BARS = 6;
const DEFAULT_ELEVATED_VOLUME_RATIO = 1.5;
const DEFAULT_HEAVY_VOLUME_RATIO = 2.5;
const DEFAULT_LIGHT_VOLUME_RATIO = 0.75;

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

function volumeBaselineBars(options: ForwardReactionValidatorOptions): number {
  return Math.max(1, Math.floor(options.volumeBaselineBars ?? DEFAULT_VOLUME_BASELINE_BARS));
}

function minVolumeBaselineBars(options: ForwardReactionValidatorOptions): number {
  return Math.max(1, Math.floor(options.minVolumeBaselineBars ?? DEFAULT_MIN_VOLUME_BASELINE_BARS));
}

function volumeLabel(ratio: number, options: ForwardReactionValidatorOptions): ForwardReactionVolumeLabel {
  if (ratio >= (options.heavyVolumeRatio ?? DEFAULT_HEAVY_VOLUME_RATIO)) {
    return "heavy";
  }
  if (ratio >= (options.elevatedVolumeRatio ?? DEFAULT_ELEVATED_VOLUME_RATIO)) {
    return "elevated";
  }
  if (ratio <= (options.lightVolumeRatio ?? DEFAULT_LIGHT_VOLUME_RATIO)) {
    return "light";
  }
  return "normal";
}

function unknownVolumeContext(reason: string): ForwardReactionVolumeContext {
  return {
    reliability: "unavailable",
    label: "unknown",
    touchVolume: null,
    baselineAverageVolume: null,
    relativeVolumeRatio: null,
    baselineBars: 0,
    reason,
  };
}

function buildVolumeContext(params: {
  futureCandles: Candle[];
  baselineCandles: Candle[];
  firstTouchIndex: number;
  options: ForwardReactionValidatorOptions;
}): ForwardReactionVolumeContext {
  const touchedCandle = params.futureCandles[params.firstTouchIndex];
  if (!touchedCandle) {
    return unknownVolumeContext("level was not touched");
  }

  const touchVolume = Number.isFinite(touchedCandle.volume) && touchedCandle.volume > 0
    ? touchedCandle.volume
    : null;
  if (touchVolume === null) {
    return {
      ...unknownVolumeContext("touch candle volume was missing or empty"),
      touchVolume,
    };
  }

  const touchTimestamp = touchedCandle.timestamp;
  const priorCandles = [
    ...params.baselineCandles,
    ...params.futureCandles.slice(0, params.firstTouchIndex),
  ]
    .filter(
      (candle) =>
        candle.timestamp < touchTimestamp &&
        Number.isFinite(candle.volume) &&
        candle.volume > 0,
    )
    .sort((left, right) => left.timestamp - right.timestamp)
    .slice(-volumeBaselineBars(params.options));
  const minBars = minVolumeBaselineBars(params.options);

  if (priorCandles.length < minBars) {
    return {
      reliability: priorCandles.length > 0 ? "watch" : "unavailable",
      label: "unknown",
      touchVolume,
      baselineAverageVolume: priorCandles.length > 0
        ? roundMetric(priorCandles.reduce((sum, candle) => sum + candle.volume, 0) / priorCandles.length)
        : null,
      relativeVolumeRatio: null,
      baselineBars: priorCandles.length,
      reason: `insufficient prior candle volume baseline (${priorCandles.length}/${minBars})`,
    };
  }

  const baselineAverageVolume =
    priorCandles.reduce((sum, candle) => sum + candle.volume, 0) / priorCandles.length;
  const relativeVolumeRatio = touchVolume / baselineAverageVolume;
  return {
    reliability: "reliable",
    label: volumeLabel(relativeVolumeRatio, params.options),
    touchVolume,
    baselineAverageVolume: roundMetric(baselineAverageVolume),
    relativeVolumeRatio: roundMetric(relativeVolumeRatio),
    baselineBars: priorCandles.length,
    reason: "touch candle volume compared with prior 5m candle baseline",
  };
}

function isActionableEvaluationZone(
  zone: FinalLevelZone,
  referencePrice: number | undefined,
  options: ForwardReactionValidatorOptions,
): boolean {
  if (!(referencePrice && referencePrice > 0)) {
    return true;
  }

  const tolerance = touchTolerance(zone.representativePrice, options);
  if (zone.kind === "support") {
    return zone.representativePrice < referencePrice - tolerance;
  }

  return zone.representativePrice > referencePrice + tolerance;
}

function buildEvaluationLevels(
  output: LevelEngineOutput,
  options: ForwardReactionValidatorOptions,
): Array<{
  zone: FinalLevelZone;
  source: "surfaced" | "extension";
  surfacedBucket?: SurfacedForwardBucket;
}> {
  const evaluationLevels = [
    ...output.majorSupport.map((zone) => ({
      zone,
      source: "surfaced" as const,
      surfacedBucket: "daily" as const,
    })),
    ...output.intermediateSupport.map((zone) => ({
      zone,
      source: "surfaced" as const,
      surfacedBucket: "4h" as const,
    })),
    ...output.intradaySupport.map((zone) => ({
      zone,
      source: "surfaced" as const,
      surfacedBucket: "5m" as const,
    })),
    ...output.majorResistance.map((zone) => ({
      zone,
      source: "surfaced" as const,
      surfacedBucket: "daily" as const,
    })),
    ...output.intermediateResistance.map((zone) => ({
      zone,
      source: "surfaced" as const,
      surfacedBucket: "4h" as const,
    })),
    ...output.intradayResistance.map((zone) => ({
      zone,
      source: "surfaced" as const,
      surfacedBucket: "5m" as const,
    })),
    ...output.extensionLevels.support.map((zone) => ({ zone, source: "extension" as const })),
    ...output.extensionLevels.resistance.map((zone) => ({ zone, source: "extension" as const })),
  ];

  return evaluationLevels.filter(({ zone }) =>
    isActionableEvaluationZone(zone, output.metadata.referencePrice, options),
  );
}

function touchMatches(zone: FinalLevelZone, candle: Candle, tolerance: number): boolean {
  const low = zone.zoneLow - tolerance;
  const high = zone.zoneHigh + tolerance;
  return candle.high >= low && candle.low <= high;
}

function closestApproachPct(zone: FinalLevelZone, candle: Candle, tolerance: number): number {
  const low = zone.zoneLow - tolerance;
  const high = zone.zoneHigh + tolerance;

  if (candle.high >= low && candle.low <= high) {
    return 0;
  }

  const gapAbove = candle.low - high;
  const gapBelow = low - candle.high;
  const distance = Math.max(Math.max(gapAbove, gapBelow), 0);

  return distance / Math.max(zone.representativePrice, 0.0001);
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
  const touched = results.filter((result) => result.touched).length;
  const useful = results.filter((result) => result.useful).length;

  return {
    evaluated: results.length,
    touched,
    touchRate: rate(touched, results.length),
    closestApproachPct:
      results.length === 0
        ? 0
        : roundMetric(
            Math.min(...results.map((result) => result.closestApproachPct)),
          ),
    usefulnessRate: rate(useful, results.length),
    usefulWhenTouchedRate: rate(useful, touched),
    respectRate: rate(results.filter((result) => result.respected).length, results.length),
    partialRespectRate: rate(
      results.filter((result) => result.partialRespected).length,
      results.length,
    ),
    breakRate: rate(results.filter((result) => result.broken).length, results.length),
  };
}

function summarizeVolumeEvidence(results: ForwardReactionLevelResult[]): ForwardReactionVolumeSummary {
  const touched = results.filter((result) => result.touched);
  const reliable = touched.filter((result) => result.volumeContext.reliability === "reliable");
  const unreliable = touched.length - reliable.length;
  const highVolume = reliable.filter((result) =>
    result.volumeContext.label === "heavy" || result.volumeContext.label === "elevated",
  );
  const lightVolume = reliable.filter((result) => result.volumeContext.label === "light");

  return {
    touched: touched.length,
    reliable: reliable.length,
    unreliable,
    highVolumeTouches: highVolume.length,
    lightVolumeTouches: lightVolume.length,
    highVolumeUsefulWhenTouchedRate: rate(highVolume.filter((result) => result.useful).length, highVolume.length),
    highVolumeRespectRate: rate(highVolume.filter((result) => result.respected).length, highVolume.length),
    highVolumeBreakRate: rate(highVolume.filter((result) => result.broken).length, highVolume.length),
    lightVolumeUsefulWhenTouchedRate: rate(lightVolume.filter((result) => result.useful).length, lightVolume.length),
    lightVolumeRespectRate: rate(lightVolume.filter((result) => result.respected).length, lightVolume.length),
    lightVolumeBreakRate: rate(lightVolume.filter((result) => result.broken).length, lightVolume.length),
  };
}

function levelEvidenceFields(zone: FinalLevelZone): Pick<
  ForwardReactionLevelResult,
  | "strengthScore"
  | "touchCount"
  | "confluenceCount"
  | "sourceEvidenceCount"
  | "timeframeSources"
  | "sourceTypes"
  | "reactionQualityScore"
  | "rejectionScore"
  | "followThroughScore"
  | "displacementScore"
> {
  return {
    strengthScore: zone.strengthScore,
    touchCount: zone.touchCount,
    confluenceCount: zone.confluenceCount,
    sourceEvidenceCount: zone.sourceEvidenceCount,
    timeframeSources: zone.timeframeSources,
    sourceTypes: zone.sourceTypes,
    reactionQualityScore: zone.reactionQualityScore,
    rejectionScore: zone.rejectionScore,
    followThroughScore: zone.followThroughScore,
    displacementScore: zone.displacementScore,
  };
}

function evaluateLevelForwardReaction(params: {
  zone: FinalLevelZone;
  source: "surfaced" | "extension";
  surfacedBucket?: SurfacedForwardBucket;
  referencePrice: number | undefined;
  futureCandles: Candle[];
  baselineCandles: Candle[];
  options: ForwardReactionValidatorOptions;
}): ForwardReactionLevelResult {
  const tolerance = touchTolerance(params.zone.representativePrice, params.options);
  const fullReactionThresholdPct = reactionMovePct(params.options);
  const partialReactionThresholdPct = partialReactionMovePct(params.options);
  const lookaheadBars = resolutionLookaheadBars(params.options);
  const band = distanceBand(params.zone, params.referencePrice, params.options);
  const minApproachPct =
    params.futureCandles.length === 0
      ? 0
      : roundMetric(
          Math.min(
            ...params.futureCandles.map((candle) =>
              closestApproachPct(params.zone, candle, tolerance),
            ),
          ),
        );
  const firstTouchIndex = params.futureCandles.findIndex((candle) =>
    touchMatches(params.zone, candle, tolerance),
  );

  if (firstTouchIndex < 0) {
    return {
      zoneId: params.zone.id,
      kind: params.zone.kind,
      source: params.source,
      surfacedBucket: params.surfacedBucket,
      timeframeBias: params.zone.timeframeBias,
      strengthLabel: params.zone.strengthLabel,
      ...levelEvidenceFields(params.zone),
      representativePrice: params.zone.representativePrice,
      distanceBand: band,
      outcome: "untouched",
      touched: false,
      useful: false,
      respected: false,
      partialRespected: false,
      broken: false,
      brokeAfterPartial: false,
      closestApproachPct: minApproachPct,
      volumeContext: unknownVolumeContext("level was not touched"),
    };
  }

  const touchedCandle = params.futureCandles[firstTouchIndex]!;
  const volumeContext = buildVolumeContext({
    futureCandles: params.futureCandles,
    baselineCandles: params.baselineCandles,
    firstTouchIndex,
    options: params.options,
  });
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
        surfacedBucket: params.surfacedBucket,
        timeframeBias: params.zone.timeframeBias,
        strengthLabel: params.zone.strengthLabel,
        ...levelEvidenceFields(params.zone),
        representativePrice: params.zone.representativePrice,
        distanceBand: band,
        outcome: "respected",
        touched: true,
        useful: true,
        respected: true,
        partialRespected: false,
        broken: false,
        brokeAfterPartial: false,
        closestApproachPct: 0,
        firstTouchTimestamp: touchedCandle.timestamp,
        resolutionTimestamp: candle.timestamp,
        maxFavorableExcursionPct: roundMetric(maxFavorablePct),
        maxAdverseExcursionPct: roundMetric(maxAdversePct),
        volumeContext,
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
          surfacedBucket: params.surfacedBucket,
          timeframeBias: params.zone.timeframeBias,
          strengthLabel: params.zone.strengthLabel,
          ...levelEvidenceFields(params.zone),
          representativePrice: params.zone.representativePrice,
          distanceBand: band,
          outcome: "partial_respect",
          touched: true,
          useful: true,
          respected: false,
          partialRespected: true,
          broken: true,
          brokeAfterPartial: true,
          closestApproachPct: 0,
          firstTouchTimestamp: touchedCandle.timestamp,
          resolutionTimestamp: candle.timestamp,
          maxFavorableExcursionPct: roundMetric(maxFavorablePct),
          maxAdverseExcursionPct: roundMetric(maxAdversePct),
          volumeContext,
        };
      }

      return {
        zoneId: params.zone.id,
        kind: params.zone.kind,
        source: params.source,
        surfacedBucket: params.surfacedBucket,
        timeframeBias: params.zone.timeframeBias,
        strengthLabel: params.zone.strengthLabel,
        ...levelEvidenceFields(params.zone),
        representativePrice: params.zone.representativePrice,
        distanceBand: band,
        outcome: "broken",
        touched: true,
        useful: false,
        respected: false,
        partialRespected: false,
        broken: true,
        brokeAfterPartial: false,
        closestApproachPct: 0,
        firstTouchTimestamp: touchedCandle.timestamp,
        resolutionTimestamp: candle.timestamp,
        maxFavorableExcursionPct: roundMetric(maxFavorablePct),
        maxAdverseExcursionPct: roundMetric(maxAdversePct),
        volumeContext,
      };
    }
  }

  if (partialTimestamp !== undefined) {
    return {
      zoneId: params.zone.id,
      kind: params.zone.kind,
      source: params.source,
      surfacedBucket: params.surfacedBucket,
      timeframeBias: params.zone.timeframeBias,
      strengthLabel: params.zone.strengthLabel,
      ...levelEvidenceFields(params.zone),
      representativePrice: params.zone.representativePrice,
      distanceBand: band,
      outcome: "partial_respect",
      touched: true,
      useful: true,
      respected: false,
      partialRespected: true,
      broken: false,
      brokeAfterPartial: false,
      closestApproachPct: 0,
      firstTouchTimestamp: touchedCandle.timestamp,
      resolutionTimestamp: partialTimestamp,
      maxFavorableExcursionPct: roundMetric(maxFavorablePct),
      maxAdverseExcursionPct: roundMetric(maxAdversePct),
      volumeContext,
    };
  }

  return {
    zoneId: params.zone.id,
    kind: params.zone.kind,
    source: params.source,
    surfacedBucket: params.surfacedBucket,
    timeframeBias: params.zone.timeframeBias,
    strengthLabel: params.zone.strengthLabel,
    ...levelEvidenceFields(params.zone),
    representativePrice: params.zone.representativePrice,
    distanceBand: band,
    outcome: "touched_no_resolution",
    touched: true,
    useful: false,
    respected: false,
    partialRespected: false,
    broken: false,
    brokeAfterPartial: false,
    closestApproachPct: 0,
    firstTouchTimestamp: touchedCandle.timestamp,
    maxFavorableExcursionPct: roundMetric(maxFavorablePct),
    maxAdverseExcursionPct: roundMetric(maxAdversePct),
    volumeContext,
  };
}

export function validateForwardReactions(
  params: {
    output: LevelEngineOutput;
    futureCandles: Candle[];
    baselineCandles?: Candle[];
  },
  options: ForwardReactionValidatorOptions = {},
): ForwardReactionValidationReport {
  const referencePrice = params.output.metadata.referencePrice;
  const baselineCandles = params.baselineCandles ?? [];
  const levelResults = buildEvaluationLevels(params.output, options).map(
    ({ zone, source, surfacedBucket }) =>
    evaluateLevelForwardReaction({
      zone,
      source,
      surfacedBucket,
      referencePrice,
      futureCandles: params.futureCandles,
      baselineCandles,
      options,
    }),
  );

  const surfacedResults = levelResults.filter((result) => result.source === "surfaced");
  const extensionResults = levelResults.filter((result) => result.source === "extension");
  const strengthLabels: FinalLevelZone["strengthLabel"][] = ["weak", "moderate", "strong", "major"];
  const volumeLabels: ForwardReactionVolumeLabel[] = ["heavy", "elevated", "normal", "light", "unknown"];
  const surfacedSummary = summarize(surfacedResults);
  const extensionSummary = summarize(extensionResults);

  return {
    totalLevelsEvaluated: levelResults.length,
    surfacedLevelsEvaluated: surfacedResults.length,
    extensionLevelsEvaluated: extensionResults.length,
    surfacedTouchRate: surfacedSummary.touchRate,
    extensionTouchRate: extensionSummary.touchRate,
    surfacedUsefulnessRate: surfacedSummary.usefulnessRate,
    extensionUsefulnessRate: extensionSummary.usefulnessRate,
    surfacedUsefulWhenTouchedRate: surfacedSummary.usefulWhenTouchedRate,
    extensionUsefulWhenTouchedRate: extensionSummary.usefulWhenTouchedRate,
    surfacedRespectRate: surfacedSummary.respectRate,
    extensionRespectRate: extensionSummary.respectRate,
    surfacedPartialRespectRate: surfacedSummary.partialRespectRate,
    extensionPartialRespectRate: extensionSummary.partialRespectRate,
    surfacedBreakRate: surfacedSummary.breakRate,
    extensionBreakRate: extensionSummary.breakRate,
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
    bySurfacedSupportBucket: {
      daily: summarize(
        levelResults.filter(
          (result) =>
            result.source === "surfaced" &&
            result.kind === "support" &&
            result.surfacedBucket === "daily",
        ),
      ),
      "4h": summarize(
        levelResults.filter(
          (result) =>
            result.source === "surfaced" &&
            result.kind === "support" &&
            result.surfacedBucket === "4h",
        ),
      ),
      "5m": summarize(
        levelResults.filter(
          (result) =>
            result.source === "surfaced" &&
            result.kind === "support" &&
            result.surfacedBucket === "5m",
        ),
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
    byVolumeLabel: Object.fromEntries(
      volumeLabels.map((label) => [
        label,
        summarize(levelResults.filter((result) => result.volumeContext.label === label)),
      ]),
    ) as ForwardReactionValidationReport["byVolumeLabel"],
    volumeEvidence: summarizeVolumeEvidence(levelResults),
    levelResults,
  };
}

export function formatForwardReactionReport(
  report: ForwardReactionValidationReport,
): string[] {
  const lines = [
    `[LevelValidation] Levels evaluated: ${report.totalLevelsEvaluated} | surfaced=${report.surfacedLevelsEvaluated} | extension=${report.extensionLevelsEvaluated}`,
    `[LevelValidation] Surfaced forward outcome | touch=${report.surfacedTouchRate.toFixed(4)} | useful=${report.surfacedUsefulnessRate.toFixed(4)} | usefulWhenTouched=${report.surfacedUsefulWhenTouchedRate.toFixed(4)} | respect=${report.surfacedRespectRate.toFixed(4)} | partial=${report.surfacedPartialRespectRate.toFixed(4)} | break=${report.surfacedBreakRate.toFixed(4)}`,
    `[LevelValidation] Extension forward outcome | touch=${report.extensionTouchRate.toFixed(4)} | useful=${report.extensionUsefulnessRate.toFixed(4)} | usefulWhenTouched=${report.extensionUsefulWhenTouchedRate.toFixed(4)} | respect=${report.extensionRespectRate.toFixed(4)} | partial=${report.extensionPartialRespectRate.toFixed(4)} | break=${report.extensionBreakRate.toFixed(4)}`,
    `[LevelValidation] By side/source | surfacedSupport=${report.byKindSource.surfacedSupport.usefulnessRate.toFixed(4)} | surfacedResistance=${report.byKindSource.surfacedResistance.usefulnessRate.toFixed(4)} | extensionSupport=${report.byKindSource.extensionSupport.usefulnessRate.toFixed(4)} | extensionResistance=${report.byKindSource.extensionResistance.usefulnessRate.toFixed(4)}`,
    `[LevelValidation] Support bucket evaluated | daily=${report.bySurfacedSupportBucket.daily.evaluated} | 4h=${report.bySurfacedSupportBucket["4h"].evaluated} | 5m=${report.bySurfacedSupportBucket["5m"].evaluated}`,
    `[LevelValidation] Support bucket usefulness | daily=${report.bySurfacedSupportBucket.daily.usefulnessRate.toFixed(4)} | 4h=${report.bySurfacedSupportBucket["4h"].usefulnessRate.toFixed(4)} | 5m=${report.bySurfacedSupportBucket["5m"].usefulnessRate.toFixed(4)}`,
    `[LevelValidation] Support bucket touch | daily=${report.bySurfacedSupportBucket.daily.touchRate.toFixed(4)} | 4h=${report.bySurfacedSupportBucket["4h"].touchRate.toFixed(4)} | 5m=${report.bySurfacedSupportBucket["5m"].touchRate.toFixed(4)}`,
    `[LevelValidation] Support bucket useful when touched | daily=${report.bySurfacedSupportBucket.daily.usefulWhenTouchedRate.toFixed(4)} | 4h=${report.bySurfacedSupportBucket["4h"].usefulWhenTouchedRate.toFixed(4)} | 5m=${report.bySurfacedSupportBucket["5m"].usefulWhenTouchedRate.toFixed(4)}`,
    `[LevelValidation] Support bucket closest approach | daily=${report.bySurfacedSupportBucket.daily.closestApproachPct.toFixed(4)} | 4h=${report.bySurfacedSupportBucket["4h"].closestApproachPct.toFixed(4)} | 5m=${report.bySurfacedSupportBucket["5m"].closestApproachPct.toFixed(4)}`,
    `[LevelValidation] By distance band | near=${report.byDistanceBand.near.usefulnessRate.toFixed(4)} | intermediate=${report.byDistanceBand.intermediate.usefulnessRate.toFixed(4)} | far=${report.byDistanceBand.far.usefulnessRate.toFixed(4)}`,
    `[LevelValidation] Distance reachability | near=${report.byDistanceBand.near.touchRate.toFixed(4)} | intermediate=${report.byDistanceBand.intermediate.touchRate.toFixed(4)} | far=${report.byDistanceBand.far.touchRate.toFixed(4)}`,
    `[LevelValidation] Distance useful when touched | near=${report.byDistanceBand.near.usefulWhenTouchedRate.toFixed(4)} | intermediate=${report.byDistanceBand.intermediate.usefulWhenTouchedRate.toFixed(4)} | far=${report.byDistanceBand.far.usefulWhenTouchedRate.toFixed(4)}`,
    `[LevelValidation] Volume evidence | touched=${report.volumeEvidence.touched} | reliable=${report.volumeEvidence.reliable} | unavailable=${report.volumeEvidence.unreliable} | highVolumeTouches=${report.volumeEvidence.highVolumeTouches} | highVolumeUseful=${report.volumeEvidence.highVolumeUsefulWhenTouchedRate.toFixed(4)} | highVolumeRespect=${report.volumeEvidence.highVolumeRespectRate.toFixed(4)} | highVolumeBreak=${report.volumeEvidence.highVolumeBreakRate.toFixed(4)}`,
    `[LevelValidation] Volume buckets | heavy=${report.byVolumeLabel.heavy.usefulWhenTouchedRate.toFixed(4)}(${report.byVolumeLabel.heavy.touched}) | elevated=${report.byVolumeLabel.elevated.usefulWhenTouchedRate.toFixed(4)}(${report.byVolumeLabel.elevated.touched}) | normal=${report.byVolumeLabel.normal.usefulWhenTouchedRate.toFixed(4)}(${report.byVolumeLabel.normal.touched}) | light=${report.byVolumeLabel.light.usefulWhenTouchedRate.toFixed(4)}(${report.byVolumeLabel.light.touched}) | unknown=${report.byVolumeLabel.unknown.touched}`,
  ];

  for (const label of ["weak", "moderate", "strong", "major"] as const) {
    const summary = report.byStrengthLabel[label];
    lines.push(
      `[LevelValidation] Strength ${label} | evaluated=${summary.evaluated} | useful=${summary.usefulnessRate.toFixed(4)} | respect=${summary.respectRate.toFixed(4)} | partial=${summary.partialRespectRate.toFixed(4)} | break=${summary.breakRate.toFixed(4)}`,
    );
  }

  return lines;
}
