import {
  clone,
  createRepresentativeCampaign,
  createRevision,
  measureEnvelope,
  recoverFork,
  stableStringify,
  validateEnvelope,
} from './campaign-core.js';

const ROOT_ID = 'rpg-campaign-durability-spike';
const META_KEY = 'stLlmRpgV2DurabilityPrototype';
const JOURNAL_PREFIX = 'st-llm-rpg:v2-durability:pending:';
const PROMPT_KEY = 'st-llm-rpg:v2-durability:capsule';
const IN_CHAT_PROMPT = 1;
const NO_PROMPT = -1;
const SYSTEM_ROLE = 0;

const state = {
  open: false,
  chatId: '',
  chatTitle: '',
  stage: 'loading',
  message: 'Reading Campaign state…',
  mobilePane: 'campaign',
  knownGood: null,
  inherited: null,
  journal: null,
  draft: null,
  metrics: null,
  timings: { saveMs: null, verifyMs: null },
  history: { state: 'unchecked', message: 'No history check run.' },
  branchTargetRevision: null,
  log: [],
  returnFocus: null,
  activation: 0,
};

function context() {
  return globalThis.SillyTavern?.getContext?.() ?? null;
}

function identity() {
  const current = context();
  let currentChatId = '';
  try {
    currentChatId = current?.getCurrentChatId?.() ?? '';
  } catch {
    currentChatId = '';
  }
  currentChatId = String(currentChatId || current?.chatId || '');
  return { id: currentChatId, title: currentChatId || 'No character chat selected' };
}

