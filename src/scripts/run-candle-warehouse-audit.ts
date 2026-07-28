import {
  buildCandleWarehouseAuditReport,
  writeCandleWarehouseAuditReport,
} from "../lib/review/candle-warehouse-audit.js";

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const root = process.argv.find((arg, index) => index > 1 && !arg.startsWith("--")) ?? "data/candles";
const outDir = argValue("--out-dir") ?? "artifacts/candle-warehouse-audit";

const report = await buildCandleWarehouseAuditReport(root);
const written = await writeCandleWarehouseAuditReport({ report, outDir });

console.log(`Candle warehouse audit wrote ${written.markdownPath}`);
console.log(`groups=${report.symbolTimeframeCount} rows=${report.totalRows} watch=${report.watchCount} broken=${report.brokenCount}`);
