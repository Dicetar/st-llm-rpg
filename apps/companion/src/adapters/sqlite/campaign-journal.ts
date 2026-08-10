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
  CampaignVerificationResult,
  ChatBindingDocument,
  FollowCampaignHeadRequest,
  NarratorModelProfile,
  NarratorVisibility,
  PreflightContextRequest,
  SetContextPinsRequest,
  DecideStorySyncProposalRequest,
  StorySyncJobDocument,
  StorySyncJobStatus,
  StorySyncFinalizationReceipt,
  StorySyncProposal,
  WorkerModelProfile,
} from '@st-llm-rpg/wire';
import { CAMPAIGN_AUTHORITY_MIGRATION, campaignMigrationChecksum } from '../../migrations/001-campaign-authority.js';
import {
  CAMPAIGN_SUBJECT_EVENTS_MIGRATION,
  campaignSubjectEventsMigrationChecksum,
} from '../../migrations/002-campaign-subject-events.js';
import {
  CAMPAIGN_CURRENT_PROJECTIONS_MIGRATION,
  campaignCurrentProjectionsMigrationChecksum,
} from '../../migrations/003-campaign-current-projections.js';
import {
  CHAT_BINDINGS_MIGRATION,
  chatBindingsMigrationChecksum,
} from '../../migrations/004-chat-bindings.js';
import {
  CONTEXT_PLANNING_MIGRATION,
  contextPlanningMigrationChecksum,
} from '../../migrations/005-context-planning.js';
import {
  STORY_SYNC_JOBS_MIGRATION,
  storySyncJobsMigrationChecksum,
} from '../../migrations/006-story-sync-jobs.js';
import {
  STORY_SYNC_FINALIZATION_MIGRATION,
  storySyncFinalizationMigrationChecksum,
} from '../../migrations/007-story-sync-finalization.js';
import {
  CAMPAIGN_ABILITIES_MIGRATION,
  campaignAbilitiesMigrationChecksum,
} from '../../migrations/008-campaign-abilities.js';
import {
  CAMPAIGN_RELATIONSHIPS_MIGRATION,
  campaignRelationshipsMigrationChecksum,
} from '../../migrations/009-campaign-relationships.js';
import {
  CAMPAIGN_WORLD_RECORDS_MIGRATION,
  campaignWorldRecordsMigrationChecksum,
} from '../../migrations/010-campaign-world-records.js';
import { CampaignExpectedError } from '../../modules/campaign/campaign-error.js';
import {
  asDocument,
  canonicalJson,
  cleanIdentifier,
  normalizeCampaignState,
  parseJson,
  sha256,
  subjectImageHash,
  type CampaignState,
  type CampaignSubjectChange,
} from '../../modules/campaign/campaign-state.js';
import type {
  CampaignCommitReceipt,
  CampaignJournal,
  CampaignJournalAppend,
  CampaignJournalBackupRequest,
  CampaignJournalBackupResult,
  CampaignJournalHead,
  CampaignJournalObservation,
  CampaignJournalRead,
  CampaignJournalReadResult,
  CampaignJournalReceipt,
  CampaignJournalRestoreRequest,
  CampaignJournalTransaction,
  CampaignJournalTransactionCompletion,
  CampaignJournalVerifyBackupRequest,
  CompleteStorySyncFinalization,
  StorySyncFinalizationReview,
} from '../../modules/campaign/campaign-journal.js';
import {
  buildCampaignSnapshotInWorker,
  readCampaignRevisionInWorker,
  type CampaignSnapshotCandidate,
  verifyCampaignAuthorityInWorker,
} from './campaign-maintenance.js';
import type { CampaignRow, ReceiptRow } from './campaign-rows.js';
import {
  applyCurrentCampaignProjectionChanges,
  LEGACY_CURRENT_STATE_MARKER,
  readCurrentCampaignState,
  replaceCurrentCampaignProjections,
} from './campaign-projections.js';
import { reconstructCampaignState, verifyCampaignDatabase } from './campaign-verifier.js';
import type {
  ChatBindingCreate,
  LegacyBindingLink,
  LegacyCampaignImport,
  LegacyImportJournal,
  LegacyImportLookup,
  LegacyMarkerOutcome,
  StoredLegacyImport,
} from '../../modules/legacy-import/legacy-import-journal.js';
import type {
  ContextAuthority,
  ContextPlanningSource,
  ContextSearchHit,
} from '../../modules/context/context-planner.js';
import type {
  CompleteStorySyncAttempt,
  CreateStorySyncJob,
  StorySyncJournal,
  StoredStorySyncSource,
} from '../../modules/story-sync/story-sync-journal.js';

const APPLICATION_ID = 0x52504733;
const EVENT_SCHEMA_VERSION = 2;
const STATE_SCHEMA_VERSION = 1;
const DEFAULT_SNAPSHOT_INTERVAL = 100;
const DEFAULT_TIMING_SAMPLE_LIMIT = 500;
const SEARCH_STOP_WORDS = new Set([
  'and', 'are', 'but', 'for', 'from', 'has', 'have', 'her', 'his', 'into', 'its',
  'not', 'that', 'the', 'their', 'then', 'there', 'they', 'this', 'was', 'were',
  'what', 'when', 'where', 'which', 'who', 'with', 'you', 'your',
]);

function normalizeSearchText(value: string): string {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim().replace(/\s+/g, ' ');
}

function significantSearchTerms(value: string): string[] {
  const terms: string[] = [];
  for (const term of normalizeSearchText(value).split(' ')) {
    if (term.length < 3 || SEARCH_STOP_WORDS.has(term) || terms.includes(term)) continue;
    terms.push(term);
    if (terms.length >= 16) break;
  }
  return terms;
}

type StoredCommitReceipt = CampaignCommitReceipt & Readonly<{
  receiptSchemaVersion: 2;
}>;

type ChatBindingRow = Readonly<{
  binding_id: string;
  campaign_id: string;
  binding_revision: number;
  campaign_anchor: number;
  locator_json: string;
  locator_fingerprint: string;
  source_fingerprint: string;
  content_fingerprint: string;
  marker_state: 'pending' | 'verified' | 'blocked';
  marker_problem: string | null;
  context_focus_revision: number;
  pins_json: string;
  sync_facet_revision: number;
  sync_through_message_index: number;
  sync_prefix_hash: string;
  created_at: string;
  updated_at: string;
}>;

