import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  AddonCandidateSchema,
  AddonCandidateCatalogSchema,
  AddonSourceCatalogSchema,
  ApplyAddonReceiptSchema,
  ApplyAddonRequestSchema,
  PreviewAddonRequestSchema,
  ProblemSchema,
  type ApplyAddonRequest,
  type PreviewAddonRequest,
} from '@st-llm-rpg/wire';
import { makeProblem } from '../../problem.js';
import { CampaignExpectedError } from '../campaign/campaign-error.js';
import type { AddonService } from './addon-service.js';

function status(code: string): number {
  if (code === 'CAMPAIGN_NOT_FOUND' || code === 'ADDON_CANDIDATE_NOT_FOUND') return 404;
  if (['ADDON_CANDIDATE_STALE', 'CAMPAIGN_REVISION_CONFLICT'].includes(code)) return 409;
  if (['ADDON_SOURCE_INVALID', 'ADDON_IMPORT_BLOCKED', 'CAMPAIGN_VALIDATION_FAILED'].includes(code)) return 422;
  return 503;
}

async function send<T>(reply: FastifyReply, requestId: string, work: () => Promise<T>, success = 200) {
  try {
    return reply.code(success).send(await work());
  } catch (error) {
    if (error instanceof CampaignExpectedError) {
      return reply.code(status(error.code)).send(makeProblem({
        code: error.code,
        message: error.message,
        requestId,
        actions: [{ id: 'rescan-addons', label: 'Rescan addons and review a fresh diff', kind: 'retry' }],
      }));
    }
    throw error;
  }
}

export function registerAddonRoutes(app: FastifyInstance, service: AddonService): void {
  app.get('/api/operations/addons', {
    schema: { response: { 200: AddonSourceCatalogSchema, 503: ProblemSchema } },
  }, async (request, reply) => send(reply, String(request.id), () => service.sourceCatalog()));

  app.post('/api/operations/addons/rescan', {
    schema: { response: { 200: AddonSourceCatalogSchema, 503: ProblemSchema } },
  }, async (request, reply) => send(reply, String(request.id), async () => (await service.rescan()).catalog));

  app.get('/api/operations/addons/candidates', {
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: { campaignId: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' } },
      },
      response: { 200: AddonCandidateCatalogSchema, 503: ProblemSchema },
    },
  }, async (request, reply) => send(
    reply,
    String(request.id),
    () => service.listCandidates((request.query as { campaignId?: string }).campaignId),
  ));

  app.post('/api/operations/addons/preview', {
    schema: {
      body: PreviewAddonRequestSchema,
      response: { 200: AddonCandidateSchema, 404: ProblemSchema, 422: ProblemSchema, 503: ProblemSchema },
    },
  }, async (request, reply) => send(
    reply,
    String(request.id),
    () => service.preview((request.body as PreviewAddonRequest).campaignId),
  ));

  app.post('/api/operations/addons/apply', {
    schema: {
      body: ApplyAddonRequestSchema,
      response: {
        200: ApplyAddonReceiptSchema,
        404: ProblemSchema,
        409: ProblemSchema,
        422: ProblemSchema,
        503: ProblemSchema,
      },
    },
  }, async (request, reply) => send(
    reply,
    String(request.id),
    () => service.apply(request.body as ApplyAddonRequest),
  ));
}
