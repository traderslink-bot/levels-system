import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import {
  buildSnapshotAuditReport,
  buildThreadPostPolicyReport,
  buildTradingDayEvidenceReport,
} from "../lib/review/discord-audit-reports.js";
import {
  buildLivePostProfileComparisonReport,
  buildLivePostReplaySimulationReport,
  buildRunnerStoryReport,
} from "../lib/review/live-post-replay-simulator.js";
import { SIGNAL_CATEGORY_KEYS, type SignalCategoryKey } from "../lib/signals/signal-category-config.js";
import { getSignalCategoryContract } from "../lib/signals/signal-category-contracts.js";

type SavedAuditRow = {
  type?: string;
  operation?: string;
  status?: string;
  timestamp?: number;
  symbol?: string;
  title?: string;
  body?: string;
  bodyPreview?: string;
  messageKind?: string;
  eventType?: string;
  signalCategory?: string;
  signalCategoryLiveEnabled?: boolean;
  supportingSignalCategories?: string[];
  volumeActivityShown?: boolean;
  volumeActivityReliability?: string;
  volumeActivitySuppressedReason?: string;
};

type RegressionFinding = {
  severity: "fail" | "warn" | "info";
  auditPath: string;
  symbol?: string;
  timestamp?: number;
  title?: string;
  reason: string;
  detail?: string;
};

type AuditRegressionResult = {
  auditPath: string;
  session: string;
  rows: number;
  postedRows: number;
  currentMetadataRows: number;
  policyTotals: ReturnType<typeof buildThreadPostPolicyReport>["totals"];
  replayTotals: ReturnType<typeof buildLivePostReplaySimulationReport>["totals"];
  evidenceCounts: {
    criticalDeliveryFailures: number;
    staleCriticalDeliveries: number;
    roleFlipCandidates: number;
    clusterCrossCandidates: number;
    badHistoricalLanguageExamples: number;
    borderlineAdviceExamples: number;
    volumeShownExamples: number;
    volumeSuppressedExamples: number;
  };
  runnerStory: {
    symbolCount: number;
    missingEventCandidates: number;
    noisyPostSamples: number;
  };
  findings: RegressionFinding[];
};

type SavedDataRegressionReport = {
  generatedAt: string;
  sourceRoot: string;
  limit: number | null;
  auditCount: number;
  totals: {
    rows: number;
    postedRows: number;
    currentMetadataRows: number;
    failFindings: number;
    warnFindings: number;
    infoFindings: number;
  };
  results: AuditRegressionResult[];
};

const SYSTEM_OR_OPERATOR_LANGUAGE =
  /Status:|Signal:|Decision area|setup update|state update|state recap|setup move|alert direction|after the alert|current read:|What matters next:|AI note:|directional progress|LEVEL SNAPSHOT|level map|mapped|remapped|operator-only|policy|suppression|replay|simulation|runtime-only|not a price target/i;

const DIRECT_ADVICE_LANGUAGE =
  /\b(?:buy here|buy now|sell now|sell here|take profit|stop out|trim here|add here|exit now|short setup|best entry|safe entry|can buy|should add|should trim|should exit|longs should|traders should|wait for)\b/i;

const SIGNAL_CATEGORY_SET = new Set<string>(SIGNAL_CATEGORY_KEYS);

