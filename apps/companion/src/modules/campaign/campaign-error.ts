import type { ProblemCode } from '@st-llm-rpg/wire';

export class CampaignExpectedError extends Error {
  readonly code: ProblemCode;
  readonly statusCode: number;
  readonly details: unknown | undefined;

  constructor(code: ProblemCode, message: string, statusCode: number, details?: unknown) {
    super(message);
    this.name = 'CampaignExpectedError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}
