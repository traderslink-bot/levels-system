import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  generateMissedMeaningfulMoveAudit,
  type MissedMeaningfulMoveCandidate,
  type MissedMeaningfulMoveSymbolReport,
} from "./missed-meaningful-move-audit.js";
import { buildLivePostReplaySimulationReport } from "./live-post-replay-simulator.js";
import type { CandleFetchTimeframe, CandleProviderName } from "../support-resistance/index.js";

export type WhyNoPostReplayVerdict =
  | "quiet_supported_by_candles"
  | "quiet_preserved_meaningful_moves"
  | "quiet_may_hide_move"
  | "unproven_runtime_silence"
  | "unproven_missing_candles";

export type QuietRiskCause =
  | "not_applicable"
  | "weakly_covered"
  | "policy_suppressed"
  | "nearby_non_matching_activity"
  | "runtime_or_feed_silence"
  | "candle_context_watch";

export type WhyNoPostReplayProofSymbol = {
  symbol: string;
  verdict: WhyNoPostReplayVerdict;
  postCount: number;
  candleCount: number;
  reviewedCandleCount: number;
  candidateCount: number;
  coveredCount: number;
  weakCoverageCount: number;
  missedCount: number;
  majorCount: number;
  largestReviewedMovePct: number | null;
  largestReviewedRangePct: number | null;
  candidateExamples: Array<{
    timestamp: number;
    timestampIso: string;
    kind: string;
    coverage: string;
    severity: string;
    closeMovePct: number;
    rangePct: number;
    open: number;
    high: number;
    low: number;
    close: number;
    reason: string;
    nearestPostTitles: string[];
    quietRiskCause: QuietRiskCause;
    quietRiskReason: string;
  }>;
  replayEvidence: {
    originalPosted: number;
    simulatedPosted: number;
    suppressed: number;
    threadStorySuppressions: number;
    suppressedByReason: Record<string, number>;
    sampleSuppressions: Array<{
      timestamp: number;
      timestampIso: string;
      messageKind: string;
      reason: string;
      title?: string;
    }>;
  } | null;
  reason: string;
};

export type WhyNoPostReplayProofReport = {
  generatedAt: string;
  sourceAuditPath: string;
  cacheDirectoryPath: string;
  warehouseDirectoryPath: string | null;
  provider: CandleProviderName;
  timeframe: CandleFetchTimeframe;
  totals: {
    symbols: number;
    quietSupported: number;
    quietPreservedMeaningfulMoves: number;
    quietMayHideMove: number;
    unprovenRuntimeSilence: number;
    unprovenMissingCandles: number;
    missedCandidates: number;
    actionableMissedCandidates: number;
    runtimeSilenceCandidates: number;
    contextWatchCandidates: number;
    policySuppressedCandidates: number;
    majorMissedCandidates: number;
    coveredCandidates: number;
    replaySuppressed: number;
    replayThreadStorySuppressions: number;
    symbolsWithReplaySuppression: number;
  };
  symbols: WhyNoPostReplayProofSymbol[];
};

export type GenerateWhyNoPostReplayProofOptions = {
  auditPath: string;
  cacheDirectoryPath?: string;
  warehouseDirectoryPath?: string;
  provider?: CandleProviderName;
  timeframe?: CandleFetchTimeframe;
  coverageWindowMs?: number;
  auditWindowPaddingMs?: number;
  includeReplayEvidence?: boolean;
  replayProfile?: "quiet" | "balanced" | "active";
  maxAuditFiles?: number;
};

export type WriteWhyNoPostReplayProofOptions = GenerateWhyNoPostReplayProofOptions & {
  jsonPath: string;
  markdownPath: string;
};

function largestAbs(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return Number(Math.max(...values.map((value) => Math.abs(value))).toFixed(2));
}

type ReplaySymbolEvidence = NonNullable<WhyNoPostReplayProofSymbol["replayEvidence"]>;

type RuntimeEvidenceRow = {
  symbol: string;
  timestamp: number;
  observedTimestamp?: number;
  source: string;
  type?: string;
  operation?: string;
  eventType?: string;
  status?: string;
  decision?: string;
  reasons?: string[];
};

type RuntimeEvidence = {
  bySymbol: Map<string, RuntimeEvidenceRow[]>;
};

const QUIET_RISK_WINDOW_MS = 12 * 60 * 1000;

