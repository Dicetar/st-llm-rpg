import { createHash } from 'node:crypto';

export const CAMPAIGN_SCENE_ARCHIVES_MIGRATION = Object.freeze({
  version: 11,
  name: 'campaign-scene-archives-v11',
  source: `
    ALTER TABLE campaign_event_changes RENAME TO campaign_event_changes_v10;

    CREATE TABLE campaign_event_changes (
      event_id TEXT NOT NULL REFERENCES campaign_events(event_id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
      subject_kind TEXT NOT NULL CHECK (subject_kind IN (
        'actor', 'item', 'quest', 'place', 'fact', 'world_object',
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
    FROM campaign_event_changes_v10;

    DROP TABLE campaign_event_changes_v10;
    CREATE INDEX campaign_event_changes_subject
      ON campaign_event_changes(subject_kind, subject_id);

    CREATE TABLE campaign_scene_archive_projections (
      campaign_id TEXT NOT NULL REFERENCES campaigns(campaign_id) ON DELETE CASCADE,
      scene_archive_id TEXT NOT NULL,
      name TEXT NOT NULL,
      summary TEXT NOT NULL,
      place_id TEXT,
      actor_ids_json TEXT,
      item_ids_json TEXT,
      world_object_ids_json TEXT,
      outcomes_json TEXT NOT NULL,
      open_threads_json TEXT NOT NULL,
      closed_at TEXT NOT NULL,
      PRIMARY KEY (campaign_id, scene_archive_id)
    );

    CREATE INDEX campaign_scene_archive_projections_closed
      ON campaign_scene_archive_projections(campaign_id, closed_at DESC, scene_archive_id);
  `,
});

export function campaignSceneArchivesMigrationChecksum(): string {
  return createHash('sha256').update(JSON.stringify(CAMPAIGN_SCENE_ARCHIVES_MIGRATION)).digest('hex');
}
