import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  PINNED_SILLYTAVERN_REVISION,
  encodeNarrationExchange,
  type ComponentObservation,
} from '@st-llm-rpg/wire';
import { buildCompanion, formatListenError } from '../src/app.js';
import { readCompanionConfig } from '../src/config.js';

async function workspaceFixture() {
  const root = await mkdtemp(join(tmpdir(), 'st-rpg-workspace-'));
  await mkdir(join(root, 'assets'));
  await writeFile(join(root, 'index.html'), '<!doctype html><title>Campaign Book</title><div id="root"></div>');
  await writeFile(join(root, 'assets', 'app.js'), 'console.log("workspace")');
  return root;
}

function config(workspaceRoot: string) {
  return readCompanionConfig({
    RPG_COMPANION_HOST: '127.0.0.1',
    RPG_COMPANION_PORT: '8002',
    RPG_WORKSPACE_DIST: workspaceRoot,
    RPG_DATABASE_PATH: join(workspaceRoot, 'campaigns.sqlite'),
    RPG_ADDON_DIRECTORY: join(workspaceRoot, 'campaign-content'),
    RPG_SNAPSHOT_INTERVAL: '2',
    RPG_SILLYTAVERN_URL: 'http://127.0.0.1:8001',
    RPG_LM_STUDIO_URL: 'http://127.0.0.1:1234/v1',
    RPG_PROBE_TIMEOUT_MS: '100',
    RPG_LOG_LEVEL: 'silent',
  });
}

const observedAt = new Date().toISOString();
const observations: readonly ComponentObservation[] = [
  { id: 'workspace', status: 'ready', blocking: true, message: 'ready', observedAt },
  { id: 'sqlite-runtime', status: 'ready', blocking: true, message: 'ready', observedAt },
  { id: 'sillytavern', status: 'available', blocking: false, message: 'available', observedAt },
  { id: 'lm-studio', status: 'unavailable', blocking: false, message: 'unavailable', observedAt },
];

