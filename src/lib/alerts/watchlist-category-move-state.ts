/** Delivery state is separate from ticker placement and analysis approval. */
export type MoveReceipt = { channelId: string; messageId: string };
export type CategoryMove = {
  id: string;
  symbol: string;
  cycleId: string;
  from: string;
  to: string;
  content: string;
  createdAt: number;
  published: boolean;
  notify: boolean;
  placement: "pending" | "complete";
  destination: "pending" | "sending" | "confirmed" | "failed" | "uncertain" | "skipped";
  destinationReceipt?: MoveReceipt;
  notification: "pending" | "confirmed" | "skipped";
  cleanup: { receipt: MoveReceipt; state: "pending" | "deleted" | "failed" }[];
  notice: string;
  retryAt?: number;
};

export function newCategoryMove(input: Omit<CategoryMove,"placement"|"destination"|"notification"|"cleanup"|"notice">, sourceReceipts: MoveReceipt[]): CategoryMove {
  const send = input.notify && input.published && input.from !== input.to;
  const unique = new Map(sourceReceipts.map(receipt => [`${receipt.channelId}:${receipt.messageId}`,receipt]));
  return { ...input, placement:"pending", destination:send ? "pending" : "skipped", notification:send ? "pending" : "skipped",
    cleanup:send ? [...unique.values()].map(receipt => ({receipt:{...receipt},state:"pending"})) : [], notice:"" };
}

export type MovePorts = {
  /** Synchronous durable save: must finish before any external side effect. */
  save: (move: CategoryMove) => void;
  current: () => boolean;
  place: () => Promise<void>;
  send: () => Promise<MoveReceipt>;
  /** Must be idempotent using move.id, including after a lost response. */
  notify: () => Promise<void>;
  remove: (receipt: MoveReceipt) => Promise<void>;
  definitelyNotSent: (error: unknown) => boolean;
  retryAfter?: (error: unknown) => number | undefined;
};

/** Caller serializes each symbol; retries use the SAME persisted operation. */
export async function advanceCategoryMove(move: CategoryMove, ports: MovePorts): Promise<CategoryMove> {
  const state = structuredClone(move);
  const save = () => ports.save(structuredClone(state));
  // A retry must not move a removed/re-added ticker, or undo a later move.
  if (!ports.current()) {
    state.notice="Ticker placement changed again. This earlier move will not send another post.";
    save();
    return state;
  }
  if (state.placement !== "complete") {
    await ports.place();
    state.placement="complete";
    save();
  }
  if (state.destination === "skipped") {state.notice="Ticker moved. No notifications sent.";save();return state;}
  if (!ports.current()) {
    state.notice="Ticker placement changed again. This earlier move will not send another post.";
    save();
    return state;
  }
  if (state.destination === "sending") {
    state.destination="uncertain";
    state.notice="Discord has not confirmed the earlier request. Check the destination channel before sending again.";
    save();
  }
  if (state.destination === "uncertain") return state;
  if(state.retryAt && state.retryAt > Date.now())return state;
  if (state.destination !== "confirmed") {
    state.destination="sending";
    save();
    let receipt: MoveReceipt;
    try { receipt=await ports.send(); }
    catch (error) {
      state.destination=ports.definitelyNotSent(error) ? "failed" : "uncertain";
      state.retryAt=ports.retryAfter?.(error);
      state.notice=state.destination === "failed"
        ? "Ticker moved. Discord delivery did not complete; the original post has been kept."
        : "Ticker moved. Discord delivery is awaiting confirmation; the original post has been kept.";
      save();
      return state;
    }
    // A failure to persist a successful receipt must not be classified as a
    // transport rejection. The saved 'sending' state protects against resending.
    state.destinationReceipt=receipt;
    state.destination="confirmed";
    state.notice="";
    save();
  }
  if (!ports.current()) {
    state.notice="The earlier Discord post was sent, but the ticker has since moved again. No further announcement was queued.";
    save();
    return state;
  }
  if (state.notification !== "confirmed") {
    try { await ports.notify(); }
    catch {
      state.notice="Discord post sent. Push/email delivery could not be queued; retry will not repeat the Discord post.";
      save();
      return state;
    }
    state.notification="confirmed";
    save();
  }
  for (const item of state.cleanup) {
    if (item.state === "deleted") continue;
    // Even if source and destination share a channel, never delete this move's receipt.
    if (item.receipt.channelId === state.destinationReceipt?.channelId && item.receipt.messageId === state.destinationReceipt.messageId) continue;
    try { await ports.remove(item.receipt); item.state="deleted"; }
    catch { item.state="failed"; }
    save();
  }
  state.notice=state.cleanup.some(item => item.state === "failed")
    ? "New post sent. Some original Discord posts could not be deleted. Retry cleanup without sending another notification."
    : "Ticker moved. Discord post sent and member notifications queued.";
  save();
  return state;
}
