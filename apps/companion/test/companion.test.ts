import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ComponentObservation } from '@st-llm-rpg/wire';
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
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const app = await buildCompanion({ config: config(workspaceRoot), probeDependencies: async () => observations });
  t.after(() => app.close());

  const health = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(health.statusCode, 200);
  assert.equal(health.json().status, 'alive');

  const ready = await app.inject({ method: 'GET', url: '/ready' });
  assert.equal(ready.statusCode, 200);
  assert.equal(ready.json().ready, true);
  assert.equal(ready.json().status, 'degraded');
  assert.equal(ready.json().components.length, 4);
});

test('blocking internal failure makes readiness not-ready', async t => {
  const workspaceRoot = await workspaceFixture();
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const failed = observations.map(value => value.id === 'sqlite-runtime'
    ? { ...value, status: 'unavailable' as const }
    : value);
  const app = await buildCompanion({ config: config(workspaceRoot), probeDependencies: async () => failed });
  t.after(() => app.close());
  const ready = await app.inject({ method: 'GET', url: '/ready' });
  assert.equal(ready.json().ready, false);
  assert.equal(ready.json().status, 'not-ready');
});

test('workspace shell and built assets are served without a second server', async t => {
  const workspaceRoot = await workspaceFixture();
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const app = await buildCompanion({ config: config(workspaceRoot), probeDependencies: async () => observations });
  t.after(() => app.close());
  const root = await app.inject({ method: 'GET', url: '/' });
  assert.match(root.body, /Campaign Book/);
  const asset = await app.inject({ method: 'GET', url: '/assets/app.js' });
  assert.equal(asset.statusCode, 200);
  assert.match(asset.headers['content-type'] ?? '', /javascript/);
});

test('Campaign API persists revisions and returns an explicit stale conflict', async t => {
  const workspaceRoot = await workspaceFixture();
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const app = await buildCompanion({ config: config(workspaceRoot), probeDependencies: async () => observations });
  t.after(() => app.close());

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

  const stale = await app.inject({
    method: 'POST',
    url: `/api/campaigns/${created.campaignId}/operations`,
    payload: { requestId: 'http-stale', expectedRevision: 1, operation: { kind: 'rename_actor', actorId: actor.json().affectedIds[0], name: 'Lost Update' } },
  });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().code, 'CAMPAIGN_REVISION_CONFLICT');

  const revisionOne = await app.inject({ method: 'GET', url: `/api/campaigns/${created.campaignId}?revision=1` });
  assert.equal(revisionOne.statusCode, 200);
  assert.equal(revisionOne.json().actors.length, 0);

  const performance = await app.inject({ method: 'GET', url: '/api/campaign-authority/performance' });
  assert.equal(performance.statusCode, 200);
  assert.equal(performance.json().sampleCount, 2);
  assert.equal(performance.json().targetMs, 50);
});

test('Campaign survives a full companion close and reopen through the HTTP boundary', async t => {
  const workspaceRoot = await workspaceFixture();
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const companionConfig = config(workspaceRoot);

  let app = await buildCompanion({ config: companionConfig, probeDependencies: async () => observations });
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
  t.after(() => app.close());
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
