import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  DecideStorySyncProposalRequestSchema,
  ProblemSchema,
  SaveWorkerModelProfileRequestSchema,
  StartStorySyncJobRequestSchema,
  StorySyncJobDocumentSchema,
  StorySyncJobReceiptSchema,
  WorkerModelProfileSchema,
  type DecideStorySyncProposalRequest,
  type ProblemCode,
  type SaveWorkerModelProfileRequest,
  type StartStorySyncJobRequest,
} from '@st-llm-rpg/wire';
import { makeProblem } from '../../problem.js';
import { CampaignExpectedError } from '../campaign/campaign-error.js';
import type { StorySyncService } from './story-sync-service.js';

function statusFor(code: ProblemCode): number {
  if (code === 'CHAT_BINDING_NOT_FOUND' || code === 'STORY_SYNC_JOB_NOT_FOUND' || code === 'STORY_SYNC_PROPOSAL_NOT_FOUND') return 404;
  if (
    code === 'CAMPAIGN_REVISION_CONFLICT'
    || code === 'STORY_SYNC_ALREADY_PENDING'
    || code === 'STORY_SYNC_PROPOSAL_REVISION_CONFLICT'
    || code === 'STORY_SYNC_REVIEW_LOCKED'
  ) return 409;
  if (code === 'STORY_SYNC_WORKER_MODEL_UNAVAILABLE') return 422;
  if (code.startsWith('STORY_SYNC_')) return 422;
  return 503;
}

async function send<T>(reply: FastifyReply, requestId: string, work: () => Promise<T>, success = 200) {
  try {
    return reply.code(success).send(await work());
  } catch (error) {
    if (error instanceof CampaignExpectedError) {
      return reply.code(statusFor(error.code)).send(makeProblem({
        code: error.code,
        message: error.message,
        requestId,
        actions: error.code === 'STORY_SYNC_WORKER_MODEL_UNAVAILABLE'
          ? [{ id: 'configure-worker', label: 'Configure the Campaign Worker model', kind: 'inspect' }]
          : [{ id: 'open-review', label: 'Open the Review Inbox', kind: 'inspect' }],
        ...(error.details === undefined ? {} : { details: error.details }),
      }));
    }
    throw error;
  }
}

export function registerStorySyncRoutes(app: FastifyInstance, service: StorySyncService): void {
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/story-sync')) return;
    reply.header('access-control-allow-origin', '*');
    reply.header('access-control-allow-methods', 'GET, PUT, POST, OPTIONS');
    reply.header('access-control-allow-headers', 'accept, content-type');
  });
  app.options('/api/story-sync/*', async (_request, reply) => reply.code(204).send());

  app.get('/api/story-sync/worker-profiles', {
    schema: { response: { 200: { type: 'array', items: WorkerModelProfileSchema }, 503: ProblemSchema } },
  }, async (request, reply) => send(reply, String(request.id), () => service.profiles()));

  app.put('/api/story-sync/worker-profile', {
    schema: {
      body: SaveWorkerModelProfileRequestSchema,
      response: { 200: WorkerModelProfileSchema, 400: ProblemSchema, 503: ProblemSchema },
    },
  }, async (request, reply) => send(
    reply,
    String(request.id),
    () => service.saveProfile(request.body as SaveWorkerModelProfileRequest),
  ));

  app.post('/api/story-sync/jobs', {
    schema: {
      body: StartStorySyncJobRequestSchema,
      response: { 202: StorySyncJobReceiptSchema, 404: ProblemSchema, 409: ProblemSchema, 422: ProblemSchema, 503: ProblemSchema },
    },
  }, async (request, reply) => send(
    reply,
    String(request.id),
    () => service.start(request.body as StartStorySyncJobRequest),
    202,
  ));

  app.get('/api/story-sync/jobs/:jobId', {
    schema: {
      params: {
        type: 'object', additionalProperties: false, required: ['jobId'],
        properties: { jobId: { type: 'string', minLength: 1, maxLength: 128 } },
      },
      response: { 200: StorySyncJobDocumentSchema, 404: ProblemSchema, 503: ProblemSchema },
    },
  }, async (request, reply) => send(
    reply,
    String(request.id),
    () => service.read((request.params as { jobId: string }).jobId),
  ));

  app.get('/api/campaigns/:campaignId/review-inbox', {
    schema: {
      params: {
        type: 'object', additionalProperties: false, required: ['campaignId'],
        properties: { campaignId: { type: 'string', minLength: 1, maxLength: 128 } },
      },
      response: { 200: { type: 'array', items: StorySyncJobDocumentSchema }, 404: ProblemSchema, 503: ProblemSchema },
    },
  }, async (request, reply) => send(
    reply,
    String(request.id),
    () => service.list((request.params as { campaignId: string }).campaignId),
  ));

  app.put('/api/story-sync/proposals/:proposalId', {
    schema: {
      params: {
        type: 'object', additionalProperties: false, required: ['proposalId'],
        properties: { proposalId: { type: 'string', minLength: 1, maxLength: 128 } },
      },
      body: DecideStorySyncProposalRequestSchema,
      response: { 200: StorySyncJobDocumentSchema, 404: ProblemSchema, 409: ProblemSchema, 503: ProblemSchema },
    },
  }, async (request, reply) => send(
    reply,
    String(request.id),
    () => service.decide(
      (request.params as { proposalId: string }).proposalId,
      request.body as DecideStorySyncProposalRequest,
    ),
  ));
}
