import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

// Explicit generation-logic scope, not a fingerprint of the whole application,
// dependencies or private data. Resolve beside the loaded source/dist module.
const MODULES = [
  "traderslink-ai-read-code-identity",
  "traderslink-ai-read-service",
  "traderslink-ai-read-price-action",
  "traderslink-ai-read-observations",
  "traderslink-ai-read-core-evidence",
  "traderslink-ai-read-section-validation",
  "traderslink-ai-read-breakout-selection",
  "traderslink-ai-read-checkpoint-dependencies",
] as const;

export function captureAnalysisCodeIdentity(options: {
  moduleUrl: string;
  deployedCommit?: string;
  readModule?: (url: URL) => Uint8Array;
}) {
  const extension = new URL(options.moduleUrl).pathname.endsWith(".ts") ? ".ts" : ".js";
  const read = options.readModule ?? ((url: URL) => readFileSync(url));
  const modules = MODULES.map(name => {
    try {
      const bytes = read(new URL(`${name}${extension}`, options.moduleUrl));
      return { name, sha256: createHash("sha256").update(bytes).digest("hex") };
    } catch { return { name, sha256: null }; }
  });
  const complete = modules.every(module => module.sha256 !== null);
  const commit = options.deployedCommit?.trim();
  return {
    version: 1,
    scope: "analysis-module-files-at-service-load",
    format: extension === ".ts" ? "typescript-source" : "compiled-javascript",
    deployedCommit: commit && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(commit) ? commit.toLowerCase() : null,
    complete,
    sha256: complete ? createHash("sha256").update(JSON.stringify(modules)).digest("hex") : null,
    modules,
  };
}
