import { join, resolve } from "node:path";

import {
  writeStartupCacheReadinessReport,
} from "../lib/review/startup-cache-readiness-report.js";
import type { CandleProviderName } from "../lib/support-resistance/index.js";

function readFlag(name: string): string | undefined {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`))?.split("=")[1];
  if (inline !== undefined) {
    return inline;
  }
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const outDir = resolve(readFlag("--out-dir") ?? "artifacts/startup-cache-readiness");
const report = writeStartupCacheReadinessReport({
  watchlistStatePath: readFlag("--state") ?? "artifacts/manual-watchlist-state.json",
  cacheDirectoryPath: readFlag("--cache") ?? ".validation-cache/candles",
  provider: (readFlag("--provider") ?? "ibkr") as CandleProviderName,
  activeOnly: !process.argv.includes("--include-inactive"),
  jsonPath: join(outDir, "startup-cache-readiness.json"),
  markdownPath: join(outDir, "startup-cache-readiness.md"),
});

console.log(
  `Startup cache readiness: symbols=${report.totals.symbols}, ready=${report.totals.readyForFastRestore}, stale=${report.totals.usableButStale}, partial=${report.totals.partialCache}, blocked=${report.totals.blocked}.`,
);
