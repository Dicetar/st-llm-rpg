#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';

function parseArguments(arguments_) {
  const result = {
    json: false,
    root: process.cwd(),
    stUrl: 'http://127.0.0.1:8001',
    companionUrl: 'http://127.0.0.1:8002',
  };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--json') result.json = true;
    else if (argument === '--root') result.root = resolve(arguments_[++index]);
    else if (argument === '--st-url') result.stUrl = arguments_[++index];
    else if (argument === '--companion-url') result.companionUrl = arguments_[++index];
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return result;
}

async function readResponse(url, type = 'json') {
  const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}.`);
  return type === 'text' ? response.text() : response.json();
}

function collectionValues(value, property) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.[property])) return value[property];
  if (Array.isArray(value?.value)) return value.value;
  throw new Error(`Expected an array or ${property} collection.`);
}

async function digest(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const release = JSON.parse(await readFile(join(options.root, 'release.json'), 'utf8'));
  const checks = [];
  const check = async (id, action) => {
    try {
      checks.push({ id, status: 'pass', message: await action() });
    } catch (error) {
      checks.push({ id, status: 'fail', message: error instanceof Error ? error.message : String(error) });
    }
  };
  const stBase = options.stUrl.replace(/\/$/, '');
  const companionBase = options.companionUrl.replace(/\/$/, '');
  let stVersion;
  let campaignId = '';

  await check('stack', async () => {
    const [version, health, readiness] = await Promise.all([
      readResponse(`${stBase}/version`),
      readResponse(`${companionBase}/health`),
      readResponse(`${companionBase}/ready`),
    ]);
    if (typeof version.agent !== 'string' || !version.agent.startsWith('SillyTavern:')) {
      throw new Error('Port 8001 is not the expected SillyTavern service.');
    }
    if (health.service !== 'st-rpg-companion' || health.status !== 'alive') {
      throw new Error('Port 8002 is not the expected RPG Companion service.');
    }
    if (readiness.service !== 'st-rpg-companion' || readiness.ready !== true) {
      throw new Error('RPG Companion is alive but Campaign services are not ready.');
    }
    stVersion = version;
    return `SillyTavern ${version.pkgVersion} and RPG Companion are ready (${readiness.status}).`;
  });

  await check('pinned-sillytavern', async () => {
    if (!stVersion) stVersion = await readResponse(`${stBase}/version`);
    const actual = String(stVersion.gitRevision ?? '');
    if (actual.length < 7 || !String(release.pinnedSillyTavernRevision).startsWith(actual)) {
      throw new Error(`Expected SillyTavern ${release.pinnedSillyTavernRevision}; found ${actual || 'unknown'}.`);
    }
    return `Pinned SillyTavern revision ${actual} is active.`;
  });

  await check('workspace', async () => {
    const html = await readResponse(`${companionBase}/`, 'text');
    if (!html.includes('Campaign Book')) throw new Error('Campaign Book production HTML is not being served.');
    return 'Campaign Book production assets are served by the companion.';
  });

  await check('narration-status', async () => {
    const status = await readResponse(`${companionBase}/api/narration/status`);
    if (status.schema !== 'st-rpg.narration-status' || !Array.isArray(status.active) || !('latest' in status)) {
      throw new Error('Narration status diagnostics do not match the playable contract.');
    }
    const serialized = JSON.stringify(status);
    for (const forbidden of ['"messages"', '"prompt"', '"completion"', '"content"']) {
      if (serialized.includes(forbidden)) throw new Error(`Narration status leaked forbidden field ${forbidden}.`);
    }
    return `Content-free operational narration status is available (${status.active.length} active; latest ${status.latest?.state ?? 'none'}).`;
  });

  await check('backup-catalog', async () => {
    const catalog = await readResponse(`${companionBase}/api/operations/backups`);
    if (catalog.schema !== 'st-rpg.backup-catalog' || !Array.isArray(catalog.backups) || !Array.isArray(catalog.problems)) {
      throw new Error('Backup catalog does not match the playable operations contract.');
    }
    if (catalog.automaticDailyHealthy !== true) throw new Error('Today\'s automatic verified backup is unavailable.');
    const available = catalog.backups.filter(backup => backup?.availability === 'available');
    if (available.length === 0) throw new Error('Backup catalog contains no available verified backup.');
    return `${available.length} verified backup${available.length === 1 ? '' : 's'} available; daily safety is current.`;
  });

  await check('campaign-authority', async () => {
    const campaigns = await readResponse(`${companionBase}/api/campaigns`);
    const values = collectionValues(campaigns, 'campaigns');
    const count = values.length;
    if (count === 0) throw new Error('No Campaign exists; the advertised linked play path is unavailable.');
    campaignId = String(values[0]?.id ?? '');
    if (!campaignId) throw new Error('The first Campaign has no stable ID.');
    return `${count} Campaign${count === 1 ? '' : 's'} available.`;
  });

  await check('narrator-profile', async () => {
    const profiles = await readResponse(`${companionBase}/api/narrator-model-profiles`);
    const count = collectionValues(profiles, 'profiles').length;
    if (count === 0) throw new Error('No narrator model profile exists; linked narration is not playable.');
    return `${count} narrator model profile${count === 1 ? '' : 's'} available.`;
  });

  await check('chat-binding', async () => {
    if (!campaignId) throw new Error('A Campaign must pass before its Chat Bindings can be inspected.');
    const bindings = collectionValues(
      await readResponse(`${companionBase}/api/campaigns/${encodeURIComponent(campaignId)}/chat-bindings`),
      'bindings',
    );
    const verified = bindings.filter(binding => binding?.markerState === 'verified');
    if (verified.length === 0) throw new Error('No verified Chat Binding exists; linked narration is not playable.');
    return `${verified.length} verified Chat Binding${verified.length === 1 ? '' : 's'} available.`;
  });

  await check('production-bridge', async () => {
    const source = join(options.root, 'extension', 'st-rpg-bridge');
    const installed = join(options.root, '.runtime', 'SillyTavern', 'public', 'scripts', 'extensions', 'third-party', 'st-rpg-bridge');
    for (const name of ['index.js', 'wire.js', 'style.css', 'manifest.json']) {
      if (await digest(join(source, name)) !== await digest(join(installed, name))) {
        throw new Error(`Installed bridge ${name} differs from the release source. Run npm run install:bridge.`);
      }
    }
    return 'Installed production bridge matches release source.';
  });

  const installedRoot = join(options.root, '.runtime', 'SillyTavern', 'public', 'scripts', 'extensions', 'third-party');
  await check('fallback', async () => {
    const info = await stat(join(installedRoot, 'st-rpg-campaign'));
    if (!info.isDirectory()) throw new Error('Fallback extension path is not a directory.');
    return 'Working fallback extension remains installed.';
  });

  await check('prototype-runtime', async () => {
    const installed = await readdir(installedRoot, { withFileTypes: true });
    const spikes = installed.filter(entry => entry.isDirectory() && entry.name.startsWith('st-rpg-') && entry.name.includes('spike'));
    if (spikes.length > 0) throw new Error(`Frozen prototypes are still installed: ${spikes.map(entry => entry.name).join(', ')}`);
    return 'No frozen prototype extension is active in the SillyTavern runtime.';
  });

  await check('campaign-database', async () => {
    const info = await stat(join(options.root, '.runtime', 'companion', 'campaigns.sqlite'));
    if (!info.isFile() || info.size === 0) throw new Error('Canonical Campaign SQLite file is missing or empty.');
    return `Canonical Campaign SQLite is present (${info.size} bytes).`;
  });

  const report = {
    ok: checks.every(item => item.status === 'pass'),
    release: String(release.version),
    channel: String(release.channel),
    checkedAt: new Date().toISOString(),
    checks,
  };
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } else {
    process.stdout.write(`Wayfinder ${report.release} (${report.channel})\n`);
    for (const item of checks) process.stdout.write(`[${item.status}] ${item.id}: ${item.message}\n`);
  }
  if (!report.ok) process.exitCode = 1;
}

main().catch(error => {
  process.stderr.write(`Playable release smoke failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
