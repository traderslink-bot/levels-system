import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  buildMarketStructureReplayAuditReport,
  type MarketStructureReplayAuditOptions,
  type MarketStructureReplayAuditReport,
  type MarketStructureReplayCase,
} from "./market-structure-replay-audit.js";
import {
  buildStableStructureDiscordAlignmentReport,
  type StableStructureDiscordAlignmentOptions,
  type StableStructureDiscordAlignmentReport,
  type StableStructureDiscordSymbolSummary,
} from "./stable-structure-discord-alignment.js";

export type MarketStructureCalibrationVerdict =
  | "trusted_for_suppression"
  | "watch_structure_chop"
  | "operator_only"
  | "insufficient_evidence";

export type MarketStructureCalibrationSymbol = {
  symbol: string;
  verdict: MarketStructureCalibrationVerdict;
  reasons: string[];
  replayCases: number;
  latestStates: string[];
  lowConfidenceCases: number;
  rangeBoundCases: number;
  rawTransitions: number;
  stableTransitions: number;
  suppressedTransitions: number;
  immaterialTransitions: number;
  stableTransitionReductionPct: number;
  postedRows: number;
  alignedRows: number;
  stableTransitionPosts: number;
  sameStructureRepeats: number;
  sameStructureRefreshes: number;
  rawChopSuppressedRows: number;
  representativeReplayFindings: string[];
  representativeRepeatedPosts: string[];
};

export type MarketStructureCalibrationReport = {
  generatedAt: string;
  replay: Pick<
    MarketStructureReplayAuditReport,
    "cacheDirectory" | "filesScanned" | "symbolsScanned" | "summary"
  >;
  discordAlignment: Pick<
    StableStructureDiscordAlignmentReport,
    "auditRoot" | "cacheDirectory" | "auditFilesScanned" | "summary"
  >;
  totals: {
    symbols: number;
    trustedForSuppression: number;
    watchStructureChop: number;
    operatorOnly: number;
    insufficientEvidence: number;
    rawTransitions: number;
    stableTransitions: number;
    suppressedTransitions: number;
    sameStructureRepeats: number;
    alignedPostRows: number;
  };
  symbols: MarketStructureCalibrationSymbol[];
};

export type BuildMarketStructureCalibrationReportOptions = {
  replay?: MarketStructureReplayAuditOptions;
  alignment?: StableStructureDiscordAlignmentOptions;
};

export type WriteMarketStructureCalibrationReportOptions =
  BuildMarketStructureCalibrationReportOptions & {
    jsonPath: string;
    markdownPath: string;
  };

function groupedCases(cases: MarketStructureReplayCase[]): Map<string, MarketStructureReplayCase[]> {
  const bySymbol = new Map<string, MarketStructureReplayCase[]>();
  for (const item of cases) {
    bySymbol.set(item.symbol, [...(bySymbol.get(item.symbol) ?? []), item]);
  }
  return bySymbol;
}

function groupedAlignment(
  summaries: StableStructureDiscordSymbolSummary[],
): Map<string, StableStructureDiscordSymbolSummary> {
  return new Map(summaries.map((summary) => [summary.symbol, summary]));
}

function average(values: number[]): number {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) {
    return 0;
  }
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function uniqueLatestStates(cases: MarketStructureReplayCase[]): string[] {
  return [...new Set(cases.flatMap((item) => [item.state, ...item.stable.lastStates.slice(-3)]))]
    .filter(Boolean)
    .slice(0, 8);
}

function replayFindingText(cases: MarketStructureReplayCase[]): string[] {
  return cases
    .flatMap((item) => item.findings.map((finding) => `${finding.reason}: ${finding.detail}`))
    .slice(0, 5);
}

function repeatedPostText(summary: StableStructureDiscordSymbolSummary | undefined): string[] {
  return (summary?.representativeRepeats ?? [])
    .map((post) => `${post.isoTimestamp} ${post.title ?? "post"} (${post.classification})`)
    .slice(0, 5);
}

