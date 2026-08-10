import { createHash, randomUUID } from 'node:crypto';
import { watch, type FSWatcher } from 'node:fs';
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Value } from '@sinclair/typebox/value';
import {
  AddonCandidateSchema,
  type AddonCandidate,
  type AddonChange,
  type AddonIssue,
  type AddonRecordKind,
  type AddonSourceCatalog,
  type AddonSourceFile,
  type AddonValue,
  type ApplyAddonReceipt,
  type CampaignDocument,
  type CampaignOperation,
  type NarratorVisibility,
} from '@st-llm-rpg/wire';
import type { CampaignEngine } from '../campaign/campaign-engine.js';
import { CampaignExpectedError } from '../campaign/campaign-error.js';
import type { BackupService } from './backup-service.js';

const PERIODIC_RESCAN_MS = 60_000;
const WATCH_DEBOUNCE_MS = 250;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const SUPPORTED_TOP_LEVEL = new Set(['people', 'items', 'quests', 'places', 'facts', 'worldObjects', 'abilities', 'relationships', 'scene', 'records']);
const KNOWN_UNSUPPORTED = new Map([
  ['character', 'Player Character identity is not represented by the current companion addon model.'],
]);

type SourceDocument = Readonly<{ name: string; document: Record<string, unknown> }>;
type Scan = Readonly<{ catalog: AddonSourceCatalog; documents: readonly SourceDocument[] }>;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value: unknown): string {
  return createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
}

function issue(
  severity: AddonIssue['severity'],
  code: string,
  source: string,
  path: string,
  message: string,
): AddonIssue {
  return { severity, code, source: source.slice(0, 255), path: path.slice(0, 512), message: message.slice(0, 1000) };
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function meaningful(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as object).length > 0;
  return true;
}

function addonSubjectId(kind: AddonRecordKind, externalId: string): string {
  return `addon:${kind}:${externalId}`;
}

function aliases(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some(alias => typeof alias !== 'string' || !alias.trim())) return undefined;
  return [...new Set(value.map(alias => String(alias).trim()))];
}

function visibility(value: unknown): NarratorVisibility | undefined {
  return ['known', 'narrator_secret', 'campaign_private'].includes(String(value))
    ? value as NarratorVisibility
    : undefined;
}

function campaignValue(document: CampaignDocument, after: AddonValue): AddonValue | null {
  const common = (record: { name: string; summary: string; aliases?: string[]; visibility?: NarratorVisibility }) => ({
    ...after,
    name: record.name,
    summary: record.summary,
    ...(record.aliases?.length ? { aliases: record.aliases } : {}),
    ...(record.visibility ? { visibility: record.visibility } : {}),
  });
  if (after.recordKind === 'actor') {
    const record = document.actors.find(candidate => candidate.id === after.subjectId);
    return record ? common(record) : null;
  }
  if (after.recordKind === 'item') {
    const record = document.items.find(candidate => candidate.id === after.subjectId);
    return record ? { ...common(record), ...(record.ownerActorId ? { ownerActorId: record.ownerActorId } : {}) } : null;
  }
  if (after.recordKind === 'quest') {
    const record = document.quests.find(candidate => candidate.id === after.subjectId);
    return record ? { ...common(record), status: record.status } : null;
  }
  if (after.recordKind === 'place') {
    const record = document.places.find(candidate => candidate.id === after.subjectId);
    return record ? common(record) : null;
  }
  if (after.recordKind === 'fact') {
    const record = (document.facts ?? []).find(candidate => candidate.id === after.subjectId);
    return record ? { ...common(record), ...(record.subjectId ? { aboutId: record.subjectId } : {}) } : null;
  }
  if (after.recordKind === 'world_object') {
    const record = (document.worldObjects ?? []).find(candidate => candidate.id === after.subjectId);
    return record ? { ...common(record), ...(record.placeId ? { placeId: record.placeId } : {}) } : null;
  }
  if (after.recordKind === 'ability') {
    const record = (document.abilities ?? []).find(candidate => candidate.id === after.subjectId);
    return record ? { ...common(record), category: record.category } : null;
  }
  if (after.recordKind === 'relationship') {
    const record = (document.relationships ?? []).find(candidate => candidate.id === after.subjectId);
    return record ? {
      ...after,
      name: after.name,
      summary: record.notes,
      sourceActorId: record.sourceActorId,
      targetActorId: record.targetActorId,
      relationshipKind: record.kind,
      relationshipStatus: record.status,
      ...(record.visibility ? { visibility: record.visibility } : {}),
    } : null;
  }
  const record = document.currentScene?.id === after.subjectId ? document.currentScene : null;
  return record ? {
    ...after,
    name: record.name,
    summary: record.summary,
    ...(record.placeId ? { placeId: record.placeId } : {}),
    ...(record.actorIds?.length ? { actorIds: record.actorIds } : {}),
    ...(record.itemIds?.length ? { itemIds: record.itemIds } : {}),
    ...(record.worldObjectIds?.length ? { worldObjectIds: record.worldObjectIds } : {}),
  } : null;
}

