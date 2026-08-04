const RPG_WORKSPACE_ID = 'rpg-workspace-boundary-spike';
const RPG_WORKSPACE_LAYOUT_KEY = `${RPG_WORKSPACE_ID}:layout`;
const RPG_WORKSPACE_DRAFT_KEY = `${RPG_WORKSPACE_ID}:drafts`;

const sampleRecords = [
  { id: 'wardrobe-key', type: 'Item', name: 'Wardrobe key', summary: 'A small iron key taken from the east dressing room.', tags: 'key, house-harcourt' },
  { id: 'mage-hand', type: 'Spell', name: 'Mage hand', summary: 'Manipulate a small unattended object at short range.', tags: 'utility, telekinesis' },
  { id: 'house-expectations', type: 'Quest', name: 'House Expectations', summary: 'Navigate House Harcourt’s rituals without losing Lavir’s trust.', tags: 'active, house-harcourt' },
  { id: 'lavir', type: 'NPC', name: 'Lavir', summary: 'Sole heir to House Harcourt; composed, observant, and under pressure.', tags: 'ally, noble' },
];

const state = {
  open: false,
  activeChatKey: '',
  activeChatTitle: '',
  activeRecordId: sampleRecords[0].id,
  mobilePane: 'editor',
  layout: readJson(localStorage, RPG_WORKSPACE_LAYOUT_KEY, {
    collections: true,
    records: true,
    chat: true,
  }),
  drafts: readJson(sessionStorage, RPG_WORKSPACE_DRAFT_KEY, {}),
  returnFocus: null,
};

function readJson(storage, key, fallback) {
  try {
    const parsed = JSON.parse(storage.getItem(key));
    return parsed && typeof parsed === 'object' ? parsed : structuredClone(fallback);
  } catch {
    return structuredClone(fallback);
  }
}

function writeJson(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn('[RPG Workspace boundary spike] Could not persist prototype state.', error);
  }
}

function getContext() {
  return globalThis.SillyTavern?.getContext?.() ?? null;
}

function currentChatIdentity() {
  const context = getContext();
  let currentChatId = '';

  try {
    currentChatId = context?.getCurrentChatId?.() ?? '';
  } catch {
    currentChatId = '';
  }

  const key = String(
    currentChatId
      || context?.chatId
      || context?.chatMetadata?.main_chat
      || context?.groupId
      || `character:${context?.characterId ?? 'unbound'}`,
  );

  return {
    key,
    title: String(currentChatId || context?.chatId || context?.chatMetadata?.main_chat || 'Current SillyTavern chat'),
  };
}

function defaultDraft(recordId) {
  const record = sampleRecords.find(candidate => candidate.id === recordId) ?? sampleRecords[0];
  return {
    name: record.name,
    type: record.type,
    summary: record.summary,
    details: '',
    tags: record.tags,
    dirty: false,
  };
}

function chatDrafts() {
  if (!state.drafts[state.activeChatKey]) {
    state.drafts[state.activeChatKey] = {};
  }
  return state.drafts[state.activeChatKey];
}

function activeDraft() {
  const drafts = chatDrafts();
  if (!drafts[state.activeRecordId]) {
    drafts[state.activeRecordId] = defaultDraft(state.activeRecordId);
  }
  return drafts[state.activeRecordId];
}

function persistDrafts() {
  writeJson(sessionStorage, RPG_WORKSPACE_DRAFT_KEY, state.drafts);
}

