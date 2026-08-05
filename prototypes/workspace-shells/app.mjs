import { createMockCampaignEngine, createMockWorkspace } from './mock-workspace.mjs';

const engine = createMockCampaignEngine();
const workspace = createMockWorkspace(engine);
const campaignId = 'campaign-emberfall';

const shellMeta = {
  ledger: {
    name: 'Ledger',
    summary: 'Persistent navigation, collection index, and editor in a dense three-pane desktop shell.',
  },
  deck: {
    name: 'Command Deck',
    summary: 'Status-first dashboard with work queues, large task cards, and contextual work surfaces.',
  },
  book: {
    name: 'Campaign Book',
    summary: 'Document-centric pages with stable chapter navigation and one focused task per route.',
  },
};

const routeMeta = {
  home: { label: 'Campaign', short: 'Home' },
  actors: { label: 'People', short: 'People', collection: 'actors' },
  inventory: { label: 'Inventory', short: 'Gear', collection: 'inventory' },
  abilities: { label: 'Abilities', short: 'Powers', collection: 'abilities' },
  objectives: { label: 'Objectives', short: 'Quests', collection: 'objectives' },
  world: { label: 'World', short: 'World', collection: 'world' },
  review: { label: 'Review Inbox', short: 'Review' },
  context: { label: 'Context Tray', short: 'Context' },
  import: { label: 'Import Diff', short: 'Import' },
  maintenance: { label: 'Backups & Settings', short: 'System' },
};

const state = {
  shell: new URLSearchParams(location.search).get('shell') || localStorage.getItem('workspace-prototype-shell') || 'book',
  route: location.hash.slice(1) || 'home',
  selectedRecordId: null,
  document: null,
  notice: 'Prototype data is disposable. No Campaign state leaves this page.',
  loading: false,
  problem: null,
  simulatedRevision: null,
};

if (!shellMeta[state.shell]) state.shell = 'book';
if (!routeMeta[state.route]) state.route = 'home';

const app = document.querySelector('#app');
const liveRegion = document.querySelector('#live-region');

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function setNotice(message) {
  state.notice = message;
  liveRegion.textContent = message;
}

function formatProblem(problem) {
  return `
    <section class="problem" role="alert" aria-labelledby="problem-title">
      <div>
        <p class="eyebrow">${escapeHtml(problem.code)}</p>
        <h2 id="problem-title">This action needs attention</h2>
        <p>${escapeHtml(problem.message)}</p>
      </div>
      <div class="problem-actions">
        ${(problem.actions || []).map((action) => `<button type="button" class="button secondary" data-dismiss-problem>${escapeHtml(action.label)}</button>`).join('')}
        <button type="button" class="button" data-reload>Reload current document</button>
      </div>
    </section>`;
}

async function loadRoute() {
  state.loading = true;
  state.problem = null;
  render();

  let request;
  const route = routeMeta[state.route];
  if (state.selectedRecordId) {
    request = { kind: 'record', campaignId, recordId: state.selectedRecordId };
  } else if (route.collection) {
    request = { kind: 'collection', campaignId, collection: route.collection };
  } else {
    request = { kind: state.route === 'home' ? 'home' : state.route, campaignId };
  }

  const result = await workspace.load(request);
  state.loading = false;
  if (!result.ok) {
    state.problem = result.problem;
    state.document = null;
  } else {
    state.document = result.value;
  }
  render();
}

function navigate(route, recordId = null) {
  state.route = route;
  state.selectedRecordId = recordId;
  location.hash = route;
  loadRoute();
}

function shellChooser() {
  return `
    <div class="prototype-switcher" aria-label="Workspace shell comparison">
      <div>
        <p class="eyebrow">Throwaway shell comparison</p>
        <strong>${escapeHtml(shellMeta[state.shell].name)}</strong>
        <span>${escapeHtml(shellMeta[state.shell].summary)}</span>
      </div>
      <div class="segmented" role="group" aria-label="Choose prototype shell">
        ${Object.entries(shellMeta).map(([key, shell]) => `
          <button type="button" data-shell="${key}" aria-pressed="${state.shell === key}">${escapeHtml(shell.name)}</button>
        `).join('')}
      </div>
    </div>`;
}

