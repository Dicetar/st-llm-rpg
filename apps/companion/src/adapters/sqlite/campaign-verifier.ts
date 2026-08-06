import type { DatabaseSync } from 'node:sqlite';
import type { CampaignRow, CampaignState, EventRow } from '../../modules/campaign/campaign-state.js';
import { canonicalJson, eventHash, parseJson, sha256 } from '../../modules/campaign/campaign-state.js';

export function verifyCampaignDatabase(database: DatabaseSync): void {
  const quick = database.prepare('PRAGMA quick_check').all();
  const foreign = database.prepare('PRAGMA foreign_key_check').all();
  if (quick.length !== 1 || Object.values(quick[0] ?? {})[0] !== 'ok' || foreign.length > 0) {
    throw new Error('Campaign database integrity verification failed.');
  }
  const campaigns = database.prepare('SELECT * FROM campaigns').all() as CampaignRow[];
  for (const campaign of campaigns) verifyCampaign(database, campaign);
}

function verifyCampaign(database: DatabaseSync, campaign: CampaignRow): void {
  const events = database.prepare(`
    SELECT revision, event_id, request_id, operation_kind, operation_json, before_state_json,
           after_state_json, accepted_at, previous_event_hash, event_hash
    FROM campaign_events WHERE campaign_id = ? ORDER BY revision ASC
  `).all(campaign.campaign_id) as EventRow[];
  if (events.length !== Number(campaign.current_revision)) {
    throw new Error(`Campaign ${campaign.campaign_id} history revision count failed.`);
  }
  let previousHash: string | null = null;
  let previousState: CampaignState | null = null;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    const revision = index + 1;
    const beforeState = event.before_state_json ? parseJson<CampaignState>(event.before_state_json) : null;
    const afterState = parseJson<CampaignState>(event.after_state_json);
    const expected = eventHash({
      campaignId: campaign.campaign_id,
      revision,
      eventId: event.event_id,
      requestId: event.request_id,
      operationKind: event.operation_kind,
      operation: parseJson(event.operation_json),
      beforeState,
      afterState,
      acceptedAt: event.accepted_at,
      previousEventHash: event.previous_event_hash,
    });
    if (Number(event.revision) !== revision || event.previous_event_hash !== previousHash || event.event_hash !== expected) {
      throw new Error(`Campaign ${campaign.campaign_id} history checksum failed at revision ${revision}.`);
    }
    if (revision > 1 && canonicalJson(beforeState) !== canonicalJson(previousState)) {
      throw new Error(`Campaign ${campaign.campaign_id} history continuity failed at revision ${revision}.`);
    }
    previousHash = event.event_hash;
    previousState = afterState;
  }
  if (previousHash !== campaign.head_event_hash || canonicalJson(previousState) !== canonicalJson(parseJson(campaign.current_state_json))) {
    throw new Error(`Campaign ${campaign.campaign_id} head does not match immutable history.`);
  }
  verifySnapshots(database, campaign.campaign_id, events);
}

function verifySnapshots(database: DatabaseSync, campaignId: string, events: readonly EventRow[]): void {
  const snapshots = database.prepare(`
    SELECT revision, state_json, state_hash, event_hash
    FROM campaign_snapshots WHERE campaign_id = ?
  `).all(campaignId) as Array<{ revision: number; state_json: string; state_hash: string; event_hash: string }>;
  for (const snapshot of snapshots) {
    const anchor = events[Number(snapshot.revision) - 1];
    const state = parseJson(snapshot.state_json);
    if (!anchor || snapshot.state_hash !== sha256(state) || snapshot.event_hash !== anchor.event_hash
      || canonicalJson(state) !== canonicalJson(parseJson(anchor.after_state_json))) {
      throw new Error(`Campaign ${campaignId} snapshot verification failed at revision ${snapshot.revision}.`);
    }
  }
}
