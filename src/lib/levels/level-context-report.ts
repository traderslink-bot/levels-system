import type { MarketContextFactsBundle, MarketContextProfile } from "../market-context/index.js";
import type { SessionMarketFacts } from "../session/index.js";
import type { VolumeMarketFacts, VolumeShelf } from "../volume/index.js";
import {
  explainLevelContext,
  type LevelContextExplanation,
} from "./level-context-explainer.js";
import type { FinalLevelZone, LevelEngineOutput } from "./level-types.js";

export type LevelContextReportCounts = {
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

export type LevelContextReportSafety = {
  levelOutputUnchanged: true;
  factsOnlyVWAP: true;
  shelvesAreFactsOnly: true;
  noRuntimeBehaviorChange: true;
};

export type LevelContextReport = {
  symbol: string;
  generatedAt: number;
  explanations: LevelContextExplanation[];
  counts: LevelContextReportCounts;
  safety: LevelContextReportSafety;
};

export type BuildLevelContextReportRequest = {
  output: LevelEngineOutput;
  sessionFacts?: SessionMarketFacts;
  volumeFacts?: VolumeMarketFacts;
  volumeShelves?: VolumeShelf[];
  marketContext?: MarketContextProfile;
  factsBundle?: MarketContextFactsBundle;
  proximityThresholdPct?: number;
};

function runtimeLevels(output: LevelEngineOutput): FinalLevelZone[] {
  return [
    ...output.majorSupport,
    ...output.majorResistance,
    ...output.intermediateSupport,
    ...output.intermediateResistance,
    ...output.intradaySupport,
    ...output.intradayResistance,
    ...output.extensionLevels.support,
    ...output.extensionLevels.resistance,
  ];
}

function buildCounts(output: LevelEngineOutput): LevelContextReportCounts {
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

export function buildLevelContextReport(request: BuildLevelContextReportRequest): LevelContextReport {
  const { output } = request;
  const explanations = runtimeLevels(output).map((level) =>
    explainLevelContext({
      level,
      sessionFacts: request.sessionFacts,
      volumeFacts: request.volumeFacts,
      volumeShelves: request.volumeShelves,
      marketContext: request.marketContext,
      factsBundle: request.factsBundle,
      currentPrice: output.metadata.referencePrice,
      proximityThresholdPct: request.proximityThresholdPct,
    }),
  );

  return {
    symbol: output.symbol,
    generatedAt: output.generatedAt,
    explanations,
    counts: buildCounts(output),
    safety: {
      levelOutputUnchanged: true,
      factsOnlyVWAP: true,
      shelvesAreFactsOnly: true,
      noRuntimeBehaviorChange: true,
    },
  };
}