function timestampOf(row: Record<string, unknown>): number | null {
  const value = row.sourceTimestamp ?? row.timestamp;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function observedTimestampOf(row: Record<string, unknown>): number | undefined {
  const value = row.timestamp;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function symbolOf(row: Record<string, unknown>): string | null {
  const value = row.symbol;
  return typeof value === "string" && value.trim() ? value.trim().toUpperCase() : null;
}

function readJsonLines(path: string): Array<Record<string, unknown>> {
  if (!existsSync(path)) {
    return [];
  }
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Record<string, unknown>];
      } catch {
        return [];
      }
    });
}

function addEvidenceRow(map: Map<string, RuntimeEvidenceRow[]>, row: RuntimeEvidenceRow): void {
  map.set(row.symbol, [...(map.get(row.symbol) ?? []), row]);
}

function loadRuntimeEvidence(sourceAuditPaths: string[]): RuntimeEvidence {
  const bySymbol = new Map<string, RuntimeEvidenceRow[]>();
  const sessionDirectories = [...new Set(sourceAuditPaths.map((path) => dirname(path)))];

  for (const auditPath of sourceAuditPaths) {
    for (const row of readJsonLines(auditPath)) {
      const symbol = symbolOf(row);
      const timestamp = timestampOf(row);
      if (!symbol || timestamp === null) {
        continue;
      }
      addEvidenceRow(bySymbol, {
        symbol,
        timestamp,
        observedTimestamp: observedTimestampOf(row),
        source: "discord_delivery_audit",
        type: typeof row.type === "string" ? row.type : undefined,
        operation: typeof row.operation === "string" ? row.operation : undefined,
        eventType: typeof row.eventType === "string" ? row.eventType : undefined,
        status: typeof row.status === "string" ? row.status : undefined,
      });
    }
  }

  for (const directory of sessionDirectories) {
    for (const fileName of [
      "manual-watchlist-diagnostics.log",
      "manual-watchlist-operational.log",
      "manual-watchlist-full.log",
    ]) {
      for (const row of readJsonLines(join(directory, fileName))) {
        const symbol = symbolOf(row);
        const timestamp = timestampOf(row);
        if (!symbol || timestamp === null) {
          continue;
        }
        const reasons = Array.isArray(row.reasons)
          ? row.reasons.filter((item): item is string => typeof item === "string")
          : undefined;
        addEvidenceRow(bySymbol, {
          symbol,
          timestamp,
          observedTimestamp: observedTimestampOf(row),
          source: fileName,
          type: typeof row.type === "string" ? row.type : undefined,
          operation: typeof row.operation === "string" ? row.operation : undefined,
          eventType: typeof row.eventType === "string" ? row.eventType : undefined,
          status: typeof row.status === "string" ? row.status : undefined,
          decision: typeof row.decision === "string" ? row.decision : undefined,
          reasons,
        });
      }
    }
  }

  return { bySymbol };
}

function nearbyEvidence(
  runtimeEvidence: RuntimeEvidence,
  candidate: MissedMeaningfulMoveCandidate,
): RuntimeEvidenceRow[] {
  return (runtimeEvidence.bySymbol.get(candidate.symbol) ?? [])
    .filter((row) => Math.abs(row.timestamp - candidate.timestamp) <= QUIET_RISK_WINDOW_MS)
    .sort((left, right) =>
      Math.abs(left.timestamp - candidate.timestamp) - Math.abs(right.timestamp - candidate.timestamp)
    );
}

function firstObservedEvidenceAt(runtimeEvidence: RuntimeEvidence, symbol: string): number | null {
  const timestamps = (runtimeEvidence.bySymbol.get(symbol) ?? [])
    .map((row) => row.observedTimestamp ?? row.timestamp)
    .filter((value) => Number.isFinite(value));
  return timestamps.length ? Math.min(...timestamps) : null;
}

function formatMinutes(value: number): string {
  return `${(Math.round(value * 10) / 10).toFixed(1)}m`;
}

