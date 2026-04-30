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
  body?: string;
  bodyPreview?: string;
  messageKind?: string;
  eventType?: string;
  severity?: string;
  confidence?: string;
  followThroughLabel?: string;
  continuityType?: string;
  progressLabel?: string;
  targetSide?: "support" | "resistance";
  targetPrice?: number;
  crossedLevels?: number[];
  clusterLow?: number;
  clusterHigh?: number;
  clusteredLevelClear?: boolean;
  retryAttempt?: number;
  retryOf?: number;
  retryReason?: string;
  directionalReturnPct?: number | null;
  rawReturnPct?: number | null;
  repeatedOutcomeUpdate?: boolean;
  error?: string;
  errorMessage?: string;
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

type AuditFindingSeverity = "blocker" | "major" | "watch" | "historical_only" | "data_quality_only";

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

export type TradingDayEvidenceReport = {
  generatedAt: string;
  sourceAuditPath: string;
  severityRubric: Record<AuditFindingSeverity, string>;
  criticalDeliveryFailures: Array<{
    symbol: string;
    timestamp: number;
    title?: string;
    messageKind?: string;
    eventType?: string;
    traderCritical: boolean;
    equivalentLaterPost: boolean;
    equivalentLaterTimestamp?: number;
    equivalentLaterTitle?: string;
    retryProven: boolean;
    severity: AuditFindingSeverity;
    error?: string;
    excerpt: string;
  }>;
  roleFlipCandidates: Array<{
    symbol: string;
    timestamp: number;
    scenario: "broken_support_as_resistance" | "reclaimed_resistance_as_support" | "false_clear_certainty";
    level?: number;
    title?: string;
    explainedClearly: boolean;
    severity: AuditFindingSeverity;
    evidence: string;
  }>;
  clusterCrossCandidates: Array<{
    symbol: string;
    firstTimestamp: number;
    lastTimestamp: number;
    side: "support" | "resistance" | "mixed";
    levels: number[];
    postCount: number;
    likelyOverExplained: boolean;
    preferClusterStory: boolean;
    severity: AuditFindingSeverity;
    titles: string[];
  }>;
  traderLanguageEvidence: {
    goodExamples: Array<TraderLanguageEvidenceExample>;
    badHistoricalExamples: Array<TraderLanguageEvidenceExample>;
    borderlineAdviceExamples: Array<TraderLanguageEvidenceExample>;
  };
};

type TraderLanguageEvidenceExample = {
  symbol: string;
  timestamp: number;
  title?: string;
  severity: AuditFindingSeverity;
  reason: string;
  excerpt: string;
};

const SEVERITY_RUBRIC: Record<AuditFindingSeverity, string> = {
  blocker: "A trader-critical safety or trust issue that should stop release until fixed.",
  major: "A material trader-facing issue that needs a code, retry, or process fix before relying on the next run.",
  watch: "A real concern that needs targeted review or live verification, but is not enough evidence for an immediate code change.",
  historical_only: "Found in saved old posts or artifacts, but current code/runtime proof is still required before changing code.",
  data_quality_only: "Explained by stale/missing/provider data; do not change trader logic until better data proves the issue.",
};

const SYSTEM_SHAPED_LANGUAGE =
  /Status:|Signal:|Decision area|setup update|state update|state recap|setup move|alert direction|after the alert|LEVEL SNAPSHOT|level map|mapped|not a price target|dip-buy/i;

const DIRECT_ADVICE_LANGUAGE =
  /\b(?:buy here|buy now|sell now|sell here|take profit|stop out|trim here|add here|exit now|short setup|best entry|safe entry|can buy|should add|should trim|should exit|longs should|traders should|wait for)\b/i;

const GOOD_TRADER_LANGUAGE =
  /\b(?:buyers need acceptance|holding (?:above|this)|reclaim(?:ing)?|risk stays|support|resistance|setup cleaner|price is testing)\b/i;

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

