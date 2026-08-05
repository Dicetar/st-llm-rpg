import { createCampaignSession } from './campaign-session.js';
import { CAMPAIGN_METADATA_KEY, createSillyTavernCampaignStorage } from './sillytavern-storage.js';
import { createStorySync } from './story-sync.js';
import { createNarratorContextInspector } from './context-inspector.js';
import { compileNarratorContext } from './context-router.js';

const ROOT_ID = 'st-rpg-campaign-workspace';
const PROMPT_KEY = 'st-llm-rpg:campaign-capsule';
const DRAFT_KEY = 'st-llm-rpg:inventory-drafts:v1';
const LAYOUT_KEY = 'st-llm-rpg:workspace-layout:v1';
const IN_CHAT_PROMPT = 1;
const NO_PROMPT = -1;
const SYSTEM_ROLE = 0;
const CONTENT_BUNDLE_URL = new URL('./content/content-bundle.json', import.meta.url);

const storage = createSillyTavernCampaignStorage();
const session = createCampaignSession({ storage });
const storySync = createStorySync({
  getContext,
  getCampaignContext: () => state.contextPacket?.text ?? state.status?.capsule ?? '',
  getSyncBoundary: () => state.status?.syncBoundary ?? null,
  getReviewInbox: () => state.status
    ? session.query({ collection: 'story_sync_proposals' })
    : { entries: [], syncBoundary: null },
  executeCampaignOperation: operation => runStorySyncOperation(operation),
});
const contextInspector = createNarratorContextInspector({
  getContext,
  getCapsule: () => state.contextPacket
    ? { capsule: state.contextPacket }
    : state.status ? session.query({ collection: 'context_capsule' }) : null,
  executeCampaignOperation: operation => runStorySyncOperation(operation),
  setManualFocus: (recordId, enabled) => setManualFocus(recordId, enabled),
});

const state = {
  open: false,
  loading: false,
  mutating: false,
  chatId: '',
  chatTitle: '',
  status: null,
  contextPacket: null,
  manualFocusIds: [],
  activeCollection: 'inventory',
  characterEntry: null,
  entries: [],
  archivedEntries: [],
  abilityEntries: [],
  archivedAbilityEntries: [],
  peopleEntries: [],
  archivedPeopleEntries: [],
  questEntries: [],
  archivedQuestEntries: [],
  factEntries: [],
  archivedFactEntries: [],
  placeEntries: [],
  archivedPlaceEntries: [],
  worldObjectEntries: [],
  archivedWorldObjectEntries: [],
  currentSceneEntry: null,
  sceneArchives: [],
  referenceOptions: [],
  worldKind: 'fact',
  relationshipEntries: [],
  archivedRelationshipEntries: [],
  actorOptions: [],
  selectedPossessionId: null,
  selectedLearnedAbilityId: null,
  selectedActorId: null,
  selectedQuestId: null,
  selectedWorldRecordId: null,
  selectedSceneId: null,
  showArchived: false,
  search: '',
  draft: null,
  fieldErrors: {},
  notice: '',
  error: '',
  undo: null,
  returnFocus: null,
  mobilePane: 'inventory',
  layout: readJson(localStorage, LAYOUT_KEY, { collections: true, inventory: true, chat: true }),
  drafts: readJson(localStorage, DRAFT_KEY, {}),
};

let draftRowSequence = 0;
function draftRowKey(prefix) {
  draftRowSequence += 1;
  return `${prefix}-${Date.now()}-${draftRowSequence}`;
}