function classifyQuietRiskCause(
  candidate: MissedMeaningfulMoveCandidate,
  runtimeEvidence: RuntimeEvidence,
): Pick<WhyNoPostReplayProofSymbol["candidateExamples"][number], "quietRiskCause" | "quietRiskReason"> {
  if (candidate.coverage === "covered") {
    return {
      quietRiskCause: "not_applicable",
      quietRiskReason: "a matching nearby Discord alert covered the candle move",
    };
  }
  if (candidate.coverage === "weak_coverage") {
    return {
      quietRiskCause: "weakly_covered",
      quietRiskReason: "nearby Discord activity existed, but it may not have told the exact candle story",
    };
  }

  const nearby = nearbyEvidence(runtimeEvidence, candidate);
  const suppressed = nearby.find((row) => row.decision === "suppressed");
  if (suppressed) {
    return {
      quietRiskCause: "policy_suppressed",
      quietRiskReason: `runtime suppression was observed near the candle (${suppressed.eventType ?? suppressed.operation ?? suppressed.type ?? suppressed.source})`,
    };
  }

  if (
    candidate.kind === "large_range" ||
    /without closing|range expanded|whether context was needed/i.test(candidate.reason)
  ) {
    return {
      quietRiskCause: "candle_context_watch",
      quietRiskReason: "the candle was worth reviewing, but it was not a confirmed support/resistance break",
    };
  }

  if (nearby.length > 0) {
    const firstObserved = firstObservedEvidenceAt(runtimeEvidence, candidate.symbol);
    if (firstObserved !== null && firstObserved - candidate.timestamp > 2 * 60 * 1000) {
      return {
        quietRiskCause: "runtime_or_feed_silence",
        quietRiskReason: `first saved symbol runtime/thread activity started ${formatMinutes((firstObserved - candidate.timestamp) / 60_000)} after the candle, so this looks like activation or feed coverage rather than live post suppression`,
      };
    }
    return {
      quietRiskCause: "nearby_non_matching_activity",
      quietRiskReason: "runtime activity existed nearby, but no matching trader-facing post covered this candle move",
    };
  }

  return {
    quietRiskCause: "runtime_or_feed_silence",
    quietRiskReason: "no saved runtime diagnostics or Discord activity were found near the candle window",
  };
}

function isActionableMissed(candidate: WhyNoPostReplayProofSymbol["candidateExamples"][number]): boolean {
  return candidate.coverage === "missed" &&
    (candidate.quietRiskCause === "policy_suppressed" ||
      candidate.quietRiskCause === "nearby_non_matching_activity");
}

function isActionableMajor(candidate: WhyNoPostReplayProofSymbol["candidateExamples"][number]): boolean {
  return candidate.severity === "major" && isActionableMissed(candidate);
}

function verdictFor(
  symbol: MissedMeaningfulMoveSymbolReport,
  replayEvidence: ReplaySymbolEvidence | null,
  candidateExamples: WhyNoPostReplayProofSymbol["candidateExamples"],
): Pick<WhyNoPostReplayProofSymbol, "verdict" | "reason"> {
  if (symbol.candleCount === 0 || symbol.reviewedCandleCount === 0) {
    return {
      verdict: "unproven_missing_candles",
      reason: "cached candles were missing or did not overlap the audited Discord window, so quiet behavior cannot be proven",
    };
  }
  const actionableMissed = candidateExamples.filter(isActionableMissed).length;
  const runtimeSilence = candidateExamples.filter((candidate) =>
    candidate.coverage === "missed" && candidate.quietRiskCause === "runtime_or_feed_silence"
  ).length;
  const contextWatch = candidateExamples.filter((candidate) =>
    candidate.coverage === "missed" && candidate.quietRiskCause === "candle_context_watch"
  ).length;
  const actionableMajor = candidateExamples.filter(isActionableMajor).length;
  if (actionableMissed > 0 || actionableMajor > 0) {
    return {
      verdict: "quiet_may_hide_move",
      reason: `${actionableMissed || symbol.missedCount} candle-backed move candidate(s) may point to policy or story coverage risk`,
    };
  }
  if (runtimeSilence > 0) {
    return {
      verdict: "unproven_runtime_silence",
      reason: `${runtimeSilence} missed candle-backed move candidate(s) had no nearby runtime/feed evidence, so this is not proven as post-policy suppression`,
    };
  }
  if (symbol.candidateCount > 0) {
    return {
      verdict: "quiet_preserved_meaningful_moves",
      reason: `${symbol.candidateCount} candle-backed move candidates were covered, weakly covered, or context-only${contextWatch ? `; ${contextWatch} missed candidate(s) were candle-context watch items rather than confirmed level breaks` : ""}${replayEvidence?.suppressed ? ` while balanced replay suppressed ${replayEvidence.suppressed} repeated/context posts` : ""}`,
    };
  }
  return {
    verdict: "quiet_supported_by_candles",
    reason: `no candle-backed meaningful move candidates appeared in the audited window${replayEvidence?.suppressed ? `; balanced replay suppression appears supported for ${replayEvidence.suppressed} posts` : ""}`,
  };
}