function uuid() {
  return globalThis.crypto?.randomUUID?.() ?? `prototype-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function journalKey(chatId = state.chatId) {
  return `${JOURNAL_PREFIX}${chatId}`;
}

function loadJournal(chatId = state.chatId) {
  if (!chatId) return null;
  try {
    const value = JSON.parse(localStorage.getItem(journalKey(chatId)));
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

function saveJournal(value) {
  state.journal = value;
  try {
    localStorage.setItem(journalKey(), JSON.stringify(value));
  } catch (error) {
    throw new Error(`The recoverable browser journal could not be written: ${error.message}`);
  }
}

function clearJournal() {
  try {
    localStorage.removeItem(journalKey());
  } catch {
    // This is a throwaway lab; the visible state still explains what happened.
  }
  state.journal = null;
}

function addLog(message) {
  state.log.unshift({ at: new Date().toLocaleTimeString(), message });
  state.log = state.log.slice(0, 10);
}

function setStage(stage, message) {
  state.stage = stage;
  state.message = message;
  addLog(`${stage}: ${message}`);
  render();
}

function editableDraft(envelope) {
  const firstItem = envelope?.campaign?.records?.find(record => record.kind === 'item');
  return envelope ? {
    title: envelope.campaign.title,
    itemId: firstItem?.id ?? '',
    itemName: firstItem?.name ?? 'No item',
    itemQuantity: Number(firstItem?.data?.quantity ?? 0),
    itemSummary: firstItem?.summary ?? '',
  } : null;
}

function setKnownGood(envelope) {
  state.knownGood = envelope ? clone(envelope) : null;
  state.metrics = envelope ? measureEnvelope(envelope) : null;
  state.draft = editableDraft(envelope);
  registerKnownGoodCapsule();
}

function registerKnownGoodCapsule() {
  const current = context();
  if (!current?.setExtensionPrompt) return;
  if (!state.knownGood) {
    current.setExtensionPrompt(PROMPT_KEY, '', NO_PROMPT, 0, false, SYSTEM_ROLE);
    return;
  }
  current.setExtensionPrompt(PROMPT_KEY, state.knownGood.capsule.text, IN_CHAT_PROMPT, 1, false, SYSTEM_ROLE);
}

function bytes(value) {
  if (!Number.isFinite(value)) return '—';
  if (value < 1024) return `${value} B`;
  return `${(value / 1024).toFixed(1)} KiB`;
}

function escapeText(value) {
  return String(value ?? '');
}

function workspaceMarkup() {
  return `
    <section id="${ROOT_ID}" class="rpgdur" role="dialog" aria-modal="true" aria-label="Campaign durability spike" aria-hidden="true">
      <header class="rpgdur__topbar">
        <div class="rpgdur__brand"><span>DURABILITY SPIKE</span><strong>Campaign storage lab</strong><small id="rpgdur-chat-title"></small></div>
        <div id="rpgdur-status" class="rpgdur__status" data-stage="loading"><strong>Loading</strong><span>Reading Campaign state…</span></div>
        <button type="button" class="rpgdur__button" data-rpgdur-action="close">Return to chat</button>
      </header>

      <nav class="rpgdur__mobile-nav" aria-label="Lab sections">
        <button type="button" data-rpgdur-pane="controls">Actions</button>
        <button type="button" data-rpgdur-pane="campaign">Campaign</button>
        <button type="button" data-rpgdur-pane="evidence">Evidence</button>
      </nav>

      <div class="rpgdur__body">
        <aside class="rpgdur__pane rpgdur__controls" data-rpgdur-panel="controls">
          <div class="rpgdur__heading"><div><span>WRITE PATH</span><h2>Actions</h2></div></div>
          <button type="button" class="rpgdur__primary" data-rpgdur-action="initialize">Create representative Campaign</button>
          <button type="button" data-rpgdur-action="commit">Commit edits</button>
          <button type="button" data-rpgdur-action="fail-commit">Simulate failed commit</button>
          <button type="button" data-rpgdur-action="verify">Verify server copy</button>
          <hr>
          <button type="button" data-rpgdur-action="restore-candidate">Restore candidate as draft</button>
          <button type="button" data-rpgdur-action="discard-candidate">Discard recoverable candidate</button>
          <hr>
          <button type="button" data-rpgdur-action="mark-boundary">Mark current sync boundary</button>
          <button type="button" data-rpgdur-action="scan-history">Check message history</button>
          <button type="button" data-rpgdur-action="recover-branch">Recover inherited branch</button>
          <p class="rpgdur__hint">A normal commit is not marked verified until the extension reads the saved chat header back from SillyTavern.</p>
        </aside>

        <main class="rpgdur__pane rpgdur__campaign" data-rpgdur-panel="campaign">
          <div class="rpgdur__heading">
            <div><span>EDITABLE CANDIDATE</span><h2 id="rpgdur-campaign-title">No Campaign</h2></div>
            <span id="rpgdur-revision" class="rpgdur__revision">Unbound</span>
          </div>
          <form id="rpgdur-form" class="rpgdur__form">
            <label>Campaign title<input name="title" autocomplete="off"></label>
            <fieldset>
              <legend id="rpgdur-item-name">First inventory item</legend>
              <label>Quantity<input name="itemQuantity" type="number" min="0" step="1" inputmode="numeric"></label>
              <label>Summary<textarea name="itemSummary" rows="5"></textarea></label>
            </fieldset>
          </form>
          <div class="rpgdur__capsule">
            <div class="rpgdur__heading"><div><span>LAST KNOWN GOOD</span><h3>Context Capsule preview</h3></div></div>
            <pre id="rpgdur-capsule"></pre>
          </div>
        </main>

        <aside class="rpgdur__pane rpgdur__evidence" data-rpgdur-panel="evidence">
          <div class="rpgdur__heading"><div><span>VISIBLE STATE</span><h2>Evidence</h2></div></div>
          <dl class="rpgdur__metrics">
            <div><dt>Records</dt><dd id="rpgdur-records">—</dd></div>
            <div><dt>Campaign envelope</dt><dd id="rpgdur-envelope-size">—</dd></div>
            <div><dt>Context Capsule</dt><dd id="rpgdur-capsule-size">—</dd></div>
            <div><dt>Save call</dt><dd id="rpgdur-save-time">—</dd></div>
            <div><dt>Server readback</dt><dd id="rpgdur-verify-time">—</dd></div>
          </dl>
          <section class="rpgdur__evidence-card"><strong>History integrity</strong><p id="rpgdur-history"></p></section>
          <section class="rpgdur__evidence-card"><strong>Branch recovery</strong><p id="rpgdur-branch"></p></section>
          <section class="rpgdur__evidence-card"><strong>Recoverable browser journal</strong><pre id="rpgdur-journal"></pre></section>
          <section class="rpgdur__evidence-card"><strong>Recent transitions</strong><ol id="rpgdur-log"></ol></section>
        </aside>
      </div>
    </section>
    <button id="rpgdur-launcher" type="button" aria-controls="${ROOT_ID}" aria-expanded="false" title="Open Campaign durability spike"><span>D</span><span>Durability</span></button>
  `;
}

function render() {
  const root = document.querySelector(`#${ROOT_ID}`);
  if (!root) return;

  root.dataset.mobilePane = state.mobilePane;
  root.querySelector('#rpgdur-chat-title').textContent = state.chatTitle;

  const status = root.querySelector('#rpgdur-status');
  status.dataset.stage = state.stage;
  status.querySelector('strong').textContent = state.stage.replaceAll('-', ' ');
  status.querySelector('span').textContent = state.message;

  for (const button of root.querySelectorAll('[data-rpgdur-pane]')) {
    button.classList.toggle('is-active', button.dataset.rpgdurPane === state.mobilePane);
  }

  const campaign = state.knownGood?.campaign;
  root.querySelector('#rpgdur-campaign-title').textContent = state.draft?.title || campaign?.title || 'No Campaign';
  root.querySelector('#rpgdur-revision').textContent = campaign ? `Revision ${campaign.revision}` : 'Unbound';
  root.querySelector('#rpgdur-item-name').textContent = state.draft?.itemName || 'First inventory item';

  const form = root.querySelector('#rpgdur-form');
  form.elements.title.value = state.draft?.title ?? '';
  form.elements.itemQuantity.value = state.draft?.itemQuantity ?? 0;
  form.elements.itemSummary.value = state.draft?.itemSummary ?? '';
  for (const field of form.elements) field.disabled = !state.draft;

  const capsule = state.knownGood?.capsule?.text ?? 'No verified Context Capsule is active.';
  root.querySelector('#rpgdur-capsule').textContent = capsule.length > 2400 ? `${capsule.slice(0, 2400)}\n…` : capsule;
  root.querySelector('#rpgdur-records').textContent = state.metrics?.records ?? '—';
  root.querySelector('#rpgdur-envelope-size').textContent = bytes(state.metrics?.envelopeBytes);
  root.querySelector('#rpgdur-capsule-size').textContent = bytes(state.metrics?.capsuleBytes);
  root.querySelector('#rpgdur-save-time').textContent = state.timings.saveMs === null ? '—' : `${state.timings.saveMs} ms`;
  root.querySelector('#rpgdur-verify-time').textContent = state.timings.verifyMs === null ? '—' : `${state.timings.verifyMs} ms`;
  root.querySelector('#rpgdur-history').textContent = state.history.message;
  root.querySelector('#rpgdur-branch').textContent = state.inherited
    ? (state.branchTargetRevision ? `Inherited future state detected. Revision ${state.branchTargetRevision} matches this message prefix and can seed a new Campaign instance.` : 'Inherited future state detected, but no recorded revision matches this message prefix.')
    : 'Campaign binding matches this chat.';
  root.querySelector('#rpgdur-journal').textContent = state.journal
    ? JSON.stringify({ baseCommitId: state.journal.baseCommitId, candidateRevision: state.journal.candidate?.campaign?.revision, candidateCommitId: state.journal.candidate?.campaign?.commitId, createdAt: state.journal.createdAt }, null, 2)
    : 'Empty';

  const log = root.querySelector('#rpgdur-log');
  log.replaceChildren();
  for (const entry of state.log) {
    const item = document.createElement('li');
    item.textContent = `${entry.at} — ${entry.message}`;
    log.appendChild(item);
  }

  const actions = Object.fromEntries([...root.querySelectorAll('[data-rpgdur-action]')].map(button => [button.dataset.rpgdurAction, button]));
  actions.initialize.disabled = Boolean(state.knownGood || state.inherited || !state.chatId);
  actions.commit.disabled = !state.knownGood || Boolean(state.inherited);
  actions['fail-commit'].disabled = !state.knownGood || Boolean(state.inherited);
  actions.verify.disabled = !state.chatId;
  actions['restore-candidate'].disabled = !state.journal;
  actions['discard-candidate'].disabled = !state.journal;
  actions['mark-boundary'].disabled = !state.knownGood || Boolean(state.inherited);
  actions['scan-history'].disabled = !state.knownGood?.campaign?.syncBoundary;
  actions['recover-branch'].disabled = !state.inherited || !state.branchTargetRevision;
}

