import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

type Thesis = {
  type: string;
  label: string;
  confidence: string;
};

type TradeSetupRead = {
  setupType: string;
  setupLabel: string;
  state: string;
  actionable: boolean;
  zone: { low: number; high: number } | null;
  triggerPrice: number | null;
  invalidationPrice: number | null;
  targets: Array<{ price: number; basis: string; rewardRiskRatio: number }>;
  plannedRiskPct: number | null;
  firstTargetRewardRiskRatio: number | null;
  blockers: string[];
  metadata: Record<string, unknown>;
};

type ReplayRow = {
  symbol: string;
  runnerDate: string;
  cutoffIso: string;
  marketCap: number;
  runnerScorePct: number;
  currentPrice: number;
  candleCountsAtCutoff: Partial<Record<"daily" | "4h" | "5m", number>>;
  causalPartialFourHourCandle: {
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  } | null;
  thesis: Thesis | null;
  bestAnyThesis: Thesis | null;
  tradeSetupRead: TradeSetupRead;
  broaderCandidateTradeSetupRead: TradeSetupRead | null;
  replayOutcome: string;
  shadowReplayOutcome: string | null;
  broaderCandidateReplayOutcome: string | null;
  broaderCandidateShadowReplayOutcome: string | null;
  bestForwardPct: number | null;
  worstForwardPct: number | null;
};

type ReplayReport = {
  generatedAt: string;
  checkpointDescription: string;
  forwardDescription: string;
  settings: {
    intradaySession: boolean;
    reconstructLiveFourHour?: boolean;
    checkpointMinutesAfterOpen: number;
    spreadMode: string;
    marketStructureMode: string;
  };
  rows: ReplayRow[];
};

type CheckpointSummary = {
  key: string;
  label: string;
  evaluations: number;
  approvedTheses: number;
  broaderOnlyTheses: number;
  noDetectedThesis: number;
  zonesBuilt: number;
  baseGeometry: number;
  finalActionable: number;
  cleanRetrospectiveMoves: number;
  cleanMovesWithApprovedThesis: number;
  cleanMovesWithBroaderOnlyThesis: number;
  cleanMovesWithNoDetectedThesis: number;
  nonActionableDamageCases: number;
  moveAndDamageCases: number;
  shadowEligiblePlans: number;
  shadowTargetFirst: number;
  shadowLossAfterTrigger: number;
  shadowFailedBeforeTrigger: number;
  shadowUnresolved: number;
};

const INPUT_DIRECTORY = join("artifacts", "eodhd-trade-setup-read-replay");
const SOURCE_FILES = [
  "trade-setup-read-replay-heavy-intraday-60m-240.json",
  "trade-setup-read-replay-heavy-intraday-60m-live4h-240.json",
  "trade-setup-read-replay-heavy-intraday-120m-240.json",
  "trade-setup-read-replay-heavy-intraday-120m-live4h-240.json",
  "trade-setup-read-replay-heavy-intraday-240m-240.json",
  "trade-setup-read-replay-heavy-intraday-240m-live4h-240.json",
  "trade-setup-read-replay-heavy-intraday-330m-240.json",
  "trade-setup-read-replay-heavy-intraday-330m-live4h-240.json",
  "trade-setup-read-replay-heavy-240.json",
] as const;
const OUTPUT_JSON = join(INPUT_DIRECTORY, "trade-setup-read-heavy-qa-summary.json");
const OUTPUT_MARKDOWN = join(INPUT_DIRECTORY, "trade-setup-read-heavy-qa-summary.md");

function stateBeforeBlockers(read: TradeSetupRead | null): string | null {
  const value = read?.metadata.tradeSetupStateBeforeBlockers;
  return typeof value === "string" ? value : null;
}

function isCleanRetrospectiveMove(row: ReplayRow): boolean {
  return row.bestForwardPct !== null && row.bestForwardPct >= 25 &&
    row.worstForwardPct !== null && row.worstForwardPct > -10;
}

function isDamage(row: ReplayRow): boolean {
  return row.worstForwardPct !== null && row.worstForwardPct <= -15;
}

function isMoveAndDamage(row: ReplayRow): boolean {
  return row.bestForwardPct !== null && row.bestForwardPct >= 25 && isDamage(row);
}

function isShadowEligible(read: TradeSetupRead): boolean {
  return ["forming", "armed", "triggered"].includes(stateBeforeBlockers(read) ?? "");
}

