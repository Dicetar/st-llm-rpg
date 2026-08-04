import { createHash, randomUUID } from 'node:crypto';
import http from 'node:http';
import process from 'node:process';
import readline from 'node:readline';
import { createAdmissionFailureSummary, createAttemptSummary, createState, reduceState } from './exchange-state.mjs';

const LISTEN_HOST = process.env.RPG_PROXY_HOST || '0.0.0.0';
const LISTEN_PORT = Number(process.env.RPG_PROXY_PORT || 8002);
const LM_STUDIO_BASE = String(process.env.RPG_PROXY_LM_STUDIO || 'http://127.0.0.1:1234/v1').replace(/\/$/, '');
const HEADER = 'x-st-rpg-exchange';
const BODY_LIMIT = 4 * 1024 * 1024;
const ST_REVISION = '380e31e8c58d196969b6a0da74f431ba999c7e0a';

let state = createState({
  listenUrl: `http://${LISTEN_HOST}:${LISTEN_PORT}`,
  lmStudioUrl: LM_STUDIO_BASE,
  startedAt: new Date().toISOString(),
});
const acceptedLocators = new Map();
const seenRequestIds = new Set();

function dispatch(event) {
  state = reduceState(state, event);
  render();
}

function corsHeaders(extra = {}) {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,x-st-rpg-exchange',
    ...extra,
  };
}

function sendJson(response, status, value, headers = {}) {
  if (response.destroyed || response.writableEnded) return false;
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, corsHeaders({
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.byteLength),
    ...headers,
  }));
  response.end(body);
  return true;
}

function problem(response, status, code, message, correlationId, stage, actions = []) {
  return sendJson(response, status, {
    error: {
      message: `${message} [RPG request ${correlationId}]`,
      type: 'rpg_narration_error',
      code,
      param: null,
      request_id: correlationId,
      stage,
      retryable: false,
      actions,
    },
  });
}

async function readBody(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.byteLength;
    if (length > BODY_LIMIT) throw new Error('BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks);
  return { raw, json: JSON.parse(raw.toString('utf8')) };
}

function decodeExchange(rawHeader) {
  if (typeof rawHeader !== 'string') throw new Error('RPG_ROUTING_METADATA_MISSING');
  if (!rawHeader.startsWith('v1.')) throw new Error('RPG_ROUTING_METADATA_INVALID');
  let envelope;
  try {
    const encoded = rawHeader.slice(3);
    const decoded = Buffer.from(encoded, 'base64url');
    if (decoded.byteLength > 4096) throw new Error('invalid');
    envelope = JSON.parse(decoded.toString('utf8'));
  } catch {
    throw new Error('RPG_ROUTING_METADATA_INVALID');
  }
  const route = envelope?.route;
  const chat = envelope?.locator?.chat;
  if (
    envelope?.protocol !== 'st-rpg.narration'
    || envelope?.version !== 1
    || typeof envelope?.requestId !== 'string'
    || !['linked', 'unlinked'].includes(route?.kind)
    || !['normal', 'regenerate', 'continue', 'swipe', 'quiet', 'impersonate'].includes(envelope?.generation)
    || envelope?.bridge?.sillyTavernRevision !== ST_REVISION
    || envelope?.locator?.version !== 1
    || typeof envelope?.locator?.hostId !== 'string'
    || !['character', 'group'].includes(chat?.kind)
    || typeof chat?.ownerId !== 'string'
    || typeof chat?.chatId !== 'string'
    || (route.kind === 'linked' && typeof route.bindingId !== 'string')
    || (route.kind === 'unlinked' && 'bindingId' in route)
  ) {
    throw new Error('RPG_ROUTING_METADATA_INVALID');
  }
  return envelope;
}

function rawHeaderValues(request, name) {
  const values = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index].toLowerCase() === name.toLowerCase()) values.push(request.rawHeaders[index + 1]);
  }
  return values;
}

