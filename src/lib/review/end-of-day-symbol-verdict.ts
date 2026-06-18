import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  buildDailyTraderReviewReport,
  type DailyTraderReviewSymbol,
} from "./daily-trader-review.js";
import { generateExecutionRelationReplayReport } from "./execution-relation-replay-report.js";
import { generateFirstSnapshotTradeMapAudit } from "./first-snapshot-trade-map-audit.js";
import { generateMissedMeaningfulMoveAudit } from "./missed-meaningful-move-audit.js";
import { buildMarketStructureCalibrationReport } from "./market-structure-calibration-report.js";
import { buildAdvancedCandleContextReport } from "./advanced-candle-context-report.js";
import { generateProviderComparisonReadinessReport } from "./provider-comparison-readiness-report.js";
import { generateWarehouseVolumeActivityReport } from "./warehouse-volume-activity-report.js";
import type { CandleProviderName } from "../support-resistance/index.js";

type AuditRow = {
  operation?: string;
  status?: string;
  timestamp?: number;
  symbol?: string;
  title?: string;
  body?: string;
  bodyPreview?: string;
  messageKind?: string;
  noLevelReason?: string;
  whyPosted?: string;
  sourceTimestamp?: number;
};

type EvidenceExample = {
  label: string;
  timestampIso?: string | null;
  reason: string;
  excerpt?: string | null;
};

export type SymbolVerdictLabel = "good" | "watch" | "needs_work" | "needs_candle_audit";

export type EndOfDaySymbolVerdict = {
  symbol: string;
  overall: SymbolVerdictLabel;
  reviewQuestions: {
    firstPostGaveGoodMap: boolean | null;
    postedTooMuch: boolean;
    missedMeaningfulMove: boolean | null;
    levelsCompleteEnough: boolean | null;
    traderWordingClear: boolean;
    needsCacheOrProviderWork: boolean;
    advancedContextTrusted: boolean | null;
  };
  firstPostTradeMap: {
    verdict: SymbolVerdictLabel;
    reason: string;
    excerpt: string | null;
  };
  postVolume: {
    verdict: SymbolVerdictLabel;
    reason: string;
    postCount: number;
    expectedMax: number;
  };
  missedMeaningfulMove: {
    verdict: SymbolVerdictLabel;
    reason: string;
  };
  levelCompleteness: {
    verdict: SymbolVerdictLabel;
    reason: string;
  };
  traderWording: {
    verdict: SymbolVerdictLabel;
    reason: string;
  };
  candleEvidence?: {
    firstSnapshotScore: number | null;
    executionRelationUsefulContext: number;
    executionRelationMissingEvidence: number;
    missingForwardResistance: number;
    missedMeaningfulMoves: number;
    majorMissedMeaningfulMoves: number;
    volumeMayHelp: number;
    volumeShouldStayHidden: number;
    firstSnapshotFullTraderMap: boolean | null;
    firstSnapshotMapFailures: string[];
    marketStructureVerdict: string | null;
    marketStructureSameRepeats: number;
    marketStructureReasons: string[];
    advancedContextStatus: string | null;
    advancedContextMissingFacts: string[];
    providerReadinessWarnings: string[];
  };
  evidenceExamples?: EvidenceExample[];
  actionItems: string[];
};

export type EndOfDaySymbolVerdictReport = {
  generatedAt: string;
  sourceAuditPath: string;
  totals: {
    symbols: number;
    good: number;
    watch: number;
    needsWork: number;
    needsCandleAudit: number;
  };
  symbols: EndOfDaySymbolVerdict[];
};

export type BuildEndOfDaySymbolVerdictWithEvidenceOptions = {
  auditPath: string;
  cacheDirectoryPath?: string;
  provider?: CandleProviderName;
  comparisonProvider?: CandleProviderName;
};

export type WriteEndOfDaySymbolVerdictWithEvidenceOptions =
  BuildEndOfDaySymbolVerdictWithEvidenceOptions & {
    jsonPath: string;
    markdownPath: string;
  };

function readRows(path: string): AuditRow[] {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as AuditRow];
      } catch {
        return [];
      }
    });
}

function isPosted(row: AuditRow): boolean {
  return (
    (row.status === "posted" || row.status === "success") &&
    ["post_alert", "post_level_snapshot", "post_level_extension"].includes(String(row.operation))
  );
}

function symbolOf(row: AuditRow): string {
  return row.symbol?.trim().toUpperCase() || "UNKNOWN";
}

function rowText(row: AuditRow): string {
  return [row.title, row.body, row.bodyPreview].filter(Boolean).join("\n").trim();
}

