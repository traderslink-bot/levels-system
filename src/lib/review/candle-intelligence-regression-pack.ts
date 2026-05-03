import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  generateExecutionRelationReplayReport,
  type ExecutionRelationReplaySample,
} from "./execution-relation-replay-report.js";
import { generateFirstSnapshotTradeMapAudit } from "./first-snapshot-trade-map-audit.js";
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
  | "missing_forward_resistance";

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
  provider: CandleProviderName;
  totals: {
    cases: number;
    weakFirstSnapshot: number;
    volumeMayHelp: number;
    volumeShouldHide: number;
    executionRelationContext: number;
    executionRelationMissingEvidence: number;
    missingForwardResistance: number;
  };
  cases: CandleIntelligenceRegressionCase[];
};

export type GenerateCandleIntelligenceRegressionPackOptions = {
  auditPath: string;
  cacheDirectoryPath?: string;
  provider?: CandleProviderName;
  maxCasesPerType?: number;
};

export type WriteCandleIntelligenceRegressionPackOptions =
  GenerateCandleIntelligenceRegressionPackOptions & {
    jsonPath: string;
    markdownPath: string;
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

export async function generateCandleIntelligenceRegressionPack(
  options: GenerateCandleIntelligenceRegressionPackOptions,
): Promise<CandleIntelligenceRegressionPack> {
  const cacheDirectoryPath = options.cacheDirectoryPath ?? ".validation-cache/candles";
  const provider = options.provider ?? "ibkr";
  const maxCasesPerType = Math.max(1, options.maxCasesPerType ?? 25);
  const firstSnapshot = generateFirstSnapshotTradeMapAudit({ auditPath: options.auditPath });
  const volume = generateWarehouseVolumeActivityReport({
    auditPath: options.auditPath,
    cacheDirectoryPath,
    provider,
  });
  const execution = await generateExecutionRelationReplayReport({
    auditPath: options.auditPath,
    cacheDirectoryPath,
    provider,
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

  return {
    generatedAt: new Date().toISOString(),
    sourceAuditPath: options.auditPath,
    cacheDirectoryPath,
    provider,
    totals: {
      cases: cases.length,
      weakFirstSnapshot: cases.filter((item) => item.type === "weak_first_snapshot").length,
      volumeMayHelp: cases.filter((item) => item.type === "volume_may_help").length,
      volumeShouldHide: cases.filter((item) => item.type === "volume_should_hide").length,
      executionRelationContext: cases.filter((item) => item.type === "execution_relation_context").length,
      executionRelationMissingEvidence: cases.filter((item) => item.type === "execution_relation_missing_evidence").length,
      missingForwardResistance: cases.filter((item) => item.type === "missing_forward_resistance").length,
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