function persistLayout() {
  writeJson(localStorage, RPG_WORKSPACE_LAYOUT_KEY, state.layout);
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function workspaceMarkup() {
  return `
    <section id="${RPG_WORKSPACE_ID}" class="rpgws" role="dialog" aria-modal="true" aria-label="RPG Campaign workspace" aria-hidden="true">
      <header class="rpgws__topbar">
        <div class="rpgws__brand">
          <span class="rpgws__prototype">BOUNDARY SPIKE</span>
          <strong>Campaign Workspace</strong>
          <span id="rpgws-chat-title" class="rpgws__chat-title"></span>
        </div>
        <div id="rpgws-restore-controls" class="rpgws__restore-controls" aria-label="Panel visibility"></div>
        <button type="button" class="rpgws__button" data-rpgws-action="close">Return to chat</button>
      </header>

      <nav class="rpgws__mobile-nav" aria-label="Workspace sections">
        <button type="button" data-rpgws-mobile="collections">Collections</button>
        <button type="button" data-rpgws-mobile="records">Records</button>
        <button type="button" data-rpgws-mobile="editor">Editor</button>
        <button type="button" data-rpgws-mobile="chat">Chat</button>
      </nav>

      <div class="rpgws__body">
        <aside class="rpgws__panel rpgws__collections" data-rpgws-panel="collections">
          <div class="rpgws__panel-heading">
            <strong>Collections</strong>
            <button type="button" class="rpgws__icon-button" data-rpgws-hide="collections" aria-label="Hide collections panel" title="Hide collections panel">×</button>
          </div>
          <button type="button" class="rpgws__collection is-active">All records <span>4</span></button>
          <button type="button" class="rpgws__collection">Character <span>1</span></button>
          <button type="button" class="rpgws__collection">Inventory <span>1</span></button>
          <button type="button" class="rpgws__collection">Abilities <span>1</span></button>
          <button type="button" class="rpgws__collection">People <span>1</span></button>
          <button type="button" class="rpgws__collection">Objectives <span>1</span></button>
          <button type="button" class="rpgws__collection">World <span>0</span></button>
          <div class="rpgws__collection-actions">
            <button type="button" class="rpgws__primary" data-rpgws-action="new-record">+ New here</button>
            <button type="button" class="rpgws__button" data-rpgws-action="sync">Sync Story</button>
            <button type="button" class="rpgws__button" data-rpgws-action="advance">Advance Scene</button>
          </div>
        </aside>

        <aside class="rpgws__panel rpgws__records" data-rpgws-panel="records">
          <div class="rpgws__panel-heading">
            <strong>Records</strong>
            <button type="button" class="rpgws__icon-button" data-rpgws-hide="records" aria-label="Hide records panel" title="Hide records panel">×</button>
          </div>
          <label class="rpgws__search">
            <span class="sr-only">Search records</span>
            <input id="rpgws-search" type="search" placeholder="Search campaign…" autocomplete="off">
          </label>
          <div id="rpgws-record-list" class="rpgws__record-list"></div>
        </aside>

        <main class="rpgws__editor" data-rpgws-panel="editor">
          <div class="rpgws__editor-heading">
            <div>
              <span class="rpgws__eyebrow">EDIT RECORD</span>
              <h2 id="rpgws-editor-title">Record</h2>
            </div>
            <span id="rpgws-dirty" class="rpgws__dirty">Draft preserved</span>
          </div>
          <form id="rpgws-form" class="rpgws__form">
            <label>Name<input name="name" autocomplete="off"></label>
            <label>Type<select name="type"><option>Item</option><option>Spell</option><option>Skill</option><option>NPC</option><option>Quest</option><option>Fact</option></select></label>
            <label class="rpgws__wide">Summary<textarea name="summary" rows="3"></textarea><small>Short, context-ready description.</small></label>
            <label class="rpgws__wide">Details<textarea name="details" rows="8" placeholder="Long notes stay editable but are not automatically injected."></textarea></label>
            <label class="rpgws__wide">Tags<input name="tags" autocomplete="off" placeholder="utility, house-harcourt"></label>
          </form>
          <div class="rpgws__editor-actions">
            <span>This prototype writes no Campaign data.</span>
            <button type="button" class="rpgws__button" data-rpgws-action="reset-draft">Reset draft</button>
            <button type="button" class="rpgws__primary" data-rpgws-action="keep-draft">Keep draft</button>
          </div>
        </main>

        <aside class="rpgws__panel rpgws__chat" data-rpgws-panel="chat">
          <div class="rpgws__panel-heading">
            <strong>Chat peek</strong>
            <button type="button" class="rpgws__icon-button" data-rpgws-hide="chat" aria-label="Hide chat preview" title="Hide chat preview">×</button>
          </div>
          <p class="rpgws__hint">Read-only. Native SillyTavern remains the only chat composer.</p>
          <div id="rpgws-chat-preview" class="rpgws__chat-preview"></div>
          <button type="button" class="rpgws__primary rpgws__return" data-rpgws-action="close">Return to SillyTavern chat</button>
        </aside>
      </div>
    </section>
  `;
}

function launcherMarkup() {
  return `
    <button id="rpgws-launcher" type="button" aria-controls="${RPG_WORKSPACE_ID}" aria-expanded="false" title="Open Campaign Workspace">
      <span aria-hidden="true">R</span>
      <span>Campaign</span>
    </button>
  `;
}

function renderRecords(query = '') {
  const list = document.querySelector('#rpgws-record-list');
  if (!list) return;

  const normalizedQuery = query.trim().toLowerCase();
  const matches = sampleRecords.filter(record => [record.name, record.type, record.summary, record.tags]
    .join(' ')
    .toLowerCase()
    .includes(normalizedQuery));

  list.replaceChildren();
  for (const record of matches) {
    const button = createElement('button', 'rpgws__record');
    button.type = 'button';
    button.dataset.recordId = record.id;
    button.classList.toggle('is-active', record.id === state.activeRecordId);
    button.append(
      createElement('span', 'rpgws__record-type', record.type),
      createElement('strong', '', activeDraftForRecord(record.id).name),
      createElement('span', 'rpgws__record-summary', activeDraftForRecord(record.id).summary),
    );
    list.appendChild(button);
  }

  if (!matches.length) {
    list.appendChild(createElement('p', 'rpgws__empty', 'No matching records.'));
  }
}

function activeDraftForRecord(recordId) {
  const drafts = chatDrafts();
  if (!drafts[recordId]) drafts[recordId] = defaultDraft(recordId);
  return drafts[recordId];
}

function renderEditor() {
  const form = document.querySelector('#rpgws-form');
  if (!form) return;
  const draft = activeDraft();

  for (const field of ['name', 'type', 'summary', 'details', 'tags']) {
    form.elements[field].value = draft[field] ?? '';
  }

  document.querySelector('#rpgws-editor-title').textContent = draft.name || 'Untitled record';
  renderDirtyState();
}

function renderDirtyState() {
  const indicator = document.querySelector('#rpgws-dirty');
  if (!indicator) return;
  const dirty = activeDraft().dirty;
  indicator.textContent = dirty ? 'Unsaved draft preserved' : 'Draft preserved';
  indicator.classList.toggle('is-dirty', dirty);
}

function renderChatPreview() {
  const preview = document.querySelector('#rpgws-chat-preview');
  if (!preview) return;
  const chat = Array.isArray(getContext()?.chat) ? getContext().chat.slice(-6) : [];
  preview.replaceChildren();

  if (!chat.length) {
    preview.appendChild(createElement('p', 'rpgws__empty', 'No messages in the current chat.'));
    return;
  }

  for (const message of chat) {
    const article = createElement('article', 'rpgws__message');
    const speaker = message?.name || (message?.is_user ? 'You' : 'Character');
    article.append(
      createElement('strong', '', String(speaker)),
      createElement('p', '', String(message?.mes ?? '').slice(0, 500)),
    );
    preview.appendChild(article);
  }
}

function renderLayout() {
  const root = document.querySelector(`#${RPG_WORKSPACE_ID}`);
  if (!root) return;

  for (const panelName of ['collections', 'records', 'chat']) {
    const panel = root.querySelector(`[data-rpgws-panel="${panelName}"]`);
    panel.hidden = !state.layout[panelName];
  }

  root.dataset.mobilePane = state.mobilePane;
  const restoreControls = root.querySelector('#rpgws-restore-controls');
  restoreControls.replaceChildren();

  for (const [panelName, label] of Object.entries({ collections: 'Collections', records: 'Records', chat: 'Chat peek' })) {
    const button = createElement('button', 'rpgws__panel-toggle', label);
    button.type = 'button';
    button.dataset.rpgwsToggle = panelName;
    button.setAttribute('aria-pressed', String(Boolean(state.layout[panelName])));
    button.title = state.layout[panelName] ? `Hide ${label}` : `Show ${label}`;
    restoreControls.appendChild(button);
  }

  for (const button of root.querySelectorAll('[data-rpgws-mobile]')) {
    button.classList.toggle('is-active', button.dataset.rpgwsMobile === state.mobilePane);
  }
}

function renderChatIdentity() {
  const identity = currentChatIdentity();
  state.activeChatKey = identity.key;
  state.activeChatTitle = identity.title;
  const title = document.querySelector('#rpgws-chat-title');
  if (title) title.textContent = identity.title;
}

function activateCurrentChat() {
  persistDrafts();
  renderChatIdentity();
  activeDraft();
  renderRecords(document.querySelector('#rpgws-search')?.value ?? '');
  renderEditor();
  renderChatPreview();
}

function openWorkspace(trigger) {
  const root = document.querySelector(`#${RPG_WORKSPACE_ID}`);
  const launcher = document.querySelector('#rpgws-launcher');
  if (!root) return;
  state.returnFocus = trigger instanceof HTMLElement ? trigger : document.activeElement;
  state.open = true;
  root.classList.add('is-open');
  root.setAttribute('aria-hidden', 'false');
  launcher?.setAttribute('aria-expanded', 'true');
  activateCurrentChat();
  root.querySelector('[data-rpgws-action="close"]')?.focus();
}

function closeWorkspace() {
  const root = document.querySelector(`#${RPG_WORKSPACE_ID}`);
  const launcher = document.querySelector('#rpgws-launcher');
  if (!root) return;
  persistDrafts();
  state.open = false;
  root.classList.remove('is-open');
  root.setAttribute('aria-hidden', 'true');
  launcher?.setAttribute('aria-expanded', 'false');
  state.returnFocus?.focus?.();
}

function setPanel(panelName, visible) {
  state.layout[panelName] = visible;
  if (!visible && state.mobilePane === panelName) state.mobilePane = 'editor';
  persistLayout();
  renderLayout();
}

function handleFormInput(event) {
  const field = event.target?.name;
  if (!['name', 'type', 'summary', 'details', 'tags'].includes(field)) return;
  const draft = activeDraft();
  draft[field] = event.target.value;
  draft.dirty = true;
  persistDrafts();
  document.querySelector('#rpgws-editor-title').textContent = draft.name || 'Untitled record';
  renderDirtyState();
  renderRecords(document.querySelector('#rpgws-search')?.value ?? '');
}

function handleAction(action, trigger) {
  if (action === 'close') closeWorkspace();
  if (action === 'reset-draft') {
    chatDrafts()[state.activeRecordId] = defaultDraft(state.activeRecordId);
    persistDrafts();
    renderEditor();
    renderRecords(document.querySelector('#rpgws-search')?.value ?? '');
  }
  if (action === 'keep-draft') {
    activeDraft().dirty = false;
    persistDrafts();
    renderDirtyState();
    globalThis.toastr?.info?.('Prototype draft retained for this browser tab. No Campaign data was written.');
  }
  if (action === 'sync') {
    const opened = globalThis.RpgCampaignWorker?.open?.(trigger) ?? false;
    if (!opened) globalThis.toastr?.error?.('Campaign Worker is unavailable. Reload SillyTavern and retry Story Sync.');
  }
  if (['new-record', 'advance'].includes(action)) {
    globalThis.toastr?.info?.(`${action.replace('-', ' ')} is intentionally stubbed in this boundary spike.`);
  }
}

function handleWorkspaceClick(event) {
  const launcher = event.target.closest('#rpgws-launcher');
  if (launcher) {
    openWorkspace(launcher);
    return;
  }

  const actionControl = event.target.closest('[data-rpgws-action]');
  const action = actionControl?.dataset.rpgwsAction;
  if (action) {
    handleAction(action, actionControl);
    return;
  }

  const hidePanel = event.target.closest('[data-rpgws-hide]')?.dataset.rpgwsHide;
  if (hidePanel) {
    setPanel(hidePanel, false);
    return;
  }

  const togglePanel = event.target.closest('[data-rpgws-toggle]')?.dataset.rpgwsToggle;
  if (togglePanel) {
    setPanel(togglePanel, !state.layout[togglePanel]);
    return;
  }

  const mobilePane = event.target.closest('[data-rpgws-mobile]')?.dataset.rpgwsMobile;
  if (mobilePane) {
    state.mobilePane = mobilePane;
    if (mobilePane in state.layout && !state.layout[mobilePane]) {
      state.layout[mobilePane] = true;
      persistLayout();
    }
    renderLayout();
    return;
  }

  const recordId = event.target.closest('[data-record-id]')?.dataset.recordId;
  if (recordId) {
    state.activeRecordId = recordId;
    state.mobilePane = 'editor';
    renderRecords(document.querySelector('#rpgws-search')?.value ?? '');
    renderEditor();
    renderLayout();
  }
}

function mount() {
  if (document.querySelector(`#${RPG_WORKSPACE_ID}`)) return;
  document.body.insertAdjacentHTML('beforeend', workspaceMarkup());
  document.body.insertAdjacentHTML('beforeend', launcherMarkup());

  renderChatIdentity();
  renderLayout();
  renderRecords();
  renderEditor();
  renderChatPreview();

  document.addEventListener('click', handleWorkspaceClick);
  document.querySelector('#rpgws-form')?.addEventListener('input', handleFormInput);
  document.querySelector('#rpgws-search')?.addEventListener('input', event => renderRecords(event.target.value));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && state.open) closeWorkspace();
  });

  const context = getContext();
  const events = context?.eventTypes ?? context?.event_types;
  const chatChanged = events?.CHAT_CHANGED;
  if (context?.eventSource && chatChanged) {
    context.eventSource.on(chatChanged, activateCurrentChat);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount, { once: true });
} else {
  mount();
}
