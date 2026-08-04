function defaultContext() {
  return globalThis.SillyTavern?.getContext?.() ?? null;
}

function createElement(tag, className = '', text = '') {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

export function createNarratorContextInspector({
  getContext = defaultContext,
  getCapsule = () => null,
  executeCampaignOperation = async () => { throw new Error('Campaign context operations are unavailable.'); },
  setManualFocus = async () => { throw new Error('Manual narrator focus is unavailable.'); },
} = {}) {
  const state = {
    popup: null,
    root: null,
    returnFocus: null,
    busy: false,
    status: '',
    statusTone: 'neutral',
  };

  function setStatus(message = '', tone = 'neutral') {
    state.status = message;
    state.statusTone = tone;
    render();
  }

  function policyActions(record) {
    const actions = createElement('div', 'rpgcontext__policy');
    for (const [policy, label] of [['automatic', 'Auto'], ['pinned', 'Pin'], ['excluded', 'Exclude']]) {
      const button = createElement('button', record.policy === policy ? 'rpgcampaign__primary' : 'rpgcampaign__button', label);
      button.type = 'button';
      button.dataset.contextRecordId = record.id;
      button.dataset.contextPolicy = policy;
      button.disabled = state.busy || record.policy === policy;
      actions.appendChild(button);
    }
    return actions;
  }

  function recordActions(record) {
    const actions = createElement('div', 'rpgcontext__record-actions');
    if (record.id) {
      const focus = createElement('button', record.queued ? 'rpgcampaign__primary' : 'rpgcampaign__button', record.queued ? 'Queued' : 'Next reply');
      focus.type = 'button';
      focus.dataset.contextFocusId = record.id;
      focus.dataset.contextFocusEnabled = String(!record.queued);
      focus.setAttribute('aria-pressed', String(Boolean(record.queued)));
      focus.disabled = state.busy || record.policy === 'excluded';
      focus.title = record.policy === 'excluded' ? 'Excluded records cannot be queued.' : 'Expand this record for the next narrator reply.';
      actions.appendChild(focus);
    }
    if (record.controllable !== false) actions.appendChild(policyActions(record));
    return actions;
  }

  function recordCard(record, detail) {
    const card = createElement('article', 'rpgcontext__record');
    const copy = createElement('div');
    copy.append(
      createElement('strong', '', record.name || record.id),
      createElement('small', '', `${record.kind || 'record'} · ${detail}`),
    );
    card.append(copy, recordActions(record));
    return card;
  }

  function render() {
    if (!state.root) return;
    const result = getCapsule();
    const capsule = result?.capsule ?? result;
    const diagnostics = capsule?.diagnostics ?? {
      totalChars: String(capsule?.text ?? '').length,
      maxChars: 8_000,
      overflow: false,
      sections: [],
      selected: [],
      indexed: [],
      focus: [],
      omitted: [],
    };
    const manualFocusIds = new Set(diagnostics.manualFocusIds ?? []);
    const status = state.root.querySelector('[role="status"]');
    status.hidden = !state.status;
    status.textContent = state.status;
    status.dataset.tone = state.statusTone;
    state.root.querySelector('[data-context-total]').textContent = `${diagnostics.totalChars} / ${diagnostics.maxChars} characters`;
    state.root.querySelector('[data-context-overflow]').textContent = diagnostics.overflow
      ? 'Some eligible records were omitted by the hard budget.'
      : 'Everything eligible fits inside the current hard budget.';
    const meter = state.root.querySelector('[data-context-meter]');
    meter.max = diagnostics.maxChars;
    meter.value = diagnostics.totalChars;

    const sections = state.root.querySelector('[data-context-sections]');
    sections.replaceChildren();
    for (const section of diagnostics.sections ?? []) {
      const row = createElement('article', 'rpgcontext__section');
      row.append(
        createElement('strong', '', section.label),
        createElement('span', '', `${section.selectedCount} included · ${section.omittedCount} omitted · ${section.usedChars}/${section.maxChars} chars`),
      );
      sections.appendChild(row);
    }

    const focus = state.root.querySelector('[data-context-focus]');
    focus.replaceChildren();
    const focusRecords = diagnostics.focus ?? [];
    if (!focusRecords.length) focus.appendChild(createElement('p', 'rpgcontext__empty', 'No detailed records were retrieved. The narrator receives the compact indexes only.'));
    for (const record of focusRecords) {
      focus.appendChild(recordCard({ ...record, queued: manualFocusIds.has(record.id) }, record.reason || 'retrieved for this reply'));
    }

    const indexed = state.root.querySelector('[data-context-indexed]');
    indexed.replaceChildren();
    const focusIds = new Set(focusRecords.map(record => record.id));
    const indexedRecords = (diagnostics.indexed ?? diagnostics.selected ?? []).filter(record => !focusIds.has(record.id));
    if (!indexedRecords.length) indexed.appendChild(createElement('p', 'rpgcontext__empty', 'No additional controllable records are present in the compact indexes.'));
    for (const record of indexedRecords) {
      indexed.appendChild(recordCard({ ...record, queued: manualFocusIds.has(record.id) }, `index only · ${record.section}`));
    }

    const omitted = state.root.querySelector('[data-context-omitted]');
    omitted.replaceChildren();
    const controllableOmitted = (diagnostics.omitted ?? []).filter(record => record.controllable && record.recordId);
    const seen = new Set();
    for (const record of controllableOmitted) {
      if (seen.has(record.recordId)) continue;
      seen.add(record.recordId);
      omitted.appendChild(recordCard({ ...record, id: record.recordId, queued: manualFocusIds.has(record.recordId) }, `${record.reason} · ${record.section}`));
    }
    const fixedOmissions = (diagnostics.omitted ?? []).filter(record => !record.controllable);
    if (!controllableOmitted.length && !fixedOmissions.length) {
      omitted.appendChild(createElement('p', 'rpgcontext__empty', 'Nothing is omitted.'));
    }
    if (fixedOmissions.length) {
      const note = createElement('details', 'rpgcontext__fixed');
      note.appendChild(createElement('summary', '', `${fixedOmissions.length} Scene or relationship line${fixedOmissions.length === 1 ? '' : 's'} omitted`));
      const list = createElement('ul');
      for (const record of fixedOmissions) list.appendChild(createElement('li', '', `${record.name}: ${record.reason}`));
      note.appendChild(list);
      omitted.appendChild(note);
    }

    state.root.querySelector('[data-context-text]').textContent = capsule?.text ?? 'No verified Context Capsule is available.';
  }

  function ensureRoot() {
    if (state.root) return state.root;
    const root = document.createElement('section');
    root.className = 'rpgcontext';
    root.setAttribute('aria-label', 'Narrator Context');
    root.innerHTML = `
      <header class="rpgcontext__topbar">
        <div><span>NARRATOR CONTEXT</span><strong>What the model receives</strong></div>
        <button type="button" class="rpgcampaign__button" data-context-action="close">Back to Workspace</button>
      </header>
      <main class="rpgcontext__main">
        <section class="rpgcontext__intro">
          <span>VERIFIED CORE · DETERMINISTIC FOCUS</span>
          <h1>See exactly what the narrator knows.</h1>
          <p>The compact indexes are always available. Relevant full records are selected from recent chat, typed Campaign links, pins, and one-turn manual focus. Policy changes save a verified Campaign revision; retrieval itself never mutates Campaign state.</p>
        </section>
        <div class="rpgcontext__status" role="status" hidden></div>
        <section class="rpgcontext__budget">
          <div><strong data-context-total></strong><span data-context-overflow></span></div>
          <progress data-context-meter></progress>
        </section>
        <section class="rpgcontext__panel">
          <header><span>SECTION BUDGETS</span><h2>Context allocation</h2></header>
          <div class="rpgcontext__sections" data-context-sections></div>
        </section>
        <section class="rpgcontext__panel">
          <header><span>RETRIEVED DETAIL</span><h2>Focus for the next reply</h2></header>
          <div class="rpgcontext__records" data-context-focus></div>
        </section>
        <section class="rpgcontext__panel">
          <header><span>COMPACT ROSTER</span><h2>Index-only records</h2></header>
          <div class="rpgcontext__records" data-context-indexed></div>
        </section>
        <section class="rpgcontext__panel">
          <header><span>NOT INJECTED</span><h2>Omitted records</h2></header>
          <div class="rpgcontext__records" data-context-omitted></div>
        </section>
        <details class="rpgcontext__exact" open>
          <summary>Exact injected text</summary>
          <pre data-context-text></pre>
        </details>
      </main>
    `;
    root.addEventListener('click', handleClick);
    state.root = root;
    render();
    return root;
  }

  async function setPolicy(recordId, contextPolicy) {
    if (state.busy) return;
    state.busy = true;
    setStatus('Saving and recompiling narrator context…');
    try {
      await executeCampaignOperation({ type: 'set_context_policy', recordId, contextPolicy });
      if (contextPolicy === 'excluded') await setManualFocus(recordId, false);
      setStatus(`Context policy changed to ${contextPolicy}.`, 'success');
    } catch (error) {
      setStatus(error?.message ?? String(error), 'error');
    } finally {
      state.busy = false;
      render();
    }
  }

  async function setFocus(recordId, enabled) {
    if (state.busy) return;
    state.busy = true;
    setStatus(enabled ? 'Queuing detailed record for the next narrator reply…' : 'Removing next-reply focus…');
    try {
      await setManualFocus(recordId, enabled);
      setStatus(enabled ? 'Record queued for the next narrator reply.' : 'Record removed from next-reply focus.', 'success');
    } catch (error) {
      setStatus(error?.message ?? String(error), 'error');
    } finally {
      state.busy = false;
      render();
    }
  }

  function handleClick(event) {
    const policy = event.target.closest('[data-context-policy]');
    if (policy) {
      void setPolicy(policy.dataset.contextRecordId, policy.dataset.contextPolicy);
      return;
    }
    const focus = event.target.closest('[data-context-focus-id]');
    if (focus) {
      void setFocus(focus.dataset.contextFocusId, focus.dataset.contextFocusEnabled === 'true');
      return;
    }
    if (event.target.closest('[data-context-action="close"]')) void close();
  }

  function open(trigger) {
    const context = getContext();
    const Popup = context?.Popup;
    const POPUP_TYPE = context?.POPUP_TYPE;
    if (!Popup || POPUP_TYPE?.DISPLAY === undefined) return false;
    if (state.popup) return true;
    state.returnFocus = trigger instanceof HTMLElement ? trigger : document.activeElement;
    state.status = '';
    render();
    const popup = new Popup(ensureRoot(), POPUP_TYPE.DISPLAY, '', {
      wider: true,
      large: true,
      allowVerticalScrolling: true,
      leftAlign: true,
      allowEscapeClose: true,
      onClose: () => {
        state.popup = null;
        state.returnFocus?.focus?.();
      },
      onOpen: () => state.root.querySelector('[data-context-action="close"]')?.focus?.(),
    });
    state.popup = popup;
    void popup.show().catch(error => {
      console.error('[RPG Campaign] Narrator Context could not open.', error);
      state.popup = null;
    });
    return true;
  }

  async function close() {
    const cancelled = getContext()?.POPUP_RESULT?.CANCELLED ?? 0;
    await state.popup?.complete?.(cancelled);
  }

  return Object.freeze({ open, close });
}
