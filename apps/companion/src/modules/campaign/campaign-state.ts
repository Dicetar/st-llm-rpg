import { createHash, randomUUID } from 'node:crypto';
import type {
  CampaignActor,
  CampaignAbility,
  CampaignDocument,
  CampaignItem,
  CampaignLearnedAbility,
  CampaignOperation,
  CampaignPlace,
  CampaignQuest,
  CampaignRelationship,
  CampaignScene,
  CampaignSummary,
  NarratorVisibility,
} from '@st-llm-rpg/wire';
import { CampaignExpectedError } from './campaign-error.js';

export type CampaignState = {
  campaign: CampaignSummary;
  actors: Record<string, CampaignActor>;
  items: Record<string, CampaignItem>;
  quests?: Record<string, CampaignQuest>;
  places?: Record<string, CampaignPlace>;
  abilities?: Record<string, CampaignAbility>;
  learnedAbilities?: Record<string, CampaignLearnedAbility>;
  relationships?: Record<string, CampaignRelationship>;
  currentScene: CampaignScene | null;
};

export type CampaignSubjectKind = 'actor' | 'item' | 'quest' | 'place' | 'ability' | 'learned_ability' | 'relationship' | 'current_scene';
export type CampaignSubjectImage = CampaignActor | CampaignItem | CampaignQuest | CampaignPlace | CampaignAbility | CampaignLearnedAbility | CampaignRelationship | CampaignScene | null;
export type CampaignSubjectChange = Readonly<{
  subjectKind: CampaignSubjectKind;
  subjectId: string;
  beforeImage: CampaignSubjectImage;
  afterImage: CampaignSubjectImage;
}>;

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort()
      .filter(key => record[key] !== undefined)
      .map(key => [key, sortValue(record[key])]));
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function sha256(value: unknown): string {
  return createHash('sha256').update(typeof value === 'string' ? value : canonicalJson(value)).digest('hex');
}

export function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

export function normalizeCampaignState(state: CampaignState): CampaignState {
  return {
    ...state,
    quests: state.quests ?? {},
    places: state.places ?? {},
    abilities: state.abilities ?? {},
    learnedAbilities: state.learnedAbilities ?? {},
    relationships: state.relationships ?? {},
  };
}

export function cleanText(value: string, field: string, maximum: number): string {
  const cleaned = String(value ?? '').trim();
  if (!cleaned) throw new CampaignExpectedError('CAMPAIGN_VALIDATION_FAILED', `${field} is required.`, { field });
  if (cleaned.length > maximum) {
    throw new CampaignExpectedError('CAMPAIGN_VALIDATION_FAILED', `${field} must be ${maximum} characters or fewer.`, { field, maximum });
  }
  return cleaned;
}

function cleanOptionalText(value: string | undefined, field: string, maximum: number): string {
  const cleaned = String(value ?? '').trim();
  if (cleaned.length > maximum) {
    throw new CampaignExpectedError('CAMPAIGN_VALIDATION_FAILED', `${field} must be ${maximum} characters or fewer.`, { field, maximum });
  }
  return cleaned;
}

export function cleanIdentifier(value: string, field: string): string {
  const cleaned = cleanText(value, field, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(cleaned)) {
    throw new CampaignExpectedError('CAMPAIGN_VALIDATION_FAILED', `${field} contains unsupported characters.`, { field });
  }
  return cleaned;
}

export function asDocument(state: CampaignState): CampaignDocument {
  const byName = <T extends { id: string; name: string }>(left: T, right: T) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
  return {
    campaign: structuredClone(state.campaign),
    actors: Object.values(state.actors).sort(byName),
    items: Object.values(state.items).sort(byName),
    quests: Object.values(state.quests ?? {}).sort(byName),
    places: Object.values(state.places ?? {}).sort(byName),
    abilities: Object.values(state.abilities ?? {}).sort(byName),
    learnedAbilities: Object.values(state.learnedAbilities ?? {}).sort((left, right) => left.id.localeCompare(right.id)),
    relationships: Object.values(state.relationships ?? {}).sort((left, right) => left.id.localeCompare(right.id)),
    currentScene: state.currentScene ? structuredClone(state.currentScene) : null,
  };
}

