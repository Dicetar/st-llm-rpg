import type { DatabaseSync } from 'node:sqlite';
import type { CampaignState, CampaignSubjectChange, CampaignSubjectImage, CampaignSubjectKind } from '../../modules/campaign/campaign-state.js';
import {
  applySubjectChanges,
  canonicalJson,
  eventHash,
  normalizeCampaignState,
  parseJson,
  sha256,
  subjectEventHash,
  subjectImageAt,
  subjectImageHash,
} from '../../modules/campaign/campaign-state.js';
import type { CampaignRow } from './campaign-rows.js';
import { readCurrentCampaignState } from './campaign-projections.js';

type StoredEvent = {
  revision: number;
  event_id: string;
  request_id: string;
  event_schema_version: number;
  operation_kind: string;
  operation_json: string;
  before_state_json: string | null;
  after_state_json: string;
  accepted_at: string;
  previous_event_hash: string | null;
  event_hash: string;
};

type StoredChange = {
  ordinal: number;
  subject_kind: CampaignSubjectKind;
  subject_id: string;
  before_schema_version: number | null;
  before_image_json: string | null;
  before_hash: string | null;
  after_schema_version: number | null;
  after_image_json: string | null;
  after_hash: string | null;
};

type StoredSnapshot = {
  revision: number;
  state_json: string;
  state_hash: string;
  event_hash: string;
};

type StoredBase = {
  state_schema_version: number;
  state_json: string;
  state_hash: string;
};

function tableExists(database: DatabaseSync, table: string): boolean {
  return Boolean(database.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table));
}

function readBase(database: DatabaseSync, campaignId: string): StoredBase {
  if (!tableExists(database, 'campaign_bases')) throw new Error(`Campaign ${campaignId} has no Campaign Base storage.`);
  const base = database.prepare(`
    SELECT state_schema_version, state_json, state_hash FROM campaign_bases WHERE campaign_id = ?
  `).get(campaignId) as StoredBase | undefined;
  if (!base) throw new Error(`Campaign ${campaignId} is missing its immutable Campaign Base.`);
  const state = parseJson<CampaignState>(base.state_json);
  if (Number(base.state_schema_version) !== 1 || base.state_hash !== sha256(state)) {
    throw new Error(`Campaign ${campaignId} Campaign Base verification failed.`);
  }
  return base;
}

function parseImage(json: string | null): CampaignSubjectImage {
  return json === null ? null : parseJson<Exclude<CampaignSubjectImage, null>>(json);
}

function readChanges(database: DatabaseSync, eventId: string): CampaignSubjectChange[] {
  if (!tableExists(database, 'campaign_event_changes')) return [];
  const rows = database.prepare(`
    SELECT ordinal, subject_kind, subject_id,
           before_schema_version, before_image_json, before_hash,
           after_schema_version, after_image_json, after_hash
    FROM campaign_event_changes WHERE event_id = ? ORDER BY ordinal
  `).all(eventId) as StoredChange[];
  return rows.map((row, index) => {
    if (Number(row.ordinal) !== index) throw new Error(`Campaign Event ${eventId} has non-contiguous subject changes.`);
    const beforeImage = parseImage(row.before_image_json);
    const afterImage = parseImage(row.after_image_json);
    const beforeVersion = row.before_schema_version === null ? null : Number(row.before_schema_version);
    const afterVersion = row.after_schema_version === null ? null : Number(row.after_schema_version);
    if ((beforeImage === null) !== (beforeVersion === null) || (afterImage === null) !== (afterVersion === null)
      || (beforeVersion !== null && beforeVersion !== 1) || (afterVersion !== null && afterVersion !== 1)
      || row.before_hash !== subjectImageHash(beforeImage) || row.after_hash !== subjectImageHash(afterImage)) {
      throw new Error(`Campaign Event ${eventId} subject image verification failed at ordinal ${index}.`);
    }
    return {
      subjectKind: row.subject_kind,
      subjectId: row.subject_id,
      beforeImage,
      afterImage,
    };
  });
}

