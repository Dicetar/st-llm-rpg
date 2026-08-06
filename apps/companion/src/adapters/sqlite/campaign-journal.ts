import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import type {
  CampaignCommit,
  CampaignCommitPerformance,
  CampaignDocument,
  CampaignHistoryEntry,
  CampaignSummary,
  CreateCampaignRequest,
  ExecuteCampaignRequest,
} from '@st-llm-rpg/wire';
import { CAMPAIGN_AUTHORITY_MIGRATION, campaignMigrationChecksum } from '../../migrations/001-campaign-authority.js';
import { CampaignExpectedError } from '../../modules/campaign/campaign-error.js';
import {
  applyOperation,
  asDocument,
  canonicalJson,
  cleanIdentifier,
  cleanText,
  eventHash,
  parseJson,
  sha256,
  type CampaignRow,
  type CampaignState,
  type ReceiptRow,
} from '../../modules/campaign/campaign-state.js';
import { verifyCampaignDatabase } from './campaign-verifier.js';

const APPLICATION_ID = 0x52504733;
const EVENT_SCHEMA_VERSION = 1;
const STATE_SCHEMA_VERSION = 1;
const DEFAULT_SNAPSHOT_INTERVAL = 25;
const DEFAULT_TIMING_SAMPLE_LIMIT = 500;

export type CampaignAuthorityObservation = Readonly<{ ready: boolean; message: string; latencyMs: number }>;

export type CampaignJournalFaultPoint =
  | 'create.after-event'
  | 'create.after-snapshot'
  | 'execute.after-event'
  | 'execute.after-projection'
  | 'restore.after-safety-backup'
  | 'restore.after-target-remove'
  | 'restore.after-swap';

export type CampaignJournalOptions = Readonly<{
  snapshotInterval?: number;
  timingSampleLimit?: number;
  faultInjector?: (point: CampaignJournalFaultPoint) => void;
}>;

export class SqliteCampaignJournal {
  readonly databasePath: string;
  readonly snapshotInterval: number;
  readonly timingSampleLimit: number;
  #database: DatabaseSync;
  #databaseOpen = true;
  #writeTail: Promise<void> = Promise.resolve();
  #commitDurations: number[] = [];
  #faultInjector?: (point: CampaignJournalFaultPoint) => void;

  private constructor(databasePath: string, options: Required<Pick<CampaignJournalOptions, 'snapshotInterval' | 'timingSampleLimit'>> & Pick<CampaignJournalOptions, 'faultInjector'>, database: DatabaseSync) {
    this.databasePath = databasePath;
    this.snapshotInterval = options.snapshotInterval;
    this.timingSampleLimit = options.timingSampleLimit;
    this.#faultInjector = options.faultInjector;
    this.#database = database;
  }

  static async open(databasePath: string, options: number | CampaignJournalOptions = DEFAULT_SNAPSHOT_INTERVAL): Promise<SqliteCampaignJournal> {
    const normalized: CampaignJournalOptions = typeof options === 'number' ? { snapshotInterval: options } : options;
    const snapshotInterval = normalized.snapshotInterval ?? DEFAULT_SNAPSHOT_INTERVAL;
    const timingSampleLimit = normalized.timingSampleLimit ?? DEFAULT_TIMING_SAMPLE_LIMIT;
    if (!Number.isInteger(snapshotInterval) || snapshotInterval < 1) throw new Error('Snapshot interval must be a positive integer.');
    if (!Number.isInteger(timingSampleLimit) || timingSampleLimit < 1) throw new Error('Timing sample limit must be a positive integer.');

    const resolved = resolve(databasePath);
    await mkdir(dirname(resolved), { recursive: true });
    const database = new DatabaseSync(resolved);
    const journal = new SqliteCampaignJournal(resolved, {
      snapshotInterval,
      timingSampleLimit,
      ...(normalized.faultInjector ? { faultInjector: normalized.faultInjector } : {}),
    }, database);
    try {
      journal.configure();
      journal.assertStoreIdentity();
      journal.migrate();
      journal.verifyOrThrow();
      return journal;
    } catch (error) {
      journal.close();
      throw error;
    }
  }