function clone(value) {
  if (value === undefined) return undefined;
  if (globalThis.structuredClone) return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function readJson(target, key, fallback) {
  try {
    const value = JSON.parse(target?.getItem(key));
    return value && typeof value === 'object' ? value : clone(fallback);
  } catch {
    return clone(fallback);
  }
}

function writeJson(target, key, value) {
  try {
    target?.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn('[RPG Campaign] Could not preserve browser UI state.', error);
  }
}

function getContext() {
  return globalThis.SillyTavern?.getContext?.() ?? null;
}

function chatIdentity() {
  const context = getContext();
  let currentChatId = '';
  try {
    currentChatId = context?.getCurrentChatId?.() ?? '';
  } catch {
    currentChatId = '';
  }
  currentChatId = String(currentChatId || context?.chatId || '');
  return {
    chatId: currentChatId,
    title: currentChatId || 'No chat selected',
  };
}

function registerCapsule(text = '') {
  const context = getContext();
  if (!context?.setExtensionPrompt) return;
  context.setExtensionPrompt(
    PROMPT_KEY,
    text,
    text ? IN_CHAT_PROMPT : NO_PROMPT,
    text ? 1 : 0,
    false,
    SYSTEM_ROLE,
  );
}

function verifiedEnvelopeFromMetadata() {
  const envelope = getContext()?.chatMetadata?.[CAMPAIGN_METADATA_KEY];
  const campaign = envelope?.campaign;
  const capsule = envelope?.capsule;
  const matches = Boolean(
    campaign
    && capsule
    && campaign.revision === capsule.campaignRevision
    && campaign.commitId === capsule.commitId,
  );
  return matches ? envelope : null;
}

function refreshNarratorPrompt() {
  const envelope = verifiedEnvelopeFromMetadata();
  if (!envelope) {
    state.contextPacket = null;
    registerCapsule('');
    return null;
  }
  const packet = compileNarratorContext(envelope.campaign, {
    messages: getContext()?.chat ?? [],
    manualFocusIds: state.manualFocusIds,
  });
  state.contextPacket = packet;
  registerCapsule(packet.text);
  return packet;
}

function setManualFocus(recordId, enabled) {
  const envelope = verifiedEnvelopeFromMetadata();
  const record = envelope?.campaign?.records?.find(candidate => candidate.id === recordId && !candidate.archivedAt);
  if (!record) throw new Error('That Campaign record is no longer available.');
  if (record.contextPolicy === 'excluded') throw new Error('Excluded records cannot be queued for narration. Change its context policy first.');
  const queued = new Set(state.manualFocusIds);
  if (enabled) queued.add(recordId);
  else queued.delete(recordId);
  state.manualFocusIds = [...queued];
  const packet = refreshNarratorPrompt();
  renderCollection();
  return packet;
}

function clearConsumedManualFocus() {
  if (!state.manualFocusIds.length) {
    refreshNarratorPrompt();
    return;
  }
  state.manualFocusIds = [];
  refreshNarratorPrompt();
  renderCollection();
}

function restoreCapsuleFromMetadata() {
  refreshNarratorPrompt();
}

function persistLayout() {
  writeJson(localStorage, LAYOUT_KEY, state.layout);
}

function persistDraft() {
  if (!state.chatId) return;
  if (state.draft?.dirty || state.draft?.relationshipDraft?.dirty || state.draft?.quickRecord?.dirty || state.draft?.advanceDraft?.dirty) {
    state.drafts[state.chatId] = clone(state.draft);
  }
  else delete state.drafts[state.chatId];
  writeJson(localStorage, DRAFT_KEY, state.drafts);
}

function hasDirtyDraft() {
  return Boolean(state.draft?.dirty || state.draft?.relationshipDraft?.dirty || state.draft?.quickRecord?.dirty || state.draft?.advanceDraft?.dirty);
}

function emptyDraft() {
  return {
    collection: 'inventory',
    mode: 'create',
    definitionMode: 'new',
    existingRecordId: '',
    itemId: null,
    possessionId: null,
    name: '',
    summary: '',
    details: '',
    category: 'other',
    tags: '',
    quantity: 1,
    carriedState: 'carried',
    equippedSlots: '',
    condition: '',
    notes: '',
    dirty: false,
  };
}

function draftFromEntry(entry) {
  return {
    collection: 'inventory',
    mode: 'edit',
    itemId: entry.item.id,
    possessionId: entry.possession.id,
    name: entry.item.name,
    summary: entry.item.summary,
    details: entry.item.details,
    category: entry.item.category,
    tags: entry.item.tags.join(', '),
    quantity: entry.possession.quantity,
    carriedState: entry.possession.carriedState,
    equippedSlots: entry.possession.equippedSlots.join(', '),
    condition: entry.possession.condition,
    notes: entry.possession.notes,
    archived: Boolean(entry.possession.archivedAt),
    dirty: false,
  };
}

function emptyAbilityDraft() {
  return {
    collection: 'abilities',
    mode: 'create',
    definitionMode: 'new',
    existingRecordId: '',
    abilityId: null,
    learnedAbilityId: null,
    name: '',
    summary: '',
    details: '',
    category: 'spell',
    tags: '',
    usage: '',
    limits: '',
    defaultResourceLabel: '',
    contextPolicy: 'automatic',
    accessState: 'learned',
    currentUses: '',
    maxUses: '',
    notes: '',
    dirty: false,
  };
}

function abilityDraftFromEntry(entry) {
  return {
    collection: 'abilities',
    mode: 'edit',
    abilityId: entry.ability.id,
    learnedAbilityId: entry.learnedAbility.id,
    name: entry.ability.name,
    summary: entry.ability.summary,
    details: entry.ability.details,
    category: entry.ability.category,
    tags: entry.ability.tags.join(', '),
    usage: entry.ability.usage,
    limits: entry.ability.limits,
    defaultResourceLabel: entry.ability.defaultResourceLabel,
    contextPolicy: entry.ability.contextPolicy,
    accessState: entry.learnedAbility.accessState,
    currentUses: entry.learnedAbility.currentUses ?? '',
    maxUses: entry.learnedAbility.maxUses ?? '',
    notes: entry.learnedAbility.notes,
    archived: Boolean(entry.learnedAbility.archivedAt),
    dirty: false,
  };
}

function emptyPersonDraft() {
  return {
    collection: 'people',
    mode: 'create',
    actorId: null,
    name: '',
    aliases: '',
    pronouns: '',
    summary: '',
    details: '',
    category: 'npc',
    tags: '',
    appearance: '',
    personality: '',
    goals: '',
    voiceNotes: '',
    conditions: '',
    contextPolicy: 'automatic',
    relationshipDraft: null,
    dirty: false,
  };
}

function personDraftFromEntry(entry) {
  return {
    collection: 'people',
    mode: 'edit',
    actorId: entry.actor.id,
    name: entry.actor.name,
    aliases: (entry.actor.aliases ?? []).join(', '),
    pronouns: entry.actor.pronouns ?? '',
    summary: entry.actor.summary ?? '',
    details: entry.actor.details ?? '',
    category: entry.actor.category ?? 'npc',
    tags: (entry.actor.tags ?? []).join(', '),
    appearance: entry.actor.appearance ?? '',
    personality: entry.actor.personality ?? '',
    goals: entry.actor.goals ?? '',
    voiceNotes: entry.actor.voiceNotes ?? '',
    conditions: (entry.actor.conditions ?? []).join(', '),
    contextPolicy: entry.actor.contextPolicy ?? 'automatic',
    relationshipDraft: null,
    archived: Boolean(entry.actor.archivedAt),
    dirty: false,
  };
}

function characterDraftFromActor(actor) {
  return {
    collection: 'character',
    mode: 'edit',
    actorId: actor.id,
    name: actor.name ?? '',
    aliases: (actor.aliases ?? []).join(', '),
    pronouns: actor.pronouns ?? '',
    summary: actor.summary ?? '',
    details: actor.details ?? '',
    category: actor.category ?? 'player-character',
    tags: (actor.tags ?? []).join(', '),
    appearance: actor.appearance ?? '',
    personality: actor.personality ?? '',
    goals: actor.goals ?? '',
    voiceNotes: actor.voiceNotes ?? '',
    conditions: (actor.conditions ?? []).join(', '),
    meters: (actor.meters ?? []).map(meter => ({ ...clone(meter), _key: meter.id })),
    dirty: false,
  };
}

function emptyQuestDraft() {
  return {
    collection: 'objectives',
    mode: 'create',
    questId: null,
    name: '',
    summary: '',
    details: '',
    category: 'quest',
    tags: '',
    status: 'planned',
    stakes: '',
    outcome: '',
    contextPolicy: 'automatic',
    steps: [],
    involvedRefs: [],
    dirty: false,
  };
}

function questDraftFromEntry(quest) {
  return {
    collection: 'objectives',
    mode: 'edit',
    questId: quest.id,
    name: quest.name ?? '',
    summary: quest.summary ?? '',
    details: quest.details ?? '',
    category: quest.category ?? 'quest',
    tags: (quest.tags ?? []).join(', '),
    status: quest.status ?? 'planned',
    stakes: quest.stakes ?? '',
    outcome: quest.outcome ?? '',
    contextPolicy: quest.contextPolicy ?? 'automatic',
    steps: (quest.steps ?? []).map(step => ({ ...clone(step), _key: step.id })),
    involvedRefs: clone(quest.involvedRefs ?? []),
    archived: Boolean(quest.archivedAt),
    dirty: false,
  };
}

function emptyWorldDraft(kind = state.worldKind) {
  const base = {
    collection: 'world',
    worldKind: kind,
    mode: 'create',
    recordId: null,
    name: '',
    summary: '',
    details: '',
    category: kind === 'world_object' ? 'world-object' : kind,
    tags: '',
    contextPolicy: 'automatic',
    dirty: false,
  };
  if (kind === 'fact') return { ...base, proposition: '', scope: 'campaign', importance: 'normal', subjectKey: '' };
  if (kind === 'place') return { ...base, atmosphere: '', parentPlaceId: '', connections: [] };
  return { ...base, state: '', homePlaceId: '' };
}

function worldDraftFromEntry(entry, kind) {
  const record = kind === 'fact' ? entry.fact : kind === 'place' ? entry.place : entry.worldObject;
  const base = {
    collection: 'world',
    worldKind: kind,
    mode: 'edit',
    recordId: record.id,
    name: record.name ?? '',
    summary: record.summary ?? '',
    details: record.details ?? '',
    category: record.category ?? (kind === 'world_object' ? 'world-object' : kind),
    tags: (record.tags ?? []).join(', '),
    contextPolicy: record.contextPolicy ?? 'automatic',
    archived: Boolean(record.archivedAt),
    dirty: false,
  };
  if (kind === 'fact') {
    return {
      ...base,
      proposition: record.proposition ?? '',
      scope: record.scope ?? 'campaign',
      importance: record.importance ?? 'normal',
      subjectKey: record.subjectRef ? `${record.subjectRef.kind}:${record.subjectRef.id}` : '',
    };
  }
  if (kind === 'place') {
    return {
      ...base,
      atmosphere: record.atmosphere ?? '',
      parentPlaceId: record.parentPlaceId ?? '',
      connections: (record.connections ?? []).map(connection => ({ ...clone(connection), _key: connection.id })),
    };
  }
  return { ...base, state: record.state ?? '', homePlaceId: record.homePlaceId ?? '' };
}

function emptySceneDraft() {
  return {
    collection: 'current_scene',
    mode: 'create',
    sceneId: null,
    title: '',
    summary: '',
    placeId: '',
    transitionNotes: '',
    presences: [],
    exits: [],
    obstacles: [],
    countdowns: [],
    openThreads: [],
    advanceDraft: null,
    dirty: false,
  };
}

function sceneDraftFromEntry(scene) {
  return {
    collection: 'current_scene',
    mode: 'edit',
    sceneId: scene.id,
    title: scene.title ?? '',
    summary: scene.summary ?? '',
    placeId: scene.placeId ?? '',
    transitionNotes: scene.transitionNotes ?? '',
    presences: (scene.presences ?? []).map(entry => {
      const presence = entry.presence ?? entry;
      return {
        ...clone(presence),
        subjectKey: presence.subjectRef ? `${presence.subjectRef.kind}:${presence.subjectRef.id}` : '',
        _key: presence.id ?? draftRowKey('scene-presence'),
      };
    }),
    exits: (scene.exits ?? []).map(entry => ({ ...clone(entry), _key: entry.id ?? draftRowKey('scene-exit') })),
    obstacles: (scene.obstacles ?? []).map(entry => ({ ...clone(entry), _key: entry.id ?? draftRowKey('scene-obstacle') })),
    countdowns: (scene.countdowns ?? []).map(entry => ({ ...clone(entry), _key: entry.id ?? draftRowKey('scene-countdown') })),
    openThreads: (scene.openThreads ?? []).map(entry => ({ ...clone(entry), _key: entry.id ?? draftRowKey('scene-thread') })),
    advanceDraft: null,
    dirty: false,
  };
}

function relationshipDraftFromEntry(entry) {
  const dimensions = entry.relationship.dimensions ?? {};
  return {
    mode: 'edit',
    relationshipId: entry.relationship.id,
    sourceActorId: entry.relationship.sourceActorId,
    targetActorId: entry.relationship.targetActorId,
    relationshipKind: entry.relationship.relationshipKind,
    status: entry.relationship.status,
    notes: entry.relationship.notes,
    affinity: dimensions.affinity ?? '',
    trust: dimensions.trust ?? '',
    respect: dimensions.respect ?? '',
    fear: dimensions.fear ?? '',
    tension: dimensions.tension ?? '',
    debt: dimensions.debt ?? '',
    dirty: false,
  };
}

function savedDraftForChat() {
  const candidate = clone(state.drafts[state.chatId] ?? null);
  if (!candidate || (!candidate.dirty && !candidate.relationshipDraft?.dirty && !candidate.quickRecord?.dirty && !candidate.advanceDraft?.dirty)) return null;
  candidate.collection ??= 'inventory';
  if (candidate.collection === 'character') candidate.meters ??= [];
  if (candidate.collection === 'objectives') {
    candidate.steps ??= [];
    candidate.involvedRefs ??= [];
  }
  if (candidate.collection === 'world' && candidate.worldKind === 'place') candidate.connections ??= [];
  if (candidate.collection === 'current_scene') {
    candidate.presences ??= [];
    candidate.exits ??= [];
    candidate.obstacles ??= [];
    candidate.countdowns ??= [];
    candidate.openThreads ??= [];
  }
  if (candidate.mode === 'edit') {
    const exists = candidate.collection === 'character'
      ? candidate.actorId === state.characterEntry?.id
      : candidate.collection === 'objectives'
        ? [...state.questEntries, ...state.archivedQuestEntries].some(entry => entry.id === candidate.questId)
        : candidate.collection === 'world'
          ? [
              ...state.factEntries.map(entry => entry.fact),
              ...state.archivedFactEntries.map(entry => entry.fact),
              ...state.placeEntries.map(entry => entry.place),
              ...state.archivedPlaceEntries.map(entry => entry.place),
              ...state.worldObjectEntries.map(entry => entry.worldObject),
              ...state.archivedWorldObjectEntries.map(entry => entry.worldObject),
            ].some(record => record.id === candidate.recordId)
        : candidate.collection === 'current_scene'
          ? candidate.sceneId === state.currentSceneEntry?.id
        : candidate.collection === 'abilities'
      ? [...state.abilityEntries, ...state.archivedAbilityEntries]
        .some(entry => entry.learnedAbility.id === candidate.learnedAbilityId && entry.ability.id === candidate.abilityId)
      : candidate.collection === 'people'
        ? [...state.peopleEntries, ...state.archivedPeopleEntries].some(entry => entry.actor.id === candidate.actorId)
        : [...state.entries, ...state.archivedEntries]
          .some(entry => entry.possession.id === candidate.possessionId && entry.item.id === candidate.itemId);
    if (!exists) return null;
  }
  return candidate;
}

function workspaceMarkup() {
  return `
    <section id="${ROOT_ID}" class="rpgcampaign" role="dialog" aria-modal="true" aria-label="RPG Campaign Workspace" aria-hidden="true">
      <header class="rpgcampaign__topbar">
        <div class="rpgcampaign__brand">
          <span>RPG CAMPAIGN</span>
          <strong>Campaign Workspace</strong>
          <small id="rpgcampaign-chat-title"></small>
        </div>
        <div id="rpgcampaign-panel-controls" class="rpgcampaign__panel-controls" aria-label="Panel visibility"></div>
        <button type="button" class="rpgcampaign__button" data-rpg-action="close">Return to chat</button>
      </header>

      <nav class="rpgcampaign__mobile-nav" aria-label="Workspace sections">
        <button type="button" data-rpg-mobile="collections">Collections</button>
        <button type="button" data-rpg-mobile="inventory">Records</button>
        <button type="button" data-rpg-mobile="editor">Editor</button>
        <button type="button" data-rpg-mobile="chat">Chat</button>
      </nav>

      <div class="rpgcampaign__body">
        <aside class="rpgcampaign__panel rpgcampaign__collections" data-rpg-panel="collections">
          <div class="rpgcampaign__panel-heading"><strong>Collections</strong><button type="button" class="rpgcampaign__icon" data-rpg-hide="collections" aria-label="Hide Collections" title="Hide Collections">×</button></div>
          <button type="button" class="rpgcampaign__collection" data-rpg-collection="character"><span>Character</span><small id="rpgcampaign-character-count">1</small></button>
          <button type="button" class="rpgcampaign__collection is-active" data-rpg-collection="inventory"><span>Inventory</span><small id="rpgcampaign-inventory-count">0</small></button>
          <button type="button" class="rpgcampaign__collection" data-rpg-collection="abilities"><span>Abilities</span><small id="rpgcampaign-abilities-count">0</small></button>
          <button type="button" class="rpgcampaign__collection" data-rpg-collection="people"><span>People</span><small id="rpgcampaign-people-count">0</small></button>
          <button type="button" class="rpgcampaign__collection" data-rpg-collection="objectives"><span>Objectives</span><small id="rpgcampaign-objectives-count">0</small></button>
          <button type="button" class="rpgcampaign__collection" data-rpg-collection="world"><span>World</span><small id="rpgcampaign-world-count">0</small></button>
          <button type="button" class="rpgcampaign__collection" data-rpg-collection="current_scene"><span>Current Scene</span><small id="rpgcampaign-current-scene-count">0</small></button>
          <div class="rpgcampaign__collection-actions">
            <button id="rpgcampaign-add-here" type="button" class="rpgcampaign__primary" data-rpg-action="new-record">+ Add item here</button>
            <button type="button" class="rpgcampaign__button" data-rpg-action="sync-addons">Sync JSON Addons</button>
            <button type="button" class="rpgcampaign__button" data-rpg-action="sync-story">Sync Story</button>
            <button type="button" class="rpgcampaign__button" data-rpg-action="inspect-context">Narrator Context</button>
          </div>
        </aside>

        <aside class="rpgcampaign__panel rpgcampaign__inventory" data-rpg-panel="inventory">
          <div class="rpgcampaign__panel-heading">
            <div><strong id="rpgcampaign-collection-title">Inventory</strong><small id="rpgcampaign-revision">Opening…</small></div>
            <button type="button" class="rpgcampaign__icon" data-rpg-hide="inventory" aria-label="Hide Inventory" title="Hide Inventory">×</button>
          </div>
          <div class="rpgcampaign__inventory-tools">
            <label id="rpgcampaign-world-kind-wrap" hidden><span class="sr-only">World record type</span><select id="rpgcampaign-world-kind"><option value="fact">Facts</option><option value="place">Places</option><option value="world_object">World Objects</option></select></label>
            <label><span class="sr-only">Search Inventory</span><input id="rpgcampaign-search" type="search" placeholder="Search Inventory…" autocomplete="off"></label>
            <label class="rpgcampaign__archived-toggle"><input id="rpgcampaign-show-archived" type="checkbox"> Archived</label>
            <button id="rpgcampaign-add-record" type="button" class="rpgcampaign__primary" data-rpg-action="new-record">+ Add item</button>
          </div>
          <div id="rpgcampaign-collection-list" class="rpgcampaign__inventory-list"></div>
        </aside>

        <main class="rpgcampaign__editor" data-rpg-panel="editor">
          <div class="rpgcampaign__editor-heading">
            <div><span id="rpgcampaign-editor-kind">INVENTORY EDITOR</span><h2 id="rpgcampaign-editor-title">Select or add an item</h2></div>
            <span id="rpgcampaign-dirty" class="rpgcampaign__dirty"></span>
          </div>
          <div id="rpgcampaign-status" class="rpgcampaign__status" role="status" hidden></div>
          <div id="rpgcampaign-error" class="rpgcampaign__error" role="alert" hidden></div>
          <div id="rpgcampaign-empty-editor" class="rpgcampaign__empty-editor">
            <p id="rpgcampaign-empty-editor-copy">Inventory is edited here. Create the Item and add it to the Player Character without leaving this collection.</p>
            <button id="rpgcampaign-empty-editor-add" type="button" class="rpgcampaign__primary" data-rpg-action="new-record">+ Add first item</button>
          </div>
          <form id="rpgcampaign-form" class="rpgcampaign__form" hidden novalidate>
            <fieldset data-rpg-definition-choice>
              <legend>Add to Inventory</legend>
              <label>Item source
                <select name="definitionMode"><option value="new">Create a new Item</option><option value="existing">Use an existing Item</option></select>
              </label>
              <label data-rpg-existing-choice hidden>Existing Item<select name="existingRecordId"></select><small data-field-error="itemId"></small></label>
            </fieldset>
            <fieldset data-rpg-definition-fields>
              <legend>Item description</legend>
              <label>Name <input name="name" autocomplete="off" required><small data-field-error="name"></small></label>
              <label>Category <input name="category" autocomplete="off" placeholder="clothing, key, weapon…"></label>
              <label class="rpgcampaign__wide">Summary <textarea name="summary" rows="3" placeholder="Short context-ready description"></textarea></label>
              <label class="rpgcampaign__wide">Details <textarea name="details" rows="6" placeholder="Long notes; not injected by default"></textarea></label>
              <label class="rpgcampaign__wide">Tags <input name="tags" autocomplete="off" placeholder="house-harcourt, clothing"></label>
            </fieldset>
            <fieldset>
              <legend>Inventory state</legend>
              <label>Quantity <input name="quantity" type="number" min="0" step="1" inputmode="numeric"><small data-field-error="quantity"></small></label>
              <label>Carried state
                <select name="carriedState">
                  <option value="carried">Carried</option><option value="worn">Worn</option><option value="stored">Stored</option>
                  <option value="missing">Missing</option><option value="consumed">Consumed</option><option value="other">Other</option>
                </select>
              </label>
              <label class="rpgcampaign__wide">Equipped slots <input name="equippedSlots" autocomplete="off" placeholder="right hand, belt"></label>
              <label>Condition <input name="condition" autocomplete="off" placeholder="pristine, damaged…"></label>
              <label class="rpgcampaign__wide">Notes <textarea name="notes" rows="4"></textarea></label>
            </fieldset>
          </form>
          <form id="rpgcampaign-ability-form" class="rpgcampaign__form" hidden novalidate>
            <fieldset data-rpg-definition-choice>
              <legend>Add to Abilities</legend>
              <label>Ability source
                <select name="definitionMode"><option value="new">Create a new Ability</option><option value="existing">Use an existing Ability</option></select>
              </label>
              <label data-rpg-existing-choice hidden>Existing Ability<select name="existingRecordId"></select><small data-field-error="abilityId"></small></label>
            </fieldset>
            <fieldset data-rpg-definition-fields>
              <legend>Ability description</legend>
              <label>Name <input name="name" autocomplete="off" required><small data-field-error="name"></small></label>
              <label>Category
                <select name="category"><option value="spell">Spell</option><option value="skill">Skill</option><option value="feat">Feat</option><option value="power">Power</option><option value="other">Other</option></select>
              </label>
              <label class="rpgcampaign__wide">Summary <textarea name="summary" rows="3" placeholder="Short context-ready description"></textarea></label>
              <label class="rpgcampaign__wide">Details <textarea name="details" rows="5" placeholder="Long notes; not injected by default"></textarea></label>
              <label class="rpgcampaign__wide">Tags <input name="tags" autocomplete="off" placeholder="arcane, utility"></label>
              <label class="rpgcampaign__wide">How it works <textarea name="usage" rows="3"></textarea></label>
              <label class="rpgcampaign__wide">Limits <textarea name="limits" rows="3"></textarea></label>
              <label>Resource label <input name="defaultResourceLabel" autocomplete="off" placeholder="charges, mana…"></label>
              <label>In narration
                <select name="contextPolicy"><option value="automatic">Include when available</option><option value="excluded">Exclude</option></select>
              </label>
            </fieldset>
            <fieldset>
              <legend>Learned state</legend>
              <label>Access
                <select name="accessState"><option value="learned">Learned</option><option value="prepared">Prepared</option><option value="enabled">Enabled</option><option value="unavailable">Unavailable</option><option value="forgotten">Forgotten</option></select>
              </label>
              <label>Current uses <input name="currentUses" type="number" min="0" step="1" inputmode="numeric"><small data-field-error="currentUses"></small></label>
              <label>Maximum uses <input name="maxUses" type="number" min="0" step="1" inputmode="numeric"><small data-field-error="maxUses"></small></label>
              <label class="rpgcampaign__wide">Notes <textarea name="notes" rows="4"></textarea></label>
            </fieldset>
          </form>
          <form id="rpgcampaign-person-form" class="rpgcampaign__form" hidden novalidate>
            <fieldset>
              <legend>NPC identity</legend>
              <label>Name <input name="name" autocomplete="off" required><small data-field-error="name"></small></label>
              <label>Pronouns <input name="pronouns" autocomplete="off" placeholder="she/her, he/him, they/them"></label>
              <label class="rpgcampaign__wide">Aliases <input name="aliases" autocomplete="off" placeholder="titles, nicknames"></label>
              <label>Category <input name="category" autocomplete="off" placeholder="courtier, merchant, rival"></label>
              <label>In narration
                <select name="contextPolicy"><option value="automatic">Include</option><option value="excluded">Exclude</option></select>
              </label>
              <label class="rpgcampaign__wide">Summary <textarea name="summary" rows="3" placeholder="Short context-ready identity"></textarea></label>
              <label class="rpgcampaign__wide">Details <textarea name="details" rows="5" placeholder="Long private notes; not injected by default"></textarea></label>
              <label class="rpgcampaign__wide">Tags <input name="tags" autocomplete="off" placeholder="house-harcourt, court, mage"></label>
            </fieldset>
            <fieldset>
              <legend>Characterization</legend>
              <label class="rpgcampaign__wide">Appearance <textarea name="appearance" rows="3"></textarea></label>
              <label class="rpgcampaign__wide">Personality <textarea name="personality" rows="3"></textarea></label>
              <label class="rpgcampaign__wide">Goals <textarea name="goals" rows="3"></textarea></label>
              <label class="rpgcampaign__wide">Voice notes <textarea name="voiceNotes" rows="3"></textarea></label>
              <label class="rpgcampaign__wide">Current conditions <input name="conditions" autocomplete="off" placeholder="wounded, suspicious"></label>
            </fieldset>
          </form>
          <form id="rpgcampaign-character-form" class="rpgcampaign__form" hidden novalidate>
            <fieldset>
              <legend>Player Character</legend>
              <label>Name <input name="name" autocomplete="off" required><small data-field-error="name"></small></label>
              <label>Pronouns <input name="pronouns" autocomplete="off"></label>
              <label class="rpgcampaign__wide">Aliases <input name="aliases" autocomplete="off" placeholder="titles, nicknames"></label>
              <label>Category <input name="category" autocomplete="off"></label>
              <label class="rpgcampaign__wide">Summary <textarea name="summary" rows="3" placeholder="Short context-ready identity"></textarea></label>
              <label class="rpgcampaign__wide">Details <textarea name="details" rows="5" placeholder="Long private notes; not injected by default"></textarea></label>
              <label class="rpgcampaign__wide">Tags <input name="tags" autocomplete="off"></label>
            </fieldset>
            <fieldset>
              <legend>Characterization</legend>
              <label class="rpgcampaign__wide">Appearance <textarea name="appearance" rows="3"></textarea></label>
              <label class="rpgcampaign__wide">Personality <textarea name="personality" rows="3"></textarea></label>
              <label class="rpgcampaign__wide">Goals <textarea name="goals" rows="3"></textarea></label>
              <label class="rpgcampaign__wide">Voice notes <textarea name="voiceNotes" rows="3"></textarea></label>
              <label class="rpgcampaign__wide">Current conditions <input name="conditions" autocomplete="off" placeholder="wounded, suspicious"></label>
            </fieldset>
            <fieldset>
              <legend>Character meters</legend>
              <div class="rpgcampaign__wide rpgcampaign__repeater-heading">
                <p>Simple current/maximum counters. Add and edit them here.</p>
                <button type="button" class="rpgcampaign__button" data-rpg-action="add-meter">+ Add meter</button>
              </div>
              <div id="rpgcampaign-meter-list" class="rpgcampaign__wide rpgcampaign__repeater-list"></div>
            </fieldset>
          </form>
          <form id="rpgcampaign-objective-form" class="rpgcampaign__form" hidden novalidate>
            <fieldset>
              <legend>Objective</legend>
              <label>Name <input name="name" autocomplete="off" required><small data-field-error="name"></small></label>
              <label>Status
                <select name="status"><option value="planned">Planned</option><option value="active">Active</option><option value="blocked">Blocked</option><option value="completed">Completed</option><option value="failed">Failed</option></select>
              </label>
              <label>Category <input name="category" autocomplete="off" placeholder="investigation, personal, faction"></label>
              <label>In narration
                <select name="contextPolicy"><option value="automatic">Automatic</option><option value="pinned">Pinned</option><option value="excluded">Excluded</option></select>
              </label>
              <label class="rpgcampaign__wide">Summary <textarea name="summary" rows="3" placeholder="Short current objective"></textarea></label>
              <label class="rpgcampaign__wide">Details <textarea name="details" rows="5" placeholder="Long private notes; not injected by default"></textarea></label>
              <label class="rpgcampaign__wide">Tags <input name="tags" autocomplete="off"></label>
              <label class="rpgcampaign__wide">Stakes <textarea name="stakes" rows="3" placeholder="What happens if this succeeds or fails?"></textarea></label>
              <label class="rpgcampaign__wide">Outcome <textarea name="outcome" rows="3" placeholder="Fill when resolved"></textarea></label>
            </fieldset>
            <fieldset>
              <legend>Steps</legend>
              <div class="rpgcampaign__wide rpgcampaign__repeater-heading">
                <p>Ordered, editable progress—not comma-separated text.</p>
                <button type="button" class="rpgcampaign__button" data-rpg-action="add-quest-step">+ Add step</button>
              </div>
              <div id="rpgcampaign-quest-step-list" class="rpgcampaign__wide rpgcampaign__repeater-list"></div>
            </fieldset>
          </form>
          <form id="rpgcampaign-fact-form" class="rpgcampaign__form" hidden novalidate>
            <fieldset>
              <legend>Campaign fact</legend>
              <label>Name <input name="name" autocomplete="off" required><small data-field-error="name"></small></label>
              <label>Importance <select name="importance"><option value="normal">Normal</option><option value="important">Important</option><option value="critical">Critical</option></select></label>
              <label>Scope <input name="scope" autocomplete="off" placeholder="campaign, faction, personal"></label>
              <label>In narration <select name="contextPolicy"><option value="automatic">Automatic</option><option value="pinned">Pinned</option><option value="excluded">Excluded</option></select></label>
              <label class="rpgcampaign__wide">Canonical statement <textarea name="proposition" rows="3" required placeholder="One concise claim treated as true"></textarea><small data-field-error="proposition"></small></label>
              <label class="rpgcampaign__wide">Subject <select name="subjectKey" id="rpgcampaign-fact-subject"></select><button type="button" class="rpgcampaign__button rpgcampaign__inline-create" data-rpg-quick-target="factSubject">+ Create and use a subject</button></label>
              <label>Category <input name="category" autocomplete="off"></label>
              <label class="rpgcampaign__wide">Summary <textarea name="summary" rows="3"></textarea></label>
              <label class="rpgcampaign__wide">Details <textarea name="details" rows="5" placeholder="Private evidence or provenance; not injected by default"></textarea></label>
              <label class="rpgcampaign__wide">Tags <input name="tags" autocomplete="off"></label>
            </fieldset>
          </form>
          <form id="rpgcampaign-place-form" class="rpgcampaign__form" hidden novalidate>
            <fieldset>
              <legend>Place</legend>
              <label>Name <input name="name" autocomplete="off" required><small data-field-error="name"></small></label>
              <label>Category <input name="category" autocomplete="off" placeholder="room, city, estate"></label>
              <label>Parent place <select name="parentPlaceId" id="rpgcampaign-place-parent"></select><button type="button" class="rpgcampaign__button rpgcampaign__inline-create" data-rpg-quick-target="parentPlaceId">+ Create parent here</button></label>
              <label>In narration <select name="contextPolicy"><option value="automatic">Automatic</option><option value="pinned">Pinned</option><option value="excluded">Excluded</option></select></label>
              <label class="rpgcampaign__wide">Summary <textarea name="summary" rows="3"></textarea></label>
              <label class="rpgcampaign__wide">Atmosphere <textarea name="atmosphere" rows="3"></textarea></label>
              <label class="rpgcampaign__wide">Details <textarea name="details" rows="5" placeholder="Long private notes; not injected by default"></textarea></label>
              <label class="rpgcampaign__wide">Tags <input name="tags" autocomplete="off"></label>
            </fieldset>
            <fieldset>
              <legend>Known connections</legend>
              <div class="rpgcampaign__wide rpgcampaign__repeater-heading"><p>Ordered durable routes between Places. Scene exits remain separate live state.</p><button type="button" class="rpgcampaign__button" data-rpg-action="add-place-connection">+ Add connection</button></div>
              <div id="rpgcampaign-place-connection-list" class="rpgcampaign__wide rpgcampaign__repeater-list"></div>
            </fieldset>
          </form>
          <form id="rpgcampaign-world-object-form" class="rpgcampaign__form" hidden novalidate>
            <fieldset>
              <legend>World object</legend>
              <label>Name <input name="name" autocomplete="off" required><small data-field-error="name"></small></label>
              <label>Category <input name="category" autocomplete="off" placeholder="furniture, landmark, mechanism"></label>
              <label>Home place <select name="homePlaceId" id="rpgcampaign-world-object-home"></select><button type="button" class="rpgcampaign__button rpgcampaign__inline-create" data-rpg-quick-target="homePlaceId">+ Create place here</button></label>
              <label>In narration <select name="contextPolicy"><option value="automatic">Automatic</option><option value="pinned">Pinned</option><option value="excluded">Excluded</option></select></label>
              <label class="rpgcampaign__wide">Current state <textarea name="state" rows="3" placeholder="Locked, damaged, dormant..."></textarea></label>
              <label class="rpgcampaign__wide">Summary <textarea name="summary" rows="3"></textarea></label>
              <label class="rpgcampaign__wide">Details <textarea name="details" rows="5" placeholder="Long private notes; not injected by default"></textarea></label>
              <label class="rpgcampaign__wide">Tags <input name="tags" autocomplete="off"></label>
            </fieldset>
          </form>
          <form id="rpgcampaign-scene-form" class="rpgcampaign__form" hidden novalidate>
            <fieldset>
              <legend>Live scene</legend>
              <label>Title <input name="title" autocomplete="off" required><small data-field-error="title"></small></label>
              <label>Place <select name="placeId" id="rpgcampaign-scene-place"></select><button type="button" class="rpgcampaign__button rpgcampaign__inline-create" data-rpg-quick-target="scenePlace">+ Create place here</button></label>
              <label class="rpgcampaign__wide">Summary <textarea name="summary" rows="3" placeholder="What is happening right now?"></textarea></label>
              <label class="rpgcampaign__wide">Transition notes <textarea name="transitionNotes" rows="3" placeholder="How the party entered this scene, or what should shape the next transition"></textarea></label>
            </fieldset>
            <fieldset>
              <legend>Presences</legend>
              <div class="rpgcampaign__wide rpgcampaign__repeater-heading"><p>Actors, possessions, Items, and World Objects currently in the scene.</p><button type="button" class="rpgcampaign__button" data-rpg-action="add-scene-presence">+ Add presence</button></div>
              <div id="rpgcampaign-scene-presence-list" class="rpgcampaign__wide rpgcampaign__repeater-list"></div>
            </fieldset>
            <fieldset>
              <legend>Exits</legend>
              <div class="rpgcampaign__wide rpgcampaign__repeater-heading"><p>Live routes and their current availability.</p><button type="button" class="rpgcampaign__button" data-rpg-action="add-scene-exit">+ Add exit</button></div>
              <div id="rpgcampaign-scene-exit-list" class="rpgcampaign__wide rpgcampaign__repeater-list"></div>
            </fieldset>
            <fieldset>
              <legend>Pressure</legend>
              <div class="rpgcampaign__wide rpgcampaign__repeater-heading"><p>Obstacles and clocks that matter in this scene.</p><span><button type="button" class="rpgcampaign__button" data-rpg-action="add-scene-obstacle">+ Obstacle</button> <button type="button" class="rpgcampaign__button" data-rpg-action="add-scene-countdown">+ Countdown</button></span></div>
              <div id="rpgcampaign-scene-obstacle-list" class="rpgcampaign__wide rpgcampaign__repeater-list"></div>
              <div id="rpgcampaign-scene-countdown-list" class="rpgcampaign__wide rpgcampaign__repeater-list"></div>
            </fieldset>
            <fieldset>
              <legend>Open threads</legend>
              <div class="rpgcampaign__wide rpgcampaign__repeater-heading"><p>Questions and leads that may be carried into the next scene.</p><button type="button" class="rpgcampaign__button" data-rpg-action="add-scene-thread">+ Add thread</button></div>
              <div id="rpgcampaign-scene-thread-list" class="rpgcampaign__wide rpgcampaign__repeater-list"></div>
            </fieldset>
          </form>
          <section id="rpgcampaign-scene-advance" class="rpgcampaign__scene-advance" hidden>
            <div class="rpgcampaign__subheading"><div><span>GUARDED LIFECYCLE</span><strong>Close this scene and open the next</strong></div></div>
            <p class="rpgcampaign__hint">The current scene will become a read-only archive. This is one atomic, undoable Campaign change.</p>
            <form id="rpgcampaign-scene-advance-form" class="rpgcampaign__relationship-form" novalidate>
              <div class="rpgcampaign__relationship-fields">
                <label>Next scene title <input name="title" autocomplete="off" required></label>
                <label>Next place <select name="placeId" id="rpgcampaign-next-scene-place"></select></label>
                <label class="rpgcampaign__wide">Next scene summary <textarea name="summary" rows="3"></textarea></label>
                <label class="rpgcampaign__wide">Transition notes <textarea name="transitionNotes" rows="3"></textarea></label>
              </div>
              <fieldset class="rpgcampaign__advance-threads"><legend>Carry unresolved threads</legend><div id="rpgcampaign-carry-thread-list"></div></fieldset>
              <div class="rpgcampaign__relationship-actions"><button type="button" class="rpgcampaign__button" data-rpg-action="cancel-advance-scene">Cancel</button><button type="button" class="rpgcampaign__primary" data-rpg-action="confirm-advance-scene">Archive current and advance</button></div>
            </form>
          </section>
          <section id="rpgcampaign-quick-record" class="rpgcampaign__quick-record" hidden>
            <div class="rpgcampaign__subheading"><div><span>CREATE WITHOUT LEAVING</span><strong id="rpgcampaign-quick-record-title">New linked record</strong></div></div>
            <p id="rpgcampaign-quick-record-help" class="rpgcampaign__hint"></p>
            <form id="rpgcampaign-quick-record-form" class="rpgcampaign__relationship-form" novalidate>
              <div class="rpgcampaign__relationship-fields">
                <label id="rpgcampaign-quick-record-kind-wrap">Type <select name="kind"><option value="actor">NPC</option><option value="item">Inventory item</option><option value="ability">Ability</option><option value="quest">Objective</option><option value="place">Place</option><option value="world_object">World Object</option></select></label>
                <label>Name <input name="name" autocomplete="off" required></label>
                <label>Category <input name="category" autocomplete="off"></label>
                <label class="rpgcampaign__wide">Summary <textarea name="summary" rows="3"></textarea></label>
              </div>
              <div class="rpgcampaign__relationship-actions"><button type="button" class="rpgcampaign__button" data-rpg-action="cancel-quick-record">Cancel</button><button type="button" class="rpgcampaign__primary" data-rpg-action="save-quick-record">Create and select</button></div>
            </form>
          </section>
          <section id="rpgcampaign-relationships" class="rpgcampaign__relationships" hidden>
            <div class="rpgcampaign__subheading">
              <div><span>DIRECTED CONNECTIONS</span><strong>Relationships</strong></div>
              <button type="button" class="rpgcampaign__button" data-rpg-action="new-relationship">+ Add relationship</button>
            </div>
            <p id="rpgcampaign-relationship-help" class="rpgcampaign__hint"></p>
            <div id="rpgcampaign-relationship-list" class="rpgcampaign__relationship-list"></div>
            <form id="rpgcampaign-relationship-form" class="rpgcampaign__relationship-form" hidden novalidate>
              <div class="rpgcampaign__relationship-direction">
                <label>From <select name="sourceActorId"></select><small data-relationship-field-error="sourceActorId"></small></label>
                <span aria-hidden="true">→</span>
                <label>To <select name="targetActorId"></select><small data-relationship-field-error="targetActorId"></small></label>
              </div>
              <div class="rpgcampaign__relationship-fields">
                <label>Kind <input name="relationshipKind" autocomplete="off" placeholder="ally, employer, rival" required><small data-relationship-field-error="relationshipKind"></small></label>
                <label>Status
                  <select name="status"><option value="active">Active</option><option value="strained">Strained</option><option value="dormant">Dormant</option><option value="ended">Ended</option><option value="other">Other</option></select>
                </label>
                <label class="rpgcampaign__wide">Notes from the source Actor's perspective <textarea name="notes" rows="3"></textarea></label>
              </div>
              <details>
                <summary>Relationship dimensions (−5 to +5)</summary>
                <div class="rpgcampaign__relationship-dimensions">
                  <label>Affinity <input name="affinity" type="number" min="-5" max="5" step="1"></label>
                  <label>Trust <input name="trust" type="number" min="-5" max="5" step="1"></label>
                  <label>Respect <input name="respect" type="number" min="-5" max="5" step="1"></label>
                  <label>Fear <input name="fear" type="number" min="-5" max="5" step="1"></label>
                  <label>Tension <input name="tension" type="number" min="-5" max="5" step="1"></label>
                  <label>Debt <input name="debt" type="number" min="-5" max="5" step="1"></label>
                </div>
              </details>
              <div class="rpgcampaign__relationship-actions">
                <button type="button" class="rpgcampaign__button" data-rpg-action="cancel-relationship">Cancel</button>
                <button type="button" class="rpgcampaign__primary" data-rpg-action="save-relationship">Save relationship</button>
              </div>
            </form>
            <details id="rpgcampaign-archived-relationships" class="rpgcampaign__archived-relationships">
              <summary>Archived relationships</summary>
              <div id="rpgcampaign-archived-relationship-list" class="rpgcampaign__relationship-list"></div>
            </details>
          </section>
          <div id="rpgcampaign-editor-actions" class="rpgcampaign__editor-actions" hidden>
            <button id="rpgcampaign-archive" type="button" class="rpgcampaign__danger-secondary" data-rpg-action="archive">Archive</button>
            <button id="rpgcampaign-delete" type="button" class="rpgcampaign__danger-secondary" data-rpg-action="delete-permanently" hidden>Delete permanently</button>
            <button id="rpgcampaign-advance" type="button" class="rpgcampaign__button" data-rpg-action="begin-advance-scene" hidden>Advance scene</button>
            <span></span>
            <button type="button" class="rpgcampaign__button" data-rpg-action="cancel-edit">Cancel</button>
            <button type="button" class="rpgcampaign__primary" data-rpg-action="save">Save</button>
          </div>
        </main>

        <aside class="rpgcampaign__panel rpgcampaign__chat" data-rpg-panel="chat">
          <div class="rpgcampaign__panel-heading"><strong>Chat peek</strong><button type="button" class="rpgcampaign__icon" data-rpg-hide="chat" aria-label="Hide Chat Peek" title="Hide Chat Peek">×</button></div>
          <p class="rpgcampaign__hint">Read-only. SillyTavern remains the chat composer.</p>
          <div id="rpgcampaign-chat-preview" class="rpgcampaign__chat-preview"></div>
        </aside>
      </div>
    </section>
    <button id="rpgcampaign-launcher" type="button" aria-controls="${ROOT_ID}" aria-expanded="false" title="Open RPG Campaign"><span>R</span><span>Campaign</span></button>
  `;
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function root() {
  return document.querySelector(`#${ROOT_ID}`);
}

function setBusy(busy) {
  state.mutating = busy;
  root()?.classList.toggle('is-busy', busy);
  for (const control of root()?.querySelectorAll('button, input, textarea, select') ?? []) {
    if (control.dataset.rpgAction === 'close') continue;
    control.disabled = busy;
  }
}

function setMessage({ notice = '', error = '', fields = {} } = {}) {
  state.notice = notice;
  state.error = error;
  state.fieldErrors = fields;
  renderMessages();
}

function renderMessages() {
  const currentRoot = root();
  if (!currentRoot) return;
  const notice = currentRoot.querySelector('#rpgcampaign-status');
  const error = currentRoot.querySelector('#rpgcampaign-error');
  notice.hidden = !state.notice && !state.undo;
  error.hidden = !state.error;
  notice.replaceChildren();
  if (state.notice) notice.appendChild(createElement('span', '', state.notice));
  if (state.undo) {
    const undo = createElement('button', 'rpgcampaign__undo', 'Undo');
    undo.type = 'button';
    undo.dataset.rpgAction = 'undo';
    notice.appendChild(undo);
  }
  error.textContent = state.error;
  for (const element of currentRoot.querySelectorAll('[data-field-error]')) {
    const field = element.dataset.fieldError;
    element.textContent = state.fieldErrors[field]
      ?? state.fieldErrors[`item.${field}`]
      ?? state.fieldErrors[`possession.${field}`]
      ?? state.fieldErrors[`ability.${field}`]
      ?? state.fieldErrors[`learnedAbility.${field}`]
      ?? state.fieldErrors[`actor.${field}`]
      ?? state.fieldErrors[`quest.${field}`]
      ?? state.fieldErrors[`fact.${field}`]
      ?? state.fieldErrors[`place.${field}`]
      ?? state.fieldErrors[`worldObject.${field}`]
      ?? state.fieldErrors[`scene.${field}`]
      ?? state.fieldErrors[`nextScene.${field}`]
      ?? '';
  }
  for (const element of currentRoot.querySelectorAll('[data-relationship-field-error]')) {
    const field = element.dataset.relationshipFieldError;
    element.textContent = state.fieldErrors[field] ?? state.fieldErrors[`relationship.${field}`] ?? '';
  }
}

function refreshViews() {
  if (!state.status) return;
  state.characterEntry = session.query({ collection: 'character' }).actor;
  state.entries = session.query({ collection: 'inventory' }).entries;
  state.archivedEntries = session.query({ collection: 'inventory', archived: true }).entries;
  state.abilityEntries = session.query({ collection: 'abilities' }).entries;
  state.archivedAbilityEntries = session.query({ collection: 'abilities', archived: true }).entries;
  state.peopleEntries = session.query({ collection: 'people' }).entries;
  state.archivedPeopleEntries = session.query({ collection: 'people', archived: true }).entries;
  state.questEntries = session.query({ collection: 'objectives' }).entries;
  state.archivedQuestEntries = session.query({ collection: 'objectives', archived: true }).entries;
  state.factEntries = session.query({ collection: 'facts' }).entries;
  state.archivedFactEntries = session.query({ collection: 'facts', archived: true }).entries;
  state.placeEntries = session.query({ collection: 'places' }).entries;
  state.archivedPlaceEntries = session.query({ collection: 'places', archived: true }).entries;
  state.worldObjectEntries = session.query({ collection: 'world_objects' }).entries;
  state.archivedWorldObjectEntries = session.query({ collection: 'world_objects', archived: true }).entries;
  state.currentSceneEntry = session.query({ collection: 'current_scene' }).scene;
  state.sceneArchives = session.query({ collection: 'scene_archives' }).entries;
  state.referenceOptions = session.query({ collection: 'reference_options' }).entries;
  state.relationshipEntries = session.query({ collection: 'relationships' }).entries;
  state.archivedRelationshipEntries = session.query({ collection: 'relationships', archived: true }).entries;
  state.actorOptions = session.query({ collection: 'actors' }).entries;
}

function collectionMeta(collection = state.activeCollection) {
  if (collection === 'character') {
    return {
      id: 'character',
      title: 'Character',
      singular: 'character',
      editorKind: 'CHARACTER EDITOR',
      emptyTitle: 'Edit the Player Character',
      emptyCopy: 'The Player Character is edited here, including current conditions and meters.',
      addLabel: '',
      addFirstLabel: '',
      canCreate: false,
    };
  }
  if (collection === 'abilities') {
    return {
      id: 'abilities',
      title: 'Abilities',
      singular: 'ability',
      editorKind: 'ABILITY EDITOR',
      emptyTitle: 'Select or add an ability',
      emptyCopy: 'Abilities are edited here. Create the Ability and learn it without leaving this collection.',
      addLabel: '+ Add ability',
      addFirstLabel: '+ Add first ability',
    };
  }
  if (collection === 'people') {
    return {
      id: 'people',
      title: 'People',
      singular: 'NPC',
      editorKind: 'PEOPLE EDITOR',
      emptyTitle: 'Select or add an NPC',
      emptyCopy: 'NPCs and their directed Relationships are edited together here.',
      addLabel: '+ Add NPC',
      addFirstLabel: '+ Add first NPC',
    };
  }
  if (collection === 'objectives') {
    return {
      id: 'objectives',
      title: 'Objectives',
      singular: 'objective',
      editorKind: 'OBJECTIVE EDITOR',
      emptyTitle: 'Select or add an objective',
      emptyCopy: 'Objectives and their ordered steps are edited together here.',
      addLabel: '+ Add objective',
      addFirstLabel: '+ Add first objective',
      canCreate: true,
    };
  }
  if (collection === 'world') {
    const kinds = {
      fact: { title: 'World · Facts', singular: 'fact', add: '+ Add fact' },
      place: { title: 'World · Places', singular: 'place', add: '+ Add place' },
      world_object: { title: 'World · Objects', singular: 'world object', add: '+ Add object' },
    };
    const selected = kinds[state.worldKind] ?? kinds.fact;
    return {
      id: 'world',
      title: selected.title,
      singular: selected.singular,
      editorKind: `${selected.singular.toUpperCase()} EDITOR`,
      emptyTitle: `Select or add a ${selected.singular}`,
      emptyCopy: `${selected.title} are edited here with structured references to existing Campaign records.`,
      addLabel: selected.add,
      addFirstLabel: selected.add.replace('+ Add ', '+ Add first '),
      canCreate: true,
    };
  }
  if (collection === 'current_scene') {
    return {
      id: 'current_scene',
      title: 'Current Scene',
      singular: 'scene',
      editorKind: 'CURRENT SCENE EDITOR',
      emptyTitle: state.currentSceneEntry ? 'Edit the current scene' : 'Open the first scene',
      emptyCopy: 'Live scene state is editable here. Advancing snapshots it into immutable history and opens the next scene atomically.',
      addLabel: state.currentSceneEntry ? '' : '+ Open scene',
      addFirstLabel: state.currentSceneEntry ? '' : '+ Open first scene',
      canCreate: !state.currentSceneEntry,
    };
  }
  return {
    id: 'inventory',
    title: 'Inventory',
    singular: 'item',
    editorKind: 'INVENTORY EDITOR',
    emptyTitle: 'Select or add an item',
    emptyCopy: 'Inventory is edited here. Create the Item and add it to the Player Character without leaving this collection.',
    addLabel: '+ Add item',
    addFirstLabel: '+ Add first item',
    canCreate: true,
  };
}

function renderLayout() {
  const currentRoot = root();
  if (!currentRoot) return;
  currentRoot.dataset.mobilePane = state.mobilePane;
  for (const panelName of ['collections', 'inventory', 'chat']) {
    const panel = currentRoot.querySelector(`[data-rpg-panel="${panelName}"]`);
    if (panel) panel.hidden = !state.layout[panelName];
  }
  for (const button of currentRoot.querySelectorAll('[data-rpg-mobile]')) {
    button.classList.toggle('is-active', button.dataset.rpgMobile === state.mobilePane);
  }
  const controls = currentRoot.querySelector('#rpgcampaign-panel-controls');
  controls.replaceChildren();
  for (const [name, label] of Object.entries({ collections: 'Collections', inventory: 'Records', chat: 'Chat peek' })) {
    const button = createElement('button', 'rpgcampaign__panel-toggle', label);
    button.type = 'button';
    button.dataset.rpgToggle = name;
    button.setAttribute('aria-pressed', String(Boolean(state.layout[name])));
    button.title = state.layout[name] ? `Hide ${label}` : `Show ${label}`;
    controls.appendChild(button);
  }
}

function matchesActiveSearch(entry) {
  if (!state.search) return true;
  const values = state.activeCollection === 'character'
    ? [entry.actor.name, entry.actor.aliases, entry.actor.pronouns, entry.actor.summary, entry.actor.tags, entry.actor.personality, entry.actor.goals, entry.actor.conditions]
    : state.activeCollection === 'current_scene'
      ? [entry.title, entry.summary, entry.place?.name, entry.transitionNotes, entry.exits?.map(exit => exit.label), entry.obstacles?.map(obstacle => obstacle.label), entry.openThreads?.map(thread => thread.label)]
    : state.activeCollection === 'objectives'
      ? [entry.name, entry.summary, entry.details, entry.category, entry.tags, entry.status, entry.stakes, entry.outcome, (entry.steps ?? []).map(step => [step.label, step.status, step.notes])]
      : state.activeCollection === 'world'
        ? state.worldKind === 'fact'
          ? [entry.fact.name, entry.fact.proposition, entry.fact.summary, entry.fact.category, entry.fact.tags, entry.fact.scope, entry.fact.importance, entry.subject?.name]
          : state.worldKind === 'place'
            ? [entry.place.name, entry.place.summary, entry.place.details, entry.place.category, entry.place.tags, entry.place.atmosphere, entry.parent?.name]
            : [entry.worldObject.name, entry.worldObject.summary, entry.worldObject.details, entry.worldObject.category, entry.worldObject.tags, entry.worldObject.state, entry.homePlace?.name]
      : state.activeCollection === 'abilities'
    ? [entry.ability.name, entry.ability.summary, entry.ability.category, entry.ability.tags, entry.ability.usage, entry.learnedAbility.accessState, entry.learnedAbility.notes]
    : state.activeCollection === 'people'
      ? [entry.actor.name, entry.actor.aliases, entry.actor.pronouns, entry.actor.summary, entry.actor.category, entry.actor.tags, entry.actor.personality, entry.actor.goals]
      : [entry.item.name, entry.item.summary, entry.item.category, entry.item.tags, entry.possession.condition, entry.possession.notes];
  return values.flat().join(' ').toLowerCase().includes(state.search.toLowerCase());
}

function activeEntries() {
  if (state.activeCollection === 'character') return state.characterEntry ? [{ actor: state.characterEntry }] : [];
  if (state.activeCollection === 'current_scene') return state.currentSceneEntry ? [state.currentSceneEntry] : [];
  if (state.activeCollection === 'objectives') {
    return state.showArchived ? state.archivedQuestEntries : state.questEntries;
  }
  if (state.activeCollection === 'world') {
    if (state.worldKind === 'place') return state.showArchived ? state.archivedPlaceEntries : state.placeEntries;
    if (state.worldKind === 'world_object') return state.showArchived ? state.archivedWorldObjectEntries : state.worldObjectEntries;
    return state.showArchived ? state.archivedFactEntries : state.factEntries;
  }
  if (state.activeCollection === 'abilities') {
    return state.showArchived ? state.archivedAbilityEntries : state.abilityEntries;
  }
  if (state.activeCollection === 'people') {
    return state.showArchived ? state.archivedPeopleEntries : state.peopleEntries;
  }
  return state.showArchived ? state.archivedEntries : state.entries;
}

function appendNarratorFocusAction(actions, record, name = record?.name) {
  if (state.showArchived || !record?.id) return;
  const queued = state.manualFocusIds.includes(record.id);
  const button = createElement('button', 'rpgcampaign__focus', '◎');
  button.type = 'button';
  button.dataset.rpgFocus = record.id;
  button.classList.toggle('is-queued', queued);
  button.setAttribute('aria-pressed', String(queued));
  button.setAttribute('aria-label', queued ? `Remove ${name} from next narrator reply` : `Use ${name} in next narrator reply`);
  button.title = record.contextPolicy === 'excluded'
    ? `${name} is excluded from narrator context`
    : queued ? `Queued for the next narrator reply: ${name}` : `Use in next narrator reply: ${name}`;
  button.disabled = record.contextPolicy === 'excluded';
  actions.appendChild(button);
}

function appendAbilityActions(actions, entry, name) {
  const recordId = entry.learnedAbility.id;
  appendNarratorFocusAction(actions, entry.ability, name);
  if (state.showArchived) {
    const restore = createElement('button', 'rpgcampaign__compact-button', 'Restore');
    restore.type = 'button';
    restore.dataset.rpgAbilityRestore = recordId;
    actions.appendChild(restore);
    return;
  }
  if (entry.learnedAbility.currentUses !== null || entry.learnedAbility.maxUses !== null) {
    const currentUses = entry.learnedAbility.currentUses ?? 0;
    const minus = createElement('button', 'rpgcampaign__quantity-button', '-');
    minus.type = 'button';
    minus.dataset.rpgAbilityUses = recordId;
    minus.dataset.delta = '-1';
    minus.setAttribute('aria-label', `Decrease ${name} remaining uses`);
    const quantity = createElement('span', 'rpgcampaign__quantity', entry.learnedAbility.maxUses === null
      ? String(currentUses)
      : `${currentUses}/${entry.learnedAbility.maxUses}`);
    quantity.title = 'Remaining uses';
    const plus = createElement('button', 'rpgcampaign__quantity-button', '+');
    plus.type = 'button';
    plus.dataset.rpgAbilityUses = recordId;
    plus.dataset.delta = '1';
    plus.setAttribute('aria-label', `Increase ${name} remaining uses`);
    actions.append(minus, quantity, plus);
  }
  const pencil = createElement('button', 'rpgcampaign__pencil', '✎');
  pencil.type = 'button';
  pencil.dataset.rpgAbilityEdit = recordId;
  pencil.setAttribute('aria-label', `Edit ${name}`);
  pencil.title = `Edit ${name}`;
  actions.appendChild(pencil);
}

function appendInventoryActions(actions, entry, name) {
  const recordId = entry.possession.id;
  appendNarratorFocusAction(actions, entry.item, name);
  if (state.showArchived) {
    const restore = createElement('button', 'rpgcampaign__compact-button', 'Restore');
    restore.type = 'button';
    restore.dataset.rpgRestore = recordId;
    actions.appendChild(restore);
    return;
  }
  const minus = createElement('button', 'rpgcampaign__quantity-button', '-');
  minus.type = 'button';
  minus.dataset.rpgQuantity = recordId;
  minus.dataset.delta = '-1';
  minus.setAttribute('aria-label', `Decrease ${name} quantity`);
  const quantity = createElement('span', 'rpgcampaign__quantity', String(entry.possession.quantity));
  quantity.title = 'Quantity';
  const plus = createElement('button', 'rpgcampaign__quantity-button', '+');
  plus.type = 'button';
  plus.dataset.rpgQuantity = recordId;
  plus.dataset.delta = '1';
  plus.setAttribute('aria-label', `Increase ${name} quantity`);
  const pencil = createElement('button', 'rpgcampaign__pencil', '✎');
  pencil.type = 'button';
  pencil.dataset.rpgEdit = recordId;
  pencil.setAttribute('aria-label', `Edit ${name}`);
  pencil.title = `Edit ${name}`;
  actions.append(minus, quantity, plus, pencil);
}

function appendPersonActions(actions, entry, name) {
  appendNarratorFocusAction(actions, entry.actor, name);
  if (state.showArchived) {
    const restore = createElement('button', 'rpgcampaign__compact-button', 'Restore');
    restore.type = 'button';
    restore.dataset.rpgPersonRestore = entry.actor.id;
    actions.appendChild(restore);
    return;
  }
  const pencil = createElement('button', 'rpgcampaign__pencil', '✎');
  pencil.type = 'button';
  pencil.dataset.rpgPersonEdit = entry.actor.id;
  pencil.setAttribute('aria-label', `Edit ${name}`);
  pencil.title = `Edit ${name}`;
  actions.appendChild(pencil);
}

function appendCharacterActions(actions, entry) {
  const pencil = createElement('button', 'rpgcampaign__pencil', 'âœŽ');
  pencil.type = 'button';
  pencil.dataset.rpgCharacterEdit = entry.actor.id;
  pencil.setAttribute('aria-label', `Edit ${entry.actor.name}`);
  pencil.title = `Edit ${entry.actor.name}`;
  actions.appendChild(pencil);
}

function appendQuestActions(actions, quest) {
  appendNarratorFocusAction(actions, quest, quest.name);
  if (state.showArchived) {
    const restore = createElement('button', 'rpgcampaign__compact-button', 'Restore');
    restore.type = 'button';
    restore.dataset.rpgQuestRestore = quest.id;
    actions.appendChild(restore);
    return;
  }
  const pencil = createElement('button', 'rpgcampaign__pencil', 'âœŽ');
  pencil.type = 'button';
  pencil.dataset.rpgQuestEdit = quest.id;
  pencil.setAttribute('aria-label', `Edit ${quest.name}`);
  pencil.title = `Edit ${quest.name}`;
  actions.appendChild(pencil);
}

function appendWorldActions(actions, record) {
  appendNarratorFocusAction(actions, record, record.name);
  if (state.showArchived) {
    const restore = createElement('button', 'rpgcampaign__compact-button', 'Restore');
    restore.type = 'button';
    restore.dataset.rpgWorldRestore = record.id;
    actions.appendChild(restore);
    return;
  }
  const pencil = createElement('button', 'rpgcampaign__pencil', 'âœŽ');
  pencil.type = 'button';
  pencil.dataset.rpgWorldEdit = record.id;
  pencil.setAttribute('aria-label', `Edit ${record.name}`);
  pencil.title = `Edit ${record.name}`;
  actions.appendChild(pencil);
}

function appendSceneActions(actions, scene) {
  appendNarratorFocusAction(actions, scene.place, scene.place?.name);
  const pencil = createElement('button', 'rpgcampaign__pencil', '✎');
  pencil.type = 'button';
  pencil.dataset.rpgSceneEdit = scene.id;
  pencil.setAttribute('aria-label', `Edit ${scene.title}`);
  pencil.title = `Edit ${scene.title}`;
  actions.appendChild(pencil);
}

function appendSceneArchives(list) {
  if (state.activeCollection !== 'current_scene' || !state.sceneArchives.length) return;
  const details = createElement('details', 'rpgcampaign__scene-archives');
  const summary = createElement('summary', '', `${state.sceneArchives.length} closed scene${state.sceneArchives.length === 1 ? '' : 's'} · read-only`);
  const archiveList = createElement('div', 'rpgcampaign__scene-archive-list');
  for (const archive of state.sceneArchives) {
    const scene = archive.scene ?? archive;
    const row = createElement('article', 'rpgcampaign__scene-archive-row');
    row.append(
      createElement('strong', '', archive.title ?? scene.title ?? 'Closed scene'),
      createElement('span', '', scene.summary || 'No summary'),
      createElement('small', '', archive.closedAt ? `Closed ${new Date(archive.closedAt).toLocaleString()}` : 'Closed scene'),
    );
    archiveList.appendChild(row);
  }
  details.append(summary, archiveList);
  list.appendChild(details);
}

function renderCollection() {
  const currentRoot = root();
  if (!currentRoot) return;
  const meta = collectionMeta();
  currentRoot.querySelector('#rpgcampaign-character-count').textContent = state.characterEntry ? '1' : '0';
  currentRoot.querySelector('#rpgcampaign-inventory-count').textContent = String(state.entries.length);
  currentRoot.querySelector('#rpgcampaign-abilities-count').textContent = String(state.abilityEntries.length);
  currentRoot.querySelector('#rpgcampaign-people-count').textContent = String(state.peopleEntries.length);
  currentRoot.querySelector('#rpgcampaign-objectives-count').textContent = String(state.questEntries.length);
  currentRoot.querySelector('#rpgcampaign-world-count').textContent = String(
    state.factEntries.length + state.placeEntries.length + state.worldObjectEntries.length,
  );
  currentRoot.querySelector('#rpgcampaign-current-scene-count').textContent = state.currentSceneEntry ? '1' : '0';
  currentRoot.querySelector('#rpgcampaign-revision').textContent = state.status ? `Verified revision ${state.status.revision}` : 'Not opened';
  const archivedToggle = currentRoot.querySelector('#rpgcampaign-show-archived');
  archivedToggle.checked = state.showArchived;
  archivedToggle.closest('label').hidden = ['character', 'current_scene'].includes(state.activeCollection);
  const worldKindWrap = currentRoot.querySelector('#rpgcampaign-world-kind-wrap');
  worldKindWrap.hidden = state.activeCollection !== 'world';
  const worldKindSelect = currentRoot.querySelector('#rpgcampaign-world-kind');
  for (const option of worldKindSelect.options) option.toggleAttribute('selected', option.value === state.worldKind);
  currentRoot.querySelector('#rpgcampaign-collection-title').textContent = meta.title;
  currentRoot.querySelector('#rpgcampaign-search').placeholder = `Search ${meta.title}...`;
  const addHere = currentRoot.querySelector('#rpgcampaign-add-here');
  const addRecord = currentRoot.querySelector('#rpgcampaign-add-record');
  addHere.textContent = meta.addLabel ? `${meta.addLabel} here` : '';
  addRecord.textContent = meta.addLabel;
  addHere.hidden = meta.canCreate === false || !meta.addLabel;
  addRecord.hidden = meta.canCreate === false || !meta.addLabel;
  for (const button of currentRoot.querySelectorAll('[data-rpg-collection]')) {
    button.classList.toggle('is-active', button.dataset.rpgCollection === state.activeCollection);
  }
  const list = currentRoot.querySelector('#rpgcampaign-collection-list');
  list.replaceChildren();
  const entries = activeEntries().filter(matchesActiveSearch);
  if (!entries.length) {
    const empty = createElement('div', 'rpgcampaign__inventory-empty');
    empty.appendChild(createElement('p', '', state.showArchived
      ? `No archived ${meta.title} entries.`
      : `${meta.title} is empty. Add a ${meta.singular} here without leaving the collection.`));
    if (!state.showArchived && meta.canCreate !== false) {
      const add = createElement('button', 'rpgcampaign__primary', meta.addLabel);
      add.type = 'button';
      add.dataset.rpgAction = 'new-record';
      empty.appendChild(add);
    }
    list.appendChild(empty);
    appendSceneArchives(list);
    return;
  }

  for (const entry of entries) {
    const isCharacter = state.activeCollection === 'character';
    const isScene = state.activeCollection === 'current_scene';
    const isQuest = state.activeCollection === 'objectives';
    const isWorld = state.activeCollection === 'world';
    const isAbility = state.activeCollection === 'abilities';
    const isPerson = state.activeCollection === 'people';
    const worldRecord = isWorld
      ? state.worldKind === 'fact' ? entry.fact : state.worldKind === 'place' ? entry.place : entry.worldObject
      : null;
    const recordId = isScene
      ? entry.id
      : isCharacter
      ? entry.actor.id
      : isQuest ? entry.id : isWorld ? worldRecord.id : isAbility ? entry.learnedAbility.id : isPerson ? entry.actor.id : entry.possession.id;
    const name = isScene
      ? entry.title
      : isCharacter
      ? entry.actor.name
      : isQuest ? entry.name : isWorld ? worldRecord.name : isAbility ? entry.ability.name : isPerson ? entry.actor.name : entry.item.name;
    const article = createElement('article', 'rpgcampaign__inventory-row');
    article.classList.toggle('is-selected', isScene
      ? recordId === state.selectedSceneId
      : isCharacter
      ? state.draft?.collection === 'character'
      : isQuest
        ? recordId === state.selectedQuestId
        : isWorld
          ? recordId === state.selectedWorldRecordId
        : isAbility
          ? recordId === state.selectedLearnedAbilityId
          : isPerson ? recordId === state.selectedActorId : recordId === state.selectedPossessionId);
    const edit = createElement('button', 'rpgcampaign__row-main');
    edit.type = 'button';
    if (isScene) edit.dataset.rpgSceneEdit = recordId;
    else if (isCharacter) edit.dataset.rpgCharacterEdit = recordId;
    else if (isQuest) edit.dataset.rpgQuestEdit = recordId;
    else if (isWorld) edit.dataset.rpgWorldEdit = recordId;
    else if (isAbility) edit.dataset.rpgAbilityEdit = recordId;
    else if (isPerson) edit.dataset.rpgPersonEdit = recordId;
    else edit.dataset.rpgEdit = recordId;
    edit.append(
      createElement('strong', '', name),
      createElement('span', 'rpgcampaign__row-meta', isScene
        ? `${entry.place?.name ?? 'No place'} - ${entry.presences?.length ?? 0} present - ${entry.openThreads?.filter(thread => ['open', 'carried'].includes(thread.status)).length ?? 0} open threads`
        : isCharacter
        ? `${entry.actor.category || 'player character'}${entry.actor.pronouns ? ` - ${entry.actor.pronouns}` : ''}`
        : isQuest
          ? `${entry.status} - ${(entry.steps ?? []).filter(step => step.status === 'completed').length}/${(entry.steps ?? []).length} steps`
          : isWorld
            ? state.worldKind === 'fact'
              ? `${entry.fact.importance} - ${entry.fact.scope}`
              : state.worldKind === 'place'
                ? `${entry.place.category}${entry.parent ? ` - in ${entry.parent.name}` : ''}`
                : `${entry.worldObject.category}${entry.homePlace ? ` - ${entry.homePlace.name}` : ''}`
          : isAbility
        ? `${entry.ability.category} - ${entry.learnedAbility.accessState}`
        : isPerson
          ? `${entry.actor.category || 'npc'}${entry.actor.pronouns ? ` - ${entry.actor.pronouns}` : ''} - ${entry.relationships.length} relationship${entry.relationships.length === 1 ? '' : 's'}`
          : `${entry.item.category} - ${entry.possession.carriedState}${entry.possession.condition ? ` - ${entry.possession.condition}` : ''}`),
      createElement('span', 'rpgcampaign__row-summary', (isScene
        ? entry.summary
        : isCharacter
        ? entry.actor.summary
        : isQuest
          ? entry.summary
          : isWorld
            ? (state.worldKind === 'fact' ? entry.fact.proposition : worldRecord.summary)
            : isAbility ? entry.ability.summary : isPerson ? entry.actor.summary : entry.item.summary) || 'No summary'),
    );
    const actions = createElement('div', 'rpgcampaign__row-actions');
    if (isScene) appendSceneActions(actions, entry);
    else if (isCharacter) appendCharacterActions(actions, entry);
    else if (isQuest) appendQuestActions(actions, entry);
    else if (isWorld) appendWorldActions(actions, worldRecord);
    else if (isAbility) appendAbilityActions(actions, entry, name);
    else if (isPerson) appendPersonActions(actions, entry, name);
    else appendInventoryActions(actions, entry, name);
    article.append(edit, actions);
    list.appendChild(article);
  }
  appendSceneArchives(list);
}

function populateForm() {
  const currentRoot = root();
  const formSelector = state.draft?.collection === 'character'
    ? '#rpgcampaign-character-form'
    : state.draft?.collection === 'objectives'
      ? '#rpgcampaign-objective-form'
      : state.draft?.collection === 'current_scene'
        ? '#rpgcampaign-scene-form'
      : state.draft?.collection === 'world'
        ? state.draft.worldKind === 'fact'
          ? '#rpgcampaign-fact-form'
          : state.draft.worldKind === 'place'
            ? '#rpgcampaign-place-form'
            : '#rpgcampaign-world-object-form'
      : state.draft?.collection === 'abilities'
        ? '#rpgcampaign-ability-form'
        : state.draft?.collection === 'people'
          ? '#rpgcampaign-person-form'
          : '#rpgcampaign-form';
  const form = currentRoot?.querySelector(formSelector);
  if (!form || !state.draft) return;
  if (['inventory', 'abilities'].includes(state.draft.collection)) {
    const definitionChoice = form.querySelector('[data-rpg-definition-choice]');
    const definitionFields = form.querySelector('[data-rpg-definition-fields]');
    const existingChoice = form.querySelector('[data-rpg-existing-choice]');
    const isCreating = state.draft.mode === 'create';
    const usesExisting = isCreating && state.draft.definitionMode === 'existing';
    definitionChoice.hidden = !isCreating;
    definitionFields.hidden = usesExisting;
    existingChoice.hidden = !usesExisting;
    const kind = state.draft.collection === 'abilities' ? 'ability' : 'item';
    const options = state.referenceOptions
      .filter(record => record.kind === kind && !record.archived)
      .map(record => ({ value: record.id, label: record.name }));
    fillSelect(
      form.querySelector('[name="existingRecordId"]'),
      options,
      state.draft.existingRecordId,
      options.length ? `Choose an existing ${kind}` : `No existing ${kind} definitions`,
    );
  }
  const actorFields = ['name', 'aliases', 'pronouns', 'summary', 'details', 'category', 'tags', 'appearance', 'personality', 'goals', 'voiceNotes', 'conditions'];
  const names = state.draft.collection === 'character'
    ? actorFields
    : state.draft.collection === 'current_scene'
      ? ['title', 'summary', 'placeId', 'transitionNotes']
    : state.draft.collection === 'objectives'
      ? ['name', 'summary', 'details', 'category', 'tags', 'status', 'stakes', 'outcome', 'contextPolicy']
      : state.draft.collection === 'world'
        ? state.draft.worldKind === 'fact'
          ? ['name', 'proposition', 'scope', 'importance', 'subjectKey', 'summary', 'details', 'category', 'tags', 'contextPolicy']
          : state.draft.worldKind === 'place'
            ? ['name', 'summary', 'details', 'category', 'tags', 'atmosphere', 'parentPlaceId', 'contextPolicy']
            : ['name', 'summary', 'details', 'category', 'tags', 'state', 'homePlaceId', 'contextPolicy']
      : state.draft.collection === 'abilities'
    ? ['definitionMode', 'existingRecordId', 'name', 'summary', 'details', 'category', 'tags', 'usage', 'limits', 'defaultResourceLabel', 'contextPolicy', 'accessState', 'currentUses', 'maxUses', 'notes']
    : state.draft.collection === 'people'
      ? [...actorFields, 'contextPolicy']
      : ['definitionMode', 'existingRecordId', 'name', 'summary', 'details', 'category', 'tags', 'quantity', 'carriedState', 'equippedSlots', 'condition', 'notes'];
  populateWorldReferenceSelects();
  populateSceneReferenceSelects();
  for (const name of names) {
    const field = form.querySelector(`[name="${name}"]`);
    if (!field) continue;
    const value = String(state.draft[name] ?? '');
    if (field.tagName === 'SELECT') {
      for (const option of field.options) {
        option.toggleAttribute('selected', option.getAttribute('value') === value);
      }
    } else {
      field.value = value;
    }
  }
  renderStructuredRows();
}

function fillSelect(select, entries, selectedValue, emptyLabel) {
  if (!select) return;
  select.replaceChildren();
  if (emptyLabel) {
    const empty = createElement('option', '', emptyLabel);
    empty.value = '';
    empty.toggleAttribute('selected', !selectedValue);
    select.appendChild(empty);
  }
  for (const entry of entries) {
    const option = createElement('option', '', entry.label);
    option.value = entry.value;
    option.toggleAttribute('selected', entry.value === selectedValue);
    select.appendChild(option);
  }
}

function allPlaceOptions(excludeId = null) {
  return [...state.placeEntries, ...state.archivedPlaceEntries]
    .map(entry => entry.place)
    .filter(place => place.id !== excludeId)
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(place => ({ value: place.id, label: `${place.name}${place.archivedAt ? ' (archived)' : ''}` }));
}

function allSceneSubjectOptions() {
  const labels = { actor: 'Actor', item: 'Item', world_object: 'World Object' };
  const records = state.referenceOptions
    .filter(entry => labels[entry.kind])
    .map(entry => ({
      value: `${entry.kind}:${entry.id}`,
      label: `${labels[entry.kind]} · ${entry.name}${entry.archived ? ' (archived)' : ''}`,
    }));
  const possessions = [...state.entries, ...state.archivedEntries].map(entry => ({
    value: `possession:${entry.possession.id}`,
    label: `Inventory · ${entry.item.name}${entry.possession.archivedAt ? ' (archived)' : ''}`,
  }));
  return [...records, ...possessions].sort((left, right) => left.label.localeCompare(right.label));
}

function populateSceneReferenceSelects() {
  const currentRoot = root();
  if (!currentRoot || state.draft?.collection !== 'current_scene') return;
  fillSelect(currentRoot.querySelector('#rpgcampaign-scene-place'), allPlaceOptions(), state.draft.placeId, 'No known place');
}

function populateWorldReferenceSelects() {
  const currentRoot = root();
  if (!currentRoot || state.draft?.collection !== 'world') return;
  if (state.draft.worldKind === 'fact') {
    const labels = { actor: 'Actor', item: 'Item', ability: 'Ability', quest: 'Objective', place: 'Place', world_object: 'World Object' };
    const entries = state.referenceOptions
      .filter(entry => labels[entry.kind])
      .map(entry => ({
        value: `${entry.kind}:${entry.id}`,
        label: `${labels[entry.kind]} · ${entry.name}${entry.archived ? ' (archived)' : ''}`,
      }));
    fillSelect(currentRoot.querySelector('#rpgcampaign-fact-subject'), entries, state.draft.subjectKey, 'No specific subject');
  }
  if (state.draft.worldKind === 'place') {
    fillSelect(
      currentRoot.querySelector('#rpgcampaign-place-parent'),
      allPlaceOptions(state.draft.recordId),
      state.draft.parentPlaceId,
      'No parent place',
    );
  }
  if (state.draft.worldKind === 'world_object') {
    fillSelect(
      currentRoot.querySelector('#rpgcampaign-world-object-home'),
      allPlaceOptions(),
      state.draft.homePlaceId,
      'No home place',
    );
  }
}

function repeaterField(labelText, control) {
  const label = createElement('label');
  label.append(document.createTextNode(labelText), control);
  return label;
}

function structuredInput({ list, index, field, value = '', type = 'text', min = null }) {
  const input = createElement('input');
  input.type = type;
  input.value = String(value ?? '');
  input.dataset.rpgDraftList = list;
  input.dataset.rpgDraftIndex = String(index);
  input.dataset.rpgDraftField = field;
  if (min !== null) input.min = String(min);
  if (type === 'number') {
    input.step = '1';
    input.inputMode = 'numeric';
  }
  return input;
}

function structuredSelect({ list, index, field, value, options }) {
  const select = createElement('select');
  select.dataset.rpgDraftList = list;
  select.dataset.rpgDraftIndex = String(index);
  select.dataset.rpgDraftField = field;
  for (const [optionValue, label] of options) {
    const option = createElement('option', '', label);
    option.value = optionValue;
    option.toggleAttribute('selected', optionValue === value);
    select.appendChild(option);
  }
  return select;
}

function draftRowActions(listName, row, index, length, extras = []) {
  const actions = createElement('div', 'rpgcampaign__repeater-actions');
  for (const extra of extras) actions.appendChild(extra);
  const up = createElement('button', 'rpgcampaign__pencil', '↑');
  up.type = 'button';
  up.dataset.rpgMoveRow = listName;
  up.dataset.rpgRowKey = row._key;
  up.dataset.delta = '-1';
  up.disabled = index === 0;
  up.setAttribute('aria-label', 'Move entry up');
  const down = createElement('button', 'rpgcampaign__pencil', '↓');
  down.type = 'button';
  down.dataset.rpgMoveRow = listName;
  down.dataset.rpgRowKey = row._key;
  down.dataset.delta = '1';
  down.disabled = index === length - 1;
  down.setAttribute('aria-label', 'Move entry down');
  const remove = createElement('button', 'rpgcampaign__pencil', '×');
  remove.type = 'button';
  remove.dataset.rpgRemoveRow = listName;
  remove.dataset.rpgRowKey = row._key;
  remove.setAttribute('aria-label', 'Remove entry');
  actions.append(up, down, remove);
  return actions;
}

function renderStructuredRows() {
  const currentRoot = root();
  if (!currentRoot || !state.draft) return;
  const meterList = currentRoot.querySelector('#rpgcampaign-meter-list');
  meterList.replaceChildren();
  if (state.draft.collection === 'character') {
    if (!state.draft.meters.length) meterList.appendChild(createElement('p', 'rpgcampaign__hint', 'No meters yet.'));
    state.draft.meters.forEach((meter, index) => {
      const row = createElement('article', 'rpgcampaign__repeater-row');
      const fields = createElement('div', 'rpgcampaign__repeater-fields');
      fields.append(
        repeaterField('Label', structuredInput({ list: 'meters', index, field: 'label', value: meter.label })),
        repeaterField('Current', structuredInput({ list: 'meters', index, field: 'current', value: meter.current, type: 'number', min: 0 })),
        repeaterField('Maximum', structuredInput({ list: 'meters', index, field: 'max', value: meter.max, type: 'number', min: 0 })),
        repeaterField('Notes', structuredInput({ list: 'meters', index, field: 'notes', value: meter.notes })),
      );
      const actions = createElement('div', 'rpgcampaign__repeater-actions');
      const up = createElement('button', 'rpgcampaign__pencil', 'â†‘');
      up.type = 'button';
      up.dataset.rpgMoveMeter = meter._key;
      up.dataset.delta = '-1';
      up.disabled = index === 0;
      up.setAttribute('aria-label', `Move ${meter.label || 'meter'} up`);
      const down = createElement('button', 'rpgcampaign__pencil', 'â†“');
      down.type = 'button';
      down.dataset.rpgMoveMeter = meter._key;
      down.dataset.delta = '1';
      down.disabled = index === state.draft.meters.length - 1;
      down.setAttribute('aria-label', `Move ${meter.label || 'meter'} down`);
      const remove = createElement('button', 'rpgcampaign__pencil', 'Ã—');
      remove.type = 'button';
      remove.dataset.rpgRemoveMeter = meter._key;
      remove.setAttribute('aria-label', `Remove ${meter.label || 'meter'}`);
      actions.append(up, down, remove);
      row.append(fields, actions);
      meterList.appendChild(row);
    });
  }

  const stepList = currentRoot.querySelector('#rpgcampaign-quest-step-list');
  stepList.replaceChildren();
  if (state.draft.collection === 'objectives') {
    if (!state.draft.steps.length) stepList.appendChild(createElement('p', 'rpgcampaign__hint', 'No steps yet. Add the first actionable step here.'));
    state.draft.steps.forEach((step, index) => {
      const row = createElement('article', 'rpgcampaign__repeater-row');
      const fields = createElement('div', 'rpgcampaign__repeater-fields rpgcampaign__quest-step-fields');
      fields.append(
        repeaterField('Step', structuredInput({ list: 'steps', index, field: 'label', value: step.label })),
        repeaterField('Status', structuredSelect({
          list: 'steps', index, field: 'status', value: step.status,
          options: [['pending', 'Pending'], ['active', 'Active'], ['blocked', 'Blocked'], ['completed', 'Completed'], ['skipped', 'Skipped']],
        })),
        repeaterField('Notes', structuredInput({ list: 'steps', index, field: 'notes', value: step.notes })),
      );
      const actions = createElement('div', 'rpgcampaign__repeater-actions');
      const up = createElement('button', 'rpgcampaign__pencil', 'â†‘');
      up.type = 'button';
      up.dataset.rpgMoveQuestStep = step._key;
      up.dataset.delta = '-1';
      up.disabled = index === 0;
      up.setAttribute('aria-label', `Move ${step.label || 'quest step'} up`);
      const down = createElement('button', 'rpgcampaign__pencil', 'â†“');
      down.type = 'button';
      down.dataset.rpgMoveQuestStep = step._key;
      down.dataset.delta = '1';
      down.disabled = index === state.draft.steps.length - 1;
      down.setAttribute('aria-label', `Move ${step.label || 'quest step'} down`);
      const remove = createElement('button', 'rpgcampaign__pencil', 'Ã—');
      remove.type = 'button';
      remove.dataset.rpgRemoveQuestStep = step._key;
      remove.setAttribute('aria-label', `Remove ${step.label || 'quest step'}`);
      actions.append(up, down, remove);
      row.append(fields, actions);
      stepList.appendChild(row);
    });
  }

  const connectionList = currentRoot.querySelector('#rpgcampaign-place-connection-list');
  connectionList.replaceChildren();
  if (state.draft.collection === 'world' && state.draft.worldKind === 'place') {
    if (!state.draft.connections.length) connectionList.appendChild(createElement('p', 'rpgcampaign__hint', 'No known connections yet.'));
    const options = allPlaceOptions(state.draft.recordId).map(entry => [entry.value, entry.label]);
    state.draft.connections.forEach((connection, index) => {
      const row = createElement('article', 'rpgcampaign__repeater-row');
      const fields = createElement('div', 'rpgcampaign__repeater-fields rpgcampaign__place-connection-fields');
      fields.append(
        repeaterField('Destination', structuredSelect({
          list: 'connections', index, field: 'targetPlaceId', value: connection.targetPlaceId, options,
        })),
        repeaterField('Connection kind', structuredInput({ list: 'connections', index, field: 'connectionKind', value: connection.connectionKind })),
        repeaterField('Notes', structuredInput({ list: 'connections', index, field: 'notes', value: connection.notes })),
      );
      const actions = createElement('div', 'rpgcampaign__repeater-actions');
      const up = createElement('button', 'rpgcampaign__pencil', 'â†‘');
      up.type = 'button';
      const createDestination = createElement('button', 'rpgcampaign__pencil', '+');
      createDestination.type = 'button';
      createDestination.dataset.rpgQuickTarget = `connection:${connection._key}`;
      createDestination.setAttribute('aria-label', 'Create and select a destination Place');
      createDestination.title = 'Create destination Place here';
      up.dataset.rpgMovePlaceConnection = connection._key;
      up.dataset.delta = '-1';
      up.disabled = index === 0;
      up.setAttribute('aria-label', 'Move connection up');
      const down = createElement('button', 'rpgcampaign__pencil', 'â†“');
      down.type = 'button';
      down.dataset.rpgMovePlaceConnection = connection._key;
      down.dataset.delta = '1';
      down.disabled = index === state.draft.connections.length - 1;
      down.setAttribute('aria-label', 'Move connection down');
      const remove = createElement('button', 'rpgcampaign__pencil', 'Ã—');
      remove.type = 'button';
      remove.dataset.rpgRemovePlaceConnection = connection._key;
      remove.setAttribute('aria-label', 'Remove connection');
      actions.append(createDestination, up, down, remove);
      row.append(fields, actions);
      connectionList.appendChild(row);
    });
  }

  const sceneLists = {
    presences: currentRoot.querySelector('#rpgcampaign-scene-presence-list'),
    exits: currentRoot.querySelector('#rpgcampaign-scene-exit-list'),
    obstacles: currentRoot.querySelector('#rpgcampaign-scene-obstacle-list'),
    countdowns: currentRoot.querySelector('#rpgcampaign-scene-countdown-list'),
    openThreads: currentRoot.querySelector('#rpgcampaign-scene-thread-list'),
  };
  for (const list of Object.values(sceneLists)) list.replaceChildren();
  if (state.draft.collection === 'current_scene') {
    const presenceOptions = allSceneSubjectOptions().map(entry => [entry.value, entry.label]);
    if (!state.draft.presences.length) sceneLists.presences.appendChild(createElement('p', 'rpgcampaign__hint', 'No presences yet.'));
    state.draft.presences.forEach((presence, index) => {
      const row = createElement('article', 'rpgcampaign__repeater-row');
      const fields = createElement('div', 'rpgcampaign__repeater-fields rpgcampaign__scene-presence-fields');
      fields.append(
        repeaterField('Subject', structuredSelect({ list: 'presences', index, field: 'subjectKey', value: presence.subjectKey, options: presenceOptions })),
        repeaterField('Role', structuredInput({ list: 'presences', index, field: 'role', value: presence.role })),
        repeaterField('State', structuredSelect({
          list: 'presences', index, field: 'state', value: presence.state,
          options: [['present', 'Present'], ['hidden', 'Hidden'], ['departed', 'Departed'], ['destroyed', 'Destroyed'], ['other', 'Other']],
        })),
        repeaterField('Notes', structuredInput({ list: 'presences', index, field: 'notes', value: presence.notes })),
      );
      const createSubject = createElement('button', 'rpgcampaign__pencil', '+');
      createSubject.type = 'button';
      createSubject.dataset.rpgQuickTarget = `scenePresence:${presence._key}`;
      createSubject.setAttribute('aria-label', 'Create and select a scene presence');
      row.append(fields, draftRowActions('presences', presence, index, state.draft.presences.length, [createSubject]));
      sceneLists.presences.appendChild(row);
    });

    const placeOptions = [['', 'Unknown destination'], ...allPlaceOptions().map(entry => [entry.value, entry.label])];
    if (!state.draft.exits.length) sceneLists.exits.appendChild(createElement('p', 'rpgcampaign__hint', 'No exits yet.'));
    state.draft.exits.forEach((exit, index) => {
      const row = createElement('article', 'rpgcampaign__repeater-row');
      const fields = createElement('div', 'rpgcampaign__repeater-fields rpgcampaign__scene-exit-fields');
      fields.append(
        repeaterField('Label', structuredInput({ list: 'exits', index, field: 'label', value: exit.label })),
        repeaterField('Destination', structuredSelect({ list: 'exits', index, field: 'destinationPlaceId', value: exit.destinationPlaceId, options: placeOptions })),
        repeaterField('Status', structuredSelect({ list: 'exits', index, field: 'status', value: exit.status, options: [['open', 'Open'], ['closed', 'Closed'], ['blocked', 'Blocked'], ['unknown', 'Unknown']] })),
        repeaterField('Notes', structuredInput({ list: 'exits', index, field: 'notes', value: exit.notes })),
      );
      const createDestination = createElement('button', 'rpgcampaign__pencil', '+');
      createDestination.type = 'button';
      createDestination.dataset.rpgQuickTarget = `sceneExit:${exit._key}`;
      createDestination.setAttribute('aria-label', 'Create and select an exit destination Place');
      row.append(fields, draftRowActions('exits', exit, index, state.draft.exits.length, [createDestination]));
      sceneLists.exits.appendChild(row);
    });

    if (!state.draft.obstacles.length) sceneLists.obstacles.appendChild(createElement('p', 'rpgcampaign__hint', 'No obstacles yet.'));
    state.draft.obstacles.forEach((obstacle, index) => {
      const row = createElement('article', 'rpgcampaign__repeater-row');
      const fields = createElement('div', 'rpgcampaign__repeater-fields rpgcampaign__scene-small-fields');
      fields.append(
        repeaterField('Obstacle', structuredInput({ list: 'obstacles', index, field: 'label', value: obstacle.label })),
        repeaterField('Status', structuredSelect({ list: 'obstacles', index, field: 'status', value: obstacle.status, options: [['active', 'Active'], ['resolved', 'Resolved'], ['bypassed', 'Bypassed']] })),
        repeaterField('Notes', structuredInput({ list: 'obstacles', index, field: 'notes', value: obstacle.notes })),
      );
      row.append(fields, draftRowActions('obstacles', obstacle, index, state.draft.obstacles.length));
      sceneLists.obstacles.appendChild(row);
    });

    if (!state.draft.countdowns.length) sceneLists.countdowns.appendChild(createElement('p', 'rpgcampaign__hint', 'No countdowns yet.'));
    state.draft.countdowns.forEach((countdown, index) => {
      const row = createElement('article', 'rpgcampaign__repeater-row');
      const fields = createElement('div', 'rpgcampaign__repeater-fields rpgcampaign__scene-countdown-fields');
      fields.append(
        repeaterField('Countdown', structuredInput({ list: 'countdowns', index, field: 'label', value: countdown.label })),
        repeaterField('Current', structuredInput({ list: 'countdowns', index, field: 'current', value: countdown.current, type: 'number', min: 0 })),
        repeaterField('Maximum', structuredInput({ list: 'countdowns', index, field: 'max', value: countdown.max, type: 'number', min: 1 })),
        repeaterField('Notes', structuredInput({ list: 'countdowns', index, field: 'notes', value: countdown.notes })),
      );
      row.append(fields, draftRowActions('countdowns', countdown, index, state.draft.countdowns.length));
      sceneLists.countdowns.appendChild(row);
    });

    if (!state.draft.openThreads.length) sceneLists.openThreads.appendChild(createElement('p', 'rpgcampaign__hint', 'No open threads yet.'));
    state.draft.openThreads.forEach((thread, index) => {
      const row = createElement('article', 'rpgcampaign__repeater-row');
      const fields = createElement('div', 'rpgcampaign__repeater-fields rpgcampaign__scene-small-fields');
      fields.append(
        repeaterField('Thread', structuredInput({ list: 'openThreads', index, field: 'label', value: thread.label })),
        repeaterField('Status', structuredSelect({ list: 'openThreads', index, field: 'status', value: thread.status, options: [['open', 'Open'], ['carried', 'Carried'], ['resolved', 'Resolved']] })),
        repeaterField('Notes', structuredInput({ list: 'openThreads', index, field: 'notes', value: thread.notes })),
      );
      row.append(fields, draftRowActions('openThreads', thread, index, state.draft.openThreads.length));
      sceneLists.openThreads.appendChild(row);
    });
  }
}

function relationshipEntriesForActor(entries, actorId) {
  if (!actorId) return [];
  return entries.filter(entry => entry.relationship.sourceActorId === actorId || entry.relationship.targetActorId === actorId);
}

function appendRelationshipRow(list, entry, archived = false) {
  const row = createElement('article', 'rpgcampaign__relationship-row');
  const copy = createElement('div', 'rpgcampaign__relationship-copy');
  copy.append(
    createElement('strong', '', `${entry.source.name} → ${entry.target.name}`),
    createElement('span', '', `${entry.relationship.relationshipKind} - ${entry.relationship.status}`),
  );
  if (entry.relationship.notes) copy.appendChild(createElement('small', '', entry.relationship.notes));
  const actions = createElement('div', 'rpgcampaign__row-actions');
  if (archived) {
    const restore = createElement('button', 'rpgcampaign__compact-button', 'Restore');
    restore.type = 'button';
    restore.dataset.rpgRelationshipRestore = entry.relationship.id;
    const remove = createElement('button', 'rpgcampaign__pencil', '×');
    remove.type = 'button';
    remove.dataset.rpgRelationshipDelete = entry.relationship.id;
    remove.setAttribute('aria-label', `Permanently delete ${entry.source.name} to ${entry.target.name} Relationship`);
    actions.append(restore, remove);
  } else {
    const edit = createElement('button', 'rpgcampaign__pencil', '✎');
    edit.type = 'button';
    edit.dataset.rpgRelationshipEdit = entry.relationship.id;
    edit.setAttribute('aria-label', `Edit ${entry.source.name} to ${entry.target.name} Relationship`);
    const archive = createElement('button', 'rpgcampaign__pencil', '−');
    archive.type = 'button';
    archive.dataset.rpgRelationshipArchive = entry.relationship.id;
    archive.setAttribute('aria-label', `Archive ${entry.source.name} to ${entry.target.name} Relationship`);
    actions.append(edit, archive);
  }
  row.append(copy, actions);
  list.appendChild(row);
}

function populateRelationshipForm() {
  const currentRoot = root();
  const form = currentRoot?.querySelector('#rpgcampaign-relationship-form');
  const draft = state.draft?.relationshipDraft;
  if (!form || !draft) return;
  for (const selectName of ['sourceActorId', 'targetActorId']) {
    const select = form.querySelector(`[name="${selectName}"]`);
    select.replaceChildren();
    for (const actor of state.actorOptions) {
      const option = createElement('option', '', actor.name);
      option.value = actor.id;
      option.toggleAttribute('selected', actor.id === draft[selectName]);
      select.appendChild(option);
    }
    select.disabled = draft.mode === 'edit';
  }
  for (const name of ['relationshipKind', 'status', 'notes', 'affinity', 'trust', 'respect', 'fear', 'tension', 'debt']) {
    const field = form.querySelector(`[name="${name}"]`);
    if (!field) continue;
    const value = String(draft[name] ?? '');
    if (field.tagName === 'SELECT') {
      for (const option of field.options) option.toggleAttribute('selected', option.getAttribute('value') === value);
    } else {
      field.value = value;
    }
  }
}

function renderRelationships({ populate = true } = {}) {
  const currentRoot = root();
  if (!currentRoot) return;
  const section = currentRoot.querySelector('#rpgcampaign-relationships');
  const isPersonDraft = state.draft?.collection === 'people';
  section.hidden = !isPersonDraft;
  if (!isPersonDraft) return;
  const actorId = state.draft.actorId;
  const help = currentRoot.querySelector('#rpgcampaign-relationship-help');
  const add = currentRoot.querySelector('[data-rpg-action="new-relationship"]');
  add.hidden = state.draft.mode !== 'edit' || state.draft.archived;
  help.textContent = state.draft.mode === 'create'
    ? 'Save this NPC first, then add directed Relationships here without leaving the editor.'
    : 'Direction matters: what one Actor feels does not automatically apply in reverse.';

  const list = currentRoot.querySelector('#rpgcampaign-relationship-list');
  list.replaceChildren();
  const active = relationshipEntriesForActor(state.relationshipEntries, actorId);
  if (!active.length) list.appendChild(createElement('p', 'rpgcampaign__hint', state.draft.mode === 'create' ? '' : 'No active Relationships yet.'));
  for (const entry of active) appendRelationshipRow(list, entry);

  const archivedList = currentRoot.querySelector('#rpgcampaign-archived-relationship-list');
  archivedList.replaceChildren();
  const archived = relationshipEntriesForActor(state.archivedRelationshipEntries, actorId);
  for (const entry of archived) appendRelationshipRow(archivedList, entry, true);
  currentRoot.querySelector('#rpgcampaign-archived-relationships').hidden = !archived.length;

  const form = currentRoot.querySelector('#rpgcampaign-relationship-form');
  form.hidden = !state.draft.relationshipDraft;
  if (populate && state.draft.relationshipDraft) populateRelationshipForm();
}

function renderQuickRecord({ populate = true } = {}) {
  const currentRoot = root();
  if (!currentRoot) return;
  const section = currentRoot.querySelector('#rpgcampaign-quick-record');
  const quick = ['world', 'current_scene'].includes(state.draft?.collection) ? state.draft.quickRecord : null;
  section.hidden = !quick;
  if (!quick) return;
  const subjectTarget = quick.target === 'factSubject' || quick.target.startsWith('scenePresence:');
  const placeOnly = !subjectTarget;
  currentRoot.querySelector('#rpgcampaign-quick-record-kind-wrap').hidden = placeOnly;
  currentRoot.querySelector('#rpgcampaign-quick-record-title').textContent = placeOnly
    ? 'New linked Place'
    : quick.target === 'factSubject' ? 'New Fact subject' : 'New scene presence';
  const consequences = {
    actor: 'Creates an NPC Actor and selects it as the Fact subject.',
    item: 'Creates an Item, adds one Possession to the Player Character, and selects the Item.',
    ability: 'Creates an Ability, teaches it to the Player Character, and selects the Ability.',
    quest: 'Creates a planned Objective and selects it.',
    place: 'Creates a Place and selects it without leaving this draft.',
    world_object: 'Creates a World Object and selects it as the Fact subject.',
  };
  currentRoot.querySelector('#rpgcampaign-quick-record-help').textContent = consequences[quick.kind];
  if (!populate) return;
  const form = currentRoot.querySelector('#rpgcampaign-quick-record-form');
  const allowedKinds = quick.target.startsWith('scenePresence:')
    ? new Set(['actor', 'item', 'world_object'])
    : null;
  for (const option of form.querySelector('[name="kind"]').options) {
    option.hidden = Boolean(allowedKinds && !allowedKinds.has(option.value));
    option.disabled = Boolean(allowedKinds && !allowedKinds.has(option.value));
  }
  for (const name of ['kind', 'name', 'category', 'summary']) {
    const field = form.querySelector(`[name="${name}"]`);
    const value = String(quick[name] ?? '');
    if (field.tagName === 'SELECT') {
      for (const option of field.options) option.toggleAttribute('selected', option.value === value);
    } else {
      field.value = value;
    }
  }
}

function renderSceneAdvance({ populate = true } = {}) {
  const currentRoot = root();
  if (!currentRoot) return;
  const section = currentRoot.querySelector('#rpgcampaign-scene-advance');
  const advance = state.draft?.collection === 'current_scene' ? state.draft.advanceDraft : null;
  section.hidden = !advance;
  if (!advance) return;
  const form = currentRoot.querySelector('#rpgcampaign-scene-advance-form');
  fillSelect(currentRoot.querySelector('#rpgcampaign-next-scene-place'), allPlaceOptions(), advance.placeId, 'No known place');
  if (populate) {
    for (const name of ['title', 'summary', 'transitionNotes']) {
      form.querySelector(`[name="${name}"]`).value = String(advance[name] ?? '');
    }
  }
  const list = currentRoot.querySelector('#rpgcampaign-carry-thread-list');
  list.replaceChildren();
  const carryable = state.draft.openThreads.filter(thread => ['open', 'carried'].includes(thread.status));
  if (!carryable.length) list.appendChild(createElement('p', 'rpgcampaign__hint', 'No unresolved threads to carry.'));
  for (const thread of carryable) {
    const label = createElement('label', 'rpgcampaign__carry-thread');
    const checkbox = createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = thread.id;
    checkbox.dataset.rpgCarryThread = thread.id;
    checkbox.checked = advance.carryThreadIds.includes(thread.id);
    label.append(checkbox, document.createTextNode(thread.label));
    list.appendChild(label);
  }
}

function renderEditor({ populate = true } = {}) {
  const currentRoot = root();
  if (!currentRoot) return;
  const inventoryForm = currentRoot.querySelector('#rpgcampaign-form');
  const abilityForm = currentRoot.querySelector('#rpgcampaign-ability-form');
  const personForm = currentRoot.querySelector('#rpgcampaign-person-form');
  const characterForm = currentRoot.querySelector('#rpgcampaign-character-form');
  const objectiveForm = currentRoot.querySelector('#rpgcampaign-objective-form');
  const factForm = currentRoot.querySelector('#rpgcampaign-fact-form');
  const placeForm = currentRoot.querySelector('#rpgcampaign-place-form');
  const worldObjectForm = currentRoot.querySelector('#rpgcampaign-world-object-form');
  const sceneForm = currentRoot.querySelector('#rpgcampaign-scene-form');
  const empty = currentRoot.querySelector('#rpgcampaign-empty-editor');
  const actions = currentRoot.querySelector('#rpgcampaign-editor-actions');
  const archive = currentRoot.querySelector('#rpgcampaign-archive');
  const permanentDelete = currentRoot.querySelector('#rpgcampaign-delete');
  const advance = currentRoot.querySelector('#rpgcampaign-advance');
  const meta = collectionMeta(state.draft?.collection ?? state.activeCollection);
  inventoryForm.hidden = !state.draft || state.draft.collection !== 'inventory';
  abilityForm.hidden = !state.draft || state.draft.collection !== 'abilities';
  personForm.hidden = !state.draft || state.draft.collection !== 'people';
  characterForm.hidden = !state.draft || state.draft.collection !== 'character';
  objectiveForm.hidden = !state.draft || state.draft.collection !== 'objectives';
  factForm.hidden = !state.draft || state.draft.collection !== 'world' || state.draft.worldKind !== 'fact';
  placeForm.hidden = !state.draft || state.draft.collection !== 'world' || state.draft.worldKind !== 'place';
  worldObjectForm.hidden = !state.draft || state.draft.collection !== 'world' || state.draft.worldKind !== 'world_object';
  sceneForm.hidden = !state.draft || state.draft.collection !== 'current_scene';
  actions.hidden = !state.draft;
  empty.hidden = Boolean(state.draft);
  currentRoot.querySelector('#rpgcampaign-editor-kind').textContent = meta.editorKind;
  currentRoot.querySelector('#rpgcampaign-empty-editor-copy').textContent = meta.emptyCopy;
  currentRoot.querySelector('#rpgcampaign-empty-editor-add').textContent = meta.addFirstLabel;
  currentRoot.querySelector('#rpgcampaign-editor-title').textContent = state.draft
    ? (state.draft.mode === 'create' ? `Add ${meta.singular}` : state.draft.title || state.draft.name || `Edit ${meta.singular}`)
    : meta.emptyTitle;
  currentRoot.querySelector('#rpgcampaign-dirty').textContent = hasDirtyDraft() ? 'Unsaved draft preserved' : '';
  archive.hidden = !state.draft || state.draft.mode !== 'edit' || ['character', 'current_scene'].includes(state.draft.collection);
  archive.textContent = state.draft?.archived ? 'Restore' : 'Archive';
  archive.classList.toggle('rpgcampaign__danger-secondary', !state.draft?.archived);
  permanentDelete.hidden = !state.draft?.archived || state.draft?.collection === 'current_scene';
  advance.hidden = state.draft?.collection !== 'current_scene' || state.draft.mode !== 'edit' || Boolean(state.draft.advanceDraft);
  if (populate) populateForm();
  renderRelationships({ populate });
  renderQuickRecord({ populate });
  renderSceneAdvance({ populate });
  renderMessages();
}

function renderChatPreview() {
  const preview = root()?.querySelector('#rpgcampaign-chat-preview');
  if (!preview) return;
  preview.replaceChildren();
  const messages = Array.isArray(getContext()?.chat) ? getContext().chat.slice(-6) : [];
  if (!messages.length) {
    preview.appendChild(createElement('p', 'rpgcampaign__hint', 'No messages in this chat.'));
    return;
  }
  for (const message of messages) {
    const article = createElement('article', 'rpgcampaign__message');
    article.append(
      createElement('strong', '', String(message?.name || (message?.is_user ? 'You' : 'Character'))),
      createElement('p', '', String(message?.mes ?? '').slice(0, 500)),
    );
    preview.appendChild(article);
  }
}

function renderAll() {
  const currentRoot = root();
  if (!currentRoot) return;
  currentRoot.querySelector('#rpgcampaign-chat-title').textContent = state.chatTitle;
  renderLayout();
  renderCollection();
  renderEditor();
  renderChatPreview();
}

async function openWorkspace(trigger) {
  const currentRoot = root();
  if (!currentRoot || state.loading) return;
  const identity = chatIdentity();
  if (!identity.chatId) {
    globalThis.toastr?.error?.('Select or create a SillyTavern chat before opening the RPG Campaign.');
    return;
  }
  state.returnFocus = trigger instanceof HTMLElement ? trigger : document.activeElement;
  if (state.chatId && state.chatId !== identity.chatId) {
    state.status = null;
    state.characterEntry = null;
    state.entries = [];
    state.archivedEntries = [];
    state.abilityEntries = [];
    state.archivedAbilityEntries = [];
    state.peopleEntries = [];
    state.archivedPeopleEntries = [];
    state.questEntries = [];
    state.archivedQuestEntries = [];
    state.factEntries = [];
    state.archivedFactEntries = [];
    state.placeEntries = [];
    state.archivedPlaceEntries = [];
    state.worldObjectEntries = [];
    state.archivedWorldObjectEntries = [];
    state.currentSceneEntry = null;
    state.sceneArchives = [];
    state.referenceOptions = [];
    state.relationshipEntries = [];
    state.archivedRelationshipEntries = [];
    state.actorOptions = [];
    state.selectedPossessionId = null;
    state.selectedLearnedAbilityId = null;
    state.selectedActorId = null;
    state.selectedQuestId = null;
    state.selectedWorldRecordId = null;
    state.selectedSceneId = null;
    state.draft = null;
    state.undo = null;
  }
  state.open = true;
  state.loading = true;
  state.chatId = identity.chatId;
  state.chatTitle = identity.title;
  currentRoot.classList.add('is-open');
  currentRoot.setAttribute('aria-hidden', 'false');
  document.querySelector('#rpgcampaign-launcher')?.setAttribute('aria-expanded', 'true');
  setBusy(true);
  setMessage({ notice: 'Opening verified Campaign…' });
  renderAll();
  try {
    state.status = await session.open(identity);
    refreshViews();
    if (!refreshNarratorPrompt()) registerCapsule(state.status.capsule);
    state.draft = savedDraftForChat();
    if (state.draft?.collection === 'character') state.activeCollection = 'character';
    if (state.draft?.collection === 'objectives') state.activeCollection = 'objectives';
    if (state.draft?.collection === 'world') {
      state.activeCollection = 'world';
      state.worldKind = state.draft.worldKind ?? 'fact';
    }
    if (state.draft?.collection === 'current_scene') state.activeCollection = 'current_scene';
    if (state.draft?.collection === 'abilities') state.activeCollection = 'abilities';
    if (state.draft?.collection === 'people') state.activeCollection = 'people';
    state.selectedPossessionId = state.draft?.collection === 'inventory'
      ? state.draft.possessionId
      : state.entries[0]?.possession.id ?? null;
    state.selectedLearnedAbilityId = state.draft?.collection === 'abilities'
      ? state.draft.learnedAbilityId
      : state.abilityEntries[0]?.learnedAbility.id ?? null;
    state.selectedActorId = state.draft?.collection === 'people'
      ? state.draft.actorId
      : state.peopleEntries[0]?.actor.id ?? null;
    state.selectedQuestId = state.draft?.collection === 'objectives'
      ? state.draft.questId
      : state.questEntries[0]?.id ?? null;
    state.selectedWorldRecordId = state.draft?.collection === 'world'
      ? state.draft.recordId
      : null;
    state.selectedSceneId = state.draft?.collection === 'current_scene'
      ? state.draft.sceneId
      : state.currentSceneEntry?.id ?? null;
    setMessage({
      notice: storage.getRecovery(identity)
        ? 'A previous unverified edit is recoverable in this browser. Your preserved form draft remains editable.'
        : `Campaign revision ${state.status.revision} verified.`,
    });
  } catch (error) {
    setMessage({ error: error?.message ?? String(error) });
  } finally {
    state.loading = false;
    setBusy(false);
    renderAll();
    currentRoot.querySelector('[data-rpg-action="close"]')?.focus();
  }
}

function closeWorkspace() {
  if (hasDirtyDraft() && !globalThis.confirm?.('Close Workspace? Your record draft will remain saved in this browser.')) return;
  persistDraft();
  const currentRoot = root();
  state.open = false;
  currentRoot?.classList.remove('is-open');
  currentRoot?.setAttribute('aria-hidden', 'true');
  document.querySelector('#rpgcampaign-launcher')?.setAttribute('aria-expanded', 'false');
  state.returnFocus?.focus?.();
}

function beginCreate() {
  if (hasDirtyDraft() && !globalThis.confirm?.('Replace the current unsaved draft?')) return;
  if (state.activeCollection === 'character') return beginCharacterEdit();
  if (state.activeCollection === 'current_scene' && state.currentSceneEntry) return beginSceneEdit(state.currentSceneEntry.id);
  state.draft = state.activeCollection === 'current_scene'
    ? emptySceneDraft()
    : state.activeCollection === 'world'
    ? emptyWorldDraft()
    : state.activeCollection === 'objectives'
    ? emptyQuestDraft()
    : state.activeCollection === 'abilities'
    ? emptyAbilityDraft()
    : state.activeCollection === 'people' ? emptyPersonDraft() : emptyDraft();
  if (state.activeCollection === 'current_scene') state.selectedSceneId = null;
  else if (state.activeCollection === 'world') state.selectedWorldRecordId = null;
  else if (state.activeCollection === 'objectives') state.selectedQuestId = null;
  else if (state.activeCollection === 'abilities') state.selectedLearnedAbilityId = null;
  else if (state.activeCollection === 'people') state.selectedActorId = null;
  else state.selectedPossessionId = null;
  state.mobilePane = 'editor';
  setMessage();
  renderCollection();
  renderEditor();
  renderLayout();
  root()?.querySelector(state.activeCollection === 'current_scene' ? '[name="title"]' : '[name="name"]')?.focus();
}

function beginCharacterEdit() {
  if (!state.characterEntry) return;
  if (hasDirtyDraft() && state.draft.collection === 'character') return;
  if (hasDirtyDraft()
    && state.draft.collection !== 'character'
    && !globalThis.confirm?.('Replace the current unsaved draft?')) return;
  state.draft = characterDraftFromActor(state.characterEntry);
  state.mobilePane = 'editor';
  setMessage();
  renderCollection();
  renderEditor();
  renderLayout();
}

function beginQuestEdit(questId) {
  if (hasDirtyDraft() && state.draft.questId === questId) return;
  if (hasDirtyDraft()
    && state.draft.questId !== questId
    && !globalThis.confirm?.('Replace the current unsaved draft?')) return;
  const quest = [...state.questEntries, ...state.archivedQuestEntries].find(entry => entry.id === questId);
  if (!quest) return;
  state.draft = questDraftFromEntry(quest);
  state.selectedQuestId = questId;
  state.mobilePane = 'editor';
  setMessage();
  renderCollection();
  renderEditor();
  renderLayout();
}

function beginWorldEdit(recordId) {
  if (hasDirtyDraft() && state.draft.recordId === recordId) return;
  if (hasDirtyDraft()
    && state.draft.recordId !== recordId
    && !globalThis.confirm?.('Replace the current unsaved draft?')) return;
  const groups = {
    fact: [...state.factEntries, ...state.archivedFactEntries],
    place: [...state.placeEntries, ...state.archivedPlaceEntries],
    world_object: [...state.worldObjectEntries, ...state.archivedWorldObjectEntries],
  };
  const entry = groups[state.worldKind].find(candidate => {
    const record = state.worldKind === 'fact' ? candidate.fact : state.worldKind === 'place' ? candidate.place : candidate.worldObject;
    return record.id === recordId;
  });
  if (!entry) return;
  state.draft = worldDraftFromEntry(entry, state.worldKind);
  state.selectedWorldRecordId = recordId;
  state.mobilePane = 'editor';
  setMessage();
  renderCollection();
  renderEditor();
  renderLayout();
}

function beginSceneEdit(sceneId) {
  if (hasDirtyDraft() && state.draft.sceneId === sceneId) return;
  if (hasDirtyDraft()
    && state.draft.sceneId !== sceneId
    && !globalThis.confirm?.('Replace the current unsaved draft?')) return;
  if (!state.currentSceneEntry || state.currentSceneEntry.id !== sceneId) return;
  state.draft = sceneDraftFromEntry(state.currentSceneEntry);
  state.selectedSceneId = sceneId;
  state.mobilePane = 'editor';
  setMessage();
  renderCollection();
  renderEditor();
  renderLayout();
}

function beginEdit(possessionId) {
  if (hasDirtyDraft() && state.draft.possessionId !== possessionId && !globalThis.confirm?.('Replace the current unsaved draft?')) return;
  const entry = [...state.entries, ...state.archivedEntries].find(candidate => candidate.possession.id === possessionId);
  if (!entry) return;
  state.draft = draftFromEntry(entry);
  state.selectedPossessionId = possessionId;
  state.mobilePane = 'editor';
  setMessage();
  renderCollection();
  renderEditor();
  renderLayout();
}

function beginAbilityEdit(learnedAbilityId) {
  if (hasDirtyDraft()
    && state.draft.learnedAbilityId !== learnedAbilityId
    && !globalThis.confirm?.('Replace the current unsaved draft?')) return;
  const entry = [...state.abilityEntries, ...state.archivedAbilityEntries]
    .find(candidate => candidate.learnedAbility.id === learnedAbilityId);
  if (!entry) return;
  state.draft = abilityDraftFromEntry(entry);
  state.selectedLearnedAbilityId = learnedAbilityId;
  state.mobilePane = 'editor';
  setMessage();
  renderCollection();
  renderEditor();
  renderLayout();
}

function beginPersonEdit(actorId) {
  if (hasDirtyDraft()
    && state.draft.actorId !== actorId
    && !globalThis.confirm?.('Replace the current unsaved draft?')) return;
  const entry = [...state.peopleEntries, ...state.archivedPeopleEntries].find(candidate => candidate.actor.id === actorId);
  if (!entry) return;
  state.draft = personDraftFromEntry(entry);
  state.selectedActorId = actorId;
  state.mobilePane = 'editor';
  setMessage();
  renderCollection();
  renderEditor();
  renderLayout();
}

function cancelEdit() {
  if (hasDirtyDraft() && !globalThis.confirm?.('Discard this record draft?')) return;
  state.draft = null;
  persistDraft();
  state.mobilePane = 'inventory';
  setMessage();
  renderEditor();
  renderLayout();
}

function operationFromDraft() {
  if (state.draft.collection === 'character') {
    return {
      type: 'update_actor',
      actorId: state.draft.actorId,
      changes: {
        name: state.draft.name,
        aliases: state.draft.aliases,
        pronouns: state.draft.pronouns,
        summary: state.draft.summary,
        details: state.draft.details,
        category: state.draft.category,
        tags: state.draft.tags,
        appearance: state.draft.appearance,
        personality: state.draft.personality,
        goals: state.draft.goals,
        voiceNotes: state.draft.voiceNotes,
        conditions: state.draft.conditions,
        meters: state.draft.meters.map(meter => ({
          id: meter.id ?? null,
          label: meter.label,
          current: Number(meter.current || 0),
          max: meter.max === '' || meter.max === null ? null : Number(meter.max),
          notes: meter.notes,
        })),
      },
    };
  }
  if (state.draft.collection === 'objectives') {
    const quest = {
      name: state.draft.name,
      summary: state.draft.summary,
      details: state.draft.details,
      category: state.draft.category,
      tags: state.draft.tags,
      status: state.draft.status,
      stakes: state.draft.stakes,
      outcome: state.draft.outcome,
      contextPolicy: state.draft.contextPolicy,
      involvedRefs: state.draft.involvedRefs,
      steps: state.draft.steps.map(step => ({
        id: step.id ?? null,
        label: step.label,
        status: step.status,
        notes: step.notes,
      })),
    };
    return state.draft.mode === 'create'
      ? { type: 'create_quest', quest }
      : { type: 'update_quest', questId: state.draft.questId, quest };
  }
  if (state.draft.collection === 'current_scene') {
    const scene = {
      title: state.draft.title,
      summary: state.draft.summary,
      placeId: state.draft.placeId || null,
      transitionNotes: state.draft.transitionNotes,
      presences: state.draft.presences.map(presence => {
        const separator = presence.subjectKey.indexOf(':');
        return {
          id: presence.id ?? null,
          subjectRef: separator > 0
            ? { kind: presence.subjectKey.slice(0, separator), id: presence.subjectKey.slice(separator + 1) }
            : null,
          role: presence.role,
          state: presence.state,
          notes: presence.notes,
        };
      }),
      exits: state.draft.exits.map(exit => ({
        id: exit.id ?? null,
        label: exit.label,
        destinationPlaceId: exit.destinationPlaceId || null,
        status: exit.status,
        notes: exit.notes,
      })),
      obstacles: state.draft.obstacles.map(obstacle => ({
        id: obstacle.id ?? null,
        label: obstacle.label,
        status: obstacle.status,
        notes: obstacle.notes,
      })),
      countdowns: state.draft.countdowns.map(countdown => ({
        id: countdown.id ?? null,
        label: countdown.label,
        current: Number(countdown.current),
        max: Number(countdown.max),
        notes: countdown.notes,
      })),
      openThreads: state.draft.openThreads.map(thread => ({
        id: thread.id ?? null,
        label: thread.label,
        status: thread.status,
        notes: thread.notes,
        carriedFromThreadId: thread.carriedFromThreadId ?? null,
      })),
    };
    return state.draft.mode === 'create'
      ? { type: 'create_current_scene', scene }
      : { type: 'update_current_scene', sceneId: state.draft.sceneId, scene };
  }
  if (state.draft.collection === 'world') {
    const common = {
      name: state.draft.name,
      summary: state.draft.summary,
      details: state.draft.details,
      category: state.draft.category,
      tags: state.draft.tags,
      contextPolicy: state.draft.contextPolicy,
    };
    if (state.draft.worldKind === 'fact') {
      const separator = state.draft.subjectKey.indexOf(':');
      const subjectRef = separator > 0
        ? { kind: state.draft.subjectKey.slice(0, separator), id: state.draft.subjectKey.slice(separator + 1) }
        : null;
      const fact = {
        ...common,
        proposition: state.draft.proposition,
        scope: state.draft.scope,
        importance: state.draft.importance,
        subjectRef,
      };
      return state.draft.mode === 'create'
        ? { type: 'create_fact', fact }
        : { type: 'update_fact', factId: state.draft.recordId, fact };
    }
    if (state.draft.worldKind === 'place') {
      const place = {
        ...common,
        atmosphere: state.draft.atmosphere,
        parentPlaceId: state.draft.parentPlaceId || null,
        connections: state.draft.connections.map(connection => ({
          id: connection.id ?? null,
          targetPlaceId: connection.targetPlaceId,
          connectionKind: connection.connectionKind,
          notes: connection.notes,
        })),
      };
      return state.draft.mode === 'create'
        ? { type: 'create_place', place }
        : { type: 'update_place', placeId: state.draft.recordId, place };
    }
    const worldObject = { ...common, state: state.draft.state, homePlaceId: state.draft.homePlaceId || null };
    return state.draft.mode === 'create'
      ? { type: 'create_world_object', worldObject }
      : { type: 'update_world_object', worldObjectId: state.draft.recordId, worldObject };
  }
  if (state.draft.collection === 'people') {
    const actor = {
      name: state.draft.name,
      aliases: state.draft.aliases,
      pronouns: state.draft.pronouns,
      summary: state.draft.summary,
      details: state.draft.details,
      category: state.draft.category,
      tags: state.draft.tags,
      appearance: state.draft.appearance,
      personality: state.draft.personality,
      goals: state.draft.goals,
      voiceNotes: state.draft.voiceNotes,
      conditions: state.draft.conditions,
      contextPolicy: state.draft.contextPolicy,
    };
    if (state.draft.mode === 'create') return { type: 'create_actor', actor };
    return { type: 'update_actor', actorId: state.draft.actorId, changes: actor };
  }
  if (state.draft.collection === 'abilities') {
    const ability = {
      name: state.draft.name,
      summary: state.draft.summary,
      details: state.draft.details,
      category: state.draft.category,
      tags: state.draft.tags,
      usage: state.draft.usage,
      limits: state.draft.limits,
      defaultResourceLabel: state.draft.defaultResourceLabel,
      contextPolicy: state.draft.contextPolicy,
    };
    const learnedAbility = {
      actorId: state.status.playerCharacterId,
      accessState: state.draft.accessState,
      currentUses: state.draft.currentUses === '' ? null : Number(state.draft.currentUses),
      maxUses: state.draft.maxUses === '' ? null : Number(state.draft.maxUses),
      notes: state.draft.notes,
    };
    if (state.draft.mode === 'create') {
      if (state.draft.definitionMode === 'existing') {
        return {
          type: 'learn_existing_ability',
          abilityId: state.draft.existingRecordId,
          learnedAbility,
        };
      }
      return { type: 'create_ability_and_learned_ability', ability, learnedAbility };
    }
    return {
      type: 'update_ability_entry',
      abilityId: state.draft.abilityId,
      learnedAbilityId: state.draft.learnedAbilityId,
      abilityChanges: ability,
      learnedAbilityChanges: learnedAbility,
    };
  }
  const item = {
    name: state.draft.name,
    summary: state.draft.summary,
    details: state.draft.details,
    category: state.draft.category,
    tags: state.draft.tags,
  };
  const possession = {
    ownerActorId: state.status.playerCharacterId,
    quantity: Number(state.draft.quantity),
    carriedState: state.draft.carriedState,
    equippedSlots: state.draft.equippedSlots,
    condition: state.draft.condition,
    notes: state.draft.notes,
  };
  if (state.draft.mode === 'create') {
    if (state.draft.definitionMode === 'existing') {
      return { type: 'add_existing_item_to_inventory', itemId: state.draft.existingRecordId, possession };
    }
    return { type: 'create_item_and_possession', item, possession };
  }
  return {
    type: 'update_inventory_entry',
    itemId: state.draft.itemId,
    possessionId: state.draft.possessionId,
    itemChanges: item,
    possessionChanges: possession,
  };
}

async function runOperation(operation, successMessage) {
  if (!state.status || state.mutating) return null;
  setBusy(true);
  setMessage({ notice: 'Saving and verifying Campaign…' });
  try {
    const result = await session.execute(operation, state.status.revision);
    state.status = {
      ...state.status,
      revision: result.revision,
      commitId: result.commitId,
      capsule: result.capsule,
      syncBoundary: result.syncBoundary,
    };
    state.undo = result.undoEligible ? { token: result.undoToken, revision: result.revision } : null;
    refreshViews();
    if (!refreshNarratorPrompt()) registerCapsule(result.capsule);
    setMessage({ notice: successMessage || result.impact });
    return result;
  } catch (error) {
    if (error?.code === 'campaign_conflict') {
      const preservedDraft = clone(state.draft);
      try {
        state.status = await session.open(chatIdentity());
        refreshViews();
        if (!refreshNarratorPrompt()) registerCapsule(state.status.capsule);
        state.draft = preservedDraft;
      } catch {
        // The original conflict remains the most actionable error.
      }
    }
    setMessage({ error: error?.message ?? String(error), fields: error?.fields ?? {} });
    return null;
  } finally {
    setBusy(false);
    renderCollection();
    renderEditor({ populate: false });
  }
}

async function runStorySyncOperation(operation) {
  if (!state.status) throw new Error('Open the Campaign Workspace before using Story Sync.');
  if (state.mutating) throw new Error('Another Campaign save is still running.');
  setBusy(true);
  try {
    const result = await session.execute(operation, state.status.revision);
    state.status = {
      ...state.status,
      revision: result.revision,
      commitId: result.commitId,
      capsule: result.capsule,
      syncBoundary: result.syncBoundary,
    };
    state.undo = result.undoEligible ? { token: result.undoToken, revision: result.revision } : null;
    refreshViews();
    if (!refreshNarratorPrompt()) registerCapsule(result.capsule);
    return result;
  } catch (error) {
    if (error?.code === 'campaign_conflict') {
      state.status = await session.open(chatIdentity());
      refreshViews();
      if (!refreshNarratorPrompt()) registerCapsule(state.status.capsule);
    }
    throw error;
  } finally {
    setBusy(false);
    renderCollection();
    renderEditor({ populate: false });
  }
}

async function saveDraft() {
  if (!state.draft) return;
  if (state.draft.quickRecord) {
    setMessage({ notice: 'Create or cancel the linked-record draft before saving this record.' });
    renderEditor({ populate: false });
    return;
  }
  if (state.draft.advanceDraft) {
    setMessage({ notice: 'Advance or cancel the next-scene draft before saving the current scene.' });
    renderEditor({ populate: false });
    return;
  }
  const collection = state.draft.collection;
  const mode = state.draft.mode;
  const possessionId = state.draft.possessionId;
  const learnedAbilityId = state.draft.learnedAbilityId;
  const actorId = state.draft.actorId;
  const questId = state.draft.questId;
  const preservedRelationshipDraft = clone(state.draft.relationshipDraft);
  const isAbility = collection === 'abilities';
  const isPerson = collection === 'people';
  const isCharacter = collection === 'character';
  const isQuest = collection === 'objectives';
  const isWorld = collection === 'world';
  const isScene = collection === 'current_scene';
  const worldKind = state.draft.worldKind;
  const worldRecordId = state.draft.recordId;
  const result = await runOperation(
    operationFromDraft(),
    isCharacter
      ? 'Player Character saved.'
      : isScene
        ? (mode === 'create' ? 'Current Scene opened.' : 'Current Scene saved.')
      : isQuest
        ? (mode === 'create' ? 'Objective created.' : 'Objective saved.')
        : isWorld
          ? (mode === 'create' ? `${collectionMeta().singular} created.` : `${collectionMeta().singular} saved.`)
        : isAbility
      ? (mode === 'create' ? 'Ability created and learned.' : 'Ability saved.')
      : isPerson
        ? (mode === 'create' ? 'NPC created. Add Relationships below.' : 'NPC saved.')
        : (mode === 'create' ? 'Item added to Inventory.' : 'Inventory entry saved.'),
  );
  if (!result) {
    state.draft.dirty = true;
    persistDraft();
    renderEditor({ populate: false });
    return;
  }
  refreshViews();
  const changed = isCharacter
    ? state.characterEntry
    : isScene
      ? state.currentSceneEntry
    : isQuest
      ? (state.questEntries.find(entry => entry.id === questId)
        ?? state.questEntries.find(entry => result.affectedIds.includes(entry.id)))
      : isWorld
        ? (worldKind === 'fact'
          ? (state.factEntries.find(entry => entry.fact.id === worldRecordId)
            ?? state.factEntries.find(entry => result.affectedIds.includes(entry.fact.id)))
          : worldKind === 'place'
            ? (state.placeEntries.find(entry => entry.place.id === worldRecordId)
              ?? state.placeEntries.find(entry => result.affectedIds.includes(entry.place.id)))
            : (state.worldObjectEntries.find(entry => entry.worldObject.id === worldRecordId)
              ?? state.worldObjectEntries.find(entry => result.affectedIds.includes(entry.worldObject.id))))
      : isAbility
    ? (state.abilityEntries.find(entry => entry.learnedAbility.id === learnedAbilityId)
      ?? state.abilityEntries.find(entry => result.affectedIds.includes(entry.learnedAbility.id)))
    : isPerson
      ? (state.peopleEntries.find(entry => entry.actor.id === actorId)
        ?? state.peopleEntries.find(entry => result.affectedIds.includes(entry.actor.id)))
      : (state.entries.find(entry => entry.possession.id === possessionId)
        ?? state.entries.find(entry => result.affectedIds.includes(entry.possession.id)));
  if (isCharacter) {
    state.draft = state.characterEntry ? characterDraftFromActor(state.characterEntry) : null;
  } else if (isScene) {
    state.selectedSceneId = changed?.id ?? null;
    state.draft = changed ? sceneDraftFromEntry(changed) : null;
  } else if (isQuest) {
    state.selectedQuestId = changed?.id ?? null;
    state.draft = changed ? questDraftFromEntry(changed) : null;
  } else if (isWorld) {
    const record = changed
      ? worldKind === 'fact' ? changed.fact : worldKind === 'place' ? changed.place : changed.worldObject
      : null;
    state.selectedWorldRecordId = record?.id ?? null;
    state.draft = changed ? worldDraftFromEntry(changed, worldKind) : null;
  } else if (isAbility) {
    state.selectedLearnedAbilityId = changed?.learnedAbility.id ?? null;
    state.draft = changed ? abilityDraftFromEntry(changed) : null;
  } else if (isPerson) {
    state.selectedActorId = changed?.actor.id ?? null;
    state.draft = changed ? personDraftFromEntry(changed) : null;
    if (state.draft && preservedRelationshipDraft?.dirty) state.draft.relationshipDraft = preservedRelationshipDraft;
  } else {
    state.selectedPossessionId = changed?.possession.id ?? null;
    state.draft = changed ? draftFromEntry(changed) : null;
  }
  persistDraft();
  renderCollection();
  renderEditor();
}

async function changeQuantity(possessionId, delta) {
  const entry = state.entries.find(candidate => candidate.possession.id === possessionId);
  if (!entry) return;
  const quantity = Math.max(0, entry.possession.quantity + delta);
  await runOperation({ type: 'update_possession', possessionId, changes: { quantity } }, `${entry.item.name} quantity is now ${quantity}.`);
  if (state.draft?.possessionId === possessionId && !state.draft.dirty) {
    const changed = state.entries.find(candidate => candidate.possession.id === possessionId);
    state.draft = draftFromEntry(changed);
    renderEditor();
  }
}

async function changeAbilityUses(learnedAbilityId, delta) {
  const entry = state.abilityEntries.find(candidate => candidate.learnedAbility.id === learnedAbilityId);
  if (!entry || (entry.learnedAbility.currentUses === null && entry.learnedAbility.maxUses === null)) return;
  const currentUses = entry.learnedAbility.currentUses ?? 0;
  const uncapped = Math.max(0, currentUses + delta);
  const nextUses = entry.learnedAbility.maxUses === null
    ? uncapped
    : Math.min(entry.learnedAbility.maxUses, uncapped);
  await runOperation(
    { type: 'update_learned_ability', learnedAbilityId, changes: { currentUses: nextUses } },
    `${entry.ability.name} has ${nextUses}${entry.learnedAbility.maxUses === null ? '' : `/${entry.learnedAbility.maxUses}`} uses remaining.`,
  );
  if (state.draft?.learnedAbilityId === learnedAbilityId && !state.draft.dirty) {
    const changed = state.abilityEntries.find(candidate => candidate.learnedAbility.id === learnedAbilityId);
    if (changed) state.draft = abilityDraftFromEntry(changed);
    renderEditor();
  }
}

function beginRelationshipCreate() {
  if (state.draft?.collection !== 'people' || state.draft.mode !== 'edit' || state.draft.archived) return;
  if (state.draft.relationshipDraft?.dirty && !globalThis.confirm?.('Replace the unsaved Relationship draft?')) return;
  state.draft.relationshipDraft = {
    mode: 'create',
    relationshipId: null,
    sourceActorId: state.status.playerCharacterId,
    targetActorId: state.draft.actorId,
    relationshipKind: '',
    status: 'active',
    notes: '',
    affinity: '',
    trust: '',
    respect: '',
    fear: '',
    tension: '',
    debt: '',
    dirty: false,
  };
  setMessage();
  renderEditor();
  root()?.querySelector('#rpgcampaign-relationship-form [name="relationshipKind"]')?.focus();
}

function beginRelationshipEdit(relationshipId) {
  if (state.draft?.collection !== 'people') return;
  if (state.draft.relationshipDraft?.dirty
    && state.draft.relationshipDraft.relationshipId !== relationshipId
    && !globalThis.confirm?.('Replace the unsaved Relationship draft?')) return;
  const entry = state.relationshipEntries.find(candidate => candidate.relationship.id === relationshipId);
  if (!entry) return;
  state.draft.relationshipDraft = relationshipDraftFromEntry(entry);
  setMessage();
  renderEditor();
}

function cancelRelationship() {
  if (state.draft?.relationshipDraft?.dirty && !globalThis.confirm?.('Discard this Relationship draft?')) return;
  if (!state.draft) return;
  state.draft.relationshipDraft = null;
  persistDraft();
  setMessage();
  renderEditor();
}

function relationshipOperationFromDraft() {
  const draft = state.draft.relationshipDraft;
  const changes = {
    relationshipKind: draft.relationshipKind,
    status: draft.status,
    notes: draft.notes,
    dimensions: {
      affinity: draft.affinity,
      trust: draft.trust,
      respect: draft.respect,
      fear: draft.fear,
      tension: draft.tension,
      debt: draft.debt,
    },
  };
  if (draft.mode === 'create') {
    return {
      type: 'create_relationship',
      relationship: {
        sourceActorId: draft.sourceActorId,
        targetActorId: draft.targetActorId,
        ...changes,
      },
    };
  }
  return { type: 'update_relationship', relationshipId: draft.relationshipId, changes };
}

async function saveRelationship() {
  const draft = state.draft?.relationshipDraft;
  if (!draft) return;
  const result = await runOperation(
    relationshipOperationFromDraft(),
    draft.mode === 'create' ? 'Relationship added.' : 'Relationship saved.',
  );
  if (!result) {
    draft.dirty = true;
    persistDraft();
    renderEditor({ populate: false });
    return;
  }
  state.draft.relationshipDraft = null;
  persistDraft();
  renderAll();
}

async function archiveRelationship(relationshipId) {
  const entry = state.relationshipEntries.find(candidate => candidate.relationship.id === relationshipId);
  if (!entry || !globalThis.confirm?.(`Archive ${entry.source.name} → ${entry.target.name} Relationship?`)) return;
  const result = await runOperation({ type: 'archive_relationship', relationshipId }, 'Relationship archived.');
  if (!result) return;
  if (state.draft?.relationshipDraft?.relationshipId === relationshipId) state.draft.relationshipDraft = null;
  persistDraft();
  renderAll();
}

async function restoreRelationship(relationshipId) {
  const result = await runOperation({ type: 'restore_relationship', relationshipId }, 'Relationship restored.');
  if (result) renderAll();
}

async function deleteRelationship(relationshipId) {
  const entry = state.archivedRelationshipEntries.find(candidate => candidate.relationship.id === relationshipId);
  if (!entry || !globalThis.confirm?.(`Permanently delete ${entry.source.name} → ${entry.target.name} Relationship?`)) return;
  const result = await runOperation({ type: 'delete_relationship', relationshipId }, 'Relationship permanently deleted.');
  if (result) renderAll();
}

async function archiveSelected() {
  if (!state.draft) return;
  if (state.draft.quickRecord) {
    setMessage({ notice: 'Create or cancel the linked-record draft before changing lifecycle state.' });
    renderEditor({ populate: false });
    return;
  }
  if (state.draft.archived) {
    if (state.draft.collection === 'abilities') await restoreLearnedAbility(state.draft.learnedAbilityId);
    else if (state.draft.collection === 'people') await restoreActor(state.draft.actorId);
    else if (state.draft.collection === 'objectives') await restoreQuest(state.draft.questId);
    else if (state.draft.collection === 'world') await restoreWorldRecord(state.draft.recordId);
    else await restorePossession(state.draft.possessionId);
    return;
  }
  const name = state.draft.name;
  const isAbility = state.draft.collection === 'abilities';
  const isPerson = state.draft.collection === 'people';
  const isQuest = state.draft.collection === 'objectives';
  const isWorld = state.draft.collection === 'world';
  if (!globalThis.confirm?.(`Archive ${name}? It will leave the active collection and narration context.`)) return;
  const result = await runOperation(isAbility
    ? { type: 'archive_learned_ability', learnedAbilityId: state.draft.learnedAbilityId }
    : isPerson
      ? { type: 'archive_actor', actorId: state.draft.actorId }
      : isQuest
        ? { type: 'archive_quest', questId: state.draft.questId }
        : isWorld
          ? { type: 'archive_world_record', recordId: state.draft.recordId }
      : { type: 'archive_possession', possessionId: state.draft.possessionId }, `${name} archived.`);
  if (!result) return;
  state.draft = null;
  persistDraft();
  if (isAbility) state.selectedLearnedAbilityId = state.abilityEntries[0]?.learnedAbility.id ?? null;
  else if (isPerson) state.selectedActorId = state.peopleEntries[0]?.actor.id ?? null;
  else if (isQuest) state.selectedQuestId = state.questEntries[0]?.id ?? null;
  else if (isWorld) state.selectedWorldRecordId = activeEntries()[0]
    ? (state.worldKind === 'fact' ? activeEntries()[0].fact.id : state.worldKind === 'place' ? activeEntries()[0].place.id : activeEntries()[0].worldObject.id)
    : null;
  else state.selectedPossessionId = state.entries[0]?.possession.id ?? null;
  state.mobilePane = 'inventory';
  renderAll();
}

async function restorePossession(possessionId) {
  const entry = state.archivedEntries.find(candidate => candidate.possession.id === possessionId);
  const result = await runOperation({ type: 'restore_possession', possessionId }, `${entry?.item.name ?? 'Item'} restored.`);
  if (!result) return;
  state.showArchived = false;
  state.selectedPossessionId = possessionId;
  const restored = state.entries.find(candidate => candidate.possession.id === possessionId);
  if (state.draft?.possessionId === possessionId && restored) state.draft = draftFromEntry(restored);
  renderAll();
}

async function restoreLearnedAbility(learnedAbilityId) {
  const entry = state.archivedAbilityEntries.find(candidate => candidate.learnedAbility.id === learnedAbilityId);
  const result = await runOperation(
    { type: 'restore_learned_ability', learnedAbilityId },
    `${entry?.ability.name ?? 'Ability'} restored.`,
  );
  if (!result) return;
  state.showArchived = false;
  state.selectedLearnedAbilityId = learnedAbilityId;
  const restored = state.abilityEntries.find(candidate => candidate.learnedAbility.id === learnedAbilityId);
  if (state.draft?.learnedAbilityId === learnedAbilityId && restored) state.draft = abilityDraftFromEntry(restored);
  renderAll();
}

async function restoreActor(actorId) {
  const entry = state.archivedPeopleEntries.find(candidate => candidate.actor.id === actorId);
  const result = await runOperation({ type: 'restore_actor', actorId }, `${entry?.actor.name ?? 'NPC'} restored.`);
  if (!result) return;
  state.showArchived = false;
  state.selectedActorId = actorId;
  const restored = state.peopleEntries.find(candidate => candidate.actor.id === actorId);
  if (state.draft?.actorId === actorId && restored) state.draft = personDraftFromEntry(restored);
  renderAll();
}

async function restoreQuest(questId) {
  const entry = state.archivedQuestEntries.find(candidate => candidate.id === questId);
  const result = await runOperation({ type: 'restore_quest', questId }, `${entry?.name ?? 'Objective'} restored.`);
  if (!result) return;
  state.showArchived = false;
  state.selectedQuestId = questId;
  const restored = state.questEntries.find(candidate => candidate.id === questId);
  if (state.draft?.questId === questId && restored) state.draft = questDraftFromEntry(restored);
  renderAll();
}

async function restoreWorldRecord(recordId) {
  const result = await runOperation({ type: 'restore_world_record', recordId }, 'World record restored.');
  if (!result) return;
  state.showArchived = false;
  state.selectedWorldRecordId = recordId;
  const entries = activeEntries();
  const restored = entries.find(entry => {
    const record = state.worldKind === 'fact' ? entry.fact : state.worldKind === 'place' ? entry.place : entry.worldObject;
    return record.id === recordId;
  });
  if (state.draft?.recordId === recordId && restored) state.draft = worldDraftFromEntry(restored, state.worldKind);
  renderAll();
}

async function deleteSelectedPermanently() {
  if (!state.draft?.archived) return;
  const isAbility = state.draft.collection === 'abilities';
  const isPerson = state.draft.collection === 'people';
  const isQuest = state.draft.collection === 'objectives';
  const isWorld = state.draft.collection === 'world';
  if (isAbility && (!state.draft.learnedAbilityId || !state.draft.abilityId)) return;
  if (isPerson && !state.draft.actorId) return;
  if (isQuest && !state.draft.questId) return;
  if (isWorld && !state.draft.recordId) return;
  if (!isAbility && !isPerson && !isQuest && !isWorld && (!state.draft.possessionId || !state.draft.itemId)) return;
  const name = state.draft.name;
  if (!globalThis.confirm?.(`Permanently delete ${name}? This cannot be undone after another Campaign change.`)) return;
  const result = await runOperation(isAbility
    ? {
        type: 'delete_ability_entry',
        learnedAbilityId: state.draft.learnedAbilityId,
        abilityId: state.draft.abilityId,
      }
    : isPerson
      ? { type: 'delete_actor', actorId: state.draft.actorId }
      : isQuest
        ? { type: 'delete_quest', questId: state.draft.questId }
        : isWorld
          ? { type: 'delete_world_record', recordId: state.draft.recordId }
      : {
          type: 'delete_inventory_entry',
          possessionId: state.draft.possessionId,
          itemId: state.draft.itemId,
        }, `${name} permanently deleted.`);
  if (!result) return;
  state.draft = null;
  persistDraft();
  if (isAbility) state.selectedLearnedAbilityId = null;
  else if (isPerson) state.selectedActorId = null;
  else if (isQuest) state.selectedQuestId = null;
  else if (isWorld) state.selectedWorldRecordId = null;
  else state.selectedPossessionId = null;
  state.showArchived = true;
  state.mobilePane = 'inventory';
  renderAll();
}

async function undoLast() {
  if (!state.undo) return;
  const undo = state.undo;
  state.undo = null;
  const result = await runOperation({ type: 'undo', token: undo.token }, 'Last Campaign change undone.');
  if (result) renderAll();
}

function handleFormInput(event) {
  if (!state.draft) return;
  const listName = event.target?.dataset?.rpgDraftList;
  if (listName) {
    const row = state.draft[listName]?.[Number(event.target.dataset.rpgDraftIndex)];
    const field = event.target.dataset.rpgDraftField;
    if (!row || !field) return;
    row[field] = event.target.value;
  } else {
    if (!event.target?.name) return;
    state.draft[event.target.name] = event.target.value;
  }
  state.draft.dirty = true;
  persistDraft();
  if (event.target?.name === 'definitionMode') {
    if (event.target.value === 'new') state.draft.existingRecordId = '';
    renderEditor();
    return;
  }
  const meta = collectionMeta(state.draft.collection);
  root().querySelector('#rpgcampaign-editor-title').textContent = state.draft.mode === 'create'
    ? `Add ${meta.singular}`
    : state.draft.title || state.draft.name || `Edit ${meta.singular}`;
  root().querySelector('#rpgcampaign-dirty').textContent = 'Unsaved draft preserved';
}

function addMeter() {
  if (state.draft?.collection !== 'character') return;
  state.draft.meters.push({ _key: draftRowKey('meter'), id: null, label: '', current: 0, max: '', notes: '' });
  state.draft.dirty = true;
  persistDraft();
  renderEditor();
  root()?.querySelector('#rpgcampaign-meter-list article:last-of-type input')?.focus();
}

function removeMeter(key) {
  if (state.draft?.collection !== 'character') return;
  state.draft.meters = state.draft.meters.filter(meter => meter._key !== key);
  state.draft.dirty = true;
  persistDraft();
  renderEditor();
}

function addQuestStep() {
  if (state.draft?.collection !== 'objectives') return;
  state.draft.steps.push({ _key: draftRowKey('quest-step'), id: null, label: '', status: 'pending', notes: '' });
  state.draft.dirty = true;
  persistDraft();
  renderEditor();
  root()?.querySelector('#rpgcampaign-quest-step-list article:last-of-type input')?.focus();
}

function removeQuestStep(key) {
  if (state.draft?.collection !== 'objectives') return;
  state.draft.steps = state.draft.steps.filter(step => step._key !== key);
  state.draft.dirty = true;
  persistDraft();
  renderEditor();
}

function moveDraftRow(listName, key, delta) {
  const rows = state.draft?.[listName];
  if (!Array.isArray(rows)) return;
  const index = rows.findIndex(row => row._key === key);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= rows.length) return;
  [rows[index], rows[target]] = [rows[target], rows[index]];
  state.draft.dirty = true;
  persistDraft();
  renderEditor();
}

function addPlaceConnection() {
  if (state.draft?.collection !== 'world' || state.draft.worldKind !== 'place') return;
  const options = allPlaceOptions(state.draft.recordId);
  state.draft.connections.push({
    _key: draftRowKey('place-connection'),
    id: null,
    targetPlaceId: options[0]?.value ?? '',
    connectionKind: 'connection',
    notes: '',
  });
  state.draft.dirty = true;
  persistDraft();
  renderEditor();
}

function addSceneRow(listName) {
  if (state.draft?.collection !== 'current_scene') return;
  const firstSubject = allSceneSubjectOptions()[0]?.value ?? '';
  const defaults = {
    presences: { subjectKey: firstSubject, role: 'participant', state: 'present', notes: '' },
    exits: { label: '', destinationPlaceId: '', status: 'open', notes: '' },
    obstacles: { label: '', status: 'active', notes: '' },
    countdowns: { label: '', current: 0, max: 4, notes: '' },
    openThreads: { label: '', status: 'open', notes: '', carriedFromThreadId: null },
  };
  if (!defaults[listName]) return;
  state.draft[listName].push({ _key: draftRowKey(`scene-${listName}`), id: null, ...defaults[listName] });
  state.draft.dirty = true;
  persistDraft();
  renderEditor();
}

function removeDraftRow(listName, key) {
  const rows = state.draft?.[listName];
  if (!Array.isArray(rows)) return;
  state.draft[listName] = rows.filter(row => row._key !== key);
  state.draft.dirty = true;
  persistDraft();
  renderEditor();
}

function beginAdvanceScene() {
  if (state.draft?.collection !== 'current_scene' || state.draft.mode !== 'edit') return;
  if (state.draft.dirty || state.draft.quickRecord) {
    setMessage({ notice: 'Save or cancel current-scene edits before advancing.' });
    renderEditor({ populate: false });
    return;
  }
  state.draft.advanceDraft = {
    title: '',
    summary: '',
    placeId: state.draft.placeId,
    transitionNotes: '',
    carryThreadIds: state.draft.openThreads
      .filter(thread => ['open', 'carried'].includes(thread.status))
      .map(thread => thread.id),
    dirty: false,
  };
  renderEditor();
  root()?.querySelector('#rpgcampaign-scene-advance-form [name="title"]')?.focus();
}

function cancelAdvanceScene() {
  const advance = state.draft?.advanceDraft;
  if (!advance) return;
  if (advance.dirty && !globalThis.confirm?.('Discard this next-scene draft?')) return;
  state.draft.advanceDraft = null;
  persistDraft();
  renderEditor();
}

function handleAdvanceInput(event) {
  const advance = state.draft?.advanceDraft;
  if (!advance || !event.target?.name) return;
  advance[event.target.name] = event.target.value;
  advance.dirty = true;
  persistDraft();
  root().querySelector('#rpgcampaign-dirty').textContent = 'Unsaved next-scene draft preserved';
}

function toggleCarryThread(threadId, checked) {
  const advance = state.draft?.advanceDraft;
  if (!advance) return;
  const ids = new Set(advance.carryThreadIds);
  if (checked) ids.add(threadId);
  else ids.delete(threadId);
  advance.carryThreadIds = [...ids];
  advance.dirty = true;
  persistDraft();
  root().querySelector('#rpgcampaign-dirty').textContent = 'Unsaved next-scene draft preserved';
}

async function confirmAdvanceScene() {
  const sceneDraft = state.draft;
  const advance = clone(sceneDraft?.advanceDraft);
  if (!sceneDraft || sceneDraft.collection !== 'current_scene' || !advance) return;
  if (!globalThis.confirm?.(`Close “${sceneDraft.title}” and open “${advance.title || 'the next scene'}”?\n\nThe closed scene becomes read-only history. This change can be undone until another Campaign change is made.`)) return;
  const result = await runOperation({
    type: 'advance_scene',
    sceneId: sceneDraft.sceneId,
    carryThreadIds: advance.carryThreadIds,
    nextScene: {
      title: advance.title,
      summary: advance.summary,
      placeId: advance.placeId || null,
      transitionNotes: advance.transitionNotes,
      presences: [],
      exits: [],
      obstacles: [],
      countdowns: [],
      openThreads: [],
    },
  }, 'Scene archived and next scene opened.');
  if (!result) {
    if (state.draft?.advanceDraft) state.draft.advanceDraft.dirty = true;
    persistDraft();
    return;
  }
  state.selectedSceneId = state.currentSceneEntry?.id ?? null;
  state.draft = state.currentSceneEntry ? sceneDraftFromEntry(state.currentSceneEntry) : null;
  persistDraft();
  renderCollection();
  renderEditor();
}

function beginQuickRecord(target) {
  if (!['world', 'current_scene'].includes(state.draft?.collection)) return;
  if (state.draft.quickRecord?.dirty && !globalThis.confirm?.('Replace the unsaved quick-create draft?')) return;
  const placeOnly = target !== 'factSubject' && !target.startsWith('scenePresence:');
  state.draft.quickRecord = {
    target,
    kind: placeOnly ? 'place' : 'actor',
    name: '',
    category: placeOnly ? 'place' : 'npc',
    summary: '',
    dirty: false,
  };
  persistDraft();
  renderEditor();
  root()?.querySelector('#rpgcampaign-quick-record-form [name="name"]')?.focus();
}

function cancelQuickRecord() {
  if (state.draft?.quickRecord?.dirty && !globalThis.confirm?.('Discard this quick-create draft?')) return;
  if (!state.draft) return;
  state.draft.quickRecord = null;
  persistDraft();
  renderEditor();
}

function handleQuickRecordInput(event) {
  const quick = state.draft?.quickRecord;
  if (!quick || !event.target?.name) return;
  quick[event.target.name] = event.target.value;
  if (event.target.name === 'kind') {
    quick.category = {
      actor: 'npc', item: 'other', ability: 'skill', quest: 'quest', place: 'place', world_object: 'world-object',
    }[event.target.value];
  }
  quick.dirty = true;
  persistDraft();
  renderQuickRecord({ populate: event.target.name === 'kind' });
  root().querySelector('#rpgcampaign-dirty').textContent = 'Unsaved draft preserved';
}

function quickRecordOperation(quick) {
  const common = { name: quick.name, summary: quick.summary, category: quick.category };
  if (quick.kind === 'actor') return { type: 'create_actor', actor: common };
  if (quick.kind === 'item') {
    return {
      type: 'create_item_and_possession',
      item: common,
      possession: { ownerActorId: state.status.playerCharacterId, quantity: 1, carriedState: 'carried', equippedSlots: [] },
    };
  }
  if (quick.kind === 'ability') {
    return {
      type: 'create_ability_and_learned_ability',
      ability: common,
      learnedAbility: { actorId: state.status.playerCharacterId, accessState: 'learned', currentUses: null, maxUses: null },
    };
  }
  if (quick.kind === 'quest') return { type: 'create_quest', quest: { ...common, status: 'planned', steps: [], involvedRefs: [] } };
  if (quick.kind === 'place') return { type: 'create_place', place: { ...common, connections: [] } };
  return { type: 'create_world_object', worldObject: common };
}

async function saveQuickRecord() {
  const quick = clone(state.draft?.quickRecord);
  if (!quick) return;
  const result = await runOperation(quickRecordOperation(quick), `${quick.name || 'Linked record'} created and selected.`);
  if (!result || !state.draft) return;
  const option = state.referenceOptions.find(entry => entry.kind === quick.kind && result.affectedIds.includes(entry.id));
  if (!option) {
    setMessage({ error: 'The new linked record was saved but could not be selected. Reload the Workspace.' });
    renderEditor({ populate: false });
    return;
  }
  if (quick.target === 'factSubject') state.draft.subjectKey = `${option.kind}:${option.id}`;
  else if (quick.target === 'parentPlaceId') state.draft.parentPlaceId = option.id;
  else if (quick.target === 'homePlaceId') state.draft.homePlaceId = option.id;
  else if (quick.target === 'scenePlace') state.draft.placeId = option.id;
  else if (quick.target.startsWith('scenePresence:')) {
    const key = quick.target.slice('scenePresence:'.length);
    const presence = state.draft.presences?.find(entry => entry._key === key);
    if (presence) presence.subjectKey = `${option.kind}:${option.id}`;
  }
  else if (quick.target.startsWith('sceneExit:')) {
    const key = quick.target.slice('sceneExit:'.length);
    const exit = state.draft.exits?.find(entry => entry._key === key);
    if (exit) exit.destinationPlaceId = option.id;
  }
  else if (quick.target.startsWith('connection:')) {
    const key = quick.target.slice('connection:'.length);
    const connection = state.draft.connections?.find(entry => entry._key === key);
    if (connection) connection.targetPlaceId = option.id;
  }
  state.draft.quickRecord = null;
  state.draft.dirty = true;
  persistDraft();
  renderEditor();
}

function removePlaceConnection(key) {
  if (state.draft?.collection !== 'world' || state.draft.worldKind !== 'place') return;
  state.draft.connections = state.draft.connections.filter(connection => connection._key !== key);
  state.draft.dirty = true;
  persistDraft();
  renderEditor();
}

function switchWorldKind(kind) {
  if (!['fact', 'place', 'world_object'].includes(kind) || kind === state.worldKind) return;
  if (hasDirtyDraft()) {
    setMessage({ notice: 'Save or cancel the current World draft before changing record type.' });
    renderEditor({ populate: false });
    return;
  }
  state.draft = null;
  state.worldKind = kind;
  state.selectedWorldRecordId = null;
  state.search = '';
  state.showArchived = false;
  root().querySelector('#rpgcampaign-search').value = '';
  setMessage();
  renderCollection();
  renderEditor();
}

function handleRelationshipInput(event) {
  const draft = state.draft?.relationshipDraft;
  if (!draft || !event.target?.name) return;
  draft[event.target.name] = event.target.value;
  draft.dirty = true;
  persistDraft();
  root().querySelector('#rpgcampaign-dirty').textContent = 'Unsaved draft preserved';
}

function switchCollection(collection) {
  if (!['character', 'inventory', 'abilities', 'people', 'objectives', 'world', 'current_scene'].includes(collection) || collection === state.activeCollection) return;
  if (hasDirtyDraft()) {
    setMessage({ notice: `Save or cancel the current ${collectionMeta(state.draft.collection).singular} draft before switching collections.` });
    renderEditor({ populate: false });
    return;
  }
  state.draft = null;
  state.activeCollection = collection;
  state.search = '';
  state.showArchived = false;
  state.mobilePane = 'inventory';
  root().querySelector('#rpgcampaign-search').value = '';
  setMessage();
  renderCollection();
  renderEditor();
  renderLayout();
  if (collection === 'character') beginCharacterEdit();
  if (collection === 'current_scene' && state.currentSceneEntry) beginSceneEdit(state.currentSceneEntry.id);
}

function setPanel(name, visible) {
  state.layout[name] = visible;
  if (!visible && state.mobilePane === name) state.mobilePane = 'editor';
  persistLayout();
  renderLayout();
}

async function syncJsonAddons() {
  if (!state.status || state.mutating) return;
  if (hasDirtyDraft()) {
    setMessage({ notice: 'Save or cancel the current draft before syncing JSON addons.' });
    renderEditor({ populate: false });
    return;
  }
  let bundle;
  let preview;
  setBusy(true);
  setMessage({ notice: 'Loading installed JSON addons…' });
  try {
    const url = new URL(CONTENT_BUNDLE_URL);
    url.searchParams.set('cache', String(Date.now()));
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`JSON addon bundle could not be loaded (HTTP ${response.status}).`);
    bundle = await response.json();
    preview = session.preview({ type: 'sync_content_addons', bundle });
  } catch (error) {
    setMessage({ error: error?.message ?? String(error), fields: error?.fields ?? {} });
    return;
  } finally {
    setBusy(false);
  }
  const total = Object.values(preview.addonCounts ?? {}).reduce((sum, count) => sum + count, 0);
  if (!total) {
    setMessage({ notice: 'The installed addon bundle is empty. Fill campaign-content/*_addon.json, run the extension installer, then retry.' });
    renderAll();
    return;
  }
  if (!globalThis.confirm?.(`${preview.summary}\n\nExisting imported IDs will be updated; missing IDs will be created.`)) {
    setMessage({ notice: 'JSON addon sync cancelled.' });
    renderAll();
    return;
  }
  const result = await runOperation({ type: 'sync_content_addons', bundle }, preview.summary);
  if (!result) return;
  state.draft = null;
  persistDraft();
  state.showArchived = false;
  renderAll();
}

