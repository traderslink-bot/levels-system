import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveManualWatchlistDurableDirectory } from "../monitoring/manual-watchlist-durable-storage.js";
import { appendDiscordMentions, currentDiscordAudience } from "./watchlist-discord-mentions.js";
import { buildWatchlistDiscordLinkMessage } from "./watchlist-discord-link-message.js";
import { DiscordConfirmedRejection } from "./discord-confirmed-rejection.js";
import { DiscordPreparationFailure } from "./discord-preparation-failure.js";

export const notesHash = (text: string) => createHash("sha256").update(text).digest("hex");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Receipt = { channelId: string; messageId: string };
type Publication = {
  id: string; symbol: string; cycleId: string; actor: string; text: string; textHash: string;
  group: string; publishedAt: number; website: boolean; notify: boolean;
  discord: "pending" | "sending" | "sent" | "retry" | "failed" | "uncertain" | "cancelled" | "skipped";
  retryAt: number; receipt?: Receipt; content: string; audience: { everyone: boolean; roles: string[] };
};
type Entry = { active: boolean; cycleId: string; group: string; listed: boolean };
type Ports = {
  current(symbol: string): Entry;
  saveDraft(symbol: string, text: string): void;
  publish(symbol: string, text: string, at: number): Promise<void>;
  send(input: { symbol: string; watchlistGroup: string; content: string; deliveryKey: string; audience: Publication["audience"] }): Promise<Receipt>;
  receipt?(symbol: string, cycleId: string, group: string, receipt: Receipt): Promise<void>;
};
const locks = new Map<string, Promise<unknown>>();

