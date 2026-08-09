import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  ChatBindingDocumentSchema,
  ContextPlanSchema,
  NarratorModelProfileSchema,
  PreflightContextRequestSchema,
  ProblemSchema,
  SetContextPinsRequestSchema,
  type NarratorModelProfile,
  type PreflightContextRequest,
  type ProblemCode,
  type SetContextPinsRequest,
} from '@st-llm-rpg/wire';
import type { Outcome } from '../campaign/campaign-engine.js';
import type { ContextService } from './context-service.js';

const IdentifierParams = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: { id: { type: 'string', minLength: 1, maxLength: 128 } },
} as const;

function statusFor(code: ProblemCode): number {
  if (code === 'CAMPAIGN_VALIDATION_FAILED' || code === 'CONTEXT_MODEL_INCOMPATIBLE') return 400;
  if (code === 'CHAT_BINDING_NOT_FOUND' || code === 'CONTEXT_MODEL_PROFILE_MISSING') return 404;
  if (code === 'CAMPAIGN_REVISION_CONFLICT' || code === 'CONTEXT_AUTHORITY_MISMATCH') return 409;
  if (
    code === 'CONTEXT_CORE_OVER_BUDGET'
    || code === 'CONTEXT_PINS_OVER_BUDGET'
    || code === 'CONTEXT_STALE_PIN'
    || code === 'CONTEXT_PRIVATE_PIN'
  ) return 422;
  if (code === 'CONTEXT_CANCELLED') return 409;
  return 503;
}

function send<T>(reply: FastifyReply, outcome: Outcome<T>) {
  if (outcome.ok) return reply.code(200).send(outcome.value);
  return reply.code(statusFor(outcome.problem.code)).send(outcome.problem);
}

export function registerContextRoutes(app: FastifyInstance, service: ContextService): void {
  app.get('/api/narrator-model-profiles', {
    schema: {
      response: {
        200: { type: 'array', items: NarratorModelProfileSchema },
        503: ProblemSchema,
      },
    },
  }, async (request, reply) => send(reply, await service.profiles(String(request.id))));

  app.put('/api/narrator-model-profiles/:id', {
    schema: {
      params: IdentifierParams,
      body: NarratorModelProfileSchema,
      response: { 200: NarratorModelProfileSchema, 400: ProblemSchema, 503: ProblemSchema },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    return send(reply, await service.saveProfile(id, request.body as NarratorModelProfile, String(request.id)));
  });

  app.put('/api/chat-bindings/:id/context-pins', {
    schema: {
      params: IdentifierParams,
      body: SetContextPinsRequestSchema,
      response: {
        200: ChatBindingDocumentSchema,
        400: ProblemSchema,
        404: ProblemSchema,
        409: ProblemSchema,
        422: ProblemSchema,
        503: ProblemSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    return send(reply, await service.setPins(id, request.body as SetContextPinsRequest));
  });

  app.post('/api/context-plans', {
    schema: {
      body: PreflightContextRequestSchema,
      response: {
        200: ContextPlanSchema,
        400: ProblemSchema,
        404: ProblemSchema,
        409: ProblemSchema,
        422: ProblemSchema,
        503: ProblemSchema,
      },
    },
  }, async (request, reply) => {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    const cancelClosedResponse = () => {
      if (!reply.raw.writableEnded) cancel();
    };
    request.raw.once('aborted', cancel);
    reply.raw.once('close', cancelClosedResponse);
    try {
      return send(reply, await service.plan(request.body as PreflightContextRequest, controller.signal));
    } finally {
      request.raw.off('aborted', cancel);
      reply.raw.off('close', cancelClosedResponse);
    }
  });
}