export function normalizeCampaignDocument(document: CampaignDocument): CampaignDocument {
  const legacy = document as CampaignDocument & {
    quests?: CampaignQuest[];
    places?: CampaignPlace[];
    abilities?: CampaignAbility[];
    learnedAbilities?: CampaignLearnedAbility[];
    relationships?: CampaignRelationship[];
  };
  return {
    ...document,
    quests: legacy.quests ?? [],
    places: legacy.places ?? [],
    abilities: legacy.abilities ?? [],
    learnedAbilities: legacy.learnedAbilities ?? [],
    relationships: legacy.relationships ?? [],
  };
}

export function eventHash(input: {
  campaignId: string;
  revision: number;
  eventId: string;
  requestId: string;
  operationKind: string;
  operation: unknown;
  beforeState: CampaignState | null;
  afterState: CampaignState;
  acceptedAt: string;
  previousEventHash: string | null;
}): string {
  return sha256(input);
}

function recordIdExists(state: CampaignState, id: string): boolean {
  return Boolean(
    state.actors[id]
    || state.items[id]
    || state.quests?.[id]
    || state.places?.[id]
    || state.abilities?.[id]
    || state.learnedAbilities?.[id]
    || state.relationships?.[id]
    || state.currentScene?.id === id,
  );
}

function requireUnusedId(state: CampaignState, value: string | undefined, field: string): string {
  const id = value ? cleanIdentifier(value, field) : randomUUID();
  if (recordIdExists(state, id)) {
    throw new CampaignExpectedError('CAMPAIGN_VALIDATION_FAILED', `Record ID ${id} already exists.`, { id });
  }
  return id;
}

function requireActor(state: CampaignState, actorId: string): CampaignActor {
  const id = cleanIdentifier(actorId, 'Actor ID');
  const actor = state.actors[id];
  if (!actor) throw new CampaignExpectedError('CAMPAIGN_RECORD_NOT_FOUND', `Actor ${id} was not found.`, { actorId: id });
  return actor;
}

function requireAttachableActor(state: CampaignState, actorId: string): CampaignActor {
  const actor = requireActor(state, actorId);
  if (actor.archived) {
    throw new CampaignExpectedError(
      'CAMPAIGN_VALIDATION_FAILED',
      `Item cannot be attached to archived Actor ${actor.id}.`,
      { actorId: actor.id },
    );
  }
  return actor;
}

function requireItem(state: CampaignState, itemId: string): CampaignItem {
  const id = cleanIdentifier(itemId, 'Item ID');
  const item = state.items[id];
  if (!item) throw new CampaignExpectedError('CAMPAIGN_RECORD_NOT_FOUND', `Item ${id} was not found.`, { itemId: id });
  return item;
}

function requireQuest(state: CampaignState, questId: string): CampaignQuest {
  const id = cleanIdentifier(questId, 'Quest ID');
  const quest = state.quests?.[id];
  if (!quest) throw new CampaignExpectedError('CAMPAIGN_RECORD_NOT_FOUND', `Quest ${id} was not found.`, { questId: id });
  return quest;
}

function requirePlace(state: CampaignState, placeId: string): CampaignPlace {
  const id = cleanIdentifier(placeId, 'Place ID');
  const place = state.places?.[id];
  if (!place) throw new CampaignExpectedError('CAMPAIGN_RECORD_NOT_FOUND', `Place ${id} was not found.`, { placeId: id });
  return place;
}

function requireAbility(state: CampaignState, abilityId: string): CampaignAbility {
  const id = cleanIdentifier(abilityId, 'Ability ID');
  const ability = state.abilities?.[id];
  if (!ability) throw new CampaignExpectedError('CAMPAIGN_RECORD_NOT_FOUND', `Ability ${id} was not found.`, { abilityId: id });
  return ability;
}

function requireLearnedAbility(state: CampaignState, learnedAbilityId: string): CampaignLearnedAbility {
  const id = cleanIdentifier(learnedAbilityId, 'Learned Ability ID');
  const learned = state.learnedAbilities?.[id];
  if (!learned) throw new CampaignExpectedError('CAMPAIGN_RECORD_NOT_FOUND', `Learned Ability ${id} was not found.`, { learnedAbilityId: id });
  return learned;
}

