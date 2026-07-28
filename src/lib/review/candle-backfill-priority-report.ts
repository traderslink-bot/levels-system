import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  buildCandleImportReadinessReport,
  type BuildCandleImportReadinessReportOptions,
} from "./candle-import-readiness-report.js";
import { buildAllSymbolStressReport, type AllSymbolStressSymbol } from "./all-symbol-stress-report.js";
import {
  generateWhyNoPostReplayProof,
  type WhyNoPostReplayProofSymbol,
} from "./why-no-post-replay-proof.js";
import {
  buildSupportResistanceCalibrationReport,
  type SupportResistanceCalibrationSymbolReport,
} from "./support-resistance-calibration-report.js";
import type {
  CandleFetchTimeframe,
  CandleProviderName,
  WarehouseMissingCandleBackfillTask,
} from "../support-resistance/index.js";

export type CandleBackfillPriorityLevel = "fetch_first" | "fetch_next" | "fetch_later";

export type CandleBackfillPriorityTask = {
  provider: CandleProviderName;
  symbol: string;
  sessionDate: string;
  timeframe: CandleFetchTimeframe;
  priority: CandleBackfillPriorityLevel;
  score: number;
  reasons: string[];
  startTimestamp: number;
  endTimestamp: number;
  estimatedCandleCount: number;
  missingCandleCountEstimate: number;
  likelyNoBarMissingCandleCountEstimate: number;
  storedCandles: number;
  tradeRequestCount: number;
};

export type CandleBackfillPrioritySymbolSession = {
  symbol: string;
  sessionDate: string;
  priority: CandleBackfillPriorityLevel;
  score: number;
  missingTimeframes: CandleFetchTimeframe[];
  taskCount: number;
  estimatedMissingCandles: number;
  likelyNoBarMissingCandles: number;
  reasons: string[];
};

export type CandleBackfillPriorityStage = {
  stageIndex: number;
  priority: CandleBackfillPriorityLevel;
  taskCount: number;
  estimatedCandleCount: number;
  symbols: string[];
  timeframes: CandleFetchTimeframe[];
  tasks: CandleBackfillPriorityTask[];
};

export type CandleBackfillPriorityReport = {
  generatedAt: string;
  sourceAuditPath: string;
  sourceAuditPaths: string[];
  warehouseDirectoryPath: string;
  cacheDirectoryPath: string;
  provider: CandleProviderName;
  totals: {
    missingTasks: number;
    fetchFirstTasks: number;
    fetchNextTasks: number;
    fetchLaterTasks: number;
    estimatedMissingCandles: number;
    likelyNoBarMissingCandles: number;
    priorityStages: number;
    quietMayHideSymbols: number;
    runtimeSilenceSymbols: number;
    unprovenQuietSymbols: number;
    postNoiseBudgetSymbols: number;
    supportResistanceWatchSymbols: number;
    supportResistanceBrokenSymbols: number;
    supportResistanceUnprovenSymbols: number;
  };
  rankedTasks: CandleBackfillPriorityTask[];
  priorityBySymbolSession: CandleBackfillPrioritySymbolSession[];
  providerStages: CandleBackfillPriorityStage[];
};

export type BuildCandleBackfillPriorityReportOptions = BuildCandleImportReadinessReportOptions & {
  cacheDirectoryPath?: string;
  maxTasksPerStage?: number;
  maxEstimatedCandlesPerStage?: number;
};

export type WriteCandleBackfillPriorityReportOptions = BuildCandleBackfillPriorityReportOptions & {
  jsonPath: string;
  markdownPath: string;
};

const DEFAULT_CACHE_DIRECTORY = ".validation-cache/candles";

const TIMEFRAME_PRIORITY: Record<CandleFetchTimeframe, number> = {
  "5m": 180,
  daily: 160,
  "4h": 140,
  "1m": 80,
};

const TIMEFRAME_ORDER: Record<CandleFetchTimeframe, number> = {
  "5m": 0,
  daily: 1,
  "4h": 2,
  "1m": 3,
};

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function priorityFromScore(score: number): CandleBackfillPriorityLevel {
  if (score >= 900) {
    return "fetch_first";
  }
  if (score >= 450) {
    return "fetch_next";
  }
  return "fetch_later";
}