function sameLocator(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateLinked(envelope, body) {
  if (!state.control.campaignAvailable) {
    return { status: 503, code: 'RPG_CAMPAIGN_UNAVAILABLE', message: 'Prototype Campaign authority is unavailable' };
  }
  if (!['normal', 'regenerate', 'continue', 'swipe'].includes(envelope.generation)) {
    return { status: 422, code: 'RPG_GENERATION_UNSUPPORTED', message: `Linked ${envelope.generation} is unsupported` };
  }
  if (body?.n !== undefined && body.n !== 1) {
    return { status: 422, code: 'RPG_MULTIPLE_CHOICES_NOT_SUPPORTED', message: 'Linked narration requires n=1' };
  }
  if ((Array.isArray(body?.tools) && body.tools.length > 0) || body?.tool_choice) {
    return { status: 422, code: 'RPG_NARRATOR_TOOLS_NOT_SUPPORTED', message: 'Linked narration does not allow narrator tools' };
  }
  if (!Array.isArray(body?.messages) || typeof body?.model !== 'string') {
    return { status: 400, code: 'RPG_CHAT_COMPLETION_INVALID', message: 'Invalid Chat Completion request' };
  }
  const accepted = acceptedLocators.get(envelope.route.bindingId);
  if (!accepted) acceptedLocators.set(envelope.route.bindingId, structuredClone(envelope.locator));
  else if (!sameLocator(accepted, envelope.locator)) {
    return { status: 409, code: 'RPG_BINDING_COLLISION', message: 'The prototype Binding was presented by another Chat Locator' };
  }
  return null;
}

function requestHeaders(request) {
  const headers = { 'content-type': 'application/json' };
  const authorization = request.headers.authorization;
  if (typeof authorization === 'string' && !/^Bearer\s+(undefined|null)?$/i.test(authorization)) {
    headers.authorization = authorization;
  }
  return headers;
}

function delay(ms, signal) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error('aborted'));
    }, { once: true });
  });
}

async function fixtureResult(body, signal) {
  if (signal.aborted) throw signal.reason ?? new Error('aborted');
  return {
    text: state.control.fixtureText,
    model: String(body.model),
    finishReason: 'stop',
    upstreamStatus: 200,
    chunks: 1,
    bytes: Buffer.byteLength(state.control.fixtureText),
  };
}

