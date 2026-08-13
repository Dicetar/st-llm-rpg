import { createHash } from 'node:crypto';
import type {
  CampaignActor,
  CampaignAbility,
  CampaignDocument,
  CampaignFact,
  CampaignItem,
  CampaignPlace,
  CampaignQuest,
  CampaignRelationship,
  CampaignWorldObject,
  ChatBindingDocument,
  ContextAmbiguity,
  ContextOmission,
  ContextPlan,
  ContextSelection,
  NarratorModelProfile,
  NarratorVisibility,
  PreflightContextRequest,
  Problem,
  RecoveryAction,
} from '@st-llm-rpg/wire';
import { makeProblem } from '../../problem.js';

export type ContextSearchHit = Readonly<{
  recordId: string;
  rank: number;
  matchedTerms: number;
}>;

export type ContextAuthority = Readonly<{
  campaign: CampaignDocument;
  binding: ChatBindingDocument;
  profile: NarratorModelProfile;
}>;

export interface ContextPlanningSource {
  readAuthority(request: PreflightContextRequest): Promise<ContextAuthority>;
  search(request: Readonly<{
    campaignId: string;
    campaignRevision: number;
    query: string;
    limit: number;
  }>): Promise<readonly ContextSearchHit[]>;
}

export type ContextOutcome =
  | Readonly<{ ok: true; value: ContextPlan }>
  | Readonly<{ ok: false; problem: Problem }>;

type ContextRecord = Readonly<{
  id: string;
  kind: 'actor' | 'item' | 'quest' | 'place' | 'fact' | 'world_object' | 'ability' | 'relationship';
  name: string;
  aliases: readonly string[];
  summary: string;
  visibility: NarratorVisibility;
  archived: boolean;
  relations: readonly string[];
  category?: CampaignAbility['category'];
  learningLabels?: readonly string[];
  relationshipLabel?: string;
  subjectLabel?: string;
  placeLabel?: string;
  trackerLabels?: readonly string[];
}>;

const INSTRUCTION_OVERHEAD_TOKENS = 128;
const MAX_EVIDENCE_TOKENS = 2_000;

function estimateTokens(value: string): number {
  return Math.ceil(Buffer.byteLength(value, 'utf8') / 3);
}

function normalizePhrase(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim().replace(/\s+/g, ' ');
}

