import { resolve } from 'node:path';

export type CompanionLogLevel = 'silent' | 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

export type CompanionConfig = Readonly<{
  host: string;
  port: number;
  sillyTavernBaseUrl: string;
  lmStudioBaseUrl: string;
  probeTimeoutMs: number;
  workspaceRoot: string;
  databasePath: string;
  snapshotInterval: number;
  serviceVersion: string;
  logLevel: CompanionLogLevel;
}>;

export class ConfigurationError extends Error {
  readonly code = 'COMPANION_CONFIGURATION_INVALID';
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

const LOG_LEVELS = new Set<CompanionLogLevel>([
  'silent',
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
]);

function parsePort(value: string | undefined, fallback: number, name: string): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new ConfigurationError(`${name} must be an integer from 1 through 65535.`);
  }
  return parsed;
}

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
  maximum = 60_000,
): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new ConfigurationError(`${name} must be an integer from 1 through ${maximum}.`);
  }
  return parsed;
}

function baseUrl(value: string | undefined, fallback: string, name: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value ?? fallback);
  } catch {
    throw new ConfigurationError(`${name} must be a valid http or https URL.`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new ConfigurationError(`${name} must use http or https.`);
  }
  return parsed.href.replace(/\/$/, '');
}

function logLevel(value: string | undefined): CompanionLogLevel {
  const parsed = String(value ?? 'info').trim().toLowerCase() as CompanionLogLevel;
  if (!LOG_LEVELS.has(parsed)) {
    throw new ConfigurationError('RPG_LOG_LEVEL must be one of silent, fatal, error, warn, info, debug, or trace.');
  }
  return parsed;
}

export function readCompanionConfig(env: NodeJS.ProcessEnv = process.env): CompanionConfig {
  const host = String(env.RPG_COMPANION_HOST ?? '0.0.0.0').trim();
  if (!host) throw new ConfigurationError('RPG_COMPANION_HOST cannot be empty.');
  return Object.freeze({
    host,
    port: parsePort(env.RPG_COMPANION_PORT, 8002, 'RPG_COMPANION_PORT'),
    sillyTavernBaseUrl: baseUrl(env.RPG_SILLYTAVERN_URL, 'http://127.0.0.1:8001', 'RPG_SILLYTAVERN_URL'),
    lmStudioBaseUrl: baseUrl(env.RPG_LM_STUDIO_URL, 'http://127.0.0.1:1234/v1', 'RPG_LM_STUDIO_URL'),
    probeTimeoutMs: parsePositiveInteger(env.RPG_PROBE_TIMEOUT_MS, 800, 'RPG_PROBE_TIMEOUT_MS'),
    workspaceRoot: resolve(env.RPG_WORKSPACE_DIST ?? 'apps/workspace/dist'),
    databasePath: resolve(env.RPG_DATABASE_PATH ?? '.runtime/companion/campaigns.sqlite'),
    snapshotInterval: parsePositiveInteger(env.RPG_SNAPSHOT_INTERVAL, 100, 'RPG_SNAPSHOT_INTERVAL', 10_000),
    serviceVersion: String(env.RPG_COMPANION_VERSION ?? '0.2.0'),
    logLevel: logLevel(env.RPG_LOG_LEVEL),
  });
}
