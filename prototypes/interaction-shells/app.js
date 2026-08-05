// THROWAWAY PROTOTYPE: three interaction shells, switchable via ?variant=.
const variants = {
  A: 'Docked command deck',
  B: 'Inline story tools',
  C: 'Campaign workspace',
};

const state = {
  variant: normalizeVariant(new URLSearchParams(location.search).get('variant')),
  inventoryCount: 12,
  pendingChanges: 4,
  currentScene: 'House Harcourt — private wing',
  selectedRecord: 'silver-key',
  inlineDrawer: false,
  mobileChat: false,
  workspaceMobileView: 'detail',
  modal: null,
  notice: '',
  undo: null,
};

const records = [
  { id: 'silver-key', kind: 'Item', name: 'Silver Key', summary: 'A tarnished key bearing the magistrate seal.', tags: ['quest item', 'carried'] },
  { id: 'mage-hand', kind: 'Spell', name: 'Mage Hand', summary: 'Manipulate a small object at short range.', tags: ['available', 'utility'] },
  { id: 'mara', kind: 'NPC', name: 'Mara Venn', summary: 'Suspicious innkeeper hiding her brother’s involvement.', tags: ['present', 'distrustful'] },
  { id: 'stolen-seal', kind: 'Quest', name: 'The Stolen Seal', summary: 'Find who stole the magistrate’s seal.', tags: ['active', '2 leads'] },
  { id: 'blackwater', kind: 'Place', name: 'Blackwater Inn', summary: 'An old riverside inn with a sealed cellar.', tags: ['current region'] },
];

const app = document.querySelector('#app');

