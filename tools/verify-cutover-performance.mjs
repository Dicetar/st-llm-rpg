import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { buildCompanion } from '../apps/companion/dist/app.js';
import { readCompanionConfig } from '../apps/companion/dist/config.js';
import {
  PINNED_SILLYTAVERN_REVISION,
  encodeNarrationExchange,
} from '../packages/wire/dist/index.js';

const projectRoot = resolve(import.meta.dirname, '..');
const iterationsArgument = process.argv.find(argument => argument.startsWith('--iterations='));
const outputArgument = process.argv.find(argument => argument.startsWith('--output='));
const iterations = Number(iterationsArgument?.split('=', 2)[1] ?? 100);
const outputPath = resolve(
  projectRoot,
  outputArgument?.split('=', 2)[1] ?? '.runtime/verification/cutover-performance.json',
);

if (!Number.isInteger(iterations) || iterations < 20 || iterations > 1_000) {
  throw new Error('--iterations must be an integer from 20 through 1000.');
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index];
}

function summary(values, targetMs) {
  return {
    sampleCount: values.length,
    p50Ms: Number(percentile(values, 0.5).toFixed(4)),
    p95Ms: Number(percentile(values, 0.95).toFixed(4)),
    maxMs: Number(Math.max(...values).toFixed(4)),
    targetMs,
  };
}