export function buildTradingDayEvidenceReport(auditPath: string): TradingDayEvidenceReport {
  const entries = readJsonLines(auditPath)
    .filter((entry) => entry.type === "discord_delivery_audit")
    .sort((left, right) => (left.timestamp ?? 0) - (right.timestamp ?? 0));

  return {
    generatedAt: new Date().toISOString(),
    sourceAuditPath: auditPath,
    severityRubric: SEVERITY_RUBRIC,
    criticalDeliveryFailures: buildCriticalDeliveryFailures(entries),
    roleFlipCandidates: buildRoleFlipCandidates(entries),
    clusterCrossCandidates: buildClusterCrossCandidates(entries),
    traderLanguageEvidence: buildTraderLanguageEvidence(entries),
  };
}

function buildCriticalDeliveryFailures(
  entries: AuditEntry[],
): TradingDayEvidenceReport["criticalDeliveryFailures"] {
  const failures = entries.filter(
    (entry) => entry.operation === "post_alert" && entry.status === "failed",
  );

  return failures.map((failure) => {
    const kind = messageKindOf(failure);
    const outputClass = classifyLiveThreadMessage(kind);
    const traderCritical = outputClass === "trader_critical";
    const equivalentLater = entries.find(
      (candidate) =>
        candidate.status === "posted" &&
        candidate.operation === "post_alert" &&
        (candidate.timestamp ?? 0) >= (failure.timestamp ?? 0) &&
        isEquivalentAlert(failure, candidate),
    );
    const retryProven = Boolean(
      equivalentLater &&
        (
          equivalentLater.retryOf === failure.timestamp ||
          (typeof equivalentLater.retryAttempt === "number" && equivalentLater.retryAttempt > 0)
        ),
    );
    const severity: AuditFindingSeverity = traderCritical
      ? retryProven
        ? "watch"
        : "major"
      : "watch";

    return {
      symbol: symbolOf(failure),
      timestamp: failure.timestamp ?? 0,
      title: failure.title,
      messageKind: kind,
      eventType: failure.eventType,
      traderCritical,
      equivalentLaterPost: Boolean(equivalentLater),
      equivalentLaterTimestamp: equivalentLater?.timestamp,
      equivalentLaterTitle: equivalentLater?.title,
      retryProven,
      severity,
      error: failure.error ?? failure.errorMessage,
      excerpt: excerptFor(failure),
    };
  });
}

function isEquivalentAlert(failed: AuditEntry, posted: AuditEntry): boolean {
  if (symbolOf(failed) !== symbolOf(posted)) {
    return false;
  }
  const failedKind = messageKindOf(failed);
  const postedKind = messageKindOf(posted);
  if (failedKind && postedKind && failedKind !== postedKind) {
    return false;
  }
  if (failed.eventType && posted.eventType && failed.eventType !== posted.eventType) {
    return false;
  }
  if (typeof failed.targetPrice === "number" && typeof posted.targetPrice === "number") {
    const tolerance = Math.max(Math.abs(failed.targetPrice) * 0.01, 0.01);
    return Math.abs(failed.targetPrice - posted.targetPrice) <= tolerance;
  }
  return normalizeTitle(failed.title) === normalizeTitle(posted.title);
}

function normalizeTitle(title: string | undefined): string {
  return title?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";
}

