import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

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
