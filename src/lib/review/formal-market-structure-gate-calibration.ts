import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import {
  buildFormalMarketStructureGateAuditReport,
  type FormalMarketStructureGateDecision,
  type FormalMarketStructureGateEvent,
} from "./formal-market-structure-gate-audit.js";
import {
  buildMarketStructureOutcomeCalibrationReport,
  type MarketStructureOutcomeEvent,
  type MarketStructureOutcomeVerdict,
} from "./market-structure-outcome-calibration.js";

type OutcomeBucketKey = MarketStructureOutcomeVerdict | "not_found";

export type FormalMarketStructureGateCalibrationBucket = {
  key: string;
  events: number;
  actionable: number;
  metadataOnly: number;
  oldVisible: number;
  newlyQuieted: number;
  continued: number;
  failed: number;
  mixed: number;
  noFollowThrough: number;
  insufficientPriceEvidence: number;
  notFound: number;
  averageMaxFavorablePct: number | null;
  averageMaxAdversePct: number | null;
};

export type FormalMarketStructureGateCalibrationEvent = FormalMarketStructureGateEvent & {
  session: string;
  outcomeVerdict: OutcomeBucketKey;
  maxFavorablePct: number | null;
  maxAdversePct: number | null;
  evidenceRows: number | null;
};

export type FormalMarketStructureGateCalibrationReport = {
  generatedAt: string;
  sourceRoot: string;
  auditCount: number;
  limit: number | null;
  totals: {
    formalBosChochEvents: number;
    actionable: number;
    metadataOnly: number;
    oldVisible: number;
    newlyQuieted: number;
    continued: number;
    failed: number;
    mixed: number;
    noFollowThrough: number;
    insufficientPriceEvidence: number;
    notFound: number;
  };
  byDecision: FormalMarketStructureGateCalibrationBucket[];
  byReason: FormalMarketStructureGateCalibrationBucket[];
  byTimeframe: FormalMarketStructureGateCalibrationBucket[];
  byConfidence: FormalMarketStructureGateCalibrationBucket[];
  events: FormalMarketStructureGateCalibrationEvent[];
};

export type BuildFormalMarketStructureGateCalibrationOptions = {
  sourceRoot: string;
  limit?: number | null;
  forwardWindowMinutes?: number;
};

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

function sessionName(auditPath: string): string {
  return basename(dirname(auditPath));
}

function outcomeByStory(events: MarketStructureOutcomeEvent[]): Map<string, MarketStructureOutcomeEvent> {
  const byStory = new Map<string, MarketStructureOutcomeEvent>();
  for (const event of events) {
    byStory.set(`${event.symbol}|${event.storyKey}`, event);
  }
  return byStory;
}

function average(values: Array<number | null>): number | null {
  const finite = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (finite.length === 0) {
    return null;
  }
  return Number((finite.reduce((sum, value) => sum + value, 0) / finite.length).toFixed(2));
}

function bucketFor(key: string, events: FormalMarketStructureGateCalibrationEvent[]): FormalMarketStructureGateCalibrationBucket {
  return {
    key,
    events: events.length,
    actionable: events.filter((event) => event.decision === "actionable").length,
    metadataOnly: events.filter((event) => event.decision === "metadata_only").length,
    oldVisible: events.filter((event) => event.oldVisible).length,
    newlyQuieted: events.filter((event) => event.oldVisible && event.decision === "metadata_only").length,
    continued: events.filter((event) => event.outcomeVerdict === "continued").length,
    failed: events.filter((event) => event.outcomeVerdict === "failed").length,
    mixed: events.filter((event) => event.outcomeVerdict === "mixed").length,
    noFollowThrough: events.filter((event) => event.outcomeVerdict === "no_follow_through").length,
    insufficientPriceEvidence: events.filter((event) => event.outcomeVerdict === "insufficient_price_evidence").length,
    notFound: events.filter((event) => event.outcomeVerdict === "not_found").length,
    averageMaxFavorablePct: average(events.map((event) => event.maxFavorablePct)),
    averageMaxAdversePct: average(events.map((event) => event.maxAdversePct)),
  };
}

function bucketsBy(
  events: FormalMarketStructureGateCalibrationEvent[],
  keyFor: (event: FormalMarketStructureGateCalibrationEvent) => string,
): FormalMarketStructureGateCalibrationBucket[] {
  const groups = new Map<string, FormalMarketStructureGateCalibrationEvent[]>();
  for (const event of events) {
    const key = keyFor(event);
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }
  return [...groups.entries()]
    .map(([key, bucketEvents]) => bucketFor(key, bucketEvents))
    .sort((left, right) => right.events - left.events || left.key.localeCompare(right.key));
}

function outcomeCounts(events: FormalMarketStructureGateCalibrationEvent[]): Pick<
  FormalMarketStructureGateCalibrationReport["totals"],
  "continued" | "failed" | "mixed" | "noFollowThrough" | "insufficientPriceEvidence" | "notFound"
> {
  return {
    continued: events.filter((event) => event.outcomeVerdict === "continued").length,
    failed: events.filter((event) => event.outcomeVerdict === "failed").length,
    mixed: events.filter((event) => event.outcomeVerdict === "mixed").length,
    noFollowThrough: events.filter((event) => event.outcomeVerdict === "no_follow_through").length,
    insufficientPriceEvidence: events.filter((event) => event.outcomeVerdict === "insufficient_price_evidence").length,
    notFound: events.filter((event) => event.outcomeVerdict === "not_found").length,
  };
}