function primaryNavigation({ compact = false } = {}) {
  const keys = ['home', 'actors', 'inventory', 'abilities', 'objectives', 'world', 'review', 'context', 'import', 'maintenance'];
  return keys.map((key) => {
    const meta = routeMeta[key];
    const active = state.route === key;
    return `<button type="button" class="nav-item" data-route="${key}" aria-current="${active ? 'page' : 'false'}">
      <span class="nav-glyph" aria-hidden="true">${navGlyph(key)}</span>
      <span>${escapeHtml(compact ? meta.short : meta.label)}</span>
      ${key === 'review' ? '<span class="count" aria-label="2 pending proposals">2</span>' : ''}
    </button>`;
  }).join('');
}

function navGlyph(key) {
  return {
    home: '◆',
    actors: '♙',
    inventory: '◇',
    abilities: '✦',
    objectives: '◎',
    world: '⌖',
    review: '✓',
    context: '◉',
    import: '⇄',
    maintenance: '⚙',
  }[key] || '•';
}

function revisionStrip() {
  const snapshot = engine.snapshot();
  return `
    <div class="revision-strip" aria-label="Current authority revisions">
      <span><b>Campaign</b> r${snapshot.campaign.revision}</span>
      <span><b>Binding</b> r${snapshot.binding.revision}</span>
      <span><b>Anchor</b> r${snapshot.binding.anchorRevision}</span>
      <span class="status-dot">Connected</span>
    </div>`;
}

function loadingBody() {
  return `<section class="loading-state" aria-busy="true"><span class="spinner" aria-hidden="true"></span><p>Loading ${escapeHtml(routeMeta[state.route].label)}…</p></section>`;
}

function routeBody() {
  if (state.loading) return loadingBody();
  if (state.problem) return formatProblem(state.problem);
  if (!state.document) return '<section class="empty-state"><h2>No document loaded</h2></section>';
  if (state.selectedRecordId) return recordEditor(state.document);

  if (state.route === 'home') return campaignHome(state.document);
  if (routeMeta[state.route].collection) return collectionDocument(state.document);
  if (state.route === 'review') return reviewInbox(state.document);
  if (state.route === 'context') return contextTray(state.document);
  if (state.route === 'import') return importDiff(state.document);
  if (state.route === 'maintenance') return maintenance(state.document);
  return '<section class="empty-state"><h2>Unknown route</h2></section>';
}

function campaignHome(doc) {
  return `
    <section class="page-heading">
      <div>
        <p class="eyebrow">Active Campaign</p>
        <h1>${escapeHtml(doc.campaign.title)}</h1>
        <p>${escapeHtml(doc.binding.label)} · anchored at Campaign revision ${doc.binding.anchorRevision}</p>
      </div>
      <button type="button" class="button" data-route="context">Inspect narrator context</button>
    </section>

    <section class="scene-hero" aria-labelledby="scene-title">
      <div>
        <p class="eyebrow">Current Scene · ${escapeHtml(doc.scene.place)}</p>
        <h2 id="scene-title">${escapeHtml(doc.scene.title)}</h2>
        <p>${escapeHtml(doc.scene.summary)}</p>
      </div>
      <div class="scene-clock"><span>Bell</span><strong>2 / 3</strong></div>
    </section>

    <div class="dashboard-grid">
      <article class="card urgent">
        <p class="eyebrow">Open pressure</p>
        <h3>${escapeHtml(doc.scene.obstacles[1])}</h3>
        <p>${escapeHtml(doc.scene.obstacles[0])}</p>
        <button type="button" class="text-action" data-route="world">Open scene details</button>
      </article>
      <article class="card">
        <p class="eyebrow">Review Inbox</p>
        <h3>${doc.proposals.length} proposals waiting</h3>
        <p>Story Sync has prepared human-reviewable changes from the latest chat range.</p>
        <button type="button" class="text-action" data-route="review">Review proposals</button>
      </article>
      <article class="card">
        <p class="eyebrow">Context budget</p>
        <h3>${doc.context.usedTokens.toLocaleString()} / ${doc.context.budgetTokens.toLocaleString()} tokens</h3>
        <div class="meter"><span style="width:${Math.round(doc.context.usedTokens / doc.context.budgetTokens * 100)}%"></span></div>
        <button type="button" class="text-action" data-route="context">Explain selections</button>
      </article>
      <article class="card">
        <p class="eyebrow">Next safe action</p>
        <h3>Find the missing reliquary key</h3>
        <p>The active objective is blocked. People, Inventory, and World records contain the strongest clues.</p>
        <button type="button" class="text-action" data-route="objectives">Open objective</button>
      </article>
    </div>`;
}

