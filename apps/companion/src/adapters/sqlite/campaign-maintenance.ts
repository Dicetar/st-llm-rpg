import { Worker } from 'node:worker_threads';
import type { CampaignDocument, CampaignVerificationResult } from '@st-llm-rpg/wire';
import { CampaignExpectedError } from '../../modules/campaign/campaign-error.js';
import type {
  CampaignMaintenanceRequest,
  CampaignMaintenanceResponse,
  CampaignMaintenanceValue,
  CampaignSnapshotCandidate,
} from './campaign-maintenance-protocol.js';
export type { CampaignSnapshotCandidate } from './campaign-maintenance-protocol.js';

function resolveWorkerResponse<T extends CampaignMaintenanceValue>(message: CampaignMaintenanceResponse<T>): T {
  if (message.ok) return message.value;
  if (message.code) {
    throw new CampaignExpectedError(
      message.code,
      message.message,
      message.details,
    );
  }
  throw new Error(message.message);
}

function isWorkerResponse(message: unknown): message is CampaignMaintenanceResponse {
  if (typeof message !== 'object' || message === null || !('ok' in message)) return false;
  if (message.ok === true) return 'value' in message;
  return message.ok === false && 'message' in message && typeof message.message === 'string';
}

function runWorker<T extends CampaignMaintenanceValue>(request: CampaignMaintenanceRequest): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const sourceMode = import.meta.url.endsWith('.ts');
    const workerUrl = new URL(
      sourceMode ? './campaign-maintenance-worker.ts' : './campaign-maintenance-worker.js',
      import.meta.url,
    );
    const worker = new Worker(workerUrl, { workerData: request });
    let response: CampaignMaintenanceResponse<T> | undefined;
    let workerError: Error | undefined;

    worker.once('message', (message: unknown) => {
      if (!isWorkerResponse(message)) {
        workerError = new Error('Campaign maintenance worker returned a malformed response.');
        return;
      }
      response = message as CampaignMaintenanceResponse<T>;
    });
    worker.once('error', error => {
      workerError = error;
    });
    worker.once('exit', code => {
      if (workerError) {
        reject(workerError);
        return;
      }
      if (code !== 0) {
        reject(new Error(`Campaign maintenance worker exited with code ${code}.`));
        return;
      }
      if (!response) {
        reject(new Error('Campaign maintenance worker exited without a response.'));
        return;
      }
      try {
        resolve(resolveWorkerResponse(response));
      } catch (error) {
        reject(error);
      }
    });
  });
}

export function verifyCampaignAuthorityInWorker(databasePath: string): Promise<CampaignVerificationResult> {
  return runWorker<CampaignVerificationResult>({ action: 'verify', databasePath });
}

export function readCampaignRevisionInWorker(
  databasePath: string,
  campaignId: string,
  revision: number,
): Promise<CampaignDocument> {
  return runWorker<CampaignDocument>({ action: 'read-revision', databasePath, campaignId, revision });
}

export function buildCampaignSnapshotInWorker(
  databasePath: string,
  campaignId: string,
  revision: number,
): Promise<CampaignSnapshotCandidate> {
  return runWorker<CampaignSnapshotCandidate>({ action: 'build-snapshot', databasePath, campaignId, revision });
}
