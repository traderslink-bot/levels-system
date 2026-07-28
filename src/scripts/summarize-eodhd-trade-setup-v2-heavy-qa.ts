import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

type Thesis = {
  type: string;
  label: string;
  status: string;
};

type TradeSetupRead = {
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

type FamilyReplay = {
  thesis: Thesis;
  tradeSetupRead: TradeSetupRead;
  replayOutcome: string;
  shadowReplayOutcome: string | null;
};

type ReplayRow = {
  symbol: string;
  runnerDate: string;
  cutoffIso: string;
  marketCap: number;
  currentPrice: number;
  thesis: Thesis | null;
  tradeSetupRead: TradeSetupRead;
  replayOutcome: string;
  shadowReplayOutcome: string | null;
  v2FamilyReplays: FamilyReplay[];
  bestForwardPct: number | null;
  worstForwardPct: number | null;
};

type ReplayReport = {
  generatedAt: string;
  settings: {
    tradeSetupModel?: string;
    intradaySession: boolean;
    reconstructLiveFourHour?: boolean;
    checkpointMinutesAfterOpen: number;
    spreadMode: string;
    marketStructureMode: string;
  };
  rows: ReplayRow[];
};

const INPUT_DIRECTORY = join("artifacts", "eodhd-trade-setup-read-replay");
const SOURCE_FILES = [
  "trade-setup-read-replay-v2-heavy-intraday-60m-live4h-240.json",
  "trade-setup-read-replay-v2-heavy-intraday-120m-live4h-240.json",
  "trade-setup-read-replay-v2-heavy-intraday-240m-live4h-240.json",
  "trade-setup-read-replay-v2-heavy-intraday-330m-live4h-240.json",
  "trade-setup-read-replay-v2-heavy-240.json",
] as const;
const OUTPUT_JSON = join(INPUT_DIRECTORY, "trade-setup-read-v2-heavy-qa-summary.json");
const OUTPUT_MARKDOWN = join(INPUT_DIRECTORY, "trade-setup-read-v2-heavy-qa-summary.md");

function stateBeforeBlockers(read: TradeSetupRead): string | null {
  const value = read.metadata.tradeSetupStateBeforeBlockers;
  return typeof value === "string" ? value : null;
}

function isLoss(outcome: string | null): boolean {
  return outcome === "invalidation_before_target" ||
    outcome === "same_bar_ambiguous_conservative_loss";
}

function isUnresolved(outcome: string | null): boolean {
  return outcome === "triggered_no_resolution" ||
    outcome === "never_triggered" ||
    outcome === "unscorable";
}

function isCleanRetrospectiveMove(row: ReplayRow): boolean {
  return row.bestForwardPct !== null && row.bestForwardPct >= 25 &&
    row.worstForwardPct !== null && row.worstForwardPct > -10;
}

function isDamage(row: ReplayRow): boolean {
  return row.worstForwardPct !== null && row.worstForwardPct <= -15;
}

function clockLabel(minutesAfterOpen: number): string {
  const totalMinutes = 9 * 60 + 30 + minutesAfterOpen;
  const hour24 = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  const hour12 = hour24 > 12 ? hour24 - 12 : hour24;
  return `${hour12}:${String(minute).padStart(2, "0")} ET`;
}

function reportLabel(report: ReplayReport): string {
  return report.settings.intradaySession
    ? `${clockLabel(report.settings.checkpointMinutesAfterOpen)} / same session`
    : "1:30 ET / next 10 completed 4h bars";
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

const taggedReports = await Promise.all(SOURCE_FILES.map(async (fileName) => ({
  fileName,
  report: JSON.parse(await readFile(join(INPUT_DIRECTORY, fileName), "utf8")) as ReplayReport,
})));

for (const { fileName, report } of taggedReports) {
  if (report.rows.length !== 240) {
    throw new Error(`${fileName} contains ${report.rows.length} rows; expected 240.`);
  }
  if (report.settings.tradeSetupModel !== "v2_small_cap") {
    throw new Error(`${fileName} is not marked as a V2 replay.`);
  }
  if (report.settings.intradaySession && report.settings.reconstructLiveFourHour !== true) {
    throw new Error(`${fileName} does not use the causal partial 4h reconstruction.`);
  }
}

const baselineRows = taggedReports[0]!.report.rows;
const allRows = taggedReports.flatMap(({ report }) => report.rows);
const intradayReports = taggedReports.filter(({ report }) => report.settings.intradaySession);
const longerHorizonReport = taggedReports.find(({ report }) => !report.settings.intradaySession)!.report;
const checkpointSummaries = taggedReports.map(({ fileName, report }) => {
  const actions = report.rows.filter((row) => row.tradeSetupRead.actionable);
  return {
    sourceFile: fileName,
    label: reportLabel(report),
    evaluations: report.rows.length,
    selectedTheses: report.rows.filter((row) => row.thesis !== null).length,
    familyEvaluations: report.rows.reduce((sum, row) => sum + row.v2FamilyReplays.length, 0),
    zonesBuilt: report.rows.filter((row) => row.tradeSetupRead.zone !== null).length,
    selectedActions: actions.length,
    targetFirst: actions.filter((row) => row.replayOutcome === "target_before_invalidation").length,
    losses: actions.filter((row) => isLoss(row.replayOutcome)).length,
    unresolved: actions.filter((row) => isUnresolved(row.replayOutcome)).length,
    cleanRetrospectiveMoves: report.rows.filter(isCleanRetrospectiveMove).length,
    nonActionableDamageCases: report.rows.filter((row) => !row.tradeSetupRead.actionable && isDamage(row)).length,
  };
});

const familyRows = allRows.flatMap((row) => row.v2FamilyReplays.map((family) => ({ row, family })));
const familyTypes = [...new Set(familyRows.map(({ family }) => family.thesis.type))].sort();
const familySummaries = familyTypes.map((type) => {
  const evaluations = familyRows.filter(({ family }) => family.thesis.type === type);
  const triggered = evaluations.filter(({ family }) =>
    stateBeforeBlockers(family.tradeSetupRead) === "triggered"
  );
  const actions = evaluations.filter(({ family }) => family.tradeSetupRead.actionable);
  return {
    type,
    label: evaluations[0]!.family.thesis.label,
    evaluations: evaluations.length,
    activeTheses: evaluations.filter(({ family }) => family.thesis.status === "active").length,
    triggeredGeometry: triggered.length,
    finalActions: actions.length,
    targetFirst: actions.filter(({ family }) => family.replayOutcome === "target_before_invalidation").length,
    losses: actions.filter(({ family }) => isLoss(family.replayOutcome)).length,
    unresolved: actions.filter(({ family }) => isUnresolved(family.replayOutcome)).length,
    triggeredShadowTargetFirst: triggered.filter(({ family }) =>
      family.shadowReplayOutcome === "target_before_invalidation"
    ).length,
    triggeredShadowLosses: triggered.filter(({ family }) => isLoss(family.shadowReplayOutcome)).length,
  };
}).sort((left, right) => right.evaluations - left.evaluations || left.type.localeCompare(right.type));

const taggedActionRows = taggedReports.flatMap(({ report }) =>
  report.rows
    .filter((row) => row.tradeSetupRead.actionable)
    .map((row) => ({ row, horizon: reportLabel(report), intraday: report.settings.intradaySession })),
);
const actionGroups = new Map<string, typeof taggedActionRows>();
for (const tagged of taggedActionRows) {
  const key = `${tagged.row.runnerDate}:${tagged.row.symbol}:${tagged.row.cutoffIso}`;
  actionGroups.set(key, [...(actionGroups.get(key) ?? []), tagged]);
}
const uniqueActions = [...actionGroups.values()].map((items) => ({
  runnerDate: items[0]!.row.runnerDate,
  symbol: items[0]!.row.symbol,
  cutoffIso: items[0]!.row.cutoffIso,
  setupType: items[0]!.row.thesis?.type ?? items[0]!.row.tradeSetupRead.metadata.tradeSetupType ?? "unknown",
  price: items[0]!.row.currentPrice,
  zone: items[0]!.row.tradeSetupRead.zone,
  trigger: items[0]!.row.tradeSetupRead.triggerPrice,
  invalidation: items[0]!.row.tradeSetupRead.invalidationPrice,
  target1: items[0]!.row.tradeSetupRead.targets[0]?.price ?? null,
  riskPct: items[0]!.row.tradeSetupRead.plannedRiskPct,
  rewardRisk: items[0]!.row.tradeSetupRead.firstTargetRewardRiskRatio,
  horizons: items.map(({ row, horizon }) => ({
    horizon,
    outcome: row.replayOutcome,
    bestForwardPct: row.bestForwardPct,
    worstForwardPct: row.worstForwardPct,
  })),
})).sort((left, right) => right.runnerDate.localeCompare(left.runnerDate) || left.symbol.localeCompare(right.symbol));

const intradayActionRows = taggedActionRows.filter((item) => item.intraday);
const longerHorizonActions = longerHorizonReport.rows.filter((row) => row.tradeSetupRead.actionable);
const summary = {
  generatedAt: new Date().toISOString(),
  activationDecision: "observe",
  coverage: {
    checkpointEvaluations: allRows.length,
    runnerDaysPerCheckpoint: baselineRows.length,
    uniqueRunnerDays: new Set(baselineRows.map((row) => `${row.runnerDate}:${row.symbol}`)).size,
    uniqueSymbols: new Set(baselineRows.map((row) => row.symbol)).size,
    minimumMarketCap: Math.min(...baselineRows.map((row) => row.marketCap)),
    maximumMarketCap: Math.max(...baselineRows.map((row) => row.marketCap)),
    checkpoints: taggedReports.length,
  },
  checkpointSummaries,
  familySummaries,
  selectedActionSummary: {
    uniqueDecisions: uniqueActions.length,
    sameSessionActionRows: intradayActionRows.length,
    sameSessionTargetFirst: intradayActionRows.filter(({ row }) =>
      row.replayOutcome === "target_before_invalidation"
    ).length,
    sameSessionLosses: intradayActionRows.filter(({ row }) => isLoss(row.replayOutcome)).length,
    sameSessionUnresolved: intradayActionRows.filter(({ row }) => isUnresolved(row.replayOutcome)).length,
    longerHorizonActionRows: longerHorizonActions.length,
    longerHorizonTargetFirst: longerHorizonActions.filter((row) =>
      row.replayOutcome === "target_before_invalidation"
    ).length,
    longerHorizonLosses: longerHorizonActions.filter((row) => isLoss(row.replayOutcome)).length,
    longerHorizonUnresolved: longerHorizonActions.filter((row) => isUnresolved(row.replayOutcome)).length,
  },
  uniqueActions,
  validation: {
    allIntradayReportsUseCausalPartialFourHour: intradayReports.every(({ report }) =>
      report.settings.reconstructLiveFourHour === true
    ),
    spreadMode: [...new Set(taggedReports.map(({ report }) => report.settings.spreadMode))],
    marketStructureMode: [...new Set(taggedReports.map(({ report }) => report.settings.marketStructureMode))],
  },
  limitations: [
    "The cohort is a hindsight-selected basket of top small-cap runners, so this is not a live hit-rate estimate.",
    "Bid/ask spread was unavailable and was intentionally not simulated.",
    "Market-structure gating was unavailable in replay; it may add blockers live but cannot create a setup.",
    "The action count remains sparse, especially within individual setup families.",
    "Observation mode is required until prospective live samples confirm that the replay behavior survives real-time data and selection.",
  ],
};

const markdown = [
  "# Trader Setup V2 Heavy QA",
  "",
  `Generated: ${summary.generatedAt}`,
  "",
  "## Decision",
  "",
  "Keep V2 in observation mode. The replay now produces coherent dip zones, confirmation triggers, structural invalidations, obstacles, and paying targets, but the basket is hindsight-selected and the action sample is still too small for user-facing activation.",
  "",
  "A fresh intraday-base breakout is no longer considered triggered. It remains a watch until a later candle retests the breakout area and a separate candle reclaims it.",
  "",
  "## Coverage",
  "",
  `- ${summary.coverage.checkpointEvaluations} total checkpoint evaluations (${summary.coverage.runnerDaysPerCheckpoint} runner-days x ${summary.coverage.checkpoints} horizons).`,
  `- ${summary.coverage.uniqueSymbols} unique symbols; all source rows were capped below $30M market cap.`,
  "- Intraday checkpoints: 10:30, 11:30, 13:30, and 15:00 ET, each using completed 5m candles and a causal partial 4h candle.",
  "- Longer horizon: next 10 completed 4h bars from the 13:30 ET decision point.",
  "",
  "## Checkpoint results",
  "",
  ...markdownTable(
    ["Checkpoint", "Rows", "Theses", "Family evals", "Zones", "Actions", "T1 first", "Losses", "Unresolved"],
    checkpointSummaries.map((item) => [
      item.label,
      item.evaluations,
      item.selectedTheses,
      item.familyEvaluations,
      item.zonesBuilt,
      item.selectedActions,
      item.targetFirst,
      item.losses,
      item.unresolved,
    ]),
  ),
  "",
  "## Selected action outcomes",
  "",
  `- Same-session: ${summary.selectedActionSummary.sameSessionTargetFirst} target-first, ${summary.selectedActionSummary.sameSessionLosses} losses, ${summary.selectedActionSummary.sameSessionUnresolved} unresolved across ${summary.selectedActionSummary.sameSessionActionRows} action rows.`,
  `- Longer horizon: ${summary.selectedActionSummary.longerHorizonTargetFirst} target-first, ${summary.selectedActionSummary.longerHorizonLosses} losses, ${summary.selectedActionSummary.longerHorizonUnresolved} unresolved across ${summary.selectedActionSummary.longerHorizonActionRows} action rows.`,
  "- The longer-horizon loss is the legacy CIIT gap-fill reclaim that was unresolved intraday; it is not a new small-cap-family action.",
  "",
  ...markdownTable(
    ["Date", "Symbol", "Setup", "Zone", "Trigger", "Stop", "T1", "Risk", "T1 skew", "Outcomes"],
    uniqueActions.map((item) => [
      item.runnerDate,
      item.symbol,
      String(item.setupType),
      item.zone ? `${formatPrice(item.zone.low)}-${formatPrice(item.zone.high)}` : "n/a",
      formatPrice(item.trigger),
      formatPrice(item.invalidation),
      formatPrice(item.target1),
      `${formatNumber(item.riskPct)}%`,
      `${formatNumber(item.rewardRisk, 2)}R`,
      item.horizons.map((horizon) => `${horizon.horizon}: ${horizon.outcome}`).join("<br>"),
    ]),
  ),
  "",
  "## Setup-family audit",
  "",
  ...markdownTable(
    ["Family", "Evals", "Active", "Triggered geometry", "Final actions", "T1 first", "Losses", "Unresolved"],
    familySummaries.map((item) => [
      item.label,
      item.evaluations,
      item.activeTheses,
      item.triggeredGeometry,
      item.finalActions,
      item.targetFirst,
      item.losses,
      item.unresolved,
    ]),
  ),
  "",
  "## Guardrails retained",
  "",
  "- A setup needs a zone supported by at least two independent evidence categories.",
  "- Nearby mapped resistance remains an obstacle; it is not mislabeled as T1 unless the objective pays at least 1.5R.",
  "- Wide structural risk, a barrier before 1R, a crowded path, stale confirmation, and chase extension can all force No trade.",
  "- Market structure may confirm or block a setup, but it cannot manufacture entry geometry.",
  "- V2 is shadow-only in the live publisher; active legacy mode cannot expose it accidentally.",
  "",
  "## Limitations",
  "",
  ...summary.limitations.map((item) => `- ${item}`),
  "",
].join("\n");

await mkdir(dirname(OUTPUT_JSON), { recursive: true });
await writeFile(OUTPUT_JSON, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
await writeFile(OUTPUT_MARKDOWN, markdown, "utf8");
console.log(`[TradeSetupV2Summary] wrote ${OUTPUT_JSON}`);
console.log(`[TradeSetupV2Summary] wrote ${OUTPUT_MARKDOWN}`);
