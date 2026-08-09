import { access, readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import Fastify, { LogController, type FastifyInstance, type FastifyReply } from 'fastify';
import {
  COMPANION_SERVICE,
  HealthDocumentSchema,
  ProblemSchema,
  ReadinessDocumentSchema,
  WIRE_VERSION,
  type ComponentObservation,
  type HealthDocument,
  type ReadinessDocument,
} from '@st-llm-rpg/wire';
import type { CompanionConfig } from './config.js';
import { createDefaultDependencyProbe, type DependencyProbe } from './observations.js';
import { makeProblem, ProblemError } from './problem.js';
import { CampaignEngine } from './modules/campaign/campaign-engine.js';
import { registerCampaignRoutes } from './modules/campaign/campaign-routes.js';
import { SqliteCampaignJournal } from './adapters/sqlite/campaign-journal.js';
import { SillyTavernChatSource } from './adapters/sillytavern/sillytavern-chat-source.js';
import { LegacyImportService, type LegacyChatSource } from './modules/legacy-import/legacy-import-service.js';
import { registerLegacyImportRoutes } from './modules/legacy-import/legacy-import-routes.js';
import { ContextService } from './modules/context/context-service.js';
import { registerContextRoutes } from './modules/context/context-routes.js';
import {
  NarrationService,
  SerialInferenceLane,
  type InferenceLane,
  type LmStudioGateway,
} from './modules/narration/narration-service.js';
import { registerNarrationRoutes, type NarrationHttpService } from './modules/narration/narration-routes.js';
import { FetchLmStudioGateway } from './adapters/lm-studio/fetch-lm-studio-gateway.js';
import { CampaignExpectedError } from './modules/campaign/campaign-error.js';

const MIME_TYPES: Readonly<Record<string, string>> = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
});

export type BuildCompanionOptions = Readonly<{
  config: CompanionConfig;
  probeDependencies?: DependencyProbe;
  campaignEngine?: CampaignEngine;
  campaignJournal?: SqliteCampaignJournal | null;
  legacyChatSource?: LegacyChatSource;
  narrationService?: NarrationHttpService;
  lmStudioGateway?: LmStudioGateway;
  inferenceLane?: InferenceLane;
  startedAt?: Date;
}>;

async function assertWorkspaceBuild(config: CompanionConfig): Promise<void> {
  const indexPath = resolve(config.workspaceRoot, 'index.html');
  try {
    await access(indexPath);
  } catch {
    throw new ProblemError(makeProblem({
      code: 'WORKSPACE_BUILD_MISSING',
      message: `Campaign Book build is missing at ${indexPath}.`,
      requestId: 'startup',
      actions: [{ id: 'build', label: 'Run npm run build', kind: 'run-command', target: 'npm run build' }],
    }), 503);
  }
}

function safeAssetPath(root: string, relative: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(relative);
  } catch {
    return null;
  }
  const candidate = resolve(root, decoded);
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  return candidate.startsWith(prefix) ? candidate : null;
}

async function sendFile(reply: FastifyReply, path: string) {
  const info = await stat(path);
  if (!info.isFile()) throw new Error('not a file');
  const body = await readFile(path);
  return reply.type(MIME_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream').send(body);
}

function readinessStatus(components: readonly ComponentObservation[]): Pick<ReadinessDocument, 'ready' | 'status'> {
  const blockingFailure = components.some(component => component.blocking && !['ready', 'available'].includes(component.status));
  if (blockingFailure) return { ready: false, status: 'not-ready' };
  const degraded = components.some(component => !['ready', 'available'].includes(component.status));
  return { ready: true, status: degraded ? 'degraded' : 'ready' };
}

function validationDetails(error: unknown): unknown | undefined {
  if (typeof error !== 'object' || error === null || !('validation' in error)) return undefined;
  return (error as { validation?: unknown }).validation;
}

function httpStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('statusCode' in error)) return undefined;
  const value = Number((error as { statusCode?: unknown }).statusCode);
  return Number.isInteger(value) && value >= 400 && value < 500 ? value : undefined;
}

