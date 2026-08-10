import test from 'node:test';
import assert from 'node:assert/strict';
import { Value } from '@sinclair/typebox/value';
import {
  StartStorySyncJobRequestSchema,
  StorySyncJobDocumentSchema,
  WorkerModelProfileSchema,
} from '../src/index.js';

test('Story Sync wire accepts bounded source capture and exposes review state without raw prose', () => {
  assert.equal(Value.Check(WorkerModelProfileSchema, {
    schema: 'st-rpg.worker-model-profile', version: '1.0', id: 'worker-default',
    modelId: 'local/worker-model', requestedOutputTokens: 1200,
    updatedAt: '2026-08-10T00:00:00.000Z',
  }), true);
  assert.equal(Value.Check(StartStorySyncJobRequestSchema, {
    requestId: 'story-sync-start-1', bindingId: 'binding-1', profileId: 'worker-default',
    locator: { version: 1, hostId: 'desktop-host', chat: { kind: 'character', ownerId: 'Narrator.png', chatId: 'Story' } },
    messages: [
      { index: 0, role: 'player', name: 'Dan', content: 'I take the silver key.' },
      { index: 1, role: 'narrator', name: 'Narrator', content: 'The key is now yours.' },
    ],
  }), true);
  assert.equal(Value.Check(StorySyncJobDocumentSchema, {
    schema: 'st-rpg.story-sync-job', version: '1.0', id: 'job-1',
    campaignId: 'campaign-1', bindingId: 'binding-1', profileId: 'worker-default',
    status: 'ready-for-review', campaignAnchor: 1, bindingRevision: 1, syncFacetRevision: 1,
    source: {
      firstMessageIndex: 0, lastMessageIndex: 1, messageCount: 2,
      fingerprint: 'a'.repeat(64), endPrefixHash: 'b'.repeat(64), contentPruned: false,
    },
    attemptCount: 1,
    proposals: [],
    createdAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-10T00:00:01.000Z',
  }), true);
  assert.equal('messages' in StorySyncJobDocumentSchema.properties.source.properties, false);
});