function recordList(rows, selectedId = null) {
  return `<div class="record-list" role="list">
    ${rows.map((row) => `<button type="button" role="listitem" class="record-row" data-record="${escapeHtml(row.id)}" data-record-route="${state.route}" aria-current="${selectedId === row.id ? 'true' : 'false'}">
      <span class="record-kind">${escapeHtml(row.kind)}</span>
      <strong>${escapeHtml(row.name)}</strong>
      <span>${escapeHtml(row.subtitle)}</span>
      <small>${escapeHtml(row.status)}</small>
    </button>`).join('')}
  </div>`;
}

function collectionDocument(doc) {
  return `
    <section class="page-heading">
      <div>
        <p class="eyebrow">Collection · ${doc.rows.length} entries</p>
        <h1>${escapeHtml(doc.label)}</h1>
        <p>Task-oriented records and live state joined at Campaign revision ${doc.revision}.</p>
      </div>
      <button type="button" class="button">Create ${escapeHtml(doc.label === 'People' ? 'Actor' : 'Record')}</button>
    </section>
    <div class="collection-tools">
      <label class="search-field"><span>Filter ${escapeHtml(doc.label)}</span><input type="search" placeholder="Name, status, tag…" data-prototype-filter></label>
      <button type="button" class="button secondary">Archived</button>
    </div>
    ${recordList(doc.rows)}`;
}

function recordEditor(doc) {
  const record = doc.record;
  return `
    <section class="page-heading editor-heading">
      <div>
        <button type="button" class="crumb" data-route="${state.route}">← ${escapeHtml(routeMeta[state.route].label)}</button>
        <p class="eyebrow">${escapeHtml(record.kind)} · editing Campaign revision ${doc.revision}</p>
        <h1>${escapeHtml(record.name)}</h1>
      </div>
      <span class="draft-badge">Draft kept locally until Save</span>
    </section>
    <form class="editor-form" data-record-form data-record-id="${escapeHtml(record.id)}" data-expected-revision="${doc.revision}">
      <div class="field-grid">
        <label><span>Name</span><input name="name" value="${escapeHtml(record.name)}" required></label>
        <label><span>Status</span><input name="status" value="${escapeHtml(record.status)}"></label>
      </div>
      <label><span>Role / category</span><input name="subtitle" value="${escapeHtml(record.subtitle)}"></label>
      <label><span>Reviewed summary</span><textarea name="summary" rows="6">${escapeHtml(record.summary)}</textarea><small>Human-reviewed canonical text. Model drafts remain proposals until accepted.</small></label>
      <section class="editor-section">
        <div><p class="eyebrow">References</p><h2>Related Campaign material</h2></div>
        <div class="reference-chip-row"><button type="button" class="chip">Current Scene</button><button type="button" class="chip">Seraphine Vale</button><button type="button" class="chip add">+ Add reference</button></div>
      </section>
      <section class="danger-zone">
        <div><p class="eyebrow">Lifecycle</p><h2>Archive before permanent deletion</h2><p>Delete is offered only after reference-impact checks and never erases historical revisions.</p></div>
        <button type="button" class="button secondary">Archive</button>
      </section>
      <div class="sticky-actions">
        <button type="button" class="button ghost" data-route="${state.route}">Cancel</button>
        <button type="button" class="button secondary" data-simulate-stale>Simulate stale tab</button>
        <button type="submit" class="button">Save changes</button>
      </div>
    </form>`;
}

