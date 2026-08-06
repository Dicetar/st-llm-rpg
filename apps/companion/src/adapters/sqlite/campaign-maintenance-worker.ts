import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import type { CampaignDocument, CampaignVerificationResult, ProblemCode } from '@st-llm-rpg/wire';
import { CampaignExpectedError } from '../../modules/campaign/campaign-error.js';
import { asDocument, parseJson, type CampaignState } from '../../modules/campaign/campaign-state.js';
import { verifyCampaignDatabase } from './campaign-verifier.js';

type WorkerInput =
  | Readonly<{ action: 'verify'; databasePath: string }>
  | Readonly<{ action: 'read-revision'; databasePath: string; campaignId: string; revision: number }>;

type WorkerSuccess =
  | Readonly<{ ok: true; value: CampaignVerificationResult }>
  | Readonly<{ ok: true; value: CampaignDocument }>;

type WorkerFailure = Readonly<{
  ok: false;
  message: string;
  code?: ProblemCode;
  statusCode?: number;
  details?: unknown;
}>;

const input = workerData as WorkerInput;
const port = parentPort;
if (!port) throw new Error('Campaign maintenance worker has no parent port.');

function fail(error: unknown): WorkerFailure {
  if (error instanceof CampaignExpectedError) {
    return {
      ok: false,
      message: error.message,
      code: error.code,
      statusCode: error.statusCode,
      ...(error.details === undefined ? {} : { details: error.details }),
    };
  }
  return {
    ok: false,
    message: error instanceof Error ? error.message : String(error),
  };
}

function readRevision(database: DatabaseSync, campaignId: string, revision: number): CampaignDocument {
  const campaign = database.prepare(
    'SELECT current_revision FROM campaigns WHERE campaign_id = ?',
  ).get(campaignId) as { current_revision: number | bigint } | undefined;
  if (!campaign) {
    throw new CampaignExpectedError(
      'CAMPAIGN_NOT_FOUND',
      `Campaign ${campaignId} was not found.`,
      404,
      { campaignId },
    );
  }
  const currentRevision = Number(campaign.current_revision);
  if (!Number.isInteger(revision) || revision < 1 || revision > currentRevision) {
    throw new CampaignExpectedError(
      'CAMPAIGN_REVISION_NOT_FOUND',
      `Campaign revision ${revision} was not found.`,
      404,
      { campaignId, revision, currentRevision },
    );
  }
  const event = database.prepare(
    'SELECT after_state_json FROM campaign_events WHERE campaign_id = ? AND revision = ?',
  ).get(campaignId, revision) as { after_state_json: string } | undefined;
  if (!event) throw new Error(`Campaign ${campaignId} is missing immutable revision ${revision}.`);
  return asDocument(parseJson<CampaignState>(event.after_state_json));
}

let database: DatabaseSync | undefined;
try {
  const started = performance.now();
  database = new DatabaseSync(input.databasePath, { readOnly: true });
  database.exec('PRAGMA query_only = ON; BEGIN;');
  verifyCampaignDatabase(database);

  let result: WorkerSuccess;
  if (input.action === 'read-revision') {
    result = { ok: true, value: readRevision(database, input.campaignId, input.revision) };
  } else {
    const row = database.prepare('SELECT COUNT(*) AS count FROM campaigns').get() as {
      count: number | bigint;
    };
    result = {
      ok: true,
      value: {
        verified: true,
        verifiedAt: new Date().toISOString(),
        durationMs: Math.max(0, performance.now() - started),
        campaignCount: Number(row.count),
      },
    };
  }
  database.exec('COMMIT;');
  port.postMessage(result);
} catch (error) {
  try { database?.exec('ROLLBACK;'); } catch { /* connection may already be unusable */ }
  port.postMessage(fail(error));
} finally {
  database?.close();
}
