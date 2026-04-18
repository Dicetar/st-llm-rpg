const MODULE_NAME = 'llm_rpg_bridge';

const DEFAULT_SETTINGS = Object.freeze({
  backendBaseUrl: 'http://127.0.0.1:8010',
  actorId: 'player',
  autoRefreshOnLoad: true,
  showFloatingPanel: true,
  injectNarrationBlockIntoChat: true,
  keepExecutionLog: true,
  inspectorOpen: false,
  panelPosition: null,
  inspectorPosition: null,
  sectionOpen: {
    overview: true,
    inventory: true,
    builder: false,
    quests: true,
    events: false,
    log: true,
    settings: false,
    inspector_actor: true,
    inspector_scene: false,
    inspector_campaign: false,
    actor_sub_overview: true,
    actor_sub_held: true,
    actor_sub_worn_entries: true,
    actor_sub_custom_skills: false,
    actor_sub_spells: true,
    actor_sub_feats: false,
    actor_sub_item_notes: false,
    spell_group_0: false,
    spell_group_1: false,
    spell_group_2: false,
    spell_group_3: false,
    spell_group_4: false,
    spell_group_5: false,
    spell_group_6: false,
    spell_group_7: false,
    spell_group_8: false,
    spell_group_9: false,
  },
});

const READ_ONLY_COMMANDS = new Set(['inventory', 'quest', 'journal', 'actor', 'campaign', 'scene']);
const MUTATION_COMMANDS = new Set(['use_item', 'cast', 'equip', 'new', 'new_item', 'new_spell', 'new_custom_skill']);

function getContextSafe() {
  if (!globalThis.SillyTavern || typeof globalThis.SillyTavern.getContext !== 'function') {
    throw new Error('SillyTavern global context is unavailable.');
  }
  return globalThis.SillyTavern.getContext();
}

function log(...args) {
  console.log('[LLM RPG Bridge]', ...args);
}

function warn(...args) {
  console.warn('[LLM RPG Bridge]', ...args);
}

function notify(message, type = 'info') {
  const toaster = globalThis.toastr;
  if (toaster && typeof toaster[type] === 'function') {
    toaster[type](message);
  } else {
    console.log(`[${type}]`, message);
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function normalizeKey(value) {
  return String(value ?? '').trim().toLowerCase().replaceAll('_', ' ');
}

function humanizeKey(value) {
  return String(value ?? '')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

function getSettings() {
  const context = getContextSafe();
  const { extensionSettings } = context;
  if (!extensionSettings[MODULE_NAME]) {
    extensionSettings[MODULE_NAME] = structuredClone(DEFAULT_SETTINGS);
  }

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (!(key in extensionSettings[MODULE_NAME])) {
      extensionSettings[MODULE_NAME][key] = value;
    }
  }

  return extensionSettings[MODULE_NAME];
}

function getSectionOpenState() {
  const settings = getSettings();

  if (!settings.sectionOpen || typeof settings.sectionOpen !== 'object') {
    settings.sectionOpen = structuredClone(DEFAULT_SETTINGS.sectionOpen);
  }

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS.sectionOpen)) {
    if (!(key in settings.sectionOpen)) {
      settings.sectionOpen[key] = value;
    }
  }

  return settings.sectionOpen;
}

function isSectionOpen(sectionKey) {
  return getSectionOpenState()[sectionKey] !== false;
}

function setSectionOpen(sectionKey, open) {
  const sectionState = getSectionOpenState();
  sectionState[sectionKey] = Boolean(open);
  saveSettings();
}

function saveSettings() {
  const context = getContextSafe();
  if (typeof context.saveSettingsDebounced === 'function') {
    context.saveSettingsDebounced();
  }
}

function getChatMetadata() {
  return getContextSafe().chatMetadata;
}

async function saveMetadata() {
  const context = getContextSafe();
  if (typeof context.saveMetadata === 'function') {
    await context.saveMetadata();
  }
}

function setPendingNarrationContext(payload) {
  const chatMetadata = getChatMetadata();
  chatMetadata[`${MODULE_NAME}_pending_narration`] = payload;
  return saveMetadata();
}

function getPendingNarrationContext() {
  return getChatMetadata()[`${MODULE_NAME}_pending_narration`] ?? null;
}

function clearPendingNarrationContext() {
  const chatMetadata = getChatMetadata();
  delete chatMetadata[`${MODULE_NAME}_pending_narration`];
  return saveMetadata();
}

function buildActorQuery() {
  const actorId = getSettings().actorId?.trim();
  return actorId ? `?actor_id=${encodeURIComponent(actorId)}` : '';
}

async function requestJson(path, options = {}) {
  const settings = getSettings();
  const url = `${settings.backendBaseUrl.replace(/\/$/, '')}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Backend request failed (${response.status}): ${body}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

async function saveQuestNote(questName, note) {
  return requestJson('/state/quest-note', {
    method: 'POST',
    body: JSON.stringify({ quest_name: questName, note }),
  });
}

function injectUiPatchStyles() {
  if (document.getElementById('llm-rpg-inline-patch-styles')) return;
  const style = document.createElement('style');
  style.id = 'llm-rpg-inline-patch-styles';
  style.textContent = `
    .llm-rpg-inventory-tools { margin-bottom: 10px; }
    .llm-rpg-inventory-search { width: 100%; box-sizing: border-box; }
    .llm-rpg-inventory-list { display: grid; gap: 6px; }
    .llm-rpg-inventory-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      padding: 8px 10px;
      border-radius: 10px;
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.06);
    }
    .llm-rpg-inventory-main {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      flex: 1;
    }
    .llm-rpg-inventory-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 13px;
    }
    .llm-rpg-inventory-help {
      opacity: 0.55;
      font-size: 11px;
      flex: 0 0 auto;
    }
    .llm-rpg-quest-note-view {
      white-space: pre-wrap;
      line-height: 1.45;
      font-size: 12px;
      opacity: 0.94;
    }
    .llm-rpg-quest-note-editor {
      width: 100%;
      box-sizing: border-box;
      min-height: 110px;
      margin-top: 8px;
      margin-bottom: 8px;
    }
    .llm-rpg-quest-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 8px;
    }
    .llm-rpg-hidden { display: none !important; }
  `;
  document.head.appendChild(style);
}

