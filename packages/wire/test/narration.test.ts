import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NARRATION_EXCHANGE_HEADER,
  PINNED_SILLYTAVERN_REVISION,
  decodeNarrationExchange,
  encodeNarrationExchange,
  readNarrationExchangeHeader,
  type NarrationExchange,
} from '../src/index.js';

const linked: NarrationExchange = {
  protocol: 'st-rpg.narration',
  version: 1,
  requestId: '2b8ba8c6-46d9-4a3f-a75f-0cf8b413998a',
  route: { kind: 'linked', bindingId: '7c203ef2-1aad-40ae-a7a0-c1c1faf48cb8' },
  generation: 'normal',
  locator: {
    version: 1,
    hostId: '0cbdbd0e-2814-4e09-948d-6cccf061dc58',
    chat: { kind: 'character', ownerId: 'Narrator.png', chatId: 'Зимний дворец - 2026-08-09' },
  },
  bridge: { version: '0.2.0', sillyTavernRevision: PINNED_SILLYTAVERN_REVISION },
};

test('narration exchange round-trips canonical Unicode linked and unlinked envelopes', () => {
  const encoded = encodeNarrationExchange(linked);
  assert.match(encoded, /^v1\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeNarrationExchange(encoded), linked);

  const unlinked: NarrationExchange = {
    ...linked,
    requestId: 'bbdf40ed-1a1e-4453-8097-68de94721a56',
    route: { kind: 'unlinked' },
    generation: 'impersonate',
  };
  assert.deepEqual(decodeNarrationExchange(encodeNarrationExchange(unlinked)), unlinked);
});

test('linked route only admits ordinary chat generation modes', () => {
  assert.throws(
    () => encodeNarrationExchange({ ...linked, generation: 'quiet' } as NarrationExchange),
    /does not match the narration exchange contract/,
  );
  assert.throws(
    () => encodeNarrationExchange({ ...linked, generation: 'impersonate' } as NarrationExchange),
    /does not match the narration exchange contract/,
  );
});

test('decoder rejects malformed, noncanonical, unknown, obsolete, and oversized envelopes', () => {
  assert.throws(() => decodeNarrationExchange('v2.abc'), /version/);
  assert.throws(() => decodeNarrationExchange('v1.not+base64'), /base64url/);

  const unknown = { ...linked, recovery: { kind: 'use-draft' } };
  const rawUnknown = Buffer.from(JSON.stringify(unknown), 'utf8').toString('base64url');
  assert.throws(() => decodeNarrationExchange(`v1.${rawUnknown}`), /canonical|contract/);

  const noncanonical = Buffer.from(JSON.stringify(linked, null, 2), 'utf8').toString('base64url');
  assert.throws(() => decodeNarrationExchange(`v1.${noncanonical}`), /canonical/);

  const oversized = Buffer.alloc(4097, 0x61).toString('base64url');
  assert.throws(() => decodeNarrationExchange(`v1.${oversized}`), /4 KiB/);
});

test('decoder rejects invalid request IDs and bridge revisions', () => {
  assert.throws(
    () => encodeNarrationExchange({ ...linked, requestId: 'REQUEST-1' } as NarrationExchange),
    /contract/,
  );
  assert.throws(
    () => encodeNarrationExchange({
      ...linked,
      bridge: { ...linked.bridge, sillyTavernRevision: 'main' },
    } as NarrationExchange),
    /contract/,
  );
});

test('raw header reader requires exactly one case-insensitive exchange header', () => {
  const encoded = encodeNarrationExchange(linked);
  assert.equal(readNarrationExchangeHeader([
    'Content-Type', 'application/json', NARRATION_EXCHANGE_HEADER, encoded,
  ]), encoded);
  assert.equal(readNarrationExchangeHeader([
    NARRATION_EXCHANGE_HEADER.toUpperCase(), encoded,
  ]), encoded);
  assert.throws(() => readNarrationExchangeHeader(['Content-Type', 'application/json']), /missing/);
  assert.throws(() => readNarrationExchangeHeader([
    NARRATION_EXCHANGE_HEADER, encoded,
    NARRATION_EXCHANGE_HEADER, encoded,
  ]), /exactly once/);
});
