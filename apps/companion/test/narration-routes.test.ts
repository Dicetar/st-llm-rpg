import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import Fastify from 'fastify';
import {
  PINNED_SILLYTAVERN_REVISION,
  encodeNarrationExchange,
  type NarrationExchange,
} from '@st-llm-rpg/wire';
import { registerNarrationRoutes, type NarrationHttpService } from '../src/modules/narration/narration-routes.js';
import { NarrationStatus } from '../src/modules/narration/narration-status.js';
import { makeProblem, ProblemError } from '../src/problem.js';

const linked: NarrationExchange = {
  protocol: 'st-rpg.narration', version: 1,
  requestId: '8fc27b90-3df2-48b7-b8ab-29b93c425c69',
  route: { kind: 'linked', bindingId: 'binding-1' }, generation: 'normal',
  locator: {
    version: 1, hostId: 'host-1',
    chat: { kind: 'character', ownerId: 'Narrator.png', chatId: 'Court' },
  },
  bridge: { version: '0.2.0', sillyTavernRevision: PINNED_SILLYTAVERN_REVISION },
};

function completion(content = 'Complete reply.') {
  return {
    id: 'chatcmpl-1', object: 'chat.completion', created: 123, model: 'qwen-test',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
  };
}

function build(service: NarrationHttpService, status = new NarrationStatus()) {
  const app = Fastify({ logger: false });
  registerNarrationRoutes(app, service, status);
  return app;
}

test('narration status reports only the latest linked outcome without prompt or reply content', async t => {
  const status = new NarrationStatus();
  const app = build({
    respond: async () => ({ kind: 'linked', stream: true, content: 'Private generated prose.', completion: completion('Private generated prose.') }),
    forwardUnlinked: async () => { throw new Error('wrong route'); },
    models: async () => new Response('{}'),
  }, status);
  t.after(() => app.close());

  const generation = await app.inject({
    method: 'POST', url: '/v1/chat/completions',
    headers: { 'x-st-rpg-exchange': encodeNarrationExchange(linked) },
    payload: { model: 'qwen-test', stream: true, messages: [{ role: 'user', content: 'Private prompt.' }] },
  });
  assert.equal(generation.statusCode, 200, generation.body);

  const response = await app.inject({ method: 'GET', url: '/api/narration/status' });
  assert.equal(response.statusCode, 200, response.body);
  const document = response.json();
  assert.equal(document.schema, 'st-rpg.narration-status');
  assert.deepEqual(document.active, []);
  assert.deepEqual(document.latest, {
    requestId: linked.requestId,
    route: 'linked',
    generation: 'normal',
    state: 'completed',
    bindingId: 'binding-1',
    startedAt: document.latest.startedAt,
    completedAt: document.latest.completedAt,
    elapsedMs: document.latest.elapsedMs,
    httpStatus: 200,
  });
  const serialized = JSON.stringify(document);
  assert.doesNotMatch(serialized, /Private prompt/);
  assert.doesNotMatch(serialized, /Private generated prose/);
});

test('narration status strips private diagnostic details from a failed Problem', async t => {
  const status = new NarrationStatus();
  const app = build({
    respond: async () => {
      throw new ProblemError(makeProblem({
        code: 'NARRATION_UPSTREAM_FAILED',
        message: 'PRIVATE EXCEPTION MESSAGE WITH CAMPAIGN CONTEXT',
        requestId: linked.requestId,
        actions: [{ id: 'retry', label: 'Retry in SillyTavern.', kind: 'retry' }],
        details: { upstreamBody: 'PRIVATE MODEL OUTPUT AND CAMPAIGN CONTEXT' },
      }), 502);
    },
    forwardUnlinked: async () => { throw new Error('wrong route'); },
    models: async () => new Response('{}'),
  }, status);
  t.after(() => app.close());

  const generation = await app.inject({
    method: 'POST', url: '/v1/chat/completions',
    headers: { 'x-st-rpg-exchange': encodeNarrationExchange(linked) },
    payload: { model: 'qwen-test', messages: [{ role: 'user', content: 'Private prompt.' }] },
  });
  assert.equal(generation.statusCode, 502, generation.body);

  const document = (await app.inject({ method: 'GET', url: '/api/narration/status' })).json();
  assert.equal(document.latest.state, 'failed');
  assert.equal(document.latest.problem.code, 'NARRATION_UPSTREAM_FAILED');
  assert.equal(document.latest.problem.message, 'The narrator model request failed before the Companion accepted a complete reply.');
  assert.equal(document.latest.problem.details, undefined);
  assert.doesNotMatch(JSON.stringify(document), /PRIVATE MODEL OUTPUT|PRIVATE EXCEPTION MESSAGE|CAMPAIGN CONTEXT|Private prompt/);
});