function excerpt(value: string, maxLength = 360): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength - 3)}...`;
}

function firstPostVerdict(rows: AuditRow[]): EndOfDaySymbolVerdict["firstPostTradeMap"] {
  const first = rows.find((row) => row.operation === "post_level_snapshot") ?? rows[0];
  if (!first) {
    return {
      verdict: "needs_work",
      reason: "No visible first post was found for this symbol.",
      excerpt: null,
    };
  }

  const text = rowText(first);
  const hasTradeMap = /Trade map:|What price is doing now:/i.test(text);
  const hasBothSides = /Resistance:/i.test(text) && /Support:/i.test(text);
  const hasPracticalContext = /support that matters|cleaner above|current structure|closest levels/i.test(text);
  if (hasTradeMap && hasBothSides && hasPracticalContext) {
    return {
      verdict: "good",
      reason: "First post included a readable trade map and both support/resistance context.",
      excerpt: excerpt(text),
    };
  }
  if (hasBothSides) {
    return {
      verdict: "watch",
      reason: "First post included support/resistance, but the practical trade map could be clearer.",
      excerpt: excerpt(text),
    };
  }
  return {
    verdict: "needs_work",
    reason: "First post did not clearly frame both support and resistance for a trader.",
    excerpt: excerpt(text),
  };
}

function postVolumeVerdict(symbol: DailyTraderReviewSymbol): EndOfDaySymbolVerdict["postVolume"] {
  if (symbol.budgetStatus === "within_budget") {
    return {
      verdict: "good",
      reason: "Post count stayed within the expected budget for this symbol behavior.",
      postCount: symbol.postCount,
      expectedMax: symbol.expectedPostBudgetMax,
    };
  }
  if (symbol.budgetStatus === "watch") {
    return {
      verdict: "watch",
      reason: "Post count was above ideal but not clearly excessive.",
      postCount: symbol.postCount,
      expectedMax: symbol.expectedPostBudgetMax,
    };
  }
  return {
    verdict: "needs_work",
    reason: "Post count exceeded the expected trader-useful budget.",
    postCount: symbol.postCount,
    expectedMax: symbol.expectedPostBudgetMax,
  };
}

function missedMoveVerdict(symbol: DailyTraderReviewSymbol): EndOfDaySymbolVerdict["missedMeaningfulMove"] {
  if (symbol.latePostCount > 0) {
    return {
      verdict: "watch",
      reason: `${symbol.latePostCount} posts were late enough to review against candle timing.`,
    };
  }
  if (symbol.noLevelCount > 0) {
    return {
      verdict: "needs_candle_audit",
      reason: "Missing next-level context appeared in saved posts; run missed-move/level audit against candles.",
    };
  }
  return {
    verdict: "needs_candle_audit",
    reason: "Saved Discord rows alone cannot prove no meaningful move was missed; confirm with the candle-backed missed-move audit.",
  };
}

function levelCompletenessVerdict(symbol: DailyTraderReviewSymbol): EndOfDaySymbolVerdict["levelCompleteness"] {
  if (symbol.noLevelCount > 0) {
    return {
      verdict: "needs_work",
      reason: `${symbol.noLevelCount} posts had missing or unavailable next-level context.`,
    };
  }
  if (symbol.mainSupport === null || symbol.mainResistance === null) {
    return {
      verdict: "watch",
      reason: "Saved posts did not expose both a main support and main resistance reference.",
    };
  }
  return {
    verdict: "good",
    reason: "Saved posts exposed usable support/resistance context without missing-level wording.",
  };
}

function traderWordingVerdict(symbol: DailyTraderReviewSymbol): EndOfDaySymbolVerdict["traderWording"] {
  const worstReasons = symbol.worstExamples.map((example) => example.reason).join(" ");
  if (/missing next-level|weak probe|late delivery/i.test(worstReasons) || symbol.weakProbeCount >= 3) {
    return {
      verdict: "watch",
      reason: "Some examples need trader-readability review, mostly around weak probes, missing context, or timing.",
    };
  }
  return {
    verdict: "good",
    reason: "Representative saved wording looked trader-facing from the daily review evidence.",
  };
}

function combineVerdicts(verdicts: SymbolVerdictLabel[]): SymbolVerdictLabel {
  if (verdicts.includes("needs_work")) {
    return "needs_work";
  }
  if (verdicts.includes("watch")) {
    return "watch";
  }
  if (verdicts.includes("needs_candle_audit")) {
    return "needs_candle_audit";
  }
  return "good";
}

function actionItems(verdict: EndOfDaySymbolVerdict): string[] {
  const items: string[] = [];
  if (verdict.firstPostTradeMap.verdict !== "good") {
    items.push("Review first-post trade map wording and level context.");
  }
  if (verdict.postVolume.verdict !== "good") {
    items.push("Replay current post policy for repeated same-area noise.");
  }
  if (verdict.missedMeaningfulMove.verdict === "needs_candle_audit") {
    items.push("Run candle-backed missed meaningful move audit.");
  }
  if (verdict.levelCompleteness.verdict !== "good") {
    items.push("Run level quality audit for missing/wide ladder context.");
  }
  if (verdict.traderWording.verdict !== "good") {
    items.push("Review saved wording examples for trader clarity.");
  }
  return items;
}

export function buildEndOfDaySymbolVerdictReport(auditPath: string): EndOfDaySymbolVerdictReport {
  const daily = buildDailyTraderReviewReport(auditPath);
  const rows = readRows(auditPath)
    .filter((row) => row.symbol && isPosted(row))
    .sort((left, right) => (left.timestamp ?? 0) - (right.timestamp ?? 0));
  const rowsBySymbol = new Map<string, AuditRow[]>();
  for (const row of rows) {
    const symbol = symbolOf(row);
    rowsBySymbol.set(symbol, [...(rowsBySymbol.get(symbol) ?? []), row]);
  }

  const symbols = daily.symbols.map((symbolReport) => {
    const firstPostTradeMap = firstPostVerdict(rowsBySymbol.get(symbolReport.symbol) ?? []);
    const postVolume = postVolumeVerdict(symbolReport);
    const missedMeaningfulMove = missedMoveVerdict(symbolReport);
    const levelCompleteness = levelCompletenessVerdict(symbolReport);
    const traderWording = traderWordingVerdict(symbolReport);
    const overall = combineVerdicts([
      firstPostTradeMap.verdict,
      postVolume.verdict,
      missedMeaningfulMove.verdict,
      levelCompleteness.verdict,
      traderWording.verdict,
    ]);
    const verdict: EndOfDaySymbolVerdict = {
      symbol: symbolReport.symbol,
      overall,
      reviewQuestions: buildReviewQuestions({
        firstPostTradeMap,
        postVolume,
        missedMeaningfulMove,
        levelCompleteness,
        traderWording,
      }),
      firstPostTradeMap,
      postVolume,
      missedMeaningfulMove,
      levelCompleteness,
      traderWording,
      actionItems: [],
    };
    verdict.actionItems = actionItems(verdict);
    return verdict;
  });

  return {
    generatedAt: new Date().toISOString(),
    sourceAuditPath: auditPath,
    totals: {
      symbols: symbols.length,
      good: symbols.filter((symbol) => symbol.overall === "good").length,
      watch: symbols.filter((symbol) => symbol.overall === "watch").length,
      needsWork: symbols.filter((symbol) => symbol.overall === "needs_work").length,
      needsCandleAudit: symbols.filter((symbol) => symbol.overall === "needs_candle_audit").length,
    },
    symbols,
  };
}

function mergeEvidenceActionItems(verdict: EndOfDaySymbolVerdict): string[] {
  const items = [...verdict.actionItems];
  const evidence = verdict.candleEvidence;
  if (!evidence) {
    return items;
  }
  if (evidence.majorMissedMeaningfulMoves > 0 || evidence.missedMeaningfulMoves > 0) {
    items.push("Review missed-move candidates against saved candles before tightening post suppression further.");
  }
  if (evidence.missingForwardResistance > 0) {
    items.push("Review forward resistance evidence for no-next-level or open-air wording.");
  }
  if (evidence.executionRelationMissingEvidence > 0) {
    items.push("Backfill missing candles so execution-level relation replay can prove the post context.");
  }
  if (evidence.volumeMayHelp > 0) {
    items.push("Review whether quiet volume/activity context would have made existing alerts clearer.");
  }
  if (evidence.firstSnapshotFullTraderMap === false) {
    items.push("Improve the first snapshot so it reads as a practical trader map, not just a level list.");
  }
  if (evidence.marketStructureVerdict === "watch_structure_chop") {
    items.push("Use market-structure calibration before allowing structure to drive suppression for this symbol.");
  }
  if (evidence.advancedContextStatus && evidence.advancedContextStatus !== "ready") {
    items.push("Backfill or inspect cached candles so advanced candle context can be built for this symbol.");
  }
  if (evidence.providerReadinessWarnings.length > 0) {
    items.push("Review provider readiness warnings before trusting a provider swap for this symbol.");
  }
  return [...new Set(items)];
}

function firstSnapshotFullTraderMap(first: ReturnType<typeof generateFirstSnapshotTradeMapAudit>["symbols"][number] | undefined): boolean | null {
  if (!first) {
    return null;
  }
  const checks = first.mapChecks;
  return checks.hasCurrentPrice &&
    checks.hasCurrentRead &&
    checks.hasClosestLevels &&
    checks.hasLineByLineLevels &&
    checks.hasSupportStrength &&
    checks.hasResistanceStrength &&
    checks.hasPracticalSupport &&
    checks.hasPracticalResistance &&
    checks.hasRoomOrRangeContext &&
    !checks.hasAdvisoryLanguage &&
    !checks.hasPennyRiskLanguage &&
    !checks.hasUnsupportedNoResistanceLanguage;
}

function firstSnapshotMapFailures(first: ReturnType<typeof generateFirstSnapshotTradeMapAudit>["symbols"][number] | undefined): string[] {
  if (!first) {
    return ["no first snapshot audit evidence"];
  }
  const checks = first.mapChecks;
  const failures: string[] = [];
  if (!checks.hasCurrentPrice) failures.push("missing current price");
  if (!checks.hasCurrentRead) failures.push("missing current read");
  if (!checks.hasClosestLevels) failures.push("missing closest levels");
  if (!checks.hasLineByLineLevels) failures.push("levels not line-by-line");
  if (!checks.hasSupportStrength) failures.push("missing support strength labels");
  if (!checks.hasResistanceStrength) failures.push("missing resistance strength labels");
  if (!checks.hasPracticalSupport) failures.push("missing practical support context");
  if (!checks.hasPracticalResistance) failures.push("missing practical resistance context");
  if (!checks.hasRoomOrRangeContext) failures.push("missing room/range context");
  if (checks.hasAdvisoryLanguage) failures.push("contains advisory language");
  if (checks.hasPennyRiskLanguage) failures.push("contains penny-risk wording");
  if (checks.hasUnsupportedNoResistanceLanguage) failures.push("contains unsupported no-resistance wording");
  return failures;
}

function advancedContextMissingFacts(
  advanced: Awaited<ReturnType<typeof buildAdvancedCandleContextReport>>["symbols"][number] | undefined,
): string[] {
  if (!advanced) {
    return ["no advanced candle context evidence"];
  }
  const missing: string[] = [];
  if (advanced.status !== "ready") missing.push(`context ${advanced.status}: ${advanced.reason}`);
  if (!advanced.dynamicAvailability.vwap) missing.push("VWAP unavailable");
  if (!advanced.dynamicAvailability.ema9 || !advanced.dynamicAvailability.ema20) missing.push("EMA9/EMA20 unavailable");
  if (advanced.marketStructure.state === null) missing.push("market structure unavailable");
  if (advanced.traderContext.openingRange === "unavailable" || advanced.traderContext.openingRange === null) missing.push("opening range unavailable");
  if (advanced.traderContext.dataQuality === "degraded" || advanced.traderContext.dataQuality === "unusable") missing.push(`data quality ${advanced.traderContext.dataQuality}`);
  return missing;
}

function providerWarnings(
  provider: Awaited<ReturnType<typeof generateProviderComparisonReadinessReport>>["symbols"][number] | undefined,
): string[] {
  if (!provider) {
    return ["no provider comparison evidence"];
  }
  const warnings = provider.timeframeComparisons.flatMap((comparison) => comparison.missingBehavior);
  if (provider.levelComparison.status !== "compared") {
    warnings.push(`level comparison ${provider.levelComparison.status}: ${provider.levelComparison.reason}`);
  }
  if (provider.structureComparison.status !== "compared") {
    warnings.push(`structure comparison ${provider.structureComparison.status}: ${provider.structureComparison.reason}`);
  } else if (provider.structureComparison.stateMatches === false) {
    warnings.push(`structure state drift ${provider.structureComparison.primaryState} vs ${provider.structureComparison.comparisonState}`);
  }
  return [...new Set(warnings)].slice(0, 8);
}

function eodEvidenceExamples(params: {
  first?: ReturnType<typeof generateFirstSnapshotTradeMapAudit>["symbols"][number];
  execution?: Awaited<ReturnType<typeof generateExecutionRelationReplayReport>>["symbols"][number];
  volume?: ReturnType<typeof generateWarehouseVolumeActivityReport>["symbols"][number];
  missed?: ReturnType<typeof generateMissedMeaningfulMoveAudit>["symbols"][number];
}): EvidenceExample[] {
  const examples: EvidenceExample[] = [];
  if (params.first) {
    examples.push({
      label: "first_snapshot",
      timestampIso: params.first.timestampIso,
      reason: `${params.first.score.label} first-post score ${params.first.score.score}/100`,
      excerpt: params.first.score.excerpt,
    });
  }
  const executionSample =
    params.execution?.samples.find((sample) => sample.recommendation === "needs_candle_evidence") ??
    params.execution?.samples.find((sample) => sample.recommendation === "useful_context_available") ??
    params.execution?.samples[0];
  if (executionSample) {
    examples.push({
      label: "execution_relation",
      timestampIso: executionSample.timestampIso,
      reason: executionSample.reason,
      excerpt: executionSample.excerpt,
    });
  }
  const missedCandidate =
    params.missed?.candidates.find((candidate) => candidate.severity === "major") ??
    params.missed?.candidates.find((candidate) => candidate.coverage === "missed") ??
    params.missed?.candidates[0];
  if (missedCandidate) {
    examples.push({
      label: "missed_move",
      timestampIso: missedCandidate.timestampIso,
      reason: `${missedCandidate.severity} ${missedCandidate.kind}; ${missedCandidate.reason}; coverage ${missedCandidate.coverage}`,
      excerpt: missedCandidate.nearestPosts[0]?.excerpt ?? null,
    });
  }
  const volumeSample =
    params.volume?.samples.find((sample) => sample.recommendation === "may_help_existing_alert") ??
    params.volume?.samples[0];
  if (volumeSample) {
    examples.push({
      label: "volume_activity",
      timestampIso: volumeSample.timestampIso,
      reason: `${volumeSample.recommendation}; ${volumeSample.reason}`,
      excerpt: volumeSample.title ?? volumeSample.operation ?? null,
    });
  }
  return examples.slice(0, 5);
}

function buildReviewQuestions(params: {
  firstPostTradeMap: EndOfDaySymbolVerdict["firstPostTradeMap"];
  postVolume: EndOfDaySymbolVerdict["postVolume"];
  missedMeaningfulMove: EndOfDaySymbolVerdict["missedMeaningfulMove"];
  levelCompleteness: EndOfDaySymbolVerdict["levelCompleteness"];
  traderWording: EndOfDaySymbolVerdict["traderWording"];
  candleEvidence?: EndOfDaySymbolVerdict["candleEvidence"];
}): EndOfDaySymbolVerdict["reviewQuestions"] {
  const evidence = params.candleEvidence;
  return {
    firstPostGaveGoodMap:
      evidence?.firstSnapshotFullTraderMap ??
      (params.firstPostTradeMap.verdict === "good"
        ? true
        : params.firstPostTradeMap.verdict === "needs_work"
          ? false
          : null),
    postedTooMuch: params.postVolume.verdict === "needs_work",
    missedMeaningfulMove:
      evidence
        ? evidence.majorMissedMeaningfulMoves > 0 || evidence.missedMeaningfulMoves > 0
        : params.missedMeaningfulMove.verdict === "good"
          ? false
          : null,
    levelsCompleteEnough:
      params.levelCompleteness.verdict === "good"
        ? true
        : params.levelCompleteness.verdict === "needs_work"
          ? false
          : null,
    traderWordingClear: params.traderWording.verdict === "good",
    needsCacheOrProviderWork:
      (evidence?.executionRelationMissingEvidence ?? 0) > 0 ||
      (evidence?.advancedContextMissingFacts.length ?? 0) > 0 ||
      (evidence?.providerReadinessWarnings.length ?? 0) > 0,
    advancedContextTrusted: evidence
      ? evidence.advancedContextStatus === "ready" && evidence.advancedContextMissingFacts.length === 0
      : null,
  };
}

export async function buildEndOfDaySymbolVerdictReportWithEvidence(
  options: BuildEndOfDaySymbolVerdictWithEvidenceOptions,
): Promise<EndOfDaySymbolVerdictReport> {
  const base = buildEndOfDaySymbolVerdictReport(options.auditPath);
  const cacheDirectoryPath = options.cacheDirectoryPath ?? ".validation-cache/candles";
  const provider = options.provider ?? "ibkr";
  const baseSymbols = base.symbols.map((symbol) => symbol.symbol);
  const comparisonProvider = options.comparisonProvider ?? "stub";
  const [firstSnapshot, executionRelations, volumeActivity, missedMoves, structureCalibration, advancedContext, providerComparison] = await Promise.all([
    Promise.resolve(generateFirstSnapshotTradeMapAudit({ auditPath: options.auditPath })),
    generateExecutionRelationReplayReport({ auditPath: options.auditPath, cacheDirectoryPath, provider }),
    Promise.resolve(generateWarehouseVolumeActivityReport({ auditPath: options.auditPath, cacheDirectoryPath, provider })),
    Promise.resolve(generateMissedMeaningfulMoveAudit({ auditPath: options.auditPath, cacheDirectoryPath, provider })),
    Promise.resolve(buildMarketStructureCalibrationReport({
      replay: { cacheDirectory: `${cacheDirectoryPath}/${provider}`, symbols: baseSymbols, maxFilesPerSymbol: 1 },
      alignment: { auditRoot: options.auditPath, cacheDirectory: `${cacheDirectoryPath}/${provider}`, symbols: baseSymbols, auditLimit: null },
    })),
    buildAdvancedCandleContextReport({ cacheDirectoryPath, provider, symbols: baseSymbols }),
    generateProviderComparisonReadinessReport({
      cacheDirectoryPath,
      primaryProvider: provider,
      comparisonProvider,
      timeframes: ["daily", "4h", "5m"],
      symbols: baseSymbols,
    }),
  ]);

  const firstBySymbol = new Map(firstSnapshot.symbols.map((symbol) => [symbol.symbol, symbol]));
  const executionBySymbol = new Map(executionRelations.symbols.map((symbol) => [symbol.symbol, symbol]));
  const volumeBySymbol = new Map(volumeActivity.symbols.map((symbol) => [symbol.symbol, symbol]));
  const missedBySymbol = new Map(missedMoves.symbols.map((symbol) => [symbol.symbol, symbol]));
  const structureBySymbol = new Map(structureCalibration.symbols.map((symbol) => [symbol.symbol, symbol]));
  const advancedBySymbol = new Map(advancedContext.symbols.map((symbol) => [symbol.symbol, symbol]));
  const providerBySymbol = new Map(providerComparison.symbols.map((symbol) => [symbol.symbol, symbol]));

  const symbols = base.symbols.map((symbolVerdict): EndOfDaySymbolVerdict => {
    const first = firstBySymbol.get(symbolVerdict.symbol);
    const execution = executionBySymbol.get(symbolVerdict.symbol);
    const volume = volumeBySymbol.get(symbolVerdict.symbol);
    const missed = missedBySymbol.get(symbolVerdict.symbol);
    const structure = structureBySymbol.get(symbolVerdict.symbol);
    const advanced = advancedBySymbol.get(symbolVerdict.symbol);
    const providerReadiness = providerBySymbol.get(symbolVerdict.symbol);
    const candleEvidence: NonNullable<EndOfDaySymbolVerdict["candleEvidence"]> = {
      firstSnapshotScore: first?.score.score ?? null,
      executionRelationUsefulContext: execution?.usefulContextCount ?? 0,
      executionRelationMissingEvidence: execution?.needsCandleEvidenceCount ?? 0,
      missingForwardResistance: execution?.missingForwardResistanceCount ?? 0,
      missedMeaningfulMoves: missed?.missedCount ?? 0,
      majorMissedMeaningfulMoves: missed?.majorCount ?? 0,
      volumeMayHelp: volume?.wouldHelpCount ?? 0,
      volumeShouldStayHidden: volume?.shouldStayHiddenCount ?? 0,
      firstSnapshotFullTraderMap: firstSnapshotFullTraderMap(first),
      firstSnapshotMapFailures: firstSnapshotMapFailures(first),
      marketStructureVerdict: structure?.verdict ?? null,
      marketStructureSameRepeats: structure?.sameStructureRepeats ?? 0,
      marketStructureReasons: structure?.reasons ?? [],
      advancedContextStatus: advanced?.status ?? null,
      advancedContextMissingFacts: advancedContextMissingFacts(advanced),
      providerReadinessWarnings: providerWarnings(providerReadiness),
    };

    let missedMeaningfulMove = symbolVerdict.missedMeaningfulMove;
    if (candleEvidence.majorMissedMeaningfulMoves > 0) {
      missedMeaningfulMove = {
        verdict: "needs_work",
        reason: `${candleEvidence.majorMissedMeaningfulMoves} major candle-backed move candidates were not clearly covered.`,
      };
    } else if (candleEvidence.missedMeaningfulMoves > 0) {
      missedMeaningfulMove = {
        verdict: "watch",
        reason: `${candleEvidence.missedMeaningfulMoves} candle-backed move candidates need review against nearby posts.`,
      };
    } else if (missed && missed.candleCount > 0 && missed.reviewedCandleCount > 0) {
      missedMeaningfulMove = {
        verdict: "good",
        reason: "Candle-backed missed-move audit found no missed meaningful move candidates.",
      };
    }

    let levelCompleteness = symbolVerdict.levelCompleteness;
    if (candleEvidence.missingForwardResistance > 0) {
      levelCompleteness = {
        verdict: "needs_work",
        reason: `${candleEvidence.missingForwardResistance} replay samples lacked forward resistance context.`,
      };
    } else if (candleEvidence.executionRelationMissingEvidence > 0 && levelCompleteness.verdict === "good") {
      levelCompleteness = {
        verdict: "needs_candle_audit",
        reason: `${candleEvidence.executionRelationMissingEvidence} posts need more candle evidence before level completeness is proven.`,
      };
    }

    let firstPostTradeMap = symbolVerdict.firstPostTradeMap;
    if (first && first.score.label === "weak") {
      firstPostTradeMap = {
        verdict: first.score.score < 45 ? "needs_work" : "watch",
        reason: `First-snapshot trade-map score was ${first.score.score}/100 in the generated audit.`,
        excerpt: first.score.excerpt ?? firstPostTradeMap.excerpt,
      };
    } else if (candleEvidence.firstSnapshotFullTraderMap === false && firstPostTradeMap.verdict === "good") {
      firstPostTradeMap = {
        verdict: "watch",
        reason: `First snapshot missed practical map checks: ${candleEvidence.firstSnapshotMapFailures.join("; ") || "unknown"}.`,
        excerpt: first?.score.excerpt ?? firstPostTradeMap.excerpt,
      };
    }

    let traderWording = symbolVerdict.traderWording;
    if (candleEvidence.marketStructureVerdict === "watch_structure_chop" && traderWording.verdict === "good") {
      traderWording = {
        verdict: "watch",
        reason: "Market-structure calibration shows chop/watch evidence; keep structure wording and suppression conservative.",
      };
    }

    if (candleEvidence.advancedContextStatus && candleEvidence.advancedContextStatus !== "ready" && levelCompleteness.verdict === "good") {
      levelCompleteness = {
        verdict: "needs_candle_audit",
        reason: `Advanced candle context is ${candleEvidence.advancedContextStatus}; ${candleEvidence.advancedContextMissingFacts.join("; ") || "missing context details"}.`,
      };
    }

    const overall = combineVerdicts([
      firstPostTradeMap.verdict,
      symbolVerdict.postVolume.verdict,
      missedMeaningfulMove.verdict,
      levelCompleteness.verdict,
      traderWording.verdict,
    ]);
    const verdict = {
      ...symbolVerdict,
      overall,
      reviewQuestions: buildReviewQuestions({
        firstPostTradeMap,
        postVolume: symbolVerdict.postVolume,
        missedMeaningfulMove,
        levelCompleteness,
        traderWording,
        candleEvidence,
      }),
      firstPostTradeMap,
      missedMeaningfulMove,
      levelCompleteness,
      traderWording,
      candleEvidence,
      evidenceExamples: eodEvidenceExamples({ first, execution, volume, missed }),
    };
    return {
      ...verdict,
      actionItems: mergeEvidenceActionItems(verdict),
    };
  });

  return {
    ...base,
    generatedAt: new Date().toISOString(),
    symbols,
    totals: {
      symbols: symbols.length,
      good: symbols.filter((symbol) => symbol.overall === "good").length,
      watch: symbols.filter((symbol) => symbol.overall === "watch").length,
      needsWork: symbols.filter((symbol) => symbol.overall === "needs_work").length,
      needsCandleAudit: symbols.filter((symbol) => symbol.overall === "needs_candle_audit").length,
    },
  };
}

export function formatEndOfDaySymbolVerdictMarkdown(report: EndOfDaySymbolVerdictReport): string {
  const lines = [
    "# End Of Day Symbol Verdicts",
    "",
    "Operator-only verdict report answering the practical trader-review questions per symbol.",
    "",
    `Generated: ${report.generatedAt}`,
    `Source: ${report.sourceAuditPath}`,
    "",
    "## Totals",
    "",
    `- symbols: ${report.totals.symbols}`,
    `- good: ${report.totals.good}`,
    `- watch: ${report.totals.watch}`,
    `- needs work: ${report.totals.needsWork}`,
    `- needs candle audit only: ${report.totals.needsCandleAudit}`,
    "",
  ];

  for (const symbol of report.symbols.slice(0, 100)) {
    lines.push(`## ${symbol.symbol} - ${symbol.overall}`, "");
    lines.push(`- first post trade map: ${symbol.firstPostTradeMap.verdict} - ${symbol.firstPostTradeMap.reason}`);
    lines.push(`- post volume: ${symbol.postVolume.verdict} - ${symbol.postVolume.postCount}/${symbol.postVolume.expectedMax}; ${symbol.postVolume.reason}`);
    lines.push(`- missed meaningful move: ${symbol.missedMeaningfulMove.verdict} - ${symbol.missedMeaningfulMove.reason}`);
    lines.push(`- level completeness: ${symbol.levelCompleteness.verdict} - ${symbol.levelCompleteness.reason}`);
    lines.push(`- trader wording: ${symbol.traderWording.verdict} - ${symbol.traderWording.reason}`);
    lines.push(
      `- practical answers: first map ${symbol.reviewQuestions.firstPostGaveGoodMap ?? "unproven"}; too many posts ${symbol.reviewQuestions.postedTooMuch}; missed move ${symbol.reviewQuestions.missedMeaningfulMove ?? "unproven"}; levels complete ${symbol.reviewQuestions.levelsCompleteEnough ?? "unproven"}; wording clear ${symbol.reviewQuestions.traderWordingClear}; cache/provider work ${symbol.reviewQuestions.needsCacheOrProviderWork}; advanced context trusted ${symbol.reviewQuestions.advancedContextTrusted ?? "unproven"}`,
    );
    if (symbol.candleEvidence) {
      lines.push(
        `- candle evidence: first snapshot ${symbol.candleEvidence.firstSnapshotScore ?? "n/a"}/100; execution useful ${symbol.candleEvidence.executionRelationUsefulContext}; missing evidence ${symbol.candleEvidence.executionRelationMissingEvidence}; no-forward-resistance ${symbol.candleEvidence.missingForwardResistance}; missed moves ${symbol.candleEvidence.missedMeaningfulMoves}; volume may-help ${symbol.candleEvidence.volumeMayHelp}; volume hidden ${symbol.candleEvidence.volumeShouldStayHidden}`,
      );
      lines.push(
        `- map/structure/context evidence: full map ${symbol.candleEvidence.firstSnapshotFullTraderMap ?? "n/a"}; map failures ${symbol.candleEvidence.firstSnapshotMapFailures.join("; ") || "none"}; structure ${symbol.candleEvidence.marketStructureVerdict ?? "n/a"} (${symbol.candleEvidence.marketStructureSameRepeats} repeats); advanced context ${symbol.candleEvidence.advancedContextStatus ?? "n/a"}; provider warnings ${symbol.candleEvidence.providerReadinessWarnings.length}`,
      );
    }
    if (symbol.actionItems.length > 0) {
      lines.push("- action items:");
      for (const item of symbol.actionItems) {
        lines.push(`  - ${item}`);
      }
    }
    if (symbol.evidenceExamples?.length) {
      lines.push("- evidence examples:");
      for (const example of symbol.evidenceExamples) {
        lines.push(`  - ${example.label}${example.timestampIso ? ` ${example.timestampIso}` : ""}: ${example.reason}`);
        if (example.excerpt) {
          lines.push(`    - ${example.excerpt}`);
        }
      }
    }
    if (symbol.firstPostTradeMap.excerpt) {
      lines.push("", "First post excerpt:", "", `> ${symbol.firstPostTradeMap.excerpt}`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

export function writeEndOfDaySymbolVerdict(params: {
  auditPath: string;
  jsonPath: string;
  markdownPath: string;
}): EndOfDaySymbolVerdictReport {
  const report = buildEndOfDaySymbolVerdictReport(params.auditPath);
  mkdirSync(dirname(params.jsonPath), { recursive: true });
  writeFileSync(params.jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(params.markdownPath, formatEndOfDaySymbolVerdictMarkdown(report));
  return report;
}

export async function writeEndOfDaySymbolVerdictWithEvidence(
  params: WriteEndOfDaySymbolVerdictWithEvidenceOptions,
): Promise<EndOfDaySymbolVerdictReport> {
  const report = await buildEndOfDaySymbolVerdictReportWithEvidence(params);
  mkdirSync(dirname(params.jsonPath), { recursive: true });
  writeFileSync(params.jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(params.markdownPath, formatEndOfDaySymbolVerdictMarkdown(report));
  return report;
}
