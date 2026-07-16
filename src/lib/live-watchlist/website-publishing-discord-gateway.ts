import type {
  AlertPayload,
  DiscordThread,
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

const DEFAULT_PRE_DISCORD_PUBLISH_GRACE_MS = 1_500;

export class WebsitePublishingDiscordGateway implements DiscordThreadGateway {
  constructor(
    private readonly gateway: DiscordThreadGateway,
    private readonly publisher: LiveWatchlistPublisher | null,
    private readonly preDiscordPublishGraceMs = DEFAULT_PRE_DISCORD_PUBLISH_GRACE_MS,
  ) {}

  async getThreadById(threadId: string): Promise<DiscordThread | null> {
    return this.gateway.getThreadById(threadId);
  }

  async findThreadByName(name: string): Promise<DiscordThread | null> {
    return this.gateway.findThreadByName(name);
  }

  async createThread(name: string): Promise<DiscordThread> {
    return this.gateway.createThread(name);
  }

  async sendMessage(threadId: string, payload: AlertPayload): Promise<void> {
    void threadId;
    await this.publishBeforeDiscord(buildLiveWatchlistAlertPatch(payload));
  }

  async sendLevelSnapshot(threadId: string, payload: LevelSnapshotPayload): Promise<void> {
    void threadId;
    await this.publishBeforeDiscord(buildLiveWatchlistSnapshotPatch(payload));
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

    let timeout: ReturnType<typeof setTimeout> | null = null;
    const publishPromise = this.publisher.publish(patch).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[WebsitePublishingDiscordGateway] Live watchlist publish failed: ${message}`);
    });

    await Promise.race([
      publishPromise,
      new Promise<void>((resolve) => {
        timeout = setTimeout(() => {
          console.warn(
            `[WebsitePublishingDiscordGateway] Live watchlist publish did not finish before Discord grace window for ${patch.symbol}.`,
          );
          resolve();
        }, this.preDiscordPublishGraceMs);
      }),
    ]);
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