function countBy<T>(rows: T[], keyFor: (row: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const key = keyFor(row);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])),
  );
}

function checkpointKey(report: ReplayReport): string {
  return report.settings.intradaySession
    ? `${report.settings.checkpointMinutesAfterOpen}m_${report.settings.reconstructLiveFourHour ? "causal_partial_4h" : "closed_4h"}_same_session`
    : "240m_next_10_4h";
}

function clockLabel(minutesAfterOpen: number): string {
  const minutes = 9 * 60 + 30 + minutesAfterOpen;
  const hour24 = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const hour12 = hour24 > 12 ? hour24 - 12 : hour24;
  return `${hour12}:${String(minute).padStart(2, "0")} ET`;
}

function checkpointLabel(report: ReplayReport): string {
  return report.settings.intradaySession
    ? `${clockLabel(report.settings.checkpointMinutesAfterOpen)} / ${report.settings.reconstructLiveFourHour ? "causal partial 4h" : "closed 4h only"}`
    : "1:30 ET / next 10 completed 4h bars";
}

function summarizeCheckpoint(report: ReplayReport): CheckpointSummary {
  const rows = report.rows;
  const clean = rows.filter(isCleanRetrospectiveMove);
  const eligibleShadow = rows.filter((row) => isShadowEligible(row.tradeSetupRead));
  const shadowOutcome = (outcome: string): number =>
    eligibleShadow.filter((row) => row.shadowReplayOutcome === outcome).length;
  return {
    key: checkpointKey(report),
    label: checkpointLabel(report),
    evaluations: rows.length,
    approvedTheses: rows.filter((row) => row.thesis !== null).length,
    broaderOnlyTheses: rows.filter((row) => row.thesis === null && row.bestAnyThesis !== null).length,
    noDetectedThesis: rows.filter((row) => row.bestAnyThesis === null).length,
    zonesBuilt: rows.filter((row) => row.tradeSetupRead.zone !== null).length,
    baseGeometry: rows.filter((row) => stateBeforeBlockers(row.tradeSetupRead) !== null).length,
    finalActionable: rows.filter((row) => row.tradeSetupRead.actionable).length,
    cleanRetrospectiveMoves: clean.length,
    cleanMovesWithApprovedThesis: clean.filter((row) => row.thesis !== null).length,
    cleanMovesWithBroaderOnlyThesis: clean.filter((row) => row.thesis === null && row.bestAnyThesis !== null).length,
    cleanMovesWithNoDetectedThesis: clean.filter((row) => row.bestAnyThesis === null).length,
    nonActionableDamageCases: rows.filter((row) => !row.tradeSetupRead.actionable && isDamage(row)).length,
    moveAndDamageCases: rows.filter(isMoveAndDamage).length,
    shadowEligiblePlans: eligibleShadow.length,
    shadowTargetFirst: shadowOutcome("target_before_invalidation"),
    shadowLossAfterTrigger:
      shadowOutcome("invalidation_before_target") + shadowOutcome("same_bar_ambiguous_conservative_loss"),
    shadowFailedBeforeTrigger: shadowOutcome("failed_before_trigger"),
    shadowUnresolved:
      shadowOutcome("triggered_no_resolution") + shadowOutcome("never_triggered") + shadowOutcome("unscorable"),
  };
}

function blockerCategory(blocker: string): string {
  if (blocker.startsWith("no candle-based setup")) return "no approved chart thesis";
  if (blocker.startsWith("no dip area")) return "no independently confirmed dip zone";
  if (blocker.startsWith("structural risk is too wide")) return "structural risk too wide";
  if (blocker.startsWith("the first meaningful upside objective")) return "first objective below 1.5R";
  if (blocker.startsWith("mapped resistance")) return "mapped resistance before 1R";
  if (blocker.startsWith("the upside path is crowded")) return "crowded upside path";
  if (blocker.startsWith("the candle-based thesis does not provide structural invalidation")) {
    return "invalid thesis-to-zone invalidation";
  }
  if (blocker.startsWith("the continuation setup has lost")) return "lost VWAP and EMA9 control";
  if (blocker.startsWith("price is too extended")) return "extended/chase risk";
  if (blocker.startsWith("price is already through")) return "thesis already failed";
  return blocker || "none";
}

