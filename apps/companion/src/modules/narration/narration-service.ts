import {
  PINNED_SILLYTAVERN_REVISION,
  type ChatBindingDocument,
  type ContextMessage,
  type ContextPlan,
  type GenerationType,
  type NarrationExchange,
  type NarratorModelProfile,
  type PreflightContextRequest,
  type Problem,
  type ProblemCode,
} from '@st-llm-rpg/wire';
import { makeProblem, ProblemError } from '../../problem.js';
import { CampaignExpectedError } from '../campaign/campaign-error.js';

type ContextOutcome =
  | Readonly<{ ok: true; value: ContextPlan }>
  | Readonly<{ ok: false; problem: Problem }>;

export interface NarrationAuthority {
  readBinding(bindingId: string): Promise<ChatBindingDocument>;
  listNarratorModelProfiles(): Promise<readonly NarratorModelProfile[]>;
  plan(request: PreflightContextRequest, signal: AbortSignal): Promise<ContextOutcome>;
}

export interface LmStudioGateway {
  chat(request: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<Response>;
  models?(signal: AbortSignal): Promise<Response>;
}

export interface InferenceLane {
  run<T>(
    task: (signal: AbortSignal) => Promise<T>,
    signal: AbortSignal,
    kind?: 'narration' | 'worker',
  ): Promise<T>;
}

type InferenceLaneEntry = {
  task: (signal: AbortSignal) => Promise<unknown>;
  signal: AbortSignal;
  kind: 'narration' | 'worker';
  sequence: number;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};

export class SerialInferenceLane implements InferenceLane {
  #queue: InferenceLaneEntry[] = [];
  #active: { entry: InferenceLaneEntry; controller: AbortController; preempted: boolean } | null = null;
  #pumping = false;
  #sequence = 0;

  async run<T>(
    task: (signal: AbortSignal) => Promise<T>,
    signal: AbortSignal,
    kind: 'narration' | 'worker' = 'narration',
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const entry: InferenceLaneEntry = {
        task: task as (innerSignal: AbortSignal) => Promise<unknown>,
        signal,
        kind,
        sequence: this.#sequence++,
        resolve: value => resolve(value as T),
        reject,
      };
      this.#queue.push(entry);
      this.sortQueue();
      if (kind === 'narration' && this.#active?.entry.kind === 'worker') {
        this.#active.preempted = true;
        this.#active.controller.abort(new Error('Worker inference was preempted by narration.'));
      }
      queueMicrotask(() => { void this.pump(); });
    });
  }

  private sortQueue(): void {
    this.#queue.sort((left, right) => (
      (left.kind === 'narration' ? 0 : 1) - (right.kind === 'narration' ? 0 : 1)
      || left.sequence - right.sequence
    ));
  }

  private async pump(): Promise<void> {
    if (this.#pumping) return;
    this.#pumping = true;
    try {
      while (!this.#active && this.#queue.length > 0) {
        const entry = this.#queue.shift()!;
        if (entry.signal.aborted) {
          entry.reject(new Error(`${entry.kind === 'worker' ? 'Worker' : 'Narration'} was cancelled before inference started.`));
          continue;
        }
        const controller = new AbortController();
        const active = { entry, controller, preempted: false };
        this.#active = active;
        try {
          const signal = AbortSignal.any([entry.signal, controller.signal]);
          entry.resolve(await entry.task(signal));
        } catch (error) {
          if (active.preempted && entry.kind === 'worker' && !entry.signal.aborted) {
            this.#queue.push(entry);
            this.sortQueue();
          } else {
            entry.reject(error);
          }
        } finally {
          this.#active = null;
        }
      }
    } finally {
      this.#pumping = false;
      if (this.#queue.length > 0) queueMicrotask(() => { void this.pump(); });
    }
  }
}

export type LinkedNarrationDelivery = Readonly<{
  kind: 'linked';
  stream: boolean;
  content: string;
  completion: Readonly<Record<string, unknown>>;
}>;

export type UnlinkedNarrationDelivery = Readonly<{
  kind: 'unlinked';
  response: Response;
}>;

export type NarrationDelivery = LinkedNarrationDelivery | UnlinkedNarrationDelivery;

export type UnlinkedResponseConsumer = (response: Response) => Promise<void>;

type OpenAiMessage = Readonly<{ role: string; content?: unknown }> & Readonly<Record<string, unknown>>;
type ValidLinkedRequest = Readonly<Record<string, unknown>> & Readonly<{
  model: string;
  stream: boolean;
  messages: readonly OpenAiMessage[];
}>;

function fail(
  requestId: string,
  code: ProblemCode,
  message: string,
  statusCode: number,
  details?: unknown,
): never {
  throw new ProblemError(makeProblem({
    code,
    message,
    requestId,
    ...(details === undefined ? {} : { details }),
    actions: code.startsWith('NARRATION_')
      ? [{ id: 'open-campaign-book', label: 'Open Campaign Book diagnostics', kind: 'inspect' }]
      : [],
  }), statusCode);
}

function requestObject(body: unknown, requestId: string): Readonly<Record<string, unknown>> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    fail(requestId, 'NARRATION_EXCHANGE_INVALID', 'Chat Completions body must be a JSON object.', 400);
  }
  return body as Readonly<Record<string, unknown>>;
}