function verdictFor(params: {
  replayCases: number;
  lowConfidenceCases: number;
  rawTransitions: number;
  stableTransitions: number;
  immaterialTransitions: number;
  sameStructureRepeats: number;
  alignedRows: number;
  rawChopSuppressedRows: number;
}): { verdict: MarketStructureCalibrationVerdict; reasons: string[] } {
  const reasons: string[] = [];
  if (params.replayCases === 0 && params.alignedRows === 0) {
    return {
      verdict: "insufficient_evidence",
      reasons: ["no replay case or aligned Discord evidence was available"],
    };
  }

  const immaterialRatio = params.rawTransitions > 0
    ? params.immaterialTransitions / params.rawTransitions
    : 0;
  if (params.lowConfidenceCases > 0) {
    reasons.push(`${params.lowConfidenceCases} low-confidence replay case(s)`);
  }
  if (immaterialRatio >= 0.35) {
    reasons.push(`immaterial transition ratio ${immaterialRatio.toFixed(2)} needs small-cap calibration review`);
  }
  if (params.sameStructureRepeats >= 3) {
    reasons.push(`${params.sameStructureRepeats} same-structure repeated Discord post(s)`);
  }
  if (params.rawChopSuppressedRows > 0) {
    reasons.push(`${params.rawChopSuppressedRows} raw chop row(s) were suppressible`);
  }

  const stableReducesNoise = params.stableTransitions < params.rawTransitions ||
    params.sameStructureRepeats >= 3 ||
    params.rawChopSuppressedRows > 0;
  const lowConfidenceIsBounded =
    params.lowConfidenceCases <= 1 &&
    (params.sameStructureRepeats >= 3 || params.rawChopSuppressedRows > 0);
  if (stableReducesNoise && (params.lowConfidenceCases === 0 || lowConfidenceIsBounded)) {
    reasons.push("stable structure reduces noisy raw flips into a calmer trader-useful state");
    return { verdict: "trusted_for_suppression", reasons };
  }

  if (params.lowConfidenceCases > 0 || immaterialRatio >= 0.35) {
    return { verdict: "watch_structure_chop", reasons };
  }
  if (stableReducesNoise) {
    reasons.push("stable structure reduces noise without removing the raw structure evidence");
    return { verdict: "trusted_for_suppression", reasons };
  }
  reasons.push("structure is useful as operator context until more Discord evidence accumulates");
  return { verdict: "operator_only", reasons };
}

export function buildMarketStructureCalibrationReport(
  options: BuildMarketStructureCalibrationReportOptions = {},
): MarketStructureCalibrationReport {
  const replay = buildMarketStructureReplayAuditReport(options.replay ?? {});
  const alignment = buildStableStructureDiscordAlignmentReport(options.alignment ?? {});
  const replayBySymbol = groupedCases(replay.cases);
  const alignmentBySymbol = groupedAlignment(alignment.perSymbol);
  const allSymbols = [...new Set([...replayBySymbol.keys(), ...alignmentBySymbol.keys()])].sort();

  const symbols = allSymbols.map((symbol): MarketStructureCalibrationSymbol => {
    const cases = replayBySymbol.get(symbol) ?? [];
    const aligned = alignmentBySymbol.get(symbol);
    const rawTransitions = cases.reduce((sum, item) => sum + item.stable.rawTransitionCount, 0);
    const stableTransitions = cases.reduce((sum, item) => sum + item.stable.stableTransitionCount, 0);
    const suppressedTransitions = cases.reduce((sum, item) => sum + item.stable.suppressedTransitionCount, 0);
    const immaterialTransitions = cases.reduce((sum, item) => sum + item.rolling.immaterialTransitionCount, 0);
    const lowConfidenceCases = cases.filter((item) => item.confidenceLabel === "low").length;
    const verdict = verdictFor({
      replayCases: cases.length,
      lowConfidenceCases,
      rawTransitions,
      stableTransitions,
      immaterialTransitions,
      sameStructureRepeats: aligned?.sameStructureRepeats ?? 0,
      alignedRows: aligned?.alignedRows ?? 0,
      rawChopSuppressedRows: aligned?.rawChopSuppressedRows ?? 0,
    });

    return {
      symbol,
      verdict: verdict.verdict,
      reasons: verdict.reasons,
      replayCases: cases.length,
      latestStates: uniqueLatestStates(cases),
      lowConfidenceCases,
      rangeBoundCases: cases.filter((item) => item.state === "range_bound").length,
      rawTransitions,
      stableTransitions,
      suppressedTransitions,
      immaterialTransitions,
      stableTransitionReductionPct: Number(average(cases.map((item) => item.stable.transitionReductionPct)).toFixed(2)),
      postedRows: aligned?.postedRows ?? 0,
      alignedRows: aligned?.alignedRows ?? 0,
      stableTransitionPosts: aligned?.stableTransitionPosts ?? 0,
      sameStructureRepeats: aligned?.sameStructureRepeats ?? 0,
      sameStructureRefreshes: aligned?.sameStructureRefreshes ?? 0,
      rawChopSuppressedRows: aligned?.rawChopSuppressedRows ?? 0,
      representativeReplayFindings: replayFindingText(cases),
      representativeRepeatedPosts: repeatedPostText(aligned),
    };
  }).sort((left, right) => {
    const rank: Record<MarketStructureCalibrationVerdict, number> = {
      watch_structure_chop: 0,
      trusted_for_suppression: 1,
      operator_only: 2,
      insufficient_evidence: 3,
    };
    return rank[left.verdict] - rank[right.verdict] ||
      right.sameStructureRepeats - left.sameStructureRepeats ||
      left.symbol.localeCompare(right.symbol);
  });

  return {
    generatedAt: new Date().toISOString(),
    replay: {
      cacheDirectory: replay.cacheDirectory,
      filesScanned: replay.filesScanned,
      symbolsScanned: replay.symbolsScanned,
      summary: replay.summary,
    },
    discordAlignment: {
      auditRoot: alignment.auditRoot,
      cacheDirectory: alignment.cacheDirectory,
      auditFilesScanned: alignment.auditFilesScanned,
      summary: alignment.summary,
    },
    totals: {
      symbols: symbols.length,
      trustedForSuppression: symbols.filter((item) => item.verdict === "trusted_for_suppression").length,
      watchStructureChop: symbols.filter((item) => item.verdict === "watch_structure_chop").length,
      operatorOnly: symbols.filter((item) => item.verdict === "operator_only").length,
      insufficientEvidence: symbols.filter((item) => item.verdict === "insufficient_evidence").length,
      rawTransitions: symbols.reduce((sum, item) => sum + item.rawTransitions, 0),
      stableTransitions: symbols.reduce((sum, item) => sum + item.stableTransitions, 0),
      suppressedTransitions: symbols.reduce((sum, item) => sum + item.suppressedTransitions, 0),
      sameStructureRepeats: symbols.reduce((sum, item) => sum + item.sameStructureRepeats, 0),
      alignedPostRows: symbols.reduce((sum, item) => sum + item.alignedRows, 0),
    },
    symbols,
  };
}

