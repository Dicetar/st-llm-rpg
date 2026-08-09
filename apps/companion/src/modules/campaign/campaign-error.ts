import type { ProblemCode } from '@st-llm-rpg/wire';

export class CampaignExpectedError extends Error {
  readonly code: ProblemCode;
  readonly details: unknown | undefined;

  constructor(code: ProblemCode, message: string, details?: unknown) {
    super(message);
    this.name = 'CampaignExpectedError';
    this.code = code;
    this.details = details;
  }
}
