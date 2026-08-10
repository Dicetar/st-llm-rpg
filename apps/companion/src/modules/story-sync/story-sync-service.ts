import { randomUUID } from 'node:crypto';
import { Value } from '@sinclair/typebox/value';
import {
  CampaignOperationSchema,
  type CampaignDocument,
  type ChatBindingDocument,
  type DecideStorySyncProposalRequest,
  type StartStorySyncJobRequest,
  type StorySyncJobDocument,
  type StorySyncJobReceipt,
  type StorySyncProposal,
  type WorkerModelProfile,
} from '@st-llm-rpg/wire';
import type {
  InferenceLane,
  LmStudioGateway,
} from '../narration/narration-service.js';
import { CampaignExpectedError } from '../campaign/campaign-error.js';
import { canonicalJson, sha256 } from '../campaign/campaign-state.js';
import type {
  StorySyncJournal,
  StoredStorySyncSource,
} from './story-sync-journal.js';

const MAX_SOURCE_MESSAGES = 12;
const MAX_SOURCE_CHARACTERS = 14_000;
const PROFILE_ID = 'worker-default';

export interface StorySyncAuthority {
  readBinding(bindingId: string): Promise<ChatBindingDocument>;
  readCampaign(campaignId: string, revision: number): Promise<CampaignDocument>;
  readCampaignRevision(campaignId: string): Promise<number>;
}

type ParsedProposal = Omit<StorySyncProposal, 'jobId'>;

function locatorMatches(binding: ChatBindingDocument, request: StartStorySyncJobRequest): boolean {
  const expected = binding.locator;
  const actual = request.locator.chat;
  if (expected.kind !== actual.kind || expected.chatId !== actual.chatId) return false;
  return actual.ownerId === (expected.kind === 'character' ? expected.avatar : expected.groupId);
}

function sourceFor(binding: ChatBindingDocument, request: StartStorySyncJobRequest): Readonly<{
  source: StoredStorySyncSource;
  fingerprint: string;
  endPrefixHash: string;
}> {
  const boundary = binding.syncBoundary ?? { throughMessageIndex: -1, prefixHash: sha256('') };
  const pending = request.messages
    .filter(message => message.index > boundary.throughMessageIndex)
    .sort((left, right) => left.index - right.index)
    .slice(0, MAX_SOURCE_MESSAGES);
  if (pending.length === 0) {
    throw new CampaignExpectedError('STORY_SYNC_SOURCE_EMPTY', 'There are no new chat messages after this Binding\'s Sync Boundary.');
  }
  if (pending[0]!.index !== boundary.throughMessageIndex + 1) {
    throw new CampaignExpectedError(
      'STORY_SYNC_SOURCE_NOT_CONTIGUOUS',
      'The captured chat range does not begin immediately after the Sync Boundary.',
    );
  }
  for (let index = 1; index < pending.length; index += 1) {
    if (pending[index]!.index !== pending[index - 1]!.index + 1) {
      throw new CampaignExpectedError('STORY_SYNC_SOURCE_NOT_CONTIGUOUS', 'The captured chat range contains a message gap.');
    }
  }
  let remaining = MAX_SOURCE_CHARACTERS;
  const messages: StoredStorySyncSource['messages'][number][] = [];
  for (const message of pending) {
    if (remaining <= 0) break;
    const content = message.content.replaceAll('\0', '').trim().slice(0, remaining);
    if (!content) continue;
    remaining -= content.length;
    messages.push({
      index: message.index,
      role: message.role,
      name: message.name.trim().slice(0, 160),
      content,
      contentHash: sha256(content),
    });
  }
  if (messages.length === 0) {
    throw new CampaignExpectedError('STORY_SYNC_SOURCE_EMPTY', 'The captured chat range contains no visible text.');
  }
  const compact = messages.map(({ index, role, name, contentHash }) => ({ index, role, name, contentHash }));
  const endPrefixHash = sha256({ previous: boundary.prefixHash, messages: compact });
  const source: StoredStorySyncSource = {
    locator: request.locator,
    boundary,
    messages,
  };
  return {
    source,
    endPrefixHash,
    fingerprint: sha256({ bindingId: binding.id, locator: request.locator, boundary, messages: compact }),
  };
}

function visibleContent(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return '';
  const choices = (payload as Record<string, unknown>).choices;
  const first = Array.isArray(choices) ? choices[0] : null;
  const message = first && typeof first === 'object' && !Array.isArray(first)
    ? (first as Record<string, unknown>).message
    : null;
  const content = message && typeof message === 'object' && !Array.isArray(message)
    ? (message as Record<string, unknown>).content
    : null;
  return typeof content === 'string' ? content.trim() : '';
}

function jsonObject(raw: string): unknown {
  const unfenced = raw.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '');
  const first = unfenced.indexOf('{');
  const last = unfenced.lastIndexOf('}');
  if (first < 0 || last <= first) throw new Error('Worker returned no JSON object.');
  return JSON.parse(unfenced.slice(first, last + 1));
}