export function buildFormalMarketStructureGateCalibrationReport(
  options: BuildFormalMarketStructureGateCalibrationOptions,
): FormalMarketStructureGateCalibrationReport {
  const auditFiles = discoverAuditFiles(options.sourceRoot);
  const selected = options.limit === null
    ? auditFiles
    : auditFiles.slice(0, Math.max(options.limit ?? 25, 0));
  const events: FormalMarketStructureGateCalibrationEvent[] = [];

  for (const auditPath of selected) {
    const gateReport = buildFormalMarketStructureGateAuditReport(auditPath);
    const outcomeReport = buildMarketStructureOutcomeCalibrationReport({
      auditPath,
      forwardWindowMinutes: options.forwardWindowMinutes,
    });
    const outcomes = outcomeByStory(outcomeReport.events);
    const session = sessionName(auditPath);
    for (const event of gateReport.events) {
      const outcome = outcomes.get(`${event.symbol}|${event.storyKey}`);
      events.push({
        ...event,
        session,
        outcomeVerdict: outcome?.verdict ?? "not_found",
        maxFavorablePct: outcome?.maxFavorablePct ?? null,
        maxAdversePct: outcome?.maxAdversePct ?? null,
        evidenceRows: outcome?.evidenceRows ?? null,
      });
    }
  }

  const outcomes = outcomeCounts(events);
  return {
    generatedAt: new Date().toISOString(),
    sourceRoot: options.sourceRoot,
    auditCount: selected.length,
    limit: options.limit ?? 25,
    totals: {
      formalBosChochEvents: events.length,
      actionable: events.filter((event) => event.decision === "actionable").length,
      metadataOnly: events.filter((event) => event.decision === "metadata_only").length,
      oldVisible: events.filter((event) => event.oldVisible).length,
      newlyQuieted: events.filter((event) => event.oldVisible && event.decision === "metadata_only").length,
      ...outcomes,
    },
    byDecision: bucketsBy(events, (event) => event.decision),
    byReason: bucketsBy(events, (event) => event.gateReason),
    byTimeframe: bucketsBy(events, (event) => event.timeframe),
    byConfidence: bucketsBy(events, (event) => event.confidence),
    events,
  };
}

function formatBucket(bucket: FormalMarketStructureGateCalibrationBucket): string {
  return `- ${bucket.key}: events ${bucket.events}, actionable ${bucket.actionable}, metadata-only ${bucket.metadataOnly}, continued/failed/mixed ${bucket.continued}/${bucket.failed}/${bucket.mixed}, insufficient ${bucket.insufficientPriceEvidence}, newly quieted ${bucket.newlyQuieted}, avg favorable ${bucket.averageMaxFavorablePct ?? "n/a"}%, avg adverse ${bucket.averageMaxAdversePct ?? "n/a"}%`;
}

export function formatFormalMarketStructureGateCalibrationMarkdown(
  report: FormalMarketStructureGateCalibrationReport,
): string {
  const lines: string[] = [
    "# Formal Market Structure Gate Calibration",
    "",
    `Generated: ${report.generatedAt}`,
    `Source root: ${report.sourceRoot}`,
    `Audit files: ${report.auditCount}`,
    "",
    "## Summary",
    "",
    `- fresh formal BOS/CHOCH events: ${report.totals.formalBosChochEvents}`,
    `- actionable after gate: ${report.totals.actionable}`,
    `- metadata-only after gate: ${report.totals.metadataOnly}`,
    `- historically visible/carried: ${report.totals.oldVisible}`,
    `- newly quieted by gate: ${report.totals.newlyQuieted}`,
    `- outcomes continued/failed/mixed/no-follow/insufficient/not-found: ${report.totals.continued}/${report.totals.failed}/${report.totals.mixed}/${report.totals.noFollowThrough}/${report.totals.insufficientPriceEvidence}/${report.totals.notFound}`,
    "",
    "## By Decision",
    "",
    ...report.byDecision.map(formatBucket),
    "",
    "## By Gate Reason",
    "",
    ...report.byReason.map(formatBucket),
    "",
    "## By Timeframe",
    "",
    ...report.byTimeframe.map(formatBucket),
    "",
    "## By Confidence",
    "",
    ...report.byConfidence.map(formatBucket),
    "",
    "## Review Samples",
    "",
  ];

  const reviewSamples = report.events
    .filter((event) =>
      event.decision === "actionable" ||
      event.outcomeVerdict === "failed" ||
      event.outcomeVerdict === "mixed"
    )
    .slice(0, 80);
  if (reviewSamples.length === 0) {
    lines.push("- No actionable, failed, or mixed formal events found.");
  } else {
    for (const event of reviewSamples) {
      lines.push(
        `- ${event.session} ${event.symbol} ${event.timeframe} ${event.eventType} ${event.confidence}: ${event.decision} (${event.gateReason}) -> ${event.outcomeVerdict}; favorable ${event.maxFavorablePct ?? "n/a"}%, adverse ${event.maxAdversePct ?? "n/a"}%; ${event.gateSummary}`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

export function writeFormalMarketStructureGateCalibrationReport(params: {
  report: FormalMarketStructureGateCalibrationReport;
  jsonPath: string;
  markdownPath: string;
}): void {
  mkdirSync(dirname(params.jsonPath), { recursive: true });
  mkdirSync(dirname(params.markdownPath), { recursive: true });
  writeFileSync(params.jsonPath, `${JSON.stringify(params.report, null, 2)}\n`, "utf8");
  writeFileSync(params.markdownPath, formatFormalMarketStructureGateCalibrationMarkdown(params.report), "utf8");
}
