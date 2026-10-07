/** Owner console only. Uses the existing authenticated review API; never generates AI. */
export const WATCHLIST_ROW_REVIEW = String.raw`
<style>
li.watchlist-control-row { display:flex; flex-direction:column; align-items:stretch; }
.watchlist-control-row > .entry-main { width:100%; }
.entry-actions.watchlist-grouped-actions { display:flex; flex-direction:column; align-items:stretch; gap:8px; width:100%; min-width:0; }
.watchlist-action-group { display:flex; flex-wrap:wrap; align-items:center; justify-content:flex-start; gap:8px; min-width:0; }
.watchlist-action-group:empty { display:none; }
.watchlist-x-choice { display:inline-flex; align-items:center; gap:8px; max-width:100%; }
.watchlist-x-choice > label { display:inline-flex; align-items:center; gap:6px; margin:0; width:auto; }
.watchlist-x-choice > button { margin:0; min-height:40px; }
.watchlist-action-group > label { display:inline-flex; align-items:center; gap:6px; margin:0; width:auto; }
.watchlist-action-group input[type="checkbox"] { width:auto; margin:0; flex:none; }
.watchlist-action-group > button,.watchlist-action-group > select { min-height:40px; margin:0; width:auto; }
.watchlist-action-move > select { flex:0 1 260px; max-width:100%; }
.watchlist-review-status { margin:4px 0; }
.watchlist-action-more { border-top:1px solid rgba(148,163,184,.3); padding-top:8px; }
.watchlist-action-more > summary { cursor:pointer; font-weight:600; padding:4px 0 8px; }
.watchlist-action-remove { margin-top:8px; }
@media(max-width:600px) {
 .watchlist-action-group > button { min-height:44px; }
 .watchlist-action-group label { min-height:44px; cursor:pointer; }
 .watchlist-x-choice > button { min-height:44px; }
 .watchlist-action-move > select { flex:1 1 180px; min-width:0; }
 .watchlist-action-move > label { flex-basis:100%; }
}
.watchlist-action-section { min-width:0; padding:10px 0; border-bottom:1px solid #e2e8f0; }
.watchlist-action-section > .watchlist-action-group:not(:empty) + .watchlist-action-group:not(:empty) { margin-top:8px; }
.watchlist-action-section > h4 { margin:0 0 8px; font-size:13px; font-weight:700; }
.watchlist-action-section:has(> .watchlist-action-group:only-of-type:empty) { display:none; }
.watchlist-access-controls { display:flex; flex-direction:column; align-items:flex-start; gap:2px; width:100%; margin:0; padding:0; border:0; background:none; }
.watchlist-access-option { display:flex; flex-direction:column; gap:4px; min-width:0; }
.watchlist-access-option label { display:flex; align-items:center; gap:6px; margin:0; min-height:28px; padding:0; }
.watchlist-access-option small:empty { display:none; }
.watchlist-action-move { display:grid; grid-template-columns:minmax(160px,260px) auto; justify-content:start; }
.watchlist-action-move > label { grid-column:1 / -1; }
.watchlist-action-move > button { justify-self:start; }
.watchlist-diagnostics .meta { overflow-wrap:anywhere; }
@media(max-width:600px) {
 .watchlist-access-controls { gap:2px; }
 .watchlist-action-move { grid-template-columns:minmax(0,1fr) auto; width:100%; }
 .watchlist-action-move > select { width:100%; }
 .watchlist-action-group > button { max-width:100%; white-space:normal; }
}
.watchlist-analysis-publication-controls { display:flex; flex-direction:row; flex-wrap:wrap; align-items:center; gap:6px 10px; max-width:100%; }
.watchlist-analysis-publication-controls > button { margin:0; min-height:40px; max-width:100%; white-space:normal; }
.watchlist-analysis-publication-controls > label { display:flex; align-items:center; gap:6px; margin:0; width:auto; cursor:pointer; }
@media(max-width:600px) { .watchlist-analysis-publication-controls > button,.watchlist-analysis-publication-controls > label { min-height:44px; } }
</style>
<script>
(() => {
  let queue = new Map(), loading = null;
  const pending = new Set(), errors = new Map(), notificationChoices = new Map();
  const notesDrafts = new Map();
  const freeChatChoices = new Map();
  const discordTextDrafts=new Map();
  window.watchlistDiscordText={
    get:key=>discordTextDrafts.get(key),
    open:async(key,symbol,kind,to='')=>{
      const dialog=document.createElement('dialog');dialog.style.cssText='width:min(600px,92vw);max-height:85vh;overflow:auto';
      const title=document.createElement('h2');title.textContent=symbol+' — Edit Discord post';
      const text=document.createElement('textarea');text.rows=8;text.style.width='100%';text.setAttribute('aria-label','Discord post text');text.disabled=true;
      const fixed=document.createElement('p');fixed.style.whiteSpace='pre-wrap';
      const status=document.createElement('p');status.setAttribute('role','status');
      const use=document.createElement('button');use.type='button';use.textContent='Use text';use.disabled=true;
      const reset=document.createElement('button');reset.type='button';reset.textContent='Reset to generated text';reset.disabled=true;
      const close=document.createElement('button');close.type='button';close.textContent='Close';close.onclick=()=>dialog.close();
      dialog.append(title,text,fixed,status,use,reset,close);document.body.append(dialog);dialog.showModal();
      const position=()=>{if(window.parent===window||!window.frameElement)return;const f=window.frameElement.getBoundingClientRect(),top=Math.max(0,-f.top),bottom=Math.min(window.innerHeight,window.parent.innerHeight-f.top);dialog.style.position='fixed';dialog.style.margin='0 auto';dialog.style.left='0';dialog.style.right='0';dialog.style.top=(top+12)+'px';dialog.style.maxHeight=Math.max(120,bottom-top-24)+'px';};
      position();window.parent.addEventListener('scroll',position,true);window.parent.addEventListener('resize',position);
      dialog.addEventListener('close',()=>{window.parent.removeEventListener('scroll',position,true);window.parent.removeEventListener('resize',position);dialog.remove();});
      try{
        const generated=await request('/discord-text?symbol='+encodeURIComponent(symbol)+'&kind='+kind+'&to='+encodeURIComponent(to));
        if(!dialog.isConnected)return;
        text.value=discordTextDrafts.get(key)??generated.text;text.maxLength=generated.maxLength;
        fixed.textContent='Links and notification tags stay unchanged:'+generated.suffix;
        const validate=()=>{status.textContent=text.value.length+' / '+generated.maxLength+' characters. This does not send a post.';use.disabled=!text.value.trim()||text.value.length>generated.maxLength||/@(everyone|here)\b|<@/i.test(text.value);};
        text.disabled=reset.disabled=false;text.oninput=()=>{discordTextDrafts.set(key,text.value);validate();};
        reset.onclick=()=>{discordTextDrafts.delete(key);text.value=generated.text;validate();};
        use.onclick=()=>{discordTextDrafts.set(key,text.value);dialog.close();};validate();position();
      }catch(error){status.textContent=String(error.message||error);}
    }
  };

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
// Embedded in the existing Runtime owner-console IIFE by the exact-parent packager.
const xChoices = new Map();
function hasPublishableDraft(state) {
  return !!state && ['Ready for review', 'New draft — awaiting review', 'Replacement failed — previous version available'].includes(state.status);
}
function attachX(entry, actions, state, more = actions) {
  if(entry.watchlistGroup === "private")return;
  const cycleId = state?.cycleId || entry.publicationReview?.cycleId;
  if (!cycleId) return;
  const choiceKey = cycleId + ':' + state?.draftRevision;
  async function openX(forApproval) {
    const dialog=document.createElement('dialog'); dialog.style.cssText='width:min(580px,90vw);max-height:85vh;overflow:auto';
    const title=document.createElement('h2');title.textContent=entry.symbol+' — Post to X';
    const label=document.createElement('label');label.textContent='X caption';
    const text=document.createElement('textarea');text.rows=5;text.style.width='100%';text.setAttribute('aria-label','X caption');label.append(text);
    const counter=document.createElement('p');counter.setAttribute('aria-live','polite');counter.textContent='Checking characters…';
    const status=document.createElement('p');status.setAttribute('role','status');status.textContent='Loading…';
    const submit=document.createElement('button');submit.type='button';submit.textContent=forApproval?'Use caption when approving':'Post to X';submit.disabled=true;
    const check=document.createElement('button');check.type='button';check.textContent='Refresh delivery status';
    const retry=document.createElement('button');retry.type='button';retry.textContent='Retry X post';retry.hidden=true;
    const close=document.createElement('button');close.type='button';close.textContent='Close';close.onclick=()=>dialog.close();
    dialog.append(title,label,counter,status,submit,retry,check,close);document.body.append(dialog);dialog.showModal();
    const position=()=>{if(window.parent===window||!window.frameElement)return;const f=window.frameElement.getBoundingClientRect(),top=Math.max(0,-f.top),bottom=Math.min(window.innerHeight,window.parent.innerHeight-f.top);dialog.style.position='fixed';dialog.style.margin='0 auto';dialog.style.left='0';dialog.style.right='0';dialog.style.maxHeight=Math.max(120,bottom-top-24)+'px';dialog.style.top=Math.max(top+12,top+(bottom-top-dialog.offsetHeight)/2)+'px';};
    position();window.parent.addEventListener('scroll',position,true);window.parent.addEventListener('resize',position);
    let current=null,valid=false,version=0,timer=null,busy=false,selectionChanged=false;
    dialog.addEventListener('close',()=>{clearTimeout(timer);version++;window.parent.removeEventListener('scroll',position,true);window.parent.removeEventListener('resize',position);dialog.remove();});
    const enable=()=>{submit.disabled=busy||selectionChanged||!valid||!current?.configured||(!forApproval&&!current?.approvalRevision)||(!forApproval&&current.posts.some(p=>p.approvalRevision===current.approvalRevision));};
    const count=async()=>{const v=++version;valid=false;enable();try{const r=await request('/x-post',{action:'count',caption:text.value});if(v!==version||!dialog.isConnected)return;valid=r.valid;counter.textContent=r.count+' / '+r.limit+' characters';counter.style.color=r.count>r.limit||!r.valid?'#ef5350':'';enable();}catch{if(v===version){counter.textContent='Character count unavailable. Try again.';valid=false;enable();}}};
    text.oninput=()=>{version++;valid=false;enable();counter.textContent='Checking characters…';clearTimeout(timer);timer=setTimeout(count,200);};
    const show=()=>{status.textContent=current.posts[0]?.message || (forApproval?'Only posts to X after you approve this analysis.':'Posts the latest published analysis images.');retry.hidden=!current.posts[0]?.canRetry;enable();position();};
    try {
      current=await request('/x-post?symbol='+encodeURIComponent(entry.symbol));
      text.value=forApproval?(xChoices.get(choiceKey)?.caption || current.nextCaption):current.caption;
      if(!current.configured)status.textContent='Buffer X connection is not configured yet.';
      else show();await count();position();
      submit.onclick=async()=>{
        if(!valid||busy||selectionChanged)return;
        if(forApproval){xChoices.set(choiceKey,{caption:text.value,enabled:true});window.dispatchEvent(new Event('watchlist-review-updated'));dialog.close();return;}
        busy=true;enable();
        try {current=await request('/x-post',{action:'send',symbol:entry.symbol,cycleId:current.cycleId,approvalRevision:current.approvalRevision,caption:text.value});show();}
        catch(error){status.textContent=String(error.message||error);}
        finally {busy=false;enable();}
      };
      check.onclick=async()=>{try{const refreshed=await request('/x-post?symbol='+encodeURIComponent(entry.symbol));if(refreshed.cycleId!==current.cycleId||(!forApproval&&refreshed.approvalRevision!==current.approvalRevision)){selectionChanged=true;status.textContent='The published analysis changed. Close and reopen Post to X to select it.';enable();return;}current=refreshed;show();}catch(error){status.textContent=String(error.message||error);}};
      retry.onclick=async()=>{retry.disabled=true;try{current=await request('/x-post',{action:'retry',symbol:entry.symbol,cycleId:current.cycleId,postKey:current.posts[0].postKey});show();}catch(error){status.textContent=String(error.message||error);}finally{retry.disabled=false;}};
    }catch(error){status.textContent=String(error.message||error);}
  }
  const open=document.createElement('button');open.type='button';open.className='secondary';open.textContent='Post to X';open.onclick=()=>openX(false);more.append(open);
  if(state?.canReview && hasPublishableDraft(state)){
    const label=document.createElement('label'),choice=document.createElement('input');choice.type='checkbox';choice.style.width='auto';choice.checked=xChoices.get(choiceKey)?.enabled===true;
    choice.onchange=()=>{if(choice.checked){choice.checked=false;openX(true);}else{xChoices.delete(choiceKey);}};
    const xGroup=document.createElement('div');xGroup.className='watchlist-x-choice';
    label.append(choice,document.createTextNode(' Also post to X'));xGroup.append(label);actions.append(xGroup);
    const caption=document.createElement('button');caption.type='button';caption.className='secondary';caption.textContent='Edit X caption';caption.onclick=()=>openX(true);xGroup.append(caption);
  }
}

  const expandedActions = new Set();
  function groups(symbol, root, header) {
    root.classList.add('watchlist-grouped-actions');
    const make = label => { const group=document.createElement('div');group.className='watchlist-action-group';group.setAttribute('role','group');group.setAttribute('aria-label',label+' for '+symbol);return group; };
    const review=make('Review and publish'),options=make('Publishing options'),listing=make('Publish without analysis'),move=make('Move ticker'),more=make('Posting'),remove=make('Remove ticker'),access=make('Access'),settings=make('Settings'),diagnostics=make('Diagnostics');
    access.classList.add('watchlist-access-controls'); diagnostics.classList.add('watchlist-diagnostics');
    const section=(title,...groups)=>{const box=document.createElement('section'),heading=document.createElement('h4');box.className='watchlist-action-section';heading.textContent=title;box.append(heading,...groups);return box;};
    for(const detail of header.querySelectorAll('.meta:not(.error-line)')) diagnostics.append(detail);
    move.classList.add('watchlist-action-move');
    remove.classList.add('watchlist-action-remove');
    const details=document.createElement('details');details.className='watchlist-action-more';details.open=expandedActions.has(symbol);
    const summary=document.createElement('summary');summary.textContent='More actions';details.append(summary,section('Move',move),section('Posting',options,more),section('Settings',settings),section('Diagnostics',diagnostics),section('Remove',remove));
    details.addEventListener('toggle',()=>{if(details.isConnected){if(details.open)expandedActions.add(symbol);else expandedActions.delete(symbol);}});
    root.append(listing,review,access,details);return {review,options,listing,move,more,remove,header,access,settings,diagnostics};
  }
  function attach(entry, actions, more = actions, options = actions, header = actions, listing = actions) {
    if(entry.watchlistGroup === "private"){listing.hidden=true;const note=document.createElement("small");note.textContent="Private — only you can see this ticker. Move it to another list to publish.";header.append(note);}
    if (entry.analysisGeneration) {
      const run = entry.analysisGeneration;
      const elapsed = Math.max(0, Math.floor((Date.now() - run.startedAt) / 1000));
      const status = document.createElement('span'); status.setAttribute('role','status'); status.textContent = 'Analysis running · ' + Math.floor(elapsed / 60) + 'm ' + (elapsed % 60) + 's';
      const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'secondary'; cancel.textContent = run.cancelling ? 'Cancelling…' : 'Cancel analysis'; cancel.disabled = run.cancelling;
      cancel.onclick = async () => { cancel.disabled = true; try { await request('/cancel-generation',{symbol:entry.symbol,runId:run.runId}); status.textContent = 'Analysis cancelled. Previous approved analysis is unchanged.'; } catch(error) { status.textContent = String(error.message || error); cancel.disabled = false; } };
      actions.append(status,cancel);
    }
    const gainPost = document.createElement('button'); gainPost.type = 'button'; gainPost.className = 'secondary'; gainPost.textContent = 'Post potential gain';
    gainPost.onclick = () => {
      if (window.parent === window) { window.alert('Open Watchlist Admin in the dashboard to preview and post the card.'); return; }
      window.parent.postMessage({ source: 'traderslink-watchlist-admin', type: 'post-potential-gain', symbol: entry.symbol }, window.location.origin);
    };
    if(entry.watchlistGroup !== "private") more.append(gainPost);
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
    if(entry.watchlistGroup !== "private") more.append(free);
    attachX(entry,options,queue.get(entry.symbol),more);
    if (!entry.publicationReview?.required) return;
    const state = queue.get(entry.symbol);
    const status = document.createElement('p'); status.setAttribute('role', 'status');
    status.textContent = (state?.status || 'Review status unavailable. Check the owner session.') + (errors.has(entry.symbol) ? ' — ' + errors.get(entry.symbol) : '');
    status.className = 'watchlist-review-status'; (header.querySelector('.entry-title') || header).append(status);
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
    // Append after the analysis button to keep the primary action order stable.
    const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'secondary';
    edit.textContent = 'View / edit analysis'; edit.disabled = !state?.canReview || pending.has(entry.symbol);
    edit.onclick = () => {
      if (window.parent === window) { status.textContent = 'Open Watchlist Admin in the dashboard to edit the analysis card.'; return; }
      window.parent.postMessage({ source: 'traderslink-watchlist-admin', type: 'edit-analysis', symbol: entry.symbol }, window.location.origin);
    };
    actions.append(edit,notes);
    if (state?.canPublishWithoutAnalysis) {
      const choice = document.createElement('label'); const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.style.width = 'auto';
      const key = state.cycleId + ':listing'; checkbox.checked = notificationChoices.get(key) !== false;
      checkbox.onchange = () => notificationChoices.set(key,checkbox.checked);
      choice.append(checkbox,document.createTextNode(' Notify published without analysis')); listing.append(choice);
      const list = document.createElement('button'); list.type = 'button'; list.className = 'secondary';
      list.textContent = 'Publish ticker without analysis'; list.disabled = pending.has(entry.symbol);
      list.onclick = async () => {
        if (pending.has(entry.symbol)) return;
        pending.add(entry.symbol); errors.delete(entry.symbol); list.disabled = true; edit.disabled = true;
        status.textContent = 'Publishing ticker without analysis…';
        try {
          await request('/publish-without-analysis', { symbol: entry.symbol, cycleId: state.cycleId, expectedHead: state.expectedHead, discordText: window.watchlistDiscordText.get(state.cycleId+':listing'), notifyUsers: notificationChoices.get(state.cycleId + ":listing") !== false });
          status.textContent = 'Listing approved. Checking delivery status…';
        } catch (error) { errors.set(entry.symbol, String(error.message || error) + ' Check delivery status before retrying.'); }
        finally { pending.delete(entry.symbol); await refresh(); window.dispatchEvent(new Event('watchlist-review-updated')); }
      };
      const editPost=document.createElement('button');editPost.type='button';editPost.textContent='Edit Discord post';editPost.onclick=()=>window.watchlistDiscordText.open(state.cycleId+':listing',entry.symbol,'listing');listing.append(editPost);
      if(entry.watchlistGroup !== "private") listing.prepend(list);
    }
    const choiceKey = state?.cycleId + ':' + state?.draftRevision;
    if(entry.watchlistGroup !== "private" && state?.canReview&&hasPublishableDraft(state)){const editPost=document.createElement('button');editPost.type='button';editPost.textContent='Edit Discord post';editPost.onclick=()=>window.watchlistDiscordText.open(choiceKey,entry.symbol,'analysis');options.append(editPost);}
    if (entry.watchlistGroup !== "private" && state?.canReview && hasPublishableDraft(state)) {
      const label = document.createElement('label'), choice = document.createElement('input'); choice.type = 'checkbox'; choice.style.width = 'auto';
      choice.checked = freeChatChoices.get(choiceKey) === true; choice.disabled = pending.has(entry.symbol);
      choice.onchange = () => freeChatChoices.set(choiceKey,choice.checked);
      label.append(choice,document.createTextNode(' Also post to Free Chat')); options.prepend(label);
    }
    let analysisNotifyLabel = null;
    if (entry.watchlistGroup !== "private" && hasPublishableDraft(state)) {
      const label = document.createElement('label');
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.style.width = 'auto';
      checkbox.checked = notificationChoices.get(choiceKey) === true; checkbox.disabled = pending.has(entry.symbol);
      checkbox.onchange = () => notificationChoices.set(choiceKey, checkbox.checked);
      label.append(checkbox, document.createTextNode(' Notify Published')); analysisNotifyLabel = label;
    }
    const approve = document.createElement('button'); approve.type = 'button'; approve.textContent = state?.listed ? 'Approve and publish analysis' : 'Approve and publish';
    // Do not offer a second publication for an already approved version or while a replacement is running.
    const ready = hasPublishableDraft(state);
    approve.disabled = !ready || pending.has(entry.symbol);
    approve.onclick = async () => {
      if (pending.has(entry.symbol)) return;
      pending.add(entry.symbol); errors.delete(entry.symbol); approve.disabled = true; edit.disabled = true;
      status.textContent = 'Approving saved analysis…';
      try {
        const preview = await request('/preview?symbol=' + encodeURIComponent(entry.symbol));
        const approvalResult = await request('/approve', { symbol: entry.symbol, cycleId: preview.cycleId, expectedHead: preview.expectedHead,
          xPost: xChoices.get(choiceKey)?.enabled === true && preview.draftRevision === state.draftRevision,
          xCaption: xChoices.get(choiceKey)?.caption,
          discordText: preview.draftRevision===state.draftRevision?window.watchlistDiscordText.get(choiceKey):undefined, draftRevision: preview.draftRevision, previewHash: preview.previewHash, notifyUsers: notificationChoices.get(choiceKey) === true, freeChat: freeChatChoices.get(choiceKey) === true && preview.draftRevision === state.draftRevision });
        notificationChoices.delete(choiceKey);
        freeChatChoices.delete(choiceKey);
        xChoices.delete(choiceKey);
        if (approvalResult.xPostingWarning) errors.set(entry.symbol,approvalResult.xPostingWarning);
        status.textContent = approvalResult.xPostingWarning || 'Approval recorded. Checking publication status…';
      } catch (error) { errors.set(entry.symbol, String(error.message || error) + ' Check delivery status before retrying.'); status.textContent = errors.get(entry.symbol); }
      finally { pending.delete(entry.symbol); await refresh(); window.dispatchEvent(new Event('watchlist-review-updated')); }
    };
    if (entry.watchlistGroup !== "private" && (ready || pending.has(entry.symbol))) {
      const publicationControls = document.createElement('div'); publicationControls.className = 'watchlist-analysis-publication-controls';
      publicationControls.append(approve);
      if (analysisNotifyLabel) publicationControls.append(analysisNotifyLabel);
      actions.append(publicationControls);
    }
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
      more.append(recovery);
    }
  }
  window.watchlistRowReview = { refresh, attach, groups };
  window.addEventListener('message', event => {
    if (event.origin !== window.location.origin || event.source !== window.parent || event.data?.source !== 'traderslink-watchlist-editor' || event.data?.type !== 'saved') return;
    window.dispatchEvent(new Event('watchlist-review-updated'));
  });
})();
</script>`;
