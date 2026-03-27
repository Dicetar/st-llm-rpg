
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

function renderKeyValueMap(map) {
  const entries = Object.entries(map || {});
  if (!entries.length) return '<div class="llm-rpg-empty">—</div>';
  return `<ul class="llm-rpg-list">${entries.map(([k, v]) => `<li><span>${escapeHtml(k)}</span><strong>${escapeHtml(v)}</strong></li>`).join('')}</ul>`;
}

function renderSimpleArray(items) {
  if (!items || !items.length) return '<div class="llm-rpg-empty">—</div>';
  return `<ul class="llm-rpg-list">${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function renderBadge(label, tone = 'default') {
  return `<span class="llm-rpg-pill llm-rpg-pill-${escapeHtml(tone)}">${escapeHtml(label)}</span>`;
}

function renderDescription(text, fallback = 'No description available.') {
  const value = String(text ?? '').trim();
  return `<div class="llm-rpg-card-description">${escapeHtml(value || fallback)}</div>`;
}

function renderExecutionResult(result) {
  const mutations = (result.mutations || []).map(m =>
    `<li><code>${escapeHtml(m.path || m.kind || 'mutation')}</code> ${escapeHtml(m.note || '')}</li>`
  ).join('');

  return `
    <div class="llm-rpg-result ${result.ok ? 'ok' : 'fail'}">
      <div class="llm-rpg-result-header">
        <strong>/${escapeHtml(result.name)}</strong>
        <span>${result.ok ? 'ok' : 'failed'}</span>
      </div>
      <div class="llm-rpg-result-body">${escapeHtml(result.message || '')}</div>
      ${mutations ? `<ul class="llm-rpg-sublist">${mutations}</ul>` : ''}
    </div>
  `;
}

function buildNarrationBlock(apiResponse) {
  const lines = [];
  lines.push('[RPG COMMAND OUTCOME]');
  lines.push('The following command results are authoritative and already applied to the external game state.');
  lines.push('Narrate consequences naturally, but do not contradict these results.');
  lines.push('');

  for (const result of apiResponse.results || []) {
    lines.push(`Command: /${result.name} ${result.argument ?? ''}`.trim());
    lines.push(`Status: ${result.ok ? 'success' : 'failed'}`);
    lines.push(`Message: ${result.message || ''}`);
    if (Array.isArray(result.mutations) && result.mutations.length) {
      lines.push('Mutations:');
      for (const mutation of result.mutations) {
        lines.push(`- ${mutation.path || mutation.kind}: ${mutation.note || ''} (before=${JSON.stringify(mutation.before)} after=${JSON.stringify(mutation.after)})`);
      }
    }
    lines.push('');
  }

  if (apiResponse.overview) {
    lines.push('Current state snapshot:');
    lines.push(JSON.stringify(apiResponse.overview, null, 2));
  }

  lines.push('[/RPG COMMAND OUTCOME]');
  return lines.join('\n');
}

function buildActionChatBlock(apiResponse) {
  const lines = ['[RPG Action]'];

  for (const result of apiResponse.results || []) {
    const commandText = `/${result.name}${result.argument ? ` ${result.argument}` : ''}`;
    lines.push(`${commandText} — ${result.ok ? 'success' : 'failed'}`);
    lines.push(result.message || '');

    if (Array.isArray(result.mutations) && result.mutations.length) {
      for (const mutation of result.mutations) {
        const changeLabel = mutation.path || mutation.kind || 'change';
        lines.push(`- ${changeLabel}`);
      }
    }

    lines.push('');
  }

  lines.push('[/RPG Action]');
  return lines.join('\n');
}

function buildInfoChatBlock(title, lines) {
  const safeLines = Array.isArray(lines) ? lines : [String(lines ?? '')];
  return [`[${title}]`, ...safeLines, `[/${title}]`].join('\n');
}

async function appendVisibleMessageToChat({ name, mes, extraType = 'rpg_info' }) {
  const context = getContextSafe();
  const message = {
    name,
    is_user: false,
    is_system: true,
    mes,
    send_date: Date.now(),
    extra: {
      type: extraType,
    },
  };

  try {
    if (typeof context.addOneMessage === 'function') {
      await context.addOneMessage(message);
      return;
    }

    if (Array.isArray(context.chat)) {
      context.chat.push(message);
    }

    if (typeof context.saveChat === 'function') {
      await context.saveChat();
    } else if (typeof context.saveChatDebounced === 'function') {
      context.saveChatDebounced();
    }

    if (typeof context.reloadCurrentChat === 'function') {
      await context.reloadCurrentChat();
    }
  } catch (error) {
    warn('Failed to append visible message to chat.', error);
  }
}

async function appendActionMessageToChat(apiResponse) {
  await appendVisibleMessageToChat({
    name: 'RPG Action',
    mes: buildActionChatBlock(apiResponse),
    extraType: 'rpg_action',
  });
}

async function appendInfoMessageToChat(title, lines) {
  await appendVisibleMessageToChat({
    name: 'RPG Info',
    mes: buildInfoChatBlock(title, lines),
    extraType: 'rpg_info',
  });
}

function ensureExecutionLogRoot() {
  const root = document.querySelector('#llm-rpg-log');
  if (!root) return null;
  if (!root.dataset.initialized) {
    root.innerHTML = '';
    root.dataset.initialized = 'true';
  }
  return root;
}

function prependExecutionHtml(html) {
  const root = ensureExecutionLogRoot();
  if (!root) return;
  const block = document.createElement('div');
  block.className = 'llm-rpg-log-entry';
  block.innerHTML = html;
  root.prepend(block);
}

function appendExecutionLog(apiResponse) {
  const timestamp = new Date().toLocaleTimeString();
  prependExecutionHtml(`
    <div class="llm-rpg-log-time">${escapeHtml(timestamp)}</div>
    ${(apiResponse.results || []).map(renderExecutionResult).join('')}
  `);
}

function appendInfoLog(title, message) {
  const timestamp = new Date().toLocaleTimeString();
  prependExecutionHtml(`
    <div class="llm-rpg-log-time">${escapeHtml(timestamp)}</div>
    <div class="llm-rpg-log-note">
      <div class="llm-rpg-log-note-title">${escapeHtml(title)}</div>
      <div class="llm-rpg-log-note-body">${escapeHtml(message)}</div>
    </div>
  `);
}

function renderCollapsibleSection(sectionKey, title, contentId, contentClass = 'llm-rpg-box', initialContent = 'Loading…') {
  const openAttr = isSectionOpen(sectionKey) ? 'open' : '';
  return `
    <details class="llm-rpg-section llm-rpg-collapsible" data-section="${escapeHtml(sectionKey)}" ${openAttr}>
      <summary class="llm-rpg-summary">${escapeHtml(title)}</summary>
      <div id="${escapeHtml(contentId)}" class="${escapeHtml(contentClass)}">${initialContent}</div>
    </details>
  `;
}

function renderRawCollapsibleSection(sectionKey, title, innerHtml, extraClass = '') {
  const openAttr = isSectionOpen(sectionKey) ? 'open' : '';
  return `
    <details class="llm-rpg-section llm-rpg-collapsible ${escapeHtml(extraClass)}" data-section="${escapeHtml(sectionKey)}" ${openAttr}>
      <summary class="llm-rpg-summary">${escapeHtml(title)}</summary>
      <div class="llm-rpg-box">${innerHtml}</div>
    </details>
  `;
}

function buildMainPanelDefaultPosition(panel) {
  const width = panel.offsetWidth || 360;
  return {
    top: 72,
    left: Math.max(16, window.innerWidth - width - 16),
  };
}

function buildInspectorDefaultPosition(panel) {
  const width = panel.offsetWidth || 420;
  const mainLeft = Math.max(16, window.innerWidth - 360 - 16);
  return {
    top: 72,
    left: Math.max(16, mainLeft - width - 16),
  };
}

function clampPanelPosition(panel, position) {
  const width = panel.offsetWidth || 360;
  const height = panel.offsetHeight || 500;
  const margin = 8;
  const maxLeft = Math.max(margin, window.innerWidth - width - margin);
  const maxTop = Math.max(margin, window.innerHeight - height - margin);
  return {
    left: Math.min(Math.max(margin, Number(position.left ?? margin)), maxLeft),
    top: Math.min(Math.max(margin, Number(position.top ?? margin)), maxTop),
  };
}

function applyPanelPosition(panel, position) {
  const clamped = clampPanelPosition(panel, position);
  panel.style.left = `${clamped.left}px`;
  panel.style.top = `${clamped.top}px`;
  panel.style.right = 'auto';
}

function setStoredPanelPosition(settingKey, position) {
  const settings = getSettings();
  settings[settingKey] = { left: position.left, top: position.top };
  saveSettings();
}

function getStoredPanelPosition(settingKey) {
  return getSettings()[settingKey];
}

function applyStoredOrDefaultPosition(panel, settingKey, defaultBuilder) {
  const stored = getStoredPanelPosition(settingKey);
  const position = stored || defaultBuilder(panel);
  applyPanelPosition(panel, position);
  if (!stored) {
    setStoredPanelPosition(settingKey, clampPanelPosition(panel, position));
  }
}

function resetPanelPosition(panel, settingKey, defaultBuilder) {
  const fresh = defaultBuilder(panel);
  applyPanelPosition(panel, fresh);
  setStoredPanelPosition(settingKey, clampPanelPosition(panel, fresh));
}

function makePanelDraggable(panel, handle, settingKey, defaultBuilder) {
  if (!panel || !handle) return;

  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;

  const onPointerMove = (event) => {
    if (!dragging) return;
    const position = {
      left: event.clientX - offsetX,
      top: event.clientY - offsetY,
    };
    applyPanelPosition(panel, position);
  };

  const finishDrag = () => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('llm-rpg-dragging');
    setStoredPanelPosition(settingKey, clampPanelPosition(panel, {
      left: parseFloat(panel.style.left || '0'),
      top: parseFloat(panel.style.top || '0'),
    }));
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', finishDrag);
  };

  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    if (event.target.closest('button, input, textarea, select, summary, a')) return;

    if (!panel.classList.contains('open')) {
      applyStoredOrDefaultPosition(panel, settingKey, defaultBuilder);
    }

    const rect = panel.getBoundingClientRect();
    dragging = true;
    offsetX = event.clientX - rect.left;
    offsetY = event.clientY - rect.top;
    document.body.classList.add('llm-rpg-dragging');
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', finishDrag);
  });
}

function buildAssignmentSummary(actorDetail) {
  const summary = {};
  const bump = (itemName, kind) => {
    const key = normalizeKey(itemName);
    if (!key) return;
    summary[key] = summary[key] || { held: 0, worn: 0 };
    summary[key][kind] += 1;
  };

  const held = actorDetail?.equipment?.held || {};
  for (const itemName of Object.values(held)) {
    if (itemName) bump(itemName, 'held');
  }

  for (const entry of actorDetail?.equipment?.worn_items || []) {
    if (entry?.worn !== false && entry?.item) {
      bump(entry.item, 'worn');
    }
  }

  return summary;
}

function buildNormalizedLookup(map) {
  const lookup = {};
  for (const [key, value] of Object.entries(map || {})) {
    lookup[normalizeKey(key)] = value;
  }
  return lookup;
}

function groupSpellsByLevel(actor) {
  const groups = {};
  const slotKeys = Object.keys(actor?.spell_slots || {});
  for (const spell of Object.values(actor.known_spells || {})) {
    const tags = Array.isArray(spell.tags) ? spell.tags : [];
    let level = null;
    if (tags.includes('cantrip')) {
      level = 0;
    } else {
      for (const tag of tags) {
        const match = String(tag).match(/^level[_\s-]?(\d+)$/i);
        if (match) {
          level = Number(match[1]);
          break;
        }
      }
    }
    if (level === null) {
      const loweredName = normalizeKey(spell.name || '');
      if (loweredName === 'suggestion' || loweredName === 'dragon breath') level = 2;
      else if (loweredName === 'charm person' || loweredName === 'command') level = 1;
      else level = tags.includes('cantrip') ? 0 : null;
    }
    if (level === null) {
      level = slotKeys.length ? Number(Math.min(...slotKeys.map(Number).filter(Number.isFinite))) : 0;
    }
    groups[level] = groups[level] || [];
    groups[level].push(spell);
  }
  return Object.entries(groups)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([level, spells]) => ({ level: Number(level), spells }));
}

function splitInventoryAndAssignments(inventory, actorDetail) {
  const inventoryEntries = [];
  const assignmentSummary = buildAssignmentSummary(actorDetail);
  const noteLookup = buildNormalizedLookup(actorDetail?.item_notes || {});

  for (const [itemName, total] of Object.entries(inventory || {}).sort((a, b) => a[0].localeCompare(b[0]))) {
    const counts = assignmentSummary[normalizeKey(itemName)] || { held: 0, worn: 0 };
    const assigned = counts.held + counts.worn;
    const available = Math.max(0, Number(total || 0) - assigned);
    if (available <= 0) continue;
    inventoryEntries.push({
      itemName,
      available,
      description: noteLookup[normalizeKey(itemName)]?.description || '',
      searchText: `${itemName} ${noteLookup[normalizeKey(itemName)]?.description || ''}`.toLowerCase(),
    });
  }

  const heldEntries = Object.entries(actorDetail?.equipment?.held || {})
    .filter(([, item]) => Boolean(item))
    .map(([slot, item]) => ({ slot, item, description: noteLookup[normalizeKey(item)]?.description || '' }));

  const wornEntries = (actorDetail?.equipment?.worn_items || [])
    .filter(entry => entry?.worn !== false && entry?.item)
    .map(entry => ({ ...entry, description: entry.notes || noteLookup[normalizeKey(entry.item)]?.description || '' }));

  return { inventoryEntries, heldEntries, wornEntries };
}

function renderInventoryAndAssignedGear(inventory, actorDetail) {
  const { inventoryEntries } = splitInventoryAndAssignments(inventory, actorDetail);
  if (!inventoryEntries.length) return '<div class="llm-rpg-empty">—</div>';

  return `
    <div class="llm-rpg-inventory-tools">
      <input id="llm-rpg-inventory-search" class="llm-rpg-inventory-search" type="text" placeholder="Search inventory by name or note..." />
    </div>
    <div id="llm-rpg-inventory-list" class="llm-rpg-inventory-list">
      ${inventoryEntries.map(({ itemName, available, description, searchText }) => `
        <div class="llm-rpg-inventory-row" title="${escapeHtml(description || itemName)}" data-search="${escapeHtml(searchText)}">
          <div class="llm-rpg-inventory-main">
            <span class="llm-rpg-inventory-name">${escapeHtml(itemName)}</span>
            ${description ? '<span class="llm-rpg-inventory-help">ⓘ</span>' : ''}
          </div>
          ${renderBadge(`x${available}`, 'count')}
        </div>
      `).join('')}
    </div>
  `;
}

function renderEntityCards(cards, emptyMessage = '—') {
  if (!cards.length) return `<div class="llm-rpg-empty">${escapeHtml(emptyMessage)}</div>`;
  return `
    <div class="llm-rpg-card-list">
      ${cards.map(card => `
        <div class="llm-rpg-card" title="${escapeHtml(card.tooltip || card.description || card.title)}">
          <div class="llm-rpg-card-header">
            <strong class="llm-rpg-card-title">${escapeHtml(card.title)}</strong>
            ${card.badges?.length ? `<div class="llm-rpg-card-badges">${card.badges.join('')}</div>` : ''}
          </div>
          ${renderDescription(card.description, card.fallbackDescription || 'No description available.')}
          ${card.meta ? `<div class="llm-rpg-card-meta">${card.meta}</div>` : ''}
        </div>
      `).join('')}
    </div>
  `;
}

function renderHeldSlots(held) {
  const entries = Object.entries(held || {}).map(([slot, item]) => ({
    title: humanizeKey(slot),
    description: item ? `Assigned item: ${item}.` : 'Empty.',
    badges: [renderBadge(item ? 'assigned' : 'empty', item ? 'held' : 'muted')],
    meta: item ? `<div class="llm-rpg-inline-note">${escapeHtml(item)}</div>` : '',
  }));
  return renderEntityCards(entries, 'No held slots.');
}

function renderWornItemEntries(wornItems) {
  const cards = (wornItems || []).map(entry => ({
    title: entry.item || 'Worn item',
    description: entry.notes || 'No item note recorded.',
    badges: [
      renderBadge(entry.category || 'worn', 'category'),
      renderBadge(entry.kind || 'item', 'kind'),
      renderBadge(entry.worn === false ? 'not worn' : 'worn', entry.worn === false ? 'muted' : 'worn'),
    ],
    meta: (entry.placements || []).length
      ? `<div class="llm-rpg-inline-note">${escapeHtml(entry.placements.map(placement => `${humanizeKey(placement.region)} [${placement.layer}]`).join(' • '))}</div>`
      : '<div class="llm-rpg-inline-note">No placement data.</div>',
  }));
  return renderEntityCards(cards, 'No worn item entries.');
}

function renderCustomSkillCards(actor) {
  const notes = actor.custom_skill_notes || {};
  const cards = Object.entries(actor.custom_skills || {}).map(([name, value]) => ({
    title: humanizeKey(name),
    description: notes[name]?.description || 'No custom skill note recorded.',
    badges: [renderBadge(`value ${value}`, 'count')],
    meta: Array.isArray(notes[name]?.tags) && notes[name].tags.length
      ? `<div class="llm-rpg-inline-note">${escapeHtml(notes[name].tags.join(' • '))}</div>`
      : '',
  }));
  return renderEntityCards(cards, 'No custom skills.');
}

function renderSpellLevelGroups(actor) {
  const grouped = groupSpellsByLevel(actor);
  if (!grouped.length) return '<div class="llm-rpg-empty">No known spells.</div>';
  return `
    <div class="llm-rpg-spell-groups">
      ${grouped.map(group => renderRawCollapsibleSection(
        `spell_group_${group.level}`,
        group.level === 0 ? 'Cantrips' : `Level ${group.level}`,
        renderEntityCards(group.spells.map(spell => ({
          title: spell.name || 'Unknown spell',
          description: spell.description || spell.notes || 'No spell description recorded.',
          badges: Array.isArray(spell.tags) ? spell.tags.slice(0, 3).map(tag => renderBadge(tag, 'kind')) : [],
          meta: spell.notes ? `<div class="llm-rpg-inline-note">${escapeHtml(spell.notes)}</div>` : '',
        })), 'No spells.'),
        'llm-rpg-spell-subsection'
      )).join('')}
    </div>
  `;
}

function renderFeatCards(actor) {
  const cards = Object.entries(actor.feats || {}).map(([name, feat]) => ({
    title: name,
    description: feat.description || 'No feat description recorded.',
    badges: Array.isArray(feat.tags) ? feat.tags.slice(0, 3).map(tag => renderBadge(tag, 'kind')) : [],
    meta: feat.source ? `<div class="llm-rpg-inline-note">source: ${escapeHtml(feat.source)}</div>` : '',
  }));
  return renderEntityCards(cards, 'No feats.');
}

function renderItemNoteCards(actor) {
  const cards = Object.entries(actor.item_notes || {}).map(([name, note]) => ({
    title: name,
    description: note.description || 'No item note recorded.',
    badges: Array.isArray(note.tags) ? note.tags.slice(0, 4).map(tag => renderBadge(tag, 'kind')) : [],
    meta: note.source ? `<div class="llm-rpg-inline-note">source: ${escapeHtml(note.source)}</div>` : '',
  }));
  return renderEntityCards(cards, 'No item notes.');
}

function renderActorSubsection(sectionKey, title, innerHtml) {
  return renderRawCollapsibleSection(sectionKey, title, innerHtml, 'llm-rpg-actor-subsection');
}

function renderActorDetail(actor) {
  return `
    ${renderActorSubsection('actor_sub_overview', 'Overview', `
      <div class="llm-rpg-grid llm-rpg-detail-grid llm-rpg-actor-top-grid">
        <div><span>Actor</span><strong>${escapeHtml(actor.name || actor.actor_id || 'Unknown')}</strong></div>
        <div><span>Conditions</span><strong>${escapeHtml((actor.conditions || []).length ? actor.conditions.join(', ') : 'None')}</strong></div>
      </div>
    `)}
    ${renderActorSubsection('actor_sub_held', 'Held Slots', renderHeldSlots(actor.equipment?.held || {}))}
    ${renderActorSubsection('actor_sub_worn_entries', 'Worn Item Entries', renderWornItemEntries(actor.equipment?.worn_items || []))}
    ${renderActorSubsection('actor_sub_custom_skills', 'Custom Skills', renderCustomSkillCards(actor))}
    ${renderActorSubsection('actor_sub_spells', 'Known Spells', renderSpellLevelGroups(actor))}
    ${renderActorSubsection('actor_sub_feats', 'Feats', renderFeatCards(actor))}
    ${renderActorSubsection('actor_sub_item_notes', 'Item Notes', renderItemNoteCards(actor))}
  `;
}

function renderSceneDetail(scene) {
  const tags = scene.scene_tags || [];
  const objects = scene.notable_objects || [];
  const exits = scene.exits || [];
  const objectDetails = Object.entries(scene.notable_object_details || {}).map(([key, value]) => ({
    title: value.name || key,
    description: value.description || 'No object description recorded.',
    badges: [
      ...(Array.isArray(value.tags) ? value.tags.slice(0, 3).map(tag => renderBadge(tag, 'kind')) : []),
    ],
    meta: value.state ? `<div class="llm-rpg-inline-note">state: ${escapeHtml(value.state)}</div>` : '',
  }));

  return `
    <div class="llm-rpg-grid llm-rpg-detail-grid">
      <div><span>Location</span><strong>${escapeHtml(scene.location || 'Unknown')}</strong></div>
      <div><span>Tension</span><strong>${escapeHtml(scene.tension_level ?? 0)}</strong></div>
      <div><span>Objects</span><strong>${escapeHtml(objects.length)}</strong></div>
      <div><span>Exits</span><strong>${escapeHtml(exits.length)}</strong></div>
    </div>
    <h4>Scene Tags</h4>
    ${renderSimpleArray(tags)}
    <h4>Notable Objects</h4>
    ${renderEntityCards(objectDetails, 'No object details.')}
    <h4>Exits</h4>
    ${renderSimpleArray(exits)}
  `;
}

function renderCampaignDetail(campaign) {
  const quests = Object.entries(campaign.quests || {}).filter(([, value]) => value?.status === 'active').map(([key, value]) => ({
    title: value?.title || key,
    description: value?.description || value?.note || 'No quest description recorded.',
    badges: [renderBadge(value?.status || 'active', 'default')],
    meta: value?.objective ? `<div class="llm-rpg-inline-note">objective: ${escapeHtml(value.objective)}</div>` : '',
  }));
  const relationships = Object.entries(campaign.relationships || {}).map(([name, relationship]) => ({
    title: name,
    description: relationship?.description || relationship?.summary || relationship?.note || 'No relationship description recorded.',
    badges: relationship?.status ? [renderBadge(relationship.status, 'category')] : [],
    meta: relationship?.score !== undefined ? `<div class="llm-rpg-inline-note">score: ${escapeHtml(relationship.score)}</div>` : '',
  }));
  const majorEvents = Array.isArray(campaign.recent_major_events)
    ? campaign.recent_major_events.map(event => ({
        title: event.title || event.id || 'Major event',
        description: event.text || event.description || 'No event description recorded.',
        badges: event.kind ? [renderBadge(event.kind, 'kind')] : [],
      }))
    : [];
  const knownFacts = Array.isArray(campaign.known_facts)
    ? campaign.known_facts.map(fact => ({
        title: fact.title || fact.id || 'Known fact',
        description: fact.text || fact.description || 'No fact description recorded.',
        badges: fact.scope ? [renderBadge(fact.scope, 'category')] : [],
      }))
    : [];

  return `
    <div class="llm-rpg-grid llm-rpg-detail-grid">
      <div><span>Arc</span><strong>${escapeHtml(campaign.current_arc || 'Unknown')}</strong></div>
      <div><span>Active Quests</span><strong>${escapeHtml(quests.length)}</strong></div>
      <div><span>Relationships</span><strong>${escapeHtml(relationships.length)}</strong></div>
      <div><span>Plot Flags</span><strong>${escapeHtml((campaign.plot_flags || []).length)}</strong></div>
    </div>
    <h4>Active Quests</h4>
    ${renderEntityCards(quests, 'No active quests.')}
    <h4>Relationships</h4>
    ${renderEntityCards(relationships, 'No relationship details.')}
    <h4>Recent Major Events</h4>
    ${renderEntityCards(majorEvents, 'No major events.')}
    <h4>Known Facts</h4>
    ${renderEntityCards(knownFacts, 'No known facts.')}
  `;
}

async function refreshInspectorPanel(prefetched = {}) {
  const inspector = document.querySelector('#llm-rpg-inspector-panel');
  if (!inspector || !inspector.classList.contains('open')) return;

  const [actor, scene, campaign] = await Promise.all([
    prefetched.actor || requestJson(`/state/actor/detail${buildActorQuery()}`),
    prefetched.scene || requestJson('/state/scene/detail'),
    prefetched.campaign || requestJson('/state/campaign/detail'),
  ]);

  const actorRoot = document.querySelector('#llm-rpg-inspector-actor');
  const sceneRoot = document.querySelector('#llm-rpg-inspector-scene');
  const campaignRoot = document.querySelector('#llm-rpg-inspector-campaign');

  if (actorRoot) actorRoot.innerHTML = renderActorDetail(actor);
  if (sceneRoot) sceneRoot.innerHTML = renderSceneDetail(scene);
  if (campaignRoot) campaignRoot.innerHTML = renderCampaignDetail(campaign);

  for (const details of document.querySelectorAll('#llm-rpg-inspector-actor .llm-rpg-collapsible')) {
    if (!details.dataset.boundToggle) {
      details.addEventListener('toggle', () => {
        const sectionKey = details.dataset.section;
        if (sectionKey) setSectionOpen(sectionKey, details.open);
      });
      details.dataset.boundToggle = 'true';
    }
  }
}

function renderQuestAccordion(questsPayload) {
  const rawQuests = questsPayload?.active_quests || {};
  const questEntries = Array.isArray(rawQuests)
    ? rawQuests.map((quest, index) => ({
        key: quest?.id || quest?.title || `quest_${index}`,
        title: typeof quest === 'string' ? quest : (quest?.title || quest?.id || `Quest ${index + 1}`),
        note: typeof quest === 'string' ? '' : (quest?.note || quest?.description || ''),
      }))
    : Object.entries(rawQuests).map(([key, value]) => ({
        key,
        title: value?.title || key,
        note: value?.note || value?.description || '',
      }));

  if (!questEntries.length) return '<div class="llm-rpg-empty">—</div>';

  return questEntries.map((quest, index) => {
    const sectionKey = `quest_entry_${index}`;
    const openAttr = isSectionOpen(sectionKey) ? 'open' : '';
    return `
      <details class="llm-rpg-section llm-rpg-collapsible llm-rpg-quest-item" data-section="${escapeHtml(sectionKey)}" data-quest-name="${escapeHtml(quest.key)}" ${openAttr}>
        <summary class="llm-rpg-summary">${escapeHtml(quest.title)}</summary>
        <div class="llm-rpg-box">
          <div class="llm-rpg-quest-note-view">${escapeHtml(quest.note || 'No quest note.')}</div>
          <textarea class="llm-rpg-quest-note-editor llm-rpg-hidden">${escapeHtml(quest.note || '')}</textarea>
          <div class="llm-rpg-quest-actions">
            <button type="button" class="menu_button llm-rpg-quest-edit-btn">Edit</button>
            <button type="button" class="menu_button llm-rpg-quest-save-btn llm-rpg-hidden">Save</button>
            <button type="button" class="menu_button llm-rpg-quest-cancel-btn llm-rpg-hidden">Cancel</button>
          </div>
        </div>
      </details>
    `;
  }).join('');
}

function bindInventorySearchHandlers() {
  const inventoryRoot = document.querySelector('#llm-rpg-inventory');
  if (!inventoryRoot || inventoryRoot.dataset.inventorySearchBound === 'true') return;

  inventoryRoot.addEventListener('input', (event) => {
    const input = event.target.closest('#llm-rpg-inventory-search');
    if (!input) return;
    const query = input.value.trim().toLowerCase();
    for (const row of inventoryRoot.querySelectorAll('.llm-rpg-inventory-row')) {
      const haystack = row.dataset.search || '';
      row.classList.toggle('llm-rpg-hidden', Boolean(query) && !haystack.includes(query));
    }
  });

  inventoryRoot.dataset.inventorySearchBound = 'true';
}

function bindQuestEditorHandlers() {
  const questsRoot = document.querySelector('#llm-rpg-quests');
  if (!questsRoot || questsRoot.dataset.questEditorBound === 'true') return;

  questsRoot.addEventListener('click', async (event) => {
    const button = event.target.closest('button');
    if (!button) return;

    const item = button.closest('.llm-rpg-quest-item');
    if (!item) return;

    const questName = item.dataset.questName;
    const noteView = item.querySelector('.llm-rpg-quest-note-view');
    const noteEditor = item.querySelector('.llm-rpg-quest-note-editor');
    const editButton = item.querySelector('.llm-rpg-quest-edit-btn');
    const saveButton = item.querySelector('.llm-rpg-quest-save-btn');
    const cancelButton = item.querySelector('.llm-rpg-quest-cancel-btn');

    if (!questName || !noteView || !noteEditor || !editButton || !saveButton || !cancelButton) return;

    if (button.classList.contains('llm-rpg-quest-edit-btn')) {
      noteEditor.dataset.originalValue = noteEditor.value;
      noteView.classList.add('llm-rpg-hidden');
      noteEditor.classList.remove('llm-rpg-hidden');
      editButton.classList.add('llm-rpg-hidden');
      saveButton.classList.remove('llm-rpg-hidden');
      cancelButton.classList.remove('llm-rpg-hidden');
      noteEditor.focus();
      return;
    }

    if (button.classList.contains('llm-rpg-quest-cancel-btn')) {
      noteEditor.value = noteEditor.dataset.originalValue || '';
      noteEditor.classList.add('llm-rpg-hidden');
      saveButton.classList.add('llm-rpg-hidden');
      cancelButton.classList.add('llm-rpg-hidden');
      noteView.classList.remove('llm-rpg-hidden');
      editButton.classList.remove('llm-rpg-hidden');
      return;
    }

    if (button.classList.contains('llm-rpg-quest-save-btn')) {
      try {
        saveButton.disabled = true;
        await saveQuestNote(questName, noteEditor.value);
        notify(`Updated quest note for ${questName}.`, 'success');
        await refreshPanel();
      } catch (error) {
        notify(error.message, 'error');
      } finally {
        saveButton.disabled = false;
      }
    }
  });

  questsRoot.dataset.questEditorBound = 'true';
}

async function refreshPanel() {
  const [overview, quests, events, actorDetail] = await Promise.all([
    requestJson(`/state/overview${buildActorQuery()}`),
    requestJson('/state/quests'),
    requestJson('/events/recent'),
    requestJson(`/state/actor/detail${buildActorQuery()}`),
  ]);

  const overviewRoot = document.querySelector('#llm-rpg-overview');
  const inventoryRoot = document.querySelector('#llm-rpg-inventory');
  const questsRoot = document.querySelector('#llm-rpg-quests');
  const eventsRoot = document.querySelector('#llm-rpg-events');

  if (overviewRoot) {
    overviewRoot.innerHTML = `
      <div class="llm-rpg-grid">
        <div><span>Name</span><strong>${escapeHtml(overview.actor_name || overview.actor_id || 'Unknown')}</strong></div>
        <div><span>HP</span><strong>${escapeHtml(`${overview.hp_current ?? '?'} / ${overview.hp_max ?? '?'}`)}</strong></div>
        <div><span>Gold</span><strong>${escapeHtml(overview.gold ?? 0)}</strong></div>
        <div><span>Scene</span><strong>${escapeHtml(overview.current_location || overview.current_scene_id || 'Unknown')}</strong></div>
        <div><span>Conditions</span><strong>${escapeHtml((actorDetail.conditions || []).length ? actorDetail.conditions.join(', ') : 'None')}</strong></div>
      </div>
      <h4>Spell Slots</h4>
      ${renderKeyValueMap(overview.spell_slots)}
    `;
  }

  if (inventoryRoot) {
    inventoryRoot.innerHTML = renderInventoryAndAssignedGear(overview.inventory, actorDetail);
  }

  if (questsRoot) {
    questsRoot.innerHTML = renderQuestAccordion(quests);
  }

  if (eventsRoot) {
    const items = events.events || [];
    eventsRoot.innerHTML = items.length
      ? `<ul class="llm-rpg-list">${items.map(item => `<li>${escapeHtml(item.command_name || item.event_type || item.type || 'event')} — ${escapeHtml(item.summary || item.message || item.id || '')}</li>`).join('')}</ul>`
      : '<div class="llm-rpg-empty">—</div>';
  }

  bindInventorySearchHandlers();
  bindQuestEditorHandlers();
  await refreshInspectorPanel({ actor: actorDetail });
}

async function executeAgainstBackend(rawText) {
  const settings = getSettings();
  const apiResponse = await requestJson('/commands/execute', {
    method: 'POST',
    body: JSON.stringify({
      actor_id: settings.actorId,
      text: rawText,
    }),
  });

  if (settings.keepExecutionLog) {
    appendExecutionLog(apiResponse);
  }

  await appendActionMessageToChat(apiResponse);

  await setPendingNarrationContext({
    created_at: Date.now(),
    raw_text: rawText,
    api_response: apiResponse,
    narration_block: buildNarrationBlock(apiResponse),
  });

  await refreshPanel();
  return apiResponse;
}

async function handleReadOnlyCommand(commandName) {
  if (commandName === 'inventory') {
    const inventory = await requestJson(`/state/inventory${buildActorQuery()}`);
    await refreshPanel();
    const itemCount = Object.keys(inventory.inventory || {}).length;
    const message = `${itemCount} tracked item ${itemCount === 1 ? 'entry' : 'entries'}.`;
    appendInfoLog('/inventory', message);
    await appendInfoMessageToChat('RPG Info', ['/inventory — refreshed', message]);
    return `[RPG INVENTORY]\n${JSON.stringify(inventory, null, 2)}\n[/RPG INVENTORY]`;
  }

  if (commandName === 'quest') {
    const quests = await requestJson('/state/quests');
    await refreshPanel();
    const rawQuests = quests.active_quests || {};
    const questCount = Array.isArray(rawQuests) ? rawQuests.length : Object.keys(rawQuests).length;
    const message = `${questCount} active ${questCount === 1 ? 'quest' : 'quests'}.`;
    appendInfoLog('/quest', message);
    await appendInfoMessageToChat('RPG Info', ['/quest — refreshed', message]);
    return `[RPG QUESTS]\n${JSON.stringify(quests, null, 2)}\n[/RPG QUESTS]`;
  }

  if (commandName === 'journal') {
    const entries = await requestJson('/journal/entries');
    const count = Array.isArray(entries.entries) ? entries.entries.length : 0;
    const message = `${count} recent ${count === 1 ? 'entry' : 'entries'} loaded.`;
    appendInfoLog('/journal', message);
    await appendInfoMessageToChat('RPG Info', ['/journal — refreshed', message]);
    return `[RPG JOURNAL]\n${JSON.stringify(entries, null, 2)}\n[/RPG JOURNAL]`;
  }

  if (commandName === 'actor') {
    const actor = await requestJson(`/state/actor/detail${buildActorQuery()}`);
    const customSkillCount = Object.keys(actor.custom_skills || {}).length;
    const spellCount = Object.keys(actor.known_spells || {}).length;
    const message = `${customSkillCount} custom skills, ${spellCount} known spells.`;
    appendInfoLog('/actor', message);
    await appendInfoMessageToChat('RPG Info', ['/actor — detail loaded', message]);
    return `[RPG ACTOR]\n${JSON.stringify(actor, null, 2)}\n[/RPG ACTOR]`;
  }

  if (commandName === 'campaign') {
    const campaign = await requestJson('/state/campaign/detail');
    const questCount = Object.keys(campaign.quests || {}).length;
    const message = `${questCount} quest records available.`;
    appendInfoLog('/campaign', message);
    await appendInfoMessageToChat('RPG Info', ['/campaign — detail loaded', message]);
    return `[RPG CAMPAIGN]\n${JSON.stringify(campaign, null, 2)}\n[/RPG CAMPAIGN]`;
  }

  if (commandName === 'scene') {
    const scene = await requestJson('/state/scene/detail');
    const objectCount = Array.isArray(scene.notable_objects) ? scene.notable_objects.length : 0;
    const message = `${objectCount} notable scene objects tracked.`;
    appendInfoLog('/scene', message);
    await appendInfoMessageToChat('RPG Info', ['/scene — detail loaded', message]);
    return `[RPG SCENE]\n${JSON.stringify(scene, null, 2)}\n[/RPG SCENE]`;
  }

  throw new Error(`Unsupported read-only command '/${commandName}'.`);
}

function parseRpgProxyText(text) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return { subcommand: '', remainder: '' };
  const [subcommand, ...rest] = trimmed.split(' ');
  return { subcommand: subcommand.trim().toLowerCase(), remainder: rest.join(' ').trim() };
}

async function dispatchRegisteredCommand(commandName, text) {
  if (commandName === 'rpg') {
    const { subcommand, remainder } = parseRpgProxyText(text);
    if (!subcommand) {
      throw new Error('Usage: /rpg actor | campaign | scene | inventory | quest | journal | new ...');
    }
    if (READ_ONLY_COMMANDS.has(subcommand)) {
      return await handleReadOnlyCommand(subcommand);
    }
    if (MUTATION_COMMANDS.has(subcommand)) {
      return await commandCallback(subcommand, remainder);
    }
    throw new Error(`Unknown /rpg subcommand '${subcommand}'.`);
  }

  if (READ_ONLY_COMMANDS.has(commandName)) {
    return await handleReadOnlyCommand(commandName);
  }

  return await commandCallback(commandName, text.trim());
}

function getBuilderFieldValues() {
  return {
    type: document.querySelector('#llm-rpg-builder-type')?.value || 'custom_skill',
    name: document.querySelector('#llm-rpg-builder-name')?.value?.trim() || '',
    secondary: document.querySelector('#llm-rpg-builder-secondary')?.value?.trim() || '',
    tertiary: document.querySelector('#llm-rpg-builder-tertiary')?.value?.trim() || '',
    description: document.querySelector('#llm-rpg-builder-description')?.value?.trim() || '',
  };
}

function setBuilderFieldValues({ name = '', secondary = '', tertiary = '', description = '' } = {}) {
  const nameInput = document.querySelector('#llm-rpg-builder-name');
  const secondaryInput = document.querySelector('#llm-rpg-builder-secondary');
  const tertiaryInput = document.querySelector('#llm-rpg-builder-tertiary');
  const descriptionInput = document.querySelector('#llm-rpg-builder-description');
  if (nameInput) nameInput.value = name;
  if (secondaryInput) secondaryInput.value = secondary;
  if (tertiaryInput) tertiaryInput.value = tertiary;
  if (descriptionInput) descriptionInput.value = description;
}

function updateBuilderComposerForm() {
  const type = document.querySelector('#llm-rpg-builder-type')?.value || 'custom_skill';
  const secondaryLabel = document.querySelector('#llm-rpg-builder-secondary-label');
  const tertiaryLabel = document.querySelector('#llm-rpg-builder-tertiary-label');
  const secondaryInput = document.querySelector('#llm-rpg-builder-secondary');
  const tertiaryInput = document.querySelector('#llm-rpg-builder-tertiary');
  const tertiaryRow = document.querySelector('#llm-rpg-builder-tertiary-row');
  const descriptionLabel = document.querySelector('#llm-rpg-builder-description-label');
  const descriptionInput = document.querySelector('#llm-rpg-builder-description');
  const submitButton = document.querySelector('#llm-rpg-builder-submit');
  const nameInput = document.querySelector('#llm-rpg-builder-name');

  if (!secondaryLabel || !tertiaryLabel || !secondaryInput || !tertiaryInput || !tertiaryRow || !descriptionLabel || !descriptionInput || !submitButton || !nameInput) {
    return;
  }

  if (type === 'custom_skill') {
    nameInput.placeholder = 'swimming';
    secondaryLabel.textContent = 'Value';
    secondaryInput.placeholder = '3';
    tertiaryLabel.textContent = 'Unused';
    tertiaryInput.placeholder = '';
    tertiaryRow.style.display = 'none';
    descriptionLabel.textContent = 'Description';
    descriptionInput.placeholder = 'Competent in water movement and breath control.';
    submitButton.textContent = 'Create / Update custom skill';
  } else if (type === 'spell') {
    nameInput.placeholder = 'feather fall';
    secondaryLabel.textContent = 'Level';
    secondaryInput.placeholder = '1';
    tertiaryLabel.textContent = 'School';
    tertiaryInput.placeholder = 'transmutation';
    tertiaryRow.style.display = '';
    descriptionLabel.textContent = 'Description';
    descriptionInput.placeholder = 'Slow the fall of nearby creatures.';
    submitButton.textContent = 'Create / Update spell';
  } else {
    nameInput.placeholder = 'rope';
    secondaryLabel.textContent = 'Amount';
    secondaryInput.placeholder = '2';
    tertiaryLabel.textContent = 'Kind';
    tertiaryInput.placeholder = 'tool';
    tertiaryRow.style.display = '';
    descriptionLabel.textContent = 'Description';
    descriptionInput.placeholder = '50 feet of braided hemp rope.';
    submitButton.textContent = 'Create / Update item';
  }
}

function clearBuilderComposer() {
  setBuilderFieldValues();
  updateBuilderComposerForm();
}

function buildBuilderCommandFromForm() {
  const { type, name, secondary, tertiary, description } = getBuilderFieldValues();
  if (!name) {
    throw new Error('Builder name is required.');
  }

  if (type === 'custom_skill') {
    return {
      commandName: 'new_custom_skill',
      rawArgument: [name, secondary || '1', description || `Player-defined custom skill: ${name}.`].join(' :: '),
    };
  }

  if (type === 'spell') {
    return {
      commandName: 'new_spell',
      rawArgument: [name, secondary || '0', description || `Player-defined spell: ${name}.`, tertiary || 'custom'].join(' :: '),
    };
  }

  return {
    commandName: 'new_item',
    rawArgument: [name, secondary || '1', tertiary || 'misc', description || `Player-defined item: ${name}.`].join(' :: '),
  };
}

async function submitBuilderComposer() {
  const { commandName, rawArgument } = buildBuilderCommandFromForm();
  await commandCallback(commandName, rawArgument);
  clearBuilderComposer();
}

function getBuilderComposerHtml() {
  return `
    <div class="llm-rpg-builder-grid">
      <label for="llm-rpg-builder-type">Builder Type</label>
      <select id="llm-rpg-builder-type">
        <option value="custom_skill">Custom Skill</option>
        <option value="spell">Spell</option>
        <option value="item">Item</option>
      </select>

      <label for="llm-rpg-builder-name">Name</label>
      <input id="llm-rpg-builder-name" type="text" placeholder="swimming" />

      <label for="llm-rpg-builder-secondary" id="llm-rpg-builder-secondary-label">Value</label>
      <input id="llm-rpg-builder-secondary" type="text" placeholder="3" />

      <div id="llm-rpg-builder-tertiary-row" class="llm-rpg-builder-row">
        <label for="llm-rpg-builder-tertiary" id="llm-rpg-builder-tertiary-label">Extra</label>
        <input id="llm-rpg-builder-tertiary" type="text" placeholder="" />
      </div>

      <label for="llm-rpg-builder-description" id="llm-rpg-builder-description-label">Description</label>
      <textarea id="llm-rpg-builder-description" rows="4" placeholder="Competent in water movement and breath control."></textarea>

      <div class="llm-rpg-builder-actions">
        <button id="llm-rpg-builder-submit" class="menu_button">Create / Update custom skill</button>
        <button id="llm-rpg-builder-clear" class="menu_button">Clear</button>
      </div>
    </div>
  `;
}

function getMainPanelHtml() {
  const settings = getSettings();
  const settingsInner = `
    <div class="llm-rpg-settings-grid">
      <label for="llm-rpg-backend-url">Backend URL</label>
      <input id="llm-rpg-backend-url" type="text" value="${escapeHtml(settings.backendBaseUrl)}" />
      <label for="llm-rpg-actor-id">Actor ID</label>
      <input id="llm-rpg-actor-id" type="text" value="${escapeHtml(settings.actorId)}" />
      <button id="llm-rpg-save-settings" class="menu_button">Save</button>
    </div>
  `;

  return `
    <div id="llm-rpg-bridge-panel" class="llm-rpg-panel">
      <div class="llm-rpg-header llm-rpg-drag-handle">
        <div class="llm-rpg-header-main">
          <h3>LLM RPG Bridge</h3>
          <p>External state first, narration second.</p>
        </div>
        <div class="llm-rpg-header-actions">
          <button id="llm-rpg-toggle" class="menu_button">×</button>
        </div>
      </div>

      <div class="llm-rpg-actions">
        <button id="llm-rpg-refresh" class="menu_button">Refresh</button>
        <button id="llm-rpg-open-inspector" class="menu_button">Inspector</button>
        <button id="llm-rpg-reset-position" class="menu_button">Reset Position</button>
        <button id="llm-rpg-clear-pending" class="menu_button">Clear Pending Narration</button>
      </div>

      ${renderCollapsibleSection('overview', 'Overview', 'llm-rpg-overview')}
      ${renderCollapsibleSection('inventory', 'Inventory', 'llm-rpg-inventory')}
      ${renderRawCollapsibleSection('builder', 'Builder / Composer', getBuilderComposerHtml())}
      ${renderCollapsibleSection('quests', 'Quests', 'llm-rpg-quests')}
      ${renderCollapsibleSection('events', 'Recent Events', 'llm-rpg-events')}
      ${renderCollapsibleSection('log', 'Last Executions', 'llm-rpg-log', 'llm-rpg-log', '<div class="llm-rpg-empty">No executions yet.</div>')}
      ${renderRawCollapsibleSection('settings', 'Connection & Actor', settingsInner)}
    </div>

    <button id="llm-rpg-open" class="menu_button llm-rpg-open-button">RPG</button>
  `;
}

function getInspectorPanelHtml() {
  const openClass = getSettings().inspectorOpen ? 'open' : '';
  return `
    <div id="llm-rpg-inspector-panel" class="llm-rpg-panel llm-rpg-inspector-panel ${openClass}">
      <div class="llm-rpg-header llm-rpg-drag-handle">
        <div class="llm-rpg-header-main">
          <h3>RPG Inspector</h3>
          <p>Rich actor, scene, and campaign detail.</p>
        </div>
        <div class="llm-rpg-header-actions">
          <button id="llm-rpg-inspector-refresh" class="menu_button">Refresh</button>
          <button id="llm-rpg-inspector-reset-position" class="menu_button">Reset</button>
          <button id="llm-rpg-inspector-close" class="menu_button">×</button>
        </div>
      </div>

      ${renderCollapsibleSection('inspector_actor', 'Actor Detail', 'llm-rpg-inspector-actor')}
      ${renderCollapsibleSection('inspector_scene', 'Scene Detail', 'llm-rpg-inspector-scene')}
      ${renderCollapsibleSection('inspector_campaign', 'Campaign Detail', 'llm-rpg-inspector-campaign')}
    </div>
  `;
}

function setInspectorOpen(open) {
  const settings = getSettings();
  settings.inspectorOpen = Boolean(open);
  saveSettings();
}

function openInspectorPanel() {
  const panel = document.querySelector('#llm-rpg-inspector-panel');
  if (!panel) return;
  panel.classList.add('open');
  setInspectorOpen(true);
  applyStoredOrDefaultPosition(panel, 'inspectorPosition', buildInspectorDefaultPosition);
  refreshInspectorPanel().catch(error => notify(error.message, 'error'));
}

function closeInspectorPanel() {
  const panel = document.querySelector('#llm-rpg-inspector-panel');
  if (!panel) return;
  panel.classList.remove('open');
  setInspectorOpen(false);
}

function getRootHtml() {
  return `${getMainPanelHtml()}${getInspectorPanelHtml()}`;
}

function clampOpenPanelsToViewport() {
  const mainPanel = document.querySelector('#llm-rpg-bridge-panel');
  const inspectorPanel = document.querySelector('#llm-rpg-inspector-panel');
  if (mainPanel) applyStoredOrDefaultPosition(mainPanel, 'panelPosition', buildMainPanelDefaultPosition);
  if (inspectorPanel) applyStoredOrDefaultPosition(inspectorPanel, 'inspectorPosition', buildInspectorDefaultPosition);
}

function mountPanel() {
  if (document.querySelector('#llm-rpg-bridge-panel')) return;

  const wrapper = document.createElement('div');
  wrapper.id = 'llm-rpg-bridge-root';
  wrapper.innerHTML = getRootHtml();
  document.body.appendChild(wrapper);

  const panel = document.querySelector('#llm-rpg-bridge-panel');
  const inspector = document.querySelector('#llm-rpg-inspector-panel');
  const open = document.querySelector('#llm-rpg-open');
  const mainDragHandle = panel?.querySelector('.llm-rpg-drag-handle');
  const inspectorDragHandle = inspector?.querySelector('.llm-rpg-drag-handle');

  applyStoredOrDefaultPosition(panel, 'panelPosition', buildMainPanelDefaultPosition);
  applyStoredOrDefaultPosition(inspector, 'inspectorPosition', buildInspectorDefaultPosition);
  makePanelDraggable(panel, mainDragHandle, 'panelPosition', buildMainPanelDefaultPosition);
  makePanelDraggable(inspector, inspectorDragHandle, 'inspectorPosition', buildInspectorDefaultPosition);

  const openPanel = () => {
    panel.classList.add('open');
    applyStoredOrDefaultPosition(panel, 'panelPosition', buildMainPanelDefaultPosition);
  };
  const closePanel = () => panel.classList.remove('open');

  open?.addEventListener('click', openPanel);
  document.querySelector('#llm-rpg-toggle')?.addEventListener('click', closePanel);

  document.querySelector('#llm-rpg-save-settings')?.addEventListener('click', async () => {
    const settings = getSettings();
    settings.backendBaseUrl = document.querySelector('#llm-rpg-backend-url')?.value?.trim() || DEFAULT_SETTINGS.backendBaseUrl;
    settings.actorId = document.querySelector('#llm-rpg-actor-id')?.value?.trim() || DEFAULT_SETTINGS.actorId;
    saveSettings();
    notify('LLM RPG Bridge settings saved.', 'success');
    await refreshPanel().catch(error => notify(error.message, 'error'));
  });

  document.querySelector('#llm-rpg-refresh')?.addEventListener('click', async () => {
    await refreshPanel().catch(error => notify(error.message, 'error'));
  });

  document.querySelector('#llm-rpg-open-inspector')?.addEventListener('click', () => {
    openInspectorPanel();
  });

  document.querySelector('#llm-rpg-reset-position')?.addEventListener('click', () => {
    resetPanelPosition(panel, 'panelPosition', buildMainPanelDefaultPosition);
    notify('Main panel position reset.', 'info');
  });

  document.querySelector('#llm-rpg-clear-pending')?.addEventListener('click', async () => {
    await clearPendingNarrationContext();
    notify('Pending narration context cleared.', 'info');
  });

  document.querySelector('#llm-rpg-inspector-refresh')?.addEventListener('click', async () => {
    await refreshInspectorPanel().catch(error => notify(error.message, 'error'));
  });

  document.querySelector('#llm-rpg-inspector-close')?.addEventListener('click', () => {
    closeInspectorPanel();
  });

  document.querySelector('#llm-rpg-inspector-reset-position')?.addEventListener('click', () => {
    resetPanelPosition(inspector, 'inspectorPosition', buildInspectorDefaultPosition);
    notify('Inspector position reset.', 'info');
  });

  document.querySelector('#llm-rpg-builder-type')?.addEventListener('change', updateBuilderComposerForm);
  document.querySelector('#llm-rpg-builder-submit')?.addEventListener('click', async () => {
    try {
      await submitBuilderComposer();
    } catch (error) {
      notify(error.message, 'error');
    }
  });
  document.querySelector('#llm-rpg-builder-clear')?.addEventListener('click', () => {
    clearBuilderComposer();
  });
  updateBuilderComposerForm();

  for (const details of document.querySelectorAll('.llm-rpg-collapsible')) {
    details.addEventListener('toggle', () => {
      const sectionKey = details.dataset.section;
      if (sectionKey) setSectionOpen(sectionKey, details.open);
    });
  }

  window.addEventListener('resize', clampOpenPanelsToViewport);

  if (getSettings().showFloatingPanel) openPanel();
  if (getSettings().inspectorOpen) openInspectorPanel();
}

async function resolveSlashApi() {
  if (globalThis.SlashCommandParser && globalThis.SlashCommand && globalThis.SlashCommandArgument && globalThis.ARGUMENT_TYPE) {
    return {
      SlashCommandParser: globalThis.SlashCommandParser,
      SlashCommand: globalThis.SlashCommand,
      SlashCommandArgument: globalThis.SlashCommandArgument,
      SlashCommandNamedArgument: globalThis.SlashCommandNamedArgument,
      ARGUMENT_TYPE: globalThis.ARGUMENT_TYPE,
    };
  }

  async function importMaybe(path) {
    try {
      return await import(/* webpackIgnore: true */ path);
    } catch (error) {
      warn(`Failed to import ${path}`, error);
      return null;
    }
  }

  const parserMod = await importMaybe('/scripts/slash-commands/SlashCommandParser.js');
  const cmdMod = await importMaybe('/scripts/slash-commands/SlashCommand.js');
  const argMod = await importMaybe('/scripts/slash-commands/SlashCommandArgument.js');
  const namedArgMod = await importMaybe('/scripts/slash-commands/SlashCommandNamedArgument.js');
  const commonEnumMod = await importMaybe('/scripts/slash-commands/SlashCommandCommonEnumsProvider.js');

  return {
    SlashCommandParser: parserMod?.SlashCommandParser || globalThis.SlashCommandParser,
    SlashCommand: cmdMod?.SlashCommand || globalThis.SlashCommand,
    SlashCommandArgument: argMod?.SlashCommandArgument || globalThis.SlashCommandArgument,
    SlashCommandNamedArgument: namedArgMod?.SlashCommandNamedArgument || globalThis.SlashCommandNamedArgument,
    ARGUMENT_TYPE: commonEnumMod?.ARGUMENT_TYPE || globalThis.ARGUMENT_TYPE,
  };
}

function stringifyExecutionSummary(apiResponse) {
  return buildNarrationBlock(apiResponse);
}

async function commandCallback(commandName, rawArgument) {
  const bracketed = rawArgument.includes('[') ? rawArgument : `[${rawArgument}]`;
  const rawText = `/${commandName} ${bracketed}`.trim();
  const apiResponse = await executeAgainstBackend(rawText);
  notify(`/${commandName} resolved against backend.`, 'success');
  return stringifyExecutionSummary(apiResponse);
}

async function registerSlashCommands() {
  const api = await resolveSlashApi();

  if (!api?.SlashCommandParser || !api?.SlashCommand || !api?.SlashCommandArgument) {
    warn('Slash command API was not resolved. Panel will still work, but slash commands were not registered.');
    return;
  }

  const add = api.SlashCommandParser.addCommandObject?.bind(api.SlashCommandParser);
  const make = api.SlashCommand.fromProps?.bind(api.SlashCommand);
  const Arg = api.SlashCommandArgument;
  const ARGUMENT_TYPE = api.ARGUMENT_TYPE || { STRING: ['string'] };

  const commands = [
    ['inventory', 'Return authoritative inventory snapshot from backend.'],
    ['use_item', 'Apply an item use against backend state and return a narration block.'],
    ['cast', 'Apply spell-slot spending and return a narration block.'],
    ['equip', 'Apply equipment change and return a narration block.'],
    ['quest', 'Return current quest information from backend.'],
    ['journal', 'Return journal guidance from backend.'],
    ['actor', 'Return richer actor detail from backend.'],
    ['campaign', 'Return campaign detail from backend.'],
    ['scene', 'Return current scene detail from backend.'],
    ['new', 'Builder command for new item, spell, or custom skill.'],
    ['new_item', 'Create or update an inventory item and registry entry.'],
    ['new_spell', 'Create or update a known spell and spell registry entry.'],
    ['new_custom_skill', 'Create or update a custom skill and note entry.'],
    ['rpg', 'Namespaced RPG command proxy. Example: /rpg actor or /rpg new item :: rope :: 2 :: tool :: 50 feet of rope.'],
    ['rpg_refresh', 'Refresh the bridge panel from the backend.'],
  ];

  for (const [name, description] of commands) {
    try {
      if (name === 'rpg_refresh') {
        add(make({
          name,
          callback: async () => {
            await refreshPanel();
            return 'RPG bridge panel refreshed.';
          },
          returns: 'confirmation text',
          unnamedArgumentList: [],
          helpString: description,
        }));
        continue;
      }

      add(make({
        name,
        callback: async (_namedArgs, unnamedArgs) => {
          const text = Array.isArray(unnamedArgs) ? unnamedArgs.join(' ') : String(unnamedArgs ?? '');
          if (!text.trim() && MUTATION_COMMANDS.has(name)) {
            throw new Error(`/${name} requires an argument.`);
          }
          return await dispatchRegisteredCommand(name, text);
        },
        returns: 'authoritative RPG command narration block',
        unnamedArgumentList: [
          Arg.fromProps({
            description: 'command target, item name, spell name, or other payload',
            typeList: ARGUMENT_TYPE.STRING,
            acceptsMultiple: true,
            isRequired: false,
          }),
        ],
        helpString: description,
      }));
      log(`Registered slash command /${name}`);
    } catch (error) {
      warn(`Failed to register /${name}. This usually means the command already exists or ST internals changed.`, error);
    }
  }
}

function injectPendingNarration(chat) {
  const settings = getSettings();
  if (!settings.injectNarrationBlockIntoChat) return;
  const pending = getPendingNarrationContext();
  if (!pending?.narration_block) return;

  const systemNote = {
    is_user: false,
    is_system: true,
    name: 'RPG Bridge',
    send_date: Date.now(),
    mes: pending.narration_block,
  };

  const insertionIndex = Math.max(0, chat.length - 1);
  chat.splice(insertionIndex, 0, systemNote);
}

globalThis.llmRpgBridgeInterceptor = async function(chat, _contextSize, _abort, type) {
  const allowed = new Set(['normal', 'swipe', 'regenerate', 'quiet', 'continue']);
  if (!allowed.has(type)) return;

  const pending = getPendingNarrationContext();
  if (!pending) return;

  try {
    injectPendingNarration(chat);
    await clearPendingNarrationContext();
    log('Injected pending narration context into chat before generation.');
  } catch (error) {
    warn('Failed to inject pending narration context.', error);
  }
};

async function bootstrap() {
  try {
    getSettings();
    mountPanel();
    injectUiPatchStyles();
    await registerSlashCommands();
    if (getSettings().autoRefreshOnLoad) {
      await refreshPanel().catch(error => warn('Initial refresh failed.', error));
    }
    notify('LLM RPG Bridge loaded.', 'success');
  } catch (error) {
    warn('Failed to initialize extension.', error);
    notify(`LLM RPG Bridge failed to initialize: ${error.message}`, 'error');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}
