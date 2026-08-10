import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { SqliteCampaignJournal } from '../src/adapters/sqlite/campaign-journal.js';
import { acceptCampaignCreate, acceptCampaignOperation } from './campaign-test-helpers.js';

test('Quest and Place records persist, edit, archive, and reconstruct through immutable history', async t => {
  const root = await mkdtemp(join(tmpdir(), 'st-rpg-workspace-records-'));
  const journal = await SqliteCampaignJournal.open(join(root, 'campaigns.sqlite'), 25);
  t.after(async () => {
    await journal.close();
    await rm(root, { recursive: true, force: true });
  });

  const created = await acceptCampaignCreate(journal, {
    requestId: 'workspace-create',
    title: 'Routed Records',
  });
  assert.deepEqual(created.document.quests, []);
  assert.deepEqual(created.document.places, []);

  const questCommit = await acceptCampaignOperation(journal, created.campaignId, {
    requestId: 'workspace-quest-create',
    expectedRevision: 1,
    operation: {
      kind: 'create_quest',
      quest: {
        name: 'Find the Moon Gate',
        summary: 'Locate the sealed gate beneath the old keep.',
      },
    },
  });
  const questId = questCommit.affectedIds[0]!;
  assert.equal(questCommit.document.quests[0]?.status, 'active');

  const placeCommit = await acceptCampaignOperation(journal, created.campaignId, {
    requestId: 'workspace-place-create',
    expectedRevision: 2,
    operation: {
      kind: 'create_place',
      place: {
        name: 'Old Keep',
        summary: 'A ruined fortress above the river road.',
      },
    },
  });
  const placeId = placeCommit.affectedIds[0]!;

  const completedQuest = await acceptCampaignOperation(journal, created.campaignId, {
    requestId: 'workspace-quest-complete',
    expectedRevision: 3,
    operation: {
      kind: 'update_quest',
      questId,
      name: 'Find the Moon Gate',
      summary: 'The gate was found and opened.',
      status: 'completed',
    },
  });
  assert.equal(completedQuest.document.quests[0]?.status, 'completed');

  const archivedPlace = await acceptCampaignOperation(journal, created.campaignId, {
    requestId: 'workspace-place-archive',
    expectedRevision: 4,
    operation: {
      kind: 'set_place_archived',
      placeId,
      archived: true,
    },
  });
  assert.equal(archivedPlace.document.places[0]?.archived, true);
  assert.equal(archivedPlace.revision, 5);

  const revisionTwo = journal.readCampaign(created.campaignId, 2);
  assert.equal(revisionTwo.quests[0]?.name, 'Find the Moon Gate');
  assert.deepEqual(revisionTwo.places, []);

  const current = journal.readCampaign(created.campaignId);
  assert.equal(current.quests[0]?.status, 'completed');
  assert.equal(current.places[0]?.archived, true);
  journal.verifyOrThrow();
});

test('Ability definitions and per-Actor learned state commit atomically, survive restart, and reconstruct', async t => {
  const root = await mkdtemp(join(tmpdir(), 'st-rpg-ability-records-'));
  const databasePath = join(root, 'campaigns.sqlite');
  let journal = await SqliteCampaignJournal.open(databasePath, 25);
  t.after(async () => {
    await journal.close();
    await rm(root, { recursive: true, force: true });
  });

  const created = await acceptCampaignCreate(journal, { requestId: 'ability-campaign', title: 'Ability Book' });
  const actor = await acceptCampaignOperation(journal, created.campaignId, {
    requestId: 'ability-actor', expectedRevision: 1,
    operation: { kind: 'create_actor', actor: { id: 'actor-mage', name: 'Mara', summary: 'A careful mage.' } },
  });
  const joined = await acceptCampaignOperation(journal, created.campaignId, {
    requestId: 'ability-create', expectedRevision: actor.revision,
    operation: {
      kind: 'create_ability_with_learning',
      ability: { id: 'ability-hand', name: 'Mage Hand', summary: 'Moves light objects.', category: 'spell' },
      learnedAbility: {
        id: 'learned-hand', actorId: 'actor-mage', prepared: true, enabled: true,
        usesRemaining: 2, usesMaximum: 3,
      },
    },
  });
  assert.deepEqual(joined.affectedIds, ['ability-hand', 'learned-hand']);
  assert.equal(joined.document.abilities?.[0]?.category, 'spell');
  assert.equal(joined.document.learnedAbilities?.[0]?.usesRemaining, 2);
  const hits = await journal.search({
    campaignId: created.campaignId,
    campaignRevision: joined.revision,
    query: 'manipulates objects Mage Hand',
    limit: 8,
  });
  assert.equal(hits.some(hit => hit.recordId === 'ability-hand'), true);

  const updated = await acceptCampaignOperation(journal, created.campaignId, {
    requestId: 'ability-use', expectedRevision: joined.revision,
    operation: {
      kind: 'update_learned_ability', learnedAbilityId: 'learned-hand',
      prepared: false, enabled: true, usesRemaining: 1, usesMaximum: 3,
    },
  });
  assert.equal(updated.document.learnedAbilities?.[0]?.prepared, false);
  assert.equal(updated.document.learnedAbilities?.[0]?.usesRemaining, 1);
  assert.equal(journal.readCampaign(created.campaignId, joined.revision).learnedAbilities?.[0]?.usesRemaining, 2);

  await journal.close();
  journal = await SqliteCampaignJournal.open(databasePath, 25);
  const reopened = journal.readCampaign(created.campaignId);
  assert.equal(reopened.abilities?.[0]?.name, 'Mage Hand');
  assert.equal(reopened.learnedAbilities?.[0]?.usesRemaining, 1);
  journal.verifyOrThrow();
});

