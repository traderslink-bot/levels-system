export const ANALYSIS_REVIEW_PANEL = String.raw`
<style>#analysis-review-panel [hidden] { display: none !important; } #analysis-review-panel details { margin: 12px 0; } #analysis-review-panel summary { cursor: pointer; font-weight: 700; margin-bottom: 10px; } #analysis-review-panel fieldset { min-width: 0; margin: 8px 0; } #analysis-review-actions { flex-wrap: wrap; }</style>
<div class="ai-read-console" id="analysis-review-panel">
  <h3>Analysis Review</h3>
  <div class="provider-control">
    <label><input type="checkbox" id="analysis-review-automatic" style="width:auto" disabled /> Automatic AI updates</label>
    <p>When off, automatic follow-up AI requests stop. Manual refresh and live price/data updates remain available.</p>
    <label><input type="checkbox" id="analysis-review-required" style="width:auto" disabled /> Review before publishing</label>
    <p>When on, new tickers wait for your approval when AI generation and the current session are enabled. Existing drafts stay held until approved.</p>
    <button type="button" id="analysis-review-settings-save" disabled>Save review controls</button>
    <button type="button" id="analysis-review-settings-load" class="secondary">Reload review controls</button>
  </div>
  <div class="inline-control">
    <button type="button" id="analysis-review-queue-refresh" class="secondary">Refresh review list</button>
  </div>
  <div id="analysis-review-queue" aria-label="Ticker review status"></div>
  <div class="inline-control">
    <label for="analysis-review-symbol">Ticker</label>
    <input id="analysis-review-symbol" maxlength="20" autocomplete="off" />
    <button type="button" id="analysis-review-load">Review ticker</button>
    <button type="button" id="analysis-review-history-load" class="secondary">Ticker history</button>
  </div>
  <div id="analysis-review-cycles" aria-label="Saved ticker histories"></div>
  <p id="analysis-review-status" role="status" aria-live="polite"></p>
  <div id="analysis-review-editor"></div>
  <div class="inline-control" id="analysis-review-actions" hidden>
    <button type="button" id="analysis-review-save">Save draft</button>
    <button type="button" id="analysis-review-preview">Preview</button>
    <button type="button" id="analysis-review-approve" disabled>Approve and publish</button>
    <button type="button" id="analysis-review-retry" class="secondary">Retry Discord delivery</button>
  </div>
  <div class="inline-control" id="analysis-review-export-area" hidden>
    <label for="analysis-review-export-generation">Audit generation</label>
    <select id="analysis-review-export-generation"></select>
    <button type="button" id="analysis-review-inspect" class="secondary">Inspect request</button>
    <button type="button" id="analysis-review-export" class="secondary">Export audit</button>
  </div>
  <div id="analysis-review-audit-content"></div>
  <div id="analysis-review-preview-content"></div>
</div>
<script>
(() => {
  const byId = (id) => document.getElementById("analysis-review-" + id);
  const editor = byId("editor"), status = byId("status"), previewContent = byId("preview-content");
  const actions = byId("actions"), ticker = byId("symbol");
  const keys = ["currentRead", "bias", "confidence", "needsToHold", "cautionBelow", "momentumFailure", "mustClear", "breakoutContinuation", "targets", "downsideCheckpoints", "pullbackPlans", "failureRecovery", "catalystRealityCheck", "dilutionRisk", "listingStatus", "riskSummary", "ownerHiddenSections"];
  const sectionLabels = { currentRead: "Analysis", needsToHold: "Needs to hold", cautionBelow: "Caution below", momentumFailure: "Momentum failure", mustClear: "Must clear", breakoutContinuation: "Breakout continuation", targets: "Where the trade could go next", downsideCheckpoints: "Downside levels", shallow: "Shallow pullback", deep: "Deep pullback", failureRecovery: "Failure and recovery", catalystRealityCheck: "Catalyst / recent news", dilutionRisk: "Dilution risk", listingStatus: "Listing status", riskSummary: "Risk notes" };
  const fieldLabels = { label: "Label", price: "Price", rationale: "Rationale", condition: "Condition", zoneLow: "Area low", zoneHigh: "Area high", confirmationPrice: "Confirmation price", confirmation: "Confirmation", invalidationPrice: "Invalidation price", firstObjectivePrice: "Next level", recoveryZoneLow: "Recovery area low", recoveryZoneHigh: "Recovery area high", firstReclaimPrice: "First reclaim", setupRestorePrice: "Recovery setup established above", summary: "Summary", dayTradeRelevance: "Day-trading relevance" };
  const levelFields = ["label", "price", "rationale"];
  const pullbackFields = ["zoneLow", "zoneHigh", "confirmationPrice", "confirmation", "invalidationPrice", "firstObjectivePrice", "rationale"];
  const recoveryFields = ["recoveryZoneLow", "recoveryZoneHigh", "firstReclaimPrice", "setupRestorePrice", "firstObjectivePrice", "rationale"];
  let review = null, patch = null, preview = null, dirty = false, busy = false, controlsLoaded = false;
  let historical = false;
  const node = (tag, text, parent) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (parent) parent.append(el); return el; };
  const message = (text) => { status.textContent = text; };
  const changed = () => { dirty = true; preview = null; previewContent.replaceChildren(); byId("approve").disabled = true; };
  const pick = (value, names) => Object.fromEntries(names.map((key) => [key, value[key]]));
  function editable(payload) {
    const result = Object.fromEntries(keys.filter((key) => Object.hasOwn(payload, key)).map((key) => [key, structuredClone(payload[key])]));
    for (const key of ["needsToHold", "cautionBelow", "momentumFailure", "mustClear", "breakoutContinuation"]) result[key] = pick(payload[key], levelFields);
    result.targets = payload.targets.map((item) => pick(item, ["label", "price", "condition"]));
    result.downsideCheckpoints = payload.downsideCheckpoints.map((item) => pick(item, ["label", "price", "condition"]));
    result.pullbackPlans = Object.fromEntries(["shallow", "deep"].map((key) => [key, payload.pullbackPlans[key] ? pick(payload.pullbackPlans[key], pullbackFields) : null]));
    result.failureRecovery = payload.failureRecovery ? pick(payload.failureRecovery, recoveryFields) : null;
    for (const key of ["catalystRealityCheck", "dilutionRisk", "listingStatus"]) result[key] = pick(payload[key], ["summary", "dayTradeRelevance"]);
    result.ownerHiddenSections = payload.ownerHiddenSections || [];
    return result;
  }
  async function request(action, body, query = {}) {
    const base = "/api/watchlist/analysis-review";
    const response = await fetch(base + action + (body ? "" : "?" + new URLSearchParams({ symbol: ticker.value.trim().toUpperCase(), ...query })), {
      method: body ? "POST" : "GET", cache: "no-store",
      headers: body ? { "Content-Type": "application/json", "x-traderlink-journal-admin-request": "1" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Owner review is unavailable. Check your owner session and try again.");
    return result;
  }
  async function run(operation) {
    if (busy) return;
    busy = true;
    const controls = Array.from(document.querySelectorAll("#analysis-review-panel button, #analysis-review-panel input, #analysis-review-panel textarea, #analysis-review-panel select"));
    controls.forEach((control) => { control.disabled = true; });
    try { await operation(); } catch (error) { message(error.message || "Review could not complete."); }
    finally { busy = false; controls.forEach((control) => { control.disabled = false; }); byId("approve").disabled = !preview || dirty; ["automatic", "required", "settings-save"].forEach((id) => { byId(id).disabled = !controlsLoaded; }); }
  }
  function input(parent, label, object, key, numeric) {
    const wrapper = node("label", label, parent);
    const control = node(numeric ? "input" : "textarea", undefined, wrapper);
    if (numeric) { control.type = "number"; control.step = "any"; }
    else control.maxLength = 8000;
    control.value = object[key] === null || object[key] === undefined ? "" : String(object[key]);
    control.addEventListener("input", () => { object[key] = numeric ? (control.value === "" ? null : Number(control.value)) : control.value; changed(); });
  }
  function fields(parent, object, names) {
    names.forEach((key) => input(parent, fieldLabels[key], object, key, key === "price" || /Price$|Low$|High$/.test(key)));
  }
  function section(key) {
    const details = node("details", undefined, editor);
    node("summary", sectionLabels[key], details);
    const wrapper = node("label", "Show this section", details);
    const checkbox = node("input", undefined, wrapper); checkbox.type = "checkbox";
    checkbox.style.width = "auto"; checkbox.checked = !patch.ownerHiddenSections.includes(key);
    checkbox.addEventListener("change", () => { patch.ownerHiddenSections = patch.ownerHiddenSections.filter((item) => item !== key); if (!checkbox.checked) patch.ownerHiddenSections.push(key); changed(); });
    return details;
  }
  function renderReviewHistory(events, parent) {
    const history = node("details", undefined, parent); node("summary", "Request and version history", history);
    const requestNumbers = new Map();
    events.filter((event) => event.body.kind === "generation" || event.body.kind === "original").forEach((event) => {
      if (!requestNumbers.has(event.body.generationId)) requestNumbers.set(event.body.generationId, requestNumbers.size + 1);
    });
    node("p", "Recorded requests: " + requestNumbers.size, history);
    events.filter((event) => ["generation", "original", "edit", "approve", "delivery", "discord_chunk"].includes(event.body.kind)).forEach((event) => {
      const requestNumber = requestNumbers.get(event.body.generationId);
      node("p", (requestNumber ? "Request " + requestNumber + " · " : "") + "Version " + event.revision + " · " + event.body.kind + " · " + new Date(event.at).toLocaleString() + (event.body.channel ? " · " + event.body.channel : "") + (event.body.status ? " · " + event.body.status : "") + (event.body.trigger ? " · " + event.body.trigger : ""), history);
    });
  }
  function renderEditor() {
    byId("audit-content").replaceChildren();
    editor.replaceChildren(); previewContent.replaceChildren(); preview = null;
    const draft = review && review.draft;
    const generations = byId("export-generation"); generations.replaceChildren();
    const generationIds = new Set();
    (review ? review.events : []).filter((event) => event.body.kind === "original" || event.body.kind === "generation").forEach((event) => {
      if (generationIds.has(event.body.generationId)) return;
      generationIds.add(event.body.generationId);
      const option = node("option", "Request " + generationIds.size + " · " + new Date(event.at).toLocaleString(), generations); option.value = event.body.generationId;
    });
    byId("export-area").hidden = generationIds.size === 0;
    if (generationIds.size) generations.value = Array.from(generationIds).at(-1);
    if (historical) {
      patch = null; dirty = false; actions.hidden = true;
      if (review) renderReviewHistory(review.events, editor);
      message("Historical record — read only. Export a request to inspect its saved analysis and revisions.");
      return;
    }
    if (!draft || !draft.body.payload) {
      patch = null; dirty = false; actions.hidden = true;
      if (review) renderReviewHistory(review.events, editor);
      message("No analysis draft is available yet. The ticker remains held if owner review is required."); return;
    }
    patch = editable(draft.body.payload); dirty = false; actions.hidden = false;
    node("p", review.symbol + " · Saved version " + draft.revision + " · Analysis price $" + draft.body.payload.currentPrice, editor);
    for (const key of ["bias", "confidence"]) {
      const label = node("label", key === "bias" ? "Bias" : "Confidence", editor);
      const select = node("select", undefined, label);
      (key === "bias" ? ["bullish", "neutral", "bearish", "mixed"] : ["low", "medium", "high"]).forEach((value) => { const option = node("option", value, select); option.value = value; });
      select.value = patch[key]; select.addEventListener("change", () => { patch[key] = select.value; changed(); });
    }
    input(section("currentRead"), "Analysis", patch, "currentRead", false);
    for (const key of ["needsToHold", "cautionBelow", "momentumFailure", "mustClear", "breakoutContinuation"]) fields(section(key), patch[key], levelFields);
    for (const key of ["targets", "downsideCheckpoints", "riskSummary"]) {
      const parent = section(key), list = node("div", undefined, parent);
      const renderList = () => {
        list.replaceChildren();
        patch[key].forEach((item, index) => {
          const row = node("fieldset", undefined, list); node("legend", String(index + 1), row);
          if (key === "riskSummary") input(row, "Risk note", patch[key], index, false);
          else fields(row, item, ["label", "price", "condition"]);
          const remove = node("button", "Remove", row); remove.type = "button";
          remove.onclick = () => { patch[key].splice(index, 1); changed(); renderList(); };
        });
      };
      renderList(); const add = node("button", "Add", parent); add.type = "button";
      add.onclick = () => { if (patch[key].length >= 20) { message("Up to 20 items can be saved in this section."); return; } patch[key].push(key === "riskSummary" ? "" : { label: "", price: null, condition: "" }); changed(); renderList(); };
    }
    for (const key of ["shallow", "deep", "failureRecovery"]) {
      const parent = section(key), object = key === "failureRecovery" ? patch : patch.pullbackPlans;
      const names = key === "failureRecovery" ? recoveryFields : pullbackFields;
      const wrapper = node("label", "Include this setup", parent), toggle = node("input", undefined, wrapper);
      toggle.type = "checkbox"; toggle.style.width = "auto"; toggle.checked = Boolean(object[key]);
      const body = node("div", undefined, parent);
      const renderSetup = () => { body.replaceChildren(); if (object[key]) fields(body, object[key], names); };
      toggle.onchange = () => { object[key] = toggle.checked ? Object.fromEntries(names.map((name) => [name, /Price$|Low$|High$/.test(name) ? null : ""])) : null; changed(); renderSetup(); };
      renderSetup();
    }
    for (const key of ["catalystRealityCheck", "dilutionRisk", "listingStatus"]) fields(section(key), patch[key], ["summary", "dayTradeRelevance"]);
    renderReviewHistory(review.events, editor);
  }
  byId("load").onclick = () => { if (dirty && !window.confirm("Discard unsaved edits and load this ticker?")) return; run(async () => { const result = await request(""); review = result.review; historical = false; renderEditor(); if (review && review.draft) message("Saved analysis loaded."); }); };
  async function loadHistory(symbol, after) {
    const result = await request("/history", undefined, { symbol, ...(after ? { after } : {}) });
    const list = byId("cycles");
    if (!after) list.replaceChildren();
    const previousMore = list.querySelector("[data-history-more]");
    if (previousMore) previousMore.remove();
    node("h4", symbol + " · Saved histories", list);
    result.cycles.forEach((cycle) => {
      const button = node("button", "Inspect " + new Date(cycle.startedAt).toLocaleString(), list);
      button.type = "button";
      button.onclick = () => {
        if (dirty && !window.confirm("Discard unsaved edits and open this historical record?")) return;
        run(async () => {
          const selected = await request("", undefined, { symbol, cycleId: cycle.cycleId });
          review = selected.review; historical = true; renderEditor();
        });
      };
    });
    if (result.nextCursor) {
      const more = node("button", "Load more histories", list); more.type = "button"; more.dataset.historyMore = "1";
      more.onclick = () => run(() => loadHistory(symbol, result.nextCursor));
    } else if (!result.cycles.length) node("p", after ? "No more matching histories." : "No saved histories for this ticker.", list);
  }
  byId("history-load").onclick = () => run(() => loadHistory(ticker.value.trim().toUpperCase()));
  byId("save").onclick = () => run(async () => {
    if (historical) throw new Error("Historical records are read only.");
    const result = await request("/save", { symbol: review.symbol, cycleId: review.cycleId, expectedHead: review.head, patch });
    review = result.review; renderEditor(); message("Draft saved." + (result.warnings.length ? " " + result.warnings.join(" ") : ""));
  });
  byId("preview").onclick = () => run(async () => {
    if (historical) throw new Error("Historical records are read only.");
    if (dirty) { message("Save your edits before previewing."); return; }
    preview = await request("/preview");
    if (preview.cycleId !== review.cycleId || preview.draftRevision !== review.draft.revision) { preview = null; throw new Error("The draft changed. Reload before previewing."); }
    previewContent.replaceChildren(); node("h4", "Discord preview", previewContent);
    const websiteButton = node("button", "Website preview", previewContent);
    websiteButton.type = "button";
    const savedWebsite = preview.publication.website;
    websiteButton.onclick = () => {
      if (window.parent === window) { message("Open Watchlist Admin in the dashboard to view the website card."); return; }
      window.parent.postMessage({ source: "traderslink-watchlist-admin", type: "preview-analysis", card: savedWebsite.cards.tradersLinkAiRead, dipBuyPlanVisible: savedWebsite.tradersLinkAiReadDipBuyPlanVisible }, window.location.origin);
    };
    preview.publication.discordChunks.forEach((text) => { const body = node("pre", text, previewContent); body.style.whiteSpace = "pre-wrap"; body.style.overflowWrap = "anywhere"; });
    message("Preview ready. Approve and publish sends this saved version.");
  });
  byId("approve").onclick = () => run(async () => {
    if (historical) throw new Error("Historical records are read only.");
    if (!preview || dirty) throw new Error("Preview the saved version before approving.");
    const result = await request("/approve", { symbol: review.symbol, cycleId: preview.cycleId, expectedHead: preview.expectedHead, draftRevision: preview.draftRevision, previewHash: preview.previewHash });
    review = result.review; renderEditor(); message("Approved version published to the website and Discord.");
  });
  byId("retry").onclick = () => run(async () => {
    if (historical) throw new Error("Historical records are read only.");
    if (!review || !review.approved) throw new Error("There is no approved version to deliver.");
    const result = await request("/retry-discord", { symbol: review.symbol, cycleId: review.cycleId, approvalRevision: review.approved.revision });
    review = result.review; message("Discord delivery confirmed.");
  });
  function renderAudit(audit) {
    const container = byId("audit-content"); container.replaceChildren();
    node("h4", audit.symbol + " · Request audit", container);
    node("p", "Generation: " + audit.generationId, container);
    node("p", audit.diagnosticStatus === "available" ? "Available captured diagnostics are shown below." : "Input/response diagnostics are unavailable. Saved request and version records remain below.", container);
    const show = (label, value) => {
      const details = node("details", undefined, container); node("summary", label, details);
      let rendered = false;
      details.addEventListener("toggle", () => {
        if (!details.open || rendered) return;
        rendered = true;
        const text = typeof value === "string" ? value : JSON.stringify(value ?? null, null, 2);
        const body = node("pre", text.slice(0, 100000), details);
        body.style.whiteSpace = "pre-wrap"; body.style.overflowWrap = "anywhere";
        if (text.length > 100000) node("p", "Display shortened for performance. Export audit contains the full available record.", details);
      });
    };
    const labels = { request: "Input packet", response: "AI response", validation: "Validation results", prepared_payload: "Prepared analysis", transport_error: "Request error" };
    ((audit.diagnostic && audit.diagnostic.events) || []).forEach((event, index) => show((labels[event.phase] || "Diagnostic record") + " · " + (index + 1), event.payload));
    (audit.selectedEvents || []).forEach((event) => show("Version " + event.revision + " · " + event.body.kind, event));
  }
  byId("inspect").onclick = () => run(async () => {
    const generationId = byId("export-generation").value;
    if (!review || !generationId) throw new Error("Select a saved request to inspect.");
    const result = await request("/export", undefined, { symbol: review.symbol, generationId, ...(historical ? { cycleId: review.cycleId } : {}) });
    renderAudit(result.audit);
    message("Selected request loaded. Inspecting does not generate or publish analysis.");
  });
  byId("export-generation").onchange = () => byId("audit-content").replaceChildren();
  byId("export").onclick = () => run(async () => {
    const generationId = byId("export-generation").value;
    if (!review || !generationId) throw new Error("Select a saved analysis to export.");
    const result = await request("/export", undefined, { symbol: review.symbol, generationId, ...(historical ? { cycleId: review.cycleId } : {}) });
    const url = URL.createObjectURL(new Blob([JSON.stringify(result.audit, null, 2)], { type: "application/json" }));
    const link = node("a"); link.href = url; link.download = review.symbol + "-analysis-audit.json"; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    message("Selected audit exported. It has not been shared with anyone.");
  });
  const showSettings = (settings) => {
    byId("automatic").checked = settings.automaticUpdatesEnabled;
    byId("required").checked = settings.reviewBeforePublishingEnabled;
    controlsLoaded = true;
  };
  const loadQueue = async () => {
    const result = await request("/queue"), list = byId("queue");
    list.replaceChildren();
    if (!result.tickers.length) { node("p", "No active tickers require owner review.", list); return; }
    result.tickers.forEach((item) => {
      const row = node("div", undefined, list); row.className = "inline-control";
      node("span", item.symbol + " · " + item.status, row);
      const button = node("button", (item.canReview ? "Review " : "Inspect ") + item.symbol, row); button.type = "button";
      button.onclick = () => { if (dirty && !window.confirm("Discard unsaved edits and load this ticker?")) return; run(async () => { ticker.value = item.symbol; review = (await request("")).review; historical = false; renderEditor(); if (review && review.draft) message("Saved analysis loaded."); }); };
    });
  };
  byId("queue-refresh").onclick = () => run(loadQueue);
  const loadSettings = () => run(async () => { showSettings((await request("/settings")).settings); await loadQueue(); message("Review controls and ticker list loaded."); });
  byId("settings-load").onclick = loadSettings;
  byId("settings-save").onclick = () => run(async () => {
    if (!controlsLoaded) throw new Error("Load the saved controls first.");
    const result = await request("/settings", { automaticUpdatesEnabled: byId("automatic").checked, reviewBeforePublishingEnabled: byId("required").checked });
    showSettings(result.settings); message("Review controls saved. Session settings and existing pending drafts are unchanged.");
  });
  void loadSettings();
  window.addEventListener("beforeunload", (event) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } });
})();
</script>`;
