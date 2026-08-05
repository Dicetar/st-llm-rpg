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

test('player creates an NPC and adds a directed Relationship inside the same editor', async () => {
  const { document, window } = parseHTML('<!doctype html><html><body></body></html>');
  let serverEnvelope = null;
  const chatMetadata = {};
  const context = {
    chatId: 'workspace-people-chat',
    chat: [{ mes: 'Lavir waits by the cabinet.', is_user: false, name: 'Narrator' }],
    chatMetadata,
    extensionSettings: { disabledExtensions: [], connectionManager: { profiles: [] } },
    characters: [{ name: 'Narrator', avatar: 'none.png' }],
    characterId: 0,
    getCurrentChatId: () => 'workspace-people-chat',
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

  await import(`${new URL('../index.js', import.meta.url).href}?people=${Date.now()}`);
  document.querySelector('#rpgcampaign-launcher').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 20));

  document.querySelector('[data-rpg-collection="people"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  document.querySelector('[data-rpg-action="new-record"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  const personForm = document.querySelector('#rpgcampaign-person-form');
  assert.equal(personForm.hidden, false);
  setField(window, personForm, 'name', 'Lavir');
  setField(window, personForm, 'pronouns', 'he/him');
  setField(window, personForm, 'summary', 'A precise court mage searching for a missing witness.');
  document.querySelector('[data-rpg-action="save"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 30));

  assert.match(document.querySelector('#rpgcampaign-collection-list').textContent, /Lavir/);
  const relationships = document.querySelector('#rpgcampaign-relationships');
  assert.equal(relationships.hidden, false);
  relationships.querySelector('[data-rpg-action="new-relationship"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  const relationshipForm = document.querySelector('#rpgcampaign-relationship-form');
  assert.equal(relationshipForm.hidden, false);
  setField(window, relationshipForm, 'relationshipKind', 'employer');
  setField(window, relationshipForm, 'trust', '2');
  relationships.querySelector('[data-rpg-action="save-relationship"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 30));

  assert.match(document.querySelector('#rpgcampaign-relationship-list').textContent, /Player Character → Lavir/);
  assert.equal(serverEnvelope.campaign.relationships.length, 1);
  assert.match(serverEnvelope.capsule.text, /Player Character -> Lavir \[employer; active; trust 2\]/);
});
