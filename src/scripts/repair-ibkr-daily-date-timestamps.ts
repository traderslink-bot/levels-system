import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

type WarehouseRow = {
  timestamp: number;
  symbol?: string;
  provider?: string;
  timeframe?: string;
  [key: string]: unknown;
};

const root = process.argv[2] ?? "data/candles/ibkr";
const minReasonableTimestamp = Date.parse("2000-01-01T00:00:00Z");
const maxReasonableTimestamp = Date.now() + 366 * 24 * 60 * 60 * 1000;

function isValidDailyDate(rawDate: string): boolean {
  if (!/^\d{8}$/.test(rawDate)) {
    return false;
  }
  const year = Number(rawDate.slice(0, 4));
  const month = Number(rawDate.slice(4, 6));
  const day = Number(rawDate.slice(6, 8));
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

function normalizeDailyTimestamp(timestamp: number): number | null {
  const raw = String(timestamp);
  const firstEight = raw.match(/^(\d{8})\d*$/)?.[1];
  if (!firstEight || !isValidDailyDate(firstEight)) {
    return null;
  }
  const year = Number(firstEight.slice(0, 4));
  const month = Number(firstEight.slice(4, 6));
  const day = Number(firstEight.slice(6, 8));
  return new Date(year, month - 1, day).getTime();
}

function dateKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function uniqueSortedRows(rows: WarehouseRow[]): WarehouseRow[] {
  const byTimestamp = new Map<number, WarehouseRow>();
  for (const row of rows) {
    byTimestamp.set(row.timestamp, row);
  }
  return [...byTimestamp.values()].sort((left, right) => left.timestamp - right.timestamp);
}

async function readRows(path: string): Promise<WarehouseRow[]> {
  if (!existsSync(path)) {
    return [];
  }
  const text = await readFile(path, "utf8");
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as WarehouseRow);
}

async function writeRows(path: string, rows: WarehouseRow[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${uniqueSortedRows(rows).map((row) => JSON.stringify(row)).join("\n")}\n`);
}

let scannedRows = 0;
let repairedRows = 0;
let unrecoverableRows = 0;
const repairedSymbols = new Set<string>();

if (!existsSync(root)) {
  throw new Error(`IBKR candle warehouse root not found: ${root}`);
}

for (const symbol of await readdir(root)) {
  const dailyPath = join(root, symbol, "daily");
  if (!existsSync(dailyPath)) {
    continue;
  }

  for (const file of await readdir(dailyPath)) {
    if (!file.endsWith(".jsonl")) {
      continue;
    }

    const sourcePath = join(dailyPath, file);
    const rows = await readRows(sourcePath);
    const remainingRows: WarehouseRow[] = [];
    const repairsByTargetPath = new Map<string, WarehouseRow[]>();
    let sourceChanged = false;

    for (const row of rows) {
      scannedRows += 1;
      const suspicious =
        !Number.isFinite(row.timestamp) ||
        row.timestamp < minReasonableTimestamp ||
        row.timestamp > maxReasonableTimestamp;

      if (!suspicious) {
        remainingRows.push(row);
        continue;
      }

      const normalized = normalizeDailyTimestamp(row.timestamp);
      if (normalized === null) {
        unrecoverableRows += 1;
        remainingRows.push(row);
        continue;
      }

      const repaired = { ...row, timestamp: normalized };
      const targetPath = join(dailyPath, `${dateKey(normalized)}.jsonl`);
      repairsByTargetPath.set(targetPath, [
        ...(repairsByTargetPath.get(targetPath) ?? []),
        repaired,
      ]);
      repairedRows += 1;
      repairedSymbols.add(symbol);
      sourceChanged = true;
    }

    for (const [targetPath, repairedRowsForTarget] of repairsByTargetPath) {
      const existing = targetPath === sourcePath ? remainingRows : await readRows(targetPath);
      await writeRows(targetPath, [...existing, ...repairedRowsForTarget]);
    }

    if (sourceChanged && !repairsByTargetPath.has(sourcePath)) {
      if (remainingRows.length > 0) {
        await writeRows(sourcePath, remainingRows);
      } else {
        await rm(sourcePath);
      }
    }
  }
}

console.log(JSON.stringify({
  scannedRows,
  repairedRows,
  unrecoverableRows,
  repairedSymbols: [...repairedSymbols].sort(),
}, null, 2));
