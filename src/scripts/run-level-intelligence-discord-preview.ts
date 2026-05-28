import {
  parseLevelIntelligenceDiscordPreviewRunnerArgs,
  runLevelIntelligenceDiscordPreviewRunner,
} from "../lib/alerts/level-intelligence-discord-preview-runner.js";

async function main(): Promise<void> {
  const options = parseLevelIntelligenceDiscordPreviewRunnerArgs(process.argv.slice(2), {
    LEVEL_INTELLIGENCE_TEST_DISCORD_WEBHOOK_URL: process.env.LEVEL_INTELLIGENCE_TEST_DISCORD_WEBHOOK_URL,
  });
  const result = await runLevelIntelligenceDiscordPreviewRunner(options);

  process.stdout.write(result.content);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