function buildRoleFlipCandidates(
  entries: AuditEntry[],
): TradingDayEvidenceReport["roleFlipCandidates"] {
  const postedAlerts = entries.filter(
    (entry) => entry.operation === "post_alert" && entry.status === "posted",
  );
  const candidates: TradingDayEvidenceReport["roleFlipCandidates"] = [];

  for (const entry of postedAlerts) {
    const kind = messageKindOf(entry);
    if (kind !== "level_clear_update" && kind !== "intelligent_alert") {
      continue;
    }

    const text = fullText(entry);
    const lower = text.toLowerCase();
    const level = typeof entry.targetPrice === "number" ? entry.targetPrice : extractFirstLevel(text);

    if (kind === "level_clear_update" && isSupportLoss(entry, lower)) {
      const explainedClearly =
        /\breclaim(?:ing)?\b/i.test(text) &&
        (/\bresistance\b/i.test(text) || /\btested from below\b/i.test(text) || /\brisk stays open\b/i.test(text));
      candidates.push({
        symbol: symbolOf(entry),
        timestamp: entry.timestamp ?? 0,
        scenario: "broken_support_as_resistance",
        level,
        title: entry.title,
        explainedClearly,
        severity: explainedClearly ? "watch" : "major",
        evidence: excerptFor(entry),
      });
    }

    if (kind === "level_clear_update" && isResistanceReclaim(entry, lower)) {
      const explainedClearly =
        /\bhold(?:ing)? above\b/i.test(text) ||
        /\btested from above\b/i.test(text) ||
        /\bpullbacks? into\b/i.test(text) ||
        /\bnearby support\b/i.test(text);
      candidates.push({
        symbol: symbolOf(entry),
        timestamp: entry.timestamp ?? 0,
        scenario: "reclaimed_resistance_as_support",
        level,
        title: entry.title,
        explainedClearly,
        severity: explainedClearly ? "watch" : "major",
        evidence: excerptFor(entry),
      });
    }

    if (
      (entry.eventType === "breakout" || /resistance (?:cleared|crossed)/i.test(text)) &&
      /Status:\s*Cleared|no longer immediate resistance|price cleared .* moving toward/i.test(text)
    ) {
      candidates.push({
        symbol: symbolOf(entry),
        timestamp: entry.timestamp ?? 0,
        scenario: "false_clear_certainty",
        level,
        title: entry.title,
        explainedClearly: false,
        severity: "historical_only",
        evidence: excerptFor(entry),
      });
    }
  }

  return candidates
    .sort((left, right) => severityRank(right.severity) - severityRank(left.severity) || left.timestamp - right.timestamp)
    .slice(0, 60);
}

function isSupportLoss(entry: AuditEntry, lowerText: string): boolean {
  return (
    entry.eventType === "breakdown" ||
    (entry.targetSide === "support" && /support (?:lost|crossed lower)|slipped below|price lost/i.test(lowerText))
  );
}

function isResistanceReclaim(entry: AuditEntry, lowerText: string): boolean {
  return (
    entry.eventType === "breakout" ||
    entry.eventType === "reclaim" ||
    (entry.targetSide === "resistance" && /resistance (?:cleared|crossed)|pushed above|price cleared/i.test(lowerText))
  );
}

function buildClusterCrossCandidates(
  entries: AuditEntry[],
): TradingDayEvidenceReport["clusterCrossCandidates"] {
  const clearRows = entries
    .filter(
      (entry) =>
        entry.operation === "post_alert" &&
        entry.status === "posted" &&
        messageKindOf(entry) === "level_clear_update" &&
        entry.clusteredLevelClear !== true &&
        typeof entry.timestamp === "number",
    )
    .sort((left, right) => left.timestamp! - right.timestamp!);
  const bySymbol = new Map<string, AuditEntry[]>();
  for (const entry of clearRows) {
    const symbol = symbolOf(entry);
    bySymbol.set(symbol, [...(bySymbol.get(symbol) ?? []), entry]);
  }

  const clusters: TradingDayEvidenceReport["clusterCrossCandidates"] = [];
  for (const [symbol, rows] of bySymbol.entries()) {
    let index = 0;
    while (index < rows.length) {
      const start = rows[index]!;
      const cluster = [start];
      let cursor = index + 1;
      while (cursor < rows.length) {
        const next = rows[cursor]!;
        if ((next.timestamp ?? 0) - (start.timestamp ?? 0) > 90 * 1000) {
          break;
        }
        const nextLevel = levelForCluster(next);
        const clusterLevels = [...cluster.map(levelForCluster), nextLevel].filter(isNumber);
        if (clusterLevels.length > 0 && relativeSpan(clusterLevels) > 0.035) {
          break;
        }
        cluster.push(next);
        cursor += 1;
      }

      const levels = uniqueSorted(cluster.map(levelForCluster).filter(isNumber));
      if (cluster.length >= 2 && levels.length >= 2) {
        const sides = new Set(cluster.map((entry) => entry.targetSide).filter(Boolean));
        const side =
          sides.size === 1 && sides.has("support")
            ? "support"
            : sides.size === 1 && sides.has("resistance")
              ? "resistance"
              : "mixed";
        clusters.push({
          symbol,
          firstTimestamp: cluster[0]!.timestamp ?? 0,
          lastTimestamp: cluster[cluster.length - 1]!.timestamp ?? 0,
          side,
          levels,
          postCount: cluster.length,
          likelyOverExplained: cluster.length >= 2,
          preferClusterStory: cluster.length >= 2,
          severity: cluster.length >= 3 ? "major" : "watch",
          titles: cluster.map((entry) => entry.title ?? "(untitled)"),
        });
      }
      index = Math.max(index + 1, cursor);
    }
  }

  return clusters.sort(
    (left, right) =>
      severityRank(right.severity) - severityRank(left.severity) ||
      right.postCount - left.postCount ||
      left.symbol.localeCompare(right.symbol),
  );
}