function reviewInbox(doc) {
  if (!doc.proposals.length) {
    return `<section class="empty-state"><p class="eyebrow">Review Inbox</p><h1>All caught up</h1><p>No unresolved Story Sync proposals remain.</p></section>`;
  }
  return `
    <section class="page-heading">
      <div><p class="eyebrow">Human review boundary</p><h1>Review Inbox</h1><p>${doc.proposals.length} model-assisted proposals. Nothing applies automatically.</p></div>
      <button type="button" class="button secondary">Start Story Sync</button>
    </section>
    <div class="proposal-stack">
      ${doc.proposals.map((proposal) => `<article class="proposal-card">
        <div class="proposal-meta"><span>${escapeHtml(proposal.kind)}</span><span>${escapeHtml(proposal.confidence)} confidence</span><span>${escapeHtml(proposal.source)}</span></div>
        <h2>${escapeHtml(proposal.title)}</h2>
        <p>${escapeHtml(proposal.detail)}</p>
        <label><span>Editable proposal</span><textarea rows="4">${escapeHtml(proposal.detail)}</textarea></label>
        <div class="proposal-actions">
          <button type="button" class="button ghost" data-proposal-action="reject" data-proposal-id="${proposal.id}" data-expected-revision="${doc.revision}">Reject</button>
          <button type="button" class="button secondary">Edit affected records</button>
          <button type="button" class="button" data-proposal-action="accept" data-proposal-id="${proposal.id}" data-expected-revision="${doc.revision}">Accept proposal</button>
        </div>
      </article>`).join('')}
    </div>`;
}

function contextTray(doc) {
  const percent = Math.round(doc.usedTokens / doc.budgetTokens * 100);
  const manualPinCount = doc.selections.filter((selection) => selection.tier === 'Manual pin').length;
  return `
    <section class="page-heading">
      <div><p class="eyebrow">Read-only Context Plan</p><h1>Context Tray</h1><p>${escapeHtml(doc.model)} · Binding revision ${doc.bindingRevision}</p></div>
      <div class="budget-orb" aria-label="${percent}% of context budget used"><strong>${percent}%</strong><span>budget</span></div>
    </section>
    <section class="context-summary">
      <div><span>Used</span><strong>${doc.usedTokens.toLocaleString()}</strong></div>
      <div><span>Available</span><strong>${(doc.budgetTokens - doc.usedTokens).toLocaleString()}</strong></div>
      <div><span>Manual pins</span><strong>${manualPinCount}</strong></div>
      <div><span>Ambiguities</span><strong>0</strong></div>
    </section>
    <div class="context-columns">
      <section><div class="section-heading"><p class="eyebrow">Selected in strict tier order</p><h2>Included material</h2></div>
        ${doc.selections.map((item) => `<article class="context-row"><span class="tier">${escapeHtml(item.tier)}</span><div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.reason)}</small></div><b>${item.tokens}</b></article>`).join('')}
      </section>
      <section><div class="section-heading"><p class="eyebrow">Explainable exclusions</p><h2>Omissions</h2></div>
        ${doc.omissions.map((item) => `<article class="omission-row"><div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.reason)}</small></div></article>`).join('')}
      </section>
    </div>
    <section class="callout"><div><p class="eyebrow">Pin policy</p><h2>Manual pins remain complete and ordered</h2><p>If required core plus pins exceed the model budget, generation blocks for an explicit choice rather than truncating them.</p></div><button type="button" class="button secondary" data-toggle-pin>Toggle Seraphine pin</button></section>`;
}

