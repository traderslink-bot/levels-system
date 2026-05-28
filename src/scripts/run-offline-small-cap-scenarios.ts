import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  renderOfflineSmallCapScenarioMarkdown,
  runOfflineSmallCapScenarios,
} from "../lib/review/offline-small-cap-scenario-simulator.js";

const outputDirectory = join(process.cwd(), "artifacts", "offline-scenarios");

await mkdir(outputDirectory, { recursive: true });

const results = await runOfflineSmallCapScenarios();
await writeFile(
  join(outputDirectory, "small-cap-scenario-simulation.json"),
  `${JSON.stringify(results, null, 2)}\n`,
  "utf8",
);
await writeFile(
  join(outputDirectory, "small-cap-scenario-simulation.md"),
  renderOfflineSmallCapScenarioMarkdown(results),
  "utf8",
);

console.log(`Offline small-cap scenario simulation wrote ${results.length} scenarios to ${outputDirectory}`);
