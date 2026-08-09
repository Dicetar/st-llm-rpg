import { createHash } from 'node:crypto';

export const CONTEXT_PLANNING_MIGRATION = Object.freeze({
  version: 5,
  name: 'context-planning-v5',
  source: `
    ALTER TABLE chat_bindings
      ADD COLUMN context_focus_revision INTEGER NOT NULL DEFAULT 1
      CHECK (context_focus_revision >= 1);

    ALTER TABLE chat_bindings
      ADD COLUMN pins_json TEXT NOT NULL DEFAULT '[]';

    ALTER TABLE campaign_actor_projections
      ADD COLUMN aliases_json TEXT;
    ALTER TABLE campaign_actor_projections
      ADD COLUMN visibility TEXT;

    ALTER TABLE campaign_item_projections
      ADD COLUMN aliases_json TEXT;
    ALTER TABLE campaign_item_projections
      ADD COLUMN visibility TEXT;

    ALTER TABLE campaign_quest_projections
      ADD COLUMN aliases_json TEXT;
    ALTER TABLE campaign_quest_projections
      ADD COLUMN visibility TEXT;

    ALTER TABLE campaign_place_projections
      ADD COLUMN aliases_json TEXT;
    ALTER TABLE campaign_place_projections
      ADD COLUMN visibility TEXT;

    ALTER TABLE campaign_scene_projections
      ADD COLUMN place_id TEXT;
    ALTER TABLE campaign_scene_projections
      ADD COLUMN actor_ids_json TEXT;
    ALTER TABLE campaign_scene_projections
      ADD COLUMN item_ids_json TEXT;

    CREATE TABLE narrator_model_profiles (
      profile_id TEXT PRIMARY KEY,
      model_id TEXT NOT NULL,
      profile_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE context_search_fts USING fts5(
      campaign_id UNINDEXED,
      campaign_revision UNINDEXED,
      record_id UNINDEXED,
      record_kind UNINDEXED,
      name,
      aliases,
      summary,
      tokenize = 'unicode61 remove_diacritics 2'
    );
  `,
});

export function contextPlanningMigrationChecksum(): string {
  return createHash('sha256').update(JSON.stringify(CONTEXT_PLANNING_MIGRATION)).digest('hex');
}