function normalizeVariant(value) {
  const key = String(value || 'A').toUpperCase();
  return Object.hasOwn(variants, key) ? key : 'A';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function commonTopbar() {
  return `
    <header class="st-topbar">
      <div class="st-avatar">R</div>
      <div class="st-title"><strong>RPG Companion</strong><small>House Harcourt · revision 44</small></div>
      <div class="top-spacer"></div>
      <button class="ghost-button" data-action="search">Search campaign</button>
      <button class="icon-button" aria-label="Settings" data-action="settings">⋯</button>
    </header>`;
}

function rail() {
  return `
    <aside class="st-rail" aria-label="Simulated SillyTavern navigation">
      <div class="rail-dot">☰</div>
      <div class="rail-dot">♟</div>
      <div class="rail-dot active">R</div>
      <div class="rail-dot">✦</div>
      <div class="rail-spacer"></div>
      <div class="rail-dot">⚙</div>
    </aside>`;
}

function messages({ inline = false } = {}) {
  return `
    <div class="message"><div class="message-meta">Narrator</div><p>Beyond the dressing-room door, footsteps stop. A key turns once in the lock, then hesitates.</p></div>
    ${inline ? `<div class="story-marker"><strong>${escapeHtml(state.currentScene)}</strong><small>Scene 7 · Mara is present · 2 open threads</small></div>` : ''}
    <div class="message player"><div class="message-meta">Lavitz</div><p>I pocket the silver key and ask Mara why her brother sealed the cellar.</p></div>
    <div class="message"><div class="message-meta">Narrator</div><p>Mara’s eyes flick toward your coat. “Some doors are closed for a reason,” she says, too quickly.</p></div>
    ${inline ? inlineStateCard() : ''}`;
}

function composer() {
  return `
    <div class="chat-composer">
      <button class="icon-button" aria-label="More chat actions">＋</button>
      <textarea aria-label="Chat message" placeholder="Write Lavitz's next action…"></textarea>
      <button class="send-button" aria-label="Send message">➤</button>
    </div>`;
}

function chatSurface({ inline = false, peek = false } = {}) {
  return `
    <main class="chat-surface${peek ? ' chat-peek' : ''}">
      <div class="chat-scroll">${messages({ inline })}</div>
      ${inline ? inlineTools() : ''}
      ${composer()}
      ${inline && state.inlineDrawer ? contextDrawer() : ''}
    </main>`;
}

function sceneActions() {
  return `
    <div class="action-row">
      <button class="solid-button" data-action="sync">Sync Story <span class="count-badge">${state.pendingChanges}</span></button>
      <button class="ghost-button" data-action="advance">Advance Scene</button>
    </div>`;
}

function variantA() {
  return `
    <div class="prototype-root variant-a ${state.mobileChat ? 'mobile-chat' : ''}">
      ${commonTopbar()}
      <div class="st-stage">
        ${rail()}
        <div class="shell-content">
          ${chatSurface()}
          <aside class="command-deck" aria-label="RPG command deck">
            <div class="deck-header">
              <div class="title-row"><div><span class="eyebrow">Current scene</span><h2>${escapeHtml(state.currentScene)}</h2><div class="body-copy">Mara is present · 2 open threads · context current</div></div><button class="icon-button" data-action="edit-scene" aria-label="Edit current scene">✎</button></div>
              <button class="ghost-button mobile-only" data-action="toggle-mobile-chat">← Back to SillyTavern chat</button>
              <div class="deck-tabs"><button class="active">Play</button><button data-action="browse">Campaign</button><button data-action="history">History</button></div>
            </div>
            <div class="deck-body">
              <section class="deck-card">
                <div class="title-row"><div><span class="eyebrow">Lavitz</span><h3>Character state</h3></div><button class="small-button" data-action="edit-character">Edit</button></div>
                <div class="resource-grid"><div class="resource"><strong>7/10</strong><span>Health</span></div><div class="resource"><strong>38</strong><span>Gold</span></div><div class="resource"><strong>1</strong><span>Condition</span></div></div>
              </section>
              <section class="deck-card">
                <div class="title-row"><div><span class="eyebrow">Story tools</span><h3>Continue play</h3></div></div>
                <p class="body-copy">Sync only when you want to reconcile recent chat. Advancing never forces change review.</p>
                ${sceneActions()}
              </section>
              <section class="deck-card">
                <div class="title-row"><div><span class="eyebrow">Inventory · ${state.inventoryCount}</span><h3>Scene-relevant items</h3></div><button class="small-button gold" data-action="add-item">+ Add</button></div>
                ${recordLine('Silver Key', 'Quest item · carried', 'silver-key')}
                ${recordLine('Iron Sword', 'Equipped · main hand', 'iron-sword')}
                ${recordLine('Healing Potion ×2', 'Consumable', 'potion')}
                <button class="small-button" data-action="browse">View all inventory</button>
              </section>
              <section class="deck-card">
                <div class="title-row"><div><span class="eyebrow">Active quest</span><h3>The Stolen Seal</h3></div><button class="small-button" data-action="edit-record" data-record="stolen-seal">✎</button></div>
                <p class="body-copy">Current lead: question Mara about the cellar entrance.</p>
              </section>
            </div>
          </aside>
        </div>
      </div>
    </div>`;
}

function recordLine(name, detail, id) {
  return `<div class="record-line"><div><strong>${escapeHtml(name)}</strong><small>${escapeHtml(detail)}</small></div><button class="small-button" data-action="edit-record" data-record="${escapeHtml(id)}" aria-label="Edit ${escapeHtml(name)}">✎</button></div>`;
}

function inlineStateCard() {
  return `
    <div class="inline-state-card">
      <div><span class="eyebrow">State used for this reply</span><strong>Lavitz · exhausted</strong><div class="mini-stats"><span>Health 7/10</span><span>${state.inventoryCount} items</span><span>Quest: Stolen Seal</span></div></div>
      <button class="small-button" data-action="toggle-inline">Inspect</button>
    </div>`;
}

function inlineTools() {
  return `
    <div class="inline-rpg-tools" aria-label="Inline RPG tools">
      <div class="scene-chip"><strong>${escapeHtml(state.currentScene)}</strong><small>Context revision 44</small></div>
      <button class="small-button" data-action="toggle-inline">State</button>
      <button class="small-button gold" data-action="sync">Sync <span class="count-badge">${state.pendingChanges}</span></button>
      <button class="small-button" data-action="advance">Advance</button>
      <button class="small-button" data-action="add-menu">＋</button>
    </div>`;
}

function contextDrawer() {
  return `
    <aside class="context-drawer">
      <div class="title-row"><div><span class="eyebrow">Contextual inspector</span><h2>Current RPG state</h2></div><button class="icon-button" data-action="toggle-inline" aria-label="Close inspector">×</button></div>
      <section class="deck-card"><strong>Inventory</strong><div class="body-copy">Silver Key · Iron Sword · Healing Potion ×2 · Rope · 8 more</div><div class="action-row"><button class="small-button gold" data-action="add-item">+ Add item</button><button class="small-button" data-action="browse">Open collection</button></div></section>
      <section class="deck-card"><strong>Present NPC</strong><div class="body-copy">Mara Venn — suspicious, distrustful</div><button class="small-button" data-action="edit-record" data-record="mara">Edit Mara</button></section>
      <section class="deck-card"><strong>Context capsule</strong><div class="body-copy">Revision 44 · 684 estimated tokens · current</div><button class="small-button" data-action="inspect-context">Inspect exact text</button></section>
    </aside>`;
}

function variantB() {
  return `
    <div class="prototype-root variant-b">
      ${commonTopbar()}
      <div class="st-stage">
        ${rail()}
        <div class="shell-content">${chatSurface({ inline: true })}</div>
      </div>
    </div>`;
}

function variantC() {
  const selected = records.find(record => record.id === state.selectedRecord) || records[0];
  return `
    <div class="prototype-root variant-c mobile-view-${state.workspaceMobileView}">
      ${commonTopbar()}
      <div class="st-stage">
        ${rail()}
        <div class="shell-content">
          <nav class="workspace-mobile-switcher" aria-label="Mobile workspace views">
            <button data-action="workspace-mobile" data-view="nav">Collections</button>
            <button data-action="workspace-mobile" data-view="list">Search</button>
            <button data-action="workspace-mobile" data-view="detail">Record</button>
            <button data-action="workspace-mobile" data-view="chat">Chat</button>
          </nav>
          <nav class="workspace-nav">
            <div class="workspace-brand"><span class="eyebrow">Campaign workspace</span><h2>House Harcourt</h2><small class="muted">Context revision 44</small></div>
            <button class="active">◎ Current scene</button>
            <div class="nav-section">Character</div>
            <button>♙ Character</button><button>▣ Inventory <span class="count-badge">${state.inventoryCount}</span></button><button>✧ Skills</button><button>✦ Spells</button>
            <div class="nav-section">Campaign</div>
            <button>♟ NPCs</button><button>⌖ Places</button><button>◇ Quests</button><button>↔ Relationships</button><button>◈ Facts</button><button>◷ Scenes</button>
            <div class="nav-section">Workflows</div>
            <button data-action="sync">↻ Changes Ready <span class="count-badge">${state.pendingChanges}</span></button><button data-action="history">↶ History & Undo</button>
          </nav>
          <section class="workspace-list">
            <div class="list-header"><span class="eyebrow">All campaign</span><input class="search-input" data-search placeholder="Search people, items, quests…"><div class="action-row" style="margin-top:8px"><button class="small-button gold" data-action="add-menu">+ New</button><button class="small-button">Filters</button></div></div>
            ${records.map(record => `<button class="list-record ${record.id === selected.id ? 'active' : ''}" data-action="select-record" data-record="${record.id}"><span class="eyebrow">${record.kind}</span><strong>${escapeHtml(record.name)}</strong><small>${escapeHtml(record.summary)}</small></button>`).join('')}
          </section>
          <main class="workspace-detail">
            <div class="detail-sheet">
              <div class="detail-hero"><div class="title-row"><div><span class="eyebrow">${escapeHtml(selected.kind)}</span><h1>${escapeHtml(selected.name)}</h1><p class="body-copy">${escapeHtml(selected.summary)}</p><div class="action-row">${selected.tags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div></div><button class="solid-button" data-action="edit-record" data-record="${selected.id}">Edit</button></div></div>
              <div class="field-grid">
                <div class="field-block"><label>Context status</label><strong>Included when relevant</strong><div class="body-copy">Source: current scene + recent mention</div></div>
                <div class="field-block"><label>Revision</label><strong>3</strong><div class="body-copy">Last changed moments ago</div></div>
                <div class="field-block wide"><label>Details</label><div class="body-copy">Long-form notes stay editable here. Only the compact summary and typed fields enter generation context unless explicitly pinned.</div></div>
                <div class="field-block wide"><label>Related records</label><div class="record-line"><div><strong>The Stolen Seal</strong><small>Active quest</small></div><button class="small-button" data-action="edit-record" data-record="stolen-seal">Open</button></div><button class="small-button gold" data-action="link-record">+ Link or create record</button></div>
              </div>
              <div class="action-row" style="margin-top:18px">${sceneActions()}</div>
            </div>
          </main>
          <aside class="workspace-chat-peek">${chatSurface({ peek: true })}</aside>
        </div>
      </div>
    </div>`;
}

function switcher() {
  return `
    <div class="prototype-warning">THROWAWAY UX PROTOTYPE</div>
    <nav class="prototype-switcher" aria-label="Prototype variants">
      <button data-action="previous-variant" aria-label="Previous variant">←</button>
      <div class="switcher-label"><strong>${state.variant} — ${variants[state.variant]}</strong><small>${state.inventoryCount} inventory · ${state.pendingChanges} changes · in-memory state</small></div>
      <button data-action="next-variant" aria-label="Next variant">→</button>
    </nav>`;
}

function syncModal() {
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="sync-title">
        <header class="modal-header"><div><span class="eyebrow">Sync Story · messages 118–126</span><h2 id="sync-title">${state.pendingChanges} editable changes</h2></div><button class="icon-button" data-action="close-modal" aria-label="Close">×</button></header>
        <div class="modal-body">
          ${proposal('Inventory', 'Add Silver Key ×1 to Lavitz', 'Source: “I pocket the silver key…”')}
          ${proposal('NPC · Mara Venn', 'Disposition: wary → distrustful', 'Source: Mara notices the key and refuses to explain.')}
          ${proposal('Quest · The Stolen Seal', 'New lead: Mara’s brother sealed the cellar', 'Source: latest exchange')}
          ${proposal('Scene', 'Open thread: Why was the cellar sealed?', 'Source: latest exchange')}
          <p class="body-copy">Nothing changes until applied. Each proposal can be edited, rejected, or deferred without blocking chat.</p>
        </div>
        <footer class="modal-footer"><button class="ghost-button" data-action="close-modal">Keep for later</button><button class="solid-button" data-action="apply-sync">Apply selected</button></footer>
      </section>
    </div>`;
}

function proposal(kind, change, source) {
  return `<div class="proposal"><label><input type="checkbox" checked><span><span class="eyebrow">${escapeHtml(kind)}</span><strong>${escapeHtml(change)}</strong><small>${escapeHtml(source)}</small></span></label><div class="action-row" style="margin-top:9px"><button class="small-button" data-action="edit-proposal">Edit</button><button class="small-button danger">Reject</button></div></div>`;
}

function advanceModal() {
  return `
    <div class="modal-backdrop">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="advance-title">
        <header class="modal-header"><div><span class="eyebrow">Advance Scene</span><h2 id="advance-title">Close private wing</h2></div><button class="icon-button" data-action="close-modal" aria-label="Close">×</button></header>
        <div class="modal-body">
          <div class="form-field"><label>Scene summary</label><textarea>Mara revealed that her brother sealed the inn cellar. Lavitz pocketed a silver key bearing the magistrate’s seal.</textarea></div>
          <div class="form-field"><label>Open threads</label><input value="Why was the cellar sealed? · What does Mara’s brother know?"></div>
          <div class="form-field"><label>Next scene</label><input value="The sealed cellar beneath Blackwater Inn"></div>
          <div class="form-field"><label>Opening situation</label><textarea>Lavitz follows the service stairs while Mara reluctantly leads the way. Someone is already moving below.</textarea></div>
          <p class="body-copy">Four Story Sync proposals will remain in Changes Ready. They do not block this transition.</p>
        </div>
        <footer class="modal-footer"><button class="ghost-button" data-action="manual-scene">Use blank manual form</button><button class="solid-button" data-action="complete-advance">Close and open next</button></footer>
      </section>
    </div>`;
}

function editModal(recordId) {
  const record = records.find(item => item.id === recordId) || records[0];
  return `
    <div class="modal-backdrop">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="edit-title">
        <header class="modal-header"><div><span class="eyebrow">Edit ${escapeHtml(record.kind)}</span><h2 id="edit-title">${escapeHtml(record.name)}</h2></div><button class="icon-button" data-action="close-modal" aria-label="Close">×</button></header>
        <div class="modal-body">
          <div class="form-field"><label>Name</label><input data-edit-name value="${escapeHtml(record.name)}"></div>
          <div class="form-field"><label>Context summary</label><textarea>${escapeHtml(record.summary)}</textarea></div>
          <div class="form-field"><label>Long details — not automatically injected</label><textarea>Editable campaign notes and description.</textarea></div>
          <div class="form-field"><label>Related quest</label><input value="The Stolen Seal"><button class="small-button gold" data-action="link-record">Choose existing or create new…</button></div>
        </div>
        <footer class="modal-footer"><button class="ghost-button" data-action="close-modal">Cancel</button><button class="solid-button" data-action="save-edit">Save</button></footer>
      </section>
    </div>`;
}

function addItemModal() {
  return `
    <div class="modal-backdrop">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="add-title">
        <header class="modal-header"><div><span class="eyebrow">Inventory · contextual create</span><h2 id="add-title">Add item here</h2></div><button class="icon-button" data-action="close-modal" aria-label="Close">×</button></header>
        <div class="modal-body">
          <div class="form-field"><label>Choose existing item</label><input placeholder="Search item library…"></div>
          <div class="form-field"><label>Or create a new item</label><input data-new-item value="Cellar map"></div>
          <div class="field-grid"><div class="form-field"><label>Quantity</label><input type="number" value="1"></div><div class="form-field"><label>Status</label><input value="Carried"></div></div>
          <div class="form-field"><label>Context summary</label><textarea>A rough map of tunnels beneath Blackwater Inn.</textarea></div>
        </div>
        <footer class="modal-footer"><button class="ghost-button" data-action="close-modal">Cancel</button><button class="solid-button" data-action="save-item">Create and add</button></footer>
      </section>
    </div>`;
}

function genericModal(title, copy) {
  return `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true"><header class="modal-header"><div><span class="eyebrow">Prototype workflow</span><h2>${escapeHtml(title)}</h2></div><button class="icon-button" data-action="close-modal">×</button></header><div class="modal-body"><p class="body-copy">${escapeHtml(copy)}</p></div><footer class="modal-footer"><button class="solid-button" data-action="close-modal">Done</button></footer></section></div>`;
}

function modal() {
  if (!state.modal) return '';
  if (state.modal.type === 'sync') return syncModal();
  if (state.modal.type === 'advance') return advanceModal();
  if (state.modal.type === 'edit') return editModal(state.modal.recordId);
  if (state.modal.type === 'add-item') return addItemModal();
  return genericModal(state.modal.title, state.modal.copy);
}

function render() {
  const body = state.variant === 'A' ? variantA() : state.variant === 'B' ? variantB() : variantC();
  app.innerHTML = `${body}${switcher()}${modal()}${state.notice ? notice() : ''}`;
}

function notice() {
  return `<div class="notice"><span>${escapeHtml(state.notice)}</span>${state.undo ? '<button class="small-button" data-action="undo">Undo</button>' : ''}</div>`;
}

function setVariant(next) {
  state.variant = next;
  const url = new URL(location.href);
  url.searchParams.set('variant', next);
  history.replaceState({}, '', url);
  state.modal = null;
  state.inlineDrawer = false;
  render();
}

function cycleVariant(direction) {
  const keys = Object.keys(variants);
  const index = keys.indexOf(state.variant);
  setVariant(keys[(index + direction + keys.length) % keys.length]);
}

function openGeneric(title, copy) {
  state.modal = { type: 'generic', title, copy };
  render();
}

app.addEventListener('click', event => {
  const control = event.target.closest('[data-action]');
  if (!control) return;
  const action = control.dataset.action;
  if (action === 'previous-variant') return cycleVariant(-1);
  if (action === 'next-variant') return cycleVariant(1);
  if (action === 'sync') state.modal = { type: 'sync' };
  else if (action === 'advance') state.modal = { type: 'advance' };
  else if (action === 'add-item' || action === 'add-menu') state.modal = { type: 'add-item' };
  else if (action === 'edit-record') state.modal = { type: 'edit', recordId: control.dataset.record || state.selectedRecord };
  else if (action === 'toggle-inline') state.inlineDrawer = !state.inlineDrawer;
  else if (action === 'toggle-mobile-chat') state.mobileChat = !state.mobileChat;
  else if (action === 'workspace-mobile') state.workspaceMobileView = control.dataset.view || 'detail';
  else if (action === 'select-record') state.selectedRecord = control.dataset.record;
  else if (action === 'close-modal') state.modal = null;
  else if (action === 'apply-sync') {
    const previous = state.pendingChanges;
    state.pendingChanges = 0;
    state.modal = null;
    state.notice = 'Applied 4 campaign changes · revision 45';
    state.undo = () => { state.pendingChanges = previous; state.notice = 'Story changes restored to review'; };
  } else if (action === 'save-item') {
    state.inventoryCount += 1;
    state.modal = null;
    state.notice = 'Cellar map created and added to Inventory';
    state.undo = () => { state.inventoryCount -= 1; state.notice = 'Item creation undone'; };
  } else if (action === 'save-edit') {
    state.modal = null;
    state.notice = 'Record saved · Context Capsule refreshed';
    state.undo = () => { state.notice = 'Record edit reverted'; };
  } else if (action === 'complete-advance') {
    const previous = state.currentScene;
    state.currentScene = 'Blackwater Inn — sealed cellar';
    state.modal = null;
    state.notice = 'Scene closed · Sealed cellar opened';
    state.undo = () => { state.currentScene = previous; state.notice = 'Scene transition reverted'; };
  } else if (action === 'undo') {
    const undo = state.undo;
    state.undo = null;
    if (undo) undo();
  } else if (action === 'browse') openGeneric('Campaign collections', 'Search, filter, create, and edit every built-in collection from one workspace.');
  else if (action === 'history') openGeneric('History and recovery', 'Recent revisions, closed scenes, and explicit restore actions appear here.');
  else if (action === 'inspect-context') openGeneric('Exact Context Capsule', '<RPG_CANON revision="44"> Inventory: Silver Key ×1; Iron Sword ×1…');
  else if (action === 'link-record') openGeneric('Link or create', 'Search existing records first. Create a new linked record without losing the parent draft.');
  else if (action === 'manual-scene') openGeneric('Manual scene transition', 'AI assistance is optional. Blank editable fields keep Advance Scene usable during model failure.');
  else if (action === 'search') openGeneric('Universal campaign search', 'Search names, aliases, tags, typed fields, scenes, and revision history.');
  else if (action === 'settings') openGeneric('Settings', 'Export, diagnostics, context inspection, and destructive actions live outside normal creation and editing.');
  else if (action === 'edit-character' || action === 'edit-scene' || action === 'edit-proposal') openGeneric('Inline editor', 'The selected content opens in a focused editor while preserving the current workflow.');
  else return;
  render();
});

app.addEventListener('input', event => {
  if (!event.target.matches('[data-search]')) return;
  const query = event.target.value.trim().toLowerCase();
  document.querySelectorAll('.list-record').forEach(row => {
    row.hidden = query && !row.textContent.toLowerCase().includes(query);
  });
});

document.addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  if (event.target.matches('input, textarea, [contenteditable]')) return;
  event.preventDefault();
  cycleVariant(event.key === 'ArrowLeft' ? -1 : 1);
});

window.addEventListener('popstate', () => {
  state.variant = normalizeVariant(new URLSearchParams(location.search).get('variant'));
  render();
});

render();
