import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  CampaignCommitPerformanceSchema,
  CampaignCommitSchema,
  CampaignDocumentSchema,
  CampaignHistoryEntrySchema,
  CampaignSummarySchema,
  CampaignVerificationResultSchema,
  CreateCampaignRequestSchema,
  ExecuteCampaignRequestSchema,
  ProblemSchema,
  type CreateCampaignRequest,
  type ExecuteCampaignRequest,
} from '@st-llm-rpg/wire';
import type { CampaignEngine, Outcome } from './campaign-engine.js';

function sendOutcome<T>(reply: FastifyReply, outcome: Outcome<T>, successStatus = 200) {
  if (outcome.ok) return reply.code(successStatus).send(outcome.value);
  return reply.code(outcome.statusCode).send(outcome.problem);
}

export function registerCampaignRoutes(app: FastifyInstance, engine: CampaignEngine): void {
  app.get('/api/campaign-authority/performance', {
    schema: { response: { 200: CampaignCommitPerformanceSchema, 503: ProblemSchema } },
  }, async (request, reply) => sendOutcome(reply, await engine.performance(String(request.id))));

  app.post('/api/campaign-authority/verify', {
    schema: { response: { 200: CampaignVerificationResultSchema, 503: ProblemSchema } },
  }, async (request, reply) => sendOutcome(reply, await engine.verify(String(request.id))));

  app.get('/api/campaigns', {
    schema: { response: { 200: { type: 'array', items: CampaignSummarySchema }, 503: ProblemSchema } },
  }, async (request, reply) => sendOutcome(reply, await engine.list(String(request.id))));

  app.post('/api/campaigns', {
    schema: {
      body: CreateCampaignRequestSchema,
      response: { 201: CampaignCommitSchema, 400: ProblemSchema, 409: ProblemSchema, 503: ProblemSchema },
    },
  }, async (request, reply) => {
    const body = request.body as CreateCampaignRequest;
    return sendOutcome(reply, await engine.create(body), 201);
  });

  app.get('/api/campaigns/:campaignId', {
    schema: {
      params: {
        type: 'object',
        additionalProperties: false,
        required: ['campaignId'],
        properties: { campaignId: { type: 'string', minLength: 1, maxLength: 128 } },
      },
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: { revision: { type: 'integer', minimum: 1 } },
      },
      response: { 200: CampaignDocumentSchema, 404: ProblemSchema, 503: ProblemSchema },
    },
  }, async (request, reply) => {
    const { campaignId } = request.params as { campaignId: string };
    const { revision } = request.query as { revision?: number };
    return sendOutcome(reply, await engine.read(campaignId, String(request.id), revision));
  });

  app.get('/api/campaigns/:campaignId/history', {
    schema: {
      params: {
        type: 'object',
        additionalProperties: false,
        required: ['campaignId'],
        properties: { campaignId: { type: 'string', minLength: 1, maxLength: 128 } },
      },
      response: {
        200: { type: 'array', items: CampaignHistoryEntrySchema },
        404: ProblemSchema,
        503: ProblemSchema,
      },
    },
  }, async (request, reply) => {
    const { campaignId } = request.params as { campaignId: string };
    return sendOutcome(reply, await engine.history(campaignId, String(request.id)));
  });

  app.post('/api/campaigns/:campaignId/operations', {
    schema: {
      params: {
        type: 'object',
        additionalProperties: false,
        required: ['campaignId'],
        properties: { campaignId: { type: 'string', minLength: 1, maxLength: 128 } },
      },
      body: ExecuteCampaignRequestSchema,
      response: {
        200: CampaignCommitSchema,
        400: ProblemSchema,
        404: ProblemSchema,
        409: ProblemSchema,
        503: ProblemSchema,
      },
    },
  }, async (request, reply) => {
    const { campaignId } = request.params as { campaignId: string };
    const body = request.body as ExecuteCampaignRequest;
    return sendOutcome(reply, await engine.execute(campaignId, body));
  });
}
