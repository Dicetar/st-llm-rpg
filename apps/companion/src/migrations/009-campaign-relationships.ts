import { createHash } from 'node:crypto';

export const CAMPAIGN_RELATIONSHIPS_MIGRATION = Object.freeze({
  version: 9,
  name: 'campaign-relationships-v9',
  source: `
    ALTER TABLE campaign_event_changes RENAME TO campaign_event_changes_v8;

    CREATE TABLE campaign_event_changes (
      event_id TEXT NOT NULL REFERENCES campaign_events(event_id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
      subject_kind TEXT NOT NULL CHECK (subject_kind IN (
        'actor', 'item', 'quest', 'place', 'ability', 'learned_ability', 'relationship', 'current_scene'
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
    FROM campaign_event_changes_v8;

    DROP TABLE campaign_event_changes_v8;
    CREATE INDEX campaign_event_changes_subject
      ON campaign_event_changes(subject_kind, subject_id);

    CREATE TABLE campaign_relationship_projections (
      campaign_id TEXT NOT NULL REFERENCES campaigns(campaign_id) ON DELETE CASCADE,
      relationship_id TEXT NOT NULL,
      source_actor_id TEXT NOT NULL,
      target_actor_id TEXT NOT NULL,
      relationship_kind TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active', 'strained', 'dormant', 'ended', 'other')),
      notes TEXT NOT NULL,
      visibility TEXT,
      archived INTEGER NOT NULL CHECK (archived IN (0, 1)),
      PRIMARY KEY (campaign_id, relationship_id)
    );

    CREATE INDEX campaign_relationship_source
      ON campaign_relationship_projections(campaign_id, source_actor_id, target_actor_id);
    CREATE INDEX campaign_relationship_target
      ON campaign_relationship_projections(campaign_id, target_actor_id, source_actor_id);
  `,
});

export function campaignRelationshipsMigrationChecksum(): string {
  return createHash('sha256').update(JSON.stringify(CAMPAIGN_RELATIONSHIPS_MIGRATION)).digest('hex');
}
