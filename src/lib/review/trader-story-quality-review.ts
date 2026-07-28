import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import {
  buildDailyTraderReviewReport,
  writeDailyTraderReview,
  type DailyTraderReviewReport,
  type DailyTraderReviewSymbol,
} from "./daily-trader-review.js";
import {
  writeLadderGapLevelAudit,
  type LadderGapLevelAuditReport,
  type LadderGapLevelFinding,
} from "./ladder-gap-level-audit.js";

export type TraderStoryQualityReviewOptions = {
  inputPath: string;
  outputDirectory?: string;
  warehouseDirectoryPath?: string;
  provider?: string;
  minGapPct?: number;
  maxGapDistancePct?: number;
  maxFindings?: number;
};

export type TraderStoryQualityReviewReport = {
  generatedAt: string;
  inputPath: string;
  auditPath: string;
  outputDirectory: string;
  verdict: "clean" | "watch" | "needs_review";
  totals: {
    symbols: number;
    posts: number;
    overBudgetSymbols: number;
    watchBudgetSymbols: number;
    storyRiskSymbols: number;
    ladderFindings: number;
    majorLadderFindings: number;
  };
  storyRisks: TraderStoryQualitySymbolRisk[];
  ladderRisks: LadderGapLevelFinding[];
  cleanSymbols: string[];
};

export type TraderStoryQualitySymbolRisk = {
  symbol: string;
  severity: "major" | "watch";
  score: number;
  summary: string;
  evidence: string[];
};

function latestLongRunSession(root = join("artifacts", "long-run")): string | null {
  if (!existsSync(root)) {
    return null;
  }

  const sessions = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name, "discord-delivery-audit.jsonl"))
    .filter(existsSync)
    .sort();

  return sessions.at(-1) ? dirname(sessions.at(-1)!) : null;
}

function resolveAuditPath(inputPath: string): string {
  const normalizedInput = inputPath === "latest"
    ? latestLongRunSession() ?? inputPath
    : inputPath;
  return normalizedInput.endsWith(".jsonl")
    ? normalizedInput
    : join(normalizedInput, "discord-delivery-audit.jsonl");
}

function resolveOutputDirectory(inputPath: string, outputDirectory?: string): string {
  if (outputDirectory) {
    return outputDirectory;
  }

  if (inputPath === "latest") {
    const latest = latestLongRunSession();
    return latest ?? join("artifacts", "trader-story-quality-review");
  }

  return inputPath.endsWith(".jsonl")
    ? join("artifacts", "trader-story-quality-review", basename(dirname(inputPath)))
    : inputPath;
}

function storyRiskForSymbol(symbol: DailyTraderReviewSymbol): TraderStoryQualitySymbolRisk | null {
  let score = 0;
  const evidence: string[] = [];

  if (symbol.budgetStatus === "over_budget") {
    score += 30;
    evidence.push(`post budget over target: ${symbol.postCount}/${symbol.expectedPostBudgetMax}`);
  } else if (symbol.budgetStatus === "watch") {
    score += 12;
    evidence.push(`post budget near limit: ${symbol.postCount}/${symbol.expectedPostBudgetMax}`);
  }

  if (symbol.noLevelCount > 0) {
    score += symbol.noLevelCount * 10;
    evidence.push(`${symbol.noLevelCount} post(s) had missing next-level context`);
  }

  if (symbol.sameMinuteBurstCount > 0) {
    const likelyStartupBurst =
      symbol.postCount <= 3 &&
      symbol.usefulPostCount >= 1 &&
      symbol.noLevelCount === 0 &&
      symbol.latePostCount === 0;
    if (!likelyStartupBurst) {
      score += symbol.sameMinuteBurstCount * 8;
      evidence.push(`${symbol.sameMinuteBurstCount} one-minute burst bucket(s)`);
    }
  }

  if (symbol.latePostCount > 0) {
    score += symbol.latePostCount * 6;
    evidence.push(`${symbol.latePostCount} late delivery post(s)`);
  }

  if (symbol.weakProbeCount > Math.max(2, symbol.usefulPostCount)) {
    score += 14;
    evidence.push(`weak/testing posts outweighed useful posts: ${symbol.weakProbeCount}/${symbol.usefulPostCount}`);
  }

  if (
    symbol.noPostEvidenceCoverage === "missing" &&
    !(symbol.postCount <= 2 && symbol.usefulPostCount >= 1 && symbol.noLevelCount === 0)
  ) {
    score += 10;
    evidence.push("no why-posted evidence on trader-facing posts");
  }

  if (score <= 0) {
    return null;
  }

  return {
    symbol: symbol.symbol,
    severity: score >= 30 ? "major" : "watch",
    score,
    summary: `${symbol.symbol} needs story-quality review: ${evidence[0] ?? "operator review"}.`,
    evidence: [
      ...evidence,
      `story style: ${symbol.expectedBudgetStyle}; latest visible story: ${symbol.lastTitle ?? "n/a"}`,
    ],
  };
}

function deriveVerdict(report: TraderStoryQualityReviewReport): TraderStoryQualityReviewReport["verdict"] {
  if (report.totals.majorLadderFindings > 0 || report.storyRisks.some((risk) => risk.severity === "major")) {
    return "needs_review";
  }
  if (report.totals.ladderFindings > 0 || report.storyRisks.length > 0) {
    return "watch";
  }
  return "clean";
}

