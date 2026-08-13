import { mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { buildCompanion } from '../src/app.js';
import { readCompanionConfig } from '../src/config.js';
import type { LegacyBindingMarker } from '../src/modules/legacy-import/legacy-import-journal.js';

const journeyLocator = { kind: 'character' as const, chatId: 'Journey Chat', avatar: 'Narrator.png' };
class JourneyChatSource {
  marker: LegacyBindingMarker | undefined;

  async list() {
    return [{
      locator: journeyLocator,
      title: journeyLocator.chatId,
      fileSize: '1 KB',
      messageCount: 2,
      lastModified: new Date().toISOString(),
      hasLegacyCampaign: false,
    }];
  }

  async read() {
    return {
      locator: journeyLocator,
      sourceContentFingerprint: 'b'.repeat(64),
      ...(this.marker ? { bindingMarker: this.marker } : {}),
    };
  }

  async writeMarker(_snapshot: unknown, marker: LegacyBindingMarker) {
    this.marker = marker;
    return { verified: true as const, legacyMetadataPreserved: true as const };
  }
}

const root = resolve(process.env.RPG_PLAYER_JOURNEY_ROOT ?? '.runtime/player-journey');
const port = Number(process.env.RPG_PLAYER_JOURNEY_PORT ?? 18102);
await rm(root, { recursive: true, force: true });
await mkdir(root, { recursive: true });

const config = readCompanionConfig({
  RPG_COMPANION_HOST: '127.0.0.1',
  RPG_COMPANION_PORT: String(port),
  RPG_WORKSPACE_DIST: resolve('apps/workspace/dist'),
  RPG_DATABASE_PATH: join(root, 'campaigns.sqlite'),
  RPG_ADDON_DIRECTORY: join(root, 'campaign-content'),
  RPG_SNAPSHOT_INTERVAL: '2',
  RPG_SILLYTAVERN_URL: 'http://127.0.0.1:8001',
  RPG_LM_STUDIO_URL: 'http://127.0.0.1:1234/v1',
  RPG_PROBE_TIMEOUT_MS: '25',
  RPG_WAYFINDER_RUN_ID: 'player-journey-run',
  RPG_LOG_LEVEL: 'silent',
});
const app = await buildCompanion({
  config,
  legacyChatSource: new JourneyChatSource(),
  lmStudioGateway: {
    models: async () => new Response('{"data":[]}'),
    chat: async () => new Response(JSON.stringify({
      id: 'journey-worker',
      object: 'chat.completion',
      created: 1,
      model: 'journey-worker',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: JSON.stringify({ proposals: [{
            title: 'The archive was opened',
            operation: { kind: 'create_fact', fact: { name: 'Archive opened', summary: 'Mara opened the Moonlit Archive.' } },
            evidence: [1],
            confidence: 'high',
          }] }),
        },
        finish_reason: 'stop',
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }),
  },
  probeDependencies: async () => {
  const observedAt = new Date().toISOString();
  return [
    { id: 'workspace', status: 'ready', blocking: true, message: 'ready', observedAt },
    { id: 'sqlite-runtime', status: 'ready', blocking: true, message: 'ready', observedAt },
    { id: 'sillytavern', status: 'unavailable', blocking: false, message: 'not required by this journey', observedAt },
    { id: 'lm-studio', status: 'unavailable', blocking: false, message: 'not required by this journey', observedAt },
  ];
  },
});
await app.listen({ host: '127.0.0.1', port });

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await app.close();
  await rm(root, { recursive: true, force: true });
}
process.once('SIGINT', () => { void close().finally(() => process.exit(0)); });
process.once('SIGTERM', () => { void close().finally(() => process.exit(0)); });
