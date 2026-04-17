import type { FinalLevelZone, LevelEngineOutput } from "../levels/level-types.js";

export type SurfacedLevelBucket = "daily" | "4h" | "5m";

export type LevelPersistenceValidatorOptions = {
  priceTolerancePct?: number;
  priceToleranceAbsolute?: number;
  looseMatchToleranceRatio?: number;
};

export type LevelPersistenceRunSummary = {
  fromGeneratedAt: number;
  toGeneratedAt: number;
  supportPersistenceRate: number;
  resistancePersistenceRate: number;
  supportBucketPersistenceRate: Record<SurfacedLevelBucket, number>;
  extensionSupportPersistenceRate: number;
  extensionResistancePersistenceRate: number;
  surfacedSupportChurnRate: number;
  surfacedResistanceChurnRate: number;
  supportLooseMatchRate: number;
  resistanceLooseMatchRate: number;
  supportBucketLooseMatchRate: Record<SurfacedLevelBucket, number>;
  averageMatchedDriftPct: number;
};

export type LevelPersistenceValidationReport = {
  totalRunsCompared: number;
  averageSupportPersistenceRate: number;
  averageResistancePersistenceRate: number;
  averageSupportBucketPersistenceRate: Record<SurfacedLevelBucket, number>;
  averageExtensionSupportPersistenceRate: number;
  averageExtensionResistancePersistenceRate: number;
  averageSurfacedSupportChurnRate: number;
  averageSurfacedResistanceChurnRate: number;
  averageSupportLooseMatchRate: number;
  averageResistanceLooseMatchRate: number;
  averageSupportBucketLooseMatchRate: Record<SurfacedLevelBucket, number>;
  averageMatchedDriftPct: number;
  runSummaries: LevelPersistenceRunSummary[];
};

const DEFAULT_PRICE_TOLERANCE_PCT = 0.0125;
const DEFAULT_PRICE_TOLERANCE_ABSOLUTE = 0.015;
const DEFAULT_LOOSE_MATCH_TOLERANCE_RATIO = 0.5;

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4));
}

function surfacedSupportZones(output: LevelEngineOutput): FinalLevelZone[] {
  return [...output.majorSupport, ...output.intermediateSupport, ...output.intradaySupport];
}

function surfacedResistanceZones(output: LevelEngineOutput): FinalLevelZone[] {
  return [...output.majorResistance, ...output.intermediateResistance, ...output.intradayResistance];
}

function surfacedSupportZonesForBucket(
  output: LevelEngineOutput,
  bucket: SurfacedLevelBucket,
): FinalLevelZone[] {
  if (bucket === "daily") {
    return output.majorSupport;
  }

  if (bucket === "4h") {
    return output.intermediateSupport;
  }

  return output.intradaySupport;
}

function priceTolerance(price: number, options: LevelPersistenceValidatorOptions): number {
  const pct = options.priceTolerancePct ?? DEFAULT_PRICE_TOLERANCE_PCT;
  const absolute = options.priceToleranceAbsolute ?? DEFAULT_PRICE_TOLERANCE_ABSOLUTE;
  return Math.max(price * pct, absolute);
}

function sortForMatching(
  zones: FinalLevelZone[],
  kind: "support" | "resistance",
): FinalLevelZone[] {
  return [...zones].sort((left, right) =>
    kind === "support"
      ? right.representativePrice - left.representativePrice
      : left.representativePrice - right.representativePrice,
  );
}

function driftPct(leftPrice: number, rightPrice: number): number {
  return Math.abs(leftPrice - rightPrice) / Math.max(Math.max(leftPrice, rightPrice), 0.0001);
}

function looseMatchToleranceRatio(options: LevelPersistenceValidatorOptions): number {
  return options.looseMatchToleranceRatio ?? DEFAULT_LOOSE_MATCH_TOLERANCE_RATIO;
}

