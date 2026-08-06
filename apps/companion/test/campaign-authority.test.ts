import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import {
  SqliteCampaignJournal,
  type CampaignJournalFaultPoint,
} from '../src/adapters/sqlite/campaign-journal.js';
import { CampaignExpectedError } from '../src/modules/campaign/campaign-error.js';

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
    journal.close();
    await rm(files.root, { recursive: true, force: true });
  });

  const created = await journal.createCampaign({ requestId: 'create-1', title: 'Ashes of Harcourt' });
  assert.equal(created.revision, 1);
  assert.equal(created.document.actors.length, 0);

  const duplicate = await journal.createCampaign({ requestId: 'create-1', title: 'Ashes of Harcourt' });
  assert.equal(duplicate.idempotent, true);
  assert.equal(duplicate.campaignId, created.campaignId);
  assert.equal(journal.history(created.campaignId).length, 1);

  const actorCommit = await journal.execute(created.campaignId, {
    requestId: 'actor-1',
    expectedRevision: 1,
    operation: { kind: 'create_actor', actor: { name: 'Lavitz' } },
  });
  assert.equal(actorCommit.revision, 2);
  assert.equal(actorCommit.document.actors[0]?.name, 'Lavitz');

  await assert.rejects(
    journal.execute(created.campaignId, {
      requestId: 'stale-1',
      expectedRevision: 1,
      operation: { kind: 'rename_actor', actorId: actorCommit.affectedIds[0]!, name: 'Stale Lavitz' },
    }),
    error => error instanceof CampaignExpectedError && error.code === 'CAMPAIGN_REVISION_CONFLICT',
  );
  assert.equal(journal.history(created.campaignId).length, 2);
  assert.equal(journal.readCampaign(created.campaignId, 1).actors.length, 0);
  assert.equal(journal.readCampaign(created.campaignId, 2).actors[0]?.name, 'Lavitz');

  const performance = journal.performance();
  assert.equal(performance.sampleCount, 2);
  assert.ok(performance.latestMs >= 0);
  assert.equal(performance.targetMs, 50);
  assert.equal(performance.investigationMs, 200);

  journal.close();
  journal = await SqliteCampaignJournal.open(files.databasePath, 2);
  assert.equal(journal.readCampaign(created.campaignId).actors[0]?.name, 'Lavitz');
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
    journal.close();
    await rm(files.root, { recursive: true, force: true });
  });

  const created = await journal.createCampaign({ requestId: 'fault-create', title: 'Atomic Campaign' });
  activeFault = 'execute.after-event';
  const request = {
    requestId: 'fault-operation',
    expectedRevision: 1,
    operation: { kind: 'create_actor' as const, actor: { name: 'Should Roll Back' } },
  };
  await assert.rejects(journal.execute(created.campaignId, request), /Injected fault/);

  assert.equal(journal.readCampaign(created.campaignId).campaign.revision, 1);
  assert.equal(journal.readCampaign(created.campaignId).actors.length, 0);
  assert.equal(journal.history(created.campaignId).length, 1);
  assert.equal(journal.performance().sampleCount, 1);

  activeFault = null;
  const accepted = await journal.execute(created.campaignId, request);
  assert.equal(accepted.revision, 2);
  assert.equal(accepted.document.actors[0]?.name, 'Should Roll Back');
  assert.equal(journal.history(created.campaignId).length, 2);
});

test('verified backup and restore return the authoritative Campaign to the backed-up revision', async t => {
  const files = await fixture();
  const journal = await SqliteCampaignJournal.open(files.databasePath, 25);
  t.after(async () => {
    journal.close();
    await rm(files.root, { recursive: true, force: true });
  });

  const created = await journal.createCampaign({ requestId: 'create-backup', title: 'Backup Campaign' });
  const actor = await journal.execute(created.campaignId, {
    requestId: 'actor-backup',
    expectedRevision: 1,
    operation: { kind: 'create_actor', actor: { name: 'Before Backup' } },
  });
  await journal.backupTo(files.backupPath);
  await journal.execute(created.campaignId, {
    requestId: 'rename-after-backup',
    expectedRevision: 2,
    operation: { kind: 'rename_actor', actorId: actor.affectedIds[0]!, name: 'After Backup' },
  });
  assert.equal(journal.readCampaign(created.campaignId).actors[0]?.name, 'After Backup');

  await journal.restoreFrom(files.backupPath);
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
    journal.close();
    await rm(files.root, { recursive: true, force: true });
  });

  const created = await journal.createCampaign({ requestId: 'restore-create', title: 'Restore Campaign' });
  const actor = await journal.execute(created.campaignId, {
    requestId: 'restore-actor',
    expectedRevision: 1,
    operation: { kind: 'create_actor', actor: { name: 'Backup Name' } },
  });
  await journal.backupTo(files.backupPath);
  await journal.execute(created.campaignId, {
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

test('corrupt immutable Event history fails closed on restart', async t => {
  const files = await fixture();
  t.after(() => rm(files.root, { recursive: true, force: true }));
  const journal = await SqliteCampaignJournal.open(files.databasePath, 25);
  const created = await journal.createCampaign({ requestId: 'create-corrupt', title: 'Corrupt Campaign' });
  journal.close();

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
