import {
  generateStartupOperatorPreflight,
  writeStartupOperatorPreflightArtifacts,
} from "../lib/review/startup-operator-preflight.js";

const result = generateStartupOperatorPreflight();
const outputDir = writeStartupOperatorPreflightArtifacts(result);
const missingCount = result.artifacts.filter((artifact) => artifact.status === "missing").length;

console.log(`Startup operator preflight wrote ${outputDir}`);
console.log(`Latest long-run session: ${result.latestLongRunSessionName ?? "none"}`);
console.log(`Missing expected artifacts: ${missingCount}`);
