import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  buildAiSignalStoryKey,
  classifyLiveThreadMessage,
  formatPolicyLevel,
  type LiveOutputClass,
  type LiveThreadMessageKind,
} from "../monitoring/live-thread-post-policy.js";

type AuditEntry = {
  type?: string;
  operation?: string;
  status?: string;
  timestamp?: number;
  symbol?: string;
  title?: string;
  messageKind?: string;
  eventType?: string;
  followThroughLabel?: string;
  continuityType?: string;
  progressLabel?: string;
  targetPrice?: number;
  directionalReturnPct?: number | null;
  rawReturnPct?: number | null;
  repeatedOutcomeUpdate?: boolean;
  snapshotAudit?: {
    referencePrice: number;
    displayTolerance: number;
    forwardResistanceLimit: number;
    displayedSupportIds: string[];
    displayedResistanceIds: string[];
    omittedSupportCount: number;
    omittedResistanceCount: number;
    omittedSupportLevels: SnapshotAuditLevel[];
    omittedResistanceLevels: SnapshotAuditLevel[];
  };
};

type SnapshotAuditLevel = {
  id: string;
  side: "support" | "resistance";
  bucket: "surfaced" | "extension";
  representativePrice: number;
  zoneLow: number;
  zoneHigh: number;
  strengthLabel: string;
  strengthScore: number;
  confluenceCount: number;
  sourceEvidenceCount: number;
  timeframeBias: string;
  timeframeSources: string[];
  sourceTypes: string[];
  freshness: string;
  isExtension: boolean;
  displayed: boolean;
  omittedReason: string;
};

type ThreadPostPolicySymbolState = {
  posted: number;
  failed: number;
  postedTimestamps: number[];
  classes: Record<LiveOutputClass, number>;
  byMessageKind: Record<string, number>;
  stories: Map<string, {
    storyKey: string;
    messageKind: string;
    count: number;
    firstTimestamp: number;
    lastTimestamp: number;
    latestDirectionalReturnPct?: number | null;
    latestRawReturnPct?: number | null;
  }>;
};

export type ThreadPostPolicyReport = {
  generatedAt: string;
  sourceAuditPath: string;
  totals: {
    posted: number;
    failed: number;
    traderCritical: number;
    traderHelpfulOptional: number;
    operatorOnly: number;
    repeatedStoryClusters: number;
  };
  topFindings: string[];
  perSymbol: Array<{
    symbol: string;
    posted: number;
    failed: number;
    traderCritical: number;
    traderHelpfulOptional: number;
    operatorOnly: number;
    optionalDensity: number;
    maxPostsInFiveMinutes: number;
    maxPostsInTenMinutes: number;
    byMessageKind: Record<string, number>;
    repeatedStoryClusters: Array<{
      storyKey: string;
      messageKind: string;
      count: number;
      firstTimestamp: number;
      lastTimestamp: number;
      latestDirectionalReturnPct?: number | null;
      latestRawReturnPct?: number | null;
    }>;
    dominantRisk: "controlled" | "repeated_story" | "optional_density" | "post_burst" | "delivery_failure";
    recommendations: string[];
    threadTrustScore: number;
  }>;
};

export type SnapshotAuditReport = {
  generatedAt: string;
  sourceAuditPath: string;
  snapshots: Array<{
    symbol: string;
    timestamp: number;
    referencePrice: number;
    forwardResistanceLimit: number;
    displayedSupportCount: number;
    displayedResistanceCount: number;
    omittedSupportCount: number;
    omittedResistanceCount: number;
    omittedByReason: Record<string, number>;
    omittedSupportLevels: SnapshotAuditLevel[];
    omittedResistanceLevels: SnapshotAuditLevel[];
  }>;
  perSymbol: Array<{
    symbol: string;
    snapshotCount: number;
    latestTimestamp: number;
    latestReferencePrice: number;
    displayedSupportCount: number;
    displayedResistanceCount: number;
    omittedByReason: Record<string, number>;
    compactedLevels: number[];
    wrongSideLevels: number[];
    outsideForwardRangeLevels: number[];
  }>;
};

