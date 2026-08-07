import { createHash, randomUUID } from 'node:crypto';
import type {
  CampaignActor,
  CampaignDocument,
  CampaignItem,
  CampaignOperation,
  CampaignScene,
  CampaignSummary,
} from '@st-llm-rpg/wire';
import { CampaignExpectedError } from './campaign-error.js';

export type CampaignState = {
  campaign: CampaignSummary;
  actors: Record<string, CampaignActor>;
  items: Record<string, CampaignItem>;
  currentScene: CampaignScene | null;
};

export type CampaignRow = {
  campaign_id: string;
  title: string;
  status: 'active' | 'archived';
  current_revision: number;
  current_state_json: string;
  head_event_hash: string;
  created_at: string;
  updated_at: string;
};

export type EventRow = {
  revision: number;
  event_id: string;
  request_id: string;
  operation_kind: string;
  operation_json: string;
  before_state_json: string | null;
  after_state_json: string;
  accepted_at: string;
  previous_event_hash: string | null;
  event_hash: string;
};

export type ReceiptRow = { request_hash: string; outcome_json: string };

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

export function cleanText(value: string, field: string, maximum: number): string {
  const cleaned = String(value ?? '').trim();
  if (!cleaned) throw new CampaignExpectedError('CAMPAIGN_VALIDATION_FAILED', `${field} is required.`, 400, { field });
  if (cleaned.length > maximum) {
    throw new CampaignExpectedError('CAMPAIGN_VALIDATION_FAILED', `${field} must be ${maximum} characters or fewer.`, 400, { field, maximum });
  }
  return cleaned;
}

function cleanOptionalText(value: string | undefined, field: string, maximum: number): string {
  const cleaned = String(value ?? '').trim();
  if (cleaned.length > maximum) {
    throw new CampaignExpectedError('CAMPAIGN_VALIDATION_FAILED', `${field} must be ${maximum} characters or fewer.`, 400, { field, maximum });
  }
  return cleaned;
}

export function cleanIdentifier(value: string, field: string): string {
  const cleaned = cleanText(value, field, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(cleaned)) {
    throw new CampaignExpectedError('CAMPAIGN_VALIDATION_FAILED', `${field} contains unsupported characters.`, 400, { field });
  }
  return cleaned;
}

export function asDocument(state: CampaignState): CampaignDocument {
  const byName = <T extends { id: string; name: string }>(left: T, right: T) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
  return {
    campaign: structuredClone(state.campaign),
    actors: Object.values(state.actors).sort(byName),
    items: Object.values(state.items).sort(byName),
    currentScene: state.currentScene ? structuredClone(state.currentScene) : null,
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

function requireActor(state: CampaignState, actorId: string): CampaignActor {
  const id = cleanIdentifier(actorId, 'Actor ID');
  const actor = state.actors[id];
  if (!actor) throw new CampaignExpectedError('CAMPAIGN_RECORD_NOT_FOUND', `Actor ${id} was not found.`, 404, { actorId: id });
  return actor;
}

function requireItem(state: CampaignState, itemId: string): CampaignItem {
  const id = cleanIdentifier(itemId, 'Item ID');
  const item = state.items[id];
  if (!item) throw new CampaignExpectedError('CAMPAIGN_RECORD_NOT_FOUND', `Item ${id} was not found.`, 404, { itemId: id });
  return item;
}

export function applyOperation(state: CampaignState, operation: CampaignOperation): string[] {
  if (operation.kind === 'create_actor') {
    const id = operation.actor.id ? cleanIdentifier(operation.actor.id, 'Actor ID') : randomUUID();
    if (state.actors[id] || state.items[id] || state.currentScene?.id === id) {
      throw new CampaignExpectedError('CAMPAIGN_VALIDATION_FAILED', `Record ID ${id} already exists.`, 400, { id });
    }
    state.actors[id] = {
      id,
      name: cleanText(operation.actor.name, 'Actor name', 160),
      summary: cleanOptionalText(operation.actor.summary, 'Actor summary', 4000),
      archived: false,
    };
    return [id];
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
    const id = operation.item.id ? cleanIdentifier(operation.item.id, 'Item ID') : randomUUID();
    if (state.actors[id] || state.items[id] || state.currentScene?.id === id) {
      throw new CampaignExpectedError('CAMPAIGN_VALIDATION_FAILED', `Record ID ${id} already exists.`, 400, { id });
    }
    state.items[id] = {
      id,
      name: cleanText(operation.item.name, 'Item name', 160),
      summary: cleanOptionalText(operation.item.summary, 'Item summary', 4000),
      archived: false,
    };
    return [id];
  }
  if (operation.kind === 'update_item') {
    const item = requireItem(state, operation.itemId);
    state.items[item.id] = {
      ...item,
      name: cleanText(operation.name, 'Item name', 160),
      summary: cleanOptionalText(operation.summary, 'Item summary', 4000),
    };
    return [item.id];
  }
  if (operation.kind === 'set_item_archived') {
    const item = requireItem(state, operation.itemId);
    state.items[item.id] = { ...item, archived: operation.archived };
    return [item.id];
  }
  const id = operation.scene.id ? cleanIdentifier(operation.scene.id, 'Scene ID') : state.currentScene?.id ?? randomUUID();
  state.currentScene = {
    id,
    name: cleanText(operation.scene.name, 'Scene name', 160),
    summary: cleanOptionalText(operation.scene.summary, 'Scene summary', 4000),
  };
  return [id];
}
