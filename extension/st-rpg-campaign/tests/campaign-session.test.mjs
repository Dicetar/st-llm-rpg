import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCampaignSession,
  createMemoryCampaignStorage,
} from '../campaign-session.js';

function deterministicIds() {
  const counters = new Map();
  return kind => {
    const next = (counters.get(kind) ?? 0) + 1;
    counters.set(kind, next);
    return `${kind}-${next}`;
  };
}

test('player can create an Item and add it to Inventory as one verified operation', async () => {
  const storage = createMemoryCampaignStorage();
  const ids = deterministicIds();
  const firstSession = createCampaignSession({ storage, createId: ids, now: () => '2026-08-02T12:00:00.000Z' });

  const opened = await firstSession.open({ chatId: 'chat-lavir', title: 'Lavir' });
  const created = await firstSession.execute({
    type: 'create_item_and_possession',
    item: {
      name: 'Wardrobe key',
      summary: 'A small iron key taken from the east dressing room.',
      category: 'key',
      tags: ['house-harcourt'],
    },
    possession: {
      ownerActorId: opened.playerCharacterId,
      quantity: 1,
      carriedState: 'carried',
      equippedSlots: [],
      notes: '',
    },
  }, opened.revision);

  const inventory = firstSession.query({ collection: 'inventory' });
  const reopenedSession = createCampaignSession({ storage, createId: ids, now: () => '2026-08-02T12:01:00.000Z' });
  const reopened = await reopenedSession.open({ chatId: 'chat-lavir', title: 'Lavir' });

  assert.deepEqual({
    result: {
      revision: created.revision,
      affectedKinds: created.affectedKinds,
      undoEligible: created.undoEligible,
    },
    inventory: inventory.entries.map(entry => ({
      name: entry.item.name,
      summary: entry.item.summary,
      quantity: entry.possession.quantity,
      carriedState: entry.possession.carriedState,
      ownerName: entry.owner.name,
    })),
    reopenedRevision: reopened.revision,
    capsule: reopened.capsule,
  }, {
    result: {
      revision: 2,
      affectedKinds: ['item', 'possession'],
      undoEligible: true,
    },
    inventory: [{
      name: 'Wardrobe key',
      summary: 'A small iron key taken from the east dressing room.',
      quantity: 1,
      carriedState: 'carried',
      ownerName: 'Player Character',
    }],
    reopenedRevision: 2,
    capsule: [
      'CAMPAIGN STATE · REVISION 2',
      'Treat these fields as authoritative current state. Lists are indexes; do not invent details absent from FOCUS DETAILS or recent chat.',
      '',
      'CHARACTER',
      '- Player Character',
      '',
      'INVENTORY',
      '- Wardrobe key ×1 [carried]',
    ].join('\n'),
  });
});

test('player can create an Ability and learn it as one verified operation', async () => {
  const storage = createMemoryCampaignStorage();
  const ids = deterministicIds();
  const firstSession = createCampaignSession({ storage, createId: ids, now: () => '2026-08-03T12:00:00.000Z' });
  const opened = await firstSession.open({ chatId: 'chat-abilities', title: 'Lavir' });

  const created = await firstSession.execute({
    type: 'create_ability_and_learned_ability',
    ability: {
      name: 'Mage Hand',
      summary: 'Manipulate a small unattended object at short range.',
      category: 'spell',
      tags: ['arcane', 'utility'],
      usage: 'Conjure a spectral hand and direct it precisely.',
      limits: 'Cannot attack or carry heavy objects.',
    },
    learnedAbility: {
      actorId: opened.playerCharacterId,
      accessState: 'prepared',
      currentUses: 2,
      maxUses: 3,
      notes: 'Usually prepared while investigating.',
    },
  }, opened.revision);

  const abilities = firstSession.query({ collection: 'abilities' });
  const reopenedSession = createCampaignSession({ storage, createId: ids, now: () => '2026-08-03T12:01:00.000Z' });
  const reopened = await reopenedSession.open({ chatId: 'chat-abilities', title: 'Lavir' });

  assert.deepEqual({
    revision: created.revision,
    affectedKinds: created.affectedKinds,
    entry: abilities.entries.map(entry => ({
      name: entry.ability.name,
      category: entry.ability.category,
      accessState: entry.learnedAbility.accessState,
      currentUses: entry.learnedAbility.currentUses,
      maxUses: entry.learnedAbility.maxUses,
      actorName: entry.actor.name,
    })),
    reopenedRevision: reopened.revision,
    capsuleHasAbility: reopened.capsule.includes('- Mage Hand [spell; prepared; uses 2/3]'),
  }, {
    revision: 2,
    affectedKinds: ['ability', 'learned_ability'],
    entry: [{
      name: 'Mage Hand',
      category: 'spell',
      accessState: 'prepared',
      currentUses: 2,
      maxUses: 3,
      actorName: 'Player Character',
    }],
    reopenedRevision: 2,
    capsuleHasAbility: true,
  });
});

