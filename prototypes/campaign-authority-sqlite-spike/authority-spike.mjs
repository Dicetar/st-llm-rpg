import { createHash, randomUUID } from 'node:crypto';
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';

const APPLICATION_ID = 0x52504732;
const DAY_MS = 24 * 60 * 60 * 1000;

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter(key => value[key] !== undefined)
        .map(key => [key, sortValue(value[key])]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

export function sha256(value) {
  const input = typeof value === 'string' || ArrayBuffer.isView(value)
    ? value
    : canonicalJson(value);
  return createHash('sha256').update(input).digest('hex');
}

function parseJson(value, fallback = null) {
  return value == null ? fallback : JSON.parse(value);
}

function clone(value) {
  return structuredClone(value);
}

function nowIso() {
  return new Date().toISOString();
}

function outcomeProblem(error) {
  return {
    ok: false,
    problem: {
      code: error.code,
      message: error.message,
      details: error.details ?? null,
      retryable: false,
    },
  };
}

export class SpikeProblem extends Error {
  constructor(code, message, details = null, { terminal = true } = {}) {
    super(message);
    this.name = 'SpikeProblem';
    this.code = code;
    this.details = details;
    this.terminal = terminal;
  }
}

function assertText(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new SpikeProblem('validation_failed', `${name} is required.`);
  }
  return value.trim();
}

function baseSchemaSql() {
  return `
    CREATE TABLE store_meta (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      store_epoch TEXT NOT NULL
    );

    CREATE TABLE request_receipts (
      request_id TEXT PRIMARY KEY,
      request_hash TEXT NOT NULL,
      scope TEXT NOT NULL,
      campaign_id TEXT,
      binding_id TEXT,
      terminal_kind TEXT NOT NULL CHECK (terminal_kind IN ('accepted', 'rejected')),
      outcome_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE accepted_commits (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      commit_id TEXT NOT NULL UNIQUE,
      request_id TEXT NOT NULL UNIQUE,
      accepted_by_json TEXT NOT NULL,
      committed_at TEXT NOT NULL
    );

    CREATE TABLE change_scopes (
      sequence INTEGER NOT NULL REFERENCES accepted_commits(sequence) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL,
      scope TEXT NOT NULL,
      campaign_id TEXT,
      binding_id TEXT,
      campaign_revision INTEGER,
      binding_revision INTEGER,
      data_json TEXT NOT NULL,
      PRIMARY KEY (sequence, ordinal)
    );

    CREATE TABLE campaigns (
      campaign_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
      current_revision INTEGER NOT NULL CHECK (current_revision >= 1),
      head_event_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      archived_at TEXT
    );

    CREATE TABLE campaign_bases (
      campaign_id TEXT PRIMARY KEY REFERENCES campaigns(campaign_id) ON DELETE CASCADE,
      base_kind TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      state_json TEXT NOT NULL,
      state_hash TEXT NOT NULL,
      source_campaign_id TEXT,
      source_revision INTEGER,
      source_event_hash TEXT,
      source_title TEXT
    );

    CREATE TABLE campaign_events (
      campaign_id TEXT NOT NULL REFERENCES campaigns(campaign_id) ON DELETE CASCADE,
      revision INTEGER NOT NULL,
      event_id TEXT NOT NULL UNIQUE,
      sequence INTEGER NOT NULL REFERENCES accepted_commits(sequence),
      request_id TEXT NOT NULL,
      event_schema_version INTEGER NOT NULL,
      operation_kind TEXT NOT NULL,
      operation_json TEXT NOT NULL,
      accepted_at TEXT NOT NULL,
      accepted_by_json TEXT NOT NULL,
      affected_json TEXT NOT NULL,
      base_hash TEXT,
      previous_event_hash TEXT,
      event_hash TEXT NOT NULL,
      PRIMARY KEY (campaign_id, revision)
    );

    CREATE TABLE campaign_event_changes (
      event_id TEXT NOT NULL REFERENCES campaign_events(event_id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL,
      subject_kind TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      before_json TEXT,
      before_hash TEXT,
      after_json TEXT,
      after_hash TEXT,
      PRIMARY KEY (event_id, ordinal)
    );

    CREATE TABLE campaign_snapshots (
      campaign_id TEXT NOT NULL REFERENCES campaigns(campaign_id) ON DELETE CASCADE,
      revision INTEGER NOT NULL,
      schema_version INTEGER NOT NULL,
      state_json TEXT NOT NULL,
      state_hash TEXT NOT NULL,
      event_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (campaign_id, revision)
    );

    CREATE TABLE subject_current (
      campaign_id TEXT NOT NULL REFERENCES campaigns(campaign_id) ON DELETE CASCADE,
      subject_id TEXT NOT NULL,
      subject_kind TEXT NOT NULL,
      name TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0,
      state_json TEXT NOT NULL,
      changed_revision INTEGER NOT NULL,
      PRIMARY KEY (campaign_id, subject_id)
    );

    CREATE INDEX subject_current_collection
      ON subject_current(campaign_id, archived, subject_kind, name, subject_id);

    CREATE TABLE reference_current (
      campaign_id TEXT NOT NULL REFERENCES campaigns(campaign_id) ON DELETE CASCADE,
      reference_id TEXT NOT NULL,
      source_subject_id TEXT NOT NULL,
      target_subject_id TEXT NOT NULL,
      state_json TEXT NOT NULL,
      changed_revision INTEGER NOT NULL,
      PRIMARY KEY (campaign_id, reference_id)
    );

    CREATE INDEX reference_current_target
      ON reference_current(campaign_id, target_subject_id);

    CREATE TABLE subject_tombstones (
      campaign_id TEXT NOT NULL REFERENCES campaigns(campaign_id) ON DELETE CASCADE,
      subject_id TEXT NOT NULL,
      deleted_revision INTEGER NOT NULL,
      PRIMARY KEY (campaign_id, subject_id)
    );

    CREATE TABLE chat_bindings (
      binding_id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active', 'unlinked', 'campaign_purged')),
      binding_revision INTEGER NOT NULL,
      identity_revision INTEGER NOT NULL,
      anchor_revision INTEGER NOT NULL,
      sync_revision INTEGER NOT NULL,
      pins_revision INTEGER NOT NULL,
      campaign_anchor INTEGER,
      locator_hash TEXT,
      locator_json TEXT,
      state_json TEXT NOT NULL,
      head_event_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX active_binding_locator
      ON chat_bindings(locator_hash)
      WHERE status = 'active' AND locator_hash IS NOT NULL;

    CREATE TABLE binding_events (
      binding_id TEXT NOT NULL REFERENCES chat_bindings(binding_id) ON DELETE CASCADE,
      binding_revision INTEGER NOT NULL,
      event_id TEXT NOT NULL UNIQUE,
      sequence INTEGER NOT NULL REFERENCES accepted_commits(sequence),
      request_id TEXT NOT NULL,
      event_schema_version INTEGER NOT NULL,
      event_kind TEXT NOT NULL,
      changed_facets_json TEXT NOT NULL,
      before_json TEXT,
      after_json TEXT NOT NULL,
      accepted_at TEXT NOT NULL,
      accepted_by_json TEXT NOT NULL,
      previous_event_hash TEXT,
      event_hash TEXT NOT NULL,
      PRIMARY KEY (binding_id, binding_revision)
    );

    CREATE TABLE binding_pins (
      binding_id TEXT NOT NULL REFERENCES chat_bindings(binding_id) ON DELETE CASCADE,
      subject_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (binding_id, subject_id)
    );

    CREATE TABLE purge_receipts (
      campaign_id TEXT PRIMARY KEY,
      purged_at TEXT NOT NULL,
      final_revision INTEGER NOT NULL,
      final_event_hash TEXT NOT NULL,
      backup_receipt_json TEXT NOT NULL,
      request_id TEXT NOT NULL UNIQUE
    );
  `;
}

export const BASE_MIGRATION = Object.freeze({
  version: 1,
  name: 'campaign-authority-spike-base',
  source: baseSchemaSql(),
  apply(db) {
    db.exec(baseSchemaSql());
    db.prepare('INSERT INTO store_meta(singleton, store_epoch) VALUES (1, ?)').run(randomUUID());
  },
});

