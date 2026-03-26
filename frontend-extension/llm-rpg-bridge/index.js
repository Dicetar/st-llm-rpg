const MODULE_NAME = 'llm_rpg_bridge';

const DEFAULT_SETTINGS = Object.freeze({
  backendBaseUrl: 'http://127.0.0.1:8010',
  actorId: 'player',
  autoRefreshOnLoad: true,
  showFloatingPanel: true,
  injectNarrationBlockIntoChat: true,
  keepExecutionLog: true,
});

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

function appendExecutionLog(apiResponse) {
  const root = document.querySelector('#llm-rpg-log');
  if (!root) return;

  const block = document.createElement('div');
  block.className = 'llm-rpg-log-entry';
  const timestamp = new Date().toLocaleTimeString();
  block.innerHTML = `
    <div class="llm-rpg-log-time">${escapeHtml(timestamp)}</div>
    ${(apiResponse.results || []).map(renderExecutionResult).join('')}
  `;
  root.prepend(block);
}

async function refreshPanel() {
  const overview = await requestJson('/state/overview');
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

  await setPendingNarrationContext({
    created_at: Date.now(),
    raw_text: rawText,
    api_response: apiResponse,
    narration_block: buildNarrationBlock(apiResponse),
  });

  await refreshPanel();
  return apiResponse;
}

function getPanelHtml() {
  const settings = getSettings();
  return `
    <div id="llm-rpg-bridge-panel" class="llm-rpg-panel">
      <div class="llm-rpg-header">
        <div>
          <h3>LLM RPG Bridge</h3>
          <p>External state first, narration second.</p>
        </div>
        <button id="llm-rpg-toggle" class="menu_button">×</button>
      </div>

      <div class="llm-rpg-section">
        <label>Backend URL</label>
        <input id="llm-rpg-backend-url" type="text" value="${escapeHtml(settings.backendBaseUrl)}" />
      </div>

      <div class="llm-rpg-section">
        <label>Actor ID</label>
        <input id="llm-rpg-actor-id" type="text" value="${escapeHtml(settings.actorId)}" />
      </div>

      <div class="llm-rpg-actions">
        <button id="llm-rpg-save-settings" class="menu_button">Save</button>
        <button id="llm-rpg-refresh" class="menu_button">Refresh</button>
        <button id="llm-rpg-clear-pending" class="menu_button">Clear Pending Narration</button>
      </div>

      <div class="llm-rpg-section">
        <h4>Overview</h4>
        <div id="llm-rpg-overview" class="llm-rpg-box">Loading…</div>
      </div>

      <div class="llm-rpg-section">
        <h4>Inventory</h4>
        <div id="llm-rpg-inventory" class="llm-rpg-box">Loading…</div>
      </div>

      <div class="llm-rpg-section">
        <h4>Quests</h4>
        <div id="llm-rpg-quests" class="llm-rpg-box">Loading…</div>
      </div>

      <div class="llm-rpg-section">
        <h4>Recent Events</h4>
        <div id="llm-rpg-events" class="llm-rpg-box">Loading…</div>
      </div>

      <div class="llm-rpg-section">
        <h4>Last Executions</h4>
        <div id="llm-rpg-log" class="llm-rpg-log"></div>
      </div>
    </div>

    <button id="llm-rpg-open" class="menu_button llm-rpg-open-button">RPG</button>
  `;
}

function mountPanel() {
  if (document.querySelector('#llm-rpg-bridge-panel')) return;

  const wrapper = document.createElement('div');
  wrapper.id = 'llm-rpg-bridge-root';
  wrapper.innerHTML = getPanelHtml();
  document.body.appendChild(wrapper);

  const panel = document.querySelector('#llm-rpg-bridge-panel');
  const open = document.querySelector('#llm-rpg-open');

  const openPanel = () => panel.classList.add('open');
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

  document.querySelector('#llm-rpg-clear-pending')?.addEventListener('click', async () => {
    await clearPendingNarrationContext();
    notify('Pending narration context cleared.', 'info');
  });

  if (getSettings().showFloatingPanel) {
    openPanel();
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
          if (!text.trim() && name !== 'inventory' && name !== 'quest' && name !== 'journal') {
            throw new Error(`/${name} requires an argument.`);
          }

          if (name === 'inventory') {
            const overview = await requestJson('/state/inventory');
            await refreshPanel();
            return `[RPG INVENTORY]\n${JSON.stringify(overview, null, 2)}\n[/RPG INVENTORY]`;
          }

          if (name === 'quest') {
            const quests = await requestJson('/state/quests');
            await refreshPanel();
            return `[RPG QUESTS]\n${JSON.stringify(quests, null, 2)}\n[/RPG QUESTS]`;
          }

          if (name === 'journal') {
            const entries = await requestJson('/journal/entries');
            return `[RPG JOURNAL]\n${JSON.stringify(entries, null, 2)}\n[/RPG JOURNAL]`;
          }

          return await commandCallback(name, text.trim());
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