function buildSymbol(
  symbol: MissedMeaningfulMoveSymbolReport,
  replayEvidence: ReplaySymbolEvidence | null,
  runtimeEvidence: RuntimeEvidence,
): WhyNoPostReplayProofSymbol {
  const candidateExamples = symbol.candidates
    .filter((candidate) => candidate.coverage !== "covered")
    .sort((left, right) => {
      const severityRank = { major: 0, watch: 1, data_quality_only: 2 } as const;
      return severityRank[left.severity] - severityRank[right.severity] ||
        Math.max(Math.abs(right.closeMovePct), right.rangePct) -
          Math.max(Math.abs(left.closeMovePct), left.rangePct);
    })
    .slice(0, 5)
    .map((candidate) => candidateExample(candidate, runtimeEvidence));
  const verdict = verdictFor(symbol, replayEvidence, candidateExamples);
  return {
    symbol: symbol.symbol,
    verdict: verdict.verdict,
    postCount: symbol.postCount,
    candleCount: symbol.candleCount,
    reviewedCandleCount: symbol.reviewedCandleCount,
    candidateCount: symbol.candidateCount,
    coveredCount: symbol.coveredCount,
    weakCoverageCount: symbol.weakCoverageCount,
    missedCount: symbol.missedCount,
    majorCount: symbol.majorCount,
    largestReviewedMovePct: largestAbs(symbol.largestReviewedMoves.map((move) => move.closeMovePct)),
    largestReviewedRangePct: largestAbs(symbol.largestReviewedMoves.map((move) => move.rangePct)),
    candidateExamples,
    replayEvidence,
    reason: verdict.reason,
  };
}

function candidateExample(
  candidate: MissedMeaningfulMoveCandidate,
  runtimeEvidence: RuntimeEvidence,
): WhyNoPostReplayProofSymbol["candidateExamples"][number] {
  const quietRisk = classifyQuietRiskCause(candidate, runtimeEvidence);
  return {
    timestamp: candidate.timestamp,
    timestampIso: candidate.timestampIso,
    kind: candidate.kind,
    coverage: candidate.coverage,
    severity: candidate.severity,
    closeMovePct: Number(candidate.closeMovePct.toFixed(2)),
    rangePct: Number(candidate.rangePct.toFixed(2)),
    open: candidate.open,
    high: candidate.high,
    low: candidate.low,
    close: candidate.close,
    reason: candidate.reason,
    nearestPostTitles: candidate.nearestPosts.slice(0, 3).map((post) =>
      `${post.distanceMinutes}m ${post.title ?? post.operation ?? "post"}`,
    ),
    ...quietRisk,
  };
}