function eventsFor(database: DatabaseSync, campaignId: string, afterRevision = 0, throughRevision?: number): StoredEvent[] {
  return database.prepare(`
    SELECT revision, event_id, request_id, event_schema_version, operation_kind, operation_json,
           before_state_json, after_state_json, accepted_at, previous_event_hash, event_hash
    FROM campaign_events
    WHERE campaign_id = ? AND revision > ? ${throughRevision === undefined ? '' : 'AND revision <= ?'}
    ORDER BY revision
  `).all(...(throughRevision === undefined
    ? [campaignId, afterRevision]
    : [campaignId, afterRevision, throughRevision])) as StoredEvent[];
}

function applyVerifiedSubjectEvent(
  database: DatabaseSync,
  campaignId: string,
  event: StoredEvent,
  state: CampaignState,
  changes = readChanges(database, event.event_id),
): CampaignState {
  for (const change of changes) {
    if (canonicalJson(subjectImageAt(state, change.subjectKind, change.subjectId)) !== canonicalJson(change.beforeImage)) {
      throw new Error(`Campaign ${campaignId} history continuity failed at revision ${event.revision}.`);
    }
  }
  const next = structuredClone(state);
  applySubjectChanges(next, changes, Number(event.revision), event.accepted_at);
  return next;
}

export function verifyCampaignDatabase(database: DatabaseSync): void {
  const quick = database.prepare('PRAGMA quick_check').all();
  const foreign = database.prepare('PRAGMA foreign_key_check').all();
  if (quick.length !== 1 || Object.values(quick[0] ?? {})[0] !== 'ok' || foreign.length > 0) {
    throw new Error('Campaign database integrity verification failed.');
  }
  const campaigns = tableExists(database, 'campaigns')
    ? database.prepare('SELECT * FROM campaigns').all() as CampaignRow[]
    : [];
  for (const campaign of campaigns) verifyCampaign(database, campaign);
}

