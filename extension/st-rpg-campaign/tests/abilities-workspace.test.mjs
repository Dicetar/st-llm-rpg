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

test('player can create a Learned Ability inside the Abilities collection', async () => {
  const { document, window } = parseHTML('<!doctype html><html><body></body></html>');
  const localStorage = memoryStorage();
  let serverEnvelope = null;
  const chatMetadata = {};
  const context = {
    chatId: 'workspace-abilities-chat',
    chat: [{ mes: 'A quiet test scene.', is_user: false, name: 'Narrator' }],
    chatMetadata,
    extensionSettings: { disabledExtensions: [], connectionManager: { profiles: [] } },
    characters: [{ name: 'Narrator', avatar: 'none.png' }],
    characterId: 0,
    getCurrentChatId: () => 'workspace-abilities-chat',
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
    localStorage,
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

  await import(`${new URL('../index.js', import.meta.url).href}?abilities=${Date.now()}`);
  document.querySelector('#rpgcampaign-launcher')
    .dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 20));

  const abilities = document.querySelector('[data-rpg-collection="abilities"]');
  assert.ok(abilities, 'Abilities must be a reachable collection, not a coming-soon label');
  abilities.dispatchEvent(new window.Event('click', { bubbles: true }));
  document.querySelector('[data-rpg-action="new-record"]')
    .dispatchEvent(new window.Event('click', { bubbles: true }));

  const form = document.querySelector('#rpgcampaign-ability-form');
  assert.equal(form.hidden, false);
  for (const [name, value] of Object.entries({
    name: 'Mage Hand',
    category: 'spell',
    summary: 'Manipulate a small unattended object at short range.',
    accessState: 'prepared',
    currentUses: '2',
    maxUses: '3',
  })) {
    const field = form.querySelector(`[name="${name}"]`);
    assert.ok(field, `Ability form must expose ${name}`);
    if (field.tagName === 'SELECT') {
      for (const option of field.options) {
        option.toggleAttribute('selected', option.getAttribute('value') === value);
      }
      assert.equal(field.value, value, field.outerHTML);
    } else {
      field.value = value;
    }
    field.dispatchEvent(new window.Event('input', { bubbles: true }));
  }
  document.querySelector('[data-rpg-action="save"]')
    .dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 30));

  const list = document.querySelector('#rpgcampaign-collection-list');
  assert.match(list.textContent, /Mage Hand/);
  assert.match(list.textContent, /prepared/);
  assert.equal(serverEnvelope.campaign.learnedAbilities.length, 1);
  assert.match(serverEnvelope.capsule.text, /Mage Hand \[spell; prepared; uses 2\/3\]/);

  document.querySelector('[data-rpg-action="new-record"]')
    .dispatchEvent(new window.Event('click', { bubbles: true }));
  const sourceMode = form.querySelector('[name="definitionMode"]');
  for (const option of sourceMode.options) option.toggleAttribute('selected', option.value === 'existing');
  sourceMode.dispatchEvent(new window.Event('input', { bubbles: true }));

  const existing = form.querySelector('[name="existingRecordId"]');
  const mageHand = [...existing.options].find(option => option.textContent === 'Mage Hand');
  assert.ok(mageHand, 'Existing Ability must be selectable inside the same editor');
  for (const option of existing.options) option.toggleAttribute('selected', option === mageHand);
  existing.dispatchEvent(new window.Event('input', { bubbles: true }));
  document.querySelector('[data-rpg-action="save"]')
    .dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 30));

  assert.equal(serverEnvelope.campaign.records.filter(record => record.kind === 'ability').length, 1);
  assert.equal(serverEnvelope.campaign.learnedAbilities.length, 2);
});
