import { createHash, randomUUID } from 'node:crypto';
import type {
  CampaignActor,
  CampaignDocument,
  CampaignItem,
  CampaignOperation,
  CampaignPlace,
  CampaignQuest,
  CampaignScene,
  CampaignSummary,
} from '@st-llm-rpg/wire';
import { CampaignExpectedError } from './campaign-error.js';

export type CampaignState = {
  campaign: CampaignSummary;
  actors: Record<string, CampaignActor>;
  items: Record<string, CampaignItem>;
  quests?: Record<string, CampaignQuest>;
  places?: Record<string, CampaignPlace>;
  currentScene: CampaignScene | null;
};

export type CampaignSubjectKind = 'actor' | 'item' | 'quest' | 'place' | 'current_scene';
export type CampaignSubjectImage = CampaignActor | CampaignItem | CampaignQuest | CampaignPlace | CampaignScene | null;
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
    currentScene: state.currentScene ? structuredClone(state.currentScene) : null,
  };
}

export function normalizeCampaignDocument(document: CampaignDocument): CampaignDocument {
  const legacy = document as CampaignDocument & {
    quests?: CampaignQuest[];
    places?: CampaignPlace[];
  };
  return {
    ...document,
    quests: legacy.quests ?? [],
    places: legacy.places ?? [],
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
      summary: cleanOptionalText(operation.actor.summary, 'Actor summary', 4000),
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
      summary: cleanOptionalText(operation.actor.summary, 'Actor summary', 4000),
      archived: false,
    };
    state.items[itemId] = {
      id: itemId,
      name: cleanText(operation.item.name, 'Item name', 160),
      summary: cleanOptionalText(operation.item.summary, 'Item summary', 4000),
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
      summary: cleanOptionalText(operation.item.summary, 'Item summary', 4000),
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
      summary: cleanOptionalText(operation.quest.summary, 'Quest summary', 4000),
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
      summary: cleanOptionalText(operation.place.summary, 'Place summary', 4000),
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
    };
    return [place.id];
  }
  if (operation.kind === 'set_place_archived') {
    const place = requirePlace(state, operation.placeId);
    state.places ??= {};
    state.places[place.id] = { ...place, archived: operation.archived };
    return [place.id];
  }
  if (operation.kind === 'set_current_scene') {
    const id = operation.scene.id ? cleanIdentifier(operation.scene.id, 'Scene ID') : state.currentScene?.id ?? randomUUID();
    state.currentScene = {
      id,
      name: cleanText(operation.scene.name, 'Scene name', 160),
      summary: cleanOptionalText(operation.scene.summary, 'Scene summary', 4000),
    };
    return [id];
  }
  const unsupported: never = operation;
  throw new Error(`Unsupported Campaign operation: ${JSON.stringify(unsupported)}`);
}
