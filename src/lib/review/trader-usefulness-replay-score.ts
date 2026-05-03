import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

type DiscordAuditRow = {
  operation?: string;
  status?: string;
  timestamp?: number;
  symbol?: string;
  title?: string;
  body?: string;
  bodyPreview?: string;
  messageKind?: string;
  eventType?: string;
  triggerPrice?: number;
  targetPrice?: number;
  whyPosted?: string;
  noLevelReason?: string;
  supportCount?: number;
  resistanceCount?: number;
  snapshotAudit?: {
    supportCount?: number;
    resistanceCount?: number;
    missingForwardLevels?: string[];
    ladderConfidence?: string;
  };
  rangeBoxLabel?: string;
  acceptanceLabel?: string;
  behaviorBudgetLabel?: string;
  failedLevelOutcome?: string;
  levelImportanceLabel?: string;
  primaryTradeAreaLocked?: boolean;
  primaryTradeAreaEscapeConfidence?: string;
  practicalStructureMaterialChange?: boolean;
  stableMarketStructureMaterialChange?: boolean;
  volumeActivityShown?: boolean;
  volumeActivityReliability?: string;
  deliveryLagMs?: number;
  error?: string;
};

export type PostUsefulnessLabel =
  | "useful_change"
  | "early_but_relevant"
  | "repeat_noise"
  | "late"
  | "missing_context";

export type TickerPersonalityLabel =
  | "clean_runner"
  | "low_volume_chop"
  | "wide_spread_messy"
  | "steady_trend"
  | "halt_prone_microfloat"
  | "mixed_unknown";

export type LadderConfidenceLabel = "strong" | "usable" | "thin" | "degraded" | "unknown";

export type MaterialChangeLabel = "material_change" | "same_story" | "unclear";

export type TraderUsefulnessReplayPost = {
  symbol: string;
  timestamp: number;
  title?: string;
  messageKind?: string;
  eventType?: string;
  triggerPrice?: number;
  usefulness: PostUsefulnessLabel;
  materialChange: MaterialChangeLabel;
  reasons: string[];
  excerpt: string;
};

export type TraderUsefulnessSymbolScore = {
  symbol: string;
  replayScore: number;
  personality: TickerPersonalityLabel;
  ladderConfidence: LadderConfidenceLabel;
  postCount: number;
  usefulChangeCount: number;
  repeatNoiseCount: number;
  lateCount: number;
  missingContextCount: number;
  materialChangeCount: number;
  sameStoryCount: number;
  reasons: string[];
  evidence: TraderUsefulnessReplayPost[];
};

export type TraderUsefulnessReplayReport = {
  generatedAt: string;
  sourceAuditPath: string;
  totals: {
    symbols: number;
    posts: number;
    usefulChange: number;
    earlyButRelevant: number;
    repeatNoise: number;
    late: number;
    missingContext: number;
    materialChange: number;
    sameStory: number;
  };
  symbols: TraderUsefulnessSymbolScore[];
};

function readRows(path: string): DiscordAuditRow[] {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as DiscordAuditRow];
      } catch {
        return [];
      }
    });
}

function isPosted(row: DiscordAuditRow): boolean {
  return row.operation === "post_alert" && (row.status === "posted" || row.status === "success");
}

function symbolOf(row: DiscordAuditRow): string {
  return row.symbol?.trim().toUpperCase() || "UNKNOWN";
}