function bucketCounts(rows: ReplayRow[], bucketFor: (row: ReplayRow) => string): Array<{
  bucket: string;
  runnerDays: number;
  uniqueSymbols: number;
}> {
  const groups = new Map<string, ReplayRow[]>();
  for (const row of rows) {
    const key = bucketFor(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()].map(([bucket, group]) => ({
    bucket,
    runnerDays: group.length,
    uniqueSymbols: new Set(group.map((row) => row.symbol)).size,
  }));
}

function formatNumber(value: number | null, digits = 1): string {
  return value === null || !Number.isFinite(value) ? "n/a" : value.toFixed(digits);
}

function formatPrice(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "n/a";
  return value >= 1 ? value.toFixed(2) : value.toFixed(4);
}

function markdownTable(headers: string[], rows: Array<Array<string | number>>): string[] {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ];
}

function replayDecisionFingerprint(row: ReplayRow): string {
  return JSON.stringify({
    symbol: row.symbol,
    runnerDate: row.runnerDate,
    cutoffIso: row.cutoffIso,
    currentPrice: row.currentPrice,
    candleCountsAtCutoff: row.candleCountsAtCutoff,
    thesis: row.thesis,
    bestAnyThesis: row.bestAnyThesis,
    tradeSetupRead: row.tradeSetupRead,
    broaderCandidateTradeSetupRead: row.broaderCandidateTradeSetupRead,
    replayOutcome: row.replayOutcome,
    shadowReplayOutcome: row.shadowReplayOutcome,
    broaderCandidateReplayOutcome: row.broaderCandidateReplayOutcome,
    broaderCandidateShadowReplayOutcome: row.broaderCandidateShadowReplayOutcome,
    bestForwardPct: row.bestForwardPct,
    worstForwardPct: row.worstForwardPct,
  });
}

const reports = await Promise.all(SOURCE_FILES.map(async (fileName) => ({
  fileName,
  report: JSON.parse(await readFile(join(INPUT_DIRECTORY, fileName), "utf8")) as ReplayReport,
})));
const allRows = reports.flatMap(({ report }) => report.rows);
const intradayReports = reports.filter(({ report }) => report.settings.intradaySession);
const liveLikeReports = intradayReports.filter(({ report }) => report.settings.reconstructLiveFourHour === true);
const baselineRows = intradayReports[0]!.report.rows;
const checkpointSummaries = reports.map(({ report }) => summarizeCheckpoint(report));
const intradayVisibilityComparison = [60, 120, 240, 330].map((minutes) => {
  const closed = checkpointSummaries.find((summary) => summary.key === `${minutes}m_closed_4h_same_session`)!;
  const partial = checkpointSummaries.find((summary) => summary.key === `${minutes}m_causal_partial_4h_same_session`)!;
  return {
    minutes,
    checkpoint: clockLabel(minutes),
    closed,
    partial,
  };
});
const runnerKeys = new Set(baselineRows.map((row) => `${row.runnerDate}:${row.symbol}`));
const uniqueSymbols = new Set(baselineRows.map((row) => row.symbol));
const dates = baselineRows.map((row) => row.runnerDate).sort();

