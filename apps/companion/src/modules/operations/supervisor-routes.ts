import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { ProblemSchema } from '@st-llm-rpg/wire';
import { makeProblem } from '../../problem.js';

const ShutdownReceiptSchema = Type.Object({
  schema: Type.Literal('st-rpg.shutdown-receipt'),
  version: Type.Literal('1.0'),
  state: Type.Literal('draining'),
  requestedAt: Type.String({ minLength: 1, maxLength: 64 }),
}, { additionalProperties: false });

function isLoopback(address: string): boolean {
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
}

export function registerSupervisorRoutes(app: FastifyInstance, runId: string | undefined): void {
  if (!runId) return;
  app.post('/api/operations/shutdown', {
    schema: { response: { 202: ShutdownReceiptSchema, 403: ProblemSchema } },
  }, async (request, reply) => {
    const supplied = String(request.headers['x-wayfinder-run-id'] ?? '');
    if (!isLoopback(request.ip) || supplied !== runId) {
      return reply.code(403).send(makeProblem({
        code: 'SUPERVISOR_OWNERSHIP_MISMATCH',
        message: 'Shutdown is available only to the identity-matched local Wayfinder supervisor.',
        requestId: String(request.id),
      }));
    }
    const receipt = {
      schema: 'st-rpg.shutdown-receipt' as const,
      version: '1.0' as const,
      state: 'draining' as const,
      requestedAt: new Date().toISOString(),
    };
    reply.raw.once('finish', () => {
      setImmediate(() => { void app.close(); });
    });
    return reply.code(202).send(receipt);
  });
}
