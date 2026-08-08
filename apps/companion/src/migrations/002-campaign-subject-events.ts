import { createHash } from 'node:crypto';

export const CAMPAIGN_SUBJECT_EVENTS_MIGRATION = Object.freeze({
  version: 2,
  name: 'campaign-subject-events-v2',
  source: `
    CREATE TABLE campaign_bases (
      campaign_id TEXT PRIMARY KEY REFERENCES campaigns(campaign_id) ON DELETE CASCADE,
      base_kind TEXT NOT NULL CHECK (base_kind IN ('blank', 'legacy_import')),
      state_schema_version INTEGER NOT NULL,
      state_json TEXT NOT NULL,
      state_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE campaign_event_changes (
      event_id TEXT NOT NULL REFERENCES campaign_events(event_id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
      subject_kind TEXT NOT NULL CHECK (subject_kind IN ('actor', 'item', 'quest', 'place', 'current_scene')),
      subject_id TEXT NOT NULL,
      before_schema_version INTEGER,
      before_image_json TEXT,
      before_hash TEXT,
      after_schema_version INTEGER,
      after_image_json TEXT,
      after_hash TEXT,
      PRIMARY KEY (event_id, ordinal)
    );

    CREATE INDEX campaign_event_changes_subject
      ON campaign_event_changes(subject_kind, subject_id);
  `,
});

export function campaignSubjectEventsMigrationChecksum(): string {
  return createHash('sha256').update(JSON.stringify(CAMPAIGN_SUBJECT_EVENTS_MIGRATION)).digest('hex');
}
