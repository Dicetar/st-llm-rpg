import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import type { LegacyChatLocator } from '@st-llm-rpg/wire';
import { SqliteCampaignJournal } from '../src/adapters/sqlite/campaign-journal.js';
import { buildCompanion } from '../src/app.js';
import { readCompanionConfig } from '../src/config.js';
import { inspectLegacyEnvelope } from '../src/modules/legacy-import/legacy-envelope.js';
import {
  LegacyImportService,
  type LegacyChatSnapshot,
  type LegacyChatSource,
} from '../src/modules/legacy-import/legacy-import-service.js';

function legacyEnvelope() {
  return {
    envelopeVersion: 1,
    campaign: {
      schemaVersion: 1,
      instanceId: 'legacy-campaign',
      commitId: 'legacy-commit-7',
      revision: 7,
      title: 'Emberfall',
      playerCharacterId: 'actor-player',
      records: [
        { id: 'actor-player', kind: 'actor', name: 'Seraphine', summary: 'A careful mage.', archivedAt: null },
        { id: 'actor-mara', kind: 'actor', name: 'Mara', summary: 'A guarded witness.', archivedAt: null },
        { id: 'item-key', kind: 'item', name: 'Moon Key', summary: 'Opens the silver gate.', archivedAt: null },
        { id: 'quest-gate', kind: 'quest', name: 'Open the Gate', summary: 'Find the gate.', status: 'active', archivedAt: null },
        { id: 'place-gate', kind: 'place', name: 'Silver Gate', summary: 'An old sealed arch.', archivedAt: null },
        { id: 'ability-hand', kind: 'ability', name: 'Mage Hand', summary: 'Moves light objects.', archivedAt: null },
      ],
      possessions: [{ id: 'possession-key', itemId: 'item-key', ownerActorId: 'actor-player' }],
      learnedAbilities: [{ id: 'learned-hand', abilityId: 'ability-hand', actorId: 'actor-player' }],
      relationships: [{ id: 'relationship-mara', sourceActorId: 'actor-player', targetActorId: 'actor-mara' }],
      sceneArchives: [],
      proposals: [],
      currentScene: { id: 'scene-gate', title: 'At the Gate', summary: 'The seal is weakening.' },
    },
  };
}

test('legacy envelope inspection projects supported truth and reports preserved unsupported data', () => {
  const inspected = inspectLegacyEnvelope(legacyEnvelope(), new Date('2026-08-09T12:00:00.000Z'));
  assert.equal(inspected.valid, true);
  assert.equal(inspected.title, 'Emberfall');
  assert.equal(inspected.legacyRevision, 7);
  assert.deepEqual(inspected.counts, { actors: 2, items: 1, quests: 1, places: 1, unsupported: 3 });
  assert.equal(inspected.state?.actors['actor-player']?.name, 'Seraphine');
  assert.equal(inspected.state?.items['item-key']?.ownerActorId, 'actor-player');
  assert.equal(inspected.state?.currentScene?.name, 'At the Gate');
  assert.equal(inspected.issues.some(issue => issue.code === 'unsupported-record-kind'), true);
  assert.equal(inspected.issues.some(issue => issue.code === 'unsupported-relationship'), true);
});

test('malformed legacy envelope produces a previewable validation report instead of partial state', () => {
  const inspected = inspectLegacyEnvelope({ envelopeVersion: 1, campaign: { revision: 2, records: 'wrong' } });
  assert.equal(inspected.valid, false);
  assert.equal(inspected.state, null);
  assert.equal(inspected.issues.some(issue => issue.severity === 'error'), true);
});

const firstLocator: LegacyChatLocator = { kind: 'character', chatId: 'Emberfall - 1', avatar: 'Seraphine.png' };

class FakeLegacySource implements LegacyChatSource {
  envelope: unknown = legacyEnvelope();
  markerFailure = '';
  readonly markers: unknown[] = [];

  async list() {
    return [{
      locator: firstLocator,
      title: firstLocator.chatId,
      fileSize: '4 KB',
      messageCount: 12,
      lastModified: '2026-08-09T12:00:00.000Z',
      hasLegacyCampaign: true,
      legacyRevision: 7,
    }];
  }

