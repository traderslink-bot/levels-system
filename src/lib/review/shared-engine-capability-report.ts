import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type SharedEngineCapabilityReport = {
  generatedAt: string;
  packageName: string;
  publicSubpath: string | null;
  publicExportCount: number;
  publicExports: string[];
  scripts: string[];
  dataDependencies: string[];
  implementedCapabilities: string[];
  partialCapabilities: string[];
  plannedCapabilities: string[];
};

function extractExportNames(indexSource: string): string[] {
  const names = new Set<string>();
  for (const match of indexSource.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
    const name = match[1]!;
    if (/^(export|from|type|as|const|let|var)$/.test(name)) {
      continue;
    }
    if (/^[A-Z][A-Za-z0-9_]*$/.test(name) || /^(build|calculate|fetch|aggregate|derive|is|plan|format|unknown|DEFAULT|SHARED)/.test(name)) {
      names.add(name);
    }
  }
  return [...names].sort();
}

export async function buildSharedEngineCapabilityReport(params: {
  packageJsonPath?: string;
  publicIndexPath?: string;
} = {}): Promise<SharedEngineCapabilityReport> {
  const packageJsonPath = params.packageJsonPath ?? "package.json";
  const publicIndexPath = params.publicIndexPath ?? "src/lib/support-resistance/index.ts";
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
    name?: string;
    exports?: Record<string, unknown>;
    scripts?: Record<string, string>;
  };
  const publicIndex = await readFile(publicIndexPath, "utf8");
  const scripts = Object.keys(packageJson.scripts ?? {}).sort();

  return {
    generatedAt: new Date().toISOString(),
    packageName: packageJson.name ?? "unknown",
    publicSubpath: packageJson.exports?.["./support-resistance-engine"] ? "./support-resistance-engine" : null,
    publicExportCount: extractExportNames(publicIndex).length,
    publicExports: extractExportNames(publicIndex),
    scripts,
    dataDependencies: [
      "provider historical candles: daily, 4h, 5m, optional 1m",
      "durable warehouse path: data/candles by default",
      "saved Discord/session artifacts for replay calibration",
      "optional stock context for float/market-cap/profile risk",
    ],
    implementedCapabilities: [
      "support/resistance level engine",
      "symbol-level candle-owned context",
      "trade-analysis candle package",
      "durable JSONL candle warehouse foundation",
      "session VWAP and EMA utilities",
      "5m candle market structure",
      "stable market-structure runtime bridge",
      "volume/activity tracker",
      "quiet trader-context bundle",
      "saved-session candle intelligence calibration report",
      "candle import-readiness report for warehouse backfill planning",
      "dry-run-first candle warehouse backfill executor with throttling controls",
      "default warehouse-backed shared context builders",
      "warehouse-backed 5m volume/activity context",
      "coded JSONL-to-database warehouse storage threshold policy",
      "Discord replay/audit tooling",
    ],
    partialCapabilities: [
      "warehouse-backed shared builders need broader live/provider validation",
      "market-structure calibration is implemented but still needs more real saved-data review",
      "volume/activity is implemented but quiet by default until live proof is stronger",
      "reference levels have first saved-session calibration but need broader all-symbol review",
      "gap structure has first saved-session calibration but should stay diagnostic until trader value is proven",
    ],
    plannedCapabilities: [
      "provider comparison before switching away from IBKR",
      "anchored VWAP after anchor policy is defined",
      "operator-only candle pattern recognition",
      "SQLite/database warehouse if JSONL becomes too slow",
    ],
  };
}

export function formatSharedEngineCapabilityReport(report: SharedEngineCapabilityReport): string {
  const lines = [
    "# Shared Engine Capability Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Package: ${report.packageName}`,
    `Public subpath: ${report.publicSubpath ?? "missing"}`,
    `Public export count: ${report.publicExportCount}`,
    "",
    "## Implemented",
    ...report.implementedCapabilities.map((item) => `- ${item}`),
    "",
    "## Partial / Needs Calibration",
    ...report.partialCapabilities.map((item) => `- ${item}`),
    "",
    "## Planned",
    ...report.plannedCapabilities.map((item) => `- ${item}`),
    "",
    "## Data Dependencies",
    ...report.dataDependencies.map((item) => `- ${item}`),
    "",
    "## Scripts",
    ...report.scripts.map((script) => `- ${script}`),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

export async function writeSharedEngineCapabilityReport(params: {
  report: SharedEngineCapabilityReport;
  outDir?: string;
}): Promise<{ jsonPath: string; markdownPath: string }> {
  const outDir = params.outDir ?? "artifacts/shared-engine-capabilities";
  await mkdir(outDir, { recursive: true });
  const jsonPath = join(outDir, "shared-engine-capabilities.json");
  const markdownPath = join(outDir, "shared-engine-capabilities.md");
  await writeFile(jsonPath, `${JSON.stringify(params.report, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, formatSharedEngineCapabilityReport(params.report), "utf8");
  return { jsonPath, markdownPath };
}
