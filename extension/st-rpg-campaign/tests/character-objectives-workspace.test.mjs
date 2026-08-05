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

function setStructuredField(window, form, list, index, field, value) {
  const control = form.querySelector(`[data-rpg-draft-list="${list}"][data-rpg-draft-index="${index}"][data-rpg-draft-field="${field}"]`);
  assert.ok(control, `Structured ${list}.${index}.${field} field must exist`);
  if (control.tagName === 'SELECT') {
    for (const option of control.options) option.toggleAttribute('selected', option.getAttribute('value') === value);
  } else {
    control.value = value;
  }
  control.dispatchEvent(new window.Event('input', { bubbles: true }));
}

test('Character meters and Objective steps are created inside their own Workspace editors', async () => {
  const { document, window } = parseHTML('<!doctype html><html><body></body></html>');
  let serverEnvelope = null;
  const chatMetadata = {};
  const context = {
    chatId: 'workspace-character-objectives-chat',
    chat: [{ mes: 'The private wing is quiet.', is_user: false, name: 'Narrator' }],
    chatMetadata,
    extensionSettings: { disabledExtensions: [], connectionManager: { profiles: [] } },
    characters: [{ name: 'Narrator', avatar: 'none.png' }],
    characterId: 0,
    getCurrentChatId: () => 'workspace-character-objectives-chat',
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

  await import(`${new URL('../index.js', import.meta.url).href}?character-objectives=${Date.now()}`);
  document.querySelector('#rpgcampaign-launcher').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 20));

  document.querySelector('[data-rpg-collection="character"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  const characterForm = document.querySelector('#rpgcampaign-character-form');
  assert.equal(characterForm.hidden, false);
  setField(window, characterForm, 'name', 'Mira');
  setField(window, characterForm, 'pronouns', 'she/her');
  setField(window, characterForm, 'summary', 'A stubborn hedge mage.');
  characterForm.querySelector('[data-rpg-action="add-meter"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  setStructuredField(window, characterForm, 'meters', 0, 'label', 'Resolve');
  setStructuredField(window, characterForm, 'meters', 0, 'current', '2');
  setStructuredField(window, characterForm, 'meters', 0, 'max', '4');
  document.querySelector('[data-rpg-action="save"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 30));

  document.querySelector('[data-rpg-collection="objectives"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  document.querySelector('[data-rpg-action="new-record"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  const objectiveForm = document.querySelector('#rpgcampaign-objective-form');
  assert.equal(objectiveForm.hidden, false);
  setField(window, objectiveForm, 'name', 'Find the witness');
  setField(window, objectiveForm, 'status', 'active');
  setField(window, objectiveForm, 'summary', 'Locate the missing court witness.');
  objectiveForm.querySelector('[data-rpg-action="add-quest-step"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  setStructuredField(window, objectiveForm, 'steps', 0, 'label', 'Search the private wing');
  setStructuredField(window, objectiveForm, 'steps', 0, 'status', 'active');
  document.querySelector('[data-rpg-action="save"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 35));

  const player = serverEnvelope.campaign.records.find(record => record.id === serverEnvelope.campaign.playerCharacterId);
  const quest = serverEnvelope.campaign.records.find(record => record.kind === 'quest');
  assert.deepEqual({
    character: [player.name, player.meters[0].label, player.meters[0].current, player.meters[0].max],
    quest: [quest.name, quest.status, quest.steps[0].label, quest.steps[0].status],
    list: document.querySelector('#rpgcampaign-collection-list').textContent.includes('Find the witness'),
    capsule: serverEnvelope.capsule.text.includes('Meters: Resolve 2/4')
      && serverEnvelope.capsule.text.includes('Find the witness [active]')
      && serverEnvelope.capsule.text.includes('next: Search the private wing [active]'),
  }, {
    character: ['Mira', 'Resolve', 2, 4],
    quest: ['Find the witness', 'active', 'Search the private wing', 'active'],
    list: true,
    capsule: true,
  });
});