function importDiff(doc) {
  return `
    <section class="page-heading">
      <div><p class="eyebrow">Review before one accepted batch</p><h1>Import Diff</h1><p>${escapeHtml(doc.source)} · compared with Campaign revision ${doc.revision}</p></div>
      <span class="warning-badge">${doc.warnings} warning</span>
    </section>
    <section class="diff-summary"><div><strong>${doc.creates}</strong><span>Creates</span></div><div><strong>${doc.updates}</strong><span>Updates</span></div><div><strong>${doc.unchanged}</strong><span>Unchanged</span></div><div><strong>${doc.warnings}</strong><span>Warnings</span></div></section>
    <div class="diff-table" role="table" aria-label="Import changes">
      ${doc.changes.map((change) => `<div class="diff-row" role="row"><span class="diff-action ${change.action.toLowerCase()}">${escapeHtml(change.action)}</span><strong>${escapeHtml(change.subject)}</strong><span>${escapeHtml(change.field)}</span><del>${escapeHtml(change.before)}</del><ins>${escapeHtml(change.after)}</ins></div>`).join('') || '<p class="empty-inline">No pending changes.</p>'}
    </div>
    <div class="sticky-actions"><button type="button" class="button ghost">Discard preview</button><button type="button" class="button" data-apply-import data-expected-revision="${doc.revision}" ${doc.changes.length ? '' : 'disabled'}>Create backup and apply batch</button></div>`;
}

function maintenance(doc) {
  return `
    <section class="page-heading"><div><p class="eyebrow">Local authority maintenance</p><h1>Backups & Settings</h1><p>Store operations remain owned by the companion process.</p></div><button type="button" class="button" data-create-backup>Create validated backup</button></section>
    <div class="settings-grid">
      <section class="settings-card"><p class="eyebrow">Service</p><h2>Companion</h2><dl><div><dt>Workspace</dt><dd>:8002</dd></div><div><dt>SillyTavern</dt><dd>:8001</dd></div><div><dt>LM Studio</dt><dd>127.0.0.1:1234</dd></div></dl></section>
      <section class="settings-card"><p class="eyebrow">Binding</p><h2>${escapeHtml(doc.binding.label)}</h2><dl><div><dt>Status</dt><dd>${escapeHtml(doc.binding.status)}</dd></div><div><dt>Anchor</dt><dd>r${doc.binding.anchorRevision}</dd></div><div><dt>Revision</dt><dd>r${doc.binding.revision}</dd></div></dl></section>
    </div>
    <section class="backup-list"><div class="section-heading"><p class="eyebrow">Validated restore points</p><h2>Backups</h2></div>${doc.backups.map((backup) => `<article><div><strong>${escapeHtml(backup.createdAt)}</strong><span>${escapeHtml(backup.kind)} · ${escapeHtml(backup.size)}</span></div><span class="validated">${escapeHtml(backup.status)}</span><button type="button" class="button ghost">Inspect</button></article>`).join('')}</section>
    <section class="danger-zone"><div><p class="eyebrow">Destructive maintenance</p><h2>Purge Campaign</h2><p>Requires a validated backup, exact title confirmation, and acknowledgement that external copies cannot be erased.</p></div><button type="button" class="button danger">Review purge requirements</button></section>`;
}