test('Ability editor saves definition and learned state together and can undo while revision is unchanged', async () => {
  const session = createCampaignSession({
    storage: createMemoryCampaignStorage(),
    createId: deterministicIds(),
    now: () => '2026-08-03T13:00:00.000Z',
  });
  const opened = await session.open({ chatId: 'chat-ability-editor' });
  const created = await session.execute({
    type: 'create_ability_and_learned_ability',
    ability: { name: 'Spark', summary: 'Create a tiny harmless spark.', category: 'spell', tags: ['arcane'] },
    learnedAbility: { actorId: opened.playerCharacterId, accessState: 'learned', currentUses: null, maxUses: null },
  }, opened.revision);
  const before = session.query({ collection: 'abilities' }).entries[0];

  const updated = await session.execute({
    type: 'update_ability_entry',
    abilityId: before.ability.id,
    learnedAbilityId: before.learnedAbility.id,
    abilityChanges: {
      name: 'Prestidigitation',
      summary: 'Perform a minor magical trick.',
      tags: ['arcane', 'utility'],
      usage: 'Create harmless sensory or cleaning effects.',
      limits: 'Only small, temporary effects.',
    },
    learnedAbilityChanges: {
      accessState: 'prepared',
      currentUses: 2,
      maxUses: 3,
      notes: 'Prepared for formal visits.',
    },
  }, created.revision);
  const after = session.query({ collection: 'abilities' }).entries[0];
  const undone = await session.execute({ type: 'undo', token: updated.undoToken }, updated.revision);
  const restored = session.query({ collection: 'abilities' }).entries[0];

  assert.deepEqual({
    saved: {
      name: after.ability.name,
      summary: after.ability.summary,
      tags: after.ability.tags,
      usage: after.ability.usage,
      accessState: after.learnedAbility.accessState,
      uses: [after.learnedAbility.currentUses, after.learnedAbility.maxUses],
      notes: after.learnedAbility.notes,
    },
    undoneRevision: undone.revision,
    restored: {
      name: restored.ability.name,
      accessState: restored.learnedAbility.accessState,
      uses: [restored.learnedAbility.currentUses, restored.learnedAbility.maxUses],
      abilityUpdatedRevision: restored.ability.updatedRevision,
      learnedUpdatedRevision: restored.learnedAbility.updatedRevision,
    },
  }, {
    saved: {
      name: 'Prestidigitation',
      summary: 'Perform a minor magical trick.',
      tags: ['arcane', 'utility'],
      usage: 'Create harmless sensory or cleaning effects.',
      accessState: 'prepared',
      uses: [2, 3],
      notes: 'Prepared for formal visits.',
    },
    undoneRevision: 4,
    restored: {
      name: 'Spark',
      accessState: 'learned',
      uses: [null, null],
      abilityUpdatedRevision: 4,
      learnedUpdatedRevision: 4,
    },
  });
});

test('Ability use counter commits immediately and updates verified narration context', async () => {
  const session = createCampaignSession({
    storage: createMemoryCampaignStorage(),
    createId: deterministicIds(),
    now: () => '2026-08-03T14:00:00.000Z',
  });
  const opened = await session.open({ chatId: 'chat-ability-counter' });
  const created = await session.execute({
    type: 'create_ability_and_learned_ability',
    ability: { name: 'Misty Step', summary: 'Teleport a short distance.', category: 'spell' },
    learnedAbility: { actorId: opened.playerCharacterId, accessState: 'prepared', currentUses: 2, maxUses: 3 },
  }, opened.revision);
  const learnedAbilityId = session.query({ collection: 'abilities' }).entries[0].learnedAbility.id;

  const changed = await session.execute({
    type: 'update_learned_ability',
    learnedAbilityId,
    changes: { currentUses: 1 },
  }, created.revision);
  const entry = session.query({ collection: 'abilities' }).entries[0];

  assert.deepEqual({
    revision: changed.revision,
    affectedKinds: changed.affectedKinds,
    currentUses: entry.learnedAbility.currentUses,
    maxUses: entry.learnedAbility.maxUses,
    capsuleHasUses: changed.capsule.includes('- Misty Step [spell; prepared; uses 1/3]'),
    undoEligible: changed.undoEligible,
  }, {
    revision: 3,
    affectedKinds: ['learned_ability'],
    currentUses: 1,
    maxUses: 3,
    capsuleHasUses: true,
    undoEligible: true,
  });
});

test('Ability lifecycle archives, restores, and safely deletes an unreferenced definition', async () => {
  const session = createCampaignSession({
    storage: createMemoryCampaignStorage(),
    createId: deterministicIds(),
    now: () => '2026-08-03T15:00:00.000Z',
  });
  const opened = await session.open({ chatId: 'chat-ability-lifecycle' });
  await session.execute({
    type: 'create_ability_and_learned_ability',
    ability: { name: 'Old Ward', summary: 'A forgotten protective charm.', category: 'spell' },
    learnedAbility: { actorId: opened.playerCharacterId, accessState: 'learned' },
  }, opened.revision);
  const entry = session.query({ collection: 'abilities' }).entries[0];

  await assert.rejects(
    session.execute({
      type: 'delete_ability_entry',
      abilityId: entry.ability.id,
      learnedAbilityId: entry.learnedAbility.id,
    }, 2),
    error => error.code === 'campaign_validation' && error.message.includes('Archive'),
  );

  const archived = await session.execute({
    type: 'archive_learned_ability',
    learnedAbilityId: entry.learnedAbility.id,
  }, 2);
  const archivedEntries = session.query({ collection: 'abilities', archived: true });
  const restored = await session.execute({
    type: 'restore_learned_ability',
    learnedAbilityId: entry.learnedAbility.id,
  }, archived.revision);
  const archivedAgain = await session.execute({
    type: 'archive_learned_ability',
    learnedAbilityId: entry.learnedAbility.id,
  }, restored.revision);
  const deleted = await session.execute({
    type: 'delete_ability_entry',
    abilityId: entry.ability.id,
    learnedAbilityId: entry.learnedAbility.id,
  }, archivedAgain.revision);

  assert.deepEqual({
    archivedVisible: session.query({ collection: 'abilities' }).entries.length,
    archivedNames: archivedEntries.entries.map(candidate => candidate.ability.name),
    archiveRemovedContext: !archived.capsule.includes('Old Ward'),
    restoreReturnedContext: restored.capsule.includes('Old Ward'),
    deletedRevision: deleted.revision,
    affectedKinds: deleted.affectedKinds,
    undoEligible: deleted.undoEligible,
    archivedAfterDelete: session.query({ collection: 'abilities', archived: true }).entries.length,
  }, {
    archivedVisible: 0,
    archivedNames: ['Old Ward'],
    archiveRemovedContext: true,
    restoreReturnedContext: true,
    deletedRevision: 6,
    affectedKinds: ['ability', 'learned_ability'],
    undoEligible: false,
    archivedAfterDelete: 0,
  });
});

