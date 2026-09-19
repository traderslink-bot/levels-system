export const WATCHLIST_DISCORD_MENTIONS_PANEL = String.raw`
<section id="watchlist-discord-notifications">
  <h2>Discord notifications</h2>
  <label><input type="checkbox" id="discord-mention-everyone" style="width:auto" disabled> Mention @everyone</label>
  <div id="discord-mention-roles" style="display:grid;gap:12px;margin:16px 0"></div>
  <button type="button" id="discord-mention-add" disabled>Add role</button>
  <button type="button" id="discord-mention-save" disabled>Save mentions</button>
  <p>Applies to future Watchlist Discord notifications. Removing a role here does not delete it from Discord. Channel permissions still control who can read posts.</p>
  <p>To find a role ID, enable Developer Mode in Discord, then use Copy Role ID on the role. Discord must allow the webhook or bot to mention that role.</p>
  <p id="discord-mention-status" role="status" aria-live="polite"></p>
</section>
<script>
(() => {
  const root = document.getElementById('watchlist-discord-notifications');
  const everyone = document.getElementById('discord-mention-everyone');
  const roles = document.getElementById('discord-mention-roles');
  const add = document.getElementById('discord-mention-add');
  const save = document.getElementById('discord-mention-save');
  const status = document.getElementById('discord-mention-status');
  let busy = true;
  const lock = value => { busy = value; root.querySelectorAll('input,button').forEach(el => { el.disabled = value; }); };
  function row(value = {id:'',label:'',enabled:true}) {
    const group = document.createElement('fieldset'); group.style.minWidth = '0';
    const legend = document.createElement('legend'); legend.textContent = 'Role mention'; group.append(legend);
    for (const [key, text, type] of [['label','Role label','text'],['id','Discord role ID','text'],['enabled','Enabled','checkbox']]) {
      const label = document.createElement('label'); label.textContent = text + ' ';
      const input = document.createElement('input'); input.type = type; input.dataset.field = key;
      if (type === 'checkbox') { input.checked = value.enabled; input.style.width = 'auto'; }
      else { input.value = value[key]; input.maxLength = key === 'id' ? 20 : 80; if(key === 'id') input.inputMode = 'numeric'; }
      label.append(input); group.append(label);
    }
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove role'; remove.onclick = () => { if(!busy) group.remove(); }; group.append(remove); roles.append(group);
  }
  async function request(body) {
    const response = await fetch("/api/watchlist/analysis-review/discord-mentions", { method: body ? 'POST':'GET', cache:'no-store', signal:AbortSignal.timeout(15000),
      headers:body ? {'content-type':'application/json','x-traderlink-journal-admin-request':'1'} : {}, body:body ? JSON.stringify(body):undefined });
    const result = await response.json(); if(!response.ok) throw new Error(result.error || 'Could not load or save mention settings.'); return result.settings;
  }
  add.onclick = () => { if(!busy && roles.children.length < 20) row(); };
  save.onclick = async () => {
    if(busy) return;
    const settings = { everyone:everyone.checked, roles:Array.from(roles.children).map(group => ({id:group.querySelector('[data-field=id]').value.trim(),label:group.querySelector('[data-field=label]').value.trim(),enabled:group.querySelector('[data-field=enabled]').checked})) };
    if(settings.roles.some(r => !/^\d{17,20}$/.test(r.id) || !r.label) || new Set(settings.roles.map(r=>r.id)).size !== settings.roles.length) { status.textContent = 'Enter a label and a unique Discord role ID for each role.'; return; }
    lock(true); status.textContent = 'Saving…';
    try { await request(settings); status.textContent = 'Mention settings saved for future Discord notifications.'; } catch(error) { status.textContent = error.message; } finally {lock(false);}
  };
  request().then(settings => { everyone.checked = settings.everyone; settings.roles.forEach(row); lock(false); }).catch(error => {status.textContent=error.message + ' Reload this page to try again.';});
})();
</script>`;
