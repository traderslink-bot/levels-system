import { createHash } from "node:crypto";
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ReviewPublication } from "./traderslink-ai-read-publication-preview.js";
import { isConfirmedDiscordRejectionStatus } from "../alerts/discord-confirmed-rejection.js";

type ReviewBody =
  | { kind: "generation"; generationId: string; status: "started" | "completed" | "failed"; runId: string; trigger: string; model: string; dataAsOf: number }
  | { kind: "begin"; symbol: string; reviewRequired: boolean }
  | { kind: "original"; generationId: string; payload: Record<string, unknown> }
  | { kind: "edit"; parentDraft: number; payload: Record<string, unknown> }
  | { kind: "approve"; draftRevision: number; publication?: ReviewPublication }
  | { kind: "discord_chunk"; approvalRevision: number; index: number; status: "started" | "acknowledged" | "rejected"; deliveryKey: string; httpStatus?: number; receipt?: { messageId: string; channelId: string } }
  | { kind: "delivery"; approvalRevision: number; channel: "website" | "discord"; status: "started" | "acknowledged" | "failed"; deliveryId: string | null }
  | { kind: "cancel" };

export type ReviewEvent = {
  version: 1; cycleId: string; revision: number; previousHash: string | null;
  actor: string; at: number; body: ReviewBody; hash: string;
};
export type ReviewState = {
  cycleId: string; symbol: string; reviewRequired: boolean; head: number;
  cancelled: boolean; draft: ReviewEvent | null; approved: ReviewEvent | null;
  events: ReviewEvent[];
};

const MAX_EVENT_BYTES = 2 * 1024 * 1024;
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const eventName = (revision: number) => `${String(revision).padStart(8, "0")}.json`;

function json(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (typeof item === "number" && !Number.isFinite(item)) throw new Error("Non-finite review value.");
    return item;
  });
}
function requireDirectory(path: string): void {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Invalid review directory.");
}

/** Single-writer, append-only review history on the existing durable volume.
 * No diagnostic retention applies. Authentication belongs to the calling API.
 * Exclusive revision files provide compare-and-swap, not a second runtime writer.
 */
export class TradersLinkAiReadReviewStore {
  constructor(private readonly directory: string, private readonly now = Date.now) {}

  private cycleDirectory(cycleId: string): string {
    if (!cycleId || cycleId.length > 200) throw new Error("Invalid review cycle ID.");
    return join(this.directory, digest(cycleId));
  }