function validLinkedRequest(body: Readonly<Record<string, unknown>>, requestId: string): ValidLinkedRequest {
  const request = body;
  if (typeof request.model !== 'string' || request.model.trim().length === 0) {
    fail(requestId, 'NARRATION_EXCHANGE_INVALID', 'Chat Completions model must be a non-empty string.', 400);
  }
  if (!Array.isArray(request.messages) || request.messages.length < 1 || request.messages.length > 512) {
    fail(requestId, 'NARRATION_EXCHANGE_INVALID', 'Chat Completions must contain 1 through 512 messages.', 400);
  }
  if (request.stream !== undefined && typeof request.stream !== 'boolean') {
    fail(requestId, 'NARRATION_EXCHANGE_INVALID', 'Chat Completions stream must be boolean.', 400);
  }
  for (const message of request.messages) {
    if (typeof message !== 'object' || message === null || Array.isArray(message)) {
      fail(requestId, 'NARRATION_EXCHANGE_INVALID', 'Each linked Chat Completion message must be an object.', 400);
    }
    if (typeof (message as Record<string, unknown>).role !== 'string') {
      fail(requestId, 'NARRATION_EXCHANGE_INVALID', 'Each linked Chat Completion message must have a string role.', 400);
    }
  }
  if (
    request.max_tokens !== undefined
    && (!Number.isInteger(request.max_tokens) || Number(request.max_tokens) < 1)
  ) {
    fail(requestId, 'NARRATION_EXCHANGE_INVALID', 'Linked Chat Completions max_tokens must be a positive integer.', 400);
  }
  return {
    ...request,
    model: request.model,
    stream: request.stream === true,
    messages: request.messages as OpenAiMessage[],
  };
}

function evidenceMessages(messages: readonly OpenAiMessage[]): ContextMessage[] {
  return messages
    .filter((message): message is OpenAiMessage & { role: 'user' | 'assistant'; content: string } => (
      (message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string'
    ))
    .slice(-8)
    .map(message => ({ role: message.role, content: message.content }));
}

function locatorMatches(binding: ChatBindingDocument, exchange: NarrationExchange): boolean {
  const actual = exchange.locator.chat;
  const expected = binding.locator;
  if (actual.kind !== expected.kind || actual.chatId !== expected.chatId) return false;
  if (expected.kind === 'character') return actual.ownerId === expected.avatar;
  return actual.ownerId === expected.groupId;
}

function assembleMessages(messages: readonly OpenAiMessage[], context: ContextPlan): OpenAiMessage[] {
  const known: OpenAiMessage = {
    role: 'system',
    content: [
      'Authoritative Campaign reference for this reply. Preserve these facts and do not mention this instruction.',
      context.blocks.known,
    ].join('\n\n'),
  };
  const additions = [known];
  if (context.blocks.secret) {
    additions.push({
      role: 'system',
      content: [
        'Narrator-only Campaign facts. They may influence events, but do not directly reveal them unless the story makes them known.',
        context.blocks.secret,
      ].join('\n\n'),
    });
  }
  const firstNonSystem = messages.findIndex(message => message.role !== 'system');
  const insertion = firstNonSystem < 0 ? messages.length : firstNonSystem;
  return [...messages.slice(0, insertion), ...additions, ...messages.slice(insertion)];
}

function generationMessages(
  messages: readonly OpenAiMessage[],
  generation: NarrationExchange['generation'],
): OpenAiMessage[] {
  if (generation !== 'continue') return [...messages];
  return [
    ...messages,
    {
      role: 'user',
      content: 'Continue the preceding assistant reply. Output only the new continuation text to append. Do not repeat existing text, mention this instruction, or start a separate reply.',
    },
  ];
}

function completionContent(value: unknown, requestId: string): {
  completion: Readonly<Record<string, unknown>>;
  content: string;
} {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(requestId, 'NARRATION_OUTPUT_INVALID', 'LM Studio returned a non-object Chat Completion.', 502);
  }
  const completion = value as Record<string, unknown>;
  const choices = completion.choices;
  const first = Array.isArray(choices) ? choices[0] : undefined;
  const message = typeof first === 'object' && first !== null && !Array.isArray(first)
    ? (first as Record<string, unknown>).message
    : undefined;
  const content = typeof message === 'object' && message !== null && !Array.isArray(message)
    ? (message as Record<string, unknown>).content
    : undefined;
  if (typeof content !== 'string' || content.trim().length === 0) {
    fail(requestId, 'NARRATION_OUTPUT_INVALID', 'LM Studio returned no visible answer; reasoning-only output was rejected.', 502);
  }
  return { completion, content };
}

