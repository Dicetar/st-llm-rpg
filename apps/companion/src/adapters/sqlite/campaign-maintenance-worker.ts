import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import type { CampaignDocument, CampaignVerificationResult } from '@st-llm-rpg/wire';
import { CampaignExpectedError } from '../../modules/campaign/campaign-error.js';
import { asDocument, canonicalJson, sha256 } from '../../modules/campaign/campaign-state.js';
import type {
  CampaignMaintenanceRequest,
  CampaignMaintenanceResponse,
  CampaignSnapshotCandidate,
} from './campaign-maintenance-protocol.js';
import { reconstructCampaignState, verifyCampaignDatabase } from './campaign-verifier.js';

const input = workerData as CampaignMaintenanceRequest;
const port = parentPort;
if (!port) throw new Error('Campaign maintenance worker has no parent port.');

function fail(error: unknown): CampaignMaintenanceResponse {
  if (error instanceof CampaignExpectedError) {
    return {
      ok: false,
      message: error.message,
      code: error.code,
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
      { campaignId },
    );
  }
  const currentRevision = Number(campaign.current_revision);
  if (!Number.isInteger(revision) || revision < 1 || revision > currentRevision) {
    throw new CampaignExpectedError(
      'CAMPAIGN_REVISION_NOT_FOUND',
      `Campaign revision ${revision} was not found.`,
      { campaignId, revision, currentRevision },
    );
  }
  return asDocument(reconstructCampaignState(database, campaignId, revision));
}

function buildSnapshot(database: DatabaseSync, campaignId: string, revision: number): CampaignSnapshotCandidate {
  const event = database.prepare(`
    SELECT event_hash, accepted_at FROM campaign_events WHERE campaign_id = ? AND revision = ?
  `).get(campaignId, revision) as { event_hash: string; accepted_at: string } | undefined;
  if (!event) {
    throw new CampaignExpectedError(
      'CAMPAIGN_REVISION_NOT_FOUND',
      `Campaign revision ${revision} was not found.`,
      { campaignId, revision },
    );
  }
  const state = reconstructCampaignState(database, campaignId, revision);
  return {
    campaignId,
    revision,
    stateJson: canonicalJson(state),
    stateHash: sha256(state),
    eventHash: event.event_hash,
    createdAt: event.accepted_at,
  };
}

let database: DatabaseSync | undefined;
try {
  const started = performance.now();
  database = new DatabaseSync(input.databasePath, { readOnly: true });
  database.exec('PRAGMA query_only = ON; BEGIN;');
  verifyCampaignDatabase(database);

  let result: CampaignMaintenanceResponse;
  if (input.action === 'read-revision') {
    result = { ok: true, value: readRevision(database, input.campaignId, input.revision) };
  } else if (input.action === 'build-snapshot') {
    result = { ok: true, value: buildSnapshot(database, input.campaignId, input.revision) };
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
