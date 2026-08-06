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

function runWorker<T>(request: WorkerRequest): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const worker = new Worker(new URL('./campaign-maintenance-worker.js', import.meta.url), {
      workerData: request,
    });
    let settled = false;
    const settle = (work: () => void) => {
      if (settled) return;
      settled = true;
      work();
    };

    worker.once('message', (message: WorkerResponse<T>) => {
      settle(() => {
        if (message.ok) {
          resolve(message.value);
          return;
        }
        if (message.code && message.statusCode) {
          reject(new CampaignExpectedError(
            message.code,
            message.message,
            message.statusCode,
            message.details,
          ));
          return;
        }
        reject(new Error(message.message));
      });
    });
    worker.once('error', error => settle(() => reject(error)));
    worker.once('exit', code => {
      if (code !== 0) settle(() => reject(new Error(`Campaign maintenance worker exited with code ${code}.`)));
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
