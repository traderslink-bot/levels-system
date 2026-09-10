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
  </div>
  <p id="analysis-review-status" role="status" aria-live="polite"></p>
  <div id="analysis-review-editor"></div>
  <div class="inline-control" id="analysis-review-actions" hidden>
    <button type="button" id="analysis-review-save">Save draft</button>
    <button type="button" id="analysis-review-preview">Preview</button>
    <button type="button" id="analysis-review-approve" disabled>Approve and publish</button>
    <button type="button" id="analysis-review-retry" class="secondary">Retry Discord delivery</button>
  </div>
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
  async function request(action, body) {
    const base = "/api/watchlist/analysis-review";
    const response = await fetch(base + action + (body ? "" : "?symbol=" + encodeURIComponent(ticker.value.trim().toUpperCase())), {
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
  function renderEditor() {
    editor.replaceChildren(); previewContent.replaceChildren(); preview = null;
    const draft = review && review.draft;
    if (!draft || !draft.body.payload) { actions.hidden = true; message("No analysis draft is available yet. The ticker remains held if owner review is required."); return; }
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
    const history = node("details", undefined, editor); node("summary", "Saved version history", history);
    review.events.filter((event) => ["original", "edit", "approve", "delivery", "discord_chunk"].includes(event.body.kind)).forEach((event) => {
      node("p", "Version " + event.revision + " · " + event.body.kind + " · " + new Date(event.at).toLocaleString() + (event.body.channel ? " · " + event.body.channel : "") + (event.body.status ? " · " + event.body.status : ""), history);
    });
  }
  byId("load").onclick = () => { if (dirty && !window.confirm("Discard unsaved edits and load this ticker?")) return; run(async () => { const result = await request(""); review = result.review; renderEditor(); if (review && review.draft) message("Saved analysis loaded."); }); };
  byId("save").onclick = () => run(async () => {
    const result = await request("/save", { symbol: review.symbol, cycleId: review.cycleId, expectedHead: review.head, patch });
    review = result.review; renderEditor(); message("Draft saved." + (result.warnings.length ? " " + result.warnings.join(" ") : ""));
  });
  byId("preview").onclick = () => run(async () => {
    if (dirty) { message("Save your edits before previewing."); return; }
    preview = await request("/preview");
    if (preview.cycleId !== review.cycleId || preview.draftRevision !== review.draft.revision) { preview = null; throw new Error("The draft changed. Reload before previewing."); }
    previewContent.replaceChildren(); node("h4", "Discord preview", previewContent);
    preview.publication.discordChunks.forEach((text) => { const body = node("pre", text, previewContent); body.style.whiteSpace = "pre-wrap"; body.style.overflowWrap = "anywhere"; });
    message("Preview ready. Approve and publish sends this saved version.");
  });
  byId("approve").onclick = () => run(async () => {
    if (!preview || dirty) throw new Error("Preview the saved version before approving.");
    const result = await request("/approve", { symbol: review.symbol, cycleId: preview.cycleId, expectedHead: preview.expectedHead, draftRevision: preview.draftRevision, previewHash: preview.previewHash });
    review = result.review; renderEditor(); message("Approved version published to the website and Discord.");
  });
  byId("retry").onclick = () => run(async () => {
    if (!review || !review.approved) throw new Error("There is no approved version to deliver.");
    const result = await request("/retry-discord", { symbol: review.symbol, cycleId: review.cycleId, approvalRevision: review.approved.revision });
    review = result.review; message("Discord delivery confirmed.");
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
      if (item.canReview) {
        const button = node("button", "Review " + item.symbol, row); button.type = "button";
        button.onclick = () => { if (dirty && !window.confirm("Discard unsaved edits and load this ticker?")) return; run(async () => { ticker.value = item.symbol; review = (await request("")).review; renderEditor(); message("Saved analysis loaded."); }); };
      }
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