  close(): void {
    if (!this.#databaseOpen) return;
    this.#database.close();
    this.#databaseOpen = false;
  }

  observation(): CampaignAuthorityObservation {
    const started = performance.now();
    try {
      const row = this.#database.prepare('SELECT COUNT(*) AS count FROM campaigns').get() as { count: number | bigint };
      const performanceSummary = this.performance();
      const timing = performanceSummary.sampleCount > 0
        ? ` Commit p95 ${performanceSummary.p95Ms.toFixed(2)} ms, max ${performanceSummary.maxMs.toFixed(2)} ms.`
        : '';
      return {
        ready: true,
        message: `SQLite Campaign authority is ready at ${this.databasePath} (${Number(row.count)} Campaigns).${timing}`,
        latencyMs: Math.max(0, performance.now() - started),
      };
    } catch (error) {
      return {
        ready: false,
        message: `SQLite Campaign authority failed: ${error instanceof Error ? error.message : String(error)}`,
        latencyMs: Math.max(0, performance.now() - started),
      };
    }
  }

  performance(): CampaignCommitPerformance {
    if (this.#commitDurations.length === 0) {
      return { sampleCount: 0, p95Ms: 0, maxMs: 0, latestMs: 0, targetMs: 50, investigationMs: 200 };
    }
    const sorted = [...this.#commitDurations].sort((left, right) => left - right);
    const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
    return {
      sampleCount: sorted.length,
      p95Ms: sorted[p95Index]!,
      maxMs: sorted.at(-1)!,
      latestMs: this.#commitDurations.at(-1)!,
      targetMs: 50,
      investigationMs: 200,
    };
  }

  listCampaigns(): CampaignSummary[] {
    const rows = this.#database.prepare(`
      SELECT campaign_id, title, status, current_revision, created_at, updated_at
      FROM campaigns ORDER BY updated_at DESC, campaign_id ASC
    `).all() as Omit<CampaignRow, 'current_state_json' | 'head_event_hash'>[];
    return rows.map(row => ({
      id: row.campaign_id,
      title: row.title,
      status: row.status,
      revision: Number(row.current_revision),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  readCampaign(campaignId: string, revision?: number): CampaignDocument {
    const id = cleanIdentifier(campaignId, 'Campaign ID');
    const state = revision === undefined
      ? parseJson<CampaignState>(this.requireCampaign(id).current_state_json)
      : this.reconstruct(id, revision);
    return asDocument(state);
  }

  history(campaignId: string): CampaignHistoryEntry[] {
    const id = cleanIdentifier(campaignId, 'Campaign ID');
    this.requireCampaign(id);
    const rows = this.#database.prepare(`
      SELECT revision, event_id, request_id, operation_kind, accepted_at
      FROM campaign_events WHERE campaign_id = ? ORDER BY revision DESC
    `).all(id) as Array<{ revision: number; event_id: string; request_id: string; operation_kind: string; accepted_at: string }>;
    return rows.map(row => ({
      revision: Number(row.revision),
      eventId: row.event_id,
      requestId: row.request_id,
      operationKind: row.operation_kind,
      committedAt: row.accepted_at,
    }));
  }

  async createCampaign(request: CreateCampaignRequest): Promise<CampaignCommit> {
    const requestId = cleanIdentifier(request.requestId, 'Request ID');
    const title = cleanText(request.title, 'Campaign title', 160);
    const requestDigest = sha256({ kind: 'create_campaign', title });
    return this.serializeWrite(() => {
      const receipt = this.readReceipt(requestId);
      if (receipt) return this.acceptReceipt(receipt, requestDigest);
      const started = performance.now();
      const campaignId = randomUUID();
      const eventId = randomUUID();
      const committedAt = new Date().toISOString();
      const summary: CampaignSummary = { id: campaignId, title, status: 'active', revision: 1, createdAt: committedAt, updatedAt: committedAt };
      const state: CampaignState = { campaign: summary, actors: {}, items: {}, currentScene: null };
      const operation = { kind: 'create_campaign', title };
      const hash = eventHash({ campaignId, revision: 1, eventId, requestId, operationKind: operation.kind, operation, beforeState: null, afterState: state, acceptedAt: committedAt, previousEventHash: null });
      const commit: CampaignCommit = {
        campaignId, revision: 1, eventId, requestId, operationKind: operation.kind,
        affectedIds: [campaignId], committedAt, idempotent: false, document: asDocument(state),
      };
      this.transaction(() => {
        this.#database.prepare(`
          INSERT INTO campaigns(campaign_id, title, status, current_revision, current_state_json, head_event_hash, created_at, updated_at)
          VALUES (?, ?, 'active', 1, ?, ?, ?, ?)
        `).run(campaignId, title, canonicalJson(state), hash, committedAt, committedAt);
        this.insertEvent({ campaignId, revision: 1, eventId, requestId, operationKind: operation.kind, operation, beforeState: null, afterState: state, acceptedAt: committedAt, previousEventHash: null, eventHash: hash });
        this.inject('create.after-event');
        this.insertSnapshot(campaignId, 1, state, hash, committedAt);
        this.inject('create.after-snapshot');
        this.insertReceipt(requestId, requestDigest, campaignId, commit, committedAt);
      });
      this.recordCommitDuration(started);
      return commit;
    });
  }

  async execute(campaignId: string, request: ExecuteCampaignRequest): Promise<CampaignCommit> {
    const id = cleanIdentifier(campaignId, 'Campaign ID');
    const requestId = cleanIdentifier(request.requestId, 'Request ID');
    const requestDigest = sha256({ campaignId: id, expectedRevision: request.expectedRevision, operation: request.operation });
    return this.serializeWrite(() => {
      const receipt = this.readReceipt(requestId);
      if (receipt) return this.acceptReceipt(receipt, requestDigest);
      const campaign = this.requireCampaign(id);
      if (Number(campaign.current_revision) !== request.expectedRevision) {
        throw new CampaignExpectedError(
          'CAMPAIGN_REVISION_CONFLICT',
          `Campaign changed from revision ${request.expectedRevision} to ${campaign.current_revision}. Reload before retrying.`,
          409,
          { campaignId: id, expectedRevision: request.expectedRevision, actualRevision: Number(campaign.current_revision) },
        );
      }
      const started = performance.now();
      const beforeState = parseJson<CampaignState>(campaign.current_state_json);
      const afterState = structuredClone(beforeState);
      const affectedIds = applyOperation(afterState, request.operation);
      const revision = Number(campaign.current_revision) + 1;
      const committedAt = new Date().toISOString();
      afterState.campaign = { ...afterState.campaign, revision, updatedAt: committedAt };
      const eventId = randomUUID();
      const hash = eventHash({ campaignId: id, revision, eventId, requestId, operationKind: request.operation.kind, operation: request.operation, beforeState, afterState, acceptedAt: committedAt, previousEventHash: campaign.head_event_hash });
      const commit: CampaignCommit = {
        campaignId: id, revision, eventId, requestId, operationKind: request.operation.kind,
        affectedIds, committedAt, idempotent: false, document: asDocument(afterState),
      };
      this.transaction(() => {
        this.insertEvent({ campaignId: id, revision, eventId, requestId, operationKind: request.operation.kind, operation: request.operation, beforeState, afterState, acceptedAt: committedAt, previousEventHash: campaign.head_event_hash, eventHash: hash });
        this.inject('execute.after-event');
        this.#database.prepare(`
          UPDATE campaigns SET title = ?, status = ?, current_revision = ?, current_state_json = ?, head_event_hash = ?, updated_at = ?
          WHERE campaign_id = ?
        `).run(afterState.campaign.title, afterState.campaign.status, revision, canonicalJson(afterState), hash, committedAt, id);
        this.inject('execute.after-projection');
        if (revision % this.snapshotInterval === 0) this.insertSnapshot(id, revision, afterState, hash, committedAt);
        this.insertReceipt(requestId, requestDigest, id, commit, committedAt);
      });
      this.recordCommitDuration(started);
      return commit;
    });
  }

  verifyOrThrow(): void {
    verifyCampaignDatabase(this.#database);
  }

  async backupTo(destinationPath: string): Promise<string> {
    return this.serializeWrite(async () => {
      const destination = resolve(destinationPath);
      if (destination === this.databasePath) throw new Error('Campaign backup destination must differ from the active database.');
      await mkdir(dirname(destination), { recursive: true });
      await this.removeDatabaseArtifacts(destination);
      await backup(this.#database, destination);
      const copy = new DatabaseSync(destination, { readOnly: true });
      try { verifyCampaignDatabase(copy); } finally { copy.close(); }
      return destination;
    });
  }

  async restoreFrom(sourcePath: string): Promise<void> {
    return this.serializeWrite(async () => {
      const source = resolve(sourcePath);
      if (source === this.databasePath) throw new Error('Campaign restore source must differ from the active database.');
      const safety = `${this.databasePath}.before-restore`;
      const staged = `${this.databasePath}.restore`;
      await this.removeDatabaseArtifacts(safety);
      await this.removeDatabaseArtifacts(staged);

      try {
        const sourceDatabase = new DatabaseSync(source, { readOnly: true });
        try {
          verifyCampaignDatabase(sourceDatabase);
          await backup(sourceDatabase, staged);
        } finally {
          sourceDatabase.close();
        }
        const stagedDatabase = new DatabaseSync(staged, { readOnly: true });
        try { verifyCampaignDatabase(stagedDatabase); } finally { stagedDatabase.close(); }

        await backup(this.#database, safety);
        try {
          this.inject('restore.after-safety-backup');
          this.closeDatabase();
          await this.removeDatabaseArtifacts(this.databasePath);
          this.inject('restore.after-target-remove');
          await rename(staged, this.databasePath);
          this.inject('restore.after-swap');
          this.openDatabase();
          this.verifyOrThrow();
        } catch (error) {
          let recoveryError: unknown;
          try {
            this.closeDatabase();
            await this.removeDatabaseArtifacts(this.databasePath);
            await copyFile(safety, this.databasePath);
            this.openDatabase();
            this.verifyOrThrow();
          } catch (caught) {
            recoveryError = caught;
          }
          if (recoveryError !== undefined) {
            throw new AggregateError([error, recoveryError], 'Campaign restore failed and the previous authority could not be recovered safely.');
          }
          throw error;
        }
      } finally {
        await this.removeDatabaseArtifacts(staged);
        await this.removeDatabaseArtifacts(safety);
      }
    });
  }

  private configure(): void {
    this.#database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA wal_autocheckpoint = 1000;
    `);
  }

  private assertStoreIdentity(): void {
    const applicationId = Number((this.#database.prepare('PRAGMA application_id').get() as Record<string, number>)?.application_id ?? 0);
    const tables = this.#database.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all();
    if (applicationId !== 0 && applicationId !== APPLICATION_ID) throw new Error('Campaign database belongs to another application.');
    if (applicationId === 0 && tables.length > 0) throw new Error('Refusing to initialize Campaign authority inside a non-empty foreign SQLite database.');
    if (applicationId === 0) this.#database.exec(`PRAGMA application_id = ${APPLICATION_ID}`);
  }

  private migrate(): void {
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);
    const migration = this.#database.prepare('SELECT name, checksum FROM schema_migrations WHERE version = ?').get(CAMPAIGN_AUTHORITY_MIGRATION.version) as { name: string; checksum: string } | undefined;
    const checksum = campaignMigrationChecksum();
    if (migration) {
      if (migration.name !== CAMPAIGN_AUTHORITY_MIGRATION.name || migration.checksum !== checksum) throw new Error('Campaign migration checksum mismatch.');
      return;
    }
    this.transaction(() => {
      this.#database.exec(CAMPAIGN_AUTHORITY_MIGRATION.source);
      this.#database.prepare('INSERT INTO store_meta(singleton, store_epoch) VALUES (1, ?)').run(randomUUID());
      this.#database.prepare('INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (?, ?, ?, ?)')
        .run(CAMPAIGN_AUTHORITY_MIGRATION.version, CAMPAIGN_AUTHORITY_MIGRATION.name, checksum, new Date().toISOString());
    });
  }

  private reconstruct(campaignId: string, revision: number): CampaignState {
    const campaign = this.requireCampaign(campaignId);
    if (!Number.isInteger(revision) || revision < 1 || revision > Number(campaign.current_revision)) {
      throw new CampaignExpectedError('CAMPAIGN_REVISION_NOT_FOUND', `Campaign revision ${revision} was not found.`, 404, { campaignId, revision, currentRevision: Number(campaign.current_revision) });
    }
    const event = this.#database.prepare('SELECT after_state_json FROM campaign_events WHERE campaign_id = ? AND revision = ?').get(campaignId, revision) as { after_state_json: string } | undefined;
    if (!event) throw new Error(`Campaign ${campaignId} is missing immutable revision ${revision}.`);
    verifyCampaignDatabase(this.#database);
    return parseJson<CampaignState>(event.after_state_json);
  }

  private requireCampaign(campaignId: string): CampaignRow {
    const row = this.#database.prepare('SELECT * FROM campaigns WHERE campaign_id = ?').get(campaignId) as CampaignRow | undefined;
    if (!row) throw new CampaignExpectedError('CAMPAIGN_NOT_FOUND', `Campaign ${campaignId} was not found.`, 404, { campaignId });
    return row;
  }

  private readReceipt(requestId: string): ReceiptRow | undefined {
    return this.#database.prepare('SELECT request_hash, outcome_json FROM request_receipts WHERE request_id = ?').get(requestId) as ReceiptRow | undefined;
  }

  private acceptReceipt(receipt: ReceiptRow, digest: string): CampaignCommit {
    if (receipt.request_hash !== digest) throw new CampaignExpectedError('CAMPAIGN_REQUEST_CONFLICT', 'Request ID was already used for different Campaign work.', 409);
    return { ...parseJson<CampaignCommit>(receipt.outcome_json), idempotent: true };
  }

  private insertReceipt(requestId: string, digest: string, campaignId: string, commit: CampaignCommit, createdAt: string): void {
    this.#database.prepare('INSERT INTO request_receipts(request_id, request_hash, campaign_id, outcome_json, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(requestId, digest, campaignId, canonicalJson(commit), createdAt);
  }

  private insertEvent(input: {
    campaignId: string; revision: number; eventId: string; requestId: string; operationKind: string;
    operation: unknown; beforeState: CampaignState | null; afterState: CampaignState; acceptedAt: string;
    previousEventHash: string | null; eventHash: string;
  }): void {
    this.#database.prepare(`
      INSERT INTO campaign_events(campaign_id, revision, event_id, request_id, event_schema_version, operation_kind, operation_json, before_state_json, after_state_json, accepted_at, previous_event_hash, event_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(input.campaignId, input.revision, input.eventId, input.requestId, EVENT_SCHEMA_VERSION, input.operationKind, canonicalJson(input.operation), input.beforeState ? canonicalJson(input.beforeState) : null, canonicalJson(input.afterState), input.acceptedAt, input.previousEventHash, input.eventHash);
  }

  private insertSnapshot(campaignId: string, revision: number, state: CampaignState, eventHashValue: string, createdAt: string): void {
    this.#database.prepare(`
      INSERT INTO campaign_snapshots(campaign_id, revision, schema_version, state_json, state_hash, event_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(campaignId, revision, STATE_SCHEMA_VERSION, canonicalJson(state), sha256(state), eventHashValue, createdAt);
  }

  private transaction<T>(work: () => T): T {
    this.#database.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.#database.exec('COMMIT');
      return result;
    } catch (error) {
      this.#database.exec('ROLLBACK');
      throw error;
    }
  }

  private serializeWrite<T>(work: () => T | Promise<T>): Promise<T> {
    const run = this.#writeTail.then(work, work);
    this.#writeTail = run.then(() => undefined, () => undefined);
    return run;
  }

  private inject(point: CampaignJournalFaultPoint): void {
    this.#faultInjector?.(point);
  }

  private recordCommitDuration(started: number): void {
    this.#commitDurations.push(Math.max(0, performance.now() - started));
    if (this.#commitDurations.length > this.timingSampleLimit) {
      this.#commitDurations.splice(0, this.#commitDurations.length - this.timingSampleLimit);
    }
  }

  private closeDatabase(): void {
    if (!this.#databaseOpen) return;
    this.#database.close();
    this.#databaseOpen = false;
  }

  private openDatabase(): void {
    this.#database = new DatabaseSync(this.databasePath);
    this.#databaseOpen = true;
    this.configure();
  }

  private async removeDatabaseArtifacts(path: string): Promise<void> {
    await Promise.all([
      rm(path, { force: true }),
      rm(`${path}-wal`, { force: true }),
      rm(`${path}-shm`, { force: true }),
    ]);
  }
}
