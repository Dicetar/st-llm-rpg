import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CompatibilityUpdate, CutoverJournal, classifyHealth, createOperationsStore,
  planOwnedStop, planSupervisorStart, reconcileAddonDirectory,
} from './prototype.mjs';

const ids = () => { let value = 0; return () => `id-${++value}`; };
const legacy = () => ({ campaign: {
  commitId: 'commit-7', revision: 7, title: 'Emberfall',
  records: [
    { id: 'pc', kind: 'actor', name: 'Seraphine' },
    { id: 'moon-key', kind: 'item', name: 'Moon Key' },
    { id: 'mara', kind: 'actor', name: 'Mara' },
  ],
  possessions: [{ id: 'p1', itemId: 'moon-key', ownerActorId: 'pc' }],
  learnedAbilities: [], relationships: [], currentScene: { id: 's1', title: 'Gate' }, sceneArchives: [],
  events: [{ id: 'e7', revision: 7 }],
} });

function importedStore() {
  const store = createOperationsStore({ id: ids() });
  const preview = store.previewLegacyImport({ envelope: legacy(), locator: 'chat:seraphine/main' });
  const applied = store.applyLegacyImport(preview);
  return { store, preview, applied };
}

test('legacy import is previewed, backed up, revision one, and leaves metadata preserved', () => {
  const store = createOperationsStore({ id: ids() });
  const preview = store.previewLegacyImport({ envelope: legacy(), locator: 'chat:seraphine/main' });
  assert.equal(preview.kind, 'new-import');
  assert.equal(preview.summary.legacyRevision, 7);
  const result = store.applyLegacyImport(preview);
  assert.equal(result.campaignRevision, 1);
  assert.equal(result.markerState, 'pending-chat-marker');
  assert.equal(result.legacyMetadataPreserved, true);
  assert.equal(store.events(result.campaignId)[0].kind, 'campaign-imported-from-legacy-metadata');
  assert.equal(store.backups().length, 1);
  store.close();
});

test('exact re-import opens existing and copied source requires a choice', () => {
  const { store, applied } = importedStore();
  const exact = store.previewLegacyImport({ envelope: legacy(), locator: 'chat:seraphine/main' });
  assert.equal(exact.kind, 'already-imported');
  assert.equal(exact.campaignId, applied.campaignId);
  const copy = store.previewLegacyImport({ envelope: legacy(), locator: 'chat:seraphine/copy' });
  assert.equal(copy.kind, 'copied-source');
  assert.deepEqual(copy.actions, ['link-existing', 'create-independent-import', 'cancel']);
  store.close();
});

test('stale legacy preview cannot be applied', () => {
  const store = createOperationsStore({ id: ids() });
  const preview = store.previewLegacyImport({ envelope: legacy(), locator: 'chat:a' });
  preview.campaign.records.push({ id: 'late', kind: 'fact' });
  assert.throws(() => store.applyLegacyImport(preview), (error) => error.code === 'legacy_preview_stale');
  assert.equal(store.backups().length, 0);
  store.close();
});

test('addon preview is additive and applies one revision after backup', () => {
  const { store, applied } = importedStore();
  const doc1 = { records: [{ externalId: 'item:rope', kind: 'item', name: 'Rope' }] };
  const first = store.previewAddon({ campaignId: applied.campaignId, sourcePath: 'items.json', document: doc1 });
  assert.equal(first.creates.length, 1);
  const result = store.applyAddon(first.candidateId, { manifestHash: first.manifestHash, expectedRevision: 1 });
  assert.equal(result.revision, 2);
  assert.equal(store.records(applied.campaignId).length, 1);
  assert.equal(store.events(applied.campaignId).at(-1).kind, 'addon-import-applied');
  assert.equal(store.backups().length, 2);
  const doc2 = { records: [] };
  const second = store.previewAddon({ campaignId: applied.campaignId, sourcePath: 'items.json', document: doc2 });
  assert.equal(second.creates.length + second.updates.length, 0);
  assert.equal(store.records(applied.campaignId).length, 1, 'removing addon rows must not delete Campaign records');
  store.close();
});

test('addon candidate rejects changed files and stale Campaign revision', () => {
  const { store, applied } = importedStore();
  const first = store.previewAddon({ campaignId: applied.campaignId, sourcePath: 'facts.json', document: { records: [{ externalId: 'f:1', kind: 'fact', proposition: 'A' }] } });
  assert.throws(() => store.applyAddon(first.candidateId, { manifestHash: 'changed', expectedRevision: 1 }), (error) => error.code === 'addon_candidate_stale');
  const second = store.previewAddon({ campaignId: applied.campaignId, sourcePath: 'facts.json', document: { records: [{ externalId: 'f:2', kind: 'fact', proposition: 'B' }] } });
  const third = store.previewAddon({ campaignId: applied.campaignId, sourcePath: 'facts2.json', document: { records: [{ externalId: 'f:3', kind: 'fact', proposition: 'C' }] } });
  store.applyAddon(second.candidateId, { manifestHash: second.manifestHash, expectedRevision: 1 });
  assert.throws(() => store.applyAddon(third.candidateId, { manifestHash: third.manifestHash, expectedRevision: 1 }), (error) => error.code === 'campaign_revision_conflict');
  store.close();
});

