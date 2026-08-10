import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import type {
  LegacyChatLocator,
  NarratorModelProfile,
} from '@st-llm-rpg/wire';
import { encodeNarrationExchange, PINNED_SILLYTAVERN_REVISION } from '@st-llm-rpg/wire';
import { SqliteCampaignJournal } from '../src/adapters/sqlite/campaign-journal.js';
import { buildCompanion } from '../src/app.js';
import { readCompanionConfig } from '../src/config.js';
import { ContextPlanner } from '../src/modules/context/context-planner.js';
import {
  LegacyImportService,
  type LegacyChatSnapshot,
  type LegacyChatSource,
} from '../src/modules/legacy-import/legacy-import-service.js';
import { acceptCampaignOperation } from './campaign-test-helpers.js';

const locator: LegacyChatLocator = {
  kind: 'character',
  chatId: 'Context Index',
  avatar: 'Narrator.png',
};

class ContextLegacySource implements LegacyChatSource {
  async list() {
    return [{
      locator,
      title: locator.chatId,
      fileSize: '2 KB',
      messageCount: 4,
      lastModified: '2026-08-09T12:00:00.000Z',
      hasLegacyCampaign: true,
      legacyRevision: 4,
    }];
  }

  async read(): Promise<LegacyChatSnapshot> {
    return {
      locator,
      sourceContentFingerprint: 'a'.repeat(64),
      envelope: {
        envelopeVersion: 1,
        campaign: {
          schemaVersion: 1,
          instanceId: 'legacy-context',
          commitId: 'legacy-context-4',
          revision: 4,
          title: 'Wardrobe Campaign',
          records: [
            {
              id: 'item-wardrobe',
              kind: 'item',
              name: 'Heirloom Wardrobe',
              summary: 'Ancient red mahogany with silver draconic filigree.',
              archivedAt: null,
            },
          ],
          possessions: [],
          learnedAbilities: [],
          relationships: [],
          sceneArchives: [],
          proposals: [],
          currentScene: {
            id: 'scene-bedroom',
            title: 'Childhood Bedroom',
            summary: 'The old furniture waits in silence.',
          },
        },
      },
    };
  }

  async writeMarker() {
    return { verified: true as const, legacyMetadataPreserved: true as const };
  }
}

const profile: NarratorModelProfile = {
  id: 'profile-context-test',
  modelId: 'mistralai/mistral-nemo-instruct-2407',
  contextWindowTokens: 16_384,
  requestedVisibleOutputTokens: 2_048,
  safetyMarginTokens: 1_024,
  maxCampaignTokens: 4_096,
  maxAutomaticRecords: 10,
  maxRelationExpansions: 4,
};

test('SQLite Context source plans against an imported Campaign revision through FTS5', async t => {
  const root = await mkdtemp(join(tmpdir(), 'st-rpg-context-sqlite-'));
  const journal = await SqliteCampaignJournal.open(join(root, 'campaigns.sqlite'));
  t.after(async () => {
    await journal.close();
    await rm(root, { recursive: true, force: true });
  });
  const service = new LegacyImportService(journal, new ContextLegacySource(), join(root, 'backups'));
  const preview = await service.preview(locator, 'context-preview');
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  const imported = await service.apply({
    requestId: 'context-import',
    locator,
    sourceFingerprint: preview.value.sourceFingerprint,
    decision: 'create-campaign',
  });
  assert.equal(imported.ok, true);
  if (!imported.ok) return;

  await journal.saveNarratorModelProfile(profile);
  const planner = new ContextPlanner(journal);
  const outcome = await planner.plan({
    requestId: 'context-sqlite-plan',
    campaignId: imported.value.campaignId,
    campaignRevision: 1,
    bindingId: imported.value.binding.id,
    bindingRevision: imported.value.binding.revision,
    contextFocusRevision: 1,
    modelProfileId: profile.id,
    generationType: 'normal',
    messages: [{ role: 'user', content: 'I inspect the ancient mahogany panels.' }],
  }, new AbortController().signal);

  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(
    outcome.value.selections.some(selection => selection.tier === 'fts5' && selection.recordId === 'item-wardrobe'),
    true,
  );
  const lexicalHits = await journal.search({
    campaignId: imported.value.campaignId,
    campaignRevision: 1,
    query: 'mahogany hog',
    limit: 16,
  });
  assert.equal(lexicalHits.find(hit => hit.recordId === 'item-wardrobe')?.matchedTerms, 1);
});

