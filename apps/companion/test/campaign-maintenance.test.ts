import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteCampaignJournal } from '../src/adapters/sqlite/campaign-journal.js';
import {
  readCampaignRevisionInWorker,
  verifyCampaignAuthorityInWorker,
} from '../src/adapters/sqlite/campaign-maintenance.js';
import { acceptCampaignCreate, acceptCampaignOperation } from './campaign-test-helpers.js';

test('maintenance worker verifies history and reconstructs a numbered revision off the main thread', async t => {
  const root = await mkdtemp(join(tmpdir(), 'st-rpg-maintenance-'));
  const databasePath = join(root, 'campaigns.sqlite');
  const journal = await SqliteCampaignJournal.open(databasePath, 2);
  t.after(async () => {
    await journal.close();
    await rm(root, { recursive: true, force: true });
  });

  const created = await acceptCampaignCreate(journal, { requestId: 'worker-create', title: 'Worker Campaign' });
  await acceptCampaignOperation(journal, created.campaignId, {
    requestId: 'worker-actor',
    expectedRevision: 1,
    operation: { kind: 'create_actor', actor: { name: 'Worker Actor' } },
  });

  const verification = await verifyCampaignAuthorityInWorker(databasePath);
  assert.equal(verification.verified, true);
  assert.equal(verification.campaignCount, 1);
  assert.ok(verification.durationMs >= 0);

  const revisionOne = await readCampaignRevisionInWorker(databasePath, created.campaignId, 1);
  assert.equal(revisionOne.campaign.revision, 1);
  assert.equal(revisionOne.actors.length, 0);
});
