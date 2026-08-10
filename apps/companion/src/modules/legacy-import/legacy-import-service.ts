import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type {
  ApplyLegacyImportRequest,
  CampaignSummary,
  ChatBindingDocument,
  CreateChatBindingRequest,
  FollowCampaignHeadRequest,
  LegacyChatListItem,
  LegacyChatLocator,
  LegacyImportPreview,
  LegacyImportResult,
  Problem,
} from '@st-llm-rpg/wire';
import { makeProblem } from '../../problem.js';
import type { Outcome } from '../campaign/campaign-engine.js';
import { CampaignExpectedError } from '../campaign/campaign-error.js';
import {
  canonicalJson,
  sha256,
  subjectEventHash,
  type CampaignState,
} from '../campaign/campaign-state.js';
import { inspectLegacyEnvelope, type LegacyEnvelopeInspection } from './legacy-envelope.js';
import type {
  LegacyBindingMarker,
  LegacyChatSnapshot,
  LegacyImportJournal,
  LegacyImportLookup,
  LegacySourceMarkerResult,
} from './legacy-import-journal.js';

export type { LegacyChatSnapshot } from './legacy-import-journal.js';

export interface LegacyChatSource {
  list(): Promise<readonly LegacyChatListItem[]>;
  read(locator: LegacyChatLocator): Promise<LegacyChatSnapshot>;
  writeMarker(snapshot: LegacyChatSnapshot, marker: LegacyBindingMarker): Promise<LegacySourceMarkerResult>;
}

export class LegacyChatSourceExpectedError extends Error {
  readonly code: 'LEGACY_METADATA_NOT_FOUND';

  constructor(code: 'LEGACY_METADATA_NOT_FOUND', message: string) {
    super(message);
    this.code = code;
  }
}

type PreparedPreview = Readonly<{
  snapshot: LegacyChatSnapshot;
  inspection: LegacyEnvelopeInspection;
  preview: LegacyImportPreview;
  lookup: LegacyImportLookup;
  contentFingerprint: string;
  sourceFingerprint: string;
  locatorFingerprint: string;
}>;

class LegacySourceFailure extends Error {
  override readonly cause: unknown;

  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.cause = cause;
  }
}

class LegacyJournalFailure extends Error {
  override readonly cause: unknown;

  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.cause = cause;
  }
}

function failure(requestId: string, code: Problem['code'], message: string, details?: unknown): Outcome<never> {
  return {
    ok: false,
    problem: makeProblem({
      code,
      message,
      requestId,
      actions: code === 'LEGACY_IMPORT_STALE'
        ? [{ id: 'preview-again', label: 'Preview the saved chat again', kind: 'retry' }]
        : [{ id: 'inspect-source', label: 'Inspect the saved chat and fallback Campaign', kind: 'inspect' }],
      ...(details === undefined ? {} : { details }),
    }),
  };
}

function decisionsFor(kind: LegacyImportPreview['kind']): LegacyImportPreview['decisions'] {
  if (kind === 'new-import') return ['create-campaign', 'cancel'];
  if (kind === 'already-imported') return ['open-existing'];
  if (kind === 'copied-source') return ['link-existing', 'create-independent-import', 'cancel'];
  if (kind === 'divergent-source') return ['create-independent-import', 'cancel'];
  return ['cancel'];
}

function marker(binding: ChatBindingDocument): LegacyBindingMarker {
  return {
    schema: 'st-rpg.chat-binding-marker',
    version: '1.0',
    bindingId: binding.id,
    campaignId: binding.campaignId,
  };
}

export class LegacyImportService {
  readonly #journal: LegacyImportJournal;
  readonly #source: LegacyChatSource;
  readonly #backupRoot: string;

  constructor(journal: LegacyImportJournal, source: LegacyChatSource, backupRoot: string) {
    this.#journal = journal;
    this.#source = source;
    this.#backupRoot = backupRoot;
  }