test('People joins an NPC Actor with directed Relationships and compiles concise context', async () => {
  const storage = createMemoryCampaignStorage();
  const ids = deterministicIds();
  const session = createCampaignSession({ storage, createId: ids, now: () => '2026-08-03T16:00:00.000Z' });
  const opened = await session.open({ chatId: 'chat-people' });

  const actorResult = await session.execute({
    type: 'create_actor',
    actor: {
      name: 'Lavir',
      summary: 'A precise court mage searching for a missing witness.',
      aliases: ['Master Lavir'],
      pronouns: 'he/him',
      personality: 'Controlled and exacting.',
      goals: 'Locate the witness without alarming the court.',
      tags: ['court', 'mage'],
    },
  }, opened.revision);
  const person = session.query({ collection: 'people' }).entries[0];
  const relationshipResult = await session.execute({
    type: 'create_relationship',
    relationship: {
      sourceActorId: person.actor.id,
      targetActorId: opened.playerCharacterId,
      relationshipKind: 'employer',
      status: 'active',
      notes: 'Lavir values precision but has not granted full trust.',
      dimensions: { trust: 1, respect: 2, tension: 1 },
    },
  }, actorResult.revision);

  const people = session.query({ collection: 'people' });
  assert.deepEqual({
    revision: relationshipResult.revision,
    actor: people.entries[0].actor.name,
    relationship: people.entries[0].relationships.map(entry => ({
      direction: `${entry.source.name} -> ${entry.target.name}`,
      kind: entry.relationship.relationshipKind,
      trust: entry.relationship.dimensions.trust,
    })),
    capsuleHasPerson: relationshipResult.capsule.includes('- Lavir [npc; he/him]'),
    capsuleHasRelationship: relationshipResult.capsule.includes('Lavir -> Player Character [employer; active; trust 1, respect 2, tension 1]'),
  }, {
    revision: 3,
    actor: 'Lavir',
    relationship: [{ direction: 'Lavir -> Player Character', kind: 'employer', trust: 1 }],
    capsuleHasPerson: true,
    capsuleHasRelationship: true,
  });
});

test('Actor deletion reports Relationship blockers and succeeds after explicit cleanup', async () => {
  const session = createCampaignSession({
    storage: createMemoryCampaignStorage(),
    createId: deterministicIds(),
    now: () => '2026-08-03T17:00:00.000Z',
  });
  const opened = await session.open({ chatId: 'chat-people-lifecycle' });
  const created = await session.execute({ type: 'create_actor', actor: { name: 'Retired Contact' } }, opened.revision);
  const actor = session.query({ collection: 'people' }).entries[0].actor;
  const related = await session.execute({
    type: 'create_relationship',
    relationship: {
      sourceActorId: opened.playerCharacterId,
      targetActorId: actor.id,
      relationshipKind: 'contact',
      status: 'dormant',
    },
  }, created.revision);
  const relationship = session.query({ collection: 'relationships', actorId: actor.id }).entries[0].relationship;
  const archivedActor = await session.execute({ type: 'archive_actor', actorId: actor.id }, related.revision);

  await assert.rejects(
    session.execute({ type: 'delete_actor', actorId: actor.id }, archivedActor.revision),
    error => error.code === 'campaign_validation' && error.message.includes('Relationships'),
  );
  const archivedRelationship = await session.execute({
    type: 'archive_relationship',
    relationshipId: relationship.id,
  }, archivedActor.revision);
  const deletedRelationship = await session.execute({
    type: 'delete_relationship',
    relationshipId: relationship.id,
  }, archivedRelationship.revision);
  const deletedActor = await session.execute({ type: 'delete_actor', actorId: actor.id }, deletedRelationship.revision);

  assert.deepEqual({
    revision: deletedActor.revision,
    people: session.query({ collection: 'people' }).entries.length,
    archivedPeople: session.query({ collection: 'people', archived: true }).entries.length,
    relationships: session.query({ collection: 'relationships', archived: true }).entries.length,
    undoEligible: deletedActor.undoEligible,
  }, { revision: 7, people: 0, archivedPeople: 0, relationships: 0, undoEligible: false });
});

test('JSON addon sync upserts stable external IDs without duplicating Campaign entries', async () => {
  const session = createCampaignSession({
    storage: createMemoryCampaignStorage(),
    createId: deterministicIds(),
    now: () => '2026-08-03T18:00:00.000Z',
  });
  const opened = await session.open({ chatId: 'chat-json-addons' });
  const bundle = {
    bundleVersion: 1,
    sources: ['house-harcourt.json'],
    character: null,
    items: [{ id: 'wardrobe-key', name: 'Wardrobe key', summary: 'A small iron key.', quantity: 1, carriedState: 'carried' }],
    abilities: [{ id: 'mage-hand', name: 'Mage Hand', category: 'spell', accessState: 'prepared', currentUses: 2, maxUses: 3 }],
    people: [{ id: 'lavir', name: 'Lavir', summary: 'A precise court mage.', pronouns: 'he/him' }],
    relationships: [{ id: 'lavir-employs-player', source: 'lavir', target: '$player', kind: 'employer', status: 'active', dimensions: { trust: 1 } }],
    quests: [],
    facts: [],
    places: [],
    worldObjects: [],
    scene: null,
  };

  const first = await session.execute({ type: 'sync_content_addons', bundle }, opened.revision);
  const firstIds = {
    possession: session.query({ collection: 'inventory' }).entries[0].possession.id,
    learnedAbility: session.query({ collection: 'abilities' }).entries[0].learnedAbility.id,
    actor: session.query({ collection: 'people' }).entries[0].actor.id,
    relationship: session.query({ collection: 'relationships' }).entries[0].relationship.id,
  };
  const changedBundle = structuredClone(bundle);
  changedBundle.items[0].quantity = 2;
  changedBundle.abilities[0].currentUses = 1;
  changedBundle.people[0].summary = 'A suspicious but precise court mage.';
  changedBundle.relationships[0].dimensions.trust = 2;
  const second = await session.execute({ type: 'sync_content_addons', bundle: changedBundle }, first.revision);

  const inventory = session.query({ collection: 'inventory' }).entries;
  const abilities = session.query({ collection: 'abilities' }).entries;
  const people = session.query({ collection: 'people' }).entries;
  const relationships = session.query({ collection: 'relationships' }).entries;
  assert.deepEqual({
    revision: second.revision,
    addonCounts: second.addonCounts,
    counts: [inventory.length, abilities.length, people.length, relationships.length],
    idsStable: {
      possession: inventory[0].possession.id === firstIds.possession,
      learnedAbility: abilities[0].learnedAbility.id === firstIds.learnedAbility,
      actor: people[0].actor.id === firstIds.actor,
      relationship: relationships[0].relationship.id === firstIds.relationship,
    },
    values: {
      quantity: inventory[0].possession.quantity,
      currentUses: abilities[0].learnedAbility.currentUses,
      summary: people[0].actor.summary,
      trust: relationships[0].relationship.dimensions.trust,
    },
    capsuleUpdated: second.capsule.includes('Wardrobe key ×2')
      && second.capsule.includes('uses 1/3')
      && second.capsule.includes('trust 2'),
  }, {
    revision: 3,
    addonCounts: {
      character: 0,
      items: 1,
      abilities: 1,
      people: 1,
      relationships: 1,
      quests: 0,
      facts: 0,
      places: 0,
      worldObjects: 0,
      scene: 0,
    },
    counts: [1, 1, 1, 1],
    idsStable: { possession: true, learnedAbility: true, actor: true, relationship: true },
    values: { quantity: 2, currentUses: 1, summary: 'A suspicious but precise court mage.', trust: 2 },
    capsuleUpdated: true,
  });
});

