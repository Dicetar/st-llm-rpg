import test from 'node:test';
import assert from 'node:assert/strict';

import { createCampaignSession, createMemoryCampaignStorage } from '../campaign-session.js';

test('Context Capsule enforces hard budgets and pin/exclude recompiles verified text', async () => {
  let sequence = 0;
  const session = createCampaignSession({
    storage: createMemoryCampaignStorage(),
    createId: kind => `${kind}-${++sequence}`,
    now: () => `2026-08-04T00:00:${String(sequence % 60).padStart(2, '0')}.000Z`,
  });
  let revision = (await session.open({ chatId: 'context-budget-chat' })).revision;
  for (let index = 0; index < 40; index += 1) {
    const result = await session.execute({
      type: 'create_fact',
      fact: {
        name: `Fact ${String(index).padStart(2, '0')}`,
        proposition: `Fact ${index} ${'contains durable campaign detail '.repeat(7)}`,
        importance: 'normal',
      },
    }, revision);
    revision = result.revision;
  }

  let capsule = session.query({ collection: 'context_capsule' }).capsule;
  assert.ok(capsule.text.length <= capsule.diagnostics.maxChars);
  assert.equal(capsule.diagnostics.overflow, true);
  const omitted = capsule.diagnostics.omitted.find(record => record.kind === 'fact' && record.reason.includes('budget'));
  assert.ok(omitted, 'At least one Fact should be omitted by the World section budget');
  const omittedFact = session.query({ collection: 'facts' }).entries.find(entry => entry.fact.id === omitted.recordId).fact;

  let changed = await session.execute({
    type: 'set_context_policy',
    recordId: omittedFact.id,
    contextPolicy: 'pinned',
  }, revision);
  revision = changed.revision;
  capsule = session.query({ collection: 'context_capsule' }).capsule;
  assert.equal(capsule.text.includes(omittedFact.proposition), true);
  assert.equal(capsule.diagnostics.selected.some(record => record.id === omittedFact.id && record.policy === 'pinned'), true);

  changed = await session.execute({
    type: 'set_context_policy',
    recordId: omittedFact.id,
    contextPolicy: 'excluded',
  }, revision);
  capsule = session.query({ collection: 'context_capsule' }).capsule;
  assert.equal(capsule.text.includes(omittedFact.proposition), false);
  assert.equal(capsule.diagnostics.omitted.some(record => record.recordId === omittedFact.id && record.reason === 'excluded'), true);
  assert.equal(changed.capsule, capsule.text);
});

test('large Inventory stays a compact roster while pinned records receive bounded detail', async () => {
  let sequence = 0;
  const session = createCampaignSession({
    storage: createMemoryCampaignStorage(),
    createId: kind => `${kind}-${++sequence}`,
    now: () => `2026-08-04T01:00:${String(sequence % 60).padStart(2, '0')}.000Z`,
  });
  const opened = await session.open({ chatId: 'large-inventory-chat' });
  let revision = opened.revision;
  for (let index = 1; index <= 12; index += 1) {
    const changed = await session.execute({
      type: 'create_item_and_possession',
      item: {
        name: `Travel item ${String(index).padStart(2, '0')}`,
        summary: `Unique detail ${index}. ${'A deliberately verbose description that stays in the record rather than every narrator prompt. '.repeat(4)}`,
      },
      possession: {
        ownerActorId: opened.playerCharacterId,
        quantity: index,
        carriedState: index === 12 ? 'worn' : 'carried',
        equippedSlots: index === 12 ? ['cloak'] : [],
      },
    }, revision);
    revision = changed.revision;
  }

  let capsule = session.query({ collection: 'context_capsule' }).capsule;
  const inventory = capsule.diagnostics.sections.find(section => section.key === 'inventory');
  assert.equal(inventory.selectedCount, 12);
  assert.equal(inventory.omittedCount, 0);
  assert.ok(inventory.usedChars <= inventory.maxChars);
  assert.doesNotMatch(capsule.text, /Unique detail/);
  for (let index = 1; index <= 12; index += 1) {
    assert.match(capsule.text, new RegExp(`Travel item ${String(index).padStart(2, '0')}`));
  }

  const pinnedItem = session.query({ collection: 'inventory' }).entries[0].item;
  await session.execute({
    type: 'set_context_policy',
    recordId: pinnedItem.id,
    contextPolicy: 'pinned',
  }, revision);
  capsule = session.query({ collection: 'context_capsule' }).capsule;
  assert.doesNotMatch(capsule.text, /Unique detail 1\./);
  assert.equal(capsule.diagnostics.selected.some(record => record.id === pinnedItem.id && record.policy === 'pinned'), true);
  assert.ok(capsule.text.length <= capsule.diagnostics.maxChars);
});