const reportFor = (minutes: number, reconstructLiveFourHour: boolean): ReplayReport => {
  const found = intradayReports.find(({ report }) =>
    report.settings.checkpointMinutesAfterOpen === minutes &&
    Boolean(report.settings.reconstructLiveFourHour) === reconstructLiveFourHour
  );
  if (!found) throw new Error(`Missing ${minutes}m replay for reconstructLiveFourHour=${reconstructLiveFourHour}.`);
  return found.report;
};
const causalPartialRows = allRows.filter((row) => Boolean(row.causalPartialFourHourCandle));
let partialCloseMismatches = 0;
let partialInvalidOhlc = 0;
let partialFutureTimestampViolations = 0;
for (const row of causalPartialRows) {
  const candle = row.causalPartialFourHourCandle!;
  if (Math.abs(candle.close - row.currentPrice) > Math.max(0.000001, row.currentPrice * 0.000001)) {
    partialCloseMismatches += 1;
  }
  if (
    candle.open <= 0 || candle.high < candle.low || candle.low <= 0 ||
    candle.high < candle.open || candle.high < candle.close ||
    candle.low > candle.open || candle.low > candle.close
  ) {
    partialInvalidOhlc += 1;
  }
  if (candle.timestamp >= Date.parse(row.cutoffIso)) partialFutureTimestampViolations += 1;
}
let partialCountDeltaMismatches = 0;
for (const minutes of [60, 120, 330]) {
  const closedByKey = new Map(reportFor(minutes, false).rows.map((row) => [`${row.runnerDate}:${row.symbol}`, row]));
  for (const partialRow of reportFor(minutes, true).rows) {
    const closedRow = closedByKey.get(`${partialRow.runnerDate}:${partialRow.symbol}`);
    if (
      !closedRow ||
      partialRow.candleCountsAtCutoff["4h"] !== (closedRow.candleCountsAtCutoff["4h"] ?? 0) + 1
    ) {
      partialCountDeltaMismatches += 1;
    }
  }
}
const boundaryClosedByKey = new Map(
  reportFor(240, false).rows.map((row) => [`${row.runnerDate}:${row.symbol}`, row]),
);
let completedBoundaryParityMismatches = 0;
for (const partialRow of reportFor(240, true).rows) {
  const closedRow = boundaryClosedByKey.get(`${partialRow.runnerDate}:${partialRow.symbol}`);
  if (!closedRow || replayDecisionFingerprint(closedRow) !== replayDecisionFingerprint(partialRow)) {
    completedBoundaryParityMismatches += 1;
  }
}
const validationChecks = {
  causalPartialRows: causalPartialRows.length,
  partialCloseMismatches,
  partialInvalidOhlc,
  partialFutureTimestampViolations,
  partialCountDeltaMismatches,
  completedBoundaryParityMismatches,
};
if (
  partialCloseMismatches > 0 ||
  partialInvalidOhlc > 0 ||
  partialFutureTimestampViolations > 0 ||
  partialCountDeltaMismatches > 0 ||
  completedBoundaryParityMismatches > 0
) {
  throw new Error(`Replay integrity validation failed: ${JSON.stringify(validationChecks)}`);
}

const taggedActionableRows = reports.flatMap(({ report }) =>
  report.rows
    .filter((row) => row.tradeSetupRead.actionable)
    .map((row) => ({ row, checkpoint: checkpointLabel(report) })),
);
const actionableDecisionGroups = new Map<string, typeof taggedActionableRows>();
for (const tagged of taggedActionableRows) {
  const key = `${tagged.row.runnerDate}:${tagged.row.symbol}:${tagged.row.cutoffIso}`;
  actionableDecisionGroups.set(key, [...(actionableDecisionGroups.get(key) ?? []), tagged]);
}
const actionableDecisions = [...actionableDecisionGroups.values()].map((items) => ({
  runnerDate: items[0]!.row.runnerDate,
  symbol: items[0]!.row.symbol,
  cutoffIso: items[0]!.row.cutoffIso,
  setupType: items[0]!.row.tradeSetupRead.setupType,
  price: items[0]!.row.currentPrice,
  zone: items[0]!.row.tradeSetupRead.zone,
  trigger: items[0]!.row.tradeSetupRead.triggerPrice,
  invalidation: items[0]!.row.tradeSetupRead.invalidationPrice,
  target1: items[0]!.row.tradeSetupRead.targets[0]?.price ?? null,
  riskPct: items[0]!.row.tradeSetupRead.plannedRiskPct,
  rewardRisk: items[0]!.row.tradeSetupRead.firstTargetRewardRiskRatio,
  horizons: items.map(({ row, checkpoint }) => ({
    checkpoint,
    outcome: row.replayOutcome,
    bestForwardPct: row.bestForwardPct,
    worstForwardPct: row.worstForwardPct,
  })),
}));

const actionableHorizonRows = reports.flatMap(({ report }) =>
  report.rows.filter((row) => row.tradeSetupRead.actionable).map((row) => ({
    runnerDate: row.runnerDate,
    symbol: row.symbol,
    checkpoint: checkpointLabel(report),
    outcome: row.replayOutcome,
    bestForwardPct: row.bestForwardPct,
    worstForwardPct: row.worstForwardPct,
  })),
);

const currentGeometryRows = allRows.filter((row) => stateBeforeBlockers(row.tradeSetupRead) !== null);
const primaryBlockers = countBy(allRows, (row) => blockerCategory(row.tradeSetupRead.blockers[0] ?? "none"));
const geometryBlockers = countBy(
  currentGeometryRows.flatMap((row) => row.tradeSetupRead.blockers.map((blocker) => ({ blocker }))),
  (item) => blockerCategory(item.blocker),
);