test('JSON addon sync covers character, objectives, world content, and one stable Current Scene', async () => {
  const session = createCampaignSession({
    storage: createMemoryCampaignStorage(),
    createId: deterministicIds(),
    now: () => '2026-08-03T18:30:00.000Z',
  });
  const opened = await session.open({ chatId: 'chat-full-json-addons' });
  const bundle = {
    bundleVersion: 1,
    sources: ['campaign.json'],
    character: {
      name: 'Mira',
      pronouns: 'she/her',
      summary: 'A stubborn hedge mage.',
      conditions: ['alert'],
      meters: [{ id: 'resolve', label: 'Resolve', current: 2, max: 4 }],
    },
    items: [{ id: 'wardrobe-key', name: 'Wardrobe key', quantity: 1 }],
    abilities: [{ id: 'mage-hand', name: 'Mage Hand', category: 'spell', accessState: 'prepared' }],
    people: [{ id: 'lavir', name: 'Lavir', summary: 'A precise court mage.' }],
    relationships: [{ id: 'lavir-employs-mira', source: 'lavir', target: '$player', kind: 'employer' }],
    quests: [{
      id: 'find-witness',
      name: 'Find the witness',
      status: 'active',
      summary: 'Locate the missing court witness.',
      steps: [{ id: 'search-study', label: 'Search the private study', status: 'active' }],
      involved: [{ kind: 'actor', id: 'lavir' }, { kind: 'place', id: 'private-study' }],
    }],
    facts: [{
      id: 'lavir-needs-proof',
      name: 'Lavir needs proof',
      proposition: 'Lavir will not act without physical proof.',
      importance: 'important',
      subject: { kind: 'actor', id: 'lavir' },
    }],
    places: [
      { id: 'private-study', name: 'Private study', summary: 'A locked room of ledgers.', connections: [{ id: 'to-hall', place: 'east-hall', kind: 'door' }] },
      { id: 'east-hall', name: 'East hall', parent: 'private-study' },
    ],
    worldObjects: [{ id: 'sealed-cabinet', name: 'Sealed cabinet', homePlace: 'private-study', state: 'locked' }],
    scene: {
      id: 'search-study',
      title: 'Search the study',
      summary: 'Mira searches before the household wakes.',
      place: 'private-study',
      presences: [
        { id: 'mira', subject: { kind: 'actor', id: '$player' }, role: 'protagonist' },
        { id: 'cabinet', subject: { kind: 'worldObject', id: 'sealed-cabinet' }, role: 'focus' },
      ],
      exits: [{ id: 'east-door', label: 'East door', destinationPlace: 'east-hall', status: 'open' }],
      obstacles: [{ id: 'cabinet-lock', label: 'Cabinet lock', status: 'active' }],
      countdowns: [{ id: 'dawn', label: 'Dawn', current: 1, max: 4 }],
      threads: [{ id: 'find-ledger', label: 'Find the hidden ledger', status: 'open' }],
    },
  };

  const first = await session.execute({ type: 'sync_content_addons', bundle }, opened.revision);
  const firstQuest = session.query({ collection: 'objectives' }).entries[0];
  const firstWorld = session.query({ collection: 'world' });
  const firstScene = session.query({ collection: 'current_scene' }).scene;
  const stableIds = {
    quest: firstQuest.id,
    step: firstQuest.steps[0].id,
    place: firstWorld.places.find(entry => entry.place.externalKey === 'place:private-study').place.id,
    worldObject: firstWorld.worldObjects[0].worldObject.id,
    scene: firstScene.id,
    presence: firstScene.presences[0].presence.id,
  };
  const changed = structuredClone(bundle);
  changed.quests[0].steps[0].status = 'completed';
  changed.scene.countdowns[0].current = 2;
  changed.worldObjects[0].state = 'open';
  const second = await session.execute({ type: 'sync_content_addons', bundle: changed }, first.revision);
  const quest = session.query({ collection: 'objectives' }).entries[0];
  const world = session.query({ collection: 'world' });
  const scene = session.query({ collection: 'current_scene' }).scene;

  assert.deepEqual({
    revision: second.revision,
    character: session.query({ collection: 'character' }).actor.name,
    worldCounts: [world.facts.length, world.places.length, world.worldObjects.length],
    stable: {
      quest: quest.id === stableIds.quest,
      step: quest.steps[0].id === stableIds.step,
      place: world.places.find(entry => entry.place.externalKey === 'place:private-study').place.id === stableIds.place,
      worldObject: world.worldObjects[0].worldObject.id === stableIds.worldObject,
      scene: scene.id === stableIds.scene,
      presence: scene.presences[0].presence.id === stableIds.presence,
    },
    values: [quest.steps[0].status, world.worldObjects[0].worldObject.state, scene.countdowns[0].current],
    capsule: [
      'Mira [she/her]: A stubborn hedge mage.',
      'CURRENT SCENE',
      'Search the study @ Private study',
      'OBJECTIVES',
      'Find the witness [active]',
      'Fact: Lavir needs proof [important]',
    ].every(text => second.capsule.includes(text)),
  }, {
    revision: 3,
    character: 'Mira',
    worldCounts: [1, 2, 1],
    stable: { quest: true, step: true, place: true, worldObject: true, scene: true, presence: true },
    values: ['completed', 'open', 2],
    capsule: true,
  });
});

