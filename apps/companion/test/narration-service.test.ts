import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PINNED_SILLYTAVERN_REVISION,
  type ChatBindingDocument,
  type ContextPlan,
  type NarrationExchange,
  type NarratorModelProfile,
  type PreflightContextRequest,
} from '@st-llm-rpg/wire';
import { NarrationService, SerialInferenceLane } from '../src/modules/narration/narration-service.js';

const binding: ChatBindingDocument = {
  schema: 'st-rpg.chat-binding', version: '1.0',
  id: 'binding-1', campaignId: 'campaign-1', revision: 3, campaignAnchor: 7,
  contextFocusRevision: 2, pins: [],
  locator: { kind: 'character', chatId: 'Court - 2026-08-09', avatar: 'Narrator.png' },
  sourceFingerprint: 'a'.repeat(64), contentFingerprint: 'b'.repeat(64),
  markerState: 'verified', createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
};

const profile: NarratorModelProfile = {
  id: 'narrator-qwen', modelId: 'qwen-test', contextWindowTokens: 32_768,
  requestedVisibleOutputTokens: 1_024, safetyMarginTokens: 512,
  maxCampaignTokens: 2_000, maxAutomaticRecords: 12, maxRelationExpansions: 4,
};

const exchange: NarrationExchange = {
  protocol: 'st-rpg.narration', version: 1,
  requestId: '2b8ba8c6-46d9-4a3f-a75f-0cf8b413998a',
  route: { kind: 'linked', bindingId: binding.id }, generation: 'normal',
  locator: {
    version: 1, hostId: 'host-1',
    chat: { kind: 'character', ownerId: 'Narrator.png', chatId: 'Court - 2026-08-09' },
  },
  bridge: { version: '0.2.0', sillyTavernRevision: PINNED_SILLYTAVERN_REVISION },
};

function plan(request: PreflightContextRequest): ContextPlan {
  return {
    schema: 'st-rpg.context-plan', version: '1.0', requestId: request.requestId,
    authority: {
      campaignId: request.campaignId, campaignRevision: request.campaignRevision,
      bindingId: request.bindingId, bindingRevision: request.bindingRevision,
      contextFocusRevision: request.contextFocusRevision,
    },
    modelProfile: { id: profile.id, modelId: profile.modelId }, generationType: request.generationType,
    evidence: { excerptHash: 'c'.repeat(64), estimatedTokens: 50, messageCount: 2 },
    budget: {
      inputCeilingTokens: 31_232, campaignBudgetTokens: 2_000, existingMessageTokens: 50,
      usedCampaignTokens: 100, remainingCampaignTokens: 1_900,
    },
    selections: [], omissions: [], ambiguities: [],
    blocks: { known: 'Campaign: Court Intrigue\nCurrent scene: The library.', secret: 'The steward has the key.' },
    contentHash: 'd'.repeat(64),
  };
}