test('health stays alive while external readiness is degraded', async t => {
  const workspaceRoot = await workspaceFixture();
  const app = await buildCompanion({ config: config(workspaceRoot), probeDependencies: async () => observations });
  t.after(async () => {
    await app.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  const health = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(health.statusCode, 200);
  assert.equal(health.json().status, 'alive');

  const ready = await app.inject({ method: 'GET', url: '/ready' });
  assert.equal(ready.statusCode, 200);
  assert.equal(ready.json().ready, true);
  assert.equal(ready.json().status, 'degraded');
  assert.equal(ready.json().components.length, 4);
});

test('SillyTavern can read the companion health check across the local port boundary', async t => {
  const workspaceRoot = await workspaceFixture();
  const app = await buildCompanion({ config: config(workspaceRoot), probeDependencies: async () => observations });
  t.after(async () => {
    await app.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  const health = await app.inject({
    method: 'GET',
    url: '/health',
    headers: { origin: 'http://127.0.0.1:8001' },
  });

  assert.equal(health.statusCode, 200);
  assert.equal(health.headers['access-control-allow-origin'], '*');
});

test('blocking internal failure makes readiness not-ready', async t => {
  const workspaceRoot = await workspaceFixture();
  const failed = observations.map(value => value.id === 'sqlite-runtime'
    ? { ...value, status: 'unavailable' as const }
    : value);
  const app = await buildCompanion({ config: config(workspaceRoot), probeDependencies: async () => failed });
  t.after(async () => {
    await app.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  });
  const ready = await app.inject({ method: 'GET', url: '/ready' });
  assert.equal(ready.json().ready, false);
  assert.equal(ready.json().status, 'not-ready');
});

test('workspace shell and built assets are served without a second server', async t => {
  const workspaceRoot = await workspaceFixture();
  const app = await buildCompanion({ config: config(workspaceRoot), probeDependencies: async () => observations });
  t.after(async () => {
    await app.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  });
  const root = await app.inject({ method: 'GET', url: '/' });
  assert.match(root.body, /Campaign Book/);
  const asset = await app.inject({ method: 'GET', url: '/assets/app.js' });
  assert.equal(asset.statusCode, 200);
  assert.match(asset.headers['content-type'] ?? '', /javascript/);
});

test('Campaign API persists revisions and returns an explicit stale conflict', async t => {
  const workspaceRoot = await workspaceFixture();
  const app = await buildCompanion({ config: config(workspaceRoot), probeDependencies: async () => observations });
  t.after(async () => {
    await app.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  const create = await app.inject({ method: 'POST', url: '/api/campaigns', payload: { requestId: 'http-create', title: 'HTTP Campaign' } });
  assert.equal(create.statusCode, 201);
  const created = create.json();
  const actor = await app.inject({
    method: 'POST',
    url: `/api/campaigns/${created.campaignId}/operations`,
    payload: { requestId: 'http-actor', expectedRevision: 1, operation: { kind: 'create_actor', actor: { name: 'HTTP Actor' } } },
  });
  assert.equal(actor.statusCode, 200);
  assert.equal(actor.json().revision, 2);

  const updated = await app.inject({
    method: 'POST',
    url: `/api/campaigns/${created.campaignId}/operations`,
    payload: {
      requestId: 'http-actor-update',
      expectedRevision: 2,
      operation: {
        kind: 'update_actor',
        actorId: actor.json().affectedIds[0],
        name: 'HTTP Actor',
        summary: 'Edited through the HTTP Workspace contract.',
      },
    },
  });
  assert.equal(updated.statusCode, 200, updated.body);
  assert.equal(updated.json().revision, 3);
  assert.equal(updated.json().document.actors[0].summary, 'Edited through the HTTP Workspace contract.');

  const stale = await app.inject({
    method: 'POST',
    url: `/api/campaigns/${created.campaignId}/operations`,
    payload: { requestId: 'http-stale', expectedRevision: 1, operation: { kind: 'rename_actor', actorId: actor.json().affectedIds[0], name: 'Lost Update' } },
  });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().code, 'CAMPAIGN_REVISION_CONFLICT');

  const revisionOne = await app.inject({ method: 'GET', url: `/api/campaigns/${created.campaignId}?revision=1` });
  assert.equal(revisionOne.statusCode, 200, revisionOne.body);
  assert.equal(revisionOne.json().actors.length, 0);

  const performance = await app.inject({ method: 'GET', url: '/api/campaign-authority/performance' });
  assert.equal(performance.statusCode, 200);
  assert.equal(performance.json().sampleCount, 3);
  assert.equal(performance.json().targetMs, 50);
});

test('Campaign survives a full companion close and reopen through the HTTP boundary', async t => {
  const workspaceRoot = await workspaceFixture();
  const companionConfig = config(workspaceRoot);

  let app = await buildCompanion({ config: companionConfig, probeDependencies: async () => observations });
  t.after(async () => {
    await app.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  });
  const create = await app.inject({ method: 'POST', url: '/api/campaigns', payload: { requestId: 'restart-create', title: 'Restart Campaign' } });
  const created = create.json();
  const actor = await app.inject({
    method: 'POST',
    url: `/api/campaigns/${created.campaignId}/operations`,
    payload: { requestId: 'restart-actor', expectedRevision: 1, operation: { kind: 'create_actor', actor: { name: 'Persisted Actor' } } },
  });
  assert.equal(actor.statusCode, 200);
  await app.close();

  app = await buildCompanion({ config: companionConfig, probeDependencies: async () => observations });
  const reopened = await app.inject({ method: 'GET', url: `/api/campaigns/${created.campaignId}` });
  assert.equal(reopened.statusCode, 200);
  assert.equal(reopened.json().campaign.revision, 2);
  assert.equal(reopened.json().actors[0]?.name, 'Persisted Actor');
});

test('missing Workspace build fails before listening with an actionable Problem', async () => {
  const root = await mkdtemp(join(tmpdir(), 'st-rpg-missing-'));
  try {
    await assert.rejects(
      buildCompanion({ config: config(root), probeDependencies: async () => observations }),
      error => error instanceof Error && error.message.includes('Campaign Book build is missing'),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('occupied port message is explicit and never claims to kill its owner', () => {
  const message = formatListenError(Object.assign(new Error('occupied'), { code: 'EADDRINUSE' }), config('workspace'));
  assert.match(message, /already in use/);
  assert.match(message, /No process was stopped or killed/);
  assert.match(message, /Get-NetTCPConnection/);
});

test('invalid configuration throws before server construction', () => {
  assert.throws(() => readCompanionConfig({ RPG_COMPANION_PORT: 'not-a-port' }), /must be an integer/);
  assert.throws(() => readCompanionConfig({ RPG_LM_STUDIO_URL: 'file:\/\/bad' }), /must use http or https/);
  assert.throws(() => readCompanionConfig({ RPG_SNAPSHOT_INTERVAL: '0' }), /must be an integer/);
  assert.throws(() => readCompanionConfig({ RPG_LOG_LEVEL: 'verbose' }), /must be one of/);
});

test('Campaign API exposes authoritative lifecycle, branching, and portable JSON', async t => {
  const workspaceRoot = await workspaceFixture();
  const app = await buildCompanion({ config: config(workspaceRoot), probeDependencies: async () => observations });
  t.after(async () => {
    await app.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  const create = await app.inject({
    method: 'POST', url: '/api/campaigns', payload: { requestId: 'http-lifecycle-create', title: 'Source Campaign' },
  });
  assert.equal(create.statusCode, 201, create.body);
  const campaignId = create.json().campaignId;
  const actor = await app.inject({
    method: 'POST', url: `/api/campaigns/${campaignId}/operations`,
    payload: { requestId: 'http-lifecycle-actor', expectedRevision: 1, operation: { kind: 'create_actor', actor: { id: 'actor-1', name: 'Mara' } } },
  });
  assert.equal(actor.statusCode, 200, actor.body);

  const archived = await app.inject({
    method: 'POST', url: `/api/campaigns/${campaignId}/operations`,
    payload: { requestId: 'http-lifecycle-archive', expectedRevision: 2, operation: { kind: 'set_campaign_archived', archived: true } },
  });
  assert.equal(archived.statusCode, 200, archived.body);
  assert.equal(archived.json().document.campaign.status, 'archived');
  const blocked = await app.inject({
    method: 'POST', url: `/api/campaigns/${campaignId}/operations`,
    payload: { requestId: 'http-lifecycle-blocked', expectedRevision: 3, operation: { kind: 'rename_actor', actorId: 'actor-1', name: 'Nope' } },
  });
  assert.equal(blocked.statusCode, 409, blocked.body);
  assert.equal(blocked.json().code, 'CAMPAIGN_ARCHIVED');

  const branch = await app.inject({
    method: 'POST', url: `/api/campaigns/${campaignId}/branches`,
    payload: { requestId: 'http-lifecycle-branch', sourceRevision: 2, title: 'Branched Campaign' },
  });
  assert.equal(branch.statusCode, 201, branch.body);
  assert.equal(branch.json().document.campaign.lineage.sourceCampaignId, campaignId);
  assert.equal(branch.json().document.campaign.lineage.sourceRevision, 2);
  assert.equal(branch.json().document.actors[0].id, 'actor-1');

  const portable = await app.inject({ method: 'GET', url: `/api/campaigns/${branch.json().campaignId}/export` });
  assert.equal(portable.statusCode, 200, portable.body);
  assert.match(portable.headers['content-disposition'] ?? '', /Branched-Campaign\.campaign\.json/);
  assert.equal(portable.json().schema, 'st-rpg.campaign-export');
  assert.deepEqual(portable.json().historyIndex.map((entry: { operationKind: string }) => entry.operationKind), ['branch_campaign']);
  assert.doesNotMatch(portable.body, /prompt|activeJob|diagnostics/i);
});

test('supervisor shutdown requires the exact local run identity and drains the Companion', async t => {
  const workspaceRoot = await workspaceFixture();
  const supervisedConfig = readCompanionConfig({
    RPG_COMPANION_HOST: '127.0.0.1', RPG_COMPANION_PORT: '8002',
    RPG_WORKSPACE_DIST: workspaceRoot, RPG_DATABASE_PATH: join(workspaceRoot, 'campaigns.sqlite'),
    RPG_ADDON_DIRECTORY: join(workspaceRoot, 'campaign-content'),
    RPG_SILLYTAVERN_URL: 'http://127.0.0.1:8001', RPG_LM_STUDIO_URL: 'http://127.0.0.1:1234/v1',
    RPG_WAYFINDER_RUN_ID: 'supervisor-test-run', RPG_LOG_LEVEL: 'silent',
  });
  const app = await buildCompanion({ config: supervisedConfig, probeDependencies: async () => observations });
  await app.listen({ host: '127.0.0.1', port: 0 });
  t.after(async () => {
    if (app.server.listening) await app.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  });
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('Test Companion did not expose a TCP address.');
  const base = `http://127.0.0.1:${address.port}`;
  const denied = await fetch(`${base}/api/operations/shutdown`, {
    method: 'POST', headers: { 'x-wayfinder-run-id': 'wrong-run' },
  });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).code, 'SUPERVISOR_OWNERSHIP_MISMATCH');
  const accepted = await fetch(`${base}/api/operations/shutdown`, {
    method: 'POST', headers: { 'x-wayfinder-run-id': 'supervisor-test-run' },
  });
  assert.equal(accepted.status, 202);
  assert.equal((await accepted.json()).state, 'draining');
  const deadline = Date.now() + 5_000;
  while (app.server.listening && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(app.server.listening, false);
});

test('backup API creates daily and explicit backups, previews restore, and rolls authority back safely', async t => {
  const workspaceRoot = await workspaceFixture();
  const app = await buildCompanion({ config: config(workspaceRoot), probeDependencies: async () => observations });
  t.after(async () => {
    await app.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  const created = await app.inject({
    method: 'POST', url: '/api/campaigns', payload: { requestId: 'backup-create-campaign', title: 'Backup Campaign' },
  });
  assert.equal(created.statusCode, 201, created.body);
  const campaignId = created.json().campaignId;

  const backup = await app.inject({
    method: 'POST', url: '/api/operations/backups', payload: { label: 'Before actor' },
  });
  assert.equal(backup.statusCode, 201, backup.body);
  assert.equal(backup.json().kind, 'explicit');
  assert.equal(backup.json().availability, 'available');

  const actor = await app.inject({
    method: 'POST', url: `/api/campaigns/${campaignId}/operations`,
    payload: { requestId: 'backup-create-actor', expectedRevision: 1, operation: { kind: 'create_actor', actor: { name: 'Later Actor' } } },
  });
  assert.equal(actor.statusCode, 200, actor.body);
  assert.equal(actor.json().revision, 2);

  const catalog = await app.inject({ method: 'GET', url: '/api/operations/backups' });
  assert.equal(catalog.statusCode, 200, catalog.body);
  assert.equal(catalog.json().automaticDailyHealthy, true);
  assert.ok(catalog.json().backups.some((entry: { kind: string }) => entry.kind === 'daily'));

  const preview = await app.inject({
    method: 'POST', url: `/api/operations/backups/${backup.json().id}/restore-preview`,
  });
  assert.equal(preview.statusCode, 200, preview.body);
  assert.equal(preview.json().backup.verification.verified, true);

  const wrongToken = await app.inject({
    method: 'POST', url: `/api/operations/backups/${backup.json().id}/restore`, payload: { restoreToken: '0'.repeat(64) },
  });
  assert.equal(wrongToken.statusCode, 409, wrongToken.body);
  assert.equal(wrongToken.json().code, 'RESTORE_CONFIRMATION_REQUIRED');

  const restored = await app.inject({
    method: 'POST', url: `/api/operations/backups/${backup.json().id}/restore`,
    payload: { restoreToken: preview.json().restoreToken },
  });
  assert.equal(restored.statusCode, 200, restored.body);
  assert.equal(restored.json().verification.verified, true);
  assert.match(restored.json().safetyBackupId, /^backup-/);

  const rolledBack = await app.inject({ method: 'GET', url: `/api/campaigns/${campaignId}` });
  assert.equal(rolledBack.statusCode, 200, rolledBack.body);
  assert.equal(rolledBack.json().campaign.revision, 1);
  assert.equal(rolledBack.json().actors.length, 0);

  const corruptible = await app.inject({
    method: 'POST', url: '/api/operations/backups', payload: { label: 'Corruption check' },
  });
  assert.equal(corruptible.statusCode, 201, corruptible.body);
  await writeFile(join(workspaceRoot, 'backups', `${corruptible.json().id}.sqlite`), 'not a database');
  const corruptPreview = await app.inject({
    method: 'POST', url: `/api/operations/backups/${corruptible.json().id}/restore-preview`,
  });
  assert.equal(corruptPreview.statusCode, 409, corruptPreview.body);
  assert.equal(corruptPreview.json().code, 'BACKUP_INVALID');
});

test('addon API previews exact manifest diff, rejects stale files, and applies one backed-up Campaign event', async t => {
  const workspaceRoot = await workspaceFixture();
  const app = await buildCompanion({ config: config(workspaceRoot), probeDependencies: async () => observations });
  t.after(async () => {
    await app.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  });
  const created = await app.inject({
    method: 'POST', url: '/api/campaigns', payload: { requestId: 'addon-campaign', title: 'Addon Campaign' },
  });
  const campaignId = created.json().campaignId;
  const addonRoot = join(workspaceRoot, 'campaign-content');
  await writeFile(join(addonRoot, 'people_addon.json'), JSON.stringify({
    people: [
      { id: 'lavir', name: 'Lavir', summary: 'A precise court mage.', details: 'Private notes stay outside the current model.' },
      { id: 'mara', name: 'Mara', summary: 'A guarded investigator.' },
    ],
  }));
  await writeFile(join(addonRoot, 'items_addon.json'), JSON.stringify({
    items: [{ id: 'wardrobe-key', name: 'Wardrobe key', summary: 'A small iron key.', ownerExternalId: 'lavir' }],
  }));
  await writeFile(join(addonRoot, 'abilities_addon.json'), JSON.stringify({
    abilities: [{ id: 'mage-hand', name: 'Mage Hand', summary: 'Moves a small unattended object.', category: 'spell' }],
  }));
  await writeFile(join(addonRoot, 'relationships_addon.json'), JSON.stringify({
    relationships: [{ id: 'lavir-trusts-mara', source: 'lavir', target: 'mara', kind: 'patron', status: 'strained', notes: 'Lavir expects proof.' }],
  }));
  await writeFile(join(addonRoot, 'places_addon.json'), JSON.stringify({
    places: [{ id: 'east-room', name: 'East Dressing Room', summary: 'A private room near the heir wing.' }],
  }));
  await writeFile(join(addonRoot, 'world_objects_addon.json'), JSON.stringify({
    worldObjects: [{ id: 'heavy-cabinet', name: 'Heavy Cabinet', summary: 'Blocks mismatched paneling.', homePlace: 'east-room' }],
  }));
  await writeFile(join(addonRoot, 'facts_addon.json'), JSON.stringify({
    facts: [{ id: 'cabinet-moved', name: 'Cabinet was moved', proposition: 'The cabinet has been moved repeatedly.', subject: { kind: 'worldObject', id: 'heavy-cabinet' } }],
  }));
  await writeFile(join(addonRoot, 'scene_addon.json'), JSON.stringify({
    scene: { id: 'search-room', name: 'Search the room', place: 'east-room', presences: [{ subject: { kind: 'worldObject', id: 'heavy-cabinet' }, state: 'present' }] },
  }));

  const sources = await app.inject({ method: 'POST', url: '/api/operations/addons/rescan' });
  assert.equal(sources.statusCode, 200, sources.body);
  assert.deepEqual(sources.json().files.map((file: { name: string }) => file.name), ['abilities_addon.json', 'facts_addon.json', 'items_addon.json', 'people_addon.json', 'places_addon.json', 'relationships_addon.json', 'scene_addon.json', 'world_objects_addon.json']);

  const firstPreview = await app.inject({
    method: 'POST', url: '/api/operations/addons/preview', payload: { campaignId },
  });
  assert.equal(firstPreview.statusCode, 200, firstPreview.body);
  assert.equal(firstPreview.json().canApply, true);
  assert.equal(firstPreview.json().changes.filter((change: { change: string }) => change.change === 'create').length, 9);
  assert.ok(firstPreview.json().issues.some((entry: { code: string }) => entry.code === 'addon_fields_not_imported'));
  const persistedCandidates = await app.inject({
    method: 'GET', url: `/api/operations/addons/candidates?campaignId=${encodeURIComponent(campaignId)}`,
  });
  assert.equal(persistedCandidates.statusCode, 200, persistedCandidates.body);
  assert.equal(persistedCandidates.json().candidates[0].id, firstPreview.json().id);

  await writeFile(join(addonRoot, 'items_addon.json'), JSON.stringify({
    items: [{ id: 'wardrobe-key', name: 'Wardrobe key', summary: 'A small iron key with a split-crown bow.', ownerExternalId: 'lavir' }],
  }));
  const stale = await app.inject({
    method: 'POST', url: '/api/operations/addons/apply', payload: {
      candidateId: firstPreview.json().id,
      campaignId,
      manifestHash: firstPreview.json().manifestHash,
      expectedRevision: firstPreview.json().expectedRevision,
    },
  });
  assert.equal(stale.statusCode, 409, stale.body);
  assert.equal(stale.json().code, 'ADDON_CANDIDATE_STALE');

  const preview = await app.inject({
    method: 'POST', url: '/api/operations/addons/preview', payload: { campaignId },
  });
  const applied = await app.inject({
    method: 'POST', url: '/api/operations/addons/apply', payload: {
      candidateId: preview.json().id,
      campaignId,
      manifestHash: preview.json().manifestHash,
      expectedRevision: preview.json().expectedRevision,
    },
  });
  assert.equal(applied.statusCode, 200, applied.body);
  assert.equal(applied.json().changed, 9);
  assert.equal(applied.json().backup.kind, 'pre-operation');
  assert.equal(applied.json().commit.operationKind, 'apply_addon_batch');
  assert.equal(applied.json().commit.revision, 2);

  const campaign = await app.inject({ method: 'GET', url: `/api/campaigns/${campaignId}` });
  assert.equal(campaign.json().actors[0].id, 'addon:actor:lavir');
  assert.equal(campaign.json().items[0].id, 'addon:item:wardrobe-key');
  assert.equal(campaign.json().items[0].ownerActorId, 'addon:actor:lavir');
  assert.equal(campaign.json().abilities[0].id, 'addon:ability:mage-hand');
  assert.equal(campaign.json().abilities[0].category, 'spell');
  assert.equal(campaign.json().relationships[0].id, 'addon:relationship:lavir-trusts-mara');
  assert.equal(campaign.json().relationships[0].sourceActorId, 'addon:actor:lavir');
  assert.equal(campaign.json().relationships[0].targetActorId, 'addon:actor:mara');
  assert.equal(campaign.json().relationships[0].status, 'strained');
  assert.equal(campaign.json().worldObjects[0].placeId, 'addon:place:east-room');
  assert.equal(campaign.json().facts[0].subjectId, 'addon:world_object:heavy-cabinet');
  assert.deepEqual(campaign.json().currentScene.worldObjectIds, ['addon:world_object:heavy-cabinet']);
  assert.match(campaign.json().items[0].summary, /split-crown/);
  const history = await app.inject({ method: 'GET', url: `/api/campaigns/${campaignId}/history` });
  assert.ok(history.json().some((entry: { operationKind: string }) => entry.operationKind === 'apply_addon_batch'));
  const verified = await app.inject({ method: 'GET', url: '/api/campaign-authority/verify' });
  assert.equal(verified.statusCode, 200, verified.body);

  await writeFile(join(addonRoot, 'items_addon.json'), JSON.stringify({ items: [] }));
  const additivePreview = await app.inject({
    method: 'POST', url: '/api/operations/addons/preview', payload: { campaignId },
  });
  assert.equal(additivePreview.json().changes.some((change: { after: { externalId: string } }) => change.after.externalId === 'wardrobe-key'), false);
  const afterRemoval = await app.inject({ method: 'GET', url: `/api/campaigns/${campaignId}` });
  assert.equal(afterRemoval.json().items.length, 1, 'missing addon rows must never delete accepted Campaign records');

  const invalidRelationshipPath = join(addonRoot, 'invalid_relationship_addon.json');
  await writeFile(invalidRelationshipPath, JSON.stringify({
    relationships: [{ id: 'player-link', source: '$player', target: 'lavir', kind: 'ally' }],
  }));
  const invalidRelationship = await app.inject({
    method: 'POST', url: '/api/operations/addons/preview', payload: { campaignId },
  });
  assert.equal(invalidRelationship.statusCode, 200, invalidRelationship.body);
  assert.equal(invalidRelationship.json().status, 'blocked');
  assert.ok(invalidRelationship.json().issues.some((entry: { code: string }) => entry.code === 'addon_relationship_reference_invalid'));
  await rm(invalidRelationshipPath);

  await writeFile(join(addonRoot, 'broken_addon.json'), '{');
  const blocked = await app.inject({
    method: 'POST', url: '/api/operations/addons/preview', payload: { campaignId },
  });
  assert.equal(blocked.statusCode, 200, blocked.body);
  assert.equal(blocked.json().status, 'blocked');
  assert.equal(blocked.json().canApply, false);
  assert.ok(blocked.json().issues.some((entry: { severity: string }) => entry.severity === 'error'));
});

test('Campaign startup outage keeps explicit-unlinked narration alive and linked narration fail-closed', async t => {
  const workspaceRoot = await workspaceFixture();
  let upstreamCalls = 0;
  const app = await buildCompanion({
    config: config(workspaceRoot),
    campaignJournal: null,
    lmStudioGateway: {
      models: async () => new Response('{"data":[{"id":"qwen-test"}]}'),
      chat: async () => {
        upstreamCalls += 1;
        return new Response(JSON.stringify({
          id: 'chatcmpl-outage', model: 'qwen-test',
          choices: [{ message: { role: 'assistant', content: 'UNLINKED_OK' }, finish_reason: 'stop' }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    },
  });
  t.after(async () => {
    await app.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  const ready = await app.inject({ method: 'GET', url: '/ready' });
  assert.equal(ready.statusCode, 200);
  assert.equal(ready.json().ready, false);
  assert.equal(ready.json().components.find((component: { id: string }) => component.id === 'sqlite-runtime').status, 'unavailable');

  const base = {
    protocol: 'st-rpg.narration' as const, version: 1 as const,
    locator: {
      version: 1 as const, hostId: 'outage-host',
      chat: { kind: 'character' as const, ownerId: 'Narrator.png', chatId: 'Outage Chat' },
    },
    bridge: { version: '0.2.0', sillyTavernRevision: PINNED_SILLYTAVERN_REVISION },
  };
  const payload = { model: 'qwen-test', stream: false, messages: [{ role: 'user', content: 'Hello' }] };
  const linked = await app.inject({
    method: 'POST', url: '/v1/chat/completions',
    headers: { 'x-st-rpg-exchange': encodeNarrationExchange({
      ...base,
      requestId: '37e9c1c0-bbb1-4718-9049-f8182a878f86',
      route: { kind: 'linked', bindingId: 'binding-1' }, generation: 'normal',
    }) },
    payload,
  });
  assert.equal(linked.statusCode, 503, linked.body);
  assert.equal(linked.json().error.code, 'CAMPAIGN_STORE_UNAVAILABLE');
  assert.equal(upstreamCalls, 0);

  const unlinked = await app.inject({
    method: 'POST', url: '/v1/chat/completions',
    headers: { 'x-st-rpg-exchange': encodeNarrationExchange({
      ...base,
      requestId: '8ff16772-6f5b-49c3-8f22-b57b9040d8ee',
      route: { kind: 'unlinked' }, generation: 'normal',
    }) },
    payload,
  });
  assert.equal(unlinked.statusCode, 200, unlinked.body);
  assert.equal(unlinked.json().choices[0].message.content, 'UNLINKED_OK');
  assert.equal(upstreamCalls, 1);
});
