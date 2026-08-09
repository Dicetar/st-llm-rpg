import { randomUUID } from 'node:crypto';
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
import { makeProblem } from '../../problem.js';
import { CampaignExpectedError } from './campaign-error.js';
import type {
  CampaignCommitReceipt,
  CampaignJournal,
  CampaignJournalTransaction,
} from './campaign-journal.js';
import {
  completeJournalTransaction,
  readAfterJournalTransaction,
} from './campaign-journal.js';
import {
  applyOperation,
  asDocument,
  cleanIdentifier,
  cleanText,
  normalizeCampaignDocument,
  sha256,
  subjectChangesForOperation,
  subjectEventHash,
  type CampaignState,
} from './campaign-state.js';

export type Outcome<T> =
  | { ok: true; value: T }
  | { ok: false; problem: Problem };

export type CampaignRevisionListener = (revision: number) => void;

function asReceipt(commit: CampaignCommit): CampaignCommitReceipt {
  const { document: _document, idempotent: _idempotent, ...receipt } = commit;
  return receipt;
}

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
  readonly #journal: CampaignJournal;
  readonly #revisionListeners = new Map<string, Set<CampaignRevisionListener>>();

  constructor(journal: CampaignJournal) {
    this.#journal = journal;
  }

  async close(): Promise<void> {
    this.#revisionListeners.clear();
    await this.#journal.close();
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
    const observation = this.#journal.observation();
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
    return this.capture(requestId, () => this.#journal.readAt({ kind: 'campaign-list' }));
  }

  async create(request: CreateCampaignRequest): Promise<Outcome<CampaignCommit>> {
    const outcome = normalizeCommitOutcome(
      await this.capture(request.requestId, async () => {
        const requestId = cleanIdentifier(request.requestId, 'Request ID');
        const title = cleanText(request.title, 'Campaign title', 160);
        const requestHash = sha256({ kind: 'create_campaign', title });
        return this.#journal.transact(transaction => {
          const receipt = this.acceptReceipt(transaction, requestId, requestHash);
          if (receipt) {
            return readAfterJournalTransaction({
              kind: 'campaign',
              campaignId: receipt.campaignId,
              revision: receipt.revision,
            }, document => ({ ...receipt, idempotent: true, document }));
          }

          const campaignId = randomUUID();
          const eventId = randomUUID();
          const committedAt = new Date().toISOString();
          const summary: CampaignSummary = {
            id: campaignId,
            title,
            status: 'active',
            revision: 1,
            createdAt: committedAt,
            updatedAt: committedAt,
          };
          const state: CampaignState = {
            campaign: summary,
            actors: {},
            items: {},
            quests: {},
            places: {},
            currentScene: null,
          };
          const baseState: CampaignState = {
            ...structuredClone(state),
            campaign: { ...summary, revision: 0 },
          };
          const operation = { kind: 'create_campaign', title };
          const eventHash = subjectEventHash({
            campaignId,
            revision: 1,
            eventId,
            requestId,
            operationKind: operation.kind,
            operation,
            acceptedAt: committedAt,
            previousEventHash: null,
            baseStateHash: sha256(baseState),
            changes: [],
          });
          const commit: CampaignCommit = {
            campaignId,
            revision: 1,
            eventId,
            requestId,
            operationKind: operation.kind,
            affectedIds: [campaignId],
            committedAt,
            idempotent: false,
            document: asDocument(state),
          };
          transaction.append({
            kind: 'create',
            baseKind: 'blank',
            requestId,
            requestHash,
            operation,
            baseState,
            afterState: state,
            eventHash,
            commit: asReceipt(commit),
          });
          return completeJournalTransaction(commit);
        });
      }),
    );
    this.publishCommit(outcome);
    return outcome;
  }

  async read(campaignId: string, requestId: string, revision?: number): Promise<Outcome<CampaignDocument>> {
    return this.capture(requestId, () => this.#journal.readAt({
      kind: 'campaign',
      campaignId,
      ...(revision === undefined ? {} : { revision }),
    }));
  }

  async history(campaignId: string, requestId: string): Promise<Outcome<CampaignHistoryEntry[]>> {
    return this.capture(requestId, () => this.#journal.readAt({ kind: 'history', campaignId }));
  }

  async execute(campaignId: string, request: ExecuteCampaignRequest): Promise<Outcome<CampaignCommit>> {
    const outcome = normalizeCommitOutcome(
      await this.capture(request.requestId, async () => {
        const id = cleanIdentifier(campaignId, 'Campaign ID');
        const requestId = cleanIdentifier(request.requestId, 'Request ID');
        const requestHash = sha256({ campaignId: id, expectedRevision: request.expectedRevision, operation: request.operation });
        return this.#journal.transact(transaction => {
          const receipt = this.acceptReceipt(transaction, requestId, requestHash);
          if (receipt) {
            return readAfterJournalTransaction({
              kind: 'campaign',
              campaignId: receipt.campaignId,
              revision: receipt.revision,
            }, document => ({ ...receipt, idempotent: true, document }));
          }

          const head = transaction.findHead(id);
          if (!head) {
            throw new CampaignExpectedError('CAMPAIGN_NOT_FOUND', `Campaign ${id} was not found.`, { campaignId: id });
          }
          const beforeState = head.state;
          if (beforeState.campaign.revision !== request.expectedRevision) {
            throw new CampaignExpectedError(
              'CAMPAIGN_REVISION_CONFLICT',
              `Campaign changed from revision ${request.expectedRevision} to ${beforeState.campaign.revision}. Reload before retrying.`,
              { campaignId: id, expectedRevision: request.expectedRevision, actualRevision: beforeState.campaign.revision },
            );
          }

          const afterState = structuredClone(beforeState);
          const affectedIds = applyOperation(afterState, request.operation);
          const changes = subjectChangesForOperation(beforeState, afterState, request.operation, affectedIds);
          const revision = beforeState.campaign.revision + 1;
          const committedAt = new Date().toISOString();
          afterState.campaign = { ...afterState.campaign, revision, updatedAt: committedAt };
          const eventId = randomUUID();
          const eventHash = subjectEventHash({
            campaignId: id,
            revision,
            eventId,
            requestId,
            operationKind: request.operation.kind,
            operation: request.operation,
            acceptedAt: committedAt,
            previousEventHash: head.headEventHash,
            baseStateHash: null,
            changes,
          });
          const commit: CampaignCommit = {
            campaignId: id,
            revision,
            eventId,
            requestId,
            operationKind: request.operation.kind,
            affectedIds,
            committedAt,
            idempotent: false,
            document: asDocument(afterState),
          };
          transaction.append({
            kind: 'revision',
            requestId,
            requestHash,
            operation: request.operation,
            changes,
            afterState,
            eventHash,
            commit: asReceipt(commit),
          });
          return completeJournalTransaction(commit);
        });
      }),
    );
    this.publishCommit(outcome);
    return outcome;
  }

  async performance(requestId: string): Promise<Outcome<CampaignCommitPerformance>> {
    return this.capture(requestId, () => this.#journal.readAt({ kind: 'performance' }));
  }

  async verify(requestId: string): Promise<Outcome<CampaignVerificationResult>> {
    return this.capture(requestId, () => this.#journal.verify());
  }

  private acceptReceipt(
    transaction: CampaignJournalTransaction,
    requestId: string,
    requestHash: string,
  ): CampaignCommitReceipt | undefined {
    const receipt = transaction.findReceipt(requestId);
    if (!receipt) return undefined;
    if (receipt.requestHash !== requestHash) {
      throw new CampaignExpectedError(
        'CAMPAIGN_REQUEST_CONFLICT',
        'Request ID was already used for different Campaign work.',
      );
    }
    return receipt.commit;
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
