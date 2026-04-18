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

  if (!questEntries.length) return '<div class="llm-rpg-empty">â€”</div>';

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
      ? `<ul class="llm-rpg-list">${items.map(item => `<li>${escapeHtml(item.command_name || item.event_type || item.type || 'event')} â€” ${escapeHtml(item.summary || item.message || item.id || '')}</li>`).join('')}</ul>`
      : '<div class="llm-rpg-empty">â€”</div>';
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
    await appendInfoMessageToChat('RPG Info', ['/inventory â€” refreshed', message]);
    return `[RPG INVENTORY]\n${JSON.stringify(inventory, null, 2)}\n[/RPG INVENTORY]`;
  }

  if (commandName === 'quest') {
    const quests = await requestJson('/state/quests');
    await refreshPanel();
    const rawQuests = quests.active_quests || {};
    const questCount = Array.isArray(rawQuests) ? rawQuests.length : Object.keys(rawQuests).length;
    const message = `${questCount} active ${questCount === 1 ? 'quest' : 'quests'}.`;
    appendInfoLog('/quest', message);
    await appendInfoMessageToChat('RPG Info', ['/quest â€” refreshed', message]);
    return `[RPG QUESTS]\n${JSON.stringify(quests, null, 2)}\n[/RPG QUESTS]`;
  }

  if (commandName === 'journal') {
    const entries = await requestJson('/journal/entries');
    const count = Array.isArray(entries.entries) ? entries.entries.length : 0;
    const message = `${count} recent ${count === 1 ? 'entry' : 'entries'} loaded.`;
    appendInfoLog('/journal', message);
    await appendInfoMessageToChat('RPG Info', ['/journal â€” refreshed', message]);
    return `[RPG JOURNAL]\n${JSON.stringify(entries, null, 2)}\n[/RPG JOURNAL]`;
  }

  if (commandName === 'actor') {
    const actor = await requestJson(`/state/actor/detail${buildActorQuery()}`);
    const customSkillCount = Object.keys(actor.custom_skills || {}).length;
    const spellCount = Object.keys(actor.known_spells || {}).length;
    const message = `${customSkillCount} custom skills, ${spellCount} known spells.`;
    appendInfoLog('/actor', message);
    await appendInfoMessageToChat('RPG Info', ['/actor â€” detail loaded', message]);
    return `[RPG ACTOR]\n${JSON.stringify(actor, null, 2)}\n[/RPG ACTOR]`;
  }

  if (commandName === 'campaign') {
    const campaign = await requestJson('/state/campaign/detail');
    const questCount = Object.keys(campaign.quests || {}).length;
    const message = `${questCount} quest records available.`;
    appendInfoLog('/campaign', message);
    await appendInfoMessageToChat('RPG Info', ['/campaign â€” detail loaded', message]);
    return `[RPG CAMPAIGN]\n${JSON.stringify(campaign, null, 2)}\n[/RPG CAMPAIGN]`;
  }

  if (commandName === 'scene') {
    const scene = await requestJson('/state/scene/detail');
    const objectCount = Array.isArray(scene.notable_objects) ? scene.notable_objects.length : 0;
    const message = `${objectCount} notable scene objects tracked.`;
    appendInfoLog('/scene', message);
    await appendInfoMessageToChat('RPG Info', ['/scene â€” detail loaded', message]);
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
          <button id="llm-rpg-toggle" class="menu_button">Ã—</button>
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
          <button id="llm-rpg-inspector-close" class="menu_button">Ã—</button>
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

