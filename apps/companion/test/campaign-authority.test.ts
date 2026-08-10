import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import {
  SqliteCampaignJournal,
  type CampaignJournalFaultPoint,
} from '../src/adapters/sqlite/campaign-journal.js';
import { CAMPAIGN_AUTHORITY_MIGRATION, campaignMigrationChecksum } from '../src/migrations/001-campaign-authority.js';
import { canonicalJson, eventHash, type CampaignState } from '../src/modules/campaign/campaign-state.js';
import {
  buildCampaignSnapshotInWorker,
  readCampaignRevisionInWorker,
} from '../src/adapters/sqlite/campaign-maintenance.js';
import {
  acceptCampaignCreate,
  acceptCampaignOperation,
  CampaignOutcomeError,
} from './campaign-test-helpers.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'st-rpg-authority-'));
  return {
    root,
    databasePath: join(root, 'campaigns.sqlite'),
    backupPath: join(root, 'campaigns.backup.sqlite'),
  };
}

test('Campaign history is durable, idempotent, revisioned, and reconstructable', async t => {
  const files = await fixture();
  let journal = await SqliteCampaignJournal.open(files.databasePath, 2);
  t.after(async () => {
    await journal.close();
    await rm(files.root, { recursive: true, force: true });
  });

  const created = await acceptCampaignCreate(journal, { requestId: 'create-1', title: 'Ashes of Harcourt' });
  assert.equal(created.revision, 1);
  assert.equal(created.document.actors.length, 0);

  const duplicate = await acceptCampaignCreate(journal, { requestId: 'create-1', title: 'Ashes of Harcourt' });
  assert.equal(duplicate.idempotent, true);
  assert.equal(duplicate.campaignId, created.campaignId);
  assert.equal(journal.history(created.campaignId).length, 1);

  const actorCommit = await acceptCampaignOperation(journal, created.campaignId, {
    requestId: 'actor-1',
    expectedRevision: 1,
    operation: { kind: 'create_actor', actor: { name: 'Lavitz' } },
  });
  assert.equal(actorCommit.revision, 2);
  assert.equal(actorCommit.document.actors[0]?.name, 'Lavitz');

  await assert.rejects(
    acceptCampaignOperation(journal, created.campaignId, {
      requestId: 'stale-1',
      expectedRevision: 1,
      operation: { kind: 'rename_actor', actorId: actorCommit.affectedIds[0]!, name: 'Stale Lavitz' },
    }),
    error => error instanceof CampaignOutcomeError && error.code === 'CAMPAIGN_REVISION_CONFLICT',
  );
  assert.equal(journal.history(created.campaignId).length, 2);
  assert.equal(journal.readCampaign(created.campaignId, 1).actors.length, 0);
  assert.equal(journal.readCampaign(created.campaignId, 2).actors[0]?.name, 'Lavitz');

  const performance = journal.performance();
  assert.equal(performance.sampleCount, 2);
  assert.ok(performance.latestMs >= 0);
  assert.equal(performance.targetMs, 50);
  assert.equal(performance.investigationMs, 200);

  await journal.close();
  journal = await SqliteCampaignJournal.open(files.databasePath, 2);
  assert.equal(journal.readCampaign(created.campaignId).actors[0]?.name, 'Lavitz');
  journal.verifyOrThrow();
});