function requireRelationship(state: CampaignState, relationshipId: string): CampaignRelationship {
  const id = cleanIdentifier(relationshipId, 'Relationship ID');
  const relationship = state.relationships?.[id];
  if (!relationship) throw new CampaignExpectedError('CAMPAIGN_RECORD_NOT_FOUND', `Relationship ${id} was not found.`, { relationshipId: id });
  return relationship;
}

function requireActiveRelationshipActor(state: CampaignState, actorId: string): CampaignActor {
  const actor = requireActor(state, actorId);
  if (actor.archived) {
    throw new CampaignExpectedError('CAMPAIGN_VALIDATION_FAILED', `Archived Actor ${actor.id} cannot be used in an active Relationship.`, { actorId: actor.id });
  }
  return actor;
}

function requireRelationshipEndpoints(state: CampaignState, sourceActorId: string, targetActorId: string): readonly [string, string] {
  const source = requireActiveRelationshipActor(state, sourceActorId).id;
  const target = requireActiveRelationshipActor(state, targetActorId).id;
  if (source === target) {
    throw new CampaignExpectedError('CAMPAIGN_VALIDATION_FAILED', 'A Relationship must connect two different Actors.', { sourceActorId: source, targetActorId: target });
  }
  return [source, target];
}

function requireUniqueRelationship(
  state: CampaignState,
  sourceActorId: string,
  targetActorId: string,
  relationshipKind: string,
  exceptId?: string,
): void {
  const normalizedKind = relationshipKind.normalize('NFKC').toLocaleLowerCase('en-US');
  const duplicate = Object.values(state.relationships ?? {}).find(candidate => (
    candidate.id !== exceptId
    && !candidate.archived
    && candidate.sourceActorId === sourceActorId
    && candidate.targetActorId === targetActorId
    && candidate.kind.normalize('NFKC').toLocaleLowerCase('en-US') === normalizedKind
  ));
  if (duplicate) {
    throw new CampaignExpectedError('CAMPAIGN_VALIDATION_FAILED', 'This directed Relationship already exists.', {
      sourceActorId, targetActorId, relationshipKind, relationshipId: duplicate.id,
    });
  }
}

function cleanUses(
  usesRemaining: number | null | undefined,
  usesMaximum: number | null | undefined,
): Pick<CampaignLearnedAbility, 'usesRemaining' | 'usesMaximum'> {
  const remaining = usesRemaining === null ? undefined : usesRemaining;
  const maximum = usesMaximum === null ? undefined : usesMaximum;
  if (remaining !== undefined && (!Number.isInteger(remaining) || remaining < 0 || remaining > 1_000_000)) {
    throw new CampaignExpectedError('CAMPAIGN_VALIDATION_FAILED', 'Uses remaining must be a whole number from 0 to 1,000,000.');
  }
  if (maximum !== undefined && (!Number.isInteger(maximum) || maximum < 0 || maximum > 1_000_000)) {
    throw new CampaignExpectedError('CAMPAIGN_VALIDATION_FAILED', 'Maximum uses must be a whole number from 0 to 1,000,000.');
  }
  if (remaining !== undefined && maximum !== undefined && remaining > maximum) {
    throw new CampaignExpectedError('CAMPAIGN_VALIDATION_FAILED', 'Uses remaining cannot exceed maximum uses.');
  }
  return {
    ...(remaining === undefined ? {} : { usesRemaining: remaining }),
    ...(maximum === undefined ? {} : { usesMaximum: maximum }),
  };
}

function requireUniqueLearning(
  state: CampaignState,
  actorId: string,
  abilityId: string,
  exceptId?: string,
): void {
  const duplicate = Object.values(state.learnedAbilities ?? {}).find(candidate => (
    candidate.id !== exceptId && !candidate.archived && candidate.actorId === actorId && candidate.abilityId === abilityId
  ));
  if (duplicate) {
    throw new CampaignExpectedError(
      'CAMPAIGN_VALIDATION_FAILED',
      'This Actor already has an active Learned Ability entry.',
      { actorId, abilityId, learnedAbilityId: duplicate.id },
    );
  }
}

function requireActiveSceneRecord<T extends { id: string; archived: boolean }>(record: T, label: string): T {
  if (record.archived) {
    throw new CampaignExpectedError('CAMPAIGN_VALIDATION_FAILED', `${label} ${record.id} is archived and cannot enter the current Scene.`, { recordId: record.id });
  }
  return record;
}