test('directed Relationships edit, archive, restore, search, reconstruct, and survive restart', async t => {
  const root = await mkdtemp(join(tmpdir(), 'st-rpg-relationship-records-'));
  const databasePath = join(root, 'campaigns.sqlite');
  let journal = await SqliteCampaignJournal.open(databasePath, 25);
  t.after(async () => {
    await journal.close();
    await rm(root, { recursive: true, force: true });
  });

  const created = await acceptCampaignCreate(journal, { requestId: 'relationship-campaign', title: 'Relationship Book' });
  const first = await acceptCampaignOperation(journal, created.campaignId, {
    requestId: 'relationship-source', expectedRevision: 1,
    operation: { kind: 'create_actor', actor: { id: 'actor-lavir', name: 'Lavir', summary: 'A demanding patron.' } },
  });
  const second = await acceptCampaignOperation(journal, created.campaignId, {
    requestId: 'relationship-target', expectedRevision: first.revision,
    operation: { kind: 'create_actor', actor: { id: 'actor-mara', name: 'Mara', summary: 'A precise investigator.' } },
  });
  const linked = await acceptCampaignOperation(journal, created.campaignId, {
    requestId: 'relationship-create', expectedRevision: second.revision,
    operation: { kind: 'create_relationship', relationship: {
      id: 'relationship-employer', sourceActorId: 'actor-lavir', targetActorId: 'actor-mara',
      kind: 'employer', status: 'active', notes: 'Lavir expects precise evidence.',
    } },
  });
  assert.equal(linked.document.relationships?.[0]?.kind, 'employer');
  const hits = await journal.search({ campaignId: created.campaignId, campaignRevision: linked.revision, query: 'precise employer Lavir', limit: 8 });
  assert.equal(hits.some(hit => hit.recordId === 'relationship-employer'), true);

  const updated = await acceptCampaignOperation(journal, created.campaignId, {
    requestId: 'relationship-update', expectedRevision: linked.revision,
    operation: { kind: 'update_relationship', relationshipId: 'relationship-employer',
      sourceActorId: 'actor-lavir', targetActorId: 'actor-mara', relationshipKind: 'patron',
      status: 'strained', notes: 'Lavir doubts Mara after the missing key.', visibility: 'narrator_secret' },
  });
  assert.equal(updated.document.relationships?.[0]?.status, 'strained');
  assert.equal(journal.readCampaign(created.campaignId, linked.revision).relationships?.[0]?.status, 'active');

  const archived = await acceptCampaignOperation(journal, created.campaignId, {
    requestId: 'relationship-archive', expectedRevision: updated.revision,
    operation: { kind: 'set_relationship_archived', relationshipId: 'relationship-employer', archived: true },
  });
  const restored = await acceptCampaignOperation(journal, created.campaignId, {
    requestId: 'relationship-restore', expectedRevision: archived.revision,
    operation: { kind: 'set_relationship_archived', relationshipId: 'relationship-employer', archived: false },
  });
  assert.equal(restored.document.relationships?.[0]?.archived, false);

  await journal.close();
  journal = await SqliteCampaignJournal.open(databasePath, 25);
  const reopened = journal.readCampaign(created.campaignId);
  assert.equal(reopened.relationships?.[0]?.kind, 'patron');
  assert.equal(reopened.relationships?.[0]?.visibility, 'narrator_secret');
  journal.verifyOrThrow();
});