function openStorySync(trigger) {
  const opened = storySync.open(trigger);
  if (!opened) setMessage({ error: 'SillyTavern Popup is unavailable. Reload SillyTavern and retry Story Sync.' });
}

function openContextInspector(trigger) {
  const opened = contextInspector.open(trigger);
  if (!opened) setMessage({ error: 'SillyTavern Popup is unavailable. Reload SillyTavern and retry Narrator Context.' });
}

function toggleNarratorFocus(recordId) {
  const enabled = !state.manualFocusIds.includes(recordId);
  try {
    const envelope = verifiedEnvelopeFromMetadata();
    const record = envelope?.campaign?.records?.find(candidate => candidate.id === recordId);
    setManualFocus(recordId, enabled);
    setMessage({ notice: enabled
      ? `${record?.name ?? 'Record'} will be expanded in the next narrator reply.`
      : `${record?.name ?? 'Record'} removed from next-reply focus.` });
  } catch (error) {
    setMessage({ error: error?.message ?? String(error) });
  }
}

async function handleClick(event) {
  const launcher = event.target.closest('#rpgcampaign-launcher');
  if (launcher) return openWorkspace(launcher);

  const actionControl = event.target.closest('[data-rpg-action]');
  const action = actionControl?.dataset.rpgAction;
  if ((state.loading || state.mutating) && action !== 'close') return;
  if (action === 'close') return closeWorkspace();
  if (action === 'new-item' || action === 'new-record') return beginCreate();
  if (action === 'cancel-edit') return cancelEdit();
  if (action === 'save') return saveDraft();
  if (action === 'archive') return archiveSelected();
  if (action === 'delete-permanently') return deleteSelectedPermanently();
  if (action === 'undo') return undoLast();
  if (action === 'sync-addons') return syncJsonAddons();
  if (action === 'sync-story') return openStorySync(actionControl);
  if (action === 'inspect-context') return openContextInspector(actionControl);
  if (action === 'new-relationship') return beginRelationshipCreate();
  if (action === 'cancel-relationship') return cancelRelationship();
  if (action === 'save-relationship') return saveRelationship();
  if (action === 'add-meter') return addMeter();
  if (action === 'add-quest-step') return addQuestStep();
  if (action === 'add-place-connection') return addPlaceConnection();
  if (action === 'add-scene-presence') return addSceneRow('presences');
  if (action === 'add-scene-exit') return addSceneRow('exits');
  if (action === 'add-scene-obstacle') return addSceneRow('obstacles');
  if (action === 'add-scene-countdown') return addSceneRow('countdowns');
  if (action === 'add-scene-thread') return addSceneRow('openThreads');
  if (action === 'begin-advance-scene') return beginAdvanceScene();
  if (action === 'cancel-advance-scene') return cancelAdvanceScene();
  if (action === 'confirm-advance-scene') return confirmAdvanceScene();
  if (action === 'cancel-quick-record') return cancelQuickRecord();
  if (action === 'save-quick-record') return saveQuickRecord();

  const quickTarget = event.target.closest('[data-rpg-quick-target]')?.dataset.rpgQuickTarget;
  if (quickTarget) return beginQuickRecord(quickTarget);

  const focusRecordId = event.target.closest('[data-rpg-focus]')?.dataset.rpgFocus;
  if (focusRecordId) return toggleNarratorFocus(focusRecordId);

  const collection = event.target.closest('[data-rpg-collection]')?.dataset.rpgCollection;
  if (collection) return switchCollection(collection);

  const hide = event.target.closest('[data-rpg-hide]')?.dataset.rpgHide;
  if (hide) return setPanel(hide, false);
  const toggle = event.target.closest('[data-rpg-toggle]')?.dataset.rpgToggle;
  if (toggle) return setPanel(toggle, !state.layout[toggle]);
  const mobile = event.target.closest('[data-rpg-mobile]')?.dataset.rpgMobile;
  if (mobile) {
    state.mobilePane = mobile;
    if (mobile in state.layout && !state.layout[mobile]) {
      state.layout[mobile] = true;
      persistLayout();
    }
    return renderLayout();
  }
  const edit = event.target.closest('[data-rpg-edit]')?.dataset.rpgEdit;
  if (edit) return beginEdit(edit);
  const abilityEdit = event.target.closest('[data-rpg-ability-edit]')?.dataset.rpgAbilityEdit;
  if (abilityEdit) return beginAbilityEdit(abilityEdit);
  const personEdit = event.target.closest('[data-rpg-person-edit]')?.dataset.rpgPersonEdit;
  if (personEdit) return beginPersonEdit(personEdit);
  const characterEdit = event.target.closest('[data-rpg-character-edit]')?.dataset.rpgCharacterEdit;
  if (characterEdit) return beginCharacterEdit();
  const questEdit = event.target.closest('[data-rpg-quest-edit]')?.dataset.rpgQuestEdit;
  if (questEdit) return beginQuestEdit(questEdit);
  const worldEdit = event.target.closest('[data-rpg-world-edit]')?.dataset.rpgWorldEdit;
  if (worldEdit) return beginWorldEdit(worldEdit);
  const sceneEdit = event.target.closest('[data-rpg-scene-edit]')?.dataset.rpgSceneEdit;
  if (sceneEdit) return beginSceneEdit(sceneEdit);
  const restore = event.target.closest('[data-rpg-restore]')?.dataset.rpgRestore;
  if (restore) return restorePossession(restore);
  const abilityRestore = event.target.closest('[data-rpg-ability-restore]')?.dataset.rpgAbilityRestore;
  if (abilityRestore) return restoreLearnedAbility(abilityRestore);
  const personRestore = event.target.closest('[data-rpg-person-restore]')?.dataset.rpgPersonRestore;
  if (personRestore) return restoreActor(personRestore);
  const questRestore = event.target.closest('[data-rpg-quest-restore]')?.dataset.rpgQuestRestore;
  if (questRestore) return restoreQuest(questRestore);
  const worldRestore = event.target.closest('[data-rpg-world-restore]')?.dataset.rpgWorldRestore;
  if (worldRestore) return restoreWorldRecord(worldRestore);
  const removeMeterKey = event.target.closest('[data-rpg-remove-meter]')?.dataset.rpgRemoveMeter;
  if (removeMeterKey) return removeMeter(removeMeterKey);
  const removeQuestStepKey = event.target.closest('[data-rpg-remove-quest-step]')?.dataset.rpgRemoveQuestStep;
  if (removeQuestStepKey) return removeQuestStep(removeQuestStepKey);
  const moveMeterControl = event.target.closest('[data-rpg-move-meter]');
  if (moveMeterControl) return moveDraftRow('meters', moveMeterControl.dataset.rpgMoveMeter, Number(moveMeterControl.dataset.delta));
  const moveQuestStepControl = event.target.closest('[data-rpg-move-quest-step]');
  if (moveQuestStepControl) return moveDraftRow('steps', moveQuestStepControl.dataset.rpgMoveQuestStep, Number(moveQuestStepControl.dataset.delta));
  const removePlaceConnectionKey = event.target.closest('[data-rpg-remove-place-connection]')?.dataset.rpgRemovePlaceConnection;
  if (removePlaceConnectionKey) return removePlaceConnection(removePlaceConnectionKey);
  const movePlaceConnectionControl = event.target.closest('[data-rpg-move-place-connection]');
  if (movePlaceConnectionControl) {
    return moveDraftRow('connections', movePlaceConnectionControl.dataset.rpgMovePlaceConnection, Number(movePlaceConnectionControl.dataset.delta));
  }
  const removeRowControl = event.target.closest('[data-rpg-remove-row]');
  if (removeRowControl) return removeDraftRow(removeRowControl.dataset.rpgRemoveRow, removeRowControl.dataset.rpgRowKey);
  const moveRowControl = event.target.closest('[data-rpg-move-row]');
  if (moveRowControl) {
    return moveDraftRow(moveRowControl.dataset.rpgMoveRow, moveRowControl.dataset.rpgRowKey, Number(moveRowControl.dataset.delta));
  }
  const relationshipEdit = event.target.closest('[data-rpg-relationship-edit]')?.dataset.rpgRelationshipEdit;
  if (relationshipEdit) return beginRelationshipEdit(relationshipEdit);
  const relationshipArchive = event.target.closest('[data-rpg-relationship-archive]')?.dataset.rpgRelationshipArchive;
  if (relationshipArchive) return archiveRelationship(relationshipArchive);
  const relationshipRestore = event.target.closest('[data-rpg-relationship-restore]')?.dataset.rpgRelationshipRestore;
  if (relationshipRestore) return restoreRelationship(relationshipRestore);
  const relationshipDelete = event.target.closest('[data-rpg-relationship-delete]')?.dataset.rpgRelationshipDelete;
  if (relationshipDelete) return deleteRelationship(relationshipDelete);
  const quantity = event.target.closest('[data-rpg-quantity]');
  if (quantity) return changeQuantity(quantity.dataset.rpgQuantity, Number(quantity.dataset.delta));
  const abilityUses = event.target.closest('[data-rpg-ability-uses]');
  if (abilityUses) return changeAbilityUses(abilityUses.dataset.rpgAbilityUses, Number(abilityUses.dataset.delta));
}

