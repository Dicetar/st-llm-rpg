import { randomUUID } from 'node:crypto';
import type {
  CampaignCommit,
  CampaignCommitPerformance,
  CampaignDocument,
  CampaignHistoryEntry,
  CampaignOperation,
  CampaignSummary,
  CampaignVerificationResult,
  CreateCampaignRequest,
  ExecuteCampaignRequest,
  FinalizeStorySyncJobRequest,
  Problem,
  RecoveryAction,
  StorySyncFinalizationReceipt,
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

export type ApplyAddonBatchRequest = Readonly<{
  requestId: string;
  candidateId: string;
  manifestHash: string;
  expectedRevision: number;
  operations: readonly CampaignOperation[];
}>;

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
            facts: {},
            worldObjects: {},
            abilities: {},
            learnedAbilities: {},
            relationships: {},
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

  async finalizeStorySync(
    jobId: string,
    request: FinalizeStorySyncJobRequest,
  ): Promise<Outcome<StorySyncFinalizationReceipt>> {
    const outcome = await this.capture(`story-sync:${jobId}`, async () => this.#journal.transact(transaction => {
      if (!transaction.findStorySyncFinalization || !transaction.completeStorySyncFinalization) {
        throw new CampaignExpectedError('CAMPAIGN_STORE_UNAVAILABLE', 'Campaign authority does not support Story Sync finalization.');
      }
      const review = transaction.findStorySyncFinalization(cleanIdentifier(jobId, 'Story Sync Job ID'));
      if (!review) throw new CampaignExpectedError('STORY_SYNC_JOB_NOT_FOUND', `Story Sync Job ${jobId} was not found.`);
      const requested = new Map(request.proposals.map(proposal => [proposal.proposalId, proposal]));
      if (requested.size !== request.proposals.length || requested.size !== review.proposals.length) {
        throw new CampaignExpectedError('STORY_SYNC_REVIEW_INCOMPLETE', 'Decide every Proposal as Accept or Reject before finalizing.');
      }
      const proposalRevisions = review.proposals.map(proposal => {
        const expected = requested.get(proposal.id);
        if (
          !expected
          || expected.expectedRevision !== proposal.revision
          || expected.decision !== proposal.decision
          || !['accept', 'reject'].includes(proposal.decision)
        ) {
          throw new CampaignExpectedError(
            'STORY_SYNC_FINALIZATION_STALE',
            'The Review Inbox changed before finalization. Reload it; nothing was applied.',
          );
        }
        return { proposalId: proposal.id, expectedRevision: proposal.revision, decision: proposal.decision as 'accept' | 'reject' };
      });
      const decisionHash = sha256({
        jobId: review.jobId,
        proposals: review.proposals.map(proposal => ({
          id: proposal.id, revision: proposal.revision, decision: proposal.decision, draft: proposal.draft,
        })),
      });
      const requestId = `story-sync-finalize-${decisionHash}`;
      if (review.completedReceipt) return completeJournalTransaction({ ...review.completedReceipt, idempotent: true });
      if (review.status !== 'ready-for-review') {
        throw new CampaignExpectedError('STORY_SYNC_REVIEW_LOCKED', `Story Sync Job ${review.jobId} cannot finalize from ${review.status}.`);
      }
      const head = transaction.findHead(review.campaignId);
      if (!head) throw new CampaignExpectedError('CAMPAIGN_NOT_FOUND', `Campaign ${review.campaignId} was not found.`);
      if (
        head.state.campaign.revision !== review.campaignAnchor
        || review.binding.campaignAnchor !== review.campaignAnchor
        || review.binding.campaignId !== review.campaignId
      ) {
        throw new CampaignExpectedError(
          'STORY_SYNC_FINALIZATION_STALE',
          'Campaign or Chat Binding authority changed after analysis. Nothing was applied.',
        );
      }
      if (
        (review.binding.syncFacetRevision ?? 1) !== review.syncFacetRevision
        || review.binding.syncBoundary?.throughMessageIndex !== review.sourceBoundary.throughMessageIndex
        || review.binding.syncBoundary?.prefixHash !== review.sourceBoundary.prefixHash
      ) {
        throw new CampaignExpectedError('STORY_SYNC_FINALIZATION_STALE', 'The Sync Boundary changed after analysis. Nothing was applied.');
      }

      const accepted = review.proposals.filter(proposal => proposal.decision === 'accept');
      const rejected = review.proposals.filter(proposal => proposal.decision === 'reject');
      const operations = accepted.map(proposal => {
        if (!proposal.draft.operation) {
          throw new CampaignExpectedError('CAMPAIGN_VALIDATION_FAILED', `Accepted Proposal ${proposal.id} has no valid Campaign change.`);
        }
        return proposal.draft.operation;
      });
      let campaignRevision = head.state.campaign.revision;
      let campaignEventId: string | undefined;
      const completedAt = new Date().toISOString();
      if (operations.length > 0) {
        const beforeState = head.state;
        const afterState = structuredClone(beforeState);
        const changes = [];
        const affectedIds: string[] = [];
        for (const operation of operations) {
          const operationBefore = structuredClone(afterState);
          const affected = applyOperation(afterState, operation);
          affectedIds.push(...affected);
          changes.push(...subjectChangesForOperation(operationBefore, afterState, operation, affected));
        }
        campaignRevision += 1;
        afterState.campaign = { ...afterState.campaign, revision: campaignRevision, updatedAt: completedAt };
        campaignEventId = randomUUID();
        const operation = { kind: 'story_sync_batch', jobId: review.jobId, operations };
        const eventHash = subjectEventHash({
          campaignId: review.campaignId,
          revision: campaignRevision,
          eventId: campaignEventId,
          requestId,
          operationKind: operation.kind,
          operation,
          acceptedAt: completedAt,
          previousEventHash: head.headEventHash,
          baseStateHash: null,
          changes,
        });
        transaction.append({
          kind: 'revision', requestId,
          requestHash: sha256({ jobId: review.jobId, decisionHash }),
          operation, changes, afterState, eventHash,
          commit: {
            campaignId: review.campaignId,
            revision: campaignRevision,
            eventId: campaignEventId,
            requestId,
            operationKind: operation.kind,
            affectedIds: [...new Set(affectedIds)],
            committedAt: completedAt,
          },
        });
      }
      const receipt = transaction.completeStorySyncFinalization({
        jobId: review.jobId,
        requestId,
        decisionHash,
        expectedCampaignRevision: review.campaignAnchor,
        expectedBindingRevision: review.binding.revision,
        expectedSyncFacetRevision: review.syncFacetRevision,
        proposalRevisions,
        acceptedProposalIds: accepted.map(proposal => proposal.id),
        rejectedProposalIds: rejected.map(proposal => proposal.id),
        campaignRevision,
        ...(campaignEventId ? { campaignEventId } : {}),
        bindingEventId: randomUUID(),
        completedAt,
      });
      return completeJournalTransaction(receipt);
    }));
    if (outcome.ok && !outcome.value.idempotent && outcome.value.campaignEventId) {
      const listeners = this.#revisionListeners.get(outcome.value.campaignId);
      if (listeners) for (const listener of [...listeners]) listener(outcome.value.campaignRevision);
    }
    return outcome;
  }

  async applyAddonBatch(campaignId: string, request: ApplyAddonBatchRequest): Promise<Outcome<CampaignCommit>> {
    const outcome = normalizeCommitOutcome(
      await this.capture(request.requestId, async () => {
        const id = cleanIdentifier(campaignId, 'Campaign ID');
        const requestId = cleanIdentifier(request.requestId, 'Request ID');
        const candidateId = cleanIdentifier(request.candidateId, 'Addon candidate ID');
        const manifestHash = cleanIdentifier(request.manifestHash, 'Addon manifest hash');
        if (request.operations.length < 1 || request.operations.length > 2000) {
          throw new CampaignExpectedError('CAMPAIGN_VALIDATION_FAILED', 'Addon batch must contain from 1 through 2000 changes.');
        }
        const acceptedOperation = {
          kind: 'apply_addon_batch',
          candidateId,
          manifestHash,
          operations: request.operations,
        };
        const requestHash = sha256({
          campaignId: id,
          expectedRevision: request.expectedRevision,
          operation: acceptedOperation,
        });
        return this.#journal.transact(transaction => {
          const receipt = this.acceptReceipt(transaction, requestId, requestHash);
          if (receipt) {
            return readAfterJournalTransaction({
              kind: 'campaign', campaignId: receipt.campaignId, revision: receipt.revision,
            }, document => ({ ...receipt, idempotent: true, document }));
          }
          const head = transaction.findHead(id);
          if (!head) throw new CampaignExpectedError('CAMPAIGN_NOT_FOUND', `Campaign ${id} was not found.`);
          if (head.state.campaign.revision !== request.expectedRevision) {
            throw new CampaignExpectedError(
              'CAMPAIGN_REVISION_CONFLICT',
              `Campaign changed from revision ${request.expectedRevision} to ${head.state.campaign.revision}. Preview the addon diff again.`,
            );
          }
          const afterState = structuredClone(head.state);
          const affectedIds: string[] = [];
          const changesBySubject = new Map<string, ReturnType<typeof subjectChangesForOperation>[number]>();
          for (const operation of request.operations) {
            const operationAffected = applyOperation(afterState, operation);
            affectedIds.push(...operationAffected);
            for (const change of subjectChangesForOperation(head.state, afterState, operation, operationAffected)) {
              changesBySubject.set(`${change.subjectKind}:${change.subjectId}`, change);
            }
          }
          const changes = [...changesBySubject.values()];
          const revision = head.state.campaign.revision + 1;
          const committedAt = new Date().toISOString();
          afterState.campaign = { ...afterState.campaign, revision, updatedAt: committedAt };
          const eventId = randomUUID();
          const eventHash = subjectEventHash({
            campaignId: id,
            revision,
            eventId,
            requestId,
            operationKind: acceptedOperation.kind,
            operation: acceptedOperation,
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
            operationKind: acceptedOperation.kind,
            affectedIds: [...new Set(affectedIds)],
            committedAt,
            idempotent: false,
            document: asDocument(afterState),
          };
          transaction.append({
            kind: 'revision',
            requestId,
            requestHash,
            operation: acceptedOperation,
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