function levelForCluster(entry: AuditEntry): number | null {
  if (typeof entry.targetPrice === "number") {
    return entry.targetPrice;
  }
  return extractFirstLevel(fullText(entry)) ?? null;
}

function isNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function relativeSpan(levels: number[]): number {
  if (levels.length === 0) {
    return 0;
  }
  const min = Math.min(...levels);
  const max = Math.max(...levels);
  const mid = (min + max) / 2;
  return mid > 0 ? (max - min) / mid : 0;
}

function uniqueSorted(levels: number[]): number[] {
  return [...new Set(levels.map((level) => Number(level.toFixed(level >= 1 ? 4 : 6))))]
    .sort((left, right) => left - right);
}

function buildTraderLanguageEvidence(
  entries: AuditEntry[],
): TradingDayEvidenceReport["traderLanguageEvidence"] {
  const posted = entries.filter((entry) => entry.status === "posted" && fullText(entry).trim().length > 0);
  const goodExamples: TraderLanguageEvidenceExample[] = [];
  const badHistoricalExamples: TraderLanguageEvidenceExample[] = [];
  const borderlineAdviceExamples: TraderLanguageEvidenceExample[] = [];

  for (const entry of posted) {
    const text = fullText(entry);
    if (borderlineAdviceExamples.length < 8 && DIRECT_ADVICE_LANGUAGE.test(text)) {
      borderlineAdviceExamples.push(languageExample(entry, "major", "direct or borderline advisory wording"));
    }
    if (badHistoricalExamples.length < 12 && SYSTEM_SHAPED_LANGUAGE.test(text)) {
      badHistoricalExamples.push(languageExample(entry, "historical_only", "system-shaped saved Discord wording"));
    }
    if (
      goodExamples.length < 8 &&
      GOOD_TRADER_LANGUAGE.test(text) &&
      !SYSTEM_SHAPED_LANGUAGE.test(text) &&
      !DIRECT_ADVICE_LANGUAGE.test(text)
    ) {
      goodExamples.push(languageExample(entry, "watch", "representative trader-facing wording"));
    }
  }

  return {
    goodExamples,
    badHistoricalExamples,
    borderlineAdviceExamples,
  };
}

function languageExample(
  entry: AuditEntry,
  severity: AuditFindingSeverity,
  reason: string,
): TraderLanguageEvidenceExample {
  return {
    symbol: symbolOf(entry),
    timestamp: entry.timestamp ?? 0,
    title: entry.title,
    severity,
    reason,
    excerpt: excerptFor(entry),
  };
}

function fullText(entry: AuditEntry): string {
  return [entry.title, entry.body, entry.bodyPreview].filter(Boolean).join("\n");
}

