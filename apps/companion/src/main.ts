import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildCompanion, formatListenError } from './app.js';
import { readCompanionConfig, type CompanionConfig } from './config.js';

export async function startCompanion(config: CompanionConfig = readCompanionConfig()): Promise<FastifyInstance> {
  const app = await buildCompanion({ config });
  try {
    await app.listen({ host: config.host, port: config.port });
    app.log.info({
      host: config.host,
      port: config.port,
      version: config.serviceVersion,
    }, 'RPG Companion listening');
    app.log.info({ url: `http://127.0.0.1:${config.port}/` }, 'Campaign Book available');
    return app;
  } catch (error) {
    app.log.error({ err: error, host: config.host, port: config.port }, 'RPG Companion failed to listen');
    await app.close().catch(() => undefined);
    throw new Error(formatListenError(error, config), { cause: error });
  }
}

function installShutdownHandlers(app: FastifyInstance): void {
  let shuttingDown = false;
  const shutdown = async (signal: 'SIGINT' | 'SIGTERM') => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'RPG Companion shutting down');
    try {
      await app.close();
      app.log.info({ signal }, 'RPG Companion stopped');
    } catch (error) {
      app.log.error({ err: error, signal }, 'RPG Companion shutdown failed');
      process.exitCode = 1;
    }
  };

  process.once('SIGINT', () => { void shutdown('SIGINT'); });
  process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  return Boolean(entry && pathToFileURL(resolve(entry)).href === import.meta.url);
}

if (isMainModule()) {
  startCompanion()
    .then(installShutdownHandlers)
    .catch(error => {
      console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    });
}