export function formatMarketStructureCalibrationMarkdown(report: MarketStructureCalibrationReport): string {
  const lines = [
    "# Market Structure Calibration Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Replay cache: ${report.replay.cacheDirectory}`,
    `Discord audit root: ${report.discordAlignment.auditRoot}`,
    "",
    "## Totals",
    "",
    `- symbols: ${report.totals.symbols}`,
    `- trusted for suppression: ${report.totals.trustedForSuppression}`,
    `- watch structure chop: ${report.totals.watchStructureChop}`,
    `- operator only: ${report.totals.operatorOnly}`,
    `- insufficient evidence: ${report.totals.insufficientEvidence}`,
    `- raw transitions: ${report.totals.rawTransitions}`,
    `- stable transitions: ${report.totals.stableTransitions}`,
    `- suppressed transitions: ${report.totals.suppressedTransitions}`,
    `- same-structure Discord repeats: ${report.totals.sameStructureRepeats}`,
    `- aligned post rows: ${report.totals.alignedPostRows}`,
    "",
    "## Symbol Calibration",
    "",
  ];

  for (const symbol of report.symbols.slice(0, 120)) {
    lines.push(
      `### ${symbol.symbol} - ${symbol.verdict}`,
      "",
      `- reasons: ${symbol.reasons.join("; ") || "none"}`,
      `- replay cases: ${symbol.replayCases}; states: ${symbol.latestStates.join(", ") || "n/a"}; low confidence: ${symbol.lowConfidenceCases}; range-bound cases: ${symbol.rangeBoundCases}`,
      `- transitions: raw ${symbol.rawTransitions}; stable ${symbol.stableTransitions}; suppressed ${symbol.suppressedTransitions}; immaterial ${symbol.immaterialTransitions}; reduction ${symbol.stableTransitionReductionPct.toFixed(2)}%`,
      `- Discord alignment: posted ${symbol.postedRows}; aligned ${symbol.alignedRows}; transition posts ${symbol.stableTransitionPosts}; same repeats ${symbol.sameStructureRepeats}; refreshes ${symbol.sameStructureRefreshes}; raw chop suppressible ${symbol.rawChopSuppressedRows}`,
      `- replay findings: ${symbol.representativeReplayFindings.join(" | ") || "none"}`,
      `- repeated-post evidence: ${symbol.representativeRepeatedPosts.join(" | ") || "none"}`,
      "",
    );
  }

  return `${lines.join("\n")}\n`;
}

export function writeMarketStructureCalibrationReport(
  options: WriteMarketStructureCalibrationReportOptions,
): MarketStructureCalibrationReport {
  const report = buildMarketStructureCalibrationReport(options);
  mkdirSync(dirname(resolve(options.jsonPath)), { recursive: true });
  mkdirSync(dirname(resolve(options.markdownPath)), { recursive: true });
  writeFileSync(options.jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(options.markdownPath, formatMarketStructureCalibrationMarkdown(report), "utf8");
  return report;
}