test('subject-change Events preserve exact Campaign Revisions without full Campaign copies', async t => {
  const files = await fixture();
  let journal = await SqliteCampaignJournal.open(files.databasePath, 100);
  t.after(async () => {
    await journal.close();
    await rm(files.root, { recursive: true, force: true });
  });

  const created = await acceptCampaignCreate(journal, { requestId: 'subject-create', title: 'Subject History' });
  const actor = await acceptCampaignOperation(journal, created.campaignId, {
    requestId: 'subject-actor',
    expectedRevision: 1,
    operation: { kind: 'create_actor', actor: { id: 'actor-1', name: 'Before Name' } },
  });
  await acceptCampaignOperation(journal, created.campaignId, {
    requestId: 'subject-rename',
    expectedRevision: 2,
    operation: { kind: 'rename_actor', actorId: 'actor-1', name: 'After Name' },
  });

  const duplicate = await acceptCampaignOperation(journal, created.campaignId, {
    requestId: 'subject-actor',
    expectedRevision: 1,
    operation: { kind: 'create_actor', actor: { id: 'actor-1', name: 'Before Name' } },
  });
  assert.equal(duplicate.idempotent, true);
  assert.equal(duplicate.revision, actor.revision);
  assert.equal(duplicate.document.actors[0]?.name, 'Before Name');

  await journal.close();
  const database = new DatabaseSync(files.databasePath, { readOnly: true });
  try {
    const events = database.prepare(`
      SELECT revision, event_schema_version, before_state_json, after_state_json
      FROM campaign_events WHERE campaign_id = ? ORDER BY revision
    `).all(created.campaignId) as Array<{
      revision: number;
      event_schema_version: number;
      before_state_json: string | null;
      after_state_json: string;
    }>;
    assert.deepEqual(events.map(event => ({ ...event })), [
      { revision: 1, event_schema_version: 2, before_state_json: null, after_state_json: '{}' },
      { revision: 2, event_schema_version: 2, before_state_json: null, after_state_json: '{}' },
      { revision: 3, event_schema_version: 2, before_state_json: null, after_state_json: '{}' },
    ]);
    const changes = database.prepare(`
      SELECT event_id, subject_kind, subject_id, before_image_json, after_image_json
      FROM campaign_event_changes ORDER BY event_id, ordinal
    `).all() as Array<Record<string, unknown>>;
    assert.equal(changes.length, 2);
    assert.deepEqual(changes.map(change => [change.subject_kind, change.subject_id]), [
      ['actor', 'actor-1'],
      ['actor', 'actor-1'],
    ]);
    const receipts = database.prepare('SELECT outcome_json FROM request_receipts ORDER BY request_id').all() as Array<{ outcome_json: string }>;
    assert.equal(receipts.every(receipt => !Object.hasOwn(JSON.parse(receipt.outcome_json) as object, 'document')), true);
  } finally {
    database.close();
  }

  journal = await SqliteCampaignJournal.open(files.databasePath, 100);
  assert.equal(journal.readCampaign(created.campaignId, 1).actors.length, 0);
  assert.equal(journal.readCampaign(created.campaignId, 2).actors[0]?.name, 'Before Name');
  assert.equal(journal.readCampaign(created.campaignId, 3).actors[0]?.name, 'After Name');
  journal.verifyOrThrow();
});

test('normalized current projections replace the legacy full Campaign head copy', async t => {
  const files = await fixture();
  let journal = await SqliteCampaignJournal.open(files.databasePath, 100);
  t.after(async () => {
    await journal.close();
    await rm(files.root, { recursive: true, force: true });
  });

  const created = await acceptCampaignCreate(journal, { requestId: 'projection-create', title: 'Projection Campaign' });
  await acceptCampaignOperation(journal, created.campaignId, {
    requestId: 'projection-actor',
    expectedRevision: 1,
    operation: { kind: 'create_actor', actor: { id: 'actor-1', name: 'Lavitz' } },
  });
  await acceptCampaignOperation(journal, created.campaignId, {
    requestId: 'projection-item',
    expectedRevision: 2,
    operation: { kind: 'create_item', item: { id: 'item-1', name: 'Wardrobe Key' } },
  });
  await acceptCampaignOperation(journal, created.campaignId, {
    requestId: 'projection-scene',
    expectedRevision: 3,
    operation: { kind: 'set_current_scene', scene: { id: 'scene-1', name: 'Childhood Bedroom' } },
  });
  await journal.close();

  const database = new DatabaseSync(files.databasePath, { readOnly: true });
  try {
    const campaign = database.prepare('SELECT current_state_json FROM campaigns WHERE campaign_id = ?')
      .get(created.campaignId) as { current_state_json: string };
    assert.equal(campaign.current_state_json, '{}');
    assert.deepEqual(
      database.prepare('SELECT actor_id, name FROM campaign_actor_projections WHERE campaign_id = ? ORDER BY actor_id')
        .all(created.campaignId).map(row => ({ ...row })),
      [{ actor_id: 'actor-1', name: 'Lavitz' }],
    );
    assert.deepEqual(
      database.prepare('SELECT item_id, name FROM campaign_item_projections WHERE campaign_id = ? ORDER BY item_id')
        .all(created.campaignId).map(row => ({ ...row })),
      [{ item_id: 'item-1', name: 'Wardrobe Key' }],
    );
    assert.deepEqual(
      database.prepare('SELECT scene_id, name FROM campaign_scene_projections WHERE campaign_id = ?')
        .all(created.campaignId).map(row => ({ ...row })),
      [{ scene_id: 'scene-1', name: 'Childhood Bedroom' }],
    );
  } finally {
    database.close();
  }

  journal = await SqliteCampaignJournal.open(files.databasePath, 100);
  const current = journal.readCampaign(created.campaignId);
  assert.equal(current.campaign.revision, 4);
  assert.equal(current.actors[0]?.name, 'Lavitz');
  assert.equal(current.items[0]?.name, 'Wardrobe Key');
  assert.equal(current.currentScene?.name, 'Childhood Bedroom');
});