function matchZones(
  previous: FinalLevelZone[],
  next: FinalLevelZone[],
  kind: "support" | "resistance",
  options: LevelPersistenceValidatorOptions,
): { matchedCount: number; looseMatchCount: number; driftPcts: number[] } {
  const remaining = sortForMatching(next, kind);
  const driftPcts: number[] = [];
  let matchedCount = 0;
  let looseMatchCount = 0;

  for (const priorZone of sortForMatching(previous, kind)) {
    const tolerance = priceTolerance(priorZone.representativePrice, options);
    const matchIndex = remaining.findIndex(
      (candidate) =>
        Math.abs(candidate.representativePrice - priorZone.representativePrice) <= tolerance,
    );

    if (matchIndex < 0) {
      continue;
    }

    const [matchedZone] = remaining.splice(matchIndex, 1);
    const drift = driftPct(priorZone.representativePrice, matchedZone!.representativePrice);
    matchedCount += 1;
    driftPcts.push(drift);

    const tolerancePct = tolerance / Math.max(priorZone.representativePrice, 0.0001);
    if (tolerancePct > 0 && drift / tolerancePct >= looseMatchToleranceRatio(options)) {
      looseMatchCount += 1;
    }
  }

  return { matchedCount, looseMatchCount, driftPcts };
}

function persistenceRate(previousCount: number, matchedCount: number): number {
  if (previousCount === 0) {
    return 1;
  }

  return Number((matchedCount / previousCount).toFixed(4));
}

function looseMatchRate(matchedCount: number, looseMatchCount: number): number {
  if (matchedCount === 0) {
    return 0;
  }

  return Number((looseMatchCount / matchedCount).toFixed(4));
}

function emptyBucketRates(): Record<SurfacedLevelBucket, number> {
  return {
    daily: 0,
    "4h": 0,
    "5m": 0,
  };
}

