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
    for (const option of field.options) option.toggleAttribute('selected', option.value === value);
  } else {
    field.value = value;
  }
  field.dispatchEvent(new window.Event('input', { bubbles: true }));
}

function setStructured(window, form, list, field, value) {
  const control = form.querySelector(`[data-rpg-draft-list="${list}"][data-rpg-draft-field="${field}"]`);
  assert.ok(control, `${list}.${field} must be editable`);
  if (control.tagName === 'SELECT') {
    for (const option of control.options) option.toggleAttribute('selected', option.value === value);
  } else {
    control.value = String(value);
  }
  control.dispatchEvent(new window.Event('input', { bubbles: true }));
}

async function wait(milliseconds = 35) {
  await new Promise(resolve => setTimeout(resolve, milliseconds));
}

test('Current Scene is edited in place and advances into immutable history as one Workspace journey', async () => {
  const { document, window } = parseHTML('<!doctype html><html><body></body></html>');
  let serverEnvelope = null;
  const chatMetadata = {};
  const context = {
    chatId: 'workspace-scene-chat',
    chat: [],
    chatMetadata,
    extensionSettings: { disabledExtensions: [], connectionManager: { profiles: [] } },
    characters: [{ name: 'Narrator', avatar: 'none.png' }],
    characterId: 0,
    getCurrentChatId: () => 'workspace-scene-chat',
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

  await import(`${new URL('../index.js', import.meta.url).href}?scene=${Date.now()}`);
  document.querySelector('#rpgcampaign-launcher').dispatchEvent(new window.Event('click', { bubbles: true }));
  await wait(20);
  document.querySelector('[data-rpg-collection="current_scene"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  document.querySelector('[data-rpg-action="new-record"]').dispatchEvent(new window.Event('click', { bubbles: true }));

  const sceneForm = document.querySelector('#rpgcampaign-scene-form');
  assert.equal(sceneForm.hidden, false);
  setField(window, sceneForm, 'title', 'Search the study');
  setField(window, sceneForm, 'summary', 'Find evidence before the steward returns.');

  sceneForm.querySelector('[data-rpg-quick-target="scenePlace"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  const quickForm = document.querySelector('#rpgcampaign-quick-record-form');
  setField(window, quickForm, 'name', 'Private study');
  quickForm.querySelector('[data-rpg-action="save-quick-record"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  await wait();

  sceneForm.querySelector('[data-rpg-action="add-scene-presence"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  setStructured(window, sceneForm, 'presences', 'role', 'investigator');
  sceneForm.querySelector('[data-rpg-action="add-scene-exit"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  setStructured(window, sceneForm, 'exits', 'label', 'Hall door');
  setStructured(window, sceneForm, 'exits', 'status', 'closed');
  sceneForm.querySelector('[data-rpg-action="add-scene-obstacle"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  setStructured(window, sceneForm, 'obstacles', 'label', 'Locked cabinet');
  sceneForm.querySelector('[data-rpg-action="add-scene-countdown"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  setStructured(window, sceneForm, 'countdowns', 'label', 'Steward returns');
  setStructured(window, sceneForm, 'countdowns', 'current', 1);
  sceneForm.querySelector('[data-rpg-action="add-scene-thread"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  setStructured(window, sceneForm, 'openThreads', 'label', 'Find the ledger');

  document.querySelector('[data-rpg-action="save"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  await wait();
  assert.equal(serverEnvelope.campaign.currentScene.title, 'Search the study');
  assert.equal(serverEnvelope.campaign.currentScene.placeId, serverEnvelope.campaign.records.find(record => record.name === 'Private study').id);
  assert.equal(serverEnvelope.campaign.currentScene.presences.length, 1);

  document.querySelector('[data-rpg-action="begin-advance-scene"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  const advanceForm = document.querySelector('#rpgcampaign-scene-advance-form');
  assert.equal(document.querySelector('#rpgcampaign-scene-advance').hidden, false);
  setField(window, advanceForm, 'title', 'Follow the hidden passage');
  setField(window, advanceForm, 'summary', 'Descend before pursuit arrives.');
  advanceForm.querySelector('[data-rpg-action="confirm-advance-scene"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  await wait();

  assert.deepEqual({
    current: serverEnvelope.campaign.currentScene.title,
    archives: serverEnvelope.campaign.sceneArchives.map(archive => archive.title),
    carried: serverEnvelope.campaign.currentScene.openThreads.map(thread => [thread.label, thread.status]),
    archiveVisible: document.querySelector('#rpgcampaign-collection-list').textContent.includes('Search the study'),
    editorVisible: document.querySelector('#rpgcampaign-editor-title').textContent,
  }, {
    current: 'Follow the hidden passage',
    archives: ['Search the study'],
    carried: [['Find the ledger', 'carried']],
    archiveVisible: true,
    editorVisible: 'Follow the hidden passage',
  });
});
