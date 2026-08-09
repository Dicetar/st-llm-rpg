import { createHash } from 'node:crypto';

export const CHAT_BINDINGS_MIGRATION = Object.freeze({
  version: 4,
  name: 'chat-bindings-v4',
  source: `
    CREATE TABLE chat_bindings (
      binding_id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(campaign_id) ON DELETE CASCADE,
      binding_revision INTEGER NOT NULL CHECK (binding_revision >= 1),
      campaign_anchor INTEGER NOT NULL CHECK (campaign_anchor >= 1),
      locator_json TEXT NOT NULL,
      locator_fingerprint TEXT NOT NULL,
      source_fingerprint TEXT NOT NULL UNIQUE,
      content_fingerprint TEXT NOT NULL,
      marker_state TEXT NOT NULL CHECK (marker_state IN ('pending', 'verified', 'blocked')),
      marker_problem TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX chat_bindings_campaign ON chat_bindings(campaign_id, binding_id);
    CREATE INDEX chat_bindings_locator ON chat_bindings(locator_fingerprint, updated_at DESC);
    CREATE INDEX chat_bindings_content ON chat_bindings(content_fingerprint, created_at);

    CREATE TABLE chat_binding_events (
      binding_id TEXT NOT NULL REFERENCES chat_bindings(binding_id) ON DELETE CASCADE,
      revision INTEGER NOT NULL,
      event_id TEXT NOT NULL UNIQUE,
      request_id TEXT NOT NULL UNIQUE,
      operation_kind TEXT NOT NULL,
      operation_json TEXT NOT NULL,
      accepted_at TEXT NOT NULL,
      PRIMARY KEY (binding_id, revision)
    );

    CREATE TABLE legacy_import_sources (
      source_fingerprint TEXT PRIMARY KEY REFERENCES chat_bindings(source_fingerprint) ON DELETE CASCADE,
      content_fingerprint TEXT NOT NULL,
      locator_fingerprint TEXT NOT NULL,
      campaign_id TEXT NOT NULL REFERENCES campaigns(campaign_id) ON DELETE CASCADE,
      binding_id TEXT NOT NULL REFERENCES chat_bindings(binding_id) ON DELETE CASCADE,
      legacy_revision INTEGER NOT NULL CHECK (legacy_revision >= 1),
      envelope_json TEXT NOT NULL,
      imported_at TEXT NOT NULL
    );

    CREATE INDEX legacy_import_content ON legacy_import_sources(content_fingerprint, imported_at);
    CREATE INDEX legacy_import_locator ON legacy_import_sources(locator_fingerprint, imported_at DESC);
  `,
});

export function chatBindingsMigrationChecksum(): string {
  return createHash('sha256').update(JSON.stringify(CHAT_BINDINGS_MIGRATION)).digest('hex');
}