test('Facts and World Objects attach beside world records, enter Scenes, retrieve, and survive restart', async t => {
  const root = await mkdtemp(join(tmpdir(), 'st-rpg-world-records-'));
  const databasePath = join(root, 'campaigns.sqlite');
  let journal = await SqliteCampaignJournal.open(databasePath, 25);
  t.after(async () => {
    await journal.close();
    await rm(root, { recursive: true, force: true });
  });

  const created = await acceptCampaignCreate(journal, { requestId: 'world-campaign', title: 'World Book' });
  assert.deepEqual(created.document.facts, []);
  assert.deepEqual(created.document.worldObjects, []);
  const place = await acceptCampaignOperation(journal, created.campaignId, {
    requestId: 'world-place', expectedRevision: created.revision,
    operation: { kind: 'create_place', place: { id: 'place-bedroom', name: 'Childhood Bedroom' } },
  });
  const worldObject = await acceptCampaignOperation(journal, created.campaignId, {
    requestId: 'world-object', expectedRevision: place.revision,
    operation: { kind: 'create_world_object', worldObject: {
      id: 'object-wardrobe', name: 'Heirloom Wardrobe', placeId: 'place-bedroom',
      summary: 'Ancient red mahogany with silver draconic filigree.',
    } },
  });
  const fact = await acceptCampaignOperation(journal, created.campaignId, {
    requestId: 'world-fact', expectedRevision: worldObject.revision,
    operation: { kind: 'create_fact', fact: {
      id: 'fact-wardrobe-key', name: 'Wardrobe key is missing', subjectId: 'object-wardrobe',
      summary: 'The silver key was removed before the heir returned.', visibility: 'narrator_secret',
    } },
  });
  const scene = await acceptCampaignOperation(journal, created.campaignId, {
    requestId: 'world-scene', expectedRevision: fact.revision,
    operation: { kind: 'set_current_scene', scene: {
      id: 'scene-bedroom', name: 'Return to the bedroom', placeId: 'place-bedroom',
      worldObjectIds: ['object-wardrobe'],
    } },
  });
  assert.equal(scene.document.worldObjects?.[0]?.placeId, 'place-bedroom');
  assert.equal(scene.document.facts?.[0]?.subjectId, 'object-wardrobe');
  assert.deepEqual(scene.document.currentScene?.worldObjectIds, ['object-wardrobe']);
  const hits = await journal.search({
    campaignId: created.campaignId,
    campaignRevision: scene.revision,
    query: 'red mahogany wardrobe filigree',
    limit: 8,
  });
  assert.equal(hits.some(hit => hit.recordId === 'object-wardrobe'), true);

  const archived = await acceptCampaignOperation(journal, created.campaignId, {
    requestId: 'world-fact-archive', expectedRevision: scene.revision,
    operation: { kind: 'set_fact_archived', factId: 'fact-wardrobe-key', archived: true },
  });
  assert.equal(archived.document.facts?.[0]?.archived, true);
  assert.equal(journal.readCampaign(created.campaignId, fact.revision).facts?.[0]?.archived, false);

  await journal.close();
  journal = await SqliteCampaignJournal.open(databasePath, 25);
  const reopened = journal.readCampaign(created.campaignId);
  assert.equal(reopened.worldObjects?.[0]?.name, 'Heirloom Wardrobe');
  assert.equal(reopened.facts?.[0]?.archived, true);
  assert.deepEqual(reopened.currentScene?.worldObjectIds, ['object-wardrobe']);
  journal.verifyOrThrow();
});