test('JSON addon sync cannot replace a different open Current Scene', async () => {
  const session = createCampaignSession({ storage: createMemoryCampaignStorage(), createId: deterministicIds() });
  const opened = await session.open({ chatId: 'chat-addon-scene-conflict' });
  const bundle = sceneId => ({
    bundleVersion: 1,
    sources: ['scene.json'],
    character: null,
    items: [], abilities: [], people: [], relationships: [], quests: [], facts: [], places: [], worldObjects: [],
    scene: { id: sceneId, title: sceneId, presences: [], exits: [], obstacles: [], countdowns: [], threads: [] },
  });
  const first = await session.execute({ type: 'sync_content_addons', bundle: bundle('scene-one') }, opened.revision);
  await assert.rejects(
    session.execute({ type: 'sync_content_addons', bundle: bundle('scene-two') }, first.revision),
    error => error.code === 'campaign_validation' && error.message.includes('different Current Scene'),
  );
});

test('Player Character editor updates structured meters with stable IDs and context', async () => {
  const session = createCampaignSession({
    storage: createMemoryCampaignStorage(),
    createId: deterministicIds(),
    now: () => '2026-08-03T20:00:00.000Z',
  });
  const opened = await session.open({ chatId: 'chat-character-editor' });
  const first = await session.execute({
    type: 'update_actor',
    actorId: opened.playerCharacterId,
    changes: {
      name: 'Mira',
      pronouns: 'she/her',
      summary: 'A stubborn hedge mage.',
      conditions: ['alert'],
      meters: [{ label: 'Resolve', current: 2, max: 4, notes: 'Spent under pressure.' }],
    },
  }, opened.revision);
  const firstActor = session.query({ collection: 'character' }).actor;
  const meterId = firstActor.meters[0].id;
  const second = await session.execute({
    type: 'update_actor',
    actorId: opened.playerCharacterId,
    changes: {
      ...firstActor,
      meters: [{ id: meterId, label: 'Resolve', current: 3, max: 4, notes: '' }],
    },
  }, first.revision);
  const actor = session.query({ collection: 'character' }).actor;

  assert.deepEqual({
    revision: second.revision,
    name: actor.name,
    meter: [actor.meters[0].id === meterId, actor.meters[0].current],
    capsule: ['Mira [she/her]: A stubborn hedge mage.', 'Conditions: alert', 'Meters: Resolve 3/4']
      .every(text => second.capsule.includes(text)),
  }, { revision: 3, name: 'Mira', meter: [true, 3], capsule: true });
});

test('Objectives support structured steps, typed links, archive, restore, and guarded deletion', async () => {
  const session = createCampaignSession({
    storage: createMemoryCampaignStorage(),
    createId: deterministicIds(),
    now: () => '2026-08-03T20:10:00.000Z',
  });
  const opened = await session.open({ chatId: 'chat-objective-editor' });
  const created = await session.execute({
    type: 'create_quest',
    quest: {
      name: 'Find the witness',
      summary: 'Locate the missing court witness.',
      status: 'active',
      involvedRefs: [{ kind: 'actor', id: opened.playerCharacterId }],
      steps: [{ label: 'Search the private wing', status: 'active', notes: '' }],
    },
  }, opened.revision);
  const original = session.query({ collection: 'objectives' }).entries[0];
  const updated = await session.execute({
    type: 'update_quest',
    questId: original.id,
    quest: {
      ...original,
      steps: [{ ...original.steps[0], status: 'completed' }, { label: 'Question the steward', status: 'active' }],
    },
  }, created.revision);
  const changed = session.query({ collection: 'objectives' }).entries[0];
  const archived = await session.execute({ type: 'archive_quest', questId: changed.id }, updated.revision);
  const restored = await session.execute({ type: 'restore_quest', questId: changed.id }, archived.revision);
  const archivedAgain = await session.execute({ type: 'archive_quest', questId: changed.id }, restored.revision);
  const deleted = await session.execute({ type: 'delete_quest', questId: changed.id }, archivedAgain.revision);

  assert.deepEqual({
    stableStep: changed.steps[0].id === original.steps[0].id,
    stepStatuses: changed.steps.map(step => step.status),
    contextAfterUpdate: updated.capsule.includes('Find the witness [active]')
      && updated.capsule.includes('next: Question the steward [active]'),
    activeAfterDelete: session.query({ collection: 'objectives' }).entries.length,
    archivedAfterDelete: session.query({ collection: 'objectives', archived: true }).entries.length,
    deleteUndo: deleted.undoEligible,
  }, {
    stableStep: true,
    stepStatuses: ['completed', 'active'],
    contextAfterUpdate: true,
    activeAfterDelete: 0,
    archivedAfterDelete: 0,
    deleteUndo: false,
  });
});

