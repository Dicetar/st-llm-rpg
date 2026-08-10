import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

const Identifier = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$',
});
const Fingerprint = Type.String({ minLength: 64, maxLength: 64, pattern: '^[a-f0-9]{64}$' });
const Timestamp = Type.String({ minLength: 1, maxLength: 64 });
const Title = Type.String({ minLength: 1, maxLength: 160 });

export const LegacyChatLocatorSchema = Type.Union([
  Type.Object({
    kind: Type.Literal('character'),
    chatId: Type.String({ minLength: 1, maxLength: 512 }),
    avatar: Type.String({ minLength: 1, maxLength: 512 }),
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal('group'),
    chatId: Type.String({ minLength: 1, maxLength: 512 }),
    groupId: Type.String({ minLength: 1, maxLength: 512 }),
  }, { additionalProperties: false }),
]);
export type LegacyChatLocator = Static<typeof LegacyChatLocatorSchema>;

export const LegacyChatListItemSchema = Type.Object({
  locator: LegacyChatLocatorSchema,
  title: Type.String({ minLength: 1, maxLength: 512 }),
  fileSize: Type.String({ maxLength: 64 }),
  messageCount: Type.Integer({ minimum: 0 }),
  lastModified: Type.Union([Timestamp, Type.Number({ minimum: 0 })]),
  hasLegacyCampaign: Type.Boolean(),
  legacyRevision: Type.Optional(Type.Integer({ minimum: 1 })),
}, { additionalProperties: false });
export type LegacyChatListItem = Static<typeof LegacyChatListItemSchema>;

export const LegacyImportIssueSchema = Type.Object({
  severity: Type.Union([Type.Literal('warning'), Type.Literal('error')]),
  code: Type.String({ minLength: 1, maxLength: 64 }),
  path: Type.String({ minLength: 1, maxLength: 512 }),
  message: Type.String({ minLength: 1, maxLength: 512 }),
}, { additionalProperties: false });
export type LegacyImportIssue = Static<typeof LegacyImportIssueSchema>;

export const LegacyImportDecisionSchema = Type.Union([
  Type.Literal('create-campaign'),
  Type.Literal('link-existing'),
  Type.Literal('create-independent-import'),
  Type.Literal('open-existing'),
  Type.Literal('cancel'),
]);
export type LegacyImportDecision = Static<typeof LegacyImportDecisionSchema>;

export const LegacyImportPreviewSchema = Type.Object({
  schema: Type.Literal('st-rpg.legacy-import-preview'),
  version: Type.Literal('1.0'),
  kind: Type.Union([
    Type.Literal('new-import'),
    Type.Literal('already-imported'),
    Type.Literal('copied-source'),
    Type.Literal('divergent-source'),
    Type.Literal('invalid-source'),
  ]),
  locator: LegacyChatLocatorSchema,
  sourceFingerprint: Fingerprint,
  contentFingerprint: Fingerprint,
  title: Title,
  legacyRevision: Type.Integer({ minimum: 1 }),
  counts: Type.Object({
    actors: Type.Integer({ minimum: 0 }),
    items: Type.Integer({ minimum: 0 }),
    quests: Type.Integer({ minimum: 0 }),
    places: Type.Integer({ minimum: 0 }),
    abilities: Type.Integer({ minimum: 0 }),
    learnedAbilities: Type.Integer({ minimum: 0 }),
    relationships: Type.Integer({ minimum: 0 }),
    unsupported: Type.Integer({ minimum: 0 }),
  }, { additionalProperties: false }),
  issues: Type.Array(LegacyImportIssueSchema, { maxItems: 512 }),
  decisions: Type.Array(LegacyImportDecisionSchema, { minItems: 1, maxItems: 5, uniqueItems: true }),
  existingCampaignId: Type.Optional(Identifier),
  existingBindingId: Type.Optional(Identifier),
  legacyMetadataPreserved: Type.Literal(true),
}, { additionalProperties: false });
export type LegacyImportPreview = Static<typeof LegacyImportPreviewSchema>;

export const PreviewLegacyImportRequestSchema = Type.Object({
  locator: LegacyChatLocatorSchema,
}, { additionalProperties: false });
export type PreviewLegacyImportRequest = Static<typeof PreviewLegacyImportRequestSchema>;

export const ApplyLegacyImportRequestSchema = Type.Object({
  requestId: Identifier,
  locator: LegacyChatLocatorSchema,
  sourceFingerprint: Fingerprint,
  decision: Type.Union([
    Type.Literal('create-campaign'),
    Type.Literal('link-existing'),
    Type.Literal('create-independent-import'),
  ]),
  title: Type.Optional(Title),
}, { additionalProperties: false });
export type ApplyLegacyImportRequest = Static<typeof ApplyLegacyImportRequestSchema>;

export const CreateChatBindingRequestSchema = Type.Object({
  requestId: Identifier,
  expectedCampaignRevision: Type.Integer({ minimum: 1 }),
  locator: LegacyChatLocatorSchema,
}, { additionalProperties: false });
export type CreateChatBindingRequest = Static<typeof CreateChatBindingRequestSchema>;

export const ChatBindingDocumentSchema = Type.Object({
  schema: Type.Literal('st-rpg.chat-binding'),
  version: Type.Literal('1.0'),
  id: Identifier,
  campaignId: Identifier,
  revision: Type.Integer({ minimum: 1 }),
  campaignAnchor: Type.Integer({ minimum: 1 }),
  contextFocusRevision: Type.Optional(Type.Integer({ minimum: 1 })),
  pins: Type.Optional(Type.Array(Identifier, { maxItems: 128, uniqueItems: true })),
  syncFacetRevision: Type.Optional(Type.Integer({ minimum: 1 })),
  syncBoundary: Type.Optional(Type.Object({
    throughMessageIndex: Type.Integer({ minimum: -1 }),
    prefixHash: Fingerprint,
  }, { additionalProperties: false })),
  locator: LegacyChatLocatorSchema,
  sourceFingerprint: Fingerprint,
  contentFingerprint: Fingerprint,
  markerState: Type.Union([
    Type.Literal('pending'),
    Type.Literal('verified'),
    Type.Literal('blocked'),
  ]),
  markerProblem: Type.Optional(Type.String({ minLength: 1, maxLength: 1024 })),
  createdAt: Timestamp,
  updatedAt: Timestamp,
}, { additionalProperties: false });
export type ChatBindingDocument = Static<typeof ChatBindingDocumentSchema>;

export const LegacyImportResultSchema = Type.Object({
  schema: Type.Literal('st-rpg.legacy-import-result'),
  version: Type.Literal('1.0'),
  kind: Type.Union([
    Type.Literal('imported'),
    Type.Literal('already-imported'),
    Type.Literal('linked-existing'),
  ]),
  campaignId: Identifier,
  campaignRevision: Type.Integer({ minimum: 1 }),
  binding: ChatBindingDocumentSchema,
  backupPath: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
  legacyMetadataPreserved: Type.Literal(true),
}, { additionalProperties: false });
export type LegacyImportResult = Static<typeof LegacyImportResultSchema>;

export function isLegacyImportPreview(value: unknown): value is LegacyImportPreview {
  return Value.Check(LegacyImportPreviewSchema, value);
}

export function isChatBindingDocument(value: unknown): value is ChatBindingDocument {
  return Value.Check(ChatBindingDocumentSchema, value);
}

export function isLegacyImportResult(value: unknown): value is LegacyImportResult {
  return Value.Check(LegacyImportResultSchema, value);
}