test('directory reconciliation converges after temp rename and reports malformed JSON', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'addons-'));
  try {
    await writeFile(join(dir, 'items.tmp'), JSON.stringify({ records: [{ externalId: 'i:1', kind: 'item' }] }));
    await rename(join(dir, 'items.tmp'), join(dir, 'items.json'));
    let scan = await reconcileAddonDirectory(dir);
    assert.equal(scan.files.length, 1);
    assert.equal(scan.errors.length, 0);
    await writeFile(join(dir, 'broken.json'), '{');
    scan = await reconcileAddonDirectory(dir);
    assert.equal(scan.files.length, 1);
    assert.equal(scan.errors[0].code, 'addon_json_malformed');
    await writeFile(join(dir, 'broken.json'), JSON.stringify({ records: [] }));
    scan = await reconcileAddonDirectory(dir);
    assert.equal(scan.files.length, 2);
    assert.equal(scan.errors.length, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('supervisor starts owned services, treats absent LM Studio as degraded, and blocks occupied ports', () => {
  const plan = planSupervisorStart({ services: [
    { kind: 'sillytavern', port: 8001, owned: true, command: 'node st/server.js', identity: 'st-pin' },
    { kind: 'companion', port: 8002, owned: true, command: 'node companion.js', identity: 'companion-v1' },
    { kind: 'lmstudio', port: 1234, owned: false, identity: 'lmstudio' },
  ], pidRecords: [{ pid: 99, identity: 'old' }] });
  assert.equal(plan.state, 'degraded');
  assert.equal(plan.starts.length, 2);
  assert.equal(plan.warnings.some((warning) => warning.code === 'stale_pid_records'), true);
  const blocked = planSupervisorStart({ services: [
    { kind: 'companion', port: 8002, owned: true, identity: 'companion-v1', occupant: { pid: 7, kind: 'other', identity: 'other', healthy: true } },
  ] });
  assert.equal(blocked.state, 'blocked');
});

test('supervisor stops only processes whose identity still matches', () => {
  const result = planOwnedStop({
    startedRecords: [
      { pid: 10, identity: 'st', commandHash: 'a' },
      { pid: 11, identity: 'companion', commandHash: 'b' },
    ],
    liveProcesses: [
      { pid: 10, identity: 'st', commandHash: 'a' },
      { pid: 11, identity: 'reused-pid', commandHash: 'b' },
    ],
  });
  assert.deepEqual(result.stop.map((entry) => entry.pid), [10]);
  assert.deepEqual(result.skipped.map((entry) => entry.pid), [11]);
});

test('Workspace can remain ready while LM Studio is absent', () => {
  const health = classifyHealth({
    companion: { http: true, database: true, maintenance: false },
    sillyTavern: { http: true, bridgeCompatible: true },
    lmStudio: { http: false, modelReady: false },
  });
  assert.equal(health.state, 'degraded');
  assert.equal(health.workspaceReady, true);
  assert.equal(health.narrationReady, false);
});

test('compatibility update switches staged pin and rolls back after post-switch failure', () => {
  const ok = new CompatibilityUpdate({ currentPin: 'old', expectedPin: 'new' });
  assert.equal(ok.run({ workingTreeClean: true, stagedPin: 'new' }).activePin, 'new');
  const failed = new CompatibilityUpdate({ currentPin: 'old', expectedPin: 'new' });
  assert.throws(() => failed.run({ workingTreeClean: true, stagedPin: 'new', failAt: 'start-smoke' }), (error) => error.code === 'compatibility_update_failed');
  assert.equal(failed.active, 'old');
  assert.equal(failed.steps.at(-1), 'rollback-runtime');
});

test('cutover requires full real-campaign trace and fallback preserves both stores', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cutover-'));
  try {
    const journal = new CutoverJournal(join(dir, 'cutover.json'));
    await journal.load();
    await journal.enterParallel();
    await journal.mark('validatedBackup');
    await journal.mark('legacyImported');
    assert.rejects(() => journal.cutover(), (error) => error.code === 'cutover_incomplete' && error.details.missing.includes('phoneJourney'));
    for (const check of ['bindingMarker', 'workspaceJourney', 'linkedNarration', 'phoneJourney', 'fallbackVerified']) await journal.mark(check);
    assert.equal((await journal.cutover()).mode, 'companion');
    const fallback = await journal.fallback('test');
    assert.equal(fallback.companionDataPreserved, true);
    assert.equal(fallback.legacyMetadataPreserved, true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