  async list(requestId: string): Promise<Outcome<readonly LegacyChatListItem[]>> {
    try {
      return { ok: true, value: await this.#source.list() };
    } catch (error) {
      return this.sourceProblem(requestId, error);
    }
  }

  async preview(locator: LegacyChatLocator, requestId: string): Promise<Outcome<LegacyImportPreview>> {
    try {
      return { ok: true, value: (await this.prepare(locator)).preview };
    } catch (error) {
      return this.prepareProblem(requestId, error);
    }
  }

  async binding(bindingId: string, requestId: string): Promise<Outcome<ChatBindingDocument>> {
    try {
      return { ok: true, value: await this.#journal.readBinding(bindingId) };
    } catch (error) {
      return this.problem(requestId, error);
    }
  }

  async bindings(campaignId: string, requestId: string): Promise<Outcome<readonly ChatBindingDocument[]>> {
    try {
      return { ok: true, value: await this.#journal.listBindings(campaignId) };
    } catch (error) {
      return this.problem(requestId, error);
    }
  }

  async followCampaignHead(
    bindingId: string,
    request: FollowCampaignHeadRequest,
  ): Promise<Outcome<ChatBindingDocument>> {
    try {
      return { ok: true, value: await this.#journal.followCampaignHead({ ...request, bindingId }) };
    } catch (error) {
      return this.bindingProblem(request.requestId, error);
    }
  }

  async createBinding(
    campaignId: string,
    request: CreateChatBindingRequest,
  ): Promise<Outcome<ChatBindingDocument>> {
    let snapshot: LegacyChatSnapshot;
    try {
      snapshot = await this.#source.read(request.locator);
    } catch (error) {
      return this.sourceProblem(request.requestId, error);
    }
    if (snapshot.envelope !== undefined) {
      return failure(
        request.requestId,
        'CHAT_BINDING_COLLISION',
        'This chat contains fallback Campaign data. Use "Import a fallback chat" so its RPG truth is reviewed before linking.',
      );
    }
    if (!/^[a-f0-9]{64}$/.test(snapshot.sourceContentFingerprint)) {
      return failure(
        request.requestId,
        'SILLYTAVERN_CHAT_UNAVAILABLE',
        'SillyTavern did not provide a stable saved-chat fingerprint. The chat was not linked.',
      );
    }

    const locatorFingerprint = sha256(request.locator);
    const sourceFingerprint = sha256({ kind: 'sillytavern-chat-binding', locator: request.locator });
    let lookup: LegacyImportLookup;
    try {
      lookup = await this.#journal.lookupLegacyImport(
        sourceFingerprint,
        snapshot.sourceContentFingerprint,
        locatorFingerprint,
      );
    } catch (error) {
      return this.bindingProblem(request.requestId, error);
    }
    const existing = lookup.exact ?? lookup.sameLocator;
    if (existing) {
      if (existing.campaignId !== campaignId) {
        return failure(
          request.requestId,
          'CHAT_BINDING_COLLISION',
          'This SillyTavern chat is already linked to another Campaign. Nothing changed.',
          { bindingId: existing.id, campaignId: existing.campaignId },
        );
      }
      if (existing.markerState === 'verified'
        && canonicalJson(snapshot.bindingMarker) === canonicalJson(marker(existing))) {
        return { ok: true, value: existing };
      }
      return this.retryMarker(existing.id, request.requestId);
    }
    if (snapshot.bindingMarker !== undefined) {
      return failure(
        request.requestId,
        'CHAT_BINDING_COLLISION',
        'This SillyTavern chat already carries an unknown Chat Binding marker. Nothing was overwritten.',
      );
    }

    try {
      const campaignRevision = await this.#journal.readCampaignRevision(campaignId);
      if (campaignRevision !== request.expectedCampaignRevision) {
        return failure(
          request.requestId,
          'CAMPAIGN_REVISION_CONFLICT',
          `Campaign changed from revision ${request.expectedCampaignRevision} to ${campaignRevision}. Reload it before linking this chat.`,
          { campaignId, expectedRevision: request.expectedCampaignRevision, actualRevision: campaignRevision },
        );
      }
      const createdAt = new Date().toISOString();
      const binding: ChatBindingDocument = {
        schema: 'st-rpg.chat-binding',
        version: '1.0',
        id: randomUUID(),
        campaignId,
        revision: 1,
        campaignAnchor: campaignRevision,
        locator: request.locator,
        sourceFingerprint,
        contentFingerprint: snapshot.sourceContentFingerprint,
        markerState: 'pending',
        createdAt,
        updatedAt: createdAt,
      };
      const stored = await this.#journal.createChatBinding({
        requestId: request.requestId,
        campaignId,
        campaignRevision,
        binding,
        locatorFingerprint,
        bindingEventId: randomUUID(),
        bindingOperation: {
          kind: 'create_chat_binding',
          campaignId,
          locator: request.locator,
          campaignAnchor: campaignRevision,
        },
      });
      try {
        await this.#source.writeMarker(snapshot, marker(stored.binding));
        return { ok: true, value: await this.recordMarkerOutcome(stored.binding, 'verified') };
      } catch (error) {
        const message = `Binding marker could not be verified: ${error instanceof Error ? error.message : String(error)}`;
        return { ok: true, value: await this.recordMarkerOutcome(stored.binding, 'blocked', message) };
      }
    } catch (error) {
      return this.bindingProblem(request.requestId, error);
    }
  }

  async retryMarker(bindingId: string, requestId: string): Promise<Outcome<ChatBindingDocument>> {
    let binding: ChatBindingDocument;
    try {
      binding = await this.#journal.readBinding(bindingId);
    } catch (error) {
      return this.problem(requestId, error);
    }
    let snapshot: LegacyChatSnapshot;
    try {
      snapshot = await this.#source.read(binding.locator);
    } catch (error) {
      return this.sourceProblem(requestId, error);
    }
    const freshBinding = binding.sourceFingerprint === sha256({
      kind: 'sillytavern-chat-binding',
      locator: binding.locator,
    });
    const contentMatches = freshBinding
      ? snapshot.envelope === undefined
      : snapshot.envelope !== undefined && sha256(snapshot.envelope) === binding.contentFingerprint;
    if (!contentMatches) {
      const message = 'The saved chat Campaign changed after import. Marker retry was blocked; preview the fallback chat again.';
      try {
        return { ok: true, value: await this.recordMarkerOutcome(binding, 'blocked', message) };
      } catch (error) {
        return this.problem(requestId, error);
      }
    }
    try {
      await this.#source.writeMarker(snapshot, marker(binding));
      return { ok: true, value: await this.recordMarkerOutcome(binding, 'verified') };
    } catch (error) {
      const message = `Binding marker could not be verified: ${error instanceof Error ? error.message : String(error)}`;
      try {
        return { ok: true, value: await this.recordMarkerOutcome(binding, 'blocked', message) };
      } catch (journalError) {
        return this.problem(requestId, journalError);
      }
    }
  }

  async apply(request: ApplyLegacyImportRequest): Promise<Outcome<LegacyImportResult>> {
    let prepared: PreparedPreview;
    try {
      prepared = await this.prepare(request.locator);
    } catch (error) {
      return this.prepareProblem(request.requestId, error);
    }
    try {
      if (prepared.sourceFingerprint !== request.sourceFingerprint) {
        return failure(
          request.requestId,
          'LEGACY_IMPORT_STALE',
          'The saved chat changed after the import preview. Nothing was imported.',
          { expectedSourceFingerprint: request.sourceFingerprint, actualSourceFingerprint: prepared.sourceFingerprint },
        );
      }
      if (!prepared.inspection.valid || !prepared.inspection.state) {
        return failure(request.requestId, 'LEGACY_IMPORT_INVALID', 'The legacy Campaign has validation errors and cannot be imported.', prepared.preview.issues);
      }
      if (prepared.lookup.exact) {
        return {
          ok: true,
          value: {
            schema: 'st-rpg.legacy-import-result', version: '1.0', kind: 'already-imported',
            campaignId: prepared.lookup.exact.campaignId,
            campaignRevision: await this.#journal.readCampaignRevision(prepared.lookup.exact.campaignId),
            binding: prepared.lookup.exact,
            legacyMetadataPreserved: true,
          },
        };
      }

      const kind = prepared.preview.kind;
      const decisionAllowed = (kind === 'new-import' && request.decision === 'create-campaign')
        || (kind === 'copied-source' && ['link-existing', 'create-independent-import'].includes(request.decision))
        || (kind === 'divergent-source' && request.decision === 'create-independent-import');
      if (!decisionAllowed) {
        return failure(request.requestId, 'LEGACY_IMPORT_COLLISION', 'Choose one of the explicit actions shown by the current import preview.', {
          previewKind: kind,
          allowedDecisions: prepared.preview.decisions,
        });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backup = await this.#journal.backup({
        destinationPath: join(this.#backupRoot, `before-legacy-import-${timestamp}-${randomUUID()}.sqlite`),
      });
      const stored = request.decision === 'link-existing'
        ? await this.linkExisting(request, prepared)
        : await this.createIndependent(request, prepared);

      let binding: ChatBindingDocument;
      try {
        await this.#source.writeMarker(prepared.snapshot, marker(stored.binding));
        binding = await this.recordMarkerOutcome(stored.binding, 'verified');
      } catch (error) {
        const message = `Binding marker could not be verified: ${error instanceof Error ? error.message : String(error)}`;
        binding = await this.recordMarkerOutcome(stored.binding, 'blocked', message);
      }

      return {
        ok: true,
        value: {
          schema: 'st-rpg.legacy-import-result',
          version: '1.0',
          kind: request.decision === 'link-existing' ? 'linked-existing' : 'imported',
          campaignId: stored.campaignId,
          campaignRevision: stored.campaignRevision,
          binding,
          backupPath: backup.destinationPath,
          legacyMetadataPreserved: true,
        },
      };
    } catch (error) {
      return this.problem(request.requestId, error);
    }
  }

  private async prepare(locator: LegacyChatLocator): Promise<PreparedPreview> {
    let snapshot: LegacyChatSnapshot;
    try {
      snapshot = await this.#source.read(locator);
    } catch (error) {
      throw new LegacySourceFailure(error);
    }
    if (snapshot.envelope === undefined) {
      throw new LegacySourceFailure(new LegacyChatSourceExpectedError(
        'LEGACY_METADATA_NOT_FOUND',
        "The selected saved chat has no fallback Campaign metadata. Link it from the Campaign's Linked SillyTavern chats panel instead.",
      ));
    }
    const inspection = inspectLegacyEnvelope(snapshot.envelope);
    const contentFingerprint = sha256(snapshot.envelope);
    const locatorFingerprint = sha256(locator);
    const sourceFingerprint = sha256({ contentFingerprint, locator });
    let lookup: LegacyImportLookup;
    try {
      lookup = await this.#journal.lookupLegacyImport(sourceFingerprint, contentFingerprint, locatorFingerprint);
    } catch (error) {
      throw new LegacyJournalFailure(error);
    }
    const kind: LegacyImportPreview['kind'] = !inspection.valid
      ? 'invalid-source'
      : lookup.exact
        ? 'already-imported'
        : lookup.sameLocator
          ? 'divergent-source'
          : lookup.sameContent
            ? 'copied-source'
            : 'new-import';
    const existing = lookup.exact ?? lookup.sameLocator ?? lookup.sameContent;
    const preview: LegacyImportPreview = {
      schema: 'st-rpg.legacy-import-preview',
      version: '1.0',
      kind,
      locator,
      sourceFingerprint,
      contentFingerprint,
      title: inspection.title,
      legacyRevision: inspection.legacyRevision,
      counts: inspection.counts,
      issues: [...inspection.issues],
      decisions: decisionsFor(kind),
      ...(existing ? { existingCampaignId: existing.campaignId, existingBindingId: existing.id } : {}),
      legacyMetadataPreserved: true,
    };
    return { snapshot, inspection, preview, lookup, contentFingerprint, sourceFingerprint, locatorFingerprint };
  }

  private async createIndependent(request: ApplyLegacyImportRequest, prepared: PreparedPreview) {
    const campaignId = randomUUID();
    const bindingId = randomUUID();
    const eventId = randomUUID();
    const bindingEventId = randomUUID();
    const committedAt = new Date().toISOString();
    const title = String(request.title ?? prepared.inspection.title).trim().slice(0, 160);
    const summary: CampaignSummary = {
      id: campaignId,
      title,
      status: 'active',
      revision: 1,
      createdAt: committedAt,
      updatedAt: committedAt,
    };
    const state: CampaignState = {
      ...structuredClone(prepared.inspection.state!),
      campaign: summary,
    };
    const operation = {
      kind: 'import_legacy_campaign',
      sourceFingerprint: prepared.sourceFingerprint,
      contentFingerprint: prepared.contentFingerprint,
      legacyRevision: prepared.inspection.legacyRevision,
      legacyMetadataPreserved: true,
    };
    const eventDigest = subjectEventHash({
      campaignId,
      revision: 1,
      eventId,
      requestId: request.requestId,
      operationKind: operation.kind,
      operation,
      acceptedAt: committedAt,
      previousEventHash: null,
      baseStateHash: sha256(state),
      changes: [],
    });
    const binding: ChatBindingDocument = {
      schema: 'st-rpg.chat-binding', version: '1.0', id: bindingId, campaignId,
      revision: 1, campaignAnchor: 1, locator: request.locator,
      sourceFingerprint: prepared.sourceFingerprint, contentFingerprint: prepared.contentFingerprint,
      markerState: 'pending', createdAt: committedAt, updatedAt: committedAt,
    };
    return this.#journal.importLegacyCampaign({
      append: {
        kind: 'create',
        baseKind: 'legacy_import',
        requestId: request.requestId,
        requestHash: sha256({ request, previewKind: prepared.preview.kind }),
        operation,
        baseState: state,
        afterState: state,
        eventHash: eventDigest,
        commit: {
          campaignId, revision: 1, eventId, requestId: request.requestId,
          operationKind: operation.kind, affectedIds: [campaignId], committedAt,
        },
      },
      binding,
      locatorFingerprint: prepared.locatorFingerprint,
      envelopeJson: canonicalJson(prepared.snapshot.envelope),
      legacyRevision: prepared.inspection.legacyRevision,
      bindingEventId,
      bindingOperation: { kind: 'create_chat_binding', campaignId, locator: request.locator, campaignAnchor: 1 },
    });
  }

  private async linkExisting(request: ApplyLegacyImportRequest, prepared: PreparedPreview) {
    const existing = prepared.lookup.sameContent;
    if (!existing) throw new CampaignExpectedError('LEGACY_IMPORT_COLLISION', 'The matching Campaign is no longer available. Preview the chat again.');
    const campaignRevision = await this.#journal.readCampaignRevision(existing.campaignId);
    const createdAt = new Date().toISOString();
    const binding: ChatBindingDocument = {
      schema: 'st-rpg.chat-binding', version: '1.0', id: randomUUID(), campaignId: existing.campaignId,
      revision: 1, campaignAnchor: campaignRevision, locator: request.locator,
      sourceFingerprint: prepared.sourceFingerprint, contentFingerprint: prepared.contentFingerprint,
      markerState: 'pending', createdAt, updatedAt: createdAt,
    };
    return this.#journal.linkLegacyBinding({
      requestId: request.requestId,
      campaignId: existing.campaignId,
      campaignRevision,
      binding,
      locatorFingerprint: prepared.locatorFingerprint,
      envelopeJson: canonicalJson(prepared.snapshot.envelope),
      legacyRevision: prepared.inspection.legacyRevision,
      bindingEventId: randomUUID(),
      bindingOperation: { kind: 'create_chat_binding', campaignId: existing.campaignId, locator: request.locator, campaignAnchor: campaignRevision },
    });
  }

  private recordMarkerOutcome(
    binding: ChatBindingDocument,
    state: 'verified' | 'blocked',
    problem?: string,
  ): Promise<ChatBindingDocument> {
    return this.#journal.recordMarkerOutcome({
      bindingId: binding.id,
      expectedRevision: binding.revision,
      state,
      ...(problem ? { problem } : {}),
      eventId: randomUUID(),
      requestId: randomUUID(),
    });
  }

  private problem<T>(requestId: string, error: unknown): Outcome<T> {
    if (error instanceof CampaignExpectedError) {
      return failure(requestId, error.code, error.message, error.details);
    }
    return failure(
      requestId,
      'CAMPAIGN_STORE_UNAVAILABLE',
      `Campaign authority could not complete the legacy import: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  private bindingProblem<T>(requestId: string, error: unknown): Outcome<T> {
    if (error instanceof CampaignExpectedError) {
      return failure(requestId, error.code, error.message, error.details);
    }
    return failure(
      requestId,
      'CAMPAIGN_STORE_UNAVAILABLE',
      `Campaign authority could not create the Chat Binding: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  private sourceProblem<T>(requestId: string, error: unknown): Outcome<T> {
    if (error instanceof LegacyChatSourceExpectedError) {
      return failure(requestId, error.code, error.message);
    }
    return failure(
      requestId,
      'SILLYTAVERN_CHAT_UNAVAILABLE',
      `The selected SillyTavern chat could not be read safely: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  private prepareProblem<T>(requestId: string, error: unknown): Outcome<T> {
    if (error instanceof LegacyJournalFailure) return this.problem(requestId, error.cause);
    if (error instanceof LegacySourceFailure) return this.sourceProblem(requestId, error.cause);
    return this.problem(requestId, error);
  }
}
