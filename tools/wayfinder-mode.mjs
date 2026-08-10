#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { resolve, join, relative, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const MODE_SCHEMA = 'st-rpg.wayfinder-mode';
const MODE_VERSION = '1.0';
const MODES = new Set(['parallel', 'companion', 'fallback']);
const EXTENSIONS = Object.freeze({
  companion: 'st-rpg-bridge',
  fallback: 'st-rpg-campaign',
});

function paths(root) {
  const projectRoot = resolve(root);
  const runtimeRoot = join(projectRoot, '.runtime');
  const stateRoot = join(runtimeRoot, 'wayfinder');
  return {
    projectRoot,
    runtimeRoot,
    stateRoot,
    modePath: join(stateRoot, 'runtime-mode.json'),
    databasePath: join(runtimeRoot, 'companion', 'campaigns.sqlite'),
    stRoot: join(runtimeRoot, 'SillyTavern'),
    activeRoot: join(runtimeRoot, 'SillyTavern', 'public', 'scripts', 'extensions', 'third-party'),
    inactiveRoot: join(stateRoot, 'inactive-extensions'),
    exportRoot: join(stateRoot, 'exports'),
    divergenceRoot: join(stateRoot, 'divergence'),
  };
}

function assertChild(parent, candidate) {
  const suffix = relative(resolve(parent), resolve(candidate));
  if (!suffix || suffix.startsWith('..') || resolve(parent, suffix) !== resolve(candidate)) {
    throw new Error(`Refusing generated-extension operation outside ${resolve(parent)}: ${resolve(candidate)}`);
  }
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, path);
}

export async function readRuntimeMode(root) {
  const target = paths(root);
  if (!await exists(target.modePath)) {
    return {
      schema: MODE_SCHEMA,
      version: MODE_VERSION,
      mode: 'parallel',
      changedAt: null,
      reason: 'No explicit mode has been selected; both reviewed extensions remain available.',
    };
  }
  const document = await readJson(target.modePath);
  if (document.schema !== MODE_SCHEMA || document.version !== MODE_VERSION || !MODES.has(document.mode)) {
    throw new Error(`Wayfinder mode record is invalid: ${target.modePath}`);
  }
  return document;
}

async function validateExtensionSource(sourceRoot, name) {
  for (const file of ['manifest.json', 'index.js']) {
    const candidate = join(sourceRoot, name, file);
    if (!await exists(candidate)) throw new Error(`Reviewed extension source is missing: ${candidate}`);
  }
}

async function extensionFileMap(root, prefix = '') {
  const result = new Map();
  const entries = await readdir(join(root, prefix), { withFileTypes: true });
  for (const entry of entries) {
    const key = prefix ? join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) {
      const nested = await extensionFileMap(root, key);
      if (!nested) return null;
      for (const [nestedKey, value] of nested) result.set(nestedKey, value);
    } else if (entry.isFile()) {
      result.set(key, createHash('sha256').update(await readFile(join(root, key))).digest('hex'));
    } else {
      return null;
    }
  }
  return result;
}

async function extensionMatches(source, active) {
  if (!await exists(active)) return false;
  const [sourceFiles, activeFiles] = await Promise.all([
    extensionFileMap(source),
    extensionFileMap(active),
  ]);
  if (!sourceFiles || !activeFiles || sourceFiles.size !== activeFiles.size) return false;
  for (const [path, hash] of sourceFiles) {
    if (activeFiles.get(path) !== hash) return false;
  }
  return true;
}

async function removeAbandonedNextDirectories(target, name) {
  const pattern = new RegExp(`^\\.${name}\\.[0-9a-f-]{36}\\.next$`, 'i');
  for (const entry of await readdir(target.activeRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !pattern.test(entry.name)) continue;
    const candidate = join(target.activeRoot, entry.name);
    assertChild(target.activeRoot, candidate);
    await rm(candidate, { recursive: true, force: true });
  }
}

async function installActiveExtension(target, name) {
  const source = join(target.projectRoot, 'extension', name);
  const active = join(target.activeRoot, name);
  const inactive = join(target.inactiveRoot, name);
  assertChild(target.activeRoot, active);
  assertChild(target.inactiveRoot, inactive);
  if (await extensionMatches(source, active)) {
    await removeAbandonedNextDirectories(target, name);
    if (await exists(inactive)) await rm(inactive, { recursive: true, force: true });
    return;
  }
  const staged = join(target.activeRoot, `.${name}.${randomUUID()}.next`);
  const previous = join(target.activeRoot, `.${name}.${randomUUID()}.previous`);
  assertChild(target.activeRoot, staged);
  assertChild(target.activeRoot, previous);
  await cp(source, staged, { recursive: true, force: true });
  const hadActive = await exists(active);
  if (hadActive) await rename(active, previous);
  try {
    await rename(staged, active);
  } catch (error) {
    if (hadActive && await exists(previous) && !await exists(active)) await rename(previous, active);
    throw error;
  }
  if (hadActive && await exists(previous)) await rm(previous, { recursive: true, force: true });
  if (await exists(inactive)) await rm(inactive, { recursive: true, force: true });
}

