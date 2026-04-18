function renderKeyValueMap(map) {
  const entries = Object.entries(map || {});
  if (!entries.length) return '<div class="llm-rpg-empty">â€”</div>';
  return `<ul class="llm-rpg-list">${entries.map(([k, v]) => `<li><span>${escapeHtml(k)}</span><strong>${escapeHtml(v)}</strong></li>`).join('')}</ul>`;
}

function renderSimpleArray(items) {
  if (!items || !items.length) return '<div class="llm-rpg-empty">â€”</div>';
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
    lines.push(`${commandText} â€” ${result.ok ? 'success' : 'failed'}`);
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

function renderCollapsibleSection(sectionKey, title, contentId, contentClass = 'llm-rpg-box', initialContent = 'Loadingâ€¦') {
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
  if (!inventoryEntries.length) return '<div class="llm-rpg-empty">â€”</div>';

  return `
    <div class="llm-rpg-inventory-tools">
      <input id="llm-rpg-inventory-search" class="llm-rpg-inventory-search" type="text" placeholder="Search inventory by name or note..." />
    </div>
    <div id="llm-rpg-inventory-list" class="llm-rpg-inventory-list">
      ${inventoryEntries.map(({ itemName, available, description, searchText }) => `
        <div class="llm-rpg-inventory-row" title="${escapeHtml(description || itemName)}" data-search="${escapeHtml(searchText)}">
          <div class="llm-rpg-inventory-main">
            <span class="llm-rpg-inventory-name">${escapeHtml(itemName)}</span>
            ${description ? '<span class="llm-rpg-inventory-help">â“˜</span>' : ''}
          </div>
          ${renderBadge(`x${available}`, 'count')}
        </div>
      `).join('')}
    </div>
  `;
}

function renderEntityCards(cards, emptyMessage = 'â€”') {
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
      ? `<div class="llm-rpg-inline-note">${escapeHtml(entry.placements.map(placement => `${humanizeKey(placement.region)} [${placement.layer}]`).join(' â€¢ '))}</div>`
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
      ? `<div class="llm-rpg-inline-note">${escapeHtml(notes[name].tags.join(' â€¢ '))}</div>`
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

