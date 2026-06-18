import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  generateExecutionRelationReplayReport,
  type ExecutionRelationReplaySample,
} from "./execution-relation-replay-report.js";
import { buildAdvancedCandleContextReport } from "./advanced-candle-context-report.js";
import { buildAllSymbolStressReport } from "./all-symbol-stress-report.js";
import { generateFirstSnapshotTradeMapAudit } from "./first-snapshot-trade-map-audit.js";
import { buildMarketStructureCalibrationReport } from "./market-structure-calibration-report.js";
import { generateProviderComparisonReadinessReport } from "./provider-comparison-readiness-report.js";
import { buildSupportResistanceCalibrationReport } from "./support-resistance-calibration-report.js";
import { generateWhyNoPostReplayProof } from "./why-no-post-replay-proof.js";
import {
  generateWarehouseVolumeActivityReport,
  type WarehouseVolumeActivityReplaySample,
} from "./warehouse-volume-activity-report.js";
import type { CandleProviderName } from "../support-resistance/index.js";

export type CandleIntelligenceRegressionCaseType =
  | "weak_first_snapshot"
  | "volume_may_help"
  | "volume_should_hide"
  | "execution_relation_context"
  | "execution_relation_missing_evidence"
  | "missing_forward_resistance"
  | "first_snapshot_map_failure"
  | "market_structure_chop_watch"
  | "advanced_context_missing"
  | "provider_readiness_watch"
  | "quiet_may_hide_move"
  | "runtime_feed_silence"
  | "post_noise_budget_watch"
  | "support_resistance_watch"
  | "support_resistance_broken"
  | "support_resistance_unproven_coverage";

export type CandleIntelligenceRegressionCaseSeverity = "watch" | "test_candidate" | "major_candidate";

export type CandleIntelligenceRegressionCase = {
  id: string;
  type: CandleIntelligenceRegressionCaseType;
  severity: CandleIntelligenceRegressionCaseSeverity;
  symbol: string;
  timestampIso: string | null;
  reason: string;
  evidence: string;
  sourceReport: string;
};

export type CandleIntelligenceRegressionPack = {
  generatedAt: string;
  sourceAuditPath: string;
  cacheDirectoryPath: string;
  warehouseDirectoryPath: string | null;
  provider: CandleProviderName;
  totals: {
    cases: number;
    weakFirstSnapshot: number;
    volumeMayHelp: number;
    volumeShouldHide: number;
    executionRelationContext: number;
    executionRelationMissingEvidence: number;
    missingForwardResistance: number;
    firstSnapshotMapFailure: number;
    marketStructureChopWatch: number;
    advancedContextMissing: number;
    providerReadinessWatch: number;
    quietMayHideMove: number;
    runtimeFeedSilence: number;
    postNoiseBudgetWatch: number;
    supportResistanceWatch: number;
    supportResistanceBroken: number;
    supportResistanceUnprovenCoverage: number;
  };
  cases: CandleIntelligenceRegressionCase[];
};

export type GenerateCandleIntelligenceRegressionPackOptions = {
  auditPath: string;
  cacheDirectoryPath?: string;
  warehouseDirectoryPath?: string;
  provider?: CandleProviderName;
  comparisonProvider?: CandleProviderName;
  maxCasesPerType?: number;
};

export type WriteCandleIntelligenceRegressionPackOptions =
  GenerateCandleIntelligenceRegressionPackOptions & {
    jsonPath: string;
    markdownPath: string;
  };

export type CandleIntelligenceRegressionGateStatus = "pass" | "review" | "fail";

export type CandleIntelligenceRegressionGateOptions = {
  maxMajorCandidateCases?: number;
  maxWeakFirstSnapshotCases?: number;
  maxMissingForwardResistanceCases?: number;
  maxExecutionRelationMissingEvidenceCases?: number;
  maxFirstSnapshotMapFailureCases?: number;
  maxMarketStructureChopWatchCases?: number;
  maxAdvancedContextMissingCases?: number;
  maxProviderReadinessWatchCases?: number;
  maxQuietMayHideMoveCases?: number;
  maxRuntimeFeedSilenceCases?: number;
  maxPostNoiseBudgetWatchCases?: number;
  maxSupportResistanceWatchCases?: number;
  maxSupportResistanceBrokenCases?: number;
  maxSupportResistanceUnprovenCoverageCases?: number;
  requiredCaseTypes?: CandleIntelligenceRegressionCaseType[];
};

export type CandleIntelligenceRegressionGateViolation = {
  status: Exclude<CandleIntelligenceRegressionGateStatus, "pass">;
  code: string;
  reason: string;
  observed: number;
  allowed: number;
};

export type CandleIntelligenceRegressionGateResult = {
  generatedAt: string;
  status: CandleIntelligenceRegressionGateStatus;
  sourceAuditPath: string;
  totals: CandleIntelligenceRegressionPack["totals"] & {
    majorCandidateCases: number;
  };
  thresholds: Required<Omit<CandleIntelligenceRegressionGateOptions, "requiredCaseTypes">> & {
    requiredCaseTypes: CandleIntelligenceRegressionCaseType[];
  };
  violations: CandleIntelligenceRegressionGateViolation[];
};

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function timestampFromVolume(sample: WarehouseVolumeActivityReplaySample): string {
  return sample.timestampIso;
}

