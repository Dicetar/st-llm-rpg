import { createHash } from 'node:crypto';

export const CAMPAIGN_AUTHORITY_MIGRATION = Object.freeze({
  version: 1,
  name: 'campaign-authority-v1',
  source: `
    CREATE TABLE store_meta (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      store_epoch TEXT NOT NULL
    );

    CREATE TABLE campaigns (
      campaign_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
      current_revision INTEGER NOT NULL CHECK (current_revision >= 1),
      current_state_json TEXT NOT NULL,
      head_event_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE campaign_events (
      campaign_id TEXT NOT NULL REFERENCES campaigns(campaign_id) ON DELETE CASCADE,
      revision INTEGER NOT NULL,
      event_id TEXT NOT NULL UNIQUE,
      request_id TEXT NOT NULL UNIQUE,
      event_schema_version INTEGER NOT NULL,
      operation_kind TEXT NOT NULL,
      operation_json TEXT NOT NULL,
      before_state_json TEXT,
      after_state_json TEXT NOT NULL,
      accepted_at TEXT NOT NULL,
      previous_event_hash TEXT,
      event_hash TEXT NOT NULL,
      PRIMARY KEY (campaign_id, revision)
    );

    CREATE TABLE campaign_snapshots (
      campaign_id TEXT NOT NULL REFERENCES campaigns(campaign_id) ON DELETE CASCADE,
      revision INTEGER NOT NULL,
      schema_version INTEGER NOT NULL,
      state_json TEXT NOT NULL,
      state_hash TEXT NOT NULL,
      event_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (campaign_id, revision)
    );

    CREATE TABLE request_receipts (
      request_id TEXT PRIMARY KEY,
      request_hash TEXT NOT NULL,
      campaign_id TEXT NOT NULL,
      outcome_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `,
});

export function campaignMigrationChecksum(): string {
  return createHash('sha256').update(JSON.stringify(CAMPAIGN_AUTHORITY_MIGRATION)).digest('hex');
}