  async read(locator: LegacyChatLocator): Promise<LegacyChatSnapshot> {
    return { locator, envelope: structuredClone(this.envelope) };
  }

  async writeMarker(_snapshot: LegacyChatSnapshot, marker: unknown) {
    if (this.markerFailure) throw new Error(this.markerFailure);
    this.markers.push(structuredClone(marker));
    return { verified: true as const, legacyMetadataPreserved: true as const };
  }
}

test('legacy import backs up, commits Campaign and Binding atomically, verifies marker, and reimports idempotently', async t => {
  const root = await mkdtemp(join(tmpdir(), 'st-rpg-legacy-import-'));
  const databasePath = join(root, 'campaigns.sqlite');
  const journal = await SqliteCampaignJournal.open(databasePath);
  const source = new FakeLegacySource();
  const service = new LegacyImportService(journal, source, join(root, 'backups'));
  t.after(async () => {
    await journal.close();
    await rm(root, { recursive: true, force: true });
  });

  const preview = await service.preview(firstLocator, 'preview-1');
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  assert.equal(preview.value.kind, 'new-import');

  const applied = await service.apply({
    requestId: 'legacy-import-1',
    locator: firstLocator,
    sourceFingerprint: preview.value.sourceFingerprint,
    decision: 'create-campaign',
  });
  assert.equal(applied.ok, true);
  if (!applied.ok) return;
  assert.equal(applied.value.kind, 'imported');
  assert.equal(applied.value.campaignRevision, 1);
  assert.equal(applied.value.binding.revision, 2);
  assert.equal(applied.value.binding.markerState, 'verified');
  assert.equal(source.markers.length, 1);
  assert.equal(journal.readCampaign(applied.value.campaignId).actors.length, 2);
  assert.equal((await journal.listBindings(applied.value.campaignId))[0]?.id, applied.value.binding.id);
  assert.equal(journal.history(applied.value.campaignId)[0]?.operationKind, 'import_legacy_campaign');
  assert.equal((await readdir(join(root, 'backups'))).filter(file => file.endsWith('.sqlite')).length, 1);

  const exact = await service.apply({
    requestId: 'legacy-import-2',
    locator: firstLocator,
    sourceFingerprint: preview.value.sourceFingerprint,
    decision: 'create-campaign',
  });
  assert.equal(exact.ok, true);
  if (!exact.ok) return;
  assert.equal(exact.value.kind, 'already-imported');
  assert.equal(exact.value.campaignId, applied.value.campaignId);
  assert.equal(journal.listCampaigns().length, 1);
  assert.equal((await readdir(join(root, 'backups'))).filter(file => file.endsWith('.sqlite')).length, 1);
});

test('marker failure leaves an inspectable blocked Binding without losing the imported Campaign', async t => {
  const root = await mkdtemp(join(tmpdir(), 'st-rpg-marker-blocked-'));
  const journal = await SqliteCampaignJournal.open(join(root, 'campaigns.sqlite'));
  const source = new FakeLegacySource();
  source.markerFailure = 'SillyTavern rejected the marker write';
  const service = new LegacyImportService(journal, source, join(root, 'backups'));
  t.after(async () => {
    await journal.close();
    await rm(root, { recursive: true, force: true });
  });

  const preview = await service.preview(firstLocator, 'preview-marker');
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  const applied = await service.apply({
    requestId: 'legacy-marker-failure', locator: firstLocator,
    sourceFingerprint: preview.value.sourceFingerprint, decision: 'create-campaign',
  });
  assert.equal(applied.ok, true);
  if (!applied.ok) return;
  assert.equal(applied.value.binding.markerState, 'blocked');
  assert.equal(applied.value.binding.revision, 2);
  assert.match(applied.value.binding.markerProblem ?? '', /rejected the marker write/);
  assert.equal(journal.readCampaign(applied.value.campaignId).campaign.revision, 1);
  source.markerFailure = '';
  const retried = await service.retryMarker(applied.value.binding.id, 'retry-marker');
  assert.equal(retried.ok, true);
  if (retried.ok) {
    assert.equal(retried.value.markerState, 'verified');
    assert.equal(retried.value.revision, 3);
  }
});

