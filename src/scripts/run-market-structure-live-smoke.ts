import { join, resolve } from "node:path";

import {
  buildMarketStructureLiveSmokeReport,
  writeMarketStructureLiveSmokeReport,
} from "../lib/review/market-structure-live-smoke.js";

function readFlag(name: string): string | undefined {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`))?.split("=")[1];
  if (inline !== undefined) {
    return inline;
  }
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const input = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : undefined;
const outputDirectory = resolve(readFlag("--output") ?? join("artifacts", "market-structure-live-smoke"));
const report = buildMarketStructureLiveSmokeReport({ input });

writeMarketStructureLiveSmokeReport({
  report,
  jsonPath: join(outputDirectory, "market-structure-live-smoke.json"),
  markdownPath: join(outputDirectory, "market-structure-live-smoke.md"),
});

console.log(`Market structure live smoke ${report.ok ? "passed" : "failed"}.`);
console.log(`Session: ${report.session}`);
console.log(`Rows/post rows: ${report.totals.rowsScanned}/${report.totals.postedRows}`);
console.log(`Visible 5m formal story keys: ${report.totals.visibleFormal5mStoryKeys}`);
console.log(`Visible 4h/daily formal story keys: ${report.totals.visibleHigherTimeframeFormalStoryKeys}`);
console.log(`Visible 5m stable story keys: ${report.totals.visibleStable5mStoryKeys}`);
console.log(`Artifacts: ${outputDirectory}`);

if (!report.ok) {
  process.exitCode = 1;
}