function configure(db) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA wal_autocheckpoint = 1000;
    PRAGMA application_id = ${APPLICATION_ID};
  `);
}

function bootstrapMigrationLedger(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
}

function migrationChecksum(migration) {
  return sha256({ version: migration.version, name: migration.name, source: migration.source });
}

function quickCheck(db) {
  const quick = db.prepare('PRAGMA quick_check').all();
  const foreign = db.prepare('PRAGMA foreign_key_check').all();
  return {
    ok: quick.length === 1 && Object.values(quick[0])[0] === 'ok' && foreign.length === 0,
    quick,
    foreign,
  };
}

function readStoreEpoch(db) {
  return db.prepare('SELECT store_epoch FROM store_meta WHERE singleton = 1').get()?.store_epoch ?? null;
}

function toState(campaign, base, subjects, references) {
  const baseState = parseJson(base.state_json);
  return {
    campaign: {
      ...baseState.campaign,
      id: campaign.campaign_id,
      title: campaign.title,
      status: campaign.status,
    },
    subjects: Object.fromEntries(subjects.map(row => [row.subject_id, parseJson(row.state_json)])),
    references: Object.fromEntries(references.map(row => [row.reference_id, parseJson(row.state_json)])),
  };
}

function eventHashInput(event, changes) {
  return {
    campaignId: event.campaignId,
    revision: event.revision,
    eventId: event.eventId,
    requestId: event.requestId,
    eventSchemaVersion: event.eventSchemaVersion,
    operationKind: event.operationKind,
    operation: event.operation,
    acceptedAt: event.acceptedAt,
    acceptedBy: event.acceptedBy,
    affected: event.affected,
    baseHash: event.baseHash ?? null,
    previousEventHash: event.previousEventHash ?? null,
    changes: changes.map(change => ({
      subjectKind: change.subjectKind,
      subjectId: change.subjectId,
      beforeHash: change.before == null ? null : sha256(change.before),
      afterHash: change.after == null ? null : sha256(change.after),
    })),
  };
}

function bindingHashInput(event) {
  return {
    bindingId: event.bindingId,
    bindingRevision: event.bindingRevision,
    eventId: event.eventId,
    requestId: event.requestId,
    eventSchemaVersion: event.eventSchemaVersion,
    eventKind: event.eventKind,
    changedFacets: event.changedFacets,
    beforeHash: event.before == null ? null : sha256(event.before),
    afterHash: sha256(event.after),
    acceptedAt: event.acceptedAt,
    acceptedBy: event.acceptedBy,
    previousEventHash: event.previousEventHash ?? null,
  };
}

function applyAfterImage(state, change) {
  if (change.subjectKind === 'campaign') {
    if (change.after == null) throw new SpikeProblem('history_corrupt', 'Campaign root cannot be deleted.');
    state.campaign = clone(change.after);
    return;
  }
  const collection = change.subjectKind === 'reference' ? state.references : state.subjects;
  if (change.after == null) delete collection[change.subjectId];
  else collection[change.subjectId] = clone(change.after);
}

function normalizeSubject(input) {
  const subject = clone(input);
  subject.id = assertText(subject.id, 'Subject ID');
  subject.kind = assertText(subject.kind, 'Subject kind');
  subject.name = assertText(subject.name, 'Subject name');
  subject.archived = Boolean(subject.archived);
  return subject;
}

function normalizeReference(input) {
  const reference = clone(input);
  reference.id = assertText(reference.id, 'Reference ID');
  reference.sourceId = assertText(reference.sourceId, 'Reference source');
  reference.targetId = assertText(reference.targetId, 'Reference target');
  reference.path = assertText(reference.path, 'Reference path');
  return reference;
}

function changedFacetNames(operation) {
  if (operation.kind === 'replace-pins') return ['pins'];
  if (operation.kind === 'set-sync-boundary') return ['sync'];
  if (operation.kind === 'follow-campaign-head') return ['anchor'];
  if (operation.kind === 'move-locator') return ['identity'];
  if (operation.kind === 'unlink' || operation.kind === 'restore-binding') return ['identity'];
  throw new SpikeProblem('validation_failed', `Unknown Binding Operation: ${operation.kind}`);
}

function cursor(db, sequence) {
  return { storeEpoch: readStoreEpoch(db), sequence: Number(sequence) };
}

export class AuthoritySpike {
  constructor(databasePath) {
    this.databasePath = path.resolve(databasePath);
    this.db = new DatabaseSync(this.databasePath);
    configure(this.db);
    bootstrapMigrationLedger(this.db);
    this.#applyMigrationSync(BASE_MIGRATION);
  }

  close() {
    if (!this.db) return;
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    this.db.close();
    this.db = null;
  }

  storeEpoch() {
    return readStoreEpoch(this.db);
  }

  schemaVersion() {
    return Number(this.db.prepare('PRAGMA user_version').get().user_version);
  }

  #applyMigrationSync(migration) {
    const checksum = migrationChecksum(migration);
    const existing = this.db.prepare('SELECT * FROM schema_migrations WHERE version = ?').get(migration.version);
    if (existing) {
      if (existing.checksum !== checksum || existing.name !== migration.name) {
        throw new SpikeProblem('migration_checksum_mismatch', `Migration ${migration.version} changed after application.`);
      }
      return false;
    }

    this.db.exec('BEGIN IMMEDIATE');
    try {
      migration.apply(this.db);
      this.db.prepare(
        'INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
      ).run(migration.version, migration.name, checksum, nowIso());
      this.db.exec(`PRAGMA user_version = ${Number(migration.version)}`);
      this.db.exec('COMMIT');
      return true;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  async applyMigrations(migrations, { backupDirectory = null } = {}) {
    const ordered = [...migrations].sort((a, b) => a.version - b.version);
    for (const migration of ordered) {
      const checksum = migrationChecksum(migration);
      const existing = this.db.prepare('SELECT * FROM schema_migrations WHERE version = ?').get(migration.version);
      if (existing) {
        if (existing.checksum !== checksum || existing.name !== migration.name) {
          throw new SpikeProblem('migration_checksum_mismatch', `Migration ${migration.version} changed after application.`);
        }
        continue;
      }
      if (backupDirectory) {
        await this.createValidatedBackup(backupDirectory, `pre-migration-v${migration.version}`);
      }
      this.#applyMigrationSync(migration);
    }
    const check = quickCheck(this.db);
    if (!check.ok) throw new SpikeProblem('database_invalid', 'Database failed post-migration validation.', check);
    return this.schemaVersion();
  }

  #readReceipt(requestId, requestHash) {
    const receipt = this.db.prepare('SELECT * FROM request_receipts WHERE request_id = ?').get(requestId);
    if (!receipt) return null;
    if (receipt.request_hash !== requestHash) {
      return outcomeProblem(new SpikeProblem('request_id_reused', 'Request ID was reused with different input.'));
    }
    const recorded = parseJson(receipt.outcome_json);
    if (recorded.ok) recorded.value.idempotentReplay = true;
    return recorded;
  }

  #recordRejected(request, requestHash, problem) {
    const outcome = outcomeProblem(problem);
    this.db.prepare(`
      INSERT OR IGNORE INTO request_receipts(
        request_id, request_hash, scope, campaign_id, binding_id,
        terminal_kind, outcome_json, created_at
      ) VALUES (?, ?, ?, ?, ?, 'rejected', ?, ?)
    `).run(
      request.requestId,
      requestHash,
      request.scope,
      request.campaignId ?? request.target?.campaignId ?? null,
      request.bindingId ?? request.target?.bindingId ?? null,
      canonicalJson(outcome),
      nowIso(),
    );
    return outcome;
  }

  #accepted(request, body) {
    const requestHash = sha256(request);
    const replay = this.#readReceipt(request.requestId, requestHash);
    if (replay) return replay;

    this.db.exec('BEGIN IMMEDIATE');
    try {
      const raceReplay = this.#readReceipt(request.requestId, requestHash);
      if (raceReplay) {
        this.db.exec('ROLLBACK');
        return raceReplay;
      }

      const commitId = randomUUID();
      const acceptedAt = nowIso();
      const commit = this.db.prepare(`
        INSERT INTO accepted_commits(commit_id, request_id, accepted_by_json, committed_at)
        VALUES (?, ?, ?, ?)
      `).run(commitId, request.requestId, canonicalJson(request.acceptedBy ?? { kind: 'prototype-human' }), acceptedAt);
      const sequence = Number(commit.lastInsertRowid);
      const value = body({ commitId, sequence, acceptedAt });
      value.requestId = request.requestId;
      value.commitId = commitId;
      value.cursor = cursor(this.db, sequence);
      value.idempotentReplay = false;
      const outcome = { ok: true, value };

      this.db.prepare(`
        INSERT INTO request_receipts(
          request_id, request_hash, scope, campaign_id, binding_id,
          terminal_kind, outcome_json, created_at
        ) VALUES (?, ?, ?, ?, ?, 'accepted', ?, ?)
      `).run(
        request.requestId,
        requestHash,
        request.scope,
        value.campaign?.campaignId ?? request.campaignId ?? request.target?.campaignId ?? null,
        value.binding?.bindingId ?? request.bindingId ?? request.target?.bindingId ?? null,
        canonicalJson(outcome),
        acceptedAt,
      );
      this.db.exec('COMMIT');
      return outcome;
    } catch (error) {
      this.db.exec('ROLLBACK');
      if (error instanceof SpikeProblem && error.terminal) {
        return this.#recordRejected(request, requestHash, error);
      }
      throw error;
    }
  }

  #insertChangeScope(sequence, ordinal, scope) {
    this.db.prepare(`
      INSERT INTO change_scopes(
        sequence, ordinal, scope, campaign_id, binding_id,
        campaign_revision, binding_revision, data_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sequence,
      ordinal,
      scope.scope,
      scope.campaignId ?? null,
      scope.bindingId ?? null,
      scope.campaignRevision ?? null,
      scope.bindingRevision ?? null,
      canonicalJson(scope.data ?? {}),
    );
  }

  #insertCampaignEvent({
    campaignId,
    revision,
    sequence,
    request,
    operation,
    changes,
    acceptedAt,
    baseHash = null,
    previousEventHash = null,
  }) {
    const eventId = randomUUID();
    const acceptedBy = request.acceptedBy ?? { kind: 'prototype-human' };
    const normalizedChanges = [...changes].sort((a, b) =>
      `${a.subjectKind}:${a.subjectId}`.localeCompare(`${b.subjectKind}:${b.subjectId}`));
    const event = {
      campaignId,
      revision,
      eventId,
      requestId: request.requestId,
      eventSchemaVersion: 1,
      operationKind: operation.kind,
      operation,
      acceptedAt,
      acceptedBy,
      affected: normalizedChanges.map(change => ({ kind: change.subjectKind, id: change.subjectId })),
      baseHash,
      previousEventHash,
    };
    const eventHash = sha256(eventHashInput(event, normalizedChanges));

    this.db.prepare(`
      INSERT INTO campaign_events(
        campaign_id, revision, event_id, sequence, request_id,
        event_schema_version, operation_kind, operation_json,
        accepted_at, accepted_by_json, affected_json, base_hash,
        previous_event_hash, event_hash
      ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      campaignId,
      revision,
      eventId,
      sequence,
      request.requestId,
      operation.kind,
      canonicalJson(operation),
      acceptedAt,
      canonicalJson(acceptedBy),
      canonicalJson(event.affected),
      baseHash,
      previousEventHash,
      eventHash,
    );

    const insertChange = this.db.prepare(`
      INSERT INTO campaign_event_changes(
        event_id, ordinal, subject_kind, subject_id,
        before_json, before_hash, after_json, after_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    normalizedChanges.forEach((change, ordinal) => {
      insertChange.run(
        eventId,
        ordinal,
        change.subjectKind,
        change.subjectId,
        change.before == null ? null : canonicalJson(change.before),
        change.before == null ? null : sha256(change.before),
        change.after == null ? null : canonicalJson(change.after),
        change.after == null ? null : sha256(change.after),
      );
    });
    return { eventId, eventHash, affected: event.affected };
  }

  #bindingState(row) {
    return parseJson(row.state_json);
  }

  #insertBindingEvent({ bindingId, sequence, request, eventKind, changedFacets, before, after, acceptedAt }) {
    const previous = this.db.prepare('SELECT * FROM chat_bindings WHERE binding_id = ?').get(bindingId);
    const bindingRevision = before == null ? 1 : Number(previous.binding_revision) + 1;
    const eventId = randomUUID();
    const acceptedBy = request.acceptedBy ?? { kind: 'prototype-human' };
    const event = {
      bindingId,
      bindingRevision,
      eventId,
      requestId: request.requestId,
      eventSchemaVersion: 1,
      eventKind,
      changedFacets,
      before,
      after,
      acceptedAt,
      acceptedBy,
      previousEventHash: previous?.head_event_hash ?? null,
    };
    const eventHash = sha256(bindingHashInput(event));

    this.db.prepare(`
      INSERT INTO binding_events(
        binding_id, binding_revision, event_id, sequence, request_id,
        event_schema_version, event_kind, changed_facets_json,
        before_json, after_json, accepted_at, accepted_by_json,
        previous_event_hash, event_hash
      ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      bindingId,
      bindingRevision,
      eventId,
      sequence,
      request.requestId,
      eventKind,
      canonicalJson(changedFacets),
      before == null ? null : canonicalJson(before),
      canonicalJson(after),
      acceptedAt,
      canonicalJson(acceptedBy),
      event.previousEventHash,
      eventHash,
    );
    return { bindingRevision, eventId, eventHash };
  }

  #insertNewBinding({ bindingId, campaignId, campaignRevision, locator, label, sequence, request, acceptedAt }) {
    const normalizedLocator = clone(locator);
    const state = {
      id: bindingId,
      campaignId,
      status: 'active',
      label: label || 'SillyTavern chat',
      locator: normalizedLocator,
      campaignAnchor: campaignRevision,
      syncBoundary: null,
      pins: [],
      facets: { identity: 1, anchor: 1, sync: 0, pins: 0 },
    };
    const locatorHash = sha256(normalizedLocator);
    const event = {
      bindingId,
      bindingRevision: 1,
      eventId: randomUUID(),
      requestId: request.requestId,
      eventSchemaVersion: 1,
      eventKind: 'binding-created',
      changedFacets: ['identity', 'anchor'],
      before: null,
      after: state,
      acceptedAt,
      acceptedBy: request.acceptedBy ?? { kind: 'prototype-human' },
      previousEventHash: null,
    };
    const eventHash = sha256(bindingHashInput(event));
    this.db.prepare(`
      INSERT INTO chat_bindings(
        binding_id, campaign_id, status, binding_revision,
        identity_revision, anchor_revision, sync_revision, pins_revision,
        campaign_anchor, locator_hash, locator_json, state_json,
        head_event_hash, created_at, updated_at
      ) VALUES (?, ?, 'active', 1, 1, 1, 0, 0, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      bindingId,
      campaignId,
      campaignRevision,
      locatorHash,
      canonicalJson(normalizedLocator),
      canonicalJson(state),
      eventHash,
      acceptedAt,
      acceptedAt,
    );
    this.db.prepare(`
      INSERT INTO binding_events(
        binding_id, binding_revision, event_id, sequence, request_id,
        event_schema_version, event_kind, changed_facets_json,
        before_json, after_json, accepted_at, accepted_by_json,
        previous_event_hash, event_hash
      ) VALUES (?, 1, ?, ?, ?, 1, 'binding-created', ?, NULL, ?, ?, ?, NULL, ?)
    `).run(
      bindingId,
      event.eventId,
      sequence,
      request.requestId,
      canonicalJson(event.changedFacets),
      canonicalJson(state),
      acceptedAt,
      canonicalJson(event.acceptedBy),
      eventHash,
    );
    return { bindingId, revision: 1, eventId: event.eventId, facets: state.facets };
  }

  #insertBaseAndProjection(campaignId, state, baseKind, lineage) {
    const stateJson = canonicalJson(state);
    this.db.prepare(`
      INSERT INTO campaign_bases(
        campaign_id, base_kind, schema_version, state_json, state_hash,
        source_campaign_id, source_revision, source_event_hash, source_title
      ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)
    `).run(
      campaignId,
      baseKind,
      stateJson,
      sha256(stateJson),
      lineage?.campaignId ?? null,
      lineage?.revision ?? null,
      lineage?.eventHash ?? null,
      lineage?.title ?? null,
    );
    this.#replaceProjection(campaignId, state, 1);
    return sha256(stateJson);
  }

  #replaceProjection(campaignId, state, revision) {
    this.db.prepare('DELETE FROM reference_current WHERE campaign_id = ?').run(campaignId);
    this.db.prepare('DELETE FROM subject_current WHERE campaign_id = ?').run(campaignId);
    const insertSubject = this.db.prepare(`
      INSERT INTO subject_current(
        campaign_id, subject_id, subject_kind, name, archived, state_json, changed_revision
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const subject of Object.values(state.subjects)) {
      insertSubject.run(
        campaignId,
        subject.id,
        subject.kind,
        subject.name,
        subject.archived ? 1 : 0,
        canonicalJson(subject),
        revision,
      );
    }
    const insertReference = this.db.prepare(`
      INSERT INTO reference_current(
        campaign_id, reference_id, source_subject_id, target_subject_id, state_json, changed_revision
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const reference of Object.values(state.references)) {
      insertReference.run(
        campaignId,
        reference.id,
        reference.sourceId,
        reference.targetId,
        canonicalJson(reference),
        revision,
      );
    }
  }

  createCampaign(request) {
    request = { ...request, scope: 'catalog' };
    return this.#accepted(request, ({ sequence, acceptedAt }) => {
      if (this.db.prepare('SELECT 1 FROM campaigns WHERE campaign_id = ?').get(request.campaignId)) {
        throw new SpikeProblem('campaign_exists', 'Campaign ID already exists.');
      }
      const campaignId = assertText(request.campaignId, 'Campaign ID');
      const title = assertText(request.title, 'Campaign title');
      const initialSubjects = Object.fromEntries(
        (request.subjects ?? []).map(input => {
          const subject = normalizeSubject(input);
          return [subject.id, subject];
        }),
      );
      const initialReferences = Object.fromEntries(
        (request.references ?? []).map(input => {
          const reference = normalizeReference(input);
          if (!initialSubjects[reference.sourceId] || !initialSubjects[reference.targetId]) {
            throw new SpikeProblem('validation_failed', 'Initial reference target/source is missing.', reference);
          }
          return [reference.id, reference];
        }),
      );
      const state = {
        campaign: { id: campaignId, title, status: 'active', lineage: null },
        subjects: initialSubjects,
        references: initialReferences,
      };
      const baseHash = sha256(canonicalJson(state));
      const provisionalEvent = {
        campaignId,
        revision: 1,
        eventId: randomUUID(),
        requestId: request.requestId,
        eventSchemaVersion: 1,
        operationKind: 'campaign-created',
        operation: { kind: 'campaign-created', title },
        acceptedAt,
        acceptedBy: request.acceptedBy ?? { kind: 'prototype-human' },
        affected: [],
        baseHash,
        previousEventHash: null,
      };
      const eventHash = sha256(eventHashInput(provisionalEvent, []));
      this.db.prepare(`
        INSERT INTO campaigns(
          campaign_id, title, status, current_revision, head_event_hash, created_at
        ) VALUES (?, ?, 'active', 1, ?, ?)
      `).run(campaignId, title, eventHash, acceptedAt);
      this.#insertBaseAndProjection(campaignId, state, 'blank', null);
      this.db.prepare(`
        INSERT INTO campaign_events(
          campaign_id, revision, event_id, sequence, request_id,
          event_schema_version, operation_kind, operation_json,
          accepted_at, accepted_by_json, affected_json, base_hash,
          previous_event_hash, event_hash
        ) VALUES (?, 1, ?, ?, ?, 1, 'campaign-created', ?, ?, ?, '[]', ?, NULL, ?)
      `).run(
        campaignId,
        provisionalEvent.eventId,
        sequence,
        request.requestId,
        canonicalJson(provisionalEvent.operation),
        acceptedAt,
        canonicalJson(provisionalEvent.acceptedBy),
        baseHash,
        eventHash,
      );
      this.#insertChangeScope(sequence, 0, {
        scope: 'campaign', campaignId, campaignRevision: 1, data: { views: ['catalog', 'campaign'] },
      });

      let binding = null;
      if (request.binding) {
        binding = this.#insertNewBinding({
          bindingId: request.binding.bindingId,
          campaignId,
          campaignRevision: 1,
          locator: request.binding.locator,
          label: request.binding.label,
          sequence,
          request,
          acceptedAt,
        });
        this.#insertChangeScope(sequence, 1, {
          scope: 'binding', campaignId, bindingId: binding.bindingId,
          bindingRevision: 1, data: { facets: ['identity', 'anchor'] },
        });
      }
      return {
        campaign: { campaignId, revision: 1, eventId: provisionalEvent.eventId },
        binding,
      };
    });
  }

  #currentCampaign(campaignId) {
    const campaign = this.db.prepare('SELECT * FROM campaigns WHERE campaign_id = ?').get(campaignId);
    if (!campaign) {
      const purged = this.db.prepare('SELECT * FROM purge_receipts WHERE campaign_id = ?').get(campaignId);
      throw new SpikeProblem(purged ? 'campaign_purged' : 'campaign_not_found', 'Campaign is unavailable.');
    }
    return campaign;
  }

  #changeCollector() {
    const changes = new Map();
    return {
      record(subjectKind, subjectId, before, after) {
        const key = `${subjectKind}:${subjectId}`;
        const existing = changes.get(key);
        changes.set(key, {
          subjectKind,
          subjectId,
          before: existing ? existing.before : clone(before),
          after: clone(after),
        });
      },
      values() {
        return [...changes.values()].filter(change => canonicalJson(change.before) !== canonicalJson(change.after));
      },
    };
  }

  #subjectRow(campaignId, subjectId) {
    return this.db.prepare(
      'SELECT * FROM subject_current WHERE campaign_id = ? AND subject_id = ?',
    ).get(campaignId, subjectId);
  }

  #applyOperation(campaignId, operation, revision, collector) {
    if (operation.kind === 'batch') {
      for (const nested of operation.operations) this.#applyOperation(campaignId, nested, revision, collector);
      return;
    }
    if (operation.kind === 'put-subject') {
      const subject = normalizeSubject(operation.subject);
      if (this.db.prepare(
        'SELECT 1 FROM subject_tombstones WHERE campaign_id = ? AND subject_id = ?',
      ).get(campaignId, subject.id)) {
        throw new SpikeProblem('subject_id_reused', 'Deleted subject IDs cannot be reused.', { subjectId: subject.id });
      }
      const row = this.#subjectRow(campaignId, subject.id);
      const before = row ? parseJson(row.state_json) : null;
      collector.record('subject', subject.id, before, subject);
      this.db.prepare(`
        INSERT INTO subject_current(
          campaign_id, subject_id, subject_kind, name, archived, state_json, changed_revision
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(campaign_id, subject_id) DO UPDATE SET
          subject_kind = excluded.subject_kind,
          name = excluded.name,
          archived = excluded.archived,
          state_json = excluded.state_json,
          changed_revision = excluded.changed_revision
      `).run(
        campaignId, subject.id, subject.kind, subject.name, subject.archived ? 1 : 0,
        canonicalJson(subject), revision,
      );
      return;
    }
    if (operation.kind === 'archive-subject' || operation.kind === 'restore-subject') {
      const row = this.#subjectRow(campaignId, operation.subjectId);
      if (!row) throw new SpikeProblem('subject_not_found', 'Subject does not exist.');
      const before = parseJson(row.state_json);
      const after = { ...before, archived: operation.kind === 'archive-subject' };
      collector.record('subject', operation.subjectId, before, after);
      this.db.prepare(`
        UPDATE subject_current
        SET archived = ?, state_json = ?, changed_revision = ?
        WHERE campaign_id = ? AND subject_id = ?
      `).run(after.archived ? 1 : 0, canonicalJson(after), revision, campaignId, operation.subjectId);
      return;
    }
    if (operation.kind === 'delete-subject') {
      const row = this.#subjectRow(campaignId, operation.subjectId);
      if (!row) throw new SpikeProblem('subject_not_found', 'Subject does not exist.');
      const before = parseJson(row.state_json);
      if (!before.archived) throw new SpikeProblem('record_not_archived', 'Archive subject before Delete.');
      const blockers = this.db.prepare(`
        SELECT reference_id, source_subject_id, target_subject_id
        FROM reference_current
        WHERE campaign_id = ? AND (target_subject_id = ? OR source_subject_id = ?)
        ORDER BY reference_id
      `).all(campaignId, operation.subjectId, operation.subjectId);
      const pinned = this.db.prepare(`
        SELECT p.binding_id
        FROM binding_pins p
        JOIN chat_bindings b ON b.binding_id = p.binding_id
        WHERE b.campaign_id = ? AND b.status = 'active' AND p.subject_id = ?
      `).all(campaignId, operation.subjectId);
      if (blockers.length || pinned.length) {
        throw new SpikeProblem('reference_blocked', 'Delete is blocked by current references.', { blockers, pinned });
      }
      collector.record('subject', operation.subjectId, before, null);
      this.db.prepare('DELETE FROM subject_current WHERE campaign_id = ? AND subject_id = ?')
        .run(campaignId, operation.subjectId);
      this.db.prepare(`
        INSERT INTO subject_tombstones(campaign_id, subject_id, deleted_revision)
        VALUES (?, ?, ?)
      `).run(campaignId, operation.subjectId, revision);
      return;
    }
    if (operation.kind === 'put-reference') {
      const reference = normalizeReference(operation.reference);
      for (const id of [reference.sourceId, reference.targetId]) {
        if (!this.#subjectRow(campaignId, id)) {
          throw new SpikeProblem('validation_failed', 'Reference source/target does not exist.', { subjectId: id });
        }
      }
      const row = this.db.prepare(
        'SELECT * FROM reference_current WHERE campaign_id = ? AND reference_id = ?',
      ).get(campaignId, reference.id);
      const before = row ? parseJson(row.state_json) : null;
      collector.record('reference', reference.id, before, reference);
      this.db.prepare(`
        INSERT INTO reference_current(
          campaign_id, reference_id, source_subject_id, target_subject_id, state_json, changed_revision
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(campaign_id, reference_id) DO UPDATE SET
          source_subject_id = excluded.source_subject_id,
          target_subject_id = excluded.target_subject_id,
          state_json = excluded.state_json,
          changed_revision = excluded.changed_revision
      `).run(
        campaignId, reference.id, reference.sourceId, reference.targetId,
        canonicalJson(reference), revision,
      );
      return;
    }
    if (operation.kind === 'delete-reference') {
      const row = this.db.prepare(
        'SELECT * FROM reference_current WHERE campaign_id = ? AND reference_id = ?',
      ).get(campaignId, operation.referenceId);
      if (!row) throw new SpikeProblem('reference_not_found', 'Reference does not exist.');
      collector.record('reference', operation.referenceId, parseJson(row.state_json), null);
      this.db.prepare('DELETE FROM reference_current WHERE campaign_id = ? AND reference_id = ?')
        .run(campaignId, operation.referenceId);
      return;
    }
    if (operation.kind === 'archive-campaign' || operation.kind === 'restore-campaign') {
      const row = this.#currentCampaign(campaignId);
      const base = this.db.prepare('SELECT * FROM campaign_bases WHERE campaign_id = ?').get(campaignId);
      const lineage = parseJson(base.state_json).campaign.lineage ?? null;
      const before = { id: campaignId, title: row.title, status: row.status, lineage };
      const status = operation.kind === 'archive-campaign' ? 'archived' : 'active';
      const after = { ...before, status };
      collector.record('campaign', campaignId, before, after);
      this.db.prepare(`
        UPDATE campaigns SET status = ?, archived_at = ?, title = ? WHERE campaign_id = ?
      `).run(status, status === 'archived' ? nowIso() : null, after.title, campaignId);
      return;
    }
    throw new SpikeProblem('validation_failed', `Unknown Campaign Operation: ${operation.kind}`);
  }

  #updateBindingRow(state, event, acceptedAt) {
    this.db.prepare(`
      UPDATE chat_bindings SET
        campaign_id = ?, status = ?, binding_revision = ?,
        identity_revision = ?, anchor_revision = ?, sync_revision = ?, pins_revision = ?,
        campaign_anchor = ?, locator_hash = ?, locator_json = ?, state_json = ?,
        head_event_hash = ?, updated_at = ?
      WHERE binding_id = ?
    `).run(
      state.campaignId,
      state.status,
      event.bindingRevision,
      state.facets.identity,
      state.facets.anchor,
      state.facets.sync,
      state.facets.pins,
      state.campaignAnchor ?? null,
      state.locator ? sha256(state.locator) : null,
      state.locator ? canonicalJson(state.locator) : null,
      canonicalJson(state),
      event.eventHash,
      acceptedAt,
      state.id,
    );
    this.db.prepare('DELETE FROM binding_pins WHERE binding_id = ?').run(state.id);
    const insertPin = this.db.prepare(
      'INSERT INTO binding_pins(binding_id, subject_id, position) VALUES (?, ?, ?)',
    );
    state.pins.forEach((subjectId, position) => insertPin.run(state.id, subjectId, position));
  }

  #advanceAnchor({ bindingId, campaignId, revision, expectedFacets, sequence, request, acceptedAt }) {
    const row = this.db.prepare('SELECT * FROM chat_bindings WHERE binding_id = ?').get(bindingId);
    if (!row) throw new SpikeProblem('binding_not_found', 'Chat Binding does not exist.');
    const before = this.#bindingState(row);
    if (before.status !== 'active' || before.campaignId !== campaignId) {
      throw new SpikeProblem('binding_mismatch', 'Chat Binding no longer targets this Campaign.');
    }
    for (const facet of ['identity', 'anchor']) {
      if (expectedFacets?.[facet] !== before.facets[facet]) {
        throw new SpikeProblem('binding_revision_conflict', `Binding ${facet} facet is stale.`, {
          facet, expected: expectedFacets?.[facet], actual: before.facets[facet],
        });
      }
    }
    const after = clone(before);
    after.campaignAnchor = revision;
    after.facets.anchor += 1;
    const event = this.#insertBindingEvent({
      bindingId, sequence, request, eventKind: 'campaign-anchor-advanced',
      changedFacets: ['anchor'], before, after, acceptedAt,
    });
    this.#updateBindingRow(after, event, acceptedAt);
    return { bindingId, revision: event.bindingRevision, eventId: event.eventId, facets: after.facets };
  }

  executeCampaign(request) {
    request = { ...request, scope: 'campaign' };
    return this.#accepted(request, ({ sequence, acceptedAt }) => {
      const campaign = this.#currentCampaign(request.campaignId);
      if (Number(campaign.current_revision) !== Number(request.expectedRevision)) {
        throw new SpikeProblem('campaign_revision_conflict', 'Campaign Revision is stale.', {
          expected: request.expectedRevision, actual: Number(campaign.current_revision),
        });
      }
      if (campaign.status === 'archived' && request.operation.kind !== 'restore-campaign') {
        throw new SpikeProblem('campaign_archived', 'Campaign is archived.');
      }

      const revision = Number(campaign.current_revision) + 1;
      const collector = this.#changeCollector();
      this.#applyOperation(request.campaignId, request.operation, revision, collector);
      const changes = collector.values();
      if (changes.length === 0) throw new SpikeProblem('validation_failed', 'Operation made no change.');
      if (request.injectFailureAt === 'after-projection') throw new Error('PROTOTYPE injected failure after projection');
      const event = this.#insertCampaignEvent({
        campaignId: request.campaignId,
        revision,
        sequence,
        request,
        operation: request.operation,
        changes,
        acceptedAt,
        previousEventHash: campaign.head_event_hash,
      });
      if (request.injectFailureAt === 'after-event') throw new Error('PROTOTYPE injected failure after Event');
      this.db.prepare(`
        UPDATE campaigns SET current_revision = ?, head_event_hash = ? WHERE campaign_id = ?
      `).run(revision, event.eventHash, request.campaignId);
      this.#insertChangeScope(sequence, 0, {
        scope: 'campaign', campaignId: request.campaignId, campaignRevision: revision,
        data: { affected: event.affected },
      });
      let binding = null;
      if (request.anchor) {
        binding = this.#advanceAnchor({
          bindingId: request.anchor.bindingId,
          campaignId: request.campaignId,
          revision,
          expectedFacets: request.anchor.expectedFacets,
          sequence,
          request,
          acceptedAt,
        });
        this.#insertChangeScope(sequence, 1, {
          scope: 'binding', campaignId: request.campaignId, bindingId: binding.bindingId,
          bindingRevision: binding.revision, data: { facets: ['anchor'] },
        });
      }
      return {
        campaign: {
          campaignId: request.campaignId,
          revision,
          eventId: event.eventId,
          eventHash: event.eventHash,
          affected: event.affected,
        },
        binding,
      };
    });
  }

  executeBinding(request) {
    request = { ...request, scope: 'binding' };
    return this.#accepted(request, ({ sequence, acceptedAt }) => {
      const row = this.db.prepare('SELECT * FROM chat_bindings WHERE binding_id = ?').get(request.bindingId);
      if (!row) throw new SpikeProblem('binding_not_found', 'Chat Binding does not exist.');
      const before = this.#bindingState(row);
      const changedFacets = changedFacetNames(request.operation);
      for (const facet of changedFacets) {
        if (request.expectedFacets?.[facet] !== before.facets[facet]) {
          throw new SpikeProblem('binding_revision_conflict', `Binding ${facet} facet is stale.`, {
            facet, expected: request.expectedFacets?.[facet], actual: before.facets[facet],
          });
        }
      }
      const after = clone(before);
      if (request.operation.kind === 'replace-pins') {
        for (const subjectId of request.operation.pins) {
          if (!this.#subjectRow(before.campaignId, subjectId)) {
            throw new SpikeProblem('subject_not_found', 'Pinned subject does not exist.', { subjectId });
          }
        }
        after.pins = [...new Set(request.operation.pins)];
      }
      if (request.operation.kind === 'set-sync-boundary') after.syncBoundary = clone(request.operation.boundary);
      if (request.operation.kind === 'follow-campaign-head') {
        const campaign = this.#currentCampaign(before.campaignId);
        if (Number(campaign.current_revision) !== Number(request.operation.revision)) {
          throw new SpikeProblem('campaign_revision_conflict', 'Chosen Campaign head changed.');
        }
        after.campaignAnchor = Number(request.operation.revision);
      }
      if (request.operation.kind === 'move-locator') after.locator = clone(request.operation.locator);
      if (request.operation.kind === 'unlink') after.status = 'unlinked';
      if (request.operation.kind === 'restore-binding') after.status = 'active';
      for (const facet of changedFacets) after.facets[facet] += 1;
      const event = this.#insertBindingEvent({
        bindingId: request.bindingId,
        sequence,
        request,
        eventKind: request.operation.kind,
        changedFacets,
        before,
        after,
        acceptedAt,
      });
      this.#updateBindingRow(after, event, acceptedAt);
      this.#insertChangeScope(sequence, 0, {
        scope: 'binding', campaignId: after.campaignId, bindingId: after.id,
        bindingRevision: event.bindingRevision, data: { facets: changedFacets },
      });
      return {
        binding: {
          bindingId: after.id,
          revision: event.bindingRevision,
          eventId: event.eventId,
          facets: after.facets,
        },
      };
    });
  }

  inspectBinding(bindingId, presentedLocator) {
    const row = this.db.prepare('SELECT * FROM chat_bindings WHERE binding_id = ?').get(bindingId);
    if (!row) return { state: 'not-found' };
    const binding = this.#bindingState(row);
    if (binding.status !== 'active') return { state: binding.status, binding };
    if (sha256(presentedLocator) !== sha256(binding.locator)) {
      return {
        state: 'collision',
        binding,
        registeredLocator: binding.locator,
        presentedLocator: clone(presentedLocator),
      };
    }
    const campaign = this.#currentCampaign(binding.campaignId);
    if (Number(campaign.current_revision) !== Number(binding.campaignAnchor)) {
      return {
        state: 'mismatch',
        binding,
        campaignHead: Number(campaign.current_revision),
        campaignAnchor: Number(binding.campaignAnchor),
      };
    }
    return { state: 'verified', binding, campaignHead: Number(campaign.current_revision) };
  }

  currentState(campaignId) {
    const campaign = this.#currentCampaign(campaignId);
    const base = this.db.prepare('SELECT * FROM campaign_bases WHERE campaign_id = ?').get(campaignId);
    const subjects = this.db.prepare(
      'SELECT * FROM subject_current WHERE campaign_id = ? ORDER BY subject_id',
    ).all(campaignId);
    const references = this.db.prepare(
      'SELECT * FROM reference_current WHERE campaign_id = ? ORDER BY reference_id',
    ).all(campaignId);
    return toState(campaign, base, subjects, references);
  }

  listSubjects(campaignId, { limit = 50, offset = 0, includeArchived = false } = {}) {
    this.#currentCampaign(campaignId);
    return this.db.prepare(`
      SELECT subject_id, subject_kind, name, archived, changed_revision
      FROM subject_current
      WHERE campaign_id = ? AND (? = 1 OR archived = 0)
      ORDER BY name, subject_id
      LIMIT ? OFFSET ?
    `).all(campaignId, includeArchived ? 1 : 0, limit, offset);
  }

  #eventAt(campaignId, revision) {
    return this.db.prepare(
      'SELECT * FROM campaign_events WHERE campaign_id = ? AND revision = ?',
    ).get(campaignId, revision);
  }

  #loadEventChanges(eventId) {
    return this.db.prepare(`
      SELECT * FROM campaign_event_changes WHERE event_id = ? ORDER BY ordinal
    `).all(eventId).map(row => ({
      subjectKind: row.subject_kind,
      subjectId: row.subject_id,
      before: parseJson(row.before_json),
      after: parseJson(row.after_json),
      beforeHash: row.before_hash,
      afterHash: row.after_hash,
    }));
  }

  #verifyEvent(row, expectedPreviousHash, expectedBaseHash = null) {
    const changes = this.#loadEventChanges(row.event_id);
    for (const change of changes) {
      if ((change.before == null ? null : sha256(change.before)) !== change.beforeHash) {
        throw new SpikeProblem('history_corrupt', 'Campaign Event before-image hash mismatch.', {
          eventId: row.event_id,
        });
      }
      if ((change.after == null ? null : sha256(change.after)) !== change.afterHash) {
        throw new SpikeProblem('history_corrupt', 'Campaign Event after-image hash mismatch.', {
          eventId: row.event_id,
        });
      }
    }
    const event = {
      campaignId: row.campaign_id,
      revision: Number(row.revision),
      eventId: row.event_id,
      requestId: row.request_id,
      eventSchemaVersion: Number(row.event_schema_version),
      operationKind: row.operation_kind,
      operation: parseJson(row.operation_json),
      acceptedAt: row.accepted_at,
      acceptedBy: parseJson(row.accepted_by_json),
      affected: parseJson(row.affected_json, []),
      baseHash: row.base_hash,
      previousEventHash: row.previous_event_hash,
    };
    if (row.previous_event_hash !== expectedPreviousHash) {
      throw new SpikeProblem('history_corrupt', 'Campaign Event hash chain is discontinuous.', {
        revision: Number(row.revision),
      });
    }
    if (expectedBaseHash != null && row.base_hash !== expectedBaseHash) {
      throw new SpikeProblem('history_corrupt', 'Campaign genesis does not bind the Campaign Base.');
    }
    const computed = sha256(eventHashInput(event, changes));
    if (computed !== row.event_hash) {
      throw new SpikeProblem('history_corrupt', 'Campaign Event envelope hash mismatch.', {
        revision: Number(row.revision),
      });
    }
    return { changes, eventHash: row.event_hash };
  }

  reconstruct(campaignId, revision) {
    const campaign = this.#currentCampaign(campaignId);
    const target = Number(revision);
    if (!Number.isInteger(target) || target < 1 || target > Number(campaign.current_revision)) {
      throw new SpikeProblem('revision_not_found', 'Campaign Revision does not exist.', { revision });
    }
    const base = this.db.prepare('SELECT * FROM campaign_bases WHERE campaign_id = ?').get(campaignId);
    let state = parseJson(base.state_json);
    if (sha256(base.state_json) !== base.state_hash) {
      throw new SpikeProblem('history_corrupt', 'Campaign Base hash mismatch.');
    }
    let startRevision = 0;
    let previousHash = null;
    const diagnostics = [];
    const snapshots = this.db.prepare(`
      SELECT * FROM campaign_snapshots
      WHERE campaign_id = ? AND revision <= ?
      ORDER BY revision DESC
    `).all(campaignId, target);
    for (const snapshot of snapshots) {
      const expectedEvent = this.#eventAt(campaignId, snapshot.revision);
      if (
        expectedEvent
        && expectedEvent.event_hash === snapshot.event_hash
        && sha256(snapshot.state_json) === snapshot.state_hash
      ) {
        // A snapshot accelerates state materialization, but it is not a new trust
        // root. Verify the immutable Event prefix before accepting its state or an
        // older corrupt Event could be hidden behind a valid snapshot.
        let verifiedPreviousHash = null;
        for (let prefixRevision = 1; prefixRevision <= Number(snapshot.revision); prefixRevision += 1) {
          const prefixEvent = this.#eventAt(campaignId, prefixRevision);
          if (!prefixEvent) {
            throw new SpikeProblem('history_corrupt', 'Campaign Event is missing.', {
              revision: prefixRevision,
            });
          }
          verifiedPreviousHash = this.#verifyEvent(
            prefixEvent,
            verifiedPreviousHash,
            prefixRevision === 1 ? base.state_hash : null,
          ).eventHash;
        }
        if (verifiedPreviousHash !== snapshot.event_hash) {
          throw new SpikeProblem('history_corrupt', 'Snapshot does not terminate at the verified Event prefix.');
        }
        state = parseJson(snapshot.state_json);
        startRevision = Number(snapshot.revision);
        previousHash = snapshot.event_hash;
        break;
      }
      diagnostics.push({ kind: 'snapshot-rejected', revision: Number(snapshot.revision) });
    }

    let replayed = 0;
    for (let next = startRevision + 1; next <= target; next += 1) {
      const row = this.#eventAt(campaignId, next);
      if (!row) throw new SpikeProblem('history_corrupt', 'Campaign Event is missing.', { revision: next });
      const verified = this.#verifyEvent(row, previousHash, next === 1 ? base.state_hash : null);
      for (const change of verified.changes) applyAfterImage(state, change);
      previousHash = verified.eventHash;
      replayed += 1;
    }
    return { campaignId, revision: target, state, eventHash: previousHash, replayed, diagnostics };
  }

  createSnapshot(campaignId, revision) {
    const reconstructed = this.reconstruct(campaignId, revision);
    const stateJson = canonicalJson(reconstructed.state);
    this.db.prepare(`
      INSERT INTO campaign_snapshots(
        campaign_id, revision, schema_version, state_json, state_hash, event_hash, created_at
      ) VALUES (?, ?, 1, ?, ?, ?, ?)
      ON CONFLICT(campaign_id, revision) DO UPDATE SET
        state_json = excluded.state_json,
        state_hash = excluded.state_hash,
        event_hash = excluded.event_hash,
        created_at = excluded.created_at
    `).run(
      campaignId,
      revision,
      stateJson,
      sha256(stateJson),
      reconstructed.eventHash,
      nowIso(),
    );
    return { campaignId, revision, bytes: Buffer.byteLength(stateJson), eventHash: reconstructed.eventHash };
  }

  projectionMatches(campaignId) {
    const campaign = this.#currentCampaign(campaignId);
    const current = this.currentState(campaignId);
    const reconstructed = this.reconstruct(campaignId, Number(campaign.current_revision)).state;
    return canonicalJson(current) === canonicalJson(reconstructed);
  }

  rebuildProjection(campaignId) {
    const campaign = this.#currentCampaign(campaignId);
    const reconstructed = this.reconstruct(campaignId, Number(campaign.current_revision));
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.#replaceProjection(campaignId, reconstructed.state, Number(campaign.current_revision));
      this.db.prepare(`
        UPDATE campaigns SET title = ?, status = ?, head_event_hash = ? WHERE campaign_id = ?
      `).run(
        reconstructed.state.campaign.title,
        reconstructed.state.campaign.status,
        reconstructed.eventHash,
        campaignId,
      );
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.projectionMatches(campaignId);
  }

  branchCampaign(request) {
    const source = this.reconstruct(request.sourceCampaignId, request.sourceRevision);
    const sourceCampaign = this.#currentCampaign(request.sourceCampaignId);
    request = { ...request, scope: 'catalog' };
    return this.#accepted(request, ({ sequence, acceptedAt }) => {
      if (this.db.prepare('SELECT 1 FROM campaigns WHERE campaign_id = ?').get(request.campaignId)) {
        throw new SpikeProblem('campaign_exists', 'Branch Campaign ID already exists.');
      }
      const stillSource = this.#eventAt(request.sourceCampaignId, request.sourceRevision);
      if (!stillSource || stillSource.event_hash !== source.eventHash) {
        throw new SpikeProblem('history_corrupt', 'Source Revision changed or disappeared.');
      }
      const childState = clone(source.state);
      childState.campaign = {
        id: request.campaignId,
        title: request.title,
        status: 'active',
        lineage: {
          campaignId: request.sourceCampaignId,
          revision: Number(request.sourceRevision),
          eventHash: source.eventHash,
          title: sourceCampaign.title,
        },
      };
      const baseHash = sha256(canonicalJson(childState));
      const event = {
        campaignId: request.campaignId,
        revision: 1,
        eventId: randomUUID(),
        requestId: request.requestId,
        eventSchemaVersion: 1,
        operationKind: 'campaign-branched',
        operation: {
          kind: 'campaign-branched',
          sourceCampaignId: request.sourceCampaignId,
          sourceRevision: Number(request.sourceRevision),
          sourceEventHash: source.eventHash,
        },
        acceptedAt,
        acceptedBy: request.acceptedBy ?? { kind: 'prototype-human' },
        affected: [],
        baseHash,
        previousEventHash: null,
      };
      const eventHash = sha256(eventHashInput(event, []));
      this.db.prepare(`
        INSERT INTO campaigns(
          campaign_id, title, status, current_revision, head_event_hash, created_at
        ) VALUES (?, ?, 'active', 1, ?, ?)
      `).run(request.campaignId, request.title, eventHash, acceptedAt);
      this.#insertBaseAndProjection(request.campaignId, childState, 'branch', childState.campaign.lineage);
      this.db.prepare(`
        INSERT INTO campaign_events(
          campaign_id, revision, event_id, sequence, request_id,
          event_schema_version, operation_kind, operation_json,
          accepted_at, accepted_by_json, affected_json, base_hash,
          previous_event_hash, event_hash
        ) VALUES (?, 1, ?, ?, ?, 1, 'campaign-branched', ?, ?, ?, '[]', ?, NULL, ?)
      `).run(
        request.campaignId,
        event.eventId,
        sequence,
        request.requestId,
        canonicalJson(event.operation),
        acceptedAt,
        canonicalJson(event.acceptedBy),
        baseHash,
        eventHash,
      );
      this.#insertChangeScope(sequence, 0, {
        scope: 'campaign', campaignId: request.campaignId, campaignRevision: 1,
        data: { lineage: childState.campaign.lineage },
      });
      let binding = null;
      if (request.binding?.kind === 'create') {
        binding = this.#insertNewBinding({
          bindingId: request.binding.bindingId,
          campaignId: request.campaignId,
          campaignRevision: 1,
          locator: request.binding.locator,
          label: request.binding.label,
          sequence,
          request,
          acceptedAt,
        });
        this.#insertChangeScope(sequence, 1, {
          scope: 'binding', campaignId: request.campaignId, bindingId: binding.bindingId,
          bindingRevision: 1, data: { facets: ['identity', 'anchor'] },
        });
      }
      return {
        campaign: {
          campaignId: request.campaignId,
          revision: 1,
          eventId: event.eventId,
          eventHash,
        },
        binding,
      };
    });
  }

  counts(campaignId) {
    const campaign = this.db.prepare('SELECT * FROM campaigns WHERE campaign_id = ?').get(campaignId);
    return {
      campaignRevision: campaign ? Number(campaign.current_revision) : null,
      campaignEvents: Number(this.db.prepare(
        'SELECT COUNT(*) count FROM campaign_events WHERE campaign_id = ?',
      ).get(campaignId).count),
      subjects: Number(this.db.prepare(
        'SELECT COUNT(*) count FROM subject_current WHERE campaign_id = ?',
      ).get(campaignId).count),
      references: Number(this.db.prepare(
        'SELECT COUNT(*) count FROM reference_current WHERE campaign_id = ?',
      ).get(campaignId).count),
      snapshots: Number(this.db.prepare(
        'SELECT COUNT(*) count FROM campaign_snapshots WHERE campaign_id = ?',
      ).get(campaignId).count),
      acceptedCommits: Number(this.db.prepare('SELECT COUNT(*) count FROM accepted_commits').get().count),
    };
  }

  binding(bindingId) {
    const row = this.db.prepare('SELECT * FROM chat_bindings WHERE binding_id = ?').get(bindingId);
    if (!row) return null;
    return {
      ...this.#bindingState(row),
      bindingRevision: Number(row.binding_revision),
      headEventHash: row.head_event_hash,
    };
  }

  readChanges({ after = null, limit = 1000 } = {}) {
    const epoch = this.storeEpoch();
    const maxSequence = Number(this.db.prepare(
      'SELECT COALESCE(MAX(sequence), 0) sequence FROM accepted_commits',
    ).get().sequence);
    if (!after) return { resetRequired: true, cursor: { storeEpoch: epoch, sequence: maxSequence }, commits: [] };
    if (after.storeEpoch !== epoch || after.sequence > maxSequence) {
      return { resetRequired: true, cursor: { storeEpoch: epoch, sequence: maxSequence }, commits: [] };
    }
    const total = Number(this.db.prepare(
      'SELECT COUNT(*) count FROM accepted_commits WHERE sequence > ?',
    ).get(after.sequence).count);
    if (total > limit) {
      return { resetRequired: true, cursor: { storeEpoch: epoch, sequence: maxSequence }, commits: [] };
    }
    const rows = this.db.prepare(`
      SELECT c.sequence, c.commit_id, c.request_id, c.committed_at,
             s.ordinal, s.scope, s.campaign_id, s.binding_id,
             s.campaign_revision, s.binding_revision, s.data_json
      FROM accepted_commits c
      JOIN change_scopes s ON s.sequence = c.sequence
      WHERE c.sequence > ?
      ORDER BY c.sequence, s.ordinal
    `).all(after.sequence);
    const grouped = new Map();
    for (const row of rows) {
      const commit = grouped.get(row.sequence) ?? {
        cursor: { storeEpoch: epoch, sequence: Number(row.sequence) },
        commitId: row.commit_id,
        requestId: row.request_id,
        changes: [],
      };
      commit.changes.push({
        scope: row.scope,
        campaignId: row.campaign_id,
        bindingId: row.binding_id,
        campaignRevision: row.campaign_revision == null ? null : Number(row.campaign_revision),
        bindingRevision: row.binding_revision == null ? null : Number(row.binding_revision),
        data: parseJson(row.data_json, {}),
      });
      grouped.set(row.sequence, commit);
    }
    return {
      resetRequired: false,
      cursor: { storeEpoch: epoch, sequence: maxSequence },
      commits: [...grouped.values()],
    };
  }

  prototypeCorruptSnapshot(campaignId, revision) {
    this.db.prepare(`
      UPDATE campaign_snapshots SET state_json = '{"corrupt":true}'
      WHERE campaign_id = ? AND revision = ?
    `).run(campaignId, revision);
  }

  prototypeCorruptProjection(campaignId, subjectId) {
    this.db.prepare(`
      UPDATE subject_current SET name = 'CORRUPT', state_json = '{"corrupt":true}'
      WHERE campaign_id = ? AND subject_id = ?
    `).run(campaignId, subjectId);
  }

  prototypeCorruptEvent(campaignId, revision) {
    this.db.prepare(`
      UPDATE campaign_events SET operation_json = '{"kind":"corrupt"}'
      WHERE campaign_id = ? AND revision = ?
    `).run(campaignId, revision);
  }

  async createValidatedBackup(directory, kind = 'manual', at = new Date()) {
    await mkdir(directory, { recursive: true });
    const stamp = at.toISOString().replaceAll(':', '-');
    const finalPath = path.join(directory, `${kind}-${stamp}-${randomUUID()}.sqlite`);
    const partialPath = `${finalPath}.partial`;
    await rm(partialPath, { force: true });
    await backup(this.db, partialPath);
    const validation = validateDatabase(partialPath);
    if (!validation.ok) {
      await rm(partialPath, { force: true });
      throw new SpikeProblem('backup_invalid', 'Online backup failed validation.', validation);
    }
    await rename(partialPath, finalPath);
    return {
      id: randomUUID(),
      kind,
      path: finalPath,
      sha256: sha256(await readFile(finalPath)),
      createdAt: at.toISOString(),
      sourceSequence: Number(this.db.prepare(
        'SELECT COALESCE(MAX(sequence), 0) sequence FROM accepted_commits',
      ).get().sequence),
    };
  }

  async ensureDailyBackup(directory, at = new Date()) {
    await mkdir(directory, { recursive: true });
    const entries = await readdir(directory, { withFileTypes: true });
    const candidates = entries
      .filter(entry => entry.isFile() && entry.name.startsWith('daily-') && entry.name.endsWith('.sqlite'))
      .map(entry => path.join(directory, entry.name));
    let newest = null;
    for (const candidate of candidates) {
      const fileStat = await stat(candidate);
      if (!newest || fileStat.mtimeMs > newest.mtimeMs) newest = { path: candidate, mtimeMs: fileStat.mtimeMs };
    }
    if (newest && at.getTime() - newest.mtimeMs < DAY_MS) {
      return { created: false, path: newest.path };
    }
    const receipt = await this.createValidatedBackup(directory, 'daily', at);
    return { created: true, ...receipt };
  }

  async purgeCampaign(request, backupDirectory) {
    request = { ...request, scope: 'catalog' };
    const requestHash = sha256(request);
    const replay = this.#readReceipt(request.requestId, requestHash);
    if (replay) return replay;
    const campaign = this.#currentCampaign(request.campaignId);
    if (campaign.status !== 'archived') {
      return this.#recordRejected(
        request,
        requestHash,
        new SpikeProblem('purge_precondition_failed', 'Campaign must be archived.'),
      );
    }
    const backupReceipt = await this.createValidatedBackup(backupDirectory, 'pre-purge');
    return this.#accepted(request, ({ sequence, acceptedAt }) => {
      const current = this.#currentCampaign(request.campaignId);
      if (
        Number(current.current_revision) !== Number(request.expectedRevision)
        || current.head_event_hash !== request.expectedHeadEventHash
      ) {
        throw new SpikeProblem('purge_precondition_failed', 'Campaign changed after purge inspection.');
      }
      this.db.prepare(`
        DELETE FROM change_scopes WHERE campaign_id = ? AND sequence < ?
      `).run(request.campaignId, sequence);
      this.db.prepare('DELETE FROM request_receipts WHERE campaign_id = ? AND request_id <> ?')
        .run(request.campaignId, request.requestId);
      const bindings = this.db.prepare('SELECT binding_id FROM chat_bindings WHERE campaign_id = ?')
        .all(request.campaignId);
      for (const binding of bindings) {
        this.db.prepare('DELETE FROM binding_events WHERE binding_id = ?').run(binding.binding_id);
        this.db.prepare('DELETE FROM binding_pins WHERE binding_id = ?').run(binding.binding_id);
        const tombstone = {
          id: binding.binding_id,
          campaignId: request.campaignId,
          status: 'campaign_purged',
          locator: null,
          campaignAnchor: null,
          syncBoundary: null,
          pins: [],
          facets: { identity: 0, anchor: 0, sync: 0, pins: 0 },
        };
        this.db.prepare(`
          UPDATE chat_bindings SET
            status = 'campaign_purged', binding_revision = 0,
            identity_revision = 0, anchor_revision = 0, sync_revision = 0, pins_revision = 0,
            campaign_anchor = NULL, locator_hash = NULL, locator_json = NULL,
            state_json = ?, head_event_hash = ?, updated_at = ?
          WHERE binding_id = ?
        `).run(canonicalJson(tombstone), 'PURGED', acceptedAt, binding.binding_id);
      }
      this.db.prepare(`
        INSERT INTO purge_receipts(
          campaign_id, purged_at, final_revision, final_event_hash, backup_receipt_json, request_id
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        request.campaignId,
        acceptedAt,
        Number(current.current_revision),
        current.head_event_hash,
        canonicalJson(backupReceipt),
        request.requestId,
      );
      this.db.prepare('DELETE FROM campaigns WHERE campaign_id = ?').run(request.campaignId);
      this.#insertChangeScope(sequence, 0, {
        scope: 'purge', campaignId: request.campaignId,
        data: { finalRevision: Number(current.current_revision) },
      });
      return {
        purge: {
          campaignId: request.campaignId,
          finalRevision: Number(current.current_revision),
          finalEventHash: current.head_event_hash,
          backupReceipt,
        },
      };
    });
  }

  validate() {
    return quickCheck(this.db);
  }
}

export function validateDatabase(databasePath) {
  let db = null;
  try {
    db = new DatabaseSync(path.resolve(databasePath), { readOnly: true });
    const applicationId = Number(db.prepare('PRAGMA application_id').get().application_id);
    const check = quickCheck(db);
    const migrations = db.prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version').all();
    return {
      ok: applicationId === APPLICATION_ID && check.ok && migrations.length > 0,
      applicationId,
      check,
      migrations,
    };
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) };
  } finally {
    db?.close();
  }
}

async function unlinkIfPresent(target) {
  try {
    await unlink(target);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

export async function restoreDatabase({ databasePath, backupPath, replacedPath }) {
  const resolvedDatabase = path.resolve(databasePath);
  const resolvedBackup = path.resolve(backupPath);
  const resolvedReplaced = path.resolve(replacedPath);
  const validation = validateDatabase(resolvedBackup);
  if (!validation.ok) {
    throw new SpikeProblem('restore_candidate_invalid', 'Restore candidate failed validation.', validation);
  }
  const stagingPath = `${resolvedDatabase}.restore.partial`;
  await rm(stagingPath, { force: true });
  await copyFile(resolvedBackup, stagingPath);
  const newEpoch = randomUUID();
  const staging = new DatabaseSync(stagingPath);
  configure(staging);
  staging.prepare('UPDATE store_meta SET store_epoch = ? WHERE singleton = 1').run(newEpoch);
  const stagingCheck = quickCheck(staging);
  staging.close();
  if (!stagingCheck.ok) {
    await rm(stagingPath, { force: true });
    throw new SpikeProblem('restore_candidate_invalid', 'Staged restore failed validation.', stagingCheck);
  }

  await unlinkIfPresent(`${resolvedDatabase}-wal`);
  await unlinkIfPresent(`${resolvedDatabase}-shm`);
  await rm(resolvedReplaced, { force: true });
  await rename(resolvedDatabase, resolvedReplaced);
  try {
    await rename(stagingPath, resolvedDatabase);
    const installed = validateDatabase(resolvedDatabase);
    if (!installed.ok) throw new SpikeProblem('restore_install_invalid', 'Installed restore failed validation.', installed);
    return { databasePath: resolvedDatabase, replacedPath: resolvedReplaced, storeEpoch: newEpoch };
  } catch (error) {
    await rm(resolvedDatabase, { force: true });
    await rename(resolvedReplaced, resolvedDatabase);
    await rm(stagingPath, { force: true });
    throw error;
  }
}

export async function corruptFileCopy(source, destination) {
  await copyFile(source, destination);
  const bytes = await readFile(destination);
  bytes.fill(0, 0, Math.min(64, bytes.length));
  await writeFile(destination, bytes);
  return destination;
}
