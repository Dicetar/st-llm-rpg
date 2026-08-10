import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { LegacyChatLocator, StorySyncJobDocument } from '@st-llm-rpg/wire';
import { buildCompanion } from '../src/app.js';
import { readCompanionConfig } from '../src/config.js';
import type {
  LegacyChatSnapshot,
  LegacyChatSource,
} from '../src/modules/legacy-import/legacy-import-service.js';

const locator: LegacyChatLocator = { kind: 'character', chatId: 'Story Sync', avatar: 'Narrator.png' };

class StorySyncLegacySource implements LegacyChatSource {
  async list() {
    return [{
      locator, title: locator.chatId, fileSize: '2 KB', messageCount: 2,
      lastModified: '2026-08-10T00:00:00.000Z', hasLegacyCampaign: true, legacyRevision: 1,
    }];
  }

  async read(): Promise<LegacyChatSnapshot> {
    return {
      locator,
      envelope: {
        envelopeVersion: 1,
        campaign: {
          schemaVersion: 1,
          instanceId: 'legacy-story-sync',
          commitId: 'legacy-story-sync-1',
          revision: 1,
          title: 'Story Sync Campaign',
          playerCharacterId: 'actor-player',
          records: [
            { id: 'actor-player', kind: 'actor', name: 'Dan', summary: 'An adventurer.', archivedAt: null },
            { id: 'item-key', kind: 'item', name: 'Silver Key', summary: 'A small old key.', archivedAt: null },
          ],
          possessions: [], learnedAbilities: [], relationships: [], sceneArchives: [], proposals: [], currentScene: null,
        },
      },
    };
  }

  async writeMarker() {
    return { verified: true as const, legacyMetadataPreserved: true as const };
  }
}

async function waitForReview(app: Awaited<ReturnType<typeof buildCompanion>>, jobId: string) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const response = await app.inject({ method: 'GET', url: `/api/story-sync/jobs/${jobId}` });
    assert.equal(response.statusCode, 200, response.body);
    const job = response.json() as StorySyncJobDocument;
    if (job.status === 'ready-for-review' || job.status === 'failed') return job;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Story Sync job did not reach review state.');
}

