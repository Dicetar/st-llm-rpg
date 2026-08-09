import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  ApplyLegacyImportRequestSchema,
  ChatBindingDocumentSchema,
  LegacyChatListItemSchema,
  LegacyImportPreviewSchema,
  LegacyImportResultSchema,
  PreviewLegacyImportRequestSchema,
  ProblemSchema,
  type ApplyLegacyImportRequest,
  type PreviewLegacyImportRequest,
  type ProblemCode,
} from '@st-llm-rpg/wire';
import type { Outcome } from '../campaign/campaign-engine.js';
import type { LegacyImportService } from './legacy-import-service.js';

function statusFor(code: ProblemCode): number {
  if (code === 'LEGACY_METADATA_NOT_FOUND' || code === 'CHAT_BINDING_NOT_FOUND') return 404;
  if (code === 'LEGACY_IMPORT_STALE' || code === 'LEGACY_IMPORT_COLLISION' || code === 'CAMPAIGN_REVISION_CONFLICT') return 409;
  if (code === 'SILLYTAVERN_CHAT_UNAVAILABLE') return 503;
  if (code === 'LEGACY_IMPORT_INVALID' || code === 'CAMPAIGN_VALIDATION_FAILED') return 400;
  return 503;
}

function send<T>(reply: FastifyReply, outcome: Outcome<T>, success = 200) {
  if (outcome.ok) return reply.code(success).send(outcome.value);
  return reply.code(statusFor(outcome.problem.code)).send(outcome.problem);
}

export function registerLegacyImportRoutes(app: FastifyInstance, service: LegacyImportService): void {
  app.get('/api/migrations/legacy-chats', {
    schema: { response: { 200: { type: 'array', items: LegacyChatListItemSchema }, 503: ProblemSchema } },
  }, async (request, reply) => send(reply, await service.list(String(request.id))));

  app.post('/api/migrations/legacy-preview', {
    schema: {
      body: PreviewLegacyImportRequestSchema,
      response: { 200: LegacyImportPreviewSchema, 400: ProblemSchema, 404: ProblemSchema, 409: ProblemSchema, 503: ProblemSchema },
    },
  }, async (request, reply) => {
    const body = request.body as PreviewLegacyImportRequest;
    return send(reply, await service.preview(body.locator, String(request.id)));
  });

  app.post('/api/migrations/legacy-import', {
    schema: {
      body: ApplyLegacyImportRequestSchema,
      response: {
        201: LegacyImportResultSchema,
        400: ProblemSchema,
        409: ProblemSchema,
        503: ProblemSchema,
      },
    },
  }, async (request, reply) => send(
    reply,
    await service.apply(request.body as ApplyLegacyImportRequest),
    201,
  ));

  app.get('/api/chat-bindings/:bindingId', {
    schema: {
      params: {
        type: 'object',
        additionalProperties: false,
        required: ['bindingId'],
        properties: { bindingId: { type: 'string', minLength: 1, maxLength: 128 } },
      },
      response: { 200: ChatBindingDocumentSchema, 404: ProblemSchema, 503: ProblemSchema },
    },
  }, async (request, reply) => {
    const { bindingId } = request.params as { bindingId: string };
    return send(reply, await service.binding(bindingId, String(request.id)));
  });

  app.get('/api/campaigns/:campaignId/chat-bindings', {
    schema: {
      params: {
        type: 'object',
        additionalProperties: false,
        required: ['campaignId'],
        properties: { campaignId: { type: 'string', minLength: 1, maxLength: 128 } },
      },
      response: {
        200: { type: 'array', items: ChatBindingDocumentSchema },
        404: ProblemSchema,
        503: ProblemSchema,
      },
    },
  }, async (request, reply) => {
    const { campaignId } = request.params as { campaignId: string };
    return send(reply, await service.bindings(campaignId, String(request.id)));
  });

  app.post('/api/chat-bindings/:bindingId/retry-marker', {
    schema: {
      params: {
        type: 'object',
        additionalProperties: false,
        required: ['bindingId'],
        properties: { bindingId: { type: 'string', minLength: 1, maxLength: 128 } },
      },
      response: { 200: ChatBindingDocumentSchema, 404: ProblemSchema, 503: ProblemSchema },
    },
  }, async (request, reply) => {
    const { bindingId } = request.params as { bindingId: string };
    return send(reply, await service.retryMarker(bindingId, String(request.id)));
  });
}