function bindingDocument(row: ChatBindingRow): ChatBindingDocument {
  return {
    schema: 'st-rpg.chat-binding',
    version: '1.0',
    id: row.binding_id,
    campaignId: row.campaign_id,
    revision: Number(row.binding_revision),
    campaignAnchor: Number(row.campaign_anchor),
    contextFocusRevision: Number(row.context_focus_revision ?? 1),
    pins: parseJson<string[]>(row.pins_json ?? '[]'),
    syncFacetRevision: Number(row.sync_facet_revision ?? 1),
    syncBoundary: {
      throughMessageIndex: Number(row.sync_through_message_index ?? -1),
      prefixHash: row.sync_prefix_hash ?? sha256(''),
    },
    locator: parseJson(row.locator_json),
    sourceFingerprint: row.source_fingerprint,
    contentFingerprint: row.content_fingerprint,
    markerState: row.marker_state,
    ...(row.marker_problem ? { markerProblem: row.marker_problem } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

type WorkerProfileRow = Readonly<{
  profile_id: string;
  model_id: string;
  requested_output_tokens: number;
  updated_at: string;
}>;

type WorkerJobRow = Readonly<{
  job_id: string;
  request_id: string;
  campaign_id: string;
  binding_id: string;
  profile_id: string;
  status: StorySyncJobStatus;
  campaign_anchor: number;
  binding_revision: number;
  sync_facet_revision: number;
  source_json: string;
  source_fingerprint: string;
  source_end_prefix_hash: string;
  source_first_message_index: number;
  source_last_message_index: number;
  source_message_count: number;
  source_content_pruned: number;
  attempt_count: number;
  problem_code: string | null;
  problem_message: string | null;
  created_at: string;
  updated_at: string;
  finalization_request_id: string | null;
  decision_hash: string | null;
  campaign_event_id: string | null;
  binding_event_id: string | null;
  completed_campaign_revision: number | null;
  completed_binding_revision: number | null;
  finalized_at: string | null;
}>;

type ProposalRow = Readonly<{
  proposal_id: string;
  job_id: string;
  ordinal: number;
  revision: number;
  decision: StorySyncProposal['decision'];
  draft_json: string;
  source_links_json: string;
  validation_problems_json: string;
  confidence: StorySyncProposal['confidence'];
}>;

function workerProfile(row: WorkerProfileRow): WorkerModelProfile {
  return {
    schema: 'st-rpg.worker-model-profile',
    version: '1.0',
    id: row.profile_id,
    modelId: row.model_id,
    requestedOutputTokens: Number(row.requested_output_tokens),
    updatedAt: row.updated_at,
  };
}

function proposalDocument(row: ProposalRow): StorySyncProposal {
  return {
    id: row.proposal_id,
    jobId: row.job_id,
    ordinal: Number(row.ordinal),
    revision: Number(row.revision),
    decision: row.decision,
    draft: parseJson(row.draft_json),
    sourceLinks: parseJson(row.source_links_json),
    validationProblems: parseJson(row.validation_problems_json),
    confidence: row.confidence,
  };
}

export type CampaignJournalFaultPoint =
  | 'create.after-event'
  | 'execute.after-event'
  | 'execute.after-projection'
  | 'restore.after-safety-backup'
  | 'restore.after-target-remove'
  | 'restore.after-swap';

export type CampaignJournalOptions = Readonly<{
  snapshotInterval?: number;
  timingSampleLimit?: number;
  faultInjector?: (point: CampaignJournalFaultPoint) => void;
  snapshotBuilder?: (databasePath: string, campaignId: string, revision: number) => Promise<CampaignSnapshotCandidate>;
  revisionReader?: (databasePath: string, campaignId: string, revision: number) => Promise<CampaignDocument>;
  beforeRestoreActivation?: () => Promise<void>;
}>;

export class SqliteCampaignJournal implements CampaignJournal, LegacyImportJournal, ContextPlanningSource, StorySyncJournal {
  readonly databasePath: string;
  readonly snapshotInterval: number;
  readonly timingSampleLimit: number;
  #database: DatabaseSync;
  #databaseOpen = true;
  #writeTail: Promise<void> = Promise.resolve();
  #lifecycleTail: Promise<void> = Promise.resolve();
  #commitDurations: number[] = [];
  #faultInjector: ((point: CampaignJournalFaultPoint) => void) | undefined;
  #snapshotBuilder: (databasePath: string, campaignId: string, revision: number) => Promise<CampaignSnapshotCandidate>;
  #revisionReader: (databasePath: string, campaignId: string, revision: number) => Promise<CampaignDocument>;
  #beforeRestoreActivation: (() => Promise<void>) | undefined;
  #maintenanceTail: Promise<void> = Promise.resolve();
  #maintenancePending = 0;
  #maintenanceFailure: Error | undefined;
  #lifecycleState: 'open' | 'closing' | 'closed' = 'open';
  #closePromise: Promise<void> | undefined;

  private constructor(
    databasePath: string,
    options: Required<Pick<CampaignJournalOptions, 'snapshotInterval' | 'timingSampleLimit' | 'snapshotBuilder' | 'revisionReader'>>
      & Pick<CampaignJournalOptions, 'faultInjector' | 'beforeRestoreActivation'>,
    database: DatabaseSync,
  ) {
    this.databasePath = databasePath;
    this.snapshotInterval = options.snapshotInterval;
    this.timingSampleLimit = options.timingSampleLimit;
    this.#faultInjector = options.faultInjector;
    this.#snapshotBuilder = options.snapshotBuilder;
    this.#revisionReader = options.revisionReader;
    this.#beforeRestoreActivation = options.beforeRestoreActivation;
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
      snapshotBuilder: normalized.snapshotBuilder ?? buildCampaignSnapshotInWorker,
      revisionReader: normalized.revisionReader ?? readCampaignRevisionInWorker,
      ...(normalized.faultInjector ? { faultInjector: normalized.faultInjector } : {}),
      ...(normalized.beforeRestoreActivation ? { beforeRestoreActivation: normalized.beforeRestoreActivation } : {}),
    }, database);
    try {
      journal.configure();
      journal.assertStoreIdentity();
      await journal.migrate();
      journal.verifyOrThrow();
      return journal;
    } catch (error) {
      await journal.close();
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.#lifecycleState === 'closed') return;
    if (this.#closePromise) return this.#closePromise;
    this.#lifecycleState = 'closing';
    this.#closePromise = (async () => {
      let failure: unknown;
      try {
        await this.#lifecycleTail;
        await this.drainMaintenance();
        await this.#writeTail;
      } catch (error) {
        failure = error;
      } finally {
        this.closeDatabase();
        this.#lifecycleState = 'closed';
      }
      if (failure !== undefined) throw failure;
    })();
    return this.#closePromise;
  }

  storeEpoch(): string {
    const row = this.#database.prepare('SELECT store_epoch FROM store_meta WHERE singleton = 1').get() as { store_epoch: string } | undefined;
    if (!row?.store_epoch) throw new Error('Campaign authority is missing its Store Epoch.');
    return row.store_epoch;
  }

  observation(): CampaignJournalObservation {
    const started = performance.now();
    try {
      if (this.#maintenanceFailure) {
        throw new Error(
          `Snapshot maintenance failed: ${this.#maintenanceFailure.message}. Restart the companion before accepting more Campaign work.`,
        );
      }
      const row = this.#database.prepare('SELECT COUNT(*) AS count FROM campaigns').get() as { count: number | bigint };
      const performanceSummary = this.performance();
      const timing = performanceSummary.sampleCount > 0
        ? ` Commit p95 ${performanceSummary.p95Ms.toFixed(2)} ms, max ${performanceSummary.maxMs.toFixed(2)} ms.`
        : '';
      const maintenance = this.#maintenancePending > 0 ? ` Snapshot maintenance pending: ${this.#maintenancePending}.` : '';
      return {
        ready: true,
        message: `SQLite Campaign authority is ready at ${this.databasePath} (${Number(row.count)} Campaigns).${timing}${maintenance}`,
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

  async readAt<R extends CampaignJournalRead>(request: R): Promise<CampaignJournalReadResult<R>> {
    return this.serializeLifecycle(
      () => this.performRead(request),
      { allowMaintenanceFailure: true },
    );
  }

  async lookupLegacyImport(
    sourceFingerprint: string,
    contentFingerprint: string,
    locatorFingerprint: string,
  ): Promise<LegacyImportLookup> {
    return this.serializeLifecycle(() => {
      const exact = this.#database.prepare(
        'SELECT * FROM chat_bindings WHERE source_fingerprint = ?',
      ).get(sourceFingerprint) as ChatBindingRow | undefined;
      const sameContent = this.#database.prepare(`
        SELECT * FROM chat_bindings WHERE content_fingerprint = ? AND source_fingerprint <> ?
        ORDER BY created_at, binding_id LIMIT 1
      `).get(contentFingerprint, sourceFingerprint) as ChatBindingRow | undefined;
      const sameLocator = this.#database.prepare(`
        SELECT * FROM chat_bindings WHERE locator_fingerprint = ? AND source_fingerprint <> ?
        ORDER BY updated_at DESC, binding_id LIMIT 1
      `).get(locatorFingerprint, sourceFingerprint) as ChatBindingRow | undefined;
      return {
        exact: exact ? bindingDocument(exact) : null,
        sameContent: sameContent ? bindingDocument(sameContent) : null,
        sameLocator: sameLocator ? bindingDocument(sameLocator) : null,
      };
    }, { allowMaintenanceFailure: true });
  }

  async importLegacyCampaign(input: LegacyCampaignImport): Promise<StoredLegacyImport> {
    return this.serializeLifecycle(() => this.serializeWrite(() => this.transaction(() => {
      const exact = this.findBindingBySource(input.binding.sourceFingerprint);
      if (exact) return this.storedLegacyImport(exact);
      this.persistAppend(input.append);
      this.persistLegacyBinding({
        binding: input.binding,
        locatorFingerprint: input.locatorFingerprint,
        envelopeJson: input.envelopeJson,
        legacyRevision: input.legacyRevision,
        bindingEventId: input.bindingEventId,
        requestId: input.append.requestId,
        bindingOperation: input.bindingOperation,
      });
      return {
        campaignId: input.append.commit.campaignId,
        campaignRevision: input.append.commit.revision,
        binding: input.binding,
      };
    })));
  }

  async linkLegacyBinding(input: LegacyBindingLink): Promise<StoredLegacyImport> {
    return this.serializeLifecycle(() => this.serializeWrite(() => this.transaction(() => {
      const exact = this.findBindingBySource(input.binding.sourceFingerprint);
      if (exact) return this.storedLegacyImport(exact);
      const campaign = this.requireCampaign(input.campaignId);
      if (Number(campaign.current_revision) !== input.campaignRevision) {
        throw new CampaignExpectedError(
          'CAMPAIGN_REVISION_CONFLICT',
          `Campaign changed from revision ${input.campaignRevision} to ${campaign.current_revision} before the Binding could be created.`,
          { campaignId: input.campaignId, expectedRevision: input.campaignRevision, actualRevision: Number(campaign.current_revision) },
        );
      }
      this.persistLegacyBinding({
        binding: input.binding,
        locatorFingerprint: input.locatorFingerprint,
        envelopeJson: input.envelopeJson,
        legacyRevision: input.legacyRevision,
        bindingEventId: input.bindingEventId,
        requestId: input.requestId,
        bindingOperation: input.bindingOperation,
      });
      return { campaignId: input.campaignId, campaignRevision: input.campaignRevision, binding: input.binding };
    })));
  }

  async createChatBinding(input: ChatBindingCreate): Promise<StoredLegacyImport> {
    return this.serializeLifecycle(() => this.serializeWrite(() => this.transaction(() => {
      const exact = this.findBindingBySource(input.binding.sourceFingerprint);
      if (exact) {
        if (exact.campaign_id !== input.campaignId) {
          throw new CampaignExpectedError(
            'CHAT_BINDING_COLLISION',
            'This SillyTavern chat is already linked to another Campaign.',
            { bindingId: exact.binding_id, campaignId: exact.campaign_id },
          );
        }
        return this.storedLegacyImport(exact);
      }
      const campaign = this.requireCampaign(input.campaignId);
      if (Number(campaign.current_revision) !== input.campaignRevision) {
        throw new CampaignExpectedError(
          'CAMPAIGN_REVISION_CONFLICT',
          `Campaign changed from revision ${input.campaignRevision} to ${campaign.current_revision} before the Binding could be created.`,
          { campaignId: input.campaignId, expectedRevision: input.campaignRevision, actualRevision: Number(campaign.current_revision) },
        );
      }
      const locatorCollision = this.#database.prepare(`
        SELECT * FROM chat_bindings WHERE locator_fingerprint = ?
        ORDER BY updated_at DESC, binding_id LIMIT 1
      `).get(input.locatorFingerprint) as ChatBindingRow | undefined;
      if (locatorCollision) {
        throw new CampaignExpectedError(
          'CHAT_BINDING_COLLISION',
          'This SillyTavern chat already has a different Chat Binding.',
          { bindingId: locatorCollision.binding_id, campaignId: locatorCollision.campaign_id },
        );
      }
      this.persistBinding(input);
      return { campaignId: input.campaignId, campaignRevision: input.campaignRevision, binding: input.binding };
    })));
  }

  async readBinding(bindingId: string): Promise<ChatBindingDocument> {
    return this.serializeLifecycle(() => {
      const id = cleanIdentifier(bindingId, 'Binding ID');
      const row = this.#database.prepare('SELECT * FROM chat_bindings WHERE binding_id = ?').get(id) as ChatBindingRow | undefined;
      if (!row) throw new CampaignExpectedError('CHAT_BINDING_NOT_FOUND', `Chat Binding ${id} was not found.`, { bindingId: id });
      return bindingDocument(row);
    }, { allowMaintenanceFailure: true });
  }

  async setContextPins(input: SetContextPinsRequest & Readonly<{ bindingId: string }>): Promise<ChatBindingDocument> {
    return this.serializeLifecycle(() => this.serializeWrite(() => this.transaction(() => {
      const bindingId = cleanIdentifier(input.bindingId, 'Binding ID');
      const current = this.findBindingById(bindingId);
      if (!current) {
        throw new CampaignExpectedError('CHAT_BINDING_NOT_FOUND', `Chat Binding ${bindingId} was not found.`, { bindingId });
      }
      const focusRevision = Number(current.context_focus_revision ?? 1);
      if (
        Number(current.binding_revision) !== input.expectedBindingRevision
        || focusRevision !== input.expectedContextFocusRevision
      ) {
        throw new CampaignExpectedError(
          'CAMPAIGN_REVISION_CONFLICT',
          `Context Focus changed before ordered pins could be saved.`,
          {
            bindingId,
            expectedBindingRevision: input.expectedBindingRevision,
            actualBindingRevision: Number(current.binding_revision),
            expectedContextFocusRevision: input.expectedContextFocusRevision,
            actualContextFocusRevision: focusRevision,
          },
        );
      }
      const pins = input.pins.map(pin => cleanIdentifier(pin, 'Pinned Record ID'));
      if (new Set(pins).size !== pins.length) {
        throw new CampaignExpectedError('CAMPAIGN_VALIDATION_FAILED', 'Context pins must be unique.', { pins });
      }
      const state = this.reconstruct(current.campaign_id, Number(current.campaign_anchor));
      const records = new Map<string, { archived: boolean; visibility?: NarratorVisibility }>([
        ...Object.values(state.actors).map(record => [record.id, record] as const),
        ...Object.values(state.items).map(record => [record.id, record] as const),
        ...Object.values(state.quests ?? {}).map(record => [record.id, record] as const),
        ...Object.values(state.places ?? {}).map(record => [record.id, record] as const),
        ...Object.values(state.abilities ?? {}).map(record => [record.id, record] as const),
        ...Object.values(state.relationships ?? {}).map(record => [record.id, record] as const),
      ]);
      for (const pin of pins) {
        const record = records.get(pin);
        if (!record || record.archived) {
          throw new CampaignExpectedError('CONTEXT_STALE_PIN', `Pinned Record ${pin} is missing or archived.`, { recordId: pin });
        }
        if (record.visibility === 'campaign_private') {
          throw new CampaignExpectedError('CONTEXT_PRIVATE_PIN', `Pinned Record ${pin} is Campaign Private.`, { recordId: pin });
        }
      }
      const nextBindingRevision = input.expectedBindingRevision + 1;
      const nextFocusRevision = input.expectedContextFocusRevision + 1;
      const updatedAt = new Date().toISOString();
      const operation = { kind: 'set_context_pins', pins };
      const result = this.#database.prepare(`
        UPDATE chat_bindings
        SET binding_revision = ?, context_focus_revision = ?, pins_json = ?, updated_at = ?
        WHERE binding_id = ? AND binding_revision = ? AND context_focus_revision = ?
      `).run(
        nextBindingRevision,
        nextFocusRevision,
        canonicalJson(pins),
        updatedAt,
        bindingId,
        input.expectedBindingRevision,
        input.expectedContextFocusRevision,
      );
      if (Number(result.changes) !== 1) {
        throw new CampaignExpectedError('CAMPAIGN_REVISION_CONFLICT', 'Context pin update lost its revision race.', { bindingId });
      }
      this.#database.prepare(`
        INSERT INTO chat_binding_events(binding_id, revision, event_id, request_id, operation_kind, operation_json, accepted_at)
        VALUES (?, ?, ?, ?, 'set_context_pins', ?, ?)
      `).run(
        bindingId,
        nextBindingRevision,
        cleanIdentifier(input.eventId, 'Binding Event ID'),
        cleanIdentifier(input.requestId, 'Binding request ID'),
        canonicalJson(operation),
        updatedAt,
      );
      return bindingDocument(this.findBindingById(bindingId)!);
    })));
  }

  async listBindings(campaignId: string): Promise<readonly ChatBindingDocument[]> {
    return this.serializeLifecycle(() => {
      const id = cleanIdentifier(campaignId, 'Campaign ID');
      this.requireCampaign(id);
      const rows = this.#database.prepare(`
        SELECT * FROM chat_bindings WHERE campaign_id = ? ORDER BY created_at, binding_id
      `).all(id) as ChatBindingRow[];
      return rows.map(bindingDocument);
    }, { allowMaintenanceFailure: true });
  }

  async followCampaignHead(
    input: FollowCampaignHeadRequest & Readonly<{ bindingId: string }>,
  ): Promise<ChatBindingDocument> {
    return this.serializeLifecycle(() => this.serializeWrite(() => this.transaction(() => {
      const bindingId = cleanIdentifier(input.bindingId, 'Binding ID');
      const current = this.findBindingById(bindingId);
      if (!current) {
        throw new CampaignExpectedError('CHAT_BINDING_NOT_FOUND', `Chat Binding ${bindingId} was not found.`, { bindingId });
      }
      const campaign = this.requireCampaign(current.campaign_id);
      const currentRevision = Number(campaign.current_revision);
      if (input.targetCampaignRevision !== currentRevision) {
        throw new CampaignExpectedError(
          'CAMPAIGN_REVISION_CONFLICT',
          `Campaign head is revision ${currentRevision}, not requested revision ${input.targetCampaignRevision}. Reload before following it.`,
          { campaignId: current.campaign_id, expectedRevision: input.targetCampaignRevision, actualRevision: currentRevision },
        );
      }
      if (
        Number(current.binding_revision) !== input.expectedBindingRevision
        || Number(current.campaign_anchor) !== input.expectedCampaignAnchor
      ) {
        throw new CampaignExpectedError(
          'CAMPAIGN_REVISION_CONFLICT',
          'Chat Binding changed before it could follow the current Campaign. Reload and choose again.',
          {
            bindingId,
            expectedBindingRevision: input.expectedBindingRevision,
            actualBindingRevision: Number(current.binding_revision),
            expectedCampaignAnchor: input.expectedCampaignAnchor,
            actualCampaignAnchor: Number(current.campaign_anchor),
          },
        );
      }
      if (input.expectedCampaignAnchor === currentRevision) return bindingDocument(current);

      const nextBindingRevision = input.expectedBindingRevision + 1;
      const updatedAt = new Date().toISOString();
      const operation = { kind: 'follow_campaign_head', campaignAnchor: currentRevision };
      const updated = this.#database.prepare(`
        UPDATE chat_bindings
        SET binding_revision = ?, campaign_anchor = ?, updated_at = ?
        WHERE binding_id = ? AND binding_revision = ? AND campaign_anchor = ?
      `).run(
        nextBindingRevision,
        currentRevision,
        updatedAt,
        bindingId,
        input.expectedBindingRevision,
        input.expectedCampaignAnchor,
      );
      if (Number(updated.changes) !== 1) {
        throw new CampaignExpectedError(
          'CAMPAIGN_REVISION_CONFLICT',
          'Chat Binding changed before it could follow the current Campaign. Nothing changed.',
          { bindingId },
        );
      }
      this.#database.prepare(`
        INSERT INTO chat_binding_events(binding_id, revision, event_id, request_id, operation_kind, operation_json, accepted_at)
        VALUES (?, ?, ?, ?, 'follow_campaign_head', ?, ?)
      `).run(
        bindingId,
        nextBindingRevision,
        cleanIdentifier(input.eventId, 'Binding Event ID'),
        cleanIdentifier(input.requestId, 'Binding request ID'),
        canonicalJson(operation),
        updatedAt,
      );
      return bindingDocument(this.findBindingById(bindingId)!);
    })));
  }

  async recordMarkerOutcome(input: LegacyMarkerOutcome): Promise<ChatBindingDocument> {
    return this.serializeLifecycle(() => this.serializeWrite(() => this.transaction(() => {
      const id = cleanIdentifier(input.bindingId, 'Binding ID');
      const current = this.findBindingById(id);
      if (!current) {
        throw new CampaignExpectedError('CHAT_BINDING_NOT_FOUND', `Chat Binding ${id} was not found.`, { bindingId: id });
      }
      const nextProblem = input.state === 'blocked'
        ? String(input.problem ?? 'Marker verification failed.').slice(0, 1024)
        : null;
      if (current.marker_state === input.state && current.marker_problem === nextProblem) return bindingDocument(current);
      if (Number(current.binding_revision) !== input.expectedRevision) {
        throw new CampaignExpectedError(
          'CAMPAIGN_REVISION_CONFLICT',
          `Chat Binding changed from revision ${input.expectedRevision} to ${current.binding_revision} before marker reconciliation.`,
          { bindingId: id, expectedRevision: input.expectedRevision, actualRevision: Number(current.binding_revision) },
        );
      }
      const updatedAt = new Date().toISOString();
      const result = this.#database.prepare(`
        UPDATE chat_bindings
        SET binding_revision = ?, marker_state = ?, marker_problem = ?, updated_at = ?
        WHERE binding_id = ? AND binding_revision = ?
      `).run(input.expectedRevision + 1, input.state, nextProblem, updatedAt, id, input.expectedRevision);
      if (Number(result.changes) !== 1) {
        throw new CampaignExpectedError('CAMPAIGN_REVISION_CONFLICT', 'Chat Binding marker reconciliation lost its revision race.', {
          bindingId: id,
          expectedRevision: input.expectedRevision,
        });
      }
      this.#database.prepare(`
        INSERT INTO chat_binding_events(binding_id, revision, event_id, request_id, operation_kind, operation_json, accepted_at)
        VALUES (?, ?, ?, ?, 'reconcile_binding_marker', ?, ?)
      `).run(
        id,
        input.expectedRevision + 1,
        cleanIdentifier(input.eventId, 'Binding Event ID'),
        cleanIdentifier(input.requestId, 'Binding request ID'),
        canonicalJson({ kind: 'reconcile_binding_marker', state: input.state, problem: nextProblem }),
        updatedAt,
      );
      return bindingDocument(this.findBindingById(id)!);
    })));
  }

  async readCampaignRevision(campaignId: string): Promise<number> {
    return this.serializeLifecycle(() => Number(this.requireCampaign(cleanIdentifier(campaignId, 'Campaign ID')).current_revision), {
      allowMaintenanceFailure: true,
    });
  }

  async saveNarratorModelProfile(profile: NarratorModelProfile): Promise<NarratorModelProfile> {
    return this.serializeLifecycle(() => this.serializeWrite(() => this.transaction(() => {
      const updatedAt = new Date().toISOString();
      this.#database.prepare(`
        INSERT INTO narrator_model_profiles(profile_id, model_id, profile_json, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(profile_id) DO UPDATE SET
          model_id = excluded.model_id,
          profile_json = excluded.profile_json,
          updated_at = excluded.updated_at
      `).run(profile.id, profile.modelId, canonicalJson(profile), updatedAt);
      return structuredClone(profile);
    })));
  }

  async listNarratorModelProfiles(): Promise<readonly NarratorModelProfile[]> {
    return this.serializeLifecycle(() => {
      const rows = this.#database.prepare(`
        SELECT profile_json FROM narrator_model_profiles ORDER BY profile_id
      `).all() as Array<{ profile_json: string }>;
      return rows.map(row => parseJson<NarratorModelProfile>(row.profile_json));
    }, { allowMaintenanceFailure: true });
  }

  async saveWorkerModelProfile(profile: WorkerModelProfile): Promise<WorkerModelProfile> {
    return this.serializeLifecycle(() => this.serializeWrite(() => this.transaction(() => {
      const id = cleanIdentifier(profile.id, 'Worker model profile ID');
      const updatedAt = new Date().toISOString();
      this.#database.prepare(`
        INSERT INTO worker_model_profiles(profile_id, model_id, requested_output_tokens, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(profile_id) DO UPDATE SET
          model_id = excluded.model_id,
          requested_output_tokens = excluded.requested_output_tokens,
          updated_at = excluded.updated_at
      `).run(id, profile.modelId, profile.requestedOutputTokens, updatedAt);
      return workerProfile(this.requireWorkerProfile(id));
    })));
  }

  async readWorkerModelProfile(profileId: string): Promise<WorkerModelProfile> {
    return this.serializeLifecycle(
      () => workerProfile(this.requireWorkerProfile(cleanIdentifier(profileId, 'Worker model profile ID'))),
      { allowMaintenanceFailure: true },
    );
  }

  async listWorkerModelProfiles(): Promise<readonly WorkerModelProfile[]> {
    return this.serializeLifecycle(() => (
      this.#database.prepare('SELECT * FROM worker_model_profiles ORDER BY profile_id').all() as WorkerProfileRow[]
    ).map(workerProfile), { allowMaintenanceFailure: true });
  }

  async createStorySyncJob(input: CreateStorySyncJob): Promise<StorySyncJobDocument> {
    return this.serializeLifecycle(() => this.serializeWrite(() => this.transaction(() => {
      const requestId = cleanIdentifier(input.requestId, 'Story Sync request ID');
      const existing = this.#database.prepare('SELECT * FROM worker_jobs WHERE request_id = ?').get(requestId) as WorkerJobRow | undefined;
      if (existing) return this.storySyncJobDocument(existing);
      const binding = this.findBindingById(cleanIdentifier(input.bindingId, 'Binding ID'));
      if (!binding) throw new CampaignExpectedError('CHAT_BINDING_NOT_FOUND', `Chat Binding ${input.bindingId} was not found.`);
      const pending = this.#database.prepare(`
        SELECT job_id FROM worker_jobs
        WHERE binding_id = ? AND status NOT IN ('completed', 'discarded', 'cancelled', 'failed')
        LIMIT 1
      `).get(binding.binding_id) as { job_id: string } | undefined;
      if (pending) {
        throw new CampaignExpectedError(
          'STORY_SYNC_ALREADY_PENDING',
          'This Chat Binding already has an unresolved Story Sync review.',
          { jobId: pending.job_id },
        );
      }
      this.requireWorkerProfile(cleanIdentifier(input.profileId, 'Worker model profile ID'));
      this.#database.prepare(`
        INSERT INTO worker_jobs(
          job_id, request_id, campaign_id, binding_id, profile_id, status,
          campaign_anchor, binding_revision, sync_facet_revision,
          source_json, source_fingerprint, source_end_prefix_hash,
          source_first_message_index, source_last_message_index, source_message_count,
          source_content_pruned, attempt_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)
      `).run(
        cleanIdentifier(input.jobId, 'Story Sync Job ID'),
        requestId,
        cleanIdentifier(input.campaignId, 'Campaign ID'),
        binding.binding_id,
        input.profileId,
        input.campaignAnchor,
        input.bindingRevision,
        input.syncFacetRevision,
        canonicalJson(input.source),
        input.sourceFingerprint,
        input.sourceEndPrefixHash,
        input.sourceFirstMessageIndex,
        input.sourceLastMessageIndex,
        input.source.messages.length,
        input.createdAt,
        input.createdAt,
      );
      return this.storySyncJobDocument(this.requireStorySyncJob(input.jobId));
    })));
  }

  async readStorySyncJob(jobId: string): Promise<StorySyncJobDocument> {
    return this.serializeLifecycle(
      () => this.storySyncJobDocument(this.requireStorySyncJob(cleanIdentifier(jobId, 'Story Sync Job ID'))),
      { allowMaintenanceFailure: true },
    );
  }

  async readStorySyncSource(jobId: string): Promise<StoredStorySyncSource> {
    return this.serializeLifecycle(
      () => parseJson<StoredStorySyncSource>(this.requireStorySyncJob(cleanIdentifier(jobId, 'Story Sync Job ID')).source_json),
      { allowMaintenanceFailure: true },
    );
  }

  async listStorySyncJobs(campaignId: string): Promise<readonly StorySyncJobDocument[]> {
    return this.serializeLifecycle(() => {
      const id = cleanIdentifier(campaignId, 'Campaign ID');
      this.requireCampaign(id);
      const rows = this.#database.prepare(`
        SELECT * FROM worker_jobs WHERE campaign_id = ? ORDER BY updated_at DESC, job_id
      `).all(id) as WorkerJobRow[];
      return rows.map(row => this.storySyncJobDocument(row));
    }, { allowMaintenanceFailure: true });
  }

  async beginStorySyncAttempt(jobId: string, attemptId: string, startedAt: string): Promise<StorySyncJobDocument> {
    return this.serializeLifecycle(() => this.serializeWrite(() => this.transaction(() => {
      const job = this.requireStorySyncJob(cleanIdentifier(jobId, 'Story Sync Job ID'));
      if (job.status !== 'queued') {
        throw new CampaignExpectedError('STORY_SYNC_REVIEW_LOCKED', `Story Sync Job ${jobId} cannot start from ${job.status}.`);
      }
      const attemptNumber = Number(job.attempt_count) + 1;
      this.#database.prepare(`
        UPDATE worker_jobs
        SET status = 'running', attempt_count = ?, problem_code = NULL, problem_message = NULL, updated_at = ?
        WHERE job_id = ?
      `).run(attemptNumber, startedAt, job.job_id);
      this.#database.prepare(`
        INSERT INTO worker_attempts(
          attempt_id, job_id, attempt_number, status, started_at
        ) VALUES (?, ?, ?, 'running', ?)
      `).run(cleanIdentifier(attemptId, 'Story Sync Attempt ID'), job.job_id, attemptNumber, startedAt);
      return this.storySyncJobDocument(this.requireStorySyncJob(job.job_id));
    })));
  }

  async setStorySyncJobStatus(jobId: string, status: StorySyncJobStatus): Promise<StorySyncJobDocument> {
    return this.serializeLifecycle(() => this.serializeWrite(() => this.transaction(() => {
      const job = this.requireStorySyncJob(cleanIdentifier(jobId, 'Story Sync Job ID'));
      this.#database.prepare('UPDATE worker_jobs SET status = ?, updated_at = ? WHERE job_id = ?')
        .run(status, new Date().toISOString(), job.job_id);
      return this.storySyncJobDocument(this.requireStorySyncJob(job.job_id));
    })));
  }

  async completeStorySyncAttempt(input: CompleteStorySyncAttempt): Promise<StorySyncJobDocument> {
    return this.serializeLifecycle(() => this.serializeWrite(() => this.transaction(() => {
      const job = this.requireStorySyncJob(cleanIdentifier(input.jobId, 'Story Sync Job ID'));
      if (!['running', 'parsing', 'repairing'].includes(job.status)) {
        throw new CampaignExpectedError('STORY_SYNC_REVIEW_LOCKED', `Story Sync Job ${job.job_id} cannot save worker output from ${job.status}.`);
      }
      this.#database.prepare('DELETE FROM story_sync_proposals WHERE job_id = ?').run(job.job_id);
      const insert = this.#database.prepare(`
        INSERT INTO story_sync_proposals(
          proposal_id, job_id, ordinal, revision, decision, draft_json,
          source_links_json, validation_problems_json, confidence
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const proposal of input.proposals) {
        insert.run(
          proposal.id,
          job.job_id,
          proposal.ordinal,
          proposal.revision,
          proposal.decision,
          canonicalJson(proposal.draft),
          canonicalJson(proposal.sourceLinks),
          canonicalJson(proposal.validationProblems),
          proposal.confidence,
        );
      }
      this.#database.prepare(`
        UPDATE worker_attempts
        SET status = 'completed', termination = ?, output_hash = ?, completed_at = ?
        WHERE attempt_id = ? AND job_id = ? AND status = 'running'
      `).run(input.repaired ? 'repaired' : 'parsed', input.outputHash, input.completedAt, input.attemptId, job.job_id);
      this.#database.prepare(`
        UPDATE worker_jobs
        SET status = 'ready-for-review', problem_code = NULL, problem_message = NULL, updated_at = ?
        WHERE job_id = ?
      `).run(input.completedAt, job.job_id);
      return this.storySyncJobDocument(this.requireStorySyncJob(job.job_id));
    })));
  }

  async failStorySyncAttempt(input: Readonly<{
    jobId: string;
    attemptId: string;
    code: string;
    message: string;
    completedAt: string;
  }>): Promise<StorySyncJobDocument> {
    return this.serializeLifecycle(() => this.serializeWrite(() => this.transaction(() => {
      const job = this.requireStorySyncJob(cleanIdentifier(input.jobId, 'Story Sync Job ID'));
      if (['cancelled', 'discarded', 'completed'].includes(job.status)) return this.storySyncJobDocument(job);
      this.#database.prepare(`
        UPDATE worker_attempts
        SET status = 'failed', termination = ?, completed_at = ?
        WHERE attempt_id = ? AND job_id = ? AND status = 'running'
      `).run(input.code.slice(0, 64), input.completedAt, input.attemptId, job.job_id);
      this.#database.prepare(`
        UPDATE worker_jobs
        SET status = 'failed', problem_code = ?, problem_message = ?, updated_at = ?
        WHERE job_id = ? AND status IN ('queued', 'waiting-for-lane', 'running', 'parsing', 'repairing')
      `).run(input.code.slice(0, 64), input.message.slice(0, 512), input.completedAt, job.job_id);
      return this.storySyncJobDocument(this.requireStorySyncJob(job.job_id));
    })));
  }

  async decideStorySyncProposal(
    proposalId: string,
    request: DecideStorySyncProposalRequest,
  ): Promise<StorySyncJobDocument> {
    return this.serializeLifecycle(() => this.serializeWrite(() => this.transaction(() => {
      const id = cleanIdentifier(proposalId, 'Story Sync Proposal ID');
      const proposal = this.#database.prepare('SELECT * FROM story_sync_proposals WHERE proposal_id = ?').get(id) as ProposalRow | undefined;
      if (!proposal) throw new CampaignExpectedError('STORY_SYNC_PROPOSAL_NOT_FOUND', `Proposal ${id} was not found.`);
      const job = this.requireStorySyncJob(proposal.job_id);
      if (job.status !== 'ready-for-review') {
        throw new CampaignExpectedError('STORY_SYNC_REVIEW_LOCKED', `Proposal review is locked while Job ${job.job_id} is ${job.status}.`);
      }
      const result = this.#database.prepare(`
        UPDATE story_sync_proposals
        SET revision = revision + 1, decision = ?, draft_json = ?
        WHERE proposal_id = ? AND revision = ?
      `).run(request.decision, canonicalJson(request.draft), id, request.expectedRevision);
      if (Number(result.changes) !== 1) {
        throw new CampaignExpectedError(
          'STORY_SYNC_PROPOSAL_REVISION_CONFLICT',
          'The Proposal changed in another tab. Reload the Review Inbox; your local draft was not applied.',
          { proposalId: id },
        );
      }
      this.#database.prepare('UPDATE worker_jobs SET updated_at = ? WHERE job_id = ?')
        .run(new Date().toISOString(), job.job_id);
      return this.storySyncJobDocument(this.requireStorySyncJob(job.job_id));
    })));
  }

  async cancelStorySyncJob(jobId: string, cancelledAt: string): Promise<StorySyncJobDocument> {
    return this.serializeLifecycle(() => this.serializeWrite(() => this.transaction(() => {
      const job = this.requireStorySyncJob(cleanIdentifier(jobId, 'Story Sync Job ID'));
      if (job.status === 'cancelled') return this.storySyncJobDocument(job);
      if (!['queued', 'waiting-for-lane', 'running', 'parsing', 'repairing'].includes(job.status)) {
        throw new CampaignExpectedError('STORY_SYNC_REVIEW_LOCKED', `Story Sync Job ${job.job_id} cannot stop from ${job.status}.`);
      }
      this.#database.prepare(`
        UPDATE worker_attempts
        SET status = 'cancelled', termination = 'user-cancelled', completed_at = ?
        WHERE job_id = ? AND status = 'running'
      `).run(cancelledAt, job.job_id);
      this.#database.prepare(`
        UPDATE worker_jobs
        SET status = 'cancelled', problem_code = 'STORY_SYNC_CANCELLED',
            problem_message = 'Story Sync was stopped. Resume or discard this job.', updated_at = ?
        WHERE job_id = ?
      `).run(cancelledAt, job.job_id);
      return this.storySyncJobDocument(this.requireStorySyncJob(job.job_id));
    })));
  }

  async prepareStorySyncResume(jobId: string, resumedAt: string): Promise<StorySyncJobDocument> {
    return this.serializeLifecycle(() => this.serializeWrite(() => this.transaction(() => {
      const job = this.requireStorySyncJob(cleanIdentifier(jobId, 'Story Sync Job ID'));
      if (!['cancelled', 'interrupted', 'failed'].includes(job.status)) {
        throw new CampaignExpectedError('STORY_SYNC_REVIEW_LOCKED', `Story Sync Job ${job.job_id} cannot resume from ${job.status}.`);
      }
      if (Boolean(job.source_content_pruned)) {
        throw new CampaignExpectedError('STORY_SYNC_SOURCE_PROOF_MISMATCH', 'This Story Sync source was already pruned and cannot be resumed.');
      }
      this.#database.prepare(`
        UPDATE worker_jobs
        SET status = 'queued', problem_code = NULL, problem_message = NULL, updated_at = ?
        WHERE job_id = ?
      `).run(resumedAt, job.job_id);
      return this.storySyncJobDocument(this.requireStorySyncJob(job.job_id));
    })));
  }

  async discardStorySyncJob(jobId: string, discardedAt: string): Promise<StorySyncJobDocument> {
    return this.serializeLifecycle(() => this.serializeWrite(() => this.transaction(() => {
      const job = this.requireStorySyncJob(cleanIdentifier(jobId, 'Story Sync Job ID'));
      if (job.status === 'discarded') return this.storySyncJobDocument(job);
      if (job.status === 'completed') {
        throw new CampaignExpectedError('STORY_SYNC_REVIEW_LOCKED', 'A completed Story Sync review is immutable and cannot be discarded.');
      }
      this.#database.prepare(`
        UPDATE worker_attempts
        SET status = 'cancelled', termination = 'job-discarded', completed_at = ?
        WHERE job_id = ? AND status = 'running'
      `).run(discardedAt, job.job_id);
      this.#database.prepare('DELETE FROM story_sync_proposals WHERE job_id = ?').run(job.job_id);
      const source = parseJson<StoredStorySyncSource>(job.source_json);
      this.#database.prepare(`
        UPDATE worker_jobs
        SET status = 'discarded', source_json = ?, source_content_pruned = 1,
            problem_code = NULL, problem_message = NULL, updated_at = ?
        WHERE job_id = ?
      `).run(canonicalJson({ ...source, messages: [] }), discardedAt, job.job_id);
      return this.storySyncJobDocument(this.requireStorySyncJob(job.job_id));
    })));
  }

  async readAuthority(request: PreflightContextRequest): Promise<ContextAuthority> {
    return this.serializeLifecycle(() => {
      const bindingId = cleanIdentifier(request.bindingId, 'Binding ID');
      const binding = this.findBindingById(bindingId);
      if (!binding) {
        throw new CampaignExpectedError('CHAT_BINDING_NOT_FOUND', `Chat Binding ${bindingId} was not found.`, { bindingId });
      }
      const profileId = cleanIdentifier(request.modelProfileId, 'Narrator model profile ID');
      const profileRow = this.#database.prepare(`
        SELECT profile_json FROM narrator_model_profiles WHERE profile_id = ?
      `).get(profileId) as { profile_json: string } | undefined;
      if (!profileRow) {
        throw new CampaignExpectedError(
          'CONTEXT_MODEL_PROFILE_MISSING',
          `Narrator model profile ${profileId} was not found.`,
          { profileId },
        );
      }
      return {
        campaign: asDocument(this.reconstruct(cleanIdentifier(request.campaignId, 'Campaign ID'), request.campaignRevision)),
        binding: bindingDocument(binding),
        profile: parseJson<NarratorModelProfile>(profileRow.profile_json),
      };
    }, { allowMaintenanceFailure: true });
  }

  async search(request: Readonly<{
    campaignId: string;
    campaignRevision: number;
    query: string;
    limit: number;
  }>): Promise<readonly ContextSearchHit[]> {
    return this.serializeLifecycle(() => {
      const terms = significantSearchTerms(request.query);
      if (terms.length === 0) return [];
      const ftsQuery = terms.map(term => `"${term.replaceAll('"', '""')}"`).join(' OR ');
      const rows = this.#database.prepare(`
        SELECT record_id, name, aliases, summary, bm25(context_search_fts) AS rank
        FROM context_search_fts
        WHERE campaign_id = ? AND campaign_revision = ? AND context_search_fts MATCH ?
        ORDER BY rank ASC, name ASC, record_id ASC
        LIMIT ?
      `).all(
        cleanIdentifier(request.campaignId, 'Campaign ID'),
        request.campaignRevision,
        ftsQuery,
        Math.max(1, Math.min(64, Math.trunc(request.limit))),
      ) as Array<{ record_id: string; name: string; aliases: string; summary: string; rank: number }>;
      return rows.map(row => {
        const indexedTerms = new Set(normalizeSearchText(`${row.name} ${row.aliases} ${row.summary}`).split(' '));
        return {
          recordId: row.record_id,
          rank: Number(row.rank),
          matchedTerms: terms.filter(term => indexedTerms.has(term)).length,
        };
      });
    }, { allowMaintenanceFailure: true });
  }

  transact<T>(
    work: (transaction: CampaignJournalTransaction) => CampaignJournalTransactionCompletion<T>,
  ): Promise<T> {
    return this.serializeLifecycle(async () => {
      const completion = await this.serializeWrite(() => {
        const started = performance.now();
        let accepted: CampaignJournalAppend | undefined;
        const transaction: CampaignJournalTransaction = {
          findReceipt: requestId => this.findReceipt(requestId),
          findHead: campaignId => this.findHead(campaignId),
          findStorySyncFinalization: jobId => this.findStorySyncFinalization(jobId),
          completeStorySyncFinalization: input => this.completeStorySyncFinalization(input),
          append: input => {
            if (accepted) throw new Error('A Campaign Journal transaction may append only one accepted Event.');
            this.persistAppend(input);
            accepted = input;
          },
        };
        const result = this.transaction(() => work(transaction));
        if (accepted) {
          this.recordCommitDuration(started);
          if (accepted.kind === 'revision' && accepted.commit.revision % this.snapshotInterval === 0) {
            this.queueSnapshot(accepted.commit.campaignId, accepted.commit.revision);
          }
        }
        return result;
      });
      if (completion.kind === 'complete') return completion.value;
      const value = await this.performRead(completion.request);
      return completion.project(value);
    });
  }

  verify(): Promise<CampaignVerificationResult> {
    return this.serializeLifecycle(
      () => verifyCampaignAuthorityInWorker(this.databasePath),
      { allowMaintenanceFailure: true },
    );
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
      ? readCurrentCampaignState(this.#database, this.requireCampaign(id))
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

  verifyOrThrow(): void {
    verifyCampaignDatabase(this.#database);
  }

  async backup(request: CampaignJournalBackupRequest): Promise<CampaignJournalBackupResult> {
    return { destinationPath: await this.backupTo(request.destinationPath) };
  }

  verifyBackup(request: CampaignJournalVerifyBackupRequest): Promise<CampaignVerificationResult> {
    return verifyCampaignAuthorityInWorker(resolve(request.sourcePath));
  }

  restore(request: CampaignJournalRestoreRequest): Promise<void> {
    return this.restoreFrom(request.sourcePath);
  }

  async backupTo(destinationPath: string): Promise<string> {
    return this.serializeLifecycle(async () => {
      await this.drainMaintenance();
      return this.serializeWrite(async () => {
        const destination = resolve(destinationPath);
        if (destination === this.databasePath) throw new Error('Campaign backup destination must differ from the active database.');
        await mkdir(dirname(destination), { recursive: true });
        await this.removeDatabaseArtifacts(destination);
        await backup(this.#database, destination);
        await verifyCampaignAuthorityInWorker(destination);
        return destination;
      });
    });
  }

  async restoreFrom(sourcePath: string): Promise<void> {
    return this.serializeLifecycle(async () => {
      await this.drainMaintenance();
      return this.serializeWrite(async () => {
        const source = resolve(sourcePath);
        if (source === this.databasePath) throw new Error('Campaign restore source must differ from the active database.');
        const safety = `${this.databasePath}.before-restore`;
        const staged = `${this.databasePath}.restore`;
        let preserveSafety = false;
        await this.removeDatabaseArtifacts(safety);
        await this.removeDatabaseArtifacts(staged);

        try {
          await verifyCampaignAuthorityInWorker(source);
          const sourceDatabase = new DatabaseSync(source, { readOnly: true });
          try {
            await backup(sourceDatabase, staged);
          } finally {
            sourceDatabase.close();
          }
          await verifyCampaignAuthorityInWorker(staged);

          await backup(this.#database, safety);
          try {
            await this.#beforeRestoreActivation?.();
            this.inject('restore.after-safety-backup');
            this.closeDatabase();
            await this.removeDatabaseArtifacts(this.databasePath);
            this.inject('restore.after-target-remove');
            await rename(staged, this.databasePath);
            this.inject('restore.after-swap');
            this.openDatabase();
            await this.migrate();
            this.rotateStoreEpoch();
            await verifyCampaignAuthorityInWorker(this.databasePath);
          } catch (error) {
            let recoveryError: unknown;
            try {
              this.closeDatabase();
              await this.removeDatabaseArtifacts(this.databasePath);
              await copyFile(safety, this.databasePath);
              this.openDatabase();
              await verifyCampaignAuthorityInWorker(this.databasePath);
            } catch (caught) {
              recoveryError = caught;
            }
            if (recoveryError !== undefined) {
              preserveSafety = true;
              throw new AggregateError(
                [error, recoveryError],
                `Campaign restore failed and the previous authority could not be recovered safely. Preserve and inspect ${safety}.`,
              );
            }
            throw error;
          }
        } finally {
          await this.removeDatabaseArtifacts(staged);
          if (!preserveSafety) await this.removeDatabaseArtifacts(safety);
        }
      });
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

  private async migrate(): Promise<void> {
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);
    const migrations = [
      { ...CAMPAIGN_AUTHORITY_MIGRATION, checksum: campaignMigrationChecksum() },
      { ...CAMPAIGN_SUBJECT_EVENTS_MIGRATION, checksum: campaignSubjectEventsMigrationChecksum() },
      { ...CAMPAIGN_CURRENT_PROJECTIONS_MIGRATION, checksum: campaignCurrentProjectionsMigrationChecksum() },
      { ...CHAT_BINDINGS_MIGRATION, checksum: chatBindingsMigrationChecksum() },
      { ...CONTEXT_PLANNING_MIGRATION, checksum: contextPlanningMigrationChecksum() },
      { ...STORY_SYNC_JOBS_MIGRATION, checksum: storySyncJobsMigrationChecksum() },
      { ...STORY_SYNC_FINALIZATION_MIGRATION, checksum: storySyncFinalizationMigrationChecksum() },
      { ...CAMPAIGN_ABILITIES_MIGRATION, checksum: campaignAbilitiesMigrationChecksum() },
      { ...CAMPAIGN_RELATIONSHIPS_MIGRATION, checksum: campaignRelationshipsMigrationChecksum() },
      { ...CAMPAIGN_WORLD_RECORDS_MIGRATION, checksum: campaignWorldRecordsMigrationChecksum() },
    ];
    const appliedRows = this.#database.prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version').all() as Array<{ version: number; name: string; checksum: string }>;
    const applied = new Map(appliedRows.map(row => [Number(row.version), row]));
    const knownVersions = new Set<number>(migrations.map(migration => migration.version));
    const unknown = appliedRows.find(row => !knownVersions.has(Number(row.version)));
    if (unknown) throw new Error(`Campaign database schema ${unknown.version} is newer than this companion supports.`);
    for (const migration of migrations) {
      const found = applied.get(migration.version);
      if (found && (found.name !== migration.name || found.checksum !== migration.checksum)) {
        throw new Error(`Campaign migration ${migration.version} checksum mismatch.`);
      }
    }
    const pending = migrations.filter(migration => !applied.has(migration.version));
    if (pending.length > 0 && applied.size > 0) await this.backupBeforeMigration(pending[0]!.version);
    for (const migration of pending) {
      this.transaction(() => {
        this.#database.exec(migration.source);
        if (migration.version === CAMPAIGN_AUTHORITY_MIGRATION.version) {
          this.#database.prepare('INSERT INTO store_meta(singleton, store_epoch) VALUES (1, ?)').run(randomUUID());
        }
        if (migration.version === CAMPAIGN_SUBJECT_EVENTS_MIGRATION.version) this.backfillCampaignBases();
        if (migration.version === CAMPAIGN_CURRENT_PROJECTIONS_MIGRATION.version) this.backfillCurrentCampaignProjections();
        if (migration.version === CONTEXT_PLANNING_MIGRATION.version) this.backfillContextSearchDocuments();
        this.#database.prepare('INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (?, ?, ?, ?)')
          .run(migration.version, migration.name, migration.checksum, new Date().toISOString());
      });
    }
    const interruptedAt = new Date().toISOString();
    this.transaction(() => {
      this.#database.prepare(`
        UPDATE worker_attempts
        SET status = 'interrupted', termination = 'host-restarted', completed_at = ?
        WHERE status = 'running'
      `).run(interruptedAt);
      this.#database.prepare(`
        UPDATE worker_jobs
        SET status = 'interrupted', problem_code = 'STORY_SYNC_INTERRUPTED',
            problem_message = 'The companion restarted during Story Sync. Resume or discard this job.', updated_at = ?
        WHERE status IN ('waiting-for-lane', 'running', 'parsing', 'repairing')
      `).run(interruptedAt);
    });
  }

  private reconstruct(campaignId: string, revision: number): CampaignState {
    const campaign = this.requireCampaign(campaignId);
    if (!Number.isInteger(revision) || revision < 1 || revision > Number(campaign.current_revision)) {
      throw new CampaignExpectedError('CAMPAIGN_REVISION_NOT_FOUND', `Campaign revision ${revision} was not found.`, { campaignId, revision, currentRevision: Number(campaign.current_revision) });
    }
    verifyCampaignDatabase(this.#database);
    return reconstructCampaignState(this.#database, campaignId, revision);
  }

  private requireCampaign(campaignId: string): CampaignRow {
    const row = this.#database.prepare('SELECT * FROM campaigns WHERE campaign_id = ?').get(campaignId) as CampaignRow | undefined;
    if (!row) throw new CampaignExpectedError('CAMPAIGN_NOT_FOUND', `Campaign ${campaignId} was not found.`, { campaignId });
    return row;
  }

  private requireWorkerProfile(profileId: string): WorkerProfileRow {
    const row = this.#database.prepare('SELECT * FROM worker_model_profiles WHERE profile_id = ?')
      .get(profileId) as WorkerProfileRow | undefined;
    if (!row) {
      throw new CampaignExpectedError(
        'STORY_SYNC_WORKER_MODEL_UNAVAILABLE',
        `Worker model profile ${profileId} was not found.`,
        { profileId },
      );
    }
    return row;
  }

  private requireStorySyncJob(jobId: string): WorkerJobRow {
    const row = this.#database.prepare('SELECT * FROM worker_jobs WHERE job_id = ?').get(jobId) as WorkerJobRow | undefined;
    if (!row) throw new CampaignExpectedError('STORY_SYNC_JOB_NOT_FOUND', `Story Sync Job ${jobId} was not found.`, { jobId });
    return row;
  }

  private storySyncJobDocument(row: WorkerJobRow): StorySyncJobDocument {
    const proposals = this.#database.prepare(`
      SELECT * FROM story_sync_proposals WHERE job_id = ? ORDER BY ordinal, proposal_id
    `).all(row.job_id) as ProposalRow[];
    return {
      schema: 'st-rpg.story-sync-job',
      version: '1.0',
      id: row.job_id,
      campaignId: row.campaign_id,
      bindingId: row.binding_id,
      profileId: row.profile_id,
      status: row.status,
      campaignAnchor: Number(row.campaign_anchor),
      bindingRevision: Number(row.binding_revision),
      syncFacetRevision: Number(row.sync_facet_revision),
      source: {
        firstMessageIndex: Number(row.source_first_message_index),
        lastMessageIndex: Number(row.source_last_message_index),
        messageCount: Number(row.source_message_count),
        fingerprint: row.source_fingerprint,
        endPrefixHash: row.source_end_prefix_hash,
        contentPruned: Boolean(row.source_content_pruned),
      },
      attemptCount: Number(row.attempt_count),
      proposals: proposals.map(proposalDocument),
      ...(row.problem_code && row.problem_message
        ? { problem: { code: row.problem_code, message: row.problem_message } }
        : {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private async performRead<R extends CampaignJournalRead>(request: R): Promise<CampaignJournalReadResult<R>> {
    let result: CampaignDocument | CampaignSummary[] | CampaignHistoryEntry[] | CampaignCommitPerformance;
    if (request.kind === 'campaign-list') result = this.listCampaigns();
    else if (request.kind === 'campaign') {
      result = request.revision === undefined
        ? this.readCampaign(request.campaignId)
        : await this.#revisionReader(this.databasePath, request.campaignId, request.revision);
    } else if (request.kind === 'history') result = this.history(request.campaignId);
    else result = this.performance();
    return result as CampaignJournalReadResult<R>;
  }

  private findReceipt(requestId: string): CampaignJournalReceipt | undefined {
    const receipt = this.#database.prepare(
      'SELECT request_hash, outcome_json FROM request_receipts WHERE request_id = ?',
    ).get(requestId) as ReceiptRow | undefined;
    if (!receipt) return undefined;
    const stored = parseJson<CampaignCommit | StoredCommitReceipt>(receipt.outcome_json);
    if ('document' in stored) {
      const { document: _document, idempotent: _idempotent, ...commit } = stored;
      return { requestHash: receipt.request_hash, commit };
    }
    if (stored.receiptSchemaVersion !== 2) throw new Error('Campaign request receipt uses an unsupported schema.');
    const { receiptSchemaVersion: _receiptSchemaVersion, ...commit } = stored;
    return { requestHash: receipt.request_hash, commit };
  }

  private findBindingById(bindingId: string): ChatBindingRow | undefined {
    return this.#database.prepare('SELECT * FROM chat_bindings WHERE binding_id = ?').get(bindingId) as ChatBindingRow | undefined;
  }

  private findStorySyncFinalization(jobId: string): StorySyncFinalizationReview | undefined {
    const row = this.#database.prepare('SELECT * FROM worker_jobs WHERE job_id = ?')
      .get(cleanIdentifier(jobId, 'Story Sync Job ID')) as WorkerJobRow | undefined;
    if (!row) return undefined;
    const binding = this.findBindingById(row.binding_id);
    if (!binding) throw new Error(`Story Sync Job ${row.job_id} lost Chat Binding ${row.binding_id}.`);
    const source = parseJson<StoredStorySyncSource>(row.source_json);
    const proposals = (this.#database.prepare(`
      SELECT * FROM story_sync_proposals WHERE job_id = ? ORDER BY ordinal, proposal_id
    `).all(row.job_id) as ProposalRow[]).map(proposalDocument);
    return {
      jobId: row.job_id,
      campaignId: row.campaign_id,
      bindingId: row.binding_id,
      status: row.status,
      campaignAnchor: Number(row.campaign_anchor),
      bindingRevision: Number(row.binding_revision),
      syncFacetRevision: Number(row.sync_facet_revision),
      sourceFirstMessageIndex: Number(row.source_first_message_index),
      sourceLastMessageIndex: Number(row.source_last_message_index),
      sourceEndPrefixHash: row.source_end_prefix_hash,
      sourceBoundary: source.boundary,
      binding: bindingDocument(binding),
      proposals,
      completedReceipt: this.completedStorySyncReceipt(row, true),
    };
  }

  private completedStorySyncReceipt(row: WorkerJobRow, idempotent: boolean): StorySyncFinalizationReceipt | null {
    if (
      row.status !== 'completed'
      || !row.binding_event_id
      || !row.completed_campaign_revision
      || !row.completed_binding_revision
      || !row.finalized_at
    ) return null;
    const proposals = (this.#database.prepare(`
      SELECT proposal_id, decision FROM story_sync_proposals WHERE job_id = ? ORDER BY ordinal, proposal_id
    `).all(row.job_id) as Array<{ proposal_id: string; decision: StorySyncProposal['decision'] }>);
    return {
      schema: 'st-rpg.story-sync-finalization-receipt',
      version: '1.0',
      jobId: row.job_id,
      campaignId: row.campaign_id,
      bindingId: row.binding_id,
      campaignRevision: Number(row.completed_campaign_revision),
      bindingRevision: Number(row.completed_binding_revision),
      acceptedProposalIds: proposals.filter(proposal => proposal.decision === 'accept').map(proposal => proposal.proposal_id),
      rejectedProposalIds: proposals.filter(proposal => proposal.decision === 'reject').map(proposal => proposal.proposal_id),
      ...(row.campaign_event_id ? { campaignEventId: row.campaign_event_id } : {}),
      bindingEventId: row.binding_event_id,
      completedAt: row.finalized_at,
      idempotent,
    };
  }

  private completeStorySyncFinalization(input: CompleteStorySyncFinalization): StorySyncFinalizationReceipt {
    const row = this.requireStorySyncJob(cleanIdentifier(input.jobId, 'Story Sync Job ID'));
    const completed = this.completedStorySyncReceipt(row, true);
    if (completed) {
      if (row.finalization_request_id !== input.requestId || row.decision_hash !== input.decisionHash) {
        throw new CampaignExpectedError('STORY_SYNC_FINALIZATION_STALE', 'This Story Sync review was already finalized with different decisions.');
      }
      return completed;
    }
    if (row.status !== 'ready-for-review') {
      throw new CampaignExpectedError('STORY_SYNC_REVIEW_LOCKED', `Story Sync Job ${row.job_id} cannot finalize from ${row.status}.`);
    }
    const proposals = this.#database.prepare(`
      SELECT * FROM story_sync_proposals WHERE job_id = ? ORDER BY ordinal, proposal_id
    `).all(row.job_id) as ProposalRow[];
    if (proposals.length !== input.proposalRevisions.length) {
      throw new CampaignExpectedError('STORY_SYNC_FINALIZATION_STALE', 'The Review Inbox changed before finalization. Reload it and review every Proposal again.');
    }
    for (let index = 0; index < proposals.length; index += 1) {
      const stored = proposals[index]!;
      const expected = input.proposalRevisions[index]!;
      if (
        stored.proposal_id !== expected.proposalId
        || Number(stored.revision) !== expected.expectedRevision
        || stored.decision !== expected.decision
      ) {
        throw new CampaignExpectedError('STORY_SYNC_FINALIZATION_STALE', 'A Proposal changed before finalization. Reload the Review Inbox; nothing was applied.');
      }
    }
    const binding = this.findBindingById(row.binding_id);
    if (!binding) throw new CampaignExpectedError('CHAT_BINDING_NOT_FOUND', `Chat Binding ${row.binding_id} was not found.`);
    const source = parseJson<StoredStorySyncSource>(row.source_json);
    if (
      Number(binding.binding_revision) !== input.expectedBindingRevision
      || Number(binding.sync_facet_revision) !== input.expectedSyncFacetRevision
      || Number(binding.sync_through_message_index) !== source.boundary.throughMessageIndex
      || binding.sync_prefix_hash !== source.boundary.prefixHash
    ) {
      throw new CampaignExpectedError('STORY_SYNC_FINALIZATION_STALE', 'The Chat Binding or Sync Boundary changed before finalization. Nothing was applied.');
    }
    const campaign = this.requireCampaign(row.campaign_id);
    if (Number(campaign.current_revision) !== input.campaignRevision) {
      throw new CampaignExpectedError('STORY_SYNC_FINALIZATION_STALE', 'Campaign authority did not reach the prepared Story Sync revision. Nothing was applied.');
    }
    const nextBindingRevision = input.expectedBindingRevision + 1;
    const nextSyncFacetRevision = input.expectedSyncFacetRevision + 1;
    const operation = {
      kind: 'set_sync_boundary', jobId: row.job_id,
      boundary: { throughMessageIndex: Number(row.source_last_message_index), prefixHash: row.source_end_prefix_hash },
      campaignAnchor: input.campaignRevision,
    };
    const updated = this.#database.prepare(`
      UPDATE chat_bindings
      SET binding_revision = ?, campaign_anchor = ?, sync_facet_revision = ?,
          sync_through_message_index = ?, sync_prefix_hash = ?, updated_at = ?
      WHERE binding_id = ? AND binding_revision = ? AND sync_facet_revision = ?
        AND campaign_anchor = ? AND sync_through_message_index = ? AND sync_prefix_hash = ?
    `).run(
      nextBindingRevision,
      input.campaignRevision,
      nextSyncFacetRevision,
      row.source_last_message_index,
      row.source_end_prefix_hash,
      input.completedAt,
      row.binding_id,
      input.expectedBindingRevision,
      input.expectedSyncFacetRevision,
      input.expectedCampaignRevision,
      source.boundary.throughMessageIndex,
      source.boundary.prefixHash,
    );
    if (Number(updated.changes) !== 1) {
      throw new CampaignExpectedError('STORY_SYNC_FINALIZATION_STALE', 'Chat Binding authority changed before finalization. Nothing was applied.');
    }
    this.#database.prepare(`
      INSERT INTO chat_binding_events(binding_id, revision, event_id, request_id, operation_kind, operation_json, accepted_at)
      VALUES (?, ?, ?, ?, 'set_sync_boundary', ?, ?)
    `).run(row.binding_id, nextBindingRevision, input.bindingEventId, input.requestId, canonicalJson(operation), input.completedAt);
    const prunedSource = { ...source, messages: [] };
    this.#database.prepare(`
      UPDATE worker_jobs
      SET status = 'completed', source_json = ?, source_content_pruned = 1,
          finalization_request_id = ?, decision_hash = ?, campaign_event_id = ?, binding_event_id = ?,
          completed_campaign_revision = ?, completed_binding_revision = ?, finalized_at = ?,
          problem_code = NULL, problem_message = NULL, updated_at = ?
      WHERE job_id = ? AND status = 'ready-for-review'
    `).run(
      canonicalJson(prunedSource), input.requestId, input.decisionHash, input.campaignEventId ?? null,
      input.bindingEventId, input.campaignRevision, nextBindingRevision, input.completedAt,
      input.completedAt, row.job_id,
    );
    return this.completedStorySyncReceipt(this.requireStorySyncJob(row.job_id), false)!;
  }

  private findBindingBySource(sourceFingerprint: string): ChatBindingRow | undefined {
    return this.#database.prepare('SELECT * FROM chat_bindings WHERE source_fingerprint = ?').get(sourceFingerprint) as ChatBindingRow | undefined;
  }

  private storedLegacyImport(row: ChatBindingRow): StoredLegacyImport {
    const campaign = this.requireCampaign(row.campaign_id);
    return {
      campaignId: row.campaign_id,
      campaignRevision: Number(campaign.current_revision),
      binding: bindingDocument(row),
    };
  }

  private persistLegacyBinding(input: {
    binding: ChatBindingDocument;
    locatorFingerprint: string;
    envelopeJson: string;
    legacyRevision: number;
    bindingEventId: string;
    requestId: string;
    bindingOperation: unknown;
  }): void {
    const binding = input.binding;
    this.persistBinding(input);
    this.#database.prepare(`
      INSERT INTO legacy_import_sources(
        source_fingerprint, content_fingerprint, locator_fingerprint, campaign_id,
        binding_id, legacy_revision, envelope_json, imported_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      binding.sourceFingerprint,
      binding.contentFingerprint,
      input.locatorFingerprint,
      binding.campaignId,
      binding.id,
      input.legacyRevision,
      input.envelopeJson,
      binding.createdAt,
    );
  }

  private persistBinding(input: {
    binding: ChatBindingDocument;
    locatorFingerprint: string;
    bindingEventId: string;
    requestId: string;
    bindingOperation: unknown;
  }): void {
    const binding = input.binding;
    this.#database.prepare(`
      INSERT INTO chat_bindings(
        binding_id, campaign_id, binding_revision, campaign_anchor, locator_json,
        locator_fingerprint, source_fingerprint, content_fingerprint,
        marker_state, marker_problem, context_focus_revision, pins_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      binding.id,
      binding.campaignId,
      binding.revision,
      binding.campaignAnchor,
      canonicalJson(binding.locator),
      input.locatorFingerprint,
      binding.sourceFingerprint,
      binding.contentFingerprint,
      binding.markerState,
      binding.markerProblem ?? null,
      binding.contextFocusRevision ?? 1,
      canonicalJson(binding.pins ?? []),
      binding.createdAt,
      binding.updatedAt,
    );
    this.#database.prepare(`
      INSERT INTO chat_binding_events(binding_id, revision, event_id, request_id, operation_kind, operation_json, accepted_at)
      VALUES (?, 1, ?, ?, 'create_chat_binding', ?, ?)
    `).run(binding.id, input.bindingEventId, input.requestId, canonicalJson(input.bindingOperation), binding.createdAt);
  }

  private findHead(campaignId: string): CampaignJournalHead | undefined {
    const row = this.#database.prepare('SELECT * FROM campaigns WHERE campaign_id = ?').get(campaignId) as CampaignRow | undefined;
    if (!row) return undefined;
    return {
      state: readCurrentCampaignState(this.#database, row),
      headEventHash: row.head_event_hash,
    };
  }

  private persistAppend(input: CampaignJournalAppend): void {
    const { commit } = input;
    if (input.kind === 'create') {
      this.#database.prepare(`
        INSERT INTO campaigns(campaign_id, title, status, current_revision, current_state_json, head_event_hash, created_at, updated_at)
        VALUES (?, ?, ?, 1, ?, ?, ?, ?)
      `).run(
        commit.campaignId,
        input.afterState.campaign.title,
        input.afterState.campaign.status,
        LEGACY_CURRENT_STATE_MARKER,
        input.eventHash,
        commit.committedAt,
        commit.committedAt,
      );
      this.insertBase(commit.campaignId, input.baseKind, input.baseState, commit.committedAt);
      this.insertSubjectEvent({
        campaignId: commit.campaignId,
        revision: commit.revision,
        eventId: commit.eventId,
        requestId: input.requestId,
        operationKind: commit.operationKind,
        operation: input.operation,
        changes: [],
        acceptedAt: commit.committedAt,
        previousEventHash: null,
        eventHash: input.eventHash,
      });
      this.inject('create.after-event');
      replaceCurrentCampaignProjections(this.#database, commit.campaignId, input.afterState);
    } else {
      const current = this.requireCampaign(commit.campaignId);
      this.insertSubjectEvent({
        campaignId: commit.campaignId,
        revision: commit.revision,
        eventId: commit.eventId,
        requestId: input.requestId,
        operationKind: commit.operationKind,
        operation: input.operation,
        changes: input.changes,
        acceptedAt: commit.committedAt,
        previousEventHash: current.head_event_hash,
        eventHash: input.eventHash,
      });
      this.inject('execute.after-event');
      applyCurrentCampaignProjectionChanges(this.#database, commit.campaignId, input.changes);
      this.#database.prepare(`
        UPDATE campaigns SET title = ?, status = ?, current_revision = ?, head_event_hash = ?, updated_at = ?
        WHERE campaign_id = ?
      `).run(
        input.afterState.campaign.title,
        input.afterState.campaign.status,
        commit.revision,
        input.eventHash,
        commit.committedAt,
        commit.campaignId,
      );
      this.inject('execute.after-projection');
    }
    this.replaceContextSearchDocuments(commit.campaignId, commit.revision, input.afterState);
    this.insertReceipt(input.requestId, input.requestHash, commit, commit.committedAt);
  }

  private insertReceipt(requestId: string, digest: string, commit: CampaignCommitReceipt, createdAt: string): void {
    const stored: StoredCommitReceipt = { receiptSchemaVersion: 2, ...commit };
    this.#database.prepare('INSERT INTO request_receipts(request_id, request_hash, campaign_id, outcome_json, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(requestId, digest, commit.campaignId, canonicalJson(stored), createdAt);
  }

  private insertBase(campaignId: string, baseKind: 'blank' | 'legacy_import', state: CampaignState, createdAt: string): void {
    this.#database.prepare(`
      INSERT INTO campaign_bases(campaign_id, base_kind, state_schema_version, state_json, state_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(campaignId, baseKind, STATE_SCHEMA_VERSION, canonicalJson(state), sha256(state), createdAt);
  }

  private insertSubjectEvent(input: {
    campaignId: string; revision: number; eventId: string; requestId: string; operationKind: string;
    operation: unknown; changes: readonly CampaignSubjectChange[]; acceptedAt: string;
    previousEventHash: string | null; eventHash: string;
  }): void {
    this.#database.prepare(`
      INSERT INTO campaign_events(campaign_id, revision, event_id, request_id, event_schema_version, operation_kind, operation_json, before_state_json, after_state_json, accepted_at, previous_event_hash, event_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(input.campaignId, input.revision, input.eventId, input.requestId, EVENT_SCHEMA_VERSION, input.operationKind, canonicalJson(input.operation), null, '{}', input.acceptedAt, input.previousEventHash, input.eventHash);
    const statement = this.#database.prepare(`
      INSERT INTO campaign_event_changes(
        event_id, ordinal, subject_kind, subject_id,
        before_schema_version, before_image_json, before_hash,
        after_schema_version, after_image_json, after_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    input.changes.forEach((change, ordinal) => {
      statement.run(
        input.eventId,
        ordinal,
        change.subjectKind,
        change.subjectId,
        change.beforeImage === null ? null : STATE_SCHEMA_VERSION,
        change.beforeImage === null ? null : canonicalJson(change.beforeImage),
        subjectImageHash(change.beforeImage),
        change.afterImage === null ? null : STATE_SCHEMA_VERSION,
        change.afterImage === null ? null : canonicalJson(change.afterImage),
        subjectImageHash(change.afterImage),
      );
    });
  }

  private backfillCampaignBases(): void {
    const rows = this.#database.prepare(`
      SELECT c.campaign_id, c.created_at, e.after_state_json
      FROM campaigns c
      JOIN campaign_events e ON e.campaign_id = c.campaign_id AND e.revision = 1
    `).all() as Array<{ campaign_id: string; created_at: string; after_state_json: string }>;
    for (const row of rows) {
      const state = parseJson<CampaignState>(row.after_state_json);
      this.insertBase(row.campaign_id, 'legacy_import', state, row.created_at);
    }
  }

  private backfillCurrentCampaignProjections(): void {
    const rows = this.#database.prepare('SELECT * FROM campaigns ORDER BY campaign_id').all() as CampaignRow[];
    const markMigrated = this.#database.prepare('UPDATE campaigns SET current_state_json = ? WHERE campaign_id = ?');
    for (const row of rows) {
      const state = normalizeCampaignState(parseJson<CampaignState>(row.current_state_json));
      replaceCurrentCampaignProjections(this.#database, row.campaign_id, state);
      markMigrated.run(LEGACY_CURRENT_STATE_MARKER, row.campaign_id);
    }
  }

  private async backupBeforeMigration(nextVersion: number): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const destination = `${this.databasePath}.pre-migration-v${nextVersion}-${timestamp}.sqlite`;
    await backup(this.#database, destination);
    await verifyCampaignAuthorityInWorker(destination);
  }

  private rotateStoreEpoch(): string {
    const epoch = randomUUID();
    this.transaction(() => {
      const result = this.#database.prepare('UPDATE store_meta SET store_epoch = ? WHERE singleton = 1').run(epoch);
      if (Number(result.changes) !== 1) throw new Error('Campaign authority could not rotate its Store Epoch.');
    });
    return epoch;
  }

  private insertSnapshot(candidate: CampaignSnapshotCandidate): void {
    const event = this.#database.prepare(`
      SELECT event_hash FROM campaign_events WHERE campaign_id = ? AND revision = ?
    `).get(candidate.campaignId, candidate.revision) as { event_hash: string } | undefined;
    if (!event || event.event_hash !== candidate.eventHash) {
      throw new Error(`Campaign ${candidate.campaignId} snapshot candidate lost its immutable revision anchor.`);
    }
    this.#database.prepare(`
      INSERT INTO campaign_snapshots(campaign_id, revision, schema_version, state_json, state_hash, event_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(campaign_id, revision) DO NOTHING
    `).run(
      candidate.campaignId,
      candidate.revision,
      STATE_SCHEMA_VERSION,
      candidate.stateJson,
      candidate.stateHash,
      candidate.eventHash,
      candidate.createdAt,
    );
  }

  private backfillContextSearchDocuments(): void {
    const rows = this.#database.prepare('SELECT campaign_id, current_revision FROM campaigns ORDER BY campaign_id').all() as
      Array<{ campaign_id: string; current_revision: number }>;
    for (const row of rows) {
      for (let revision = 1; revision <= Number(row.current_revision); revision += 1) {
        this.replaceContextSearchDocuments(
          row.campaign_id,
          revision,
          reconstructCampaignState(this.#database, row.campaign_id, revision),
        );
      }
    }
  }

  private replaceContextSearchDocuments(campaignId: string, revision: number, state: CampaignState): void {
    this.#database.prepare(`
      DELETE FROM context_search_fts WHERE campaign_id = ? AND campaign_revision = ?
    `).run(campaignId, revision);
    const insert = this.#database.prepare(`
      INSERT INTO context_search_fts(
        campaign_id, campaign_revision, record_id, record_kind, name, aliases, summary
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const records = [
      ...Object.values(state.actors).map(record => ({ kind: 'actor', record })),
      ...Object.values(state.items).map(record => ({ kind: 'item', record })),
      ...Object.values(state.quests ?? {}).map(record => ({ kind: 'quest', record })),
      ...Object.values(state.places ?? {}).map(record => ({ kind: 'place', record })),
      ...Object.values(state.facts ?? {}).map(record => ({ kind: 'fact', record })),
      ...Object.values(state.worldObjects ?? {}).map(record => ({ kind: 'world_object', record })),
      ...Object.values(state.abilities ?? {}).map(record => ({ kind: 'ability', record })),
      ...Object.values(state.relationships ?? {}).map(relationship => {
        const source = state.actors[relationship.sourceActorId];
        const target = state.actors[relationship.targetActorId];
        return {
          kind: 'relationship',
          record: {
            id: relationship.id,
            name: `${source?.name ?? relationship.sourceActorId} → ${target?.name ?? relationship.targetActorId}`,
            aliases: [] as string[],
            summary: `${relationship.kind} ${relationship.status} ${relationship.notes}`.trim(),
            visibility: relationship.visibility,
            archived: relationship.archived || Boolean(source?.archived) || Boolean(target?.archived),
          },
        };
      }),
    ].sort((left, right) => left.record.name.localeCompare(right.record.name) || left.record.id.localeCompare(right.record.id));
    for (const { kind, record } of records) {
      if (record.archived || record.visibility === 'campaign_private') continue;
      insert.run(
        campaignId,
        revision,
        record.id,
        kind,
        record.name,
        (record.aliases ?? []).join(' '),
        record.summary,
      );
    }
  }

  private queueSnapshot(campaignId: string, revision: number): void {
    this.#maintenancePending += 1;
    const task = this.#maintenanceTail.then(async () => {
      const candidate = await this.#snapshotBuilder(this.databasePath, campaignId, revision);
      await this.serializeWrite(() => this.insertSnapshot(candidate));
    });
    this.#maintenanceTail = task.then(
      () => {
        this.#maintenancePending -= 1;
      },
      error => {
        this.#maintenancePending -= 1;
        this.#maintenanceFailure ??= error instanceof Error ? error : new Error(String(error));
      },
    );
  }

  private async drainMaintenance(): Promise<void> {
    await this.#maintenanceTail;
    if (this.#maintenanceFailure) {
      throw new Error(`Campaign snapshot maintenance failed: ${this.#maintenanceFailure.message}`);
    }
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

  private serializeLifecycle<T>(
    work: () => T | Promise<T>,
    options: Readonly<{ allowMaintenanceFailure?: boolean }> = {},
  ): Promise<T> {
    if (this.#lifecycleState !== 'open') {
      return Promise.reject(new Error(`Campaign Journal is ${this.#lifecycleState}.`));
    }
    const guardedWork = () => {
      if (this.#maintenanceFailure && !options.allowMaintenanceFailure) {
        throw new Error(`Campaign snapshot maintenance failed: ${this.#maintenanceFailure.message}`);
      }
      return work();
    };
    const run = this.#lifecycleTail.then(guardedWork, guardedWork);
    this.#lifecycleTail = run.then(() => undefined, () => undefined);
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