function readJsonLines(path: string): AuditEntry[] {
  const text = readFileSync(path, "utf8");
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as AuditEntry];
      } catch {
        return [];
      }
    });
}

function increment(table: Record<string, number>, key: string): void {
  table[key] = (table[key] ?? 0) + 1;
}

function symbolOf(entry: AuditEntry): string {
  return entry.symbol?.trim().toUpperCase() || "UNKNOWN";
}

function messageKindOf(entry: AuditEntry): LiveThreadMessageKind | undefined {
  if (entry.operation === "post_level_snapshot") {
    return "level_snapshot";
  }

  if (entry.operation === "post_level_extension") {
    return "level_extension";
  }

  return entry.messageKind as LiveThreadMessageKind | undefined;
}

function storyKeyFor(entry: AuditEntry): string | null {
  const kind = messageKindOf(entry);
  if (!kind || entry.operation !== "post_alert") {
    return null;
  }

  const symbol = symbolOf(entry);
  const eventType = entry.eventType ?? "unknown";
  if (kind === "follow_through_update") {
    return [
      kind,
      eventType,
      entry.followThroughLabel ?? "unknown",
      typeof entry.targetPrice === "number" ? formatPolicyLevel(entry.targetPrice) : "unknown",
    ].join("|");
  }

  if (kind === "continuity_update") {
    return [
      kind,
      eventType,
      entry.continuityType ?? "unknown",
    ].join("|");
  }

  if (kind === "ai_signal_commentary") {
    return `ai|${buildAiSignalStoryKey({
      symbol,
      eventType,
      level: entry.targetPrice,
      title: entry.title,
    })}`;
  }

  return null;
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function buildThreadPostPolicyReport(auditPath: string): ThreadPostPolicyReport {
  const entries = readJsonLines(auditPath).filter((entry) => entry.type === "discord_delivery_audit");
  const perSymbol = new Map<string, ThreadPostPolicySymbolState>();

  const getSymbol = (symbol: string) => {
    const existing = perSymbol.get(symbol);
    if (existing) {
      return existing;
    }

    const created: ThreadPostPolicySymbolState = {
      posted: 0,
      failed: 0,
      postedTimestamps: [],
      classes: {
        trader_critical: 0,
        trader_helpful_optional: 0,
        operator_only: 0,
      },
      byMessageKind: {},
      stories: new Map(),
    };
    perSymbol.set(symbol, created);
    return created;
  };

  for (const entry of entries) {
    const symbol = symbolOf(entry);
    const state = getSymbol(symbol);
    const kind = messageKindOf(entry);
    const outputClass = classifyLiveThreadMessage(kind);
    if (entry.status === "posted") {
      state.posted += 1;
      if (typeof entry.timestamp === "number") {
        state.postedTimestamps.push(entry.timestamp);
      }
      state.classes[outputClass] += 1;
    } else if (entry.status === "failed") {
      state.failed += 1;
    }

    if (kind) {
      increment(state.byMessageKind, kind);
    }

    const storyKey = storyKeyFor(entry);
    if (entry.status === "posted" && storyKey && kind) {
      const existing = state.stories.get(storyKey);
      if (existing) {
        existing.count += 1;
        existing.lastTimestamp = entry.timestamp ?? existing.lastTimestamp;
        existing.latestDirectionalReturnPct = entry.directionalReturnPct;
        existing.latestRawReturnPct = entry.rawReturnPct;
      } else {
        state.stories.set(storyKey, {
          storyKey,
          messageKind: kind,
          count: 1,
          firstTimestamp: entry.timestamp ?? 0,
          lastTimestamp: entry.timestamp ?? 0,
          latestDirectionalReturnPct: entry.directionalReturnPct,
          latestRawReturnPct: entry.rawReturnPct,
        });
      }
    }
  }

  const symbolReports = [...perSymbol.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([symbol, state]) => {
      const repeatedStoryClusters = [...state.stories.values()]
        .filter((story) => story.count >= 3)
        .sort((left, right) => right.count - left.count || left.storyKey.localeCompare(right.storyKey));
      const optionalDensity = state.posted > 0 ? state.classes.trader_helpful_optional / state.posted : 0;
      const maxPostsInFiveMinutes = maxEventsInWindow(state.postedTimestamps, 5 * 60 * 1000);
      const maxPostsInTenMinutes = maxEventsInWindow(state.postedTimestamps, 10 * 60 * 1000);
      const repeatPenalty = repeatedStoryClusters.reduce((sum, story) => sum + Math.max(0, story.count - 2), 0);
      const failurePenalty = state.failed * 8;
      const optionalDensityEligible = state.posted >= 6 && state.classes.trader_helpful_optional >= 3;
      const optionalPenalty = optionalDensityEligible && optionalDensity > 0.35 ? Math.round((optionalDensity - 0.35) * 80) : 0;
      const burstPenalty = Math.max(0, maxPostsInFiveMinutes - 5) * 5 + Math.max(0, maxPostsInTenMinutes - 8) * 3;
      const threadTrustScore = clampScore(100 - repeatPenalty * 4 - failurePenalty - optionalPenalty - burstPenalty);
      const dominantRisk = chooseDominantPolicyRisk({
        failed: state.failed,
        repeatedStoryClusters,
        posted: state.posted,
        traderHelpfulOptional: state.classes.trader_helpful_optional,
        optionalDensity,
        maxPostsInFiveMinutes,
        maxPostsInTenMinutes,
      });
      const recommendations: string[] = [];
      if (repeatedStoryClusters.length > 0) {
        const worst = repeatedStoryClusters[0];
        recommendations.push(
          `tighten ${worst.messageKind} same-story gating around ${worst.storyKey}; it repeated ${worst.count} times`,
        );
      }
      if (optionalDensity > 0.35) {
        recommendations.push(
          `optional context density is ${(optionalDensity * 100).toFixed(0)}%; continuity, AI, or recap should need fresher evidence`,
        );
      }
      if (maxPostsInFiveMinutes > 5 || maxPostsInTenMinutes > 8) {
        recommendations.push(
          `post burst detected: ${maxPostsInFiveMinutes} posts in 5 minutes / ${maxPostsInTenMinutes} posts in 10 minutes`,
        );
      }
      if (state.failed > 0) {
        recommendations.push("review Discord delivery failures before judging signal quality");
      }
      if (recommendations.length === 0) {
        recommendations.push("thread policy looked controlled in this audit");
      }

      return {
        symbol,
        posted: state.posted,
        failed: state.failed,
        traderCritical: state.classes.trader_critical,
        traderHelpfulOptional: state.classes.trader_helpful_optional,
        operatorOnly: state.classes.operator_only,
        optionalDensity: Number(optionalDensity.toFixed(4)),
        maxPostsInFiveMinutes,
        maxPostsInTenMinutes,
        byMessageKind: state.byMessageKind,
        repeatedStoryClusters,
        dominantRisk,
        recommendations,
        threadTrustScore,
      };
    });
  const topFindings = buildTopPolicyFindings(symbolReports);

  return {
    generatedAt: new Date().toISOString(),
    sourceAuditPath: auditPath,
    totals: {
      posted: symbolReports.reduce((sum, item) => sum + item.posted, 0),
      failed: symbolReports.reduce((sum, item) => sum + item.failed, 0),
      traderCritical: symbolReports.reduce((sum, item) => sum + item.traderCritical, 0),
      traderHelpfulOptional: symbolReports.reduce((sum, item) => sum + item.traderHelpfulOptional, 0),
      operatorOnly: symbolReports.reduce((sum, item) => sum + item.operatorOnly, 0),
      repeatedStoryClusters: symbolReports.reduce(
        (sum, item) => sum + item.repeatedStoryClusters.length,
        0,
      ),
    },
    topFindings,
    perSymbol: symbolReports,
  };
}

function maxEventsInWindow(timestamps: number[], windowMs: number): number {
  const sorted = [...timestamps].sort((left, right) => left - right);
  let max = 0;
  let start = 0;
  for (let end = 0; end < sorted.length; end += 1) {
    while (sorted[end] - sorted[start] > windowMs) {
      start += 1;
    }
    max = Math.max(max, end - start + 1);
  }
  return max;
}

function chooseDominantPolicyRisk(params: {
  failed: number;
  repeatedStoryClusters: Array<{ count: number }>;
  posted: number;
  traderHelpfulOptional: number;
  optionalDensity: number;
  maxPostsInFiveMinutes: number;
  maxPostsInTenMinutes: number;
}): ThreadPostPolicyReport["perSymbol"][number]["dominantRisk"] {
  if (params.failed > 0) {
    return "delivery_failure";
  }
  if (params.repeatedStoryClusters.length > 0) {
    return "repeated_story";
  }
  if (params.maxPostsInFiveMinutes > 5 || params.maxPostsInTenMinutes > 8) {
    return "post_burst";
  }
  if (params.posted >= 6 && params.traderHelpfulOptional >= 3 && params.optionalDensity > 0.35) {
    return "optional_density";
  }
  return "controlled";
}

function buildTopPolicyFindings(symbolReports: ThreadPostPolicyReport["perSymbol"]): string[] {
  const findings: string[] = [];
  const worstTrust = [...symbolReports].sort(
    (left, right) => left.threadTrustScore - right.threadTrustScore || right.posted - left.posted,
  )[0];
  if (worstTrust && worstTrust.threadTrustScore < 70) {
    findings.push(
      `${worstTrust.symbol} had the weakest thread trust score (${worstTrust.threadTrustScore}) with dominant risk ${worstTrust.dominantRisk}`,
    );
  }

  const worstRepeat = symbolReports
    .flatMap((symbol) =>
      symbol.repeatedStoryClusters.map((story) => ({
        symbol: symbol.symbol,
        story,
      })),
    )
    .sort((left, right) => right.story.count - left.story.count)[0];
  if (worstRepeat) {
    findings.push(
      `${worstRepeat.symbol} repeated ${worstRepeat.story.messageKind} story ${worstRepeat.story.count} times: ${worstRepeat.story.storyKey}`,
    );
  }

  const worstBurst = [...symbolReports].sort(
    (left, right) => right.maxPostsInTenMinutes - left.maxPostsInTenMinutes || right.maxPostsInFiveMinutes - left.maxPostsInFiveMinutes,
  )[0];
  if (worstBurst && (worstBurst.maxPostsInFiveMinutes > 5 || worstBurst.maxPostsInTenMinutes > 8)) {
    findings.push(
      `${worstBurst.symbol} had the biggest post burst (${worstBurst.maxPostsInFiveMinutes} in 5m / ${worstBurst.maxPostsInTenMinutes} in 10m)`,
    );
  }

  if (findings.length === 0) {
    findings.push("No major repeated-story, burst, optional-density, or delivery-failure policy issues stood out.");
  }
  return findings;
}

function countOmittedReasons(levels: SnapshotAuditLevel[], output: Record<string, number>): void {
  for (const level of levels) {
    increment(output, level.omittedReason);
  }
}

export function buildSnapshotAuditReport(auditPath: string): SnapshotAuditReport {
  const entries = readJsonLines(auditPath).filter(
    (entry) => entry.type === "discord_delivery_audit" && entry.operation === "post_level_snapshot" && entry.snapshotAudit,
  );
  const snapshots = entries.map((entry) => {
    const audit = entry.snapshotAudit!;
    const omittedByReason: Record<string, number> = {};
    countOmittedReasons(audit.omittedSupportLevels, omittedByReason);
    countOmittedReasons(audit.omittedResistanceLevels, omittedByReason);
    return {
      symbol: symbolOf(entry),
      timestamp: entry.timestamp ?? 0,
      referencePrice: audit.referencePrice,
      forwardResistanceLimit: audit.forwardResistanceLimit,
      displayedSupportCount: audit.displayedSupportIds.length,
      displayedResistanceCount: audit.displayedResistanceIds.length,
      omittedSupportCount: audit.omittedSupportCount,
      omittedResistanceCount: audit.omittedResistanceCount,
      omittedByReason,
      omittedSupportLevels: audit.omittedSupportLevels,
      omittedResistanceLevels: audit.omittedResistanceLevels,
    };
  });
  const bySymbol = new Map<string, SnapshotAuditReport["perSymbol"][number]>();

  for (const snapshot of snapshots) {
    const existing = bySymbol.get(snapshot.symbol) ?? {
      symbol: snapshot.symbol,
      snapshotCount: 0,
      latestTimestamp: 0,
      latestReferencePrice: 0,
      displayedSupportCount: 0,
      displayedResistanceCount: 0,
      omittedByReason: {},
      compactedLevels: [],
      wrongSideLevels: [],
      outsideForwardRangeLevels: [],
    };
    existing.snapshotCount += 1;
    for (const [reason, count] of Object.entries(snapshot.omittedByReason)) {
      existing.omittedByReason[reason] = (existing.omittedByReason[reason] ?? 0) + count;
    }
    const omitted = [...snapshot.omittedSupportLevels, ...snapshot.omittedResistanceLevels];
    existing.compactedLevels.push(
      ...omitted.filter((level) => level.omittedReason === "compacted").map((level) => level.representativePrice),
    );
    existing.wrongSideLevels.push(
      ...omitted.filter((level) => level.omittedReason === "wrong_side").map((level) => level.representativePrice),
    );
    existing.outsideForwardRangeLevels.push(
      ...omitted.filter((level) => level.omittedReason === "outside_forward_range").map((level) => level.representativePrice),
    );
    if (snapshot.timestamp >= existing.latestTimestamp) {
      existing.latestTimestamp = snapshot.timestamp;
      existing.latestReferencePrice = snapshot.referencePrice;
      existing.displayedSupportCount = snapshot.displayedSupportCount;
      existing.displayedResistanceCount = snapshot.displayedResistanceCount;
    }
    bySymbol.set(snapshot.symbol, existing);
  }

  return {
    generatedAt: new Date().toISOString(),
    sourceAuditPath: auditPath,
    snapshots,
    perSymbol: [...bySymbol.values()].sort((left, right) => left.symbol.localeCompare(right.symbol)),
  };
}

export function writeJsonReport(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function writeTextReport(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value.endsWith("\n") ? value : `${value}\n`, "utf8");
}

export function formatThreadPostPolicyMarkdown(report: ThreadPostPolicyReport): string {
  const lines: string[] = [
    "# Thread Post Policy Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Source: ${report.sourceAuditPath}`,
    "",
    "## Totals",
    "",
    `- posted: ${report.totals.posted}`,
    `- failed: ${report.totals.failed}`,
    `- trader-critical: ${report.totals.traderCritical}`,
    `- trader-helpful optional: ${report.totals.traderHelpfulOptional}`,
    `- repeated story clusters: ${report.totals.repeatedStoryClusters}`,
    "",
    "## Top Findings",
    "",
    ...report.topFindings.map((finding) => `- ${finding}`),
    "",
    "## Symbols Needing Attention",
    "",
  ];

  const attention = report.perSymbol.filter(
    (symbol) => symbol.dominantRisk !== "controlled" || symbol.threadTrustScore < 85,
  );
  if (attention.length === 0) {
    lines.push("- No symbols required policy attention in this audit.", "");
  } else {
    for (const symbol of attention) {
      lines.push(
        `### ${symbol.symbol}`,
        "",
        `- trust score: ${symbol.threadTrustScore}`,
        `- dominant risk: ${symbol.dominantRisk}`,
        `- posts: ${symbol.posted} (${symbol.traderCritical} critical / ${symbol.traderHelpfulOptional} optional)`,
        `- optional density: ${(symbol.optionalDensity * 100).toFixed(0)}%`,
        `- burst max: ${symbol.maxPostsInFiveMinutes} in 5m / ${symbol.maxPostsInTenMinutes} in 10m`,
        "- recommendations:",
        ...symbol.recommendations.map((recommendation) => `  - ${recommendation}`),
      );
      if (symbol.repeatedStoryClusters.length > 0) {
        lines.push("- repeated stories:");
        for (const story of symbol.repeatedStoryClusters.slice(0, 5)) {
          lines.push(`  - ${story.count}x ${story.storyKey}`);
        }
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

export function formatSnapshotAuditMarkdown(report: SnapshotAuditReport): string {
  const lines: string[] = [
    "# Snapshot Audit Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Source: ${report.sourceAuditPath}`,
    "",
    "## Symbols",
    "",
  ];

  if (report.perSymbol.length === 0) {
    lines.push("- No snapshot audit rows were found.", "");
    return lines.join("\n");
  }

  for (const symbol of report.perSymbol) {
    const reasonText = Object.entries(symbol.omittedByReason)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([reason, count]) => `${reason}: ${count}`)
      .join(", ") || "none";
    lines.push(
      `### ${symbol.symbol}`,
      "",
      `- snapshots: ${symbol.snapshotCount}`,
      `- latest reference price: ${symbol.latestReferencePrice}`,
      `- displayed latest: ${symbol.displayedSupportCount} support / ${symbol.displayedResistanceCount} resistance`,
      `- omitted reasons: ${reasonText}`,
      `- compacted levels: ${formatLevelList(symbol.compactedLevels)}`,
      `- wrong-side levels: ${formatLevelList(symbol.wrongSideLevels)}`,
      `- outside forward range levels: ${formatLevelList(symbol.outsideForwardRangeLevels)}`,
      "",
    );
  }

  return lines.join("\n");
}

function formatLevelList(levels: number[]): string {
  if (levels.length === 0) {
    return "none";
  }
  return [...new Set(levels)]
    .sort((left, right) => left - right)
    .map((level) => level >= 1 ? level.toFixed(2) : level.toFixed(4))
    .join(", ");
}

export function defaultReportPaths(sessionDirectory: string): {
  auditPath: string;
  policyReportPath: string;
  snapshotReportPath: string;
  policyMarkdownPath: string;
  snapshotMarkdownPath: string;
  tuningJsonPath: string;
  tuningMarkdownPath: string;
  replaySimulationJsonPath: string;
  replaySimulationMarkdownPath: string;
  profileComparisonJsonPath: string;
  profileComparisonMarkdownPath: string;
  runnerStoryJsonPath: string;
  runnerStoryMarkdownPath: string;
} {
  return {
    auditPath: join(sessionDirectory, "discord-delivery-audit.jsonl"),
    policyReportPath: join(sessionDirectory, "thread-post-policy-report.json"),
    snapshotReportPath: join(sessionDirectory, "snapshot-audit-report.json"),
    policyMarkdownPath: join(sessionDirectory, "thread-post-policy-report.md"),
    snapshotMarkdownPath: join(sessionDirectory, "snapshot-audit-report.md"),
    tuningJsonPath: join(sessionDirectory, "long-run-tuning-suggestions.json"),
    tuningMarkdownPath: join(sessionDirectory, "long-run-tuning-suggestions.md"),
    replaySimulationJsonPath: join(sessionDirectory, "live-post-replay-simulation.json"),
    replaySimulationMarkdownPath: join(sessionDirectory, "live-post-replay-simulation.md"),
    profileComparisonJsonPath: join(sessionDirectory, "live-post-profile-comparison.json"),
    profileComparisonMarkdownPath: join(sessionDirectory, "live-post-profile-comparison.md"),
    runnerStoryJsonPath: join(sessionDirectory, "runner-story-report.json"),
    runnerStoryMarkdownPath: join(sessionDirectory, "runner-story-report.md"),
  };
}