test('existing V1 Campaign upgrades through a verified backup and continues with V2 subject Events', async t => {
  const files = await fixture();
  t.after(() => rm(files.root, { recursive: true, force: true }));
  const campaignId = 'legacy-campaign';
  const eventId = 'legacy-event-1';
  const requestId = 'legacy-request-1';
  const committedAt = '2026-08-08T00:00:00.000Z';
  const secondEventId = 'legacy-event-2';
  const secondRequestId = 'legacy-request-2';
  const secondCommittedAt = '2026-08-08T00:00:01.000Z';
  const operation = { kind: 'create_campaign', title: 'Legacy Campaign' };
  const firstState: CampaignState = {
    campaign: {
      id: campaignId,
      title: 'Legacy Campaign',
      status: 'active',
      revision: 1,
      createdAt: committedAt,
      updatedAt: committedAt,
    },
    actors: {},
    items: {},
    currentScene: null,
  };
  const firstHash = eventHash({
    campaignId,
    revision: 1,
    eventId,
    requestId,
    operationKind: operation.kind,
    operation,
    beforeState: null,
    afterState: firstState,
    acceptedAt: committedAt,
    previousEventHash: null,
  });
  const secondOperation = { kind: 'create_actor', actor: { id: 'legacy-actor', name: 'Before Upgrade' } };
  const secondState: CampaignState = {
    ...structuredClone(firstState),
    campaign: { ...firstState.campaign, revision: 2, updatedAt: secondCommittedAt },
    actors: {
      'legacy-actor': { id: 'legacy-actor', name: 'Before Upgrade', summary: '', archived: false },
    },
  };
  const secondHash = eventHash({
    campaignId,
    revision: 2,
    eventId: secondEventId,
    requestId: secondRequestId,
    operationKind: secondOperation.kind,
    operation: secondOperation,
    beforeState: firstState,
    afterState: secondState,
    acceptedAt: secondCommittedAt,
    previousEventHash: firstHash,
  });
  const legacy = new DatabaseSync(files.databasePath);
  legacy.exec(`
    PRAGMA application_id = 1380992819;
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
    ${CAMPAIGN_AUTHORITY_MIGRATION.source}
  `);
  legacy.prepare('INSERT INTO store_meta(singleton, store_epoch) VALUES (1, ?)').run('legacy-store');
  legacy.prepare('INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (?, ?, ?, ?)')
    .run(1, CAMPAIGN_AUTHORITY_MIGRATION.name, campaignMigrationChecksum(), committedAt);
  legacy.prepare(`
    INSERT INTO campaigns(campaign_id, title, status, current_revision, current_state_json, head_event_hash, created_at, updated_at)
    VALUES (?, ?, 'active', 2, ?, ?, ?, ?)
  `).run(campaignId, 'Legacy Campaign', canonicalJson(secondState), secondHash, committedAt, secondCommittedAt);
  legacy.prepare(`
    INSERT INTO campaign_events(campaign_id, revision, event_id, request_id, event_schema_version, operation_kind, operation_json, before_state_json, after_state_json, accepted_at, previous_event_hash, event_hash)
    VALUES (?, 1, ?, ?, 1, ?, ?, NULL, ?, ?, NULL, ?)
  `).run(campaignId, eventId, requestId, operation.kind, canonicalJson(operation), canonicalJson(firstState), committedAt, firstHash);
  legacy.prepare(`
    INSERT INTO campaign_events(campaign_id, revision, event_id, request_id, event_schema_version, operation_kind, operation_json, before_state_json, after_state_json, accepted_at, previous_event_hash, event_hash)
    VALUES (?, 2, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    campaignId,
    secondEventId,
    secondRequestId,
    secondOperation.kind,
    canonicalJson(secondOperation),
    canonicalJson(firstState),
    canonicalJson(secondState),
    secondCommittedAt,
    firstHash,
    secondHash,
  );
  legacy.close();

  const journal = await SqliteCampaignJournal.open(files.databasePath, 100);
  try {
    assert.equal(journal.readCampaign(campaignId, 1).campaign.title, 'Legacy Campaign');
    assert.equal(journal.readCampaign(campaignId).actors[0]?.name, 'Before Upgrade');
    const actor = await acceptCampaignOperation(journal, campaignId, {
      requestId: 'legacy-v2-actor',
      expectedRevision: 2,
      operation: { kind: 'create_actor', actor: { id: 'post-upgrade-actor', name: 'After Upgrade' } },
    });
    assert.equal(actor.revision, 3);
    assert.equal(journal.readCampaign(campaignId, 1).actors.length, 0);
    assert.equal(journal.readCampaign(campaignId, 2).actors[0]?.name, 'Before Upgrade');
    assert.deepEqual(journal.readCampaign(campaignId, 3).actors.map(record => record.name), ['After Upgrade', 'Before Upgrade']);
    journal.verifyOrThrow();
  } finally {
    await journal.close();
  }

  const filesAfter = await readdir(files.root);
  assert.equal(filesAfter.some(name => name.startsWith('campaigns.sqlite.pre-migration-v2-') && name.endsWith('.sqlite')), true);
});

test('Item and current Scene subject Events replay independently', async t => {
  const files = await fixture();
  const journal = await SqliteCampaignJournal.open(files.databasePath, 100);
  t.after(async () => {
    await journal.close();
    await rm(files.root, { recursive: true, force: true });
  });
  const created = await acceptCampaignCreate(journal, { requestId: 'kinds-create', title: 'Kinds Campaign' });
  await acceptCampaignOperation(journal, created.campaignId, {
    requestId: 'kinds-item',
    expectedRevision: 1,
    operation: { kind: 'create_item', item: { id: 'item-1', name: 'Wardrobe Key' } },
  });
  await acceptCampaignOperation(journal, created.campaignId, {
    requestId: 'kinds-scene-one',
    expectedRevision: 2,
    operation: { kind: 'set_current_scene', scene: { id: 'scene-1', name: 'Childhood Bedroom' } },
  });
  await acceptCampaignOperation(journal, created.campaignId, {
    requestId: 'kinds-scene-edit',
    expectedRevision: 3,
    operation: { kind: 'set_current_scene', scene: { id: 'scene-1', name: 'Wardrobe Interior' } },
  });

  assert.equal(journal.readCampaign(created.campaignId, 1).items.length, 0);
  assert.equal(journal.readCampaign(created.campaignId, 2).items[0]?.name, 'Wardrobe Key');
  assert.equal(journal.readCampaign(created.campaignId, 2).currentScene, null);
  assert.equal(journal.readCampaign(created.campaignId, 3).currentScene?.name, 'Childhood Bedroom');
  assert.equal(journal.readCampaign(created.campaignId, 4).currentScene?.name, 'Wardrobe Interior');
  journal.verifyOrThrow();
});

test('joined Actor and Item Operation preserves both subjects and ownership through replay', async t => {
  const files = await fixture();
  let journal = await SqliteCampaignJournal.open(files.databasePath, 100);
  t.after(async () => {
    await journal.close();
    await rm(files.root, { recursive: true, force: true });
  });

  const created = await acceptCampaignCreate(journal, { requestId: 'joined-create', title: 'Joined Campaign' });
  const joined = await acceptCampaignOperation(journal, created.campaignId, {
    requestId: 'joined-operation',
    expectedRevision: 1,
    operation: {
      kind: 'create_actor_with_item',
      actor: { id: 'actor-owner', name: 'Lavitz' },
      item: { id: 'item-owned', name: 'Wardrobe Key' },
    },
  });
  assert.deepEqual(joined.affectedIds, ['actor-owner', 'item-owned']);
  assert.equal(joined.document.items[0]?.ownerActorId, 'actor-owner');
  assert.equal(journal.readCampaign(created.campaignId, 1).items.length, 0);
  assert.equal(journal.readCampaign(created.campaignId, 2).items[0]?.ownerActorId, 'actor-owner');

  await journal.close();
  journal = await SqliteCampaignJournal.open(files.databasePath, 100);
  const reopened = journal.readCampaign(created.campaignId);
  assert.equal(reopened.actors[0]?.id, 'actor-owner');
  assert.equal(reopened.items[0]?.ownerActorId, 'actor-owner');
  journal.verifyOrThrow();
});

test('interactive commit does not wait for snapshot maintenance and close drains it safely', async t => {
  const files = await fixture();
  let releaseSnapshot!: () => void;
  let reportSnapshotStarted!: () => void;
  const snapshotGate = new Promise<void>(resolve => {
    releaseSnapshot = resolve;
  });
  const snapshotStarted = new Promise<void>(resolve => {
    reportSnapshotStarted = resolve;
  });
  const journal = await SqliteCampaignJournal.open(files.databasePath, {
    snapshotInterval: 2,
    async snapshotBuilder(databasePath, campaignId, revision) {
      reportSnapshotStarted();
      await snapshotGate;
      return buildCampaignSnapshotInWorker(databasePath, campaignId, revision);
    },
  });
  t.after(async () => {
    await journal.close();
    await rm(files.root, { recursive: true, force: true });
  });

  const created = await acceptCampaignCreate(journal, { requestId: 'deferred-create', title: 'Deferred Snapshot' });
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const commitPromise = acceptCampaignOperation(journal, created.campaignId, {
      requestId: 'deferred-actor',
      expectedRevision: 1,
      operation: { kind: 'create_actor', actor: { id: 'deferred-actor', name: 'Snapshot Actor' } },
  });
  await snapshotStarted;
  const commit = await Promise.race([
    commitPromise,
    new Promise<never>((_resolve, reject) => {
      deadline = setTimeout(() => reject(new Error('Interactive commit deadlocked behind snapshot maintenance.')), 5_000);
    }),
  ]).finally(() => clearTimeout(deadline));
  assert.equal(commit.revision, 2);
  assert.match(journal.observation().message, /Snapshot maintenance pending: 1/);

  releaseSnapshot();
  await journal.close();
  const database = new DatabaseSync(files.databasePath, { readOnly: true });
  try {
    const row = database.prepare(`
      SELECT state_json FROM campaign_snapshots WHERE campaign_id = ? AND revision = 2
    `).get(created.campaignId) as { state_json: string } | undefined;
    assert.ok(row);
    assert.equal(JSON.parse(row.state_json).actors['deferred-actor'].name, 'Snapshot Actor');
  } finally {
    database.close();
  }
});

test('close waits for an admitted commit and its deferred snapshot before releasing SQLite', async t => {
  const files = await fixture();
  let releaseSnapshot!: () => void;
  let reportSnapshotStarted!: () => void;
  const snapshotGate = new Promise<void>(resolve => { releaseSnapshot = resolve; });
  const snapshotStarted = new Promise<void>(resolve => { reportSnapshotStarted = resolve; });
  let journal = await SqliteCampaignJournal.open(files.databasePath, {
    snapshotInterval: 2,
    async snapshotBuilder(databasePath, campaignId, revision) {
      reportSnapshotStarted();
      await snapshotGate;
      return buildCampaignSnapshotInWorker(databasePath, campaignId, revision);
    },
  });
  t.after(async () => {
    await journal.close().catch(() => undefined);
    await rm(files.root, { recursive: true, force: true });
  });

  const created = await acceptCampaignCreate(journal, { requestId: 'close-race-create', title: 'Close Race' });
  const commitPromise = acceptCampaignOperation(journal, created.campaignId, {
    requestId: 'close-race-actor',
    expectedRevision: 1,
    operation: { kind: 'create_actor', actor: { id: 'close-race-actor', name: 'Durable Actor' } },
  });
  const closePromise = journal.close();
  const commit = await commitPromise;
  const firstLifecycleResult = await Promise.race([
    closePromise.then(() => 'closed' as const),
    snapshotStarted.then(() => 'snapshot-started' as const),
  ]);
  assert.equal(firstLifecycleResult, 'snapshot-started');

  releaseSnapshot();
  await closePromise;
  journal = await SqliteCampaignJournal.open(files.databasePath, 2);
  assert.equal(journal.readCampaign(created.campaignId).campaign.revision, commit.revision);
  assert.equal(journal.readCampaign(created.campaignId).actors[0]?.name, 'Durable Actor');
  journal.verifyOrThrow();
});

test('backup and restore form an exclusive barrier around admitted commits and snapshots', async t => {
  const files = await fixture();
  let releaseSnapshot!: () => void;
  let reportSnapshotStarted!: () => void;
  let releaseRestoreActivation!: () => void;
  let reportRestoreActivationStarted!: () => void;
  const snapshotGate = new Promise<void>(resolve => { releaseSnapshot = resolve; });
  const snapshotStarted = new Promise<void>(resolve => { reportSnapshotStarted = resolve; });
  const restoreActivationGate = new Promise<void>(resolve => { releaseRestoreActivation = resolve; });
  const restoreActivationStarted = new Promise<void>(resolve => { reportRestoreActivationStarted = resolve; });
  const restoreSource = join(files.root, 'restore-source.sqlite');
  const concurrentBackup = join(files.root, 'concurrent-backup.sqlite');
  const journal = await SqliteCampaignJournal.open(files.databasePath, {
    snapshotInterval: 2,
    async snapshotBuilder(databasePath, campaignId, revision) {
      reportSnapshotStarted();
      await snapshotGate;
      return buildCampaignSnapshotInWorker(databasePath, campaignId, revision);
    },
    async beforeRestoreActivation() {
      reportRestoreActivationStarted();
      await restoreActivationGate;
    },
  });
  t.after(async () => {
    await journal.close().catch(() => undefined);
    await rm(files.root, { recursive: true, force: true });
  });

  const created = await acceptCampaignCreate(journal, { requestId: 'barrier-create', title: 'Barrier Campaign' });
  await journal.backupTo(restoreSource);
  const commitPromise = acceptCampaignOperation(journal, created.campaignId, {
    requestId: 'barrier-actor',
    expectedRevision: 1,
    operation: { kind: 'create_actor', actor: { id: 'barrier-actor', name: 'Barrier Actor' } },
  });
  const backupPromise = journal.backupTo(concurrentBackup);
  await commitPromise;
  await snapshotStarted;
  releaseSnapshot();
  await backupPromise;

  const backup = await SqliteCampaignJournal.open(concurrentBackup, 2);
  try {
    assert.equal(backup.readCampaign(created.campaignId).campaign.revision, 2);
    backup.verifyOrThrow();
  } finally {
    await backup.close();
  }

  const admittedCommit = acceptCampaignOperation(journal, created.campaignId, {
    requestId: 'barrier-rename',
    expectedRevision: 2,
    operation: { kind: 'rename_actor', actorId: 'barrier-actor', name: 'Committed Before Restore' },
  });
  const restorePromise = journal.restoreFrom(restoreSource);
  assert.equal((await admittedCommit).revision, 3);
  await restoreActivationStarted;
  const readPromise = journal.readAt({ kind: 'campaign', campaignId: created.campaignId });
  const firstReadResult = await Promise.race([
    readPromise.then(() => 'read-completed' as const),
    Promise.resolve('read-blocked' as const),
  ]);
  assert.equal(firstReadResult, 'read-blocked');
  releaseRestoreActivation();
  await restorePromise;
  assert.equal((await readPromise).campaign.revision, 1);
  assert.equal(journal.observation().ready, true);
  journal.verifyOrThrow();
});

test('idempotent receipt hydration completes before a queued restore replaces authority', async t => {
  const files = await fixture();
  const restoreSource = join(files.root, 'receipt-restore-source.sqlite');
  let releaseRevisionRead!: () => void;
  let reportRevisionReadStarted!: () => void;
  const revisionReadGate = new Promise<void>(resolve => { releaseRevisionRead = resolve; });
  const revisionReadStarted = new Promise<void>(resolve => { reportRevisionReadStarted = resolve; });
  const journal = await SqliteCampaignJournal.open(files.databasePath, {
    snapshotInterval: 100,
    async revisionReader(databasePath, campaignId, revision) {
      reportRevisionReadStarted();
      await revisionReadGate;
      return readCampaignRevisionInWorker(databasePath, campaignId, revision);
    },
  });
  t.after(async () => {
    await journal.close().catch(() => undefined);
    await rm(files.root, { recursive: true, force: true });
  });

  const created = await acceptCampaignCreate(journal, { requestId: 'receipt-race-create', title: 'Receipt Race' });
  await journal.backupTo(restoreSource);
  const request = {
    requestId: 'receipt-race-actor',
    expectedRevision: 1,
    operation: { kind: 'create_actor' as const, actor: { id: 'receipt-race-actor', name: 'Receipt Actor' } },
  };
  const accepted = await acceptCampaignOperation(journal, created.campaignId, request);
  const duplicatePromise = acceptCampaignOperation(journal, created.campaignId, request);
  const restorePromise = journal.restoreFrom(restoreSource);
  const firstResult = await Promise.race([
    revisionReadStarted.then(() => 'receipt-read' as const),
    restorePromise.then(() => 'restore-completed' as const),
  ]);
  releaseRevisionRead();
  assert.equal(firstResult, 'receipt-read');

  const duplicate = await duplicatePromise;
  assert.equal(duplicate.idempotent, true);
  assert.equal(duplicate.revision, accepted.revision);
  assert.equal(duplicate.document.actors[0]?.name, 'Receipt Actor');
  await restorePromise;
  assert.equal(journal.readCampaign(created.campaignId).campaign.revision, 1);
  journal.verifyOrThrow();
});

test('snapshot failure blocks readiness, backup, and later mutations until a clean restart', async t => {
  const files = await fixture();
  let journal = await SqliteCampaignJournal.open(files.databasePath, {
    snapshotInterval: 2,
    async snapshotBuilder() {
      throw new Error('injected snapshot failure');
    },
  });
  t.after(async () => {
    await journal.close().catch(() => undefined);
    await rm(files.root, { recursive: true, force: true });
  });

  const created = await acceptCampaignCreate(journal, { requestId: 'snapshot-failure-create', title: 'Snapshot Failure' });
  await acceptCampaignOperation(journal, created.campaignId, {
    requestId: 'snapshot-failure-actor',
    expectedRevision: 1,
    operation: { kind: 'create_actor', actor: { id: 'snapshot-failure-actor', name: 'Preserved Actor' } },
  });

  await assert.rejects(journal.backupTo(files.backupPath), /snapshot maintenance failed/i);
  assert.equal(journal.observation().ready, false);
  assert.equal(
    (await journal.readAt({ kind: 'campaign', campaignId: created.campaignId })).campaign.revision,
    2,
  );
  await assert.rejects(
    acceptCampaignOperation(journal, created.campaignId, {
      requestId: 'snapshot-failure-later',
      expectedRevision: 2,
      operation: { kind: 'rename_actor', actorId: 'snapshot-failure-actor', name: 'Must Not Commit' },
    }),
    error => error instanceof CampaignOutcomeError && error.code === 'CAMPAIGN_STORE_UNAVAILABLE',
  );
  await assert.rejects(journal.close(), /snapshot maintenance failed/i);

  journal = await SqliteCampaignJournal.open(files.databasePath, 2);
  assert.equal(journal.readCampaign(created.campaignId).campaign.revision, 2);
  assert.equal(journal.readCampaign(created.campaignId).actors[0]?.name, 'Preserved Actor');
  assert.equal(journal.observation().ready, true);
  journal.verifyOrThrow();
});

test('injected transaction failure rolls back Event, projection, snapshot, and request receipt', async t => {
  const files = await fixture();
  let activeFault: CampaignJournalFaultPoint | null = null;
  const journal = await SqliteCampaignJournal.open(files.databasePath, {
    snapshotInterval: 2,
    faultInjector(point) {
      if (point === activeFault) throw new Error(`Injected fault at ${point}`);
    },
  });
  t.after(async () => {
    await journal.close();
    await rm(files.root, { recursive: true, force: true });
  });

  const created = await acceptCampaignCreate(journal, { requestId: 'fault-create', title: 'Atomic Campaign' });
  activeFault = 'execute.after-event';
  const request = {
    requestId: 'fault-operation',
    expectedRevision: 1,
    operation: { kind: 'create_actor' as const, actor: { name: 'Should Roll Back' } },
  };
  await assert.rejects(acceptCampaignOperation(journal, created.campaignId, request), /Injected fault/);

  assert.equal(journal.readCampaign(created.campaignId).campaign.revision, 1);
  assert.equal(journal.readCampaign(created.campaignId).actors.length, 0);
  assert.equal(journal.history(created.campaignId).length, 1);
  assert.equal(journal.performance().sampleCount, 1);

  activeFault = null;
  const accepted = await acceptCampaignOperation(journal, created.campaignId, request);
  assert.equal(accepted.revision, 2);
  assert.equal(accepted.document.actors[0]?.name, 'Should Roll Back');
  assert.equal(journal.history(created.campaignId).length, 2);
});

test('verified backup and restore return the authoritative Campaign to the backed-up revision', async t => {
  const files = await fixture();
  const journal = await SqliteCampaignJournal.open(files.databasePath, 25);
  t.after(async () => {
    await journal.close();
    await rm(files.root, { recursive: true, force: true });
  });

  const created = await acceptCampaignCreate(journal, { requestId: 'create-backup', title: 'Backup Campaign' });
  const actor = await acceptCampaignOperation(journal, created.campaignId, {
    requestId: 'actor-backup',
    expectedRevision: 1,
    operation: { kind: 'create_actor', actor: { name: 'Before Backup' } },
  });
  const epochBeforeRestore = journal.storeEpoch();
  await journal.backupTo(files.backupPath);
  await acceptCampaignOperation(journal, created.campaignId, {
    requestId: 'rename-after-backup',
    expectedRevision: 2,
    operation: { kind: 'rename_actor', actorId: actor.affectedIds[0]!, name: 'After Backup' },
  });
  assert.equal(journal.readCampaign(created.campaignId).actors[0]?.name, 'After Backup');

  await journal.restoreFrom(files.backupPath);
  assert.notEqual(journal.storeEpoch(), epochBeforeRestore);
  assert.equal(journal.readCampaign(created.campaignId).campaign.revision, 2);
  assert.equal(journal.readCampaign(created.campaignId).actors[0]?.name, 'Before Backup');
});

test('restore interruption recovers and verifies the previous authority before returning failure', async t => {
  const files = await fixture();
  let activeFault: CampaignJournalFaultPoint | null = null;
  const journal = await SqliteCampaignJournal.open(files.databasePath, {
    faultInjector(point) {
      if (point === activeFault) throw new Error(`Injected fault at ${point}`);
    },
  });
  t.after(async () => {
    await journal.close();
    await rm(files.root, { recursive: true, force: true });
  });

  const created = await acceptCampaignCreate(journal, { requestId: 'restore-create', title: 'Restore Campaign' });
  const actor = await acceptCampaignOperation(journal, created.campaignId, {
    requestId: 'restore-actor',
    expectedRevision: 1,
    operation: { kind: 'create_actor', actor: { name: 'Backup Name' } },
  });
  await journal.backupTo(files.backupPath);
  await acceptCampaignOperation(journal, created.campaignId, {
    requestId: 'restore-current',
    expectedRevision: 2,
    operation: { kind: 'rename_actor', actorId: actor.affectedIds[0]!, name: 'Current Name' },
  });

  activeFault = 'restore.after-target-remove';
  await assert.rejects(journal.restoreFrom(files.backupPath), /Injected fault/);
  assert.equal(journal.readCampaign(created.campaignId).campaign.revision, 3);
  assert.equal(journal.readCampaign(created.campaignId).actors[0]?.name, 'Current Name');
  journal.verifyOrThrow();

  activeFault = null;
  await journal.restoreFrom(files.backupPath);
  assert.equal(journal.readCampaign(created.campaignId).campaign.revision, 2);
  assert.equal(journal.readCampaign(created.campaignId).actors[0]?.name, 'Backup Name');
});

test('failed restore recovery preserves the verified safety authority for operator recovery', async t => {
  const files = await fixture();
  const journal = await SqliteCampaignJournal.open(files.databasePath, {
    faultInjector(point) {
      if (point !== 'restore.after-target-remove') return;
      mkdirSync(files.databasePath);
      throw new Error(`Injected fault at ${point}`);
    },
  });
  t.after(async () => {
    await journal.close();
    await rm(files.root, { recursive: true, force: true });
  });

  const created = await acceptCampaignCreate(journal, { requestId: 'failed-recovery-create', title: 'Recoverable Campaign' });
  await journal.backupTo(files.backupPath);
  await acceptCampaignOperation(journal, created.campaignId, {
    requestId: 'failed-recovery-actor',
    expectedRevision: 1,
    operation: { kind: 'create_actor', actor: { name: 'Preserved Actor' } },
  });

  await assert.rejects(
    journal.restoreFrom(files.backupPath),
    error => error instanceof AggregateError
      && error.message.includes('could not be recovered safely')
      && error.message.includes(`${files.databasePath}.before-restore`),
  );

  const safety = await SqliteCampaignJournal.open(`${files.databasePath}.before-restore`, 25);
  try {
    const preserved = safety.readCampaign(created.campaignId);
    assert.equal(preserved.campaign.revision, 2);
    assert.equal(preserved.actors[0]?.name, 'Preserved Actor');
  } finally {
    await safety.close();
  }
});

test('corrupt immutable Event history fails closed on restart', async t => {
  const files = await fixture();
  t.after(() => rm(files.root, { recursive: true, force: true }));
  const journal = await SqliteCampaignJournal.open(files.databasePath, 25);
  const created = await acceptCampaignCreate(journal, { requestId: 'create-corrupt', title: 'Corrupt Campaign' });
  await journal.close();

  const database = new DatabaseSync(files.databasePath);
  database.prepare(`
    UPDATE campaign_events SET event_hash = 'broken' WHERE campaign_id = ? AND revision = 1
  `).run(created.campaignId);
  database.close();

  await assert.rejects(
    SqliteCampaignJournal.open(files.databasePath, 25),
    /history checksum failed|head does not match/,
  );
});
