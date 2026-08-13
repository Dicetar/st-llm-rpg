import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  BranchCampaignRequestSchema,
  CampaignCommitPerformanceSchema,
  CampaignCommitSchema,
  CampaignDocumentSchema,
  CampaignExportSchema,
  CampaignHistoryEntrySchema,
  CampaignSummarySchema,
  CampaignVerificationResultSchema,
  CreateCampaignRequestSchema,
  ExecuteCampaignRequestSchema,
  ProblemSchema,
  type CampaignInvalidation,
  type BranchCampaignRequest,
  type CreateCampaignRequest,
  type ExecuteCampaignRequest,
  type ProblemCode,
} from '@st-llm-rpg/wire';
import type { CampaignEngine, Outcome } from './campaign-engine.js';

function httpStatusFor(code: ProblemCode): number {
  if (code === 'CAMPAIGN_VALIDATION_FAILED') return 400;
  if (
    code === 'CAMPAIGN_NOT_FOUND'
    || code === 'CAMPAIGN_RECORD_NOT_FOUND'
    || code === 'CAMPAIGN_REVISION_NOT_FOUND'
    || code === 'NOT_FOUND'
  ) return 404;
  if (code === 'CAMPAIGN_REVISION_CONFLICT' || code === 'CAMPAIGN_REQUEST_CONFLICT' || code === 'CAMPAIGN_ARCHIVED') return 409;
  if (
    code === 'CAMPAIGN_HISTORY_CORRUPT'
    || code === 'CAMPAIGN_STORE_UNAVAILABLE'
    || code === 'SQLITE_RUNTIME_UNAVAILABLE'
    || code === 'DEPENDENCY_UNAVAILABLE'
  ) return 503;
  return 500;
}

function sendOutcome<T>(reply: FastifyReply, outcome: Outcome<T>, successStatus = 200) {
  if (outcome.ok) return reply.code(successStatus).send(outcome.value);
  return reply.code(httpStatusFor(outcome.problem.code)).send(outcome.problem);
}

export function registerCampaignRoutes(app: FastifyInstance, engine: CampaignEngine): void {
  app.get('/api/campaign-authority/performance', {
    schema: { response: { 200: CampaignCommitPerformanceSchema, 503: ProblemSchema } },
  }, async (request, reply) => sendOutcome(reply, await engine.performance(String(request.id))));

  app.get('/api/campaign-authority/verify', {
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

  app.get('/api/campaigns/:campaignId/changes', {
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
        properties: { afterRevision: { type: 'integer', minimum: 0 } },
      },
      response: { 404: ProblemSchema, 503: ProblemSchema },
    },
  }, async (request, reply) => {
    const { campaignId } = request.params as { campaignId: string };
    const { afterRevision = 0 } = request.query as { afterRevision?: number };
    let connected = false;
    let queuedRevision = 0;
    let lastRevision = afterRevision;

    const writeInvalidation = (revision: number) => {
      if (!connected || revision <= lastRevision) return;
      lastRevision = revision;
      const event: CampaignInvalidation = {
        schema: 'st-rpg.campaign-invalidation',
        version: '1.0',
        campaignId,
        revision,
        observedAt: new Date().toISOString(),
      };
      reply.raw.write(`event: campaign-revision\ndata: ${JSON.stringify(event)}\n\n`);
    };

    const unsubscribe = engine.subscribe(campaignId, revision => {
      if (!connected) {
        queuedRevision = Math.max(queuedRevision, revision);
        return;
      }
      writeInvalidation(revision);
    });

    const current = await engine.read(campaignId, String(request.id));
    if (!current.ok) {
      unsubscribe();
      return sendOutcome(reply, current);
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    reply.raw.flushHeaders();
    connected = true;
    writeInvalidation(Math.max(current.value.campaign.revision, queuedRevision));

    const heartbeat = setInterval(() => {
      reply.raw.write(': keep-alive\n\n');
    }, 25_000);
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      clearInterval(heartbeat);
      unsubscribe();
    };
    reply.raw.once('close', cleanup);
    reply.raw.once('error', cleanup);
    return reply;
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

  app.get('/api/campaigns/:campaignId/export', {
    schema: {
      params: {
        type: 'object',
        additionalProperties: false,
        required: ['campaignId'],
        properties: { campaignId: { type: 'string', minLength: 1, maxLength: 128 } },
      },
      response: { 200: CampaignExportSchema, 404: ProblemSchema, 503: ProblemSchema },
    },
  }, async (request, reply) => {
    const { campaignId } = request.params as { campaignId: string };
    const outcome = await engine.export(campaignId, String(request.id));
    if (!outcome.ok) return sendOutcome(reply, outcome);
    const safeTitle = outcome.value.document.campaign.title.replaceAll(/[^A-Za-z0-9._-]+/g, '-').replaceAll(/^-+|-+$/g, '') || 'campaign';
    reply.header('content-disposition', `attachment; filename="${safeTitle}.campaign.json"`);
    return reply.send(outcome.value);
  });

  app.post('/api/campaigns/:campaignId/branches', {
    schema: {
      params: {
        type: 'object',
        additionalProperties: false,
        required: ['campaignId'],
        properties: { campaignId: { type: 'string', minLength: 1, maxLength: 128 } },
      },
      body: BranchCampaignRequestSchema,
      response: {
        201: CampaignCommitSchema,
        400: ProblemSchema,
        404: ProblemSchema,
        409: ProblemSchema,
        503: ProblemSchema,
      },
    },
  }, async (request, reply) => {
    const { campaignId } = request.params as { campaignId: string };
    return sendOutcome(reply, await engine.branch(campaignId, request.body as BranchCampaignRequest), 201);
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