export function validateLevelPersistence(
  outputs: LevelEngineOutput[],
  options: LevelPersistenceValidatorOptions = {},
): LevelPersistenceValidationReport {
  if (outputs.length < 2) {
    return {
      totalRunsCompared: 0,
      averageSupportPersistenceRate: 0,
      averageResistancePersistenceRate: 0,
      averageSupportBucketPersistenceRate: emptyBucketRates(),
      averageExtensionSupportPersistenceRate: 0,
      averageExtensionResistancePersistenceRate: 0,
      averageSurfacedSupportChurnRate: 0,
      averageSurfacedResistanceChurnRate: 0,
      averageSupportLooseMatchRate: 0,
      averageResistanceLooseMatchRate: 0,
      averageSupportBucketLooseMatchRate: emptyBucketRates(),
      averageMatchedDriftPct: 0,
      runSummaries: [],
    };
  }

  const runSummaries: LevelPersistenceRunSummary[] = [];

  for (let index = 1; index < outputs.length; index += 1) {
    const previous = outputs[index - 1]!;
    const current = outputs[index]!;

    const previousSupport = surfacedSupportZones(previous);
    const currentSupport = surfacedSupportZones(current);
    const previousResistance = surfacedResistanceZones(previous);
    const currentResistance = surfacedResistanceZones(current);
    const previousExtensionSupport = previous.extensionLevels.support;
    const currentExtensionSupport = current.extensionLevels.support;
    const previousExtensionResistance = previous.extensionLevels.resistance;
    const currentExtensionResistance = current.extensionLevels.resistance;
    const supportBucketMatches = {
      daily: matchZones(
        surfacedSupportZonesForBucket(previous, "daily"),
        surfacedSupportZonesForBucket(current, "daily"),
        "support",
        options,
      ),
      "4h": matchZones(
        surfacedSupportZonesForBucket(previous, "4h"),
        surfacedSupportZonesForBucket(current, "4h"),
        "support",
        options,
      ),
      "5m": matchZones(
        surfacedSupportZonesForBucket(previous, "5m"),
        surfacedSupportZonesForBucket(current, "5m"),
        "support",
        options,
      ),
    };

    const supportMatches = matchZones(previousSupport, currentSupport, "support", options);
    const resistanceMatches = matchZones(previousResistance, currentResistance, "resistance", options);
    const extensionSupportMatches = matchZones(
      previousExtensionSupport,
      currentExtensionSupport,
      "support",
      options,
    );
    const extensionResistanceMatches = matchZones(
      previousExtensionResistance,
      currentExtensionResistance,
      "resistance",
      options,
    );

    const supportPersistenceRate = persistenceRate(previousSupport.length, supportMatches.matchedCount);
    const resistancePersistenceRate = persistenceRate(
      previousResistance.length,
      resistanceMatches.matchedCount,
    );
    const extensionSupportPersistenceRate = persistenceRate(
      previousExtensionSupport.length,
      extensionSupportMatches.matchedCount,
    );
    const extensionResistancePersistenceRate = persistenceRate(
      previousExtensionResistance.length,
      extensionResistanceMatches.matchedCount,
    );

    runSummaries.push({
      fromGeneratedAt: previous.generatedAt,
      toGeneratedAt: current.generatedAt,
      supportPersistenceRate,
      resistancePersistenceRate,
      supportBucketPersistenceRate: {
        daily: persistenceRate(
          surfacedSupportZonesForBucket(previous, "daily").length,
          supportBucketMatches.daily.matchedCount,
        ),
        "4h": persistenceRate(
          surfacedSupportZonesForBucket(previous, "4h").length,
          supportBucketMatches["4h"].matchedCount,
        ),
        "5m": persistenceRate(
          surfacedSupportZonesForBucket(previous, "5m").length,
          supportBucketMatches["5m"].matchedCount,
        ),
      },
      extensionSupportPersistenceRate,
      extensionResistancePersistenceRate,
      surfacedSupportChurnRate: Number((1 - supportPersistenceRate).toFixed(4)),
      surfacedResistanceChurnRate: Number((1 - resistancePersistenceRate).toFixed(4)),
      supportLooseMatchRate: looseMatchRate(
        supportMatches.matchedCount,
        supportMatches.looseMatchCount,
      ),
      resistanceLooseMatchRate: looseMatchRate(
        resistanceMatches.matchedCount,
        resistanceMatches.looseMatchCount,
      ),
      supportBucketLooseMatchRate: {
        daily: looseMatchRate(
          supportBucketMatches.daily.matchedCount,
          supportBucketMatches.daily.looseMatchCount,
        ),
        "4h": looseMatchRate(
          supportBucketMatches["4h"].matchedCount,
          supportBucketMatches["4h"].looseMatchCount,
        ),
        "5m": looseMatchRate(
          supportBucketMatches["5m"].matchedCount,
          supportBucketMatches["5m"].looseMatchCount,
        ),
      },
      averageMatchedDriftPct: average([
        ...supportMatches.driftPcts,
        ...resistanceMatches.driftPcts,
        ...extensionSupportMatches.driftPcts,
        ...extensionResistanceMatches.driftPcts,
      ]),
    });
  }

  return {
    totalRunsCompared: runSummaries.length,
    averageSupportPersistenceRate: average(runSummaries.map((summary) => summary.supportPersistenceRate)),
    averageResistancePersistenceRate: average(
      runSummaries.map((summary) => summary.resistancePersistenceRate),
    ),
    averageSupportBucketPersistenceRate: {
      daily: average(runSummaries.map((summary) => summary.supportBucketPersistenceRate.daily)),
      "4h": average(runSummaries.map((summary) => summary.supportBucketPersistenceRate["4h"])),
      "5m": average(runSummaries.map((summary) => summary.supportBucketPersistenceRate["5m"])),
    },
    averageExtensionSupportPersistenceRate: average(
      runSummaries.map((summary) => summary.extensionSupportPersistenceRate),
    ),
    averageExtensionResistancePersistenceRate: average(
      runSummaries.map((summary) => summary.extensionResistancePersistenceRate),
    ),
    averageSurfacedSupportChurnRate: average(
      runSummaries.map((summary) => summary.surfacedSupportChurnRate),
    ),
    averageSurfacedResistanceChurnRate: average(
      runSummaries.map((summary) => summary.surfacedResistanceChurnRate),
    ),
    averageSupportLooseMatchRate: average(
      runSummaries.map((summary) => summary.supportLooseMatchRate),
    ),
    averageResistanceLooseMatchRate: average(
      runSummaries.map((summary) => summary.resistanceLooseMatchRate),
    ),
    averageSupportBucketLooseMatchRate: {
      daily: average(runSummaries.map((summary) => summary.supportBucketLooseMatchRate.daily)),
      "4h": average(runSummaries.map((summary) => summary.supportBucketLooseMatchRate["4h"])),
      "5m": average(runSummaries.map((summary) => summary.supportBucketLooseMatchRate["5m"])),
    },
    averageMatchedDriftPct: average(runSummaries.map((summary) => summary.averageMatchedDriftPct)),
    runSummaries,
  };
}

