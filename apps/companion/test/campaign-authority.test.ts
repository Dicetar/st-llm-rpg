import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { SqliteCampaignJournal } from '../src/adapters/sqlite/campaign-journal.js';
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
  t.after(() => rm(files.root, { recursive: true, force: true }));
  let journal = await SqliteCampaignJournal.open(files.databasePath, 2);

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

  journal.close();
  journal = await SqliteCampaignJournal.open(files.databasePath, 2);
  assert.equal(journal.readCampaign(created.campaignId).actors[0]?.name, 'Lavitz');
  journal.verifyOrThrow();
  journal.close();
});

test('verified backup and restore return the authoritative Campaign to the backed-up revision', async t => {
  const files = await fixture();
  t.after(() => rm(files.root, { recursive: true, force: true }));
  const journal = await SqliteCampaignJournal.open(files.databasePath, 25);
  t.after(() => journal.close());

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