function scoreTask(params: {
  task: WarehouseMissingCandleBackfillTask;
  why?: WhyNoPostReplayProofSymbol;
  stress?: AllSymbolStressSymbol;
  supportResistance?: SupportResistanceCalibrationSymbolReport;
}): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = TIMEFRAME_PRIORITY[params.task.timeframe] ?? 50;

  if (params.why?.verdict === "quiet_may_hide_move") {
    score += 1_000;
    reasons.push(`quiet may hide ${params.why.missedCount} candle-backed move candidate(s)`);
    if (params.why.majorCount > 0) {
      score += params.why.majorCount * 35;
      reasons.push(`${params.why.majorCount} major missed candidate(s) need candle proof`);
    }
  } else if (params.why?.verdict === "unproven_runtime_silence") {
    score += 700;
    reasons.push("quiet behavior is unproven because runtime/feed evidence was silent near a candle-backed move");
  } else if (params.why?.verdict === "unproven_missing_candles") {
    score += 500;
    reasons.push("quiet behavior is unproven because candle coverage is missing");
  } else if (params.why?.verdict === "quiet_preserved_meaningful_moves") {
    score += 200;
    reasons.push("meaningful moves were preserved, but coverage still improves proof quality");
  } else if (params.why?.verdict === "quiet_supported_by_candles") {
    score += 100;
    reasons.push("quiet behavior was supported by available candles; lower backfill urgency");
  }

  if (params.stress && params.stress.postBudget.status !== "within_budget") {
    const overBudget = Math.max(0, params.stress.maxSimulatedPostsInSession - params.stress.budgetSessionLimit);
    score += 350 + overBudget * 15;
    reasons.push(`post-budget ${params.stress.postBudget.status}: ${params.stress.postBudget.reason}`);
  }

  if (params.supportResistance?.verdict === "broken") {
    score += 1_200;
    reasons.push("support/resistance calibration marked this symbol broken");
  } else if (params.supportResistance?.verdict === "unproven") {
    score += 650;
    reasons.push("support/resistance calibration is unproven and needs candle coverage");
  } else if (params.supportResistance?.verdict === "watch") {
    score += 400;
    reasons.push("support/resistance calibration found watch-level ladder/ranking evidence");
  }

  const matchingCoverageGap = params.supportResistance?.coverageGaps.find((gap) => gap.timeframe === params.task.timeframe);
  if (matchingCoverageGap) {
    score += matchingCoverageGap.priority === "fetch_first" ? 550 : matchingCoverageGap.priority === "fetch_next" ? 250 : 75;
    reasons.push(`support/resistance coverage gap: ${matchingCoverageGap.reason}`);
  }

  if (params.supportResistance?.forwardLadder.nearestResistance === null && params.task.timeframe !== "1m") {
    score += 180;
    reasons.push("support/resistance audit needs forward resistance proof");
  }
  if (params.supportResistance?.marketStructure.alignment === "questions_ladder") {
    score += 300;
    reasons.push("market structure questioned the generated support/resistance ladder");
  }

  if (params.task.timeframe === "5m") {
    score += 80;
    reasons.push("5m candles are needed for why-no-post, market-structure, and volume proof");
  } else if (params.task.timeframe === "daily" || params.task.timeframe === "4h") {
    score += 55;
    reasons.push(`${params.task.timeframe} candles are needed for support/resistance ladder proof`);
  } else {
    reasons.push("1m candles support future trade-window review after higher proof gaps are handled");
  }

  if (params.task.coverage.candleCount > 0) {
    score += 25;
    reasons.push(`${params.task.coverage.candleCount} candle(s) already stored; partial range can be completed`);
  }

  score += Math.min(50, Math.floor(params.task.missingCandleCountEstimate / 25));
  reasons.push(`${params.task.missingCandleCountEstimate} estimated missing candle(s)`);
  if ((params.task.likelyNoBarMissingCandleCountEstimate ?? 0) > 0) {
    reasons.push(`${params.task.likelyNoBarMissingCandleCountEstimate} likely no-bar/off-hours intraday gap candle(s) ignored`);
  }

  return {
    score,
    reasons: unique(reasons),
  };
}