function ledgerShell() {
  const snapshot = engine.snapshot();
  const collection = routeMeta[state.route].collection ? snapshot.collections[routeMeta[state.route].collection] : null;
  return `
    <div class="workspace-shell shell-ledger">
      <header class="ledger-header">${shellChooser()}${revisionStrip()}</header>
      <div class="ledger-body">
        <aside class="ledger-nav"><div class="brand-mark"><span>ER</span><div><strong>Emberfall</strong><small>Campaign authority</small></div></div><nav aria-label="Workspace sections">${primaryNavigation()}</nav></aside>
        <aside class="ledger-index" aria-label="Current collection index">
          ${collection ? `<div class="index-heading"><p class="eyebrow">${escapeHtml(routeMeta[state.route].label)}</p><strong>${collection.length} records</strong></div>${recordList(collection, state.selectedRecordId)}` : `<div class="index-heading"><p class="eyebrow">Pinned work</p><strong>Current Campaign</strong></div><button class="index-task" data-route="review"><span>2</span><strong>Review proposals</strong><small>Human decision required</small></button><button class="index-task" data-route="context"><span>59%</span><strong>Context budget</strong><small>Two manual pins</small></button><button class="index-task" data-route="import"><span>1</span><strong>Import warning</strong><small>Duplicate external ID</small></button>`}
        </aside>
        <main id="workspace-main" class="ledger-canvas" tabindex="-1">${routeBody()}</main>
      </div>
      <footer class="prototype-footer">${escapeHtml(state.notice)}</footer>
    </div>`;
}

function deckShell() {
  return `
    <div class="workspace-shell shell-deck">
      <header class="deck-header"><div class="deck-title"><span class="deck-sigil">E</span><div><strong>Emberfall Command Deck</strong><small>Campaign control · local authority</small></div></div>${revisionStrip()}</header>
      ${shellChooser()}
      <nav class="deck-nav" aria-label="Workspace task lanes">${primaryNavigation({ compact: true })}</nav>
      <main id="workspace-main" class="deck-main" tabindex="-1">
        <section class="deck-status" aria-label="Campaign status"><div><span>Scene pressure</span><strong>Third bell imminent</strong></div><div><span>Human queue</span><strong>2 proposals</strong></div><div><span>Context</span><strong>4,820 tokens</strong></div><div><span>Authority</span><strong>Campaign r${engine.snapshot().campaign.revision}</strong></div></section>
        <div class="deck-work-surface">${routeBody()}</div>
      </main>
      <footer class="deck-command-bar"><button type="button" data-route="home">Campaign pulse</button><button type="button" data-route="review">Review next</button><button type="button" data-route="context">Inspect context</button><span>${escapeHtml(state.notice)}</span></footer>
    </div>`;
}

function bookShell() {
  return `
    <div class="workspace-shell shell-book">
      <header class="book-masthead"><div class="book-brand"><span class="book-seal">E</span><div><p class="eyebrow">Campaign Workspace</p><strong>Emberfall: The Glass March</strong></div></div>${revisionStrip()}</header>
      ${shellChooser()}
      <nav class="book-tabs" aria-label="Campaign book chapters">${primaryNavigation({ compact: true })}</nav>
      <main id="workspace-main" class="book-page" tabindex="-1"><div class="book-page-inner">${routeBody()}</div></main>
      <footer class="book-footer"><span>Local companion prototype</span><span>${escapeHtml(state.notice)}</span></footer>
    </div>`;
}

function render() {
  app.innerHTML = state.shell === 'ledger' ? ledgerShell() : state.shell === 'deck' ? deckShell() : bookShell();
}

async function submitRecord(form) {
  const formData = new FormData(form);
  const expectedRevision = state.simulatedRevision ?? Number(form.dataset.expectedRevision);
  const result = await workspace.act({
    kind: 'save-record',
    requestId: crypto.randomUUID(),
    campaignId,
    expectedRevision,
    recordId: form.dataset.recordId,
    patch: {
      name: formData.get('name'),
      status: formData.get('status'),
      subtitle: formData.get('subtitle'),
      summary: formData.get('summary'),
    },
  });
  state.simulatedRevision = null;
  if (!result.ok) {
    state.problem = result.problem;
    render();
    return;
  }
  setNotice(`Saved as Campaign revision ${result.value.campaignRevision}.`);
  await loadRoute();
}

async function proposalAction(button) {
  const result = await workspace.act({
    kind: button.dataset.proposalAction === 'accept' ? 'accept-proposal' : 'reject-proposal',
    requestId: crypto.randomUUID(),
    campaignId,
    expectedRevision: Number(button.dataset.expectedRevision),
    proposalId: button.dataset.proposalId,
  });
  if (!result.ok) state.problem = result.problem;
  else setNotice(`${button.dataset.proposalAction === 'accept' ? 'Accepted' : 'Rejected'} proposal at Campaign revision ${result.value.campaignRevision}.`);
  await loadRoute();
}

