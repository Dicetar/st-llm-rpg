import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const root = new URL('./', import.meta.url);

async function text(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('launcher installs every file referenced by the bridge manifest and loader', async () => {
  const [script, manifestText, loader] = await Promise.all([
    text('run.ps1'),
    text('bridge/manifest.json'),
    text('bridge/loader.js'),
  ]);
  const manifest = JSON.parse(manifestText);
  const installed = new Set(
    [...script.matchAll(/'([^']+\.(?:js|css|json))'/g)].map(match => match[1]),
  );
  const required = [manifest.js, manifest.css]
    .map(value => String(value).split('?')[0]);
  for (const match of loader.matchAll(/import\s+['"]\.\/([^?'";]+)(?:\?[^'"]*)?['"]/g)) {
    required.push(match[1]);
  }
  for (const file of required) {
    assert.equal(installed.has(file), true, `run.ps1 must install ${file}`);
  }
});

test('launcher reuses the healthy spike and diagnoses foreign port owners without killing them', async () => {
  const script = await text('run.ps1');
  assert.match(script, /\/prototype\/state/);
  assert.match(script, /st-narrator-proxy-spike/);
  assert.match(script, /already running on port/);
  assert.match(script, /Get-NetTCPConnection/);
  assert.match(script, /Get-CimInstance Win32_Process/);
  assert.match(script, /launcher did not stop it/);
  assert.doesNotMatch(script, /Stop-Process/);
});

test('browser bridge uses simple local labels and no Web Crypto API', async () => {
  const bridge = await text('bridge/index.js');
  assert.doesNotMatch(bridge, /crypto\./);
  assert.doesNotMatch(bridge, /randomUUID/);
  assert.match(bridge, /Date\.now\(\)\.toString\(36\)/);
  assert.match(bridge, /localIdCounter/);
});

test('browser bridge redirects only the transient test request and does not require a saved proxy endpoint', async () => {
  const bridge = await text('bridge/index.js');
  assert.match(bridge, /generateData\.custom_url\s*=\s*PROXY_BASE/);
  assert.doesNotMatch(bridge, /Set the Custom endpoint/);
  assert.doesNotMatch(bridge, /oai_settings\.custom_url\s*=/);
  assert.match(bridge, /saved SillyTavern endpoint\/profile remains untouched/);
});
