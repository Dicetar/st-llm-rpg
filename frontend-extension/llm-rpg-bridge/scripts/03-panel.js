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

  if (!questEntries.length) return '<div class="llm-rpg-empty">None</div>';

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

function renderRelationshipsAccordion(relationshipsPayload) {
  const entries = Object.entries(relationshipsPayload?.relationships || {}).map(([name, value]) => ({
    name,
    score: value?.score,
    note: value?.note || value?.description || value?.summary || '',
    lastUpdatedDay: value?.last_updated_day,
  }));

  if (!entries.length) return '<div class="llm-rpg-empty">None</div>';

  return entries.map((relationship, index) => {
    const sectionKey = `relationship_entry_${index}`;
    const openAttr = isSectionOpen(sectionKey) ? 'open' : '';
    return `
      <details class="llm-rpg-section llm-rpg-collapsible" data-section="${escapeHtml(sectionKey)}" ${openAttr}>
        <summary class="llm-rpg-summary">
          ${escapeHtml(relationship.name)}
          <span class="llm-rpg-inline-note">score: ${escapeHtml(relationship.score ?? 0)}</span>
        </summary>
        <div class="llm-rpg-box">
          <div class="llm-rpg-quest-note-view">${escapeHtml(relationship.note || 'No relationship note.')}</div>
          ${relationship.lastUpdatedDay !== undefined
            ? `<div class="llm-rpg-inline-note">last updated day: ${escapeHtml(relationship.lastUpdatedDay)}</div>`
            : ''}
        </div>
      </details>
    `;
  }).join('');
}

