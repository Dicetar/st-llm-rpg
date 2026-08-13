import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

const port = 18102;
const baseUrl = `http://127.0.0.1:${port}`;

async function assertPortFree() {
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
}

async function waitForServer(child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Player journey harness exited early with code ${child.exitCode}.`);
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // Startup is still in progress.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Player journey harness did not become ready within 30 seconds.');
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return Promise.resolve(true);
  return new Promise(resolve => {
    const timeout = setTimeout(() => resolve(false), timeoutMs);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve(true);
    });
  });
}

await assertPortFree();
const harness = spawn(process.execPath, [
  '--import', 'tsx',
  'apps/companion/test/player-journey-harness.ts',
], { cwd: process.cwd(), stdio: 'inherit' });

let journeyCode = 1;
try {
  await waitForServer(harness);
  journeyCode = await new Promise((resolve, reject) => {
    const journey = spawn(process.execPath, ['tests/player-journey.playwright.mjs'], {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: { ...process.env, RPG_PLAYER_JOURNEY_URL: baseUrl },
    });
    journey.once('error', reject);
    journey.once('exit', code => resolve(code ?? 1));
  });
} finally {
  await fetch(`${baseUrl}/api/operations/shutdown`, {
    method: 'POST',
    headers: { 'x-wayfinder-run-id': 'player-journey-run' },
  }).catch(() => undefined);
  if (!await waitForExit(harness, 5_000)) {
    harness.kill('SIGTERM');
    await waitForExit(harness, 2_000);
  }
}

if (journeyCode !== 0) process.exitCode = journeyCode;
