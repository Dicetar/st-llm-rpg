import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  NarrationStatusDocumentSchema,
  NarrationExchangeError,
  decodeNarrationExchange,
  readNarrationExchangeHeader,
  type NarrationExchange,
} from '@st-llm-rpg/wire';
import { makeProblem, ProblemError } from '../../problem.js';
import { NarrationStatus } from './narration-status.js';
import type { NarrationDelivery, UnlinkedResponseConsumer } from './narration-service.js';

const MAX_CHAT_BODY_BYTES = 4 * 1024 * 1024;

export interface NarrationHttpService {
  respond(exchange: NarrationExchange, body: unknown, signal: AbortSignal): Promise<NarrationDelivery>;
  forwardUnlinked(
    exchange: NarrationExchange,
    body: unknown,
    signal: AbortSignal,
    consume: UnlinkedResponseConsumer,
  ): Promise<void>;
  models(signal: AbortSignal): Promise<Response>;
}

function openAiError(problem: ReturnType<typeof makeProblem>) {
  return {
    error: {
      message: problem.message,
      type: 'st_rpg_problem',
      param: null,
      code: problem.code,
    },
    problem,
  };
}

function problemFor(error: unknown, requestId: string) {
  if (error instanceof ProblemError) return { status: error.statusCode, problem: error.problem };
  if (error instanceof NarrationExchangeError) {
    return {
      status: 400,
      problem: makeProblem({
        code: 'NARRATION_EXCHANGE_INVALID', message: error.message, requestId,
        actions: [{ id: 'inspect-bridge', label: 'Inspect the RPG Companion bridge', kind: 'inspect' }],
      }),
    };
  }
  return {
    status: 502,
    problem: makeProblem({
      code: 'NARRATION_UPSTREAM_FAILED',
      message: error instanceof Error ? error.message : 'Narration failed.',
      requestId,
      retryable: true,
      actions: [{ id: 'inspect-terminal', label: 'Inspect the companion terminal', kind: 'inspect' }],
    }),
  };
}

function copyResponseMetadata(response: Response, reply: FastifyReply): void {
  reply.code(response.status);
  for (const name of ['content-type', 'cache-control']) {
    const value = response.headers.get(name);
    if (value) reply.header(name, value);
  }
}

function completionPart(completion: Readonly<Record<string, unknown>>, key: string, fallback: unknown): unknown {
  return completion[key] ?? fallback;
}

function finishReason(completion: Readonly<Record<string, unknown>>): unknown {
  const choices = completion.choices;
  const first = Array.isArray(choices) ? choices[0] : undefined;
  return typeof first === 'object' && first !== null ? (first as Record<string, unknown>).finish_reason ?? 'stop' : 'stop';
}

function linkedSse(delivery: Extract<NarrationDelivery, { kind: 'linked' }>, requestId: string): string {
  const base = {
    id: completionPart(delivery.completion, 'id', `chatcmpl-${requestId}`),
    object: 'chat.completion.chunk',
    created: completionPart(delivery.completion, 'created', Math.floor(Date.now() / 1000)),
    model: completionPart(delivery.completion, 'model', 'narrator'),
  };
  const content = {
    ...base,
    choices: [{ index: 0, delta: { role: 'assistant', content: delivery.content }, finish_reason: null }],
  };
  const finish = {
    ...base,
    choices: [{ index: 0, delta: {}, finish_reason: finishReason(delivery.completion) }],
  };
  return `data: ${JSON.stringify(content)}\n\ndata: ${JSON.stringify(finish)}\n\ndata: [DONE]\n\n`;
}

function cancellation(request: { raw: NodeJS.EventEmitter }, reply: FastifyReply) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const abortClosedResponse = () => {
    if (!reply.raw.writableEnded) abort();
  };
  request.raw.once('aborted', abort);
  reply.raw.once('close', abortClosedResponse);
  return {
    signal: controller.signal,
    dispose() {
      request.raw.removeListener('aborted', abort);
      reply.raw.removeListener('close', abortClosedResponse);
    },
  };
}

