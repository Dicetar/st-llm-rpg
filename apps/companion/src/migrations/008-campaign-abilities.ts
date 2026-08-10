import { createHash } from 'node:crypto';

export const CAMPAIGN_ABILITIES_MIGRATION = Object.freeze({
  version: 8,
  name: 'campaign-abilities-v8',
  source: `
    ALTER TABLE campaign_event_changes RENAME TO campaign_event_changes_v7;

    CREATE TABLE campaign_event_changes (
      event_id TEXT NOT NULL REFERENCES campaign_events(event_id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
      subject_kind TEXT NOT NULL CHECK (subject_kind IN (
        'actor', 'item', 'quest', 'place', 'ability', 'learned_ability', 'current_scene'
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
    FROM campaign_event_changes_v7;

    DROP TABLE campaign_event_changes_v7;
    CREATE INDEX campaign_event_changes_subject
      ON campaign_event_changes(subject_kind, subject_id);

    CREATE TABLE campaign_ability_projections (
      campaign_id TEXT NOT NULL REFERENCES campaigns(campaign_id) ON DELETE CASCADE,
      ability_id TEXT NOT NULL,
      name TEXT NOT NULL,
      aliases_json TEXT,
      summary TEXT NOT NULL,
      visibility TEXT,
      category TEXT NOT NULL CHECK (category IN ('spell', 'skill', 'feat', 'other')),
      archived INTEGER NOT NULL CHECK (archived IN (0, 1)),
      PRIMARY KEY (campaign_id, ability_id)
    );

    CREATE TABLE campaign_learned_ability_projections (
      campaign_id TEXT NOT NULL REFERENCES campaigns(campaign_id) ON DELETE CASCADE,
      learned_ability_id TEXT NOT NULL,
      ability_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      prepared INTEGER NOT NULL CHECK (prepared IN (0, 1)),
      enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
      uses_remaining INTEGER CHECK (uses_remaining IS NULL OR uses_remaining >= 0),
      uses_maximum INTEGER CHECK (uses_maximum IS NULL OR uses_maximum >= 0),
      archived INTEGER NOT NULL CHECK (archived IN (0, 1)),
      PRIMARY KEY (campaign_id, learned_ability_id)
    );

    CREATE INDEX campaign_ability_projections_name
      ON campaign_ability_projections(campaign_id, name, ability_id);
    CREATE INDEX campaign_learned_ability_actor
      ON campaign_learned_ability_projections(campaign_id, actor_id, ability_id);
    CREATE INDEX campaign_learned_ability_ability
      ON campaign_learned_ability_projections(campaign_id, ability_id, actor_id);
  `,
});

export function campaignAbilitiesMigrationChecksum(): string {
  return createHash('sha256').update(JSON.stringify(CAMPAIGN_ABILITIES_MIGRATION)).digest('hex');
}