function renderMarkdown(report: TraderStoryQualityReviewReport): string {
  const lines: string[] = [];
  lines.push("# Trader Story Quality Review");
  lines.push("");
  lines.push("Operator-only report that combines level ladder quality with Discord story quality.");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Verdict: ${report.verdict}`);
  lines.push(`Source audit: ${report.auditPath}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Symbols: ${report.totals.symbols}`);
  lines.push(`- Posts: ${report.totals.posts}`);
  lines.push(`- Story risk symbols: ${report.totals.storyRiskSymbols}`);
  lines.push(`- Over-budget symbols: ${report.totals.overBudgetSymbols}`);
  lines.push(`- Watch-budget symbols: ${report.totals.watchBudgetSymbols}`);
  lines.push(`- Ladder findings: ${report.totals.ladderFindings}`);
  lines.push(`- Major ladder findings: ${report.totals.majorLadderFindings}`);
  lines.push("");
  lines.push("## Operator Action Queue");
  lines.push("");
  if (report.storyRisks.length === 0 && report.ladderRisks.length === 0) {
    lines.push("- No immediate story or ladder risks found.");
  }
  for (const risk of report.storyRisks.slice(0, 20)) {
    lines.push(`- ${risk.severity.toUpperCase()} ${risk.symbol}: ${risk.summary}`);
    for (const evidence of risk.evidence.slice(0, 3)) {
      lines.push(`  - ${evidence}`);
    }
  }
  for (const finding of report.ladderRisks.slice(0, 20)) {
    lines.push(`- ${finding.severity.toUpperCase()} ${finding.symbol}: ${finding.summary}`);
    for (const evidence of finding.evidence.slice(0, 2)) {
      lines.push(`  - ${evidence}`);
    }
  }
  lines.push("");
  lines.push("## Clean Symbols");
  lines.push("");
  lines.push(report.cleanSymbols.length > 0 ? `- ${report.cleanSymbols.join(", ")}` : "- None yet.");
  lines.push("");
  lines.push("## Related Files");
  lines.push("");
  lines.push("- `daily-trader-review.md`: per-symbol Discord story budget and examples.");
  lines.push("- `ladder-gap-level-audit.md`: candle-backed hidden ladder gap candidates.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function writeTraderStoryQualityReview(
  options: TraderStoryQualityReviewOptions,
): TraderStoryQualityReviewReport {
  const inputPath = options.inputPath || "latest";
  const auditPath = resolveAuditPath(inputPath);
  if (!existsSync(auditPath)) {
    throw new Error(`Discord delivery audit was not found: ${auditPath}`);
  }

  const outputDirectory = resolveOutputDirectory(inputPath, options.outputDirectory);
  mkdirSync(outputDirectory, { recursive: true });

  const dailyReview: DailyTraderReviewReport = writeDailyTraderReview({
    auditPath,
    jsonPath: join(outputDirectory, "daily-trader-review.json"),
    markdownPath: join(outputDirectory, "daily-trader-review.md"),
    htmlPath: join(outputDirectory, "daily-trader-review.html"),
  });

  const ladderReview: LadderGapLevelAuditReport = writeLadderGapLevelAudit({
    inputPath: auditPath,
    outputDirectory,
    warehouseDirectoryPath: options.warehouseDirectoryPath ?? "data/candles",
    provider: options.provider ?? "ibkr",
    minGapPct: options.minGapPct ?? 8,
    maxGapDistancePct: options.maxGapDistancePct ?? 45,
    maxFindings: options.maxFindings ?? 60,
  });

  const storyRisks = dailyReview.symbols
    .map(storyRiskForSymbol)
    .filter((risk): risk is TraderStoryQualitySymbolRisk => risk !== null)
    .sort((left, right) => right.score - left.score || left.symbol.localeCompare(right.symbol));
  const ladderRisks = ladderReview.findings;
  const riskSymbols = new Set([
    ...storyRisks.map((risk) => risk.symbol),
    ...ladderRisks.map((risk) => risk.symbol),
  ]);
  const cleanSymbols = dailyReview.symbols
    .filter((symbol) => !riskSymbols.has(symbol.symbol) && symbol.budgetStatus === "within_budget")
    .map((symbol) => symbol.symbol)
    .sort();

  const report: TraderStoryQualityReviewReport = {
    generatedAt: new Date().toISOString(),
    inputPath,
    auditPath: resolve(auditPath),
    outputDirectory: resolve(outputDirectory),
    verdict: "clean",
    totals: {
      symbols: dailyReview.totals.symbols,
      posts: dailyReview.totals.posts,
      overBudgetSymbols: dailyReview.totals.overBudgetSymbols,
      watchBudgetSymbols: dailyReview.symbols.filter((symbol) => symbol.budgetStatus === "watch").length,
      storyRiskSymbols: storyRisks.length,
      ladderFindings: ladderRisks.length,
      majorLadderFindings: ladderRisks.filter((finding) => finding.severity === "major").length,
    },
    storyRisks,
    ladderRisks,
    cleanSymbols,
  };
  report.verdict = deriveVerdict(report);

  writeFileSync(
    join(outputDirectory, "trader-story-quality-review.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  writeFileSync(join(outputDirectory, "trader-story-quality-review.md"), renderMarkdown(report));

  return report;
}