function comparable(value: AddonValue): Record<string, unknown> {
  const { externalId: _externalId, sourceFile: _sourceFile, ...content } = value;
  return content;
}

function changedFields(before: AddonValue | null, after: AddonValue): string[] {
  if (!before) return Object.keys(comparable(after)).sort();
  const left = comparable(before);
  const right = comparable(after);
  return [...new Set([...Object.keys(left), ...Object.keys(right)])]
    .filter(key => canonical(left[key]) !== canonical(right[key]))
    .sort();
}

function operationsFor(changes: readonly AddonChange[]): CampaignOperation[] {
  const operations: CampaignOperation[] = [];
  for (const change of changes) {
    if (change.change === 'unchanged') continue;
    const value = change.after;
    const narrator = {
      ...(value.aliases ? { aliases: value.aliases } : {}),
      ...(value.visibility ? { visibility: value.visibility } : {}),
    };
    if (value.recordKind === 'actor') {
      operations.push(change.change === 'create'
        ? { kind: 'create_actor', actor: { id: value.subjectId, name: value.name, summary: value.summary, ...narrator } }
        : { kind: 'update_actor', actorId: value.subjectId, name: value.name, summary: value.summary, ...narrator });
    } else if (value.recordKind === 'item') {
      operations.push(change.change === 'create'
        ? { kind: 'create_item', item: { id: value.subjectId, name: value.name, summary: value.summary, ...narrator, ...(value.ownerActorId ? { ownerActorId: value.ownerActorId } : {}) } }
        : { kind: 'update_item', itemId: value.subjectId, name: value.name, summary: value.summary, ...narrator, ...('ownerActorId' in value ? { ownerActorId: value.ownerActorId ?? null } : {}) });
    } else if (value.recordKind === 'quest') {
      operations.push(change.change === 'create'
        ? { kind: 'create_quest', quest: { id: value.subjectId, name: value.name, summary: value.summary, status: value.status ?? 'active', ...narrator } }
        : { kind: 'update_quest', questId: value.subjectId, name: value.name, summary: value.summary, status: value.status ?? 'active', ...narrator });
    } else if (value.recordKind === 'place') {
      operations.push(change.change === 'create'
        ? { kind: 'create_place', place: { id: value.subjectId, name: value.name, summary: value.summary, ...narrator } }
        : { kind: 'update_place', placeId: value.subjectId, name: value.name, summary: value.summary, ...narrator });
    } else if (value.recordKind === 'fact') {
      operations.push(change.change === 'create'
        ? { kind: 'create_fact', fact: { id: value.subjectId, name: value.name, summary: value.summary, ...narrator, ...(value.aboutId ? { subjectId: value.aboutId } : {}) } }
        : { kind: 'update_fact', factId: value.subjectId, name: value.name, summary: value.summary, ...narrator, subjectId: value.aboutId ?? null });
    } else if (value.recordKind === 'world_object') {
      operations.push(change.change === 'create'
        ? { kind: 'create_world_object', worldObject: { id: value.subjectId, name: value.name, summary: value.summary, ...narrator, ...(value.placeId ? { placeId: value.placeId } : {}) } }
        : { kind: 'update_world_object', worldObjectId: value.subjectId, name: value.name, summary: value.summary, ...narrator, placeId: value.placeId ?? null });
    } else if (value.recordKind === 'ability') {
      operations.push(change.change === 'create'
        ? { kind: 'create_ability', ability: { id: value.subjectId, name: value.name, summary: value.summary, category: value.category ?? 'other', ...narrator } }
        : { kind: 'update_ability', abilityId: value.subjectId, name: value.name, summary: value.summary, category: value.category ?? 'other', ...narrator });
    } else if (value.recordKind === 'relationship') {
      operations.push(change.change === 'create'
        ? { kind: 'create_relationship', relationship: {
          id: value.subjectId,
          sourceActorId: value.sourceActorId!, targetActorId: value.targetActorId!,
          kind: value.relationshipKind!, status: value.relationshipStatus ?? 'active',
          notes: value.summary, ...(value.visibility ? { visibility: value.visibility } : {}),
        } }
        : { kind: 'update_relationship', relationshipId: value.subjectId,
          sourceActorId: value.sourceActorId!, targetActorId: value.targetActorId!,
          relationshipKind: value.relationshipKind!, status: value.relationshipStatus ?? 'active',
          notes: value.summary, ...(value.visibility ? { visibility: value.visibility } : {}),
        });
    } else {
      operations.push({
        kind: 'set_current_scene',
        scene: {
          id: value.subjectId,
          name: value.name,
          summary: value.summary,
          ...(value.placeId ? { placeId: value.placeId } : {}),
          ...(value.actorIds?.length ? { actorIds: value.actorIds } : {}),
          ...(value.itemIds?.length ? { itemIds: value.itemIds } : {}),
          ...(value.worldObjectIds?.length ? { worldObjectIds: value.worldObjectIds } : {}),
        },
      });
    }
  }
  const order: Record<CampaignOperation['kind'], number> = {
    create_actor: 0, rename_actor: 0, update_actor: 0, set_actor_archived: 0,
    create_place: 1, update_place: 1, set_place_archived: 1,
    create_fact: 6, update_fact: 6, set_fact_archived: 6,
    create_world_object: 3, update_world_object: 3, set_world_object_archived: 3,
    create_item: 2, update_item: 2, set_item_archived: 2, create_actor_with_item: 2,
    create_quest: 4, update_quest: 4, set_quest_archived: 4,
    create_ability: 2, create_ability_with_learning: 2, update_ability: 2, set_ability_archived: 2,
    create_learned_ability: 3, update_learned_ability: 3, set_learned_ability_archived: 3,
    create_relationship: 5, update_relationship: 5, set_relationship_archived: 5,
    set_current_scene: 7, advance_scene: 7,
  };
  return operations.sort((left, right) => order[left.kind] - order[right.kind]);
}

