import type {
  DecideStorySyncProposalRequest,
  StorySyncJobDocument,
  StorySyncProposal,
  StorySyncJobStatus,
  WorkerModelProfile,
} from '@st-llm-rpg/wire';

export type StoredStorySyncSource = Readonly<{
  locator: Readonly<{
    version: 1;
    hostId: string;
    chat: Readonly<{ kind: 'character' | 'group'; ownerId: string; chatId: string }>;
  }>;
  boundary: Readonly<{ throughMessageIndex: number; prefixHash: string }>;
  messages: readonly Readonly<{
    index: number;
    role: 'player' | 'narrator';
    name: string;
    content: string;
    contentHash: string;
  }>[];
}>;

export type CreateStorySyncJob = Readonly<{
  jobId: string;
  requestId: string;
  campaignId: string;
  bindingId: string;
  profileId: string;
  campaignAnchor: number;
  bindingRevision: number;
  syncFacetRevision: number;
  source: StoredStorySyncSource;
  sourceFingerprint: string;
  sourceEndPrefixHash: string;
  sourceFirstMessageIndex: number;
  sourceLastMessageIndex: number;
  createdAt: string;
}>;

export type CompleteStorySyncAttempt = Readonly<{
  jobId: string;
  attemptId: string;
  outputHash: string;
  proposals: readonly Omit<StorySyncProposal, 'jobId'>[];
  repaired: boolean;
  completedAt: string;
}>;

export interface StorySyncJournal {
  saveWorkerModelProfile(profile: WorkerModelProfile): Promise<WorkerModelProfile>;
  readWorkerModelProfile(profileId: string): Promise<WorkerModelProfile>;
  listWorkerModelProfiles(): Promise<readonly WorkerModelProfile[]>;
  createStorySyncJob(input: CreateStorySyncJob): Promise<StorySyncJobDocument>;
  readStorySyncJob(jobId: string): Promise<StorySyncJobDocument>;
  readStorySyncSource(jobId: string): Promise<StoredStorySyncSource>;
  listStorySyncJobs(campaignId: string): Promise<readonly StorySyncJobDocument[]>;
  beginStorySyncAttempt(jobId: string, attemptId: string, startedAt: string): Promise<StorySyncJobDocument>;
  setStorySyncJobStatus(jobId: string, status: StorySyncJobStatus): Promise<StorySyncJobDocument>;
  completeStorySyncAttempt(input: CompleteStorySyncAttempt): Promise<StorySyncJobDocument>;
  failStorySyncAttempt(input: Readonly<{
    jobId: string;
    attemptId: string;
    code: string;
    message: string;
    completedAt: string;
  }>): Promise<StorySyncJobDocument>;
  decideStorySyncProposal(
    proposalId: string,
    request: DecideStorySyncProposalRequest,
  ): Promise<StorySyncJobDocument>;
  cancelStorySyncJob(jobId: string, cancelledAt: string): Promise<StorySyncJobDocument>;
  prepareStorySyncResume(jobId: string, resumedAt: string): Promise<StorySyncJobDocument>;
  discardStorySyncJob(jobId: string, discardedAt: string): Promise<StorySyncJobDocument>;
}
