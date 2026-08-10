import { createHash } from 'node:crypto';

const EMPTY_PREFIX_HASH = createHash('sha256').update('').digest('hex');

export const STORY_SYNC_JOBS_MIGRATION = Object.freeze({
  version: 6,
  name: 'story-sync-jobs-v6',
  source: `
    ALTER TABLE chat_bindings
      ADD COLUMN sync_facet_revision INTEGER NOT NULL DEFAULT 1
      CHECK (sync_facet_revision >= 1);

    ALTER TABLE chat_bindings
      ADD COLUMN sync_through_message_index INTEGER NOT NULL DEFAULT -1
      CHECK (sync_through_message_index >= -1);

    ALTER TABLE chat_bindings
      ADD COLUMN sync_prefix_hash TEXT NOT NULL DEFAULT '${EMPTY_PREFIX_HASH}';

    CREATE TABLE worker_model_profiles (
      profile_id TEXT PRIMARY KEY,
      model_id TEXT NOT NULL,
      requested_output_tokens INTEGER NOT NULL
        CHECK (requested_output_tokens BETWEEN 128 AND 8192),
      updated_at TEXT NOT NULL
    );

    CREATE TABLE worker_jobs (
      job_id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL UNIQUE,
      campaign_id TEXT NOT NULL REFERENCES campaigns(campaign_id) ON DELETE CASCADE,
      binding_id TEXT NOT NULL REFERENCES chat_bindings(binding_id) ON DELETE CASCADE,
      profile_id TEXT NOT NULL REFERENCES worker_model_profiles(profile_id),
      status TEXT NOT NULL CHECK (status IN (
        'queued', 'waiting-for-lane', 'running', 'parsing', 'repairing',
        'ready-for-review', 'interrupted', 'cancelled', 'failed', 'discarded',
        'awaiting-authority', 'completed'
      )),
      campaign_anchor INTEGER NOT NULL CHECK (campaign_anchor >= 1),
      binding_revision INTEGER NOT NULL CHECK (binding_revision >= 1),
      sync_facet_revision INTEGER NOT NULL CHECK (sync_facet_revision >= 1),
      source_json TEXT NOT NULL,
      source_fingerprint TEXT NOT NULL,
      source_end_prefix_hash TEXT NOT NULL,
      source_first_message_index INTEGER NOT NULL CHECK (source_first_message_index >= 0),
      source_last_message_index INTEGER NOT NULL CHECK (source_last_message_index >= source_first_message_index),
      source_message_count INTEGER NOT NULL CHECK (source_message_count BETWEEN 1 AND 12),
      source_content_pruned INTEGER NOT NULL DEFAULT 0 CHECK (source_content_pruned IN (0, 1)),
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      problem_code TEXT,
      problem_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX worker_jobs_campaign_status
      ON worker_jobs(campaign_id, status, updated_at DESC);
    CREATE INDEX worker_jobs_binding_status
      ON worker_jobs(binding_id, status, updated_at DESC);

    CREATE TABLE worker_attempts (
      attempt_id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES worker_jobs(job_id) ON DELETE CASCADE,
      attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
      status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'interrupted', 'cancelled', 'failed')),
      termination TEXT,
      output_hash TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      UNIQUE(job_id, attempt_number)
    );

    CREATE TABLE story_sync_proposals (
      proposal_id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES worker_jobs(job_id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
      revision INTEGER NOT NULL CHECK (revision >= 1),
      decision TEXT NOT NULL CHECK (decision IN ('pending', 'accept', 'reject', 'defer')),
      draft_json TEXT NOT NULL,
      source_links_json TEXT NOT NULL,
      validation_problems_json TEXT NOT NULL,
      confidence TEXT NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
      UNIQUE(job_id, ordinal)
    );
  `,
});

export function storySyncJobsMigrationChecksum(): string {
  return createHash('sha256').update(JSON.stringify(STORY_SYNC_JOBS_MIGRATION)).digest('hex');
}
