// 2026-04-18 09:20 AM America/Toronto
// Review compare-mode runtime logs and summarize recurring old-vs-new surfaced-output disagreements.

import { promises as fs } from "node:fs";
import path from "node:path";
import {
  parseRuntimeCompareLogsFromText,
  reviewRuntimeCompareEvents,
  type RuntimeCompareReviewReport,
} from "../lib/levels/level-runtime-compare-review.js";

type CliOptions = {
  inputPath: string;
  maxReviewItems: number;
  outputJsonPath?: string;
};

function parseCliArgs(argv: string[]): CliOptions {
  let inputPath: string | undefined;
  let maxReviewItems = 8;
  let outputJsonPath: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (token === "--max-review") {
      const value = Number(argv[index + 1] ?? "8");
      if (Number.isFinite(value) && value > 0) {
        maxReviewItems = Math.floor(value);
      }
      index += 1;
      continue;
    }
    if (token === "--out-json") {
      outputJsonPath = argv[index + 1];
      index += 1;
      continue;
    }
    if (!inputPath) {
      inputPath = token;
    }
  }

  if (!inputPath) {
    throw new Error(
      "Usage: npx tsx src/scripts/run-level-runtime-compare-review.ts <file-or-directory> [--max-review 8] [--out-json report.json]",
    );
  }

  return {
    inputPath,
    maxReviewItems,
    outputJsonPath,
  };
}

async function collectFiles(targetPath: string): Promise<string[]> {
  const stats = await fs.stat(targetPath);
  if (stats.isFile()) {
    return [targetPath];
  }

  const files: string[] = [];
  const entries = await fs.readdir(targetPath, { withFileTypes: true });
  for (const entry of entries) {
    const resolvedPath = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(resolvedPath)));
      continue;
    }

    if (entry.isFile()) {
      files.push(resolvedPath);
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

function formatTopCategory(report: RuntimeCompareReviewReport): string {
  return report.aggregateSummary.topDifferenceCategories
    .map((entry) => `${entry.category}=${entry.count}`)
    .join(", ");
}

function printReport(report: RuntimeCompareReviewReport): void {
  console.log("LEVEL RUNTIME COMPARE REVIEW");
  console.log("");
  console.log(`total compare events: ${report.aggregateSummary.totalCompareEvents}`);
  console.log(`valid events: ${report.aggregateSummary.validEvents}`);
  console.log(`malformed or skipped compare events: ${report.aggregateSummary.malformedEvents}`);
  console.log(`support changed: ${report.aggregateSummary.supportChangedCount}`);
  console.log(`resistance changed: ${report.aggregateSummary.resistanceChangedCount}`);
  console.log(`both changed: ${report.aggregateSummary.bothChangedCount}`);
  console.log(`ladder count changed: ${report.aggregateSummary.ladderCountChangedCount}`);
  console.log(`broken-level differences: ${report.aggregateSummary.brokenLevelDifferenceCount}`);
  console.log(
    `approximation-related differences: ${report.aggregateSummary.approximationRelatedDifferenceCount}`,
  );

  console.log("");
  console.log(`top difference categories: ${formatTopCategory(report) || "none"}`);

  console.log("");
  console.log("TOP SYMBOLS NEEDING REVIEW");
  if (report.symbolSummaries.length === 0) {
    console.log("none");
  } else {
    for (const summary of report.symbolSummaries.slice(0, 8)) {
      console.log(
        `${summary.symbol} | events=${summary.totalEvents} | supportChanges=${summary.supportChangeCount} | resistanceChanges=${summary.resistanceChangeCount} | broken=${summary.brokenLevelDifferenceCount} | approximations=${summary.approximationIssueCount} | flags=${summary.flags.join("; ") || "none"}`,
      );
      if (summary.topRepresentativeDifference) {
        console.log(`difference: ${summary.topRepresentativeDifference}`);
      }
    }
  }

  console.log("");
  console.log("MANUAL REVIEW QUEUE");
  if (report.manualReviewQueue.length === 0) {
    console.log("none");
  } else {
    for (const item of report.manualReviewQueue) {
      console.log(
        `${item.symbol} | ${item.reason} | count=${item.count} | frequency=${item.frequencyPct.toFixed(2)}% | assessment=${item.assessment}`,
      );
      if (item.representativeDifference) {
        console.log(`difference: ${item.representativeDifference}`);
      }
    }
  }

  console.log("");
  console.log(`recommendation: ${report.aggregateSummary.recommendation}`);
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  const files = await collectFiles(options.inputPath);
  const allEvents = [];
  const allIssues = [];

  for (const file of files) {
    const text = await fs.readFile(file, "utf8");
    const parsed = parseRuntimeCompareLogsFromText(text, file);
    allEvents.push(...parsed.validEvents);
    allIssues.push(...parsed.parseIssues);
  }

  const report = reviewRuntimeCompareEvents(allEvents, allIssues, {
    maxManualReviewItems: options.maxReviewItems,
  });

  printReport(report);

  if (options.outputJsonPath) {
    await fs.writeFile(options.outputJsonPath, JSON.stringify(report, null, 2));
    console.log("");
    console.log(`wrote JSON summary to ${options.outputJsonPath}`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