export class AddonService {
  readonly #engine: CampaignEngine;
  readonly #backups: BackupService;
  readonly #directory: string;
  readonly #candidateRoot: string;
  #scan: Scan | null = null;
  #watcher: FSWatcher | null = null;
  #timer: NodeJS.Timeout | null = null;
  #debounce: NodeJS.Timeout | null = null;
  #refresh: Promise<Scan> = Promise.resolve({
    catalog: {
      schema: 'st-rpg.addon-source-catalog', version: '1.0', directory: '.', observedAt: new Date(0).toISOString(),
      manifestHash: digest([]), files: [], issues: [],
    },
    documents: [],
  });

  constructor(engine: CampaignEngine, backups: BackupService, directory: string, candidateRoot: string) {
    this.#engine = engine;
    this.#backups = backups;
    this.#directory = resolve(directory);
    this.#candidateRoot = resolve(candidateRoot);
  }

  async start(): Promise<void> {
    await Promise.all([mkdir(this.#directory, { recursive: true }), mkdir(this.#candidateRoot, { recursive: true })]);
    await this.rescan();
    this.#watcher = watch(this.#directory, () => this.scheduleRescan());
    this.#watcher.on('error', () => this.scheduleRescan());
    this.#timer = setInterval(() => { void this.rescan(); }, PERIODIC_RESCAN_MS);
    this.#timer.unref();
  }

  async close(): Promise<void> {
    this.#watcher?.close();
    this.#watcher = null;
    if (this.#timer) clearInterval(this.#timer);
    if (this.#debounce) clearTimeout(this.#debounce);
    this.#timer = null;
    this.#debounce = null;
    await this.#refresh;
  }

  async sourceCatalog(): Promise<AddonSourceCatalog> {
    return (this.#scan ?? await this.rescan()).catalog;
  }

  async listCandidates(campaignId?: string): Promise<{ schema: 'st-rpg.addon-candidate-catalog'; version: '1.0'; observedAt: string; candidates: AddonCandidate[] }> {
    await mkdir(this.#candidateRoot, { recursive: true });
    const names = (await readdir(this.#candidateRoot)).filter(name => name.endsWith('.json')).sort();
    const candidates: AddonCandidate[] = [];
    for (const name of names) {
      try {
        const candidate = JSON.parse(await readFile(resolve(this.#candidateRoot, name), 'utf8')) as unknown;
        if (!Value.Check(AddonCandidateSchema, candidate)) continue;
        if (!campaignId || (candidate as AddonCandidate).campaignId === campaignId) candidates.push(candidate as AddonCandidate);
      } catch {
        // A partial/corrupt operational candidate never becomes Campaign truth. Fresh preview replaces it.
      }
    }
    candidates.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return {
      schema: 'st-rpg.addon-candidate-catalog', version: '1.0', observedAt: new Date().toISOString(),
      candidates: candidates.slice(0, 512),
    };
  }

  rescan(): Promise<Scan> {
    this.#refresh = this.#refresh.then(
      () => this.scanDirectory(),
      () => this.scanDirectory(),
    );
    return this.#refresh.then(scan => {
      this.#scan = scan;
      return scan;
    });
  }

  async preview(campaignId: string): Promise<AddonCandidate> {
    const scan = await this.rescan();
    const outcome = await this.#engine.read(campaignId, `addon-preview-${randomUUID()}`);
    if (!outcome.ok) throw new CampaignExpectedError(outcome.problem.code, outcome.problem.message);
    const issues = [...scan.catalog.issues];
    const values = this.readValues(scan.documents, issues);
    this.validateReferences(outcome.value, values, issues);
    const changes = values.map(after => {
      const before = campaignValue(outcome.value, after);
      const fields = changedFields(before, after);
      return {
        change: before === null ? 'create' : fields.length ? 'update' : 'unchanged',
        before,
        after,
        changedFields: fields,
      } satisfies AddonChange;
    });
    const errors = issues.filter(candidate => candidate.severity === 'error');
    const changed = changes.filter(change => change.change !== 'unchanged').length;
    const candidate: AddonCandidate = {
      schema: 'st-rpg.addon-candidate',
      version: '1.0',
      id: randomUUID(),
      status: errors.length ? 'blocked' : 'pending',
      campaignId: outcome.value.campaign.id,
      expectedRevision: outcome.value.campaign.revision,
      createdAt: new Date().toISOString(),
      directory: scan.catalog.directory,
      manifestHash: scan.catalog.manifestHash,
      files: scan.catalog.files,
      issues,
      changes,
      canApply: errors.length === 0 && changed > 0,
      deletionPolicy: 'missing-addon-rows-never-delete-campaign-records',
    };
    await this.saveCandidate(candidate);
    return candidate;
  }

  async apply(input: {
    candidateId: string;
    campaignId: string;
    manifestHash: string;
    expectedRevision: number;
  }): Promise<ApplyAddonReceipt> {
    const candidate = await this.loadCandidate(input.candidateId);
    if (candidate.campaignId !== input.campaignId) {
      throw new CampaignExpectedError('ADDON_CANDIDATE_STALE', 'Addon candidate belongs to another Campaign. Preview again.');
    }
    if (candidate.status !== 'pending' || !candidate.canApply) {
      throw new CampaignExpectedError('ADDON_IMPORT_BLOCKED', 'Addon candidate is not a pending applicable diff. Preview again.');
    }
    const scan = await this.rescan();
    if (candidate.manifestHash !== input.manifestHash || scan.catalog.manifestHash !== input.manifestHash) {
      await this.saveCandidate({ ...candidate, status: 'stale', canApply: false });
      throw new CampaignExpectedError('ADDON_CANDIDATE_STALE', 'Addon files changed after preview. Nothing was applied; preview again.');
    }
    if (candidate.expectedRevision !== input.expectedRevision) {
      throw new CampaignExpectedError('ADDON_CANDIDATE_STALE', 'Campaign revision does not match the reviewed addon diff. Preview again.');
    }
    const current = await this.#engine.read(candidate.campaignId, `addon-apply-read-${randomUUID()}`);
    if (!current.ok) throw new CampaignExpectedError(current.problem.code, current.problem.message);
    if (current.value.campaign.revision !== candidate.expectedRevision) {
      await this.saveCandidate({ ...candidate, status: 'stale', canApply: false });
      throw new CampaignExpectedError('CAMPAIGN_REVISION_CONFLICT', 'Campaign changed after addon preview. Nothing was applied; preview again.');
    }
    const operations = operationsFor(candidate.changes);
    if (operations.length === 0) {
      const receipt: ApplyAddonReceipt = {
        schema: 'st-rpg.addon-apply-receipt', version: '1.0', candidateId: candidate.id,
        manifestHash: candidate.manifestHash, changed: 0, appliedAt: new Date().toISOString(), backup: null, commit: null,
      };
      await this.saveCandidate({ ...candidate, status: 'applied', canApply: false, appliedRevision: candidate.expectedRevision });
      return receipt;
    }
    const backup = await this.#backups.createPreOperation(`Before addon import to ${current.value.campaign.title}`);
    const postBackupScan = await this.rescan();
    if (postBackupScan.catalog.manifestHash !== candidate.manifestHash) {
      await this.saveCandidate({ ...candidate, status: 'stale', canApply: false });
      throw new CampaignExpectedError('ADDON_CANDIDATE_STALE', 'Addon files changed while the safety backup was being created. Nothing was applied; preview again.');
    }
    const commit = await this.#engine.applyAddonBatch(candidate.campaignId, {
      requestId: `addon-apply-${candidate.id}`,
      candidateId: candidate.id,
      manifestHash: candidate.manifestHash,
      expectedRevision: candidate.expectedRevision,
      operations,
    });
    if (!commit.ok) throw new CampaignExpectedError(commit.problem.code, commit.problem.message);
    await this.saveCandidate({ ...candidate, status: 'applied', canApply: false, appliedRevision: commit.value.revision });
    return {
      schema: 'st-rpg.addon-apply-receipt', version: '1.0', candidateId: candidate.id,
      manifestHash: candidate.manifestHash, changed: operations.length, appliedAt: new Date().toISOString(), backup, commit: commit.value,
    };
  }

  private scheduleRescan(): void {
    if (this.#debounce) clearTimeout(this.#debounce);
    this.#debounce = setTimeout(() => { this.#debounce = null; void this.rescan(); }, WATCH_DEBOUNCE_MS);
    this.#debounce.unref();
  }

  private async scanDirectory(): Promise<Scan> {
    await mkdir(this.#directory, { recursive: true });
    const names = (await readdir(this.#directory))
      .filter(name => name.toLowerCase().endsWith('.json') && !name.toLowerCase().endsWith('_example.json'))
      .sort((left, right) => left.localeCompare(right));
    const files: AddonSourceFile[] = [];
    const documents: SourceDocument[] = [];
    const issues: AddonIssue[] = [];
    for (const name of names) {
      const path = resolve(this.#directory, name);
      try {
        const before = await stat(path);
        if (!before.isFile()) continue;
        if (before.size > MAX_FILE_BYTES) throw new Error(`File exceeds ${MAX_FILE_BYTES} bytes.`);
        const content = await readFile(path, 'utf8');
        const after = await stat(path);
        if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
          throw new Error('File changed while being read; save it again or rescan.');
        }
        let parsed: unknown;
        try { parsed = JSON.parse(content); } catch { throw new Error('Malformed JSON.'); }
        const document = object(parsed);
        if (!document) throw new Error('Addon root must be a JSON object.');
        files.push({
          name,
          sizeBytes: after.size,
          modifiedAt: new Date(after.mtimeMs).toISOString(),
          sha256: digest(content),
        });
        documents.push({ name, document });
      } catch (error) {
        issues.push(issue('error', 'addon_source_unreadable', name, name, error instanceof Error ? error.message : String(error)));
      }
    }
    const manifestHash = digest(files.map(file => ({ name: file.name, sizeBytes: file.sizeBytes, sha256: file.sha256 })));
    return {
      catalog: {
        schema: 'st-rpg.addon-source-catalog', version: '1.0', directory: this.#directory,
        observedAt: new Date().toISOString(), manifestHash, files, issues,
      },
      documents,
    };
  }

  private readValues(documents: readonly SourceDocument[], issues: AddonIssue[]): AddonValue[] {
    const values: AddonValue[] = [];
    const seen = new Map<string, string>();
    const add = (kind: AddonRecordKind, raw: unknown, sourceFile: string, path: string) => {
      const input = object(raw);
      if (!input) {
        issues.push(issue('error', 'addon_record_invalid', sourceFile, path, 'Record must be a JSON object.'));
        return;
      }
      const externalId = text(input.externalId ?? input.id);
      const relationshipSource = text(input.sourceActorId) || (text(input.source) ? addonSubjectId('actor', text(input.source)) : '');
      const relationshipTarget = text(input.targetActorId) || (text(input.target) ? addonSubjectId('actor', text(input.target)) : '');
      const relationshipKind = text(input.kind) === 'relationship'
        ? text(input.relationshipKind)
        : text(input.relationshipKind ?? input.kind);
      const name = kind === 'relationship'
        ? (text(input.name ?? input.title) || `${text(input.source) || relationshipSource} → ${text(input.target) || relationshipTarget}`).slice(0, 160)
        : text(input.name ?? input.title);
      if (!externalId || externalId.length > 96 || !ID_PATTERN.test(externalId)) {
        issues.push(issue('error', 'addon_identity_invalid', sourceFile, `${path}.id`, 'Stable ID must use letters, numbers, dot, underscore, colon, or hyphen.'));
        return;
      }
      const subjectId = addonSubjectId(kind, externalId);
      if (subjectId.length > 128) {
        issues.push(issue('error', 'addon_identity_invalid', sourceFile, `${path}.id`, 'Namespaced stable ID is longer than 128 characters.'));
        return;
      }
      if (!name || name.length > 160) {
        issues.push(issue('error', 'addon_name_invalid', sourceFile, `${path}.name`, 'Name is required and may contain at most 160 characters.'));
        return;
      }
      const identity = `${kind}:${externalId}`;
      const duplicate = seen.get(identity);
      if (duplicate) {
        issues.push(issue('error', 'addon_identity_duplicate', sourceFile, path, `Stable ${kind} ID ${externalId} already appears at ${duplicate}.`));
        return;
      }
      seen.set(identity, `${sourceFile}:${path}`);
      const rawAliases = aliases(input.aliases);
      if (input.aliases !== undefined && rawAliases === undefined) {
        issues.push(issue('error', 'addon_aliases_invalid', sourceFile, `${path}.aliases`, 'Aliases must be an array of non-empty strings.'));
        return;
      }
      const rawVisibility = visibility(input.visibility);
      if (input.visibility !== undefined && rawVisibility === undefined) {
        issues.push(issue('error', 'addon_visibility_invalid', sourceFile, `${path}.visibility`, 'Visibility must be known, narrator_secret, or campaign_private.'));
        return;
      }
      const common: AddonValue = {
        recordKind: kind, externalId, subjectId, sourceFile, name,
        summary: kind === 'fact' ? text(input.proposition ?? input.summary) : text(input.summary),
        ...(rawAliases?.length ? { aliases: rawAliases } : {}),
        ...(rawVisibility ? { visibility: rawVisibility } : { visibility: 'known' }),
      };
      if (kind === 'item') {
        const ownerExternalId = text(input.ownerExternalId);
        const ownerActorId = text(input.ownerActorId) || (ownerExternalId ? addonSubjectId('actor', ownerExternalId) : '');
        if (ownerActorId) Object.assign(common, { ownerActorId });
      } else if (kind === 'quest') {
        const status = text(input.status, 'active');
        if (!['active', 'completed'].includes(status)) {
          issues.push(issue('error', 'addon_quest_status_unsupported', sourceFile, `${path}.status`, 'Current companion accepts only active or completed Quest status.'));
          return;
        }
        Object.assign(common, { status });
      } else if (kind === 'ability') {
        const inputCategory = text(input.category, 'other');
        const category = inputCategory === 'power' ? 'other' : inputCategory;
        if (!['spell', 'skill', 'feat', 'other'].includes(category)) {
          issues.push(issue('error', 'addon_ability_category_unsupported', sourceFile, `${path}.category`, 'Ability category must be spell, skill, feat, power, or other.'));
          return;
        }
        Object.assign(common, { category });
      } else if (kind === 'fact') {
        const subject = object(input.subject);
        const subjectKind = text(subject?.kind);
        const subjectExternalId = text(subject?.id);
        const kindMap: Record<string, AddonRecordKind> = {
          actor: 'actor', item: 'item', quest: 'quest', place: 'place', ability: 'ability',
          worldObject: 'world_object', world_object: 'world_object', relationship: 'relationship',
        };
        let aboutId = text(input.aboutId ?? input.subjectId);
        if (!aboutId && subjectKind && subjectExternalId) {
          const mapped = kindMap[subjectKind];
          if (!mapped || subjectExternalId === '$player') {
            issues.push(issue('error', 'addon_fact_subject_invalid', sourceFile, `${path}.subject`, 'Fact subject must reference a supported Campaign Record. The Companion does not guess $player.'));
            return;
          }
          aboutId = addonSubjectId(mapped, subjectExternalId);
        }
        if (aboutId) Object.assign(common, { aboutId });
      } else if (kind === 'world_object') {
        const placeId = text(input.placeId) || (text(input.homePlace) ? addonSubjectId('place', text(input.homePlace)) : '');
        if (placeId) Object.assign(common, { placeId });
      } else if (kind === 'relationship') {
        const relationshipStatus = text(input.status, 'active');
        if (!relationshipSource || !relationshipTarget || relationshipSource === relationshipTarget) {
          issues.push(issue('error', 'addon_relationship_actors_invalid', sourceFile, path, 'Relationship must connect two different Actor references.'));
          return;
        }
        if (!ID_PATTERN.test(relationshipSource) || !ID_PATTERN.test(relationshipTarget)
          || relationshipSource.length > 128 || relationshipTarget.length > 128) {
          issues.push(issue('error', 'addon_relationship_reference_invalid', sourceFile, path, 'Relationship Actor references must be canonical IDs or People addon IDs. The Companion does not guess $player.'));
          return;
        }
        if (!relationshipKind || relationshipKind.length > 160) {
          issues.push(issue('error', 'addon_relationship_kind_invalid', sourceFile, `${path}.kind`, 'Relationship kind is required and may contain at most 160 characters.'));
          return;
        }
        if (!['active', 'strained', 'dormant', 'ended', 'other'].includes(relationshipStatus)) {
          issues.push(issue('error', 'addon_relationship_status_unsupported', sourceFile, `${path}.status`, 'Relationship status must be active, strained, dormant, ended, or other.'));
          return;
        }
        Object.assign(common, {
          sourceActorId: relationshipSource,
          targetActorId: relationshipTarget,
          relationshipKind,
          relationshipStatus,
          summary: text(input.notes ?? input.summary),
        });
      } else if (kind === 'scene') {
        const placeId = text(input.placeId) || (text(input.place) ? addonSubjectId('place', text(input.place)) : '');
        const actorIds = Array.isArray(input.actorIds) ? input.actorIds.map(String) : [];
        const itemIds = Array.isArray(input.itemIds) ? input.itemIds.map(String) : [];
        const worldObjectIds = Array.isArray(input.worldObjectIds) ? input.worldObjectIds.map(String) : [];
        if (Array.isArray(input.presences)) {
          for (const [presenceIndex, presence] of input.presences.entries()) {
            const subject = object(object(presence)?.subject);
            const presencePath = `${path}.presences[${presenceIndex}]`;
            if (!subject) {
              issues.push(issue('warning', 'addon_scene_presence_not_imported', sourceFile, presencePath, 'Presence has no supported typed subject.'));
              continue;
            }
            if (text(object(presence)?.state, 'present') !== 'present') {
              issues.push(issue('warning', 'addon_scene_presence_not_imported', sourceFile, presencePath, 'Only present Scene attachments are represented by the current companion Scene model.'));
              continue;
            }
            const subjectKind = text(subject.kind);
            const subjectExternalId = text(subject.id);
            if (subjectKind === 'actor' && subjectExternalId !== '$player') actorIds.push(addonSubjectId('actor', subjectExternalId));
            else if (subjectKind === 'item') itemIds.push(addonSubjectId('item', subjectExternalId));
            else if (subjectKind === 'worldObject' || subjectKind === 'world_object') worldObjectIds.push(addonSubjectId('world_object', subjectExternalId));
            else issues.push(issue('warning', 'addon_scene_presence_not_imported', sourceFile, presencePath, `Scene subject ${subjectKind}:${subjectExternalId} is not represented by the current companion Scene model.`));
          }
        }
        Object.assign(common, {
          ...(placeId ? { placeId } : {}),
          ...(actorIds.length ? { actorIds: [...new Set(actorIds)] } : {}),
          ...(itemIds.length ? { itemIds: [...new Set(itemIds)] } : {}),
          ...(worldObjectIds.length ? { worldObjectIds: [...new Set(worldObjectIds)] } : {}),
        });
      }
      const accepted = new Set(['kind', 'id', 'externalId', 'name', 'title', 'summary', 'aliases', 'visibility']);
      if (kind === 'item') ['ownerActorId', 'ownerExternalId'].forEach(key => accepted.add(key));
      if (kind === 'quest') accepted.add('status');
      if (kind === 'ability') accepted.add('category');
      if (kind === 'fact') ['proposition', 'subject', 'subjectId', 'aboutId'].forEach(key => accepted.add(key));
      if (kind === 'world_object') ['placeId', 'homePlace'].forEach(key => accepted.add(key));
      if (kind === 'relationship') ['source', 'target', 'sourceActorId', 'targetActorId', 'relationshipKind', 'status', 'notes'].forEach(key => accepted.add(key));
      if (kind === 'scene') ['place', 'placeId', 'actorIds', 'itemIds', 'worldObjectIds', 'presences'].forEach(key => accepted.add(key));
      const omitted = Object.keys(input).filter(key => !accepted.has(key) && meaningful(input[key]));
      if (omitted.length) {
        issues.push(issue('warning', 'addon_fields_not_imported', sourceFile, path, `Current companion does not import these fields: ${omitted.join(', ')}.`));
      }
      values.push(common);
    };
    for (const source of documents) {
      const document = source.document;
      const collections: Array<readonly [string, AddonRecordKind]> = [
        ['people', 'actor'], ['items', 'item'], ['quests', 'quest'], ['places', 'place'], ['facts', 'fact'],
        ['worldObjects', 'world_object'], ['abilities', 'ability'], ['relationships', 'relationship'],
      ];
      for (const [key, kind] of collections) {
        const raw = document[key];
        if (raw === undefined) continue;
        if (!Array.isArray(raw)) {
          issues.push(issue('error', 'addon_collection_invalid', source.name, key, `${key} must be an array.`));
          continue;
        }
        raw.forEach((record, index) => add(kind, record, source.name, `${key}[${index}]`));
      }
      if (document.scene !== undefined && document.scene !== null) add('scene', document.scene, source.name, 'scene');
      if (document.records !== undefined) {
        if (!Array.isArray(document.records)) {
          issues.push(issue('error', 'addon_collection_invalid', source.name, 'records', 'records must be an array.'));
        } else {
          document.records.forEach((record, index) => {
            const kind = text(object(record)?.kind) as AddonRecordKind;
            if (!['actor', 'item', 'quest', 'place', 'fact', 'world_object', 'ability', 'relationship', 'scene'].includes(kind)) {
              issues.push(issue('error', 'addon_kind_unsupported', source.name, `records[${index}].kind`, 'Kind must be actor, item, quest, place, fact, world_object, ability, relationship, or scene.'));
              return;
            }
            add(kind, record, source.name, `records[${index}]`);
          });
        }
      }
      for (const [key, message] of KNOWN_UNSUPPORTED) {
        if (meaningful(document[key])) issues.push(issue('warning', 'addon_collection_not_imported', source.name, key, message));
      }
      for (const key of Object.keys(document)) {
        if (key.startsWith('_') || SUPPORTED_TOP_LEVEL.has(key) || KNOWN_UNSUPPORTED.has(key)) continue;
        if (meaningful(document[key])) issues.push(issue('warning', 'addon_key_ignored', source.name, key, `Unknown top-level key ${key} was ignored.`));
      }
    }
    return values;
  }

  private validateReferences(document: CampaignDocument, values: readonly AddonValue[], issues: AddonIssue[]): void {
    const known = new Set([
      ...document.actors.map(record => record.id),
      ...document.items.map(record => record.id),
      ...document.places.map(record => record.id),
      ...(document.facts ?? []).map(record => record.id),
      ...(document.worldObjects ?? []).map(record => record.id),
      ...(document.abilities ?? []).map(record => record.id),
      ...(document.relationships ?? []).map(record => record.id),
      ...values.map(value => value.subjectId),
    ]);
    for (const value of values) {
      const references = [
        ...(value.ownerActorId ? [value.ownerActorId] : []),
        ...(value.placeId ? [value.placeId] : []),
        ...(value.aboutId ? [value.aboutId] : []),
        ...(value.actorIds ?? []),
        ...(value.itemIds ?? []),
        ...(value.worldObjectIds ?? []),
        ...(value.sourceActorId ? [value.sourceActorId] : []),
        ...(value.targetActorId ? [value.targetActorId] : []),
      ];
      for (const reference of references) {
        if (!known.has(reference)) {
          issues.push(issue('error', 'addon_reference_missing', value.sourceFile, `${value.recordKind}:${value.externalId}`, `Reference ${reference} does not exist in Campaign or this addon manifest.`));
        }
      }
      if (value.recordKind === 'scene' && document.currentScene && document.currentScene.id !== value.subjectId) {
        issues.push(issue('error', 'addon_scene_conflict', value.sourceFile, `scene:${value.externalId}`, `Campaign already has another current Scene (${document.currentScene.name}). Advance or replace it explicitly before addon apply.`));
      }
    }
  }

  private candidatePath(candidateId: string): string {
    if (!ID_PATTERN.test(candidateId) || candidateId.length > 128) {
      throw new CampaignExpectedError('ADDON_CANDIDATE_NOT_FOUND', 'Addon candidate ID is invalid.');
    }
    return resolve(this.#candidateRoot, `${candidateId}.json`);
  }

  private async saveCandidate(candidate: AddonCandidate): Promise<void> {
    if (!Value.Check(AddonCandidateSchema, candidate)) throw new Error('Addon candidate does not match its wire schema.');
    await mkdir(this.#candidateRoot, { recursive: true });
    const path = this.candidatePath(candidate.id);
    const partial = `${path}.${randomUUID()}.partial`;
    await writeFile(partial, `${JSON.stringify(candidate, null, 2)}\n`, 'utf8');
    await rename(partial, path);
  }

  private async loadCandidate(candidateId: string): Promise<AddonCandidate> {
    try {
      const candidate = JSON.parse(await readFile(this.candidatePath(candidateId), 'utf8')) as unknown;
      if (!Value.Check(AddonCandidateSchema, candidate)) throw new Error('Candidate schema is invalid.');
      return candidate as AddonCandidate;
    } catch (error) {
      if (error instanceof CampaignExpectedError) throw error;
      throw new CampaignExpectedError('ADDON_CANDIDATE_NOT_FOUND', `Addon candidate ${candidateId} was not found or is invalid.`);
    }
  }
}
