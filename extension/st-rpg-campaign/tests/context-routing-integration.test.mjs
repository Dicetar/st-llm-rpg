import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

import { compileContextCapsuleDetailed } from '../context-capsule.js';

test('SillyTavern message events replace the registered prompt with deterministic focused detail', async () => {
  const { document, window } = parseHTML('<!doctype html><html><body></body></html>');
  const campaign = {
    schemaVersion: 1,
    instanceId: 'campaign-routing',
    binding: { chatId: 'routing-chat' },
    revision: 3,
    commitId: 'commit-routing-3',
    playerCharacterId: 'actor-player',
    records: [
      { id: 'actor-player', kind: 'actor', role: 'player_character', name: 'Mira', summary: '', category: 'player-character', tags: [], contextPolicy: 'automatic', archivedAt: null },
      { id: 'item-key', kind: 'item', name: 'Wardrobe Key', summary: 'A narrow iron key for the private wardrobe.', details: 'Its bow bears House Harcourt marks.', category: 'key', tags: ['wardrobe'], contextPolicy: 'automatic', archivedAt: null },
      { id: 'ability-hand', kind: 'ability', name: 'Mage Hand', summary: 'Manipulate a small unattended object.', usage: 'Conjure a spectral hand at range.', limits: 'Cannot attack.', category: 'spell', tags: ['arcane'], contextPolicy: 'automatic', archivedAt: null },
    ],
    possessions: [{ id: 'possession-key', ownerActorId: 'actor-player', itemId: 'item-key', quantity: 1, carriedState: 'carried', equippedSlots: [], condition: '', notes: '', archivedAt: null }],
    learnedAbilities: [{ id: 'learned-hand', actorId: 'actor-player', abilityId: 'ability-hand', accessState: 'prepared', currentUses: 2, maxUses: 3, notes: '', archivedAt: null }],
    relationships: [], events: [], sceneArchives: [], proposals: [], pendingSyncReview: null, currentScene: null, syncBoundary: null,
  };
  const compiled = compileContextCapsuleDetailed(campaign);
  const chatMetadata = {
    stLlmRpgCampaign: {
      envelopeVersion: 1,
      campaign,
      capsule: { campaignRevision: campaign.revision, commitId: campaign.commitId, text: compiled.text, diagnostics: compiled.diagnostics },
    },
  };
  const listeners = new Map();
  const prompts = [];
  const context = {
    chatId: 'routing-chat',
    getCurrentChatId: () => 'routing-chat',
    chat: [{ is_user: true, mes: 'I turn the Wardrobe Key.' }],
    chatMetadata,
    extensionSettings: {},
    setExtensionPrompt(_key, text) { prompts.push(text); },
    eventSource: { on(name, callback) { listeners.set(name, callback); } },
    eventTypes: {
      CHAT_CHANGED: 'chat_changed', MESSAGE_SENT: 'message_sent', MESSAGE_RECEIVED: 'message_received', MESSAGE_EDITED: 'message_edited', MESSAGE_DELETED: 'message_deleted', MESSAGE_SWIPED: 'message_swiped', GENERATION_AFTER_COMMANDS: 'generation_after_commands',
    },
  };
  Object.assign(globalThis, {
    document,
    window,
    HTMLElement: window.HTMLElement,
    Event: window.Event,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    toastr: { error() {}, warning() {}, info() {}, success() {} },
  });
  globalThis.SillyTavern = { getContext: () => context };

  await import(`${new URL('../index.js', import.meta.url).href}?routing=${Date.now()}`);
  assert.match(prompts.at(-1), /ITEM DETAIL · Wardrobe Key/);
  assert.match(prompts.at(-1), /House Harcourt marks/);

  context.chat.push({ is_user: true, mes: 'Now I cast Mage Hand.' });
  listeners.get('message_sent')?.(1);
  assert.match(prompts.at(-1), /ABILITY DETAIL · Mage Hand/);
  assert.match(prompts.at(-1), /Cannot attack/);
  assert.ok(prompts.at(-1).length <= 8_000);
});