test('World records preserve typed references, ordered connections, and deletion blockers', async () => {
  const session = createCampaignSession({
    storage: createMemoryCampaignStorage(),
    createId: deterministicIds(),
    now: () => '2026-08-03T20:30:00.000Z',
  });
  const opened = await session.open({ chatId: 'chat-world-editor' });
  const estateResult = await session.execute({
    type: 'create_place',
    place: { name: 'Harcourt Estate', summary: 'An old noble estate.', contextPolicy: 'pinned' },
  }, opened.revision);
  const estate = session.query({ collection: 'places' }).entries[0].place;
  const studyResult = await session.execute({
    type: 'create_place',
    place: { name: 'Private study', parentPlaceId: estate.id },
  }, estateResult.revision);
  const study = session.query({ collection: 'places' }).entries.find(entry => entry.place.name === 'Private study').place;
  const connectionResult = await session.execute({
    type: 'update_place',
    placeId: estate.id,
    place: {
      ...estate,
      connections: [{ targetPlaceId: study.id, connectionKind: 'locked door', notes: '' }],
    },
  }, studyResult.revision);
  const connectedEstate = session.query({ collection: 'places' }).entries.find(entry => entry.place.id === estate.id).place;
  const connectionId = connectedEstate.connections[0].id;
  const objectResult = await session.execute({
    type: 'create_world_object',
    worldObject: {
      name: 'Sealed cabinet',
      summary: 'A heavy cabinet over mismatched paneling.',
      state: 'locked',
      homePlaceId: study.id,
      contextPolicy: 'pinned',
    },
  }, connectionResult.revision);
  const worldObject = session.query({ collection: 'world_objects' }).entries[0].worldObject;
  const factResult = await session.execute({
    type: 'create_fact',
    fact: {
      name: 'Cabinet hides a passage',
      proposition: 'The sealed cabinet conceals an old service passage.',
      importance: 'critical',
      subjectRef: { kind: 'world_object', id: worldObject.id },
    },
  }, objectResult.revision);
  const fact = session.query({ collection: 'facts' }).entries[0];
  const updatedPlace = await session.execute({
    type: 'update_place',
    placeId: estate.id,
    place: {
      ...connectedEstate,
      connections: [{ ...connectedEstate.connections[0], connectionKind: 'secret door' }],
    },
  }, factResult.revision);
  const stableConnection = session.query({ collection: 'places' }).entries
    .find(entry => entry.place.id === estate.id).place.connections[0];
  const archivedObject = await session.execute({ type: 'archive_world_record', recordId: worldObject.id }, updatedPlace.revision);

  await assert.rejects(
    session.execute({ type: 'delete_world_record', recordId: worldObject.id }, archivedObject.revision),
    error => error.code === 'campaign_validation' && error.message.includes('Fact Cabinet hides a passage'),
  );
  assert.deepEqual({
    counts: [
      session.query({ collection: 'facts' }).entries.length,
      session.query({ collection: 'places' }).entries.length,
      session.query({ collection: 'world_objects', archived: true }).entries.length,
    ],
    subject: [fact.subject.kind, fact.subject.name],
    parent: session.query({ collection: 'places' }).entries.find(entry => entry.place.id === study.id).parent.name,
    stableConnection: [stableConnection.id === connectionId, stableConnection.connectionKind],
    context: factResult.capsule.includes('Fact [critical]: The sealed cabinet conceals an old service passage.')
      && factResult.capsule.includes('Object: Sealed cabinet'),
  }, {
    counts: [1, 2, 1],
    subject: ['world_object', 'Sealed cabinet'],
    parent: 'Harcourt Estate',
    stableConnection: [true, 'secret door'],
    context: true,
  });
});

test('Current Scene edits preserve row IDs and Advance Scene archives once while carrying selected threads', async () => {
  const storage = createMemoryCampaignStorage();
  const session = createCampaignSession({
    storage,
    createId: deterministicIds(),
    now: () => '2026-08-03T21:00:00.000Z',
  });
  const opened = await session.open({ chatId: 'chat-scene-lifecycle' });
  const placeResult = await session.execute({
    type: 'create_place',
    place: { name: 'Private study', summary: 'A sealed room lined with books.' },
  }, opened.revision);
  const place = session.query({ collection: 'places' }).entries[0].place;
  const openedScene = await session.execute({
    type: 'create_current_scene',
    scene: {
      title: 'Search the study',
      summary: 'Find evidence before the steward returns.',
      placeId: place.id,
      presences: [{
        subjectRef: { kind: 'actor', id: opened.playerCharacterId },
        role: 'investigator',
        state: 'present',
      }],
      exits: [{ label: 'Hall door', status: 'closed' }],
      obstacles: [{ label: 'Locked cabinet', status: 'active' }],
      countdowns: [{ label: 'Steward returns', current: 1, max: 4 }],
      openThreads: [
        { label: 'Find the ledger', status: 'open', notes: 'It may name the witness.' },
        { label: 'Cabinet searched', status: 'resolved' },
      ],
    },
  }, placeResult.revision);
  const first = session.query({ collection: 'current_scene' }).scene;
  const firstThreadId = first.openThreads[0].id;
  const firstExitId = first.exits[0].id;

  const updatedScene = await session.execute({
    type: 'update_current_scene',
    sceneId: first.id,
    scene: {
      ...first,
      presences: first.presences.map(entry => entry.presence),
      exits: [{ ...first.exits[0], status: 'open' }],
      countdowns: [{ ...first.countdowns[0], current: 2 }],
    },
  }, openedScene.revision);
  const updated = session.query({ collection: 'current_scene' }).scene;
  assert.equal(updated.exits[0].id, firstExitId);

  const advanced = await session.execute({
    type: 'advance_scene',
    sceneId: updated.id,
    carryThreadIds: [firstThreadId],
    nextScene: {
      title: 'Follow the hidden passage',
      summary: 'Descend before pursuit reaches the study.',
      placeId: null,
      presences: [],
      exits: [],
      obstacles: [],
      countdowns: [],
      openThreads: [{ label: 'Find a safe way down', status: 'open' }],
    },
  }, updatedScene.revision);
  const current = session.query({ collection: 'current_scene' }).scene;
  const archives = session.query({ collection: 'scene_archives' }).entries;

  assert.deepEqual({
    current: [current.title, current.id !== updated.id],
    carried: current.openThreads.map(thread => [thread.label, thread.status, thread.carriedFromThreadId]),
    archive: [archives.length, archives[0].title, archives[0].scene.exits[0].status],
    capsule: advanced.capsule.includes('Follow the hidden passage')
      && !advanced.capsule.includes('Search the study'),
  }, {
    current: ['Follow the hidden passage', true],
    carried: [
      ['Find a safe way down', 'open', null],
      ['Find the ledger', 'carried', firstThreadId],
    ],
    archive: [1, 'Search the study', 'open'],
    capsule: true,
  });

  await session.execute({ type: 'undo', token: advanced.undoToken }, advanced.revision);
  assert.equal(session.query({ collection: 'current_scene' }).scene.id, updated.id);
  assert.equal(session.query({ collection: 'scene_archives' }).entries.length, 0);
});

