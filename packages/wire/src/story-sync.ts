import { Type, type Static } from '@sinclair/typebox';
import { CampaignOperationSchema } from './campaign.js';
import { NarrationChatLocatorSchema } from './narration.js';

const Identifier = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$',
});
const Fingerprint = Type.String({ minLength: 64, maxLength: 64, pattern: '^[a-f0-9]{64}$' });
const Timestamp = Type.String({ minLength: 1, maxLength: 64 });
const ShortText = Type.String({ minLength: 1, maxLength: 512 });

export const WorkerModelProfileSchema = Type.Object({
  schema: Type.Literal('st-rpg.worker-model-profile'),
  version: Type.Literal('1.0'),
  id: Identifier,
  modelId: Type.String({ minLength: 1, maxLength: 512 }),
  requestedOutputTokens: Type.Integer({ minimum: 128, maximum: 8192 }),
  updatedAt: Timestamp,
}, { additionalProperties: false });
export type WorkerModelProfile = Static<typeof WorkerModelProfileSchema>;

export const SaveWorkerModelProfileRequestSchema = Type.Object({
  modelId: Type.String({ minLength: 1, maxLength: 512 }),
  requestedOutputTokens: Type.Integer({ minimum: 128, maximum: 8192 }),
}, { additionalProperties: false });
export type SaveWorkerModelProfileRequest = Static<typeof SaveWorkerModelProfileRequestSchema>;

export const StorySyncLocatorSchema = Type.Object({
  version: Type.Literal(1),
  hostId: Identifier,
  chat: NarrationChatLocatorSchema,
}, { additionalProperties: false });
export type StorySyncLocator = Static<typeof StorySyncLocatorSchema>;

export const StorySyncCaptureMessageSchema = Type.Object({
  index: Type.Integer({ minimum: 0 }),
  role: Type.Union([Type.Literal('player'), Type.Literal('narrator')]),
  name: Type.String({ maxLength: 160 }),
  content: Type.String({ minLength: 1, maxLength: 20_000 }),
}, { additionalProperties: false });
export type StorySyncCaptureMessage = Static<typeof StorySyncCaptureMessageSchema>;

export const StartStorySyncJobRequestSchema = Type.Object({
  requestId: Identifier,
  bindingId: Identifier,
  profileId: Identifier,
  locator: StorySyncLocatorSchema,
  messages: Type.Array(StorySyncCaptureMessageSchema, { minItems: 1, maxItems: 512 }),
}, { additionalProperties: false });
export type StartStorySyncJobRequest = Static<typeof StartStorySyncJobRequestSchema>;

export const StorySyncJobStatusSchema = Type.Union([
  Type.Literal('queued'),
  Type.Literal('waiting-for-lane'),
  Type.Literal('running'),
  Type.Literal('parsing'),
  Type.Literal('repairing'),
  Type.Literal('ready-for-review'),
  Type.Literal('interrupted'),
  Type.Literal('cancelled'),
  Type.Literal('failed'),
  Type.Literal('discarded'),
  Type.Literal('awaiting-authority'),
  Type.Literal('completed'),
]);
export type StorySyncJobStatus = Static<typeof StorySyncJobStatusSchema>;

export const StorySyncProposalDecisionSchema = Type.Union([
  Type.Literal('pending'),
  Type.Literal('accept'),
  Type.Literal('reject'),
  Type.Literal('defer'),
]);
export type StorySyncProposalDecision = Static<typeof StorySyncProposalDecisionSchema>;

export const StorySyncProposalDraftSchema = Type.Object({
  title: ShortText,
  operation: Type.Union([CampaignOperationSchema, Type.Null()]),
  note: Type.String({ maxLength: 2_000 }),
}, { additionalProperties: false });
export type StorySyncProposalDraft = Static<typeof StorySyncProposalDraftSchema>;

export const StorySyncProposalSchema = Type.Object({
  id: Identifier,
  jobId: Identifier,
  ordinal: Type.Integer({ minimum: 0 }),
  revision: Type.Integer({ minimum: 1 }),
  decision: StorySyncProposalDecisionSchema,
  draft: StorySyncProposalDraftSchema,
  sourceLinks: Type.Array(Type.Object({
    messageIndex: Type.Integer({ minimum: 0 }),
    excerpt: Type.String({ maxLength: 240 }),
  }, { additionalProperties: false }), { maxItems: 8 }),
  validationProblems: Type.Array(Type.String({ minLength: 1, maxLength: 512 }), { maxItems: 16 }),
  confidence: Type.Union([Type.Literal('high'), Type.Literal('medium'), Type.Literal('low')]),
}, { additionalProperties: false });
export type StorySyncProposal = Static<typeof StorySyncProposalSchema>;

export const StorySyncJobDocumentSchema = Type.Object({
  schema: Type.Literal('st-rpg.story-sync-job'),
  version: Type.Literal('1.0'),
  id: Identifier,
  campaignId: Identifier,
  bindingId: Identifier,
  profileId: Identifier,
  status: StorySyncJobStatusSchema,
  campaignAnchor: Type.Integer({ minimum: 1 }),
  bindingRevision: Type.Integer({ minimum: 1 }),
  syncFacetRevision: Type.Integer({ minimum: 1 }),
  source: Type.Object({
    firstMessageIndex: Type.Integer({ minimum: 0 }),
    lastMessageIndex: Type.Integer({ minimum: 0 }),
    messageCount: Type.Integer({ minimum: 1, maximum: 12 }),
    fingerprint: Fingerprint,
    endPrefixHash: Fingerprint,
    contentPruned: Type.Boolean(),
  }, { additionalProperties: false }),
  attemptCount: Type.Integer({ minimum: 0 }),
  proposals: Type.Array(StorySyncProposalSchema, { maxItems: 30 }),
  problem: Type.Optional(Type.Object({
    code: Type.String({ minLength: 1, maxLength: 64 }),
    message: Type.String({ minLength: 1, maxLength: 512 }),
  }, { additionalProperties: false })),
  createdAt: Timestamp,
  updatedAt: Timestamp,
}, { additionalProperties: false });
export type StorySyncJobDocument = Static<typeof StorySyncJobDocumentSchema>;

export const StorySyncJobReceiptSchema = Type.Object({
  schema: Type.Literal('st-rpg.story-sync-job-receipt'),
  version: Type.Literal('1.0'),
  jobId: Identifier,
  campaignId: Identifier,
  status: StorySyncJobStatusSchema,
}, { additionalProperties: false });
export type StorySyncJobReceipt = Static<typeof StorySyncJobReceiptSchema>;

export const DecideStorySyncProposalRequestSchema = Type.Object({
  expectedRevision: Type.Integer({ minimum: 1 }),
  decision: StorySyncProposalDecisionSchema,
  draft: StorySyncProposalDraftSchema,
}, { additionalProperties: false });
export type DecideStorySyncProposalRequest = Static<typeof DecideStorySyncProposalRequestSchema>;
