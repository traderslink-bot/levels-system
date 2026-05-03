import {
  buildSharedEngineCapabilityReport,
  writeSharedEngineCapabilityReport,
} from "../lib/review/shared-engine-capability-report.js";

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const outDir = argValue("--out-dir") ?? "artifacts/shared-engine-capabilities";
const report = await buildSharedEngineCapabilityReport();
const written = await writeSharedEngineCapabilityReport({ report, outDir });

console.log(`Shared engine capability report wrote ${written.markdownPath}`);
console.log(`exports=${report.publicExportCount} scripts=${report.scripts.length}`);