function readFlag(name: string): string | undefined {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`))?.split("=")[1];
  if (inline !== undefined) {
    return inline;
  }

  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function discoverAuditFiles(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }

  const stats = statSync(root);
  if (stats.isFile()) {
    return basename(root).toLowerCase() === "discord-delivery-audit.jsonl" ? [root] : [];
  }

  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase() === "discord-delivery-audit.jsonl") {
        found.push(fullPath);
      }
    }
  };
  walk(root);
  return found.sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
}

function readAuditRows(auditPath: string): SavedAuditRow[] {
  return readFileSync(auditPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SavedAuditRow)
    .filter((row) => row.type === "discord_delivery_audit");
}

function rowText(row: SavedAuditRow): string {
  return [row.title, row.body ?? row.bodyPreview].filter(Boolean).join("\n");
}

function finding(
  auditPath: string,
  row: Pick<SavedAuditRow, "symbol" | "timestamp" | "title"> | undefined,
  severity: RegressionFinding["severity"],
  reason: string,
  detail?: string,
): RegressionFinding {
  return {
    severity,
    auditPath,
    symbol: row?.symbol,
    timestamp: row?.timestamp,
    title: row?.title,
    reason,
    detail,
  };
}

function validateCurrentMetadataRows(auditPath: string, rows: SavedAuditRow[]): RegressionFinding[] {
  const findings: RegressionFinding[] = [];
  for (const row of rows) {
    if (row.status !== "posted" || row.operation !== "post_alert") {
      continue;
    }

    const hasCurrentMetadata =
      row.signalCategory !== undefined ||
      row.signalCategoryLiveEnabled !== undefined ||
      row.volumeActivityShown !== undefined ||
      row.volumeActivityReliability !== undefined;

    if (!hasCurrentMetadata) {
      continue;
    }

    if (!row.signalCategory || !SIGNAL_CATEGORY_SET.has(row.signalCategory)) {
      findings.push(
        finding(auditPath, row, "fail", "posted current-format alert has missing or invalid signalCategory", row.signalCategory),
      );
      continue;
    }

    const category = row.signalCategory as SignalCategoryKey;
    const contract = getSignalCategoryContract(category);
    if (contract.liveBehavior === "operator_only" && row.signalCategoryLiveEnabled !== true) {
      findings.push(
        finding(
          auditPath,
          row,
          "fail",
          "operator/internal category reached Discord without an explicit live enable marker",
          category,
        ),
      );
    }

    if (category === "range_compression" && row.signalCategoryLiveEnabled !== true) {
      findings.push(
        finding(
          auditPath,
          row,
          "fail",
          "range_compression post reached Discord while category metadata says live Discord was not enabled",
        ),
      );
    }

    if (row.volumeActivityShown && row.volumeActivityReliability !== "reliable") {
      findings.push(
        finding(
          auditPath,
          row,
          "fail",
          "volume/activity trader text was shown without reliable volume metadata",
          `reliability=${row.volumeActivityReliability ?? "missing"}`,
        ),
      );
    }

    const text = rowText(row);
    if (SYSTEM_OR_OPERATOR_LANGUAGE.test(text)) {
      findings.push(finding(auditPath, row, "fail", "current-format trader post contains system/operator wording"));
    }
    if (DIRECT_ADVICE_LANGUAGE.test(text)) {
      findings.push(finding(auditPath, row, "fail", "current-format trader post contains direct advice wording"));
    }
  }

  return findings;
}

function validateHistoricalRows(auditPath: string, rows: SavedAuditRow[]): RegressionFinding[] {
  const findings: RegressionFinding[] = [];
  let missingCategoryMetadata = 0;
  let historicalLanguage = 0;

  for (const row of rows) {
    if (row.status !== "posted" || row.operation !== "post_alert") {
      continue;
    }

    if (row.signalCategory === undefined) {
      missingCategoryMetadata += 1;
    }

    const text = rowText(row);
    if (SYSTEM_OR_OPERATOR_LANGUAGE.test(text) || DIRECT_ADVICE_LANGUAGE.test(text)) {
      historicalLanguage += 1;
    }
  }

  if (missingCategoryMetadata > 0) {
    findings.push(
      finding(
        auditPath,
        undefined,
        "info",
        "saved post rows predate signal-category metadata",
        `${missingCategoryMetadata} posted alert rows`,
      ),
    );
  }

  if (historicalLanguage > 0) {
    findings.push(
      finding(
        auditPath,
        undefined,
        "warn",
        "saved posts include historical trader-language issues",
        `${historicalLanguage} rows; use evidence report to inspect examples`,
      ),
    );
  }

  return findings;
}

function runAuditRegression(auditPath: string): AuditRegressionResult {
  const rows = readAuditRows(auditPath);
  const postedRows = rows.filter((row) => row.status === "posted").length;
  const currentMetadataRows = rows.filter(
    (row) =>
      row.status === "posted" &&
      (row.signalCategory !== undefined ||
        row.signalCategoryLiveEnabled !== undefined ||
        row.volumeActivityShown !== undefined ||
        row.volumeActivityReliability !== undefined),
  ).length;

  const policy = buildThreadPostPolicyReport(auditPath);
  const snapshot = buildSnapshotAuditReport(auditPath);
  const evidence = buildTradingDayEvidenceReport(auditPath);
  const replay = buildLivePostReplaySimulationReport(auditPath);
  const profiles = buildLivePostProfileComparisonReport(auditPath);
  const runner = buildRunnerStoryReport(auditPath);
  const findings: RegressionFinding[] = [
    ...validateCurrentMetadataRows(auditPath, rows),
    ...validateHistoricalRows(auditPath, rows),
  ];

  if (postedRows === 0) {
    findings.push(finding(auditPath, undefined, "warn", "audit file has no posted Discord rows"));
  }

  if (profiles.profiles.length < 3) {
    findings.push(finding(auditPath, undefined, "fail", "profile comparison did not produce quiet/balanced/active outputs"));
  }

  if (snapshot.snapshots.length === 0) {
    findings.push(finding(auditPath, undefined, "info", "no level snapshot audit rows found in this saved file"));
  }

  const unresolvedCriticalFailures = evidence.criticalDeliveryFailures.filter(
    (failure) => failure.traderCritical && failure.severity === "major" && !failure.retryProven,
  );
  if (unresolvedCriticalFailures.length > 0) {
    findings.push(
      finding(
        auditPath,
        undefined,
        "warn",
        "saved audit includes trader-critical delivery failures without proven retry",
        `${unresolvedCriticalFailures.length} failures`,
      ),
    );
  }

  const missingEventCandidates = runner.symbols.reduce(
    (sum, symbol) => sum + symbol.missingEventCandidates.length,
    0,
  );
  const noisyPostSamples = runner.symbols.reduce(
    (sum, symbol) => sum + symbol.noisyPostSamples.length,
    0,
  );

  return {
    auditPath,
    session: basename(dirname(auditPath)),
    rows: rows.length,
    postedRows,
    currentMetadataRows,
    policyTotals: policy.totals,
    replayTotals: replay.totals,
    evidenceCounts: {
      criticalDeliveryFailures: evidence.criticalDeliveryFailures.length,
      staleCriticalDeliveries: evidence.staleCriticalDeliveries.length,
      roleFlipCandidates: evidence.roleFlipCandidates.length,
      clusterCrossCandidates: evidence.clusterCrossCandidates.length,
      badHistoricalLanguageExamples: evidence.traderLanguageEvidence.badHistoricalExamples.length,
      borderlineAdviceExamples: evidence.traderLanguageEvidence.borderlineAdviceExamples.length,
      volumeShownExamples: evidence.volumeActivityEvidence.shownExamples.length,
      volumeSuppressedExamples: evidence.volumeActivityEvidence.suppressedExamples.length,
    },
    runnerStory: {
      symbolCount: runner.symbols.length,
      missingEventCandidates,
      noisyPostSamples,
    },
    findings,
  };
}

function formatMarkdown(report: SavedDataRegressionReport): string {
  const lines = [
    "# Saved Data Regression Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Source root: ${report.sourceRoot}`,
    `Audit files checked: ${report.auditCount}`,
    "",
    "## Totals",
    "",
    `- rows: ${report.totals.rows}`,
    `- posted rows: ${report.totals.postedRows}`,
    `- current metadata rows: ${report.totals.currentMetadataRows}`,
    `- fail findings: ${report.totals.failFindings}`,
    `- warn findings: ${report.totals.warnFindings}`,
    `- info findings: ${report.totals.infoFindings}`,
    "",
    "## Sessions",
    "",
  ];

  for (const result of report.results) {
    lines.push(
      `### ${result.session}`,
      "",
      `- audit: ${result.auditPath}`,
      `- posted: ${result.postedRows}`,
      `- current metadata rows: ${result.currentMetadataRows}`,
      `- replay: ${result.replayTotals.originalPosted} -> ${result.replayTotals.simulatedPosted} posts (${result.replayTotals.reductionPct}% reduction)`,
      `- policy repeated-story clusters: ${result.policyTotals.repeatedStoryClusters}`,
      `- role-flip candidates: ${result.evidenceCounts.roleFlipCandidates}`,
      `- cluster-cross candidates: ${result.evidenceCounts.clusterCrossCandidates}`,
      `- runner missing-event candidates: ${result.runnerStory.missingEventCandidates}`,
      "",
    );

    const failFindings = result.findings.filter((item) => item.severity === "fail");
    const warnFindings = result.findings.filter((item) => item.severity === "warn");
    if (failFindings.length > 0 || warnFindings.length > 0) {
      lines.push("Findings:");
      for (const item of [...failFindings, ...warnFindings].slice(0, 12)) {
        lines.push(
          `- ${item.severity.toUpperCase()}: ${item.reason}${item.detail ? ` (${item.detail})` : ""}${item.symbol ? ` [${item.symbol}]` : ""}`,
        );
      }
      lines.push("");
    }
  }

  return `${lines.join("\n")}\n`;
}

