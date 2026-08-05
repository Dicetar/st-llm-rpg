import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../extension/st-rpg-bridge/index.js', import.meta.url), 'utf8');

test('tracer-32 bridge only opens Campaign Book', () => {
  assert.match(source, /extensionsMenu/);
  assert.match(source, /\/health/);
  assert.match(source, /npm run start:companion/);
  assert.doesNotMatch(source, /CHAT_COMPLETION_SETTINGS_READY/);
  assert.doesNotMatch(source, /chat_completion/i);
  assert.doesNotMatch(source, /setExtensionPrompt/);
  assert.doesNotMatch(source, /chatMetadata/);
});