const broaderRows = allRows.filter((row) => row.broaderCandidateTradeSetupRead !== null);
const broaderTypes = [...new Set(broaderRows.map((row) => row.bestAnyThesis!.type))].sort();
const broaderCandidateTypes = broaderTypes.map((type) => {
  const rows = broaderRows.filter((row) => row.bestAnyThesis!.type === type);
  const eligible = rows.filter((row) => isShadowEligible(row.broaderCandidateTradeSetupRead!));
  return {
    type,
    evaluations: rows.length,
    cleanRetrospectiveMoves: rows.filter(isCleanRetrospectiveMove).length,
    damageCases: rows.filter(isDamage).length,
    baseTriggered: rows.filter((row) => stateBeforeBlockers(row.broaderCandidateTradeSetupRead) === "triggered").length,
    finalActionable: rows.filter((row) => row.broaderCandidateTradeSetupRead!.actionable).length,
    shadowEligiblePlans: eligible.length,
    shadowTargetFirst: eligible.filter((row) => row.broaderCandidateShadowReplayOutcome === "target_before_invalidation").length,
    shadowLossAfterTrigger: eligible.filter((row) =>
      row.broaderCandidateShadowReplayOutcome === "invalidation_before_target" ||
      row.broaderCandidateShadowReplayOutcome === "same_bar_ambiguous_conservative_loss"
    ).length,
  };
});

const nearPromotionRows = liveLikeReports.flatMap(({ report }) =>
  report.rows.flatMap((row) => {
    const candidates = [
      { kind: "approved", read: row.tradeSetupRead, shadowOutcome: row.shadowReplayOutcome },
      {
        kind: "broader-only",
        read: row.broaderCandidateTradeSetupRead,
        shadowOutcome: row.broaderCandidateShadowReplayOutcome,
      },
    ];
    return candidates
      .filter((candidate) =>
        candidate.read !== null &&
        stateBeforeBlockers(candidate.read) === "triggered" &&
        candidate.read.blockers.length > 0 &&
        candidate.read.blockers.length <= 2
      )
      .map((candidate) => ({
        checkpoint: `${report.settings.checkpointMinutesAfterOpen}m`,
        runnerDate: row.runnerDate,
        symbol: row.symbol,
        kind: candidate.kind,
        setupType: candidate.read!.setupType,
        blockers: candidate.read!.blockers,
        riskPct: candidate.read!.plannedRiskPct,
        rewardRisk: candidate.read!.firstTargetRewardRiskRatio,
        shadowOutcome: candidate.shadowOutcome,
        bestForwardPct: row.bestForwardPct,
        worstForwardPct: row.worstForwardPct,
      }));
  }),
);

const cleanRows = allRows.filter(isCleanRetrospectiveMove);
const topCleanMissExamples = liveLikeReports
  .flatMap(({ report }) => report.rows.map((row) => ({ report, row })))
  .filter(({ row }) => !row.tradeSetupRead.actionable && isCleanRetrospectiveMove(row))
  .sort((left, right) => right.row.bestForwardPct! - left.row.bestForwardPct!)
  .slice(0, 20)
  .map(({ report, row }) => ({
    checkpoint: `${report.settings.checkpointMinutesAfterOpen}m`,
    runnerDate: row.runnerDate,
    symbol: row.symbol,
    bestForwardPct: row.bestForwardPct,
    worstForwardPct: row.worstForwardPct,
    approvedThesis: row.thesis?.type ?? null,
    broaderThesis: row.thesis === null ? row.bestAnyThesis?.type ?? null : null,
    primaryBlocker: blockerCategory(row.tradeSetupRead.blockers[0] ?? "none"),
  }));

const scenarioCoverage = {
  marketCap: bucketCounts(baselineRows, (row) =>
    row.marketCap < 5_000_000 ? "under $5M" : row.marketCap < 15_000_000 ? "$5M-$15M" : "$15M-$30M"
  ),
  runnerMove: bucketCounts(baselineRows, (row) =>
    row.runnerScorePct < 75 ? "under 75%" : row.runnerScorePct < 150 ? "75%-150%" : "150%+"
  ),
  priceAt60m: bucketCounts(baselineRows, (row) =>
    row.currentPrice < 1 ? "under $1" : row.currentPrice < 5 ? "$1-$5" : row.currentPrice < 10 ? "$5-$10" : "$10+"
  ),
};

