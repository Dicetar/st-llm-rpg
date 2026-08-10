import { Type, type Static } from '@sinclair/typebox';
import { CampaignCommitSchema } from './campaign.js';
import { BackupDocumentSchema } from './operations.js';

const Identifier = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$',
});
const Timestamp = Type.String({ minLength: 1, maxLength: 64 });
const Sha256 = Type.String({ minLength: 64, maxLength: 64, pattern: '^[a-f0-9]{64}$' });
const Aliases = Type.Array(Type.String({ minLength: 1, maxLength: 160 }), { maxItems: 32, uniqueItems: true });
const Visibility = Type.Union([
  Type.Literal('known'),
  Type.Literal('narrator_secret'),
  Type.Literal('campaign_private'),
]);

export const AddonRecordKindSchema = Type.Union([
  Type.Literal('actor'),
  Type.Literal('item'),
  Type.Literal('quest'),
  Type.Literal('place'),
  Type.Literal('ability'),
  Type.Literal('relationship'),
  Type.Literal('scene'),
]);
export type AddonRecordKind = Static<typeof AddonRecordKindSchema>;

export const AddonSourceFileSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 255 }),
  sizeBytes: Type.Integer({ minimum: 0 }),
  modifiedAt: Timestamp,
  sha256: Sha256,
}, { additionalProperties: false });
export type AddonSourceFile = Static<typeof AddonSourceFileSchema>;

export const AddonIssueSchema = Type.Object({
  severity: Type.Union([Type.Literal('warning'), Type.Literal('error')]),
  code: Type.String({ minLength: 1, maxLength: 64 }),
  source: Type.String({ minLength: 1, maxLength: 255 }),
  path: Type.String({ minLength: 1, maxLength: 512 }),
  message: Type.String({ minLength: 1, maxLength: 1000 }),
}, { additionalProperties: false });
export type AddonIssue = Static<typeof AddonIssueSchema>;

export const AddonValueSchema = Type.Object({
  recordKind: AddonRecordKindSchema,
  externalId: Identifier,
  subjectId: Identifier,
  sourceFile: Type.String({ minLength: 1, maxLength: 255 }),
  name: Type.String({ minLength: 1, maxLength: 160 }),
  summary: Type.String({ maxLength: 4000 }),
  aliases: Type.Optional(Aliases),
  visibility: Type.Optional(Visibility),
  ownerActorId: Type.Optional(Identifier),
  status: Type.Optional(Type.Union([Type.Literal('active'), Type.Literal('completed')])),
  category: Type.Optional(Type.Union([Type.Literal('spell'), Type.Literal('skill'), Type.Literal('feat'), Type.Literal('other')])),
  sourceActorId: Type.Optional(Identifier),
  targetActorId: Type.Optional(Identifier),
  relationshipKind: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
  relationshipStatus: Type.Optional(Type.Union([
    Type.Literal('active'), Type.Literal('strained'), Type.Literal('dormant'), Type.Literal('ended'), Type.Literal('other'),
  ])),
  placeId: Type.Optional(Identifier),
  actorIds: Type.Optional(Type.Array(Identifier, { maxItems: 64, uniqueItems: true })),
  itemIds: Type.Optional(Type.Array(Identifier, { maxItems: 64, uniqueItems: true })),
}, { additionalProperties: false });
export type AddonValue = Static<typeof AddonValueSchema>;

export const AddonChangeSchema = Type.Object({
  change: Type.Union([Type.Literal('create'), Type.Literal('update'), Type.Literal('unchanged')]),
  before: Type.Union([AddonValueSchema, Type.Null()]),
  after: AddonValueSchema,
  changedFields: Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { maxItems: 32, uniqueItems: true }),
}, { additionalProperties: false });
export type AddonChange = Static<typeof AddonChangeSchema>;

export const AddonSourceCatalogSchema = Type.Object({
  schema: Type.Literal('st-rpg.addon-source-catalog'),
  version: Type.Literal('1.0'),
  directory: Type.String({ minLength: 1, maxLength: 1024 }),
  observedAt: Timestamp,
  manifestHash: Sha256,
  files: Type.Array(AddonSourceFileSchema, { maxItems: 512 }),
  issues: Type.Array(AddonIssueSchema, { maxItems: 512 }),
}, { additionalProperties: false });
export type AddonSourceCatalog = Static<typeof AddonSourceCatalogSchema>;

export const AddonCandidateSchema = Type.Object({
  schema: Type.Literal('st-rpg.addon-candidate'),
  version: Type.Literal('1.0'),
  id: Identifier,
  status: Type.Union([
    Type.Literal('pending'),
    Type.Literal('blocked'),
    Type.Literal('stale'),
    Type.Literal('applied'),
  ]),
  campaignId: Identifier,
  expectedRevision: Type.Integer({ minimum: 1 }),
  createdAt: Timestamp,
  directory: Type.String({ minLength: 1, maxLength: 1024 }),
  manifestHash: Sha256,
  files: Type.Array(AddonSourceFileSchema, { maxItems: 512 }),
  issues: Type.Array(AddonIssueSchema, { maxItems: 512 }),
  changes: Type.Array(AddonChangeSchema, { maxItems: 2000 }),
  canApply: Type.Boolean(),
  deletionPolicy: Type.Literal('missing-addon-rows-never-delete-campaign-records'),
  appliedRevision: Type.Optional(Type.Integer({ minimum: 1 })),
}, { additionalProperties: false });
export type AddonCandidate = Static<typeof AddonCandidateSchema>;

export const AddonCandidateCatalogSchema = Type.Object({
  schema: Type.Literal('st-rpg.addon-candidate-catalog'),
  version: Type.Literal('1.0'),
  observedAt: Timestamp,
  candidates: Type.Array(AddonCandidateSchema, { maxItems: 512 }),
}, { additionalProperties: false });
export type AddonCandidateCatalog = Static<typeof AddonCandidateCatalogSchema>;

export const PreviewAddonRequestSchema = Type.Object({
  campaignId: Identifier,
}, { additionalProperties: false });
export type PreviewAddonRequest = Static<typeof PreviewAddonRequestSchema>;

export const ApplyAddonRequestSchema = Type.Object({
  candidateId: Identifier,
  campaignId: Identifier,
  manifestHash: Sha256,
  expectedRevision: Type.Integer({ minimum: 1 }),
}, { additionalProperties: false });
export type ApplyAddonRequest = Static<typeof ApplyAddonRequestSchema>;

export const ApplyAddonReceiptSchema = Type.Object({
  schema: Type.Literal('st-rpg.addon-apply-receipt'),
  version: Type.Literal('1.0'),
  candidateId: Identifier,
  manifestHash: Sha256,
  changed: Type.Integer({ minimum: 0 }),
  appliedAt: Timestamp,
  backup: Type.Union([BackupDocumentSchema, Type.Null()]),
  commit: Type.Union([CampaignCommitSchema, Type.Null()]),
}, { additionalProperties: false });
export type ApplyAddonReceipt = Static<typeof ApplyAddonReceiptSchema>;
