/** Owner console only. Uses the existing authenticated review API; never generates AI. */
export const WATCHLIST_ROW_REVIEW = String.raw`
<script>
(() => {
  let queue = new Map(), loading = null;
  const pending = new Set(), errors = new Map();
  async function request(path, body) {
    const response = await fetch("/api/watchlist/analysis-review" + path, {
      method: body ? 'POST' : 'GET', cache: 'no-store', signal: AbortSignal.timeout(30000),
      headers: body ? { 'Content-Type': 'application/json', 'x-traderlink-journal-admin-request': '1' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Review unavailable. Check your owner session.');
    return result;
  }
  async function refresh() {
    if (loading) return loading;
    loading = (async () => {
      try { const result = await request('/queue'); queue = new Map(result.tickers.map(item => [item.symbol, item])); }
      catch { queue = new Map(); }
      finally { loading = null; }
    })();
    return loading;
  }
  function attach(entry, actions) {
    if (!entry.publicationReview?.required) return;
    const state = queue.get(entry.symbol);
    const status = document.createElement('p'); status.setAttribute('role', 'status');
    status.textContent = (state?.status || 'Review status unavailable. Check the owner session.') + (errors.has(entry.symbol) ? ' — ' + errors.get(entry.symbol) : '');
    actions.append(status);
    const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'secondary';
    edit.textContent = 'View / edit analysis'; edit.disabled = !state?.canReview || pending.has(entry.symbol);
    edit.onclick = () => {
      if (window.parent === window) { status.textContent = 'Open Watchlist Admin in the dashboard to edit the analysis card.'; return; }
      window.parent.postMessage({ source: 'traderslink-watchlist-admin', type: 'edit-analysis', symbol: entry.symbol }, window.location.origin);
    };
    actions.append(edit);
    const approve = document.createElement('button'); approve.type = 'button'; approve.textContent = 'Approve and publish';
    // Do not offer a second publication for an already approved version or while a replacement is running.
    const ready = state && ['Ready for review', 'New draft — awaiting review', 'Replacement failed — previous version available'].includes(state.status);
    approve.disabled = !ready || pending.has(entry.symbol);
    approve.onclick = async () => {
      if (pending.has(entry.symbol)) return;
      pending.add(entry.symbol); errors.delete(entry.symbol); approve.disabled = true; edit.disabled = true;
      status.textContent = 'Approving saved analysis…';
      try {
        const preview = await request('/preview?symbol=' + encodeURIComponent(entry.symbol));
        await request('/approve', { symbol: entry.symbol, cycleId: preview.cycleId, expectedHead: preview.expectedHead,
          draftRevision: preview.draftRevision, previewHash: preview.previewHash });
        status.textContent = 'Approval recorded. Checking website and Discord delivery…';
      } catch (error) { errors.set(entry.symbol, String(error.message || error) + ' Check delivery status before retrying.'); status.textContent = errors.get(entry.symbol); }
      finally { pending.delete(entry.symbol); await refresh(); window.dispatchEvent(new Event('watchlist-review-updated')); }
    };
    actions.append(approve);
    if (state?.status === 'Approved — delivery needs attention') {
      const recovery = document.createElement('button'); recovery.type = 'button'; recovery.className = 'secondary';
      recovery.textContent = 'Delivery details';
      recovery.onclick = () => {
        const navigation = document.getElementById('traderslink-watchlist-admin-section-navigation');
        if (navigation) Array.from(navigation.querySelectorAll('button')).find(button => button.textContent === 'AI Controls')?.click();
        document.getElementById('analysis-review-symbol').value = entry.symbol;
        document.getElementById('analysis-review-load').click();
        document.getElementById('analysis-review-panel').scrollIntoView({ block: 'start' });
      };
      actions.append(recovery);
    }
  }
  window.watchlistRowReview = { refresh, attach };
  window.addEventListener('message', event => {
    if (event.origin !== window.location.origin || event.source !== window.parent || event.data?.source !== 'traderslink-watchlist-editor' || event.data?.type !== 'saved') return;
    window.dispatchEvent(new Event('watchlist-review-updated'));
  });
})();
</script>`;
