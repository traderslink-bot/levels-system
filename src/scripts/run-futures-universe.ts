import {
  buildFuturesUniverse,
  fetchIceProductCodes,
  writeFuturesUniverseArtifacts,
} from "../lib/review/futures-universe.js";

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

const write = hasFlag("--write");
const skipIce = hasFlag("--skip-ice");
const masterJsonPath = argValue("--master") ?? "data/futures-universe/futures-current-universe.json";
const markdownPath = argValue("--doc") ?? "docs/futures-universe.md";
const artifactsRoot = argValue("--out-dir");

console.log(`[FuturesUniverse] fetching ICE product-code slate=${skipIce ? "skipped" : "enabled"}`);

const iceProducts = skipIce ? [] : await fetchIceProductCodes();
const universe = buildFuturesUniverse({ iceProducts });

console.log(
  [
    `[FuturesUniverse] roots=${universe.counts.totalRoots}`,
    `seed=${universe.counts.seedRoots}`,
    `iceRows=${universe.counts.iceRows}`,
    `iceFutures=${universe.counts.iceFutureRows}`,
    `uniqueIceSymbols=${universe.counts.uniqueIceSymbolCodes}`,
  ].join(" "),
);
console.log(
  `[FuturesUniverse] tiers ${Object.entries(universe.counts.byTier)
    .map(([tier, count]) => `${tier}=${count}`)
    .join(" ")}`,
);

if (!write) {
  console.log("[FuturesUniverse] preview only; pass --write to update data/docs/artifacts.");
  process.exit(0);
}

const result = await writeFuturesUniverseArtifacts({
  universe,
  masterJsonPath,
  markdownPath,
  artifactsRoot,
});

console.log(`[FuturesUniverse] wrote master=${result.masterJsonPath}`);
console.log(`[FuturesUniverse] wrote doc=${result.markdownPath}`);
console.log(`[FuturesUniverse] wrote artifact=${result.artifactJsonPath}`);
