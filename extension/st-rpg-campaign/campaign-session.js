import { createCampaignReferenceGraph } from './campaign-reference-graph.js';
import { compileContextCapsuleDetailed } from './context-capsule.js';
export { compileContextCapsule } from './context-capsule.js';

const CARRIED_STATES = new Set(['carried', 'worn', 'stored', 'missing', 'consumed', 'other']);
const ABILITY_ACCESS_STATES = new Set(['learned', 'prepared', 'enabled', 'unavailable', 'forgotten']);
const RELATIONSHIP_STATUSES = new Set(['active', 'strained', 'dormant', 'ended', 'other']);
const RELATIONSHIP_DIMENSIONS = ['affinity', 'trust', 'respect', 'fear', 'tension', 'debt'];
const CONTEXT_POLICIES = new Set(['automatic', 'pinned', 'excluded']);
const QUEST_STATUSES = new Set(['planned', 'active', 'blocked', 'completed', 'failed']);
const QUEST_STEP_STATUSES = new Set(['pending', 'active', 'blocked', 'completed', 'skipped']);
const FACT_IMPORTANCE = new Set(['normal', 'important', 'critical']);
const PRESENCE_STATES = new Set(['present', 'hidden', 'departed', 'destroyed', 'other']);
const EXIT_STATUSES = new Set(['open', 'closed', 'blocked', 'unknown']);
const OBSTACLE_STATUSES = new Set(['active', 'resolved', 'bypassed']);
const THREAD_STATUSES = new Set(['open', 'resolved', 'carried']);
const STORY_SYNC_CONFIDENCE = new Set(['high', 'medium', 'low']);
const STORY_SYNC_TYPES = new Set(['character', 'item', 'ability', 'npc', 'quest', 'fact', 'scene']);
const STORY_SYNC_COLLECTION_TYPES = Object.freeze({
  character: 'character',
  inventory: 'item',
  abilities: 'ability',
  people: 'npc',
  objectives: 'quest',
  world: 'fact',
  scene: 'scene',
});
const STORY_SYNC_TYPE_COLLECTIONS = Object.freeze({
  character: 'character',
  item: 'inventory',
  ability: 'abilities',
  npc: 'people',
  quest: 'objectives',
  fact: 'world',
  scene: 'scene',
});
export const STORY_SYNC_FIELDS = Object.freeze({
  character: ['summary', 'details', 'appearance', 'personality', 'goals', 'voiceNotes'],
  item: ['summary', 'details', 'category', 'condition', 'quantity', 'carriedState'],
  ability: ['summary', 'details', 'category', 'usage', 'limits', 'accessState', 'currentUses', 'maxUses'],
  npc: ['summary', 'details', 'pronouns', 'appearance', 'personality', 'goals', 'voiceNotes'],
  quest: ['summary', 'details', 'status', 'stakes', 'outcome'],
  fact: ['proposition', 'summary', 'details', 'importance'],
  scene: ['summary', 'transitionNotes', 'thread'],
});
const STORY_SYNC_DEFAULT_FIELDS = Object.freeze({
  character: 'details',
  item: 'summary',
  ability: 'summary',
  npc: 'summary',
  quest: 'summary',
  fact: 'proposition',
  scene: 'thread',
});

export class CampaignConflictError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'CampaignConflictError';
    this.code = 'campaign_conflict';
    this.details = details;
  }
}

export class CampaignValidationError extends Error {
  constructor(message, fields = {}) {
    super(message);
    this.name = 'CampaignValidationError';
    this.code = 'campaign_validation';
    this.fields = fields;
  }
}

function clone(value) {
  if (value === undefined) return undefined;
  if (globalThis.structuredClone) return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function cleanText(value) {
  return String(value ?? '').trim();
}

function cleanStorySyncSource(value, field = 'source') {
  const identity = requiredText(value?.identity, `${field}.identity`, 'Story Sync source identity');
  const firstMessageIndex = positiveInteger(value?.firstMessageIndex, `${field}.firstMessageIndex`);
  const lastMessageIndex = positiveInteger(value?.lastMessageIndex, `${field}.lastMessageIndex`);
  if (lastMessageIndex < firstMessageIndex) {
    throw new CampaignValidationError('Story Sync source range is invalid.', {
      [`${field}.lastMessageIndex`]: 'Last message must not precede the first message.',
    });
  }
  return {
    identity,
    chatId: cleanText(value?.chatId),
    firstMessageIndex,
    lastMessageIndex,
    remainingMessages: positiveInteger(value?.remainingMessages ?? 0, `${field}.remainingMessages`),
  };
}

function cleanStorySyncProposal(value, field = 'proposal') {
  const collection = cleanText(value?.collection).toLowerCase();
  const recordType = cleanText(value?.recordType).toLowerCase() || STORY_SYNC_COLLECTION_TYPES[collection];
  if (!STORY_SYNC_TYPES.has(recordType)) {
    throw new CampaignValidationError('Story Sync record type is invalid.', {
      [`${field}.recordType`]: 'Choose Character, Item, Ability, NPC, Quest, Fact, or Scene.',
    });
  }
  const allowedFields = STORY_SYNC_FIELDS[recordType];
  const targetField = cleanText(value?.field) || STORY_SYNC_DEFAULT_FIELDS[recordType];
  if (!allowedFields.includes(targetField)) {
    throw new CampaignValidationError('Story Sync target field is invalid.', {
      [`${field}.field`]: `Choose ${allowedFields.join(', ')}.`,
    });
  }
  const confidence = STORY_SYNC_CONFIDENCE.has(cleanText(value?.confidence).toLowerCase())
    ? cleanText(value.confidence).toLowerCase()
    : 'low';
  return {
    recordType,
    collection: STORY_SYNC_TYPE_COLLECTIONS[recordType],
    subject: requiredText(value?.subject, `${field}.subject`, 'Proposal subject'),
    field: targetField,
    value: requiredText(value?.value ?? value?.change, `${field}.value`, 'Proposed value'),
    evidence: cleanText(value?.evidence),
    confidence,
  };
}

function findActiveRecordByName(campaign, kind, name) {
  const normalizedName = cleanText(name).toLocaleLowerCase();
  return campaign.records.find(record => record.kind === kind
    && !record.archivedAt
    && cleanText(record.name).toLocaleLowerCase() === normalizedName) ?? null;
}

function storySyncProposalOperation(campaign, proposal) {
  const value = proposal.value;
  if (proposal.recordType === 'character') {
    return { type: 'update_actor', actorId: campaign.playerCharacterId, changes: { [proposal.field]: value } };
  }
  if (proposal.recordType === 'item') {
    const item = findActiveRecordByName(campaign, 'item', proposal.subject);
    const possession = item
      ? campaign.possessions.find(entry => !entry.archivedAt
        && entry.itemId === item.id
        && entry.ownerActorId === campaign.playerCharacterId)
      : null;
    const possessionFields = new Set(['condition', 'quantity', 'carriedState']);
    const normalizedValue = proposal.field === 'quantity' ? Number(value) : value;
    if (item && possession) {
      return {
        type: 'update_inventory_entry',
        itemId: item.id,
        possessionId: possession.id,
        itemChanges: possessionFields.has(proposal.field) ? {} : { [proposal.field]: normalizedValue },
        possessionChanges: possessionFields.has(proposal.field) ? { [proposal.field]: normalizedValue } : {},
      };
    }
    if (item) {
      return {
        type: 'add_existing_item_to_inventory',
        itemId: item.id,
        possession: {
          ownerActorId: campaign.playerCharacterId,
          quantity: proposal.field === 'quantity' ? normalizedValue : 1,
          carriedState: proposal.field === 'carriedState' ? normalizedValue : 'carried',
          condition: proposal.field === 'condition' ? normalizedValue : '',
          notes: '',
        },
      };
    }
    return {
      type: 'create_item_and_possession',
      item: {
        name: proposal.subject,
        summary: proposal.field === 'summary' ? value : '',
        details: proposal.field === 'details' ? value : '',
        category: proposal.field === 'category' ? value : 'other',
        tags: [],
      },
      possession: {
        ownerActorId: campaign.playerCharacterId,
        quantity: proposal.field === 'quantity' ? normalizedValue : 1,
        carriedState: proposal.field === 'carriedState' ? value : 'carried',
        condition: proposal.field === 'condition' ? value : '',
        notes: '',
      },
    };
  }
  if (proposal.recordType === 'ability') {
    const ability = findActiveRecordByName(campaign, 'ability', proposal.subject);
    const learnedAbility = ability
      ? campaign.learnedAbilities.find(entry => !entry.archivedAt
        && entry.abilityId === ability.id
        && entry.actorId === campaign.playerCharacterId)
      : null;
    const learnedFields = new Set(['accessState', 'currentUses', 'maxUses']);
    const normalizedValue = ['currentUses', 'maxUses'].includes(proposal.field) ? Number(value) : value;
    if (ability && learnedAbility) {
      return {
        type: 'update_ability_entry',
        abilityId: ability.id,
        learnedAbilityId: learnedAbility.id,
        abilityChanges: learnedFields.has(proposal.field) ? {} : { [proposal.field]: normalizedValue },
        learnedAbilityChanges: learnedFields.has(proposal.field) ? { [proposal.field]: normalizedValue } : {},
      };
    }
    if (ability) {
      return {
        type: 'learn_existing_ability',
        abilityId: ability.id,
        learnedAbility: {
          actorId: campaign.playerCharacterId,
          accessState: proposal.field === 'accessState' ? value : 'learned',
          currentUses: proposal.field === 'currentUses' ? normalizedValue : null,
          maxUses: proposal.field === 'maxUses' ? normalizedValue : null,
          notes: '',
        },
      };
    }
    return {
      type: 'create_ability_and_learned_ability',
      ability: {
        name: proposal.subject,
        summary: proposal.field === 'summary' ? value : '',
        details: proposal.field === 'details' ? value : '',
        category: proposal.field === 'category' ? value : 'other',
        tags: [],
        usage: proposal.field === 'usage' ? value : '',
        limits: proposal.field === 'limits' ? value : '',
      },
      learnedAbility: {
        actorId: campaign.playerCharacterId,
        accessState: proposal.field === 'accessState' ? value : 'learned',
        currentUses: proposal.field === 'currentUses' ? normalizedValue : null,
        maxUses: proposal.field === 'maxUses' ? normalizedValue : null,
        notes: '',
      },
    };
  }
  if (proposal.recordType === 'npc') {
    const actor = findActiveRecordByName(campaign, 'actor', proposal.subject);
    const npc = actor?.role === 'npc' ? actor : null;
    return npc
      ? { type: 'update_actor', actorId: npc.id, changes: { [proposal.field]: value } }
      : { type: 'create_actor', actor: { name: proposal.subject, [proposal.field]: value } };
  }
  if (proposal.recordType === 'quest') {
    const quest = findActiveRecordByName(campaign, 'quest', proposal.subject);
    const payload = quest ? clone(quest) : {
      name: proposal.subject,
      summary: '', details: '', category: 'quest', tags: [], status: 'active', stakes: '', outcome: '', involvedRefs: [], steps: [],
    };
    payload[proposal.field] = value;
    return quest ? { type: 'update_quest', questId: quest.id, quest: payload } : { type: 'create_quest', quest: payload };
  }
  if (proposal.recordType === 'fact') {
    const fact = findActiveRecordByName(campaign, 'fact', proposal.subject);
    const payload = fact ? clone(fact) : {
      name: proposal.subject,
      proposition: proposal.subject,
      summary: '', details: '', category: 'fact', scope: 'campaign', tags: [], importance: 'normal', subjectRef: null,
    };
    payload[proposal.field] = value;
    return fact ? { type: 'update_fact', factId: fact.id, fact: payload } : { type: 'create_fact', fact: payload };
  }
  if (proposal.recordType === 'scene') {
    if (!campaign.currentScene) throw new CampaignValidationError('Open a Current Scene before accepting this Scene proposal.');
    const scene = clone(campaign.currentScene);
    if (proposal.field === 'thread') {
      scene.openThreads = [...(scene.openThreads ?? []), {
        id: null,
        label: proposal.subject,
        status: 'open',
        notes: value,
      }];
    } else {
      scene[proposal.field] = value;
    }
    return { type: 'update_current_scene', sceneId: scene.id, scene };
  }
  throw new CampaignValidationError('Story Sync proposal cannot be applied.');
}

function cleanTags(value) {
  const tags = Array.isArray(value) ? value : String(value ?? '').split(',');
  return [...new Set(tags.map(tag => cleanText(tag).toLowerCase()).filter(Boolean))];
}

function positiveInteger(value, field, { allowZero = true } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < (allowZero ? 0 : 1)) {
    throw new CampaignValidationError(`${field} must be ${allowZero ? 'a non-negative' : 'a positive'} whole number.`, {
      [field]: `${field} must be ${allowZero ? 'a non-negative' : 'a positive'} whole number.`,
    });
  }
  return number;
}

function optionalNonNegativeInteger(value, field) {
  if (value === null || value === undefined || value === '') return null;
  return positiveInteger(value, field);
}

function optionalBoundedInteger(value, field, minimum = -5, maximum = 5) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new CampaignValidationError(`${field} must be a whole number from ${minimum} to ${maximum}.`, {
      [field]: `Use a whole number from ${minimum} to ${maximum}.`,
    });
  }
  return number;
}

function cleanRelationshipDimensions(value = {}, prefix = 'relationship.dimensions') {
  const dimensions = {};
  for (const key of RELATIONSHIP_DIMENSIONS) {
    const number = optionalBoundedInteger(value?.[key], `${prefix}.${key}`);
    if (number !== null) dimensions[key] = number;
  }
  return dimensions;
}

function cleanContextPolicy(value, field = 'contextPolicy') {
  const policy = cleanText(value) || 'automatic';
  if (!CONTEXT_POLICIES.has(policy)) {
    throw new CampaignValidationError('Context policy is invalid.', {
      [field]: 'Choose automatic, pinned, or excluded.',
    });
  }
  return policy;
}

function cleanMeters(value, field) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new CampaignValidationError(`${field} must be an array.`);
  const seen = new Set();
  return value.map((entry, index) => {
    const externalId = addonId(entry?.id, `${field}.${index}.id`);
    if (seen.has(externalId)) throw new CampaignValidationError(`Duplicate meter ID '${externalId}'.`);
    seen.add(externalId);
    const current = positiveInteger(entry?.current ?? 0, `${field}.${index}.current`);
    const max = optionalNonNegativeInteger(entry?.max, `${field}.${index}.max`);
    if (max !== null && current > max) {
      throw new CampaignValidationError('Meter current value cannot exceed maximum.', {
        [`${field}.${index}.current`]: 'Current cannot exceed maximum.',
      });
    }
    return {
      externalId,
      label: requiredText(entry?.label, `${field}.${index}.label`, 'Meter label'),
      current,
      max,
      notes: cleanText(entry?.notes),
    };
  });
}

function cleanEditableMeters(value, field = 'character.meters') {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new CampaignValidationError(`${field} must be an array.`);
  const seen = new Set();
  return value.map((entry, index) => {
    const id = cleanText(entry?.id) || null;
    if (id && seen.has(id)) throw new CampaignValidationError(`Duplicate Meter ID '${id}'.`);
    if (id) seen.add(id);
    const current = positiveInteger(entry?.current ?? 0, `${field}.${index}.current`);
    const max = optionalNonNegativeInteger(entry?.max, `${field}.${index}.max`);
    if (max !== null && current > max) {
      throw new CampaignValidationError('Meter current value cannot exceed maximum.', {
        [`${field}.${index}.current`]: 'Current cannot exceed maximum.',
      });
    }
    return {
      id,
      label: requiredText(entry?.label, `${field}.${index}.label`, 'Meter label'),
      current,
      max,
      notes: cleanText(entry?.notes),
    };
  });
}

function cleanQuestPayload(value, campaign, field = 'quest') {
  const status = cleanText(value?.status) || 'planned';
  if (!QUEST_STATUSES.has(status)) {
    throw new CampaignValidationError('Quest status is invalid.', {
      [`${field}.status`]: 'Choose planned, active, blocked, completed, or failed.',
    });
  }
  if (!Array.isArray(value?.steps ?? [])) throw new CampaignValidationError(`${field}.steps must be an array.`);
  const stepIds = new Set();
  const steps = (value?.steps ?? []).map((step, index) => {
    const id = cleanText(step?.id) || null;
    if (id && stepIds.has(id)) throw new CampaignValidationError(`Duplicate Quest Step ID '${id}'.`);
    if (id) stepIds.add(id);
    const stepStatus = cleanText(step?.status) || 'pending';
    if (!QUEST_STEP_STATUSES.has(stepStatus)) {
      throw new CampaignValidationError('Quest Step status is invalid.', {
        [`${field}.steps.${index}.status`]: 'Choose pending, active, blocked, completed, or skipped.',
      });
    }
    return {
      id,
      label: requiredText(step?.label, `${field}.steps.${index}.label`, 'Quest Step label'),
      status: stepStatus,
      notes: cleanText(step?.notes),
    };
  });
  if (!Array.isArray(value?.involvedRefs ?? [])) {
    throw new CampaignValidationError(`${field}.involvedRefs must be an array.`);
  }
  const allowedKinds = new Set(['actor', 'item', 'ability', 'fact', 'place', 'world_object']);
  const involvedRefs = [];
  const referenceKeys = new Set();
  for (const [index, reference] of (value?.involvedRefs ?? []).entries()) {
    const kind = cleanText(reference?.kind) === 'worldObject' ? 'world_object' : cleanText(reference?.kind);
    const id = cleanText(reference?.id);
    if (!allowedKinds.has(kind)) {
      throw new CampaignValidationError('Quest reference kind is invalid.', {
        [`${field}.involvedRefs.${index}.kind`]: 'Choose an Actor, Item, Ability, Fact, Place, or World Object.',
      });
    }
    const target = campaign.records.find(record => record.id === id && record.kind === kind);
    if (!target) {
      throw new CampaignValidationError('Quest reference does not exist.', {
        [`${field}.involvedRefs.${index}.id`]: 'Choose an existing Campaign record.',
      });
    }
    const key = `${kind}:${id}`;
    if (referenceKeys.has(key)) continue;
    referenceKeys.add(key);
    involvedRefs.push({ kind, id });
  }
  return {
    name: requiredText(value?.name, `${field}.name`, 'Quest name'),
    summary: cleanText(value?.summary),
    details: cleanText(value?.details),
    category: cleanText(value?.category) || 'quest',
    tags: cleanTags(value?.tags),
    status,
    stakes: cleanText(value?.stakes),
    outcome: cleanText(value?.outcome),
    steps,
    involvedRefs,
    contextPolicy: cleanContextPolicy(value?.contextPolicy, `${field}.contextPolicy`),
  };
}