function rankTasks(
  tasks: WarehouseMissingCandleBackfillTask[],
  whyBySymbol: Map<string, WhyNoPostReplayProofSymbol>,
  stressBySymbol: Map<string, AllSymbolStressSymbol>,
  supportResistanceBySymbol: Map<string, SupportResistanceCalibrationSymbolReport>,
): CandleBackfillPriorityTask[] {
  return tasks
    .map((task) => {
      const scored = scoreTask({
        task,
        why: whyBySymbol.get(task.symbol),
        stress: stressBySymbol.get(task.symbol),
        supportResistance: supportResistanceBySymbol.get(task.symbol),
      });
      return {
        provider: task.provider,
        symbol: task.symbol,
        sessionDate: task.sessionDate,
        timeframe: task.timeframe,
        priority: priorityFromScore(scored.score),
        score: scored.score,
        reasons: scored.reasons,
        startTimestamp: task.startTimestamp,
        endTimestamp: task.endTimestamp,
        estimatedCandleCount: task.estimatedCandleCount ?? 0,
        missingCandleCountEstimate: task.missingCandleCountEstimate,
        likelyNoBarMissingCandleCountEstimate: task.likelyNoBarMissingCandleCountEstimate ?? 0,
        storedCandles: task.coverage.candleCount,
        tradeRequestCount: task.tradeRequestCount ?? 1,
      };
    })
    .sort((left, right) =>
      right.score - left.score ||
      TIMEFRAME_ORDER[left.timeframe] - TIMEFRAME_ORDER[right.timeframe] ||
      left.symbol.localeCompare(right.symbol) ||
      left.sessionDate.localeCompare(right.sessionDate),
    );
}

function buildSymbolSessions(tasks: CandleBackfillPriorityTask[]): CandleBackfillPrioritySymbolSession[] {
  const grouped = new Map<string, CandleBackfillPriorityTask[]>();
  for (const task of tasks) {
    const key = `${task.symbol}:${task.sessionDate}`;
    grouped.set(key, [...(grouped.get(key) ?? []), task]);
  }

  return [...grouped.values()]
    .map((items) => {
      const score = Math.max(...items.map((item) => item.score));
      return {
        symbol: items[0]!.symbol,
        sessionDate: items[0]!.sessionDate,
        priority: priorityFromScore(score),
        score,
        missingTimeframes: unique(items.map((item) => item.timeframe)).sort((left, right) => TIMEFRAME_ORDER[left] - TIMEFRAME_ORDER[right]),
        taskCount: items.length,
        estimatedMissingCandles: items.reduce((sum, item) => sum + item.missingCandleCountEstimate, 0),
        likelyNoBarMissingCandles: items.reduce((sum, item) => sum + item.likelyNoBarMissingCandleCountEstimate, 0),
        reasons: unique(items.flatMap((item) => item.reasons)).slice(0, 8),
      };
    })
    .sort((left, right) =>
      right.score - left.score ||
      right.estimatedMissingCandles - left.estimatedMissingCandles ||
      left.symbol.localeCompare(right.symbol),
    );
}

function stageTasks(
  tasks: CandleBackfillPriorityTask[],
  options: Pick<BuildCandleBackfillPriorityReportOptions, "maxTasksPerStage" | "maxEstimatedCandlesPerStage">,
): CandleBackfillPriorityStage[] {
  const maxTasksPerStage = Math.max(1, options.maxTasksPerStage ?? 25);
  const maxEstimatedCandlesPerStage = Math.max(1, options.maxEstimatedCandlesPerStage ?? 8_000);
  const stages: CandleBackfillPriorityStage[] = [];
  let current: CandleBackfillPriorityTask[] = [];
  let currentCandles = 0;

  function flush(): void {
    if (current.length === 0) {
      return;
    }
    stages.push({
      stageIndex: stages.length + 1,
      priority: current.some((task) => task.priority === "fetch_first")
        ? "fetch_first"
        : current.some((task) => task.priority === "fetch_next")
          ? "fetch_next"
          : "fetch_later",
      taskCount: current.length,
      estimatedCandleCount: currentCandles,
      symbols: unique(current.map((task) => task.symbol)).sort(),
      timeframes: unique(current.map((task) => task.timeframe)).sort((left, right) => TIMEFRAME_ORDER[left] - TIMEFRAME_ORDER[right]),
      tasks: current,
    });
    current = [];
    currentCandles = 0;
  }

  for (const task of tasks) {
    const taskCandles = task.estimatedCandleCount || task.missingCandleCountEstimate || 1;
    const wouldOverflowTasks = current.length >= maxTasksPerStage;
    const wouldOverflowCandles = current.length > 0 && currentCandles + taskCandles > maxEstimatedCandlesPerStage;
    const wouldMixPriority = current.length > 0 && current[0]!.priority !== task.priority;
    if (wouldOverflowTasks || wouldOverflowCandles || wouldMixPriority) {
      flush();
    }
    current.push(task);
    currentCandles += taskCandles;
  }
  flush();
  return stages;
}

