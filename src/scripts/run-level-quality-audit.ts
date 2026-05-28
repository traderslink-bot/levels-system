import {
  parseLevelQualityAuditReviewRunnerArgs,
  runLevelQualityAuditReviewRunner,
} from "../lib/levels/level-quality-audit-review-runner.js";

function main(): void {
  const options = parseLevelQualityAuditReviewRunnerArgs(process.argv.slice(2));
  const result = runLevelQualityAuditReviewRunner(options);

  process.stdout.write(result.content);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
}