async function togglePin() {
  const snapshot = engine.snapshot();
  const pin = 'actor-seraphine';
  const pins = snapshot.binding.pins.includes(pin) ? snapshot.binding.pins.filter((id) => id !== pin) : [...snapshot.binding.pins, pin];
  const result = await workspace.act({ kind: 'replace-pins', requestId: crypto.randomUUID(), bindingId: snapshot.binding.id, expectedBindingRevision: snapshot.binding.revision, pins });
  if (!result.ok) state.problem = result.problem;
  else setNotice(`Manual pins updated at Binding revision ${result.value.bindingRevision}.`);
  await loadRoute();
}

app.addEventListener('click', async (event) => {
  const shellButton = event.target.closest('[data-shell]');
  if (shellButton) {
    state.shell = shellButton.dataset.shell;
    localStorage.setItem('workspace-prototype-shell', state.shell);
    const url = new URL(location.href);
    url.searchParams.set('shell', state.shell);
    history.replaceState(null, '', url);
    setNotice(`Switched to ${shellMeta[state.shell].name}. Route and prototype state preserved.`);
    render();
    return;
  }

  const routeButton = event.target.closest('[data-route]');
  if (routeButton) {
    navigate(routeButton.dataset.route);
    return;
  }

  const recordButton = event.target.closest('[data-record]');
  if (recordButton) {
    state.route = recordButton.dataset.recordRoute || state.route;
    state.selectedRecordId = recordButton.dataset.record;
    await loadRoute();
    document.querySelector('#workspace-main')?.focus();
    return;
  }

  const proposalButton = event.target.closest('[data-proposal-action]');
  if (proposalButton) {
    await proposalAction(proposalButton);
    return;
  }

  if (event.target.closest('[data-toggle-pin]')) {
    await togglePin();
    return;
  }

  const importButton = event.target.closest('[data-apply-import]');
  if (importButton) {
    const result = await workspace.act({ kind: 'apply-import', requestId: crypto.randomUUID(), campaignId, expectedRevision: Number(importButton.dataset.expectedRevision) });
    if (!result.ok) state.problem = result.problem;
    else setNotice(`Import applied atomically as Campaign revision ${result.value.campaignRevision}.`);
    await loadRoute();
    return;
  }

  if (event.target.closest('[data-create-backup]')) {
    const result = await workspace.act({ kind: 'create-backup', requestId: crypto.randomUUID() });
    if (!result.ok) state.problem = result.problem;
    else setNotice(`Validated backup created at ${result.value.createdAt}.`);
    await loadRoute();
    return;
  }

  if (event.target.closest('[data-simulate-stale]')) {
    state.simulatedRevision = Math.max(1, Number(document.querySelector('[data-record-form]')?.dataset.expectedRevision || 1) - 1);
    setNotice('The next Save will submit a stale expected revision to demonstrate conflict recovery.');
    render();
    return;
  }

  if (event.target.closest('[data-dismiss-problem]')) {
    state.problem = null;
    setNotice('Draft retained. Reload or return to the collection when ready.');
    render();
    return;
  }

  if (event.target.closest('[data-reload]')) {
    await loadRoute();
  }
});

app.addEventListener('submit', async (event) => {
  const form = event.target.closest('[data-record-form]');
  if (!form) return;
  event.preventDefault();
  await submitRecord(form);
});

addEventListener('hashchange', () => {
  const route = location.hash.slice(1);
  if (routeMeta[route] && route !== state.route) {
    state.route = route;
    state.selectedRecordId = null;
    loadRoute();
  }
});

addEventListener('keydown', (event) => {
  if (event.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
    event.preventDefault();
    document.querySelector('[data-prototype-filter]')?.focus();
  }
});

await loadRoute();
