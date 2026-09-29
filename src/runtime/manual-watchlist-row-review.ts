/** Owner console only. Uses the existing authenticated review API; never generates AI. */
export const WATCHLIST_ROW_REVIEW = String.raw`
<script>
(() => {
  let queue = new Map(), loading = null;
  const pending = new Set(), errors = new Map(), notificationChoices = new Map();
  const notesDrafts = new Map();
  const freeChatChoices = new Map();
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
    if (entry.analysisGeneration) {
      const run = entry.analysisGeneration;
      const elapsed = Math.max(0, Math.floor((Date.now() - run.startedAt) / 1000));
      const status = document.createElement('span'); status.textContent = 'Analysis running · ' + Math.floor(elapsed / 60) + 'm ' + (elapsed % 60) + 's';
      const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'secondary'; cancel.textContent = run.cancelling ? 'Cancelling…' : 'Cancel analysis'; cancel.disabled = run.cancelling;
      cancel.onclick = async () => { cancel.disabled = true; try { await request('/cancel-generation',{symbol:entry.symbol,runId:run.runId}); status.textContent = 'Analysis cancelled. Previous approved analysis is unchanged.'; } catch(error) { status.textContent = String(error.message || error); cancel.disabled = false; } };
      actions.append(status,cancel);
    }
    const gainPost = document.createElement('button'); gainPost.type = 'button'; gainPost.className = 'secondary'; gainPost.textContent = 'Post potential gain';
    gainPost.onclick = () => {
      if (window.parent === window) { window.alert('Open Watchlist Admin in the dashboard to preview and post the card.'); return; }
      window.parent.postMessage({ source: 'traderslink-watchlist-admin', type: 'post-potential-gain', symbol: entry.symbol }, window.location.origin);
    };
    actions.append(gainPost);
    const free = document.createElement('button'); free.type = 'button'; free.className = 'secondary'; free.textContent = 'Post to Free Chat';
    free.disabled = !entry.publicationReview?.cycleId;
    free.onclick = async () => {
      const dialog = document.createElement('dialog'); dialog.style.cssText = 'width:min(480px,90vw);max-height:85vh;overflow:auto';
      const heading = document.createElement('h2'); heading.textContent = entry.symbol + ' — Free Chat';
      const message = document.createElement('p'); message.setAttribute('role','status'); message.textContent = 'Loading…';
      const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Close'; close.onclick = () => dialog.close();
      dialog.append(heading,message,close); dialog.addEventListener('close',()=>dialog.remove()); document.body.append(dialog); dialog.showModal();
      const position = () => {
        if (window.parent === window || !window.frameElement) return;
        const frame = window.frameElement.getBoundingClientRect();
        const top = Math.max(0, -frame.top), bottom = Math.min(window.innerHeight, window.parent.innerHeight - frame.top);
        dialog.style.position = 'fixed'; dialog.style.margin = '0 auto'; dialog.style.left = '0'; dialog.style.right = '0';
        dialog.style.maxHeight = Math.max(120, bottom - top - 24) + 'px';
        dialog.style.top = Math.max(top + 12, top + (bottom - top - dialog.offsetHeight) / 2) + 'px';
      };
      position(); window.parent.addEventListener('scroll',position,true); window.parent.addEventListener('resize',position);
      dialog.addEventListener('close',()=>{window.parent.removeEventListener('scroll',position,true);window.parent.removeEventListener('resize',position);});
      try {
        let current = await request('/free-chat?symbol=' + encodeURIComponent(entry.symbol));
        const show = () => { const receipt = current.posts[0]; message.textContent = receipt ? (receipt.status_message || 'Free Chat: ' + receipt.state) + (receipt.sent_at_ms ? ' ' + new Date(receipt.sent_at_ms).toLocaleString() : '') : 'No Free Chat post sent for this ticker.'; };
        const label = document.createElement('label'), automatic = document.createElement('input'); automatic.type = 'checkbox'; automatic.style.width = 'auto'; automatic.checked = current.automaticEnabled;
        label.append(automatic,document.createTextNode(' Automatically post analysis updates to Free Chat'));
        const send = document.createElement('button'); send.type = 'button'; send.textContent = 'Post to Free Chat'; send.disabled = !current.hasPublishedAnalysis;
        const update = async body => {
          automatic.disabled = send.disabled = true;
          try { current = await request('/free-chat',Object.assign({symbol:entry.symbol,cycleId:current.cycleId},body)); automatic.checked = current.automaticEnabled; show(); }
          catch(error) { automatic.checked = current.automaticEnabled; message.textContent = String(error.message || error); }
          finally { automatic.disabled = false; send.disabled = !current.hasPublishedAnalysis; }
        };
        automatic.onchange = () => update({action:'automatic',enabled:automatic.checked});
        send.onclick = () => update({action:'send'});
        const check = document.createElement('button'); check.type = 'button'; check.textContent = 'Refresh delivery status'; check.onclick = async () => { try { current = await request('/free-chat?symbol=' + encodeURIComponent(entry.symbol)); show(); } catch(error) { message.textContent = String(error.message || error); } };
        dialog.insertBefore(label,close); dialog.insertBefore(send,close); dialog.insertBefore(check,close); show(); position();
      } catch(error) { message.textContent = String(error.message || error); }
    };
    actions.append(free);
    if (!entry.publicationReview?.required) return;
    const state = queue.get(entry.symbol);
    const status = document.createElement('p'); status.setAttribute('role', 'status');
    status.textContent = (state?.status || 'Review status unavailable. Check the owner session.') + (errors.has(entry.symbol) ? ' — ' + errors.get(entry.symbol) : '');
    actions.append(status);
    const notes = document.createElement('button'); notes.type = 'button'; notes.className = 'secondary'; notes.textContent = 'My notes';
    notes.disabled = !state?.cycleId || pending.has(entry.symbol);
    notes.onclick = () => {
      const key = state.cycleId;
      const dialog = document.createElement('dialog'); dialog.style.cssText = 'width:min(600px,90vw);max-height:85vh;overflow:auto';
      const title = document.createElement('h2'); title.textContent = entry.symbol + ' — My notes';
      const text = document.createElement('textarea'); text.rows = 10; text.maxLength = 12000; text.style.width = '100%'; text.setAttribute('aria-label','My notes');
      text.value = notesDrafts.has(key) ? notesDrafts.get(key) : entry.traderNotesDraft || '';
      text.oninput = () => notesDrafts.set(key,text.value);
      const message = document.createElement('p'); message.setAttribute('role','status');
      const save = document.createElement('button'); save.textContent = 'Save draft'; save.type = 'button';
      const publish = document.createElement('button'); publish.textContent = 'Publish notes'; publish.type = 'button';
      const close = document.createElement('button'); close.textContent = 'Close'; close.type = 'button'; close.className = 'secondary';
      const write = async (publishNow) => {
        save.disabled = publish.disabled = true; message.textContent = 'Saving notes…';
        try { await request('/save-notes',{symbol:entry.symbol,cycleId:state.cycleId,text:text.value,publish:publishNow});
          notesDrafts.set(key,text.value); message.textContent = publishNow ? 'Notes published.' : 'Draft saved. Not visible to members until published.';
          window.dispatchEvent(new Event('watchlist-review-updated'));
        } catch(error) { message.textContent = String(error.message || error); }
        finally { save.disabled = publish.disabled = false; }
      };
      save.onclick = () => write(false); publish.onclick = () => write(true); close.onclick = () => dialog.close();
      dialog.append(title,text,message,save); if(state.listed) dialog.append(publish); dialog.append(close);
      dialog.addEventListener('close',()=>dialog.remove()); document.body.append(dialog); dialog.showModal();
    };
    actions.append(notes);
    const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'secondary';
    edit.textContent = 'View / edit analysis'; edit.disabled = !state?.canReview || pending.has(entry.symbol);
    edit.onclick = () => {
      if (window.parent === window) { status.textContent = 'Open Watchlist Admin in the dashboard to edit the analysis card.'; return; }
      window.parent.postMessage({ source: 'traderslink-watchlist-admin', type: 'edit-analysis', symbol: entry.symbol }, window.location.origin);
    };
    actions.append(edit);
    if (state?.canPublishWithoutAnalysis) {
      const choice = document.createElement('label'); const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.style.width = 'auto';
      const key = state.cycleId + ':listing'; checkbox.checked = notificationChoices.get(key) !== false;
      checkbox.onchange = () => notificationChoices.set(key,checkbox.checked);
      choice.append(checkbox,document.createTextNode(' Notify users for ticker-only post')); actions.append(choice);
      const list = document.createElement('button'); list.type = 'button'; list.className = 'secondary';
      list.textContent = 'Publish ticker without analysis'; list.disabled = pending.has(entry.symbol);
      list.onclick = async () => {
        if (pending.has(entry.symbol)) return;
        pending.add(entry.symbol); errors.delete(entry.symbol); list.disabled = true; edit.disabled = true;
        status.textContent = 'Publishing ticker without analysis…';
        try {
          await request('/publish-without-analysis', { symbol: entry.symbol, cycleId: state.cycleId, expectedHead: state.expectedHead, notifyUsers: notificationChoices.get(state.cycleId + ":listing") !== false });
          status.textContent = 'Listing approved. Checking delivery status…';
        } catch (error) { errors.set(entry.symbol, String(error.message || error) + ' Check delivery status before retrying.'); }
        finally { pending.delete(entry.symbol); await refresh(); window.dispatchEvent(new Event('watchlist-review-updated')); }
      };
      actions.append(list);
    }
    const choiceKey = state?.cycleId + ':' + state?.draftRevision;
    if (state?.canReview) {
      const label = document.createElement('label'), choice = document.createElement('input'); choice.type = 'checkbox'; choice.style.width = 'auto';
      choice.checked = freeChatChoices.get(choiceKey) === true; choice.disabled = pending.has(entry.symbol);
      choice.onchange = () => freeChatChoices.set(choiceKey,choice.checked);
      label.append(choice,document.createTextNode(' Also post to Free Chat')); actions.append(label);
    }
    if (state?.listed) {
      const label = document.createElement('label');
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.style.width = 'auto';
      checkbox.checked = notificationChoices.get(choiceKey) === true; checkbox.disabled = pending.has(entry.symbol);
      checkbox.onchange = () => notificationChoices.set(choiceKey, checkbox.checked);
      label.append(checkbox, document.createTextNode(' Notify users')); actions.append(label);
    }
    const approve = document.createElement('button'); approve.type = 'button'; approve.textContent = state?.listed ? 'Approve and publish analysis' : 'Approve and publish';
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
          draftRevision: preview.draftRevision, previewHash: preview.previewHash, notifyUsers: notificationChoices.get(choiceKey) === true, freeChat: freeChatChoices.get(choiceKey) === true && preview.draftRevision === state.draftRevision });
        notificationChoices.delete(choiceKey);
        freeChatChoices.delete(choiceKey);
        status.textContent = 'Approval recorded. Checking publication status…';
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
