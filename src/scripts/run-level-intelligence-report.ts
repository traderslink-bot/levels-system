import {
  parseLevelIntelligenceReportRunnerArgs,
  runLevelIntelligenceReportRunner,
} from "../lib/levels/level-intelligence-report-runner.js";

function main(): void {
  const options = parseLevelIntelligenceReportRunnerArgs(process.argv.slice(2));
  const result = runLevelIntelligenceReportRunner(options);

  process.stdout.write(result.content);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
}
