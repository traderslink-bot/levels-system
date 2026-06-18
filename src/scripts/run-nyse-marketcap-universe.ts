import {
  buildNyseMarketCapUniverse,
  buildNyseUniverseSnapshot,
  fetchNyseScreenerRows,
  writeNyseUniverseArtifacts,
} from "../lib/review/nyse-marketcap-universe.js";

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

const write = hasFlag("--write");
const masterJsonPath = argValue("--master") ?? "data/nyse-universe/nyse-current-universe.json";
const artifactsRoot = argValue("--out-dir");
const docMarketCapMarkdownPath = argValue("--doc") ?? "docs/nyse-marketcap-universe.md";

const rows = await fetchNyseScreenerRows();
const snapshot = buildNyseUniverseSnapshot(rows);
const universe = buildNyseMarketCapUniverse(snapshot);
const totalClean = Object.values(universe.bucketCounts).reduce((total, count) => total + count, 0);

console.log(`[NyseUniverse] fetched=${snapshot.rawCount} clean=${snapshot.cleanCount} bucketed=${totalClean}`);
console.log(
  `[NyseUniverse] buckets ${Object.entries(universe.bucketCounts)
    .map(([bucket, count]) => `${bucket}=${count}`)
    .join(" ")}`,
);

if (!write) {
  console.log("[NyseUniverse] preview only; pass --write to update data/docs/artifacts.");
  process.exit(0);
}

const result = await writeNyseUniverseArtifacts({
  snapshot,
  rawRows: rows,
  masterJsonPath,
  artifactsRoot,
  docMarketCapMarkdownPath,
});

console.log(`[NyseUniverse] wrote master=${result.masterJsonPath}`);
console.log(`[NyseUniverse] wrote marketcap=${result.marketCapMarkdownPath}`);
console.log(`[NyseUniverse] wrote doc=${result.docMarketCapMarkdownPath}`);
