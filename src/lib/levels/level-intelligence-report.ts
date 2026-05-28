import type { MarketContextFactsBundle, MarketContextProfile } from "../market-context/index.js";
import type { SessionMarketFacts } from "../session/index.js";
import type { VolumeMarketFacts, VolumeShelf } from "../volume/index.js";
import {
  buildLevelIntelligenceProfile,
  type LevelIntelligenceProfile,
} from "./level-intelligence-profile.js";
import type { FinalLevelZone, LevelEngineOutput } from "./level-types.js";

export type LevelIntelligenceReportCounts = {
  majorSupport: number;
  majorResistance: number;
  intermediateSupport: number;
  intermediateResistance: number;
  intradaySupport: number;
  intradayResistance: number;
  extensionSupport: number;
  extensionResistance: number;
  total: number;
};

export type LevelIntelligenceReportBuckets = {
  majorSupport: LevelIntelligenceProfile[];
  majorResistance: LevelIntelligenceProfile[];
  intermediateSupport: LevelIntelligenceProfile[];
  intermediateResistance: LevelIntelligenceProfile[];
  intradaySupport: LevelIntelligenceProfile[];
  intradayResistance: LevelIntelligenceProfile[];
  extensionSupport: LevelIntelligenceProfile[];
  extensionResistance: LevelIntelligenceProfile[];
};

export type LevelIntelligenceReportSafety = {
  levelOutputUnchanged: true;
  factsOnly: true;
  vwapFactsOnly: true;
  shelvesAreFactsOnly: true;
  noRuntimeBehaviorChange: true;
};

export type LevelIntelligenceReport = {
  symbol: string;
  generatedAt: number;
  referencePrice?: number;
  profiles: LevelIntelligenceProfile[];
  buckets: LevelIntelligenceReportBuckets;
  counts: LevelIntelligenceReportCounts;
  diagnostics: string[];
  safety: LevelIntelligenceReportSafety;
};

export type BuildLevelIntelligenceReportRequest = {
  output: LevelEngineOutput;
  referencePrice?: number;
  sessionFacts?: SessionMarketFacts;
  volumeFacts?: VolumeMarketFacts;
  volumeShelves?: VolumeShelf[];
  marketContext?: MarketContextProfile;
  factsBundle?: MarketContextFactsBundle;
  proximityThresholdPct?: number;
};

function buildCounts(output: LevelEngineOutput): LevelIntelligenceReportCounts {
  const majorSupport = output.majorSupport.length;
  const majorResistance = output.majorResistance.length;
  const intermediateSupport = output.intermediateSupport.length;
  const intermediateResistance = output.intermediateResistance.length;
  const intradaySupport = output.intradaySupport.length;
  const intradayResistance = output.intradayResistance.length;
  const extensionSupport = output.extensionLevels.support.length;
  const extensionResistance = output.extensionLevels.resistance.length;

  return {
    majorSupport,
    majorResistance,
    intermediateSupport,
    intermediateResistance,
    intradaySupport,
    intradayResistance,
    extensionSupport,
    extensionResistance,
    total:
      majorSupport +
      majorResistance +
      intermediateSupport +
      intermediateResistance +
      intradaySupport +
      intradayResistance +
      extensionSupport +
      extensionResistance,
  };
}

function resolveReferencePrice(request: BuildLevelIntelligenceReportRequest): number | undefined {
  return (
    request.referencePrice ??
    request.output.metadata.referencePrice ??
    request.factsBundle?.referencePrice ??
    request.sessionFacts?.currentPrice
  );
}

function buildBucketProfiles(
  levels: FinalLevelZone[],
  request: BuildLevelIntelligenceReportRequest,
  referencePrice: number | undefined,
): LevelIntelligenceProfile[] {
  return levels.map((level) =>
    buildLevelIntelligenceProfile({
      level,
      referencePrice,
      sessionFacts: request.sessionFacts,
      volumeFacts: request.volumeFacts,
      volumeShelves: request.volumeShelves,
      marketContext: request.marketContext,
      factsBundle: request.factsBundle,
      proximityThresholdPct: request.proximityThresholdPct,
    }),
  );
}

function flattenBuckets(buckets: LevelIntelligenceReportBuckets): LevelIntelligenceProfile[] {
  return [
    ...buckets.majorSupport,
    ...buckets.majorResistance,
    ...buckets.intermediateSupport,
    ...buckets.intermediateResistance,
    ...buckets.intradaySupport,
    ...buckets.intradayResistance,
    ...buckets.extensionSupport,
    ...buckets.extensionResistance,
  ];
}

function collectDiagnostics(profiles: LevelIntelligenceProfile[]): string[] {
  return [...new Set(profiles.flatMap((profile) => profile.diagnostics))];
}

export function buildLevelIntelligenceReport(
  request: BuildLevelIntelligenceReportRequest,
): LevelIntelligenceReport {
  const { output } = request;
  const referencePrice = resolveReferencePrice(request);
  const buckets: LevelIntelligenceReportBuckets = {
    majorSupport: buildBucketProfiles(output.majorSupport, request, referencePrice),
    majorResistance: buildBucketProfiles(output.majorResistance, request, referencePrice),
    intermediateSupport: buildBucketProfiles(output.intermediateSupport, request, referencePrice),
    intermediateResistance: buildBucketProfiles(output.intermediateResistance, request, referencePrice),
    intradaySupport: buildBucketProfiles(output.intradaySupport, request, referencePrice),
    intradayResistance: buildBucketProfiles(output.intradayResistance, request, referencePrice),
    extensionSupport: buildBucketProfiles(output.extensionLevels.support, request, referencePrice),
    extensionResistance: buildBucketProfiles(output.extensionLevels.resistance, request, referencePrice),
  };
  const profiles = flattenBuckets(buckets);

  return {
    symbol: output.symbol,
    generatedAt: output.generatedAt,
    referencePrice,
    profiles,
    buckets,
    counts: buildCounts(output),
    diagnostics: collectDiagnostics(profiles),
    safety: {
      levelOutputUnchanged: true,
      factsOnly: true,
      vwapFactsOnly: true,
      shelvesAreFactsOnly: true,
      noRuntimeBehaviorChange: true,
    },
  };
}
