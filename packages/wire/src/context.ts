import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

const Identifier = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$',
});
const RequestId = Type.String({ minLength: 1, maxLength: 128 });
const Fingerprint = Type.String({ minLength: 64, maxLength: 64, pattern: '^[a-f0-9]{64}$' });

export const NarratorVisibilitySchema = Type.Union([
  Type.Literal('known'),
  Type.Literal('narrator_secret'),
  Type.Literal('campaign_private'),
]);
export type NarratorVisibility = Static<typeof NarratorVisibilitySchema>;

export const NarratorModelProfileSchema = Type.Object({
  id: Identifier,
  modelId: Type.String({ minLength: 1, maxLength: 512 }),
  contextWindowTokens: Type.Integer({ minimum: 1 }),
  requestedVisibleOutputTokens: Type.Integer({ minimum: 1 }),
  safetyMarginTokens: Type.Integer({ minimum: 0 }),
  maxCampaignTokens: Type.Integer({ minimum: 1 }),
  maxAutomaticRecords: Type.Integer({ minimum: 0, maximum: 100 }),
  maxRelationExpansions: Type.Integer({ minimum: 0, maximum: 100 }),
}, { additionalProperties: false });
export type NarratorModelProfile = Static<typeof NarratorModelProfileSchema>;

export const ContextMessageSchema = Type.Object({
  role: Type.Union([Type.Literal('user'), Type.Literal('assistant')]),
  content: Type.String({ maxLength: 100_000 }),
}, { additionalProperties: false });
export type ContextMessage = Static<typeof ContextMessageSchema>;

export const GenerationTypeSchema = Type.Union([
  Type.Literal('normal'),
  Type.Literal('regenerate'),
  Type.Literal('swipe'),
  Type.Literal('continue'),
]);
export type GenerationType = Static<typeof GenerationTypeSchema>;

export const PreflightContextRequestSchema = Type.Object({
  requestId: RequestId,
  campaignId: Identifier,
  campaignRevision: Type.Integer({ minimum: 1 }),
  bindingId: Identifier,
  bindingRevision: Type.Integer({ minimum: 1 }),
  contextFocusRevision: Type.Integer({ minimum: 1 }),
  modelProfileId: Identifier,
  generationType: GenerationTypeSchema,
  messages: Type.Array(ContextMessageSchema, { minItems: 1, maxItems: 8 }),
}, { additionalProperties: false });
export type PreflightContextRequest = Static<typeof PreflightContextRequestSchema>;

export const SetContextPinsRequestSchema = Type.Object({
  requestId: RequestId,
  eventId: Identifier,
  expectedBindingRevision: Type.Integer({ minimum: 1 }),
  expectedContextFocusRevision: Type.Integer({ minimum: 1 }),
  pins: Type.Array(Identifier, { maxItems: 128, uniqueItems: true }),
}, { additionalProperties: false });
export type SetContextPinsRequest = Static<typeof SetContextPinsRequestSchema>;

export const ContextTierSchema = Type.Union([
  Type.Literal('required-core'),
  Type.Literal('manual-pin'),
  Type.Literal('exact-mention'),
  Type.Literal('scene-anchor'),
  Type.Literal('fts5'),
  Type.Literal('relation-hop'),
]);
export type ContextTier = Static<typeof ContextTierSchema>;

export const ContextSelectionSchema = Type.Object({
  tier: ContextTierSchema,
  recordId: Type.Optional(Identifier),
  recordKind: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  label: Type.String({ minLength: 1, maxLength: 512 }),
  visibility: NarratorVisibilitySchema,
  tokenCost: Type.Integer({ minimum: 0 }),
  reason: Type.String({ minLength: 1, maxLength: 512 }),
}, { additionalProperties: false });
export type ContextSelection = Static<typeof ContextSelectionSchema>;

export const ContextOmissionSchema = Type.Object({
  recordId: Type.Optional(Identifier),
  label: Type.String({ minLength: 1, maxLength: 512 }),
  reason: Type.Union([
    Type.Literal('visibility'),
    Type.Literal('ambiguity'),
    Type.Literal('duplicate'),
    Type.Literal('record-limit'),
    Type.Literal('token-budget'),
    Type.Literal('threshold'),
  ]),
  tokenCost: Type.Optional(Type.Integer({ minimum: 0 })),
}, { additionalProperties: false });
export type ContextOmission = Static<typeof ContextOmissionSchema>;

export const ContextAmbiguitySchema = Type.Object({
  phrase: Type.String({ minLength: 1, maxLength: 512 }),
  candidates: Type.Array(Type.Object({
    recordId: Identifier,
    label: Type.String({ minLength: 1, maxLength: 512 }),
  }, { additionalProperties: false }), { minItems: 2, maxItems: 32 }),
}, { additionalProperties: false });
export type ContextAmbiguity = Static<typeof ContextAmbiguitySchema>;

export const ContextBudgetSchema = Type.Object({
  inputCeilingTokens: Type.Integer({ minimum: 0 }),
  campaignBudgetTokens: Type.Integer({ minimum: 0 }),
  existingMessageTokens: Type.Integer({ minimum: 0 }),
  usedCampaignTokens: Type.Integer({ minimum: 0 }),
  remainingCampaignTokens: Type.Integer({ minimum: 0 }),
}, { additionalProperties: false });
export type ContextBudget = Static<typeof ContextBudgetSchema>;

export const ContextPlanSchema = Type.Object({
  schema: Type.Literal('st-rpg.context-plan'),
  version: Type.Literal('1.0'),
  requestId: RequestId,
  authority: Type.Object({
    campaignId: Identifier,
    campaignRevision: Type.Integer({ minimum: 1 }),
    bindingId: Identifier,
    bindingRevision: Type.Integer({ minimum: 1 }),
    contextFocusRevision: Type.Integer({ minimum: 1 }),
  }, { additionalProperties: false }),
  modelProfile: Type.Object({
    id: Identifier,
    modelId: Type.String({ minLength: 1, maxLength: 512 }),
  }, { additionalProperties: false }),
  generationType: GenerationTypeSchema,
  evidence: Type.Object({
    excerptHash: Fingerprint,
    estimatedTokens: Type.Integer({ minimum: 0, maximum: 2_000 }),
    messageCount: Type.Integer({ minimum: 1, maximum: 8 }),
  }, { additionalProperties: false }),
  budget: ContextBudgetSchema,
  selections: Type.Array(ContextSelectionSchema, { maxItems: 128 }),
  omissions: Type.Array(ContextOmissionSchema, { maxItems: 256 }),
  ambiguities: Type.Array(ContextAmbiguitySchema, { maxItems: 64 }),
  blocks: Type.Object({
    known: Type.String(),
    secret: Type.Optional(Type.String()),
  }, { additionalProperties: false }),
  contentHash: Fingerprint,
}, { additionalProperties: false });
export type ContextPlan = Static<typeof ContextPlanSchema>;

export function isContextPlan(value: unknown): value is ContextPlan {
  return Value.Check(ContextPlanSchema, value);
}
