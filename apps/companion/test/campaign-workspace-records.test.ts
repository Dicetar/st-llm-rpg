import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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