test('chat completions rejects a missing exchange instead of guessing unlinked', async t => {
  let calls = 0;
  const status = new NarrationStatus();
  const app = build({
    respond: async () => { calls += 1; throw new Error('must not run'); },
    forwardUnlinked: async () => { calls += 1; },
    models: async () => new Response('{}'),
  }, status);
  t.after(() => app.close());
  const response = await app.inject({
    method: 'POST', url: '/v1/chat/completions',
    payload: { model: 'qwen-test', messages: [{ role: 'user', content: 'Hello' }] },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, 'NARRATION_EXCHANGE_INVALID');
  assert.equal(calls, 0);
  const document = (await app.inject({ method: 'GET', url: '/api/narration/status' })).json();
  assert.equal(document.latest.route, 'invalid');
  assert.equal(document.latest.generation, null);
  assert.equal(document.latest.state, 'rejected');
  assert.equal(document.latest.httpStatus, 400);
  assert.equal(document.latest.problem.code, 'NARRATION_EXCHANGE_INVALID');
  assert.match(document.latest.problem.actions[0].label, /bridge/);
});

test('chat completions returns an OpenAI-shaped admission error for oversized JSON', async t => {
  let calls = 0;
  const status = new NarrationStatus();
  const app = build({
    respond: async () => { calls += 1; throw new Error('must not run'); },
    forwardUnlinked: async () => { calls += 1; },
    models: async () => new Response('{}'),
  }, status);
  t.after(() => app.close());
  const response = await app.inject({
    method: 'POST', url: '/v1/chat/completions',
    headers: { 'x-st-rpg-exchange': encodeNarrationExchange(linked) },
    payload: { model: 'qwen-test', messages: [{ role: 'user', content: 'x'.repeat(4 * 1024 * 1024) }] },
  });
  assert.equal(response.statusCode, 413);
  assert.equal(response.json().error.code, 'NARRATION_EXCHANGE_INVALID');
  assert.equal(calls, 0);
  const document = (await app.inject({ method: 'GET', url: '/api/narration/status' })).json();
  assert.equal(document.latest.route, 'invalid');
  assert.equal(document.latest.state, 'rejected');
  assert.equal(document.latest.httpStatus, 413);
  assert.match(document.latest.problem.actions[0].label, /Reduce/);
});

test('linked streaming delivery emits one complete content chunk only after service acceptance', async t => {
  const seen: unknown[] = [];
  const app = build({
    respond: async (exchange, body) => {
      seen.push(exchange, body);
      return { kind: 'linked', stream: true, content: 'Complete reply.', completion: completion() };
    },
    forwardUnlinked: async () => { throw new Error('wrong route'); },
    models: async () => new Response('{}'),
  });
  t.after(() => app.close());
  const response = await app.inject({
    method: 'POST', url: '/v1/chat/completions',
    headers: { 'x-st-rpg-exchange': encodeNarrationExchange(linked) },
    payload: { model: 'qwen-test', stream: true, messages: [{ role: 'user', content: 'Hello' }] },
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.match(response.headers['content-type'] ?? '', /text\/event-stream/);
  const events = response.body.trim().split('\n\n');
  assert.equal(events.length, 3);
  assert.equal(JSON.parse(events[0]!.slice(6)).choices[0].delta.content, 'Complete reply.');
  assert.equal(JSON.parse(events[1]!.slice(6)).choices[0].finish_reason, 'stop');
  assert.equal(events[2], 'data: [DONE]');
  assert.equal(seen.length, 2);
});

test('explicit unlinked route preserves upstream status, content type, and fragmented bytes', async t => {
  const chunks = ['data: {"choices":[', '{"delta":{"content":"Hi"}}]}\n\n', 'data: [DONE]\n\n'];
  let calls = 0;
  const app = build({
    respond: async () => { throw new Error('wrong route'); },
    forwardUnlinked: async (_exchange, _body, _signal, consume) => {
      calls += 1;
      const stream = new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
          controller.close();
        },
      });
      await consume(new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
    },
    models: async () => new Response('{}'),
  });
  t.after(() => app.close());
  const response = await app.inject({
    method: 'POST', url: '/v1/chat/completions',
    headers: { 'x-st-rpg-exchange': encodeNarrationExchange({ ...linked, route: { kind: 'unlinked' } }) },
    payload: { model: 'qwen-test', stream: true, messages: [{ role: 'user', content: 'Hello' }] },
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.body, chunks.join(''));
  assert.match(response.headers['content-type'] ?? '', /text\/event-stream/);
  assert.equal(calls, 1);
});

test('unlinked client disconnect after streamed headers does not send a second error response', async t => {
  let observeAbort!: () => void;
  const aborted = new Promise<void>(resolve => { observeAbort = resolve; });
  const app = build({
    respond: async () => { throw new Error('wrong route'); },
    forwardUnlinked: async (_exchange, _body, signal, consume) => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'));
          signal.addEventListener('abort', () => {
            observeAbort();
            controller.error(new Error('client disconnected after headers'));
          }, { once: true });
        },
      });
      await consume(new Response(stream, {
        status: 200, headers: { 'content-type': 'text/event-stream' },
      }));
    },
    models: async () => new Response('{}'),
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  t.after(() => app.close());
  const address = app.server.address();
  assert.ok(address && typeof address === 'object');

  const controller = new AbortController();
  const response = await fetch(`http://127.0.0.1:${address.port}/v1/chat/completions`, {
    method: 'POST', signal: controller.signal,
    headers: {
      'content-type': 'application/json',
      'x-st-rpg-exchange': encodeNarrationExchange({ ...linked, route: { kind: 'unlinked' } }),
    },
    body: JSON.stringify({ model: 'qwen-test', stream: true, messages: [{ role: 'user', content: 'Hello' }] }),
  });
  assert.equal(response.status, 200);
  const reader = response.body!.getReader();
  const first = await reader.read();
  assert.match(new TextDecoder().decode(first.value), /partial/);
  controller.abort();
  await Promise.race([
    aborted,
    new Promise((_, reject) => setTimeout(() => reject(new Error('server did not observe unlinked disconnect')), 1_000)),
  ]);
  await new Promise(resolve => setTimeout(resolve, 30));

  const status = await app.inject({ method: 'GET', url: '/api/narration/status' });
  assert.equal(status.statusCode, 200, status.body);
  assert.equal(status.json().latest.state, 'cancelled');
});