export function formatLevelPersistenceReport(
  report: LevelPersistenceValidationReport,
): string[] {
  const lines = [
    `[LevelValidation] Runs compared: ${report.totalRunsCompared}`,
    `[LevelValidation] Surfaced persistence | support=${report.averageSupportPersistenceRate.toFixed(4)} | resistance=${report.averageResistancePersistenceRate.toFixed(4)}`,
    `[LevelValidation] Support bucket persistence | daily=${report.averageSupportBucketPersistenceRate.daily.toFixed(4)} | 4h=${report.averageSupportBucketPersistenceRate["4h"].toFixed(4)} | 5m=${report.averageSupportBucketPersistenceRate["5m"].toFixed(4)}`,
    `[LevelValidation] Extension persistence | support=${report.averageExtensionSupportPersistenceRate.toFixed(4)} | resistance=${report.averageExtensionResistancePersistenceRate.toFixed(4)}`,
    `[LevelValidation] Surfaced churn | support=${report.averageSurfacedSupportChurnRate.toFixed(4)} | resistance=${report.averageSurfacedResistanceChurnRate.toFixed(4)}`,
    `[LevelValidation] Loose surfaced matches | support=${report.averageSupportLooseMatchRate.toFixed(4)} | resistance=${report.averageResistanceLooseMatchRate.toFixed(4)}`,
    `[LevelValidation] Support bucket loose matches | daily=${report.averageSupportBucketLooseMatchRate.daily.toFixed(4)} | 4h=${report.averageSupportBucketLooseMatchRate["4h"].toFixed(4)} | 5m=${report.averageSupportBucketLooseMatchRate["5m"].toFixed(4)}`,
    `[LevelValidation] Average matched drift pct: ${report.averageMatchedDriftPct.toFixed(4)}`,
  ];

  for (const summary of report.runSummaries) {
    lines.push(
      [
        `[LevelValidation] Window ${summary.fromGeneratedAt} -> ${summary.toGeneratedAt}`,
        `surfacedSupport=${summary.supportPersistenceRate.toFixed(4)}`,
        `supportDaily=${summary.supportBucketPersistenceRate.daily.toFixed(4)}`,
        `support4h=${summary.supportBucketPersistenceRate["4h"].toFixed(4)}`,
        `support5m=${summary.supportBucketPersistenceRate["5m"].toFixed(4)}`,
        `surfacedResistance=${summary.resistancePersistenceRate.toFixed(4)}`,
        `extensionSupport=${summary.extensionSupportPersistenceRate.toFixed(4)}`,
        `extensionResistance=${summary.extensionResistancePersistenceRate.toFixed(4)}`,
        `supportChurn=${summary.surfacedSupportChurnRate.toFixed(4)}`,
        `resistanceChurn=${summary.surfacedResistanceChurnRate.toFixed(4)}`,
        `supportLoose=${summary.supportLooseMatchRate.toFixed(4)}`,
        `supportLooseDaily=${summary.supportBucketLooseMatchRate.daily.toFixed(4)}`,
        `supportLoose4h=${summary.supportBucketLooseMatchRate["4h"].toFixed(4)}`,
        `supportLoose5m=${summary.supportBucketLooseMatchRate["5m"].toFixed(4)}`,
        `resistanceLoose=${summary.resistanceLooseMatchRate.toFixed(4)}`,
        `avgDrift=${summary.averageMatchedDriftPct.toFixed(4)}`,
      ].join(" | "),
    );
  }

  return lines;
}