async function jsonRequest(baseUrl, method, path, body, headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${path} returned HTTP ${response.status}: ${text.slice(0, 1_000)}`);
  }
  return { response, text, json: text ? JSON.parse(text) : null };
}

const locator = {
  kind: 'character',
  chatId: 'Cutover Performance Fixture',
  avatar: 'Performance-Narrator.png',
};

class IsolatedLegacySource {
  async list() {
    return [{
      locator,
      title: locator.chatId,
      fileSize: '2 KB',
      messageCount: 2,
      lastModified: '2026-08-10T00:00:00.000Z',
      hasLegacyCampaign: true,
      legacyRevision: 1,
    }];
  }

  async read() {
    return {
      locator,
      sourceContentFingerprint: 'a'.repeat(64),
      envelope: {
        envelopeVersion: 1,
        campaign: {
          schemaVersion: 1,
          instanceId: 'cutover-performance-fixture',
          commitId: 'cutover-performance-fixture-1',
          revision: 1,
          title: 'Cutover Performance Fixture',
          records: [{
            id: 'item-heirloom-wardrobe',
            kind: 'item',
            name: 'Heirloom Wardrobe',
            summary: 'Ancient red mahogany with silver draconic filigree.',
            archivedAt: null,
          }],
          possessions: [],
          learnedAbilities: [],
          relationships: [],
          sceneArchives: [],
          proposals: [],
          currentScene: {
            id: 'scene-childhood-bedroom',
            title: 'Childhood Bedroom',
            summary: 'The heirloom wardrobe dominates the quiet room.',
          },
        },
      },
    };
  }

  async writeMarker() {
    return { verified: true, legacyMetadataPreserved: true };
  }
}

const runId = randomUUID();
const runtimeRoot = resolve(projectRoot, '.runtime', 'verification', `cutover-performance-${runId}`);
const profile = {
  id: 'cutover-performance-model',
  modelId: 'cutover-performance-model',
  contextWindowTokens: 32_768,
  requestedVisibleOutputTokens: 1_024,
  safetyMarginTokens: 512,
  maxCampaignTokens: 4_096,
  maxAutomaticRecords: 20,
  maxRelationExpansions: 8,
};

let activeNarrationStartedAt = null;
const preModelDurations = [];
let upstreamCalls = 0;
let app;

try {
  await mkdir(runtimeRoot, { recursive: true });
  const config = readCompanionConfig({
    RPG_COMPANION_HOST: '127.0.0.1',
    RPG_COMPANION_PORT: '18003',
    RPG_WORKSPACE_DIST: resolve(projectRoot, 'apps/workspace/dist'),
    RPG_DATABASE_PATH: resolve(runtimeRoot, 'campaigns.sqlite'),
    RPG_ADDON_DIRECTORY: resolve(runtimeRoot, 'campaign-content'),
    RPG_SILLYTAVERN_URL: 'http://127.0.0.1:1',
    RPG_LM_STUDIO_URL: 'http://127.0.0.1:1/v1',
    RPG_LOG_LEVEL: 'silent',
  });
  app = await buildCompanion({
    config,
    legacyChatSource: new IsolatedLegacySource(),
    probeDependencies: async () => [],
    lmStudioGateway: {
      models: async () => new Response('{"data":[]}'),
      chat: async request => {
        if (activeNarrationStartedAt === null) {
          throw new Error('The fake model boundary was reached outside a measured narration request.');
        }
        preModelDurations.push(performance.now() - activeNarrationStartedAt);
        upstreamCalls += 1;
        return new Response(JSON.stringify({
          id: `chatcmpl-${upstreamCalls}`,
          object: 'chat.completion',
          created: 1,
          model: profile.modelId,
          choices: [{
            index: 0,
            message: { role: 'assistant', content: 'The wardrobe waits in the quiet room.' },
            finish_reason: 'stop',
          }],
          requestHadContext: JSON.stringify(request).includes('Heirloom Wardrobe'),
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    },
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('Companion did not expose a TCP address.');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const preview = (await jsonRequest(baseUrl, 'POST', '/api/migrations/legacy-preview', { locator })).json;
  const imported = (await jsonRequest(baseUrl, 'POST', '/api/migrations/legacy-import', {
    requestId: `cutover-import-${runId}`,
    locator,
    sourceFingerprint: preview.sourceFingerprint,
    decision: 'create-campaign',
  })).json;
  if (imported.binding.markerState !== 'verified') throw new Error('Isolated binding marker was not verified.');

  await jsonRequest(
    baseUrl,
    'PUT',
    `/api/narrator-model-profiles/${profile.id}`,
    profile,
  );

  const contextDurations = [];
  for (let index = 0; index < 5 + iterations; index += 1) {
    const started = performance.now();
    const plan = (await jsonRequest(baseUrl, 'POST', '/api/context-plans', {
      requestId: `context-plan-${runId}-${index}`,
      campaignId: imported.campaignId,
      campaignRevision: imported.campaignRevision,
      bindingId: imported.binding.id,
      bindingRevision: imported.binding.revision,
      contextFocusRevision: imported.binding.contextFocusRevision ?? 1,
      modelProfileId: profile.id,
      generationType: 'normal',
      messages: [{ role: 'user', content: 'I inspect the heirloom wardrobe.' }],
    })).json;
    const elapsed = performance.now() - started;
    if (!plan.selections.some(selection => selection.recordId === 'item-heirloom-wardrobe')) {
      throw new Error('Context Plan did not retrieve the fixture wardrobe.');
    }
    if (index >= 5) contextDurations.push(elapsed);
  }

  const narrationRequestIds = [];
  for (let index = 0; index < 5 + iterations; index += 1) {
    const requestId = randomUUID();
    const exchange = encodeNarrationExchange({
      protocol: 'st-rpg.narration',
      version: 1,
      requestId,
      route: { kind: 'linked', bindingId: imported.binding.id },
      generation: 'normal',
      locator: {
        version: 1,
        hostId: 'cutover-performance-host',
        chat: { kind: 'character', ownerId: locator.avatar, chatId: locator.chatId },
      },
      bridge: { version: '0.2.0', sillyTavernRevision: PINNED_SILLYTAVERN_REVISION },
    });
    activeNarrationStartedAt = performance.now();
    const result = await jsonRequest(baseUrl, 'POST', '/v1/chat/completions', {
      model: profile.modelId,
      stream: false,
      messages: [
        { role: 'system', content: 'Narrate the next turn.' },
        { role: 'user', content: 'I inspect the heirloom wardrobe.' },
      ],
    }, { 'x-st-rpg-exchange': exchange });
    activeNarrationStartedAt = null;
    if (!result.text.includes('wardrobe waits')) throw new Error('Linked narration did not return the accepted reply.');
    if (index >= 5) narrationRequestIds.push(requestId);
  }

  const measuredUpstreamCalls = upstreamCalls - 5;
  const measuredPreModelDurations = preModelDurations.slice(5);
  const contextPlanning = summary(contextDurations, 100);
  const companionAddedPreModel = summary(measuredPreModelDurations, 250);
  const evidence = {
    schema: 'st-rpg.cutover-performance',
    version: 1,
    generatedAt: new Date().toISOString(),
    nodeVersion: process.version,
    platform: `${process.platform}-${process.arch}`,
    iterations,
    dataset: {
      campaignRevision: imported.campaignRevision,
      records: 1,
      messagesPerPlan: 1,
      linkedNarrationUpstream: 'in-process zero-latency fake; inference excluded',
    },
    contextPlanning,
    contextPlanningTargetMet: contextPlanning.p95Ms < contextPlanning.targetMs,
    companionAddedPreModel,
    companionAddedPreModelTargetMet: companionAddedPreModel.p95Ms < companionAddedPreModel.targetMs,
    measuredLinkedRequests: narrationRequestIds.length,
    measuredUpstreamCalls,
    exactlyOneUpstreamCallPerLinkedRequest: measuredUpstreamCalls === narrationRequestIds.length,
  };
  evidence.passed = evidence.contextPlanningTargetMet
    && evidence.companionAddedPreModelTargetMet
    && evidence.exactlyOneUpstreamCallPerLinkedRequest;

  await mkdir(resolve(outputPath, '..'), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`Cutover performance evidence: ${outputPath}\n`);
  if (!evidence.passed) throw new Error('Cutover performance targets were not met.');
} finally {
  activeNarrationStartedAt = null;
  await app?.close();
  await rm(runtimeRoot, { recursive: true, force: true });
}