test('legacy migration HTTP boundary lists, previews, imports, and exposes Binding state', async t => {
  const root = await mkdtemp(join(tmpdir(), 'st-rpg-legacy-http-'));
  const workspaceRoot = join(root, 'workspace');
  await mkdir(join(workspaceRoot, 'assets'), { recursive: true });
  await writeFile(join(workspaceRoot, 'index.html'), '<!doctype html><div id="root"></div>');
  const source = new FakeLegacySource();
  const config = readCompanionConfig({
    RPG_COMPANION_HOST: '127.0.0.1',
    RPG_COMPANION_PORT: '8002',
    RPG_WORKSPACE_DIST: workspaceRoot,
    RPG_DATABASE_PATH: join(root, 'campaigns.sqlite'),
    RPG_ADDON_DIRECTORY: join(root, 'campaign-content'),
    RPG_SILLYTAVERN_URL: 'http://127.0.0.1:8001',
    RPG_LM_STUDIO_URL: 'http://127.0.0.1:1234/v1',
    RPG_LOG_LEVEL: 'silent',
  });
  const app = await buildCompanion({ config, legacyChatSource: source });
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  const chats = await app.inject({ method: 'GET', url: '/api/migrations/legacy-chats' });
  assert.equal(chats.statusCode, 200, chats.body);
  assert.equal(chats.json()[0].legacyRevision, 7);
  const preview = await app.inject({
    method: 'POST', url: '/api/migrations/legacy-preview', payload: { locator: firstLocator },
  });
  assert.equal(preview.statusCode, 200, preview.body);
  assert.equal(preview.json().kind, 'new-import');
  const applied = await app.inject({
    method: 'POST', url: '/api/migrations/legacy-import',
    payload: {
      requestId: 'http-legacy-import', locator: firstLocator,
      sourceFingerprint: preview.json().sourceFingerprint, decision: 'create-campaign',
    },
  });
  assert.equal(applied.statusCode, 201, applied.body);
  assert.equal(applied.json().binding.markerState, 'verified');
  const binding = await app.inject({
    method: 'GET', url: `/api/chat-bindings/${applied.json().binding.id}`,
  });
  assert.equal(binding.statusCode, 200, binding.body);
  assert.equal(binding.json().campaignId, applied.json().campaignId);
  const campaignBindings = await app.inject({
    method: 'GET', url: `/api/campaigns/${applied.json().campaignId}/chat-bindings`,
  });
  assert.equal(campaignBindings.statusCode, 200, campaignBindings.body);
  assert.equal(campaignBindings.json()[0].id, applied.json().binding.id);
  const missingRetry = await app.inject({
    method: 'POST', url: '/api/chat-bindings/missing-binding/retry-marker',
  });
  assert.equal(missingRetry.statusCode, 404, missingRetry.body);
  assert.equal(missingRetry.json().code, 'CHAT_BINDING_NOT_FOUND');
});