function cleanAliases(value: readonly string[] | undefined): string[] {
  const aliases = (value ?? []).map((alias, index) => cleanText(alias, `Alias ${index + 1}`, 160));
  const normalized = new Set<string>();
  for (const alias of aliases) {
    const key = alias.normalize('NFKC').toLocaleLowerCase('en-US');
    if (normalized.has(key)) {
      throw new CampaignExpectedError('CAMPAIGN_VALIDATION_FAILED', `Alias ${alias} is duplicated.`, { alias });
    }
    normalized.add(key);
  }
  if (aliases.length > 32) {
    throw new CampaignExpectedError('CAMPAIGN_VALIDATION_FAILED', 'A Record may have at most 32 aliases.', { maximum: 32 });
  }
  return aliases;
}

function cleanVisibility(value: NarratorVisibility | undefined): NarratorVisibility {
  return value ?? 'known';
}

function narratorFields(
  current: { aliases?: string[]; visibility?: NarratorVisibility },
  aliases: readonly string[] | undefined,
  visibility: NarratorVisibility | undefined,
) {
  return {
    aliases: aliases === undefined ? [...(current.aliases ?? [])] : cleanAliases(aliases),
    visibility: visibility ?? current.visibility ?? 'known',
  };
}

export function subjectImageHash(image: CampaignSubjectImage): string | null {
  return image === null ? null : sha256(image);
}

export function subjectEventHash(input: {
  campaignId: string;
  revision: number;
  eventId: string;
  requestId: string;
  operationKind: string;
  operation: unknown;
  acceptedAt: string;
  previousEventHash: string | null;
  baseStateHash: string | null;
  changes: readonly CampaignSubjectChange[];
}): string {
  return sha256({
    campaignId: input.campaignId,
    revision: input.revision,
    eventId: input.eventId,
    requestId: input.requestId,
    eventSchemaVersion: 2,
    operationKind: input.operationKind,
    operation: input.operation,
    acceptedAt: input.acceptedAt,
    previousEventHash: input.previousEventHash,
    baseStateHash: input.baseStateHash,
    changes: input.changes.map(change => ({
      subjectKind: change.subjectKind,
      subjectId: change.subjectId,
      beforeHash: subjectImageHash(change.beforeImage),
      afterHash: subjectImageHash(change.afterImage),
    })),
  });
}

export function subjectImageAt(
  state: CampaignState,
  subjectKind: CampaignSubjectKind,
  subjectId: string,
): CampaignSubjectImage {
  if (subjectKind === 'actor') return structuredClone(state.actors[subjectId] ?? null);
  if (subjectKind === 'item') return structuredClone(state.items[subjectId] ?? null);
  if (subjectKind === 'quest') return structuredClone(state.quests?.[subjectId] ?? null);
  if (subjectKind === 'place') return structuredClone(state.places?.[subjectId] ?? null);
  if (subjectKind === 'ability') return structuredClone(state.abilities?.[subjectId] ?? null);
  if (subjectKind === 'learned_ability') return structuredClone(state.learnedAbilities?.[subjectId] ?? null);
  if (subjectKind === 'relationship') return structuredClone(state.relationships?.[subjectId] ?? null);
  return structuredClone(state.currentScene);
}

export function subjectChangesForOperation(
  beforeState: CampaignState,
  afterState: CampaignState,
  operation: CampaignOperation,
  affectedIds: readonly string[],
): CampaignSubjectChange[] {
  let subjects: Array<readonly [CampaignSubjectKind, string]>;
  if (operation.kind === 'create_actor_with_item') {
    const [actorId, itemId] = affectedIds;
    if (!actorId || !itemId) throw new Error('Campaign Operation create_actor_with_item produced incomplete subjects.');
    subjects = [['actor', actorId], ['item', itemId]];
  } else if (operation.kind === 'create_ability_with_learning') {
    const [abilityId, learnedAbilityId] = affectedIds;
    if (!abilityId || !learnedAbilityId) throw new Error('Campaign Operation create_ability_with_learning produced incomplete subjects.');
    subjects = [['ability', abilityId], ['learned_ability', learnedAbilityId]];
  } else {
    const affectedId = affectedIds[0];
    if (!affectedId) throw new Error(`Campaign Operation ${operation.kind} produced no affected subject.`);
    const subjectKind: CampaignSubjectKind = operation.kind === 'set_current_scene'
      ? 'current_scene'
      : operation.kind.includes('item')
        ? 'item'
        : operation.kind.includes('quest')
          ? 'quest'
          : operation.kind.includes('place')
            ? 'place'
            : operation.kind.includes('learned_ability')
              ? 'learned_ability'
              : operation.kind.includes('relationship')
                ? 'relationship'
              : operation.kind.includes('ability')
                ? 'ability'
            : 'actor';
    subjects = [[subjectKind, subjectKind === 'current_scene' ? 'current' : affectedId]];
  }
  return subjects.map(([subjectKind, subjectId]) => ({
    subjectKind,
    subjectId,
    beforeImage: subjectImageAt(beforeState, subjectKind, subjectId),
    afterImage: subjectImageAt(afterState, subjectKind, subjectId),
  }));
}