async function sha256(value) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function messageShape(message) {
  return {
    isUser: Boolean(message?.is_user),
    name: String(message?.name ?? ''),
    text: String(message?.mes ?? ''),
    swipeId: Number.isInteger(message?.swipe_id) ? message.swipe_id : null,
  };
}

async function messageDigests() {
  const messages = Array.isArray(context()?.chat) ? context().chat : [];
  return await Promise.all(messages.map(message => sha256(stableStringify(messageShape(message)))));
}

async function anchorFor(digests = null, count = null) {
  const allDigests = digests ?? await messageDigests();
  const messageCount = count ?? allDigests.length;
  return { messageCount, prefixDigest: await sha256(allDigests.slice(0, messageCount).join('\n')) };
}

async function readServerEnvelope() {
  const current = context();
  if (!current || current.groupId) throw new Error('This spike currently supports character chats only.');
  const character = current.characters?.[current.characterId];
  if (!character || !state.chatId) throw new Error('No saved character chat is selected.');

  const response = await fetch('/api/chats/get', {
    method: 'POST',
    cache: 'no-cache',
    headers: current.getRequestHeaders(),
    body: JSON.stringify({
      ch_name: character.name,
      file_name: state.chatId,
      avatar_url: character.avatar,
    }),
  });
  if (!response.ok) throw new Error(`Server readback failed with HTTP ${response.status}.`);
  const data = await response.json();
  return clone(data?.[0]?.chat_metadata?.[META_KEY] ?? null);
}

