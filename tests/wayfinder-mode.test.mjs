import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import {
  activateRuntimeExtensions,
  enterCompanionMode,
  enterFallbackMode,
  inspectRuntimeMode,
  readRuntimeMode,
} from '../tools/wayfinder-mode.mjs';

async function exists(path) {
  try { await stat(path); return true; } catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
}

async function createRoot() {
  const root = await mkdtemp(join(tmpdir(), 'wayfinder-mode-'));
  await mkdir(join(root, '.runtime', 'SillyTavern', 'public', 'scripts', 'extensions', 'third-party'), { recursive: true });
  await mkdir(join(root, '.runtime', 'companion'), { recursive: true });
  await writeFile(join(root, '.runtime', 'SillyTavern', 'package.json'), '{}');
  await writeFile(join(root, 'release.json'), JSON.stringify({ version: 'test-preview' }));
  for (const name of ['st-rpg-bridge', 'st-rpg-campaign']) {
    const source = join(root, 'extension', name);
    await mkdir(source, { recursive: true });
    await writeFile(join(source, 'manifest.json'), JSON.stringify({ display_name: name }));
    await writeFile(join(source, 'index.js'), `export const name = '${name}';`);
  }
  return root;
}

test('extension slot activates only the selected authority while preserving both reviewed sources', async t => {
  const root = await createRoot();
  t.after(() => rm(root, { recursive: true, force: true }));

  await activateRuntimeExtensions(root, 'parallel');
  assert.deepEqual(await inspectRuntimeMode(root, 'parallel'), {
    mode: 'parallel',
    active: { companion: true, fallback: true },
    preserved: { companion: true, fallback: true },
  });

  await activateRuntimeExtensions(root, 'companion');
  assert.deepEqual(await inspectRuntimeMode(root, 'companion'), {
    mode: 'companion',
    active: { companion: true, fallback: false },
    preserved: { companion: true, fallback: true },
  });
  assert.equal(await exists(join(root, '.runtime', 'wayfinder', 'inactive-extensions', 'st-rpg-campaign')), true);
});

test('applying the current mode reuses an exact active extension directory', async t => {
  const root = await createRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  await activateRuntimeExtensions(root, 'companion');
  const active = join(root, '.runtime', 'SillyTavern', 'public', 'scripts', 'extensions', 'third-party', 'st-rpg-bridge');
  const before = await stat(active);

  await activateRuntimeExtensions(root, 'companion');

  const after = await stat(active);
  assert.equal(after.ino, before.ino, 'an exact active directory is not renamed or replaced');
});

test('fallback mode creates verified backup/export/divergence evidence before disabling the bridge', async t => {
  const root = await createRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  await activateRuntimeExtensions(root, 'parallel');
  const campaignId = 'campaign-one';
  const binding = {
    id: 'binding-one', revision: 3, campaignAnchor: 1, markerState: 'verified',
  };
  const routes = {
    'POST /api/operations/backups': {
      id: 'backup-one', fileName: 'backup-one.sqlite', availability: 'available', verification: { verified: true },
    },
    'GET /api/campaigns': [{ id: campaignId, revision: 4 }],
    [`GET /api/campaigns/${campaignId}`]: { campaign: { id: campaignId, revision: 4 }, actors: [], items: [], quests: [], places: [], currentScene: null },
    [`GET /api/campaigns/${campaignId}/history`]: [{ revision: 4 }],
    [`GET /api/campaigns/${campaignId}/chat-bindings`]: [binding],
  };
  const fetchImplementation = async (url, init = {}) => {
    const key = `${init.method ?? 'GET'} ${new URL(url).pathname}`;
    const value = routes[key];
    return new Response(value === undefined ? '' : JSON.stringify(value), {
      status: value === undefined ? 404 : 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const result = await enterFallbackMode(root, { companionUrl: 'http://fixture.invalid', fetchImplementation });
  assert.equal(result.mode.mode, 'fallback');
  assert.equal(result.divergence.backupId, 'backup-one');
  assert.equal(result.divergence.campaigns[0].campaignRevision, 4);
  assert.equal(result.divergence.campaigns[0].bindings[0].legacyImportProvenanceRevision, 1);
  assert.deepEqual(result.extensionState.active, { companion: false, fallback: true });
  assert.equal(JSON.parse(await readFile(result.divergence.exportPath, 'utf8')).campaigns.length, 1);
  assert.equal((await readRuntimeMode(root)).warning.includes('diverges'), true);
});

test('companion mode requires a verified Binding and never merges fallback history', async t => {
  const root = await createRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  await activateRuntimeExtensions(root, 'fallback');
  const database = new DatabaseSync(join(root, '.runtime', 'companion', 'campaigns.sqlite'));
  database.exec(`
    CREATE TABLE chat_bindings (binding_id TEXT PRIMARY KEY, marker_state TEXT NOT NULL);
    INSERT INTO chat_bindings VALUES ('binding-one', 'verified');
  `);
  database.close();

  const result = await enterCompanionMode(root);
  assert.equal(result.mode.mode, 'companion');
  assert.equal(result.mode.verifiedBindingCount, 1);
  assert.match(result.mode.warning, /does not merge/i);
  assert.deepEqual(result.extensionState.active, { companion: true, fallback: false });
});
