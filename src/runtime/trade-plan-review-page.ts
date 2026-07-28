export const TRADE_PLAN_REVIEW_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Trade Plan Review</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; color: #1f2937; background: #f6f8fb; }
    header { position: sticky; top: 0; z-index: 2; background: #ffffff; border-bottom: 1px solid #dbe3ee; padding: 14px 20px; }
    main { max-width: 1320px; margin: 0 auto; padding: 18px 20px 28px; }
    h1, h2, h3 { margin: 0; }
    h1 { font-size: 22px; }
    h2 { font-size: 18px; }
    h3 { font-size: 15px; }
    button { border: 0; border-radius: 8px; padding: 9px 12px; cursor: pointer; background: #0f766e; color: #fff; font-weight: 700; }
    button:disabled { opacity: 0.62; cursor: wait; }
    select, textarea, input { border: 1px solid #cbd5e1; border-radius: 8px; padding: 9px; box-sizing: border-box; background: #fff; }
    textarea { width: 100%; min-height: 92px; resize: vertical; }
    .topline { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .meta { color: #64748b; font-size: 13px; margin-top: 4px; overflow-wrap: anywhere; }
    .filters { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
    .filters input { min-width: 170px; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 14px; }
    .stat { background: #fff; border: 1px solid #dbe3ee; border-radius: 8px; padding: 11px; }
    .stat-label { color: #64748b; font-size: 12px; }
    .stat-value { font-size: 22px; font-weight: 800; margin-top: 2px; }
    .layout { display: grid; grid-template-columns: minmax(280px, 390px) 1fr; gap: 14px; align-items: start; }
    .list, .detail { background: #fff; border: 1px solid #dbe3ee; border-radius: 8px; }
    .list { max-height: calc(100vh - 185px); overflow: auto; }
    .post-row { display: block; width: 100%; text-align: left; border-radius: 0; border-bottom: 1px solid #e5eaf1; background: #fff; color: #1f2937; padding: 12px; font-weight: 400; }
    .post-row:hover, .post-row.active { background: #eaf7f5; }
    .row-title { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-weight: 800; }
    .row-summary { margin-top: 6px; color: #475569; font-size: 13px; line-height: 1.35; }
    .detail { padding: 16px; min-height: 520px; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .chip { border-radius: 999px; padding: 4px 8px; background: #e2e8f0; color: #334155; font-size: 12px; font-weight: 700; }
    .chip-good { background: #dcfce7; color: #166534; }
    .chip-watch { background: #fef3c7; color: #92400e; }
    .plan-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 10px; margin: 14px 0; }
    .plan-cell { border: 1px solid #dbe3ee; border-radius: 8px; padding: 10px; background: #fbfdff; min-height: 64px; }
    .plan-label { color: #64748b; font-size: 12px; font-weight: 800; text-transform: uppercase; }
    .plan-value { margin-top: 5px; line-height: 1.35; }
    .columns { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 14px 0; }
    .level-list { margin: 8px 0 0; padding: 0; list-style: none; }
    .level-list li { padding: 5px 0; border-top: 1px solid #edf2f7; font-size: 13px; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; background: #0f172a; color: #e2e8f0; border-radius: 8px; padding: 12px; max-height: 340px; overflow: auto; font-size: 12px; }
    .note-panel { border-top: 1px solid #dbe3ee; margin-top: 16px; padding-top: 14px; }
    .note-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 8px; }
    .status { min-height: 20px; color: #0f766e; font-size: 13px; margin-top: 8px; }
    .empty { padding: 20px; color: #64748b; }
    @media (max-width: 860px) {
      .layout, .columns { grid-template-columns: 1fr; }
      .list { max-height: 420px; }
    }
  </style>
</head>
<body>
  <header>
    <div class="topline">
      <div>
        <h1>Trade Plan Review</h1>
        <div class="meta" id="source-meta">Loading session...</div>
      </div>
      <button id="refresh-button" type="button">Refresh</button>
    </div>
    <div class="filters">
      <input id="symbol-filter" placeholder="Filter symbol" />
      <select id="kind-filter">
        <option value="">All post types</option>
        <option value="level_snapshot">Snapshots</option>
        <option value="intelligent_alert">Alerts</option>
        <option value="follow_through_update">Follow-through</option>
      </select>
      <select id="review-filter">
        <option value="">All reviews</option>
        <option value="unreviewed">Unreviewed</option>
        <option value="useful">Useful</option>
        <option value="needs_work">Needs work</option>
        <option value="ignore">Ignore</option>
      </select>
    </div>
  </header>
  <main>
    <div class="stats" id="stats"></div>
    <div class="layout">
      <section class="list" id="post-list"></section>
      <section class="detail" id="post-detail">
        <div class="empty">Select a post to review the derived trader plan.</div>
      </section>
    </div>
  </main>
  <script>
    const sourceMetaEl = document.getElementById("source-meta");
    const refreshButtonEl = document.getElementById("refresh-button");
    const symbolFilterEl = document.getElementById("symbol-filter");
    const kindFilterEl = document.getElementById("kind-filter");
    const reviewFilterEl = document.getElementById("review-filter");
    const statsEl = document.getElementById("stats");
    const listEl = document.getElementById("post-list");
    const detailEl = document.getElementById("post-detail");
    let payload = null;
    let selectedId = null;

    function formatTime(value) {
      return value ? new Date(value).toLocaleString() : "n/a";
    }

    function reviewState(item) {
      return item.note?.verdict || "unreviewed";
    }

    function chipClass(verdict) {
      if (verdict === "useful") return "chip chip-good";
      if (verdict === "needs_work") return "chip chip-watch";
      return "chip";
    }

    function createStat(label, value) {
      const card = document.createElement("div");
      const labelEl = document.createElement("div");
      const valueEl = document.createElement("div");
      card.className = "stat";
      labelEl.className = "stat-label";
      valueEl.className = "stat-value";
      labelEl.textContent = label;
      valueEl.textContent = value;
      card.appendChild(labelEl);
      card.appendChild(valueEl);
      return card;
    }

    function createChip(text, className) {
      const chip = document.createElement("span");
      chip.className = className || "chip";
      chip.textContent = text;
      return chip;
    }

    function filteredItems() {
      if (!payload) return [];
      const symbol = symbolFilterEl.value.trim().toUpperCase();
      const kind = kindFilterEl.value;
      const review = reviewFilterEl.value;
      return payload.items.filter((item) => {
        if (symbol && !item.symbol.includes(symbol)) return false;
        if (kind && item.messageKind !== kind) return false;
        if (review && reviewState(item) !== review) return false;
        return true;
      });
    }

    function renderStats(items) {
      statsEl.innerHTML = "";
      const reviewed = items.filter((item) => reviewState(item) !== "unreviewed").length;
      const symbols = new Set(items.map((item) => item.symbol)).size;
      statsEl.appendChild(createStat("Visible Posts", String(items.length)));
      statsEl.appendChild(createStat("Symbols", String(symbols)));
      statsEl.appendChild(createStat("Reviewed", String(reviewed)));
      statsEl.appendChild(createStat("Needs Work", String(items.filter((item) => reviewState(item) === "needs_work").length)));
    }

    function renderList() {
      const items = filteredItems();
      renderStats(items);
      listEl.innerHTML = "";
      if (items.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty";
        empty.textContent = "No posts match the current filters.";
        listEl.appendChild(empty);
        return;
      }
      if (!selectedId || !items.some((item) => item.id === selectedId)) {
        selectedId = items[0]?.id || null;
      }
      for (const item of items) {
        const row = document.createElement("button");
        const title = document.createElement("div");
        const summary = document.createElement("div");
        const left = document.createElement("span");
        const state = document.createElement("span");
        row.type = "button";
        row.className = "post-row" + (item.id === selectedId ? " active" : "");
        title.className = "row-title";
        summary.className = "row-summary";
        left.textContent = item.symbol + " | " + item.title;
        state.className = chipClass(reviewState(item));
        state.textContent = reviewState(item).replace(/_/g, " ");
        title.appendChild(left);
        title.appendChild(state);
        summary.textContent = [
          formatTime(item.timestamp),
          item.messageKind,
          item.derivedPlan.supportThatMustHold ? "hold: " + item.derivedPlan.supportThatMustHold : "",
          item.derivedPlan.breakZone ? "break: " + item.derivedPlan.breakZone : "",
        ].filter(Boolean).join(" | ");
        row.appendChild(title);
        row.appendChild(summary);
        row.addEventListener("click", () => {
          selectedId = item.id;
          render();
        });
        listEl.appendChild(row);
      }
    }

    function appendPlanCell(container, label, value) {
      const cell = document.createElement("div");
      const labelEl = document.createElement("div");
      const valueEl = document.createElement("div");
      cell.className = "plan-cell";
      labelEl.className = "plan-label";
      valueEl.className = "plan-value";
      labelEl.textContent = label;
      valueEl.textContent = value || "n/a";
      cell.appendChild(labelEl);
      cell.appendChild(valueEl);
      container.appendChild(cell);
    }

    function appendLevelList(container, title, zones) {
      const wrap = document.createElement("div");
      const heading = document.createElement("h3");
      const list = document.createElement("ul");
      heading.textContent = title;
      list.className = "level-list";
      for (const zone of zones || []) {
        const item = document.createElement("li");
        item.textContent = zone.label;
        list.appendChild(item);
      }
      if (!zones || zones.length === 0) {
        const item = document.createElement("li");
        item.textContent = "No ladder levels on this row.";
        list.appendChild(item);
      }
      wrap.appendChild(heading);
      wrap.appendChild(list);
      container.appendChild(wrap);
    }

    function renderDetail() {
      const item = (payload?.items || []).find((candidate) => candidate.id === selectedId);
      detailEl.innerHTML = "";
      if (!item) {
        const empty = document.createElement("div");
        empty.className = "empty";
        empty.textContent = "Select a post to review the derived trader plan.";
        detailEl.appendChild(empty);
        return;
      }

      const title = document.createElement("h2");
      const meta = document.createElement("div");
      const chips = document.createElement("div");
      const plan = document.createElement("div");
      const columns = document.createElement("div");
      const originalHeading = document.createElement("h3");
      const original = document.createElement("pre");
      const notePanel = document.createElement("div");
      const noteHeading = document.createElement("h3");
      const verdict = document.createElement("select");
      const tags = document.createElement("input");
      const notes = document.createElement("textarea");
      const save = document.createElement("button");
      const noteStatus = document.createElement("div");

      title.textContent = item.symbol + " | " + item.title;
      meta.className = "meta";
      meta.textContent = formatTime(item.timestamp) + " | " + item.messageKind + (item.currentPrice ? " | price " + item.currentPrice : "");
      chips.className = "chips";
      chips.appendChild(createChip(reviewState(item).replace(/_/g, " "), chipClass(reviewState(item))));
      for (const value of item.context || []) chips.appendChild(createChip(value));

      plan.className = "plan-grid";
      appendPlanCell(plan, "Buy-Zone Candidate", item.derivedPlan.buyZone);
      appendPlanCell(plan, "Break Zone", item.derivedPlan.breakZone);
      appendPlanCell(plan, "Support Must Hold", item.derivedPlan.supportThatMustHold);
      appendPlanCell(plan, "Failure Zone", item.derivedPlan.failureZone);
      appendPlanCell(plan, "First Target / Barrier", item.derivedPlan.firstTarget);
      appendPlanCell(plan, "Caution", item.derivedPlan.caution);
      appendPlanCell(plan, "Structure", item.derivedPlan.structure);

      columns.className = "columns";
      appendLevelList(columns, "Support Ladder", item.levels.displayedSupports);
      appendLevelList(columns, "Resistance Ladder", item.levels.displayedResistances);

      originalHeading.textContent = "Original Post";
      original.textContent = item.originalPost || "";

      notePanel.className = "note-panel";
      noteHeading.textContent = "Review Notes";
      for (const value of ["unreviewed", "useful", "needs_work", "ignore"]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value.replace(/_/g, " ");
        verdict.appendChild(option);
      }
      verdict.value = reviewState(item);
      tags.placeholder = "Tags, comma separated";
      tags.value = (item.note?.tags || []).join(", ");
      notes.placeholder = "Leave notes for Codex to review later";
      notes.value = item.note?.notes || "";
      save.textContent = "Save Review";
      noteStatus.className = "status";
      save.addEventListener("click", async () => {
        save.disabled = true;
        noteStatus.textContent = "Saving...";
        try {
          const response = await fetch("/api/trade-plan-review/notes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              itemId: item.id,
              symbol: item.symbol,
              verdict: verdict.value,
              notes: notes.value,
              tags: tags.value.split(",").map((tag) => tag.trim()).filter(Boolean),
            }),
          });
          const saved = await response.json();
          if (!response.ok) throw new Error(saved.error || "Save failed");
          item.note = saved.note;
          noteStatus.textContent = "Saved " + saved.note.updatedAt;
          renderList();
        } catch (error) {
          noteStatus.textContent = String(error);
        } finally {
          save.disabled = false;
        }
      });

      const actions = document.createElement("div");
      actions.className = "note-actions";
      actions.appendChild(verdict);
      actions.appendChild(tags);
      actions.appendChild(save);
      notePanel.appendChild(noteHeading);
      notePanel.appendChild(notes);
      notePanel.appendChild(actions);
      notePanel.appendChild(noteStatus);

      detailEl.appendChild(title);
      detailEl.appendChild(meta);
      detailEl.appendChild(chips);
      detailEl.appendChild(plan);
      detailEl.appendChild(columns);
      detailEl.appendChild(originalHeading);
      detailEl.appendChild(original);
      detailEl.appendChild(notePanel);
    }

    function render() {
      renderList();
      renderDetail();
    }

    async function load() {
      refreshButtonEl.disabled = true;
      try {
        const response = await fetch("/api/trade-plan-review");
        payload = await response.json();
        sourceMetaEl.textContent = payload.sessionDirectory
          ? "Session: " + payload.sessionDirectory + " | Notes: " + (payload.notesPath || "n/a")
          : "No active session directory is configured.";
        render();
      } catch (error) {
        sourceMetaEl.textContent = String(error);
      } finally {
        refreshButtonEl.disabled = false;
      }
    }

    refreshButtonEl.addEventListener("click", load);
    symbolFilterEl.addEventListener("input", render);
    kindFilterEl.addEventListener("change", render);
    reviewFilterEl.addEventListener("change", render);
    load();
    setInterval(load, 10000);
  </script>
</body>
</html>
`;