function cleanRecordFields(value, field, defaultCategory) {
  return {
    name: requiredText(value?.name, `${field}.name`, 'Name'),
    summary: cleanText(value?.summary),
    details: cleanText(value?.details),
    category: cleanText(value?.category) || defaultCategory,
    tags: cleanTags(value?.tags),
    contextPolicy: cleanContextPolicy(value?.contextPolicy, `${field}.contextPolicy`),
  };
}

function cleanFactPayload(value, campaign, field = 'fact') {
  const importance = cleanText(value?.importance) || 'normal';
  if (!FACT_IMPORTANCE.has(importance)) {
    throw new CampaignValidationError('Fact importance is invalid.', {
      [`${field}.importance`]: 'Choose normal, important, or critical.',
    });
  }
  let subjectRef = null;
  if (value?.subjectRef?.id) {
    const kind = cleanText(value.subjectRef.kind) === 'worldObject' ? 'world_object' : cleanText(value.subjectRef.kind);
    const allowedKinds = new Set(['actor', 'item', 'ability', 'quest', 'place', 'world_object']);
    const target = campaign.records.find(record => record.id === value.subjectRef.id && record.kind === kind);
    if (!allowedKinds.has(kind) || !target) {
      throw new CampaignValidationError('Fact subject does not exist.', {
        [`${field}.subjectRef`]: 'Choose an existing Actor, Item, Ability, Quest, Place, or World Object.',
      });
    }
    subjectRef = { kind, id: target.id };
  }
  return {
    ...cleanRecordFields(value, field, 'fact'),
    proposition: requiredText(value?.proposition, `${field}.proposition`, 'Fact proposition'),
    scope: cleanText(value?.scope) || 'campaign',
    importance,
    subjectRef,
  };
}

function cleanPlacePayload(value, campaign, field = 'place') {
  const parentPlaceId = cleanText(value?.parentPlaceId) || null;
  if (parentPlaceId && !campaign.records.some(record => record.id === parentPlaceId && record.kind === 'place')) {
    throw new CampaignValidationError('Parent Place does not exist.', {
      [`${field}.parentPlaceId`]: 'Choose an existing Place.',
    });
  }
  if (!Array.isArray(value?.connections ?? [])) {
    throw new CampaignValidationError(`${field}.connections must be an array.`);
  }
  const connectionIds = new Set();
  const connections = (value?.connections ?? []).map((connection, index) => {
    const id = cleanText(connection?.id) || null;
    if (id && connectionIds.has(id)) throw new CampaignValidationError(`Duplicate Place Connection ID '${id}'.`);
    if (id) connectionIds.add(id);
    const targetPlaceId = cleanText(connection?.targetPlaceId);
    if (!campaign.records.some(record => record.id === targetPlaceId && record.kind === 'place')) {
      throw new CampaignValidationError('Connection destination does not exist.', {
        [`${field}.connections.${index}.targetPlaceId`]: 'Choose an existing Place.',
      });
    }
    return {
      id,
      targetPlaceId,
      connectionKind: cleanText(connection?.connectionKind) || 'connection',
      notes: cleanText(connection?.notes),
    };
  });
  return {
    ...cleanRecordFields(value, field, 'place'),
    atmosphere: cleanText(value?.atmosphere),
    parentPlaceId,
    connections,
  };
}

function cleanWorldObjectPayload(value, campaign, field = 'worldObject') {
  const homePlaceId = cleanText(value?.homePlaceId) || null;
  if (homePlaceId && !campaign.records.some(record => record.id === homePlaceId && record.kind === 'place')) {
    throw new CampaignValidationError('World Object home Place does not exist.', {
      [`${field}.homePlaceId`]: 'Choose an existing Place.',
    });
  }
  return {
    ...cleanRecordFields(value, field, 'world-object'),
    state: cleanText(value?.state),
    homePlaceId,
  };
}

function placeParentCreatesCycle(campaign, placeId, parentPlaceId) {
  const seen = new Set([placeId]);
  let cursor = parentPlaceId;
  while (cursor) {
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    cursor = campaign.records.find(record => record.id === cursor && record.kind === 'place')?.parentPlaceId ?? null;
  }
  return false;
}

function cleanEditableLocalEntries(value, field, mapper) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new CampaignValidationError(`${field} must be an array.`);
  const ids = new Set();
  return value.map((entry, index) => {
    const id = cleanText(entry?.id) || null;
    if (id && ids.has(id)) throw new CampaignValidationError(`Duplicate ID '${id}' in ${field}.`);
    if (id) ids.add(id);
    return { id, ...mapper(entry, index) };
  });
}

function cleanScenePayload(value, campaign, field = 'scene') {
  const placeId = cleanText(value?.placeId) || null;
  if (placeId && !campaign.records.some(record => record.id === placeId && record.kind === 'place')) {
    throw new CampaignValidationError('Scene Place does not exist.', { [`${field}.placeId`]: 'Choose an existing Place.' });
  }
  const presences = cleanEditableLocalEntries(value?.presences, `${field}.presences`, (presence, index) => {
    const kind = cleanText(presence?.subjectRef?.kind) === 'worldObject'
      ? 'world_object'
      : cleanText(presence?.subjectRef?.kind);
    const id = cleanText(presence?.subjectRef?.id);
    const allowedKinds = new Set(['actor', 'item', 'possession', 'world_object']);
    const exists = kind === 'possession'
      ? campaign.possessions.some(entry => entry.id === id)
      : campaign.records.some(record => record.id === id && record.kind === kind);
    if (!allowedKinds.has(kind) || !exists) {
      throw new CampaignValidationError('Scene Presence subject does not exist.', {
        [`${field}.presences.${index}.subjectRef`]: 'Choose an Actor, Item, Inventory entry, or World Object.',
      });
    }
    const state = cleanText(presence?.state) || 'present';
    if (!PRESENCE_STATES.has(state)) {
      throw new CampaignValidationError('Scene Presence state is invalid.', {
        [`${field}.presences.${index}.state`]: 'Choose present, hidden, departed, destroyed, or other.',
      });
    }
    return {
      subjectRef: { kind, id },
      role: cleanText(presence?.role) || 'participant',
      state,
      notes: cleanText(presence?.notes),
    };
  });
  const exits = cleanEditableLocalEntries(value?.exits, `${field}.exits`, (exit, index) => {
    const destinationPlaceId = cleanText(exit?.destinationPlaceId) || null;
    if (destinationPlaceId && !campaign.records.some(record => record.id === destinationPlaceId && record.kind === 'place')) {
      throw new CampaignValidationError('Scene Exit destination does not exist.', {
        [`${field}.exits.${index}.destinationPlaceId`]: 'Choose an existing Place.',
      });
    }
    const status = cleanText(exit?.status) || 'open';
    if (!EXIT_STATUSES.has(status)) {
      throw new CampaignValidationError('Scene Exit status is invalid.', {
        [`${field}.exits.${index}.status`]: 'Choose open, closed, blocked, or unknown.',
      });
    }
    return {
      label: requiredText(exit?.label, `${field}.exits.${index}.label`, 'Scene Exit label'),
      destinationPlaceId,
      status,
      notes: cleanText(exit?.notes),
    };
  });
  const obstacles = cleanEditableLocalEntries(value?.obstacles, `${field}.obstacles`, (obstacle, index) => {
    const status = cleanText(obstacle?.status) || 'active';
    if (!OBSTACLE_STATUSES.has(status)) {
      throw new CampaignValidationError('Scene Obstacle status is invalid.', {
        [`${field}.obstacles.${index}.status`]: 'Choose active, resolved, or bypassed.',
      });
    }
    return {
      label: requiredText(obstacle?.label, `${field}.obstacles.${index}.label`, 'Scene Obstacle label'),
      status,
      notes: cleanText(obstacle?.notes),
    };
  });
  const countdowns = cleanEditableLocalEntries(value?.countdowns, `${field}.countdowns`, (countdown, index) => {
    const current = positiveInteger(countdown?.current ?? 0, `${field}.countdowns.${index}.current`);
    const max = positiveInteger(countdown?.max, `${field}.countdowns.${index}.max`, { allowZero: false });
    if (current > max) {
      throw new CampaignValidationError('Scene Countdown current cannot exceed maximum.', {
        [`${field}.countdowns.${index}.current`]: 'Current cannot exceed maximum.',
      });
    }
    return {
      label: requiredText(countdown?.label, `${field}.countdowns.${index}.label`, 'Scene Countdown label'),
      current,
      max,
      notes: cleanText(countdown?.notes),
    };
  });
  const openThreads = cleanEditableLocalEntries(
    value?.openThreads ?? value?.threads,
    `${field}.openThreads`,
    (thread, index) => {
      const status = cleanText(thread?.status) || 'open';
      if (!THREAD_STATUSES.has(status)) {
        throw new CampaignValidationError('Scene Thread status is invalid.', {
          [`${field}.openThreads.${index}.status`]: 'Choose open, resolved, or carried.',
        });
      }
      return {
        label: requiredText(thread?.label, `${field}.openThreads.${index}.label`, 'Scene Thread label'),
        status,
        notes: cleanText(thread?.notes),
        carriedFromThreadId: cleanText(thread?.carriedFromThreadId) || null,
      };
    },
  );
  return {
    title: requiredText(value?.title, `${field}.title`, 'Scene title'),
    summary: cleanText(value?.summary),
    placeId,
    transitionNotes: cleanText(value?.transitionNotes),
    presences,
    exits,
    obstacles,
    countdowns,
    openThreads,
  };
}

function addonId(value, field) {
  const id = requiredText(value, field, 'Addon ID');
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(id)) {
    throw new CampaignValidationError(`${field} is invalid.`, {
      [field]: 'Use 1-80 letters, numbers, dots, underscores, or hyphens.',
    });
  }
  return id;
}