function phrasePattern(value: string): RegExp {
  const normalized = normalizePhrase(value);
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(?:^|\\b)${escaped}(?:$|\\b)`, 'iu');
}

function visibilityOf(record: { visibility?: NarratorVisibility }): NarratorVisibility {
  return record.visibility ?? 'known';
}

function recordsOf(document: CampaignDocument): ContextRecord[] {
  const factIdsBySubject = new Map<string, string[]>();
  for (const fact of (document.facts ?? [])) {
    if (fact.archived || visibilityOf(fact) === 'campaign_private' || !fact.subjectId) continue;
    factIdsBySubject.set(fact.subjectId, [...(factIdsBySubject.get(fact.subjectId) ?? []), fact.id]);
  }
  const worldObjectIdsByPlace = new Map<string, string[]>();
  for (const worldObject of (document.worldObjects ?? [])) {
    if (worldObject.archived || visibilityOf(worldObject) === 'campaign_private' || !worldObject.placeId) continue;
    worldObjectIdsByPlace.set(worldObject.placeId, [...(worldObjectIdsByPlace.get(worldObject.placeId) ?? []), worldObject.id]);
  }
  const learned = (document.learnedAbilities ?? []).filter(record => !record.archived);
  const abilityIdsByActor = new Map<string, string[]>();
  const actorIdsByAbility = new Map<string, string[]>();
  for (const entry of learned) {
    abilityIdsByActor.set(entry.actorId, [...(abilityIdsByActor.get(entry.actorId) ?? []), entry.abilityId]);
    actorIdsByAbility.set(entry.abilityId, [...(actorIdsByAbility.get(entry.abilityId) ?? []), entry.actorId]);
  }
  const activeRelationships = (document.relationships ?? []).filter(record => !record.archived);
  const narratableRelationships = activeRelationships.filter(record => visibilityOf(record) !== 'campaign_private');
  const relationIdsByActor = new Map<string, string[]>();
  for (const relationship of narratableRelationships) {
    relationIdsByActor.set(relationship.sourceActorId, [
      ...(relationIdsByActor.get(relationship.sourceActorId) ?? []), relationship.id, relationship.targetActorId,
    ]);
    relationIdsByActor.set(relationship.targetActorId, [
      ...(relationIdsByActor.get(relationship.targetActorId) ?? []), relationship.id, relationship.sourceActorId,
    ]);
  }
  const actors = document.actors.map((record: CampaignActor): ContextRecord => ({
    id: record.id,
    kind: 'actor',
    name: record.name,
    aliases: record.aliases ?? [],
    summary: record.summary,
    visibility: visibilityOf(record),
    archived: record.archived,
    trackerLabels: (record.trackers ?? []).map(tracker => (
      `${tracker.label}: ${tracker.current}${tracker.maximum === undefined ? '' : `/${tracker.maximum}`}${tracker.notes ? ` (${tracker.notes})` : ''}`
    )),
    relations: [...new Set([...(abilityIdsByActor.get(record.id) ?? []), ...(relationIdsByActor.get(record.id) ?? []), ...(factIdsBySubject.get(record.id) ?? [])])],
  }));
  const items = document.items.map((record: CampaignItem): ContextRecord => ({
    id: record.id,
    kind: 'item',
    name: record.name,
    aliases: record.aliases ?? [],
    summary: record.summary,
    visibility: visibilityOf(record),
    archived: record.archived,
    relations: [...(record.ownerActorId ? [record.ownerActorId] : []), ...(factIdsBySubject.get(record.id) ?? [])],
  }));
  const quests = document.quests.map((record: CampaignQuest): ContextRecord => ({
    id: record.id,
    kind: 'quest',
    name: record.name,
    aliases: record.aliases ?? [],
    summary: record.summary,
    visibility: visibilityOf(record),
    archived: record.archived,
    relations: factIdsBySubject.get(record.id) ?? [],
  }));
  const places = document.places.map((record: CampaignPlace): ContextRecord => ({
    id: record.id,
    kind: 'place',
    name: record.name,
    aliases: record.aliases ?? [],
    summary: record.summary,
    visibility: visibilityOf(record),
    archived: record.archived,
    relations: [...(worldObjectIdsByPlace.get(record.id) ?? []), ...(factIdsBySubject.get(record.id) ?? [])],
  }));
  const facts = (document.facts ?? []).map((record: CampaignFact): ContextRecord => ({
    id: record.id,
    kind: 'fact',
    name: record.name,
    aliases: record.aliases ?? [],
    summary: record.summary,
    visibility: visibilityOf(record),
    archived: record.archived,
    relations: record.subjectId ? [record.subjectId] : [],
    ...(record.subjectId ? { subjectLabel: recordsLabel(document, record.subjectId) ?? record.subjectId } : {}),
  }));
  const worldObjects = (document.worldObjects ?? []).map((record: CampaignWorldObject): ContextRecord => ({
    id: record.id,
    kind: 'world_object',
    name: record.name,
    aliases: record.aliases ?? [],
    summary: record.summary,
    visibility: visibilityOf(record),
    archived: record.archived,
    relations: [...(record.placeId ? [record.placeId] : []), ...(factIdsBySubject.get(record.id) ?? [])],
    ...(record.placeId ? {
      placeLabel: document.places.find(candidate => candidate.id === record.placeId)?.name ?? record.placeId,
    } : {}),
  }));
  const abilities = (document.abilities ?? []).map((record: CampaignAbility): ContextRecord => ({
    id: record.id,
    kind: 'ability',
    name: record.name,
    aliases: record.aliases ?? [],
    summary: record.summary,
    visibility: visibilityOf(record),
    archived: record.archived,
    relations: [...(actorIdsByAbility.get(record.id) ?? []), ...(factIdsBySubject.get(record.id) ?? [])],
    category: record.category,
    learningLabels: learned.filter(entry => entry.abilityId === record.id).map(entry => {
      const actor = document.actors.find(candidate => candidate.id === entry.actorId);
      const uses = entry.usesRemaining === undefined
        ? ''
        : `, ${entry.usesRemaining}${entry.usesMaximum === undefined ? '' : `/${entry.usesMaximum}`} uses`;
      return `${actor?.name ?? entry.actorId}${entry.prepared ? ', prepared' : ''}${entry.enabled ? '' : ', disabled'}${uses}`;
    }),
  }));
  const relationships = activeRelationships.flatMap((record: CampaignRelationship): ContextRecord[] => {
    const source = document.actors.find(candidate => candidate.id === record.sourceActorId);
    const target = document.actors.find(candidate => candidate.id === record.targetActorId);
    if (!source || !target || source.archived || target.archived) return [];
    return [{
      id: record.id,
      kind: 'relationship',
      name: `${source.name} → ${target.name}`,
      aliases: [],
      summary: record.notes,
      visibility: visibilityOf(record),
      archived: record.archived,
      relations: [source.id, target.id],
      relationshipLabel: `${source.name} —${record.kind}→ ${target.name} (${record.status})`,
    }];
  });
  return [...actors, ...items, ...quests, ...places, ...facts, ...worldObjects, ...abilities, ...relationships]
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

function renderCore(document: CampaignDocument): string {
  const rows = [
    'CAMPAIGN CORE — AUTHORITATIVE',
    `Campaign: ${document.campaign.title} · revision ${document.campaign.revision}`,
    document.currentScene
      ? `Current scene: ${document.currentScene.name}${document.currentScene.summary ? ` — ${document.currentScene.summary}` : ''}`
      : 'Current scene: none',
  ];
  const actors = document.actors.filter(record => !record.archived && visibilityOf(record) === 'known');
  const items = document.items.filter(record => !record.archived && visibilityOf(record) === 'known');
  const quests = document.quests.filter(record => !record.archived && record.status === 'active' && visibilityOf(record) === 'known');
  const learned = (document.learnedAbilities ?? []).filter(record => !record.archived && record.enabled);
  const learnedNames = learned.flatMap(entry => {
    const ability = (document.abilities ?? []).find(record => record.id === entry.abilityId && !record.archived && visibilityOf(record) === 'known');
    const actor = document.actors.find(record => record.id === entry.actorId && !record.archived);
    return ability && actor ? [`${ability.name} (${actor.name})`] : [];
  });
  if (actors.length) rows.push(`Actors: ${actors.map(record => record.name).join(', ')}`);
  if (items.length) rows.push(`Items: ${items.map(record => record.name).join(', ')}`);
  if (quests.length) rows.push(`Active quests: ${quests.map(record => record.name).join(', ')}`);
  if (learnedNames.length) rows.push(`Available abilities: ${learnedNames.join(', ')}`);
  return rows.join('\n');
}

function recordsLabel(document: CampaignDocument, recordId: string): string | undefined {
  return [
    ...document.actors,
    ...document.items,
    ...document.quests,
    ...document.places,
    ...(document.facts ?? []),
    ...(document.worldObjects ?? []),
    ...(document.abilities ?? []),
  ].find(record => record.id === recordId)?.name;
}

function renderRecord(record: ContextRecord): string {
  const aliases = record.aliases.length ? `\nAliases: ${record.aliases.join(', ')}` : '';
  const category = record.category ? `\nCategory: ${record.category}` : '';
  const learning = record.learningLabels?.length ? `\nKnown by: ${record.learningLabels.join('; ')}` : '';
  const relationship = record.relationshipLabel ? `\n${record.relationshipLabel}` : '';
  const subject = record.subjectLabel ? `\nAbout: ${record.subjectLabel}` : '';
  const place = record.placeLabel ? `\nPlace: ${record.placeLabel}` : '';
  const trackers = record.trackerLabels?.length ? `\nLive trackers: ${record.trackerLabels.join('; ')}` : '';
  return `${record.kind.replace('_', ' ').toUpperCase()}: ${record.name}${category}${aliases}${relationship}${subject}${place}${record.summary ? `\n${record.summary}` : ''}${learning}${trackers}`;
}

function fitToTokenBudget(value: string, maximumTokens: number): string {
  if (estimateTokens(value) <= maximumTokens) return value;
  const characters = Array.from(value);
  let low = 0;
  let high = characters.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (estimateTokens(characters.slice(0, middle).join('')) <= maximumTokens) low = middle;
    else high = middle - 1;
  }
  return characters.slice(0, low).join('');
}

function boundedEvidence(messages: PreflightContextRequest['messages']) {
  const newestFirst = [...messages].reverse();
  const primary = newestFirst.find(message => message.role === 'user') ?? newestFirst[0]!;
  const ordered = [primary, ...newestFirst.filter(message => message !== primary)];
  const excerpt: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  let estimatedTokens = 0;
  for (const message of ordered) {
    const available = MAX_EVIDENCE_TOKENS - estimatedTokens;
    if (available < 4) break;
    const content = fitToTokenBudget(message.content, available - 4);
    excerpt.push({ role: message.role, content });
    estimatedTokens += estimateTokens(content) + 4;
    if (estimatedTokens >= MAX_EVIDENCE_TOKENS) break;
  }
  return {
    texts: excerpt.map(message => normalizePhrase(message.content)),
    excerptHash: createHash('sha256').update(JSON.stringify(excerpt)).digest('hex'),
    estimatedTokens,
    messageCount: excerpt.length,
  };
}

function exactMentionCandidates(records: readonly ContextRecord[], evidence: readonly string[]) {
  const phraseRecords = new Map<string, ContextRecord[]>();
  for (const record of records) {
    if (record.archived || record.visibility === 'campaign_private') continue;
    for (const phrase of [record.name, ...record.aliases]) {
      const normalized = normalizePhrase(phrase);
      if (!normalized) continue;
      const matches = phraseRecords.get(normalized) ?? [];
      if (!matches.some(candidate => candidate.id === record.id)) matches.push(record);
      phraseRecords.set(normalized, matches);
    }
  }
  return [...phraseRecords.entries()]
    .filter(([phrase]) => evidence.some(text => phrasePattern(phrase).test(text)))
    .sort((left, right) => right[0].length - left[0].length || left[0].localeCompare(right[0]));
}

const OPEN_CONTEXT_TRAY_ACTION: RecoveryAction = {
  id: 'open-context-tray',
  label: 'Open Context Tray',
  kind: 'inspect',
};
const UNPIN_RECORD_ACTION: RecoveryAction = {
  id: 'unpin-record',
  label: 'Remove a manual pin',
  kind: 'inspect',
};
const CHOOSE_LARGER_PROFILE_ACTION: RecoveryAction = {
  id: 'choose-larger-profile',
  label: 'Choose a larger model profile',
  kind: 'inspect',
};

function problem(
  requestId: string,
  code: Problem['code'],
  message: string,
  details?: unknown,
  actions: readonly RecoveryAction[] = [OPEN_CONTEXT_TRAY_ACTION],
): ContextOutcome {
  return {
    ok: false,
    problem: makeProblem({
      code,
      message,
      requestId,
      actions,
      ...(details === undefined ? {} : { details }),
    }),
  };
}

export class ContextPlanner {
  constructor(private readonly source: ContextPlanningSource) {}

  async plan(request: PreflightContextRequest, signal: AbortSignal): Promise<ContextOutcome> {
    if (signal.aborted) return problem(request.requestId, 'CONTEXT_CANCELLED', 'Context planning was cancelled.');
    const authority = await this.source.readAuthority(request);
    const focusRevision = authority.binding.contextFocusRevision ?? 1;
    if (
      authority.campaign.campaign.id !== request.campaignId
      || authority.campaign.campaign.revision !== request.campaignRevision
      || authority.binding.id !== request.bindingId
      || authority.binding.revision !== request.bindingRevision
      || focusRevision !== request.contextFocusRevision
      || authority.binding.campaignId !== request.campaignId
      || authority.binding.campaignAnchor !== request.campaignRevision
    ) {
      return problem(request.requestId, 'CONTEXT_AUTHORITY_MISMATCH', 'Campaign or Chat Binding authority changed before Context planning.', {
        requested: {
          campaignRevision: request.campaignRevision,
          bindingRevision: request.bindingRevision,
          contextFocusRevision: request.contextFocusRevision,
        },
        actual: {
          campaignRevision: authority.campaign.campaign.revision,
          bindingRevision: authority.binding.revision,
          contextFocusRevision: focusRevision,
        },
      });
    }
    if (authority.profile.id !== request.modelProfileId) {
      return problem(request.requestId, 'CONTEXT_MODEL_PROFILE_MISSING', `Narrator model profile ${request.modelProfileId} is unavailable.`);
    }

    const records = recordsOf(authority.campaign);
    const byId = new Map(records.map(record => [record.id, record]));
    const evidence = boundedEvidence(request.messages);
    const existingMessageTokens = evidence.estimatedTokens;
    const inputCeilingTokens = Math.max(0, authority.profile.contextWindowTokens
      - authority.profile.requestedVisibleOutputTokens
      - authority.profile.safetyMarginTokens);
    const campaignBudgetTokens = Math.max(0, Math.min(
      authority.profile.maxCampaignTokens,
      inputCeilingTokens - existingMessageTokens - INSTRUCTION_OVERHEAD_TOKENS,
    ));

    const core = renderCore(authority.campaign);
    const coreCost = estimateTokens(core);
    if (coreCost > campaignBudgetTokens) {
      return problem(request.requestId, 'CONTEXT_CORE_OVER_BUDGET', 'Required Campaign context does not fit the selected model profile.', {
        requiredTokens: coreCost,
        availableTokens: campaignBudgetTokens,
      }, [OPEN_CONTEXT_TRAY_ACTION, CHOOSE_LARGER_PROFILE_ACTION]);
    }

    const selections: ContextSelection[] = [{
      tier: 'required-core',
      label: 'Campaign core',
      visibility: 'known',
      tokenCost: coreCost,
      reason: 'Required Campaign and current Scene authority.',
    }];
    const omissions: ContextOmission[] = [];
    const ambiguities: ContextAmbiguity[] = [];
    const knownBlocks = [core];
    const secretBlocks: string[] = [];
    const selected = new Set<string>();
    const ambiguousIds = new Set<string>();
    let usedCampaignTokens = coreCost;

    for (const pinId of authority.binding.pins ?? []) {
      const record = byId.get(pinId);
      if (!record || record.archived) {
        return problem(
          request.requestId,
          'CONTEXT_STALE_PIN',
          `Pinned Record ${pinId} is missing or archived.`,
          { recordId: pinId },
          [OPEN_CONTEXT_TRAY_ACTION, UNPIN_RECORD_ACTION],
        );
      }
      if (record.visibility === 'campaign_private') {
        return problem(
          request.requestId,
          'CONTEXT_PRIVATE_PIN',
          `Pinned Record ${pinId} is Campaign Private.`,
          { recordId: pinId },
          [OPEN_CONTEXT_TRAY_ACTION, UNPIN_RECORD_ACTION],
        );
      }
      const rendered = renderRecord(record);
      const tokenCost = estimateTokens(rendered);
      if (usedCampaignTokens + tokenCost > campaignBudgetTokens) {
        return problem(request.requestId, 'CONTEXT_PINS_OVER_BUDGET', 'Required core and ordered manual pins do not fit the selected model profile.', {
          availableTokens: campaignBudgetTokens,
          usedTokens: usedCampaignTokens,
          pin: { recordId: record.id, label: record.name, tokenCost },
        }, [
          OPEN_CONTEXT_TRAY_ACTION,
          UNPIN_RECORD_ACTION,
          CHOOSE_LARGER_PROFILE_ACTION,
        ]);
      }
      selections.push({
        tier: 'manual-pin',
        recordId: record.id,
        recordKind: record.kind,
        label: record.name,
        visibility: record.visibility,
        tokenCost,
        reason: 'Ordered manual pin from this Chat Binding.',
      });
      (record.visibility === 'narrator_secret' ? secretBlocks : knownBlocks).push(rendered);
      selected.add(record.id);
      usedCampaignTokens += tokenCost;
    }

    let automaticCount = 0;
    for (const [phrase, matches] of exactMentionCandidates(records, evidence.texts)) {
      if (matches.some(record => selected.has(record.id))) continue;
      const available = matches.filter(record => !selected.has(record.id));
      if (available.length === 0) continue;
      if (available.length > 1) {
        ambiguities.push({
          phrase,
          candidates: available.map(record => ({ recordId: record.id, label: record.name }))
            .sort((left, right) => left.label.localeCompare(right.label) || left.recordId.localeCompare(right.recordId)),
        });
        for (const record of available) {
          ambiguousIds.add(record.id);
          omissions.push({ recordId: record.id, label: record.name, reason: 'ambiguity' });
        }
        continue;
      }
      const record = available[0]!;
      if (automaticCount >= authority.profile.maxAutomaticRecords) {
        omissions.push({ recordId: record.id, label: record.name, reason: 'record-limit' });
        continue;
      }
      const rendered = renderRecord(record);
      const tokenCost = estimateTokens(rendered);
      if (usedCampaignTokens + tokenCost > campaignBudgetTokens) {
        omissions.push({ recordId: record.id, label: record.name, reason: 'token-budget', tokenCost });
        continue;
      }
      selections.push({
        tier: 'exact-mention',
        recordId: record.id,
        recordKind: record.kind,
        label: record.name,
        visibility: record.visibility,
        tokenCost,
        reason: `Unique exact name or alias mention: ${phrase}.`,
      });
      (record.visibility === 'narrator_secret' ? secretBlocks : knownBlocks).push(rendered);
      selected.add(record.id);
      usedCampaignTokens += tokenCost;
      automaticCount += 1;
    }

    const scene = authority.campaign.currentScene;
    const sceneAnchorIds = scene
      ? [scene.placeId, ...(scene.actorIds ?? []), ...(scene.itemIds ?? []), ...(scene.worldObjectIds ?? [])].filter((id): id is string => Boolean(id)).slice(0, 4)
      : [];
    for (const recordId of sceneAnchorIds) {
      const record = byId.get(recordId);
      if (!record || record.archived || record.visibility === 'campaign_private') continue;
      if (selected.has(record.id) || ambiguousIds.has(record.id)) continue;
      if (automaticCount >= authority.profile.maxAutomaticRecords) {
        omissions.push({ recordId: record.id, label: record.name, reason: 'record-limit' });
        continue;
      }
      const rendered = renderRecord(record);
      const tokenCost = estimateTokens(rendered);
      if (usedCampaignTokens + tokenCost > campaignBudgetTokens) {
        omissions.push({ recordId: record.id, label: record.name, reason: 'token-budget', tokenCost });
        continue;
      }
      selections.push({
        tier: 'scene-anchor',
        recordId: record.id,
        recordKind: record.kind,
        label: record.name,
        visibility: record.visibility,
        tokenCost,
        reason: 'Structural attachment to the current Scene.',
      });
      (record.visibility === 'narrator_secret' ? secretBlocks : knownBlocks).push(rendered);
      selected.add(record.id);
      usedCampaignTokens += tokenCost;
      automaticCount += 1;
    }

    if (automaticCount < authority.profile.maxAutomaticRecords) {
      const query = evidence.texts.join(' ');
      const searchHits = await this.source.search({
        campaignId: request.campaignId,
        campaignRevision: request.campaignRevision,
        query,
        limit: 16,
      });
      if (signal.aborted) return problem(request.requestId, 'CONTEXT_CANCELLED', 'Context planning was cancelled.');
      const orderedHits = [...searchHits].sort((left, right) => {
        const leftRecord = byId.get(left.recordId);
        const rightRecord = byId.get(right.recordId);
        return left.rank - right.rank
          || right.matchedTerms - left.matchedTerms
          || String(leftRecord?.name ?? '').localeCompare(String(rightRecord?.name ?? ''))
          || left.recordId.localeCompare(right.recordId);
      });
      for (const hit of orderedHits) {
        const record = byId.get(hit.recordId);
        if (!record || record.archived || record.visibility === 'campaign_private') continue;
        if (selected.has(record.id) || ambiguousIds.has(record.id)) continue;
        if (hit.matchedTerms < 2) {
          omissions.push({ recordId: record.id, label: record.name, reason: 'threshold' });
          continue;
        }
        if (automaticCount >= authority.profile.maxAutomaticRecords) {
          omissions.push({ recordId: record.id, label: record.name, reason: 'record-limit' });
          continue;
        }
        const rendered = renderRecord(record);
        const tokenCost = estimateTokens(rendered);
        if (usedCampaignTokens + tokenCost > campaignBudgetTokens) {
          omissions.push({ recordId: record.id, label: record.name, reason: 'token-budget', tokenCost });
          continue;
        }
        selections.push({
          tier: 'fts5',
          recordId: record.id,
          recordKind: record.kind,
          label: record.name,
          visibility: record.visibility,
          tokenCost,
          reason: 'Qualified lexical match from the Campaign narrator index.',
        });
        (record.visibility === 'narrator_secret' ? secretBlocks : knownBlocks).push(rendered);
        selected.add(record.id);
        usedCampaignTokens += tokenCost;
        automaticCount += 1;
      }
    }

    const relationIds = selections
      .map(selection => selection.recordId ? byId.get(selection.recordId) : undefined)
      .filter((record): record is ContextRecord => Boolean(record))
      .flatMap(record => [...record.relations]);
    let relationCount = 0;
    for (const recordId of relationIds) {
      if (relationCount >= authority.profile.maxRelationExpansions) break;
      const record = byId.get(recordId);
      if (!record || record.archived || record.visibility === 'campaign_private') continue;
      if (selected.has(record.id) || ambiguousIds.has(record.id)) continue;
      if (automaticCount >= authority.profile.maxAutomaticRecords) {
        omissions.push({ recordId: record.id, label: record.name, reason: 'record-limit' });
        continue;
      }
      const rendered = renderRecord(record);
      const tokenCost = estimateTokens(rendered);
      if (usedCampaignTokens + tokenCost > campaignBudgetTokens) {
        omissions.push({ recordId: record.id, label: record.name, reason: 'token-budget', tokenCost });
        continue;
      }
      selections.push({
        tier: 'relation-hop',
        recordId: record.id,
        recordKind: record.kind,
        label: record.name,
        visibility: record.visibility,
        tokenCost,
        reason: 'One-hop explicit relation from a selected Record.',
      });
      (record.visibility === 'narrator_secret' ? secretBlocks : knownBlocks).push(rendered);
      selected.add(record.id);
      usedCampaignTokens += tokenCost;
      automaticCount += 1;
      relationCount += 1;
    }

    const blocks: ContextPlan['blocks'] = {
      known: knownBlocks.join('\n\n'),
      ...(secretBlocks.length ? {
        secret: [
          'NARRATOR SECRET — USE SILENTLY',
          'Maintain causality and characterization from this material. Do not state, confirm, quote, or expose it directly.',
          ...secretBlocks,
        ].join('\n\n'),
      } : {}),
    };
    const planWithoutHash = {
      schema: 'st-rpg.context-plan' as const,
      version: '1.0' as const,
      requestId: request.requestId,
      authority: {
        campaignId: request.campaignId,
        campaignRevision: request.campaignRevision,
        bindingId: request.bindingId,
        bindingRevision: request.bindingRevision,
        contextFocusRevision: request.contextFocusRevision,
      },
      modelProfile: { id: authority.profile.id, modelId: authority.profile.modelId },
      generationType: request.generationType,
      evidence: {
        excerptHash: evidence.excerptHash,
        estimatedTokens: evidence.estimatedTokens,
        messageCount: evidence.messageCount,
      },
      budget: {
        inputCeilingTokens,
        campaignBudgetTokens,
        existingMessageTokens,
        usedCampaignTokens,
        remainingCampaignTokens: Math.max(0, campaignBudgetTokens - usedCampaignTokens),
      },
      selections,
      omissions,
      ambiguities,
      blocks,
    };
    const contentHash = createHash('sha256').update(JSON.stringify(planWithoutHash)).digest('hex');
    return { ok: true, value: { ...planWithoutHash, contentHash } };
  }
}
