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
    quests: false,
    events: false,
    log: true,
    settings: false,
    inspector_actor: true,
    inspector_scene: false,
    inspector_campaign: false,
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

function renderKeyValueMap(map) {
  const entries = Object.entries(map || {});
  if (!entries.length) return '<div class="llm-rpg-empty">—</div>';
  return `<ul class="llm-rpg-list">${entries.map(([k, v]) => `<li><span>${escapeHtml(k)}</span><strong>${escapeHtml(v)}</strong></li>`).join('')}</ul>`;
}

function renderSimpleArray(items) {
  if (!items || !items.length) return '<div class="llm-rpg-empty">—</div>';
  return `<ul class="llm-rpg-list">${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
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

function renderRawCollapsibleSection(sectionKey, title, innerHtml) {
  const openAttr = isSectionOpen(sectionKey) ? 'open' : '';
  return `
    <details class="llm-rpg-section llm-rpg-collapsible" data-section="${escapeHtml(sectionKey)}" ${openAttr}>
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

function renderDetailSummaryList(items, formatter) {
  if (!items || !items.length) return '<div class="llm-rpg-empty">—</div>';
  return `<ul class="llm-rpg-detail-list">${items.map(item => `<li>${formatter(item)}</li>`).join('')}</ul>`;
}

function renderActorDetail(actor) {
  const customSkillCount = Object.keys(actor.custom_skills || {}).length;
  const spellCount = Object.keys(actor.known_spells || {}).length;
  const featNames = Object.keys(actor.feats || {});
  const spellNames = Object.values(actor.known_spells || {}).map(spell => spell.name || 'Unknown spell');
  const itemNoteNames = Object.keys(actor.item_notes || {});
  const jewelry = Array.isArray(actor.equipment?.jewelry) ? actor.equipment.jewelry.map(item => item.item || item.kind || 'Jewelry') : [];

  return `
    <div class="llm-rpg-grid llm-rpg-detail-grid">
      <div><span>Actor</span><strong>${escapeHtml(actor.name || actor.actor_id || 'Unknown')}</strong></div>
      <div><span>Custom Skills</span><strong>${escapeHtml(customSkillCount)}</strong></div>
      <div><span>Known Spells</span><strong>${escapeHtml(spellCount)}</strong></div>
      <div><span>Feats</span><strong>${escapeHtml(featNames.length)}</strong></div>
    </div>
    <h4>Custom Skills</h4>
    ${renderKeyValueMap(actor.custom_skills || {})}
    <h4>Known Spells</h4>
    ${renderSimpleArray(spellNames)}
    <h4>Feats</h4>
    ${renderSimpleArray(featNames)}
    <h4>Jewelry</h4>
    ${renderSimpleArray(jewelry)}
    <h4>Item Notes</h4>
    ${renderSimpleArray(itemNoteNames)}
  `;
}

function renderSceneDetail(scene) {
  const tags = scene.scene_tags || [];
  const objects = scene.notable_objects || [];
  const exits = scene.exits || [];
  const detailKeys = Object.keys(scene.notable_object_details || {});

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
    ${renderSimpleArray(objects)}
    <h4>Object Detail Records</h4>
    ${renderSimpleArray(detailKeys)}
    <h4>Exits</h4>
    ${renderSimpleArray(exits)}
  `;
}

function renderCampaignDetail(campaign) {
  const quests = Object.entries(campaign.quests || {}).filter(([, value]) => value?.status === 'active').map(([key]) => key);
  const relationships = Object.keys(campaign.relationships || {});
  const plotFlags = Array.isArray(campaign.plot_flags) ? campaign.plot_flags : [];
  const majorEvents = Array.isArray(campaign.recent_major_events)
    ? campaign.recent_major_events.map(event => event.text || event.id || 'Major event')
    : [];
  const knownFacts = Array.isArray(campaign.known_facts)
    ? campaign.known_facts.map(fact => fact.text || fact.id || 'Known fact')
    : [];

  return `
    <div class="llm-rpg-grid llm-rpg-detail-grid">
      <div><span>Arc</span><strong>${escapeHtml(campaign.current_arc || 'Unknown')}</strong></div>
      <div><span>Active Quests</span><strong>${escapeHtml(quests.length)}</strong></div>
      <div><span>Relationships</span><strong>${escapeHtml(relationships.length)}</strong></div>
      <div><span>Plot Flags</span><strong>${escapeHtml(plotFlags.length)}</strong></div>
    </div>
    <h4>Active Quests</h4>
    ${renderSimpleArray(quests)}
    <h4>Plot Flags</h4>
    ${renderSimpleArray(plotFlags)}
    <h4>Relationships</h4>
    ${renderSimpleArray(relationships)}
    <h4>Recent Major Events</h4>
    ${renderSimpleArray(majorEvents)}
    <h4>Known Facts</h4>
    ${renderSimpleArray(knownFacts)}
  `;
}

async function refreshInspectorPanel() {
  const inspector = document.querySelector('#llm-rpg-inspector-panel');
  if (!inspector || !inspector.classList.contains('open')) return;

  const [actor, scene, campaign] = await Promise.all([
    requestJson(`/state/actor/detail${buildActorQuery()}`),
    requestJson('/state/scene/detail'),
    requestJson('/state/campaign/detail'),
  ]);

  const actorRoot = document.querySelector('#llm-rpg-inspector-actor');
  const sceneRoot = document.querySelector('#llm-rpg-inspector-scene');
  const campaignRoot = document.querySelector('#llm-rpg-inspector-campaign');

  if (actorRoot) actorRoot.innerHTML = renderActorDetail(actor);
  if (sceneRoot) sceneRoot.innerHTML = renderSceneDetail(scene);
  if (campaignRoot) campaignRoot.innerHTML = renderCampaignDetail(campaign);
}

async function refreshPanel() {
  const overview = await requestJson(`/state/overview${buildActorQuery()}`);
  const quests = await requestJson('/state/quests');
  const events = await requestJson('/events/recent');

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
      </div>
      <h4>Spell Slots</h4>
      ${renderKeyValueMap(overview.spell_slots)}
    `;
  }

  if (inventoryRoot) {
    inventoryRoot.innerHTML = renderKeyValueMap(overview.inventory);
  }

  if (questsRoot) {
    const rawQuests = quests.active_quests || [];
    const questItems = Array.isArray(rawQuests)
      ? rawQuests.map(q => typeof q === 'string' ? q : (q.title || q.id || 'Unknown quest'))
      : Object.entries(rawQuests).map(([key, value]) => {
          if (typeof value === 'string') return value;
          return value?.title || key || 'Unknown quest';
        });

    questsRoot.innerHTML = renderSimpleArray(questItems);
  }

  if (eventsRoot) {
    const items = events.events || [];
    eventsRoot.innerHTML = items.length
      ? `<ul class="llm-rpg-list">${items.map(item => `<li>${escapeHtml(item.command_name || item.event_type || item.type || 'event')} — ${escapeHtml(item.summary || item.message || item.id || '')}</li>`).join('')}</ul>`
      : '<div class="llm-rpg-empty">—</div>';
  }

  await refreshInspectorPanel();
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

  for (const details of document.querySelectorAll('.llm-rpg-collapsible')) {
    details.addEventListener('toggle', () => {
      const sectionKey = details.dataset.section;
      if (sectionKey) {
        setSectionOpen(sectionKey, details.open);
      }
    });
  }

  window.addEventListener('resize', clampOpenPanelsToViewport);

  if (getSettings().showFloatingPanel) {
    openPanel();
  }
  if (getSettings().inspectorOpen) {
    openInspectorPanel();
  }
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
