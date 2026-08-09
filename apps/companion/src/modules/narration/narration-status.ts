import type {
  NarrationExchange,
  NarrationStatusDocument,
  NarrationStatusFinished,
  NarrationStatusRunning,
  Problem,
  RecoveryAction,
} from '@st-llm-rpg/wire';

export type NarrationStatusOutcome =
  | Readonly<{ state: 'completed' | 'cancelled'; httpStatus: number }>
  | Readonly<{ state: 'rejected' | 'failed'; httpStatus: number; problem: Problem }>;

export interface NarrationStatusHandle {
  finish(outcome: NarrationStatusOutcome): void;
}

type ActiveNarration = NarrationStatusRunning & Readonly<{ startedMs: number }>;

function statusMessage(code: Problem['code']): string {
  switch (code) {
    case 'NARRATION_EXCHANGE_INVALID':
      return 'SillyTavern sent a narration request the Companion could not validate.';
    case 'NARRATION_BRIDGE_INCOMPATIBLE':
      return 'The SillyTavern RPG bridge is incompatible with this Companion.';
    case 'NARRATION_ROUTE_REJECTED':
      return 'The Companion rejected the narration route before generation.';
    case 'NARRATION_LOCATOR_MISMATCH':
    case 'CHAT_BINDING_NOT_FOUND':
      return 'The linked chat does not match a verified Chat Binding.';
    case 'CONTEXT_CORE_OVER_BUDGET':
    case 'CONTEXT_PINS_OVER_BUDGET':
    case 'CONTEXT_STALE_PIN':
    case 'CONTEXT_PRIVATE_PIN':
    case 'CONTEXT_AUTHORITY_MISMATCH':
      return 'The Companion could not build a safe Context Plan for this reply.';
    case 'CONTEXT_MODEL_PROFILE_MISSING':
    case 'CONTEXT_MODEL_INCOMPATIBLE':
      return 'The linked narrator profile cannot run this narration request.';
    case 'NARRATION_UPSTREAM_FAILED':
      return 'The narrator model request failed before the Companion accepted a complete reply.';
    case 'NARRATION_OUTPUT_INVALID':
      return 'The narrator model returned an unusable reply.';
    case 'NARRATION_CANCELLED':
    case 'CONTEXT_CANCELLED':
      return 'The narration request was cancelled.';
    default:
      return 'The Companion could not complete the narration request.';
  }
}

function statusActions(problem: Problem): RecoveryAction[] {
  if (problem.actions.some(action => action.id === 'reduce-context')) {
    return [{ id: 'reduce-context', label: 'Reduce the SillyTavern prompt or context size, then retry.', kind: 'inspect' }];
  }
  switch (problem.code) {
    case 'NARRATION_EXCHANGE_INVALID':
    case 'NARRATION_BRIDGE_INCOMPATIBLE':
      return [{ id: 'inspect-bridge', label: 'Reload SillyTavern, then inspect the RPG Companion bridge.', kind: 'inspect' }];
    case 'NARRATION_LOCATOR_MISMATCH':
    case 'CHAT_BINDING_NOT_FOUND':
      return [{ id: 'inspect-binding', label: 'Open Chat Binding in Campaign Book and verify this chat.', kind: 'inspect' }];
    case 'CONTEXT_CORE_OVER_BUDGET':
    case 'CONTEXT_PINS_OVER_BUDGET':
    case 'CONTEXT_STALE_PIN':
    case 'CONTEXT_PRIVATE_PIN':
    case 'CONTEXT_AUTHORITY_MISMATCH':
      return [{ id: 'inspect-context', label: 'Open Context Tray, correct the flagged records or budget, then retry.', kind: 'inspect' }];
    case 'CONTEXT_MODEL_PROFILE_MISSING':
    case 'CONTEXT_MODEL_INCOMPATIBLE':
      return [{ id: 'inspect-profile', label: 'Open narrator profiles and select a compatible LM Studio model.', kind: 'inspect' }];
    case 'NARRATION_UPSTREAM_FAILED':
    case 'NARRATION_OUTPUT_INVALID':
      return [{ id: 'inspect-lm-studio', label: 'Check LM Studio on port 1234, then retry in SillyTavern.', kind: 'inspect' }];
    default:
      return [{ id: 'inspect-companion', label: 'Inspect the Companion terminal, correct the problem, then retry.', kind: 'inspect' }];
  }
}

function statusProblem(problem: Problem): Omit<Problem, 'details'> {
  return {
    schema: problem.schema,
    version: problem.version,
    code: problem.code,
    message: statusMessage(problem.code),
    requestId: problem.requestId,
    retryable: problem.retryable,
    actions: statusActions(problem),
  };
}

export class NarrationStatus {
  readonly #active = new Set<ActiveNarration>();
  #latest: NarrationStatusFinished | null = null;

  begin(exchange: NarrationExchange): NarrationStatusHandle {
    const started = new Date();
    const active: ActiveNarration = {
      requestId: exchange.requestId,
      route: exchange.route.kind,
      generation: exchange.generation,
      state: 'running',
      ...(exchange.route.kind === 'linked' ? { bindingId: exchange.route.bindingId } : {}),
      startedAt: started.toISOString(),
      startedMs: started.getTime(),
    };
    this.#active.add(active);
    let finished = false;
    return {
      finish: outcome => {
        if (finished) return;
        finished = true;
        this.finish(active, outcome);
      },
    };
  }

  rejectInvalid(requestId: string, problem: Problem, httpStatus = 400): void {
    const started = new Date();
    this.finish({
      requestId,
      route: 'invalid',
      generation: null,
      state: 'running',
      startedAt: started.toISOString(),
      startedMs: started.getTime(),
    }, { state: 'rejected', httpStatus, problem });
  }

  document(): NarrationStatusDocument {
    return {
      schema: 'st-rpg.narration-status',
      version: '1.0',
      observedAt: new Date().toISOString(),
      active: [...this.#active].slice(-16).map(({ startedMs: _startedMs, ...activity }) => activity),
      latest: this.#latest,
    };
  }

  private finish(active: ActiveNarration, outcome: NarrationStatusOutcome): void {
    const completed = new Date();
    this.#active.delete(active);
    const common = {
      requestId: active.requestId,
      route: active.route,
      generation: active.generation,
      ...(active.bindingId ? { bindingId: active.bindingId } : {}),
      startedAt: active.startedAt,
      completedAt: completed.toISOString(),
      elapsedMs: Math.max(0, completed.getTime() - active.startedMs),
      httpStatus: outcome.httpStatus,
    };
    this.#latest = outcome.state === 'failed' || outcome.state === 'rejected'
      ? { ...common, state: outcome.state, problem: statusProblem(outcome.problem) }
      : { ...common, state: outcome.state };
  }
}