function harness() {
  const calls: Array<Record<string, unknown>> = [];
  const plans: PreflightContextRequest[] = [];
  const service = new NarrationService({
    authority: {
      readBinding: async () => structuredClone(binding),
      listNarratorModelProfiles: async () => [profile],
      plan: async request => {
        plans.push(structuredClone(request));
        return { ok: true as const, value: plan(request) };
      },
    },
    inference: new SerialInferenceLane(),
    lmStudio: {
      chat: async request => {
        calls.push(structuredClone(request));
        return new Response(JSON.stringify({
          id: 'chatcmpl-1', object: 'chat.completion', created: 1, model: 'qwen-test',
          choices: [{ index: 0, message: { role: 'assistant', content: 'Airi opens the wardrobe.' }, finish_reason: 'stop' }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    },
  });
  return { service, calls, plans };
}

const body = {
  model: 'qwen-test', stream: true,
  messages: [
    { role: 'system', content: 'Write as the narrator.' },
    { role: 'user', content: 'Airi opens the wardrobe.' },
  ],
  temperature: 0.8,
};

test('linked narration verifies authority, plans context, and makes exactly one buffered upstream call', async () => {
  const { service, calls, plans } = harness();
  const result = await service.respond(exchange, body, new AbortController().signal);

  assert.equal(result.kind, 'linked');
  if (result.kind !== 'linked') return;
  assert.equal(result.content, 'Airi opens the wardrobe.');
  assert.equal(result.stream, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.stream, false, 'linked upstream is always buffered');
  assert.equal(plans.length, 1);
  assert.deepEqual(plans[0], {
    requestId: exchange.requestId,
    campaignId: binding.campaignId,
    campaignRevision: binding.campaignAnchor,
    bindingId: binding.id,
    bindingRevision: binding.revision,
    contextFocusRevision: binding.contextFocusRevision,
    modelProfileId: profile.id,
    generationType: 'normal',
    messages: [{ role: 'user', content: 'Airi opens the wardrobe.' }],
  });
  const messages = calls[0]?.messages as Array<{ role: string; content: string }>;
  assert.deepEqual(messages.map(message => message.role), ['system', 'system', 'system', 'user']);
  assert.match(messages[1]?.content ?? '', /Campaign: Court Intrigue/);
  assert.match(messages[2]?.content ?? '', /steward has the key/);
  assert.equal(calls[0]?.temperature, 0.8);
});

test('linked locator mismatch and unverified marker fail before planning or model work', async () => {
  const { service, calls, plans } = harness();
  await assert.rejects(
    service.respond({
      ...exchange,
      locator: { ...exchange.locator, chat: { ...exchange.locator.chat, chatId: 'Copied chat' } },
    }, body, new AbortController().signal),
    (error: unknown) => error instanceof Error && error.message.includes('locator'),
  );
  assert.equal(plans.length, 0);
  assert.equal(calls.length, 0);
});

test('unlinked narration is forwarded exactly once without request mutation or Context access', async () => {
  const { service, calls, plans } = harness();
  const unlinked: NarrationExchange = {
    ...exchange,
    route: { kind: 'unlinked' },
    generation: 'quiet',
  };
  const result = await service.respond(unlinked, body, new AbortController().signal);
  assert.equal(result.kind, 'unlinked');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], body);
  assert.equal(plans.length, 0);
});

test('unlinked forwarding preserves absent stream and provider-specific fields exactly', async () => {
  const { service, calls } = harness();
  const unlinked: NarrationExchange = { ...exchange, route: { kind: 'unlinked' }, generation: 'quiet' };
  const providerBody = {
    model: 'qwen-test', messages: [{ role: 'user', content: 'Hello' }],
    provider_extension: { passthrough: true },
  };
  await service.respond(unlinked, providerBody, new AbortController().signal);
  assert.deepEqual(calls, [providerBody]);
  assert.equal('stream' in calls[0]!, false);
});

test('linked narration rejects tools, incompatible model, and reasoning-only output before delivery', async () => {
  const first = harness();
  await assert.rejects(
    first.service.respond(exchange, { ...body, tools: [] }, new AbortController().signal),
    /tools/,
  );
  assert.equal(first.calls.length, 0);

  const second = harness();
  await assert.rejects(
    second.service.respond(exchange, { ...body, model: 'other-model' }, new AbortController().signal),
    /model profile/,
  );
  assert.equal(second.calls.length, 0);

  const third = harness();
  third.service.lmStudio.chat = async () => new Response(JSON.stringify({
    id: 'chatcmpl-thinking', model: 'qwen-test',
    choices: [{ message: { role: 'assistant', content: '', reasoning_content: 'hidden only' }, finish_reason: 'stop' }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  await assert.rejects(
    third.service.respond(exchange, body, new AbortController().signal),
    /visible answer/,
  );
});

test('linked narration rejects ambiguous model profiles and malformed messages before inference', async () => {
  const calls: Array<Readonly<Record<string, unknown>>> = [];
  const service = new NarrationService({
    authority: {
      readBinding: async () => binding,
      listNarratorModelProfiles: async () => [profile, { ...profile, id: 'duplicate-profile' }],
      plan: async request => ({ ok: true, value: plan(request) }),
    },
    inference: new SerialInferenceLane(),
    lmStudio: {
      chat: async request => {
        calls.push(request);
        return new Response('{}');
      },
    },
  });
  await assert.rejects(service.respond(exchange, body, new AbortController().signal), /Multiple narrator model profiles/);
  assert.equal(calls.length, 0);

  const normal = harness();
  await assert.rejects(normal.service.respond(
    exchange,
    { ...body, messages: [null] },
    new AbortController().signal,
  ), /message must be an object/);
  assert.equal(normal.calls.length, 0);
});

test('serial inference lane never overlaps calls and skips an aborted queued call', async () => {
  const lane = new SerialInferenceLane();
  let active = 0;
  let maximum = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const first = lane.run(async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    await gate;
    active -= 1;
    return 'first';
  }, new AbortController().signal);
  const controller = new AbortController();
  const second = lane.run(async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    active -= 1;
    return 'second';
  }, controller.signal);
  controller.abort();
  release();
  assert.equal(await first, 'first');
  await assert.rejects(second, /cancelled/);
  assert.equal(maximum, 1);
});

test('narration preempts active worker inference and the worker restarts after narration', async () => {
  const lane = new SerialInferenceLane();
  const order: string[] = [];
  let workerRuns = 0;
  let workerStarted!: () => void;
  const started = new Promise<void>(resolve => { workerStarted = resolve; });
  const workerController = new AbortController();
  const safety = setTimeout(() => workerController.abort(), 500);
  const worker = lane.run(async signal => {
    workerRuns += 1;
    order.push(`worker-${workerRuns}-start`);
    if (workerRuns === 1) {
      workerStarted();
      await new Promise<void>((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('worker interrupted')), { once: true });
      });
    }
    order.push(`worker-${workerRuns}-finish`);
    return 'worker';
  }, workerController.signal, 'worker');
  await started;
  const narrator = lane.run(async () => {
    order.push('narrator');
    return 'narrator';
  }, new AbortController().signal, 'narration');
  assert.equal(await narrator, 'narrator');
  assert.equal(await worker, 'worker');
  clearTimeout(safety);
  assert.deepEqual(order, ['worker-1-start', 'narrator', 'worker-2-start', 'worker-2-finish']);
});

test('normal, regenerate, continue, and swipe remain distinct pinned Context intents', async () => {
  for (const generation of ['normal', 'regenerate', 'continue', 'swipe'] as const) {
    const current = harness();
    const result = await current.service.respond(
      { ...exchange, generation, requestId: crypto.randomUUID() },
      body,
      new AbortController().signal,
    );
    assert.equal(result.kind, 'linked');
    assert.equal(current.calls.length, 1);
    assert.equal(current.plans[0]?.generationType, generation);
  }
});

test('fragmented upstream JSON is fully buffered before one visible delivery', async () => {
  const current = harness();
  const json = JSON.stringify({
    id: 'chatcmpl-fragmented', model: profile.modelId,
    choices: [{ message: { role: 'assistant', content: 'Accepted after all fragments.' }, finish_reason: 'stop' }],
  });
  current.service.lmStudio.chat = async () => new Response(new ReadableStream({
    async start(controller) {
      controller.enqueue(new TextEncoder().encode(json.slice(0, 17)));
      await new Promise(resolve => setTimeout(resolve, 5));
      controller.enqueue(new TextEncoder().encode(json.slice(17)));
      controller.close();
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  const result = await current.service.respond(exchange, body, new AbortController().signal);
  assert.equal(result.kind, 'linked');
  if (result.kind === 'linked') assert.equal(result.content, 'Accepted after all fragments.');
});

test('malformed, empty, failed, and disconnected upstream calls never produce a delivery', async () => {
  const cases: Array<{ response?: Response; error?: Error; message: RegExp }> = [
    { response: new Response('{bad json', { status: 200 }), message: /malformed JSON/ },
    {
      response: new Response(JSON.stringify({ choices: [{ message: { content: '   ' } }] }), { status: 200 }),
      message: /no visible answer/,
    },
    { response: new Response('model unavailable', { status: 503 }), message: /HTTP 503/ },
    { error: new Error('socket disconnected'), message: /socket disconnected/ },
    { error: new DOMException('request timed out', 'TimeoutError'), message: /request timed out/ },
  ];
  for (const failure of cases) {
    const current = harness();
    current.service.lmStudio.chat = async () => {
      if (failure.error) throw failure.error;
      return failure.response!;
    };
    await assert.rejects(
      current.service.respond(
        { ...exchange, requestId: crypto.randomUUID() },
        body,
        new AbortController().signal,
      ),
      failure.message,
    );
  }
});

test('Campaign and budget outages make zero linked calls while explicit unlinked bypass still calls once', async () => {
  let calls = 0;
  const service = new NarrationService({
    authority: {
      readBinding: async () => { throw new Error('Campaign database offline'); },
      listNarratorModelProfiles: async () => [profile],
      plan: async request => ({
        ok: false,
        problem: {
          schema: 'st-rpg.problem', version: '1.0', code: 'CONTEXT_PINS_OVER_BUDGET',
          message: 'Pins exceed budget.', requestId: request.requestId, retryable: false, actions: [],
        },
      }),
    },
    inference: new SerialInferenceLane(),
    lmStudio: {
      chat: async () => {
        calls += 1;
        return new Response(JSON.stringify({ choices: [{ message: { content: 'UNLINKED' } }] }));
      },
    },
  });
  await assert.rejects(service.respond(exchange, body, new AbortController().signal), /Campaign authority is unavailable/);
  assert.equal(calls, 0);

  let bypassBody = '';
  await service.forwardUnlinked(
    { ...exchange, route: { kind: 'unlinked' } },
    body,
    new AbortController().signal,
    async response => { bypassBody = await response.text(); },
  );
  assert.equal(calls, 1);
  assert.match(bypassBody, /UNLINKED/);

  const budget = harness();
  budget.service.authority.plan = async request => ({
    ok: false,
    problem: {
      schema: 'st-rpg.problem', version: '1.0', code: 'CONTEXT_PINS_OVER_BUDGET',
      message: 'Pins exceed budget.', requestId: request.requestId, retryable: false, actions: [],
    },
  });
  await assert.rejects(budget.service.respond(exchange, body, new AbortController().signal), /Pins exceed budget/);
  assert.equal(budget.calls.length, 0);
});

test('continue delivers only the new suffix and never repeats the saved assistant prefix', async () => {
  const current = harness();
  current.service.lmStudio.chat = async request => {
    current.calls.push(structuredClone(request));
    return new Response(JSON.stringify({
      id: 'chatcmpl-continue', model: profile.modelId,
      choices: [{ message: { role: 'assistant', content: ' and closes the door.' }, finish_reason: 'stop' }],
    }));
  };
  const result = await current.service.respond(
    { ...exchange, generation: 'continue' },
    {
      ...body,
      messages: [
        { role: 'system', content: 'Narrate.' },
        { role: 'assistant', content: 'Airi opens the wardrobe' },
      ],
    },
    new AbortController().signal,
  );
  assert.equal(result.kind, 'linked');
  if (result.kind === 'linked') assert.equal(result.content, ' and closes the door.');
  const sentMessages = current.calls[0]?.messages;
  assert.ok(Array.isArray(sentMessages));
  assert.equal(sentMessages.at(-1)?.role, 'user');
  assert.match(String(sentMessages.at(-1)?.content), /only the new continuation text/i);
});
