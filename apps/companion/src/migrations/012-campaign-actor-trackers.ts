import { createHash } from 'node:crypto';

export const CAMPAIGN_ACTOR_TRACKERS_MIGRATION = Object.freeze({
  version: 12,
  name: 'campaign-actor-trackers-v12',
  source: `
    ALTER TABLE campaign_actor_projections
      ADD COLUMN trackers_json TEXT;
  `,
});

export function campaignActorTrackersMigrationChecksum(): string {
  return createHash('sha256').update(JSON.stringify(CAMPAIGN_ACTOR_TRACKERS_MIGRATION)).digest('hex');
}
