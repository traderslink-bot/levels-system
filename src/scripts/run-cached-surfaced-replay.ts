// 2026-04-17 11:45 PM America/Toronto
// Run an offline old-vs-new surfaced validation pass from cached candle files.

import {
  runCachedSurfacedReplay,
  type CachedSurfacedReplayManualReviewItem,
} from "../lib/levels/level-cached-surfaced-replay.js";

function parseArgs(argv: string[]) {
  const symbols: string[] = [];
  let maxCasesPerSymbol: number | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (token === "--max-cases-per-symbol") {
      const rawValue = argv[index + 1];
      const parsed = Number.parseInt(rawValue ?? "", 10);
      if (Number.isInteger(parsed) && parsed > 0) {
        maxCasesPerSymbol = parsed;
      }
      index += 1;
      continue;
    }

    if (token.startsWith("--")) {
      continue;
    }

    symbols.push(token.trim().toUpperCase());
  }

  return {
    symbols,
    maxCasesPerSymbol,
  };
}

function formatManualReviewItem(item: CachedSurfacedReplayManualReviewItem): string {
  return `${item.caseId} | ${item.reason} | winner=${item.winner} | delta=${item.scoreDelta >= 0 ? "+" : ""}${item.scoreDelta.toFixed(2)}`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const report = await runCachedSurfacedReplay({
    symbols: args.symbols.length > 0 ? args.symbols : undefined,
    maxCasesPerSymbol: args.maxCasesPerSymbol,
  });

  console.log("CACHED SURFACED REPLAY");
  console.log("");
  console.log(`Cache directory: ${report.cacheDirectoryPath}`);
  console.log(`Symbols discovered: ${report.inventory.length}`);
  console.log(
    `Usable symbols: ${report.inventory.filter((entry) => entry.usableForReplay).length}`,
  );
  console.log(`Generated cases: ${report.cases.length}`);
  console.log(`Skipped items: ${report.skipped.length}`);
  console.log("");

  for (const result of report.results) {
    console.log(
      `${result.caseId} | ${result.symbol} | old=${result.oldSystem.metrics.validationScore.toFixed(2)} | new=${result.newSystem.metrics.validationScore.toFixed(2)} | winner=${result.winner} | delta=${result.scoreDelta >= 0 ? "+" : ""}${result.scoreDelta.toFixed(2)}`,
    );
  }

  console.log("");
  console.log("AGGREGATE SUMMARY");
  console.log(`total generated cases: ${report.summary.totalCases}`);
  console.log(`old wins: ${report.summary.oldWins}`);
  console.log(`new wins: ${report.summary.newWins}`);
  console.log(`mixed: ${report.summary.mixed}`);
  console.log(`inconclusive: ${report.summary.inconclusive}`);
  console.log(`average validation score old: ${report.summary.averageValidationScoreOld.toFixed(2)}`);
  console.log(`average validation score new: ${report.summary.averageValidationScoreNew.toFixed(2)}`);
  console.log(
    `cases where new improved first interaction alignment: ${report.summary.casesWhereNewImprovedFirstInteractionAlignment}`,
  );
  console.log(
    `cases where new reduced clutter: ${report.summary.casesWhereNewReducedClutter}`,
  );
  console.log(`migration readiness: ${report.summary.migrationReadiness}`);
  console.log("");
  console.log(
    `symbols where old still wins: ${report.oldWinSymbols.length > 0 ? report.oldWinSymbols.join(", ") : "none"}`,
  );
  console.log(
    `broken-handling signal symbols: ${report.brokenHandlingSymbols.length > 0 ? report.brokenHandlingSymbols.join(", ") : "none"}`,
  );
  console.log(
    `first-interaction alignment problem symbols: ${report.firstInteractionAlignmentProblemSymbols.length > 0 ? report.firstInteractionAlignmentProblemSymbols.join(", ") : "none"}`,
  );
  console.log(
    `manual review queue: ${report.manualReviewQueue.length > 0 ? report.manualReviewQueue.slice(0, 12).map(formatManualReviewItem).join(" || ") : "none"}`,
  );

  if (report.skipped.length > 0) {
    const byReason = new Map<string, number>();
    for (const item of report.skipped) {
      byReason.set(item.reason, (byReason.get(item.reason) ?? 0) + 1);
    }
    console.log("");
    console.log("TOP SKIP REASONS");
    for (const [reason, count] of [...byReason.entries()].sort((left, right) => right[1] - left[1]).slice(0, 8)) {
      console.log(`${reason}: ${count}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