async function deactivateExtension(target, name) {
  const active = join(target.activeRoot, name);
  const inactive = join(target.inactiveRoot, name);
  assertChild(target.activeRoot, active);
  assertChild(target.inactiveRoot, inactive);
  if (!await exists(active)) return;
  if (await exists(inactive)) await rm(inactive, { recursive: true, force: true });
  await rename(active, inactive);
}

export async function activateRuntimeExtensions(root, mode) {
  if (!MODES.has(mode)) throw new Error(`Unknown Wayfinder runtime mode: ${mode}`);
  const target = paths(root);
  if (!await exists(join(target.stRoot, 'package.json'))) {
    throw new Error(`Pinned SillyTavern runtime is missing: ${target.stRoot}`);
  }
  await validateExtensionSource(join(target.projectRoot, 'extension'), EXTENSIONS.companion);
  await validateExtensionSource(join(target.projectRoot, 'extension'), EXTENSIONS.fallback);
  await mkdir(target.activeRoot, { recursive: true });
  await mkdir(target.inactiveRoot, { recursive: true });

  if (mode === 'parallel') {
    await installActiveExtension(target, EXTENSIONS.companion);
    await installActiveExtension(target, EXTENSIONS.fallback);
  } else if (mode === 'companion') {
    await installActiveExtension(target, EXTENSIONS.companion);
    await deactivateExtension(target, EXTENSIONS.fallback);
  } else {
    await installActiveExtension(target, EXTENSIONS.fallback);
    await deactivateExtension(target, EXTENSIONS.companion);
  }

  return inspectRuntimeMode(root, mode);
}

export async function inspectRuntimeMode(root, declaredMode) {
  const target = paths(root);
  const document = declaredMode ? { mode: declaredMode } : await readRuntimeMode(root);
  const active = {};
  const preserved = {};
  for (const [key, name] of Object.entries(EXTENSIONS)) {
    active[key] = await exists(join(target.activeRoot, name));
    preserved[key] = active[key]
      || await exists(join(target.inactiveRoot, name))
      || await exists(join(target.projectRoot, 'extension', name));
  }
  return { mode: document.mode, active, preserved };
}

async function fetchJson(url, init = {}, fetchImplementation = globalThis.fetch) {
  const response = await fetchImplementation(url, { ...init, signal: AbortSignal.timeout(60_000) });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body?.message || `${url} returned HTTP ${response.status}`;
    throw new Error(message);
  }
  return body;
}

function safeTimestamp() {
  return new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
}

async function createFallbackSafetyExport(root, companionUrl, fetchImplementation) {
  const target = paths(root);
  const base = companionUrl.replace(/\/$/, '');
  const exportedAt = new Date().toISOString();
  const backup = await fetchJson(`${base}/api/operations/backups`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ label: `Before fallback mode ${exportedAt}` }),
  }, fetchImplementation);
  if (backup?.availability !== 'available' || backup?.verification?.verified !== true) {
    throw new Error('Companion did not return a verified pre-fallback backup.');
  }

  const summaries = await fetchJson(`${base}/api/campaigns`, {}, fetchImplementation);
  if (!Array.isArray(summaries)) throw new Error('Companion Campaign list was not an array.');
  const campaigns = [];
  for (const summary of summaries) {
    const id = String(summary?.id ?? '');
    if (!id) throw new Error('Companion export found a Campaign without a stable ID.');
    const encoded = encodeURIComponent(id);
    const [document, history, bindings] = await Promise.all([
      fetchJson(`${base}/api/campaigns/${encoded}`, {}, fetchImplementation),
      fetchJson(`${base}/api/campaigns/${encoded}/history`, {}, fetchImplementation),
      fetchJson(`${base}/api/campaigns/${encoded}/chat-bindings`, {}, fetchImplementation),
    ]);
    if (!document?.campaign?.id || !Number.isInteger(document?.campaign?.revision) || !Array.isArray(history) || !Array.isArray(bindings)) {
      throw new Error(`Companion export returned an invalid document set for Campaign ${id}.`);
    }
    campaigns.push({ document, history, bindings });
  }

  const release = await readJson(join(target.projectRoot, 'release.json'));
  const exportDocument = {
    schema: 'st-rpg.companion-export',
    version: '1.0',
    exportedAt,
    release: String(release.version),
    backup,
    campaigns,
  };
  await mkdir(target.exportRoot, { recursive: true });
  const exportPath = join(target.exportRoot, `companion-export-${safeTimestamp()}.json`);
  await writeJsonAtomic(exportPath, exportDocument);
  const serialized = await readFile(exportPath);
  JSON.parse(serialized.toString('utf8'));
  return {
    backup,
    exportPath,
    exportSha256: createHash('sha256').update(serialized).digest('hex'),
    exportDocument,
  };
}

async function verifiedBindingsFromDatabase(root) {
  const target = paths(root);
  if (!await exists(target.databasePath)) throw new Error(`Campaign SQLite is missing: ${target.databasePath}`);
  const database = new DatabaseSync(target.databasePath, { readOnly: true });
  try {
    const row = database.prepare(`
      SELECT COUNT(*) AS count
      FROM chat_bindings
      WHERE marker_state = 'verified'
    `).get();
    return Number(row?.count ?? 0);
  } finally {
    database.close();
  }
}

