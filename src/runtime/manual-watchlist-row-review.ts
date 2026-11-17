import { WATCHLIST_JSON_RESPONSE_READER } from './manual-watchlist-json-response.js';

/** Owner console only. Uses the existing authenticated review API; never generates AI. */
export const WATCHLIST_ROW_REVIEW = String.raw`
<style>
li.watchlist-control-row { display:flex; flex-direction:column; align-items:stretch; }
li.watchlist-control-row, li.watchlist-control-row:first-child { border-top:2px solid #64748B; }
.watchlist-control-row > .entry-main { width:100%; }
li.watchlist-control-row > .entry-main > .entry-title > strong:first-child { color:#EA580C; }
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
.watchlist-action-move { display:grid; grid-template-columns:minmax(0,1fr); width:100%; }
.watchlist-move-placement { display:grid; grid-template-columns:minmax(0,260px) auto; gap:8px; justify-content:start; align-items:start; }
.watchlist-move-placement > select,.watchlist-move-placement > button { margin:0; min-height:40px; }
.watchlist-move-placement > select { min-width:0; width:100%; }
.watchlist-action-move > button { justify-self:start; }
.watchlist-move-delivery { min-width:0; overflow-wrap:anywhere; }
.watchlist-move-delivery p { margin:8px 0; }
.watchlist-move-delivery button { margin:0 8px 8px 0; max-width:100%; white-space:normal; }
.watchlist-diagnostics .meta { overflow-wrap:anywhere; }
@media(max-width:600px) {
 .watchlist-access-controls { gap:2px; }
 .watchlist-move-placement { grid-template-columns:minmax(0,1fr); }
 .watchlist-move-placement > select,.watchlist-move-placement > button,.watchlist-move-delivery button { min-height:44px; }
 .watchlist-move-placement > button { justify-self:start; }
 .watchlist-action-group > button { max-width:100%; white-space:normal; }
}
.watchlist-analysis-publication-controls { display:flex; flex-direction:row; flex-wrap:wrap; align-items:center; gap:6px 10px; max-width:100%; }
.watchlist-analysis-publication-controls > button { margin:0; min-height:40px; max-width:100%; white-space:normal; }
.watchlist-analysis-publication-controls > label { display:flex; align-items:center; gap:6px; margin:0; width:auto; cursor:pointer; }
.watchlist-free-chat-preview { box-sizing:border-box; width:min(480px,90vw); max-height:85vh; overflow:auto; border:1px solid; border-radius:8px; padding:20px; background:Canvas; color:CanvasText; }
.watchlist-free-chat-preview h2 { margin:0 0 16px; }
.watchlist-free-chat-preview-copy { white-space:pre-wrap; overflow-wrap:anywhere; }
.watchlist-free-chat-message { box-sizing:border-box; display:block; width:100%; min-height:92px; margin:6px 0 12px; resize:vertical; }
.watchlist-free-chat-preview-actions > [hidden] { display:none; }
.watchlist-free-chat-preview-actions { display:flex; flex-wrap:wrap; gap:8px; }
.watchlist-free-chat-preview-actions > button { min-height:40px; padding:6px 12px; margin:0; }
@media(max-width:600px) { .watchlist-free-chat-preview-actions > button { min-height:44px; } }
@media(max-width:600px) { .watchlist-analysis-publication-controls > button,.watchlist-analysis-publication-controls > label { min-height:44px; } }
</style>
<script>
(() => {
  ${WATCHLIST_JSON_RESPONSE_READER}
  let queue = new Map(), loading = null;
  let reviewError = '';
  const pending = new Set(), errors = new Map(), notificationChoices = new Map();
  const notesDrafts = new Map();
  const freeChatChoices = new Map();

  const pendingMoveText = new Map();
  async function saveMoveText(key) {
    const draft = pendingMoveText.get(key);
    if (!draft) return null;
    const result = await request('/discord-text', draft);
    pendingMoveText.delete(key);
    return result;
  }

  window.watchlistDiscordText={
    get:()=>undefined,
    saveMoveText,
    open:async(key,symbol,kind,to='')=>{
      const dialog=document.createElement('dialog');dialog.style.cssText='width:min(600px,92vw);max-height:85vh;overflow:auto';
      const title=document.createElement('h2');title.textContent=symbol+' — Edit Discord post';
      const text=document.createElement('textarea');text.rows=8;text.style.width='100%';text.setAttribute('aria-label','Discord post text');text.disabled=true;
      const fixed=document.createElement('p');fixed.style.whiteSpace='pre-wrap';
      const status=document.createElement('p');status.setAttribute('role','status');
      const use=document.createElement('button');use.type='button';use.textContent='Save text';use.disabled=true;
      const reset=document.createElement('button');reset.type='button';reset.textContent='Reset to generated text';reset.disabled=true;
      const close=document.createElement('button');close.type='button';close.textContent='Close';close.onclick=()=>dialog.close();
      dialog.append(title,text,fixed,status,use,reset,close);document.body.append(dialog);dialog.showModal();
      dialog.addEventListener('cancel', event=>{if(close.disabled)event.preventDefault();});
      const position=()=>{if(window.parent===window||!window.frameElement)return;const f=window.frameElement.getBoundingClientRect(),top=Math.max(0,-f.top),bottom=Math.min(window.innerHeight,window.parent.innerHeight-f.top);dialog.style.position='fixed';dialog.style.margin='0 auto';dialog.style.left='0';dialog.style.right='0';dialog.style.top=(top+12)+'px';dialog.style.maxHeight=Math.max(120,bottom-top-24)+'px';};
      position();window.parent.addEventListener('scroll',position,true);window.parent.addEventListener('resize',position);
      dialog.addEventListener('close',()=>{window.parent.removeEventListener('scroll',position,true);window.parent.removeEventListener('resize',position);dialog.remove();});
      try{
        const generated=await request('/discord-text?symbol='+encodeURIComponent(symbol)+'&kind='+kind+'&to='+encodeURIComponent(to));
        if(!dialog.isConnected)return;
        let revision=generated.revision;
        const pending = kind==='move' ? pendingMoveText.get(key) : undefined;
        text.value=pending?.text??generated.draftText??generated.text;text.maxLength=generated.maxLength;
        fixed.textContent='Links and notification tags stay unchanged:'+generated.suffix;
        const validate=()=>{status.textContent=text.value.length+' / '+generated.maxLength+' characters. This does not send a post.';use.disabled=!text.value.trim()||text.value.length>generated.maxLength||/@(everyone|here)\b|<@/i.test(text.value);};
        text.disabled=reset.disabled=false;
        const markChanged=()=>{
          validate();
          if(kind==='move'){
            pendingMoveText.set(key,{symbol,kind,to,identity:generated.identity,revision:pending ? pending.revision : revision,text:text.value});
            status.textContent+=' Edits will be saved before the move posts.';
          }else status.textContent+=' Unsaved changes—select Save text.';
        };
        text.oninput=markChanged;
        const save=async(value)=>{
          use.disabled=reset.disabled=text.disabled=close.disabled=true;status.textContent='Saving post text…';
          try{
            const result=await request('/discord-text',{symbol,kind,to,identity:generated.identity,revision,text:value});
            if(kind==='move')pendingMoveText.delete(key);
            revision=result.revision;text.value=result.draftText??result.text;validate();
            status.textContent='Saved. This text will be used when you notify users.';
          }
          catch(error){status.textContent=String(error.message||error);}
          finally{text.disabled=reset.disabled=close.disabled=false;use.disabled=!text.value.trim()||text.value.length>generated.maxLength||/@(everyone|here)\b|<@/i.test(text.value);}
        };
        reset.onclick=()=>save(null);
        use.onclick=()=>save(text.value);if(pending)markChanged();else validate();position();
      }catch(error){status.textContent=String(error.message||error);}
    }
  };

  async function request(path, body) {
    const response = await fetch("/api/watchlist/analysis-review" + path, {
      method: body ? 'POST' : 'GET', cache: 'no-store', signal: AbortSignal.timeout(30000),
      headers: body ? { 'Content-Type': 'application/json', 'x-traderlink-journal-admin-request': '1' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    return readWatchlistJsonResponse(response);
  }
  window.watchlistConfirmFreeChat = async (symbol, mode, approvalRevision) => {
    const query = new URLSearchParams({symbol, preview:mode});
    if (Number.isSafeInteger(approvalRevision)) query.set('approvalRevision', String(approvalRevision));
    const result = await request('/free-chat?' + query);
    if (typeof result.preview?.content !== 'string' || typeof result.preview.includeImages !== 'boolean') {
      throw Error('Free Chat preview is unavailable.');
    }
    return new Promise(resolve => {
      const dialog = document.createElement('dialog');
      dialog.className = 'watchlist-free-chat-preview';
      dialog.setAttribute('aria-label','Free Chat preview');
      const title = document.createElement('h2'); title.textContent = 'Free Chat preview';
      const content = document.createElement('p');
      content.className = 'watchlist-free-chat-preview-copy';
      const heading = result.preview.content.match(/^\*\*(.+)\*\*/);
      if (heading) {
        const strong = document.createElement('strong'); strong.textContent = heading[1];
        content.append(strong,document.createTextNode(result.preview.content.slice(heading[0].length)));
      } else content.textContent = result.preview.content;
      const attachments = document.createElement('p');
      attachments.textContent = result.preview.includeImages ? 'Analysis images will be attached when available.' : 'Text-only post.';
      const message = document.createElement('p'); message.textContent = 'Premium settings are checked again at delivery.';
      const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'secondary';
      cancel.textContent = 'Cancel'; cancel.autofocus = true; cancel.onclick = () => dialog.close();
      const send = document.createElement('button'); send.type = 'button'; send.textContent = 'Confirm Free Chat post';
      send.onclick = () => dialog.close('send');
      const position = () => {
        if (window.parent === window || !window.frameElement) return;
        const frame = window.frameElement.getBoundingClientRect();
        const top = Math.max(0, -frame.top), bottom = Math.min(window.innerHeight, window.parent.innerHeight - frame.top);
        Object.assign(dialog.style,{position:'fixed',inset:(top+12)+'px 0 auto',margin:'0 auto',maxHeight:Math.max(120,bottom-top-24)+'px'});
      };
      const actions = document.createElement('div'); actions.className = 'watchlist-free-chat-preview-actions';
      actions.append(cancel, send);
      dialog.append(title, content, attachments, message, actions);
      dialog.addEventListener('close', () => {
        window.parent.removeEventListener('scroll',position,true); window.parent.removeEventListener('resize',position);
        dialog.remove(); resolve(dialog.returnValue === 'send');
      });
      document.body.append(dialog); dialog.showModal(); position();
      window.parent.addEventListener('scroll',position,true); window.parent.addEventListener('resize',position);
    });
  };
  async function refresh() {
    if (loading) return loading;
    loading = (async () => {
      try {
        const result = await request('/queue');
        if (!Array.isArray(result.tickers) || result.tickers.some(item => !item || typeof item.symbol !== 'string')) throw new Error('Review information is temporarily unavailable.');
        queue = new Map(result.tickers.map(item => [item.symbol, item]));
        reviewError = '';
      }
      catch (error) {
        reviewError = error.status === 401 || error.status === 403
          ? error.message : 'Review update delayed. Showing the last loaded review information.';
        if (error.status === 401 || error.status === 403) queue = new Map();
      }
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
    const gainPost = document.createElement('button'); gainPost.type = 'button'; gainPost.className = 'secondary'; gainPost.textContent = 'Post Gain';
    gainPost.onclick = () => {
      if (window.parent === window) { window.alert('Open Watchlist Admin in the dashboard to preview and post the card.'); return; }
      window.parent.postMessage({ source: 'traderslink-watchlist-admin', type: 'post-potential-gain', symbol: entry.symbol }, window.location.origin);
    };
    if(entry.watchlistGroup !== "private") more.append(gainPost);
    const lossPost = document.createElement('button'); lossPost.type = 'button'; lossPost.className = 'secondary'; lossPost.textContent = 'Post Loss';
    lossPost.onclick = () => {
      if (window.parent === window) { window.alert('Open Watchlist Admin in the dashboard to enter and preview the loss card.'); return; }
      window.parent.postMessage({ source: 'traderslink-watchlist-admin', type: 'post-manual-loss', symbol: entry.symbol }, window.location.origin);
    };
    if(entry.watchlistGroup !== "private") more.append(lossPost);
    const free = document.createElement('button'); free.type = 'button'; free.className = 'secondary'; free.textContent = 'Post to Free Chat';
    free.disabled = !entry.publicationReview?.cycleId;
    free.onclick = async () => {
      const dialog = document.createElement('dialog');
      dialog.className = 'watchlist-free-chat-preview';
      dialog.setAttribute('aria-label','Post to Free Chat');
      const heading = document.createElement('h2'); heading.textContent = entry.symbol + ' — Free Chat';
      const status = document.createElement('p'); status.setAttribute('role','status'); status.textContent = 'Loading…';
      const preview = document.createElement('section'); preview.hidden = true;
      const copy = document.createElement('p'); copy.className = 'watchlist-free-chat-preview-copy';
      const attachment = document.createElement('p');
      const messageLabel = document.createElement('label');
      const message = document.createElement('textarea'); message.className = 'watchlist-free-chat-message'; message.maxLength = 1200;
      messageLabel.append(document.createTextNode('Post message'),message);
      const privacy = document.createElement('p');
      preview.append(messageLabel,privacy,copy,attachment);
      const label = document.createElement('label');
      const automatic = document.createElement('input'); automatic.type = 'checkbox'; automatic.disabled = true; automatic.style.width = 'auto';
      label.append(automatic,document.createTextNode(' Automatically post analysis updates to Free Chat'));
      const close = document.createElement('button'); close.type = 'button'; close.className = 'secondary'; close.textContent = 'Close';
      close.onclick = () => dialog.close();
      const send = document.createElement('button'); send.type = 'button'; send.textContent = 'Confirm Free Chat post'; send.disabled = true;
      const check = document.createElement('button'); check.type = 'button'; check.className = 'secondary'; check.textContent = 'Check delivery status'; check.hidden = true;
      const actions = document.createElement('div'); actions.className = 'watchlist-free-chat-preview-actions';
      actions.append(close,send,check);
      dialog.append(heading,status,preview,label,actions); document.body.append(dialog); dialog.showModal();
      const position = () => {
        if (window.parent === window || !window.frameElement) return;
        const frame = window.frameElement.getBoundingClientRect();
        const top = Math.max(0,-frame.top), bottom = Math.min(window.innerHeight,window.parent.innerHeight-frame.top);
        Object.assign(dialog.style,{position:'fixed',inset:(top+12)+'px 0 auto',margin:'0 auto',maxHeight:Math.max(120,bottom-top-24)+'px'});
      };
      position(); window.parent.addEventListener('scroll',position,true); window.parent.addEventListener('resize',position);
      let current, timer, stopping = false, working = false, checksLeft = 0, requestBusy = false;
      dialog.addEventListener('close',()=>{
        stopping = true; clearTimeout(timer);
        window.parent.removeEventListener('scroll',position,true); window.parent.removeEventListener('resize',position);
        dialog.remove();
      });
      const path = '/free-chat?symbol=' + encodeURIComponent(entry.symbol);
      const waiting = () => ['pending','sending','retry'].includes(current?.delivery?.state);
      const canSend = () => !!current?.preview && (!current.delivery || current.delivery.state === 'failed');
      const renderPreview = () => {
        const value = current?.preview;
        preview.hidden = !value;
        if (!value) return;
        const title = document.createElement('strong');
        title.textContent = value.heading.replace(/^\*\*|\*\*$/g,'');
        copy.replaceChildren(title,document.createTextNode('\n\n'+(message.value.trim()||value.defaultMessage)+'\n\n'+value.footer));
        privacy.textContent = value.visibilityKey[0] === '1' ? 'Leave out the ticker, company name, and any details that identify it.' : '';
        privacy.hidden = !privacy.textContent;
        attachment.textContent = value.includeImages ? 'Analysis images will be attached when available.' : 'Text-only post.';
      };
      const syncControls = () => {
        automatic.disabled = working || !current;
        send.disabled = working || !canSend();
        send.textContent = current?.delivery?.state === 'failed' ? 'Retry Free Chat post' : 'Confirm Free Chat post';
        message.disabled = send.disabled;
      };
      const renderReceipt = () => {
        const receipt = current?.delivery;
        const messages = {pending:'Queued for Free Chat…',sending:'Posting to Free Chat…',sent:'Posted to Free Chat.'};
        const detail = receipt ? (messages[receipt.state] || receipt.status_message || 'Free Chat: '+receipt.state) : '';
        status.textContent = receipt
          ? detail+(receipt.sent_at_ms ? ' '+new Date(receipt.sent_at_ms).toLocaleString() : '')
          : current?.preview ? 'Review how the post will appear in Free Chat.' : 'Publish this ticker to the Watchlist before sharing it to Free Chat.';
        syncControls();
      };
      const scheduleCheck = () => {
        clearTimeout(timer);
        if (stopping || !waiting()) return;
        if (checksLeft > 0) timer = setTimeout(refreshDelivery, 3500);
        else check.hidden = false;
      };
      async function refreshDelivery() {
        if (stopping || !current?.approvalRevision || requestBusy) return;
        requestBusy = true; checksLeft--;
        try {
          const query = new URLSearchParams({cycleId:current.cycleId,delivery:String(current.approvalRevision)});
          const result = await request(path+'&'+query);
          if (!stopping) { current.delivery = result.delivery; check.hidden = true; renderReceipt(); }
        } catch {
          if (!stopping) { check.hidden = false; status.textContent = 'Delivery status could not refresh. Check again.'; }
        } finally { requestBusy = false; scheduleCheck(); }
      }
      check.onclick = () => { checksLeft = 30; void refreshDelivery(); };
      message.oninput = renderPreview;
      automatic.onchange = async () => {
        working = true; syncControls();
        try {
          const result = await request('/free-chat',{action:'automatic',symbol:entry.symbol,cycleId:current.cycleId,enabled:automatic.checked});
          current.automaticEnabled = result.automaticEnabled;
        } catch (error) { status.textContent = String(error.message || error); }
        finally { automatic.checked = current.automaticEnabled; working = false; syncControls(); }
      };
      send.onclick = async () => {
        if (working || !canSend()) return;
        working = true; syncControls(); status.textContent = 'Queuing Free Chat post…';
        try {
          const result = await request('/free-chat',{
            action:'send', symbol:entry.symbol,cycleId:current.cycleId,approvalRevision:current.approvalRevision,
            visibilityKey:current.preview.visibilityKey,message:message.value,
          });
          if (!stopping) { current = result; renderPreview(); renderReceipt(); checksLeft = 30; scheduleCheck(); }
        } catch (error) {
          if (!stopping) status.textContent = String(error.message || error);
        } finally { working = false; syncControls(); }
      };
      try {
        current = await request(path);
        if (!stopping) {
          automatic.checked = current.automaticEnabled; message.value = current.savedMessage ?? current.preview?.defaultMessage ?? '';
          renderPreview(); renderReceipt(); checksLeft = 30; scheduleCheck(); position();
        }
      } catch (error) { if (!stopping) status.textContent = String(error.message || error); }
    };
    if(entry.watchlistGroup !== "private") more.append(free);
    const cachedState = queue.get(entry.symbol);
    const state = cachedState && (!entry.publicationReview?.cycleId || cachedState.cycleId === entry.publicationReview.cycleId) ? cachedState : undefined;
    attachX(entry,options,state,more);
    if (!entry.publicationReview?.required) return;
    const status = document.createElement('p'); status.setAttribute('role', 'status');
    status.textContent = (state?.status || 'Review information is temporarily unavailable.') + (reviewError ? ' — ' + (state || reviewError.includes('Sign in again') ? reviewError : 'Waiting for review information to reconnect.') : '') + (errors.has(entry.symbol) ? ' — ' + errors.get(entry.symbol) : '');
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
    const history = document.createElement('button'); history.type = 'button'; history.className = 'secondary';
    history.textContent = 'Previous analyses'; history.disabled = !state?.cycleId;
    history.onclick = () => {
      if (window.parent === window) { status.textContent = 'Open Watchlist Admin in the dashboard to view previous analysis cards.'; return; }
      window.parent.postMessage({ source: 'traderslink-watchlist-admin', type: 'previous-analyses', symbol: entry.symbol, cycleId: state.cycleId }, window.location.origin);
    };
    actions.append(edit,history,notes);
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
        const freeChat = freeChatChoices.get(choiceKey) === true && preview.draftRevision === state.draftRevision;
        if (freeChat && !await window.watchlistConfirmFreeChat(entry.symbol,'approval')) return;
        const approvalResult = await request('/approve', { symbol: entry.symbol, cycleId: preview.cycleId, expectedHead: preview.expectedHead,
          xPost: xChoices.get(choiceKey)?.enabled === true && preview.draftRevision === state.draftRevision,
          xCaption: xChoices.get(choiceKey)?.caption,
          discordText: preview.draftRevision===state.draftRevision?window.watchlistDiscordText.get(choiceKey):undefined, draftRevision: preview.draftRevision, previewHash: preview.previewHash, notifyUsers: notificationChoices.get(choiceKey) === true, freeChat });
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
