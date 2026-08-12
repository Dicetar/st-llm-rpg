import type { Problem } from '@st-llm-rpg/wire';
import { createUuid } from './browser-uuid.js';

export type RevisionConflict = Readonly<{
  campaignId: string;
  expectedRevision: number;
  actualRevision: number | null;
}>;

export class ApiProblem extends Error {
  readonly problem: Problem | null;

  constructor(message: string, problem: Problem | null) {
    super(message);
    this.name = 'ApiProblem';
    this.problem = problem;
  }
}

export async function fetchJson<T>(path: string, signal?: AbortSignal, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  const response = await fetch(path, {
    ...init,
    ...(signal === undefined ? {} : { signal }),
    headers,
  });
  const body = await response.json().catch(() => null) as T | Problem | null;
  if (!response.ok) {
    const problem = body && typeof body === 'object' && 'schema' in body && body.schema === 'st-rpg.problem'
      ? body as Problem
      : null;
    throw new ApiProblem(problem?.message ?? `${path} returned HTTP ${response.status}`, problem);
  }
  return body as T;
}

export function newRequestId(): string {
  return createUuid();
}

export function conflictFrom(
  problem: Problem | null,
  campaignId: string,
  expectedRevision: number,
): RevisionConflict | null {
  if (problem?.code !== 'CAMPAIGN_REVISION_CONFLICT') return null;
  const details = problem.details && typeof problem.details === 'object'
    ? problem.details as Record<string, unknown>
    : null;
  const actual = details && typeof details.actualRevision === 'number' ? details.actualRevision : null;
  return { campaignId, expectedRevision, actualRevision: actual };
}
