import type {
  CampaignDocument,
  CampaignVerificationResult,
  ProblemCode,
} from '@st-llm-rpg/wire';

export type CampaignSnapshotCandidate = Readonly<{
  campaignId: string;
  revision: number;
  stateJson: string;
  stateHash: string;
  eventHash: string;
  createdAt: string;
}>;

export type CampaignMaintenanceRequest =
  | Readonly<{ action: 'verify'; databasePath: string }>
  | Readonly<{ action: 'read-revision'; databasePath: string; campaignId: string; revision: number }>
  | Readonly<{ action: 'build-snapshot'; databasePath: string; campaignId: string; revision: number }>;

export type CampaignMaintenanceValue =
  | CampaignVerificationResult
  | CampaignDocument
  | CampaignSnapshotCandidate;

export type CampaignMaintenanceResponse<T extends CampaignMaintenanceValue = CampaignMaintenanceValue> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{
      ok: false;
      message: string;
      code?: ProblemCode;
      details?: unknown;
    }>;