function normalizeAddonBundle(input) {
  if (input?.bundleVersion !== 1) throw new CampaignValidationError('Unsupported Campaign addon bundle.');
  for (const collection of ['items', 'abilities', 'people', 'relationships', 'quests', 'facts', 'places', 'worldObjects']) {
    if (!Array.isArray(input?.[collection])) {
      throw new CampaignValidationError(`Addon bundle '${collection}' must be an array.`);
    }
  }
  const seen = new Map();
  const uniqueId = (kind, value, field) => {
    const id = addonId(value, field);
    const key = `${kind}:${id}`;
    if (seen.has(key)) throw new CampaignValidationError(`Duplicate addon ID: ${key}.`, { [field]: 'Use a unique stable ID.' });
    seen.set(key, true);
    return id;
  };

  const items = input.items.map((entry, index) => {
    const carriedState = cleanText(entry?.carriedState) || 'carried';
    if (!CARRIED_STATES.has(carriedState)) {
      throw new CampaignValidationError('Addon Item carried state is invalid.', {
        [`items.${index}.carriedState`]: 'Choose carried, worn, stored, missing, consumed, or other.',
      });
    }
    return {
      externalId: uniqueId('item', entry?.id, `items.${index}.id`),
      sourceFile: cleanText(entry?._sourceFile),
      name: requiredText(entry?.name, `items.${index}.name`, 'Item name'),
      summary: cleanText(entry?.summary),
      details: cleanText(entry?.details),
      category: cleanText(entry?.category) || 'other',
      tags: cleanTags(entry?.tags),
      quantity: positiveInteger(entry?.quantity ?? 1, `items.${index}.quantity`),
      carriedState,
      equippedSlots: cleanTags(entry?.equippedSlots),
      condition: cleanText(entry?.condition),
      notes: cleanText(entry?.notes),
      contextPolicy: cleanContextPolicy(entry?.contextPolicy, `items.${index}.contextPolicy`),
    };
  });

  const abilities = input.abilities.map((entry, index) => {
    const accessState = cleanText(entry?.accessState) || 'learned';
    if (!ABILITY_ACCESS_STATES.has(accessState)) {
      throw new CampaignValidationError('Addon Ability access state is invalid.', {
        [`abilities.${index}.accessState`]: 'Choose learned, prepared, enabled, unavailable, or forgotten.',
      });
    }
    const currentUses = optionalNonNegativeInteger(entry?.currentUses, `abilities.${index}.currentUses`);
    const maxUses = optionalNonNegativeInteger(entry?.maxUses, `abilities.${index}.maxUses`);
    if (currentUses !== null && maxUses !== null && currentUses > maxUses) {
      throw new CampaignValidationError('Addon Ability current uses cannot exceed maximum uses.', {
        [`abilities.${index}.currentUses`]: 'Current uses cannot exceed maximum uses.',
      });
    }
    return {
      externalId: uniqueId('ability', entry?.id, `abilities.${index}.id`),
      sourceFile: cleanText(entry?._sourceFile),
      name: requiredText(entry?.name, `abilities.${index}.name`, 'Ability name'),
      summary: cleanText(entry?.summary),
      details: cleanText(entry?.details),
      category: cleanText(entry?.category) || 'other',
      tags: cleanTags(entry?.tags),
      usage: cleanText(entry?.usage),
      limits: cleanText(entry?.limits),
      defaultResourceLabel: cleanText(entry?.resourceLabel ?? entry?.defaultResourceLabel),
      contextPolicy: cleanContextPolicy(entry?.contextPolicy, `abilities.${index}.contextPolicy`),
      accessState,
      currentUses,
      maxUses,
      notes: cleanText(entry?.notes),
    };
  });

  const people = input.people.map((entry, index) => ({
    externalId: uniqueId('actor', entry?.id, `people.${index}.id`),
    sourceFile: cleanText(entry?._sourceFile),
    name: requiredText(entry?.name, `people.${index}.name`, 'Actor name'),
    aliases: cleanTags(entry?.aliases),
    pronouns: cleanText(entry?.pronouns),
    summary: cleanText(entry?.summary),
    details: cleanText(entry?.details),
    category: cleanText(entry?.category) || 'npc',
    tags: cleanTags(entry?.tags),
    appearance: cleanText(entry?.appearance),
    personality: cleanText(entry?.personality),
    goals: cleanText(entry?.goals),
    voiceNotes: cleanText(entry?.voiceNotes),
    conditions: cleanTags(entry?.conditions),
    meters: cleanMeters(entry?.meters, `people.${index}.meters`),
    contextPolicy: cleanContextPolicy(entry?.contextPolicy, `people.${index}.contextPolicy`),
  }));
  const peopleIds = new Set(people.map(entry => entry.externalId));

  const character = input.character === null || input.character === undefined
    ? null
    : {
        sourceFile: cleanText(input.character?._sourceFile),
        name: requiredText(input.character?.name, 'character.name', 'Player Character name'),
        aliases: cleanTags(input.character?.aliases),
        pronouns: cleanText(input.character?.pronouns),
        summary: cleanText(input.character?.summary),
        details: cleanText(input.character?.details),
        category: cleanText(input.character?.category) || 'player-character',
        tags: cleanTags(input.character?.tags),
        appearance: cleanText(input.character?.appearance),
        personality: cleanText(input.character?.personality),
        goals: cleanText(input.character?.goals),
        voiceNotes: cleanText(input.character?.voiceNotes),
        conditions: cleanTags(input.character?.conditions),
        meters: cleanMeters(input.character?.meters, 'character.meters'),
        contextPolicy: cleanContextPolicy(input.character?.contextPolicy, 'character.contextPolicy'),
      };

  const relationships = input.relationships.map((entry, index) => {
    const status = cleanText(entry?.status) || 'active';
    if (!RELATIONSHIP_STATUSES.has(status)) {
      throw new CampaignValidationError('Addon Relationship status is invalid.', {
        [`relationships.${index}.status`]: 'Choose active, strained, dormant, ended, or other.',
      });
    }
    const source = cleanText(entry?.source);
    const target = cleanText(entry?.target);
    if (source !== '$player') addonId(source, `relationships.${index}.source`);
    if (target !== '$player') addonId(target, `relationships.${index}.target`);
    if (source === target) {
      throw new CampaignValidationError('Addon Relationship must connect two different Actors.', {
        [`relationships.${index}.target`]: 'Choose another Actor.',
      });
    }
    if (source !== '$player' && !peopleIds.has(source)) {
      throw new CampaignValidationError(`Addon Relationship refers to unknown People ID '${source}'.`);
    }
    if (target !== '$player' && !peopleIds.has(target)) {
      throw new CampaignValidationError(`Addon Relationship refers to unknown People ID '${target}'.`);
    }
    return {
      externalId: uniqueId('relationship', entry?.id, `relationships.${index}.id`),
      sourceFile: cleanText(entry?._sourceFile),
      source,
      target,
      relationshipKind: requiredText(entry?.kind ?? entry?.relationshipKind, `relationships.${index}.kind`, 'Relationship kind'),
      status,
      notes: cleanText(entry?.notes),
      dimensions: cleanRelationshipDimensions(entry?.dimensions, `relationships.${index}.dimensions`),
    };
  });

  const normalizeLocalEntries = (value, field, mapper) => {
    if (value === null || value === undefined) return [];
    if (!Array.isArray(value)) throw new CampaignValidationError(`${field} must be an array.`);
    const localIds = new Set();
    return value.map((entry, index) => {
      const externalId = addonId(entry?.id, `${field}.${index}.id`);
      if (localIds.has(externalId)) throw new CampaignValidationError(`Duplicate ID '${externalId}' in ${field}.`);
      localIds.add(externalId);
      return mapper(entry, index, externalId);
    });
  };

  const quests = input.quests.map((entry, index) => {
    const status = cleanText(entry?.status) || 'planned';
    if (!QUEST_STATUSES.has(status)) {
      throw new CampaignValidationError('Addon Quest status is invalid.', {
        [`quests.${index}.status`]: 'Choose planned, active, blocked, completed, or failed.',
      });
    }
    const steps = normalizeLocalEntries(entry?.steps, `quests.${index}.steps`, (step, stepIndex, externalId) => {
      const stepStatus = cleanText(step?.status) || 'pending';
      if (!QUEST_STEP_STATUSES.has(stepStatus)) {
        throw new CampaignValidationError('Addon Quest Step status is invalid.', {
          [`quests.${index}.steps.${stepIndex}.status`]: 'Choose pending, active, blocked, completed, or skipped.',
        });
      }
      return {
        externalId,
        label: requiredText(step?.label, `quests.${index}.steps.${stepIndex}.label`, 'Quest Step label'),
        status: stepStatus,
        notes: cleanText(step?.notes),
      };
    });
    return {
      externalId: uniqueId('quest', entry?.id, `quests.${index}.id`),
      sourceFile: cleanText(entry?._sourceFile),
      name: requiredText(entry?.name, `quests.${index}.name`, 'Quest name'),
      summary: cleanText(entry?.summary),
      details: cleanText(entry?.details),
      category: cleanText(entry?.category) || 'quest',
      tags: cleanTags(entry?.tags),
      status,
      stakes: cleanText(entry?.stakes),
      outcome: cleanText(entry?.outcome),
      steps,
      rawInvolved: entry?.involved ?? [],
      contextPolicy: cleanContextPolicy(entry?.contextPolicy, `quests.${index}.contextPolicy`),
    };
  });

  const facts = input.facts.map((entry, index) => {
    const importance = cleanText(entry?.importance) || 'normal';
    if (!FACT_IMPORTANCE.has(importance)) {
      throw new CampaignValidationError('Addon Fact importance is invalid.', {
        [`facts.${index}.importance`]: 'Choose normal, important, or critical.',
      });
    }
    return {
      externalId: uniqueId('fact', entry?.id, `facts.${index}.id`),
      sourceFile: cleanText(entry?._sourceFile),
      name: requiredText(entry?.name, `facts.${index}.name`, 'Fact name'),
      proposition: requiredText(entry?.proposition, `facts.${index}.proposition`, 'Fact proposition'),
      summary: cleanText(entry?.summary),
      details: cleanText(entry?.details),
      category: cleanText(entry?.category) || 'fact',
      scope: cleanText(entry?.scope) || 'campaign',
      tags: cleanTags(entry?.tags),
      rawSubject: entry?.subject ?? null,
      importance,
      contextPolicy: cleanContextPolicy(entry?.contextPolicy, `facts.${index}.contextPolicy`),
    };
  });

  const places = input.places.map((entry, index) => ({
    externalId: uniqueId('place', entry?.id, `places.${index}.id`),
    sourceFile: cleanText(entry?._sourceFile),
    name: requiredText(entry?.name, `places.${index}.name`, 'Place name'),
    summary: cleanText(entry?.summary),
    details: cleanText(entry?.details),
    category: cleanText(entry?.category) || 'place',
    tags: cleanTags(entry?.tags),
    atmosphere: cleanText(entry?.atmosphere),
    rawParent: cleanText(entry?.parent),
    connections: normalizeLocalEntries(entry?.connections, `places.${index}.connections`, (connection, connectionIndex, externalId) => ({
      externalId,
      targetExternalId: addonId(connection?.place, `places.${index}.connections.${connectionIndex}.place`),
      connectionKind: cleanText(connection?.kind) || 'connection',
      notes: cleanText(connection?.notes),
    })),
    contextPolicy: cleanContextPolicy(entry?.contextPolicy, `places.${index}.contextPolicy`),
  }));

  const worldObjects = input.worldObjects.map((entry, index) => ({
    externalId: uniqueId('world_object', entry?.id, `worldObjects.${index}.id`),
    sourceFile: cleanText(entry?._sourceFile),
    name: requiredText(entry?.name, `worldObjects.${index}.name`, 'World Object name'),
    summary: cleanText(entry?.summary),
    details: cleanText(entry?.details),
    category: cleanText(entry?.category) || 'world-object',
    tags: cleanTags(entry?.tags),
    state: cleanText(entry?.state),
    rawHomePlace: cleanText(entry?.homePlace),
    contextPolicy: cleanContextPolicy(entry?.contextPolicy, `worldObjects.${index}.contextPolicy`),
  }));

  const idsByKind = new Map([
    ['actor', peopleIds],
    ['item', new Set(items.map(entry => entry.externalId))],
    ['possession', new Set(items.map(entry => entry.externalId))],
    ['ability', new Set(abilities.map(entry => entry.externalId))],
    ['quest', new Set(quests.map(entry => entry.externalId))],
    ['fact', new Set(facts.map(entry => entry.externalId))],
    ['place', new Set(places.map(entry => entry.externalId))],
    ['world_object', new Set(worldObjects.map(entry => entry.externalId))],
  ]);
  const normalizeReference = (reference, field, allowedKinds, { optional = false } = {}) => {
    if (reference === null || reference === undefined) {
      if (optional) return null;
      throw new CampaignValidationError(`${field} is required.`, { [field]: 'Choose a referenced subject.' });
    }
    const rawKind = cleanText(reference?.kind);
    const kind = rawKind === 'worldObject' ? 'world_object' : rawKind;
    if (!allowedKinds.includes(kind)) {
      throw new CampaignValidationError(`${field} kind is invalid.`, { [field]: `Choose: ${allowedKinds.join(', ')}.` });
    }
    const externalId = cleanText(reference?.id);
    if (kind === 'actor' && externalId === '$player') return { kind, externalId };
    addonId(externalId, `${field}.id`);
    if (!idsByKind.get(kind)?.has(externalId)) {
      throw new CampaignValidationError(`${field} refers to unknown ${kind} ID '${externalId}'.`);
    }
    return { kind, externalId };
  };

  for (const [index, quest] of quests.entries()) {
    if (!Array.isArray(quest.rawInvolved)) throw new CampaignValidationError(`quests.${index}.involved must be an array.`);
    quest.involved = quest.rawInvolved.map((reference, referenceIndex) => normalizeReference(
      reference,
      `quests.${index}.involved.${referenceIndex}`,
      ['actor', 'item', 'ability', 'fact', 'place', 'world_object'],
    ));
    delete quest.rawInvolved;
  }
  for (const [index, fact] of facts.entries()) {
    fact.subject = normalizeReference(
      fact.rawSubject,
      `facts.${index}.subject`,
      ['actor', 'item', 'ability', 'quest', 'place', 'world_object'],
      { optional: true },
    );
    delete fact.rawSubject;
  }
  const placeIds = idsByKind.get('place');
  for (const [index, place] of places.entries()) {
    if (place.rawParent && !placeIds.has(place.rawParent)) {
      throw new CampaignValidationError(`places.${index}.parent refers to unknown Place ID '${place.rawParent}'.`);
    }
    place.parentExternalId = place.rawParent || null;
    delete place.rawParent;
    for (const connection of place.connections) {
      if (!placeIds.has(connection.targetExternalId)) {
        throw new CampaignValidationError(`Place '${place.externalId}' has a connection to unknown Place '${connection.targetExternalId}'.`);
      }
    }
  }
  for (const [index, worldObject] of worldObjects.entries()) {
    if (worldObject.rawHomePlace && !placeIds.has(worldObject.rawHomePlace)) {
      throw new CampaignValidationError(`worldObjects.${index}.homePlace refers to unknown Place ID '${worldObject.rawHomePlace}'.`);
    }
    worldObject.homePlaceExternalId = worldObject.rawHomePlace || null;
    delete worldObject.rawHomePlace;
  }

  let scene = null;
  if (input.scene !== null && input.scene !== undefined) {
    const scenePlace = cleanText(input.scene?.place);
    if (scenePlace && !placeIds.has(scenePlace)) {
      throw new CampaignValidationError(`scene.place refers to unknown Place ID '${scenePlace}'.`);
    }
    const presences = normalizeLocalEntries(input.scene?.presences, 'scene.presences', (presence, index, externalId) => {
      const presenceState = cleanText(presence?.state) || 'present';
      if (!PRESENCE_STATES.has(presenceState)) {
        throw new CampaignValidationError('Scene Presence state is invalid.', {
          [`scene.presences.${index}.state`]: 'Choose present, hidden, departed, destroyed, or other.',
        });
      }
      return {
        externalId,
        subject: normalizeReference(
          presence?.subject,
          `scene.presences.${index}.subject`,
          ['actor', 'item', 'possession', 'world_object'],
        ),
        role: cleanText(presence?.role) || 'participant',
        state: presenceState,
        notes: cleanText(presence?.notes),
      };
    });
    const exits = normalizeLocalEntries(input.scene?.exits, 'scene.exits', (exit, index, externalId) => {
      const status = cleanText(exit?.status) || 'open';
      if (!EXIT_STATUSES.has(status)) {
        throw new CampaignValidationError('Scene Exit status is invalid.', {
          [`scene.exits.${index}.status`]: 'Choose open, closed, blocked, or unknown.',
        });
      }
      const destinationPlaceExternalId = cleanText(exit?.destinationPlace);
      if (destinationPlaceExternalId && !placeIds.has(destinationPlaceExternalId)) {
        throw new CampaignValidationError(`Scene Exit '${externalId}' refers to unknown Place '${destinationPlaceExternalId}'.`);
      }
      return {
        externalId,
        label: requiredText(exit?.label, `scene.exits.${index}.label`, 'Scene Exit label'),
        destinationPlaceExternalId: destinationPlaceExternalId || null,
        status,
        notes: cleanText(exit?.notes),
      };
    });
    const obstacles = normalizeLocalEntries(input.scene?.obstacles, 'scene.obstacles', (obstacle, index, externalId) => {
      const status = cleanText(obstacle?.status) || 'active';
      if (!OBSTACLE_STATUSES.has(status)) {
        throw new CampaignValidationError('Scene Obstacle status is invalid.', {
          [`scene.obstacles.${index}.status`]: 'Choose active, resolved, or bypassed.',
        });
      }
      return {
        externalId,
        label: requiredText(obstacle?.label, `scene.obstacles.${index}.label`, 'Scene Obstacle label'),
        status,
        notes: cleanText(obstacle?.notes),
      };
    });
    const countdowns = normalizeLocalEntries(input.scene?.countdowns, 'scene.countdowns', (countdown, index, externalId) => {
      const current = positiveInteger(countdown?.current ?? 0, `scene.countdowns.${index}.current`);
      const max = positiveInteger(countdown?.max, `scene.countdowns.${index}.max`, { allowZero: false });
      if (current > max) {
        throw new CampaignValidationError('Scene Countdown current value cannot exceed maximum.', {
          [`scene.countdowns.${index}.current`]: 'Current cannot exceed maximum.',
        });
      }
      return {
        externalId,
        label: requiredText(countdown?.label, `scene.countdowns.${index}.label`, 'Scene Countdown label'),
        current,
        max,
        notes: cleanText(countdown?.notes),
      };
    });
    const threads = normalizeLocalEntries(input.scene?.threads, 'scene.threads', (thread, index, externalId) => {
      const status = cleanText(thread?.status) || 'open';
      if (!THREAD_STATUSES.has(status)) {
        throw new CampaignValidationError('Scene Thread status is invalid.', {
          [`scene.threads.${index}.status`]: 'Choose open, resolved, or carried.',
        });
      }
      return {
        externalId,
        label: requiredText(thread?.label, `scene.threads.${index}.label`, 'Scene Thread label'),
        status,
        notes: cleanText(thread?.notes),
      };
    });
    scene = {
      externalId: uniqueId('scene', input.scene?.id, 'scene.id'),
      sourceFile: cleanText(input.scene?._sourceFile),
      title: requiredText(input.scene?.title, 'scene.title', 'Scene title'),
      summary: cleanText(input.scene?.summary),
      placeExternalId: scenePlace || null,
      presences,
      exits,
      obstacles,
      countdowns,
      threads,
      transitionNotes: cleanText(input.scene?.transitionNotes),
    };
  }

  return {
    sources: Array.isArray(input.sources) ? input.sources.map(cleanText).filter(Boolean) : [],
    character,
    items,
    abilities,
    people,
    relationships,
    quests,
    facts,
    places,
    worldObjects,
    scene,
  };
}

function requiredText(value, field, label) {
  const text = cleanText(value);
  if (!text) {
    throw new CampaignValidationError(`${label} is required.`, { [field]: `${label} is required.` });
  }
  return text;
}

function describeReferenceBlockers(blockers) {
  return [...new Set(blockers.map(blocker => blocker.location))];
}

function requireNoInboundReferences(campaign, id, field, label, options = {}) {
  const blockers = describeReferenceBlockers(createCampaignReferenceGraph(campaign).inbound(id, options));
  if (!blockers.length) return;
  throw new CampaignValidationError(`Remove references before deleting ${label}: ${blockers.join(', ')}.`, {
    [field]: `Blocked by ${blockers.join(', ')}.`,
  });
}

function validateEnvelope(envelope) {
  const campaign = envelope?.campaign;
  const errors = [];
  if (envelope?.envelopeVersion !== 1) errors.push('Unsupported Campaign envelope.');
  if (campaign?.schemaVersion !== 1) errors.push('Unsupported Campaign schema.');
  if (!campaign?.instanceId || !campaign?.commitId) errors.push('Campaign identity is incomplete.');
  if (!campaign?.binding?.chatId) errors.push('Campaign chat binding is missing.');
  if (!Number.isInteger(campaign?.revision) || campaign.revision < 1) errors.push('Campaign revision is invalid.');
  if (!Array.isArray(campaign?.records)
    || !Array.isArray(campaign?.possessions)
    || !Array.isArray(campaign?.learnedAbilities)
    || !Array.isArray(campaign?.relationships)
    || !Array.isArray(campaign?.sceneArchives)
    || !Array.isArray(campaign?.proposals)) {
    errors.push('Campaign collections are invalid.');
  }
  if (!campaign?.records?.some(record => record.id === campaign.playerCharacterId && record.kind === 'actor')) {
    errors.push('Player Character is missing.');
  }
  if (campaign?.currentScene) {
    for (const collection of ['presences', 'exits', 'obstacles', 'countdowns', 'openThreads']) {
      if (!Array.isArray(campaign.currentScene[collection])) errors.push(`Current Scene ${collection} are invalid.`);
    }
  }
  if (envelope?.capsule?.campaignRevision !== campaign?.revision || envelope?.capsule?.commitId !== campaign?.commitId) {
    errors.push('Context Capsule does not match the Campaign revision.');
  }
  if (errors.length) throw new CampaignValidationError(errors.join(' '));
}

function makeEnvelope(campaign) {
  const compiled = compileContextCapsuleDetailed(campaign);
  return {
    envelopeVersion: 1,
    campaign: clone(campaign),
    capsule: {
      campaignRevision: campaign.revision,
      commitId: campaign.commitId,
      text: compiled.text,
      diagnostics: compiled.diagnostics,
    },
  };
}

function createInitialEnvelope(binding, createId, now) {
  const createdAt = now();
  const actorId = createId('actor');
  const commitId = createId('commit');
  const campaign = {
    schemaVersion: 1,
    instanceId: createId('campaign'),
    title: cleanText(binding.title) || 'RPG Campaign',
    binding: { chatId: requiredText(binding.chatId, 'chatId', 'Chat binding') },
    revision: 1,
    commitId,
    playerCharacterId: actorId,
    records: [{
      id: actorId,
      kind: 'actor',
      role: 'player_character',
      name: 'Player Character',
      summary: '',
      details: '',
      category: 'player-character',
      tags: [],
      contextPolicy: 'automatic',
      createdAt,
      updatedAt: createdAt,
      createdRevision: 1,
      updatedRevision: 1,
      archivedAt: null,
    }],
    possessions: [],
    learnedAbilities: [],
    relationships: [],
    events: [{
      id: createId('event'),
      type: 'campaign_created',
      revision: 1,
      affectedIds: [actorId],
      createdAt,
    }],
    sceneArchives: [],
    proposals: [],
    pendingSyncReview: null,
    currentScene: null,
    syncBoundary: null,
  };
  return makeEnvelope(campaign);
}

