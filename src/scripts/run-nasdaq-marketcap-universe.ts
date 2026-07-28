import {
  buildNasdaqUniverseSnapshot,
  buildUnder500Universe,
  fetchNasdaqScreenerRows,
  writeNasdaqUniverseArtifacts,
} from "../lib/review/nasdaq-marketcap-universe.js";

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

const write = hasFlag("--write");
const checklistPath = argValue("--checklist") ?? "docs/nasdaq-under-100m-checklist-with-previous-tickers.md";
const masterJsonPath = argValue("--master") ?? "data/nasdaq-universe/nasdaq-current-universe.json";
const artifactsRoot = argValue("--out-dir");
const docUnder500MarkdownPath = argValue("--doc") ?? "docs/nasdaq-under-500m-marketcap-universe.md";

const rows = await fetchNasdaqScreenerRows();
const snapshot = buildNasdaqUniverseSnapshot(rows);
const under500 = buildUnder500Universe(snapshot);
const totalUnder500 = Object.values(under500.bucketCounts).reduce((total, count) => total + count, 0);

console.log(`[NasdaqUniverse] fetched=${snapshot.rawCount} clean=${snapshot.cleanCount} under500=${totalUnder500}`);
console.log(
  `[NasdaqUniverse] buckets ${Object.entries(under500.bucketCounts)
    .map(([bucket, count]) => `${bucket}=${count}`)
    .join(" ")}`,
);

if (!write) {
  console.log("[NasdaqUniverse] preview only; pass --write to update data/docs/artifacts.");
  process.exit(0);
}

const result = await writeNasdaqUniverseArtifacts({
  snapshot,
  rawRows: rows,
  checklistPath,
  masterJsonPath,
  artifactsRoot,
  docUnder500MarkdownPath,
});

console.log(`[NasdaqUniverse] wrote master=${result.masterJsonPath}`);
console.log(`[NasdaqUniverse] wrote under500=${result.under500MarkdownPath}`);
console.log(`[NasdaqUniverse] wrote doc=${result.docUnder500MarkdownPath}`);
console.log(`[NasdaqUniverse] wrote diff=${result.diffMarkdownPath}`);