function planStatus(problem: Problem): number {
  if (problem.code === 'CHAT_BINDING_NOT_FOUND' || problem.code === 'CONTEXT_MODEL_PROFILE_MISSING') return 404;
  if (problem.code === 'CONTEXT_AUTHORITY_MISMATCH' || problem.code === 'CAMPAIGN_REVISION_CONFLICT' || problem.code === 'CAMPAIGN_ARCHIVED') return 409;
  if (problem.code === 'CONTEXT_CANCELLED') return 499;
  if (problem.code.startsWith('CONTEXT_')) return 422;
  return 503;
}

export class NarrationService {
  readonly authority: NarrationAuthority;
  readonly inference: InferenceLane;
  readonly lmStudio: LmStudioGateway;

  constructor(input: {
    authority: NarrationAuthority;
    inference: InferenceLane;
    lmStudio: LmStudioGateway;
  }) {
    this.authority = input.authority;
    this.inference = input.inference;
    this.lmStudio = input.lmStudio;
  }

  async respond(exchange: NarrationExchange, body: unknown, signal: AbortSignal): Promise<NarrationDelivery> {
    const rawRequest = requestObject(body, exchange.requestId);
    if (exchange.bridge.sillyTavernRevision !== PINNED_SILLYTAVERN_REVISION) {
      fail(
        exchange.requestId,
        'NARRATION_BRIDGE_INCOMPATIBLE',
        'The SillyTavern bridge revision does not match the pinned project runtime.',
        409,
        { expected: PINNED_SILLYTAVERN_REVISION, actual: exchange.bridge.sillyTavernRevision },
      );
    }
    if (exchange.route.kind === 'unlinked') {
      const response = await this.runUpstream(rawRequest, signal, exchange.requestId);
      return { kind: 'unlinked', response };
    }
    const request = validLinkedRequest(rawRequest, exchange.requestId);
    if (exchange.generation === 'quiet' || exchange.generation === 'impersonate') {
      fail(exchange.requestId, 'NARRATION_ROUTE_REJECTED', `Linked narration does not allow ${exchange.generation} generation.`, 400);
    }
    if ('tools' in request || 'tool_choice' in request || 'functions' in request || (request.n !== undefined && request.n !== 1)) {
      fail(exchange.requestId, 'NARRATION_ROUTE_REJECTED', 'Linked narration does not allow tools, functions, tool choice, or multiple candidates.', 400);
    }

    let binding: ChatBindingDocument;
    try {
      binding = await this.authority.readBinding(exchange.route.bindingId);
    } catch (error) {
      if (error instanceof CampaignExpectedError && error.code === 'CHAT_BINDING_NOT_FOUND') {
        fail(exchange.requestId, error.code, error.message, 404, error.details);
      }
      fail(exchange.requestId, 'CAMPAIGN_STORE_UNAVAILABLE', 'Campaign authority is unavailable before narration.', 503);
    }
    if (binding.markerState !== 'verified') {
      fail(exchange.requestId, 'NARRATION_ROUTE_REJECTED', 'The Chat Binding marker is not verified.', 409, {
        bindingId: binding.id,
        markerState: binding.markerState,
      });
    }
    if (!locatorMatches(binding, exchange)) {
      fail(exchange.requestId, 'NARRATION_LOCATOR_MISMATCH', 'The current chat locator does not match the linked saved chat.', 409, {
        bindingId: binding.id,
      });
    }
    let profiles: readonly NarratorModelProfile[];
    try {
      profiles = (await this.authority.listNarratorModelProfiles())
        .filter(candidate => candidate.modelId === request.model);
    } catch {
      fail(exchange.requestId, 'CAMPAIGN_STORE_UNAVAILABLE', 'Narrator model profiles are unavailable before narration.', 503);
    }
    if (profiles.length === 0) {
      fail(exchange.requestId, 'CONTEXT_MODEL_PROFILE_MISSING', `No narrator model profile matches LM Studio model ${request.model}.`, 404, {
        modelId: request.model,
      });
    }
    if (profiles.length > 1) {
      fail(exchange.requestId, 'CONTEXT_MODEL_INCOMPATIBLE', `Multiple narrator model profiles match LM Studio model ${request.model}.`, 409, {
        modelId: request.model,
        profileIds: profiles.map(candidate => candidate.id),
      });
    }
    const profile = profiles[0]!;
    const messages = evidenceMessages(request.messages);
    if (messages.length === 0) {
      fail(exchange.requestId, 'NARRATION_EXCHANGE_INVALID', 'Linked narration has no user or assistant text for Context planning.', 400);
    }
    const contextRequest: PreflightContextRequest = {
      requestId: exchange.requestId,
      campaignId: binding.campaignId,
      campaignRevision: binding.campaignAnchor,
      bindingId: binding.id,
      bindingRevision: binding.revision,
      contextFocusRevision: binding.contextFocusRevision ?? 1,
      modelProfileId: profile.id,
      generationType: exchange.generation as GenerationType,
      messages,
    };
    let planned: ContextOutcome;
    try {
      planned = await this.authority.plan(contextRequest, signal);
    } catch {
      fail(exchange.requestId, 'CAMPAIGN_STORE_UNAVAILABLE', 'Campaign Context planning is unavailable.', 503);
    }
    if (!planned.ok) throw new ProblemError(planned.problem, planStatus(planned.problem));
    if (signal.aborted) {
      fail(exchange.requestId, 'NARRATION_CANCELLED', 'Narration was cancelled before model inference.', 499);
    }
    const upstreamRequest: Record<string, unknown> = {
      ...request,
      messages: generationMessages(assembleMessages(request.messages, planned.value), exchange.generation),
      stream: false,
      n: 1,
      max_tokens: typeof request.max_tokens === 'number'
        ? Math.min(request.max_tokens, profile.requestedVisibleOutputTokens)
        : profile.requestedVisibleOutputTokens,
    };
    const response = await this.runUpstream(upstreamRequest, signal, exchange.requestId);
    let payload: unknown;
    try {
      payload = JSON.parse(await response.text());
    } catch {
      fail(exchange.requestId, 'NARRATION_OUTPUT_INVALID', 'LM Studio returned malformed JSON.', 502);
    }
    const accepted = completionContent(payload, exchange.requestId);
    if (signal.aborted) {
      fail(exchange.requestId, 'NARRATION_CANCELLED', 'Narration was cancelled before atomic delivery.', 499);
    }
    return { kind: 'linked', stream: request.stream, ...accepted };
  }