function defaultId(kind) {
  return `${kind}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

export function createMemoryCampaignStorage() {
  const campaigns = new Map();
  return Object.freeze({
    async load(binding) {
      return clone(campaigns.get(binding.chatId) ?? null);
    },
    async commit(binding, candidate, expectedCommitId) {
      const current = campaigns.get(binding.chatId) ?? null;
      const currentCommitId = current?.campaign?.commitId ?? null;
      if (currentCommitId !== expectedCommitId) {
        throw new CampaignConflictError('Stored Campaign changed before this operation could be committed.', {
          expectedCommitId,
          actualCommitId: currentCommitId,
        });
      }
      validateEnvelope(candidate);
      campaigns.set(binding.chatId, clone(candidate));
      return clone(candidate);
    },
  });
}

export function createCampaignSession({
  storage,
  createId = defaultId,
  now = () => new Date().toISOString(),
} = {}) {
  if (!storage?.load || !storage?.commit) throw new TypeError('Campaign storage must provide load and commit.');

  let binding = null;
  let verified = null;
  const listeners = new Set();
  const undoEntries = new Map();

  function requireOpen() {
    if (!binding || !verified) throw new Error('Campaign Session is not open.');
    return verified.campaign;
  }

  function status() {
    const campaign = requireOpen();
    return {
      state: 'verified',
      campaignId: campaign.instanceId,
      revision: campaign.revision,
      commitId: campaign.commitId,
      playerCharacterId: campaign.playerCharacterId,
      capsule: verified.capsule.text,
      syncBoundary: clone(campaign.syncBoundary),
    };
  }

  async function open(nextBinding) {
    const chatId = requiredText(nextBinding?.chatId, 'chatId', 'Chat binding');
    binding = { chatId, title: cleanText(nextBinding?.title) };
    undoEntries.clear();
    const loaded = await storage.load(binding);
    if (loaded) {
      loaded.campaign.learnedAbilities ??= [];
      loaded.campaign.relationships ??= [];
      loaded.campaign.sceneArchives ??= [];
      loaded.campaign.proposals ??= [];
      loaded.campaign.pendingSyncReview ??= null;
      loaded.campaign.syncBoundary ??= null;
      if (loaded.campaign.currentScene) {
        loaded.campaign.currentScene.presences ??= [];
        loaded.campaign.currentScene.exits ??= [];
        loaded.campaign.currentScene.obstacles ??= [];
        loaded.campaign.currentScene.countdowns ??= [];
        loaded.campaign.currentScene.openThreads ??= loaded.campaign.currentScene.threads ?? [];
        delete loaded.campaign.currentScene.threads;
      }
      validateEnvelope(loaded);
      if (loaded.campaign.binding.chatId !== chatId) {
        throw new CampaignConflictError('Stored Campaign belongs to another chat.', {
          expectedChatId: chatId,
          actualChatId: loaded.campaign.binding.chatId,
        });
      }
      const rebuilt = makeEnvelope(loaded.campaign);
      const capsuleNeedsRefresh = !loaded.capsule?.diagnostics || loaded.capsule.text !== rebuilt.capsule.text;
      if (capsuleNeedsRefresh) {
        const migratedCampaign = clone(loaded.campaign);
        const migratedAt = now();
        migratedCampaign.revision += 1;
        migratedCampaign.commitId = createId('commit');
        migratedCampaign.events.push({
          id: createId('event'),
          type: 'context_capsule_migrated',
          revision: migratedCampaign.revision,
          affectedIds: [],
          createdAt: migratedAt,
        });
        verified = await storage.commit(binding, makeEnvelope(migratedCampaign), loaded.campaign.commitId);
      } else {
        verified = clone(loaded);
      }
    } else {
      const initial = createInitialEnvelope(binding, createId, now);
      verified = await storage.commit(binding, initial, null);
    }
    return status();
  }

  function query(queryInput = {}) {
    const campaign = requireOpen();
    if (queryInput.collection === 'inventory') {
      const records = new Map(campaign.records.map(record => [record.id, record]));
      const entries = campaign.possessions
        .filter(possession => queryInput.archived ? Boolean(possession.archivedAt) : !possession.archivedAt)
        .map(possession => ({
          possession: clone(possession),
          item: clone(records.get(possession.itemId)),
          owner: clone(records.get(possession.ownerActorId)),
        }))
        .filter(entry => entry.item && entry.owner)
        .sort((left, right) => left.item.name.localeCompare(right.item.name));
      return { revision: campaign.revision, entries };
    }
    if (queryInput.collection === 'character') {
      return {
        revision: campaign.revision,
        actor: clone(campaign.records.find(record => record.id === campaign.playerCharacterId)),
      };
    }
    if (queryInput.collection === 'abilities') {
      const records = new Map(campaign.records.map(record => [record.id, record]));
      const entries = campaign.learnedAbilities
        .filter(learnedAbility => queryInput.archived ? Boolean(learnedAbility.archivedAt) : !learnedAbility.archivedAt)
        .map(learnedAbility => ({
          learnedAbility: clone(learnedAbility),
          ability: clone(records.get(learnedAbility.abilityId)),
          actor: clone(records.get(learnedAbility.actorId)),
        }))
        .filter(entry => entry.ability && entry.actor)
        .sort((left, right) => left.ability.name.localeCompare(right.ability.name));
      return { revision: campaign.revision, entries };
    }
    if (queryInput.collection === 'people') {
      const records = new Map(campaign.records.map(record => [record.id, record]));
      const entries = campaign.records
        .filter(record => record.kind === 'actor'
          && record.role === 'npc'
          && (queryInput.archived ? Boolean(record.archivedAt) : !record.archivedAt))
        .map(actor => ({
          actor: clone(actor),
          relationships: campaign.relationships
            .filter(relationship => !relationship.archivedAt
              && (relationship.sourceActorId === actor.id || relationship.targetActorId === actor.id))
            .map(relationship => ({
              relationship: clone(relationship),
              source: clone(records.get(relationship.sourceActorId)),
              target: clone(records.get(relationship.targetActorId)),
            }))
            .filter(entry => entry.source && entry.target),
        }))
        .sort((left, right) => left.actor.name.localeCompare(right.actor.name));
      return { revision: campaign.revision, entries };
    }
    if (queryInput.collection === 'relationships') {
      const records = new Map(campaign.records.map(record => [record.id, record]));
      const entries = campaign.relationships
        .filter(relationship => queryInput.archived ? Boolean(relationship.archivedAt) : !relationship.archivedAt)
        .filter(relationship => !queryInput.actorId
          || relationship.sourceActorId === queryInput.actorId
          || relationship.targetActorId === queryInput.actorId)
        .map(relationship => ({
          relationship: clone(relationship),
          source: clone(records.get(relationship.sourceActorId)),
          target: clone(records.get(relationship.targetActorId)),
        }))
        .filter(entry => entry.source && entry.target)
        .sort((left, right) => `${left.source.name}:${left.target.name}`.localeCompare(`${right.source.name}:${right.target.name}`));
      return { revision: campaign.revision, entries };
    }
    if (queryInput.collection === 'objectives' || queryInput.collection === 'quests') {
      const entries = campaign.records
        .filter(record => record.kind === 'quest'
          && (queryInput.archived ? Boolean(record.archivedAt) : !record.archivedAt))
        .sort((left, right) => left.name.localeCompare(right.name))
        .map(clone);
      return { revision: campaign.revision, entries };
    }
    if (queryInput.collection === 'facts') {
      const records = new Map(campaign.records.map(record => [record.id, record]));
      const entries = campaign.records
        .filter(record => record.kind === 'fact'
          && (queryInput.archived ? Boolean(record.archivedAt) : !record.archivedAt))
        .sort((left, right) => left.name.localeCompare(right.name))
        .map(fact => ({ fact: clone(fact), subject: clone(records.get(fact.subjectRef?.id)) }))
        .map(entry => entry.subject ? entry : { ...entry, subject: null });
      return { revision: campaign.revision, entries };
    }
    if (queryInput.collection === 'places') {
      const records = new Map(campaign.records.map(record => [record.id, record]));
      const entries = campaign.records
        .filter(record => record.kind === 'place'
          && (queryInput.archived ? Boolean(record.archivedAt) : !record.archivedAt))
        .sort((left, right) => left.name.localeCompare(right.name))
        .map(place => ({
          place: clone(place),
          parent: clone(records.get(place.parentPlaceId)) ?? null,
          connections: (place.connections ?? []).map(connection => ({
            connection: clone(connection),
            target: clone(records.get(connection.targetPlaceId)) ?? null,
          })),
        }));
      return { revision: campaign.revision, entries };
    }
    if (queryInput.collection === 'world_objects') {
      const records = new Map(campaign.records.map(record => [record.id, record]));
      const entries = campaign.records
        .filter(record => record.kind === 'world_object'
          && (queryInput.archived ? Boolean(record.archivedAt) : !record.archivedAt))
        .sort((left, right) => left.name.localeCompare(right.name))
        .map(worldObject => ({
          worldObject: clone(worldObject),
          homePlace: clone(records.get(worldObject.homePlaceId)) ?? null,
        }));
      return { revision: campaign.revision, entries };
    }
    if (queryInput.collection === 'world') {
      return {
        revision: campaign.revision,
        facts: query({ collection: 'facts', archived: queryInput.archived }).entries,
        places: query({ collection: 'places', archived: queryInput.archived }).entries,
        worldObjects: query({ collection: 'world_objects', archived: queryInput.archived }).entries,
      };
    }
    if (queryInput.collection === 'reference_options') {
      const allowedKinds = new Set(['actor', 'item', 'ability', 'fact', 'place', 'world_object']);
      const entries = campaign.records
        .filter(record => allowedKinds.has(record.kind))
        .sort((left, right) => `${left.kind}:${left.name}`.localeCompare(`${right.kind}:${right.name}`))
        .map(record => ({ id: record.id, kind: record.kind, name: record.name, archived: Boolean(record.archivedAt) }));
      return { revision: campaign.revision, entries };
    }
    if (queryInput.collection === 'current_scene') {
      if (!campaign.currentScene) return { revision: campaign.revision, scene: null };
      const records = new Map(campaign.records.map(record => [record.id, record]));
      return {
        revision: campaign.revision,
        scene: {
          ...clone(campaign.currentScene),
          place: clone(records.get(campaign.currentScene.placeId)) ?? null,
          presences: campaign.currentScene.presences.map(presence => ({
            presence: clone(presence),
            subject: clone(records.get(presence.subjectRef?.id))
              ?? clone(campaign.possessions.find(entry => entry.id === presence.subjectRef?.id))
              ?? null,
          })),
        },
      };
    }
    if (queryInput.collection === 'scene_archives') {
      const entries = [...(campaign.sceneArchives ?? [])]
        .sort((left, right) => String(right.closedAt ?? '').localeCompare(String(left.closedAt ?? '')))
        .map(clone);
      return { revision: campaign.revision, entries };
    }
    if (queryInput.collection === 'story_sync_proposals') {
      const statuses = Array.isArray(queryInput.statuses) ? new Set(queryInput.statuses) : null;
      const entries = [...(campaign.proposals ?? [])]
        .filter(proposal => !statuses || statuses.has(proposal.status))
        .sort((left, right) => String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? '')))
        .map(clone);
      return {
        revision: campaign.revision,
        syncBoundary: clone(campaign.syncBoundary),
        pendingReview: clone(campaign.pendingSyncReview),
        entries,
      };
    }
    if (queryInput.collection === 'context_capsule') {
      return { revision: campaign.revision, capsule: clone(verified.capsule) };
    }
    if (queryInput.collection === 'actors') {
      const entries = campaign.records
        .filter(record => record.kind === 'actor'
          && (queryInput.archived ? Boolean(record.archivedAt) : !record.archivedAt))
        .sort((left, right) => left.name.localeCompare(right.name))
        .map(clone);
      return { revision: campaign.revision, entries };
    }
    throw new CampaignValidationError(`Unknown Campaign collection: ${queryInput.collection ?? '(missing)'}.`);
  }

  function preview(operation) {
    const campaign = requireOpen();
    if (operation?.type === 'store_story_sync_draft') {
      const source = cleanStorySyncSource(operation.source);
      if (!Array.isArray(operation.proposals)) throw new CampaignValidationError('Story Sync proposals must be an array.');
      if (operation.proposals.length > 30) throw new CampaignValidationError('Story Sync can store at most 30 proposals per review.');
      operation.proposals.forEach((proposal, index) => cleanStorySyncProposal(proposal, `proposals.${index}`));
      const otherPending = (campaign.proposals ?? []).some(proposal => proposal.status === 'pending' && proposal.sourceIdentity !== source.identity);
      const otherEmptyReview = campaign.pendingSyncReview && campaign.pendingSyncReview.identity !== source.identity;
      if (otherPending || otherEmptyReview) {
        throw new CampaignConflictError('Finish or discard the existing Story Sync review before analyzing another range.');
      }
      return {
        summary: `Save ${operation.proposals.length} Story Sync proposal${operation.proposals.length === 1 ? '' : 's'} for review.`,
        affectedKinds: ['story_sync_proposal'],
      };
    }
    if (operation?.type === 'update_story_sync_proposal') {
      const existing = (campaign.proposals ?? []).find(proposal => proposal.id === operation.proposalId);
      if (!existing || existing.status !== 'pending') {
        throw new CampaignValidationError('Pending Story Sync proposal does not exist.', { proposalId: 'Reload the Review Inbox.' });
      }
      cleanStorySyncProposal({ ...existing, ...operation.changes });
      return { summary: `Update Story Sync proposal for ${existing.subject}.`, affectedKinds: ['story_sync_proposal'] };
    }
    if (operation?.type === 'accept_story_sync_proposal') {
      const proposal = (campaign.proposals ?? []).find(entry => entry.id === operation.proposalId);
      if (!proposal || proposal.status !== 'pending') {
        throw new CampaignValidationError('Pending Story Sync proposal does not exist.', { proposalId: 'Reload the Review Inbox.' });
      }
      const nested = preview(storySyncProposalOperation(campaign, proposal));
      return {
        summary: `Accept ${proposal.subject}: ${nested.summary}`,
        affectedKinds: ['story_sync_proposal', ...nested.affectedKinds],
      };
    }
    if (operation?.type === 'reject_story_sync_proposal') {
      const proposal = (campaign.proposals ?? []).find(entry => entry.id === operation.proposalId);
      if (!proposal || proposal.status !== 'pending') {
        throw new CampaignValidationError('Pending Story Sync proposal does not exist.', { proposalId: 'Reload the Review Inbox.' });
      }
      return { summary: `Reject Story Sync proposal for ${proposal.subject}.`, affectedKinds: ['story_sync_proposal'] };
    }
    if (operation?.type === 'discard_story_sync_review') {
      const pending = (campaign.proposals ?? []).filter(proposal => proposal.status === 'pending');
      if (!pending.length && !campaign.pendingSyncReview) throw new CampaignValidationError('There is no pending Story Sync review to discard.');
      return { summary: `Discard ${pending.length} pending Story Sync proposal${pending.length === 1 ? '' : 's'}.`, affectedKinds: ['story_sync_proposal'] };
    }
    if (operation?.type === 'complete_empty_story_sync_review') {
      cleanStorySyncSource(operation.source);
      return { summary: 'Mark this Story Sync range reviewed with no changes.', affectedKinds: ['sync_boundary'] };
    }
    if (operation?.type === 'set_context_policy') {
      const record = campaign.records.find(candidate => candidate.id === operation.recordId);
      if (!record) throw new CampaignValidationError('Context record does not exist.', { recordId: 'Reload Narrator Context.' });
      if (record.id === campaign.playerCharacterId) throw new CampaignValidationError('The Player Character is always included in narrator context.');
      const contextPolicy = cleanContextPolicy(operation.contextPolicy);
      return {
        summary: `${contextPolicy === 'pinned' ? 'Pin' : contextPolicy === 'excluded' ? 'Exclude' : 'Use automatic context for'} ${record.name}.`,
        affectedKinds: [record.kind, 'context_capsule'],
      };
    }
    if (operation?.type === 'sync_content_addons') {
      const bundle = normalizeAddonBundle(operation.bundle);
      const counts = {
        character: bundle.character ? 1 : 0,
        items: bundle.items.length,
        abilities: bundle.abilities.length,
        people: bundle.people.length,
        relationships: bundle.relationships.length,
        quests: bundle.quests.length,
        facts: bundle.facts.length,
        places: bundle.places.length,
        worldObjects: bundle.worldObjects.length,
        scene: bundle.scene ? 1 : 0,
      };
      if (bundle.scene && campaign.currentScene?.externalKey !== undefined
        && campaign.currentScene.externalKey !== `scene:${bundle.scene.externalId}`) {
        throw new CampaignValidationError('A different Current Scene is already open. Advance or close it before syncing another Scene.');
      }
      if (bundle.scene && campaign.currentScene && !campaign.currentScene.externalKey) {
        throw new CampaignValidationError('A non-addon Current Scene is already open. Advance or close it before syncing an addon Scene.');
      }
      const affectedKinds = Object.entries(counts).filter(([, count]) => count > 0).map(([kind]) => kind);
      const countText = Object.entries(counts)
        .filter(([, count]) => count > 0)
        .map(([kind, count]) => `${count} ${kind}`)
        .join(', ');
      return {
        summary: `Sync JSON addons: ${countText || 'no content'}.`,
        affectedKinds,
        addonCounts: counts,
      };
    }
    if (operation?.type === 'create_item_and_possession') {
      const name = requiredText(operation.item?.name, 'item.name', 'Item name');
      const owner = campaign.records.find(record => record.id === operation.possession?.ownerActorId && record.kind === 'actor');
      if (!owner) throw new CampaignValidationError('Possession owner does not exist.', { 'possession.ownerActorId': 'Choose an existing Actor.' });
      const quantity = positiveInteger(operation.possession?.quantity, 'possession.quantity');
      return {
        summary: `Create ${name} and add it to ${owner.name}’s Inventory ×${quantity}.`,
        affectedKinds: ['item', 'possession'],
      };
    }
    if (operation?.type === 'add_existing_item_to_inventory') {
      const item = campaign.records.find(record => record.id === operation.itemId && record.kind === 'item' && !record.archivedAt);
      const owner = campaign.records.find(record => record.id === operation.possession?.ownerActorId && record.kind === 'actor' && !record.archivedAt);
      if (!item) throw new CampaignValidationError('Item definition does not exist.', { itemId: 'Choose an active Item.' });
      if (!owner) throw new CampaignValidationError('Possession owner does not exist.', { 'possession.ownerActorId': 'Choose an active Actor.' });
      positiveInteger(operation.possession?.quantity ?? 1, 'possession.quantity');
      return { summary: `Add existing ${item.name} to ${owner.name}'s Inventory.`, affectedKinds: ['possession'] };
    }
    if (operation?.type === 'create_ability_and_learned_ability') {
      const name = requiredText(operation.ability?.name, 'ability.name', 'Ability name');
      const actor = campaign.records.find(record => record.id === operation.learnedAbility?.actorId && record.kind === 'actor');
      if (!actor) throw new CampaignValidationError('Ability learner does not exist.', { 'learnedAbility.actorId': 'Choose an existing Actor.' });
      return {
        summary: `Create ${name} and add it to ${actor.name}'s Abilities.`,
        affectedKinds: ['ability', 'learned_ability'],
      };
    }
    if (operation?.type === 'learn_existing_ability') {
      const ability = campaign.records.find(record => record.id === operation.abilityId && record.kind === 'ability' && !record.archivedAt);
      const actor = campaign.records.find(record => record.id === operation.learnedAbility?.actorId && record.kind === 'actor' && !record.archivedAt);
      if (!ability) throw new CampaignValidationError('Ability definition does not exist.', { abilityId: 'Choose an active Ability.' });
      if (!actor) throw new CampaignValidationError('Ability learner does not exist.', { 'learnedAbility.actorId': 'Choose an active Actor.' });
      return { summary: `Add existing ${ability.name} to ${actor.name}'s Abilities.`, affectedKinds: ['learned_ability'] };
    }
    if (operation?.type === 'update_possession') {
      const possession = campaign.possessions.find(entry => entry.id === operation.possessionId);
      if (!possession) throw new CampaignValidationError('Possession does not exist.', { possessionId: 'Choose an existing Possession.' });
      const item = campaign.records.find(record => record.id === possession.itemId);
      return {
        summary: `Update ${item?.name ?? 'Inventory entry'}.`,
        affectedKinds: ['possession'],
      };
    }
    if (operation?.type === 'update_learned_ability') {
      const learnedAbility = campaign.learnedAbilities.find(entry => entry.id === operation.learnedAbilityId);
      if (!learnedAbility) throw new CampaignValidationError('Learned Ability does not exist.', { learnedAbilityId: 'Choose an existing Learned Ability.' });
      const ability = campaign.records.find(record => record.id === learnedAbility.abilityId && record.kind === 'ability');
      return {
        summary: `Update ${ability?.name ?? 'Learned Ability'}.`,
        affectedKinds: ['learned_ability'],
      };
    }
    if (operation?.type === 'update_inventory_entry') {
      const item = campaign.records.find(record => record.id === operation.itemId && record.kind === 'item');
      const possession = campaign.possessions.find(entry => entry.id === operation.possessionId);
      if (!item) throw new CampaignValidationError('Item does not exist.', { itemId: 'Choose an existing Item.' });
      if (!possession || possession.itemId !== item.id) {
        throw new CampaignValidationError('Possession does not refer to this Item.', { possessionId: 'Choose the matching Possession.' });
      }
      if ('name' in (operation.itemChanges ?? {})) requiredText(operation.itemChanges.name, 'item.name', 'Item name');
      return {
        summary: `Update ${item.name} and its Inventory state.`,
        affectedKinds: ['item', 'possession'],
      };
    }
    if (operation?.type === 'update_ability_entry') {
      const ability = campaign.records.find(record => record.id === operation.abilityId && record.kind === 'ability');
      const learnedAbility = campaign.learnedAbilities.find(entry => entry.id === operation.learnedAbilityId);
      if (!ability) throw new CampaignValidationError('Ability does not exist.', { abilityId: 'Choose an existing Ability.' });
      if (!learnedAbility || learnedAbility.abilityId !== ability.id) {
        throw new CampaignValidationError('Learned Ability does not refer to this Ability.', {
          learnedAbilityId: 'Choose the matching Learned Ability.',
        });
      }
      if ('name' in (operation.abilityChanges ?? {})) requiredText(operation.abilityChanges.name, 'ability.name', 'Ability name');
      return {
        summary: `Update ${ability.name} and its learned state.`,
        affectedKinds: ['ability', 'learned_ability'],
      };
    }
    if (operation?.type === 'create_actor') {
      const name = requiredText(operation.actor?.name, 'actor.name', 'Actor name');
      return {
        summary: `Create NPC ${name}.`,
        affectedKinds: ['actor'],
      };
    }
    if (operation?.type === 'update_actor') {
      const actor = campaign.records.find(record => record.id === operation.actorId && record.kind === 'actor');
      if (!actor) throw new CampaignValidationError('Actor does not exist.', { actorId: 'Choose an existing Actor.' });
      if ('name' in (operation.changes ?? {})) requiredText(operation.changes.name, 'actor.name', 'Actor name');
      if ('meters' in (operation.changes ?? {})) cleanEditableMeters(operation.changes.meters, 'actor.meters');
      return {
        summary: `Update ${actor.name}.`,
        affectedKinds: ['actor'],
      };
    }
    if (operation?.type === 'create_quest') {
      const quest = cleanQuestPayload(operation.quest, campaign);
      return { summary: `Create Objective ${quest.name}.`, affectedKinds: ['quest'] };
    }
    if (operation?.type === 'update_quest') {
      const existing = campaign.records.find(record => record.id === operation.questId && record.kind === 'quest');
      if (!existing) throw new CampaignValidationError('Quest does not exist.', { questId: 'Choose an existing Objective.' });
      const quest = cleanQuestPayload(operation.quest, campaign);
      const existingStepIds = new Set((existing.steps ?? []).map(step => step.id));
      for (const step of quest.steps) {
        if (step.id && !existingStepIds.has(step.id)) {
          throw new CampaignValidationError('Quest Step does not belong to this Objective.', {
            'quest.steps': 'Reload the Objective and retry.',
          });
        }
      }
      return { summary: `Update ${existing.name}.`, affectedKinds: ['quest'] };
    }
    if (operation?.type === 'create_fact' || operation?.type === 'update_fact') {
      const existing = operation.type === 'update_fact'
        ? campaign.records.find(record => record.id === operation.factId && record.kind === 'fact')
        : null;
      if (operation.type === 'update_fact' && !existing) {
        throw new CampaignValidationError('Fact does not exist.', { factId: 'Choose an existing Fact.' });
      }
      const fact = cleanFactPayload(operation.fact, campaign);
      return {
        summary: `${existing ? 'Update' : 'Create'} Fact ${existing?.name ?? fact.name}.`,
        affectedKinds: ['fact'],
      };
    }
    if (operation?.type === 'create_place' || operation?.type === 'update_place') {
      const existing = operation.type === 'update_place'
        ? campaign.records.find(record => record.id === operation.placeId && record.kind === 'place')
        : null;
      if (operation.type === 'update_place' && !existing) {
        throw new CampaignValidationError('Place does not exist.', { placeId: 'Choose an existing Place.' });
      }
      const place = cleanPlacePayload(operation.place, campaign);
      if (existing && placeParentCreatesCycle(campaign, existing.id, place.parentPlaceId)) {
        throw new CampaignValidationError('A Place cannot contain itself through its parent chain.', {
          'place.parentPlaceId': 'Choose a Place outside this parent chain.',
        });
      }
      if (existing && place.connections.some(connection => connection.targetPlaceId === existing.id)) {
        throw new CampaignValidationError('A Place cannot connect to itself.', {
          'place.connections': 'Choose another destination Place.',
        });
      }
      const existingConnectionIds = new Set((existing?.connections ?? []).map(connection => connection.id));
      for (const connection of place.connections) {
        if (connection.id && !existingConnectionIds.has(connection.id)) {
          throw new CampaignValidationError('Place Connection does not belong to this Place.', {
            'place.connections': 'Reload the Place and retry.',
          });
        }
      }
      return {
        summary: `${existing ? 'Update' : 'Create'} Place ${existing?.name ?? place.name}.`,
        affectedKinds: ['place'],
      };
    }
    if (operation?.type === 'create_world_object' || operation?.type === 'update_world_object') {
      const existing = operation.type === 'update_world_object'
        ? campaign.records.find(record => record.id === operation.worldObjectId && record.kind === 'world_object')
        : null;
      if (operation.type === 'update_world_object' && !existing) {
        throw new CampaignValidationError('World Object does not exist.', { worldObjectId: 'Choose an existing World Object.' });
      }
      const worldObject = cleanWorldObjectPayload(operation.worldObject, campaign);
      return {
        summary: `${existing ? 'Update' : 'Create'} World Object ${existing?.name ?? worldObject.name}.`,
        affectedKinds: ['world_object'],
      };
    }
    if (operation?.type === 'create_current_scene') {
      if (campaign.currentScene) throw new CampaignValidationError('A Current Scene is already open. Advance it instead.');
      const scene = cleanScenePayload(operation.scene, campaign);
      return { summary: `Open Scene ${scene.title}.`, affectedKinds: ['scene'] };
    }
    if (operation?.type === 'update_current_scene') {
      const currentScene = campaign.currentScene;
      if (!currentScene || currentScene.id !== operation.sceneId) {
        throw new CampaignValidationError('Current Scene does not exist.', { sceneId: 'Reload the Current Scene.' });
      }
      const scene = cleanScenePayload(operation.scene, campaign);
      for (const collection of ['presences', 'exits', 'obstacles', 'countdowns', 'openThreads']) {
        const existingIds = new Set((currentScene[collection] ?? []).map(entry => entry.id));
        if (scene[collection].some(entry => entry.id && !existingIds.has(entry.id))) {
          throw new CampaignValidationError(`A ${collection} entry does not belong to the Current Scene.`, {
            [`scene.${collection}`]: 'Reload the Current Scene and retry.',
          });
        }
      }
      return { summary: `Update Scene ${currentScene.title}.`, affectedKinds: ['scene'] };
    }
    if (operation?.type === 'advance_scene') {
      const currentScene = campaign.currentScene;
      if (!currentScene || currentScene.id !== operation.sceneId) {
        throw new CampaignValidationError('Current Scene does not exist.', { sceneId: 'Reload the Current Scene.' });
      }
      const nextScene = cleanScenePayload(operation.nextScene, campaign, 'nextScene');
      if (!Array.isArray(operation.carryThreadIds ?? [])) {
        throw new CampaignValidationError('carryThreadIds must be an array.');
      }
      const carryable = new Set((currentScene.openThreads ?? [])
        .filter(thread => ['open', 'carried'].includes(thread.status))
        .map(thread => thread.id));
      for (const threadId of operation.carryThreadIds ?? []) {
        if (!carryable.has(threadId)) {
          throw new CampaignValidationError('A selected Scene Thread cannot be carried forward.', {
            carryThreadIds: 'Select only unresolved threads from the Current Scene.',
          });
        }
      }
      return {
        summary: `Close ${currentScene.title} and open ${nextScene.title}.`,
        affectedKinds: ['scene_archive', 'scene'],
      };
    }
    if (operation?.type === 'create_relationship') {
      const source = campaign.records.find(record => record.id === operation.relationship?.sourceActorId && record.kind === 'actor');
      const target = campaign.records.find(record => record.id === operation.relationship?.targetActorId && record.kind === 'actor');
      if (!source) throw new CampaignValidationError('Relationship source does not exist.', { 'relationship.sourceActorId': 'Choose an existing Actor.' });
      if (!target) throw new CampaignValidationError('Relationship target does not exist.', { 'relationship.targetActorId': 'Choose an existing Actor.' });
      if (source.id === target.id) throw new CampaignValidationError('A Relationship must connect two different Actors.', { 'relationship.targetActorId': 'Choose another Actor.' });
      requiredText(operation.relationship?.relationshipKind, 'relationship.relationshipKind', 'Relationship kind');
      return {
        summary: `Create ${source.name} -> ${target.name} Relationship.`,
        affectedKinds: ['relationship'],
      };
    }
    if (operation?.type === 'update_relationship') {
      const relationship = campaign.relationships.find(entry => entry.id === operation.relationshipId);
      if (!relationship) throw new CampaignValidationError('Relationship does not exist.', { relationshipId: 'Choose an existing Relationship.' });
      if ('relationshipKind' in (operation.changes ?? {})) {
        requiredText(operation.changes.relationshipKind, 'relationship.relationshipKind', 'Relationship kind');
      }
      return {
        summary: 'Update Relationship.',
        affectedKinds: ['relationship'],
      };
    }
    if (operation?.type === 'undo') {
      const entry = undoEntries.get(operation.token);
      if (!entry || entry.revision !== campaign.revision) {
        throw new CampaignConflictError('This Undo is no longer available because the Campaign revision changed.', {
          actualRevision: campaign.revision,
        });
      }
      return {
        summary: `Undo ${entry.impact}`,
        affectedKinds: clone(entry.affectedKinds),
      };
    }
    if (operation?.type === 'archive_possession' || operation?.type === 'restore_possession') {
      const possession = campaign.possessions.find(entry => entry.id === operation.possessionId);
      if (!possession) throw new CampaignValidationError('Possession does not exist.', { possessionId: 'Choose an existing Possession.' });
      const item = campaign.records.find(record => record.id === possession.itemId);
      if (operation.type === 'archive_possession' && possession.archivedAt) {
        throw new CampaignValidationError('Possession is already archived.');
      }
      if (operation.type === 'restore_possession' && !possession.archivedAt) {
        throw new CampaignValidationError('Possession is not archived.');
      }
      return {
        summary: `${operation.type === 'archive_possession' ? 'Archive' : 'Restore'} ${item?.name ?? 'Inventory entry'}.`,
        affectedKinds: ['possession'],
      };
    }
    if (operation?.type === 'archive_learned_ability' || operation?.type === 'restore_learned_ability') {
      const learnedAbility = campaign.learnedAbilities.find(entry => entry.id === operation.learnedAbilityId);
      if (!learnedAbility) throw new CampaignValidationError('Learned Ability does not exist.', { learnedAbilityId: 'Choose an existing Learned Ability.' });
      const ability = campaign.records.find(record => record.id === learnedAbility.abilityId && record.kind === 'ability');
      if (operation.type === 'archive_learned_ability' && learnedAbility.archivedAt) {
        throw new CampaignValidationError('Learned Ability is already archived.');
      }
      if (operation.type === 'restore_learned_ability' && !learnedAbility.archivedAt) {
        throw new CampaignValidationError('Learned Ability is not archived.');
      }
      return {
        summary: `${operation.type === 'archive_learned_ability' ? 'Archive' : 'Restore'} ${ability?.name ?? 'Learned Ability'}.`,
        affectedKinds: ['learned_ability'],
      };
    }
    if (operation?.type === 'archive_actor' || operation?.type === 'restore_actor') {
      const actor = campaign.records.find(record => record.id === operation.actorId && record.kind === 'actor');
      if (!actor) throw new CampaignValidationError('Actor does not exist.', { actorId: 'Choose an existing Actor.' });
      if (actor.id === campaign.playerCharacterId) throw new CampaignValidationError('The Player Character cannot be archived.');
      if (operation.type === 'archive_actor' && actor.archivedAt) throw new CampaignValidationError('Actor is already archived.');
      if (operation.type === 'restore_actor' && !actor.archivedAt) throw new CampaignValidationError('Actor is not archived.');
      return {
        summary: `${operation.type === 'archive_actor' ? 'Archive' : 'Restore'} ${actor.name}.`,
        affectedKinds: ['actor'],
      };
    }
    if (operation?.type === 'archive_relationship' || operation?.type === 'restore_relationship') {
      const relationship = campaign.relationships.find(entry => entry.id === operation.relationshipId);
      if (!relationship) throw new CampaignValidationError('Relationship does not exist.', { relationshipId: 'Choose an existing Relationship.' });
      if (operation.type === 'archive_relationship' && relationship.archivedAt) throw new CampaignValidationError('Relationship is already archived.');
      if (operation.type === 'restore_relationship' && !relationship.archivedAt) throw new CampaignValidationError('Relationship is not archived.');
      return {
        summary: `${operation.type === 'archive_relationship' ? 'Archive' : 'Restore'} Relationship.`,
        affectedKinds: ['relationship'],
      };
    }
    if (operation?.type === 'archive_quest' || operation?.type === 'restore_quest') {
      const quest = campaign.records.find(record => record.id === operation.questId && record.kind === 'quest');
      if (!quest) throw new CampaignValidationError('Quest does not exist.', { questId: 'Choose an existing Objective.' });
      if (operation.type === 'archive_quest' && quest.archivedAt) throw new CampaignValidationError('Quest is already archived.');
      if (operation.type === 'restore_quest' && !quest.archivedAt) throw new CampaignValidationError('Quest is not archived.');
      return {
        summary: `${operation.type === 'archive_quest' ? 'Archive' : 'Restore'} ${quest.name}.`,
        affectedKinds: ['quest'],
      };
    }
    if (operation?.type === 'archive_world_record' || operation?.type === 'restore_world_record') {
      const allowedKinds = new Set(['fact', 'place', 'world_object']);
      const record = campaign.records.find(entry => entry.id === operation.recordId && allowedKinds.has(entry.kind));
      if (!record) throw new CampaignValidationError('World record does not exist.', { recordId: 'Choose an existing World record.' });
      if (operation.type === 'archive_world_record' && record.archivedAt) throw new CampaignValidationError('World record is already archived.');
      if (operation.type === 'restore_world_record' && !record.archivedAt) throw new CampaignValidationError('World record is not archived.');
      return {
        summary: `${operation.type === 'archive_world_record' ? 'Archive' : 'Restore'} ${record.name}.`,
        affectedKinds: [record.kind],
      };
    }
    if (operation?.type === 'delete_inventory_entry') {
      const possession = campaign.possessions.find(entry => entry.id === operation.possessionId);
      const item = campaign.records.find(record => record.id === operation.itemId && record.kind === 'item');
      if (!possession || !item || possession.itemId !== item.id) {
        throw new CampaignValidationError('Inventory entry does not exist.', { possessionId: 'Choose an existing Inventory entry.' });
      }
      if (!possession.archivedAt) {
        throw new CampaignValidationError('Archive this Inventory entry before permanently deleting it.');
      }
      requireNoInboundReferences(campaign, possession.id, 'possessionId', item.name);
      const itemStillReferenced = createCampaignReferenceGraph(campaign)
        .inbound(item.id, { excludeSourceIds: [possession.id] }).length > 0;
      return {
        summary: `Permanently delete ${item.name}${itemStillReferenced ? ' from this Inventory' : ' and its unreferenced Item definition'}.`,
        affectedKinds: itemStillReferenced ? ['possession'] : ['item', 'possession'],
      };
    }
    if (operation?.type === 'delete_ability_entry') {
      const learnedAbility = campaign.learnedAbilities.find(entry => entry.id === operation.learnedAbilityId);
      const ability = campaign.records.find(record => record.id === operation.abilityId && record.kind === 'ability');
      if (!learnedAbility || !ability || learnedAbility.abilityId !== ability.id) {
        throw new CampaignValidationError('Ability entry does not exist.', { learnedAbilityId: 'Choose an existing Ability entry.' });
      }
      if (!learnedAbility.archivedAt) {
        throw new CampaignValidationError('Archive this Ability entry before permanently deleting it.');
      }
      requireNoInboundReferences(campaign, learnedAbility.id, 'learnedAbilityId', ability.name);
      const abilityStillReferenced = createCampaignReferenceGraph(campaign)
        .inbound(ability.id, { excludeSourceIds: [learnedAbility.id] }).length > 0;
      return {
        summary: `Permanently delete ${ability.name}${abilityStillReferenced ? ' from this Actor' : ' and its unreferenced Ability definition'}.`,
        affectedKinds: abilityStillReferenced ? ['learned_ability'] : ['ability', 'learned_ability'],
      };
    }
    if (operation?.type === 'delete_relationship') {
      const relationship = campaign.relationships.find(entry => entry.id === operation.relationshipId);
      if (!relationship) throw new CampaignValidationError('Relationship does not exist.', { relationshipId: 'Choose an existing Relationship.' });
      if (!relationship.archivedAt) throw new CampaignValidationError('Archive this Relationship before permanently deleting it.');
      return { summary: 'Permanently delete Relationship.', affectedKinds: ['relationship'] };
    }
    if (operation?.type === 'delete_actor') {
      const actor = campaign.records.find(record => record.id === operation.actorId && record.kind === 'actor');
      if (!actor) throw new CampaignValidationError('Actor does not exist.', { actorId: 'Choose an existing Actor.' });
      if (actor.id === campaign.playerCharacterId) throw new CampaignValidationError('The Player Character cannot be deleted.');
      if (!actor.archivedAt) throw new CampaignValidationError('Archive this Actor before permanently deleting it.');
      requireNoInboundReferences(campaign, actor.id, 'actorId', actor.name);
      return { summary: `Permanently delete ${actor.name}.`, affectedKinds: ['actor'] };
    }
    if (operation?.type === 'delete_quest') {
      const quest = campaign.records.find(record => record.id === operation.questId && record.kind === 'quest');
      if (!quest) throw new CampaignValidationError('Quest does not exist.', { questId: 'Choose an existing Objective.' });
      if (!quest.archivedAt) throw new CampaignValidationError('Archive this Objective before permanently deleting it.');
      requireNoInboundReferences(campaign, quest.id, 'questId', quest.name);
      return { summary: `Permanently delete ${quest.name}.`, affectedKinds: ['quest'] };
    }
    if (operation?.type === 'delete_world_record') {
      const allowedKinds = new Set(['fact', 'place', 'world_object']);
      const record = campaign.records.find(entry => entry.id === operation.recordId && allowedKinds.has(entry.kind));
      if (!record) throw new CampaignValidationError('World record does not exist.', { recordId: 'Choose an existing World record.' });
      if (!record.archivedAt) throw new CampaignValidationError('Archive this World record before permanently deleting it.');
      requireNoInboundReferences(campaign, record.id, 'recordId', record.name);
      return { summary: `Permanently delete ${record.name}.`, affectedKinds: [record.kind] };
    }
    throw new CampaignValidationError(`Unsupported Campaign Operation: ${operation?.type ?? '(missing)'}.`);
  }

  async function execute(operation, expectedRevision) {
    const current = requireOpen();
    if (current.revision !== expectedRevision) {
      throw new CampaignConflictError(`Campaign is at revision ${current.revision}, not ${expectedRevision}.`, {
        expectedRevision,
        actualRevision: current.revision,
      });
    }

    const requestedOperation = operation;
    let acceptedProposal = null;
    const impact = preview(requestedOperation);
    if (requestedOperation.type === 'accept_story_sync_proposal') {
      acceptedProposal = (current.proposals ?? []).find(proposal => proposal.id === requestedOperation.proposalId) ?? null;
      operation = storySyncProposalOperation(current, acceptedProposal);
    }
    if (operation.type === 'undo') {
      const undoEntry = undoEntries.get(operation.token);
      const candidate = clone(undoEntry.beforeCampaign);
      const changedAt = now();
      const nextRevision = current.revision + 1;
      candidate.revision = nextRevision;
      candidate.commitId = createId('commit');
      for (const record of candidate.records) {
        if (!undoEntry.affectedIds.includes(record.id)) continue;
        record.updatedAt = changedAt;
        record.updatedRevision = nextRevision;
      }
      for (const possession of candidate.possessions) {
        if (!undoEntry.affectedIds.includes(possession.id)) continue;
        possession.updatedAt = changedAt;
        possession.updatedRevision = nextRevision;
      }
      for (const learnedAbility of candidate.learnedAbilities) {
        if (!undoEntry.affectedIds.includes(learnedAbility.id)) continue;
        learnedAbility.updatedAt = changedAt;
        learnedAbility.updatedRevision = nextRevision;
      }
      for (const relationship of candidate.relationships) {
        if (!undoEntry.affectedIds.includes(relationship.id)) continue;
        relationship.updatedAt = changedAt;
        relationship.updatedRevision = nextRevision;
      }
      if (candidate.currentScene) {
        const sceneEntries = [
          candidate.currentScene,
          ...candidate.currentScene.presences,
          ...candidate.currentScene.exits,
          ...candidate.currentScene.obstacles,
          ...candidate.currentScene.countdowns,
          ...candidate.currentScene.openThreads,
        ];
        for (const entry of sceneEntries) {
          if (!undoEntry.affectedIds.includes(entry.id)) continue;
          entry.updatedAt = changedAt;
          entry.updatedRevision = nextRevision;
        }
      }
      candidate.events = [
        ...clone(current.events),
        {
          id: createId('event'),
          type: 'undo',
          revision: nextRevision,
          affectedIds: clone(undoEntry.affectedIds),
          createdAt: changedAt,
        },
      ];
      const candidateEnvelope = makeEnvelope(candidate);
      const committed = await storage.commit(binding, candidateEnvelope, current.commitId);
      verified = clone(committed);
      undoEntries.clear();
      const result = {
        revision: nextRevision,
        commitId: candidate.commitId,
        affectedIds: clone(undoEntry.affectedIds),
        affectedKinds: clone(undoEntry.affectedKinds),
        impact: impact.summary,
        undoEligible: false,
        undoToken: null,
        capsule: candidateEnvelope.capsule.text,
        refreshHints: ['character', 'inventory', 'abilities', 'people', 'objectives', 'world', 'current_scene'],
      };
      for (const listener of listeners) listener(clone(result));
      return result;
    }

    const beforeCampaign = clone(current);
    const candidate = clone(current);
    const changedAt = now();
    const nextRevision = current.revision + 1;
    const affectedIds = [];
    const replaceEditableNested = (existing, rows, idKind, assign) => {
      const existingRows = Array.isArray(existing) ? existing : [];
      const byId = new Map(existingRows.map(entry => [entry.id, entry]));
      const retainedIds = new Set();
      const nextRows = rows.map(row => {
        let entry = row.id ? byId.get(row.id) : null;
        if (!entry) {
          entry = {
            id: createId(idKind),
            kind: idKind,
            createdAt: changedAt,
            createdRevision: nextRevision,
          };
        }
        Object.assign(entry, assign(row), {
          updatedAt: changedAt,
          updatedRevision: nextRevision,
          archivedAt: null,
        });
        retainedIds.add(entry.id);
        affectedIds.push(entry.id);
        return entry;
      });
      for (const previous of existingRows) {
        if (!retainedIds.has(previous.id)) affectedIds.push(previous.id);
      }
      return nextRows;
    };
    const applyScenePayload = (scene, payload) => {
      Object.assign(scene, {
        title: payload.title,
        summary: payload.summary,
        placeId: payload.placeId,
        transitionNotes: payload.transitionNotes,
        updatedAt: changedAt,
        updatedRevision: nextRevision,
        archivedAt: null,
      });
      scene.presences = replaceEditableNested(scene.presences, payload.presences, 'scene-presence', presence => ({
        subjectRef: presence.subjectRef,
        role: presence.role,
        state: presence.state,
        notes: presence.notes,
      }));
      scene.exits = replaceEditableNested(scene.exits, payload.exits, 'scene-exit', exit => ({
        label: exit.label,
        destinationPlaceId: exit.destinationPlaceId,
        status: exit.status,
        notes: exit.notes,
      }));
      scene.obstacles = replaceEditableNested(scene.obstacles, payload.obstacles, 'scene-obstacle', obstacle => ({
        label: obstacle.label,
        status: obstacle.status,
        notes: obstacle.notes,
      }));
      scene.countdowns = replaceEditableNested(scene.countdowns, payload.countdowns, 'scene-countdown', countdown => ({
        label: countdown.label,
        current: countdown.current,
        max: countdown.max,
        notes: countdown.notes,
      }));
      scene.openThreads = replaceEditableNested(scene.openThreads, payload.openThreads, 'scene-thread', thread => ({
        label: thread.label,
        status: thread.status,
        notes: thread.notes,
        carriedFromThreadId: thread.carriedFromThreadId ?? null,
      }));
      affectedIds.push(scene.id);
      return scene;
    };
    const advanceBoundaryWhenReviewed = sourceIdentity => {
      const batch = (candidate.proposals ?? []).filter(proposal => proposal.sourceIdentity === sourceIdentity);
      if (!batch.length || batch.some(proposal => proposal.status === 'pending')) return;
      const latest = batch.reduce((currentLatest, proposal) => (
        proposal.sourceLastMessageIndex > currentLatest.sourceLastMessageIndex ? proposal : currentLatest
      ));
      candidate.syncBoundary = {
        messageIndex: latest.sourceLastMessageIndex,
        sourceIdentity,
        reviewedAt: changedAt,
      };
      candidate.pendingSyncReview = null;
    };

    if (operation.type === 'store_story_sync_draft') {
      const source = cleanStorySyncSource(operation.source);
      const retained = (candidate.proposals ?? [])
        .filter(proposal => proposal.status !== 'pending' && proposal.sourceIdentity !== source.identity)
        .slice(-70);
      const stored = operation.proposals.map((proposal, index) => ({
        id: createId('proposal'),
        kind: 'story_sync_proposal',
        ...cleanStorySyncProposal(proposal, `proposals.${index}`),
        sourceIdentity: source.identity,
        sourceChatId: source.chatId,
        sourceFirstMessageIndex: source.firstMessageIndex,
        sourceLastMessageIndex: source.lastMessageIndex,
        sourceRemainingMessages: source.remainingMessages,
        status: 'pending',
        createdAt: changedAt,
        updatedAt: changedAt,
        createdRevision: nextRevision,
        updatedRevision: nextRevision,
        reviewedAt: null,
        appliedIds: [],
      }));
      candidate.proposals = [...retained, ...stored];
      candidate.pendingSyncReview = source;
      affectedIds.push(...stored.map(proposal => proposal.id));
    }

    if (operation.type === 'update_story_sync_proposal') {
      const proposal = candidate.proposals.find(entry => entry.id === operation.proposalId);
      Object.assign(proposal, cleanStorySyncProposal({ ...proposal, ...operation.changes }), {
        updatedAt: changedAt,
        updatedRevision: nextRevision,
      });
      affectedIds.push(proposal.id);
    }

    if (operation.type === 'reject_story_sync_proposal') {
      const proposal = candidate.proposals.find(entry => entry.id === operation.proposalId);
      proposal.status = 'rejected';
      proposal.reviewedAt = changedAt;
      proposal.updatedAt = changedAt;
      proposal.updatedRevision = nextRevision;
      affectedIds.push(proposal.id);
      advanceBoundaryWhenReviewed(proposal.sourceIdentity);
    }

    if (operation.type === 'discard_story_sync_review') {
      const discarded = candidate.proposals.filter(proposal => proposal.status === 'pending');
      candidate.proposals = candidate.proposals.filter(proposal => proposal.status !== 'pending');
      candidate.pendingSyncReview = null;
      affectedIds.push(...discarded.map(proposal => proposal.id));
    }

    if (operation.type === 'complete_empty_story_sync_review') {
      const source = cleanStorySyncSource(operation.source);
      candidate.syncBoundary = {
        messageIndex: source.lastMessageIndex,
        sourceIdentity: source.identity,
        reviewedAt: changedAt,
      };
      candidate.pendingSyncReview = null;
    }

    if (operation.type === 'set_context_policy') {
      const record = candidate.records.find(entry => entry.id === operation.recordId);
      record.contextPolicy = cleanContextPolicy(operation.contextPolicy);
      record.updatedAt = changedAt;
      record.updatedRevision = nextRevision;
      affectedIds.push(record.id);
    }

    if (operation.type === 'sync_content_addons') {
      const bundle = normalizeAddonBundle(operation.bundle);
      const finishRecord = record => {
        record.updatedAt = changedAt;
        record.updatedRevision = nextRevision;
        record.archivedAt = null;
        affectedIds.push(record.id);
      };
      const newRecordMetadata = () => ({
        createdAt: changedAt,
        updatedAt: changedAt,
        createdRevision: nextRevision,
        updatedRevision: nextRevision,
        archivedAt: null,
      });
      const externalReferenceIds = new Map();
      const rememberReference = (kind, externalId, id) => externalReferenceIds.set(`${kind}:${externalId}`, id);
      const resolveReference = reference => {
        if (!reference) return null;
        if (reference.kind === 'actor' && reference.externalId === '$player') {
          return { kind: 'actor', id: candidate.playerCharacterId };
        }
        const id = externalReferenceIds.get(`${reference.kind}:${reference.externalId}`);
        if (!id) throw new CampaignValidationError(`Addon reference could not resolve ${reference.kind}:${reference.externalId}.`);
        return { kind: reference.kind, id };
      };
      const syncEmbedded = (existing, addons, idKind, assign) => {
        const currentEntries = Array.isArray(existing) ? existing : [];
        const byExternalKey = new Map(currentEntries.filter(entry => entry.externalKey).map(entry => [entry.externalKey, entry]));
        const synced = [];
        const used = new Set();
        for (const addon of addons) {
          const externalKey = `${idKind}:${addon.externalId}`;
          let entry = byExternalKey.get(externalKey);
          if (!entry) entry = { id: createId(idKind), externalKey, ...newRecordMetadata() };
          Object.assign(entry, assign(addon), {
            externalKey,
            updatedAt: changedAt,
            updatedRevision: nextRevision,
            archivedAt: null,
          });
          synced.push(entry);
          used.add(entry.id);
          affectedIds.push(entry.id);
        }
        for (const entry of currentEntries) if (!used.has(entry.id)) synced.push(entry);
        return synced;
      };

      if (bundle.character) {
        const actor = candidate.records.find(record => record.id === candidate.playerCharacterId && record.kind === 'actor');
        Object.assign(actor, {
          externalKey: 'actor:$player',
          externalSource: bundle.character.sourceFile,
          role: 'player_character',
          name: bundle.character.name,
          aliases: bundle.character.aliases,
          pronouns: bundle.character.pronouns,
          summary: bundle.character.summary,
          details: bundle.character.details,
          category: bundle.character.category,
          tags: bundle.character.tags,
          appearance: bundle.character.appearance,
          personality: bundle.character.personality,
          goals: bundle.character.goals,
          voiceNotes: bundle.character.voiceNotes,
          conditions: bundle.character.conditions,
          contextPolicy: bundle.character.contextPolicy,
        });
        actor.meters = syncEmbedded(actor.meters, bundle.character.meters, 'meter', meter => ({
          label: meter.label,
          current: meter.current,
          max: meter.max,
          notes: meter.notes,
        }));
        finishRecord(actor);
      }

      for (const addon of bundle.items) {
        const externalKey = `item:${addon.externalId}`;
        let item = candidate.records.find(record => record.kind === 'item' && record.externalKey === externalKey);
        if (!item) {
          item = { id: createId('item'), kind: 'item', ...newRecordMetadata() };
          candidate.records.push(item);
        }
        Object.assign(item, {
          externalKey,
          externalSource: addon.sourceFile,
          name: addon.name,
          summary: addon.summary,
          details: addon.details,
          category: addon.category,
          tags: addon.tags,
          portable: true,
          unique: false,
          defaultEquipmentSlots: addon.equippedSlots,
          contextPolicy: addon.contextPolicy,
        });
        finishRecord(item);
        rememberReference('item', addon.externalId, item.id);

        let possession = candidate.possessions.find(entry => entry.externalKey === externalKey);
        if (!possession) {
          possession = { id: createId('possession'), kind: 'possession', ...newRecordMetadata() };
          candidate.possessions.push(possession);
        }
        Object.assign(possession, {
          externalKey,
          externalSource: addon.sourceFile,
          ownerActorId: candidate.playerCharacterId,
          itemId: item.id,
          quantity: addon.quantity,
          carriedState: addon.carriedState,
          equippedSlots: addon.equippedSlots,
          label: '',
          condition: addon.condition,
          notes: addon.notes,
          updatedAt: changedAt,
          updatedRevision: nextRevision,
          archivedAt: null,
        });
        affectedIds.push(possession.id);
        rememberReference('possession', addon.externalId, possession.id);
      }

      for (const addon of bundle.abilities) {
        const externalKey = `ability:${addon.externalId}`;
        let ability = candidate.records.find(record => record.kind === 'ability' && record.externalKey === externalKey);
        if (!ability) {
          ability = { id: createId('ability'), kind: 'ability', ...newRecordMetadata() };
          candidate.records.push(ability);
        }
        Object.assign(ability, {
          externalKey,
          externalSource: addon.sourceFile,
          name: addon.name,
          summary: addon.summary,
          details: addon.details,
          category: addon.category,
          tags: addon.tags,
          usage: addon.usage,
          limits: addon.limits,
          defaultResourceLabel: addon.defaultResourceLabel,
          contextPolicy: addon.contextPolicy,
        });
        finishRecord(ability);
        rememberReference('ability', addon.externalId, ability.id);

        let learnedAbility = candidate.learnedAbilities.find(entry => entry.externalKey === externalKey);
        if (!learnedAbility) {
          learnedAbility = { id: createId('learned-ability'), kind: 'learned_ability', ...newRecordMetadata() };
          candidate.learnedAbilities.push(learnedAbility);
        }
        Object.assign(learnedAbility, {
          externalKey,
          externalSource: addon.sourceFile,
          actorId: candidate.playerCharacterId,
          abilityId: ability.id,
          accessState: addon.accessState,
          currentUses: addon.currentUses,
          maxUses: addon.maxUses,
          notes: addon.notes,
          updatedAt: changedAt,
          updatedRevision: nextRevision,
          archivedAt: null,
        });
        affectedIds.push(learnedAbility.id);
      }

      const externalActors = new Map();
      for (const addon of bundle.people) {
        const externalKey = `actor:${addon.externalId}`;
        let actor = candidate.records.find(record => record.kind === 'actor' && record.externalKey === externalKey);
        if (!actor) {
          actor = { id: createId('actor'), kind: 'actor', role: 'npc', ...newRecordMetadata() };
          candidate.records.push(actor);
        }
        Object.assign(actor, {
          externalKey,
          externalSource: addon.sourceFile,
          role: 'npc',
          name: addon.name,
          aliases: addon.aliases,
          pronouns: addon.pronouns,
          summary: addon.summary,
          details: addon.details,
          category: addon.category,
          tags: addon.tags,
          appearance: addon.appearance,
          personality: addon.personality,
          goals: addon.goals,
          voiceNotes: addon.voiceNotes,
          conditions: addon.conditions,
          meters: actor.meters ?? [],
          contextPolicy: addon.contextPolicy,
        });
        actor.meters = syncEmbedded(actor.meters, addon.meters, 'meter', meter => ({
          label: meter.label,
          current: meter.current,
          max: meter.max,
          notes: meter.notes,
        }));
        finishRecord(actor);
        externalActors.set(addon.externalId, actor.id);
        rememberReference('actor', addon.externalId, actor.id);
      }

      const placeByExternalId = new Map();
      for (const addon of bundle.places) {
        const externalKey = `place:${addon.externalId}`;
        let place = candidate.records.find(record => record.kind === 'place' && record.externalKey === externalKey);
        if (!place) {
          place = { id: createId('place'), kind: 'place', connections: [], ...newRecordMetadata() };
          candidate.records.push(place);
        }
        Object.assign(place, {
          externalKey,
          externalSource: addon.sourceFile,
          name: addon.name,
          summary: addon.summary,
          details: addon.details,
          category: addon.category,
          tags: addon.tags,
          atmosphere: addon.atmosphere,
          contextPolicy: addon.contextPolicy,
        });
        finishRecord(place);
        placeByExternalId.set(addon.externalId, place);
        rememberReference('place', addon.externalId, place.id);
      }

      const worldObjectByExternalId = new Map();
      for (const addon of bundle.worldObjects) {
        const externalKey = `world_object:${addon.externalId}`;
        let worldObject = candidate.records.find(record => record.kind === 'world_object' && record.externalKey === externalKey);
        if (!worldObject) {
          worldObject = { id: createId('world-object'), kind: 'world_object', ...newRecordMetadata() };
          candidate.records.push(worldObject);
        }
        Object.assign(worldObject, {
          externalKey,
          externalSource: addon.sourceFile,
          name: addon.name,
          summary: addon.summary,
          details: addon.details,
          category: addon.category,
          tags: addon.tags,
          state: addon.state,
          contextPolicy: addon.contextPolicy,
        });
        finishRecord(worldObject);
        worldObjectByExternalId.set(addon.externalId, worldObject);
        rememberReference('world_object', addon.externalId, worldObject.id);
      }

      const factByExternalId = new Map();
      for (const addon of bundle.facts) {
        const externalKey = `fact:${addon.externalId}`;
        let fact = candidate.records.find(record => record.kind === 'fact' && record.externalKey === externalKey);
        if (!fact) {
          fact = { id: createId('fact'), kind: 'fact', ...newRecordMetadata() };
          candidate.records.push(fact);
        }
        Object.assign(fact, {
          externalKey,
          externalSource: addon.sourceFile,
          name: addon.name,
          proposition: addon.proposition,
          summary: addon.summary,
          details: addon.details,
          category: addon.category,
          scope: addon.scope,
          tags: addon.tags,
          importance: addon.importance,
          contextPolicy: addon.contextPolicy,
        });
        finishRecord(fact);
        factByExternalId.set(addon.externalId, fact);
        rememberReference('fact', addon.externalId, fact.id);
      }

      const questByExternalId = new Map();
      for (const addon of bundle.quests) {
        const externalKey = `quest:${addon.externalId}`;
        let quest = candidate.records.find(record => record.kind === 'quest' && record.externalKey === externalKey);
        if (!quest) {
          quest = { id: createId('quest'), kind: 'quest', steps: [], ...newRecordMetadata() };
          candidate.records.push(quest);
        }
        Object.assign(quest, {
          externalKey,
          externalSource: addon.sourceFile,
          name: addon.name,
          summary: addon.summary,
          details: addon.details,
          category: addon.category,
          tags: addon.tags,
          status: addon.status,
          stakes: addon.stakes,
          outcome: addon.outcome,
          contextPolicy: addon.contextPolicy,
        });
        quest.steps = syncEmbedded(quest.steps, addon.steps, 'quest-step', step => ({
          label: step.label,
          status: step.status,
          notes: step.notes,
        }));
        finishRecord(quest);
        questByExternalId.set(addon.externalId, quest);
        rememberReference('quest', addon.externalId, quest.id);
      }

      for (const addon of bundle.places) {
        const place = placeByExternalId.get(addon.externalId);
        place.parentPlaceId = addon.parentExternalId ? placeByExternalId.get(addon.parentExternalId).id : null;
        place.connections = syncEmbedded(place.connections, addon.connections, 'place-connection', connection => ({
          targetPlaceId: placeByExternalId.get(connection.targetExternalId).id,
          connectionKind: connection.connectionKind,
          notes: connection.notes,
        }));
      }
      for (const addon of bundle.worldObjects) {
        const worldObject = worldObjectByExternalId.get(addon.externalId);
        worldObject.homePlaceId = addon.homePlaceExternalId ? placeByExternalId.get(addon.homePlaceExternalId).id : null;
      }
      for (const addon of bundle.facts) {
        factByExternalId.get(addon.externalId).subjectRef = resolveReference(addon.subject);
      }
      for (const addon of bundle.quests) {
        questByExternalId.get(addon.externalId).involvedRefs = addon.involved.map(resolveReference);
      }

      for (const addon of bundle.relationships) {
        const externalKey = `relationship:${addon.externalId}`;
        let relationship = candidate.relationships.find(entry => entry.externalKey === externalKey);
        if (!relationship) {
          relationship = { id: createId('relationship'), kind: 'relationship', ...newRecordMetadata() };
          candidate.relationships.push(relationship);
        }
        Object.assign(relationship, {
          externalKey,
          externalSource: addon.sourceFile,
          sourceActorId: addon.source === '$player' ? candidate.playerCharacterId : externalActors.get(addon.source),
          targetActorId: addon.target === '$player' ? candidate.playerCharacterId : externalActors.get(addon.target),
          relationshipKind: addon.relationshipKind,
          status: addon.status,
          notes: addon.notes,
          dimensions: addon.dimensions,
          updatedAt: changedAt,
          updatedRevision: nextRevision,
          archivedAt: null,
        });
        affectedIds.push(relationship.id);
      }

      if (bundle.scene) {
        const externalKey = `scene:${bundle.scene.externalId}`;
        let scene = candidate.currentScene;
        if (!scene) {
          scene = {
            id: createId('scene'),
            kind: 'scene',
            externalKey,
            startMessageAnchor: null,
            openedAt: changedAt,
            openedRevision: nextRevision,
            ...newRecordMetadata(),
          };
        }
        Object.assign(scene, {
          externalKey,
          externalSource: bundle.scene.sourceFile,
          title: bundle.scene.title,
          summary: bundle.scene.summary,
          placeId: bundle.scene.placeExternalId ? placeByExternalId.get(bundle.scene.placeExternalId).id : null,
          transitionNotes: bundle.scene.transitionNotes,
          updatedAt: changedAt,
          updatedRevision: nextRevision,
          archivedAt: null,
        });
        scene.presences = syncEmbedded(scene.presences, bundle.scene.presences, 'scene-presence', presence => ({
          subjectRef: resolveReference(presence.subject),
          role: presence.role,
          state: presence.state,
          notes: presence.notes,
        }));
        scene.exits = syncEmbedded(scene.exits, bundle.scene.exits, 'scene-exit', exit => ({
          label: exit.label,
          destinationPlaceId: exit.destinationPlaceExternalId
            ? placeByExternalId.get(exit.destinationPlaceExternalId).id
            : null,
          status: exit.status,
          notes: exit.notes,
        }));
        scene.obstacles = syncEmbedded(scene.obstacles, bundle.scene.obstacles, 'scene-obstacle', obstacle => ({
          label: obstacle.label,
          status: obstacle.status,
          notes: obstacle.notes,
        }));
        scene.countdowns = syncEmbedded(scene.countdowns, bundle.scene.countdowns, 'scene-countdown', countdown => ({
          label: countdown.label,
          current: countdown.current,
          max: countdown.max,
          notes: countdown.notes,
        }));
        scene.openThreads = syncEmbedded(scene.openThreads, bundle.scene.threads, 'scene-thread', thread => ({
          label: thread.label,
          status: thread.status,
          notes: thread.notes,
        }));
        affectedIds.push(scene.id);
        candidate.currentScene = scene;
      }
    }

    if (operation.type === 'create_item_and_possession') {
      const itemId = createId('item');
      const possessionId = createId('possession');
      const carriedState = cleanText(operation.possession?.carriedState) || 'carried';
      if (!CARRIED_STATES.has(carriedState)) {
        throw new CampaignValidationError('Carried state is invalid.', { 'possession.carriedState': 'Choose a supported carried state.' });
      }
      const item = {
        id: itemId,
        kind: 'item',
        name: requiredText(operation.item?.name, 'item.name', 'Item name'),
        summary: cleanText(operation.item?.summary),
        details: cleanText(operation.item?.details),
        category: cleanText(operation.item?.category) || 'other',
        tags: cleanTags(operation.item?.tags),
        portable: operation.item?.portable !== false,
        unique: Boolean(operation.item?.unique),
        defaultEquipmentSlots: cleanTags(operation.item?.defaultEquipmentSlots),
        contextPolicy: cleanContextPolicy(operation.item?.contextPolicy),
        createdAt: changedAt,
        updatedAt: changedAt,
        createdRevision: nextRevision,
        updatedRevision: nextRevision,
        archivedAt: null,
      };
      const possession = {
        id: possessionId,
        kind: 'possession',
        ownerActorId: operation.possession.ownerActorId,
        itemId,
        quantity: positiveInteger(operation.possession.quantity, 'possession.quantity'),
        carriedState,
        equippedSlots: cleanTags(operation.possession.equippedSlots),
        label: cleanText(operation.possession.label),
        condition: cleanText(operation.possession.condition),
        notes: cleanText(operation.possession.notes),
        createdAt: changedAt,
        updatedAt: changedAt,
        createdRevision: nextRevision,
        updatedRevision: nextRevision,
        archivedAt: null,
      };
      candidate.records.push(item);
      candidate.possessions.push(possession);
      affectedIds.push(itemId, possessionId);
    }

    if (operation.type === 'add_existing_item_to_inventory') {
      const possessionId = createId('possession');
      const carriedState = cleanText(operation.possession?.carriedState) || 'carried';
      if (!CARRIED_STATES.has(carriedState)) {
        throw new CampaignValidationError('Carried state is invalid.', { 'possession.carriedState': 'Choose a supported carried state.' });
      }
      candidate.possessions.push({
        id: possessionId,
        kind: 'possession',
        ownerActorId: operation.possession.ownerActorId,
        itemId: operation.itemId,
        quantity: positiveInteger(operation.possession.quantity ?? 1, 'possession.quantity'),
        carriedState,
        equippedSlots: cleanTags(operation.possession.equippedSlots),
        label: cleanText(operation.possession.label),
        condition: cleanText(operation.possession.condition),
        notes: cleanText(operation.possession.notes),
        createdAt: changedAt,
        updatedAt: changedAt,
        createdRevision: nextRevision,
        updatedRevision: nextRevision,
        archivedAt: null,
      });
      affectedIds.push(possessionId);
    }

    if (operation.type === 'create_ability_and_learned_ability') {
      const abilityId = createId('ability');
      const learnedAbilityId = createId('learned-ability');
      const accessState = cleanText(operation.learnedAbility?.accessState) || 'learned';
      if (!ABILITY_ACCESS_STATES.has(accessState)) {
        throw new CampaignValidationError('Ability access state is invalid.', {
          'learnedAbility.accessState': 'Choose a supported access state.',
        });
      }
      const currentUses = optionalNonNegativeInteger(operation.learnedAbility?.currentUses, 'learnedAbility.currentUses');
      const maxUses = optionalNonNegativeInteger(operation.learnedAbility?.maxUses, 'learnedAbility.maxUses');
      if (currentUses !== null && maxUses !== null && currentUses > maxUses) {
        throw new CampaignValidationError('Current uses cannot exceed maximum uses.', {
          'learnedAbility.currentUses': 'Current uses cannot exceed maximum uses.',
        });
      }
      const ability = {
        id: abilityId,
        kind: 'ability',
        name: requiredText(operation.ability?.name, 'ability.name', 'Ability name'),
        summary: cleanText(operation.ability?.summary),
        details: cleanText(operation.ability?.details),
        category: cleanText(operation.ability?.category) || 'other',
        tags: cleanTags(operation.ability?.tags),
        usage: cleanText(operation.ability?.usage),
        limits: cleanText(operation.ability?.limits),
        defaultResourceLabel: cleanText(operation.ability?.defaultResourceLabel),
        contextPolicy: cleanContextPolicy(operation.ability?.contextPolicy),
        createdAt: changedAt,
        updatedAt: changedAt,
        createdRevision: nextRevision,
        updatedRevision: nextRevision,
        archivedAt: null,
      };
      const learnedAbility = {
        id: learnedAbilityId,
        kind: 'learned_ability',
        actorId: operation.learnedAbility.actorId,
        abilityId,
        accessState,
        currentUses,
        maxUses,
        notes: cleanText(operation.learnedAbility?.notes),
        createdAt: changedAt,
        updatedAt: changedAt,
        createdRevision: nextRevision,
        updatedRevision: nextRevision,
        archivedAt: null,
      };
      candidate.records.push(ability);
      candidate.learnedAbilities.push(learnedAbility);
      affectedIds.push(abilityId, learnedAbilityId);
    }

    if (operation.type === 'learn_existing_ability') {
      const learnedAbilityId = createId('learned-ability');
      const accessState = cleanText(operation.learnedAbility?.accessState) || 'learned';
      if (!ABILITY_ACCESS_STATES.has(accessState)) {
        throw new CampaignValidationError('Ability access state is invalid.', {
          'learnedAbility.accessState': 'Choose a supported access state.',
        });
      }
      const currentUses = optionalNonNegativeInteger(operation.learnedAbility?.currentUses, 'learnedAbility.currentUses');
      const maxUses = optionalNonNegativeInteger(operation.learnedAbility?.maxUses, 'learnedAbility.maxUses');
      if (currentUses !== null && maxUses !== null && currentUses > maxUses) {
        throw new CampaignValidationError('Current uses cannot exceed maximum uses.', {
          'learnedAbility.currentUses': 'Current uses cannot exceed maximum uses.',
        });
      }
      candidate.learnedAbilities.push({
        id: learnedAbilityId,
        kind: 'learned_ability',
        actorId: operation.learnedAbility.actorId,
        abilityId: operation.abilityId,
        accessState,
        currentUses,
        maxUses,
        notes: cleanText(operation.learnedAbility?.notes),
        createdAt: changedAt,
        updatedAt: changedAt,
        createdRevision: nextRevision,
        updatedRevision: nextRevision,
        archivedAt: null,
      });
      affectedIds.push(learnedAbilityId);
    }

    if (operation.type === 'create_actor') {
      const actorId = createId('actor');
      const actor = {
        id: actorId,
        kind: 'actor',
        role: 'npc',
        name: requiredText(operation.actor?.name, 'actor.name', 'Actor name'),
        summary: cleanText(operation.actor?.summary),
        details: cleanText(operation.actor?.details),
        category: cleanText(operation.actor?.category) || 'npc',
        tags: cleanTags(operation.actor?.tags),
        aliases: cleanTags(operation.actor?.aliases),
        pronouns: cleanText(operation.actor?.pronouns),
        appearance: cleanText(operation.actor?.appearance),
        personality: cleanText(operation.actor?.personality),
        goals: cleanText(operation.actor?.goals),
        voiceNotes: cleanText(operation.actor?.voiceNotes),
        conditions: cleanTags(operation.actor?.conditions),
        contextPolicy: cleanContextPolicy(operation.actor?.contextPolicy),
        createdAt: changedAt,
        updatedAt: changedAt,
        createdRevision: nextRevision,
        updatedRevision: nextRevision,
        archivedAt: null,
      };
      candidate.records.push(actor);
      affectedIds.push(actorId);
    }

    if (operation.type === 'create_relationship') {
      const relationshipId = createId('relationship');
      const status = cleanText(operation.relationship?.status) || 'active';
      if (!RELATIONSHIP_STATUSES.has(status)) {
        throw new CampaignValidationError('Relationship status is invalid.', {
          'relationship.status': 'Choose a supported Relationship status.',
        });
      }
      const relationship = {
        id: relationshipId,
        kind: 'relationship',
        sourceActorId: operation.relationship.sourceActorId,
        targetActorId: operation.relationship.targetActorId,
        relationshipKind: requiredText(operation.relationship?.relationshipKind, 'relationship.relationshipKind', 'Relationship kind'),
        status,
        notes: cleanText(operation.relationship?.notes),
        dimensions: cleanRelationshipDimensions(operation.relationship?.dimensions),
        createdAt: changedAt,
        updatedAt: changedAt,
        createdRevision: nextRevision,
        updatedRevision: nextRevision,
        archivedAt: null,
      };
      candidate.relationships.push(relationship);
      affectedIds.push(relationshipId);
    }

    if (operation.type === 'update_possession') {
      const possession = candidate.possessions.find(entry => entry.id === operation.possessionId);
      const changes = operation.changes ?? {};
      if ('quantity' in changes) possession.quantity = positiveInteger(changes.quantity, 'quantity');
      if ('carriedState' in changes) {
        const carriedState = requiredText(changes.carriedState, 'carriedState', 'Carried state');
        if (!CARRIED_STATES.has(carriedState)) {
          throw new CampaignValidationError('Carried state is invalid.', { carriedState: 'Choose a supported carried state.' });
        }
        possession.carriedState = carriedState;
      }
      if ('equippedSlots' in changes) possession.equippedSlots = cleanTags(changes.equippedSlots);
      if ('label' in changes) possession.label = cleanText(changes.label);
      if ('condition' in changes) possession.condition = cleanText(changes.condition);
      if ('notes' in changes) possession.notes = cleanText(changes.notes);
      possession.updatedAt = changedAt;
      possession.updatedRevision = nextRevision;
      affectedIds.push(possession.id);
    }

    if (operation.type === 'update_learned_ability') {
      const learnedAbility = candidate.learnedAbilities.find(entry => entry.id === operation.learnedAbilityId);
      const changes = operation.changes ?? {};
      if ('accessState' in changes) {
        const accessState = requiredText(changes.accessState, 'accessState', 'Access state');
        if (!ABILITY_ACCESS_STATES.has(accessState)) {
          throw new CampaignValidationError('Ability access state is invalid.', { accessState: 'Choose a supported access state.' });
        }
        learnedAbility.accessState = accessState;
      }
      const currentUses = 'currentUses' in changes
        ? optionalNonNegativeInteger(changes.currentUses, 'currentUses')
        : learnedAbility.currentUses;
      const maxUses = 'maxUses' in changes
        ? optionalNonNegativeInteger(changes.maxUses, 'maxUses')
        : learnedAbility.maxUses;
      if (currentUses !== null && maxUses !== null && currentUses > maxUses) {
        throw new CampaignValidationError('Current uses cannot exceed maximum uses.', {
          currentUses: 'Current uses cannot exceed maximum uses.',
        });
      }
      learnedAbility.currentUses = currentUses;
      learnedAbility.maxUses = maxUses;
      if ('notes' in changes) learnedAbility.notes = cleanText(changes.notes);
      learnedAbility.updatedAt = changedAt;
      learnedAbility.updatedRevision = nextRevision;
      affectedIds.push(learnedAbility.id);
    }

    if (operation.type === 'update_inventory_entry') {
      const item = candidate.records.find(record => record.id === operation.itemId && record.kind === 'item');
      const possession = candidate.possessions.find(entry => entry.id === operation.possessionId);
      const itemChanges = operation.itemChanges ?? {};
      const possessionChanges = operation.possessionChanges ?? {};

      if ('name' in itemChanges) item.name = requiredText(itemChanges.name, 'item.name', 'Item name');
      if ('summary' in itemChanges) item.summary = cleanText(itemChanges.summary);
      if ('details' in itemChanges) item.details = cleanText(itemChanges.details);
      if ('category' in itemChanges) item.category = cleanText(itemChanges.category) || 'other';
      if ('tags' in itemChanges) item.tags = cleanTags(itemChanges.tags);
      if ('portable' in itemChanges) item.portable = Boolean(itemChanges.portable);
      if ('unique' in itemChanges) item.unique = Boolean(itemChanges.unique);
      if ('defaultEquipmentSlots' in itemChanges) item.defaultEquipmentSlots = cleanTags(itemChanges.defaultEquipmentSlots);
      if ('contextPolicy' in itemChanges) item.contextPolicy = cleanContextPolicy(itemChanges.contextPolicy);
      item.updatedAt = changedAt;
      item.updatedRevision = nextRevision;

      if ('quantity' in possessionChanges) possession.quantity = positiveInteger(possessionChanges.quantity, 'quantity');
      if ('carriedState' in possessionChanges) {
        const carriedState = requiredText(possessionChanges.carriedState, 'carriedState', 'Carried state');
        if (!CARRIED_STATES.has(carriedState)) {
          throw new CampaignValidationError('Carried state is invalid.', { carriedState: 'Choose a supported carried state.' });
        }
        possession.carriedState = carriedState;
      }
      if ('equippedSlots' in possessionChanges) possession.equippedSlots = cleanTags(possessionChanges.equippedSlots);
      if ('label' in possessionChanges) possession.label = cleanText(possessionChanges.label);
      if ('condition' in possessionChanges) possession.condition = cleanText(possessionChanges.condition);
      if ('notes' in possessionChanges) possession.notes = cleanText(possessionChanges.notes);
      possession.updatedAt = changedAt;
      possession.updatedRevision = nextRevision;
      affectedIds.push(item.id, possession.id);
    }

    if (operation.type === 'update_ability_entry') {
      const ability = candidate.records.find(record => record.id === operation.abilityId && record.kind === 'ability');
      const learnedAbility = candidate.learnedAbilities.find(entry => entry.id === operation.learnedAbilityId);
      const abilityChanges = operation.abilityChanges ?? {};
      const learnedChanges = operation.learnedAbilityChanges ?? {};

      if ('name' in abilityChanges) ability.name = requiredText(abilityChanges.name, 'ability.name', 'Ability name');
      if ('summary' in abilityChanges) ability.summary = cleanText(abilityChanges.summary);
      if ('details' in abilityChanges) ability.details = cleanText(abilityChanges.details);
      if ('category' in abilityChanges) ability.category = cleanText(abilityChanges.category) || 'other';
      if ('tags' in abilityChanges) ability.tags = cleanTags(abilityChanges.tags);
      if ('usage' in abilityChanges) ability.usage = cleanText(abilityChanges.usage);
      if ('limits' in abilityChanges) ability.limits = cleanText(abilityChanges.limits);
      if ('defaultResourceLabel' in abilityChanges) ability.defaultResourceLabel = cleanText(abilityChanges.defaultResourceLabel);
      if ('contextPolicy' in abilityChanges) ability.contextPolicy = cleanContextPolicy(abilityChanges.contextPolicy);
      ability.updatedAt = changedAt;
      ability.updatedRevision = nextRevision;

      if ('accessState' in learnedChanges) {
        const accessState = requiredText(learnedChanges.accessState, 'learnedAbility.accessState', 'Access state');
        if (!ABILITY_ACCESS_STATES.has(accessState)) {
          throw new CampaignValidationError('Ability access state is invalid.', {
            'learnedAbility.accessState': 'Choose a supported access state.',
          });
        }
        learnedAbility.accessState = accessState;
      }
      const currentUses = 'currentUses' in learnedChanges
        ? optionalNonNegativeInteger(learnedChanges.currentUses, 'learnedAbility.currentUses')
        : learnedAbility.currentUses;
      const maxUses = 'maxUses' in learnedChanges
        ? optionalNonNegativeInteger(learnedChanges.maxUses, 'learnedAbility.maxUses')
        : learnedAbility.maxUses;
      if (currentUses !== null && maxUses !== null && currentUses > maxUses) {
        throw new CampaignValidationError('Current uses cannot exceed maximum uses.', {
          'learnedAbility.currentUses': 'Current uses cannot exceed maximum uses.',
        });
      }
      learnedAbility.currentUses = currentUses;
      learnedAbility.maxUses = maxUses;
      if ('notes' in learnedChanges) learnedAbility.notes = cleanText(learnedChanges.notes);
      learnedAbility.updatedAt = changedAt;
      learnedAbility.updatedRevision = nextRevision;
      affectedIds.push(ability.id, learnedAbility.id);
    }

    if (operation.type === 'update_actor') {
      const actor = candidate.records.find(record => record.id === operation.actorId && record.kind === 'actor');
      const changes = operation.changes ?? {};
      if ('name' in changes) actor.name = requiredText(changes.name, 'actor.name', 'Actor name');
      if ('summary' in changes) actor.summary = cleanText(changes.summary);
      if ('details' in changes) actor.details = cleanText(changes.details);
      if ('category' in changes) actor.category = cleanText(changes.category) || 'npc';
      if ('tags' in changes) actor.tags = cleanTags(changes.tags);
      if ('aliases' in changes) actor.aliases = cleanTags(changes.aliases);
      if ('pronouns' in changes) actor.pronouns = cleanText(changes.pronouns);
      if ('appearance' in changes) actor.appearance = cleanText(changes.appearance);
      if ('personality' in changes) actor.personality = cleanText(changes.personality);
      if ('goals' in changes) actor.goals = cleanText(changes.goals);
      if ('voiceNotes' in changes) actor.voiceNotes = cleanText(changes.voiceNotes);
      if ('conditions' in changes) actor.conditions = cleanTags(changes.conditions);
      if ('contextPolicy' in changes) actor.contextPolicy = cleanContextPolicy(changes.contextPolicy);
      if ('meters' in changes) {
        const meters = cleanEditableMeters(changes.meters, 'actor.meters');
        actor.meters = replaceEditableNested(actor.meters, meters, 'meter', meter => ({
          label: meter.label,
          current: meter.current,
          max: meter.max,
          notes: meter.notes,
        }));
      }
      actor.updatedAt = changedAt;
      actor.updatedRevision = nextRevision;
      affectedIds.push(actor.id);
    }

    if (operation.type === 'create_quest' || operation.type === 'update_quest') {
      const normalized = cleanQuestPayload(operation.quest, candidate);
      let quest = operation.type === 'update_quest'
        ? candidate.records.find(record => record.id === operation.questId && record.kind === 'quest')
        : null;
      if (!quest) {
        quest = {
          id: createId('quest'),
          kind: 'quest',
          createdAt: changedAt,
          createdRevision: nextRevision,
          archivedAt: null,
          steps: [],
        };
        candidate.records.push(quest);
      }
      Object.assign(quest, {
        name: normalized.name,
        summary: normalized.summary,
        details: normalized.details,
        category: normalized.category,
        tags: normalized.tags,
        status: normalized.status,
        stakes: normalized.stakes,
        outcome: normalized.outcome,
        involvedRefs: normalized.involvedRefs,
        contextPolicy: normalized.contextPolicy,
        updatedAt: changedAt,
        updatedRevision: nextRevision,
        archivedAt: null,
      });
      quest.steps = replaceEditableNested(quest.steps, normalized.steps, 'quest-step', step => ({
        label: step.label,
        status: step.status,
        notes: step.notes,
      }));
      affectedIds.push(quest.id);
    }

    if (operation.type === 'create_fact' || operation.type === 'update_fact') {
      const normalized = cleanFactPayload(operation.fact, candidate);
      let fact = operation.type === 'update_fact'
        ? candidate.records.find(record => record.id === operation.factId && record.kind === 'fact')
        : null;
      if (!fact) {
        fact = {
          id: createId('fact'),
          kind: 'fact',
          createdAt: changedAt,
          createdRevision: nextRevision,
        };
        candidate.records.push(fact);
      }
      Object.assign(fact, normalized, {
        updatedAt: changedAt,
        updatedRevision: nextRevision,
        archivedAt: null,
      });
      affectedIds.push(fact.id);
    }

    if (operation.type === 'create_place' || operation.type === 'update_place') {
      const normalized = cleanPlacePayload(operation.place, candidate);
      let place = operation.type === 'update_place'
        ? candidate.records.find(record => record.id === operation.placeId && record.kind === 'place')
        : null;
      if (!place) {
        place = {
          id: createId('place'),
          kind: 'place',
          connections: [],
          createdAt: changedAt,
          createdRevision: nextRevision,
        };
        candidate.records.push(place);
      }
      Object.assign(place, {
        name: normalized.name,
        summary: normalized.summary,
        details: normalized.details,
        category: normalized.category,
        tags: normalized.tags,
        contextPolicy: normalized.contextPolicy,
        atmosphere: normalized.atmosphere,
        parentPlaceId: normalized.parentPlaceId,
        updatedAt: changedAt,
        updatedRevision: nextRevision,
        archivedAt: null,
      });
      place.connections = replaceEditableNested(place.connections, normalized.connections, 'place-connection', connection => ({
        targetPlaceId: connection.targetPlaceId,
        connectionKind: connection.connectionKind,
        notes: connection.notes,
      }));
      affectedIds.push(place.id);
    }

    if (operation.type === 'create_world_object' || operation.type === 'update_world_object') {
      const normalized = cleanWorldObjectPayload(operation.worldObject, candidate);
      let worldObject = operation.type === 'update_world_object'
        ? candidate.records.find(record => record.id === operation.worldObjectId && record.kind === 'world_object')
        : null;
      if (!worldObject) {
        worldObject = {
          id: createId('world-object'),
          kind: 'world_object',
          createdAt: changedAt,
          createdRevision: nextRevision,
        };
        candidate.records.push(worldObject);
      }
      Object.assign(worldObject, normalized, {
        updatedAt: changedAt,
        updatedRevision: nextRevision,
        archivedAt: null,
      });
      affectedIds.push(worldObject.id);
    }

    if (operation.type === 'create_current_scene' || operation.type === 'update_current_scene') {
      const normalized = cleanScenePayload(operation.scene, candidate);
      let scene = operation.type === 'update_current_scene' ? candidate.currentScene : null;
      if (!scene) {
        scene = {
          id: createId('scene'),
          kind: 'scene',
          createdAt: changedAt,
          createdRevision: nextRevision,
          openedAt: changedAt,
          openedRevision: nextRevision,
          startMessageAnchor: cleanText(operation.startMessageAnchor) || null,
          presences: [],
          exits: [],
          obstacles: [],
          countdowns: [],
          openThreads: [],
        };
      }
      candidate.currentScene = applyScenePayload(scene, normalized);
    }

    if (operation.type === 'advance_scene') {
      const currentScene = candidate.currentScene;
      const nextScenePayload = cleanScenePayload(operation.nextScene, candidate, 'nextScene');
      const carryThreadIds = new Set(operation.carryThreadIds ?? []);
      const carriedThreads = (currentScene.openThreads ?? [])
        .filter(thread => carryThreadIds.has(thread.id))
        .map(thread => ({
          id: null,
          label: thread.label,
          status: 'carried',
          notes: thread.notes,
          carriedFromThreadId: thread.id,
        }));
      nextScenePayload.openThreads.push(...carriedThreads);

      const archive = {
        id: createId('scene-archive'),
        kind: 'scene_archive',
        sourceSceneId: currentScene.id,
        title: currentScene.title,
        closedAt: changedAt,
        closedRevision: nextRevision,
        endMessageAnchor: cleanText(operation.endMessageAnchor) || null,
        scene: clone(currentScene),
      };
      candidate.sceneArchives ??= [];
      candidate.sceneArchives.push(archive);
      affectedIds.push(
        currentScene.id,
        ...(currentScene.presences ?? []).map(entry => entry.id),
        ...(currentScene.exits ?? []).map(entry => entry.id),
        ...(currentScene.obstacles ?? []).map(entry => entry.id),
        ...(currentScene.countdowns ?? []).map(entry => entry.id),
        ...(currentScene.openThreads ?? []).map(entry => entry.id),
        archive.id,
      );

      const nextScene = {
        id: createId('scene'),
        kind: 'scene',
        createdAt: changedAt,
        createdRevision: nextRevision,
        openedAt: changedAt,
        openedRevision: nextRevision,
        startMessageAnchor: cleanText(operation.startMessageAnchor) || null,
        presences: [],
        exits: [],
        obstacles: [],
        countdowns: [],
        openThreads: [],
      };
      candidate.currentScene = applyScenePayload(nextScene, nextScenePayload);
    }

    if (operation.type === 'update_relationship') {
      const relationship = candidate.relationships.find(entry => entry.id === operation.relationshipId);
      const changes = operation.changes ?? {};
      if ('relationshipKind' in changes) {
        relationship.relationshipKind = requiredText(changes.relationshipKind, 'relationship.relationshipKind', 'Relationship kind');
      }
      if ('status' in changes) {
        const status = requiredText(changes.status, 'relationship.status', 'Relationship status');
        if (!RELATIONSHIP_STATUSES.has(status)) {
          throw new CampaignValidationError('Relationship status is invalid.', {
            'relationship.status': 'Choose a supported Relationship status.',
          });
        }
        relationship.status = status;
      }
      if ('notes' in changes) relationship.notes = cleanText(changes.notes);
      if ('dimensions' in changes) relationship.dimensions = cleanRelationshipDimensions(changes.dimensions);
      relationship.updatedAt = changedAt;
      relationship.updatedRevision = nextRevision;
      affectedIds.push(relationship.id);
    }

    if (operation.type === 'archive_possession' || operation.type === 'restore_possession') {
      const possession = candidate.possessions.find(entry => entry.id === operation.possessionId);
      possession.archivedAt = operation.type === 'archive_possession' ? changedAt : null;
      possession.updatedAt = changedAt;
      possession.updatedRevision = nextRevision;
      affectedIds.push(possession.id);
    }

    if (operation.type === 'archive_learned_ability' || operation.type === 'restore_learned_ability') {
      const learnedAbility = candidate.learnedAbilities.find(entry => entry.id === operation.learnedAbilityId);
      learnedAbility.archivedAt = operation.type === 'archive_learned_ability' ? changedAt : null;
      learnedAbility.updatedAt = changedAt;
      learnedAbility.updatedRevision = nextRevision;
      affectedIds.push(learnedAbility.id);
    }

    if (operation.type === 'archive_actor' || operation.type === 'restore_actor') {
      const actor = candidate.records.find(record => record.id === operation.actorId && record.kind === 'actor');
      actor.archivedAt = operation.type === 'archive_actor' ? changedAt : null;
      actor.updatedAt = changedAt;
      actor.updatedRevision = nextRevision;
      affectedIds.push(actor.id);
    }

    if (operation.type === 'archive_relationship' || operation.type === 'restore_relationship') {
      const relationship = candidate.relationships.find(entry => entry.id === operation.relationshipId);
      relationship.archivedAt = operation.type === 'archive_relationship' ? changedAt : null;
      relationship.updatedAt = changedAt;
      relationship.updatedRevision = nextRevision;
      affectedIds.push(relationship.id);
    }

    if (operation.type === 'archive_quest' || operation.type === 'restore_quest') {
      const quest = candidate.records.find(record => record.id === operation.questId && record.kind === 'quest');
      quest.archivedAt = operation.type === 'archive_quest' ? changedAt : null;
      quest.updatedAt = changedAt;
      quest.updatedRevision = nextRevision;
      affectedIds.push(quest.id);
    }

    if (operation.type === 'archive_world_record' || operation.type === 'restore_world_record') {
      const record = candidate.records.find(entry => entry.id === operation.recordId);
      record.archivedAt = operation.type === 'archive_world_record' ? changedAt : null;
      record.updatedAt = changedAt;
      record.updatedRevision = nextRevision;
      affectedIds.push(record.id);
    }

    if (operation.type === 'delete_inventory_entry') {
      const possession = candidate.possessions.find(entry => entry.id === operation.possessionId);
      candidate.possessions = candidate.possessions.filter(entry => entry.id !== possession.id);
      affectedIds.push(possession.id);
      const itemStillReferenced = createCampaignReferenceGraph(candidate).inbound(operation.itemId).length > 0;
      if (!itemStillReferenced) {
        candidate.records = candidate.records.filter(record => record.id !== operation.itemId);
        affectedIds.unshift(operation.itemId);
      }
    }

    if (operation.type === 'delete_ability_entry') {
      const learnedAbility = candidate.learnedAbilities.find(entry => entry.id === operation.learnedAbilityId);
      candidate.learnedAbilities = candidate.learnedAbilities.filter(entry => entry.id !== learnedAbility.id);
      affectedIds.push(learnedAbility.id);
      const abilityStillReferenced = createCampaignReferenceGraph(candidate).inbound(operation.abilityId).length > 0;
      if (!abilityStillReferenced) {
        candidate.records = candidate.records.filter(record => record.id !== operation.abilityId);
        affectedIds.unshift(operation.abilityId);
      }
    }

    if (operation.type === 'delete_relationship') {
      candidate.relationships = candidate.relationships.filter(entry => entry.id !== operation.relationshipId);
      affectedIds.push(operation.relationshipId);
    }

    if (operation.type === 'delete_actor') {
      candidate.records = candidate.records.filter(record => record.id !== operation.actorId);
      affectedIds.push(operation.actorId);
    }

    if (operation.type === 'delete_quest') {
      const quest = candidate.records.find(record => record.id === operation.questId && record.kind === 'quest');
      candidate.records = candidate.records.filter(record => record.id !== operation.questId);
      affectedIds.push(quest.id, ...(quest.steps ?? []).map(step => step.id));
    }

    if (operation.type === 'delete_world_record') {
      const record = candidate.records.find(entry => entry.id === operation.recordId);
      candidate.records = candidate.records.filter(entry => entry.id !== operation.recordId);
      affectedIds.push(record.id, ...(record.connections ?? []).map(connection => connection.id));
    }

    if (acceptedProposal) {
      const proposal = candidate.proposals.find(entry => entry.id === acceptedProposal.id);
      proposal.status = 'accepted';
      proposal.reviewedAt = changedAt;
      proposal.updatedAt = changedAt;
      proposal.updatedRevision = nextRevision;
      proposal.appliedIds = clone(affectedIds);
      affectedIds.push(proposal.id);
      advanceBoundaryWhenReviewed(proposal.sourceIdentity);
    }

    candidate.revision = nextRevision;
    candidate.commitId = createId('commit');
    candidate.events.push({
      id: createId('event'),
      type: requestedOperation.type,
      revision: nextRevision,
      affectedIds: clone(affectedIds),
      createdAt: changedAt,
    });

    const candidateEnvelope = makeEnvelope(candidate);
    const committed = await storage.commit(binding, candidateEnvelope, current.commitId);
    verified = clone(committed);
    undoEntries.clear();
    const undoEligible = ![
      'store_story_sync_draft',
      'update_story_sync_proposal',
      'reject_story_sync_proposal',
      'discard_story_sync_review',
      'complete_empty_story_sync_review',
      'delete_inventory_entry',
      'delete_ability_entry',
      'delete_relationship',
      'delete_actor',
      'delete_quest',
      'delete_world_record',
    ].includes(requestedOperation.type);
    const undoToken = undoEligible ? createId('undo') : null;
    if (undoEligible) {
      undoEntries.set(undoToken, {
        revision: candidate.revision,
        beforeCampaign,
        affectedIds: clone(affectedIds),
        affectedKinds: clone(impact.affectedKinds),
        impact: impact.summary,
      });
    }
    const result = {
      revision: candidate.revision,
      commitId: candidate.commitId,
      affectedIds,
      affectedKinds: impact.affectedKinds,
      impact: impact.summary,
      undoEligible,
      undoToken,
      capsule: candidateEnvelope.capsule.text,
      refreshHints: ['character', 'inventory', 'abilities', 'people', 'objectives', 'world', 'current_scene'],
      addonCounts: impact.addonCounts ?? null,
      syncBoundary: clone(candidate.syncBoundary),
    };
    for (const listener of listeners) listener(clone(result));
    return result;
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('Campaign listener must be a function.');
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return Object.freeze({ open, query, preview, execute, subscribe });
}
