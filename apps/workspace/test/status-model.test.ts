import test from 'node:test';
import assert from 'node:assert/strict';
import type { ReadinessDocument } from '@st-llm-rpg/wire';
import { buildStatusCards } from '../src/status-model.js';

const readiness: ReadinessDocument = {
  schema: 'st-rpg.readiness', version: '1.0', service: 'st-rpg-companion',
  ready: true, status: 'degraded', requestId: 'request', observedAt: new Date().toISOString(),
  components: [
    { id: 'workspace', status: 'ready', blocking: true, message: 'ready', observedAt: new Date().toISOString() },
    { id: 'sqlite-runtime', status: 'ready', blocking: true, message: 'SQLite Campaign authority is ready.', observedAt: new Date().toISOString() },
    { id: 'sillytavern', status: 'available', blocking: false, message: 'available', observedAt: new Date().toISOString() },
    { id: 'lm-studio', status: 'unavailable', blocking: false, message: 'offline', observedAt: new Date().toISOString() },
  ],
};

test('status cards distinguish durable Campaign authority from degraded external services', () => {
  const cards = buildStatusCards(readiness);
  assert.equal(cards.length, 4);
  assert.equal(cards.find(card => card.id === 'lm-studio')?.tone, 'warning');
  assert.equal(cards.find(card => card.id === 'sqlite-runtime')?.tone, 'good');
  assert.equal(cards.find(card => card.id === 'sqlite-runtime')?.title, 'Campaign authority');
});
