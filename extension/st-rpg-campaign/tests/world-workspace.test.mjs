import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

function setField(window, form, name, value) {
  const field = form.querySelector(`[name="${name}"]`);
  assert.ok(field, `Form must expose ${name}`);
  if (field.tagName === 'SELECT') {
    for (const option of field.options) option.toggleAttribute('selected', option.getAttribute('value') === value);
  } else {
    field.value = value;
  }
  field.dispatchEvent(new window.Event('input', { bubbles: true }));
}

async function save(window, document) {
  document.querySelector('[data-rpg-action="save"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 30));
}

function selectWorldKind(window, document, value) {
  const select = document.querySelector('#rpgcampaign-world-kind');
  for (const option of select.options) option.toggleAttribute('selected', option.value === value);
  select.dispatchEvent(new window.Event('change', { bubbles: true }));
}

test('World collection creates Places, connections, Objects, and typed Facts without syntax', async () => {
  const { document, window } = parseHTML('<!doctype html><html><body></body></html>');
  let serverEnvelope = null;
  const chatMetadata = {};
  const context = {
    chatId: 'workspace-world-chat',
    chat: [],
    chatMetadata,
    extensionSettings: { disabledExtensions: [], connectionManager: { profiles: [] } },
    characters: [{ name: 'Narrator', avatar: 'none.png' }],
    characterId: 0,
    getCurrentChatId: () => 'workspace-world-chat',
    getRequestHeaders: () => ({}),
    async saveMetadata() {
      serverEnvelope = structuredClone(chatMetadata.stLlmRpgCampaign);
    },
    setExtensionPrompt() {},
    saveSettingsDebounced() {},
    eventSource: { on() {} },
    eventTypes: { CHAT_CHANGED: 'chat_changed' },
    ConnectionManagerRequestService: { getSupportedProfiles: () => [] },
  };

  Object.assign(globalThis, {
    document,
    window,
    HTMLElement: window.HTMLElement,
    Event: window.Event,
    localStorage: memoryStorage(),
    fetch: async () => ({
      ok: true,
      async json() {
        return serverEnvelope ? [{ chat_metadata: { stLlmRpgCampaign: structuredClone(serverEnvelope) } }] : [];
      },
    }),
    confirm: () => true,
    toastr: { error() {}, warning() {}, info() {}, success() {} },
  });
  globalThis.SillyTavern = { getContext: () => context };

  await import(`${new URL('../index.js', import.meta.url).href}?world=${Date.now()}`);
  document.querySelector('#rpgcampaign-launcher').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 20));
  document.querySelector('[data-rpg-collection="world"]').dispatchEvent(new window.Event('click', { bubbles: true }));

  selectWorldKind(window, document, 'place');
  document.querySelector('[data-rpg-action="new-record"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  let placeForm = document.querySelector('#rpgcampaign-place-form');
  assert.equal(placeForm.hidden, false);
  setField(window, placeForm, 'name', 'Harcourt Estate');
  setField(window, placeForm, 'summary', 'An old noble estate.');
  setField(window, placeForm, 'contextPolicy', 'pinned');
  await save(window, document);
  const estate = serverEnvelope.campaign.records.find(record => record.kind === 'place' && record.name === 'Harcourt Estate');

  document.querySelector('[data-rpg-action="new-record"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  placeForm = document.querySelector('#rpgcampaign-place-form');
  setField(window, placeForm, 'name', 'Private study');
  setField(window, placeForm, 'parentPlaceId', estate.id);
  await save(window, document);
  const study = serverEnvelope.campaign.records.find(record => record.kind === 'place' && record.name === 'Private study');

  document.querySelector(`[data-rpg-world-edit="${estate.id}"]`).dispatchEvent(new window.Event('click', { bubbles: true }));
  placeForm.querySelector('[data-rpg-action="add-place-connection"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  setField(window, placeForm, 'name', 'Harcourt Estate');
  const destination = placeForm.querySelector('[data-rpg-draft-list="connections"][data-rpg-draft-field="targetPlaceId"]');
  for (const option of destination.options) option.toggleAttribute('selected', option.value === study.id);
  destination.dispatchEvent(new window.Event('input', { bubbles: true }));
  const kind = placeForm.querySelector('[data-rpg-draft-list="connections"][data-rpg-draft-field="connectionKind"]');
  kind.value = 'locked door';
  kind.dispatchEvent(new window.Event('input', { bubbles: true }));
  await save(window, document);

  selectWorldKind(window, document, 'world_object');
  document.querySelector('[data-rpg-action="new-record"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  const objectForm = document.querySelector('#rpgcampaign-world-object-form');
  setField(window, objectForm, 'name', 'Sealed cabinet');
  setField(window, objectForm, 'summary', 'A heavy cabinet over mismatched paneling.');
  setField(window, objectForm, 'state', 'locked');
  setField(window, objectForm, 'contextPolicy', 'pinned');
  objectForm.querySelector('[data-rpg-quick-target="homePlaceId"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  const quickForm = document.querySelector('#rpgcampaign-quick-record-form');
  setField(window, quickForm, 'name', 'Hidden vault');
  quickForm.querySelector('[data-rpg-action="save-quick-record"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 35));
  const vault = serverEnvelope.campaign.records.find(record => record.kind === 'place' && record.name === 'Hidden vault');
  await save(window, document);
  const worldObject = serverEnvelope.campaign.records.find(record => record.kind === 'world_object');

  selectWorldKind(window, document, 'fact');
  document.querySelector('[data-rpg-action="new-record"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  const factForm = document.querySelector('#rpgcampaign-fact-form');
  setField(window, factForm, 'name', 'Cabinet hides a passage');
  setField(window, factForm, 'proposition', 'The sealed cabinet conceals an old service passage.');
  setField(window, factForm, 'importance', 'critical');
  setField(window, factForm, 'subjectKey', `world_object:${worldObject.id}`);
  await save(window, document);

  const records = serverEnvelope.campaign.records;
  const savedEstate = records.find(record => record.id === estate.id);
  const savedStudy = records.find(record => record.id === study.id);
  const savedObject = records.find(record => record.id === worldObject.id);
  const savedFact = records.find(record => record.kind === 'fact');
  assert.deepEqual({
    parent: savedStudy.parentPlaceId === estate.id,
    connection: [savedEstate.connections[0].targetPlaceId === study.id, savedEstate.connections[0].connectionKind],
    object: [savedObject.homePlaceId === vault.id, savedObject.state],
    fact: [savedFact.subjectRef.id === worldObject.id, savedFact.importance],
    list: document.querySelector('#rpgcampaign-collection-list').textContent.includes('Cabinet hides a passage'),
    capsule: serverEnvelope.capsule.text.includes('Fact [critical]: The sealed cabinet conceals an old service passage.'),
  }, {
    parent: true,
    connection: [true, 'locked door'],
    object: [true, 'locked'],
    fact: [true, 'critical'],
    list: true,
    capsule: true,
  });
});
