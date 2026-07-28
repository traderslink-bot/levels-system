import "dotenv/config";

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import type { DiscordPermissionPreflightResult } from "../lib/alerts/discord-rest-thread-gateway.js";
import { DiscordRestThreadGateway } from "../lib/alerts/discord-rest-thread-gateway.js";

function renderMarkdown(result: DiscordPermissionPreflightResult): string {
  const lines = [
    "# Discord Permission Preflight",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Overall: ${result.ok ? "pass" : "fail"}`,
    `Post test: ${result.destructive ? "enabled" : "disabled"}`,
    "",
    "| Check | Status | Detail |",
    "| --- | --- | --- |",
  ];

  for (const check of result.checks) {
    lines.push(`| ${check.name} | ${check.status} | ${check.detail.replace(/\|/g, "\\|")} |`);
  }

  lines.push(
    "",
    "Non-destructive mode verifies read/recovery permissions only.",
    "Use `npm run discord:preflight -- --post-test` to send and delete a temporary channel message.",
  );
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const postTest = process.argv.includes("--post-test");
  const botToken = process.env.DISCORD_BOT_TOKEN;
  const watchlistChannelId = process.env.DISCORD_WATCHLIST_CHANNEL_ID;
  const guildId = process.env.DISCORD_GUILD_ID;

  if (!botToken || !watchlistChannelId) {
    throw new Error("DISCORD_BOT_TOKEN and DISCORD_WATCHLIST_CHANNEL_ID are required.");
  }

  const gateway = new DiscordRestThreadGateway({
    botToken,
    watchlistChannelId,
    guildId,
  });
  const result = await gateway.preflightPermissions({ postTest });
  const outputDir = resolve(process.cwd(), "artifacts", "discord-permission-preflight");
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, "discord-permission-preflight.json"), JSON.stringify(result, null, 2));
  writeFileSync(resolve(outputDir, "discord-permission-preflight.md"), renderMarkdown(result));

  console.log(`Discord permission preflight ${result.ok ? "passed" : "failed"}.`);
  console.log(`Artifacts: ${outputDir}`);
  if (!result.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