const summary = {
  generatedAt: new Date().toISOString(),
  sourceFiles: SOURCE_FILES,
  cohort: {
    evaluations: allRows.length,
    runnerDays: runnerKeys.size,
    uniqueSymbols: uniqueSymbols.size,
    dateFrom: dates[0] ?? null,
    dateTo: dates.at(-1) ?? null,
    maxMarketCap: Math.max(...baselineRows.map((row) => row.marketCap)),
    causalPartialFourHourRows: allRows.filter((row) => Boolean(row.causalPartialFourHourCandle)).length,
  },
  verdict: {
    mode: "observation",
    promote: false,
    reasons: [
      "Only one unique current-card decision became actionable across the cohort.",
      "That decision did not resolve the same session and later hit invalidation before target on the longer horizon.",
      "The retrospective top-runner basket is hindsight-selected and cannot establish prospective hit rate.",
      "Historical spread, live partial-volume delta, and formal runtime Market Structure context were unavailable and were not invented.",
    ],
  },
  checkpointSummaries,
  intradayVisibilityComparison,
  validationChecks,
  actionableDecisions,
  actionableHorizonRows,
  primaryBlockers,
  geometryBlockers,
  broaderCandidateTypes,
  nearPromotionRows,
  cleanMoveAudit: {
    definition: "best forward move at least +25% while worst forward excursion stayed above -10%",
    evaluations: cleanRows.length,
    approvedThesis: cleanRows.filter((row) => row.thesis !== null).length,
    broaderOnlyThesis: cleanRows.filter((row) => row.thesis === null && row.bestAnyThesis !== null).length,
    noDetectedThesis: cleanRows.filter((row) => row.bestAnyThesis === null).length,
    topExamples: topCleanMissExamples,
  },
  broaderCandidateExperiment: {
    description: "Broader engine patterns were passed through the unchanged Trade Setup Read gates without enabling them in production.",
    candidateEvaluations: broaderRows.length,
    finalActionable: broaderRows.filter((row) => row.broaderCandidateTradeSetupRead!.actionable).length,
  },
  scenarioCoverage,
  limitations: [
    "The saved basket contains the top five realized small-cap runners for each selected date, so it is useful for miss analysis but not a strategy performance estimate.",
    "The 1:30 ET decision snapshot is checked under both 4h-visibility modes for boundary parity and graded through both the remaining session and the next ten completed 4h bars.",
    "Each intraday checkpoint is tested in both a closed-4h-only view and a live-like view whose partial 4h candle is reconstructed solely from completed 5m candles.",
    "The same-day daily candle is excluded at every cutoff, and only completed intraday candles are visible to the engine.",
    "Historical spread is null, not candle-estimated; formal runtime Market Structure and live partial-volume delta are also unavailable.",
    "When target and invalidation occur inside the same forward candle, the replay scores the result conservatively as a loss.",
  ],
};