test('Advance Scene archives the closed Scene and opens the editable next Scene atomically', async t => {
  const root = await mkdtemp(join(tmpdir(), 'st-rpg-scene-advance-'));
  const databasePath = join(root, 'campaigns.sqlite');
  let journal = await SqliteCampaignJournal.open(databasePath, 25);
  t.after(async () => {
    await journal.close();
    await rm(root, { recursive: true, force: true });
  });

  const created = await acceptCampaignCreate(journal, { requestId: 'scene-advance-campaign', title: 'Scene Chronicle' });
  const actor = await acceptCampaignOperation(journal, created.campaignId, {
    requestId: 'scene-advance-actor', expectedRevision: created.revision,
    operation: { kind: 'create_actor', actor: { id: 'actor-mara', name: 'Mara' } },
  });
  const place = await acceptCampaignOperation(journal, created.campaignId, {
    requestId: 'scene-advance-place', expectedRevision: actor.revision,
    operation: { kind: 'create_place', place: { id: 'place-gate', name: 'Moon Gate' } },
  });
  const opened = await acceptCampaignOperation(journal, created.campaignId, {
    requestId: 'scene-advance-open', expectedRevision: place.revision,
    operation: { kind: 'set_current_scene', scene: {
      id: 'scene-arrival', name: 'Arrival at the sealed gate', summary: 'Mara reaches the gate.',
      placeId: 'place-gate', actorIds: ['actor-mara'],
    } },
  });

  const advanced = await acceptCampaignOperation(journal, created.campaignId, {
    requestId: 'scene-advance-next', expectedRevision: opened.revision,
    operation: {
      kind: 'advance_scene',
      closingSummary: 'Mara opens the Moon Gate and crosses the threshold.',
      outcomes: ['The Moon Gate is open.'],
      openThreads: ['Who rang the bell beyond the gate?'],
      nextScene: {
        id: 'scene-beyond', name: 'Beyond the Moon Gate', summary: 'A bell echoes in the silver fog.',
        placeId: 'place-gate', actorIds: ['actor-mara'],
      },
    },
  });

  assert.deepEqual(advanced.affectedIds, ['scene-arrival', 'scene-beyond']);
  assert.equal(advanced.document.currentScene?.id, 'scene-beyond');
  assert.equal(advanced.document.sceneArchives?.[0]?.id, 'scene-arrival');
  assert.equal(advanced.document.sceneArchives?.[0]?.summary, 'Mara opens the Moon Gate and crosses the threshold.');
  assert.deepEqual(advanced.document.sceneArchives?.[0]?.outcomes, ['The Moon Gate is open.']);
  assert.deepEqual(advanced.document.sceneArchives?.[0]?.openThreads, ['Who rang the bell beyond the gate?']);
  assert.equal(advanced.document.sceneArchives?.[0]?.closedAt, advanced.committedAt);
  assert.equal(journal.readCampaign(created.campaignId, opened.revision).currentScene?.id, 'scene-arrival');
  assert.deepEqual(journal.readCampaign(created.campaignId, opened.revision).sceneArchives, []);

  await journal.close();
  journal = await SqliteCampaignJournal.open(databasePath, 25);
  const reopened = journal.readCampaign(created.campaignId);
  assert.equal(reopened.currentScene?.name, 'Beyond the Moon Gate');
  assert.equal(reopened.sceneArchives?.[0]?.name, 'Arrival at the sealed gate');
  journal.verifyOrThrow();
});

