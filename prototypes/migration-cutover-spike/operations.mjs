import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { OpsProblem } from './core.mjs';

function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function now() { return new Date().toISOString(); }

export function planSupervisorStart({ services, pidRecords = [] }) {
  const result = { state: 'ready', starts: [], existing: [], warnings: [], blockers: [] };
  for (const service of services) {
    const occupant = service.occupant ?? null;
    if (occupant) {
      const expected = occupant.kind === service.kind && occupant.healthy === true && occupant.identity === service.identity;
      if (expected) result.existing.push({ kind: service.kind, port: service.port, pid: occupant.pid });
      else result.blockers.push({ code: 'port_owned_by_other_process', kind: service.kind, port: service.port, occupant });
      continue;
    }
    if (service.owned === false) {
      result.warnings.push({ code: 'optional_service_unavailable', kind: service.kind, port: service.port });
    } else {
      result.starts.push({ kind: service.kind, port: service.port, command: service.command, identity: service.identity });
    }
  }
  const stale = pidRecords.filter((record) => !services.some((service) => service.occupant?.pid === record.pid && service.occupant?.identity === record.identity));
  if (stale.length) result.warnings.push({ code: 'stale_pid_records', records: stale });
  if (result.blockers.length) result.state = 'blocked';
  else if (result.warnings.some((warning) => warning.code === 'optional_service_unavailable')) result.state = 'degraded';
  return result;
}

export function planOwnedStop({ startedRecords, liveProcesses }) {
  const stop = [], skipped = [];
  for (const record of startedRecords) {
    const live = liveProcesses.find((process) => process.pid === record.pid);
    if (live && live.identity === record.identity && live.commandHash === record.commandHash) stop.push(record);
    else skipped.push({ ...record, reason: 'ownership-not-proven' });
  }
  return { stop, skipped };
}

export function classifyHealth({ companion, sillyTavern, lmStudio }) {
  const problems = [];
  if (!companion?.http || !companion?.database || companion?.maintenance) problems.push('companion-not-ready');
  if (!sillyTavern?.http || !sillyTavern?.bridgeCompatible) problems.push('sillytavern-not-ready');
  const narrationReady = Boolean(lmStudio?.http && lmStudio?.modelReady);
  return {
    workspaceReady: !problems.length,
    narrationReady,
    state: problems.length ? 'unavailable' : narrationReady ? 'ready' : 'degraded',
    problems,
    warnings: narrationReady ? [] : ['lm-studio-unavailable'],
  };
}

export class CompatibilityUpdate {
  constructor({ currentPin, expectedPin }) {
    this.currentPin = currentPin;
    this.expectedPin = expectedPin;
    this.steps = [];
    this.active = currentPin;
    this.previous = null;
  }
  run({ workingTreeClean, stagedPin, checks = {}, failAt = null }) {
    if (!workingTreeClean) throw new OpsProblem('working_tree_dirty', 'Compatibility update requires a clean project tree.', ['commit-or-stash']);
    if (stagedPin !== this.expectedPin) throw new OpsProblem('st_pin_mismatch', 'Staged SillyTavern does not match the reviewed pin.', ['discard-stage']);
    const order = ['backup-database', 'backup-runtime', 'stage-runtime', 'install-bridge', 'run-tests', 'stop-owned-st', 'switch-runtime', 'start-smoke'];
    for (const step of order) {
      this.steps.push(step);
      if (failAt === step || checks[step] === false) {
        if (this.previous) { this.active = this.previous; this.steps.push('rollback-runtime'); }
        throw new OpsProblem('compatibility_update_failed', `Compatibility update failed at ${step}.`, ['inspect-log', 'use-fallback']);
      }
      if (step === 'switch-runtime') { this.previous = this.active; this.active = stagedPin; }
    }
    return { activePin: this.active, previousPin: this.previous, steps: clone(this.steps) };
  }
}

export class CutoverJournal {
  constructor(path) { this.path = path; this.state = { mode: 'fallback', checks: {}, history: [] }; }
  async load() {
    try { this.state = JSON.parse(await readFile(this.path, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    return clone(this.state);
  }
  async save() { await mkdir(dirname(this.path), { recursive: true }); await writeFile(this.path, JSON.stringify(this.state, null, 2)); }
  async mark(check, value = true) { this.state.checks[check] = value; this.state.history.push({ at: now(), action: 'check', check, value }); await this.save(); }
  async enterParallel() { this.state.mode = 'parallel'; this.state.history.push({ at: now(), action: 'parallel' }); await this.save(); }
  async cutover() {
    const required = ['validatedBackup', 'legacyImported', 'bindingMarker', 'workspaceJourney', 'linkedNarration', 'phoneJourney', 'fallbackVerified'];
    const missing = required.filter((check) => this.state.checks[check] !== true);
    if (missing.length) throw new OpsProblem('cutover_incomplete', 'Real-campaign cutover checks are incomplete.', ['complete-trace'], { missing });
    this.state.mode = 'companion'; this.state.history.push({ at: now(), action: 'cutover' }); await this.save(); return clone(this.state);
  }
  async fallback(reason = 'manual') {
    this.state.mode = 'fallback';
    this.state.history.push({ at: now(), action: 'fallback', reason });
    await this.save();
    return { mode: 'fallback', companionDataPreserved: true, legacyMetadataPreserved: true };
  }
}

export async function atomicReplaceFile(currentPath, stagedPath) {
  const previousPath = `${currentPath}.previous`;
  await rename(currentPath, previousPath);
  try { await rename(stagedPath, currentPath); return { currentPath, previousPath }; }
  catch (error) { await rename(previousPath, currentPath); throw error; }
}
