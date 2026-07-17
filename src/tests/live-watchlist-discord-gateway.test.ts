import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { DiscordThreadGateway } from "../lib/alerts/alert-router.js";
import type {
  AlertPayload,
  DiscordThread,
  LevelExtensionPayload,
  LevelSnapshotPayload,
} from "../lib/alerts/alert-types.js";
import { WebsitePublishingDiscordGateway } from "../lib/live-watchlist/website-publishing-discord-gateway.js";
import type {
  LiveWatchlistCardPatch,
  LiveWatchlistPublisher,
} from "../lib/live-watchlist/live-watchlist-types.js";

class RecordingDiscordGateway implements DiscordThreadGateway {
  constructor(private readonly events: string[]) {}

  async getThreadById(threadId: string): Promise<DiscordThread | null> {
    return { id: threadId, name: threadId };
  }

  async findThreadByName(name: string): Promise<DiscordThread | null> {
    return { id: name, name };
  }

  async createThread(name: string): Promise<DiscordThread> {
    return { id: name, name };
  }

  async sendMessage(_threadId: string, _payload: AlertPayload): Promise<void> {
    this.events.push("discord:message");
  }

  async sendLevelSnapshot(
    _threadId: string,
    _payload: LevelSnapshotPayload,
  ): Promise<void> {
    this.events.push("discord:snapshot");
  }

  async sendLevelExtension(
    _threadId: string,
    _payload: LevelExtensionPayload,
  ): Promise<void> {
    this.events.push("discord:extension");
  }
}

describe("website publishing Discord gateway", () => {
  it("publishes trader reads to the website without forwarding the content to Discord", async () => {
    const events: string[] = [];
    const publisher: LiveWatchlistPublisher = {
      async publish(patch: LiveWatchlistCardPatch): Promise<void> {
        events.push(`website:${patch.symbol}`);
      },
    };
    const gateway = new WebsitePublishingDiscordGateway(
      new RecordingDiscordGateway(events),
      publisher,
    );

    await gateway.sendMessage("thread-1", {
      title: "ABCD trader read",
      body: "Holding above support.",
      symbol: "ABCD",
      timestamp: 1000,
      metadata: { messageKind: "intelligent_alert" },
    });

    assert.deepEqual(events, ["website:ABCD"]);
  });

  it("does not block activation when website publishing exceeds the grace window", async () => {
    const events: string[] = [];
    const publisher: LiveWatchlistPublisher = {
      async publish(_patch: LiveWatchlistCardPatch): Promise<void> {
        events.push("website-started");
        await new Promise((resolve) => setTimeout(resolve, 50));
        events.push("website-finished");
      },
    };
    const gateway = new WebsitePublishingDiscordGateway(
      new RecordingDiscordGateway(events),
      publisher,
      5,
    );

    await gateway.sendMessage("thread-1", {
      title: "ABCD trader read",
      body: "Holding above support.",
      symbol: "ABCD",
      timestamp: 1000,
      metadata: { messageKind: "intelligent_alert" },
    });

    assert.deepEqual(events, ["website-started"]);
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.deepEqual(events, ["website-started", "website-finished"]);
  });

  it("publishes snapshots and extensions to the website without forwarding the content to Discord", async () => {
    const events: string[] = [];
    const publisher: LiveWatchlistPublisher = {
      async publish(patch: LiveWatchlistCardPatch): Promise<void> {
        events.push(`website:${patch.symbol}`);
      },
    };
    const gateway = new WebsitePublishingDiscordGateway(
      new RecordingDiscordGateway(events),
      publisher,
    );

    await gateway.sendLevelSnapshot("thread-1", {
      symbol: "ABCD",
      currentPrice: 1.23,
      supportZones: [{ representativePrice: 1.1 }],
      resistanceZones: [{ representativePrice: 1.4 }],
      timestamp: 1000,
    });
    await gateway.sendLevelExtension("thread-1", {
      symbol: "ABCD",
      side: "resistance",
      levels: [1.4],
      timestamp: 2000,
    });

    assert.deepEqual(events, ["website:ABCD", "website:ABCD"]);
  });
});
