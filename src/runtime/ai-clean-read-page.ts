export const AI_CLEAN_READ_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AI Clean Read</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; color: #1f2937; background: #f6f8fb; }
    header { position: sticky; top: 0; z-index: 2; background: #fff; border-bottom: 1px solid #dbe3ee; padding: 14px 20px; }
    main { max-width: 1280px; margin: 0 auto; padding: 18px 20px 28px; }
    h1, h2, h3 { margin: 0; }
    h1 { font-size: 22px; }
    h2 { font-size: 18px; }
    h3 { font-size: 15px; }
    label { display: block; font-size: 13px; font-weight: 700; color: #475569; margin-bottom: 6px; }
    input, textarea { width: 100%; border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px; box-sizing: border-box; background: #fff; color: #111827; }
    textarea { min-height: 240px; resize: vertical; font-family: Consolas, "Courier New", monospace; font-size: 13px; line-height: 1.4; }
    button { border: 0; border-radius: 8px; padding: 10px 13px; cursor: pointer; background: #1d4ed8; color: #fff; font-weight: 700; }
    button:disabled { opacity: 0.62; cursor: wait; }
    pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; background: #0f172a; color: #e2e8f0; border-radius: 8px; padding: 14px; min-height: 180px; font-size: 14px; line-height: 1.45; }
    .topline { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
    .meta { color: #64748b; font-size: 13px; margin-top: 4px; overflow-wrap: anywhere; }
    .layout { display: grid; grid-template-columns: minmax(320px, 520px) 1fr; gap: 14px; align-items: start; }
    .panel { background: #fff; border: 1px solid #dbe3ee; border-radius: 8px; padding: 16px; }
    .field-grid { display: grid; grid-template-columns: minmax(150px, 1fr) minmax(150px, 1fr); gap: 12px; }
    .field { margin-bottom: 12px; }
    .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 12px; }
    .status { min-height: 20px; color: #1d4ed8; font-size: 13px; margin-top: 10px; }
    .error { color: #b91c1c; }
    .secondary { background: #475569; }
    .quiet { background: #64748b; }
    .output-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
    .comment-box { margin-top: 14px; border-top: 1px solid #dbe3ee; padding-top: 14px; }
    .comment-box textarea { min-height: 104px; font-family: Arial, sans-serif; }
    .usage-line { color: #334155; font-size: 13px; margin-top: 5px; }
    .live-line { color: #0f766e; font-size: 12px; margin-top: 5px; }
    .records { margin-top: 14px; display: grid; gap: 10px; }
    .record-button { width: 100%; text-align: left; background: #fff; color: #1f2937; border: 1px solid #dbe3ee; border-radius: 8px; padding: 11px; font-weight: 400; }
    .record-button:hover, .record-button.active { background: #eef5ff; border-color: #93c5fd; }
    .record-title { display: flex; justify-content: space-between; gap: 8px; font-weight: 800; }
    .record-preview { margin-top: 6px; color: #475569; font-size: 13px; line-height: 1.35; }
    @media (max-width: 900px) {
      .layout, .field-grid { grid-template-columns: 1fr; }
      textarea { min-height: 190px; }
    }
  </style>
</head>
<body>
  <header>
    <div class="topline">
      <div>
        <h1>AI Clean Read</h1>
        <div class="meta" id="source-meta">Loading...</div>
        <div class="live-line" id="live-meta">Live updates on.</div>
      </div>
      <div class="actions">
        <button class="secondary" id="watchlist-button" type="button">Back to Watchlist</button>
        <button class="quiet" id="refresh-button" type="button">Refresh</button>
      </div>
    </div>
  </header>
  <main>
    <div class="layout">
      <section class="panel">
        <div class="field-grid">
          <div class="field">
            <label for="symbol">Symbol</label>
            <input id="symbol" placeholder="AIM" />
          </div>
          <div class="field">
            <label for="current-price">Current price</label>
            <input id="current-price" placeholder="0.4199" />
          </div>
        </div>
        <div class="field">
          <label for="ladder">Support / resistance ladder</label>
          <textarea id="ladder" spellcheck="false"></textarea>
        </div>
        <div class="field">
          <label for="ai-prompt-notes">Notes to send to OpenAI (optional)</label>
          <textarea id="ai-prompt-notes"></textarea>
        </div>
        <div class="actions">
          <button id="generate-button" type="button">Generate Clean Read</button>
          <button class="secondary" id="clear-button" type="button">Clear</button>
        </div>
        <div class="status" id="status"></div>
      </section>

      <section>
        <div class="panel">
          <div class="output-head">
            <div>
              <h2>Output</h2>
              <div class="meta" id="output-meta">No clean read generated yet.</div>
              <div class="usage-line" id="usage-meta">Token usage will appear after generation.</div>
            </div>
            <button class="secondary" id="copy-button" type="button">Copy</button>
          </div>
          <pre id="output"></pre>
          <div class="comment-box">
            <h3>Audit comments</h3>
            <div class="meta">Saved locally for later audits. These comments are not sent to OpenAI.</div>
            <textarea id="audit-comments"></textarea>
            <div class="actions">
              <button id="save-comment-button" type="button">Save Comment</button>
            </div>
            <div class="status" id="comment-status"></div>
          </div>
        </div>

        <div class="panel records">
          <h2>Recent Clean Reads</h2>
          <div id="record-list"></div>
        </div>
      </section>
    </div>
  </main>
  <script>
    const sourceMetaEl = document.getElementById("source-meta");
    const liveMetaEl = document.getElementById("live-meta");
    const refreshButtonEl = document.getElementById("refresh-button");
    const watchlistButtonEl = document.getElementById("watchlist-button");
    const generateButtonEl = document.getElementById("generate-button");
    const clearButtonEl = document.getElementById("clear-button");
    const copyButtonEl = document.getElementById("copy-button");
    const saveCommentButtonEl = document.getElementById("save-comment-button");
    const symbolEl = document.getElementById("symbol");
    const currentPriceEl = document.getElementById("current-price");
    const ladderEl = document.getElementById("ladder");
    const aiPromptNotesEl = document.getElementById("ai-prompt-notes");
    const outputEl = document.getElementById("output");
    const outputMetaEl = document.getElementById("output-meta");
    const usageMetaEl = document.getElementById("usage-meta");
    const statusEl = document.getElementById("status");
    const auditCommentsEl = document.getElementById("audit-comments");
    const commentStatusEl = document.getElementById("comment-status");
    const recordListEl = document.getElementById("record-list");
    const AUTO_REFRESH_INTERVAL_MS = 4000;
    let payload = null;
    let selectedRecord = null;
    let lastNewestRecordId = null;
    let payloadLoading = false;
    let auditCommentDirty = false;
    let autoRefreshTimer = null;

    function setStatus(message, isError) {
      statusEl.textContent = message || "";
      statusEl.className = isError ? "status error" : "status";
    }

    function setCommentStatus(message, isError) {
      commentStatusEl.textContent = message || "";
      commentStatusEl.className = isError ? "status error" : "status";
    }

    function formatTime(value) {
      return value ? new Date(value).toLocaleString() : "n/a";
    }

    function formatTokens(value) {
      return typeof value === "number" && Number.isFinite(value)
        ? value.toLocaleString()
        : "n/a";
    }

    function formatCost(value) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return "cost n/a";
      }
      return "$" + value.toFixed(value < 0.01 ? 4 : 2);
    }

    function formatUsage(record) {
      const usage = record?.usage;
      if (!usage) {
        return "Tokens: n/a";
      }
      return [
        "Tokens: " + formatTokens(usage.totalTokens),
        "input " + formatTokens(usage.inputTokens),
        "output " + formatTokens(usage.outputTokens),
        "reasoning " + formatTokens(usage.reasoningTokens),
        "est. " + formatCost(usage.estimatedCostUsd),
      ].join(" | ");
    }

    function formatUsageSummary(summary) {
      if (!summary || !summary.recordsWithUsage) {
        return "Recent usage: no token data yet";
      }
      return [
        "Recent usage: " + summary.recordsWithUsage + "/" + summary.recordCount + " reads",
        formatTokens(summary.totalTokens) + " tokens",
        "input " + formatTokens(summary.inputTokens),
        "output " + formatTokens(summary.outputTokens),
        "reasoning " + formatTokens(summary.reasoningTokens),
        "est. " + formatCost(summary.estimatedCostUsd),
      ].join(" | ");
    }

    function selectRecord(record) {
      selectedRecord = record;
      symbolEl.value = record.symbol || "";
      currentPriceEl.value = record.currentPrice || "";
      ladderEl.value = record.ladderText || "";
      aiPromptNotesEl.value = record.aiPromptNotes || record.operatorComments || "";
      outputEl.textContent = record.text || "";
      outputMetaEl.textContent =
        "$" + record.symbol + " | " + formatTime(record.createdAt) + " | " + record.model + " / " + record.reasoningEffort;
      usageMetaEl.textContent = formatUsage(record);
      auditCommentsEl.value = record.latestComment?.comments || "";
      auditCommentDirty = false;
      renderRecords();
    }

    function renderRecords() {
      recordListEl.innerHTML = "";
      const records = payload?.records || [];
      if (records.length === 0) {
        const empty = document.createElement("div");
        empty.className = "meta";
        empty.textContent = "No recent clean reads yet.";
        recordListEl.appendChild(empty);
        return;
      }

      for (const record of records) {
        const button = document.createElement("button");
        const title = document.createElement("div");
        const left = document.createElement("span");
        const right = document.createElement("span");
        const preview = document.createElement("div");
        button.type = "button";
        button.dataset.recordId = record.id || "";
        button.title = "Show clean read for $" + record.symbol;
        button.className = "record-button" + (selectedRecord?.id === record.id ? " active" : "");
        title.className = "record-title";
        left.textContent = "$" + record.symbol;
        right.textContent = formatTime(record.createdAt);
        preview.className = "record-preview";
        preview.textContent =
          String(record.text || "").split("\\n").slice(0, 3).join(" | ") +
          " | " +
          formatUsage(record);
        title.appendChild(left);
        title.appendChild(right);
        button.appendChild(title);
        button.appendChild(preview);
        button.addEventListener("click", () => selectRecord(record));
        recordListEl.appendChild(button);
      }
    }

    async function loadPayload(options) {
      const settings = options || {};
      if (payloadLoading) {
        return;
      }
      payloadLoading = true;
      if (!settings.silent) {
        refreshButtonEl.disabled = true;
      }
      try {
        const response = await fetch("/api/ai-clean-read");
        payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || "Load failed");
        }
        sourceMetaEl.textContent =
          "Model: " +
          payload.model +
          " | Reasoning: " +
          payload.reasoningEffort +
          " | OpenAI key: " +
          (payload.openAiApiKeyPresent ? "present" : "missing") +
          " | " +
          formatUsageSummary(payload.usageSummary) +
          " | Comments: " +
          payload.commentsPath;
        const records = payload?.records || [];
        if (records.length > 0) {
          const newestRecord = records[0];
          const previousNewestRecordId = lastNewestRecordId;
          lastNewestRecordId = newestRecord.id;
          const matchingRecord = selectedRecord?.id
            ? records.find((record) => record.id === selectedRecord.id)
            : null;
          const hasNewRecord = previousNewestRecordId && previousNewestRecordId !== newestRecord.id;
          if (hasNewRecord && auditCommentDirty) {
            renderRecords();
            liveMetaEl.textContent = "New clean read available. Save your audit comment, then click the newest record.";
          } else if (settings.forceLatest || !matchingRecord || hasNewRecord) {
            selectRecord(newestRecord);
            liveMetaEl.textContent = hasNewRecord
              ? "New clean read loaded " + formatTime(newestRecord.createdAt) + "."
              : "Live updates on.";
          } else {
            selectRecord(matchingRecord);
            liveMetaEl.textContent = "Live updates on.";
          }
        } else {
          lastNewestRecordId = null;
          selectedRecord = null;
          renderRecords();
          liveMetaEl.textContent = "Live updates on.";
        }
      } catch (error) {
        sourceMetaEl.textContent = String(error);
        liveMetaEl.textContent = "Live updates paused while the API is unavailable.";
      } finally {
        if (!settings.silent) {
          refreshButtonEl.disabled = false;
        }
        payloadLoading = false;
      }
    }

    async function generateCleanRead() {
      generateButtonEl.disabled = true;
      setStatus("Generating clean read with xhigh reasoning from the form or latest watchlist ladder...");
      setCommentStatus("");
      try {
        const response = await fetch("/api/ai-clean-read/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            symbol: symbolEl.value,
            currentPrice: currentPriceEl.value,
            ladderText: ladderEl.value,
            aiPromptNotes: aiPromptNotesEl.value,
          }),
        });
        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.error || "Generation failed");
        }
        outputEl.textContent = result.record.text;
        outputMetaEl.textContent =
          "$" +
          result.record.symbol +
          " | " +
          formatTime(result.record.createdAt) +
          " | " +
          result.record.model +
          " / " +
          result.record.reasoningEffort;
        usageMetaEl.textContent = formatUsage(result.record);
        selectedRecord = result.record;
        auditCommentDirty = false;
        auditCommentsEl.value = "";
        setStatus("Generated clean read for $" + result.record.symbol + ". " + formatUsage(result.record));
        await loadPayload({ forceLatest: true });
        const match = (payload?.records || []).find((record) => record.id === result.record.id);
        if (match) {
          selectRecord(match);
        }
      } catch (error) {
        setStatus(String(error), true);
      } finally {
        generateButtonEl.disabled = false;
      }
    }

    async function saveComment() {
      const symbol = selectedRecord?.symbol || symbolEl.value;
      saveCommentButtonEl.disabled = true;
      setCommentStatus("Saving...");
      try {
        const response = await fetch("/api/ai-clean-read/comments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cleanReadId: selectedRecord?.id || null,
            symbol,
            comments: auditCommentsEl.value,
          }),
        });
        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.error || "Save failed");
        }
        setCommentStatus("Saved " + formatTime(result.comment.updatedAt));
        auditCommentDirty = false;
        await loadPayload();
      } catch (error) {
        setCommentStatus(String(error), true);
      } finally {
        saveCommentButtonEl.disabled = false;
      }
    }

    async function copyOutput() {
      const text = outputEl.textContent || "";
      if (!text.trim()) {
        setStatus("No output to copy.", true);
        return;
      }
      try {
        await navigator.clipboard.writeText(text);
        setStatus("Copied clean read.");
      } catch {
        setStatus("Copy failed. Select the output text manually.", true);
      }
    }

    function clearForm() {
      selectedRecord = null;
      symbolEl.value = "";
      currentPriceEl.value = "";
      ladderEl.value = "";
      aiPromptNotesEl.value = "";
      auditCommentsEl.value = "";
      outputEl.textContent = "";
      outputMetaEl.textContent = "No clean read generated yet.";
      usageMetaEl.textContent = "Token usage will appear after generation.";
      setStatus("");
      setCommentStatus("");
      renderRecords();
    }

    function startAutoRefresh() {
      if (autoRefreshTimer) {
        return;
      }
      autoRefreshTimer = window.setInterval(() => {
        if (document.hidden || generateButtonEl.disabled || saveCommentButtonEl.disabled) {
          return;
        }
        loadPayload({ silent: true });
      }, AUTO_REFRESH_INTERVAL_MS);
    }

    auditCommentsEl.addEventListener("input", () => {
      auditCommentDirty = true;
    });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        loadPayload({ silent: true });
      }
    });
    watchlistButtonEl.addEventListener("click", () => {
      window.open("/", "manual-watchlist");
    });
    refreshButtonEl.addEventListener("click", () => loadPayload({ forceLatest: true }));
    generateButtonEl.addEventListener("click", generateCleanRead);
    saveCommentButtonEl.addEventListener("click", saveComment);
    copyButtonEl.addEventListener("click", copyOutput);
    clearButtonEl.addEventListener("click", clearForm);
    loadPayload({ forceLatest: true });
    startAutoRefresh();
  </script>
</body>
</html>
`;
