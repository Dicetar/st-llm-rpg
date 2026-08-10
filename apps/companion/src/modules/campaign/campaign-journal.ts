import type {
  CampaignCommit,
  CampaignCommitPerformance,
  CampaignDocument,
  CampaignHistoryEntry,
  CampaignSummary,
  CampaignVerificationResult,
  ChatBindingDocument,
  StorySyncFinalizationReceipt,
  StorySyncProposal,
} from '@st-llm-rpg/wire';
import type { CampaignState, CampaignSubjectChange } from './campaign-state.js';

export type CampaignJournalObservation = Readonly<{
  ready: boolean;
  message: string;
  latencyMs: number;
}>;

export type CampaignJournalRead =
  | Readonly<{ kind: 'campaign-list' }>
  | Readonly<{ kind: 'campaign'; campaignId: string; revision?: number }>
  | Readonly<{ kind: 'history'; campaignId: string }>
  | Readonly<{ kind: 'performance' }>;

export type CampaignJournalReadResult<R extends CampaignJournalRead> =
  R extends { kind: 'campaign-list' } ? CampaignSummary[]
    : R extends { kind: 'campaign' } ? CampaignDocument
      : R extends { kind: 'history' } ? CampaignHistoryEntry[]
        : R extends { kind: 'performance' } ? CampaignCommitPerformance
          : never;

export type CampaignCommitReceipt = Omit<CampaignCommit, 'document' | 'idempotent'>;

export type CampaignJournalReceipt = Readonly<{
  requestHash: string;
  commit: CampaignCommitReceipt;
}>;

export type CampaignJournalHead = Readonly<{
  state: CampaignState;
  headEventHash: string;
}>;

export type StorySyncFinalizationReview = Readonly<{
  jobId: string;
  campaignId: string;
  bindingId: string;
  status: string;
  campaignAnchor: number;
  bindingRevision: number;
  syncFacetRevision: number;
  sourceFirstMessageIndex: number;
  sourceLastMessageIndex: number;
  sourceEndPrefixHash: string;
  sourceBoundary: Readonly<{ throughMessageIndex: number; prefixHash: string }>;
  binding: ChatBindingDocument;
  proposals: readonly StorySyncProposal[];
  completedReceipt: StorySyncFinalizationReceipt | null;
}>;

export type CompleteStorySyncFinalization = Readonly<{
  jobId: string;
  requestId: string;
  decisionHash: string;
  expectedCampaignRevision: number;
  expectedBindingRevision: number;
  expectedSyncFacetRevision: number;
  proposalRevisions: readonly Readonly<{
    proposalId: string;
    expectedRevision: number;
    decision: 'accept' | 'reject';
  }>[];
  acceptedProposalIds: readonly string[];
  rejectedProposalIds: readonly string[];
  campaignRevision: number;
  campaignEventId?: string;
  bindingEventId: string;
  completedAt: string;
}>;

type CampaignJournalAppendBase = Readonly<{
  requestId: string;
  requestHash: string;
  operation: unknown;
  afterState: CampaignState;
  eventHash: string;
  commit: CampaignCommitReceipt;
}>;

export type CampaignJournalAppend =
  | CampaignJournalAppendBase & Readonly<{
      kind: 'create';
      baseKind: 'blank' | 'legacy_import';
      baseState: CampaignState;
    }>
  | CampaignJournalAppendBase & Readonly<{
      kind: 'revision';
      changes: readonly CampaignSubjectChange[];
    }>;

export interface CampaignJournalTransaction {
  findReceipt(requestId: string): CampaignJournalReceipt | undefined;
  findHead(campaignId: string): CampaignJournalHead | undefined;
  append(input: CampaignJournalAppend): void;
  findStorySyncFinalization?(jobId: string): StorySyncFinalizationReview | undefined;
  completeStorySyncFinalization?(input: CompleteStorySyncFinalization): StorySyncFinalizationReceipt;
}

type CampaignJournalReadValue =
  | CampaignDocument
  | CampaignSummary[]
  | CampaignHistoryEntry[]
  | CampaignCommitPerformance;

export type CampaignJournalTransactionCompletion<T> =
  | Readonly<{ kind: 'complete'; value: T }>
  | Readonly<{
      kind: 'read-after-transaction';
      request: CampaignJournalRead;
      project(value: CampaignJournalReadValue): T;
    }>;

export function completeJournalTransaction<T>(value: T): CampaignJournalTransactionCompletion<T> {
  return { kind: 'complete', value };
}

export function readAfterJournalTransaction<R extends CampaignJournalRead, T>(
  request: R,
  project: (value: CampaignJournalReadResult<R>) => T,
): CampaignJournalTransactionCompletion<T> {
  return {
    kind: 'read-after-transaction',
    request,
    project: project as (value: CampaignJournalReadValue) => T,
  };
}

export type CampaignJournalBackupRequest = Readonly<{ destinationPath: string }>;
export type CampaignJournalBackupResult = Readonly<{ destinationPath: string }>;
export type CampaignJournalRestoreRequest = Readonly<{ sourcePath: string }>;
export type CampaignJournalVerifyBackupRequest = Readonly<{ sourcePath: string }>;

export interface CampaignJournal {
  close(): Promise<void>;
  observation(): CampaignJournalObservation;
  readAt<R extends CampaignJournalRead>(request: R): Promise<CampaignJournalReadResult<R>>;
  transact<T>(
    work: (transaction: CampaignJournalTransaction) => CampaignJournalTransactionCompletion<T>,
  ): Promise<T>;
  verify(): Promise<CampaignVerificationResult>;
  backup(request: CampaignJournalBackupRequest): Promise<CampaignJournalBackupResult>;
  verifyBackup(request: CampaignJournalVerifyBackupRequest): Promise<CampaignVerificationResult>;
  restore(request: CampaignJournalRestoreRequest): Promise<void>;
}
