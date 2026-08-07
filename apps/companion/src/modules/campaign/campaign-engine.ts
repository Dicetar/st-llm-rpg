import type {
  CampaignCommit,
  CampaignCommitPerformance,
  CampaignDocument,
  CampaignHistoryEntry,
  CampaignSummary,
  CampaignVerificationResult,
  CreateCampaignRequest,
  ExecuteCampaignRequest,
  Problem,
  RecoveryAction,
} from '@st-llm-rpg/wire';
import type { ComponentObservation } from '@st-llm-rpg/wire';
import { SqliteCampaignJournal } from '../../adapters/sqlite/campaign-journal.js';
import {
  readCampaignRevisionInWorker,
  verifyCampaignAuthorityInWorker,
} from '../../adapters/sqlite/campaign-maintenance.js';
import { makeProblem } from '../../problem.js';
import { CampaignExpectedError } from './campaign-error.js';
import { normalizeCampaignDocument } from './campaign-state.js';

export type Outcome<T> =
  | { ok: true; value: T }
  | { ok: false; problem: Problem; statusCode: number };

export type CampaignRevisionListener = (revision: number) => void;

function actionsFor(error: CampaignExpectedError): readonly RecoveryAction[] {
  if (error.code === 'CAMPAIGN_REVISION_CONFLICT') {
    return [{ id: 'reload', label: 'Reload the Campaign and review your edit', kind: 'retry' }];
  }
  if (error.code === 'CAMPAIGN_REQUEST_CONFLICT') {
    return [{ id: 'new-request', label: 'Retry with a new request ID', kind: 'retry' }];
  }
  if (error.code === 'CAMPAIGN_HISTORY_CORRUPT' || error.code === 'CAMPAIGN_STORE_UNAVAILABLE') {
    return [{ id: 'inspect-terminal', label: 'Inspect the companion terminal and restore a verified backup', kind: 'inspect' }];
  }
  return [];
}

function normalizeCommitOutcome(outcome: Outcome<CampaignCommit>): Outcome<CampaignCommit> {
  if (!outcome.ok) return outcome;
  return {
    ok: true,
    value: {
      ...outcome.value,
      document: normalizeCampaignDocument(outcome.value.document),
    },
  };
}

export class CampaignEngine {
  readonly journal: SqliteCampaignJournal;
  readonly #revisionListeners = new Map<string, Set<CampaignRevisionListener>>();

  private constructor(journal: SqliteCampaignJournal) {
    this.journal = journal;
  }

  static async open(databasePath: string, snapshotInterval: number): Promise<CampaignEngine> {
    return new CampaignEngine(await SqliteCampaignJournal.open(databasePath, snapshotInterval));
  }

  close(): void {
    this.#revisionListeners.clear();
    this.journal.close();
  }

  subscribe(campaignId: string, listener: CampaignRevisionListener): () => void {
    const listeners = this.#revisionListeners.get(campaignId) ?? new Set<CampaignRevisionListener>();
    listeners.add(listener);
    this.#revisionListeners.set(campaignId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.#revisionListeners.delete(campaignId);
    };
  }

  observation(): ComponentObservation {
    const observation = this.journal.observation();
    return {
      id: 'sqlite-runtime',
      status: observation.ready ? 'ready' : 'unavailable',
      blocking: true,
      message: observation.message,
      observedAt: new Date().toISOString(),
      latencyMs: observation.latencyMs,
    };
  }

  async list(requestId: string): Promise<Outcome<CampaignSummary[]>> {
    return this.capture(requestId, () => this.journal.listCampaigns());
  }

  async create(request: CreateCampaignRequest): Promise<Outcome<CampaignCommit>> {
    const outcome = normalizeCommitOutcome(
      await this.capture(request.requestId, () => this.journal.createCampaign(request)),
    );
    this.publishCommit(outcome);
    return outcome;
  }

  async read(campaignId: string, requestId: string, revision?: number): Promise<Outcome<CampaignDocument>> {
    return this.capture(requestId, () => revision === undefined
      ? this.journal.readCampaign(campaignId)
      : readCampaignRevisionInWorker(this.journal.databasePath, campaignId, revision));
  }

  async history(campaignId: string, requestId: string): Promise<Outcome<CampaignHistoryEntry[]>> {
    return this.capture(requestId, () => this.journal.history(campaignId));
  }

  async execute(campaignId: string, request: ExecuteCampaignRequest): Promise<Outcome<CampaignCommit>> {
    const outcome = normalizeCommitOutcome(
      await this.capture(request.requestId, () => this.journal.execute(campaignId, request)),
    );
    this.publishCommit(outcome);
    return outcome;
  }

  async performance(requestId: string): Promise<Outcome<CampaignCommitPerformance>> {
    return this.capture(requestId, () => this.journal.performance());
  }

  async verify(requestId: string): Promise<Outcome<CampaignVerificationResult>> {
    return this.capture(requestId, () => verifyCampaignAuthorityInWorker(this.journal.databasePath));
  }

  private publishCommit(outcome: Outcome<CampaignCommit>): void {
    if (!outcome.ok || outcome.value.idempotent) return;
    const listeners = this.#revisionListeners.get(outcome.value.campaignId);
    if (!listeners) return;
    for (const listener of [...listeners]) listener(outcome.value.revision);
  }

  private async capture<T>(requestId: string, work: () => T | Promise<T>): Promise<Outcome<T>> {
    try {
      return { ok: true, value: await work() };
    } catch (error) {
      if (error instanceof CampaignExpectedError) {
        return {
          ok: false,
          statusCode: error.statusCode,
          problem: makeProblem({
            code: error.code,
            message: error.message,
            requestId,
            actions: actionsFor(error),
            ...(error.details === undefined ? {} : { details: error.details }),
          }),
        };
      }
      return {
        ok: false,
        statusCode: 503,
        problem: makeProblem({
          code: 'CAMPAIGN_STORE_UNAVAILABLE',
          message: `Campaign authority could not complete the operation: ${error instanceof Error ? error.message : String(error)}`,
          requestId,
          actions: [{ id: 'inspect-terminal', label: 'Inspect the companion terminal before retrying', kind: 'inspect' }],
        }),
      };
    }
  }
}
