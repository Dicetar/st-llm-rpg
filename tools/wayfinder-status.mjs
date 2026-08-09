#!/usr/bin/env node

import { readFileSync } from 'node:fs';

const DEFAULT_ST_URL = 'http://127.0.0.1:8001';
const DEFAULT_COMPANION_URL = 'http://127.0.0.1:8002';
const RELEASE = JSON.parse(readFileSync(new URL('../release.json', import.meta.url), 'utf8'));
const PINNED_ST_REVISION = String(RELEASE.pinnedSillyTavernRevision);

function parseArguments(arguments_) {
  const options = {
    json: false,
    stUrl: DEFAULT_ST_URL,
    companionUrl: DEFAULT_COMPANION_URL,
  };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--json') {
      options.json = true;
    } else if (argument === '--st-url') {
      options.stUrl = arguments_[++index];
    } else if (argument === '--companion-url') {
      options.companionUrl = arguments_[++index];
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!options.stUrl || !options.companionUrl) throw new Error('Status URLs cannot be empty.');
  return options;
}

async function readJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}.`);
  return response.json();
}

async function inspectSillyTavern(options) {
  const version = await readJson(`${options.stUrl.replace(/\/$/, '')}/version`);
  if (typeof version.agent !== 'string' || !version.agent.startsWith('SillyTavern:')) {
    throw new Error(`${options.stUrl} is not the expected SillyTavern service.`);
  }
  const revision = String(version.gitRevision ?? 'unknown');
  if (revision.length < 7 || !PINNED_ST_REVISION.startsWith(revision)) {
    return {
      status: 'incompatible',
      version: String(version.pkgVersion ?? 'unknown'),
      revision,
      message: `SillyTavern is running revision ${revision}; expected pinned revision ${PINNED_ST_REVISION.slice(0, 9)}.`,
    };
  }
  return {
    status: 'ready',
    version: String(version.pkgVersion ?? 'unknown'),
    revision,
    message: 'Pinned SillyTavern is ready.',
  };
}

async function inspectCompanion(options) {
  const companionBase = options.companionUrl.replace(/\/$/, '');
  const health = await readJson(`${companionBase}/health`);
  if (health.service !== 'st-rpg-companion' || health.status !== 'alive') {
    throw new Error(`${options.companionUrl} is not the expected RPG Companion service.`);
  }
  const readiness = await readJson(`${companionBase}/ready`);
  if (readiness.service !== 'st-rpg-companion' || typeof readiness.ready !== 'boolean') {
    throw new Error(`${options.companionUrl}/ready returned an invalid readiness document.`);
  }
  return {
    companion: {
      status: String(readiness.status ?? (readiness.ready ? 'ready' : 'not-ready')),
      ready: readiness.ready,
      message: readiness.ready
        ? readiness.status === 'degraded'
          ? 'Companion is ready; one or more optional dependencies are unavailable.'
          : 'Companion is ready.'
        : 'Companion is alive but Campaign services are not ready.',
    },
    components: Array.isArray(readiness.components)
      ? readiness.components.map(component => ({
          id: String(component.id),
          status: String(component.status),
          blocking: Boolean(component.blocking),
          message: String(component.message),
        }))
      : [],
  };
}

async function inspectStack(options) {
  const [sillyTavernResult, companionResult] = await Promise.allSettled([
    inspectSillyTavern(options),
    inspectCompanion(options),
  ]);
  const sillyTavern = sillyTavernResult.status === 'fulfilled'
    ? sillyTavernResult.value
    : {
        status: 'unavailable',
        version: 'unknown',
        revision: 'unknown',
        message: `SillyTavern is not reachable at ${options.stUrl}.`,
      };
  const companion = companionResult.status === 'fulfilled'
    ? companionResult.value.companion
    : {
        status: 'unavailable',
        ready: false,
        message: `RPG Companion is not reachable at ${options.companionUrl}.`,
      };
  return {
    ok: sillyTavern.status === 'ready' && companion.ready,
    sillyTavern,
    companion,
    components: companionResult.status === 'fulfilled' ? companionResult.value.components : [],
  };
}

function renderHuman(result) {
  const lines = [
    `[${result.sillyTavern.status}] SillyTavern ${result.sillyTavern.version} (${result.sillyTavern.revision}): ${result.sillyTavern.message}`,
    `[${result.companion.status}] RPG Companion: ${result.companion.message}`,
  ];
  for (const component of result.components) {
    lines.push(`[${component.status}] ${component.id}: ${component.message}`);
  }
  return lines.join('\n');
}

async function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    const result = await inspectStack(options);
    process.stdout.write(`${options.json ? JSON.stringify(result) : renderHuman(result)}\n`);
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`Wayfinder status failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

await main();