async function activateCurrentChat() {
  persistDraft();
  state.manualFocusIds = [];
  state.contextPacket = null;
  restoreCapsuleFromMetadata();
  if (!state.open) return;
  state.status = null;
  state.characterEntry = null;
  state.entries = [];
  state.archivedEntries = [];
  state.abilityEntries = [];
  state.archivedAbilityEntries = [];
  state.peopleEntries = [];
  state.archivedPeopleEntries = [];
  state.questEntries = [];
  state.archivedQuestEntries = [];
  state.factEntries = [];
  state.archivedFactEntries = [];
  state.placeEntries = [];
  state.archivedPlaceEntries = [];
  state.worldObjectEntries = [];
  state.archivedWorldObjectEntries = [];
  state.currentSceneEntry = null;
  state.sceneArchives = [];
  state.referenceOptions = [];
  state.relationshipEntries = [];
  state.archivedRelationshipEntries = [];
  state.actorOptions = [];
  state.selectedSceneId = null;
  state.draft = null;
  await openWorkspace(document.querySelector('#rpgcampaign-launcher'));
}

function mount() {
  if (document.querySelector(`#${ROOT_ID}`)) return;
  document.body.insertAdjacentHTML('beforeend', workspaceMarkup());
  restoreCapsuleFromMetadata();
  renderLayout();
  renderCollection();
  renderEditor();
  renderChatPreview();

  document.addEventListener('click', handleClick);
  root().querySelector('#rpgcampaign-form')?.addEventListener('input', handleFormInput);
  root().querySelector('#rpgcampaign-ability-form')?.addEventListener('input', handleFormInput);
  root().querySelector('#rpgcampaign-person-form')?.addEventListener('input', handleFormInput);
  root().querySelector('#rpgcampaign-character-form')?.addEventListener('input', handleFormInput);
  root().querySelector('#rpgcampaign-objective-form')?.addEventListener('input', handleFormInput);
  root().querySelector('#rpgcampaign-fact-form')?.addEventListener('input', handleFormInput);
  root().querySelector('#rpgcampaign-place-form')?.addEventListener('input', handleFormInput);
  root().querySelector('#rpgcampaign-world-object-form')?.addEventListener('input', handleFormInput);
  root().querySelector('#rpgcampaign-scene-form')?.addEventListener('input', handleFormInput);
  root().querySelector('#rpgcampaign-scene-advance-form')?.addEventListener('input', handleAdvanceInput);
  root().querySelector('#rpgcampaign-scene-advance-form')?.addEventListener('change', event => {
    if (event.target.matches('[data-rpg-carry-thread]')) toggleCarryThread(event.target.dataset.rpgCarryThread, event.target.checked);
  });
  root().querySelector('#rpgcampaign-quick-record-form')?.addEventListener('input', handleQuickRecordInput);
  root().querySelector('#rpgcampaign-relationship-form')?.addEventListener('input', handleRelationshipInput);
  root().querySelector('#rpgcampaign-search')?.addEventListener('input', event => {
    state.search = event.target.value.trim();
    renderCollection();
  });
  root().querySelector('#rpgcampaign-show-archived')?.addEventListener('change', event => {
    state.showArchived = event.target.checked;
    renderCollection();
  });
  root().querySelector('#rpgcampaign-world-kind')?.addEventListener('change', event => switchWorldKind(event.target.value));
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !state.open) return;
    if (state.draft?.advanceDraft) cancelAdvanceScene();
    else if (state.draft?.relationshipDraft) cancelRelationship();
    else closeWorkspace();
  });

  const context = getContext();
  const events = context?.eventTypes ?? context?.event_types;
  if (context?.eventSource && events?.CHAT_CHANGED) context.eventSource.on(events.CHAT_CHANGED, activateCurrentChat);
  if (context?.eventSource) {
    for (const eventName of ['MESSAGE_SENT', 'MESSAGE_EDITED', 'MESSAGE_DELETED', 'MESSAGE_SWIPED']) {
      if (events?.[eventName]) context.eventSource.on(events[eventName], refreshNarratorPrompt);
    }
    if (events?.MESSAGE_RECEIVED) context.eventSource.on(events.MESSAGE_RECEIVED, clearConsumedManualFocus);
    if (events?.GENERATION_AFTER_COMMANDS) {
      context.eventSource.on(events.GENERATION_AFTER_COMMANDS, () => {
        if (state.contextPacket) registerCapsule(state.contextPacket.text);
        else restoreCapsuleFromMetadata();
      });
    }
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
else mount();
