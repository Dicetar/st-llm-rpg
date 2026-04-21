const MODULE_NAME = 'llm_rpg_bridge';

const DEFAULT_SAVE_ID = 'default';
const SAVE_BINDING_VERSION = 1;
const SAVE_BINDING_METADATA_KEY = `${MODULE_NAME}_save_binding`;
const MAX_RESOLVE_CHAT_MESSAGES = 8;
const MAX_RESOLVE_CHAT_CHARS = 700;
const MAX_SESSION_SUMMARY_CHAT_MESSAGES = 48;
const MAX_SESSION_SUMMARY_MESSAGE_CHARS = 1000;
const MAX_SESSION_SUMMARY_TOTAL_CHARS = 16000;
const SESSION_SUMMARY_HEAD_MESSAGES = 10;

const DEFAULT_SETTINGS = Object.freeze({
  backendBaseUrl: 'http://127.0.0.1:8010',
  actorId: 'player',
  autoRefreshOnLoad: true,
  showFloatingPanel: true,
  injectNarrationBlockIntoChat: true,
  resolveNarrativeTurns: true,
  includeExtractionOnResolveTurn: false,
  failurePolicy: 'best_effort',
  keepExecutionLog: true,
  inspectorOpen: false,
  panelPosition: null,
  inspectorPosition: null,
  sectionOpen: {
    overview: true,
    scene: false,
    scene_lifecycle: true,
    inventory: true,
    builder: false,
    quests: true,
    relationships: true,
    session_summary: false,
    lorebook: true,
    activated_lore: true,
    extraction_review: true,
    journal: false,
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

const READ_ONLY_COMMANDS = new Set(['inventory', 'quest', 'journal', 'lorebook', 'actor', 'campaign', 'scene', 'relationships']);
const MUTATION_COMMANDS = new Set([
  'use_item',
  'cast',
  'equip',
  'new',
  'new_item',
  'new_spell',
  'new_custom_skill',
  'condition',
  'quest_update',
  'relationship_note',
  'scene_move',
  'scene_object',
  'scene_clue',
  'scene_hazard',
  'scene_discovery',
]);

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

function normalizeWhitespace(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function hashSaveName(value) {
  let hash = 2166136261;
  const input = String(value ?? '');
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function buildSaveIdFromName(value) {
  const normalizedName = normalizeWhitespace(value).toLowerCase();
  if (!normalizedName || normalizedName === DEFAULT_SAVE_ID) return DEFAULT_SAVE_ID;

  let slug = normalizedName;
  if (typeof slug.normalize === 'function') {
    slug = slug.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  }

  slug = slug
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 48);

  if (!slug) slug = 'save';
  return `${slug}--${hashSaveName(normalizedName)}`;
}

function normalizeProvidedSaveId(value) {
  const normalized = normalizeWhitespace(value).toLowerCase();
  if (!normalized || normalized === DEFAULT_SAVE_ID) return DEFAULT_SAVE_ID;

  const safeValue = normalized
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 64);

  if (/^[a-z0-9][a-z0-9._-]{0,63}$/.test(safeValue)) {
    return safeValue;
  }

  return buildSaveIdFromName(normalized);
}

function getCurrentChatTitle() {
  const context = getContextSafe();
  const candidates = [
    typeof context.getCurrentChatId === 'function' ? context.getCurrentChatId() : null,
    context.chatId,
    getChatMetadata()?.main_chat,
    context.groupId ? context.groups?.find(group => String(group?.id) === String(context.groupId))?.chat_id : null,
    context.characterId !== undefined && context.characterId !== null ? context.characters?.[context.characterId]?.chat : null,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeWhitespace(candidate);
    if (normalized) return normalized;
  }

  return DEFAULT_SAVE_ID;
}

function normalizeSaveBinding(binding, fallbackSource = 'manual') {
  const saveName = normalizeWhitespace(binding?.saveName || binding?.save_name || '') || getCurrentChatTitle() || DEFAULT_SAVE_ID;
  const explicitSaveId = normalizeWhitespace(binding?.saveId || binding?.save_id || '');
  const source = normalizeWhitespace(binding?.source || '') || fallbackSource;
  const chatTitle = normalizeWhitespace(binding?.chatTitle || binding?.chat_title || '') || getCurrentChatTitle() || saveName;

  return {
    version: SAVE_BINDING_VERSION,
    saveName,
    saveId: explicitSaveId ? normalizeProvidedSaveId(explicitSaveId) : buildSaveIdFromName(saveName),
    chatTitle,
    source,
    createdAt: Number.isFinite(Number(binding?.createdAt)) ? Number(binding.createdAt) : Date.now(),
  };
}

function getStoredSaveBinding() {
  const value = getChatMetadata()[SAVE_BINDING_METADATA_KEY];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value;
}

function deriveDefaultSaveBinding() {
  const chatTitle = getCurrentChatTitle();
  return normalizeSaveBinding(
    {
      saveName: chatTitle,
      chatTitle,
      source: 'chat_title',
    },
    'chat_title',
  );
}

function getSaveBinding() {
  const stored = getStoredSaveBinding();
  return stored ? normalizeSaveBinding(stored, stored.source || 'manual') : deriveDefaultSaveBinding();
}

function saveBindingsEqual(left, right) {
  return Boolean(left)
    && Boolean(right)
    && left.saveId === right.saveId
    && left.saveName === right.saveName
    && left.chatTitle === right.chatTitle
    && left.source === right.source
    && Number(left.version || 0) === Number(right.version || 0);
}

function clearTransientTurnMetadata(chatMetadata) {
  delete chatMetadata[`${MODULE_NAME}_pending_narration`];
  delete chatMetadata[`${MODULE_NAME}_resolved_turn_key`];
  delete chatMetadata[`${MODULE_NAME}_activated_lore`];
  delete chatMetadata[`${MODULE_NAME}_extraction_review`];
}

async function saveMetadata() {
  const context = getContextSafe();
  if (typeof context.saveMetadata === 'function') {
    await context.saveMetadata();
  }
}

async function setSaveBinding(binding, options = {}) {
  const normalized = normalizeSaveBinding(binding, binding?.source || 'manual');
  const chatMetadata = getChatMetadata();
  const previous = getStoredSaveBinding();
  chatMetadata[SAVE_BINDING_METADATA_KEY] = normalized;
  if (options.clearTransientState && (!previous || previous.saveId !== normalized.saveId)) {
    clearTransientTurnMetadata(chatMetadata);
  }
  await saveMetadata();
  return normalized;
}

async function ensureSaveBinding() {
  const stored = getStoredSaveBinding();
  const normalized = stored ? normalizeSaveBinding(stored, stored.source || 'manual') : deriveDefaultSaveBinding();
  if (!stored || !saveBindingsEqual(stored, normalized)) {
    await setSaveBinding(normalized, { clearTransientState: false });
  }
  return normalized;
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

function getResolvedTurnKey() {
  return getChatMetadata()[`${MODULE_NAME}_resolved_turn_key`] ?? null;
}

async function setResolvedTurnKey(value) {
  const chatMetadata = getChatMetadata();
  if (value) {
    chatMetadata[`${MODULE_NAME}_resolved_turn_key`] = value;
  } else {
    delete chatMetadata[`${MODULE_NAME}_resolved_turn_key`];
  }
  await saveMetadata();
}

function getActivatedLoreContext() {
  return getChatMetadata()[`${MODULE_NAME}_activated_lore`] ?? null;
}

async function setActivatedLoreContext(payload) {
  const chatMetadata = getChatMetadata();
  if (payload) {
    chatMetadata[`${MODULE_NAME}_activated_lore`] = payload;
  } else {
    delete chatMetadata[`${MODULE_NAME}_activated_lore`];
  }
  await saveMetadata();
}

function getExtractionReviewContext() {
  return getChatMetadata()[`${MODULE_NAME}_extraction_review`] ?? null;
}

async function setExtractionReviewContext(payload) {
  const chatMetadata = getChatMetadata();
  if (payload) {
    chatMetadata[`${MODULE_NAME}_extraction_review`] = payload;
  } else {
    delete chatMetadata[`${MODULE_NAME}_extraction_review`];
  }
  await saveMetadata();
}

function buildActorQuery() {
  return buildQuery();
}

function buildQuery(params = {}) {
  const search = new URLSearchParams();
  const actorId = getSettings().actorId?.trim();
  if (actorId) search.set('actor_id', actorId);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const rendered = search.toString();
  return rendered ? `?${rendered}` : '';
}

function buildRecentChatMessages(chat = null, options = {}) {
  const source = Array.isArray(chat) ? chat : (getContextSafe().chat || []);
  const limit = Number.isFinite(Number(options.limit)) ? Number(options.limit) : MAX_RESOLVE_CHAT_MESSAGES;
  const excludeLatestUserText = String(options.excludeLatestUserText ?? '').trim();
  const collected = [];
  let skippedLatestUser = false;

  for (let index = source.length - 1; index >= 0; index -= 1) {
    const message = source[index];
    if (!message || message.is_system) continue;
    const content = String(message.mes ?? '').trim();
    if (!content || content.startsWith('/')) continue;
    const role = message.is_user ? 'user' : 'assistant';
    if (!skippedLatestUser && excludeLatestUserText && role === 'user' && content === excludeLatestUserText) {
      skippedLatestUser = true;
      continue;
    }
    collected.push({
      role,
      name: String(message.name ?? '').trim() || null,
      content: content.length > MAX_RESOLVE_CHAT_CHARS ? `${content.slice(0, MAX_RESOLVE_CHAT_CHARS)}...` : content,
    });
    if (collected.length >= limit) break;
  }

  return collected.reverse();
}

function buildSessionSummaryChatMessages(chat = null, options = {}) {
  const source = Array.isArray(chat) ? chat : (getContextSafe().chat || []);
  const maxMessages = Number.isFinite(Number(options.limit)) ? Number(options.limit) : MAX_SESSION_SUMMARY_CHAT_MESSAGES;
  const perMessageChars = Number.isFinite(Number(options.messageCharLimit)) ? Number(options.messageCharLimit) : MAX_SESSION_SUMMARY_MESSAGE_CHARS;
  const maxTotalChars = Number.isFinite(Number(options.totalCharLimit)) ? Number(options.totalCharLimit) : MAX_SESSION_SUMMARY_TOTAL_CHARS;
  const headMessages = Number.isFinite(Number(options.headMessages)) ? Number(options.headMessages) : SESSION_SUMMARY_HEAD_MESSAGES;

  const eligible = [];
  for (const message of source) {
    if (!message || message.is_system) continue;
    const rawContent = String(message.mes ?? '').trim();
    if (!rawContent || rawContent.startsWith('/')) continue;
    const role = message.is_user ? 'user' : 'assistant';
    const content = rawContent.length > perMessageChars ? `${rawContent.slice(0, perMessageChars)}...` : rawContent;
    eligible.push({
      role,
      name: String(message.name ?? '').trim() || null,
      content,
    });
  }

  if (!eligible.length) return [];

  const totalChars = eligible.reduce((sum, message) => sum + message.content.length, 0);
  if (eligible.length <= maxMessages && totalChars <= maxTotalChars) {
    return eligible;
  }

  const head = eligible.slice(0, Math.min(headMessages, maxMessages, eligible.length));
  const remainingCapacity = Math.max(0, maxMessages - head.length);
  const tail = [];
  let usedChars = head.reduce((sum, message) => sum + message.content.length, 0);

  for (let index = eligible.length - 1; index >= head.length; index -= 1) {
    if (tail.length >= remainingCapacity) break;
    const message = eligible[index];
    if (usedChars + message.content.length > maxTotalChars) {
      if (tail.length) break;
      continue;
    }
    tail.push(message);
    usedChars += message.content.length;
  }

  const merged = [...head, ...tail.reverse()];
  if (merged.length <= maxMessages && usedChars <= maxTotalChars) {
    return merged;
  }
  return merged.slice(0, maxMessages);
}

function appendQueryParamsToPath(path, params = {}) {
  const url = new URL(path, 'http://llm-rpg.local');
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  return `${url.pathname}${url.search}`;
}

async function requestJson(path, options = {}) {
  await ensureSaveBinding();
  const settings = getSettings();
  const saveBinding = getSaveBinding();
  const scopedPath = appendQueryParamsToPath(path, { save_id: saveBinding.saveId });
  const url = `${settings.backendBaseUrl.replace(/\/$/, '')}${scopedPath}`;
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