test('narration status gives an unlinked upstream HTTP failure a concrete recovery action', async t => {
  const status = new NarrationStatus();
  const app = build({
    respond: async () => { throw new Error('wrong route'); },
    forwardUnlinked: async (_exchange, _body, _signal, consume) => {
      await consume(new Response('{"error":"offline"}', {
        status: 503, headers: { 'content-type': 'application/json' },
      }));
    },
    models: async () => new Response('{}'),
  }, status);
  t.after(() => app.close());

  const response = await app.inject({
    method: 'POST', url: '/v1/chat/completions',
    headers: { 'x-st-rpg-exchange': encodeNarrationExchange({ ...linked, route: { kind: 'unlinked' } }) },
    payload: { model: 'qwen-test', messages: [{ role: 'user', content: 'Hello' }] },
  });
  assert.equal(response.statusCode, 503, response.body);
  let document;
  const deadline = Date.now() + 1_000;
  do {
    document = (await app.inject({ method: 'GET', url: '/api/narration/status' })).json();
    if (document.latest) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  } while (Date.now() < deadline);
  assert.equal(document.latest.route, 'unlinked');
  assert.equal(document.latest.state, 'failed');
  assert.equal(document.latest.httpStatus, 503);
  assert.equal(document.latest.problem.code, 'NARRATION_UPSTREAM_FAILED');
  assert.match(document.latest.problem.actions[0].label, /LM Studio.*retry in SillyTavern/);
});

