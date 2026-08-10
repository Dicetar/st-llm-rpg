import { Type, type Static } from '@sinclair/typebox';
import { CampaignVerificationResultSchema } from './campaign.js';

const Identifier = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$',
});
const Timestamp = Type.String({ minLength: 1, maxLength: 64 });
const Sha256 = Type.String({ minLength: 64, maxLength: 64, pattern: '^[a-f0-9]{64}$' });

export const BackupKindSchema = Type.Union([
  Type.Literal('daily'),
  Type.Literal('pre-operation'),
  Type.Literal('explicit'),
]);
export type BackupKind = Static<typeof BackupKindSchema>;

export const BackupDocumentSchema = Type.Object({
  schema: Type.Literal('st-rpg.backup'),
  version: Type.Literal('1.0'),
  id: Identifier,
  kind: BackupKindSchema,
  label: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
  createdAt: Timestamp,
  fileName: Type.String({ minLength: 1, maxLength: 255 }),
  sizeBytes: Type.Integer({ minimum: 1 }),
  sha256: Sha256,
  availability: Type.Union([
    Type.Literal('available'),
    Type.Literal('missing'),
    Type.Literal('changed'),
  ]),
  verification: CampaignVerificationResultSchema,
}, { additionalProperties: false });
export type BackupDocument = Static<typeof BackupDocumentSchema>;

export const BackupCatalogSchema = Type.Object({
  schema: Type.Literal('st-rpg.backup-catalog'),
  version: Type.Literal('1.0'),
  observedAt: Timestamp,
  automaticDailyHealthy: Type.Boolean(),
  backups: Type.Array(BackupDocumentSchema, { maxItems: 512 }),
  problems: Type.Array(Type.Object({
    source: Type.String({ minLength: 1, maxLength: 255 }),
    message: Type.String({ minLength: 1, maxLength: 512 }),
  }, { additionalProperties: false }), { maxItems: 128 }),
}, { additionalProperties: false });
export type BackupCatalog = Static<typeof BackupCatalogSchema>;

export const CreateBackupRequestSchema = Type.Object({
  label: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
}, { additionalProperties: false });
export type CreateBackupRequest = Static<typeof CreateBackupRequestSchema>;

export const RestoreBackupPreviewSchema = Type.Object({
  schema: Type.Literal('st-rpg.restore-preview'),
  version: Type.Literal('1.0'),
  backup: BackupDocumentSchema,
  currentAuthority: CampaignVerificationResultSchema,
  restoreToken: Sha256,
}, { additionalProperties: false });
export type RestoreBackupPreview = Static<typeof RestoreBackupPreviewSchema>;

export const RestoreBackupRequestSchema = Type.Object({
  restoreToken: Sha256,
}, { additionalProperties: false });
export type RestoreBackupRequest = Static<typeof RestoreBackupRequestSchema>;

export const RestoreBackupReceiptSchema = Type.Object({
  schema: Type.Literal('st-rpg.restore-receipt'),
  version: Type.Literal('1.0'),
  backupId: Identifier,
  safetyBackupId: Identifier,
  restoredAt: Timestamp,
  verification: CampaignVerificationResultSchema,
}, { additionalProperties: false });
export type RestoreBackupReceipt = Static<typeof RestoreBackupReceiptSchema>;
