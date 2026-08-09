import { access, readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
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
  const ownsCampaignEngine = options.campaignEngine === undefined;
  const campaignEngine = options.campaignEngine ?? new CampaignEngine(await SqliteCampaignJournal.open(
    options.config.databasePath,
    options.config.snapshotInterval,
  ));
  const probeDependencies = options.probeDependencies
    ?? createDefaultDependencyProbe(options.config, () => campaignEngine.observation());
  const app = Fastify({
    logger: { level: options.config.logLevel },
    genReqId: () => randomUUID(),
    logController: new LogController({ disableRequestLogging: true }),
  });

  if (ownsCampaignEngine) {
    app.addHook('onClose', async () => {
      await campaignEngine.close();
    });
  }

  app.get('/health', {
    schema: { response: { 200: HealthDocumentSchema } },
  }, async request => {
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

  registerCampaignRoutes(app, campaignEngine);

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
