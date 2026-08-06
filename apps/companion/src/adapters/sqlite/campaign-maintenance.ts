import { Worker } from 'node:worker_threads';
import type { CampaignDocument, CampaignVerificationResult, ProblemCode } from '@st-llm-rpg/wire';
import { CampaignExpectedError } from '../../modules/campaign/campaign-error.js';

type WorkerRequest =
  | Readonly<{ action: 'verify'; databasePath: string }>
  | Readonly<{ action: 'read-revision'; databasePath: string; campaignId: string; revision: number }>;

type WorkerResponse<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{
      ok: false;
      message: string;
      code?: ProblemCode;
      statusCode?: number;
      details?: unknown;
    }>;

function resolveWorkerResponse<T>(message: WorkerResponse<T>): T {
  if (message.ok) return message.value;
  if (message.code && message.statusCode) {
    throw new CampaignExpectedError(
      message.code,
      message.message,
      message.statusCode,
      message.details,
    );
  }
  throw new Error(message.message);
}

function runWorker<T>(request: WorkerRequest): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const sourceMode = import.meta.url.endsWith('.ts');
    const workerUrl = new URL(
      sourceMode ? './campaign-maintenance-worker.ts' : './campaign-maintenance-worker.js',
      import.meta.url,
    );
    const worker = new Worker(workerUrl, { workerData: request });
    let response: WorkerResponse<T> | undefined;
    let workerError: Error | undefined;

    worker.once('message', (message: WorkerResponse<T>) => {
      response = message;
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