test('V4 authority verifies, backs up, and migrates before Context columns are read', async t => {
  const root = await mkdtemp(join(tmpdir(), 'st-rpg-context-v4-upgrade-'));
  const databasePath = join(root, 'campaigns.sqlite');
  let journal = await SqliteCampaignJournal.open(databasePath);
  t.after(async () => {
    try { await journal.close(); } catch { /* already closed after the assertion path */ }
    await rm(root, { recursive: true, force: true });
  });
  const service = new LegacyImportService(journal, new ContextLegacySource(), join(root, 'backups'));
  const preview = await service.preview(locator, 'v4-upgrade-preview');
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  const imported = await service.apply({
    requestId: 'v4-upgrade-import',
    locator,
    sourceFingerprint: preview.value.sourceFingerprint,
    decision: 'create-campaign',
  });
  assert.equal(imported.ok, true);
  if (!imported.ok) return;
  await journal.close();

  const database = new DatabaseSync(databasePath);
  database.exec(`
    DROP TABLE context_search_fts;
    DROP TABLE narrator_model_profiles;
    ALTER TABLE chat_bindings DROP COLUMN context_focus_revision;
    ALTER TABLE chat_bindings DROP COLUMN pins_json;
    ALTER TABLE campaign_actor_projections DROP COLUMN aliases_json;
    ALTER TABLE campaign_actor_projections DROP COLUMN visibility;
    ALTER TABLE campaign_item_projections DROP COLUMN aliases_json;
    ALTER TABLE campaign_item_projections DROP COLUMN visibility;
    ALTER TABLE campaign_quest_projections DROP COLUMN aliases_json;
    ALTER TABLE campaign_quest_projections DROP COLUMN visibility;
    ALTER TABLE campaign_place_projections DROP COLUMN aliases_json;
    ALTER TABLE campaign_place_projections DROP COLUMN visibility;
    ALTER TABLE campaign_scene_projections DROP COLUMN place_id;
    ALTER TABLE campaign_scene_projections DROP COLUMN actor_ids_json;
    ALTER TABLE campaign_scene_projections DROP COLUMN item_ids_json;
    DELETE FROM schema_migrations WHERE version = 5;
  `);
  database.close();

  journal = await SqliteCampaignJournal.open(databasePath);
  assert.equal((await journal.readCampaign(imported.value.campaignId)).campaign.revision, 1);
  await journal.close();
  assert.equal((await readdir(root)).some(name => name.startsWith('campaigns.sqlite.pre-migration-v5-')), true);
});

test('ordered Context pins survive restart as Binding history and drive later plans', async t => {
  const root = await mkdtemp(join(tmpdir(), 'st-rpg-context-pins-'));
  const databasePath = join(root, 'campaigns.sqlite');
  let journal = await SqliteCampaignJournal.open(databasePath);
  t.after(async () => {
    await journal.close();
    await rm(root, { recursive: true, force: true });
  });
  const service = new LegacyImportService(journal, new ContextLegacySource(), join(root, 'backups'));
  const preview = await service.preview(locator, 'pins-preview');
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  const imported = await service.apply({
    requestId: 'pins-import',
    locator,
    sourceFingerprint: preview.value.sourceFingerprint,
    decision: 'create-campaign',
  });
  assert.equal(imported.ok, true);
  if (!imported.ok) return;

  const pinned = await journal.setContextPins({
    requestId: 'pins-update',
    eventId: 'pins-event',
    bindingId: imported.value.binding.id,
    expectedBindingRevision: imported.value.binding.revision,
    expectedContextFocusRevision: 1,
    pins: ['item-wardrobe'],
  });
  assert.deepEqual(
    { revision: pinned.revision, focus: pinned.contextFocusRevision, pins: pinned.pins },
    { revision: 3, focus: 2, pins: ['item-wardrobe'] },
  );

  await journal.close();
  journal = await SqliteCampaignJournal.open(databasePath);
  await journal.saveNarratorModelProfile(profile);
  const reopened = await journal.readBinding(imported.value.binding.id);
  const outcome = await new ContextPlanner(journal).plan({
    requestId: 'pins-plan',
    campaignId: imported.value.campaignId,
    campaignRevision: 1,
    bindingId: reopened.id,
    bindingRevision: reopened.revision,
    contextFocusRevision: reopened.contextFocusRevision ?? 1,
    modelProfileId: profile.id,
    generationType: 'normal',
    messages: [{ role: 'user', content: 'I wait in silence.' }],
  }, new AbortController().signal);

  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.value.selections[1]?.tier, 'manual-pin');
  assert.equal(outcome.value.selections[1]?.recordId, 'item-wardrobe');
});

test('Campaign Private updates disappear from the next revision FTS index', async t => {
  const root = await mkdtemp(join(tmpdir(), 'st-rpg-context-private-'));
  const journal = await SqliteCampaignJournal.open(join(root, 'campaigns.sqlite'));
  t.after(async () => {
    await journal.close();
    await rm(root, { recursive: true, force: true });
  });
  const service = new LegacyImportService(journal, new ContextLegacySource(), join(root, 'backups'));
  const preview = await service.preview(locator, 'private-preview');
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  const imported = await service.apply({
    requestId: 'private-import',
    locator,
    sourceFingerprint: preview.value.sourceFingerprint,
    decision: 'create-campaign',
  });
  assert.equal(imported.ok, true);
  if (!imported.ok) return;

  const hidden = await acceptCampaignOperation(journal, imported.value.campaignId, {
    requestId: 'private-item-update',
    expectedRevision: 1,
    operation: {
      kind: 'update_item',
      itemId: 'item-wardrobe',
      name: 'Heirloom Wardrobe',
      aliases: ['ancient cabinet'],
      summary: 'Ancient red mahogany with silver draconic filigree.',
      visibility: 'campaign_private',
    },
  });
  assert.equal(hidden.document.items[0]?.visibility, 'campaign_private');
  assert.deepEqual(hidden.document.items[0]?.aliases, ['ancient cabinet']);
  assert.deepEqual(await journal.search({
    campaignId: imported.value.campaignId,
    campaignRevision: 2,
    query: 'ancient mahogany',
    limit: 16,
  }), []);
});