  read(cycleId: string): ReviewState | null {
    const directory = this.cycleDirectory(cycleId);
    if (!existsSync(this.directory)) return null;
    requireDirectory(this.directory);
    if (!existsSync(directory)) return null;
    requireDirectory(directory);
    const names = readdirSync(directory).filter((name) => /^\d{8}\.json$/.test(name)).sort();
    if (!names.length) return null;
    const events: ReviewEvent[] = [];
    for (const [index, name] of names.entries()) {
      if (name !== eventName(index + 1)) throw new Error("Review revision gap.");
      const path = join(directory, name);
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_EVENT_BYTES) throw new Error("Invalid review event file.");
      const event = JSON.parse(readFileSync(path, "utf8")) as ReviewEvent;
      const { hash, ...unsigned } = event;
      if (event.version !== 1 || event.cycleId !== cycleId || event.revision !== index + 1 ||
        event.previousHash !== (events.at(-1)?.hash ?? null) || hash !== digest(json(unsigned))) {
        throw new Error("Review history integrity failure.");
      }
      events.push(event);
    }
    const first = events[0]!.body;
    if (first.kind !== "begin") throw new Error("Missing review cycle origin.");
    return {
      cycleId, symbol: first.symbol, reviewRequired: first.reviewRequired, head: events.length,
      cancelled: events.some((event) => event.body.kind === "cancel"),
      draft: events.findLast((event) => event.body.kind === "original" || event.body.kind === "edit") ?? null,
      approved: events.findLast((event) => event.body.kind === "approve") ?? null,
      events,
    };
  }

  private append(cycleId: string, expectedHead: number, actor: string, body: ReviewBody): ReviewEvent {
    if (!actor.trim() || actor.length > 200) throw new Error("Invalid review actor.");
    const state = this.read(cycleId);
    if ((state?.head ?? 0) !== expectedHead) throw new Error("Review changed. Reload before saving.");
    // A receipt can arrive after removal; retain that historical outcome,
    // without allowing any new publication or edits on the cancelled cycle.
    const cancelledOriginal = body.kind === "original" && state?.events.some((event) => event.body.kind === "generation" && event.body.generationId === body.generationId && event.body.status === "completed");
    if (state?.cancelled && !cancelledOriginal && !(body.kind === "discord_chunk" && body.status === "acknowledged") && !(body.kind === "generation" && body.status !== "started")) throw new Error("Review cycle is cancelled.");
    if (!state && body.kind !== "begin") throw new Error("Review cycle does not exist.");
    if (state && body.kind === "begin") throw new Error("Review cycle already exists.");
    const unsigned = {
      version: 1 as const, cycleId, revision: expectedHead + 1,
      previousHash: state?.events.at(-1)?.hash ?? null, actor, at: this.now(), body,
    };
    const event: ReviewEvent = { ...unsigned, hash: digest(json(unsigned)) };
    const serialized = json(event);
    if (Buffer.byteLength(serialized) > MAX_EVENT_BYTES) throw new Error("Review revision exceeds storage limit.");
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    requireDirectory(this.directory);
    const directory = this.cycleDirectory(cycleId);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    requireDirectory(directory);
    const descriptor = openSync(join(directory, eventName(event.revision)), "wx", 0o600);
    try { writeFileSync(descriptor, serialized, "utf8"); fsyncSync(descriptor); }
    finally { closeSync(descriptor); }
    return JSON.parse(serialized) as ReviewEvent;
  }

  begin(cycleId: string, symbol: string, reviewRequired: boolean, actor: string): ReviewEvent {
    if (!/^[A-Z0-9][A-Z0-9.\-]{0,19}$/.test(symbol)) throw new Error("Invalid review symbol.");
    return this.append(cycleId, 0, actor, { kind: "begin", symbol, reviewRequired });
  }

  recordGeneration(cycleId: string, input: { generationId: string; status: "started" | "completed" | "failed"; runId: string; trigger: string; model: string; dataAsOf: number }): ReviewEvent {
    const state = this.read(cycleId);
    if (!state || !input.generationId || input.generationId.length > 200 || !Number.isFinite(input.dataAsOf)) throw new Error("Invalid generation audit identity.");
    const prior = state.events.findLast((event) => event.body.kind === "generation" && event.body.generationId === input.generationId);
    if (!prior && input.status !== "started") throw new Error("Generation audit was not started.");
    if (prior?.body.kind === "generation") {
      if (prior.body.runId !== input.runId || prior.body.trigger !== input.trigger || prior.body.model !== input.model || prior.body.dataAsOf !== input.dataAsOf) throw new Error("Generation audit identity changed.");
      if (prior.body.status === input.status) return prior;
      if (prior.body.status !== "started" || input.status === "started") throw new Error("Generation audit is already complete.");
    }
    return this.append(cycleId, state.head, "runtime:generator", { kind: "generation", ...input });
  }

  saveDraft(input: { cycleId: string; expectedHead: number; actor: string; payload: Record<string, unknown>; generationId?: string }): ReviewEvent {
    const state = this.read(input.cycleId);
    if (!state || input.payload.symbol !== state.symbol) throw new Error("Review ticker mismatch.");
    if (input.generationId !== undefined && (!input.generationId || input.generationId.length > 200)) throw new Error("Invalid generation ID.");
    const original = input.generationId ? state.events.find((event) =>
      event.body.kind === "original" && event.body.generationId === input.generationId) : undefined;
    if (original?.body.kind === "original") {
      if (json(original.body.payload) !== json(input.payload)) throw new Error("Generation ID already has different original content.");
      return original;
    }
    if (!input.generationId && !state.draft) throw new Error("No original analysis to edit.");
    return this.append(input.cycleId, input.expectedHead, input.actor, input.generationId
      ? { kind: "original", generationId: input.generationId, payload: input.payload }
      : { kind: "edit", parentDraft: state.draft!.revision, payload: input.payload });
  }

  approve(cycleId: string, expectedHead: number, draftRevision: number, actor: string, publication?: ReviewPublication): ReviewEvent {
    const state = this.read(cycleId);
    if (!state || state.cancelled || state.draft?.revision !== draftRevision) throw new Error("Draft changed. Review the latest version.");
    if (state.approved?.body.kind === "approve" && state.approved.body.draftRevision === draftRevision) {
      if (publication && json(state.approved.body.publication) !== json(publication)) throw new Error("Approved preview cannot change. Save a new draft first.");
      return state.approved;
    }
    if (publication && (!publication.website || !Array.isArray(publication.discordChunks) || publication.discordChunks.length === 0 ||
      publication.discordChunks.some((chunk) => typeof chunk !== "string" || !chunk.trim() || chunk.length > 2000))) throw new Error("Invalid publication preview.");
    return this.append(cycleId, expectedHead, actor, { kind: "approve", draftRevision, ...(publication ? { publication } : {}) });
  }

  claimDiscordChunk(cycleId: string, expectedHead: number, approvalRevision: number, index: number) {
    const state = this.read(cycleId);
    const approval = state?.approved;
    if (!state || state.cancelled || approval?.revision !== approvalRevision || approval.body.kind !== "approve") throw new Error("Publication approval changed.");
    const chunks = approval.body.publication?.discordChunks;
    if (!Number.isInteger(index) || index < 0 || !chunks?.[index]) throw new Error("Approved Discord chunk is unavailable.");
    const prior = state.events.findLast((event) => event.body.kind === "discord_chunk" && event.body.approvalRevision === approvalRevision && event.body.index === index);
    const deliveryKey = digest(`${cycleId}:${approvalRevision}:discord:${index}`);
    if (prior?.body.kind === "discord_chunk" && prior.body.status !== "rejected") return { shouldSend: false, deliveryKey, content: chunks[index]!, reason: prior.body.status === "acknowledged" ? "acknowledged" as const : "uncertain" as const };
    if (index > 0 && !state.events.some((event) => event.body.kind === "discord_chunk" && event.body.approvalRevision === approvalRevision && event.body.index === index - 1 && event.body.status === "acknowledged")) throw new Error("Previous Discord chunk is not acknowledged.");
    this.append(cycleId, expectedHead, "delivery", { kind: "discord_chunk", approvalRevision, index, status: "started", deliveryKey });
    return { shouldSend: true, deliveryKey, content: chunks[index]!, reason: "claimed" as const };
  }

  rejectDiscordChunk(cycleId: string, expectedHead: number, approvalRevision: number, index: number, httpStatus: number) {
    if (!isConfirmedDiscordRejectionStatus(httpStatus)) throw new Error("Discord delivery is not a confirmed rejection.");
    const state = this.read(cycleId);
    const prior = state?.events.findLast((event) => event.body.kind === "discord_chunk" && event.body.approvalRevision === approvalRevision && event.body.index === index);
    if (!prior || prior.body.kind !== "discord_chunk" || prior.body.status !== "started") throw new Error("Discord delivery is not awaiting an outcome.");
    return this.append(cycleId, expectedHead, "delivery", { kind: "discord_chunk", approvalRevision, index, status: "rejected", deliveryKey: prior.body.deliveryKey, httpStatus });
  }

  acknowledgeDiscordChunk(cycleId: string, expectedHead: number, approvalRevision: number, index: number, receipt: { messageId: string; channelId: string }) {
    if (!/^\d{17,20}$/.test(receipt.messageId) || !/^\d{17,20}$/.test(receipt.channelId)) throw new Error("Invalid Discord receipt.");
    const state = this.read(cycleId);
    const prior = state?.events.findLast((event) => event.body.kind === "discord_chunk" && event.body.approvalRevision === approvalRevision && event.body.index === index);
    if (!prior || prior.body.kind !== "discord_chunk") throw new Error("Discord delivery was not claimed.");
    if (prior.body.status === "acknowledged") {
      if (json(prior.body.receipt) !== json(receipt)) throw new Error("Discord receipt conflicts with confirmed delivery.");
      return prior;
    }
    return this.append(cycleId, expectedHead, "delivery", { kind: "discord_chunk", approvalRevision, index, status: "acknowledged", deliveryKey: prior.body.deliveryKey, receipt });
  }

  recordDelivery(cycleId: string, expectedHead: number, approvalRevision: number, channel: "website" | "discord", status: "started" | "acknowledged" | "failed", deliveryId: string | null): ReviewEvent {
    const state = this.read(cycleId);
    if (!state?.events.some((event) => event.revision === approvalRevision && event.body.kind === "approve") ||
      (status === "started" && state.approved?.revision !== approvalRevision)) throw new Error("Publication approval changed.");
    const prior = state.events.findLast((event) => event.body.kind === "delivery" && event.body.approvalRevision === approvalRevision && event.body.channel === channel);
    if (prior?.body.kind === "delivery" && prior.body.status === "acknowledged") return prior;
    return this.append(cycleId, expectedHead, "delivery", { kind: "delivery", approvalRevision, channel, status, deliveryId });
  }

  claimDelivery(cycleId: string, expectedHead: number, approvalRevision: number, channel: "website" | "discord"):
    { shouldSend: boolean; deliveryKey: string; event: ReviewEvent; reason: "claimed" | "acknowledged" | "uncertain" } {
    const state = this.read(cycleId);
    if (!state || state.cancelled || state.approved?.revision !== approvalRevision) throw new Error("Publication approval changed.");
    const deliveryKey = digest(`${cycleId}:${approvalRevision}:${channel}`);
    const prior = state.events.findLast((event) => event.body.kind === "delivery" && event.body.approvalRevision === approvalRevision && event.body.channel === channel);
    if (prior?.body.kind === "delivery" && prior.body.status !== "failed") {
      return { shouldSend: false, deliveryKey, event: prior, reason: prior.body.status === "acknowledged" ? "acknowledged" : "uncertain" };
    }
    const event = this.append(cycleId, expectedHead, "delivery", { kind: "delivery", approvalRevision, channel, status: "started", deliveryId: deliveryKey });
    return { shouldSend: true, deliveryKey, event, reason: "claimed" };
  }

  cancel(cycleId: string, expectedHead: number, actor: string): ReviewEvent {
    return this.append(cycleId, expectedHead, actor, { kind: "cancel" });
  }
}