test('Story Sync creates a durable editable Proposal without mutating Campaign truth', async t => {
  const root = await mkdtemp(join(tmpdir(), 'st-rpg-story-sync-'));
  const workspaceRoot = join(root, 'workspace');
  await mkdir(join(workspaceRoot, 'assets'), { recursive: true });
  await writeFile(join(workspaceRoot, 'index.html'), '<!doctype html><div id="root"></div>');
  const config = readCompanionConfig({
    RPG_COMPANION_HOST: '127.0.0.1', RPG_COMPANION_PORT: '8002',
    RPG_WORKSPACE_DIST: workspaceRoot, RPG_DATABASE_PATH: join(root, 'campaigns.sqlite'),
    RPG_ADDON_DIRECTORY: join(root, 'campaign-content'),
    RPG_SILLYTAVERN_URL: 'http://127.0.0.1:8001', RPG_LM_STUDIO_URL: 'http://127.0.0.1:1234/v1',
    RPG_LOG_LEVEL: 'silent',
  });
  const source = new StorySyncLegacySource();
  let holdWorker = false;
  let markWorkerHeld: (() => void) | null = null;
  const gateway = {
    models: async () => new Response('{"data":[]}'),
    chat: async (_request: Readonly<Record<string, unknown>>, signal: AbortSignal) => {
      if (holdWorker) {
        markWorkerHeld?.();
        await new Promise<never>((_resolve, reject) => {
          if (signal.aborted) reject(new Error('Worker aborted.'));
          else signal.addEventListener('abort', () => reject(new Error('Worker aborted.')), { once: true });
        });
      }
      return new Response(JSON.stringify({
      id: 'worker-completion', object: 'chat.completion', created: 1, model: 'local/worker-model',
      choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({
        proposals: [{
          title: 'The Silver Key is now carried',
          operation: {
            kind: 'update_item', itemId: 'item-key', name: 'Silver Key',
            summary: 'A small old key now carried by Dan.', ownerActorId: 'actor-player',
          },
          evidence: [1], confidence: 'high',
        }],
      }) }, finish_reason: 'stop' }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  };
  let app = await buildCompanion({ config, legacyChatSource: source, lmStudioGateway: gateway });
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  const preview = await app.inject({ method: 'POST', url: '/api/migrations/legacy-preview', payload: { locator } });
  const imported = await app.inject({
    method: 'POST', url: '/api/migrations/legacy-import',
    payload: {
      requestId: 'story-sync-import', locator,
      sourceFingerprint: preview.json().sourceFingerprint, decision: 'create-campaign',
    },
  });
  assert.equal(imported.statusCode, 201, imported.body);
  const campaignId = imported.json().campaignId as string;
  const bindingId = imported.json().binding.id as string;

  const profile = await app.inject({
    method: 'PUT', url: '/api/story-sync/worker-profile',
    payload: { modelId: 'local/worker-model', requestedOutputTokens: 1200 },
  });
  assert.equal(profile.statusCode, 200, profile.body);

  const started = await app.inject({
    method: 'POST', url: '/api/story-sync/jobs',
    payload: {
      requestId: 'story-sync-start', bindingId, profileId: 'worker-default',
      locator: {
        version: 1, hostId: 'desktop-host',
        chat: { kind: 'character', ownerId: locator.avatar, chatId: locator.chatId },
      },
      messages: [
        { index: 0, role: 'player', name: 'Dan', content: 'I take the Silver Key.' },
        { index: 1, role: 'narrator', name: 'Narrator', content: 'The key settles into your pocket.' },
      ],
    },
  });
  assert.equal(started.statusCode, 202, started.body);
  const job = await waitForReview(app, started.json().jobId);
  assert.equal(job.status, 'ready-for-review');
  assert.equal(job.proposals.length, 1);
  assert.equal(job.proposals[0]?.draft.operation?.kind, 'update_item');
  assert.deepEqual(Object.keys(job.source).sort(), [
    'contentPruned', 'endPrefixHash', 'fingerprint', 'firstMessageIndex', 'lastMessageIndex', 'messageCount',
  ]);

  const campaign = await app.inject({ method: 'GET', url: `/api/campaigns/${campaignId}` });
  assert.equal(campaign.json().campaign.revision, 1, 'model output must not mutate Campaign truth');
  const history = await app.inject({ method: 'GET', url: `/api/campaigns/${campaignId}/history` });
  assert.equal(history.json().length, 1, 'model output must not append a Campaign Event');

  await app.close();
  app = await buildCompanion({ config, legacyChatSource: source, lmStudioGateway: gateway });
  const restored = await app.inject({ method: 'GET', url: `/api/story-sync/jobs/${job.id}` });
  assert.equal(restored.statusCode, 200, restored.body);
  assert.equal(restored.json().status, 'ready-for-review');
  assert.equal(restored.json().proposals[0].draft.title, 'The Silver Key is now carried');

  const reviewed = restored.json() as StorySyncJobDocument;
  const incomplete = await app.inject({
    method: 'POST', url: `/api/story-sync/jobs/${reviewed.id}/finalize`,
    payload: { proposals: [] },
  });
  assert.equal(incomplete.statusCode, 409, incomplete.body);
  assert.equal(incomplete.json().code, 'STORY_SYNC_REVIEW_INCOMPLETE');
  const unchanged = await app.inject({ method: 'GET', url: `/api/campaigns/${campaignId}` });
  assert.equal(unchanged.json().campaign.revision, 1, 'incomplete review cannot partially mutate Campaign truth');

  const decided = await app.inject({
    method: 'PUT', url: `/api/story-sync/proposals/${reviewed.proposals[0]!.id}`,
    payload: {
      expectedRevision: reviewed.proposals[0]!.revision,
      decision: 'accept',
      draft: reviewed.proposals[0]!.draft,
    },
  });
  assert.equal(decided.statusCode, 200, decided.body);
  const accepted = decided.json() as StorySyncJobDocument;
  const finalizePayload = {
    proposals: accepted.proposals.map(proposal => ({
      proposalId: proposal.id,
      expectedRevision: proposal.revision,
      decision: proposal.decision,
    })),
  };
  const finalized = await app.inject({
    method: 'POST', url: `/api/story-sync/jobs/${accepted.id}/finalize`, payload: finalizePayload,
  });
  assert.equal(finalized.statusCode, 200, finalized.body);
  assert.equal(finalized.json().campaignRevision, 2);
  assert.equal(finalized.json().acceptedProposalIds[0], accepted.proposals[0]!.id);

  const afterCampaign = await app.inject({ method: 'GET', url: `/api/campaigns/${campaignId}` });
  assert.equal(afterCampaign.json().campaign.revision, 2);
  assert.equal(afterCampaign.json().items[0].ownerActorId, 'actor-player');
  const afterHistory = await app.inject({ method: 'GET', url: `/api/campaigns/${campaignId}/history` });
  assert.equal(afterHistory.json().length, 2, 'accepted Proposals append one Campaign Event');
  assert.equal(afterHistory.json()[0].operationKind, 'story_sync_batch');
  const binding = await app.inject({ method: 'GET', url: `/api/chat-bindings/${bindingId}` });
  assert.equal(binding.json().syncBoundary.throughMessageIndex, 1);
  assert.equal(binding.json().campaignAnchor, 2);
  const completed = await app.inject({ method: 'GET', url: `/api/story-sync/jobs/${accepted.id}` });
  assert.equal(completed.json().status, 'completed');
  assert.equal(completed.json().source.contentPruned, true);

  const repeated = await app.inject({
    method: 'POST', url: `/api/story-sync/jobs/${accepted.id}/finalize`, payload: finalizePayload,
  });
  assert.equal(repeated.statusCode, 200, repeated.body);
  assert.equal(repeated.json().idempotent, true);
  assert.equal(repeated.json().campaignRevision, 2);

  holdWorker = true;
  const workerHeld = new Promise<void>(resolve => { markWorkerHeld = resolve; });
  const cancellable = await app.inject({
    method: 'POST', url: '/api/story-sync/jobs',
    payload: {
      requestId: 'story-sync-cancellable', bindingId, profileId: 'worker-default',
      locator: {
        version: 1, hostId: 'desktop-host',
        chat: { kind: 'character', ownerId: locator.avatar, chatId: locator.chatId },
      },
      messages: [
        { index: 0, role: 'player', name: 'Dan', content: 'I take the Silver Key.' },
        { index: 1, role: 'narrator', name: 'Narrator', content: 'The key settles into your pocket.' },
        { index: 2, role: 'player', name: 'Dan', content: 'I inspect the next door.' },
        { index: 3, role: 'narrator', name: 'Narrator', content: 'It remains closed.' },
      ],
    },
  });
  assert.equal(cancellable.statusCode, 202, cancellable.body);
  const enteredInference = await Promise.race([
    workerHeld.then(() => true),
    new Promise<false>(resolve => setTimeout(() => resolve(false), 3_000)),
  ]);
  if (!enteredInference) {
    const stalled = await app.inject({ method: 'GET', url: `/api/story-sync/jobs/${cancellable.json().jobId}` });
    assert.fail(`Worker did not enter held inference: ${stalled.body}`);
  }
  const cancelled = await app.inject({ method: 'POST', url: `/api/story-sync/jobs/${cancellable.json().jobId}/cancel` });
  assert.equal(cancelled.statusCode, 200, cancelled.body);
  assert.equal(cancelled.json().status, 'cancelled');
  assert.equal(cancelled.json().source.contentPruned, false);

  holdWorker = false;
  markWorkerHeld = null;
  const resumed = await app.inject({ method: 'POST', url: `/api/story-sync/jobs/${cancellable.json().jobId}/resume` });
  assert.equal(resumed.statusCode, 200, resumed.body);
  const resumedReview = await waitForReview(app, cancellable.json().jobId);
  assert.equal(resumedReview.status, 'ready-for-review');
  const discarded = await app.inject({ method: 'POST', url: `/api/story-sync/jobs/${cancellable.json().jobId}/discard` });
  assert.equal(discarded.statusCode, 200, discarded.body);
  assert.equal(discarded.json().status, 'discarded');
  assert.equal(discarded.json().source.contentPruned, true);
  assert.equal(discarded.json().proposals.length, 0);

  const afterDiscardCampaign = await app.inject({ method: 'GET', url: `/api/campaigns/${campaignId}` });
  assert.equal(afterDiscardCampaign.json().campaign.revision, 2, 'discard cannot mutate Campaign truth');
  const afterDiscardBinding = await app.inject({ method: 'GET', url: `/api/chat-bindings/${bindingId}` });
  assert.equal(afterDiscardBinding.json().syncBoundary.throughMessageIndex, 1, 'discard cannot advance the Sync Boundary');
});
