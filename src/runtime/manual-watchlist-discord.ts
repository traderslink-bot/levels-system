import { DiscordAlertRouter } from "../lib/alerts/alert-router.js";
import { DiscordAuditedThreadGateway } from "../lib/alerts/discord-audited-thread-gateway.js";
import { DiscordRestThreadGateway } from "../lib/alerts/discord-rest-thread-gateway.js";
import { LocalDiscordThreadGateway } from "../lib/alerts/local-discord-thread-gateway.js";
import { createLiveWatchlistPublisherFromEnv } from "../lib/live-watchlist/live-watchlist-publisher.js";
import {
  LIVE_WATCHLIST_PULLBACK_READ_ENABLED_ENV,
  resolveLiveWatchlistPullbackReadEnabled,
} from "../lib/live-watchlist/pullback-read.js";
import {
  LIVE_WATCHLIST_TRADE_SETUP_READ_MODE_ENV,
  resolveLiveWatchlistTradeSetupReadMode,
} from "../lib/live-watchlist/trade-setup-read.js";
import { WebsitePublishingDiscordGateway } from "../lib/live-watchlist/website-publishing-discord-gateway.js";

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

function resolveDiscordAuditFilePath(): string | undefined {
  const sessionDirectory = process.env.LEVEL_MANUAL_SESSION_DIRECTORY?.trim();
  if (!sessionDirectory) {
    return undefined;
  }

  return `${sessionDirectory}\\discord-delivery-audit.jsonl`;
}

function createAuditedGateway(
  gatewayMode: "real" | "local",
  gateway: DiscordRestThreadGateway | LocalDiscordThreadGateway,
) {
  return new DiscordAuditedThreadGateway(gateway, {
    gatewayMode,
    auditFilePath: resolveDiscordAuditFilePath(),
    auditListener: (entry) => {
      console.log(JSON.stringify(entry));
    },
  });
}

export function createDiscordAlertRouter(options: {
  isLiveTraderReadCardVisible?: () => boolean;
} = {}): DiscordAlertRouter {
  const env = readDiscordRuntimeEnv();
  const hasAnyDiscordConfig = Boolean(env.botToken || env.watchlistChannelId || env.guildId);
  const shouldUseRealDiscord = Boolean(env.botToken && env.watchlistChannelId);
  const liveWatchlistPublisher = createLiveWatchlistPublisherFromEnv();
  const pullbackReadEnabled = resolveLiveWatchlistPullbackReadEnabled();
  const tradeSetupReadMode = resolveLiveWatchlistTradeSetupReadMode();

  if (liveWatchlistPublisher) {
    console.log("[ManualWatchlistRuntime] Live website watchlist publisher enabled.");
    if (pullbackReadEnabled) {
      console.log(
        `[ManualWatchlistRuntime] Watchlist pullback read enabled. Set ${LIVE_WATCHLIST_PULLBACK_READ_ENABLED_ENV}=0 to disable it.`,
      );
    }
    console.log(
      tradeSetupReadMode === "active"
        ? `[ManualWatchlistRuntime] Trade Setup Trader Read active via ${LIVE_WATCHLIST_TRADE_SETUP_READ_MODE_ENV}=active.`
        : tradeSetupReadMode === "observe"
          ? `[ManualWatchlistRuntime] Trade Setup Trader Read is in observe mode; analysis is recorded without replacing live copy. Set ${LIVE_WATCHLIST_TRADE_SETUP_READ_MODE_ENV}=active only after review.`
          : `[ManualWatchlistRuntime] Trade Setup Trader Read disabled via ${LIVE_WATCHLIST_TRADE_SETUP_READ_MODE_ENV}=off.`,
    );
  } else {
    console.log(
      "[ManualWatchlistRuntime] Live website watchlist publisher disabled. Set TRADERSLINK_WATCHLIST_INGEST_URL and TRADERSLINK_WATCHLIST_PUBLISHER_TOKEN to enable it.",
    );
  }

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
      new WebsitePublishingDiscordGateway(
        createAuditedGateway(
          "real",
          new DiscordRestThreadGateway({
            botToken: env.botToken!,
            watchlistChannelId: env.watchlistChannelId!,
            guildId: env.guildId ?? undefined,
          }),
        ),
        liveWatchlistPublisher,
        undefined,
        {
          pullbackReadEnabled,
          tradeSetupReadMode,
          isLiveTraderReadCardVisible: options.isLiveTraderReadCardVisible,
        },
      ),
    );
  }

  logDiscordRuntimeDiagnostics(env, "fallback");
  console.log(
    "[ManualWatchlistRuntime] Set DISCORD_BOT_TOKEN and DISCORD_WATCHLIST_CHANNEL_ID in .env for real Discord posting.",
  );
  return new DiscordAlertRouter(
    new WebsitePublishingDiscordGateway(
      createAuditedGateway("local", new LocalDiscordThreadGateway()),
      liveWatchlistPublisher,
      undefined,
      {
        pullbackReadEnabled,
        tradeSetupReadMode,
        isLiveTraderReadCardVisible: options.isLiveTraderReadCardVisible,
      },
    ),
  );
}
