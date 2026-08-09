import type {
  CampaignCommit,
  CampaignCommitPerformance,
  CampaignDocument,
  CampaignHistoryEntry,
  CampaignSummary,
  CampaignVerificationResult,
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

export interface CampaignJournal {
  close(): Promise<void>;
  observation(): CampaignJournalObservation;
  readAt<R extends CampaignJournalRead>(request: R): Promise<CampaignJournalReadResult<R>>;
  transact<T>(
    work: (transaction: CampaignJournalTransaction) => CampaignJournalTransactionCompletion<T>,
  ): Promise<T>;
  verify(): Promise<CampaignVerificationResult>;
  backup(request: CampaignJournalBackupRequest): Promise<CampaignJournalBackupResult>;
  restore(request: CampaignJournalRestoreRequest): Promise<void>;
}