/** Separate from analysis review heads: notes never change an analysis approval. */
export class WatchlistNotesPublication {
  constructor(private readonly ports: Ports, private readonly directory = join(resolveManualWatchlistDurableDirectory(), "watchlist-notes-publications"), private readonly now = Date.now) {}
  private path(symbol: string) {
    if (!/^[A-Z][A-Z0-9]{0,9}(?:[.-][A-Z0-9]{1,2})?$/.test(symbol)) throw Error("Invalid notes request.");
    return join(this.directory, symbol + ".json");
  }
  private read(symbol: string): Publication[] {
    const path = this.path(symbol);
    if (!existsSync(path)) return [];
    const rows = JSON.parse(readFileSync(path, "utf8")) as Publication[];
    if (!Array.isArray(rows) || rows.some(row => !uuid.test(row.id) || row.symbol !== symbol || row.textHash !== notesHash(row.text))) throw Error("Notes publication status unavailable.");
    return rows;
  }
  private save(row: Publication) {
    const rows = this.read(row.symbol), index = rows.findIndex(old => old.id === row.id);
    if (index < 0) rows.push(row); else rows[index] = row;
    mkdirSync(this.directory, { recursive: true });
    const path = this.path(row.symbol); writeFileSync(path + ".tmp", JSON.stringify(rows), { mode: 0o600 }); renameSync(path + ".tmp", path);
  }
  private async serialized<T>(symbol: string, work: () => Promise<T>): Promise<T> {
    const previous = locks.get(symbol) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(work); locks.set(symbol, next);
    try { return await next; } finally { if (locks.get(symbol) === next) locks.delete(symbol); }
  }
  status(symbol: string, id: string, actor: string) {
    const row = this.read(symbol).find(row => row.id === id);
    if (!row || row.actor !== actor) return null;
    const entry = this.ports.current(symbol);
    return { id: row.id, symbol, cycleId: row.cycleId, textHash: row.textHash, publishedAt: row.publishedAt,
      published: row.website, notify: row.notify, group: row.group, discord: row.discord, retryAt: row.retryAt,
      current: entry.active && entry.cycleId === row.cycleId && entry.group === row.group && entry.group !== "private" && this.read(symbol).filter(item=>item.website && item.cycleId===row.cycleId).at(-1)?.id === row.id };
  }
  receipts(symbol: string, cycleId?: string, group?: string) {
    return this.read(symbol).filter(row => (!cycleId || row.cycleId === cycleId) && (!group || row.group === group)).flatMap(row => row.receipt ? [row.receipt] : []);
  }
  publish(input: { symbol: string; cycleId: string; actor: string; text: string; id: string; notifyUsers?: boolean }) {
    return this.serialized(input.symbol, async () => {
      if (!uuid.test(input.id) || typeof input.text !== "string" || input.text.length > 12000) throw Error("Invalid notes request.");
      const entry = this.ports.current(input.symbol);
      if (!entry.active || entry.cycleId !== input.cycleId || !entry.listed || entry.group === "private") throw Error("Save your notes, then publish the ticker.");
      let row = this.read(input.symbol).find(row => row.id === input.id);
      const notify = input.notifyUsers === true && Boolean(input.text.trim());
      if (row && (row.cycleId !== input.cycleId || row.actor !== input.actor || row.text !== input.text || row.notify !== notify)) throw Error("Notes request changed. Reopen your notes.");
      if (!row) {
        const audience = currentDiscordAudience();
        row = { id: input.id, symbol: input.symbol, cycleId: input.cycleId, actor: input.actor, text: input.text,
          textHash: notesHash(input.text), group: entry.group, publishedAt: this.now(), website: false, notify,
          discord: notify ? "pending" : "skipped", retryAt: 0, audience,
          content: appendDiscordMentions(buildWatchlistDiscordLinkMessage(input.symbol).replace(/^[^\n]+/, `## ${input.symbol} Trader notes updated by "This Guy"\nRead the updated Trader Notes on the ticker page.`), audience) };
        this.save(row);
      }
      if (!row.website) {
        // A retried old operation must never replace a later published note.
        const rows = this.read(input.symbol), index = rows.findIndex(other => other.id === row!.id);
        const later = rows.slice(index + 1).some(other => other.cycleId === row!.cycleId && other.website);
        if (later) throw Error("Notes request changed. Reopen your notes.");
        this.ports.saveDraft(input.symbol, row.text);
        await this.ports.publish(input.symbol, row.text, row.publishedAt);
        row.website = true; this.save(row);
      }
      return { saved: true, published: true, notesPublication: this.status(input.symbol, row.id, input.actor) };
    });
  }
  send(symbol: string, id: string, actor: string) {
    return this.serialized(symbol, async () => {
      const row = this.read(symbol).find(row => row.id === id && row.actor === actor);
      if (!row || !row.website || !row.notify) throw Error("Notes notification unavailable.");
      const entry = this.ports.current(symbol);
      if (!this.status(symbol,id,actor)?.current || !entry.active || entry.cycleId !== row.cycleId || entry.group !== row.group || entry.group === "private" || this.now() - row.publishedAt >= 3600000) {
        row.discord = "cancelled"; this.save(row); return this.status(symbol, id, actor);
      }
      if (row.discord !== "pending" && !(row.discord === "retry" && row.retryAt <= this.now())) return this.status(symbol, id, actor);
      row.discord = "sending"; this.save(row);
      try {
        const receipt = await this.ports.send({ symbol, watchlistGroup: row.group, content: row.content, deliveryKey: "notes:" + id, audience: row.audience });
        row.receipt = receipt; row.discord = "sent"; this.save(row);
        await this.ports.receipt?.(symbol, row.cycleId, row.group, receipt);
      } catch (error) {
        if (row.discord !== "sent") {
          row.discord = error instanceof DiscordConfirmedRejection ? error.status === 429 ? "retry" : "failed" : error instanceof DiscordPreparationFailure ? "failed" : "uncertain";
          row.retryAt = error instanceof DiscordConfirmedRejection ? error.rateLimit?.retryAt ?? this.now() + 60000 : 0;
          this.save(row);
        }
      }
      return this.status(symbol, id, actor);
    });
  }
}
