const __llmRpgPatchStyleId = 'llm-rpg-ui-patch-style';

if (!document.getElementById(__llmRpgPatchStyleId)) {
  const style = document.createElement('style');
  style.id = __llmRpgPatchStyleId;
  style.textContent = `
    .llm-rpg-inventory-tools {
      margin-bottom: 10px;
    }
    .llm-rpg-inventory-search {
      width: 100%;
      box-sizing: border-box;
    }
    .llm-rpg-inventory-list {
      display: grid;
      gap: 6px;
    }
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
    .llm-rpg-hidden {
      display: none !important;
    }
  `;
  document.head.appendChild(style);
}

async function saveQuestNote(questName, note) {
  return await requestJson('/state/quest-note', {
    method: 'POST',
    body: JSON.stringify({ quest_name: questName, note }),
  });
}

function renderInventoryAndAssignedGear(inventory, actorDetail) {
  const { inventoryEntries } = splitInventoryAndAssignments(inventory, actorDetail);
  if (!inventoryEntries.length) {
    return '<div class="llm-rpg-empty">—</div>';
  }

  const rows = inventoryEntries.map(({ itemName, available, description }) => `
    <div class="llm-rpg-inventory-row" title="${escapeHtml(description || itemName)}" data-search="${escapeHtml(`${itemName} ${description}`.toLowerCase())}">
      <div class="llm-rpg-inventory-main">
        <span class="llm-rpg-inventory-name">${escapeHtml(itemName)}</span>
        ${description ? '<span class="llm-rpg-inventory-help">ⓘ</span>' : ''}
      </div>
      ${renderBadge(`x${available}`, 'count')}
    </div>
  `).join('');

  return `
    <div class="llm-rpg-inventory-tools">
      <input id="llm-rpg-inventory-search" class="llm-rpg-inventory-search" type="text" placeholder="Search inventory by name or note..." />
    </div>
    <div id="llm-rpg-inventory-list" class="llm-rpg-inventory-list">${rows}</div>
  `;
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

  if (!questEntries.length) {
    return '<div class="llm-rpg-empty">—</div>';
  }

  return questEntries.map((quest, index) => {
    const sectionKey = `quest_entry_${index}`;
    const openAttr = isSectionOpen(sectionKey) ? 'open' : '';
    return `
      <details class="llm-rpg-section llm-rpg-collapsible llm-rpg-quest-item" data-section="${escapeHtml(sectionKey)}" data-quest-name="${escapeHtml(quest.title)}" ${openAttr}>
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
  if (!inventoryRoot || inventoryRoot.dataset.inventorySearchBound) return;

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
  if (!questsRoot || questsRoot.dataset.questEditorBound) return;

  questsRoot.addEventListener('click', async (event) => {
    const button = event.target.closest('button');
    if (!button) return;

    const item = button.closest('.llm-rpg-quest-item');
    if (!item) return;

    const noteView = item.querySelector('.llm-rpg-quest-note-view');
    const noteEditor = item.querySelector('.llm-rpg-quest-note-editor');
    const editButton = item.querySelector('.llm-rpg-quest-edit-btn');
    const saveButton = item.querySelector('.llm-rpg-quest-save-btn');
    const cancelButton = item.querySelector('.llm-rpg-quest-cancel-btn');
    const questName = item.dataset.questName;

    if (!noteView || !noteEditor || !editButton || !saveButton || !cancelButton || !questName) return;

    if (button.classList.contains('llm-rpg-quest-edit-btn')) {
      noteEditor.dataset.originalValue = noteEditor.value;
      noteView.classList.add('llm-rpg-hidden');
      editButton.classList.add('llm-rpg-hidden');
      noteEditor.classList.remove('llm-rpg-hidden');
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

setTimeout(() => {
  try {
    bindInventorySearchHandlers();
    bindQuestEditorHandlers();
    if (typeof refreshPanel === 'function') {
      refreshPanel().catch(error => warn('Patched refresh failed.', error));
    }
  } catch (error) {
    warn('Patch initialization failed.', error);
  }
}, 0);