function parseProposals(raw: string, source: StoredStorySyncSource): ParsedProposal[] {
  const document = jsonObject(raw);
  if (typeof document !== 'object' || document === null || !Array.isArray((document as Record<string, unknown>).proposals)) {
    throw new Error('Worker JSON has no proposals array.');
  }
  return ((document as { proposals: unknown[] }).proposals).slice(0, 30).map((candidate, ordinal) => {
    const record = candidate && typeof candidate === 'object' && !Array.isArray(candidate)
      ? candidate as Record<string, unknown>
      : {};
    const operation = Value.Check(CampaignOperationSchema, record.operation) ? record.operation : null;
    const evidence = Array.isArray(record.evidence)
      ? [...new Set(record.evidence.filter(index => Number.isInteger(index)).map(Number))].slice(0, 8)
      : [];
    const links = evidence.flatMap(messageIndex => {
      const message = source.messages.find(entry => entry.index === messageIndex);
      return message ? [{ messageIndex, excerpt: message.content.slice(0, 240) }] : [];
    });
    const confidence = ['high', 'medium', 'low'].includes(String(record.confidence))
      ? String(record.confidence) as StorySyncProposal['confidence']
      : 'low';
    const title = String(record.title ?? (operation ? operation.kind : `Proposal ${ordinal + 1}`)).trim().slice(0, 512)
      || `Proposal ${ordinal + 1}`;
    return {
      id: `proposal-${randomUUID()}`,
      ordinal,
      revision: 1,
      decision: 'pending',
      draft: {
        title,
        operation,
        note: String(record.note ?? '').slice(0, 2_000),
      },
      sourceLinks: links,
      validationProblems: operation ? [] : ['The worker did not provide a valid typed Campaign Operation. Edit or reject this Proposal.'],
      confidence,
    };
  });
}