test('models endpoint transparently forwards LM Studio discovery without an exchange header', async t => {
  const app = build({
    respond: async () => { throw new Error('unused'); },
    forwardUnlinked: async () => { throw new Error('unused'); },
    models: async () => new Response('{"data":[{"id":"qwen-test"}]}', {
      status: 200, headers: { 'content-type': 'application/json' },
    }),
  });
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: '/v1/models' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { data: [{ id: 'qwen-test' }] });
});

test('linked HTTP response exposes no headers or bytes before the complete reply is accepted', async t => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const app = build({
    respond: async () => {
      await gate;
      return { kind: 'linked', stream: true, content: 'Atomic.', completion: completion('Atomic.') };
    },
    forwardUnlinked: async () => { throw new Error('wrong route'); },
    models: async () => new Response('{}'),
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  t.after(() => app.close());
  const address = app.server.address();
  assert.ok(address && typeof address === 'object');
  let headersArrived = false;
  const pending = fetch(`http://127.0.0.1:${address.port}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-st-rpg-exchange': encodeNarrationExchange(linked) },
    body: JSON.stringify({ model: 'qwen-test', stream: true, messages: [{ role: 'user', content: 'Hello' }] }),
  }).then(response => {
    headersArrived = true;
    return response;
  });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(headersArrived, false);
  release();
  const response = await pending;
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Atomic\./);
});

test('client disconnect propagates cancellation to active linked narration', async t => {
  let observedAbort!: () => void;
  const aborted = new Promise<void>(resolve => { observedAbort = resolve; });
  const status = new NarrationStatus();
  const app = build({
    respond: async (_exchange, _body, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        observedAbort();
        reject(new Error('cancelled by client'));
      }, { once: true });
    }),
    forwardUnlinked: async () => { throw new Error('wrong route'); },
    models: async () => new Response('{}'),
  }, status);
  await app.listen({ host: '127.0.0.1', port: 0 });
  t.after(() => app.close());
  const address = app.server.address();
  assert.ok(address && typeof address === 'object');
  const controller = new AbortController();
  const pending = fetch(`http://127.0.0.1:${address.port}/v1/chat/completions`, {
    method: 'POST', signal: controller.signal,
    headers: { 'content-type': 'application/json', 'x-st-rpg-exchange': encodeNarrationExchange(linked) },
    body: JSON.stringify({ model: 'qwen-test', stream: true, messages: [{ role: 'user', content: 'Hello' }] }),
  });
  setTimeout(() => controller.abort(), 30);
  await assert.rejects(pending, error => error instanceof Error && error.name === 'AbortError');
  await Promise.race([
    aborted,
    new Promise((_, reject) => setTimeout(() => reject(new Error('server did not observe disconnect')), 1_000)),
  ]);
  let trace: Record<string, unknown> | undefined;
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    const document = (await app.inject({ method: 'GET', url: '/api/narration/status' })).json();
    trace = document.latest;
    if (trace) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(trace?.state, 'cancelled');
  assert.equal(trace?.httpStatus, 499);
});

test('duplicate exchange header lines are rejected before service dispatch', async t => {
  let calls = 0;
  const app = build({
    respond: async () => { calls += 1; throw new Error('must not run'); },
    forwardUnlinked: async () => { calls += 1; },
    models: async () => new Response('{}'),
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  t.after(() => app.close());
  const address = app.server.address();
  assert.ok(address && typeof address === 'object');
  const payload = JSON.stringify({ model: 'qwen-test', messages: [{ role: 'user', content: 'Hello' }] });
  const encoded = encodeNarrationExchange(linked);
  const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const request = httpRequest({
      host: '127.0.0.1', port: address.port, path: '/v1/chat/completions', method: 'POST',
      headers: [
        'Content-Type', 'application/json',
        'Content-Length', String(Buffer.byteLength(payload)),
        'X-ST-RPG-Exchange', encoded,
        'x-st-rpg-exchange', encoded,
      ],
    }, incoming => {
      incoming.setEncoding('utf8');
      let body = '';
      incoming.on('data', chunk => { body += chunk; });
      incoming.on('end', () => resolve({ status: incoming.statusCode ?? 0, body }));
    });
    request.on('error', reject);
    request.end(payload);
  });
  assert.equal(response.status, 400);
  if (response.body) assert.equal(JSON.parse(response.body).error.code, 'NARRATION_EXCHANGE_INVALID');
  assert.equal(calls, 0);
});
