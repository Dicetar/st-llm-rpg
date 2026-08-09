import test from 'node:test';
import assert from 'node:assert/strict';
import { createUuid } from '../src/browser-uuid.js';

test('browser UUID uses the native implementation when available', () => {
  assert.equal(createUuid({ randomUUID: () => 'native-id' }), 'native-id');
});

test('browser UUID creates a valid UUIDv4 without randomUUID', () => {
  const value = createUuid({
    getRandomValues(bytes) {
      for (let index = 0; index < bytes.length; index += 1) bytes[index] = index + 1;
      return bytes;
    },
  });
  assert.match(value, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('browser UUID fails clearly when no cryptographic RNG exists', () => {
  assert.throws(() => createUuid({}), /cannot create secure request IDs/);
});