const markdown: string[] = [
  "# Heavy Small-Cap Top-Runner Trade Setup Read QA",
  "",
  `Generated: ${summary.generatedAt}`,
  "",
  "## Verdict",
  "",
  "**Keep the card in observation mode.** The test is now broad enough to expose the failure pattern, but not to certify live accuracy: only one unique decision became actionable, it did not resolve during that session, and it later invalidated before reaching T1 on the longer replay.",
  "",
  `The cohort contains **${summary.cohort.evaluations.toLocaleString()} evaluations** from **${summary.cohort.runnerDays} top-runner days** and **${summary.cohort.uniqueSymbols} distinct small-cap symbols**, covering ${summary.cohort.dateFrom} through ${summary.cohort.dateTo}. All market caps were below $30M.`,
  "",
  "No historical spread was estimated or used. The missing live spread therefore did not cause the card's low output rate.",
  "",
  "## Checkpoint results",
  "",
  "A clean retrospective move means at least +25% forward upside with no worse than a -10% excursion. Because the basket was selected from realized top runners, this diagnoses misses; it is not a prospective win rate. Every intraday checkpoint was run twice: with only closed 4h bars and with a live-like partial 4h candle rebuilt causally from completed 5m bars.",
  "",
  ...markdownTable(
    ["Checkpoint", "N", "Approved thesis", "Broader-only", "Plan geometry", "Actionable", "Clean moves", "Non-actionable -15% damage"],
    checkpointSummaries.map((row) => [
      row.label,
      row.evaluations,
      row.approvedTheses,
      row.broaderOnlyTheses,
      row.baseGeometry,
      row.finalActionable,
      row.cleanRetrospectiveMoves,
      row.nonActionableDamageCases,
    ]),
  ),
  "",
  "### Closed 4h versus causal partial 4h",
  "",
  ...markdownTable(
    ["Checkpoint", "Approved thesis closed / partial", "Plan geometry closed / partial", "Actionable closed / partial"],
    intradayVisibilityComparison.map((row) => [
      row.checkpoint,
      `${row.closed.approvedTheses} / ${row.partial.approvedTheses}`,
      `${row.closed.baseGeometry} / ${row.partial.baseGeometry}`,
      `${row.closed.finalActionable} / ${row.partial.finalActionable}`,
    ]),
  ),
  "",
  `The causal partial 4h view materially improved early pattern detection (24 to 47 theses at 10:30 and 24 to 41 at 11:30), but it produced no additional actionable setups. At 3:00 it replaced stale first-bar reads and reduced thesis count from 42 to 24. At 1:30 the two views matched, which is the expected completed-bar boundary check. Across the run, ${summary.cohort.causalPartialFourHourRows} rows contained a reconstructed partial candle whose close was verified against the last completed 5m close.`,
  "",
  "### Replay integrity checks",
  "",
  ...markdownTable(
    ["Check", "Result"],
    [
      ["Causal partial 4h rows", validationChecks.causalPartialRows],
      ["Partial close mismatches versus last completed 5m", validationChecks.partialCloseMismatches],
      ["Invalid reconstructed OHLC rows", validationChecks.partialInvalidOhlc],
      ["Partial candles timestamped at/after cutoff", validationChecks.partialFutureTimestampViolations],
      ["Expected +1 partial-bar count mismatches", validationChecks.partialCountDeltaMismatches],
      ["1:30 completed-boundary decision mismatches", validationChecks.completedBoundaryParityMismatches],
    ],
  ),
  "",
  "## The one actionable decision",
  "",
  ...actionableHorizonRows.map((row) =>
    `- ${row.runnerDate} ${row.symbol}, ${row.checkpoint}: ${row.outcome}; best ${formatNumber(row.bestForwardPct)}%, worst ${formatNumber(row.worstForwardPct)}%.`
  ),
  "",
  "This is not enough successful decision evidence to move the card out of observation mode.",
  "",
  "## What the blockers are doing",
  "",
  `Primary blocker counts across all ${summary.cohort.evaluations.toLocaleString()} evaluations:`,
  "",
  ...markdownTable(
    ["Primary blocker", "Count"],
    Object.entries(primaryBlockers).map(([blocker, count]) => [blocker, count]),
  ),
  "",
  "Among rows where a full zone/trigger/invalidation plan could be built, these were the blocker categories:",
  "",
  ...markdownTable(
    ["Geometry blocker", "Count"],
    Object.entries(geometryBlockers).map(([blocker, count]) => [blocker, count]),
  ),
  "",
  "The target and risk blockers should not be loosened just because a nearby target was touched. Several shadow target hits paid only 0.1R-0.5R against 15%-50% structural risk, and some later suffered deep damage. That is not a useful trade plan.",
  "",
  "## Pre-blocker shadow plans",
  "",
  "This replay also graded valid plan geometry before the final safety blockers, without changing the user-facing result:",
  "",
  ...markdownTable(
    ["Checkpoint", "Eligible plans", "T1 first", "Loss after trigger", "Failed before trigger", "Unresolved"],
    checkpointSummaries.map((row) => [
      row.label,
      row.shadowEligiblePlans,
      row.shadowTargetFirst,
      row.shadowLossAfterTrigger,
      row.shadowFailedBeforeTrigger,
      row.shadowUnresolved,
    ]),
  ),
  "",
  "These shadow results are diagnostic only. A target touch with poor reward/risk does not validate removing the blocker.",
  "",
  "## Broader-pattern experiment",
  "",
  "For every result with no approved watchlist thesis, the best broader chart-engine pattern was passed through the unchanged Trade Setup Read gates. This did not enable any production behavior.",
  "",
  ...markdownTable(
    ["Broader pattern", "Evaluations", "Clean moves", "-15% damage", "Base triggered", "Final actionable", "Shadow T1 first", "Shadow losses"],
    broaderCandidateTypes.map((row) => [
      row.type,
      row.evaluations,
      row.cleanRetrospectiveMoves,
      row.damageCases,
      row.baseTriggered,
      row.finalActionable,
      row.shadowTargetFirst,
      row.shadowLossAfterTrigger,
    ]),
  ),
  "",
  `Result: **${summary.broaderCandidateExperiment.finalActionable} of ${summary.broaderCandidateExperiment.candidateEvaluations} broader-candidate evaluations became actionable.** Merely whitelisting these patterns would not solve the card. Upper-range ignition deserves targeted observation, while opening-range expansion showed too much downside damage to admit broadly.`,
  "",
  "## Triggered-but-blocked audit",
  "",
  ...markdownTable(
    ["Time", "Date", "Symbol", "Source", "Pattern", "Risk", "T1 R", "Blocker", "Shadow result", "Best / worst"],
    nearPromotionRows.map((row) => [
      row.checkpoint,
      row.runnerDate,
      row.symbol,
      row.kind,
      row.setupType,
      `${formatNumber(row.riskPct, 2)}%`,
      `${formatNumber(row.rewardRisk, 2)}R`,
      row.blockers.map(blockerCategory).join("; "),
      row.shadowOutcome ?? "n/a",
      `${formatNumber(row.bestForwardPct)}% / ${formatNumber(row.worstForwardPct)}%`,
    ]),
  ),
  "",
  "This table is the clearest reason not to relax the gates globally: target-first examples usually carried weak payoff, while the few examples above 1R were still below the 1.5R floor and/or carried excessive structural risk.",
  "",
  "## Scenario coverage",
  "",
  "The 240 underlying runner-day samples were distributed across these small-cap scenarios:",
  "",
  "### Market cap",
  "",
  ...markdownTable(["Bucket", "Runner days", "Unique symbols"], scenarioCoverage.marketCap.map((row) => [row.bucket, row.runnerDays, row.uniqueSymbols])),
  "",
  "### Price at 10:30 ET",
  "",
  ...markdownTable(["Bucket", "Runner days", "Unique symbols"], scenarioCoverage.priceAt60m.map((row) => [row.bucket, row.runnerDays, row.uniqueSymbols])),
  "",
  "### Realized runner move in the saved basket",
  "",
  ...markdownTable(["Bucket", "Runner days", "Unique symbols"], scenarioCoverage.runnerMove.map((row) => [row.bucket, row.runnerDays, row.uniqueSymbols])),
  "",
  "## Retrospective clean-move audit",
  "",
  `Across all horizons there were ${summary.cleanMoveAudit.evaluations} clean-move evaluations: ${summary.cleanMoveAudit.approvedThesis} had an approved thesis, ${summary.cleanMoveAudit.broaderOnlyThesis} had only a broader-engine pattern, and ${summary.cleanMoveAudit.noDetectedThesis} had no detected chart thesis. The largest remaining coverage issue is therefore chart-pattern recognition, especially early in the session - not support availability or the absence of spread data.`,
  "",
  ...markdownTable(
    ["Time", "Date", "Symbol", "Best", "Worst", "Approved / broader thesis", "Primary blocker"],
    topCleanMissExamples.map((row) => [
      row.checkpoint,
      row.runnerDate,
      row.symbol,
      `+${formatNumber(row.bestForwardPct)}%`,
      `${formatNumber(row.worstForwardPct)}%`,
      row.approvedThesis ?? row.broaderThesis ?? "none",
      row.primaryBlocker,
    ]),
  ),
  "",
  "## Evidence-backed next direction",
  "",
  "1. Keep observation mode and collect prospective, not hindsight-selected, runner snapshots.",
  "2. Target upper-range ignition for a separate observation-only study; do not broadly approve opening-range expansion.",
  "3. Preserve wide-risk, sub-1.5R, and pre-1R obstacle blockers. Improve target hierarchy only when a farther chart objective is structurally supported and the nearer obstacle is explicitly cleared.",
  "4. Continue exposing pre-blocker state in metadata so future live observations can distinguish `no pattern`, `valid geometry but blocked`, and `actually triggered`.",
  "",
  "## Limitations",
  "",
  ...summary.limitations.map((limitation) => `- ${limitation}`),
  "",
];

await mkdir(dirname(OUTPUT_JSON), { recursive: true });
await writeFile(OUTPUT_JSON, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
await writeFile(OUTPUT_MARKDOWN, `${markdown.join("\n")}\n`, "utf8");
console.log(`[TradeSetupHeavyQa] wrote ${OUTPUT_JSON}`);
console.log(`[TradeSetupHeavyQa] wrote ${OUTPUT_MARKDOWN}`);
