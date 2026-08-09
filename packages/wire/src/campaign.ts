import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

const Identifier = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$',
});
const Title = Type.String({ minLength: 1, maxLength: 160 });
const Summary = Type.String({ maxLength: 4000 });
const Timestamp = Type.String({ minLength: 1, maxLength: 64 });
const RequestId = Type.String({ minLength: 1, maxLength: 128 });
const Alias = Type.String({ minLength: 1, maxLength: 160 });
const Aliases = Type.Array(Alias, { maxItems: 32, uniqueItems: true });
const NarratorVisibility = Type.Union([
  Type.Literal('known'),
  Type.Literal('narrator_secret'),
  Type.Literal('campaign_private'),
]);

export const CampaignActorSchema = Type.Object({
  id: Identifier,
  name: Title,
  aliases: Type.Optional(Aliases),
  summary: Summary,
  visibility: Type.Optional(NarratorVisibility),
  archived: Type.Boolean(),
}, { additionalProperties: false });
export type CampaignActor = Static<typeof CampaignActorSchema>;

export const CampaignItemSchema = Type.Object({
  id: Identifier,
  name: Title,
  aliases: Type.Optional(Aliases),
  summary: Summary,
  visibility: Type.Optional(NarratorVisibility),
  archived: Type.Boolean(),
  ownerActorId: Type.Optional(Identifier),
}, { additionalProperties: false });
export type CampaignItem = Static<typeof CampaignItemSchema>;

export const CampaignQuestStatusSchema = Type.Union([
  Type.Literal('active'),
  Type.Literal('completed'),
]);
export type CampaignQuestStatus = Static<typeof CampaignQuestStatusSchema>;

export const CampaignQuestSchema = Type.Object({
  id: Identifier,
  name: Title,
  aliases: Type.Optional(Aliases),
  summary: Summary,
  visibility: Type.Optional(NarratorVisibility),
  status: CampaignQuestStatusSchema,
  archived: Type.Boolean(),
}, { additionalProperties: false });
export type CampaignQuest = Static<typeof CampaignQuestSchema>;

export const CampaignPlaceSchema = Type.Object({
  id: Identifier,
  name: Title,
  aliases: Type.Optional(Aliases),
  summary: Summary,
  visibility: Type.Optional(NarratorVisibility),
  archived: Type.Boolean(),
}, { additionalProperties: false });
export type CampaignPlace = Static<typeof CampaignPlaceSchema>;

export const CampaignSceneSchema = Type.Object({
  id: Identifier,
  name: Title,
  summary: Summary,
  placeId: Type.Optional(Identifier),
  actorIds: Type.Optional(Type.Array(Identifier, { maxItems: 64, uniqueItems: true })),
  itemIds: Type.Optional(Type.Array(Identifier, { maxItems: 64, uniqueItems: true })),
}, { additionalProperties: false });
export type CampaignScene = Static<typeof CampaignSceneSchema>;

export const CampaignSummarySchema = Type.Object({
  id: Identifier,
  title: Title,
  status: Type.Union([Type.Literal('active'), Type.Literal('archived')]),
  revision: Type.Integer({ minimum: 1 }),
  createdAt: Timestamp,
  updatedAt: Timestamp,
}, { additionalProperties: false });
export type CampaignSummary = Static<typeof CampaignSummarySchema>;

export const CampaignDocumentSchema = Type.Object({
  campaign: CampaignSummarySchema,
  actors: Type.Array(CampaignActorSchema),
  items: Type.Array(CampaignItemSchema),
  quests: Type.Array(CampaignQuestSchema),
  places: Type.Array(CampaignPlaceSchema),
  currentScene: Type.Union([CampaignSceneSchema, Type.Null()]),
}, { additionalProperties: false });
export type CampaignDocument = Static<typeof CampaignDocumentSchema>;

export const CreateCampaignRequestSchema = Type.Object({
  requestId: RequestId,
  title: Title,
}, { additionalProperties: false });
export type CreateCampaignRequest = Static<typeof CreateCampaignRequestSchema>;

const NewActorSchema = Type.Object({
  id: Type.Optional(Identifier),
  name: Title,
  aliases: Type.Optional(Aliases),
  summary: Type.Optional(Summary),
  visibility: Type.Optional(NarratorVisibility),
}, { additionalProperties: false });

const NewItemSchema = Type.Object({
  id: Type.Optional(Identifier),
  name: Title,
  aliases: Type.Optional(Aliases),
  summary: Type.Optional(Summary),
  visibility: Type.Optional(NarratorVisibility),
  ownerActorId: Type.Optional(Identifier),
}, { additionalProperties: false });

const NewQuestSchema = Type.Object({
  id: Type.Optional(Identifier),
  name: Title,
  aliases: Type.Optional(Aliases),
  summary: Type.Optional(Summary),
  visibility: Type.Optional(NarratorVisibility),
  status: Type.Optional(CampaignQuestStatusSchema),
}, { additionalProperties: false });

const NewPlaceSchema = Type.Object({
  id: Type.Optional(Identifier),
  name: Title,
  aliases: Type.Optional(Aliases),
  summary: Type.Optional(Summary),
  visibility: Type.Optional(NarratorVisibility),
}, { additionalProperties: false });