function sameCommit(left, right) {
  return Boolean(left?.campaign?.commitId && left.campaign.commitId === right?.campaign?.commitId);
}

function replaceInMemoryMetadata(envelope) {
  const metadata = context()?.chatMetadata;
  if (!metadata) return;
  if (envelope) metadata[META_KEY] = clone(envelope);
  else delete metadata[META_KEY];
}

async function persistCandidate(candidate, baseEnvelope, simulateFailure = false) {
  if (identity().id !== state.chatId) {
    setStage('stale', 'The active chat changed before the write began. Nothing was saved.');
    return;
  }

  const check = validateEnvelope(candidate);
  if (!check.ok) {
    setStage('corrupt', check.errors.join(' '));
    return;
  }

  try {
    saveJournal({
      chatId: state.chatId,
      baseCommitId: baseEnvelope?.campaign?.commitId ?? null,
      candidate: clone(candidate),
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    setStage('failed', error.message);
    return;
  }

  const previousKnownGood = clone(state.knownGood);
  replaceInMemoryMetadata(candidate);
  setStage('pending', 'Candidate is journaled locally; SillyTavern save has started. The previous capsule remains active.');

  let restoreFetch = null;
  if (simulateFailure) {
    const originalFetch = globalThis.fetch;
    let armed = true;
    globalThis.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input?.url;
      if (armed && String(url).includes('/api/chats/save')) {
        armed = false;
        throw new TypeError('Simulated Campaign save failure');
      }
      return originalFetch(input, init);
    };
    restoreFetch = () => { globalThis.fetch = originalFetch; };
  }

  const saveStarted = performance.now();
  try {
    await context().saveMetadata();
  } finally {
    state.timings.saveMs = Math.round(performance.now() - saveStarted);
    restoreFetch?.();
  }

  const verifyStarted = performance.now();
  try {
    const serverEnvelope = await readServerEnvelope();
    state.timings.verifyMs = Math.round(performance.now() - verifyStarted);

    if (sameCommit(serverEnvelope, candidate)) {
      replaceInMemoryMetadata(candidate);
      setKnownGood(candidate);
      clearJournal();
      setStage('verified', `Revision ${candidate.campaign.revision} was read back from the saved chat header.`);
      return;
    }

    replaceInMemoryMetadata(serverEnvelope);
    if (serverEnvelope && validateEnvelope(serverEnvelope).ok && serverEnvelope.campaign.binding.chatId === state.chatId) setKnownGood(serverEnvelope);
    else setKnownGood(previousKnownGood);

    if ((!serverEnvelope && !baseEnvelope) || sameCommit(serverEnvelope, baseEnvelope)) {
      setStage('failed', 'The server still has the previous revision. The candidate remains recoverable in the browser journal.');
    } else {
      setStage('stale', 'The server contains a different commit. Automatic overwrite is blocked; the candidate remains recoverable.');
    }
  } catch (error) {
    state.timings.verifyMs = Math.round(performance.now() - verifyStarted);
    replaceInMemoryMetadata(previousKnownGood);
    setKnownGood(previousKnownGood);
    setStage('pending-unknown', `${error.message} Save outcome is unknown; previous known-good context remains active.`);
  }
}

async function initializeCampaign() {
  if (!state.chatId || state.knownGood || state.inherited) return;
  const anchor = await anchorFor();
  const candidate = createRepresentativeCampaign({ chatId: state.chatId, anchor, instanceId: uuid(), commitId: uuid() });
  await persistCandidate(candidate, null, false);
}

function mutateFromDraft(campaign) {
  campaign.title = String(state.draft.title).trim() || 'Untitled Campaign';
  const item = campaign.records.find(record => record.id === state.draft.itemId);
  if (item) {
    item.data.quantity = Math.max(0, Math.trunc(Number(state.draft.itemQuantity) || 0));
    item.summary = String(state.draft.itemSummary).trim();
  }
}

async function commitDraft(simulateFailure) {
  if (!state.knownGood || !state.draft) return;
  const anchor = await anchorFor();
  const candidate = createRevision(state.knownGood, { commitId: uuid(), anchor, mutate: mutateFromDraft });
  await persistCandidate(candidate, state.knownGood, simulateFailure);
}

async function verifyServer() {
  const started = performance.now();
  setStage('checking', 'Reading the current chat header directly from SillyTavern…');
  try {
    const serverEnvelope = await readServerEnvelope();
    state.timings.verifyMs = Math.round(performance.now() - started);
    const journal = loadJournal();
    state.journal = journal;

    if (journal && sameCommit(serverEnvelope, journal.candidate)) {
      replaceInMemoryMetadata(serverEnvelope);
      setKnownGood(serverEnvelope);
      clearJournal();
      setStage('verified', `Recovered and verified revision ${serverEnvelope.campaign.revision}.`);
      return;
    }

    if (!serverEnvelope) {
      setKnownGood(null);
      setStage(journal ? 'failed' : 'unbound', journal ? 'The server has no Campaign; the browser candidate is recoverable.' : 'This chat has no Campaign.');
      return;
    }

    const check = validateEnvelope(serverEnvelope);
    if (!check.ok) {
      setKnownGood(null);
      setStage('corrupt', check.errors.join(' '));
      return;
    }

    if (serverEnvelope.campaign.binding.chatId !== state.chatId) {
      state.inherited = serverEnvelope;
      setKnownGood(null);
      await evaluateBranchTarget();
      setStage('branch-mismatch', 'This chat inherited a Campaign bound to another chat. Future state is not injected.');
      return;
    }

    replaceInMemoryMetadata(serverEnvelope);
    setKnownGood(serverEnvelope);
    setStage(journal ? 'stale' : 'verified', journal ? 'Server and recoverable candidate differ; overwrite is blocked.' : `Revision ${serverEnvelope.campaign.revision} matches this chat.`);
  } catch (error) {
    state.timings.verifyMs = Math.round(performance.now() - started);
    setStage('pending-unknown', error.message);
  }
}

function restoreCandidateAsDraft() {
  if (!state.journal?.candidate) return;
  state.draft = editableDraft(state.journal.candidate);
  setStage('draft', 'Recoverable candidate fields were restored as an editable draft against the current known-good revision.');
}

function discardCandidate() {
  clearJournal();
  state.draft = editableDraft(state.knownGood);
  setStage(state.knownGood ? 'verified' : 'unbound', state.knownGood ? 'Recoverable candidate discarded; verified Campaign unchanged.' : 'Recoverable candidate discarded.');
}

async function markSyncBoundary() {
  if (!state.knownGood) return;
  const digests = await messageDigests();
  const anchor = await anchorFor(digests);
  const candidate = createRevision(state.knownGood, {
    commitId: uuid(),
    anchor,
    mutate: campaign => {
      campaign.syncBoundary = { messageCount: digests.length, messageDigests: digests, prefixDigest: anchor.prefixDigest };
    },
  });
  await persistCandidate(candidate, state.knownGood, false);
  if (state.knownGood?.campaign?.syncBoundary) {
    state.history = { state: 'clean', message: `Saved fingerprints for ${digests.length} messages.` };
    render();
  }
}

async function scanHistory() {
  const boundary = state.knownGood?.campaign?.syncBoundary;
  if (!boundary) return;
  const current = await messageDigests();
  let earliest = -1;
  const comparable = Math.min(boundary.messageDigests.length, current.length);
  for (let index = 0; index < comparable; index += 1) {
    if (boundary.messageDigests[index] !== current[index]) {
      earliest = index;
      break;
    }
  }
  if (earliest < 0 && current.length < boundary.messageCount) earliest = current.length;

  if (earliest < 0) {
    state.history = { state: 'clean', message: `The first ${boundary.messageCount} messages still match the saved sync boundary.` };
  } else {
    state.history = { state: 'changed', message: `History diverged at message ${earliest + 1}. Canonical state was not changed; Story Sync must reconsider from there.` };
  }
  addLog(`history-${state.history.state}: ${state.history.message}`);
  render();
}

async function evaluateBranchTarget() {
  state.branchTargetRevision = null;
  if (!state.inherited) return;
  const digests = await messageDigests();
  const trail = [...state.inherited.campaign.revisionTrail].sort((a, b) => a.revision - b.revision);
  for (const entry of trail) {
    if (!entry.anchor || entry.anchor.messageCount > digests.length) continue;
    const currentAnchor = await anchorFor(digests, entry.anchor.messageCount);
    if (currentAnchor.prefixDigest === entry.anchor.prefixDigest) state.branchTargetRevision = entry.revision;
  }
  render();
}

async function recoverInheritedBranch() {
  if (!state.inherited || !state.branchTargetRevision) return;
  const anchor = await anchorFor();
  const candidate = recoverFork(state.inherited, {
    targetRevision: state.branchTargetRevision,
    chatId: state.chatId,
    anchor,
    instanceId: uuid(),
    commitId: uuid(),
  });
  await persistCandidate(candidate, state.inherited, false);
  if (state.knownGood && state.knownGood.campaign.binding.chatId === state.chatId) {
    state.inherited = null;
    state.branchTargetRevision = null;
    setStage('verified', `Branch recovered as a new Campaign from parent revision ${candidate.campaign.lineage.parentRevision}.`);
  }
}

async function activateChat() {
  const activation = ++state.activation;
  const currentIdentity = identity();
  state.chatId = currentIdentity.id;
  state.chatTitle = currentIdentity.title;
  state.knownGood = null;
  state.inherited = null;
  state.branchTargetRevision = null;
  state.metrics = null;
  state.draft = null;
  state.journal = loadJournal(currentIdentity.id);
  state.history = { state: 'unchecked', message: 'No history check run.' };
  registerKnownGoodCapsule();

  if (!state.chatId) {
    setStage('unbound', 'Open or create a saved character chat first.');
    return;
  }

  const raw = clone(context()?.chatMetadata?.[META_KEY] ?? null);
  if (!raw) {
    setStage(state.journal ? 'failed' : 'unbound', state.journal ? 'No server Campaign is loaded; a browser candidate is recoverable.' : 'This chat has no Campaign.');
    return;
  }

  const check = validateEnvelope(raw);
  if (!check.ok) {
    setStage('corrupt', check.errors.join(' '));
    return;
  }

  if (raw.campaign.binding.chatId !== state.chatId) {
    state.inherited = raw;
    await evaluateBranchTarget();
    if (activation !== state.activation) return;
    setStage('branch-mismatch', 'Inherited Campaign belongs to another chat. Its capsule is disabled until point-in-time recovery.');
    return;
  }

  setKnownGood(raw);
  if (state.journal && sameCommit(raw, state.journal.candidate)) {
    clearJournal();
    setStage('verified', `Revision ${raw.campaign.revision} was confirmed by chat reload.`);
  } else if (state.journal && state.journal.baseCommitId === raw.campaign.commitId) {
    setStage('failed', 'The previous revision survived; the unsaved candidate remains recoverable.');
  } else if (state.journal) {
    setStage('stale', 'Loaded Campaign and recoverable candidate have different bases. Automatic overwrite is blocked.');
  } else {
    setStage('verified', `Loaded revision ${raw.campaign.revision} from chat metadata.`);
  }
}

function openWorkspace(trigger) {
  const root = document.querySelector(`#${ROOT_ID}`);
  if (!root) return;
  state.returnFocus = trigger instanceof HTMLElement ? trigger : document.activeElement;
  state.open = true;
  root.classList.add('is-open');
  root.setAttribute('aria-hidden', 'false');
  document.querySelector('#rpgdur-launcher')?.setAttribute('aria-expanded', 'true');
  activateChat();
  root.querySelector('[data-rpgdur-action="close"]')?.focus();
}

function closeWorkspace() {
  const root = document.querySelector(`#${ROOT_ID}`);
  if (!root) return;
  state.open = false;
  root.classList.remove('is-open');
  root.setAttribute('aria-hidden', 'true');
  document.querySelector('#rpgdur-launcher')?.setAttribute('aria-expanded', 'false');
  state.returnFocus?.focus?.();
}

async function handleAction(action) {
  if (action === 'close') closeWorkspace();
  if (action === 'initialize') await initializeCampaign();
  if (action === 'commit') await commitDraft(false);
  if (action === 'fail-commit') await commitDraft(true);
  if (action === 'verify') await verifyServer();
  if (action === 'restore-candidate') restoreCandidateAsDraft();
  if (action === 'discard-candidate') discardCandidate();
  if (action === 'mark-boundary') await markSyncBoundary();
  if (action === 'scan-history') await scanHistory();
  if (action === 'recover-branch') await recoverInheritedBranch();
}

function handleClick(event) {
  const launcher = event.target.closest('#rpgdur-launcher');
  if (launcher) {
    openWorkspace(launcher);
    return;
  }
  const pane = event.target.closest('[data-rpgdur-pane]')?.dataset.rpgdurPane;
  if (pane) {
    state.mobilePane = pane;
    render();
    return;
  }
  const action = event.target.closest('[data-rpgdur-action]')?.dataset.rpgdurAction;
  if (action) handleAction(action).catch(error => setStage('failed', error.message));
}

function handleInput(event) {
  if (!state.draft) return;
  if (event.target.name === 'title') state.draft.title = event.target.value;
  if (event.target.name === 'itemQuantity') state.draft.itemQuantity = event.target.value;
  if (event.target.name === 'itemSummary') state.draft.itemSummary = event.target.value;
  state.stage = 'draft';
  state.message = 'Local fields changed. Nothing canonical has changed yet.';
  const root = document.querySelector(`#${ROOT_ID}`);
  if (!root) return;
  const status = root.querySelector('#rpgdur-status');
  status.dataset.stage = state.stage;
  status.querySelector('strong').textContent = 'draft';
  status.querySelector('span').textContent = state.message;
  root.querySelector('#rpgdur-campaign-title').textContent = state.draft.title || 'Untitled Campaign';
}

function mount() {
  if (document.querySelector(`#${ROOT_ID}`)) return;
  document.body.insertAdjacentHTML('beforeend', workspaceMarkup());
  document.addEventListener('click', handleClick);
  document.querySelector('#rpgdur-form')?.addEventListener('input', handleInput);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && state.open) closeWorkspace();
  });

  const current = context();
  const chatChanged = current?.eventTypes?.CHAT_CHANGED ?? current?.event_types?.CHAT_CHANGED;
  if (current?.eventSource && chatChanged) current.eventSource.on(chatChanged, () => activateChat().catch(error => setStage('failed', error.message)));
  activateChat().catch(error => setStage('failed', error.message));
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
else mount();