function run(): void {
  const sourceRoot = resolve(readFlag("--input") ?? "artifacts");
  const outputDirectory = resolve(readFlag("--output") ?? join("artifacts", "saved-data-regression"));
  const explicitLimit = readFlag("--limit");
  const limit = hasFlag("--all") ? null : explicitLimit ? Number.parseInt(explicitLimit, 10) : 8;
  const failOnWarnings = hasFlag("--fail-on-warnings");
  const auditFiles = discoverAuditFiles(sourceRoot);
  const selectedAuditFiles = limit === null ? auditFiles : auditFiles.slice(0, Math.max(limit, 0));

  if (selectedAuditFiles.length === 0) {
    throw new Error(`No discord-delivery-audit.jsonl files found under ${sourceRoot}`);
  }

  const results = selectedAuditFiles.map(runAuditRegression);
  const allFindings = results.flatMap((result) => result.findings);
  const report: SavedDataRegressionReport = {
    generatedAt: new Date().toISOString(),
    sourceRoot,
    limit,
    auditCount: selectedAuditFiles.length,
    totals: {
      rows: results.reduce((sum, result) => sum + result.rows, 0),
      postedRows: results.reduce((sum, result) => sum + result.postedRows, 0),
      currentMetadataRows: results.reduce((sum, result) => sum + result.currentMetadataRows, 0),
      failFindings: allFindings.filter((finding) => finding.severity === "fail").length,
      warnFindings: allFindings.filter((finding) => finding.severity === "warn").length,
      infoFindings: allFindings.filter((finding) => finding.severity === "info").length,
    },
    results,
  };

  mkdirSync(outputDirectory, { recursive: true });
  const jsonPath = join(outputDirectory, "saved-data-regression-report.json");
  const markdownPath = join(outputDirectory, "saved-data-regression-report.md");
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(markdownPath, formatMarkdown(report));

  console.log(`Saved data regression checked ${report.auditCount} audit file(s).`);
  console.log(`Rows: ${report.totals.rows}; posted: ${report.totals.postedRows}; current metadata rows: ${report.totals.currentMetadataRows}.`);
  console.log(`Findings: ${report.totals.failFindings} fail / ${report.totals.warnFindings} warn / ${report.totals.infoFindings} info.`);
  console.log(`Wrote ${jsonPath}`);
  console.log(`Wrote ${markdownPath}`);

  if (report.totals.failFindings > 0 || (failOnWarnings && report.totals.warnFindings > 0)) {
    process.exitCode = 1;
  }
}

run();