export const CampaignOperationSchema = Type.Union([
  Type.Object({
    kind: Type.Literal('create_actor'),
    actor: NewActorSchema,
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal('create_actor_with_item'),
    actor: NewActorSchema,
    item: Type.Object({
      id: Type.Optional(Identifier),
      name: Title,
      aliases: Type.Optional(Aliases),
      summary: Type.Optional(Summary),
      visibility: Type.Optional(NarratorVisibility),
    }, { additionalProperties: false }),
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal('rename_actor'),
    actorId: Identifier,
    name: Title,
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal('update_actor'),
    actorId: Identifier,
    name: Title,
    summary: Summary,
    aliases: Type.Optional(Aliases),
    visibility: Type.Optional(NarratorVisibility),
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal('set_actor_archived'),
    actorId: Identifier,
    archived: Type.Boolean(),
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal('create_item'),
    item: NewItemSchema,
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal('update_item'),
    itemId: Identifier,
    name: Title,
    summary: Summary,
    aliases: Type.Optional(Aliases),
    visibility: Type.Optional(NarratorVisibility),
    ownerActorId: Type.Optional(Type.Union([Identifier, Type.Null()])),
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal('set_item_archived'),
    itemId: Identifier,
    archived: Type.Boolean(),
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal('create_quest'),
    quest: NewQuestSchema,
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal('update_quest'),
    questId: Identifier,
    name: Title,
    summary: Summary,
    status: CampaignQuestStatusSchema,
    aliases: Type.Optional(Aliases),
    visibility: Type.Optional(NarratorVisibility),
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal('set_quest_archived'),
    questId: Identifier,
    archived: Type.Boolean(),
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal('create_place'),
    place: NewPlaceSchema,
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal('update_place'),
    placeId: Identifier,
    name: Title,
    summary: Summary,
    aliases: Type.Optional(Aliases),
    visibility: Type.Optional(NarratorVisibility),
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal('set_place_archived'),
    placeId: Identifier,
    archived: Type.Boolean(),
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal('set_current_scene'),
    scene: Type.Object({
      id: Type.Optional(Identifier),
      name: Title,
      summary: Type.Optional(Summary),
      placeId: Type.Optional(Identifier),
      actorIds: Type.Optional(Type.Array(Identifier, { maxItems: 64, uniqueItems: true })),
      itemIds: Type.Optional(Type.Array(Identifier, { maxItems: 64, uniqueItems: true })),
    }, { additionalProperties: false }),
  }, { additionalProperties: false }),
]);
export type CampaignOperation = Static<typeof CampaignOperationSchema>;

export const ExecuteCampaignRequestSchema = Type.Object({
  requestId: RequestId,
  expectedRevision: Type.Integer({ minimum: 1 }),
  operation: CampaignOperationSchema,
}, { additionalProperties: false });
export type ExecuteCampaignRequest = Static<typeof ExecuteCampaignRequestSchema>;

export const CampaignCommitSchema = Type.Object({
  campaignId: Identifier,
  revision: Type.Integer({ minimum: 1 }),
  eventId: Identifier,
  requestId: RequestId,
  operationKind: Type.String({ minLength: 1, maxLength: 64 }),
  affectedIds: Type.Array(Identifier, { maxItems: 64 }),
  committedAt: Timestamp,
  idempotent: Type.Boolean(),
  document: CampaignDocumentSchema,
}, { additionalProperties: false });
export type CampaignCommit = Static<typeof CampaignCommitSchema>;

export const CampaignHistoryEntrySchema = Type.Object({
  revision: Type.Integer({ minimum: 1 }),
  eventId: Identifier,
  requestId: RequestId,
  operationKind: Type.String({ minLength: 1, maxLength: 64 }),
  committedAt: Timestamp,
}, { additionalProperties: false });
export type CampaignHistoryEntry = Static<typeof CampaignHistoryEntrySchema>;

export const CampaignInvalidationSchema = Type.Object({
  schema: Type.Literal('st-rpg.campaign-invalidation'),
  version: Type.Literal('1.0'),
  campaignId: Identifier,
  revision: Type.Integer({ minimum: 1 }),
  observedAt: Timestamp,
}, { additionalProperties: false });
export type CampaignInvalidation = Static<typeof CampaignInvalidationSchema>;

export const CampaignCommitPerformanceSchema = Type.Object({
  sampleCount: Type.Integer({ minimum: 0 }),
  p95Ms: Type.Number({ minimum: 0 }),
  maxMs: Type.Number({ minimum: 0 }),
  latestMs: Type.Number({ minimum: 0 }),
  targetMs: Type.Literal(50),
  investigationMs: Type.Literal(200),
}, { additionalProperties: false });
export type CampaignCommitPerformance = Static<typeof CampaignCommitPerformanceSchema>;

export const CampaignVerificationResultSchema = Type.Object({
  verified: Type.Literal(true),
  verifiedAt: Timestamp,
  durationMs: Type.Number({ minimum: 0 }),
  campaignCount: Type.Integer({ minimum: 0 }),
}, { additionalProperties: false });
export type CampaignVerificationResult = Static<typeof CampaignVerificationResultSchema>;

export function isCampaignDocument(value: unknown): value is CampaignDocument {
  return Value.Check(CampaignDocumentSchema, value);
}

export function isCampaignCommit(value: unknown): value is CampaignCommit {
  return Value.Check(CampaignCommitSchema, value);
}

export function isCampaignInvalidation(value: unknown): value is CampaignInvalidation {
  return Value.Check(CampaignInvalidationSchema, value);
}

export function isCampaignCommitPerformance(value: unknown): value is CampaignCommitPerformance {
  return Value.Check(CampaignCommitPerformanceSchema, value);
}

export function isCampaignVerificationResult(value: unknown): value is CampaignVerificationResult {
  return Value.Check(CampaignVerificationResultSchema, value);
}