test('changed and copied sources require current explicit choices', async t => {
  const root = await mkdtemp(join(tmpdir(), 'st-rpg-legacy-collision-'));
  const journal = await SqliteCampaignJournal.open(join(root, 'campaigns.sqlite'));
  const source = new FakeLegacySource();
  const service = new LegacyImportService(journal, source, join(root, 'backups'));
  t.after(async () => {
    await journal.close();
    await rm(root, { recursive: true, force: true });
  });

  const first = await service.preview(firstLocator, 'preview-first');
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const imported = await service.apply({
    requestId: 'import-first', locator: firstLocator,
    sourceFingerprint: first.value.sourceFingerprint, decision: 'create-campaign',
  });
  assert.equal(imported.ok, true);
  if (!imported.ok) return;

  const copiedLocator: LegacyChatLocator = { kind: 'character', chatId: 'Emberfall - copy', avatar: 'Seraphine.png' };
  const copied = await service.preview(copiedLocator, 'preview-copy');
  assert.equal(copied.ok, true);
  if (!copied.ok) return;
  assert.equal(copied.value.kind, 'copied-source');
  assert.deepEqual(copied.value.decisions, ['link-existing', 'create-independent-import', 'cancel']);
  const invalidChoice = await service.apply({
    requestId: 'copy-implicit', locator: copiedLocator,
    sourceFingerprint: copied.value.sourceFingerprint, decision: 'create-campaign',
  });
  assert.equal(invalidChoice.ok, false);
  if (!invalidChoice.ok) assert.equal(invalidChoice.problem.code, 'LEGACY_IMPORT_COLLISION');
  assert.equal(journal.listCampaigns().length, 1);

  const linked = await service.apply({
    requestId: 'copy-link', locator: copiedLocator,
    sourceFingerprint: copied.value.sourceFingerprint, decision: 'link-existing',
  });
  assert.equal(linked.ok, true);
  if (!linked.ok) return;
  assert.equal(linked.value.kind, 'linked-existing');
  assert.equal(linked.value.campaignId, imported.value.campaignId);
  assert.equal(journal.history(imported.value.campaignId).length, 1, 'Binding work must not create a Campaign Event');

  const stalePreview = await service.preview({ ...firstLocator, chatId: 'changed-source' }, 'preview-stale');
  assert.equal(stalePreview.ok, true);
  if (!stalePreview.ok) return;
  source.envelope = { ...legacyEnvelope(), campaign: { ...legacyEnvelope().campaign, title: 'Changed after preview' } };
  const stale = await service.apply({
    requestId: 'stale-source', locator: { ...firstLocator, chatId: 'changed-source' },
    sourceFingerprint: stalePreview.value.sourceFingerprint, decision: 'create-independent-import',
  });
  assert.equal(stale.ok, false);
  if (!stale.ok) assert.equal(stale.problem.code, 'LEGACY_IMPORT_STALE');
  assert.equal(journal.listCampaigns().length, 1);
});

test('failed atomic import leaves neither Campaign nor Binding', async t => {
  const root = await mkdtemp(join(tmpdir(), 'st-rpg-legacy-atomic-'));
  const journal = await SqliteCampaignJournal.open(join(root, 'campaigns.sqlite'), {
    faultInjector: point => {
      if (point === 'create.after-event') throw new Error('injected legacy import failure');
    },
  });
  const source = new FakeLegacySource();
  const service = new LegacyImportService(journal, source, join(root, 'backups'));
  t.after(async () => {
    await journal.close();
    await rm(root, { recursive: true, force: true });
  });
  const preview = await service.preview(firstLocator, 'preview-atomic');
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  const applied = await service.apply({
    requestId: 'atomic-failure', locator: firstLocator,
    sourceFingerprint: preview.value.sourceFingerprint, decision: 'create-campaign',
  });
  assert.equal(applied.ok, false);
  assert.equal(journal.listCampaigns().length, 0);
  await assert.rejects(journal.readBinding('binding-does-not-exist'));
  assert.equal(source.markers.length, 0);
});

test('startup rejects a Chat Binding whose immutable history was damaged', async () => {
  const root = await mkdtemp(join(tmpdir(), 'st-rpg-binding-corrupt-'));
  const databasePath = join(root, 'campaigns.sqlite');
  const journal = await SqliteCampaignJournal.open(databasePath);
  const source = new FakeLegacySource();
  const service = new LegacyImportService(journal, source, join(root, 'backups'));
  try {
    const preview = await service.preview(firstLocator, 'preview-corrupt-binding');
    assert.equal(preview.ok, true);
    if (!preview.ok) return;
    const applied = await service.apply({
      requestId: 'import-corrupt-binding', locator: firstLocator,
      sourceFingerprint: preview.value.sourceFingerprint, decision: 'create-campaign',
    });
    assert.equal(applied.ok, true);
    await journal.close();

    const database = new DatabaseSync(databasePath);
    database.exec('PRAGMA foreign_keys = ON;');
    database.prepare('DELETE FROM chat_binding_events').run();
    database.close();

    await assert.rejects(
      SqliteCampaignJournal.open(databasePath),
      /Chat Binding .* history revision count failed/,
    );
  } finally {
    await journal.close();
    await rm(root, { recursive: true, force: true });
  }
});
