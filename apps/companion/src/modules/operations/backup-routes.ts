import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  BackupCatalogSchema,
  BackupDocumentSchema,
  CreateBackupRequestSchema,
  ProblemSchema,
  RestoreBackupPreviewSchema,
  RestoreBackupReceiptSchema,
  RestoreBackupRequestSchema,
  type CreateBackupRequest,
  type RestoreBackupRequest,
} from '@st-llm-rpg/wire';
import { makeProblem } from '../../problem.js';
import { CampaignExpectedError } from '../campaign/campaign-error.js';
import type { BackupService } from './backup-service.js';

function status(code: string): number {
  if (code === 'BACKUP_NOT_FOUND') return 404;
  if (code === 'BACKUP_INVALID' || code === 'RESTORE_CONFIRMATION_REQUIRED') return 409;
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
        actions: [{ id: 'open-backups', label: 'Open Backups and Restore', kind: 'inspect' }],
      }));
    }
    throw error;
  }
}

const BackupIdParams = {
  type: 'object', additionalProperties: false, required: ['backupId'],
  properties: { backupId: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' } },
} as const;

export function registerBackupRoutes(app: FastifyInstance, service: BackupService): void {
  app.get('/api/operations/backups', {
    schema: { response: { 200: BackupCatalogSchema, 503: ProblemSchema } },
  }, async (request, reply) => send(reply, String(request.id), () => service.list()));

  app.post('/api/operations/backups', {
    schema: {
      body: CreateBackupRequestSchema,
      response: { 201: BackupDocumentSchema, 400: ProblemSchema, 503: ProblemSchema },
    },
  }, async (request, reply) => send(
    reply,
    String(request.id),
    () => service.createExplicit((request.body as CreateBackupRequest).label),
    201,
  ));

  app.post('/api/operations/backups/:backupId/restore-preview', {
    schema: {
      params: BackupIdParams,
      response: { 200: RestoreBackupPreviewSchema, 404: ProblemSchema, 409: ProblemSchema, 503: ProblemSchema },
    },
  }, async (request, reply) => send(
    reply,
    String(request.id),
    () => service.previewRestore((request.params as { backupId: string }).backupId),
  ));

  app.post('/api/operations/backups/:backupId/restore', {
    schema: {
      params: BackupIdParams,
      body: RestoreBackupRequestSchema,
      response: { 200: RestoreBackupReceiptSchema, 404: ProblemSchema, 409: ProblemSchema, 503: ProblemSchema },
    },
  }, async (request, reply) => send(
    reply,
    String(request.id),
    () => service.restore(
      (request.params as { backupId: string }).backupId,
      (request.body as RestoreBackupRequest).restoreToken,
    ),
  ));
}
