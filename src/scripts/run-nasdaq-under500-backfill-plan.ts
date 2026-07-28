import type { CandleFetchTimeframe } from "../lib/market-data/candle-types.js";
import {
  buildNasdaqUnder500BackfillPlan,
  readNasdaqUniverseSnapshot,
  writeNasdaqBackfillPlan,
} from "../lib/review/nasdaq-marketcap-universe.js";

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function parseTimeframes(raw: string | undefined): CandleFetchTimeframe[] {
  if (!raw) {
    return ["daily", "4h", "5m"];
  }
  const allowed = new Set<CandleFetchTimeframe>(["daily", "4h", "5m", "1m"]);
  const parsed = raw
    .split(",")
    .map((item) => item.trim())
    .filter((item): item is CandleFetchTimeframe => allowed.has(item as CandleFetchTimeframe));
  return parsed.length > 0 ? parsed : ["daily", "4h", "5m"];
}

const universePath = argValue("--universe") ?? "data/nasdaq-universe/nasdaq-current-universe.json";
const warehouseDirectoryPath = argValue("--warehouse") ?? "data/candles";
const outDir = argValue("--out-dir");
const timeframes = parseTimeframes(argValue("--timeframes"));

const snapshot = await readNasdaqUniverseSnapshot(universePath);
const plan = buildNasdaqUnder500BackfillPlan({
  snapshot,
  sourceUniversePath: universePath,
  warehouseDirectoryPath,
  timeframes,
});
const result = await writeNasdaqBackfillPlan({ plan, outDir });
const totalMissing = plan.stages.reduce((total, stage) => total + stage.missingSymbols.length, 0);

console.log(`[NasdaqUnder500BackfillPlan] stages=${plan.stages.length} missing=${totalMissing} timeframes=${timeframes.join(",")}`);
console.log(`[NasdaqUnder500BackfillPlan] wrote ${result.markdownPath}`);
