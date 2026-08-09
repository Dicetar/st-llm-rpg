import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { FetchLmStudioGateway } from '../src/adapters/lm-studio/fetch-lm-studio-gateway.js';

test('LM Studio gateway targets only configured OpenAI-compatible endpoints and forwards cancellation', async t => {
  const requests: Array<{ method?: string; url?: string; body: string }> = [];
  const server = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      requests.push({ method: request.method, url: request.url, body });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(request.url === '/v1/models' ? '{"data":[]}' : '{"choices":[]}');
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const gateway = new FetchLmStudioGateway(`http://127.0.0.1:${address.port}/v1`);

  const chat = await gateway.chat({ model: 'qwen-test', messages: [] }, new AbortController().signal);
  assert.equal(chat.status, 200);
  const models = await gateway.models(new AbortController().signal);
  assert.equal(models.status, 200);
  assert.deepEqual(requests.map(request => [request.method, request.url]), [
    ['POST', '/v1/chat/completions'], ['GET', '/v1/models'],
  ]);
  assert.deepEqual(JSON.parse(requests[0]!.body), { model: 'qwen-test', messages: [] });
});

test('LM Studio gateway abort signal terminates an active HTTP call', async t => {
  let closed = false;
  const server = createServer((request, _response) => {
    request.on('close', () => { closed = true; });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const gateway = new FetchLmStudioGateway(`http://127.0.0.1:${address.port}/v1`);
  const controller = new AbortController();
  const pending = gateway.chat({ model: 'qwen-test', messages: [] }, controller.signal);
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(pending, error => error instanceof Error && error.name === 'AbortError');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(closed, true);
});
