import { createHash } from 'node:crypto';

export const CAMPAIGN_CURRENT_PROJECTIONS_MIGRATION = Object.freeze({
  version: 3,
  name: 'campaign-current-projections-v3',
  source: `
    CREATE TABLE campaign_actor_projections (
      campaign_id TEXT NOT NULL REFERENCES campaigns(campaign_id) ON DELETE CASCADE,
      actor_id TEXT NOT NULL,
      name TEXT NOT NULL,
      summary TEXT NOT NULL,
      archived INTEGER NOT NULL CHECK (archived IN (0, 1)),
      PRIMARY KEY (campaign_id, actor_id)
    );

    CREATE TABLE campaign_item_projections (
      campaign_id TEXT NOT NULL REFERENCES campaigns(campaign_id) ON DELETE CASCADE,
      item_id TEXT NOT NULL,
      name TEXT NOT NULL,
      summary TEXT NOT NULL,
      archived INTEGER NOT NULL CHECK (archived IN (0, 1)),
      owner_actor_id TEXT,
      PRIMARY KEY (campaign_id, item_id)
    );

    CREATE TABLE campaign_quest_projections (
      campaign_id TEXT NOT NULL REFERENCES campaigns(campaign_id) ON DELETE CASCADE,
      quest_id TEXT NOT NULL,
      name TEXT NOT NULL,
      summary TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active', 'completed')),
      archived INTEGER NOT NULL CHECK (archived IN (0, 1)),
      PRIMARY KEY (campaign_id, quest_id)
    );

    CREATE TABLE campaign_place_projections (
      campaign_id TEXT NOT NULL REFERENCES campaigns(campaign_id) ON DELETE CASCADE,
      place_id TEXT NOT NULL,
      name TEXT NOT NULL,
      summary TEXT NOT NULL,
      archived INTEGER NOT NULL CHECK (archived IN (0, 1)),
      PRIMARY KEY (campaign_id, place_id)
    );

    CREATE TABLE campaign_scene_projections (
      campaign_id TEXT PRIMARY KEY REFERENCES campaigns(campaign_id) ON DELETE CASCADE,
      scene_id TEXT NOT NULL,
      name TEXT NOT NULL,
      summary TEXT NOT NULL
    );

    CREATE INDEX campaign_actor_projections_name
      ON campaign_actor_projections(campaign_id, name, actor_id);
    CREATE INDEX campaign_item_projections_name
      ON campaign_item_projections(campaign_id, name, item_id);
    CREATE INDEX campaign_quest_projections_name
      ON campaign_quest_projections(campaign_id, name, quest_id);
    CREATE INDEX campaign_place_projections_name
      ON campaign_place_projections(campaign_id, name, place_id);
  `,
});

export function campaignCurrentProjectionsMigrationChecksum(): string {
  return createHash('sha256').update(JSON.stringify(CAMPAIGN_CURRENT_PROJECTIONS_MIGRATION)).digest('hex');
}
