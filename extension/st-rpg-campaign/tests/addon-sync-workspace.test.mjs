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

test('Workspace syncs the installed JSON addon bundle through Campaign Session', async () => {
  const { document, window } = parseHTML('<!doctype html><html><body></body></html>');
  let serverEnvelope = null;
  const chatMetadata = {};
  const bundle = {
    bundleVersion: 1,
    sources: ['test_addon.json'],
    character: null,
    items: [{ id: 'field-journal', name: 'Field journal', summary: 'A compact notebook.', quantity: 1 }],
    abilities: [],
    people: [{ id: 'lavir', name: 'Lavir', summary: 'A precise court mage.' }],
    relationships: [{ id: 'player-knows-lavir', source: '$player', target: 'lavir', kind: 'contact', status: 'active' }],
    quests: [],
    facts: [],
    places: [],
    worldObjects: [],
    scene: null,
  };
  const context = {
    chatId: 'workspace-addon-chat',
    chat: [],
    chatMetadata,
    extensionSettings: { disabledExtensions: [], connectionManager: { profiles: [] } },
    characters: [{ name: 'Narrator', avatar: 'none.png' }],
    characterId: 0,
    getCurrentChatId: () => 'workspace-addon-chat',
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
    fetch: async input => {
      if (String(input).includes('content-bundle.json')) {
        return { ok: true, status: 200, json: async () => structuredClone(bundle) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => serverEnvelope ? [{ chat_metadata: { stLlmRpgCampaign: structuredClone(serverEnvelope) } }] : [],
      };
    },
    confirm: () => true,
    toastr: { error() {}, warning() {}, info() {}, success() {} },
  });
  globalThis.SillyTavern = { getContext: () => context };

  await import(`${new URL('../index.js', import.meta.url).href}?addons=${Date.now()}`);
  document.querySelector('#rpgcampaign-launcher').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 20));
  document.querySelector('[data-rpg-action="sync-addons"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 35));

  assert.equal(serverEnvelope.campaign.possessions.length, 1);
  assert.equal(serverEnvelope.campaign.relationships.length, 1);
  assert.match(serverEnvelope.capsule.text, /Field journal ×1/);
  assert.match(serverEnvelope.capsule.text, /Player Character -> Lavir \[contact; active\]/);
  assert.match(document.querySelector('#rpgcampaign-collection-list').textContent, /Field journal/);
});