export function generateWhyNoPostReplayProof(
  options: GenerateWhyNoPostReplayProofOptions,
): WhyNoPostReplayProofReport {
  const missed = generateMissedMeaningfulMoveAudit(options);
  const runtimeEvidence = loadRuntimeEvidence(missed.sourceAuditPaths);
  const replayEvidenceBySymbol = new Map<string, ReplaySymbolEvidence>();
  if (options.includeReplayEvidence !== false && missed.sourceAuditPaths.length === 1) {
    const replay = buildLivePostReplaySimulationReport(missed.sourceAuditPaths[0]!, options.replayProfile ?? "balanced");
    for (const symbol of replay.perSymbol) {
      replayEvidenceBySymbol.set(symbol.symbol, {
        originalPosted: symbol.originalPosted,
        simulatedPosted: symbol.simulatedPosted,
        suppressed: symbol.suppressed,
        threadStorySuppressions: symbol.threadStorySuppressions,
        suppressedByReason: symbol.suppressedByReason,
        sampleSuppressions: symbol.sampleSuppressions.map((sample) => ({
          ...sample,
          timestampIso: new Date(sample.timestamp).toISOString(),
        })),
      });
    }
  }

  const symbols = missed.symbols.map((symbol) =>
    buildSymbol(symbol, replayEvidenceBySymbol.get(symbol.symbol) ?? null, runtimeEvidence)
  ).sort((left, right) => {
    const rank: Record<WhyNoPostReplayVerdict, number> = {
      quiet_may_hide_move: 0,
      unproven_missing_candles: 1,
      unproven_runtime_silence: 2,
      quiet_preserved_meaningful_moves: 3,
      quiet_supported_by_candles: 4,
    };
    return rank[left.verdict] - rank[right.verdict] || right.missedCount - left.missedCount || left.symbol.localeCompare(right.symbol);
  });

  return {
    generatedAt: new Date().toISOString(),
    sourceAuditPath: missed.sourceAuditPath,
    cacheDirectoryPath: missed.cacheDirectoryPath,
    warehouseDirectoryPath: missed.warehouseDirectoryPath,
    provider: missed.provider,
    timeframe: missed.timeframe,
    totals: {
      symbols: symbols.length,
      quietSupported: symbols.filter((symbol) => symbol.verdict === "quiet_supported_by_candles").length,
      quietPreservedMeaningfulMoves: symbols.filter((symbol) => symbol.verdict === "quiet_preserved_meaningful_moves").length,
      quietMayHideMove: symbols.filter((symbol) => symbol.verdict === "quiet_may_hide_move").length,
      unprovenRuntimeSilence: symbols.filter((symbol) => symbol.verdict === "unproven_runtime_silence").length,
      unprovenMissingCandles: symbols.filter((symbol) => symbol.verdict === "unproven_missing_candles").length,
      missedCandidates: symbols.reduce((sum, symbol) => sum + symbol.missedCount, 0),
      actionableMissedCandidates: symbols.reduce((sum, symbol) =>
        sum + symbol.candidateExamples.filter(isActionableMissed).length, 0),
      runtimeSilenceCandidates: symbols.reduce((sum, symbol) =>
        sum + symbol.candidateExamples.filter((candidate) => candidate.quietRiskCause === "runtime_or_feed_silence").length, 0),
      contextWatchCandidates: symbols.reduce((sum, symbol) =>
        sum + symbol.candidateExamples.filter((candidate) => candidate.quietRiskCause === "candle_context_watch").length, 0),
      policySuppressedCandidates: symbols.reduce((sum, symbol) =>
        sum + symbol.candidateExamples.filter((candidate) => candidate.quietRiskCause === "policy_suppressed").length, 0),
      majorMissedCandidates: symbols.reduce((sum, symbol) => sum + symbol.majorCount, 0),
      coveredCandidates: symbols.reduce((sum, symbol) => sum + symbol.coveredCount, 0),
      replaySuppressed: symbols.reduce((sum, symbol) => sum + (symbol.replayEvidence?.suppressed ?? 0), 0),
      replayThreadStorySuppressions: symbols.reduce((sum, symbol) => sum + (symbol.replayEvidence?.threadStorySuppressions ?? 0), 0),
      symbolsWithReplaySuppression: symbols.filter((symbol) => (symbol.replayEvidence?.suppressed ?? 0) > 0).length,
    },
    symbols,
  };
}

