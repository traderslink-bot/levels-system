import { DiscordAlertRouter } from "../lib/alerts/alert-router.js";
import { DiscordRestThreadGateway } from "../lib/alerts/discord-rest-thread-gateway.js";
import { LocalDiscordThreadGateway } from "../lib/alerts/local-discord-thread-gateway.js";

type DiscordRuntimeEnv = {
  botToken: string | null;
  watchlistChannelId: string | null;
  guildId: string | null;
};

function readDiscordRuntimeEnv(): DiscordRuntimeEnv {
  return {
    botToken: process.env.DISCORD_BOT_TOKEN?.trim() || null,
    watchlistChannelId: process.env.DISCORD_WATCHLIST_CHANNEL_ID?.trim() || null,
    guildId: process.env.DISCORD_GUILD_ID?.trim() || null,
  };
}

function logDiscordRuntimeDiagnostics(env: DiscordRuntimeEnv, mode: "real" | "fallback"): void {
  console.log("[ManualWatchlistRuntime] Discord env diagnostics:");
  console.log(`- DISCORD_BOT_TOKEN: ${env.botToken ? "present" : "missing"}`);
  console.log(
    `- DISCORD_WATCHLIST_CHANNEL_ID: ${env.watchlistChannelId ? "present" : "missing"}`,
  );
  console.log(`- DISCORD_GUILD_ID: ${env.guildId ? "present" : "missing"}`);
  console.log(
    `- Discord gateway mode: ${
      mode === "real" ? "real Discord REST gateway" : "local persisted gateway fallback"
    }`,
  );
}

export function createDiscordAlertRouter(): DiscordAlertRouter {
  const env = readDiscordRuntimeEnv();
  const hasAnyDiscordConfig = Boolean(env.botToken || env.watchlistChannelId || env.guildId);
  const shouldUseRealDiscord = Boolean(env.botToken && env.watchlistChannelId);

  if (hasAnyDiscordConfig && !shouldUseRealDiscord) {
    throw new Error(
      "Incomplete Discord runtime configuration. Set both DISCORD_BOT_TOKEN and DISCORD_WATCHLIST_CHANNEL_ID to use the real Discord gateway, or remove the partial Discord env values to use the local fallback.",
    );
  }

  if (shouldUseRealDiscord) {
    logDiscordRuntimeDiagnostics(env, "real");
    if (!env.guildId) {
      console.log(
        "[ManualWatchlistRuntime] DISCORD_GUILD_ID is missing. Real Discord posting will still work, but exact-name thread recovery will be limited.",
      );
    }

    return new DiscordAlertRouter(
      new DiscordRestThreadGateway({
        botToken: env.botToken!,
        watchlistChannelId: env.watchlistChannelId!,
        guildId: env.guildId ?? undefined,
      }),
    );
  }

  logDiscordRuntimeDiagnostics(env, "fallback");
  console.log(
    "[ManualWatchlistRuntime] Set DISCORD_BOT_TOKEN and DISCORD_WATCHLIST_CHANNEL_ID in .env for real Discord posting.",
  );
  return new DiscordAlertRouter(new LocalDiscordThreadGateway());
}