test('V7 authority backs up, expands subject history, and opens with empty Ability collections', async t => {
  const root = await mkdtemp(join(tmpdir(), 'st-rpg-v7-ability-upgrade-'));
  const databasePath = join(root, 'campaigns.sqlite');
  let journal = await SqliteCampaignJournal.open(databasePath);
  t.after(async () => {
    try { await journal.close(); } catch { /* already closed */ }
    await rm(root, { recursive: true, force: true });
  });
  const created = await acceptCampaignCreate(journal, { requestId: 'v7-campaign', title: 'Before Abilities' });
  await acceptCampaignOperation(journal, created.campaignId, {
    requestId: 'v7-actor', expectedRevision: 1,
    operation: { kind: 'create_actor', actor: { id: 'actor-kept', name: 'Kept Actor' } },
  });
  await journal.close();

  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA foreign_keys = OFF;
    DROP INDEX campaign_event_changes_subject;
    ALTER TABLE campaign_event_changes RENAME TO campaign_event_changes_v8;
    CREATE TABLE campaign_event_changes (
      event_id TEXT NOT NULL REFERENCES campaign_events(event_id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
      subject_kind TEXT NOT NULL CHECK (subject_kind IN ('actor', 'item', 'quest', 'place', 'current_scene')),
      subject_id TEXT NOT NULL,
      before_schema_version INTEGER,
      before_image_json TEXT,
      before_hash TEXT,
      after_schema_version INTEGER,
      after_image_json TEXT,
      after_hash TEXT,
      PRIMARY KEY (event_id, ordinal)
    );
    INSERT INTO campaign_event_changes SELECT * FROM campaign_event_changes_v8;
    DROP TABLE campaign_event_changes_v8;
    CREATE INDEX campaign_event_changes_subject ON campaign_event_changes(subject_kind, subject_id);
    DROP TABLE campaign_learned_ability_projections;
    DROP TABLE campaign_ability_projections;
    DELETE FROM schema_migrations WHERE version = 8;
    PRAGMA foreign_keys = ON;
  `);
  database.close();

  journal = await SqliteCampaignJournal.open(databasePath);
  const upgraded = journal.readCampaign(created.campaignId);
  assert.equal(upgraded.actors[0]?.name, 'Kept Actor');
  assert.deepEqual(upgraded.abilities, []);
  assert.deepEqual(upgraded.learnedAbilities, []);
  journal.verifyOrThrow();
  await journal.close();
  assert.equal((await readdir(root)).some(name => name.startsWith('campaigns.sqlite.pre-migration-v8-')), true);
});

test('V8 authority receives an automatic backup before Relationship schema migration', async t => {
  const root = await mkdtemp(join(tmpdir(), 'st-rpg-v8-relationship-upgrade-'));
  const databasePath = join(root, 'campaigns.sqlite');
  let journal = await SqliteCampaignJournal.open(databasePath);
  t.after(async () => {
    try { await journal.close(); } catch { /* already closed */ }
    await rm(root, { recursive: true, force: true });
  });
  const created = await acceptCampaignCreate(journal, { requestId: 'v8-campaign', title: 'Before Relationships' });
  await acceptCampaignOperation(journal, created.campaignId, {
    requestId: 'v8-actor', expectedRevision: 1,
    operation: { kind: 'create_actor', actor: { id: 'actor-kept-v8', name: 'Kept V8 Actor' } },
  });
  await journal.close();

  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA foreign_keys = OFF;
    DROP INDEX campaign_event_changes_subject;
    ALTER TABLE campaign_event_changes RENAME TO campaign_event_changes_v9;
    CREATE TABLE campaign_event_changes (
      event_id TEXT NOT NULL REFERENCES campaign_events(event_id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
      subject_kind TEXT NOT NULL CHECK (subject_kind IN ('actor', 'item', 'quest', 'place', 'ability', 'learned_ability', 'current_scene')),
      subject_id TEXT NOT NULL,
      before_schema_version INTEGER,
      before_image_json TEXT,
      before_hash TEXT,
      after_schema_version INTEGER,
      after_image_json TEXT,
      after_hash TEXT,
      PRIMARY KEY (event_id, ordinal)
    );
    INSERT INTO campaign_event_changes SELECT * FROM campaign_event_changes_v9;
    DROP TABLE campaign_event_changes_v9;
    CREATE INDEX campaign_event_changes_subject ON campaign_event_changes(subject_kind, subject_id);
    DROP TABLE campaign_relationship_projections;
    DELETE FROM schema_migrations WHERE version = 9;
    PRAGMA foreign_keys = ON;
  `);
  database.close();

  journal = await SqliteCampaignJournal.open(databasePath);
  const upgraded = journal.readCampaign(created.campaignId);
  assert.equal(upgraded.actors[0]?.name, 'Kept V8 Actor');
  assert.deepEqual(upgraded.relationships, []);
  journal.verifyOrThrow();
  await journal.close();
  assert.equal((await readdir(root)).some(name => name.startsWith('campaigns.sqlite.pre-migration-v9-')), true);
});