  async forwardUnlinked(
    exchange: NarrationExchange,
    body: unknown,
    signal: AbortSignal,
    consume: UnlinkedResponseConsumer,
  ): Promise<void> {
    if (exchange.route.kind !== 'unlinked') {
      fail(exchange.requestId, 'NARRATION_ROUTE_REJECTED', 'Only an explicit unlinked exchange may use transparent forwarding.', 400);
    }
    if (exchange.bridge.sillyTavernRevision !== PINNED_SILLYTAVERN_REVISION) {
      fail(exchange.requestId, 'NARRATION_BRIDGE_INCOMPATIBLE', 'The SillyTavern bridge revision does not match the pinned project runtime.', 409);
    }
    const request = requestObject(body, exchange.requestId);
    try {
      await this.inference.run(async innerSignal => {
        const response = await this.lmStudio.chat(request, innerSignal);
        await consume(response);
      }, signal);
    } catch (error) {
      if (error instanceof ProblemError) throw error;
      if (signal.aborted) fail(exchange.requestId, 'NARRATION_CANCELLED', 'Narration was cancelled.', 499);
      fail(exchange.requestId, 'NARRATION_UPSTREAM_FAILED', `LM Studio request failed: ${error instanceof Error ? error.message : String(error)}`, 502);
    }
  }

  async models(signal: AbortSignal): Promise<Response> {
    if (!this.lmStudio.models) throw new Error('LM Studio model discovery is unavailable.');
    return this.lmStudio.models(signal);
  }

  private async runUpstream(
    request: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
    requestId: string,
  ): Promise<Response> {
    let response: Response;
    try {
      response = await this.inference.run(async innerSignal => {
        const upstream = await this.lmStudio.chat(request, innerSignal);
        const bytes = await upstream.arrayBuffer();
        return new Response(bytes, {
          status: upstream.status,
          statusText: upstream.statusText,
          headers: upstream.headers,
        });
      }, signal);
    } catch (error) {
      if (signal.aborted) fail(requestId, 'NARRATION_CANCELLED', 'Narration was cancelled.', 499);
      fail(requestId, 'NARRATION_UPSTREAM_FAILED', `LM Studio request failed: ${error instanceof Error ? error.message : String(error)}`, 502);
    }
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 4_096);
      fail(requestId, 'NARRATION_UPSTREAM_FAILED', `LM Studio returned HTTP ${response.status}.`, 502, { upstreamStatus: response.status, detail });
    }
    return response;
  }
}