function workerMessages(campaign: CampaignDocument, source: StoredStorySyncSource) {
  const transcript = source.messages.map(message => (
    `[message ${message.index}] ${message.role.toUpperCase()} (${message.name}):\n${message.content}`
  )).join('\n\n');
  return [
    {
      role: 'system',
      content: [
        'Analyze the bounded RPG chat transcript for explicit durable changes.',
        'Return only one JSON object: {"proposals":[{"title":"...","operation":{...},"evidence":[0],"confidence":"high|medium|low"}]}.',
        'Each operation must be one exact Campaign Operation. Do not invent events, infer uncertain changes, or apply anything.',
        'Allowed operation kinds are create_actor, update_actor, create_item, update_item, create_quest, update_quest, create_place, update_place, and set_current_scene.',
        'Use existing stable IDs from the Campaign document. An empty proposals array is valid.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `Pinned Campaign document:\n${canonicalJson(campaign)}\n\nUntrusted bounded transcript:\n${transcript}`,
    },
  ];
}

export class StorySyncService {
  readonly #journal: StorySyncJournal;
  readonly #authority: StorySyncAuthority;
  readonly #inference: InferenceLane;
  readonly #lmStudio: LmStudioGateway;
  readonly #controllers = new Map<string, AbortController>();
  readonly #running = new Set<Promise<void>>();

  constructor(input: Readonly<{
    journal: StorySyncJournal;
    authority: StorySyncAuthority;
    inference: InferenceLane;
    lmStudio: LmStudioGateway;
  }>) {
    this.#journal = input.journal;
    this.#authority = input.authority;
    this.#inference = input.inference;
    this.#lmStudio = input.lmStudio;
  }

  async saveProfile(input: Readonly<{ modelId: string; requestedOutputTokens: number }>): Promise<WorkerModelProfile> {
    return this.#journal.saveWorkerModelProfile({
      schema: 'st-rpg.worker-model-profile',
      version: '1.0',
      id: PROFILE_ID,
      modelId: input.modelId.trim(),
      requestedOutputTokens: input.requestedOutputTokens,
      updatedAt: new Date().toISOString(),
    });
  }

  profiles(): Promise<readonly WorkerModelProfile[]> {
    return this.#journal.listWorkerModelProfiles();
  }

  async start(request: StartStorySyncJobRequest): Promise<StorySyncJobReceipt> {
    const binding = await this.#authority.readBinding(request.bindingId);
    if (binding.markerState !== 'verified') {
      throw new CampaignExpectedError('STORY_SYNC_SOURCE_PROOF_MISMATCH', 'The Chat Binding marker is not verified.');
    }
    if (!locatorMatches(binding, request)) {
      throw new CampaignExpectedError('STORY_SYNC_SOURCE_PROOF_MISMATCH', 'The captured chat does not match this Chat Binding.');
    }
    const campaignHead = await this.#authority.readCampaignRevision(binding.campaignId);
    if (campaignHead !== binding.campaignAnchor) {
      throw new CampaignExpectedError(
        'CAMPAIGN_REVISION_CONFLICT',
        'The Chat Binding Campaign Anchor is behind current Campaign truth. Follow or branch before Story Sync.',
        { campaignAnchor: binding.campaignAnchor, campaignHead },
      );
    }
    await this.#journal.readWorkerModelProfile(request.profileId);
    const prepared = sourceFor(binding, request);
    const jobId = `job-${randomUUID()}`;
    const createdAt = new Date().toISOString();
    const job = await this.#journal.createStorySyncJob({
      jobId,
      requestId: request.requestId,
      campaignId: binding.campaignId,
      bindingId: binding.id,
      profileId: request.profileId,
      campaignAnchor: binding.campaignAnchor,
      bindingRevision: binding.revision,
      syncFacetRevision: binding.syncFacetRevision ?? 1,
      source: prepared.source,
      sourceFingerprint: prepared.fingerprint,
      sourceEndPrefixHash: prepared.endPrefixHash,
      sourceFirstMessageIndex: prepared.source.messages[0]!.index,
      sourceLastMessageIndex: prepared.source.messages.at(-1)!.index,
      createdAt,
    });
    this.schedule(job.id);
    return {
      schema: 'st-rpg.story-sync-job-receipt',
      version: '1.0',
      jobId: job.id,
      campaignId: job.campaignId,
      status: job.status,
    };
  }

  read(jobId: string): Promise<StorySyncJobDocument> {
    return this.#journal.readStorySyncJob(jobId);
  }

  list(campaignId: string): Promise<readonly StorySyncJobDocument[]> {
    return this.#journal.listStorySyncJobs(campaignId);
  }

  decide(proposalId: string, request: DecideStorySyncProposalRequest): Promise<StorySyncJobDocument> {
    return this.#journal.decideStorySyncProposal(proposalId, request);
  }

  async close(): Promise<void> {
    for (const controller of this.#controllers.values()) controller.abort();
    await Promise.allSettled(this.#running);
  }

  private schedule(jobId: string): void {
    const task = this.run(jobId);
    this.#running.add(task);
    void task.finally(() => this.#running.delete(task));
  }

  private async run(jobId: string): Promise<void> {
    const controller = new AbortController();
    this.#controllers.set(jobId, controller);
    const attemptId = `attempt-${randomUUID()}`;
    try {
      await this.#journal.beginStorySyncAttempt(jobId, attemptId, new Date().toISOString());
      const job = await this.#journal.readStorySyncJob(jobId);
      const profile = await this.#journal.readWorkerModelProfile(job.profileId);
      const campaign = await this.#authority.readCampaign(job.campaignId, job.campaignAnchor);
      const source = await this.source(jobId);
      const raw = await this.infer({
        model: profile.modelId,
        max_tokens: profile.requestedOutputTokens,
        stream: false,
        n: 1,
        temperature: 0.1,
        messages: workerMessages(campaign, source),
      }, controller.signal);
      await this.#journal.setStorySyncJobStatus(jobId, 'parsing');
      let proposals: ParsedProposal[];
      let acceptedRaw = raw;
      let repaired = false;
      try {
        proposals = parseProposals(raw, source);
      } catch {
        repaired = true;
        await this.#journal.setStorySyncJobStatus(jobId, 'repairing');
        acceptedRaw = await this.infer({
          model: profile.modelId,
          max_tokens: profile.requestedOutputTokens,
          stream: false,
          n: 1,
          temperature: 0,
          messages: [
            { role: 'system', content: 'Repair the input into one valid JSON object with a proposals array. Return JSON only. Do not add facts.' },
            { role: 'user', content: raw.slice(0, 9_000) },
          ],
        }, controller.signal);
        proposals = parseProposals(acceptedRaw, source);
      }
      await this.#journal.completeStorySyncAttempt({
        jobId,
        attemptId,
        outputHash: sha256(acceptedRaw),
        proposals,
        repaired,
        completedAt: new Date().toISOString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        await this.#journal.failStorySyncAttempt({
          jobId,
          attemptId,
          code: controller.signal.aborted ? 'STORY_SYNC_CANCELLED' : 'STORY_SYNC_OUTPUT_UNUSABLE',
          message: controller.signal.aborted ? 'Story Sync stopped before Proposals were saved.' : message,
          completedAt: new Date().toISOString(),
        });
      } catch {
        // A concurrent shutdown may close SQLite after cancellation. Startup recovery owns that case.
      }
    } finally {
      this.#controllers.delete(jobId);
    }
  }

  private async source(jobId: string): Promise<StoredStorySyncSource> {
    return this.#journal.readStorySyncSource(jobId);
  }

  private async infer(request: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<string> {
    return this.#inference.run(async innerSignal => {
      const response = await this.#lmStudio.chat(request, innerSignal);
      if (!response.ok) throw new Error(`LM Studio returned HTTP ${response.status}.`);
      const payload = JSON.parse(await response.text()) as unknown;
      const content = visibleContent(payload);
      if (!content) throw new Error('Worker returned no visible answer. Use a non-thinking worker model.');
      return content;
    }, signal, 'worker');
  }
}
