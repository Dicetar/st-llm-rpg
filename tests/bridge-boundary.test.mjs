import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../extension/st-rpg-bridge/index.js', import.meta.url), 'utf8');

test('production bridge owns launchers, Story Sync source capture, and transient narration routing', () => {
  assert.match(source, /extensionsMenu/);
  assert.match(source, /\/health/);
  assert.match(source, /npm run start:companion/);
  assert.match(source, /CHAT_COMPLETION_SETTINGS_READY/);
  assert.match(source, /custom_include_headers/);
  assert.match(source, /generateData\.custom_url/);
  assert.match(source, /generateData\.chat_completion_source/);
  assert.match(source, /makeLast/);
  assert.match(source, /stLlmRpgBinding/);
  assert.match(source, /function createUuid/);
  assert.match(source, /getRandomValues/);
  assert.match(source, /st-rpg-story-sync-launcher/);
  assert.match(source, /\/api\/story-sync\/jobs/);
  assert.match(source, /current\?\.chat/);
  assert.match(source, /role: message\?\.is_user \? 'player' : 'narrator'/);
  assert.doesNotMatch(source, /requestId:\s*crypto\.randomUUID/);
  assert.doesNotMatch(source, /oai_settings\.custom_url\s*=/);
  assert.doesNotMatch(source, /saveMetadata/);
  assert.doesNotMatch(source, /setExtensionPrompt/);
});