export async function buildCandleBackfillPriorityReport(
  options: BuildCandleBackfillPriorityReportOptions,
): Promise<CandleBackfillPriorityReport> {
  const cacheDirectoryPath = options.cacheDirectoryPath ?? DEFAULT_CACHE_DIRECTORY;
  const provider = options.provider ?? "ibkr";
  const [readiness, whyNoPost, stress, supportResistance] = await Promise.all([
    buildCandleImportReadinessReport(options),
    Promise.resolve(generateWhyNoPostReplayProof({
      auditPath: options.auditPath,
      cacheDirectoryPath,
      warehouseDirectoryPath: options.warehouseDirectoryPath,
      provider,
      includeReplayEvidence: false,
      maxAuditFiles: options.maxAuditFiles,
    })),
    buildAllSymbolStressReport(options.auditPath, { maxAuditFiles: options.maxAuditFiles }),
    buildSupportResistanceCalibrationReport({
      auditPath: options.auditPath,
      cacheDirectoryPath,
      warehouseDirectoryPath: options.warehouseDirectoryPath,
      provider,
      maxAuditFiles: options.maxAuditFiles,
    }),
  ]);

  const whyBySymbol = new Map(whyNoPost.symbols.map((symbol) => [symbol.symbol, symbol]));
  const stressBySymbol = new Map(stress.symbols.map((symbol) => [symbol.symbol, symbol]));
  const supportResistanceBySymbol = new Map(supportResistance.symbols.map((symbol) => [symbol.symbol, symbol]));
  const rankedTasks = rankTasks(readiness.plan.tasks, whyBySymbol, stressBySymbol, supportResistanceBySymbol);
  const providerStages = stageTasks(rankedTasks, options);

  return {
    generatedAt: new Date().toISOString(),
    sourceAuditPath: readiness.sourceAuditPath,
    sourceAuditPaths: readiness.sourceAuditPaths,
    warehouseDirectoryPath: readiness.warehouseDirectoryPath,
    cacheDirectoryPath,
    provider,
    totals: {
      missingTasks: rankedTasks.length,
      fetchFirstTasks: rankedTasks.filter((task) => task.priority === "fetch_first").length,
      fetchNextTasks: rankedTasks.filter((task) => task.priority === "fetch_next").length,
      fetchLaterTasks: rankedTasks.filter((task) => task.priority === "fetch_later").length,
      estimatedMissingCandles: rankedTasks.reduce((sum, task) => sum + task.missingCandleCountEstimate, 0),
      likelyNoBarMissingCandles: readiness.plan.likelyNoBarMissingCandleCountEstimate,
      priorityStages: providerStages.length,
      quietMayHideSymbols: whyNoPost.totals.quietMayHideMove,
      runtimeSilenceSymbols: whyNoPost.totals.unprovenRuntimeSilence,
      unprovenQuietSymbols: whyNoPost.totals.unprovenMissingCandles,
      postNoiseBudgetSymbols: stress.totals.postBudgetWatchSymbols +
        stress.totals.postBudgetExcessiveChopSymbols +
        stress.totals.postBudgetRunnerReviewSymbols,
      supportResistanceWatchSymbols: supportResistance.totals.watch,
      supportResistanceBrokenSymbols: supportResistance.totals.broken,
      supportResistanceUnprovenSymbols: supportResistance.totals.unproven,
    },
    rankedTasks,
    priorityBySymbolSession: buildSymbolSessions(rankedTasks),
    providerStages,
  };
}

