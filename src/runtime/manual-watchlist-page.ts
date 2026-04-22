export const MANUAL_WATCHLIST_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Manual Watchlist</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; background: #f5f7fb; color: #1f2937; }
    main { max-width: 760px; margin: 0 auto; }
    form, section { background: #fff; border: 1px solid #d7dee8; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
    label { display: block; font-size: 14px; margin-bottom: 6px; }
    input { width: 100%; padding: 10px; border: 1px solid #c7d0dc; border-radius: 8px; margin-bottom: 12px; box-sizing: border-box; }
    button { padding: 10px 14px; border: 0; border-radius: 8px; cursor: pointer; background: #1d4ed8; color: #fff; }
    ul { list-style: none; padding: 0; margin: 0; }
    li { display: flex; justify-content: space-between; gap: 12px; align-items: center; border-top: 1px solid #e5e7eb; padding: 12px 0; }
    li:first-child { border-top: 0; }
    .meta { color: #4b5563; font-size: 13px; }
    .status { min-height: 20px; font-size: 14px; margin-bottom: 12px; color: #1d4ed8; }
    .danger { background: #b91c1c; }
  </style>
</head>
<body>
  <main>
    <form id="watchlist-form">
      <h1>Manual Watchlist</h1>
      <div class="status" id="status"></div>
      <label for="symbol">npm run watchlist:manual</label>
      <label for="symbol">Symbol</label>
      <input id="symbol" name="symbol" maxlength="10" required />
      <label for="note">Note (optional)</label>
      <input id="note" name="note" maxlength="200" />
      <button type="submit">Add / Activate</button>
    </form>

    <section>
      <h2>Active Tickers</h2>
      <ul id="active-list"></ul>
    </section>
  </main>

  <script>
    const statusEl = document.getElementById("status");
    const listEl = document.getElementById("active-list");
    const formEl = document.getElementById("watchlist-form");
    const symbolEl = document.getElementById("symbol");
    const noteEl = document.getElementById("note");

    function setStatus(message, isError = false) {
      statusEl.textContent = message;
      statusEl.style.color = isError ? "#b91c1c" : "#1d4ed8";
    }

    function appendMetaValue(container, label, value) {
      if (!value) {
        return;
      }

      container.appendChild(document.createTextNode(" | " + label + ": " + value));
    }

    function buildEntryMeta(entry) {
      const meta = document.createElement("div");
      const title = document.createElement("strong");
      const details = document.createElement("div");
      const lastPostText = entry.lastLevelPostAt
        ? new Date(entry.lastLevelPostAt).toLocaleTimeString()
        : "";

      title.textContent = entry.symbol;
      details.className = "meta";
      details.appendChild(
        document.createTextNode("thread: " + (entry.discordThreadId || "pending")),
      );
      appendMetaValue(details, "state", entry.lifecycle);
      appendMetaValue(details, "last snapshot", lastPostText);
      appendMetaValue(details, "note", entry.note);

      meta.appendChild(title);
      meta.appendChild(details);
      return meta;
    }

    function renderEntries(entries) {
      listEl.innerHTML = "";
      if (entries.length === 0) {
        const empty = document.createElement("li");
        empty.textContent = "No active tickers";
        listEl.appendChild(empty);
        return;
      }

      for (const entry of entries) {
        const item = document.createElement("li");
        const meta = buildEntryMeta(entry);

        const button = document.createElement("button");
        button.textContent = "Deactivate";
        button.className = "danger";
        button.addEventListener("click", async () => {
          const response = await fetch("/api/watchlist/deactivate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ symbol: entry.symbol }),
          });
          const payload = await response.json();
          if (!response.ok) {
            setStatus(payload.error || "Deactivate failed", true);
            return;
          }
          setStatus("Deactivated " + payload.entry.symbol);
          await loadEntries();
        });

        item.appendChild(meta);
        item.appendChild(button);
        listEl.appendChild(item);
      }
    }

    async function loadEntries() {
      const response = await fetch("/api/watchlist");
      const payload = await response.json();
      renderEntries(payload.activeEntries || []);
    }

    formEl.addEventListener("submit", async (event) => {
      event.preventDefault();
      const response = await fetch("/api/watchlist/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: symbolEl.value,
          note: noteEl.value,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setStatus(payload.error || "Activate failed", true);
        return;
      }
      if (payload.queued) {
        setStatus(
          "Activation started for " +
            payload.entry.symbol +
            " in thread " +
            (payload.entry.discordThreadId || "pending") +
            ". IBKR seeding can take a minute if the symbol is slow.",
        );
      } else {
        setStatus("Activated " + payload.entry.symbol + " in thread " + payload.entry.discordThreadId);
      }
      symbolEl.value = "";
      noteEl.value = "";
      await loadEntries();
    });

    loadEntries().catch((error) => {
      setStatus(String(error), true);
    });
    setInterval(() => {
      loadEntries().catch((error) => {
        setStatus(String(error), true);
      });
    }, 5000);
  </script>
</body>
</html>
`;
