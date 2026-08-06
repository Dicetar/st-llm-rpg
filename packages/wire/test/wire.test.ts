import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPANION_SERVICE,
  WIRE_VERSION,
  isCampaignCommit,
  isCampaignDocument,
  isHealthDocument,
  isProblem,
  isReadinessDocument,
} from '../src/index.js';

const now = new Date().toISOString();

test('health document rejects unversioned and extra fields', () => {
  const valid = {
    schema: 'st-rpg.health', version: WIRE_VERSION, service: COMPANION_SERVICE,
    status: 'alive', requestId: 'request-1', startedAt: now, uptimeMs: 5,
  };
  assert.equal(isHealthDocument(valid), true);
  assert.equal(isHealthDocument({ ...valid, version: '0' }), false);
  assert.equal(isHealthDocument({ ...valid, surprise: true }), false);
});

test('readiness document validates exactly four bounded observations', () => {
  const components = [
    ['workspace', 'ready', true],
    ['sqlite-runtime', 'ready', true],
    ['sillytavern', 'available', false],
    ['lm-studio', 'unavailable', false],
  ].map(([id, status, blocking]) => ({ id, status, blocking, message: String(id), observedAt: now }));
  const value = {
    schema: 'st-rpg.readiness', version: WIRE_VERSION, service: COMPANION_SERVICE,
    ready: true, status: 'degraded', requestId: 'request-2', observedAt: now, components,
  };
  assert.equal(isReadinessDocument(value), true);
  assert.equal(isReadinessDocument({ ...value, components: components.slice(0, 3) }), false);
});

test('Problem is bounded and carries explicit recovery actions', () => {
  const value = {
    schema: 'st-rpg.problem', version: WIRE_VERSION, code: 'DEPENDENCY_UNAVAILABLE',
    message: 'LM Studio is unavailable.', requestId: 'request-3', retryable: true,
    actions: [{ id: 'retry', label: 'Retry readiness check', kind: 'retry' }],
  };
  assert.equal(isProblem(value), true);
  assert.equal(isProblem({ ...value, code: 'UNKNOWN' }), false);
  assert.equal(isProblem({ ...value, actions: [{ label: 'missing id', kind: 'retry' }] }), false);
});

test('Campaign documents and commits reject unbounded or malformed authority payloads', () => {
  const document = {
    campaign: {
      id: 'campaign-1', title: 'Campaign', status: 'active', revision: 1,
      createdAt: now, updatedAt: now,
    },
    actors: [], items: [], currentScene: null,
  };
  const commit = {
    campaignId: 'campaign-1', revision: 1, eventId: 'event-1', requestId: 'request-4',
    operationKind: 'create_campaign', affectedIds: ['campaign-1'], committedAt: now,
    idempotent: false, document,
  };
  assert.equal(isCampaignDocument(document), true);
  assert.equal(isCampaignCommit(commit), true);
  assert.equal(isCampaignDocument({ ...document, arbitraryTable: [] }), false);
  assert.equal(isCampaignCommit({ ...commit, document: { ...document, actors: [{ id: '', name: '', summary: '', archived: false }] } }), false);
});