export async function buildCompanion(options: BuildCompanionOptions): Promise<FastifyInstance> {
  await assertWorkspaceBuild(options.config);
  const startedAt = options.startedAt ?? new Date();
  let campaignStartupError: unknown;
  let campaignJournal: SqliteCampaignJournal | null;
  if (options.campaignJournal !== undefined) {
    campaignJournal = options.campaignJournal;
    if (campaignJournal === null) campaignStartupError = new Error('Campaign authority was deliberately unavailable.');
  } else if (options.campaignEngine !== undefined) {
    campaignJournal = null;
  } else {
    try {
      campaignJournal = await SqliteCampaignJournal.open(options.config.databasePath, options.config.snapshotInterval);
    } catch (error) {
      campaignJournal = null;
      campaignStartupError = error;
    }
  }
  const ownsCampaignEngine = options.campaignEngine === undefined && campaignJournal !== null;
  const campaignEngine = options.campaignEngine ?? (campaignJournal ? new CampaignEngine(campaignJournal) : null);
  const legacyImportService = campaignJournal
    ? new LegacyImportService(
        campaignJournal,
        options.legacyChatSource ?? new SillyTavernChatSource(options.config.sillyTavernBaseUrl),
        join(dirname(options.config.databasePath), 'backups'),
      )
    : null;
  const contextService = campaignJournal ? new ContextService(campaignJournal) : null;
  const unavailableMessage = `Campaign authority is unavailable: ${campaignStartupError instanceof Error ? campaignStartupError.message : 'SQLite did not open.'}`;
  const narrationAuthority = campaignJournal && contextService
    ? {
        readBinding: (bindingId: string) => campaignJournal.readBinding(bindingId),
        listNarratorModelProfiles: () => campaignJournal.listNarratorModelProfiles(),
        plan: (request: Parameters<ContextService['plan']>[0], signal: AbortSignal) => contextService.plan(request, signal),
      }
    : {
        async readBinding(_bindingId: string): Promise<never> {
          throw new CampaignExpectedError('CAMPAIGN_STORE_UNAVAILABLE', unavailableMessage);
        },
        async listNarratorModelProfiles(): Promise<never> {
          throw new CampaignExpectedError('CAMPAIGN_STORE_UNAVAILABLE', unavailableMessage);
        },
        async plan(request: Parameters<ContextService['plan']>[0]) {
          return {
            ok: false as const,
            problem: makeProblem({
              code: 'CAMPAIGN_STORE_UNAVAILABLE', message: unavailableMessage, requestId: request.requestId,
            }),
          };
        },
      };
  const narrationService = options.narrationService ?? new NarrationService({
    authority: narrationAuthority,
    inference: options.inferenceLane ?? new SerialInferenceLane(),
    lmStudio: options.lmStudioGateway ?? new FetchLmStudioGateway(options.config.lmStudioBaseUrl),
  });
  const probeDependencies = options.probeDependencies
    ?? createDefaultDependencyProbe(options.config, () => campaignEngine?.observation() ?? {
      id: 'sqlite-runtime',
      status: 'unavailable',
      blocking: true,
      message: unavailableMessage,
      observedAt: new Date().toISOString(),
      latencyMs: 0,
    });
  const app = Fastify({
    logger: { level: options.config.logLevel },
    ajv: { customOptions: { removeAdditional: false } },
    genReqId: () => randomUUID(),
    logController: new LogController({ disableRequestLogging: true }),
  });

  if (ownsCampaignEngine && campaignEngine) {
    app.addHook('onClose', async () => {
      await campaignEngine.close();
    });
  }

  app.get('/health', {
    schema: { response: { 200: HealthDocumentSchema } },
  }, async (request, reply) => {
    reply.header('access-control-allow-origin', '*');
    const result: HealthDocument = {
      schema: 'st-rpg.health',
      version: WIRE_VERSION,
      service: COMPANION_SERVICE,
      status: 'alive',
      requestId: String(request.id),
      startedAt: startedAt.toISOString(),
      uptimeMs: Math.max(0, Date.now() - startedAt.getTime()),
    };
    return result;
  });

  app.get('/ready', {
    schema: { response: { 200: ReadinessDocumentSchema } },
  }, async request => {
    const components = [...await probeDependencies()];
    const state = readinessStatus(components);
    const result: ReadinessDocument = {
      schema: 'st-rpg.readiness',
      version: WIRE_VERSION,
      service: COMPANION_SERVICE,
      ...state,
      requestId: String(request.id),
      observedAt: new Date().toISOString(),
      components,
    };
    return result;
  });

  if (campaignEngine) registerCampaignRoutes(app, campaignEngine);
  if (legacyImportService) registerLegacyImportRoutes(app, legacyImportService);
  if (contextService) registerContextRoutes(app, contextService);
  registerNarrationRoutes(app, narrationService);

  app.get('/assets/*', async (request, reply) => {
    const relative = (request.params as { '*': string })['*'];
    const path = safeAssetPath(resolve(options.config.workspaceRoot, 'assets'), relative);
    if (!path) {
      return reply.code(404).send(makeProblem({
        code: 'NOT_FOUND', message: 'Workspace asset was not found.', requestId: String(request.id),
      }));
    }
    try {
      return await sendFile(reply, path);
    } catch {
      return reply.code(404).send(makeProblem({
        code: 'NOT_FOUND', message: 'Workspace asset was not found.', requestId: String(request.id),
      }));
    }
  });

  app.get('/', async (_request, reply) => sendFile(reply, resolve(options.config.workspaceRoot, 'index.html')));

  app.setNotFoundHandler(async (request, reply) => {
    const acceptsHtml = request.method === 'GET' && String(request.headers.accept ?? '').includes('text/html');
    if (acceptsHtml && !request.url.startsWith('/api/')) {
      return sendFile(reply, resolve(options.config.workspaceRoot, 'index.html'));
    }
    return reply.code(404).send(makeProblem({
      code: 'NOT_FOUND',
      message: `No companion route owns ${request.method} ${request.url}.`,
      requestId: String(request.id),
    }));
  });

  app.setErrorHandler((error, request, reply) => {
    const validation = validationDetails(error);
    if (validation !== undefined) {
      void reply.code(400).send(makeProblem({
        code: 'CAMPAIGN_VALIDATION_FAILED',
        message: 'The request did not match the Campaign operation contract.',
        requestId: String(request.id),
        details: validation,
      }));
      return;
    }
    if (error instanceof ProblemError) {
      void reply.code(error.statusCode).send(error.problem);
      return;
    }
    const statusCode = httpStatus(error);
    if (statusCode !== undefined) {
      void reply.code(statusCode).send(makeProblem({
        code: 'CAMPAIGN_VALIDATION_FAILED',
        message: error instanceof Error ? error.message : 'The request could not be accepted.',
        requestId: String(request.id),
      }));
      return;
    }
    const problem = makeProblem({
      code: 'INTERNAL_ERROR',
      message: 'The companion failed to complete the request.',
      requestId: String(request.id),
      actions: [{ id: 'inspect-terminal', label: 'Inspect the companion terminal', kind: 'inspect' }],
    });
    request.log.error({ err: error }, 'Unhandled companion request failure');
    void reply.code(500).send(problem);
  });

  app.addSchema(ProblemSchema);
  return app;
}

export function formatListenError(error: unknown, config: CompanionConfig): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code?: unknown }).code) : '';
  if (code === 'EADDRINUSE') {
    return [
      `Companion cannot start because ${config.host}:${config.port} is already in use.`,
      'No process was stopped or killed.',
      `Inspect the owner in PowerShell: Get-NetTCPConnection -LocalPort ${config.port} | Format-List`,
      'Stop the known owner or set RPG_COMPANION_PORT to another free port.',
    ].join(' ');
  }
  return `Companion failed to listen on ${config.host}:${config.port}: ${error instanceof Error ? error.message : String(error)}`;
}
