import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { SillyTavernChatSource } from '../src/adapters/sillytavern/sillytavern-chat-source.js';
import { canonicalJson } from '../src/modules/campaign/campaign-state.js';

const envelope = {
  envelopeVersion: 1,
  campaign: {
    schemaVersion: 1, instanceId: 'legacy', commitId: 'commit-1', revision: 1, title: 'Legacy',
    records: [], possessions: [], learnedAbilities: [], relationships: [], sceneArchives: [], proposals: [], currentScene: null,
  },
};

test('SillyTavern adapter uses CSRF session, writes only additive marker, and verifies readback', async t => {
  let chat: unknown[] = [{ chat_metadata: { stLlmRpgCampaign: envelope }, user_name: 'Player', character_name: 'Narrator' }];
  const requests: Array<{ path: string; body: unknown }> = [];
  const server = createServer(async (request, response) => {
    if (request.url === '/csrf-token') {
      response.setHeader('content-type', 'application/json');
      response.setHeader('set-cookie', ['session=test-session; Path=/', 'token=test-token; Path=/']);
      response.end(JSON.stringify({ token: 'csrf-test' }));
      return;
    }
    let raw = '';
    for await (const chunk of request) raw += String(chunk);
    const body = raw ? JSON.parse(raw) : null;
    requests.push({ path: request.url ?? '', body });
    assert.equal(request.headers['x-csrf-token'], 'csrf-test');
    assert.match(request.headers.cookie ?? '', /session=test-session/);
    response.setHeader('content-type', 'application/json');
    if (request.url === '/api/chats/recent') {
      response.end(JSON.stringify([{
        file_id: 'Legacy Chat', file_name: 'Legacy Chat.jsonl', file_size: '1 KB', chat_items: 0,
        last_mes: '2026-08-09T12:00:00.000Z', avatar: 'Narrator.png',
        chat_metadata: { stLlmRpgCampaign: envelope },
      }]));
      return;
    }
    if (request.url === '/api/chats/get') {
      response.end(JSON.stringify(chat));
      return;
    }
    if (request.url === '/api/chats/save') {
      chat = body.chat;
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    response.statusCode = 404;
    response.end('{}');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server did not listen');

  const source = new SillyTavernChatSource(`http://127.0.0.1:${address.port}`);
  const listed = await source.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.hasLegacyCampaign, true);
  const chatBefore = structuredClone(chat);
  const snapshot = await source.read(listed[0]!.locator);
  const legacyBefore = canonicalJson(snapshot.envelope);
  const legacyBytesBefore = JSON.stringify(snapshot.envelope);
  await source.writeMarker(snapshot, {
    schema: 'st-rpg.chat-binding-marker', version: '1.0', bindingId: 'binding-1', campaignId: 'campaign-1',
  });
  const metadata = (chat[0] as { chat_metadata: Record<string, unknown> }).chat_metadata;
  assert.equal(canonicalJson(metadata.stLlmRpgCampaign), legacyBefore);
  assert.equal(JSON.stringify(metadata.stLlmRpgCampaign), legacyBytesBefore);
  assert.deepEqual(metadata.stLlmRpgBinding, {
    schema: 'st-rpg.chat-binding-marker', version: '1.0', bindingId: 'binding-1', campaignId: 'campaign-1',
  });
  assert.equal(requests.filter(entry => entry.path === '/api/chats/save').length, 1);
  assert.equal(requests.filter(entry => entry.path === '/api/chats/get').length, 3);
  const chatWithoutMarker = structuredClone(chat);
  delete (chatWithoutMarker[0] as { chat_metadata: Record<string, unknown> }).chat_metadata.stLlmRpgBinding;
  assert.deepEqual(chatWithoutMarker, chatBefore, 'the additive marker is the only saved-chat change');
});