test('V9 authority receives an automatic backup before Fact and World Object schema migration', async t => {
  const root = await mkdtemp(join(tmpdir(), 'st-rpg-v9-world-upgrade-'));
  const databasePath = join(root, 'campaigns.sqlite');
  let journal = await SqliteCampaignJournal.open(databasePath);
  t.after(async () => {
    try { await journal.close(); } catch { /* already closed */ }
    await rm(root, { recursive: true, force: true });
  });
  const created = await acceptCampaignCreate(journal, { requestId: 'v9-campaign', title: 'Before World Records' });
  await acceptCampaignOperation(journal, created.campaignId, {
    requestId: 'v9-place', expectedRevision: 1,
    operation: { kind: 'create_place', place: { id: 'place-kept-v9', name: 'Kept V9 Place' } },
  });
  await journal.close();

  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA foreign_keys = OFF;
    DROP INDEX campaign_event_changes_subject;
    ALTER TABLE campaign_event_changes RENAME TO campaign_event_changes_v10;
    CREATE TABLE campaign_event_changes (
      event_id TEXT NOT NULL REFERENCES campaign_events(event_id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
      subject_kind TEXT NOT NULL CHECK (subject_kind IN ('actor', 'item', 'quest', 'place', 'ability', 'learned_ability', 'relationship', 'current_scene')),
      subject_id TEXT NOT NULL,
      before_schema_version INTEGER,
      before_image_json TEXT,
      before_hash TEXT,
      after_schema_version INTEGER,
      after_image_json TEXT,
      after_hash TEXT,
      PRIMARY KEY (event_id, ordinal)
    );
    INSERT INTO campaign_event_changes SELECT * FROM campaign_event_changes_v10;
    DROP TABLE campaign_event_changes_v10;
    CREATE INDEX campaign_event_changes_subject ON campaign_event_changes(subject_kind, subject_id);
    DROP TABLE campaign_fact_projections;
    DROP TABLE campaign_world_object_projections;
    ALTER TABLE campaign_scene_projections DROP COLUMN world_object_ids_json;
    DELETE FROM schema_migrations WHERE version = 10;
    PRAGMA foreign_keys = ON;
  `);
  database.close();

  journal = await SqliteCampaignJournal.open(databasePath);
  const upgraded = journal.readCampaign(created.campaignId);
  assert.equal(upgraded.places[0]?.name, 'Kept V9 Place');
  assert.deepEqual(upgraded.facts, []);
  assert.deepEqual(upgraded.worldObjects, []);
  journal.verifyOrThrow();
  await journal.close();
  assert.equal((await readdir(root)).some(name => name.startsWith('campaigns.sqlite.pre-migration-v10-')), true);
});

test('V10 authority receives an automatic backup before Scene Archive schema migration', async t => {
  const root = await mkdtemp(join(tmpdir(), 'st-rpg-v10-scene-archive-upgrade-'));
  const databasePath = join(root, 'campaigns.sqlite');
  let journal = await SqliteCampaignJournal.open(databasePath);
  t.after(async () => {
    try { await journal.close(); } catch { /* already closed */ }
    await rm(root, { recursive: true, force: true });
  });
  const created = await acceptCampaignCreate(journal, { requestId: 'v10-campaign', title: 'Before Scene Archives' });
  await acceptCampaignOperation(journal, created.campaignId, {
    requestId: 'v10-scene', expectedRevision: created.revision,
    operation: { kind: 'set_current_scene', scene: { id: 'scene-kept-v10', name: 'Kept V10 Scene' } },
  });
  await journal.close();

  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA foreign_keys = OFF;
    DROP INDEX campaign_event_changes_subject;
    ALTER TABLE campaign_event_changes RENAME TO campaign_event_changes_v11;
    CREATE TABLE campaign_event_changes (
      event_id TEXT NOT NULL REFERENCES campaign_events(event_id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
      subject_kind TEXT NOT NULL CHECK (subject_kind IN (
        'actor', 'item', 'quest', 'place', 'fact', 'world_object',
        'ability', 'learned_ability', 'relationship', 'current_scene'
      )),
      subject_id TEXT NOT NULL,
      before_schema_version INTEGER,
      before_image_json TEXT,
      before_hash TEXT,
      after_schema_version INTEGER,
      after_image_json TEXT,
      after_hash TEXT,
      PRIMARY KEY (event_id, ordinal)
    );
    INSERT INTO campaign_event_changes SELECT * FROM campaign_event_changes_v11;
    DROP TABLE campaign_event_changes_v11;
    CREATE INDEX campaign_event_changes_subject ON campaign_event_changes(subject_kind, subject_id);
    DROP TABLE campaign_scene_archive_projections;
    DELETE FROM schema_migrations WHERE version = 11;
    PRAGMA foreign_keys = ON;
  `);
  database.close();

  journal = await SqliteCampaignJournal.open(databasePath);
  const upgraded = journal.readCampaign(created.campaignId);
  assert.equal(upgraded.currentScene?.name, 'Kept V10 Scene');
  assert.deepEqual(upgraded.sceneArchives, []);
  journal.verifyOrThrow();
  await journal.close();
  assert.equal((await readdir(root)).some(name => name.startsWith('campaigns.sqlite.pre-migration-v11-')), true);
});
