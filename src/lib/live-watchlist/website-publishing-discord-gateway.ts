import type {
  AlertPayload,
  DiscordThread,
  DiscordThreadRoutingResult,
  LevelExtensionPayload,
  LevelSnapshotPayload,
} from "../alerts/alert-types.js";
import type { DiscordThreadGateway } from "../alerts/alert-router.js";
import {
  buildLiveWatchlistAlertPatch,
  buildLiveWatchlistExtensionPatch,
  buildLiveWatchlistSnapshotPatch,
} from "./live-watchlist-publisher.js";
import type { LiveWatchlistPublisher } from "./live-watchlist-types.js";
import type { LiveWatchlistTradeSetupReadMode } from "./trade-setup-read.js";

const DEFAULT_PRE_DISCORD_PUBLISH_GRACE_MS = 1_500;
const WATCHLIST_ROUTE_PREFIX = "watchlist:";

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function buildWatchlistRoute(symbol: string): DiscordThread {
  const normalizedSymbol = normalizeSymbol(symbol);
  return {
    id: `${WATCHLIST_ROUTE_PREFIX}${normalizedSymbol}`,
    name: normalizedSymbol,
  };
}

function parseWatchlistRoute(routeId: string): DiscordThread | null {
  if (!routeId.startsWith(WATCHLIST_ROUTE_PREFIX)) {
    return null;
  }
  const symbol = normalizeSymbol(routeId.slice(WATCHLIST_ROUTE_PREFIX.length));
  return symbol ? buildWatchlistRoute(symbol) : null;
}

export class WebsitePublishingDiscordGateway implements DiscordThreadGateway {
  constructor(
    private readonly gateway: DiscordThreadGateway,
    private readonly publisher: LiveWatchlistPublisher | null,
    private readonly preDiscordPublishGraceMs = DEFAULT_PRE_DISCORD_PUBLISH_GRACE_MS,
    private readonly options: {
      pullbackReadEnabled?: boolean;
      tradeSetupReadMode?: LiveWatchlistTradeSetupReadMode;
      isLiveTraderReadCardVisible?: () => boolean;
    } = {},
  ) {}

  async ensureSymbolRoute(
    symbol: string,
    storedRouteId?: string | null,
  ): Promise<DiscordThreadRoutingResult> {
    const route = buildWatchlistRoute(symbol);
    if (storedRouteId) {
      return {
        threadId: route.id,
        reused: true,
        recovered: storedRouteId !== route.id,
        created: false,
      };
    }

    await this.gateway.announceTickerAdded?.(route.name);
    return {
      threadId: route.id,
      reused: false,
      recovered: false,
      created: true,
    };
  }

  async getThreadById(threadId: string): Promise<DiscordThread | null> {
    return parseWatchlistRoute(threadId);
  }

  async findThreadByName(name: string): Promise<DiscordThread | null> {
    void name;
    return null;
  }

  async createThread(name: string): Promise<DiscordThread> {
    await this.gateway.announceTickerAdded?.(name);
    return buildWatchlistRoute(name);
  }

  async sendMessage(threadId: string, payload: AlertPayload): Promise<void> {
    void threadId;
    await this.publishBeforeDiscord(buildLiveWatchlistAlertPatch(payload));
  }

  async sendLevelSnapshot(threadId: string, payload: LevelSnapshotPayload): Promise<void> {
    void threadId;
    await this.publishBeforeDiscord(buildLiveWatchlistSnapshotPatch(payload, {
      pullbackReadEnabled: this.options.pullbackReadEnabled,
      tradeSetupReadMode: this.options.tradeSetupReadMode,
    }));
  }

  async sendLevelLadder(threadId: string, payload: LevelSnapshotPayload): Promise<void> {
    void threadId;
    void payload;
  }

  async sendLevelExtension(threadId: string, payload: LevelExtensionPayload): Promise<void> {
    void threadId;
    await this.publishBeforeDiscord(buildLiveWatchlistExtensionPatch(payload));
  }

  private async publishBeforeDiscord(
    patch: ReturnType<typeof buildLiveWatchlistAlertPatch>,
  ): Promise<void> {
    if (!this.publisher || !patch) {
      return;
    }

    const websitePatch = this.options.isLiveTraderReadCardVisible?.() === false
      ? {
          ...patch,
          cards: {
            ...patch.cards,
            liveTraderRead: null,
          },
        }
      : patch;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const publishPromise = this.publisher.publish(websitePatch).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[WebsitePublishingDiscordGateway] Live watchlist publish failed: ${message}`);
    });

    await Promise.race([
      publishPromise,
      new Promise<void>((resolve) => {
        timeout = setTimeout(() => {
          resolve();
        }, this.preDiscordPublishGraceMs);
      }),
    ]);
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