function iso(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

export function formatCandleBackfillPriorityReport(report: CandleBackfillPriorityReport): string {
  const lines = [
    "# Candle Backfill Priority Report",
    "",
    "Operator-only report. It ranks missing candle ranges by audit value so backfill work starts with the data needed to prove quiet-risk and noisy-symbol findings.",
    "",
    `Generated: ${report.generatedAt}`,
    `Source audit: ${report.sourceAuditPath}`,
    `Source audit files: ${report.sourceAuditPaths.length}`,
    `Warehouse: ${report.warehouseDirectoryPath}`,
    `Candle cache: ${report.cacheDirectoryPath}`,
    `Provider: ${report.provider}`,
    "",
    "## Totals",
    "",
    `- missing tasks: ${report.totals.missingTasks}`,
    `- fetch first tasks: ${report.totals.fetchFirstTasks}`,
    `- fetch next tasks: ${report.totals.fetchNextTasks}`,
    `- fetch later tasks: ${report.totals.fetchLaterTasks}`,
    `- estimated missing candles: ${report.totals.estimatedMissingCandles}`,
    `- likely no-bar/off-hours intraday gaps ignored: ${report.totals.likelyNoBarMissingCandles}`,
    `- priority stages: ${report.totals.priorityStages}`,
    `- quiet may-hide symbols: ${report.totals.quietMayHideSymbols}`,
    `- runtime/feed silence symbols: ${report.totals.runtimeSilenceSymbols}`,
    `- unproven quiet symbols: ${report.totals.unprovenQuietSymbols}`,
    `- post-noise budget symbols: ${report.totals.postNoiseBudgetSymbols}`,
    `- support/resistance watch symbols: ${report.totals.supportResistanceWatchSymbols}`,
    `- support/resistance broken symbols: ${report.totals.supportResistanceBrokenSymbols}`,
    `- support/resistance unproven symbols: ${report.totals.supportResistanceUnprovenSymbols}`,
    "",
    "## Priority Stages",
    "",
    "| Stage | Priority | Tasks | Est. Candles | Symbols | Timeframes | First Tasks |",
    "| ---: | --- | ---: | ---: | --- | --- | --- |",
  ];

  for (const stage of report.providerStages.slice(0, 60)) {
    const firstTasks = stage.tasks
      .slice(0, 5)
      .map((task) => `${task.symbol} ${task.sessionDate} ${task.timeframe}`)
      .join("<br>");
    lines.push(
      `| ${stage.stageIndex} | ${stage.priority} | ${stage.taskCount} | ${stage.estimatedCandleCount} | ${stage.symbols.slice(0, 10).join(", ")} | ${stage.timeframes.join(", ")} | ${firstTasks} |`,
    );
  }
  if (!report.providerStages.length) {
    lines.push("| n/a | n/a | 0 | 0 | none | none | none |");
  }

  lines.push("", "## Fetch First Symbol / Session Gaps", "");
  lines.push("| Symbol | Session | Priority | Score | Missing Timeframes | Missing Candles | Likely No-Bar Gaps | Reasons |");
  lines.push("| --- | --- | --- | ---: | --- | ---: | ---: | --- |");
  for (const item of report.priorityBySymbolSession
    .filter((symbol) => symbol.priority === "fetch_first")
    .slice(0, 80)) {
    lines.push(
      `| ${item.symbol} | ${item.sessionDate} | ${item.priority} | ${item.score} | ${item.missingTimeframes.join(", ")} | ${item.estimatedMissingCandles} | ${item.likelyNoBarMissingCandles} | ${item.reasons.join("<br>")} |`,
    );
  }

  lines.push("", "## Top Ranked Missing Tasks", "");
  lines.push("| Rank | Symbol | Session | Timeframe | Priority | Score | Stored | Missing Candles | Likely No-Bar Gaps | Range | Reasons |");
  lines.push("| ---: | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- |");
  report.rankedTasks.slice(0, 120).forEach((task, index) => {
    lines.push(
      `| ${index + 1} | ${task.symbol} | ${task.sessionDate} | ${task.timeframe} | ${task.priority} | ${task.score} | ${task.storedCandles} | ${task.missingCandleCountEstimate} | ${task.likelyNoBarMissingCandleCountEstimate} | ${iso(task.startTimestamp)} to ${iso(task.endTimestamp)} | ${task.reasons.join("<br>")} |`,
    );
  });

  lines.push("", "## Backfill Guidance", "");
  lines.push("- Start with `fetch_first` stages because they contain symbols where quiet periods may have hidden candle-backed moves or where the audit cannot prove quiet behavior without candles.");
  lines.push("- Keep `fetch_next` staged behind the first pass; these usually improve noisy-symbol validation or finish meaningful but less urgent coverage.");
  lines.push("- Treat `fetch_later` as ordinary warehouse coverage unless a live issue points back to that symbol/session.");
  lines.push("- This report does not fetch provider data. Use it to choose bounded `candles:backfill --max-tasks ...` runs.");
  lines.push("- Intraday gaps outside the 04:00-20:00 ET extended session are treated as likely no-bar ranges and are not ranked as provider backfill work.");

  return `${lines.join("\n")}\n`;
}

export async function writeCandleBackfillPriorityReport(
  options: WriteCandleBackfillPriorityReportOptions,
): Promise<CandleBackfillPriorityReport> {
  const report = await buildCandleBackfillPriorityReport(options);
  mkdirSync(dirname(resolve(options.jsonPath)), { recursive: true });
  mkdirSync(dirname(resolve(options.markdownPath)), { recursive: true });
  writeFileSync(options.jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(options.markdownPath, formatCandleBackfillPriorityReport(report), "utf8");
  return report;
}