function verifyCampaign(database: DatabaseSync, campaign: CampaignRow): void {
  const events = eventsFor(database, campaign.campaign_id);
  if (events.length !== Number(campaign.current_revision)) {
    throw new Error(`Campaign ${campaign.campaign_id} history revision count failed.`);
  }
  const snapshots = database.prepare(`
    SELECT revision, state_json, state_hash, event_hash
    FROM campaign_snapshots WHERE campaign_id = ?
  `).all(campaign.campaign_id) as StoredSnapshot[];
  const snapshotsByRevision = new Map(snapshots.map(snapshot => [Number(snapshot.revision), snapshot]));
  if (tableExists(database, 'campaign_bases')) readBase(database, campaign.campaign_id);
  let previousHash: string | null = null;
  let state: CampaignState | null = null;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    const revision = index + 1;
    if (Number(event.revision) !== revision || event.previous_event_hash !== previousHash) {
      throw new Error(`Campaign ${campaign.campaign_id} history checksum failed at revision ${revision}.`);
    }
    if (Number(event.event_schema_version) === 1) {
      const storedBeforeState = event.before_state_json ? parseJson<CampaignState>(event.before_state_json) : null;
      const storedAfterState = parseJson<CampaignState>(event.after_state_json);
      const expected = eventHash({
        campaignId: campaign.campaign_id,
        revision,
        eventId: event.event_id,
        requestId: event.request_id,
        operationKind: event.operation_kind,
        operation: parseJson(event.operation_json),
        beforeState: storedBeforeState,
        afterState: storedAfterState,
        acceptedAt: event.accepted_at,
        previousEventHash: event.previous_event_hash,
      });
      const normalizedBeforeState = storedBeforeState === null ? null : normalizeCampaignState(storedBeforeState);
      if (event.event_hash !== expected || (revision > 1 && canonicalJson(normalizedBeforeState) !== canonicalJson(state))) {
        throw new Error(`Campaign ${campaign.campaign_id} history checksum failed at revision ${revision}.`);
      }
      state = normalizeCampaignState(storedAfterState);
    } else if (Number(event.event_schema_version) === 2) {
      let baseStateHash: string | null = null;
      if (state === null) {
        if (revision !== 1) throw new Error(`Campaign ${campaign.campaign_id} subject history has no replay base.`);
        const base = readBase(database, campaign.campaign_id);
        state = normalizeCampaignState(parseJson<CampaignState>(base.state_json));
        baseStateHash = base.state_hash;
      }
      const changes = readChanges(database, event.event_id);
      const expected = subjectEventHash({
        campaignId: campaign.campaign_id,
        revision,
        eventId: event.event_id,
        requestId: event.request_id,
        operationKind: event.operation_kind,
        operation: parseJson(event.operation_json),
        acceptedAt: event.accepted_at,
        previousEventHash: event.previous_event_hash,
        baseStateHash,
        changes,
      });
      if (event.event_hash !== expected || event.before_state_json !== null || event.after_state_json !== '{}') {
        throw new Error(`Campaign ${campaign.campaign_id} history checksum failed at revision ${revision}.`);
      }
      state = applyVerifiedSubjectEvent(database, campaign.campaign_id, event, state, changes);
    } else {
      throw new Error(`Campaign ${campaign.campaign_id} uses unsupported Event schema ${event.event_schema_version}.`);
    }
    previousHash = event.event_hash;
    const snapshot = snapshotsByRevision.get(revision);
    if (snapshot) {
      const storedSnapshotState = parseJson<CampaignState>(snapshot.state_json);
      if (snapshot.state_hash !== sha256(storedSnapshotState) || snapshot.event_hash !== event.event_hash
        || canonicalJson(normalizeCampaignState(storedSnapshotState)) !== canonicalJson(state)) {
      throw new Error(`Campaign ${campaign.campaign_id} snapshot verification failed at revision ${revision}.`);
      }
    }
    snapshotsByRevision.delete(revision);
  }
  if (snapshotsByRevision.size > 0) throw new Error(`Campaign ${campaign.campaign_id} has a snapshot outside immutable history.`);
  const currentState = readCurrentCampaignState(database, campaign);
  if (previousHash !== campaign.head_event_hash || canonicalJson(state) !== canonicalJson(currentState)) {
    throw new Error(`Campaign ${campaign.campaign_id} head does not match immutable history.`);
  }
}

export function reconstructCampaignState(database: DatabaseSync, campaignId: string, revision: number): CampaignState {
  const snapshot = database.prepare(`
    SELECT revision, state_json FROM campaign_snapshots
    WHERE campaign_id = ? AND revision <= ? ORDER BY revision DESC LIMIT 1
  `).get(campaignId, revision) as { revision: number; state_json: string } | undefined;
  let state: CampaignState;
  let startRevision: number;
  if (snapshot) {
    state = normalizeCampaignState(parseJson<CampaignState>(snapshot.state_json));
    startRevision = Number(snapshot.revision);
  } else {
    const legacy = database.prepare(`
      SELECT revision, after_state_json FROM campaign_events
      WHERE campaign_id = ? AND revision <= ? AND event_schema_version = 1
      ORDER BY revision DESC LIMIT 1
    `).get(campaignId, revision) as { revision: number; after_state_json: string } | undefined;
    if (legacy) {
      state = normalizeCampaignState(parseJson<CampaignState>(legacy.after_state_json));
      startRevision = Number(legacy.revision);
    } else {
      const base = readBase(database, campaignId);
      state = normalizeCampaignState(parseJson<CampaignState>(base.state_json));
      startRevision = 0;
    }
  }
  for (const event of eventsFor(database, campaignId, startRevision, revision)) {
    state = Number(event.event_schema_version) === 1
      ? normalizeCampaignState(parseJson<CampaignState>(event.after_state_json))
      : applyVerifiedSubjectEvent(database, campaignId, event, state);
  }
  return state;
}
