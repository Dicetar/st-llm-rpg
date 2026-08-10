import { createHash } from 'node:crypto';

export const CAMPAIGN_WORLD_RECORDS_MIGRATION = Object.freeze({
  version: 10,
  name: 'campaign-world-records-v10',
  source: `
    ALTER TABLE campaign_event_changes RENAME TO campaign_event_changes_v9;

    CREATE TABLE campaign_event_changes (
      event_id TEXT NOT NULL REFERENCES campaign_events(event_id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
      subject_kind TEXT NOT NULL CHECK (subject_kind IN (
        'actor', 'item', 'quest', 'place', 'fact', 'world_object',
        'ability', 'learned_ability', 'relationship', 'current_scene'
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
    FROM campaign_event_changes_v9;

    DROP TABLE campaign_event_changes_v9;
    CREATE INDEX campaign_event_changes_subject
      ON campaign_event_changes(subject_kind, subject_id);

    CREATE TABLE campaign_fact_projections (
      campaign_id TEXT NOT NULL REFERENCES campaigns(campaign_id) ON DELETE CASCADE,
      fact_id TEXT NOT NULL,
      name TEXT NOT NULL,
      aliases_json TEXT,
      summary TEXT NOT NULL,
      visibility TEXT,
      archived INTEGER NOT NULL CHECK (archived IN (0, 1)),
      subject_id TEXT,
      PRIMARY KEY (campaign_id, fact_id)
    );

    CREATE TABLE campaign_world_object_projections (
      campaign_id TEXT NOT NULL REFERENCES campaigns(campaign_id) ON DELETE CASCADE,
      world_object_id TEXT NOT NULL,
      name TEXT NOT NULL,
      aliases_json TEXT,
      summary TEXT NOT NULL,
      visibility TEXT,
      archived INTEGER NOT NULL CHECK (archived IN (0, 1)),
      place_id TEXT,
      PRIMARY KEY (campaign_id, world_object_id)
    );

    ALTER TABLE campaign_scene_projections
      ADD COLUMN world_object_ids_json TEXT;

    CREATE INDEX campaign_fact_projections_name
      ON campaign_fact_projections(campaign_id, name, fact_id);
    CREATE INDEX campaign_fact_projections_subject
      ON campaign_fact_projections(campaign_id, subject_id, fact_id);
    CREATE INDEX campaign_world_object_projections_name
      ON campaign_world_object_projections(campaign_id, name, world_object_id);
    CREATE INDEX campaign_world_object_projections_place
      ON campaign_world_object_projections(campaign_id, place_id, world_object_id);
  `,
});

export function campaignWorldRecordsMigrationChecksum(): string {
  return createHash('sha256').update(JSON.stringify(CAMPAIGN_WORLD_RECORDS_MIGRATION)).digest('hex');
}