function excerptFor(entry: AuditEntry, maxLength = 360): string {
  const text = fullText(entry).replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 3)}...`;
}

function extractFirstLevel(text: string): number | undefined {
  const match = text.match(/\b\d+(?:\.\d+)?\b/);
  if (!match?.[0]) {
    return undefined;
  }
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : undefined;
}

function severityRank(severity: AuditFindingSeverity): number {
  switch (severity) {
    case "blocker":
      return 5;
    case "major":
      return 4;
    case "watch":
      return 3;
    case "data_quality_only":
      return 2;
    case "historical_only":
      return 1;
  }
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

export function formatTradingDayEvidenceMarkdown(report: TradingDayEvidenceReport): string {
  const lines: string[] = [
    "# Trading Day Evidence Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Source: ${report.sourceAuditPath}`,
    "",
    "## Severity Rubric",
    "",
    ...Object.entries(report.severityRubric).map(([severity, meaning]) => `- \`${severity}\`: ${meaning}`),
    "",
    "## Critical Delivery Failures",
    "",
  ];

  if (report.criticalDeliveryFailures.length === 0) {
    lines.push("- No failed `post_alert` rows were found.", "");
  } else {
    for (const failure of report.criticalDeliveryFailures) {
      lines.push(
        `### ${failure.symbol} - ${failure.title ?? "untitled"}`,
        "",
        `- severity: \`${failure.severity}\``,
        `- time: ${formatTimestamp(failure.timestamp)}`,
        `- kind: ${failure.messageKind ?? "unknown"} / ${failure.eventType ?? "unknown"}`,
        `- trader-critical: ${failure.traderCritical ? "yes" : "no"}`,
        `- retry proven: ${failure.retryProven ? "yes" : "no"}`,
        `- equivalent later post: ${failure.equivalentLaterPost ? `yes (${formatTimestamp(failure.equivalentLaterTimestamp ?? 0)} ${failure.equivalentLaterTitle ?? ""})` : "no"}`,
        `- error: ${failure.error ?? "n/a"}`,
        `- excerpt: ${failure.excerpt}`,
        "",
      );
    }
  }

  lines.push("## Role-Flip Candidates", "");
  if (report.roleFlipCandidates.length === 0) {
    lines.push("- No role-flip candidates were found.", "");
  } else {
    for (const item of report.roleFlipCandidates.slice(0, 25)) {
      lines.push(
        `### ${item.symbol} - ${item.scenario}`,
        "",
        `- severity: \`${item.severity}\``,
        `- time: ${formatTimestamp(item.timestamp)}`,
        `- level: ${typeof item.level === "number" ? formatLevelForMarkdown(item.level) : "unknown"}`,
        `- explained clearly: ${item.explainedClearly ? "yes" : "no"}`,
        `- title: ${item.title ?? "untitled"}`,
        `- evidence: ${item.evidence}`,
        "",
      );
    }
  }

  lines.push("## Cluster-Cross Candidates", "");
  if (report.clusterCrossCandidates.length === 0) {
    lines.push("- No cluster-cross candidates were found.", "");
  } else {
    for (const item of report.clusterCrossCandidates.slice(0, 25)) {
      lines.push(
        `### ${item.symbol} - ${item.side}`,
        "",
        `- severity: \`${item.severity}\``,
        `- window: ${formatTimestamp(item.firstTimestamp)} -> ${formatTimestamp(item.lastTimestamp)}`,
        `- levels: ${item.levels.map(formatLevelForMarkdown).join(", ")}`,
        `- post count: ${item.postCount}`,
        `- likely over-explained: ${item.likelyOverExplained ? "yes" : "no"}`,
        `- prefer one cluster story: ${item.preferClusterStory ? "yes" : "no"}`,
        "- titles:",
        ...item.titles.map((title) => `  - ${title}`),
        "",
      );
    }
  }

  lines.push("## Trader-Language Evidence Appendix", "");
  appendLanguageExamples(lines, "Good Trader-Facing Examples", report.traderLanguageEvidence.goodExamples);
  appendLanguageExamples(lines, "Bad Historical/System-Shaped Examples", report.traderLanguageEvidence.badHistoricalExamples);
  appendLanguageExamples(lines, "Borderline Advisory Examples", report.traderLanguageEvidence.borderlineAdviceExamples);

  return lines.join("\n");
}

function appendLanguageExamples(
  lines: string[],
  title: string,
  examples: TraderLanguageEvidenceExample[],
): void {
  lines.push(`### ${title}`, "");
  if (examples.length === 0) {
    lines.push("- None found.", "");
    return;
  }

  for (const example of examples) {
    lines.push(
      `- ${example.symbol} at ${formatTimestamp(example.timestamp)} (${example.severity}, ${example.reason}): ${example.title ?? "untitled"} - ${example.excerpt}`,
    );
  }
  lines.push("");
}

function formatTimestamp(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return "unknown";
  }
  return new Date(timestamp).toISOString();
}

function formatLevelForMarkdown(level: number): string {
  return level >= 1 ? level.toFixed(2) : level.toFixed(4);
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
  evidenceJsonPath: string;
  evidenceMarkdownPath: string;
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
    evidenceJsonPath: join(sessionDirectory, "trading-day-evidence-report.json"),
    evidenceMarkdownPath: join(sessionDirectory, "trading-day-evidence-report.md"),
  };
}