export function applySubjectChanges(
  state: CampaignState,
  changes: readonly CampaignSubjectChange[],
  revision: number,
  acceptedAt: string,
): void {
  for (const change of changes) {
    if (change.subjectKind === 'actor') {
      if (change.afterImage === null) delete state.actors[change.subjectId];
      else state.actors[change.subjectId] = structuredClone(change.afterImage as CampaignActor);
      continue;
    }
    if (change.subjectKind === 'item') {
      if (change.afterImage === null) delete state.items[change.subjectId];
      else state.items[change.subjectId] = structuredClone(change.afterImage as CampaignItem);
      continue;
    }
    if (change.subjectKind === 'quest') {
      state.quests ??= {};
      if (change.afterImage === null) delete state.quests[change.subjectId];
      else state.quests[change.subjectId] = structuredClone(change.afterImage as CampaignQuest);
      continue;
    }
    if (change.subjectKind === 'place') {
      state.places ??= {};
      if (change.afterImage === null) delete state.places[change.subjectId];
      else state.places[change.subjectId] = structuredClone(change.afterImage as CampaignPlace);
      continue;
    }
    if (change.subjectKind === 'ability') {
      state.abilities ??= {};
      if (change.afterImage === null) delete state.abilities[change.subjectId];
      else state.abilities[change.subjectId] = structuredClone(change.afterImage as CampaignAbility);
      continue;
    }
    if (change.subjectKind === 'learned_ability') {
      state.learnedAbilities ??= {};
      if (change.afterImage === null) delete state.learnedAbilities[change.subjectId];
      else state.learnedAbilities[change.subjectId] = structuredClone(change.afterImage as CampaignLearnedAbility);
      continue;
    }
    if (change.subjectKind === 'relationship') {
      state.relationships ??= {};
      if (change.afterImage === null) delete state.relationships[change.subjectId];
      else state.relationships[change.subjectId] = structuredClone(change.afterImage as CampaignRelationship);
      continue;
    }
    state.currentScene = change.afterImage === null
      ? null
      : structuredClone(change.afterImage as CampaignScene);
  }
  state.campaign = { ...state.campaign, revision, updatedAt: acceptedAt };
}