function evidenceFromVolume(sample: WarehouseVolumeActivityReplaySample): string {
  return `${sample.title ?? sample.eventType ?? "alert"}; ${sample.interactionKind}; label=${sample.label}; reliability=${sample.reliability}; rvol=${sample.relativeVolumeRatio ?? "n/a"}; ${sample.reason}`;
}

function evidenceFromExecution(sample: ExecutionRelationReplaySample): string {
  return `${sample.title ?? sample.operation ?? "post"}; price=${sample.price ?? "n/a"}; support=${sample.nearestSupportBelow?.price ?? "n/a"}; resistance=${sample.nearestResistanceAbove?.price ?? "n/a"}; roomAbove=${sample.roomAbovePct ?? "n/a"}; ${sample.reason}; ${sample.excerpt}`;
}

function isFullTraderMap(item: ReturnType<typeof generateFirstSnapshotTradeMapAudit>["symbols"][number]): boolean {
  const checks = item.mapChecks;
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

function mapFailureEvidence(item: ReturnType<typeof generateFirstSnapshotTradeMapAudit>["symbols"][number]): string {
  const checks = item.mapChecks;
  const failures = [
    !checks.hasCurrentPrice ? "missing current price" : null,
    !checks.hasCurrentRead ? "missing current read" : null,
    !checks.hasClosestLevels ? "missing closest levels" : null,
    !checks.hasLineByLineLevels ? "not line-by-line" : null,
    !checks.hasSupportStrength ? "missing support strength" : null,
    !checks.hasResistanceStrength ? "missing resistance strength" : null,
    !checks.hasPracticalSupport ? "missing practical support" : null,
    !checks.hasPracticalResistance ? "missing practical resistance" : null,
    !checks.hasRoomOrRangeContext ? "missing room/range context" : null,
    checks.hasAdvisoryLanguage ? "advisory wording" : null,
    checks.hasPennyRiskLanguage ? "penny-risk wording" : null,
    checks.hasUnsupportedNoResistanceLanguage ? "unsupported no-resistance wording" : null,
  ].filter(Boolean);
  return `${item.title ?? "snapshot"}; failures=${failures.join("; ") || "none"}; score=${item.score.score}/100; excerpt=${item.score.excerpt ?? "n/a"}`;
}

export async function generateCandleIntelligenceRegressionPack(
  options: GenerateCandleIntelligenceRegressionPackOptions,
): Promise<CandleIntelligenceRegressionPack> {
  const cacheDirectoryPath = options.cacheDirectoryPath ?? ".validation-cache/candles";
  const warehouseDirectoryPath = options.warehouseDirectoryPath ?? null;
  const candleEvidenceDirectoryPath = warehouseDirectoryPath ?? cacheDirectoryPath;
  const provider = options.provider ?? "ibkr";
  const comparisonProvider = options.comparisonProvider ?? "stub";
  const maxCasesPerType = Math.max(1, options.maxCasesPerType ?? 25);
  const firstSnapshot = generateFirstSnapshotTradeMapAudit({ auditPath: options.auditPath });
  const packSymbols = firstSnapshot.symbols.map((item) => item.symbol);
  const volume = generateWarehouseVolumeActivityReport({
    auditPath: options.auditPath,
    cacheDirectoryPath: candleEvidenceDirectoryPath,
    provider,
  });
  const execution = await generateExecutionRelationReplayReport({
    auditPath: options.auditPath,
    cacheDirectoryPath: candleEvidenceDirectoryPath,
    provider,
  });
  const [structure, advancedContext, providerComparison, allSymbolStress] = await Promise.all([
    Promise.resolve(buildMarketStructureCalibrationReport({
      replay: { cacheDirectory: `${candleEvidenceDirectoryPath}/${provider}`, symbols: packSymbols, maxFilesPerSymbol: 1 },
      alignment: { auditRoot: options.auditPath, cacheDirectory: `${candleEvidenceDirectoryPath}/${provider}`, symbols: packSymbols, auditLimit: null },
    })),
    buildAdvancedCandleContextReport({ cacheDirectoryPath: candleEvidenceDirectoryPath, provider, symbols: packSymbols }),
    generateProviderComparisonReadinessReport({
      cacheDirectoryPath: candleEvidenceDirectoryPath,
      primaryProvider: provider,
      comparisonProvider,
      timeframes: ["daily", "4h", "5m"],
      symbols: packSymbols,
    }),
    buildAllSymbolStressReport(options.auditPath),
  ]);
  const supportResistance = await buildSupportResistanceCalibrationReport({
    auditPath: options.auditPath,
    cacheDirectoryPath,
    warehouseDirectoryPath: warehouseDirectoryPath ?? undefined,
    provider,
  });
  const whyNoPost = generateWhyNoPostReplayProof({
    auditPath: options.auditPath,
    cacheDirectoryPath,
    warehouseDirectoryPath: warehouseDirectoryPath ?? undefined,
    provider,
    includeReplayEvidence: true,
  });
  const cases: CandleIntelligenceRegressionCase[] = [];

  for (const item of firstSnapshot.symbols
    .filter((symbol) => symbol.score.label === "weak")
    .slice(0, maxCasesPerType)) {
    cases.push({
      id: `weak-first-snapshot-${slug(item.symbol)}`,
      type: "weak_first_snapshot",
      severity: item.score.score < 45 ? "major_candidate" : "watch",
      symbol: item.symbol,
      timestampIso: item.timestampIso,
      reason: `first snapshot scored ${item.score.score}/100`,
      evidence: `${item.title ?? "snapshot"}; issues=${item.score.issues.join("; ") || "none"}; excerpt=${item.score.excerpt ?? "n/a"}`,
      sourceReport: "first-snapshot-trade-map-audit",
    });
  }

  for (const item of firstSnapshot.symbols
    .filter((symbol) => !isFullTraderMap(symbol))
    .slice(0, maxCasesPerType)) {
    cases.push({
      id: `first-snapshot-map-failure-${slug(item.symbol)}`,
      type: "first_snapshot_map_failure",
      severity: item.mapChecks.hasAdvisoryLanguage || item.mapChecks.hasUnsupportedNoResistanceLanguage
        ? "major_candidate"
        : "watch",
      symbol: item.symbol,
      timestampIso: item.timestampIso,
      reason: "first snapshot did not pass the full trader-map evidence checklist",
      evidence: mapFailureEvidence(item),
      sourceReport: "first-snapshot-trade-map-audit",
    });
  }

  for (const sample of volume.examples.mayHelpExistingAlert.slice(0, maxCasesPerType)) {
    cases.push({
      id: `volume-may-help-${slug(sample.symbol)}-${sample.timestamp}`,
      type: "volume_may_help",
      severity: "test_candidate",
      symbol: sample.symbol,
      timestampIso: timestampFromVolume(sample),
      reason: "volume/activity may improve an already-posted alert without adding standalone noise",
      evidence: evidenceFromVolume(sample),
      sourceReport: "warehouse-volume-activity-report",
    });
  }

  for (const sample of volume.examples.keepOperatorOnly.slice(0, maxCasesPerType)) {
    cases.push({
      id: `volume-hide-${slug(sample.symbol)}-${sample.timestamp}`,
      type: "volume_should_hide",
      severity: sample.interactionKind === "stale_or_unreliable" ? "watch" : "test_candidate",
      symbol: sample.symbol,
      timestampIso: timestampFromVolume(sample),
      reason: "volume/activity should remain out of Discord for this saved case",
      evidence: evidenceFromVolume(sample),
      sourceReport: "warehouse-volume-activity-report",
    });
  }

  for (const sample of execution.examples.usefulContextAvailable.slice(0, maxCasesPerType)) {
    cases.push({
      id: `execution-context-${slug(sample.symbol)}-${sample.timestamp}`,
      type: sample.nearestResistanceAbove === null ? "missing_forward_resistance" : "execution_relation_context",
      severity: sample.nearestResistanceAbove === null ? "major_candidate" : "test_candidate",
      symbol: sample.symbol,
      timestampIso: sample.timestampIso,
      reason: sample.reason,
      evidence: evidenceFromExecution(sample),
      sourceReport: "execution-relation-replay-report",
    });
  }

  for (const sample of execution.examples.needsCandleEvidence.slice(0, maxCasesPerType)) {
    cases.push({
      id: `execution-missing-evidence-${slug(sample.symbol)}-${sample.timestamp}`,
      type: "execution_relation_missing_evidence",
      severity: "watch",
      symbol: sample.symbol,
      timestampIso: sample.timestampIso,
      reason: sample.reason,
      evidence: evidenceFromExecution(sample),
      sourceReport: "execution-relation-replay-report",
    });
  }

  for (const item of structure.symbols
    .filter((symbol) => symbol.verdict === "watch_structure_chop")
    .slice(0, maxCasesPerType)) {
    cases.push({
      id: `market-structure-chop-watch-${slug(item.symbol)}`,
      type: "market_structure_chop_watch",
      severity: item.sameStructureRepeats >= 5 ? "test_candidate" : "watch",
      symbol: item.symbol,
      timestampIso: null,
      reason: "market-structure calibration says this symbol needs chop/materiality review",
      evidence: `reasons=${item.reasons.join("; ") || "none"}; repeats=${item.sameStructureRepeats}; rawTransitions=${item.rawTransitions}; stableTransitions=${item.stableTransitions}; immaterial=${item.immaterialTransitions}`,
      sourceReport: "market-structure-calibration-report",
    });
  }

  for (const item of advancedContext.symbols
    .filter((symbol) => symbol.status !== "ready" || symbol.traderContext.dataQuality === "degraded" || symbol.traderContext.dataQuality === "unusable")
    .slice(0, maxCasesPerType)) {
    cases.push({
      id: `advanced-context-missing-${slug(item.symbol)}`,
      type: "advanced_context_missing",
      severity: item.status === "error" || item.status === "blocked" ? "test_candidate" : "watch",
      symbol: item.symbol,
      timestampIso: null,
      reason: "advanced candle context was missing, partial, blocked, errored, or degraded",
      evidence: `status=${item.status}; reason=${item.reason}; candles=daily ${item.candleCounts.daily}/4h ${item.candleCounts["4h"]}/5m ${item.candleCounts["5m"]}; data=${item.traderContext.dataQuality ?? "n/a"}; structure=${item.marketStructure.state ?? "n/a"}`,
      sourceReport: "advanced-candle-context-report",
    });
  }

  for (const item of providerComparison.symbols
    .filter((symbol) =>
      symbol.timeframeComparisons.some((comparison) => comparison.missingBehavior.length > 0) ||
      symbol.levelComparison.status !== "compared" ||
      symbol.structureComparison.status !== "compared" ||
      symbol.structureComparison.stateMatches === false)
    .slice(0, maxCasesPerType)) {
    cases.push({
      id: `provider-readiness-watch-${slug(item.symbol)}`,
      type: "provider_readiness_watch",
      severity: "watch",
      symbol: item.symbol,
      timestampIso: null,
      reason: "provider comparison found missing/stale behavior or structural readiness gaps",
      evidence: [
        ...item.timeframeComparisons.flatMap((comparison) => comparison.missingBehavior.map((reason) => `${comparison.timeframe}: ${reason}`)),
        `level=${item.levelComparison.status}: ${item.levelComparison.reason}`,
        `structure=${item.structureComparison.status}: ${item.structureComparison.reason}`,
      ].join("; "),
      sourceReport: "provider-comparison-readiness-report",
    });
  }

  for (const item of whyNoPost.symbols
    .filter((symbol) => symbol.verdict === "quiet_may_hide_move")
    .slice(0, maxCasesPerType)) {
    const example = item.candidateExamples[0];
    cases.push({
      id: `quiet-may-hide-move-${slug(item.symbol)}`,
      type: "quiet_may_hide_move",
      severity: item.majorCount > 0 ? "major_candidate" : "test_candidate",
      symbol: item.symbol,
      timestampIso: example?.timestampIso ?? null,
      reason: item.reason,
      evidence: example
        ? `${example.kind}; ${example.coverage}/${example.severity}; closeMove=${example.closeMovePct}%; range=${example.rangePct}%; ${example.reason}; nearest=${example.nearestPostTitles.join(" | ") || "none"}`
        : `missed=${item.missedCount}; major=${item.majorCount}; reviewedCandles=${item.reviewedCandleCount}/${item.candleCount}`,
      sourceReport: "why-no-post-replay-proof",
    });
  }

  for (const item of whyNoPost.symbols
    .filter((symbol) => symbol.verdict === "unproven_runtime_silence")
    .slice(0, maxCasesPerType)) {
    const example = item.candidateExamples.find((candidate) => candidate.quietRiskCause === "runtime_or_feed_silence") ??
      item.candidateExamples[0];
    cases.push({
      id: `runtime-feed-silence-${slug(item.symbol)}`,
      type: "runtime_feed_silence",
      severity: "test_candidate",
      symbol: item.symbol,
      timestampIso: example?.timestampIso ?? null,
      reason: item.reason,
      evidence: example
        ? `${example.kind}; ${example.coverage}/${example.severity}; cause=${example.quietRiskCause}; closeMove=${example.closeMovePct}%; range=${example.rangePct}%; ${example.reason}; ${example.quietRiskReason}`
        : `missed=${item.missedCount}; reviewedCandles=${item.reviewedCandleCount}/${item.candleCount}`,
      sourceReport: "why-no-post-replay-proof",
    });
  }

  for (const item of allSymbolStress.symbols
    .filter((symbol) => symbol.postBudget.status !== "within_budget")
    .slice(0, maxCasesPerType)) {
    const session = item.sampleSessions[0];
    cases.push({
      id: `post-noise-budget-watch-${slug(item.symbol)}`,
      type: "post_noise_budget_watch",
      severity: item.postBudget.status === "excessive_chop" || item.postBudget.status === "runner_review"
        ? "test_candidate"
        : "watch",
      symbol: item.symbol,
      timestampIso: null,
      reason: item.postBudget.reason,
      evidence: [
        `type=${item.budgetSymbolType}`,
        `budget=${item.postBudget.status}`,
        `limit=${item.budgetSessionLimit}`,
        `maxBalanced=${item.maxSimulatedPostsInSession}`,
        `maxQuiet=${item.maxQuietSimulatedPostsInSession}`,
        session ? `sample=${session.session} ${session.originalPosted}->${session.simulatedPosted} quiet=${session.quietSimulatedPosted}` : "sample=n/a",
      ].join("; "),
      sourceReport: "all-symbol-stress-report",
    });
  }

  for (const item of supportResistance.symbols
    .filter((symbol) => symbol.verdict === "broken")
    .slice(0, maxCasesPerType)) {
    cases.push({
      id: `support-resistance-broken-${slug(item.symbol)}`,
      type: "support_resistance_broken",
      severity: "major_candidate",
      symbol: item.symbol,
      timestampIso: item.firstPostAt === null ? null : new Date(item.firstPostAt).toISOString(),
      reason: "support/resistance calibration marked the symbol broken",
      evidence: [
        `reaction=${item.forwardReaction.verdict}: ${item.forwardReaction.reasons.join("; ")}`,
        `ladder=${item.forwardLadder.verdict}: ${item.forwardLadder.reasons.join("; ")}`,
        `ranking=${item.rankingProof.verdict}: ${item.rankingProof.weakestEvidence.join("; ") || "none"}`,
        `structure=${item.marketStructure.alignment}: ${item.marketStructure.reasons.join("; ")}`,
      ].join(" | "),
      sourceReport: "support-resistance-calibration-report",
    });
  }

  for (const item of supportResistance.symbols
    .filter((symbol) => symbol.verdict === "watch")
    .slice(0, maxCasesPerType)) {
    cases.push({
      id: `support-resistance-watch-${slug(item.symbol)}`,
      type: "support_resistance_watch",
      severity: item.marketStructure.alignment === "questions_ladder" ? "major_candidate" : "test_candidate",
      symbol: item.symbol,
      timestampIso: item.firstPostAt === null ? null : new Date(item.firstPostAt).toISOString(),
      reason: "support/resistance calibration found watch-level ladder, ranking, or structure evidence",
      evidence: [
        `ladder=${item.forwardLadder.verdict}: ${item.forwardLadder.reasons.join("; ")}`,
        `ranking=${item.rankingProof.verdict}: ${item.rankingProof.weakestEvidence.join("; ") || "none"}`,
        `structure=${item.marketStructure.alignment}: ${item.marketStructure.reasons.join("; ")}`,
      ].join(" | "),
      sourceReport: "support-resistance-calibration-report",
    });
  }

  for (const item of supportResistance.symbols
    .filter((symbol) => symbol.verdict === "unproven" && symbol.coverageGaps.length > 0)
    .slice(0, maxCasesPerType)) {
    cases.push({
      id: `support-resistance-unproven-coverage-${slug(item.symbol)}`,
      type: "support_resistance_unproven_coverage",
      severity: item.coverageGaps.some((gap) => gap.priority === "fetch_first") ? "test_candidate" : "watch",
      symbol: item.symbol,
      timestampIso: item.firstPostAt === null ? null : new Date(item.firstPostAt).toISOString(),
      reason: "support/resistance calibration could not prove the symbol because candle coverage was missing or incomplete",
      evidence: item.coverageGaps
        .slice(0, 4)
        .map((gap) => `${gap.priority} ${gap.timeframe}: ${gap.reason}`)
        .join(" | "),
      sourceReport: "support-resistance-calibration-report",
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    sourceAuditPath: options.auditPath,
    cacheDirectoryPath,
    warehouseDirectoryPath,
    provider,
    totals: {
      cases: cases.length,
      weakFirstSnapshot: cases.filter((item) => item.type === "weak_first_snapshot").length,
      volumeMayHelp: cases.filter((item) => item.type === "volume_may_help").length,
      volumeShouldHide: cases.filter((item) => item.type === "volume_should_hide").length,
      executionRelationContext: cases.filter((item) => item.type === "execution_relation_context").length,
      executionRelationMissingEvidence: cases.filter((item) => item.type === "execution_relation_missing_evidence").length,
      missingForwardResistance: cases.filter((item) => item.type === "missing_forward_resistance").length,
      firstSnapshotMapFailure: cases.filter((item) => item.type === "first_snapshot_map_failure").length,
      marketStructureChopWatch: cases.filter((item) => item.type === "market_structure_chop_watch").length,
      advancedContextMissing: cases.filter((item) => item.type === "advanced_context_missing").length,
      providerReadinessWatch: cases.filter((item) => item.type === "provider_readiness_watch").length,
      quietMayHideMove: cases.filter((item) => item.type === "quiet_may_hide_move").length,
      runtimeFeedSilence: cases.filter((item) => item.type === "runtime_feed_silence").length,
      postNoiseBudgetWatch: cases.filter((item) => item.type === "post_noise_budget_watch").length,
      supportResistanceWatch: cases.filter((item) => item.type === "support_resistance_watch").length,
      supportResistanceBroken: cases.filter((item) => item.type === "support_resistance_broken").length,
      supportResistanceUnprovenCoverage: cases.filter((item) => item.type === "support_resistance_unproven_coverage").length,
    },
    cases,
  };
}

export function formatCandleIntelligenceRegressionPack(pack: CandleIntelligenceRegressionPack): string {
  const lines = [
    "# Candle Intelligence Regression Pack",
    "",
    `Generated: ${pack.generatedAt}`,
    `Source audit: ${pack.sourceAuditPath}`,
    `Cache: ${pack.cacheDirectoryPath}`,
    `Warehouse: ${pack.warehouseDirectoryPath ?? "none"}`,
    `Provider: ${pack.provider}`,
    "",
    "## Totals",
    "",
    `- cases: ${pack.totals.cases}`,
    `- weak first snapshots: ${pack.totals.weakFirstSnapshot}`,
    `- volume may help: ${pack.totals.volumeMayHelp}`,
    `- volume should hide: ${pack.totals.volumeShouldHide}`,
    `- execution relation context: ${pack.totals.executionRelationContext}`,
    `- execution relation missing evidence: ${pack.totals.executionRelationMissingEvidence}`,
    `- missing forward resistance: ${pack.totals.missingForwardResistance}`,
    `- first snapshot map failures: ${pack.totals.firstSnapshotMapFailure}`,
    `- market-structure chop watch: ${pack.totals.marketStructureChopWatch}`,
    `- advanced context missing: ${pack.totals.advancedContextMissing}`,
    `- provider readiness watch: ${pack.totals.providerReadinessWatch}`,
    `- quiet may hide move: ${pack.totals.quietMayHideMove}`,
    `- runtime/feed silence: ${pack.totals.runtimeFeedSilence}`,
    `- post-noise budget watch: ${pack.totals.postNoiseBudgetWatch}`,
    `- support/resistance watch: ${pack.totals.supportResistanceWatch}`,
    `- support/resistance broken: ${pack.totals.supportResistanceBroken}`,
    `- support/resistance unproven coverage: ${pack.totals.supportResistanceUnprovenCoverage}`,
    "",
    "## Cases",
    "",
  ];

  for (const item of pack.cases) {
    lines.push(
      `### ${item.id}`,
      "",
      `- type: ${item.type}`,
      `- severity: ${item.severity}`,
      `- symbol: ${item.symbol}`,
      `- timestamp: ${item.timestampIso ?? "n/a"}`,
      `- reason: ${item.reason}`,
      `- source: ${item.sourceReport}`,
      `- evidence: ${item.evidence}`,
      "",
    );
  }
  if (pack.cases.length === 0) {
    lines.push("- none found; the input may not contain saved Discord post rows");
  }

  return `${lines.join("\n")}\n`;
}

function requiredThresholds(
  options: CandleIntelligenceRegressionGateOptions = {},
): CandleIntelligenceRegressionGateResult["thresholds"] {
  return {
    maxMajorCandidateCases: options.maxMajorCandidateCases ?? 0,
    maxWeakFirstSnapshotCases: options.maxWeakFirstSnapshotCases ?? 0,
    maxMissingForwardResistanceCases: options.maxMissingForwardResistanceCases ?? 0,
    maxExecutionRelationMissingEvidenceCases: options.maxExecutionRelationMissingEvidenceCases ?? Number.POSITIVE_INFINITY,
    maxFirstSnapshotMapFailureCases: options.maxFirstSnapshotMapFailureCases ?? 0,
    maxMarketStructureChopWatchCases: options.maxMarketStructureChopWatchCases ?? Number.POSITIVE_INFINITY,
    maxAdvancedContextMissingCases: options.maxAdvancedContextMissingCases ?? Number.POSITIVE_INFINITY,
    maxProviderReadinessWatchCases: options.maxProviderReadinessWatchCases ?? Number.POSITIVE_INFINITY,
    maxQuietMayHideMoveCases: options.maxQuietMayHideMoveCases ?? 0,
    maxRuntimeFeedSilenceCases: options.maxRuntimeFeedSilenceCases ?? Number.POSITIVE_INFINITY,
    maxPostNoiseBudgetWatchCases: options.maxPostNoiseBudgetWatchCases ?? Number.POSITIVE_INFINITY,
    maxSupportResistanceWatchCases: options.maxSupportResistanceWatchCases ?? Number.POSITIVE_INFINITY,
    maxSupportResistanceBrokenCases: options.maxSupportResistanceBrokenCases ?? 0,
    maxSupportResistanceUnprovenCoverageCases: options.maxSupportResistanceUnprovenCoverageCases ?? Number.POSITIVE_INFINITY,
    requiredCaseTypes: options.requiredCaseTypes ?? [],
  };
}

function statusRank(status: CandleIntelligenceRegressionGateStatus): number {
  if (status === "fail") {
    return 2;
  }
  if (status === "review") {
    return 1;
  }
  return 0;
}

function strongestStatus(
  violations: CandleIntelligenceRegressionGateViolation[],
): CandleIntelligenceRegressionGateStatus {
  return violations.reduce<CandleIntelligenceRegressionGateStatus>(
    (current, violation) => statusRank(violation.status) > statusRank(current) ? violation.status : current,
    "pass",
  );
}

function maybeViolation(params: {
  violations: CandleIntelligenceRegressionGateViolation[];
  status: Exclude<CandleIntelligenceRegressionGateStatus, "pass">;
  code: string;
  reason: string;
  observed: number;
  allowed: number;
}): void {
  if (params.observed <= params.allowed) {
    return;
  }
  params.violations.push({
    status: params.status,
    code: params.code,
    reason: params.reason,
    observed: params.observed,
    allowed: params.allowed,
  });
}

export function evaluateCandleIntelligenceRegressionGate(
  pack: CandleIntelligenceRegressionPack,
  options: CandleIntelligenceRegressionGateOptions = {},
): CandleIntelligenceRegressionGateResult {
  const thresholds = requiredThresholds(options);
  const majorCandidateCases = pack.cases.filter((item) => item.severity === "major_candidate").length;
  const violations: CandleIntelligenceRegressionGateViolation[] = [];

  maybeViolation({
    violations,
    status: "fail",
    code: "major_candidate_cases",
    reason: "major candle-intelligence regression candidates require review before trusting the run",
    observed: majorCandidateCases,
    allowed: thresholds.maxMajorCandidateCases,
  });
  maybeViolation({
    violations,
    status: "fail",
    code: "weak_first_snapshot_cases",
    reason: "weak first snapshots mean the initial trader map did not meet the quality bar",
    observed: pack.totals.weakFirstSnapshot,
    allowed: thresholds.maxWeakFirstSnapshotCases,
  });
  maybeViolation({
    violations,
    status: "fail",
    code: "missing_forward_resistance_cases",
    reason: "missing forward resistance cases can mislead fast-runner reads",
    observed: pack.totals.missingForwardResistance,
    allowed: thresholds.maxMissingForwardResistanceCases,
  });
  maybeViolation({
    violations,
    status: "review",
    code: "execution_relation_missing_evidence_cases",
    reason: "saved posts could not be replayed against enough candle evidence",
    observed: pack.totals.executionRelationMissingEvidence,
    allowed: thresholds.maxExecutionRelationMissingEvidenceCases,
  });
  maybeViolation({
    violations,
    status: "fail",
    code: "first_snapshot_map_failure_cases",
    reason: "first snapshots failed the full trader-map checklist",
    observed: pack.totals.firstSnapshotMapFailure,
    allowed: thresholds.maxFirstSnapshotMapFailureCases,
  });
  maybeViolation({
    violations,
    status: "review",
    code: "market_structure_chop_watch_cases",
    reason: "market-structure calibration found symbols needing chop/materiality review",
    observed: pack.totals.marketStructureChopWatch,
    allowed: thresholds.maxMarketStructureChopWatchCases,
  });
  maybeViolation({
    violations,
    status: "review",
    code: "advanced_context_missing_cases",
    reason: "advanced candle context was missing, partial, or degraded",
    observed: pack.totals.advancedContextMissing,
    allowed: thresholds.maxAdvancedContextMissingCases,
  });
  maybeViolation({
    violations,
    status: "review",
    code: "provider_readiness_watch_cases",
    reason: "provider comparison found missing/stale behavior or structural readiness gaps",
    observed: pack.totals.providerReadinessWatch,
    allowed: thresholds.maxProviderReadinessWatchCases,
  });
  maybeViolation({
    violations,
    status: "fail",
    code: "quiet_may_hide_move_cases",
    reason: "quiet replay may have hidden candle-backed meaningful moves",
    observed: pack.totals.quietMayHideMove,
    allowed: thresholds.maxQuietMayHideMoveCases,
  });
  maybeViolation({
    violations,
    status: "review",
    code: "runtime_feed_silence_cases",
    reason: "saved candle moves occurred during runtime/feed silence windows and need operational review",
    observed: pack.totals.runtimeFeedSilence,
    allowed: thresholds.maxRuntimeFeedSilenceCases,
  });
  maybeViolation({
    violations,
    status: "review",
    code: "post_noise_budget_watch_cases",
    reason: "saved replay still has symbols above their post-budget style limit",
    observed: pack.totals.postNoiseBudgetWatch,
    allowed: thresholds.maxPostNoiseBudgetWatchCases,
  });
  maybeViolation({
    violations,
    status: "review",
    code: "support_resistance_watch_cases",
    reason: "support/resistance calibration found symbols that need evidence review",
    observed: pack.totals.supportResistanceWatch,
    allowed: thresholds.maxSupportResistanceWatchCases,
  });
  maybeViolation({
    violations,
    status: "fail",
    code: "support_resistance_broken_cases",
    reason: "support/resistance calibration found broken symbols",
    observed: pack.totals.supportResistanceBroken,
    allowed: thresholds.maxSupportResistanceBrokenCases,
  });
  maybeViolation({
    violations,
    status: "review",
    code: "support_resistance_unproven_coverage_cases",
    reason: "support/resistance calibration could not prove symbols because candle coverage was missing",
    observed: pack.totals.supportResistanceUnprovenCoverage,
    allowed: thresholds.maxSupportResistanceUnprovenCoverageCases,
  });

  for (const type of thresholds.requiredCaseTypes) {
    const observed = pack.cases.filter((item) => item.type === type).length;
    maybeViolation({
      violations,
      status: "review",
      code: `missing_required_case_${type}`,
      reason: `regression pack did not include required case type ${type}`,
      observed,
      allowed: -1,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    status: strongestStatus(violations),
    sourceAuditPath: pack.sourceAuditPath,
    totals: {
      ...pack.totals,
      majorCandidateCases,
    },
    thresholds,
    violations,
  };
}

export function formatCandleIntelligenceRegressionGate(
  result: CandleIntelligenceRegressionGateResult,
): string {
  const lines = [
    "# Candle Intelligence Regression Gate",
    "",
    `Generated: ${result.generatedAt}`,
    `Source audit: ${result.sourceAuditPath}`,
    `Status: ${result.status}`,
    "",
    "## Totals",
    "",
    `- cases: ${result.totals.cases}`,
    `- major candidates: ${result.totals.majorCandidateCases}`,
    `- weak first snapshots: ${result.totals.weakFirstSnapshot}`,
    `- missing forward resistance: ${result.totals.missingForwardResistance}`,
    `- execution relation missing evidence: ${result.totals.executionRelationMissingEvidence}`,
    `- first snapshot map failures: ${result.totals.firstSnapshotMapFailure}`,
    `- market-structure chop watch: ${result.totals.marketStructureChopWatch}`,
    `- advanced context missing: ${result.totals.advancedContextMissing}`,
    `- provider readiness watch: ${result.totals.providerReadinessWatch}`,
    `- quiet may hide move: ${result.totals.quietMayHideMove}`,
    `- runtime/feed silence: ${result.totals.runtimeFeedSilence}`,
    `- post-noise budget watch: ${result.totals.postNoiseBudgetWatch}`,
    `- support/resistance watch: ${result.totals.supportResistanceWatch}`,
    `- support/resistance broken: ${result.totals.supportResistanceBroken}`,
    `- support/resistance unproven coverage: ${result.totals.supportResistanceUnprovenCoverage}`,
    "",
    "## Thresholds",
    "",
    `- max major candidates: ${result.thresholds.maxMajorCandidateCases}`,
    `- max weak first snapshots: ${result.thresholds.maxWeakFirstSnapshotCases}`,
    `- max missing forward resistance: ${result.thresholds.maxMissingForwardResistanceCases}`,
    `- max execution relation missing evidence: ${Number.isFinite(result.thresholds.maxExecutionRelationMissingEvidenceCases)
      ? result.thresholds.maxExecutionRelationMissingEvidenceCases
      : "unlimited"}`,
    `- max first snapshot map failures: ${result.thresholds.maxFirstSnapshotMapFailureCases}`,
    `- max market-structure chop watch: ${Number.isFinite(result.thresholds.maxMarketStructureChopWatchCases)
      ? result.thresholds.maxMarketStructureChopWatchCases
      : "unlimited"}`,
    `- max advanced context missing: ${Number.isFinite(result.thresholds.maxAdvancedContextMissingCases)
      ? result.thresholds.maxAdvancedContextMissingCases
      : "unlimited"}`,
    `- max provider readiness watch: ${Number.isFinite(result.thresholds.maxProviderReadinessWatchCases)
      ? result.thresholds.maxProviderReadinessWatchCases
      : "unlimited"}`,
    `- max quiet may hide move: ${result.thresholds.maxQuietMayHideMoveCases}`,
    `- max runtime/feed silence: ${Number.isFinite(result.thresholds.maxRuntimeFeedSilenceCases)
      ? result.thresholds.maxRuntimeFeedSilenceCases
      : "unlimited"}`,
    `- max post-noise budget watch: ${Number.isFinite(result.thresholds.maxPostNoiseBudgetWatchCases)
      ? result.thresholds.maxPostNoiseBudgetWatchCases
      : "unlimited"}`,
    `- max support/resistance watch: ${Number.isFinite(result.thresholds.maxSupportResistanceWatchCases)
      ? result.thresholds.maxSupportResistanceWatchCases
      : "unlimited"}`,
    `- max support/resistance broken: ${result.thresholds.maxSupportResistanceBrokenCases}`,
    `- max support/resistance unproven coverage: ${Number.isFinite(result.thresholds.maxSupportResistanceUnprovenCoverageCases)
      ? result.thresholds.maxSupportResistanceUnprovenCoverageCases
      : "unlimited"}`,
    `- required case types: ${result.thresholds.requiredCaseTypes.join(", ") || "none"}`,
    "",
    "## Violations",
    "",
  ];

  if (result.violations.length === 0) {
    lines.push("- none");
  } else {
    for (const violation of result.violations) {
      lines.push(
        `- ${violation.status} ${violation.code}: observed ${violation.observed}, allowed ${violation.allowed}; ${violation.reason}`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

export function writeCandleIntelligenceRegressionGate(params: {
  pack: CandleIntelligenceRegressionPack;
  options?: CandleIntelligenceRegressionGateOptions;
  jsonPath: string;
  markdownPath: string;
}): CandleIntelligenceRegressionGateResult {
  const result = evaluateCandleIntelligenceRegressionGate(params.pack, params.options);
  mkdirSync(dirname(resolve(params.jsonPath)), { recursive: true });
  mkdirSync(dirname(resolve(params.markdownPath)), { recursive: true });
  writeFileSync(params.jsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  writeFileSync(params.markdownPath, formatCandleIntelligenceRegressionGate(result), "utf8");
  return result;
}

export async function writeCandleIntelligenceRegressionPack(
  options: WriteCandleIntelligenceRegressionPackOptions,
): Promise<CandleIntelligenceRegressionPack> {
  const pack = await generateCandleIntelligenceRegressionPack(options);
  mkdirSync(dirname(resolve(options.jsonPath)), { recursive: true });
  mkdirSync(dirname(resolve(options.markdownPath)), { recursive: true });
  writeFileSync(options.jsonPath, `${JSON.stringify(pack, null, 2)}\n`, "utf8");
  writeFileSync(options.markdownPath, formatCandleIntelligenceRegressionPack(pack), "utf8");
  return pack;
}