test('Context HTTP boundary saves a profile and pins before returning an inspectable plan', async t => {
  const root = await mkdtemp(join(tmpdir(), 'st-rpg-context-http-'));
  const workspaceRoot = join(root, 'workspace');
  await mkdir(join(workspaceRoot, 'assets'), { recursive: true });
  await writeFile(join(workspaceRoot, 'index.html'), '<!doctype html><div id="root"></div>');
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
  const upstreamCalls: Array<Readonly<Record<string, unknown>>> = [];
  const app = await buildCompanion({
    config,
    legacyChatSource: new ContextLegacySource(),
    lmStudioGateway: {
      models: async () => new Response('{"data":[]}'),
      chat: async request => {
        upstreamCalls.push(structuredClone(request));
        return new Response(JSON.stringify({
          id: 'chatcmpl-sqlite', object: 'chat.completion', created: 1, model: profile.modelId,
          choices: [{ index: 0, message: { role: 'assistant', content: 'The wardrobe waits.' }, finish_reason: 'stop' }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    },
  });
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  const preview = await app.inject({
    method: 'POST',
    url: '/api/migrations/legacy-preview',
    payload: { locator },
  });
  const imported = await app.inject({
    method: 'POST',
    url: '/api/migrations/legacy-import',
    payload: {
      requestId: 'context-http-import',
      locator,
      sourceFingerprint: preview.json().sourceFingerprint,
      decision: 'create-campaign',
    },
  });
  assert.equal(imported.statusCode, 201, imported.body);

  const savedProfile = await app.inject({
    method: 'PUT',
    url: `/api/narrator-model-profiles/${profile.id}`,
    payload: profile,
  });
  assert.equal(savedProfile.statusCode, 200, savedProfile.body);

  const pinUpdate = await app.inject({
    method: 'PUT',
    url: `/api/chat-bindings/${imported.json().binding.id}/context-pins`,
    payload: {
      requestId: 'context-http-pins',
      eventId: 'context-http-pins-event',
      expectedBindingRevision: imported.json().binding.revision,
      expectedContextFocusRevision: 1,
      pins: ['item-wardrobe'],
    },
  });
  assert.equal(pinUpdate.statusCode, 200, pinUpdate.body);

  const planPayload = {
    requestId: 'context-http-plan',
    campaignId: imported.json().campaignId,
    campaignRevision: 1,
    bindingId: imported.json().binding.id,
    bindingRevision: pinUpdate.json().revision,
    contextFocusRevision: pinUpdate.json().contextFocusRevision,
    modelProfileId: profile.id,
    generationType: 'normal',
    messages: [{ role: 'user', content: 'I wait in silence.' }],
  };
  const plan = await app.inject({
    method: 'POST',
    url: '/api/context-plans',
    payload: planPayload,
  });
  assert.equal(plan.statusCode, 200, plan.body);
  assert.equal(plan.json().selections[1].tier, 'manual-pin');
  assert.equal(plan.json().selections[1].recordId, 'item-wardrobe');

  const exchange = encodeNarrationExchange({
    protocol: 'st-rpg.narration', version: 1,
    requestId: '2b8ba8c6-46d9-4a3f-a75f-0cf8b413998a',
    route: { kind: 'linked', bindingId: imported.json().binding.id },
    generation: 'normal',
    locator: {
      version: 1, hostId: 'context-test-host',
      chat: { kind: 'character', ownerId: locator.avatar, chatId: locator.chatId },
    },
    bridge: { version: '0.2.0', sillyTavernRevision: PINNED_SILLYTAVERN_REVISION },
  });
  const narration = await app.inject({
    method: 'POST', url: '/v1/chat/completions',
    headers: { 'x-st-rpg-exchange': exchange },
    payload: {
      model: profile.modelId, stream: true,
      messages: [
        { role: 'system', content: 'Narrate.' },
        { role: 'user', content: 'I wait in silence.' },
      ],
    },
  });
  assert.equal(narration.statusCode, 200, narration.body);
  assert.match(narration.body, /The wardrobe waits\./);
  assert.equal(upstreamCalls.length, 1);
  const upstreamMessages = upstreamCalls[0]?.messages as Array<{ role: string; content: string }>;
  assert.equal(upstreamCalls[0]?.stream, false);
  assert.equal(upstreamMessages.some(message => message.content.includes('Heirloom Wardrobe')), true);

  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  assert(address && typeof address === 'object');
  const networkPlan = await fetch(`http://127.0.0.1:${address.port}/api/context-plans`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...planPayload,
      requestId: 'context-http-real-network-plan',
    }),
  });
  assert.equal(networkPlan.status, 200, await networkPlan.text());
});