export function applyOperation(state: CampaignState, operation: CampaignOperation): string[] {
  if (operation.kind === 'create_actor') {
    const id = requireUnusedId(state, operation.actor.id, 'Actor ID');
    state.actors[id] = {
      id,
      name: cleanText(operation.actor.name, 'Actor name', 160),
      aliases: cleanAliases(operation.actor.aliases),
      summary: cleanOptionalText(operation.actor.summary, 'Actor summary', 4000),
      visibility: cleanVisibility(operation.actor.visibility),
      archived: false,
    };
    return [id];
  }
  if (operation.kind === 'create_actor_with_item') {
    const actorId = requireUnusedId(state, operation.actor.id, 'Actor ID');
    const itemId = requireUnusedId(state, operation.item.id, 'Item ID');
    if (actorId === itemId) {
      throw new CampaignExpectedError(
        'CAMPAIGN_VALIDATION_FAILED',
        'Actor and Item IDs must be different.',
        { actorId, itemId },
      );
    }
    state.actors[actorId] = {
      id: actorId,
      name: cleanText(operation.actor.name, 'Actor name', 160),
      aliases: cleanAliases(operation.actor.aliases),
      summary: cleanOptionalText(operation.actor.summary, 'Actor summary', 4000),
      visibility: cleanVisibility(operation.actor.visibility),
      archived: false,
    };
    state.items[itemId] = {
      id: itemId,
      name: cleanText(operation.item.name, 'Item name', 160),
      aliases: cleanAliases(operation.item.aliases),
      summary: cleanOptionalText(operation.item.summary, 'Item summary', 4000),
      visibility: cleanVisibility(operation.item.visibility),
      archived: false,
      ownerActorId: actorId,
    };
    return [actorId, itemId];
  }
  if (operation.kind === 'rename_actor') {
    const actor = requireActor(state, operation.actorId);
    state.actors[actor.id] = { ...actor, name: cleanText(operation.name, 'Actor name', 160) };
    return [actor.id];
  }
  if (operation.kind === 'update_actor') {
    const actor = requireActor(state, operation.actorId);
    state.actors[actor.id] = {
      ...actor,
      name: cleanText(operation.name, 'Actor name', 160),
      summary: cleanOptionalText(operation.summary, 'Actor summary', 4000),
      ...narratorFields(actor, operation.aliases, operation.visibility),
    };
    return [actor.id];
  }
  if (operation.kind === 'set_actor_archived') {
    const actor = requireActor(state, operation.actorId);
    state.actors[actor.id] = { ...actor, archived: operation.archived };
    return [actor.id];
  }
  if (operation.kind === 'create_item') {
    const id = requireUnusedId(state, operation.item.id, 'Item ID');
    const owner = operation.item.ownerActorId === undefined
      ? undefined
      : requireAttachableActor(state, operation.item.ownerActorId).id;
    state.items[id] = {
      id,
      name: cleanText(operation.item.name, 'Item name', 160),
      aliases: cleanAliases(operation.item.aliases),
      summary: cleanOptionalText(operation.item.summary, 'Item summary', 4000),
      visibility: cleanVisibility(operation.item.visibility),
      archived: false,
      ...(owner === undefined ? {} : { ownerActorId: owner }),
    };
    return [id];
  }
  if (operation.kind === 'update_item') {
    const item = requireItem(state, operation.itemId);
    let updated: CampaignItem = {
      ...item,
      name: cleanText(operation.name, 'Item name', 160),
      summary: cleanOptionalText(operation.summary, 'Item summary', 4000),
      ...narratorFields(item, operation.aliases, operation.visibility),
    };
    if ('ownerActorId' in operation) {
      if (operation.ownerActorId === null || operation.ownerActorId === undefined) {
        updated = {
          id: updated.id,
          name: updated.name,
          summary: updated.summary,
          archived: updated.archived,
        };
      } else if (operation.ownerActorId !== item.ownerActorId) {
        updated = { ...updated, ownerActorId: requireAttachableActor(state, operation.ownerActorId).id };
      }
    }
    state.items[item.id] = updated;
    return [item.id];
  }
  if (operation.kind === 'set_item_archived') {
    const item = requireItem(state, operation.itemId);
    state.items[item.id] = { ...item, archived: operation.archived };
    return [item.id];
  }
  if (operation.kind === 'create_quest') {
    const id = requireUnusedId(state, operation.quest.id, 'Quest ID');
    state.quests ??= {};
    state.quests[id] = {
      id,
      name: cleanText(operation.quest.name, 'Quest name', 160),
      aliases: cleanAliases(operation.quest.aliases),
      summary: cleanOptionalText(operation.quest.summary, 'Quest summary', 4000),
      visibility: cleanVisibility(operation.quest.visibility),
      status: operation.quest.status ?? 'active',
      archived: false,
    };
    return [id];
  }
  if (operation.kind === 'update_quest') {
    const quest = requireQuest(state, operation.questId);
    state.quests ??= {};
    state.quests[quest.id] = {
      ...quest,
      name: cleanText(operation.name, 'Quest name', 160),
      summary: cleanOptionalText(operation.summary, 'Quest summary', 4000),
      status: operation.status,
      ...narratorFields(quest, operation.aliases, operation.visibility),
    };
    return [quest.id];
  }
  if (operation.kind === 'set_quest_archived') {
    const quest = requireQuest(state, operation.questId);
    state.quests ??= {};
    state.quests[quest.id] = { ...quest, archived: operation.archived };
    return [quest.id];
  }
  if (operation.kind === 'create_place') {
    const id = requireUnusedId(state, operation.place.id, 'Place ID');
    state.places ??= {};
    state.places[id] = {
      id,
      name: cleanText(operation.place.name, 'Place name', 160),
      aliases: cleanAliases(operation.place.aliases),
      summary: cleanOptionalText(operation.place.summary, 'Place summary', 4000),
      visibility: cleanVisibility(operation.place.visibility),
      archived: false,
    };
    return [id];
  }
  if (operation.kind === 'update_place') {
    const place = requirePlace(state, operation.placeId);
    state.places ??= {};
    state.places[place.id] = {
      ...place,
      name: cleanText(operation.name, 'Place name', 160),
      summary: cleanOptionalText(operation.summary, 'Place summary', 4000),
      ...narratorFields(place, operation.aliases, operation.visibility),
    };
    return [place.id];
  }
  if (operation.kind === 'set_place_archived') {
    const place = requirePlace(state, operation.placeId);
    state.places ??= {};
    state.places[place.id] = { ...place, archived: operation.archived };
    return [place.id];
  }
  if (operation.kind === 'create_ability' || operation.kind === 'create_ability_with_learning') {
    const id = requireUnusedId(state, operation.ability.id, 'Ability ID');
    state.abilities ??= {};
    state.abilities[id] = {
      id,
      name: cleanText(operation.ability.name, 'Ability name', 160),
      aliases: cleanAliases(operation.ability.aliases),
      summary: cleanOptionalText(operation.ability.summary, 'Ability summary', 4000),
      visibility: cleanVisibility(operation.ability.visibility),
      category: operation.ability.category ?? 'other',
      archived: false,
    };
    if (operation.kind === 'create_ability') return [id];
    const learnedId = requireUnusedId(state, operation.learnedAbility.id, 'Learned Ability ID');
    const actorId = requireActiveSceneRecord(requireActor(state, operation.learnedAbility.actorId), 'Actor').id;
    state.learnedAbilities ??= {};
    state.learnedAbilities[learnedId] = {
      id: learnedId,
      abilityId: id,
      actorId,
      prepared: operation.learnedAbility.prepared ?? false,
      enabled: operation.learnedAbility.enabled ?? true,
      ...cleanUses(operation.learnedAbility.usesRemaining, operation.learnedAbility.usesMaximum),
      archived: false,
    };
    return [id, learnedId];
  }
  if (operation.kind === 'update_ability') {
    const ability = requireAbility(state, operation.abilityId);
    state.abilities ??= {};
    state.abilities[ability.id] = {
      ...ability,
      name: cleanText(operation.name, 'Ability name', 160),
      summary: cleanOptionalText(operation.summary, 'Ability summary', 4000),
      category: operation.category,
      ...narratorFields(ability, operation.aliases, operation.visibility),
    };
    return [ability.id];
  }
  if (operation.kind === 'set_ability_archived') {
    const ability = requireAbility(state, operation.abilityId);
    state.abilities ??= {};
    state.abilities[ability.id] = { ...ability, archived: operation.archived };
    return [ability.id];
  }
  if (operation.kind === 'create_learned_ability') {
    const id = requireUnusedId(state, operation.learnedAbility.id, 'Learned Ability ID');
    const ability = requireAbility(state, operation.learnedAbility.abilityId);
    if (ability.archived) throw new CampaignExpectedError('CAMPAIGN_VALIDATION_FAILED', 'An archived Ability cannot be learned.', { abilityId: ability.id });
    const actor = requireActiveSceneRecord(requireActor(state, operation.learnedAbility.actorId), 'Actor');
    requireUniqueLearning(state, actor.id, ability.id);
    state.learnedAbilities ??= {};
    state.learnedAbilities[id] = {
      id,
      abilityId: ability.id,
      actorId: actor.id,
      prepared: operation.learnedAbility.prepared ?? false,
      enabled: operation.learnedAbility.enabled ?? true,
      ...cleanUses(operation.learnedAbility.usesRemaining, operation.learnedAbility.usesMaximum),
      archived: false,
    };
    return [id];
  }
  if (operation.kind === 'update_learned_ability') {
    const learned = requireLearnedAbility(state, operation.learnedAbilityId);
    state.learnedAbilities ??= {};
    state.learnedAbilities[learned.id] = {
      id: learned.id,
      abilityId: learned.abilityId,
      actorId: learned.actorId,
      prepared: operation.prepared,
      enabled: operation.enabled,
      ...cleanUses(operation.usesRemaining, operation.usesMaximum),
      archived: learned.archived,
    };
    return [learned.id];
  }
  if (operation.kind === 'set_learned_ability_archived') {
    const learned = requireLearnedAbility(state, operation.learnedAbilityId);
    if (!operation.archived) {
      const ability = requireAbility(state, learned.abilityId);
      const actor = requireActor(state, learned.actorId);
      if (ability.archived || actor.archived) {
        throw new CampaignExpectedError('CAMPAIGN_VALIDATION_FAILED', 'Restore the linked Actor and Ability before restoring this Learned Ability.');
      }
      requireUniqueLearning(state, actor.id, ability.id, learned.id);
    }
    state.learnedAbilities ??= {};
    state.learnedAbilities[learned.id] = { ...learned, archived: operation.archived };
    return [learned.id];
  }
  if (operation.kind === 'create_relationship') {
    const id = requireUnusedId(state, operation.relationship.id, 'Relationship ID');
    const [sourceActorId, targetActorId] = requireRelationshipEndpoints(
      state,
      operation.relationship.sourceActorId,
      operation.relationship.targetActorId,
    );
    const relationshipKind = cleanText(operation.relationship.kind, 'Relationship kind', 160);
    requireUniqueRelationship(state, sourceActorId, targetActorId, relationshipKind);
    state.relationships ??= {};
    state.relationships[id] = {
      id,
      sourceActorId,
      targetActorId,
      kind: relationshipKind,
      status: operation.relationship.status ?? 'active',
      notes: cleanOptionalText(operation.relationship.notes, 'Relationship notes', 4000),
      visibility: cleanVisibility(operation.relationship.visibility),
      archived: false,
    };
    return [id];
  }
  if (operation.kind === 'update_relationship') {
    const relationship = requireRelationship(state, operation.relationshipId);
    const [sourceActorId, targetActorId] = requireRelationshipEndpoints(
      state,
      operation.sourceActorId,
      operation.targetActorId,
    );
    const relationshipKind = cleanText(operation.relationshipKind, 'Relationship kind', 160);
    requireUniqueRelationship(state, sourceActorId, targetActorId, relationshipKind, relationship.id);
    state.relationships ??= {};
    state.relationships[relationship.id] = {
      ...relationship,
      sourceActorId,
      targetActorId,
      kind: relationshipKind,
      status: operation.status,
      notes: cleanOptionalText(operation.notes, 'Relationship notes', 4000),
      visibility: operation.visibility ?? relationship.visibility ?? 'known',
    };
    return [relationship.id];
  }
  if (operation.kind === 'set_relationship_archived') {
    const relationship = requireRelationship(state, operation.relationshipId);
    if (!operation.archived) {
      requireRelationshipEndpoints(state, relationship.sourceActorId, relationship.targetActorId);
      requireUniqueRelationship(state, relationship.sourceActorId, relationship.targetActorId, relationship.kind, relationship.id);
    }
    state.relationships ??= {};
    state.relationships[relationship.id] = { ...relationship, archived: operation.archived };
    return [relationship.id];
  }
  if (operation.kind === 'set_current_scene') {
    const id = operation.scene.id ? cleanIdentifier(operation.scene.id, 'Scene ID') : state.currentScene?.id ?? randomUUID();
    const placeId = operation.scene.placeId === undefined
      ? undefined
      : requireActiveSceneRecord(requirePlace(state, operation.scene.placeId), 'Place').id;
    const actorIds = operation.scene.actorIds?.map(actorId => requireActiveSceneRecord(requireActor(state, actorId), 'Actor').id) ?? [];
    const itemIds = operation.scene.itemIds?.map(itemId => requireActiveSceneRecord(requireItem(state, itemId), 'Item').id) ?? [];
    state.currentScene = {
      id,
      name: cleanText(operation.scene.name, 'Scene name', 160),
      summary: cleanOptionalText(operation.scene.summary, 'Scene summary', 4000),
      ...(placeId ? { placeId } : {}),
      ...(actorIds.length ? { actorIds } : {}),
      ...(itemIds.length ? { itemIds } : {}),
    };
    return [id];
  }
  const unsupported: never = operation;
  throw new Error(`Unsupported Campaign operation: ${JSON.stringify(unsupported)}`);
}
