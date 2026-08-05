import test from 'node:test';
import assert from 'node:assert/strict';

import { compileNarratorContext } from '../context-router.js';

function campaignFixture() {
  const player = { id: 'actor-player', kind: 'actor', role: 'player_character', name: 'Mira', summary: 'A careful investigator.', category: 'player-character', tags: [], contextPolicy: 'automatic', archivedAt: null };
  const lavir = { id: 'actor-lavir', kind: 'actor', role: 'npc', name: 'Lavir', aliases: ['Court mage'], summary: 'A suspicious court mage.', details: 'Lavir values precise evidence over promises.', personality: 'Controlled and exacting.', category: 'npc', tags: ['court'], contextPolicy: 'automatic', archivedAt: null };
  const place = { id: 'place-study', kind: 'place', name: 'Private Study', summary: 'A sealed room of ledgers.', details: 'The west cabinet hides a narrow gap.', atmosphere: 'Dusty and tense.', category: 'room', tags: ['estate'], connections: [], contextPolicy: 'automatic', archivedAt: null };
  const items = Array.from({ length: 12 }, (_, offset) => {
    const index = offset + 1;
    return {
      id: `item-${index}`,
      kind: 'item',
      name: `Travel item ${String(index).padStart(2, '0')}`,
      summary: `Unique item detail ${index}: ${index === 7 ? 'a fine blade suited to cutting rope' : 'ordinary expedition gear'}.`,
      details: `Private construction notes for item ${index}.`,
      category: index === 7 ? 'tool' : 'gear',
      tags: index === 7 ? ['blade', 'rope'] : ['travel'],
      contextPolicy: 'automatic',
      archivedAt: null,
    };
  });
  const ability = {
    id: 'ability-mage-hand', kind: 'ability', name: 'Mage Hand', summary: 'Manipulate a small unattended object at short range.', details: 'The hand is visibly spectral.',
    usage: 'Conjure and precisely direct a spectral hand.', limits: 'Cannot attack or carry heavy objects.', category: 'spell', tags: ['arcane', 'telekinesis'], contextPolicy: 'automatic', archivedAt: null,
  };
  const quest = {
    id: 'quest-witness', kind: 'quest', name: 'Find the Witness', summary: 'Locate the missing court witness.', details: 'The witness last visited the estate.', status: 'active', stakes: 'Lavir will withdraw his support.', outcome: '', category: 'investigation', tags: ['witness'],
    steps: [{ id: 'step-1', label: 'Search the private study', status: 'active', notes: 'Look behind the cabinet.' }], involvedRefs: [{ kind: 'actor', id: lavir.id }, { kind: 'place', id: place.id }], contextPolicy: 'automatic', archivedAt: null,
  };
  const possessions = items.map((item, offset) => ({
    id: `possession-${offset + 1}`, kind: 'possession', ownerActorId: player.id, itemId: item.id, quantity: 1, carriedState: 'carried', equippedSlots: [], condition: '', notes: '', archivedAt: null,
  }));
  return {
    schemaVersion: 1,
    instanceId: 'campaign-1',
    revision: 7,
    commitId: 'commit-7',
    playerCharacterId: player.id,
    records: [player, lavir, place, ...items, ability, quest],
    possessions,
    learnedAbilities: [{ id: 'learned-mage-hand', kind: 'learned_ability', actorId: player.id, abilityId: ability.id, accessState: 'prepared', currentUses: 2, maxUses: 3, notes: '', archivedAt: null }],
    relationships: [{ id: 'relationship-lavir', sourceActorId: player.id, targetActorId: lavir.id, relationshipKind: 'patron', status: 'strained', dimensions: { trust: -1 }, notes: 'Lavir expects proof.', archivedAt: null }],
    currentScene: {
      id: 'scene-1', title: 'The private study', summary: 'Mira searches while Lavir watches.', placeId: place.id,
      presences: [{ id: 'presence-lavir', subjectRef: { kind: 'actor', id: lavir.id }, role: 'observer', state: 'present', notes: '' }],
      exits: [], obstacles: [], countdowns: [], openThreads: [],
    },
  };
}

test('Narrator Context keeps a compact large Inventory index and retrieves one named Item in detail', () => {
  const campaign = campaignFixture();
  const packet = compileNarratorContext(campaign, {
    messages: [{ is_user: true, mes: 'I use Travel item 07 to cut the rope.' }],
  });

  assert.ok(packet.text.length <= 8_000);
  for (let index = 1; index <= 12; index += 1) {
    assert.match(packet.text, new RegExp(`Travel item ${String(index).padStart(2, '0')}`));
  }
  assert.match(packet.text, /ITEM DETAIL · Travel item 07/);
  assert.match(packet.text, /fine blade suited to cutting rope/);
  assert.doesNotMatch(packet.text, /Unique item detail 6/);
  const focused = packet.diagnostics.focus.find(record => record.id === 'item-7');
  assert.ok(focused);
  assert.match(focused.reason, /exact name in the latest message/);
});

test('recent explicit mentions retain Ability detail across a pronoun-only follow-up', () => {
  const packet = compileNarratorContext(campaignFixture(), {
    messages: [
      { is_user: true, mes: 'Could Mage Hand reach the lever?' },
      { is_user: false, mes: 'Mage Hand curls around the lever.' },
      { is_user: true, mes: 'Use it again.' },
    ],
  });

  assert.match(packet.text, /ABILITY DETAIL · Mage Hand/);
  assert.match(packet.text, /Cannot attack or carry heavy objects/);
  assert.match(packet.diagnostics.focus.find(record => record.id === 'ability-mage-hand').reason, /mentioned recently/);
});

test('manual next-reply focus is deterministic and Quest links expand one hop', () => {
  const campaign = campaignFixture();
  const packet = compileNarratorContext(campaign, {
    messages: [{ is_user: true, mes: 'We continue the investigation.' }],
    manualFocusIds: ['item-3', 'quest-witness'],
  });

  assert.match(packet.text, /ITEM DETAIL · Travel item 03/);
  assert.match(packet.text, /QUEST DETAIL · Find the Witness/);
  assert.match(packet.text, /ACTOR DETAIL · Lavir/);
  assert.equal(packet.diagnostics.focus.find(record => record.id === 'item-3').manual, true);
  assert.match(packet.diagnostics.focus.find(record => record.id === 'actor-lavir').reason, /linked to Find the Witness|present in the Current Scene/);
  assert.ok(packet.text.length <= packet.diagnostics.maxChars);
});
