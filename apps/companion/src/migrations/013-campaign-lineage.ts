import { createHash } from 'node:crypto';

export const CAMPAIGN_LINEAGE_MIGRATION = Object.freeze({
  version: 13,
  name: 'campaign-lineage-v13',
  source: `
    ALTER TABLE campaigns
      ADD COLUMN lineage_json TEXT;

    ALTER TABLE campaign_bases RENAME TO campaign_bases_v12;
    CREATE TABLE campaign_bases (
      campaign_id TEXT PRIMARY KEY REFERENCES campaigns(campaign_id) ON DELETE CASCADE,
      base_kind TEXT NOT NULL CHECK (base_kind IN ('blank', 'legacy_import', 'branch')),
      state_schema_version INTEGER NOT NULL,
      state_json TEXT NOT NULL,
      state_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    INSERT INTO campaign_bases(campaign_id, base_kind, state_schema_version, state_json, state_hash, created_at)
    SELECT campaign_id, base_kind, state_schema_version, state_json, state_hash, created_at
    FROM campaign_bases_v12;
    DROP TABLE campaign_bases_v12;

    ALTER TABLE campaign_event_changes RENAME TO campaign_event_changes_v12;
    CREATE TABLE campaign_event_changes (
      event_id TEXT NOT NULL REFERENCES campaign_events(event_id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
      subject_kind TEXT NOT NULL CHECK (subject_kind IN (
        'campaign', 'actor', 'item', 'quest', 'place', 'fact', 'world_object',
        'ability', 'learned_ability', 'relationship', 'current_scene', 'scene_archive'
      )),
      subject_id TEXT NOT NULL,
      before_schema_version INTEGER,
      before_image_json TEXT,
      before_hash TEXT,
      after_schema_version INTEGER,
      after_image_json TEXT,
      after_hash TEXT,
      PRIMARY KEY (event_id, ordinal)
    );
    INSERT INTO campaign_event_changes(
      event_id, ordinal, subject_kind, subject_id,
      before_schema_version, before_image_json, before_hash,
      after_schema_version, after_image_json, after_hash
    )
    SELECT event_id, ordinal, subject_kind, subject_id,
           before_schema_version, before_image_json, before_hash,
           after_schema_version, after_image_json, after_hash
    FROM campaign_event_changes_v12;
    DROP TABLE campaign_event_changes_v12;
    CREATE INDEX campaign_event_changes_subject
      ON campaign_event_changes(subject_kind, subject_id);
  `,
});

export function campaignLineageMigrationChecksum(): string {
  return createHash('sha256').update(JSON.stringify(CAMPAIGN_LINEAGE_MIGRATION)).digest('hex');
}