test('stale Inventory edits are rejected without replacing the verified Possession', async () => {
  const storage = createMemoryCampaignStorage();
  const session = createCampaignSession({ storage, createId: deterministicIds(), now: () => '2026-08-02T13:00:00.000Z' });
  const opened = await session.open({ chatId: 'chat-conflict' });
  await session.execute({
    type: 'create_item_and_possession',
    item: { name: 'Silver mirror', summary: 'A compact hand mirror.' },
    possession: {
      ownerActorId: opened.playerCharacterId,
      quantity: 1,
      carriedState: 'stored',
      equippedSlots: [],
    },
  }, opened.revision);
  const possessionId = session.query({ collection: 'inventory' }).entries[0].possession.id;

  const updated = await session.execute({
    type: 'update_possession',
    possessionId,
    changes: {
      quantity: 2,
      carriedState: 'worn',
      equippedSlots: ['belt'],
    },
  }, 2);

  await assert.rejects(
    session.execute({
      type: 'update_possession',
      possessionId,
      changes: { quantity: 99 },
    }, 2),
    error => error.code === 'campaign_conflict' && error.details.actualRevision === 3,
  );

  const entry = session.query({ collection: 'inventory' }).entries[0];
  assert.deepEqual({
    revision: updated.revision,
    quantity: entry.possession.quantity,
    carriedState: entry.possession.carriedState,
    equippedSlots: entry.possession.equippedSlots,
  }, {
    revision: 3,
    quantity: 2,
    carriedState: 'worn',
    equippedSlots: ['belt'],
  });
});

test('Inventory editor saves Item and Possession fields together and can undo while the revision is unchanged', async () => {
  const storage = createMemoryCampaignStorage();
  const session = createCampaignSession({ storage, createId: deterministicIds(), now: () => '2026-08-02T14:00:00.000Z' });
  const opened = await session.open({ chatId: 'chat-editor' });
  const created = await session.execute({
    type: 'create_item_and_possession',
    item: { name: 'Travel cloak', summary: 'A plain wool cloak.', category: 'clothing' },
    possession: {
      ownerActorId: opened.playerCharacterId,
      quantity: 1,
      carriedState: 'worn',
      equippedSlots: ['shoulders'],
    },
  }, opened.revision);
  const before = session.query({ collection: 'inventory' }).entries[0];

  const updated = await session.execute({
    type: 'update_inventory_entry',
    itemId: before.item.id,
    possessionId: before.possession.id,
    itemChanges: {
      name: 'House Harcourt cloak',
      summary: 'A formal cloak carrying the house colours.',
      tags: ['clothing', 'house-harcourt'],
    },
    possessionChanges: {
      quantity: 1,
      carriedState: 'stored',
      equippedSlots: [],
      condition: 'clean',
    },
  }, created.revision);
  const after = session.query({ collection: 'inventory' }).entries[0];

  const undone = await session.execute({ type: 'undo', token: updated.undoToken }, updated.revision);
  const restored = session.query({ collection: 'inventory' }).entries[0];

  assert.deepEqual({
    saved: {
      revision: updated.revision,
      name: after.item.name,
      summary: after.item.summary,
      tags: after.item.tags,
      state: after.possession.carriedState,
      condition: after.possession.condition,
    },
    undoneRevision: undone.revision,
    restored: {
      name: restored.item.name,
      summary: restored.item.summary,
      state: restored.possession.carriedState,
      slots: restored.possession.equippedSlots,
      itemUpdatedRevision: restored.item.updatedRevision,
      possessionUpdatedRevision: restored.possession.updatedRevision,
    },
  }, {
    saved: {
      revision: 3,
      name: 'House Harcourt cloak',
      summary: 'A formal cloak carrying the house colours.',
      tags: ['clothing', 'house-harcourt'],
      state: 'stored',
      condition: 'clean',
    },
    undoneRevision: 4,
    restored: {
      name: 'Travel cloak',
      summary: 'A plain wool cloak.',
      state: 'worn',
      slots: ['shoulders'],
      itemUpdatedRevision: 4,
      possessionUpdatedRevision: 4,
    },
  });
});

test('archiving and restoring a Possession removes and returns it from Inventory context', async () => {
  const storage = createMemoryCampaignStorage();
  const session = createCampaignSession({ storage, createId: deterministicIds(), now: () => '2026-08-02T15:00:00.000Z' });
  const opened = await session.open({ chatId: 'chat-archive' });
  await session.execute({
    type: 'create_item_and_possession',
    item: { name: 'Sealed letter', summary: 'A letter bearing Lavir’s seal.' },
    possession: {
      ownerActorId: opened.playerCharacterId,
      quantity: 1,
      carriedState: 'carried',
      equippedSlots: [],
    },
  }, opened.revision);
  const possessionId = session.query({ collection: 'inventory' }).entries[0].possession.id;

  const archived = await session.execute({ type: 'archive_possession', possessionId }, 2);
  const visibleAfterArchive = session.query({ collection: 'inventory' });
  const archivedEntries = session.query({ collection: 'inventory', archived: true });
  const restored = await session.execute({ type: 'restore_possession', possessionId }, archived.revision);
  const visibleAfterRestore = session.query({ collection: 'inventory' });

  assert.deepEqual({
    archivedRevision: archived.revision,
    visibleAfterArchive: visibleAfterArchive.entries.length,
    archivedNames: archivedEntries.entries.map(entry => entry.item.name),
    archivedCapsuleContainsItem: archived.capsule.includes('Sealed letter'),
    restoredRevision: restored.revision,
    visibleAfterRestore: visibleAfterRestore.entries.map(entry => entry.item.name),
    restoredCapsuleContainsItem: restored.capsule.includes('Sealed letter'),
  }, {
    archivedRevision: 3,
    visibleAfterArchive: 0,
    archivedNames: ['Sealed letter'],
    archivedCapsuleContainsItem: false,
    restoredRevision: 4,
    visibleAfterRestore: ['Sealed letter'],
    restoredCapsuleContainsItem: true,
  });
});

