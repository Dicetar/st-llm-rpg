import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const PINNED_REVISION = '380e31e8c58d196969b6a0da74f431ba999c7e0a';

async function startFixture(routes) {
  const server = createServer((request, response) => {
    const route = routes[request.url];
    if (!route) return response.writeHead(404).end();
    response.writeHead(200, { 'content-type': route.type ?? 'application/json' });
    response.end(route.body ?? JSON.stringify(route));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

async function writeTree(root) {
  const source = join(root, 'extension', 'st-rpg-bridge');
  const installedRoot = join(root, '.runtime', 'SillyTavern', 'public', 'scripts', 'extensions', 'third-party');
  const installed = join(installedRoot, 'st-rpg-bridge');
  await Promise.all([mkdir(source, { recursive: true }), mkdir(installed, { recursive: true })]);
  for (const name of ['index.js', 'wire.js', 'style.css', 'manifest.json']) {
    await Promise.all([
      writeFile(join(source, name), `same-${name}`),
      writeFile(join(installed, name), `same-${name}`),
    ]);
  }
  await mkdir(join(installedRoot, 'st-rpg-campaign'), { recursive: true });
  await mkdir(join(root, '.runtime', 'companion'), { recursive: true });
  await writeFile(join(root, '.runtime', 'companion', 'campaigns.sqlite'), 'fixture');
  await writeFile(join(root, 'release.json'), JSON.stringify({
    version: '0.3.0-preview.4',
    channel: 'preview',
    pinnedSillyTavernRevision: PINNED_REVISION,
  }));
}

async function runSmoke(arguments_) {
  const child = spawn(process.execPath, ['tools/smoke-playable-release.mjs', ...arguments_], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  return { code, stdout, stderr };
}

test('playable preview smoke proves the installed bridge, fallback, Campaign data, and live documents', async t => {
  const root = await mkdtemp(join(tmpdir(), 'wayfinder-smoke-'));
  await writeTree(root);
  const st = await startFixture({
    '/version': {
      agent: 'SillyTavern:1.18.0:Cohee#1207',
      pkgVersion: '1.18.0',
      gitRevision: PINNED_REVISION.slice(0, 9),
    },
  });
  const companion = await startFixture({
    '/health': { service: 'st-rpg-companion', status: 'alive' },
    '/ready': {
      service: 'st-rpg-companion', ready: true, status: 'ready',
      components: [
        { id: 'workspace', status: 'ready', blocking: true, message: 'ready' },
        { id: 'sqlite-runtime', status: 'ready', blocking: true, message: 'ready' },
        { id: 'sillytavern', status: 'available', blocking: false, message: 'ready' },
        { id: 'lm-studio', status: 'available', blocking: false, message: 'ready' },
      ],
    },
    '/': { type: 'text/html', body: '<title>Campaign Book</title>' },
    '/api/narration/status': {
      schema: 'st-rpg.narration-status', version: '1.0', observedAt: '2026-08-09T12:00:00.000Z', active: [], latest: null,
    },
    '/api/campaigns': { campaigns: [{ id: 'campaign-1' }] },
    '/api/narrator-model-profiles': { profiles: [{ id: 'narrator-1' }] },
    '/api/campaigns/campaign-1/chat-bindings': [{ id: 'binding-1', markerState: 'verified' }],
  });
  t.after(async () => {
    await Promise.all([st.close(), companion.close()]);
    await rm(root, { recursive: true, force: true });
  });

  const result = await runSmoke([
    '--json', '--root', root, '--st-url', st.baseUrl, '--companion-url', companion.baseUrl,
  ]);

  assert.equal(result.code, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.release, '0.3.0-preview.4');
  assert.deepEqual(report.checks.map(check => [check.id, check.status]), [
    ['stack', 'pass'],
    ['pinned-sillytavern', 'pass'],
    ['workspace', 'pass'],
    ['narration-status', 'pass'],
    ['campaign-authority', 'pass'],
    ['narrator-profile', 'pass'],
    ['chat-binding', 'pass'],
    ['production-bridge', 'pass'],
    ['fallback', 'pass'],
    ['prototype-runtime', 'pass'],
    ['campaign-database', 'pass'],
  ]);
});
