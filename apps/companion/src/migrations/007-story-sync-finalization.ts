import { createHash } from 'node:crypto';

export const STORY_SYNC_FINALIZATION_MIGRATION = Object.freeze({
  version: 7,
  name: 'story-sync-finalization-v7',
  source: `
    ALTER TABLE worker_jobs ADD COLUMN finalization_request_id TEXT;
    ALTER TABLE worker_jobs ADD COLUMN decision_hash TEXT;
    ALTER TABLE worker_jobs ADD COLUMN campaign_event_id TEXT;
    ALTER TABLE worker_jobs ADD COLUMN binding_event_id TEXT;
    ALTER TABLE worker_jobs ADD COLUMN completed_campaign_revision INTEGER
      CHECK (completed_campaign_revision IS NULL OR completed_campaign_revision >= 1);
    ALTER TABLE worker_jobs ADD COLUMN completed_binding_revision INTEGER
      CHECK (completed_binding_revision IS NULL OR completed_binding_revision >= 1);
    ALTER TABLE worker_jobs ADD COLUMN finalized_at TEXT;

    CREATE UNIQUE INDEX worker_jobs_finalization_request
      ON worker_jobs(finalization_request_id)
      WHERE finalization_request_id IS NOT NULL;
  `,
});

export function storySyncFinalizationMigrationChecksum(): string {
  return createHash('sha256').update(JSON.stringify(STORY_SYNC_FINALIZATION_MIGRATION)).digest('hex');
}