async function liveLinkedResult(body, raw, request, signal, traceId) {
  dispatch({ type: 'upstream', traceId, at: new Date().toISOString() });
  const upstream = await fetch(`${LM_STUDIO_BASE}/chat/completions`, {
    method: 'POST',
    headers: requestHeaders(request),
    body: raw,
    signal,
  });
  if (!upstream.ok) {
    const text = await upstream.text();
    throw new Error(`UPSTREAM_${upstream.status}:${text.slice(0, 300)}`);
  }
  dispatch({
    type: 'stage', traceId, stage: 'upstream-response', at: new Date().toISOString(),
    patch: { upstreamStatus: upstream.status },
  });

  if (body.stream !== true) {
    const json = await upstream.json();
    const text = String(json?.choices?.[0]?.message?.content ?? '');
    return {
      text,
      model: String(json?.model ?? body.model),
      finishReason: json?.choices?.[0]?.finish_reason ?? 'stop',
      upstreamStatus: upstream.status,
      chunks: 1,
      bytes: Buffer.byteLength(JSON.stringify(json)),
    };
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let model = String(body.model);
  let finishReason = 'stop';
  let chunks = 0;
  let bytes = 0;

  const consumeEvent = event => {
    const lines = event.split(/\r?\n/).filter(line => line.startsWith('data:'));
    for (const line of lines) {
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      const json = JSON.parse(data);
      chunks += 1;
      model = String(json?.model ?? model);
      const delta = json?.choices?.[0]?.delta;
      if (typeof delta?.content === 'string') text += delta.content;
      if (json?.choices?.[0]?.finish_reason) finishReason = json.choices[0].finish_reason;
    }
  };

  for await (const chunk of upstream.body) {
    bytes += chunk.byteLength;
    buffer += decoder.decode(chunk, { stream: true });
    let boundary;
    while ((boundary = buffer.search(/\r?\n\r?\n/)) >= 0) {
      const event = buffer.slice(0, boundary);
      const separator = buffer.slice(boundary).match(/^\r?\n\r?\n/)[0];
      buffer = buffer.slice(boundary + separator.length);
      consumeEvent(event);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) consumeEvent(buffer);

  return { text, model, finishReason, upstreamStatus: upstream.status, chunks, bytes };
}

function sendAtomic(response, body, envelope, result) {
  if (response.destroyed || response.writableEnded) return false;
  const id = `chatcmpl-rpg-${envelope.requestId}`;
  const created = Math.floor(Date.now() / 1000);
  if (body.stream === true) {
    const content = JSON.stringify({
      id,
      object: 'chat.completion.chunk',
      created,
      model: result.model,
      choices: [{ index: 0, delta: { role: 'assistant', content: result.text }, finish_reason: null }],
    });
    const finish = JSON.stringify({
      id,
      object: 'chat.completion.chunk',
      created,
      model: result.model,
      choices: [{ index: 0, delta: {}, finish_reason: result.finishReason }],
    });
    const encoded = `data: ${content}\n\ndata: ${finish}\n\ndata: [DONE]\n\n`;
    response.writeHead(200, corsHeaders({
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    }));
    response.end(encoded);
    return true;
  }

  return sendJson(response, 200, {
    id,
    object: 'chat.completion',
    created,
    model: result.model,
    choices: [{ index: 0, message: { role: 'assistant', content: result.text }, finish_reason: result.finishReason }],
  });
}

async function transparentForward(request, response, raw, body, signal, traceId) {
  dispatch({ type: 'upstream', traceId, at: new Date().toISOString() });
  if (state.control.upstreamMode === 'unavailable') throw new Error('UPSTREAM_UNAVAILABLE');
  if (state.control.upstreamMode === 'fixture') {
    await delay(state.control.linkedDelayMs, signal);
    const result = await fixtureResult(body, signal);
    const committed = sendAtomic(response, body, {
      requestId: state.attempts.find(item => item.traceId === traceId).requestId,
    }, result);
    return { ...result, committed };
  }

  const upstream = await fetch(`${LM_STUDIO_BASE}/chat/completions`, {
    method: 'POST',
    headers: requestHeaders(request),
    body: raw,
    signal,
  });
  if (response.destroyed || signal.aborted) return { committed: false, upstreamStatus: upstream.status, chunks: 0, bytes: 0 };
  const headers = {};
  for (const [name, value] of upstream.headers) {
    if (!['content-length', 'transfer-encoding', 'content-encoding', 'connection'].includes(name.toLowerCase())) headers[name] = value;
  }
  response.writeHead(upstream.status, corsHeaders(headers));
  dispatch({
    type: 'stage', traceId, stage: 'upstream-response', at: new Date().toISOString(),
    patch: { upstreamStatus: upstream.status, responseCommitted: true },
  });
  let chunks = 0;
  let bytes = 0;
  for await (const chunk of upstream.body) {
    if (signal.aborted || response.destroyed) break;
    chunks += 1;
    bytes += chunk.byteLength;
    if (chunks === 1) {
      dispatch({
        type: 'stage', traceId, stage: 'streaming', at: new Date().toISOString(),
        patch: { upstreamChunks: chunks, upstreamBytes: bytes, responseCommitted: true },
      });
    }
    response.write(Buffer.from(chunk));
  }
  if (!response.destroyed && !response.writableEnded) response.end();
  return { committed: true, upstreamStatus: upstream.status, chunks, bytes, text: '', model: body.model };
}

async function handleCompletion(request, response) {
  const traceId = randomUUID();
  const started = performance.now();
  const receivedAt = new Date().toISOString();
  const controller = new AbortController();
  let terminal = false;
  let envelope;
  let rawBody = Buffer.alloc(0);

  const cancel = () => {
    if (terminal || controller.signal.aborted) return;
    controller.abort(new Error('client disconnected'));
  };
  request.once('aborted', cancel);
  response.once('close', () => {
    if (!response.writableEnded) cancel();
  });

  try {
    const { raw, json: body } = await readBody(request);
    rawBody = raw;
    const exchangeHeaders = rawHeaderValues(request, HEADER);
    if (exchangeHeaders.length === 0) throw new Error('RPG_ROUTING_METADATA_MISSING');
    if (exchangeHeaders.length !== 1) throw new Error('RPG_ROUTING_METADATA_DUPLICATE');
    envelope = decodeExchange(exchangeHeaders[0]);
    const summary = createAttemptSummary({
      traceId,
      receivedAt,
      envelope,
      body,
      bodyHash: createHash('sha256').update(raw).digest('hex'),
      bodyBytes: raw.byteLength,
    });
    dispatch({ type: 'received', attempt: summary });

    if (seenRequestIds.has(envelope.requestId)) {
      const committed = problem(response, 409, 'RPG_REQUEST_ID_REUSED', 'Request IDs identify one attempt and cannot be replayed', envelope.requestId, 'metadata');
      terminal = true;
      dispatch({
        type: 'terminal', traceId, outcome: 'rejected', at: new Date().toISOString(),
        elapsedMs: Math.round(performance.now() - started),
        patch: { problemCode: 'RPG_REQUEST_ID_REUSED', responseCommitted: committed },
      });
      return;
    }
    seenRequestIds.add(envelope.requestId);

    if (envelope.route.kind === 'linked') {
      const invalid = validateLinked(envelope, body);
      if (invalid) {
        const committed = problem(response, invalid.status, invalid.code, invalid.message, envelope.requestId, 'binding');
        terminal = true;
        dispatch({
          type: 'terminal', traceId, outcome: 'rejected', at: new Date().toISOString(),
          elapsedMs: Math.round(performance.now() - started),
          patch: { problemCode: invalid.code, responseCommitted: committed },
        });
        return;
      }
      dispatch({ type: 'stage', traceId, stage: 'binding-verified', at: new Date().toISOString() });
      await delay(state.control.linkedDelayMs, controller.signal);
      let result;
      if (state.control.upstreamMode === 'unavailable') throw new Error('UPSTREAM_UNAVAILABLE');
      if (state.control.upstreamMode === 'fixture') {
        dispatch({ type: 'upstream', traceId, at: new Date().toISOString() });
        result = await fixtureResult(body, controller.signal);
      } else {
        result = await liveLinkedResult(body, raw, request, controller.signal, traceId);
      }
      if (!result.text) throw new Error('EMPTY_VISIBLE_OUTPUT');
      dispatch({
        type: 'stage', traceId, stage: 'final-buffered', at: new Date().toISOString(),
        patch: {
          upstreamStatus: result.upstreamStatus,
          upstreamChunks: result.chunks,
          upstreamBytes: result.bytes,
          visibleChars: result.text.length,
        },
      });
      if (controller.signal.aborted) throw controller.signal.reason;
      const committed = sendAtomic(response, body, envelope, result);
      terminal = true;
      dispatch({
        type: 'terminal', traceId, outcome: committed ? 'completed' : 'cancelled', at: new Date().toISOString(),
        elapsedMs: Math.round(performance.now() - started),
        patch: { responseCommitted: committed, cancelled: !committed },
      });
      return;
    }

    const result = await transparentForward(request, response, raw, body, controller.signal, traceId);
    terminal = true;
    dispatch({
      type: 'terminal', traceId, outcome: controller.signal.aborted ? 'cancelled' : 'completed', at: new Date().toISOString(),
      elapsedMs: Math.round(performance.now() - started),
      patch: {
        upstreamStatus: result.upstreamStatus,
        upstreamChunks: result.chunks,
        upstreamBytes: result.bytes,
        responseCommitted: Boolean(result.committed),
        cancelled: controller.signal.aborted,
      },
    });
  } catch (error) {
    const cancelled = controller.signal.aborted || error?.name === 'AbortError';
    terminal = true;
    const correlationId = envelope?.requestId ?? traceId;
    const message = String(error?.message ?? error);
    const code = cancelled
      ? 'RPG_CANCELLED'
      : message === 'BODY_TOO_LARGE'
        ? 'RPG_CHAT_COMPLETION_TOO_LARGE'
        : message.startsWith('RPG_ROUTING_')
          ? message
          : message === 'EMPTY_VISIBLE_OUTPUT'
            ? 'RPG_EMPTY_REPLY'
            : 'RPG_NARRATOR_UNAVAILABLE';
    if (!state.attempts.some(item => item.traceId === traceId)) {
      dispatch({
        type: 'received',
        attempt: createAdmissionFailureSummary({
          traceId,
          receivedAt,
          bodyHash: rawBody.byteLength ? createHash('sha256').update(rawBody).digest('hex') : null,
          bodyBytes: rawBody.byteLength,
        }),
      });
    }
    const existing = state.attempts.find(item => item.traceId === traceId);
    let committed = Boolean(existing?.responseCommitted);
    if (!cancelled) {
      const status = code === 'RPG_NARRATOR_UNAVAILABLE'
        ? 503
        : code === 'RPG_EMPTY_REPLY'
          ? 502
          : 400;
      committed = problem(response, status, code, message.slice(0, 300), correlationId, envelope ? 'draft' : 'metadata') || committed;
    }
    const outcome = cancelled ? 'cancelled' : code.startsWith('RPG_ROUTING_') ? 'rejected' : 'failed';
    dispatch({
      type: 'terminal', traceId, outcome, at: new Date().toISOString(),
      elapsedMs: Math.round(performance.now() - started),
      patch: { responseCommitted: committed, cancelled, problemCode: code },
    });
  }
}

async function handleModels(request, response) {
  const controller = new AbortController();
  request.once('aborted', () => controller.abort());
  try {
    const upstream = await fetch(`${LM_STUDIO_BASE}/models`, { signal: controller.signal });
    const body = Buffer.from(await upstream.arrayBuffer());
    response.writeHead(upstream.status, corsHeaders({ 'content-type': upstream.headers.get('content-type') ?? 'application/json' }));
    response.end(body);
  } catch (error) {
    problem(response, 503, 'RPG_NARRATOR_UNAVAILABLE', String(error.message ?? error), randomUUID(), 'request');
  }
}

async function handleControl(request, response) {
  try {
    const { json } = await readBody(request);
    if (json?.reset === true) dispatch({ type: 'clear' });
    const patch = {};
    if (typeof json?.campaignAvailable === 'boolean') patch.campaignAvailable = json.campaignAvailable;
    if (['live', 'fixture', 'unavailable'].includes(json?.upstreamMode)) patch.upstreamMode = json.upstreamMode;
    if (Number.isInteger(json?.linkedDelayMs) && json.linkedDelayMs >= 0 && json.linkedDelayMs <= 60000) patch.linkedDelayMs = json.linkedDelayMs;
    if (typeof json?.fixtureText === 'string' && json.fixtureText.length <= 2000) patch.fixtureText = json.fixtureText;
    if (Object.keys(patch).length) dispatch({ type: 'control', patch });
    sendJson(response, 200, state);
  } catch (error) {
    sendJson(response, 400, { error: String(error.message ?? error) });
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);
  if (request.method === 'OPTIONS') {
    response.writeHead(204, corsHeaders());
    response.end();
    return;
  }
  if (request.method === 'GET' && url.pathname === '/prototype/state') return sendJson(response, 200, state);
  if (request.method === 'POST' && url.pathname === '/prototype/control') return handleControl(request, response);
  if (request.method === 'GET' && url.pathname === '/v1/models') return handleModels(request, response);
  if (request.method === 'POST' && url.pathname === '/v1/chat/completions') return handleCompletion(request, response);
  return sendJson(response, 404, { error: 'Not found' });
});

function render() {
  if (!process.stdout.isTTY) return;
  console.clear();
  const bold = '\x1b[1m';
  const dim = '\x1b[2m';
  const reset = '\x1b[0m';
  console.log(`${bold}THROWAWAY ST narrator proxy spike${reset}`);
  console.log(`${dim}${state.listenUrl} -> ${state.lmStudioUrl}${reset}`);
  console.log('');
  console.log(`${bold}Control${reset}`);
  console.log(JSON.stringify(state.control, null, 2));
  console.log(`${bold}Totals${reset}`);
  console.log(JSON.stringify(state.totals, null, 2));
  console.log(`${bold}Recent attempts${reset}`);
  console.log(JSON.stringify(state.attempts.slice(0, 4), null, 2));
  console.log('');
  console.log(`${bold}[o]${reset} ${dim}Campaign outage${reset}  ${bold}[f]${reset} ${dim}live/fixture${reset}  ${bold}[d]${reset} ${dim}delay${reset}  ${bold}[c]${reset} ${dim}clear${reset}  ${bold}[q]${reset} ${dim}quit${reset}`);
}

function installKeyboard() {
  if (!process.stdin.isTTY) return;
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.on('keypress', (_text, key) => {
    if (key?.ctrl && key.name === 'c') return shutdown();
    if (key?.name === 'q') return shutdown();
    if (key?.name === 'o') return dispatch({ type: 'control', patch: { campaignAvailable: !state.control.campaignAvailable } });
    if (key?.name === 'f') return dispatch({ type: 'control', patch: { upstreamMode: state.control.upstreamMode === 'live' ? 'fixture' : 'live' } });
    if (key?.name === 'd') return dispatch({ type: 'control', patch: { linkedDelayMs: state.control.linkedDelayMs ? 0 : 10000 } });
    if (key?.name === 'c') return dispatch({ type: 'clear' });
  });
}

function shutdown() {
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  server.close(() => process.exit(0));
}

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  installKeyboard();
  render();
  if (!process.stdout.isTTY) console.log(JSON.stringify({ ready: true, listen: state.listenUrl, lmStudio: state.lmStudioUrl }));
});

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
