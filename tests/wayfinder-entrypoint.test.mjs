import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('Wayfinder exposes identity-safe supervisor commands through one rooted PowerShell entrypoint', async () => {
  const [batch, supervisor, launcher] = await Promise.all([
    import('node:fs/promises').then(({ readFile }) => readFile('Wayfinder.cmd', 'utf8')),
    import('node:fs/promises').then(({ readFile }) => readFile('tools/wayfinder.ps1', 'utf8')),
    import('node:fs/promises').then(({ readFile }) => readFile('tools/start-local-sillytavern.ps1', 'utf8')),
  ]);
  assert.match(batch, /tools\\wayfinder\.ps1/i);
  for (const command of ['start', 'status', 'stop', 'companion', 'backup', 'restore']) {
    assert.match(supervisor, new RegExp(`'${command}'`));
  }
  for (const identity of ['startTimeUtc', 'executablePath', 'commandHash', 'runId']) {
    assert.match(supervisor, new RegExp(identity));
    assert.match(launcher, new RegExp(identity));
  }
  assert.match(supervisor, /Refusing to stop PID/);
  assert.doesNotMatch(supervisor, /taskkill|Stop-Process\s+-Name|kill.*800[12]/i);
  assert.match(supervisor, /x-wayfinder-run-id/);
});

test('compatibility update is staged beside active ST and preserves rollback before any switch', async () => {
  const { readFile } = await import('node:fs/promises');
  const [updater, bridgeInstaller, fallbackInstaller, lockText, releaseText] = await Promise.all([
    readFile('tools/update-sillytavern-compatibility.ps1', 'utf8'),
    readFile('extension/st-rpg-bridge/install.ps1', 'utf8'),
    readFile('extension/st-rpg-campaign/install.ps1', 'utf8'),
    readFile('compatibility.lock.json', 'utf8'),
    readFile('release.json', 'utf8'),
  ]);
  const lock = JSON.parse(lockText);
  const release = JSON.parse(releaseText);
  assert.equal(lock.schema, 'st-rpg.compatibility-lock');
  assert.equal(lock.sillyTavern.revision, release.pinnedSillyTavernRevision);
  assert.match(updater, /SillyTavern\.next/);
  assert.match(updater, /SillyTavern\.previous/);
  assert.match(updater, /api\/operations\/backups/);
  assert.match(updater, /Test-StagedRuntime \$stageRoot/);
  assert.match(updater, /Test-StagedRuntime \$activeRoot/);
  assert.match(updater, /listen: false/);
  assert.match(updater, /skipContentCheck: true/);
  assert.match(updater, /autoDownload: false/);
  assert.match(updater, /AddSeconds\(120\)/);
  assert.match(updater, /Move-PersistentState/);
  assert.match(updater, /rolling back/i);
  assert.match(updater, /RollbackDrill/);
  assert.match(updater, /after-post-switch-verification/);
  assert.match(updater, /persistentStateSentinelRestored/);
  assert.match(updater, /liveRuntimeUnchanged/);
  assert.match(updater, /active SillyTavern is still running/i);
  assert.doesNotMatch(updater, /git\s+(pull|reset|stash)/i);
  assert.match(bridgeInstaller, /TargetRoot/);
  assert.match(fallbackInstaller, /TargetRoot/);
});

test('fallback and companion modes preserve both authorities and require explicit safety evidence', async () => {
  const { readFile } = await import('node:fs/promises');
  const [supervisor, modeTool, launcher] = await Promise.all([
    readFile('tools/wayfinder.ps1', 'utf8'),
    readFile('tools/wayfinder-mode.mjs', 'utf8'),
    readFile('tools/start-local-sillytavern.ps1', 'utf8'),
  ]);
  assert.match(supervisor, /Type FALLBACK/);
  assert.match(supervisor, /--emergency/);
  assert.match(supervisor, /Stop-OwnedProcess 'companion'/);
  assert.match(modeTool, /api\/operations\/backups/);
  assert.match(modeTool, /companion-export/);
  assert.match(modeTool, /fallback-divergence/);
  assert.match(modeTool, /marker_state = 'verified'/);
  assert.match(modeTool, /inactive-extensions/);
  assert.match(modeTool, /never merged automatically/);
  assert.doesNotMatch(modeTool, /rm\([^\n]*projectRoot[^\n]*extension/);
  assert.match(launcher, /extensionMode -eq 'fallback'/);
  assert.match(launcher, /Companion remains stopped/);
});

test('Wayfinder batch entrypoint preserves a PowerShell startup failure', async t => {
  const fakeBin = await mkdtemp(join(tmpdir(), 'wayfinder-powershell-'));
  await writeFile(join(fakeBin, 'powershell.cmd'), '@echo fake PowerShell failure\r\n@exit /b 23\r\n');
  t.after(() => rm(fakeBin, { recursive: true, force: true }));

  const child = spawn('cmd.exe', ['/d', '/c', 'Wayfinder.cmd < nul'], {
    cwd: process.cwd(),
    env: { ...process.env, PATH: `${fakeBin};${process.env.PATH ?? ''}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.setEncoding('utf8').on('data', chunk => { output += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { output += chunk; });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });

  assert.equal(code, 23, output);
  assert.match(output, /fake PowerShell failure/);
  assert.match(output, /Wayfinder could not start the playable stack/);
});