function pct(value: number | null): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}%` : "n/a";
}

export function formatWhyNoPostReplayProof(report: WhyNoPostReplayProofReport): string {
  const lines = [
    "# Why No Post Replay Proof",
    "",
    "Operator-only report. It proves whether quieter Discord behavior is supported by saved 5m candles, or whether suppression may have hidden a meaningful move.",
    "",
    `Generated: ${report.generatedAt}`,
    `Source audit: ${report.sourceAuditPath}`,
    `Candle cache: ${report.cacheDirectoryPath}`,
    `Warehouse: ${report.warehouseDirectoryPath ?? "none"}`,
    `Provider/timeframe: ${report.provider} ${report.timeframe}`,
    "",
    "## Totals",
    "",
    `- symbols: ${report.totals.symbols}`,
    `- quiet supported by candles: ${report.totals.quietSupported}`,
    `- quiet preserved meaningful moves: ${report.totals.quietPreservedMeaningfulMoves}`,
    `- quiet may hide a move: ${report.totals.quietMayHideMove}`,
    `- unproven due to runtime/feed silence: ${report.totals.unprovenRuntimeSilence}`,
    `- unproven due to missing candles: ${report.totals.unprovenMissingCandles}`,
    `- covered candidates: ${report.totals.coveredCandidates}`,
    `- missed candidates: ${report.totals.missedCandidates}`,
    `- actionable missed candidates: ${report.totals.actionableMissedCandidates}`,
    `- runtime/feed silence candidates: ${report.totals.runtimeSilenceCandidates}`,
    `- candle-context watch candidates: ${report.totals.contextWatchCandidates}`,
    `- policy-suppressed candidates: ${report.totals.policySuppressedCandidates}`,
    `- major missed candidates: ${report.totals.majorMissedCandidates}`,
    `- balanced replay suppressed posts: ${report.totals.replaySuppressed}`,
    `- balanced replay thread-story suppressions: ${report.totals.replayThreadStorySuppressions}`,
    `- symbols with replay suppression: ${report.totals.symbolsWithReplaySuppression}`,
    "",
    "## Per Symbol Proof",
    "",
    "| Symbol | Verdict | Posts | Candles | Candidates | Covered/Weak/Missed | Causes | Major | Replay Suppressed | Largest Close Move | Largest Range | Reason |",
    "| --- | --- | ---: | ---: | ---: | --- | --- | ---: | ---: | ---: | ---: | --- |",
  ];

  for (const symbol of report.symbols.slice(0, 160)) {
    const causes = symbol.candidateExamples
      .filter((candidate) => candidate.coverage === "missed")
      .map((candidate) => candidate.quietRiskCause)
      .filter((value, index, array) => array.indexOf(value) === index)
      .join(", ") || "n/a";
    lines.push(
      `| ${symbol.symbol} | ${symbol.verdict} | ${symbol.postCount} | ${symbol.reviewedCandleCount}/${symbol.candleCount} | ${symbol.candidateCount} | ${symbol.coveredCount}/${symbol.weakCoverageCount}/${symbol.missedCount} | ${causes} | ${symbol.majorCount} | ${symbol.replayEvidence?.suppressed ?? 0} | ${pct(symbol.largestReviewedMovePct)} | ${pct(symbol.largestReviewedRangePct)} | ${symbol.reason} |`,
    );
  }
  if (report.symbols.length > 160) {
    lines.push(`| ... | ... | ... | ... | ... | ... | ... | ... | ... | ... | ${report.symbols.length - 160} additional symbols omitted |`);
  }

  const suppressedExamples = report.symbols
    .filter((symbol) => (symbol.replayEvidence?.sampleSuppressions.length ?? 0) > 0)
    .slice(0, 20);
  lines.push("", "## Replay Suppression Evidence", "");
  if (!suppressedExamples.length) {
    lines.push("- none");
  }
  for (const symbol of suppressedExamples) {
    lines.push(`### ${symbol.symbol}`, "");
    lines.push(`- suppressed by reason: ${JSON.stringify(symbol.replayEvidence?.suppressedByReason ?? {})}`);
    for (const sample of symbol.replayEvidence?.sampleSuppressions.slice(0, 4) ?? []) {
      lines.push(`- ${sample.timestampIso} ${sample.messageKind}: ${sample.reason}; ${sample.title ?? "post"}`);
    }
    lines.push("");
  }

  const missedExamples = report.symbols
    .filter((symbol) => symbol.candidateExamples.length > 0)
    .slice(0, 30);
  lines.push("", "## Concrete Move Examples", "");
  if (!missedExamples.length) {
    lines.push("- none");
  }
  for (const symbol of missedExamples) {
    lines.push(`### ${symbol.symbol}`, "");
    for (const candidate of symbol.candidateExamples) {
      lines.push(
        `- ${candidate.timestampIso} ${candidate.kind}: ${candidate.coverage}/${candidate.severity}; close move ${pct(candidate.closeMovePct)}, range ${pct(candidate.rangePct)}; candle ${candidate.open} -> ${candidate.close} (${candidate.low}-${candidate.high})`,
      );
      lines.push(`  - why it matters: ${candidate.reason}`);
      lines.push(`  - quiet-risk cause: ${candidate.quietRiskCause}; ${candidate.quietRiskReason}`);
      lines.push(`  - nearest saved posts: ${candidate.nearestPostTitles.join("; ") || "none within review window"}`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

export function writeWhyNoPostReplayProof(
  options: WriteWhyNoPostReplayProofOptions,
): WhyNoPostReplayProofReport {
  const report = generateWhyNoPostReplayProof(options);
  mkdirSync(dirname(resolve(options.jsonPath)), { recursive: true });
  mkdirSync(dirname(resolve(options.markdownPath)), { recursive: true });
  writeFileSync(options.jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(options.markdownPath, formatWhyNoPostReplayProof(report), "utf8");
  return report;
}