function rowText(row: DiscordAuditRow): string {
  return [row.title, row.body, row.bodyPreview].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function excerpt(row: DiscordAuditRow, maxLength = 280): string {
  const text = rowText(row);
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
}

function levelReference(row: DiscordAuditRow): number | null {
  const candidate = row.triggerPrice ?? row.targetPrice;
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : null;
}

function rowStoryKey(row: DiscordAuditRow): string {
  const level = levelReference(row);
  const levelPart = level === null ? "unknown" : String(Math.round(level * 20) / 20);
  return [
    row.messageKind ?? "unknown",
    row.eventType ?? "unknown",
    row.rangeBoxLabel ?? "",
    row.acceptanceLabel ?? "",
    row.failedLevelOutcome ?? "",
    row.primaryTradeAreaLocked ? "locked" : "",
    levelPart,
  ].join("|");
}

function priceMovePct(current: DiscordAuditRow, previous: DiscordAuditRow): number | null {
  const nextLevel = levelReference(current);
  const prevLevel = levelReference(previous);
  if (nextLevel === null || prevLevel === null || Math.abs(prevLevel) <= 0.0001) {
    return null;
  }
  return Math.abs((nextLevel - prevLevel) / prevLevel) * 100;
}

function materialChangeLabel(row: DiscordAuditRow, previous: DiscordAuditRow | undefined): MaterialChangeLabel {
  if (!previous) {
    return "material_change";
  }
  if (row.practicalStructureMaterialChange || row.stableMarketStructureMaterialChange) {
    return "material_change";
  }
  if (
    row.acceptanceLabel === "accepted" ||
    row.primaryTradeAreaEscapeConfidence === "accepted" ||
    row.levelImportanceLabel === "major_decision"
  ) {
    return "material_change";
  }
  if (rowStoryKey(row) === rowStoryKey(previous)) {
    return "same_story";
  }
  const movePct = priceMovePct(row, previous);
  if (
    previous.eventType === row.eventType &&
    previous.messageKind === row.messageKind &&
    movePct !== null &&
    movePct < 1.25 &&
    !row.practicalStructureMaterialChange &&
    !row.stableMarketStructureMaterialChange
  ) {
    return "same_story";
  }
  return "unclear";
}

function classifyUsefulness(row: DiscordAuditRow, previous: DiscordAuditRow | undefined): TraderUsefulnessReplayPost {
  const reasons: string[] = [];
  const materialChange = materialChangeLabel(row, previous);
  let usefulness: PostUsefulnessLabel = "early_but_relevant";

  if (row.noLevelReason || /none currently surfaced|no higher resistance|no lower support|surface[d]? ladder/i.test(rowText(row))) {
    usefulness = "missing_context";
    reasons.push("post had missing or uncertain next-level context");
  }

  if (typeof row.deliveryLagMs === "number" && row.deliveryLagMs > 90_000) {
    usefulness = "late";
    reasons.push(`delivery lag was ${Math.round(row.deliveryLagMs / 1000)}s`);
  }

  if (materialChange === "same_story") {
    usefulness = "repeat_noise";
    reasons.push("same story as the previous saved post without enough material change");
  }

  if (
    usefulness !== "missing_context" &&
    (
      materialChange === "material_change" ||
      row.acceptanceLabel === "accepted" ||
      row.levelImportanceLabel === "major_decision" ||
      row.volumeActivityShown === true
    )
  ) {
    usefulness = "useful_change";
    reasons.push("material level, acceptance, structure, or activity change reached Discord");
  }

  if (
    usefulness === "useful_change" &&
    (row.failedLevelOutcome === "probe_only" || row.acceptanceLabel === "weak_probe") &&
    row.levelImportanceLabel !== "major_decision"
  ) {
    usefulness = "early_but_relevant";
    reasons.push("early probe reached Discord; useful only if it changed the trader story");
  }

  if (reasons.length === 0) {
    reasons.push("post added fresh context but did not prove a full material change");
  }

  return {
    symbol: symbolOf(row),
    timestamp: row.timestamp ?? 0,
    title: row.title,
    messageKind: row.messageKind,
    eventType: row.eventType,
    triggerPrice: row.triggerPrice,
    usefulness,
    materialChange,
    reasons,
    excerpt: excerpt(row),
  };
}

function countLabels(posts: TraderUsefulnessReplayPost[], label: PostUsefulnessLabel): number {
  return posts.filter((post) => post.usefulness === label).length;
}

function countMaterial(posts: TraderUsefulnessReplayPost[], label: MaterialChangeLabel): number {
  return posts.filter((post) => post.materialChange === label).length;
}

function deriveLadderConfidence(rows: DiscordAuditRow[]): LadderConfidenceLabel {
  const snapshotRows = rows.filter((row) => row.messageKind === "snapshot" || /support and resistance|level/i.test(row.title ?? ""));
  const candidates = snapshotRows.length > 0 ? snapshotRows : rows;
  if (candidates.some((row) => row.noLevelReason || /none currently surfaced/i.test(rowText(row)))) {
    return "degraded";
  }
  const best = candidates.reduce(
    (acc, row) => {
      const support = row.snapshotAudit?.supportCount ?? row.supportCount ?? 0;
      const resistance = row.snapshotAudit?.resistanceCount ?? row.resistanceCount ?? 0;
      return {
        support: Math.max(acc.support, support),
        resistance: Math.max(acc.resistance, resistance),
      };
    },
    { support: 0, resistance: 0 },
  );
  if (best.support >= 5 && best.resistance >= 5) {
    return "strong";
  }
  if (best.support >= 3 && best.resistance >= 3) {
    return "usable";
  }
  if (best.support > 0 || best.resistance > 0) {
    return "thin";
  }
  return "unknown";
}

function derivePersonality(rows: DiscordAuditRow[], posts: TraderUsefulnessReplayPost[]): TickerPersonalityLabel {
  const postCount = posts.length;
  const repeatNoise = countLabels(posts, "repeat_noise");
  const accepted = rows.filter((row) => row.acceptanceLabel === "accepted").length;
  const major = rows.filter((row) => row.levelImportanceLabel === "major_decision").length;
  const boring = rows.filter((row) => row.behaviorBudgetLabel === "boring_range" || row.rangeBoxLabel === "active").length;
  const weakProbe = rows.filter((row) => row.acceptanceLabel === "weak_probe" || row.failedLevelOutcome === "probe_only").length;
  const wideMessy = rows.filter((row) => row.noLevelReason || row.volumeActivityReliability === "unreliable").length;

  if (postCount >= 20 && repeatNoise >= 6 && boring + weakProbe >= 6) {
    return "low_volume_chop";
  }
  if (wideMessy >= 3) {
    return "wide_spread_messy";
  }
  if (accepted >= 3 && major >= 2 && repeatNoise <= Math.max(2, Math.floor(postCount * 0.2))) {
    return "clean_runner";
  }
  if (postCount >= 12 && accepted >= 2) {
    return "steady_trend";
  }
  if (postCount >= 20 && major >= 5) {
    return "halt_prone_microfloat";
  }
  return "mixed_unknown";
}

function scoreSymbol(posts: TraderUsefulnessReplayPost[], ladderConfidence: LadderConfidenceLabel): number {
  let score = 100;
  score -= countLabels(posts, "repeat_noise") * 7;
  score -= countLabels(posts, "missing_context") * 10;
  score -= countLabels(posts, "late") * 6;
  if (posts.length > 30) {
    score -= 18;
  } else if (posts.length > 18) {
    score -= 9;
  }
  if (ladderConfidence === "degraded") {
    score -= 16;
  } else if (ladderConfidence === "thin") {
    score -= 8;
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

function symbolReasons(posts: TraderUsefulnessReplayPost[], ladderConfidence: LadderConfidenceLabel): string[] {
  const reasons: string[] = [];
  const repeatNoise = countLabels(posts, "repeat_noise");
  const missing = countLabels(posts, "missing_context");
  const late = countLabels(posts, "late");
  if (posts.length > 30) {
    reasons.push(`very high post count (${posts.length})`);
  } else if (posts.length > 18) {
    reasons.push(`elevated post count (${posts.length})`);
  }
  if (repeatNoise > 0) {
    reasons.push(`${repeatNoise} same-story posts looked like noise`);
  }
  if (missing > 0) {
    reasons.push(`${missing} posts had missing next-level context`);
  }
  if (late > 0) {
    reasons.push(`${late} posts were late enough to review`);
  }
  if (ladderConfidence === "degraded" || ladderConfidence === "thin") {
    reasons.push(`ladder confidence was ${ladderConfidence}`);
  }
  if (reasons.length === 0) {
    reasons.push("saved posts looked useful enough for replay review");
  }
  return reasons;
}

export function buildTraderUsefulnessReplayReport(auditPath: string): TraderUsefulnessReplayReport {
  const rows = readRows(auditPath).filter((row) => row.symbol);
  const bySymbol = new Map<string, DiscordAuditRow[]>();
  for (const row of rows) {
    const symbol = symbolOf(row);
    bySymbol.set(symbol, [...(bySymbol.get(symbol) ?? []), row]);
  }

  const symbols = [...bySymbol.entries()].map(([symbol, symbolRows]) => {
    const postedRows = symbolRows
      .filter(isPosted)
      .sort((left, right) => (left.timestamp ?? 0) - (right.timestamp ?? 0));
    const posts = postedRows.map((row, index) => classifyUsefulness(row, postedRows[index - 1]));
    const ladderConfidence = deriveLadderConfidence(symbolRows);
    const replayScore = scoreSymbol(posts, ladderConfidence);
    const repeatNoiseCount = countLabels(posts, "repeat_noise");
    const missingContextCount = countLabels(posts, "missing_context");
    const lateCount = countLabels(posts, "late");
    const evidence = [
      ...posts.filter((post) => post.usefulness === "repeat_noise"),
      ...posts.filter((post) => post.usefulness === "missing_context"),
      ...posts.filter((post) => post.usefulness === "useful_change"),
      ...posts,
    ].slice(0, 8);
    return {
      symbol,
      replayScore,
      personality: derivePersonality(symbolRows, posts),
      ladderConfidence,
      postCount: posts.length,
      usefulChangeCount: countLabels(posts, "useful_change"),
      repeatNoiseCount,
      lateCount,
      missingContextCount,
      materialChangeCount: countMaterial(posts, "material_change"),
      sameStoryCount: countMaterial(posts, "same_story"),
      reasons: symbolReasons(posts, ladderConfidence),
      evidence,
    };
  }).sort((left, right) =>
    left.replayScore - right.replayScore ||
    right.postCount - left.postCount ||
    left.symbol.localeCompare(right.symbol),
  );

  return {
    generatedAt: new Date().toISOString(),
    sourceAuditPath: auditPath,
    totals: {
      symbols: symbols.length,
      posts: symbols.reduce((sum, symbol) => sum + symbol.postCount, 0),
      usefulChange: symbols.reduce((sum, symbol) => sum + symbol.usefulChangeCount, 0),
      earlyButRelevant: symbols.reduce((sum, symbol) => sum + Math.max(0, symbol.postCount - symbol.usefulChangeCount - symbol.repeatNoiseCount - symbol.lateCount - symbol.missingContextCount), 0),
      repeatNoise: symbols.reduce((sum, symbol) => sum + symbol.repeatNoiseCount, 0),
      late: symbols.reduce((sum, symbol) => sum + symbol.lateCount, 0),
      missingContext: symbols.reduce((sum, symbol) => sum + symbol.missingContextCount, 0),
      materialChange: symbols.reduce((sum, symbol) => sum + symbol.materialChangeCount, 0),
      sameStory: symbols.reduce((sum, symbol) => sum + symbol.sameStoryCount, 0),
    },
    symbols,
  };
}

export function formatTraderUsefulnessReplayMarkdown(report: TraderUsefulnessReplayReport): string {
  const lines = [
    "# Trader Usefulness Replay Score",
    "",
    "This is an operator-only replay report. It asks whether saved Discord posts looked useful from a trader perspective, whether a ticker behaved like chop or a runner, and whether the ladder had enough forward context.",
    "",
    `Generated: ${report.generatedAt}`,
    `Source: ${report.sourceAuditPath}`,
    "",
    "## Totals",
    "",
    `- symbols: ${report.totals.symbols}`,
    `- posts: ${report.totals.posts}`,
    `- useful change: ${report.totals.usefulChange}`,
    `- early but relevant: ${report.totals.earlyButRelevant}`,
    `- repeat noise: ${report.totals.repeatNoise}`,
    `- late: ${report.totals.late}`,
    `- missing context: ${report.totals.missingContext}`,
    `- same story: ${report.totals.sameStory}`,
    "",
    "## Symbols",
    "",
  ];

  for (const symbol of report.symbols.slice(0, 60)) {
    lines.push(`### ${symbol.symbol} - score ${symbol.replayScore}`);
    lines.push(`- personality: ${symbol.personality}`);
    lines.push(`- ladder confidence: ${symbol.ladderConfidence}`);
    lines.push(`- posts: ${symbol.postCount}`);
    lines.push(`- useful / repeat / late / missing: ${symbol.usefulChangeCount} / ${symbol.repeatNoiseCount} / ${symbol.lateCount} / ${symbol.missingContextCount}`);
    lines.push(`- material / same-story: ${symbol.materialChangeCount} / ${symbol.sameStoryCount}`);
    lines.push(`- reasons: ${symbol.reasons.join("; ")}`);
    if (symbol.evidence.length > 0) {
      lines.push("- evidence:");
      for (const post of symbol.evidence.slice(0, 4)) {
        lines.push(`  - ${post.usefulness} | ${post.materialChange} | ${post.title ?? post.messageKind ?? "post"} | ${post.excerpt}`);
      }
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

export function writeTraderUsefulnessReplayReport(params: {
  auditPath: string;
  jsonPath: string;
  markdownPath: string;
}): TraderUsefulnessReplayReport {
  const report = buildTraderUsefulnessReplayReport(params.auditPath);
  mkdirSync(dirname(params.jsonPath), { recursive: true });
  mkdirSync(dirname(params.markdownPath), { recursive: true });
  writeFileSync(params.jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(params.markdownPath, formatTraderUsefulnessReplayMarkdown(report));
  return report;
}