export function registerNarrationRoutes(
  app: FastifyInstance,
  service: NarrationHttpService,
  status = new NarrationStatus(),
): void {
  app.get('/api/narration/status', {
    schema: { response: { 200: NarrationStatusDocumentSchema } },
  }, async () => status.document());

  app.get('/v1/models', async (request, reply) => {
    const cancel = cancellation(request, reply);
    try {
      const response = await service.models(cancel.signal);
      copyResponseMetadata(response, reply);
      return reply.send(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      const result = problemFor(error, String(request.id));
      return reply.code(result.status).send(openAiError(result.problem));
    } finally {
      cancel.dispose();
    }
  });

  app.post('/v1/chat/completions', {
    bodyLimit: MAX_CHAT_BODY_BYTES,
    errorHandler(error, request, reply) {
      const candidate = error as Error & { statusCode?: number };
      const statusCode = Number.isInteger(candidate.statusCode) && Number(candidate.statusCode) >= 400 && Number(candidate.statusCode) < 500
        ? Number(candidate.statusCode)
        : 502;
      const problem = makeProblem({
        code: statusCode < 500 ? 'NARRATION_EXCHANGE_INVALID' : 'NARRATION_UPSTREAM_FAILED',
        message: candidate.message || 'Narration request failed.',
        requestId: String(request.id),
        retryable: statusCode >= 500,
        actions: [{
          id: statusCode === 413 ? 'reduce-context' : 'inspect-bridge',
          label: statusCode === 413
            ? 'Reduce the SillyTavern prompt or context size, then retry.'
            : 'Reload SillyTavern and inspect the RPG Companion bridge before retrying.',
          kind: 'inspect',
        }],
      });
      status.rejectInvalid(String(request.id), problem, statusCode);
      void reply.code(statusCode).send(openAiError(problem));
    },
  }, async (request, reply) => {
    const cancel = cancellation(request, reply);
    let exchange: NarrationExchange;
    try {
      exchange = decodeNarrationExchange(readNarrationExchangeHeader(request.raw.rawHeaders));
    } catch (error) {
      cancel.dispose();
      const result = problemFor(error, String(request.id));
      status.rejectInvalid(String(request.id), result.problem, result.status);
      return reply.code(result.status).send(openAiError(result.problem));
    }
    const trace = status.begin(exchange);

    try {
      if (exchange.route.kind === 'unlinked') {
        let upstreamStatus = 200;
        await service.forwardUnlinked(exchange, request.body, cancel.signal, async response => {
          upstreamStatus = response.status;
          copyResponseMetadata(response, reply);
          if (!response.body) {
            reply.send();
            return;
          }
          const stream = Readable.fromWeb(response.body as never);
          reply.send(stream);
          await finished(stream);
        });
        if (upstreamStatus >= 400) {
          trace.finish({
            state: 'failed',
            httpStatus: upstreamStatus,
            problem: makeProblem({
              code: 'NARRATION_UPSTREAM_FAILED',
              message: `LM Studio returned HTTP ${upstreamStatus} for unlinked narration.`,
              requestId: exchange.requestId,
              retryable: true,
              actions: [{
                id: 'inspect-lm-studio',
                label: 'Check that LM Studio is running on port 1234, then retry in SillyTavern.',
                kind: 'inspect',
              }],
            }),
          });
        } else {
          trace.finish({ state: 'completed', httpStatus: upstreamStatus });
        }
        return reply;
      }

      const delivery = await service.respond(exchange, request.body, cancel.signal);
      if (delivery.kind !== 'linked') throw new Error('Linked narration returned an unlinked delivery.');
      trace.finish({ state: 'completed', httpStatus: 200 });
      if (delivery.stream) {
        return reply.type('text/event-stream; charset=utf-8').send(linkedSse(delivery, exchange.requestId));
      }
      return reply.type('application/json; charset=utf-8').send(delivery.completion);
    } catch (error) {
      const result = problemFor(error, exchange.requestId);
      if (cancel.signal.aborted) trace.finish({ state: 'cancelled', httpStatus: 499 });
      else trace.finish({
        state: result.status < 500 ? 'rejected' : 'failed',
        httpStatus: result.status,
        problem: result.problem,
      });
      if (reply.sent) return reply;
      return reply.code(result.status).send(openAiError(result.problem));
    } finally {
      cancel.dispose();
    }
  });
}
