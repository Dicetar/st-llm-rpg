import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bindingRoute,
  encodeNarrationExchange,
  mergeExchangeHeader,
} from '../extension/st-rpg-bridge/wire.js';

const exchange = {
  protocol: 'st-rpg.narration', version: 1,
  requestId: '2b8ba8c6-46d9-4a3f-a75f-0cf8b413998a',
  route: { kind: 'unlinked' }, generation: 'normal',
  locator: {
    version: 1, hostId: 'host-1',
    chat: { kind: 'character', ownerId: 'Narrator.png', chatId: 'Зимний дворец' },
  },
  bridge: { version: '0.2.0', sillyTavernRevision: '380e31e8c58d196969b6a0da74f431ba999c7e0a' },
};

test('bridge wire emits deterministic canonical Unicode base64url', () => {
  const encoded = encodeNarrationExchange(exchange);
  assert.match(encoded, /^v1\.[A-Za-z0-9_-]+$/);
  const json = new TextDecoder().decode(Uint8Array.from(
    atob(encoded.slice(3).replaceAll('-', '+').replaceAll('_', '/') + '=='.slice(0, (4 - encoded.slice(3).length % 4) % 4)),
    character => character.charCodeAt(0),
  ));
  assert.equal(json, '{"bridge":{"sillyTavernRevision":"380e31e8c58d196969b6a0da74f431ba999c7e0a","version":"0.2.0"},"generation":"normal","locator":{"chat":{"chatId":"Зимний дворец","kind":"character","ownerId":"Narrator.png"},"hostId":"host-1","version":1},"protocol":"st-rpg.narration","requestId":"2b8ba8c6-46d9-4a3f-a75f-0cf8b413998a","route":{"kind":"unlinked"},"version":1}');
});

test('bridge routing only trusts the verified additive marker shape', () => {
  assert.deepEqual(bindingRoute(null), { kind: 'unlinked' });
  assert.deepEqual(bindingRoute({
    schema: 'st-rpg.chat-binding-marker', version: '1.0',
    bindingId: 'binding-1', campaignId: 'campaign-1',
  }), { kind: 'linked', bindingId: 'binding-1' });
  assert.throws(() => bindingRoute({ version: 1, bindingId: 'binding-1' }), /malformed/);
  assert.throws(() => bindingRoute({
    schema: 'st-rpg.chat-binding-marker', version: '1.0', bindingId: '', campaignId: 'campaign-1',
  }), /malformed/);
});

test('exchange header replacement is case-insensitive and leaves other YAML lines intact', () => {
  const merged = mergeExchangeHeader('Authorization: Bearer local\nx-st-rpg-exchange: old', 'v1.new');
  assert.equal(merged, 'Authorization: Bearer local\nX-ST-RPG-Exchange: v1.new');
  assert.equal(merged.match(/st-rpg-exchange/gi)?.length, 1);
});
