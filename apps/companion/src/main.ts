import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildCompanion, formatListenError } from './app.js';
import { readCompanionConfig, type CompanionConfig } from './config.js';

export async function startCompanion(config: CompanionConfig = readCompanionConfig()): Promise<FastifyInstance> {
  const app = await buildCompanion({ config });
  try {
    await app.listen({ host: config.host, port: config.port });
    console.log(`RPG Companion listening on http://${config.host}:${config.port}`);
    console.log(`Campaign Book: http://127.0.0.1:${config.port}/`);
    return app;
  } catch (error) {
    await app.close().catch(() => undefined);
    throw new Error(formatListenError(error, config), { cause: error });
  }
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  return Boolean(entry && pathToFileURL(resolve(entry)).href === import.meta.url);
}

if (isMainModule()) {
  startCompanion().catch(error => {
    console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
