import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import test from 'node:test';

async function startFixture(routes) {
  const server = createServer((request, response) => {
    const route = routes[request.url];
    if (!route) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(route));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

async function runStatus(arguments_) {
  const child = spawn(process.execPath, ['tools/wayfinder-status.mjs', ...arguments_], {
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

test('status accepts a ready Campaign stack when only LM Studio is degraded', async t => {
  const st = await startFixture({
    '/version': {
      agent: 'SillyTavern:1.18.0:Cohee#1207',
      pkgVersion: '1.18.0',
      gitRevision: '380e31e8c',
    },
  });
  const companion = await startFixture({
    '/health': {
      schema: 'st-rpg.health',
      version: '1.0',
      service: 'st-rpg-companion',
      status: 'alive',
    },
    '/ready': {
      schema: 'st-rpg.readiness',
      version: '1.0',
      service: 'st-rpg-companion',
      ready: true,
      status: 'degraded',
      components: [
        { id: 'workspace', status: 'ready', blocking: true, message: 'Workspace ready.' },
        { id: 'sqlite-runtime', status: 'ready', blocking: true, message: 'Campaign ready.' },
        { id: 'sillytavern', status: 'available', blocking: false, message: 'ST reachable.' },
        { id: 'lm-studio', status: 'unavailable', blocking: false, message: 'Start LM Studio to narrate.' },
      ],
    },
  });
  t.after(() => Promise.all([st.close(), companion.close()]));

  const result = await runStatus([
    '--json',
    '--mode', 'parallel',
    '--st-url', st.baseUrl,
    '--companion-url', companion.baseUrl,
  ]);

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    ok: true,
    mode: 'parallel',
    sillyTavern: {
      status: 'ready',
      version: '1.18.0',
      revision: '380e31e8c',
      message: 'Pinned SillyTavern is ready.',
    },
    companion: {
      status: 'degraded',
      ready: true,
      message: 'Companion is ready; one or more optional dependencies are unavailable.',
    },
    components: [
      { id: 'workspace', status: 'ready', blocking: true, message: 'Workspace ready.' },
      { id: 'sqlite-runtime', status: 'ready', blocking: true, message: 'Campaign ready.' },
      { id: 'sillytavern', status: 'available', blocking: false, message: 'ST reachable.' },
      { id: 'lm-studio', status: 'unavailable', blocking: false, message: 'Start LM Studio to narrate.' },
    ],
  });
});

test('status identifies an unavailable companion without hiding the healthy SillyTavern result', async t => {
  const st = await startFixture({
    '/version': {
      agent: 'SillyTavern:1.18.0:Cohee#1207',
      pkgVersion: '1.18.0',
      gitRevision: '380e31e8c',
    },
  });
  const absentCompanion = await startFixture({});
  const companionUrl = absentCompanion.baseUrl;
  await absentCompanion.close();
  t.after(() => st.close());

  const result = await runStatus([
    '--json',
    '--mode', 'parallel',
    '--st-url', st.baseUrl,
    '--companion-url', companionUrl,
  ]);

  assert.equal(result.code, 1);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), {
    ok: false,
    mode: 'parallel',
    sillyTavern: {
      status: 'ready',
      version: '1.18.0',
      revision: '380e31e8c',
      message: 'Pinned SillyTavern is ready.',
    },
    companion: {
      status: 'unavailable',
      ready: false,
      message: `RPG Companion is not reachable at ${companionUrl}.`,
    },
    components: [],
  });
});

test('status rejects an unpinned SillyTavern revision instead of calling it ready', async t => {
  const st = await startFixture({
    '/version': {
      agent: 'SillyTavern:1.19.0:Cohee#1207',
      pkgVersion: '1.19.0',
      gitRevision: 'deadbeef0',
    },
  });
  const companion = await startFixture({
    '/health': { service: 'st-rpg-companion', status: 'alive' },
    '/ready': { service: 'st-rpg-companion', ready: true, status: 'ready', components: [] },
  });
  t.after(() => Promise.all([st.close(), companion.close()]));

  const result = await runStatus([
    '--json', '--mode', 'parallel', '--st-url', st.baseUrl, '--companion-url', companion.baseUrl,
  ]);

  assert.equal(result.code, 1);
  assert.equal(JSON.parse(result.stdout).sillyTavern.status, 'incompatible');
  assert.match(JSON.parse(result.stdout).sillyTavern.message, /expected pinned revision 380e31e8c/i);
});

test('fallback status stays ready when pinned SillyTavern is available and Companion is intentionally stopped', async t => {
  const st = await startFixture({
    '/version': {
      agent: 'SillyTavern:1.18.0:Cohee#1207',
      pkgVersion: '1.18.0',
      gitRevision: '380e31e8c',
    },
  });
  const absentCompanion = await startFixture({});
  const companionUrl = absentCompanion.baseUrl;
  await absentCompanion.close();
  t.after(() => st.close());

  const result = await runStatus([
    '--json', '--mode', 'fallback', '--st-url', st.baseUrl, '--companion-url', companionUrl,
  ]);
  const document = JSON.parse(result.stdout);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(document.ok, true);
  assert.equal(document.mode, 'fallback');
  assert.equal(document.companion.status, 'unavailable');
});