test('Inventory accepts an explicit zero quantity without treating it as deletion', async () => {
  const session = createCampaignSession({
    storage: createMemoryCampaignStorage(),
    createId: deterministicIds(),
    now: () => '2026-08-02T16:30:00.000Z',
  });
  const opened = await session.open({ chatId: 'chat-zero-quantity' });

  const created = await session.execute({
    type: 'create_item_and_possession',
    item: { name: 'Empty vial', summary: 'No vials remain, but the entry is intentionally retained.' },
    possession: {
      ownerActorId: opened.playerCharacterId,
      quantity: 0,
      carriedState: 'consumed',
      equippedSlots: [],
    },
  }, opened.revision);

  const entry = session.query({ collection: 'inventory' }).entries[0];
  assert.deepEqual({ revision: created.revision, quantity: entry.possession.quantity, stillVisible: Boolean(entry) }, {
    revision: 2,
    quantity: 0,
    stillVisible: true,
  });
});

test('permanent Inventory deletion is blocked until archived and then removes the unreferenced Item atomically', async () => {
  const session = createCampaignSession({
    storage: createMemoryCampaignStorage(),
    createId: deterministicIds(),
    now: () => '2026-08-02T17:00:00.000Z',
  });
  const opened = await session.open({ chatId: 'chat-delete' });
  await session.execute({
    type: 'create_item_and_possession',
    item: { name: 'Broken token', summary: 'A discarded brass token.' },
    possession: {
      ownerActorId: opened.playerCharacterId,
      quantity: 1,
      carriedState: 'stored',
      equippedSlots: [],
    },
  }, opened.revision);
  const entry = session.query({ collection: 'inventory' }).entries[0];

  await assert.rejects(
    session.execute({
      type: 'delete_inventory_entry',
      possessionId: entry.possession.id,
      itemId: entry.item.id,
    }, 2),
    error => error.code === 'campaign_validation' && error.message.includes('Archive'),
  );

  const archived = await session.execute({ type: 'archive_possession', possessionId: entry.possession.id }, 2);
  const deleted = await session.execute({
    type: 'delete_inventory_entry',
    possessionId: entry.possession.id,
    itemId: entry.item.id,
  }, archived.revision);

  assert.deepEqual({
    revision: deleted.revision,
    affectedKinds: deleted.affectedKinds,
    undoEligible: deleted.undoEligible,
    visible: session.query({ collection: 'inventory' }).entries.length,
    archived: session.query({ collection: 'inventory', archived: true }).entries.length,
    capsuleContainsItem: deleted.capsule.includes('Broken token'),
  }, {
    revision: 4,
    affectedKinds: ['item', 'possession'],
    undoEligible: false,
    visible: 0,
    archived: 0,
    capsuleContainsItem: false,
  });
});

test('Inventory deletion blocks Scene references and retains Item definitions used by Objectives', async () => {
  const session = createCampaignSession({
    storage: createMemoryCampaignStorage(),
    createId: deterministicIds(),
    now: () => '2026-08-03T23:00:00.000Z',
  });
  const opened = await session.open({ chatId: 'chat-reference-delete' });
  const created = await session.execute({
    type: 'create_item_and_possession',
    item: { name: 'Witness key', summary: 'Opens the witness room.' },
    possession: { ownerActorId: opened.playerCharacterId, quantity: 1, carriedState: 'carried' },
  }, opened.revision);
  const entry = session.query({ collection: 'inventory' }).entries[0];
  const sceneResult = await session.execute({
    type: 'create_current_scene',
    scene: {
      title: 'Witness room',
      summary: '',
      placeId: null,
      presences: [{ subjectRef: { kind: 'possession', id: entry.possession.id }, role: 'evidence', state: 'present' }],
      exits: [], obstacles: [], countdowns: [], openThreads: [],
    },
  }, created.revision);
  const archived = await session.execute({ type: 'archive_possession', possessionId: entry.possession.id }, sceneResult.revision);

  await assert.rejects(
    session.execute({
      type: 'delete_inventory_entry',
      possessionId: entry.possession.id,
      itemId: entry.item.id,
    }, archived.revision),
    error => error.code === 'campaign_validation' && error.message.includes('Current Scene presence'),
  );

  const scene = session.query({ collection: 'current_scene' }).scene;
  const clearedScene = await session.execute({
    type: 'update_current_scene',
    sceneId: scene.id,
    scene: { ...scene, presences: [], exits: scene.exits },
  }, archived.revision);
  const objective = await session.execute({
    type: 'create_quest',
    quest: {
      name: 'Return the key', status: 'active', steps: [],
      involvedRefs: [{ kind: 'item', id: entry.item.id }],
    },
  }, clearedScene.revision);
  await session.execute({
    type: 'delete_inventory_entry',
    possessionId: entry.possession.id,
    itemId: entry.item.id,
  }, objective.revision);

  assert.equal(session.query({ collection: 'inventory' }).entries.length, 0);
  assert.equal(session.query({ collection: 'reference_options' }).entries.some(record => record.id === entry.item.id), true);
  assert.doesNotMatch(session.query({ collection: 'current_scene' }).scene.summary, /Unknown subject/);
});

test('an empty Story Sync review survives reopen until the player advances its boundary', async () => {
  const storage = createMemoryCampaignStorage();
  const first = createCampaignSession({ storage, createId: deterministicIds(), now: () => '2026-08-03T23:30:00.000Z' });
  const opened = await first.open({ chatId: 'chat-empty-review' });
  const source = {
    identity: 'chat-empty-review:range-1',
    chatId: 'chat-empty-review',
    firstMessageIndex: 3,
    lastMessageIndex: 7,
    remainingMessages: 2,
  };
  await first.execute({ type: 'store_story_sync_draft', source, proposals: [] }, opened.revision);

  const reopenedSession = createCampaignSession({ storage, createId: deterministicIds(), now: () => '2026-08-03T23:31:00.000Z' });
  const reopened = await reopenedSession.open({ chatId: 'chat-empty-review' });
  assert.deepEqual(reopenedSession.query({ collection: 'story_sync_proposals' }).pendingReview, source);

  const completed = await reopenedSession.execute({ type: 'complete_empty_story_sync_review', source }, reopened.revision);
  assert.equal(completed.syncBoundary.messageIndex, 7);
  assert.equal(reopenedSession.query({ collection: 'story_sync_proposals' }).pendingReview, null);
});