function renderJournalEntries(entriesPayload) {
  const entries = Array.isArray(entriesPayload?.entries) ? entriesPayload.entries : [];
  if (!entries.length) return '<div class="llm-rpg-empty">None</div>';

  return `
    <div class="llm-rpg-card-list">
      ${entries.map(entry => `
        <div class="llm-rpg-card">
          <div class="llm-rpg-card-header">
            <strong class="llm-rpg-card-title">${escapeHtml(humanizeKey(entry.kind || 'entry'))}</strong>
            <div class="llm-rpg-card-badges">
              ${renderBadge(entry.scene_id || 'no_scene', 'category')}
            </div>
          </div>
          <div class="llm-rpg-card-description">${escapeHtml(entry.text || '')}</div>
          <div class="llm-rpg-inline-note">${escapeHtml(entry.timestamp || '')}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderLorebookEntries(lorebookPayload) {
  const entries = Array.isArray(lorebookPayload?.entries) ? lorebookPayload.entries : [];
  if (!entries.length) return '<div class="llm-rpg-empty">No lorebook insertion entries yet.</div>';

  const visibleEntries = entries.slice(0, 30);
  return `
    <div class="llm-rpg-lorebook-summary">
      <strong>${escapeHtml(lorebookPayload.entry_count ?? entries.length)}</strong>
      <span>keyword insertion entries, revision ${escapeHtml(lorebookPayload.revision ?? 0)}</span>
    </div>
    <div class="llm-rpg-card-list">
      ${visibleEntries.map(entry => {
        const keywords = Array.isArray(entry.keywords) ? entry.keywords.slice(0, 8) : [];
        const secondary = Array.isArray(entry.secondary_keywords) ? entry.secondary_keywords.slice(0, 5) : [];
        return `
          <div class="llm-rpg-card llm-rpg-lorebook-card">
            <div class="llm-rpg-card-header">
              <strong class="llm-rpg-card-title">${escapeHtml(entry.title || entry.id || 'Lorebook Entry')}</strong>
              <div class="llm-rpg-card-badges">
                ${renderBadge(entry.entry_type || 'entry', 'category')}
                ${entry.constant ? renderBadge('constant', 'kind') : renderBadge('keyword', 'default')}
              </div>
            </div>
            <div class="llm-rpg-card-description">${escapeHtml(entry.content || '')}</div>
            <div class="llm-rpg-inline-note">keys: ${escapeHtml(keywords.join(', ') || 'none')}</div>
            ${secondary.length ? `<div class="llm-rpg-inline-note">secondary: ${escapeHtml(secondary.join(', '))}</div>` : ''}
          </div>
        `;
      }).join('')}
    </div>
    ${entries.length > visibleEntries.length ? `<div class="llm-rpg-inline-note">Showing ${visibleEntries.length} of ${entries.length} entries.</div>` : ''}
  `;
}

function renderActivatedLoreEntries(activationPayload) {
  const entries = Array.isArray(activationPayload?.entries) ? activationPayload.entries : [];
  if (!entries.length) return '<div class="llm-rpg-empty">No activated lore yet. Resolve a narrative turn to see what the backend selected.</div>';

  const headerBits = [];
  if (activationPayload?.turnId) headerBits.push(`turn ${activationPayload.turnId}`);
  if (activationPayload?.playerInput) headerBits.push(`input: ${activationPayload.playerInput}`);

  return `
    ${headerBits.length ? `<div class="llm-rpg-inline-note">${escapeHtml(headerBits.join(' | '))}</div>` : ''}
    <div class="llm-rpg-card-list">
      ${entries.map(entry => `
        <div class="llm-rpg-card llm-rpg-lorebook-card">
          <div class="llm-rpg-card-header">
            <strong class="llm-rpg-card-title">${escapeHtml(entry.title || entry.id || 'Activated Lore')}</strong>
            <div class="llm-rpg-card-badges">
              ${renderBadge(entry.entry_type || 'entry', 'category')}
              ${renderBadge(`score ${entry.score ?? 0}`, 'count')}
            </div>
          </div>
          <div class="llm-rpg-card-description">${escapeHtml(entry.content || '')}</div>
          ${Array.isArray(entry.match_reasons) && entry.match_reasons.length
            ? `<div class="llm-rpg-inline-note">why: ${escapeHtml(entry.match_reasons.join(', '))}</div>`
            : ''}
        </div>
      `).join('')}
    </div>
  `;
}

function refreshActivatedLorePanel() {
  const root = document.querySelector('#llm-rpg-activated-lore');
  if (!root) return;
  root.innerHTML = renderActivatedLoreEntries(getActivatedLoreContext());
}

function joinStructuredCommandParts(parts) {
  const normalized = Array.isArray(parts) ? parts.map(part => String(part ?? '').trim()) : [];
  let lastNonEmpty = -1;
  for (let index = 0; index < normalized.length; index += 1) {
    if (normalized[index]) lastNonEmpty = index;
  }
  if (lastNonEmpty < 0) return '';
  return normalized.slice(0, lastNonEmpty + 1).join(' :: ');
}

function stableSerializeExtractionValue(value) {
  if (Array.isArray(value)) {
    return `[${value.map(item => stableSerializeExtractionValue(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableSerializeExtractionValue(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function getHandledExtractionEntries(reviewPayload) {
  if (!reviewPayload?.handledEntries || typeof reviewPayload.handledEntries !== 'object' || Array.isArray(reviewPayload.handledEntries)) {
    return {};
  }
  return reviewPayload.handledEntries;
}

function getExtractionReviewBucketEntries(reviewPayload, bucket) {
  if (bucket === 'staged') {
    return Array.isArray(reviewPayload?.stagedUpdates) ? reviewPayload.stagedUpdates : [];
  }
  if (bucket === 'proposed') {
    return Array.isArray(reviewPayload?.proposedUpdates) ? reviewPayload.proposedUpdates : [];
  }
  return [];
}

function buildExtractionReviewEntryKey(bucket, entry, index) {
  return `${bucket}:${index}:${stableSerializeExtractionValue({
    category: entry?.category || '',
    description: entry?.description || '',
    payload: entry?.payload || null,
    confidence: entry?.confidence ?? null,
  })}`;
}

function getVisibleExtractionReviewDescriptors(bucket, entries, handledEntries = {}) {
  const sourceEntries = Array.isArray(entries) ? entries : [];
  return sourceEntries
    .map((entry, index) => {
      const key = buildExtractionReviewEntryKey(bucket, entry, index);
      return {
        entry,
        index,
        key,
        handled: handledEntries[key] || null,
      };
    })
    .filter(descriptor => !descriptor.handled);
}

function getExtractionReviewEntryDescriptor(reviewPayload, bucket, index) {
  const sourceEntries = getExtractionReviewBucketEntries(reviewPayload, bucket);
  const entry = Array.isArray(sourceEntries) ? sourceEntries[index] : null;
  if (!entry) return null;
  return {
    entry,
    index,
    key: buildExtractionReviewEntryKey(bucket, entry, index),
  };
}

function buildHandledExtractionReviewPayload(reviewPayload, bucket, index, status, message) {
  const descriptor = getExtractionReviewEntryDescriptor(reviewPayload, bucket, index);
  if (!descriptor) return null;
  return {
    ...reviewPayload,
    handledEntries: {
      ...getHandledExtractionEntries(reviewPayload),
      [descriptor.key]: {
        status,
        message,
        at: Date.now(),
      },
    },
    actionStatus: {
      tone: status === 'dismissed' ? 'info' : 'success',
      message,
      at: Date.now(),
    },
  };
}

function buildExtractionReviewAction(entry) {
  const payload = entry?.payload || {};

  if (entry?.category === 'relationship_shift') {
    const targetName = String(payload.target_name || '').trim();
    const note = String(payload.note || entry.description || '').trim();
    if (!targetName || !note) return null;
    return {
      label: 'Apply Relationship Note',
      commandName: 'relationship_note',
      rawArgument: joinStructuredCommandParts([targetName, note]),
      successMessage: `Applied relationship note for ${targetName}.`,
    };
  }

  if (entry?.category === 'quest_progress') {
    const questName = String(payload.quest_name || '').trim();
    const note = String(payload.note || entry.description || '').trim();
    let status = String(payload.status || '').trim();
    const currentStage = String(payload.current_stage || '').trim();
    if (!questName || !note) return null;
    if (!status && currentStage) status = 'active';
    return {
      label: 'Apply Quest Update',
      commandName: 'quest_update',
      rawArgument: joinStructuredCommandParts([questName, note, status, currentStage]),
      successMessage: `Applied quest update for ${questName}.`,
    };
  }

  if (entry?.category === 'item_change') {
    const itemName = String(payload.item_name || '').trim();
    const quantityDelta = Number(payload.quantity_delta);
    if (!itemName || !Number.isFinite(quantityDelta) || quantityDelta <= 0) return null;
    const rawKind = String(payload.kind || '').trim();
    const kindTokens = rawKind.toLowerCase().split(',').map(part => part.trim()).filter(Boolean);
    return {
      label: quantityDelta === 1 ? 'Add Item' : `Add ${quantityDelta}`,
      commandName: 'new_item',
      rawArgument: joinStructuredCommandParts([
        itemName,
        String(quantityDelta),
        normalizeBuilderItemTags(rawKind || 'misc', kindTokens.includes('consumable')),
        String(payload.description || entry.description || `Player-defined item: ${itemName}.`).trim(),
      ]),
      successMessage: `Added ${quantityDelta} ${itemName}.`,
    };
  }

  if (entry?.category === 'condition_change') {
    const condition = String(payload.condition || '').trim();
    const action = String(payload.action || 'add').trim().toLowerCase();
    if (!condition || !['add', 'remove'].includes(action)) return null;
    return {
      label: action === 'remove' ? 'Remove Condition' : 'Add Condition',
      commandName: 'condition',
      rawArgument: joinStructuredCommandParts([condition, action]),
      successMessage: `${action === 'remove' ? 'Removed' : 'Added'} condition ${condition}.`,
    };
  }

  if (entry?.category === 'location_change') {
    const location = String(payload.location || '').trim();
    const sceneId = String(payload.scene_id || '').trim();
    let timeOfDay = String(payload.time_of_day || '').trim();
    if (!location) return null;
    if (timeOfDay && !sceneId) timeOfDay = '';
    return {
      label: 'Apply Scene Move',
      commandName: 'scene_move',
      rawArgument: joinStructuredCommandParts([location, sceneId, timeOfDay]),
      successMessage: `Moved scene to ${location}.`,
    };
  }

  if (entry?.category === 'scene_object_change') {
    const objectName = String(payload.object_name || '').trim();
    const description = String(payload.description || entry.description || 'Updated from extraction review.').trim();
    if (!objectName) return null;
    let visibility = '';
    if (payload.visible !== undefined && payload.visible !== null && payload.visible !== '') {
      visibility = payload.visible === false || String(payload.visible).trim().toLowerCase() === 'hidden'
        ? 'hidden'
        : 'visible';
    }
    return {
      label: 'Apply Scene Object',
      commandName: 'scene_object',
      rawArgument: joinStructuredCommandParts([objectName, description, visibility]),
      successMessage: `Applied scene object update for ${objectName}.`,
    };
  }

  return null;
}

async function applyExtractionReviewAction(bucket, index, triggerButton = null) {
  const review = getExtractionReviewContext();
  const descriptor = getExtractionReviewEntryDescriptor(review, bucket, index);
  const entry = descriptor?.entry || null;
  const action = buildExtractionReviewAction(entry);

  if (!entry || !action) {
    notify('No direct backend action is available for that extracted update yet.', 'warning');
    return;
  }

  if (triggerButton) triggerButton.disabled = true;

  try {
    await commandCallback(action.commandName, action.rawArgument);
    const handledReview = buildHandledExtractionReviewPayload(getExtractionReviewContext() || review, bucket, index, 'applied', action.successMessage);
    if (handledReview) await setExtractionReviewContext(handledReview);
    refreshExtractionReviewPanel();
  } catch (error) {
    await setExtractionReviewContext({
      ...review,
      actionStatus: {
        tone: 'error',
        message: error.message || 'Extraction review action failed.',
        at: Date.now(),
      },
    });
    refreshExtractionReviewPanel();
    notify(error.message || 'Extraction review action failed.', 'error');
  } finally {
    if (triggerButton) triggerButton.disabled = false;
  }
}

async function dismissExtractionReviewAction(bucket, index, triggerButton = null) {
  const review = getExtractionReviewContext();
  const descriptor = getExtractionReviewEntryDescriptor(review, bucket, index);
  if (!descriptor) return;

  if (triggerButton) triggerButton.disabled = true;

  const label = descriptor.entry.description || humanizeKey(descriptor.entry.category || 'update');
  const handledReview = buildHandledExtractionReviewPayload(review, bucket, index, 'dismissed', `Dismissed extracted update: ${label}.`);
  if (handledReview) {
    await setExtractionReviewContext(handledReview);
    refreshExtractionReviewPanel();
  }
}

function bindExtractionReviewHandlers() {
  const root = document.querySelector('#llm-rpg-extraction-review');
  if (!root || root.dataset.extractionReviewBound === 'true') return;

  root.addEventListener('click', async (event) => {
    const applyButton = event.target.closest('.llm-rpg-extraction-action-btn');
    if (applyButton) {
      const bucket = String(applyButton.dataset.bucket || '').trim();
      const index = Number(applyButton.dataset.index);
      if (!bucket || !Number.isFinite(index)) return;
      await applyExtractionReviewAction(bucket, index, applyButton);
      return;
    }

    const dismissButton = event.target.closest('.llm-rpg-extraction-dismiss-btn');
    if (!dismissButton) return;
    const bucket = String(dismissButton.dataset.bucket || '').trim();
    const index = Number(dismissButton.dataset.index);
    if (!bucket || !Number.isFinite(index)) return;
    await dismissExtractionReviewAction(bucket, index, dismissButton);
  });

  root.dataset.extractionReviewBound = 'true';
}

function renderExtractionCards(items, emptyMessage, type, bucket = '', handledEntries = {}) {
  const entries = Array.isArray(items) ? items : [];

  if (type === 'update') {
    const descriptors = getVisibleExtractionReviewDescriptors(bucket, entries, handledEntries);
    if (!descriptors.length) return `<div class="llm-rpg-empty">${escapeHtml(emptyMessage)}</div>`;

    return `
      <div class="llm-rpg-card-list">
        ${descriptors.map(({ entry, index }) => {
          const action = buildExtractionReviewAction(entry);
          return `
            <div class="llm-rpg-card llm-rpg-extraction-card">
              <div class="llm-rpg-card-header">
                <strong class="llm-rpg-card-title">${escapeHtml(entry.description || 'Extracted update')}</strong>
                <div class="llm-rpg-card-badges">
                  ${renderBadge(entry.category || 'update', 'category')}
                  ${entry.confidence !== undefined ? renderBadge(`conf ${Number(entry.confidence).toFixed(2)}`, 'count') : ''}
                </div>
              </div>
              ${entry.payload && Object.keys(entry.payload).length
                ? `<div class="llm-rpg-inline-note">${escapeHtml(JSON.stringify(entry.payload))}</div>`
                : '<div class="llm-rpg-inline-note">No payload details.</div>'}
              <div class="llm-rpg-extraction-actions">
                ${action
                  ? `<button type="button" class="menu_button llm-rpg-extraction-action-btn" data-bucket="${escapeHtml(bucket)}" data-index="${escapeHtml(index)}">${escapeHtml(action.label)}</button>`
                  : '<div class="llm-rpg-inline-note">No direct bridge action for this category yet.</div>'}
                <button type="button" class="menu_button llm-rpg-extraction-dismiss-btn" data-bucket="${escapeHtml(bucket)}" data-index="${escapeHtml(index)}">Dismiss</button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  if (!entries.length) return `<div class="llm-rpg-empty">${escapeHtml(emptyMessage)}</div>`;

  return `
    <div class="llm-rpg-card-list">
      ${entries.map(entry => {
        if (type === 'mutation') {
          return `
            <div class="llm-rpg-card llm-rpg-extraction-card">
              <div class="llm-rpg-card-header">
                <strong class="llm-rpg-card-title">${escapeHtml(entry.path || entry.kind || 'state change')}</strong>
                <div class="llm-rpg-card-badges">
                  ${renderBadge(entry.kind || 'mutation', 'category')}
                </div>
              </div>
              <div class="llm-rpg-card-description">${escapeHtml(entry.note || 'No mutation note.')}</div>
              ${entry.after !== undefined ? `<div class="llm-rpg-inline-note">after: ${escapeHtml(JSON.stringify(entry.after))}</div>` : ''}
            </div>
          `;
        }

        if (type === 'warning') {
          return `
            <div class="llm-rpg-card llm-rpg-extraction-card">
              <div class="llm-rpg-card-header">
                <strong class="llm-rpg-card-title">${escapeHtml(humanizeKey(entry.stage || 'warning'))}</strong>
                <div class="llm-rpg-card-badges">
                  ${renderBadge(entry.error_code || 'warning', 'fail')}
                </div>
              </div>
              <div class="llm-rpg-card-description">${escapeHtml(entry.message || 'No warning message.')}</div>
            </div>
          `;
        }

        return '';
      }).join('')}
    </div>
  `;
}

function renderExtractionReview(reviewPayload) {
  if (!reviewPayload) {
    return '<div class="llm-rpg-empty">No extraction review yet. Send a fresh user turn or use /rpg_resolve to capture resolve-turn output. ST Continue/Swipe does not populate this section.</div>';
  }

  const requested = Boolean(reviewPayload.requested);
  const pending = Boolean(reviewPayload.pending);
  const proposed = Array.isArray(reviewPayload.proposedUpdates) ? reviewPayload.proposedUpdates : [];
  const applied = Array.isArray(reviewPayload.appliedUpdates) ? reviewPayload.appliedUpdates : [];
  const staged = Array.isArray(reviewPayload.stagedUpdates) ? reviewPayload.stagedUpdates : [];
  const warnings = Array.isArray(reviewPayload.warnings) ? reviewPayload.warnings : [];
  const actionStatus = reviewPayload.actionStatus || null;
  const handledEntries = getHandledExtractionEntries(reviewPayload);
  const activeProposed = getVisibleExtractionReviewDescriptors('proposed', proposed, handledEntries);
  const activeStaged = getVisibleExtractionReviewDescriptors('staged', staged, handledEntries);
  const reviewedCount = Object.keys(handledEntries).length;
  const headerBits = [];

  if (reviewPayload.turnId) headerBits.push(`turn ${reviewPayload.turnId}`);
  if (reviewPayload.playerInput) headerBits.push(`input: ${reviewPayload.playerInput}`);
  if (reviewPayload.narratorModel) headerBits.push(`narrator: ${reviewPayload.narratorModel}`);
  if (requested) {
    headerBits.push(reviewPayload.extractorModel ? `extractor: ${reviewPayload.extractorModel}` : 'extractor requested');
  } else {
    headerBits.push('extraction off');
  }
  if (pending) headerBits.push('pending backend response');

  return `
    ${headerBits.length ? `<div class="llm-rpg-inline-note">${escapeHtml(headerBits.join(' | '))}</div>` : ''}
    <div class="llm-rpg-extraction-summary">
      ${renderBadge(pending ? 'pending' : (requested ? 'requested' : 'disabled'), pending ? 'category' : (requested ? 'kind' : 'muted'))}
      ${renderBadge(`proposed ${activeProposed.length}`, activeProposed.length ? 'count' : 'muted')}
      ${renderBadge(`applied ${applied.length}`, applied.length ? 'held' : 'muted')}
      ${renderBadge(`staged ${activeStaged.length}`, activeStaged.length ? 'fail' : 'muted')}
      ${renderBadge(`warnings ${warnings.length}`, warnings.length ? 'fail' : 'muted')}
      ${renderBadge(`reviewed ${reviewedCount}`, reviewedCount ? 'default' : 'muted')}
    </div>
    ${pending
      ? '<div class="llm-rpg-inline-note">The backend is still resolving this turn. With the current LM Studio model this can take a long time.</div>'
      : ''}
    ${!requested && !warnings.length
      ? '<div class="llm-rpg-inline-note">Enable `Run extraction during resolve-turn` in `Connection & Actor` to populate this section during narrative turns.</div>'
      : ''}
    ${actionStatus?.message
      ? `<div class="llm-rpg-inline-note llm-rpg-extraction-status llm-rpg-extraction-status-${escapeHtml(actionStatus.tone || 'info')}">${escapeHtml(actionStatus.message)}</div>`
      : ''}
    <div class="llm-rpg-inline-note">Supported review actions create a new authoritative backend turn. Dismissed or applied entries stay hidden until the next resolved turn.</div>
    <h4>Warnings</h4>
    ${renderExtractionCards(warnings, 'No extraction warnings.', 'warning')}
    <h4>Proposed Updates</h4>
    ${renderExtractionCards(
      proposed,
      proposed.length
        ? 'All proposed updates in this review have been handled.'
        : (requested ? 'No proposed updates were returned.' : 'Extraction was not requested for this turn.'),
      'update',
      'proposed',
      handledEntries,
    )}
    <h4>Applied Updates</h4>
    ${renderExtractionCards(applied, 'No extracted updates were applied.', 'mutation')}
    <h4>Staged Updates</h4>
    ${renderExtractionCards(
      staged,
      staged.length ? 'All staged updates in this review have been handled.' : 'No extracted updates were staged.',
      'update',
      'staged',
      handledEntries,
    )}
  `;
}

function refreshExtractionReviewPanel() {
  const root = document.querySelector('#llm-rpg-extraction-review');
  if (!root) return;
  root.innerHTML = renderExtractionReview(getExtractionReviewContext());
  bindExtractionReviewHandlers();
}

function splitLooseList(value, pattern = /[\n,]+/) {
  return String(value ?? '')
    .split(pattern)
    .map(item => item.trim())
    .filter(Boolean);
}

function parsePipeParts(value) {
  return String(value ?? '').split('|').map(part => part.trim());
}

function renderSceneArchives(archivesPayload) {
  const archives = Array.isArray(archivesPayload?.archives) ? archivesPayload.archives : [];
  if (!archives.length) return '<div class="llm-rpg-empty">No archived scenes.</div>';

  return `
    <div class="llm-rpg-card-list">
      ${archives.map(archive => `
        <div class="llm-rpg-card">
          <div class="llm-rpg-card-header">
            <strong class="llm-rpg-card-title">${escapeHtml(archive.scene_id || archive.archive_id || 'archived scene')}</strong>
            <div class="llm-rpg-card-badges">${renderBadge(archive.ended_at || 'closed', 'category')}</div>
          </div>
          <div class="llm-rpg-card-description">${escapeHtml(archive.summary || 'No summary recorded.')}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function getSceneLifecycleHtml() {
  return `
    <div class="llm-rpg-scene-life-grid">
      <h4>Open Scene</h4>
      <div class="llm-rpg-field-row">
        <label for="llm-rpg-scene-open-id">Scene ID</label>
        <input id="llm-rpg-scene-open-id" type="text" placeholder="market_square_evening" />
      </div>
      <div class="llm-rpg-field-row">
        <label for="llm-rpg-scene-open-location">Location</label>
        <input id="llm-rpg-scene-open-location" type="text" placeholder="Market Square" />
      </div>
      <div class="llm-rpg-field-row">
        <label for="llm-rpg-scene-open-time">Time</label>
        <input id="llm-rpg-scene-open-time" type="text" placeholder="Evening" />
      </div>
      <div class="llm-rpg-field-row">
        <label for="llm-rpg-scene-open-tension">Tension</label>
        <input id="llm-rpg-scene-open-tension" type="number" min="0" max="10" value="0" />
      </div>
      <label for="llm-rpg-scene-open-npcs">NPCs</label>
      <textarea id="llm-rpg-scene-open-npcs" rows="2" placeholder="One per line or comma-separated"></textarea>
      <label for="llm-rpg-scene-open-objects">Objects</label>
      <textarea id="llm-rpg-scene-open-objects" rows="2" placeholder="One per line or comma-separated"></textarea>
      <label for="llm-rpg-scene-open-exits">Exits</label>
      <textarea id="llm-rpg-scene-open-exits" rows="2" placeholder="One per line or comma-separated"></textarea>
      <label for="llm-rpg-scene-open-tags">Tags</label>
      <input id="llm-rpg-scene-open-tags" type="text" placeholder="urban, social" />
      <div class="llm-rpg-scene-life-actions">
        <button id="llm-rpg-scene-open-submit" class="menu_button" type="button">Open Scene</button>
      </div>

      <h4>Close Scene</h4>
      <label for="llm-rpg-scene-draft-instructions">Draft Instructions</label>
      <textarea id="llm-rpg-scene-draft-instructions" rows="2" placeholder="Optional focus for LM draft"></textarea>
      <div class="llm-rpg-scene-life-actions">
        <button id="llm-rpg-scene-draft-summary" class="menu_button" type="button">Draft Summary</button>
      </div>
      <div id="llm-rpg-scene-draft-status" class="llm-rpg-inline-note"></div>
      <label for="llm-rpg-scene-close-summary">Summary</label>
      <textarea id="llm-rpg-scene-close-summary" rows="4" placeholder="Scene close summary"></textarea>
      <label for="llm-rpg-scene-close-facts">Durable Facts</label>
      <textarea id="llm-rpg-scene-close-facts" rows="3" placeholder="One per line or semicolon-separated"></textarea>
      <div class="llm-rpg-field-row">
        <label for="llm-rpg-scene-next-id">Next ID</label>
        <input id="llm-rpg-scene-next-id" type="text" placeholder="inn_common_room" />
      </div>
      <div class="llm-rpg-field-row">
        <label for="llm-rpg-scene-next-location">Next Loc</label>
        <input id="llm-rpg-scene-next-location" type="text" placeholder="Common Room" />
      </div>
      <div class="llm-rpg-field-row">
        <label for="llm-rpg-scene-next-time">Next Time</label>
        <input id="llm-rpg-scene-next-time" type="text" placeholder="Night" />
      </div>
      <div class="llm-rpg-scene-life-actions">
        <button id="llm-rpg-scene-close-submit" class="menu_button" type="button">Close Scene</button>
        <button id="llm-rpg-scene-clear-forms" class="menu_button" type="button">Clear</button>
      </div>

      <h4>Recent Archives</h4>
      <div id="llm-rpg-scene-archive" class="llm-rpg-scene-archive">Loading...</div>
    </div>
  `;
}

function getSessionSummaryHtml() {
  return `
    <div class="llm-rpg-session-summary-grid">
      <label for="llm-rpg-session-summary-draft-instructions">Draft Instructions</label>
      <textarea id="llm-rpg-session-summary-draft-instructions" rows="2" placeholder="Optional focus, for example: summarize relationship and quest developments only."></textarea>
      <div class="llm-rpg-scene-life-actions">
        <button id="llm-rpg-session-summary-draft" class="menu_button" type="button">Summarize & Fill</button>
      </div>
      <div id="llm-rpg-session-summary-status" class="llm-rpg-inline-note">Drafting is advisory only. Review the filled fields before saving.</div>
      <label for="llm-rpg-session-summary-text">Summary</label>
      <textarea id="llm-rpg-session-summary-text" rows="4" placeholder="What should become durable session memory?"></textarea>
      <label for="llm-rpg-session-summary-facts">Durable Facts</label>
      <textarea id="llm-rpg-session-summary-facts" rows="3" placeholder="One fact per line or semicolon-separated"></textarea>
      <label for="llm-rpg-session-summary-tags">Tags</label>
      <input id="llm-rpg-session-summary-tags" type="text" placeholder="session, harcourt, awakening" />
      <div class="llm-rpg-scene-life-actions">
        <button id="llm-rpg-session-summary-save" class="menu_button" type="button">Save Summary</button>
        <button id="llm-rpg-lorebook-sync" class="menu_button" type="button">Sync Lorebook</button>
        <button id="llm-rpg-session-summary-clear" class="menu_button" type="button">Clear</button>
      </div>
      <div class="llm-rpg-inline-note">Saving updates the journal and rebuilds keyword insertion entries from backend state.</div>
    </div>
  `;
}

function buildSceneOpenPayloadFromForm() {
  const sceneId = document.querySelector('#llm-rpg-scene-open-id')?.value?.trim() || '';
  const location = document.querySelector('#llm-rpg-scene-open-location')?.value?.trim() || '';
  if (!sceneId || !location) {
    throw new Error('Open Scene requires scene ID and location.');
  }

  const timeOfDay = document.querySelector('#llm-rpg-scene-open-time')?.value?.trim() || null;
  const tensionRaw = document.querySelector('#llm-rpg-scene-open-tension')?.value;
  return {
    scene_id: sceneId,
    location,
    time_of_day: timeOfDay,
    nearby_npcs: splitLooseList(document.querySelector('#llm-rpg-scene-open-npcs')?.value),
    notable_objects: splitLooseList(document.querySelector('#llm-rpg-scene-open-objects')?.value),
    exits: splitLooseList(document.querySelector('#llm-rpg-scene-open-exits')?.value),
    scene_tags: splitLooseList(document.querySelector('#llm-rpg-scene-open-tags')?.value),
    tension_level: Number.isFinite(Number(tensionRaw)) ? Number(tensionRaw) : 0,
  };
}

function buildSceneClosePayloadFromForm() {
  const summary = document.querySelector('#llm-rpg-scene-close-summary')?.value?.trim() || '';
  if (!summary) {
    throw new Error('Close Scene requires a summary.');
  }

  const nextSceneId = document.querySelector('#llm-rpg-scene-next-id')?.value?.trim() || '';
  const nextLocation = document.querySelector('#llm-rpg-scene-next-location')?.value?.trim() || '';
  const nextTime = document.querySelector('#llm-rpg-scene-next-time')?.value?.trim() || '';
  const payload = {
    summary,
    durable_facts: splitLooseList(document.querySelector('#llm-rpg-scene-close-facts')?.value, /[\n;]+/),
  };

  if (nextSceneId || nextLocation || nextTime) {
    if (!nextSceneId || !nextLocation) {
      throw new Error('Next scene requires both next ID and next location.');
    }
    payload.next_scene = {
      scene_id: nextSceneId,
      location: nextLocation,
      time_of_day: nextTime || null,
      nearby_npcs: [],
      notable_objects: [],
      exits: [],
      scene_tags: [],
      tension_level: 0,
    };
  }

  return payload;
}

function buildSessionSummaryPayloadFromForm() {
  const summary = document.querySelector('#llm-rpg-session-summary-text')?.value?.trim() || '';
  if (!summary) {
    throw new Error('Session Summary requires summary text.');
  }

  return {
    summary,
    durable_facts: splitLooseList(document.querySelector('#llm-rpg-session-summary-facts')?.value, /[\n;]+/),
    tags: splitLooseList(document.querySelector('#llm-rpg-session-summary-tags')?.value),
  };
}

function clearSessionSummaryForm() {
  for (const selector of [
    '#llm-rpg-session-summary-draft-instructions',
    '#llm-rpg-session-summary-text',
    '#llm-rpg-session-summary-facts',
    '#llm-rpg-session-summary-tags',
  ]) {
    const node = document.querySelector(selector);
    if (node) node.value = '';
  }
  const status = document.querySelector('#llm-rpg-session-summary-status');
  if (status) {
    status.textContent = 'Drafting is advisory only. Review the filled fields before saving.';
  }
}

async function submitSessionSummaryPayload(payload) {
  const response = await requestJson(`/journal/session-summary${buildActorQuery()}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  await refreshPanel(response.refresh_hints || ['events', 'journal', 'lorebook']);
  return response;
}

async function submitSessionSummaryForm() {
  const payload = buildSessionSummaryPayloadFromForm();
  const response = await submitSessionSummaryPayload(payload);
  clearSessionSummaryForm();
  appendInfoLog('/session_summary', 'Session summary recorded and lorebook insertion entries rebuilt.');
  await appendInfoMessageToChat('RPG Session Summary', [payload.summary, ...payload.durable_facts.map(fact => `Fact: ${fact}`)]);
  return response;
}

async function draftSessionSummaryFromChat(instructions = '') {
  const messages = buildSessionSummaryChatMessages();
  if (!messages.length) {
    throw new Error('No eligible chat messages were found to summarize.');
  }

  return requestJson(`/journal/draft-session-summary${buildActorQuery()}`, {
    method: 'POST',
    body: JSON.stringify({
      chat_title: getCurrentChatTitle(),
      instructions: String(instructions || '').trim() || null,
      messages,
    }),
  });
}

function fillSessionSummaryDraft(draft) {
  const summaryInput = document.querySelector('#llm-rpg-session-summary-text');
  const factsInput = document.querySelector('#llm-rpg-session-summary-facts');
  const tagsInput = document.querySelector('#llm-rpg-session-summary-tags');
  const status = document.querySelector('#llm-rpg-session-summary-status');

  if (summaryInput) summaryInput.value = draft.summary || '';
  if (factsInput) factsInput.value = (draft.durable_facts || []).join('\n');
  if (tagsInput && !tagsInput.value.trim()) {
    tagsInput.value = 'session, catchup';
  }
  if (status) {
    const warningText = (draft.warnings || []).length ? ` warnings: ${draft.warnings.join(', ')}` : '';
    const messageCount = Number(draft?.source_counts?.messages || 0);
    status.textContent = `Drafted from ${messageCount} chat message${messageCount === 1 ? '' : 's'}.${warningText}`;
  }
}

function formatSessionSummaryDraftResult(draft) {
  const facts = (draft.durable_facts || []).map(fact => `- ${fact}`).join('\n') || '- None';
  const warnings = (draft.warnings || []).map(warning => `- ${warning}`).join('\n') || '- None';
  return [
    '[RPG SESSION SUMMARY DRAFT]',
    `Chat: ${draft.chat_title || 'unknown_chat'}`,
    `Model: ${draft.model || 'unknown'}`,
    '',
    draft.summary || '',
    '',
    'Durable facts:',
    facts,
    '',
    'Warnings:',
    warnings,
    '[/RPG SESSION SUMMARY DRAFT]',
  ].join('\n');
}

async function draftSessionSummaryFromForm() {
  const instructions = document.querySelector('#llm-rpg-session-summary-draft-instructions')?.value || '';
  const draft = await draftSessionSummaryFromChat(instructions);
  fillSessionSummaryDraft(draft);
  appendInfoLog('/session_summary_draft', `Drafted session summary from ${draft.source_counts?.messages || 0} chat messages.`);
  return draft;
}

async function syncLorebookFromPanel() {
  const response = await requestJson(`/state/lorebook/sync${buildActorQuery()}`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  await refreshPanel(response.refresh_hints || ['lorebook']);
  appendInfoLog('/lorebook', 'Lorebook insertion entries rebuilt from canonical state.');
  return response;
}

async function draftSceneCloseSummary(instructions = '') {
  return requestJson(`/scene/draft-close-summary${buildActorQuery()}`, {
    method: 'POST',
    body: JSON.stringify({
      instructions: String(instructions || '').trim() || null,
      recent_event_limit: 8,
      recent_journal_limit: 8,
    }),
  });
}

async function openSceneWithPayload(payload) {
  const response = await requestJson(`/scene/open${buildActorQuery()}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  await refreshPanel(response.refresh_hints || ['overview', 'scene', 'events', 'campaign']);
  return response;
}

async function closeSceneWithPayload(payload) {
  const response = await requestJson(`/scene/close${buildActorQuery()}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  await refreshPanel(response.refresh_hints || ['overview', 'scene', 'events', 'journal', 'campaign', 'scene_archive']);
  return response;
}

function fillSceneCloseDraft(draft) {
  const summaryInput = document.querySelector('#llm-rpg-scene-close-summary');
  const factsInput = document.querySelector('#llm-rpg-scene-close-facts');
  const status = document.querySelector('#llm-rpg-scene-draft-status');
  if (summaryInput) summaryInput.value = draft.summary || '';
  if (factsInput) factsInput.value = (draft.durable_facts || []).join('\n');
  if (status) {
    const warningText = (draft.warnings || []).length ? ` warnings: ${draft.warnings.join(', ')}` : '';
    status.textContent = `Drafted ${draft.durable_facts?.length || 0} durable fact(s).${warningText}`;
  }
}

function clearSceneLifecycleForms() {
  for (const selector of [
    '#llm-rpg-scene-open-id',
    '#llm-rpg-scene-open-location',
    '#llm-rpg-scene-open-time',
    '#llm-rpg-scene-open-npcs',
    '#llm-rpg-scene-open-objects',
    '#llm-rpg-scene-open-exits',
    '#llm-rpg-scene-open-tags',
    '#llm-rpg-scene-draft-instructions',
    '#llm-rpg-scene-close-summary',
    '#llm-rpg-scene-close-facts',
    '#llm-rpg-scene-next-id',
    '#llm-rpg-scene-next-location',
    '#llm-rpg-scene-next-time',
  ]) {
    const node = document.querySelector(selector);
    if (node) node.value = '';
  }
  const tension = document.querySelector('#llm-rpg-scene-open-tension');
  if (tension) tension.value = '0';
  const status = document.querySelector('#llm-rpg-scene-draft-status');
  if (status) status.textContent = '';
}

function formatSceneDraftResult(draft) {
  const facts = (draft.durable_facts || []).map(fact => `- ${fact}`).join('\n') || '- None';
  const warnings = (draft.warnings || []).map(warning => `- ${warning}`).join('\n') || '- None';
  return [
    '[RPG SCENE DRAFT]',
    `Scene: ${draft.scene_id || 'unknown_scene'}`,
    `Model: ${draft.model || 'unknown'}`,
    '',
    draft.summary || '',
    '',
    'Durable facts:',
    facts,
    '',
    'Warnings:',
    warnings,
    '[/RPG SCENE DRAFT]',
  ].join('\n');
}

function formatSceneLifecycleResult(title, response) {
  const tag = `RPG ${title}`;
  return [
    `[${tag}]`,
    JSON.stringify(response, null, 2),
    `[/${tag}]`,
  ].join('\n');
}

async function draftSceneCloseSummaryFromForm() {
  const instructions = document.querySelector('#llm-rpg-scene-draft-instructions')?.value || '';
  const draft = await draftSceneCloseSummary(instructions);
  fillSceneCloseDraft(draft);
  appendInfoLog('/scene_draft_close', `Drafted close summary for ${draft.scene_id}.`);
  await appendInfoMessageToChat('RPG Scene Draft', [draft.summary || '', ...(draft.durable_facts || []).map(fact => `Fact: ${fact}`)]);
  return draft;
}

async function submitOpenSceneForm() {
  const payload = buildSceneOpenPayloadFromForm();
  const response = await openSceneWithPayload(payload);
  appendInfoLog('/scene_open', `Opened scene ${response.scene?.scene_id || payload.scene_id}.`);
  await appendInfoMessageToChat('RPG Scene', [`Opened scene ${response.scene?.scene_id || payload.scene_id}.`]);
  return response;
}

async function submitCloseSceneForm() {
  const payload = buildSceneClosePayloadFromForm();
  const response = await closeSceneWithPayload(payload);
  appendInfoLog('/scene_close', `Closed scene ${response.closed_scene?.scene_id || 'unknown_scene'}.`);
  await appendInfoMessageToChat('RPG Scene', [`Closed scene ${response.closed_scene?.scene_id || 'unknown_scene'}.`]);
  return response;
}

async function sceneDraftCloseCommand(rawText) {
  const draft = await draftSceneCloseSummary(rawText);
  fillSceneCloseDraft(draft);
  appendInfoLog('/scene_draft_close', `Drafted close summary for ${draft.scene_id}.`);
  return formatSceneDraftResult(draft);
}

async function sessionSummaryDraftCommand(rawText) {
  const draft = await draftSessionSummaryFromChat(rawText);
  fillSessionSummaryDraft(draft);
  appendInfoLog('/session_summary_draft', `Drafted session summary from ${draft.source_counts?.messages || 0} chat messages.`);
  return formatSessionSummaryDraftResult(draft);
}

async function sceneOpenCommand(rawText) {
  const [sceneId, location, timeOfDay, tags, tension] = parsePipeParts(rawText);
  if (!sceneId || !location) {
    throw new Error('/scene_open requires "scene_id | location" and optional time/tags/tension.');
  }
  const response = await openSceneWithPayload({
    scene_id: sceneId,
    location,
    time_of_day: timeOfDay || null,
    scene_tags: splitLooseList(tags),
    tension_level: Number.isFinite(Number(tension)) ? Number(tension) : 0,
    nearby_npcs: [],
    notable_objects: [],
    exits: [],
  });
  appendInfoLog('/scene_open', `Opened scene ${response.scene?.scene_id || sceneId}.`);
  return formatSceneLifecycleResult('SCENE OPEN', response);
}

async function sceneCloseCommand(rawText) {
  const [summary, facts, nextSceneId, nextLocation, nextTime] = parsePipeParts(rawText);
  if (!summary) {
    throw new Error('/scene_close requires "summary" and optional facts/next scene fields.');
  }
  const payload = {
    summary,
    durable_facts: splitLooseList(facts, /[\n;]+/),
  };
  if (nextSceneId || nextLocation || nextTime) {
    if (!nextSceneId || !nextLocation) {
      throw new Error('/scene_close next scene requires both next_scene_id and next_location.');
    }
    payload.next_scene = {
      scene_id: nextSceneId,
      location: nextLocation,
      time_of_day: nextTime || null,
      nearby_npcs: [],
      notable_objects: [],
      exits: [],
      scene_tags: [],
      tension_level: 0,
    };
  }
  const response = await closeSceneWithPayload(payload);
  appendInfoLog('/scene_close', `Closed scene ${response.closed_scene?.scene_id || 'unknown_scene'}.`);
  return formatSceneLifecycleResult('SCENE CLOSE', response);
}

async function lorebookCommand() {
  const payload = await requestJson(`/state/lorebook/insertion-entries${buildQuery({ sync: true })}`);
  await refreshPanel(['lorebook']);
  const message = `${payload.entry_count || 0} keyword insertion entries available.`;
  appendInfoLog('/lorebook', message);
  await appendInfoMessageToChat('RPG Lorebook', [message]);
  return `[RPG LOREBOOK]\n${JSON.stringify(payload.entries || [], null, 2)}\n[/RPG LOREBOOK]`;
}

async function sessionSummaryCommand(rawText) {
  const [summary, facts, tags] = parsePipeParts(rawText);
  if (!summary) {
    throw new Error('/session_summary requires "summary" and optional facts/tags fields.');
  }
  const payload = {
    summary,
    durable_facts: splitLooseList(facts, /[\n;]+/),
    tags: splitLooseList(tags),
  };
  const response = await submitSessionSummaryPayload(payload);
  appendInfoLog('/session_summary', 'Session summary recorded and lorebook insertion entries rebuilt.');
  return `[RPG SESSION SUMMARY]\n${JSON.stringify(response, null, 2)}\n[/RPG SESSION SUMMARY]`;
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

function clearExecutionLog() {
  const root = document.querySelector('#llm-rpg-log');
  if (!root) return;
  root.dataset.initialized = 'true';
  root.innerHTML = '<div class="llm-rpg-empty">No executions yet.</div>';
}

function refreshSaveBindingControls() {
  const binding = getSaveBinding();
  const saveNameInput = document.querySelector('#llm-rpg-save-name');
  const saveIdInput = document.querySelector('#llm-rpg-save-id');
  const saveMeta = document.querySelector('#llm-rpg-save-meta');

  if (saveNameInput) saveNameInput.value = binding.saveName || '';
  if (saveIdInput) saveIdInput.value = binding.saveId || '';
  if (saveMeta) {
    saveMeta.textContent = `Chat title: ${getCurrentChatTitle()} | source: ${binding.source || 'manual'}`;
  }
}

async function applySaveBinding(binding) {
  const normalized = normalizeSaveBinding(binding, binding?.source || 'manual');
  const previous = getSaveBinding();
  const changed = previous.saveId !== normalized.saveId;

  await setSaveBinding(normalized, { clearTransientState: changed });
  refreshSaveBindingControls();

  if (changed) {
    clearExecutionLog();
    refreshActivatedLorePanel();
    refreshExtractionReviewPanel();
  }

  return normalized;
}

function buildSaveBindingFromSettingsInputs() {
  const enteredSaveName = document.querySelector('#llm-rpg-save-name')?.value?.trim() || '';
  if (!enteredSaveName) {
    return deriveDefaultSaveBinding();
  }

  return normalizeSaveBinding({
    saveName: enteredSaveName,
    chatTitle: getCurrentChatTitle(),
    source: 'manual',
  }, 'manual');
}

async function refreshPanel(refreshHints) {
  return await refreshPanelFromHints(refreshHints);
}

function normalizeRefreshHints(refreshHints) {
  const fallback = ['overview', 'inventory', 'quests', 'relationships', 'journal', 'lorebook', 'events', 'actor', 'campaign', 'scene', 'scene_archive'];
  const source = Array.isArray(refreshHints) && refreshHints.length ? refreshHints : fallback;
  return new Set(source.map(hint => String(hint || '').trim().toLowerCase()).filter(Boolean));
}

async function refreshPanelFromHints(refreshHints) {
  refreshSaveBindingControls();
  const hints = normalizeRefreshHints(refreshHints);
  const shouldFetchOverview = hints.has('overview') || hints.has('inventory') || hints.has('actor');
  const shouldFetchActor = hints.has('actor') || hints.has('inventory') || hints.has('overview');
  const shouldFetchScene = hints.has('scene') || hints.has('overview');
  const shouldFetchQuests = hints.has('quests') || hints.has('campaign');
  const shouldFetchRelationships = hints.has('relationships') || hints.has('campaign');
  const shouldFetchJournal = hints.has('journal');
  const shouldFetchLorebook = hints.has('lorebook');
  const shouldFetchEvents = hints.has('events');
  const shouldFetchSceneArchive = hints.has('scene_archive') || hints.has('scene');

  const [overview, scene, quests, relationships, journal, lorebook, events, actorDetail, sceneArchive] = await Promise.all([
    shouldFetchOverview ? requestJson(`/state/overview${buildActorQuery()}`) : Promise.resolve(null),
    shouldFetchScene ? requestJson('/state/scene/detail') : Promise.resolve(null),
    shouldFetchQuests ? requestJson('/state/quests') : Promise.resolve(null),
    shouldFetchRelationships ? requestJson('/state/relationships') : Promise.resolve(null),
    shouldFetchJournal ? requestJson('/journal/entries') : Promise.resolve(null),
    shouldFetchLorebook ? requestJson(`/state/lorebook/insertion-entries${buildQuery({ sync: true })}`) : Promise.resolve(null),
    shouldFetchEvents ? requestJson('/events/recent') : Promise.resolve(null),
    shouldFetchActor ? requestJson(`/state/actor/detail${buildActorQuery()}`) : Promise.resolve(null),
    shouldFetchSceneArchive ? requestJson('/state/scene/archive') : Promise.resolve(null),
  ]);

  const overviewRoot = document.querySelector('#llm-rpg-overview');
  const sceneRoot = document.querySelector('#llm-rpg-scene');
  const inventoryRoot = document.querySelector('#llm-rpg-inventory');
  const questsRoot = document.querySelector('#llm-rpg-quests');
  const relationshipsRoot = document.querySelector('#llm-rpg-relationships');
  const journalRoot = document.querySelector('#llm-rpg-journal');
  const lorebookRoot = document.querySelector('#llm-rpg-lorebook');
  const eventsRoot = document.querySelector('#llm-rpg-events');
  const sceneArchiveRoot = document.querySelector('#llm-rpg-scene-archive');

  if (overviewRoot && overview && actorDetail) {
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

  if (inventoryRoot && overview && actorDetail) {
    inventoryRoot.innerHTML = renderInventoryAndAssignedGear(overview.inventory, actorDetail);
  }

  if (sceneRoot && scene) {
    sceneRoot.innerHTML = renderSceneDetail(scene);
  }

  if (questsRoot && quests) {
    questsRoot.innerHTML = renderQuestAccordion(quests);
  }

  if (relationshipsRoot && relationships) {
    relationshipsRoot.innerHTML = renderRelationshipsAccordion(relationships);
  }

  if (journalRoot && journal) {
    journalRoot.innerHTML = renderJournalEntries(journal);
  }

  if (lorebookRoot && lorebook) {
    lorebookRoot.innerHTML = renderLorebookEntries(lorebook);
  }

  if (eventsRoot && events) {
    const items = events.events || [];
    eventsRoot.innerHTML = items.length
      ? `<ul class="llm-rpg-list">${items.map(item => `<li>${escapeHtml(item.command_name || item.event_type || item.type || 'event')} - ${escapeHtml(item.summary || item.message || item.id || '')}</li>`).join('')}</ul>`
      : '<div class="llm-rpg-empty">None</div>';
  }

  if (sceneArchiveRoot && sceneArchive) {
    sceneArchiveRoot.innerHTML = renderSceneArchives(sceneArchive);
  }

  refreshActivatedLorePanel();
  refreshExtractionReviewPanel();
  bindInventorySearchHandlers();
  bindQuestEditorHandlers();

  const inspectorRelevant = (
    hints.has('overview') ||
    hints.has('inventory') ||
    hints.has('actor') ||
    hints.has('campaign') ||
    hints.has('quests') ||
    hints.has('relationships') ||
    hints.has('scene')
  );
  if (inspectorRelevant) {
    await refreshInspectorPanel({
      actor: actorDetail,
      scene,
    });
  }
}

async function executeAgainstBackend(rawText) {
  const settings = getSettings();
  const apiResponse = await requestJson('/commands/execute', {
    method: 'POST',
    body: JSON.stringify({
      actor_id: settings.actorId,
      text: rawText,
      failure_policy: settings.failurePolicy || DEFAULT_SETTINGS.failurePolicy,
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

  await refreshPanel(apiResponse.refresh_hints);
  return apiResponse;
}

async function resolveTurnAgainstBackend(rawText, options = {}) {
  const settings = getSettings();
  const extractionRequested = Boolean(options.includeExtraction ?? settings.includeExtractionOnResolveTurn);
  await setExtractionReviewContext({
    turnId: null,
    playerInput: rawText,
    requested: extractionRequested,
    pending: true,
    narratorModel: null,
    extractorModel: null,
    proposedUpdates: [],
    appliedUpdates: [],
    stagedUpdates: [],
    warnings: [],
    handledEntries: {},
    actionStatus: null,
    createdAt: Date.now(),
  });
  refreshExtractionReviewPanel();
  const recentChatMessages = buildRecentChatMessages(options.chatMessages || null, {
    excludeLatestUserText: rawText,
  });
  let apiResponse;
  try {
    apiResponse = await requestJson('/narration/resolve-turn', {
      method: 'POST',
      body: JSON.stringify({
        actor_id: settings.actorId,
        text: rawText,
        recent_chat_messages: recentChatMessages,
        failure_policy: settings.failurePolicy || DEFAULT_SETTINGS.failurePolicy,
        include_extraction: extractionRequested,
      }),
    });
  } catch (error) {
    await setExtractionReviewContext({
      turnId: null,
      playerInput: rawText,
      requested: extractionRequested,
      pending: false,
      narratorModel: null,
      extractorModel: null,
      proposedUpdates: [],
      appliedUpdates: [],
      stagedUpdates: [],
      warnings: [{ stage: 'resolve_turn', error_code: 'request_failed', message: error.message || 'Resolve-turn request failed.' }],
      handledEntries: {},
      actionStatus: null,
      createdAt: Date.now(),
    });
    refreshExtractionReviewPanel();
    throw error;
  }

  if (settings.keepExecutionLog && Array.isArray(apiResponse.results) && apiResponse.results.length) {
    appendExecutionLog(apiResponse);
  }
  if (settings.keepExecutionLog && (!Array.isArray(apiResponse.results) || !apiResponse.results.length) && apiResponse.turn_id) {
    appendExecutionLog(apiResponse);
  }

  if (Array.isArray(apiResponse.results) && apiResponse.results.length) {
    await appendActionMessageToChat(apiResponse);
  }

  if (apiResponse.prose && options.appendNarration !== false) {
    await appendNarrationMessageToChat(apiResponse.prose);
  }

  await setActivatedLoreContext({
    turnId: apiResponse.turn_id || null,
    playerInput: rawText,
    entries: Array.isArray(apiResponse.activated_lore_entries) ? apiResponse.activated_lore_entries : [],
    createdAt: Date.now(),
  });
  await setExtractionReviewContext({
    turnId: apiResponse.turn_id || null,
    playerInput: rawText,
    requested: extractionRequested,
    pending: false,
    narratorModel: apiResponse.narrator_model || null,
    extractorModel: apiResponse.extractor_model || null,
    proposedUpdates: Array.isArray(apiResponse.proposed_updates) ? apiResponse.proposed_updates : [],
    appliedUpdates: Array.isArray(apiResponse.applied_updates) ? apiResponse.applied_updates : [],
    stagedUpdates: Array.isArray(apiResponse.staged_updates) ? apiResponse.staged_updates : [],
    warnings: Array.isArray(apiResponse.warnings) ? apiResponse.warnings : [],
    handledEntries: {},
    actionStatus: null,
    createdAt: Date.now(),
  });
  const warnings = Array.isArray(apiResponse.warnings) ? apiResponse.warnings : [];
  for (const warning of warnings) {
    appendInfoLog(`/resolve_turn/${warning.stage || 'warning'}`, warning.message || 'Resolve-turn returned a warning.');
  }
  if (warnings.length) {
    const stages = [...new Set(warnings.map(warning => String(warning.stage || 'warning')))].join(', ');
    notify(`Resolve-turn completed with ${stages} warning${warnings.length === 1 ? '' : 's'}.`, 'info');
  }
  if (extractionRequested || apiResponse.proposed_updates?.length || apiResponse.applied_updates?.length || apiResponse.staged_updates?.length) {
    appendInfoLog(
      '/extract',
      `proposed ${apiResponse.proposed_updates?.length || 0} | applied ${apiResponse.applied_updates?.length || 0} | staged ${apiResponse.staged_updates?.length || 0} | warnings ${warnings.length}`,
    );
  }
  appendInfoLog('/lore_activate', `${apiResponse.activated_lore_entries?.length || 0} lore entries activated for narration.`);
  refreshActivatedLorePanel();
  refreshExtractionReviewPanel();
  await refreshPanel(apiResponse.refresh_hints);
  return apiResponse;
}

async function handleReadOnlyCommand(commandName) {
  if (commandName === 'inventory') {
    const inventory = await requestJson(`/state/inventory${buildActorQuery()}`);
    await refreshPanel();
    const itemCount = Object.keys(inventory.inventory || {}).length;
    const message = `${itemCount} tracked item ${itemCount === 1 ? 'entry' : 'entries'}.`;
    appendInfoLog('/inventory', message);
    await appendInfoMessageToChat('RPG Info', ['/inventory - refreshed', message]);
    return `[RPG INVENTORY]\n${JSON.stringify(inventory, null, 2)}\n[/RPG INVENTORY]`;
  }

  if (commandName === 'quest') {
    const quests = await requestJson('/state/quests');
    await refreshPanel();
    const rawQuests = quests.active_quests || {};
    const questCount = Array.isArray(rawQuests) ? rawQuests.length : Object.keys(rawQuests).length;
    const message = `${questCount} active ${questCount === 1 ? 'quest' : 'quests'}.`;
    appendInfoLog('/quest', message);
    await appendInfoMessageToChat('RPG Info', ['/quest - refreshed', message]);
    return `[RPG QUESTS]\n${JSON.stringify(quests, null, 2)}\n[/RPG QUESTS]`;
  }

  if (commandName === 'journal') {
    const entries = await requestJson('/journal/entries');
    await refreshPanel(['journal']);
    const count = Array.isArray(entries.entries) ? entries.entries.length : 0;
    const message = `${count} recent ${count === 1 ? 'entry' : 'entries'} loaded.`;
    appendInfoLog('/journal', message);
    await appendInfoMessageToChat('RPG Info', ['/journal - refreshed', message]);
    return `[RPG JOURNAL]\n${JSON.stringify(entries, null, 2)}\n[/RPG JOURNAL]`;
  }

  if (commandName === 'lorebook') {
    return await lorebookCommand();
  }

  if (commandName === 'actor') {
    const actor = await requestJson(`/state/actor/detail${buildActorQuery()}`);
    const customSkillCount = Object.keys(actor.custom_skills || {}).length;
    const spellCount = Object.keys(actor.known_spells || {}).length;
    const message = `${customSkillCount} custom skills, ${spellCount} known spells.`;
    appendInfoLog('/actor', message);
    await appendInfoMessageToChat('RPG Info', ['/actor - detail loaded', message]);
    return `[RPG ACTOR]\n${JSON.stringify(actor, null, 2)}\n[/RPG ACTOR]`;
  }

  if (commandName === 'campaign') {
    const campaign = await requestJson('/state/campaign/detail');
    const questCount = Object.keys(campaign.quests || {}).length;
    const message = `${questCount} quest records available.`;
    appendInfoLog('/campaign', message);
    await appendInfoMessageToChat('RPG Info', ['/campaign - detail loaded', message]);
    return `[RPG CAMPAIGN]\n${JSON.stringify(campaign, null, 2)}\n[/RPG CAMPAIGN]`;
  }

  if (commandName === 'scene') {
    const scene = await requestJson('/state/scene/detail');
    await refreshPanel(['scene']);
    const objectCount = Array.isArray(scene.notable_objects) ? scene.notable_objects.length : 0;
    const message = `${objectCount} notable scene objects tracked.`;
    appendInfoLog('/scene', message);
    await appendInfoMessageToChat('RPG Info', ['/scene - detail loaded', message]);
    return `[RPG SCENE]\n${JSON.stringify(scene, null, 2)}\n[/RPG SCENE]`;
  }

  if (commandName === 'relationships') {
    const relationships = await requestJson('/state/relationships');
    await refreshPanel(['relationships']);
    const count = Object.keys(relationships.relationships || {}).length;
    const message = `${count} relationship ${count === 1 ? 'record' : 'records'} loaded.`;
    appendInfoLog('/relationships', message);
    await appendInfoMessageToChat('RPG Info', ['/relationships - refreshed', message]);
    return `[RPG RELATIONSHIPS]\n${JSON.stringify(relationships, null, 2)}\n[/RPG RELATIONSHIPS]`;
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
  if (commandName === 'scene_draft_close') {
    return await sceneDraftCloseCommand(text);
  }

  if (commandName === 'session_summary_draft') {
    return await sessionSummaryDraftCommand(text);
  }

  if (commandName === 'session_summary') {
    return await sessionSummaryCommand(text);
  }

  if (commandName === 'scene_open') {
    return await sceneOpenCommand(text);
  }

  if (commandName === 'scene_close') {
    return await sceneCloseCommand(text);
  }

  if (commandName === 'rpg') {
    const { subcommand, remainder } = parseRpgProxyText(text);
    if (!subcommand) {
      throw new Error('Usage: /rpg actor | campaign | scene | inventory | quest | journal | lorebook | relationships | session_summary | session_summary_draft | scene_open | scene_close | scene_draft_close | condition | scene_move | scene_object | scene_clue | scene_hazard | scene_discovery | new ...');
    }
    if (subcommand === 'scene_draft_close') {
      return await sceneDraftCloseCommand(remainder);
    }
    if (subcommand === 'session_summary_draft') {
      return await sessionSummaryDraftCommand(remainder);
    }
    if (subcommand === 'session_summary') {
      return await sessionSummaryCommand(remainder);
    }
    if (subcommand === 'scene_open') {
      return await sceneOpenCommand(remainder);
    }
    if (subcommand === 'scene_close') {
      return await sceneCloseCommand(remainder);
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
    consumable: Boolean(document.querySelector('#llm-rpg-builder-consumable')?.checked),
  };
}

function setBuilderFieldValues({ name = '', secondary = '', tertiary = '', description = '', consumable = false } = {}) {
  const nameInput = document.querySelector('#llm-rpg-builder-name');
  const secondaryInput = document.querySelector('#llm-rpg-builder-secondary');
  const tertiaryInput = document.querySelector('#llm-rpg-builder-tertiary');
  const descriptionInput = document.querySelector('#llm-rpg-builder-description');
  const consumableInput = document.querySelector('#llm-rpg-builder-consumable');
  if (nameInput) nameInput.value = name;
  if (secondaryInput) secondaryInput.value = secondary;
  if (tertiaryInput) tertiaryInput.value = tertiary;
  if (descriptionInput) descriptionInput.value = description;
  if (consumableInput) consumableInput.checked = Boolean(consumable);
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
  const consumableRow = document.querySelector('#llm-rpg-builder-consumable-row');
  const consumableInput = document.querySelector('#llm-rpg-builder-consumable');

  if (!secondaryLabel || !tertiaryLabel || !secondaryInput || !tertiaryInput || !tertiaryRow || !descriptionLabel || !descriptionInput || !submitButton || !nameInput || !consumableRow || !consumableInput) {
    return;
  }

  if (type === 'custom_skill') {
    nameInput.placeholder = 'swimming';
    secondaryLabel.textContent = 'Value';
    secondaryInput.placeholder = '3';
    tertiaryLabel.textContent = 'Unused';
    tertiaryInput.placeholder = '';
    tertiaryRow.style.display = 'none';
    consumableRow.style.display = 'none';
    consumableInput.checked = false;
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
    consumableRow.style.display = 'none';
    consumableInput.checked = false;
    descriptionLabel.textContent = 'Description';
    descriptionInput.placeholder = 'Slow the fall of nearby creatures.';
    submitButton.textContent = 'Create / Update spell';
  } else {
    nameInput.placeholder = 'rope';
    secondaryLabel.textContent = 'Amount';
    secondaryInput.placeholder = '2';
    tertiaryLabel.textContent = 'Kind / Tags';
    tertiaryInput.placeholder = 'tool, alchemy';
    tertiaryRow.style.display = '';
    consumableRow.style.display = '';
    descriptionLabel.textContent = 'Description';
    descriptionInput.placeholder = '50 feet of braided hemp rope.';
    submitButton.textContent = 'Create / Update item';
  }
}

function clearBuilderComposer() {
  setBuilderFieldValues();
  updateBuilderComposerForm();
}

function normalizeBuilderItemTags(rawKind, consumable) {
  const tokens = String(rawKind || '')
    .split(',')
    .map(part => part.trim().toLowerCase())
    .filter(Boolean);

  if (consumable && !tokens.includes('consumable')) {
    tokens.unshift('consumable');
  }

  const uniqueTokens = [];
  for (const token of tokens) {
    if (!uniqueTokens.includes(token)) {
      uniqueTokens.push(token);
    }
  }

  return uniqueTokens.length ? uniqueTokens.join(', ') : 'misc';
}

function buildBuilderCommandFromForm() {
  const { type, name, secondary, tertiary, description, consumable } = getBuilderFieldValues();
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
    rawArgument: [
      name,
      secondary || '1',
      normalizeBuilderItemTags(tertiary, consumable),
      description || `Player-defined item: ${name}.`,
    ].join(' :: '),
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

      <div id="llm-rpg-builder-consumable-row" class="llm-rpg-builder-toggle-row" style="display:none;">
        <label for="llm-rpg-builder-consumable">Consumable</label>
        <input id="llm-rpg-builder-consumable" type="checkbox" />
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
  const saveBinding = getSaveBinding();
  const settingsInner = `
    <div class="llm-rpg-settings-grid">
      <div class="llm-rpg-field-row">
        <label for="llm-rpg-backend-url">Backend URL</label>
        <input id="llm-rpg-backend-url" type="text" value="${escapeHtml(settings.backendBaseUrl)}" />
      </div>
      <div class="llm-rpg-field-row">
        <label for="llm-rpg-save-name">Save Name</label>
        <input id="llm-rpg-save-name" type="text" value="${escapeHtml(saveBinding.saveName || '')}" />
      </div>
      <div class="llm-rpg-field-row">
        <label for="llm-rpg-save-id">Save ID</label>
        <input id="llm-rpg-save-id" type="text" value="${escapeHtml(saveBinding.saveId || '')}" readonly />
      </div>
      <div id="llm-rpg-save-meta" class="llm-rpg-inline-note">Chat title: ${escapeHtml(getCurrentChatTitle())} | source: ${escapeHtml(saveBinding.source || 'manual')}</div>
      <div class="llm-rpg-field-row">
        <label for="llm-rpg-actor-id">Actor ID</label>
        <input id="llm-rpg-actor-id" type="text" value="${escapeHtml(settings.actorId)}" />
      </div>
      <div class="llm-rpg-field-row">
        <label for="llm-rpg-failure-policy">Failure</label>
        <select id="llm-rpg-failure-policy">
          <option value="best_effort" ${(settings.failurePolicy || DEFAULT_SETTINGS.failurePolicy) === 'best_effort' ? 'selected' : ''}>Best effort</option>
          <option value="rollback_on_failure" ${(settings.failurePolicy || DEFAULT_SETTINGS.failurePolicy) === 'rollback_on_failure' ? 'selected' : ''}>Rollback on fail</option>
        </select>
      </div>
      <div class="llm-rpg-toggle-row">
        <label for="llm-rpg-resolve-turns">Resolve normal turns via backend</label>
        <input id="llm-rpg-resolve-turns" type="checkbox" ${settings.resolveNarrativeTurns ? 'checked' : ''} />
      </div>
      <div class="llm-rpg-toggle-row">
        <label for="llm-rpg-include-extraction">Run extraction during resolve-turn</label>
        <input id="llm-rpg-include-extraction" type="checkbox" ${settings.includeExtractionOnResolveTurn ? 'checked' : ''} />
      </div>
      <div class="llm-rpg-settings-actions">
        <button id="llm-rpg-use-chat-title" class="menu_button">Use Chat Title</button>
        <button id="llm-rpg-save-settings" class="menu_button">Save</button>
      </div>
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
          <button id="llm-rpg-toggle" class="menu_button">x</button>
        </div>
      </div>

      <div class="llm-rpg-actions">
        <button id="llm-rpg-refresh" class="menu_button">Refresh</button>
        <button id="llm-rpg-open-inspector" class="menu_button">Inspector</button>
        <button id="llm-rpg-reset-position" class="menu_button">Reset</button>
        <button id="llm-rpg-clear-pending" class="menu_button">Clear Pending</button>
      </div>

      ${renderCollapsibleSection('overview', 'Overview', 'llm-rpg-overview')}
      ${renderCollapsibleSection('scene', 'Scene', 'llm-rpg-scene')}
      ${renderRawCollapsibleSection('scene_lifecycle', 'Scene Lifecycle', getSceneLifecycleHtml())}
      ${renderCollapsibleSection('inventory', 'Inventory', 'llm-rpg-inventory')}
      ${renderRawCollapsibleSection('builder', 'Builder / Composer', getBuilderComposerHtml())}
      ${renderCollapsibleSection('quests', 'Quests', 'llm-rpg-quests')}
      ${renderCollapsibleSection('relationships', 'Relationships', 'llm-rpg-relationships')}
      ${renderRawCollapsibleSection('session_summary', 'Session Summary', getSessionSummaryHtml())}
      ${renderCollapsibleSection('lorebook', 'Lorebook Insertions', 'llm-rpg-lorebook')}
      ${renderCollapsibleSection('activated_lore', 'Activated Lore', 'llm-rpg-activated-lore')}
      ${renderCollapsibleSection('extraction_review', 'Extraction Review', 'llm-rpg-extraction-review')}
      ${renderCollapsibleSection('journal', 'Journal', 'llm-rpg-journal')}
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
          <button id="llm-rpg-inspector-close" class="menu_button">x</button>
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
    settings.failurePolicy = document.querySelector('#llm-rpg-failure-policy')?.value || DEFAULT_SETTINGS.failurePolicy;
    settings.resolveNarrativeTurns = Boolean(document.querySelector('#llm-rpg-resolve-turns')?.checked);
    settings.includeExtractionOnResolveTurn = Boolean(document.querySelector('#llm-rpg-include-extraction')?.checked);
    saveSettings();
    await applySaveBinding(buildSaveBindingFromSettingsInputs());
    notify('LLM RPG Bridge settings saved.', 'success');
    await refreshPanel().catch(error => notify(error.message, 'error'));
  });

  document.querySelector('#llm-rpg-use-chat-title')?.addEventListener('click', async () => {
    try {
      await applySaveBinding(deriveDefaultSaveBinding());
      notify('Save binding reset from current chat title.', 'success');
      await refreshPanel().catch(error => notify(error.message, 'error'));
    } catch (error) {
      notify(error.message, 'error');
    }
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

  document.querySelector('#llm-rpg-scene-draft-summary')?.addEventListener('click', async () => {
    try {
      await draftSceneCloseSummaryFromForm();
      notify('Scene close summary drafted.', 'success');
    } catch (error) {
      notify(error.message, 'error');
    }
  });

  document.querySelector('#llm-rpg-scene-open-submit')?.addEventListener('click', async () => {
    try {
      await submitOpenSceneForm();
      notify('Scene opened.', 'success');
    } catch (error) {
      notify(error.message, 'error');
    }
  });

  document.querySelector('#llm-rpg-scene-close-submit')?.addEventListener('click', async () => {
    try {
      await submitCloseSceneForm();
      notify('Scene closed.', 'success');
    } catch (error) {
      notify(error.message, 'error');
    }
  });

  document.querySelector('#llm-rpg-scene-clear-forms')?.addEventListener('click', () => {
    clearSceneLifecycleForms();
  });

  document.querySelector('#llm-rpg-session-summary-draft')?.addEventListener('click', async () => {
    try {
      await draftSessionSummaryFromForm();
      notify('Session summary drafted from current chat.', 'success');
    } catch (error) {
      notify(error.message, 'error');
    }
  });

  document.querySelector('#llm-rpg-session-summary-save')?.addEventListener('click', async () => {
    try {
      await submitSessionSummaryForm();
      notify('Session summary saved.', 'success');
    } catch (error) {
      notify(error.message, 'error');
    }
  });

  document.querySelector('#llm-rpg-lorebook-sync')?.addEventListener('click', async () => {
    try {
      await syncLorebookFromPanel();
      notify('Lorebook insertion entries synced.', 'success');
    } catch (error) {
      notify(error.message, 'error');
    }
  });

  document.querySelector('#llm-rpg-session-summary-clear')?.addEventListener('click', () => {
    clearSessionSummaryForm();
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
  refreshSaveBindingControls();
  refreshActivatedLorePanel();
  refreshExtractionReviewPanel();

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