async function writeMode(root, mode, details) {
  const target = paths(root);
  const document = {
    schema: MODE_SCHEMA,
    version: MODE_VERSION,
    mode,
    changedAt: new Date().toISOString(),
    ...details,
  };
  await writeJsonAtomic(target.modePath, document);
  return document;
}

export async function enterFallbackMode(root, options = {}) {
  const target = paths(root);
  const previous = await readRuntimeMode(root);
  let safety = null;
  let safetyFailure = null;
  try {
    safety = await createFallbackSafetyExport(
      root,
      options.companionUrl ?? 'http://127.0.0.1:8002',
      options.fetchImplementation ?? globalThis.fetch,
    );
  } catch (error) {
    safetyFailure = error instanceof Error ? error.message : String(error);
    if (!options.emergency) {
      throw new Error(`Fallback blocked before extension switch: ${safetyFailure} Rerun only with explicit --emergency if losing this safety export is acceptable.`);
    }
  }

  await mkdir(target.divergenceRoot, { recursive: true });
  const divergencePath = join(target.divergenceRoot, `fallback-divergence-${safeTimestamp()}.json`);
  const campaigns = safety?.exportDocument.campaigns.map(entry => ({
    campaignId: entry.document.campaign.id,
    campaignRevision: entry.document.campaign.revision,
    bindings: entry.bindings.map(binding => ({
      bindingId: binding.id,
      bindingRevision: binding.revision,
      markerState: binding.markerState,
      legacyImportProvenanceRevision: binding.campaignAnchor,
    })),
  })) ?? [];
  const divergence = {
    schema: 'st-rpg.fallback-divergence',
    version: '1.0',
    recordedAt: new Date().toISOString(),
    previousMode: previous.mode,
    emergency: Boolean(options.emergency && !safety),
    safetyFailure,
    backupId: safety?.backup.id ?? null,
    backupFileName: safety?.backup.fileName ?? null,
    exportPath: safety?.exportPath ?? null,
    exportSha256: safety?.exportSha256 ?? null,
    campaigns,
    warning: 'Fallback resumes retained legacy chat metadata. Further fallback play diverges from SQLite Campaign history and is never merged automatically.',
  };
  await writeJsonAtomic(divergencePath, divergence);
  await activateRuntimeExtensions(root, 'fallback');
  let mode;
  try {
    mode = await writeMode(root, 'fallback', {
      previousMode: previous.mode,
      divergenceReport: divergencePath,
      backupId: safety?.backup.id ?? null,
      exportPath: safety?.exportPath ?? null,
      emergency: divergence.emergency,
      warning: divergence.warning,
    });
  } catch (error) {
    await activateRuntimeExtensions(root, previous.mode).catch(() => undefined);
    throw error;
  }
  return { mode, divergence, extensionState: await inspectRuntimeMode(root) };
}

export async function enterCompanionMode(root) {
  const previous = await readRuntimeMode(root);
  const verifiedBindingCount = await verifiedBindingsFromDatabase(root);
  if (verifiedBindingCount < 1) {
    throw new Error('Companion mode requires at least one verified Chat Binding. Import and verify a legacy chat first.');
  }
  await activateRuntimeExtensions(root, 'companion');
  let mode;
  try {
    mode = await writeMode(root, 'companion', {
      previousMode: previous.mode,
      verifiedBindingCount,
      warning: previous.mode === 'fallback'
        ? 'Returning to Companion does not merge any play performed in fallback mode.'
        : 'SQLite Campaign authority is active for verified linked chats. Companion does not merge fallback play automatically.',
    });
  } catch (error) {
    await activateRuntimeExtensions(root, previous.mode).catch(() => undefined);
    throw error;
  }
  return { mode, extensionState: await inspectRuntimeMode(root) };
}

function parseArguments(arguments_) {
  const result = {
    command: arguments_[0] ?? 'inspect',
    root: process.cwd(),
    companionUrl: 'http://127.0.0.1:8002',
    emergency: false,
  };
  for (let index = 1; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--root') result.root = arguments_[++index];
    else if (argument === '--companion-url') result.companionUrl = arguments_[++index];
    else if (argument === '--emergency') result.emergency = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return result;
}

export async function runModeCommand(arguments_) {
  const options = parseArguments(arguments_);
  if (options.command === 'inspect') return inspectRuntimeMode(options.root);
  if (options.command === 'apply-current') {
    const mode = await readRuntimeMode(options.root);
    return activateRuntimeExtensions(options.root, mode.mode);
  }
  if (options.command === 'fallback') {
    return enterFallbackMode(options.root, {
      companionUrl: options.companionUrl,
      emergency: options.emergency,
    });
  }
  if (options.command === 'companion') return enterCompanionMode(options.root);
  throw new Error(`Unknown Wayfinder mode command: ${options.command}`);
}

async function main() {
  try {
    const result = await runModeCommand(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`Wayfinder mode failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
