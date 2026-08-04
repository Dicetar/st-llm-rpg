import test from 'node:test';
import assert from 'node:assert/strict';

import { createCampaignSession } from '../campaign-session.js';
import { createSillyTavernCampaignStorage } from '../sillytavern-storage.js';

function memoryJournal() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
}

test('failed SillyTavern acknowledgement keeps the verified Campaign and exposes the candidate as recoverable', async () => {
  let serverEnvelope = null;
  let swallowNextSave = false;
  let id = 0;
  const context = {
    chatMetadata: {},
    async saveMetadata() {
      if (swallowNextSave) {
        swallowNextSave = false;
        return;
      }
      serverEnvelope = structuredClone(this.chatMetadata.stLlmRpgCampaign ?? null);
    },
  };
  const storage = createSillyTavernCampaignStorage({
    getContext: () => context,
    readServerEnvelope: async () => structuredClone(serverEnvelope),
    journalStorage: memoryJournal(),
  });
  const session = createCampaignSession({
    storage,
    createId: kind => `${kind}-${++id}`,
    now: () => '2026-08-02T16:00:00.000Z',
  });
  const opened = await session.open({ chatId: 'chat-save-failure' });
  await session.execute({
    type: 'create_item_and_possession',
    item: { name: 'Silk rope', summary: 'Ten metres of braided silk.' },
    possession: {
      ownerActorId: opened.playerCharacterId,
      quantity: 1,
      carriedState: 'carried',
      equippedSlots: [],
    },
  }, opened.revision);

  swallowNextSave = true;
  await assert.rejects(
    session.execute({
      type: 'update_possession',
      possessionId: session.query({ collection: 'inventory' }).entries[0].possession.id,
      changes: { quantity: 2 },
    }, 2),
    error => error.code === 'campaign_not_saved' && error.recoverable === true,
  );

  const inventory = session.query({ collection: 'inventory' });
  const recovery = storage.getRecovery({ chatId: 'chat-save-failure' });
  assert.deepEqual({
    revision: inventory.revision,
    quantity: inventory.entries[0].possession.quantity,
    recoverableRevision: recovery?.candidate?.campaign?.revision,
    baseCommitId: recovery?.baseCommitId,
  }, {
    revision: 2,
    quantity: 1,
    recoverableRevision: 3,
    baseCommitId: serverEnvelope.campaign.commitId,
  });
});
