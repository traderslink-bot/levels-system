import assert from "node:assert/strict";
import test from "node:test";
import { Script } from "node:vm";
import { WATCHLIST_ROW_REVIEW } from "../runtime/manual-watchlist-row-review.js";

class Element {
  [key: string]: any;
  children: Element[] = [];
  style = {};
  attributes: Record<string, string> = {};
  listeners: Record<string, () => void> = {};
  textContent = "";
  value = "";
  disabled = false;
  checked = false;
  indeterminate = false;
  isConnected = false;
  parent?: Element;
  constructor(public tag: string) {}
  append(...nodes: Element[]) { for (const node of nodes) { this.children.push(node); node.parent = this; node.isConnected = this.isConnected; } }
  prepend(...nodes: Element[]) { this.children.unshift(...nodes); }
  replaceChildren(...nodes: Element[]) { this.children = []; this.append(...nodes); }
  setAttribute(key: string, value: string) { this.attributes[key] = value; }
  querySelector() { return null; }
  addEventListener(name: string, listener: () => void) { this.listeners[name] = listener; }
  showModal() {}
  close() { this.listeners.close?.(); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); this.isConnected = false; }
}

function harness() {
  const body = new Element("body"); body.isConnected = true;
  const calls: { method: string; input?: Record<string, any> }[] = [];
  const state = { cycleId: "cycle", approvalRevision: 3, automaticEnabled: false, copy: null as string | null, queued: false,
    loseSendAck: false, loseAutomaticAck: false, failNextRead: false, failBeforeSend: false, queueWrites: 0 };
  const model = () => ({ cycleId: state.cycleId, approvalRevision: state.approvalRevision, automaticEnabled: state.automaticEnabled,
    savedMessage: state.copy, delivery: state.queued ? { state: "pending" } : null,
    preview: { heading: "Free $TEST TradersLink Analysis", defaultMessage: "Default message", footer: "Protected links", visibilityKey: "000", includeImages: true } });
  let delayed: (() => Promise<Response>) | undefined;
  const window: any = { location: { origin: "https://app.test" }, addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
  window.parent = window;
  const document = { body, createElement: (tag: string) => new Element(tag), createTextNode: (text: string) => Object.assign(new Element("#text"), { textContent: text }) };
  new Script(WATCHLIST_ROW_REVIEW.match(/<script>([\s\S]*?)<\/script>/)![1]!).runInNewContext({
    window, document, AbortSignal, Event, URLSearchParams, setTimeout: () => 1, clearTimeout() {},
    fetch: async (_url: string, options: { method: string; body?: string }) => {
      const input = options.body ? JSON.parse(options.body) : undefined;
      calls.push({ method: options.method, input });
      if (!input) {
        if (state.failNextRead) { state.failNextRead = false; return Response.json({ error: "Read unavailable" }, { status: 503 }); }
        return Response.json(model());
      }
      if (input.action === "send") {
        if (state.failBeforeSend) { state.failBeforeSend = false; return Response.json({ error: "Write unavailable" }, { status: 503 }); }
        if (!state.queued) { state.queued = true; state.copy = input.message; state.queueWrites++; }
        if (state.loseSendAck) { state.loseSendAck = false; return Response.json({ error: "Acknowledgement lost" }, { status: 503 }); }
      }
      if (input.action === "automatic") {
        state.automaticEnabled = input.enabled;
        if (state.loseAutomaticAck) { state.loseAutomaticAck = false; return Response.json({ error: "Acknowledgement lost" }, { status: 503 }); }
      }
      return delayed ? delayed() : Response.json(model());
    },
  });
  const actions = new Element("div"); body.append(actions);
  window.watchlistRowReview.attach({ symbol: "TEST", watchlistGroup: "main", publicationReview: { cycleId: "cycle", required: false } }, actions);
  const all = (root = body): Element[] => [root, ...root.children.flatMap(child => all(child))];
  return { state, calls, body, model, delay: (fn: () => Promise<Response>) => { delayed = fn; },
    async open() {
      await all().find(node => node.textContent === "Post to Free Chat")!.onclick();
      const dialog = body.children.find(node => node.tag === "dialog")!;
      const nodes = all(dialog);
      return { dialog, message: nodes.find(node => node.tag === "textarea")!, automatic: nodes.find(node => node.type === "checkbox")!,
        send: nodes.find(node => node.textContent === "Confirm Free Chat post")!, check: nodes.find(node => node.textContent === "Check delivery status")!, status: nodes.find(node => node.attributes.role === "status")! };
    },
  };
}

test("a committed Free Chat send with lost acknowledgement reads its receipt and never posts again", async () => {
  const h = harness(), ui = await h.open(); h.state.loseSendAck = true;
  ui.message.value = "First saved copy"; await ui.send.onclick();
  assert.equal(h.state.queueWrites, 1);
  assert.equal(h.calls.filter(call => call.input?.action === "send").length, 1);
  assert.equal(ui.message.value, "First saved copy");
  assert.match(ui.status.textContent, /Queued/); assert.equal(ui.send.disabled, true);
});

test("an explicit edited retry displays the first immutable queued copy after readback also failed", async () => {
  const h = harness(), ui = await h.open(); h.state.loseSendAck = h.state.failNextRead = true;
  ui.message.value = "First saved copy"; await ui.send.onclick();
  assert.match(ui.status.textContent, /could not be confirmed/); assert.equal(ui.message.value, "First saved copy");
  ui.message.value = "Later unsaved copy"; await ui.send.onclick();
  assert.equal(h.state.queueWrites, 1); assert.equal(h.state.copy, "First saved copy");
  assert.equal(ui.message.value, "First saved copy"); assert.match(ui.status.textContent, /Queued/);
});

test("a request that failed before writing keeps the owner's text and does not claim queued delivery", async () => {
  const h = harness(), ui = await h.open(); h.state.failBeforeSend = true;
  ui.message.value = "Still my draft"; await ui.send.onclick();
  assert.equal(h.state.queueWrites, 0); assert.equal(ui.message.value, "Still my draft");
  assert.match(ui.status.textContent, /Write unavailable/); assert.equal(ui.send.disabled, false);
});

test("manual status recovery also restores the saved copy before claiming queued delivery", async () => {
  const h = harness(), ui = await h.open(); h.state.loseSendAck = h.state.failNextRead = true;
  ui.message.value = "First saved copy"; await ui.send.onclick();
  ui.message.value = "Later unsaved copy";
  await ui.check.onclick();
  // The button starts its async refresh without waiting for it.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ui.message.value, "First saved copy"); assert.match(ui.status.textContent, /Queued/);
  assert.equal(h.state.queueWrites, 1); assert.equal(h.calls.filter(call => call.input?.action === "send").length, 1);
});

test("send recovery cannot silently switch to another publication", async () => {
  const h = harness(), ui = await h.open(); h.state.loseSendAck = true; h.state.approvalRevision = 4;
  ui.message.value = "Selected revision three"; await ui.send.onclick();
  assert.match(ui.status.textContent, /could not be confirmed/);
  assert.equal(ui.message.value, "Selected revision three");
  assert.equal(h.calls.filter(call => call.input?.action === "send").length, 1);
  assert.equal(h.calls.find(call => call.input?.action === "send")!.input!.approvalRevision, 3);
});

test("a late send response does not reopen a closed composer", async () => {
  const h = harness(), ui = await h.open(); let resolve!: (response: Response) => void;
  h.delay(() => new Promise<Response>(done => { resolve = done; }));
  const pending = ui.send.onclick(); ui.dialog.close(); resolve(Response.json(h.model())); await pending;
  assert.equal(h.body.children.some(node => node.tag === "dialog"), false); assert.equal(h.state.queueWrites, 1);
});

test("automatic preference lost acknowledgement is reconciled with GET, without queuing a post", async () => {
  const h = harness(), ui = await h.open(); h.state.loseAutomaticAck = true;
  ui.automatic.checked = true; await ui.automatic.onchange();
  assert.equal(h.state.automaticEnabled, true); assert.equal(ui.automatic.checked, true);
  assert.equal(ui.automatic.indeterminate, false); assert.equal(h.state.queueWrites, 0);
  assert.equal(h.calls.filter(call => call.input?.action === "automatic").length, 1);
});

test("unverifiable automatic preference shows unknown and still accepts a new explicit owner choice", async () => {
  const h = harness(), ui = await h.open(); h.state.loseAutomaticAck = h.state.failNextRead = true;
  ui.automatic.checked = true; await ui.automatic.onchange();
  assert.equal(h.state.automaticEnabled, true); assert.equal(ui.automatic.indeterminate, true);
  assert.match(ui.status.textContent, /setting is unknown/); assert.equal(ui.automatic.disabled, false);
  ui.automatic.checked = false; await ui.automatic.onchange();
  assert.equal(h.state.automaticEnabled, false); assert.equal(ui.automatic.checked, false);
  assert.equal(ui.automatic.indeterminate, false); assert.equal(h.state.queueWrites, 0);
});
