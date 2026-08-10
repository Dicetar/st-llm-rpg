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

test('Campaign documents and commits validate routed record collections', () => {
  const document = {
    campaign: {
      id: 'campaign-1', title: 'Campaign', status: 'active', revision: 1,
      createdAt: now, updatedAt: now,
    },
    actors: [],
    items: [],
    quests: [{
      id: 'quest-1', name: 'Find the Gate', summary: 'Locate the sealed gate.',
      status: 'active', archived: false,
    }],
    places: [{
      id: 'place-1', name: 'Old Keep', summary: 'A ruined border fortress.', archived: false,
    }],
    facts: [{
      id: 'fact-1', name: 'Broken succession', summary: 'The heir vanished.',
      subjectId: 'place-1', archived: false,
    }],
    worldObjects: [{
      id: 'world-object-1', name: 'Moon Gate', summary: 'A sealed stone arch.',
      placeId: 'place-1', archived: false,
    }],
    abilities: [{
      id: 'ability-1', name: 'Mage Hand', summary: 'Moves light objects.', category: 'spell', archived: false,
    }],
    learnedAbilities: [{
      id: 'learned-1', abilityId: 'ability-1', actorId: 'actor-1', prepared: true, enabled: true, archived: false,
    }],
    relationships: [{
      id: 'relationship-1', sourceActorId: 'actor-1', targetActorId: 'actor-2', kind: 'ally',
      status: 'active', notes: 'They trust each other.', archived: false,
    }],
    currentScene: {
      id: 'scene-1', name: 'At the gate', summary: '', placeId: 'place-1',
      worldObjectIds: ['world-object-1'],
    },
    sceneArchives: [{
      id: 'scene-0', name: 'Road to the gate', summary: 'The party arrived safely.', placeId: 'place-1',
      actorIds: ['actor-1'], outcomes: ['The gate was found.'], openThreads: ['Who sealed it?'], closedAt: now,
    }],
  };
  const commit = {
    campaignId: 'campaign-1', revision: 1, eventId: 'event-1', requestId: 'request-4',
    operationKind: 'create_campaign', affectedIds: ['campaign-1'], committedAt: now,
    idempotent: false, document,
  };
  assert.equal(isCampaignDocument(document), true);
  assert.equal(isCampaignCommit(commit), true);
  assert.equal(isCampaignDocument({ ...document, arbitraryTable: [] }), false);
  assert.equal(isCampaignDocument({
    ...document,
    quests: [{ ...document.quests[0]!, status: 'unknown' }],
  }), false);
  assert.equal(isCampaignDocument({
    ...document,
    worldObjects: [{ ...document.worldObjects[0]!, placeId: '' }],
  }), false);
  assert.equal(isCampaignCommit({ ...commit, document: { ...document, actors: [{ id: '', name: '', summary: '', archived: false }] } }), false);
});
