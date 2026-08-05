import {
  WIRE_VERSION,
  type Problem,
  type ProblemCode,
  type RecoveryAction,
} from '@st-llm-rpg/wire';

export function makeProblem(input: {
  code: ProblemCode;
  message: string;
  requestId: string;
  retryable?: boolean;
  actions?: readonly RecoveryAction[];
  details?: unknown;
}): Problem {
  return {
    schema: 'st-rpg.problem',
    version: WIRE_VERSION,
    code: input.code,
    message: input.message,
    requestId: input.requestId,
    retryable: input.retryable ?? false,
    actions: [...(input.actions ?? [])],
    ...(input.details === undefined ? {} : { details: input.details }),
  };
}

export class ProblemError extends Error {
  readonly problem: Problem;
  readonly statusCode: number;

  constructor(problem: Problem, statusCode = 500) {
    super(problem.message);
    this.name = 'ProblemError';
    this.problem = problem;
    this.statusCode = statusCode;
  }
}
