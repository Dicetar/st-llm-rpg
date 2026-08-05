import { compileContextCapsuleDetailed } from './context-capsule.js';

export const DEFAULT_NARRATOR_CONTEXT_BUDGET = Object.freeze({
  maxChars: 8_000,
  maxFocusChars: 2_800,
  maxFocusRecords: 8,
  maxRecordChars: 650,
  recentMessages: 6,
});

const STOP_WORDS = new Set([
  'about', 'after', 'again', 'also', 'and', 'are', 'but', 'can', 'could', 'does', 'for', 'from', 'have', 'her', 'here',
  'him', 'his', 'how', 'into', 'its', 'just', 'like', 'more', 'not', 'now', 'our', 'out', 'she', 'that', 'the', 'their',
  'them', 'then', 'there', 'these', 'they', 'this', 'through', 'use', 'very', 'want', 'was', 'what', 'when', 'where',
  'which', 'who', 'will', 'with', 'would', 'you', 'your',
  'как', 'где', 'для', 'его', 'есть', 'еще', 'или', 'как', 'мне', 'мой', 'над', 'она', 'они', 'оно', 'при', 'про',
  'так', 'там', 'тебе', 'того', 'тоже', 'тут', 'уже', 'что', 'это',
]);

const COLLECTION_INTENTS = Object.freeze({
  inventory: ['inventory', 'carry', 'carrying', 'carried', 'pack', 'bag', 'pocket', 'equip', 'equipped', 'wear', 'weapon', 'drink', 'инвентарь', 'несу', 'сумка', 'рюкзак', 'карман', 'экипировать', 'оружие'],
  abilities: ['ability', 'abilities', 'spell', 'spells', 'skill', 'skills', 'feat', 'feats', 'power', 'powers', 'cast', 'casting', 'magic', 'заклинание', 'заклинания', 'умение', 'умения', 'способность', 'способности', 'навык', 'магия', 'каст'],
  people: ['npc', 'person', 'people', 'character', 'relationship', 'relationships', 'trust', 'friend', 'enemy', 'нпс', 'персонаж', 'персонажи', 'отношение', 'отношения', 'доверие', 'друг', 'враг'],
  objectives: ['quest', 'quests', 'objective', 'objectives', 'mission', 'missions', 'goal', 'goals', 'task', 'tasks', 'clue', 'квест', 'квесты', 'задание', 'задания', 'цель', 'цели', 'миссия', 'улика'],
  world: ['place', 'places', 'location', 'locations', 'world', 'lore', 'fact', 'facts', 'object', 'место', 'места', 'локация', 'локации', 'мир', 'лор', 'факт', 'факты', 'объект'],
});

function compactText(value, maxChars = 240) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function boundedBlock(value, maxChars) {
  const text = String(value ?? '').trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function searchableText(value) {
  return compactText(Array.isArray(value) ? value.flat(Infinity).join(' ') : value, Number.MAX_SAFE_INTEGER)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function termsOf(value) {
  return new Set(searchableText(value).split(' ').filter(term => term.length >= 3 && !STOP_WORDS.has(term)));
}

function intersects(left, right) {
  const matches = [];
  for (const value of left) if (right.has(value)) matches.push(value);
  return matches;
}

function hasPhrase(text, phrase) {
  if (!text || !phrase) return false;
  return ` ${text} `.includes(` ${phrase} `);
}

function recordCollection(kind) {
  if (kind === 'item') return 'inventory';
  if (kind === 'ability') return 'abilities';
  if (kind === 'actor') return 'people';
  if (kind === 'quest') return 'objectives';
  return 'world';
}

function messageSegments(messages, limit) {
  const values = (Array.isArray(messages) ? messages : [])
    .map(message => typeof message === 'string' ? { text: message, isSystem: false } : {
      text: message?.mes ?? message?.text ?? message?.content ?? '',
      isSystem: Boolean(message?.is_system ?? message?.isSystem),
    })
    .filter(message => !message.isSystem && compactText(message.text, Number.MAX_SAFE_INTEGER))
    .slice(-limit)
    .reverse();
  const weights = [1, 0.82, 0.66, 0.52, 0.4, 0.3];
  return values.map((message, index) => {
    const normalized = searchableText(message.text);
    return { normalized, terms: termsOf(message.text), weight: weights[index] ?? 0.25 };
  });
}

function detectedIntents(segments) {
  const text = segments.map(segment => segment.normalized).join(' ');
  const terms = termsOf(text);
  const intents = new Set();
  for (const [collection, triggers] of Object.entries(COLLECTION_INTENTS)) {
    if (triggers.some(trigger => trigger.includes(' ') ? hasPhrase(text, searchableText(trigger)) : terms.has(searchableText(trigger)))) {
      intents.add(collection);
    }
  }
  return intents;
}

function recordLinks(campaign) {
  const links = new Map();
  const connect = (left, right) => {
    if (!left || !right || left === right) return;
    if (!links.has(left)) links.set(left, new Set());
    if (!links.has(right)) links.set(right, new Set());
    links.get(left).add(right);
    links.get(right).add(left);
  };
  for (const record of campaign.records) {
    if (record.kind === 'quest') for (const reference of record.involvedRefs ?? []) connect(record.id, reference.id);
    if (record.kind === 'fact') connect(record.id, record.subjectRef?.id);
    if (record.kind === 'place') {
      connect(record.id, record.parentPlaceId);
      for (const connection of record.connections ?? []) connect(record.id, connection.targetPlaceId);
    }
    if (record.kind === 'world_object') connect(record.id, record.homePlaceId);
  }
  for (const relationship of campaign.relationships ?? []) {
    if (!relationship.archivedAt && relationship.status !== 'ended') connect(relationship.sourceActorId, relationship.targetActorId);
  }
  return links;
}

function currentSceneRecordIds(campaign, records) {
  const ids = new Set();
  const scene = campaign.currentScene;
  if (!scene) return ids;
  if (scene.placeId) ids.add(scene.placeId);
  for (const presence of scene.presences ?? []) {
    if (['departed', 'destroyed'].includes(presence.state)) continue;
    if (presence.subjectRef?.kind === 'possession') {
      const possession = campaign.possessions.find(candidate => candidate.id === presence.subjectRef.id);
      if (possession?.itemId) ids.add(possession.itemId);
    } else if (records.has(presence.subjectRef?.id)) ids.add(presence.subjectRef.id);
  }
  return ids;
}

function candidateSearchParts(record, campaign, records) {
  const parts = [record.summary, record.details, record.category, record.tags];
  if (record.kind === 'actor') {
    parts.push(record.aliases, record.pronouns, record.appearance, record.personality, record.goals, record.voiceNotes, record.conditions);
    for (const relationship of campaign.relationships ?? []) {
      if (relationship.archivedAt || relationship.status === 'ended') continue;
      if (![relationship.sourceActorId, relationship.targetActorId].includes(record.id)) continue;
      const otherId = relationship.sourceActorId === record.id ? relationship.targetActorId : relationship.sourceActorId;
      parts.push(records.get(otherId)?.name, relationship.relationshipKind, relationship.status, relationship.notes, Object.keys(relationship.dimensions ?? {}));
    }
  }
  if (record.kind === 'item') {
    for (const possession of campaign.possessions.filter(candidate => candidate.itemId === record.id && !candidate.archivedAt)) {
      parts.push(possession.carriedState, possession.equippedSlots, possession.label, possession.condition, possession.notes);
    }
  }
  if (record.kind === 'ability') {
    parts.push(record.usage, record.limits, record.defaultResourceLabel);
    for (const learned of campaign.learnedAbilities.filter(candidate => candidate.abilityId === record.id && !candidate.archivedAt)) {
      parts.push(learned.accessState, learned.notes);
    }
  }
  if (record.kind === 'quest') parts.push(record.status, record.stakes, record.outcome, (record.steps ?? []).map(step => [step.label, step.status, step.notes]));
  if (record.kind === 'fact') parts.push(record.proposition, record.scope, record.importance, records.get(record.subjectRef?.id)?.name);
  if (record.kind === 'place') parts.push(record.atmosphere, records.get(record.parentPlaceId)?.name, (record.connections ?? []).map(connection => [records.get(connection.targetPlaceId)?.name, connection.connectionKind, connection.notes]));
  if (record.kind === 'world_object') parts.push(record.state, records.get(record.homePlaceId)?.name);
  return parts;
}

function rankBias(record, campaign) {
  if (record.kind === 'item') {
    const possessions = campaign.possessions.filter(candidate => candidate.itemId === record.id && !candidate.archivedAt);
    if (possessions.some(possession => possession.equippedSlots?.length)) return 24;
    if (possessions.some(possession => possession.carriedState === 'worn')) return 18;
    if (possessions.some(possession => possession.carriedState === 'carried')) return 12;
  }
  if (record.kind === 'ability') {
    const states = campaign.learnedAbilities.filter(candidate => candidate.abilityId === record.id && !candidate.archivedAt).map(candidate => candidate.accessState);
    if (states.includes('prepared') || states.includes('enabled')) return 18;
  }
  if (record.kind === 'quest' && ['active', 'blocked'].includes(record.status)) return 14;
  if (record.kind === 'fact' && record.importance === 'critical') return 14;
  return 0;
}

function buildCandidates(campaign) {
  const records = new Map(campaign.records.map(record => [record.id, record]));
  const sceneIds = currentSceneRecordIds(campaign, records);
  return campaign.records
    .filter(record => !record.archivedAt && record.id !== campaign.playerCharacterId)
    .map(record => ({
      id: record.id,
      kind: record.kind,
      name: record.name,
      record,
      policy: record.contextPolicy ?? 'automatic',
      collection: recordCollection(record.kind),
      normalizedName: searchableText(record.name),
      aliases: (record.aliases ?? []).map(searchableText).filter(Boolean),
      nameTerms: termsOf(record.name),
      tagTerms: termsOf([record.category, record.tags]),
      bodyTerms: termsOf(candidateSearchParts(record, campaign, records)),
      currentScene: sceneIds.has(record.id),
      bias: rankBias(record, campaign),
      score: 0,
      reasons: [],
      forced: false,
    }));
}

function addReason(candidate, reason) {
  if (!candidate.reasons.includes(reason)) candidate.reasons.push(reason);
}

function scoreCandidates(candidates, segments, intents, manualFocusIds) {
  const manual = new Set(manualFocusIds ?? []);
  const frequencies = new Map();
  for (const candidate of candidates) {
    for (const term of new Set([...candidate.nameTerms, ...candidate.tagTerms, ...candidate.bodyTerms])) {
      frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
    }
  }
  const weightedMatches = (matches, weight, cap) => Math.min(cap, matches.reduce((total, term) => (
    total + weight / Math.sqrt(frequencies.get(term) ?? 1)
  ), 0));
  for (const candidate of candidates) {
    if (manual.has(candidate.id)) {
      candidate.score += 1_000;
      candidate.forced = true;
      addReason(candidate, 'queued manually for the next reply');
    }
    if (candidate.policy === 'pinned') {
      candidate.score += 700;
      candidate.forced = true;
      addReason(candidate, 'pinned');
    }
    if (candidate.currentScene) {
      candidate.score += 70;
      addReason(candidate, 'present in the Current Scene');
    }
    if (intents.has(candidate.collection)) {
      candidate.score += 15;
      addReason(candidate, `${candidate.collection} requested`);
    }
    for (const segment of segments) {
      if (hasPhrase(segment.normalized, candidate.normalizedName)) {
        candidate.score += Math.round(300 * segment.weight);
        addReason(candidate, segment.weight === 1 ? 'exact name in the latest message' : 'name mentioned recently');
      } else if (candidate.aliases.some(alias => hasPhrase(segment.normalized, alias))) {
        candidate.score += Math.round(250 * segment.weight);
        addReason(candidate, segment.weight === 1 ? 'alias in the latest message' : 'alias mentioned recently');
      }
      const nameMatches = intersects(candidate.nameTerms, segment.terms);
      if (nameMatches.length) {
        candidate.score += Math.round(weightedMatches(nameMatches, 48, 110) * segment.weight);
        addReason(candidate, `name terms matched: ${nameMatches.slice(0, 3).join(', ')}`);
      }
      const tagMatches = intersects(candidate.tagTerms, segment.terms);
      if (tagMatches.length) {
        candidate.score += Math.round(weightedMatches(tagMatches, 30, 78) * segment.weight);
        addReason(candidate, `category or tags matched: ${tagMatches.slice(0, 3).join(', ')}`);
      }
      const bodyMatches = intersects(candidate.bodyTerms, segment.terms);
      if (bodyMatches.length) {
        candidate.score += Math.round(weightedMatches(bodyMatches, 12, 60) * segment.weight);
        addReason(candidate, `description matched: ${bodyMatches.slice(0, 3).join(', ')}`);
      }
    }
  }
  for (const collection of intents) {
    if (candidates.some(candidate => candidate.collection === collection && candidate.score >= 45)) continue;
    const fallbacks = [...candidates]
      .filter(candidate => candidate.collection === collection && candidate.policy !== 'excluded')
      .sort((left, right) => right.bias - left.bias || String(left.name).localeCompare(String(right.name)))
      .slice(0, 2);
    for (const fallback of fallbacks) {
      fallback.score = Math.max(fallback.score, 45);
      addReason(fallback, `top current ${collection} record for a broad request`);
    }
  }
  return manual;
}

function appendField(lines, label, value, maxChars = 260) {
  const text = compactText(value, maxChars);
  if (text) lines.push(`${label}: ${text}`);
}

function recordName(records, id) {
  return records.get(id)?.name ?? '';
}

function renderRecordDetail(candidate, campaign, maxChars) {
  const record = candidate.record;
  const records = new Map(campaign.records.map(entry => [entry.id, entry]));
  const lines = [`${record.kind.toLocaleUpperCase().replace('_', ' ')} DETAIL · ${record.name}`];
  if (record.kind === 'actor') {
    appendField(lines, 'Identity', [record.pronouns, record.category].filter(Boolean).join('; '), 120);
    appendField(lines, 'Summary', record.summary);
    appendField(lines, 'Appearance', record.appearance);
    appendField(lines, 'Personality', record.personality);
    appendField(lines, 'Goals', record.goals);
    appendField(lines, 'Voice', record.voiceNotes, 180);
    appendField(lines, 'Conditions', record.conditions?.join(', '), 140);
    appendField(lines, 'Details', record.details, 260);
    const relationships = (campaign.relationships ?? [])
      .filter(relationship => !relationship.archivedAt && relationship.status !== 'ended' && [relationship.sourceActorId, relationship.targetActorId].includes(record.id))
      .slice(0, 4)
      .map(relationship => {
        const outgoing = relationship.sourceActorId === record.id;
        const other = recordName(records, outgoing ? relationship.targetActorId : relationship.sourceActorId);
        const dimensions = Object.entries(relationship.dimensions ?? {}).map(([key, value]) => `${key} ${value}`).join(', ');
        return `${outgoing ? 'toward' : 'from'} ${other}: ${relationship.relationshipKind}; ${relationship.status}${dimensions ? `; ${dimensions}` : ''}${relationship.notes ? `; ${relationship.notes}` : ''}`;
      });
    appendField(lines, 'Relationships', relationships.join(' | '), 300);
  } else if (record.kind === 'item') {
    appendField(lines, 'Type', [record.category, ...(record.tags ?? [])].filter(Boolean).join('; '), 140);
    appendField(lines, 'Summary', record.summary);
    appendField(lines, 'Details', record.details, 280);
    const possessions = campaign.possessions
      .filter(possession => possession.itemId === record.id && !possession.archivedAt)
      .map(possession => {
        const owner = recordName(records, possession.ownerActorId) || 'Unknown owner';
        return `${owner}: quantity ${possession.quantity}; ${possession.carriedState}${possession.equippedSlots?.length ? `; equipped ${possession.equippedSlots.join(', ')}` : ''}${possession.condition ? `; condition ${possession.condition}` : ''}${possession.notes ? `; ${possession.notes}` : ''}`;
      });
    appendField(lines, 'Live state', possessions.join(' | '), 300);
  } else if (record.kind === 'ability') {
    appendField(lines, 'Type', [record.category, ...(record.tags ?? [])].filter(Boolean).join('; '), 140);
    appendField(lines, 'Summary', record.summary);
    appendField(lines, 'Usage', record.usage, 260);
    appendField(lines, 'Limits', record.limits, 240);
    appendField(lines, 'Details', record.details, 220);
    const learned = campaign.learnedAbilities
      .filter(entry => entry.abilityId === record.id && !entry.archivedAt)
      .map(entry => `${recordName(records, entry.actorId) || 'Unknown actor'}: ${entry.accessState}${entry.maxUses === null ? (entry.currentUses === null ? '' : `; uses ${entry.currentUses}`) : `; uses ${entry.currentUses ?? 0}/${entry.maxUses}`}${entry.notes ? `; ${entry.notes}` : ''}`);
    appendField(lines, 'Live state', learned.join(' | '), 220);
  } else if (record.kind === 'quest') {
    appendField(lines, 'State', `${record.status}${record.category ? `; ${record.category}` : ''}`, 120);
    appendField(lines, 'Summary', record.summary);
    appendField(lines, 'Stakes', record.stakes, 220);
    appendField(lines, 'Details', record.details, 220);
    const steps = (record.steps ?? []).slice(0, 6).map(step => `${step.label} [${step.status}]${step.notes ? `: ${step.notes}` : ''}`);
    appendField(lines, 'Steps', steps.join(' | '), 320);
    appendField(lines, 'Involved', (record.involvedRefs ?? []).map(reference => recordName(records, reference.id)).filter(Boolean).join(', '), 180);
    appendField(lines, 'Outcome', record.outcome, 180);
  } else if (record.kind === 'fact') {
    appendField(lines, 'Truth', record.proposition, 360);
    appendField(lines, 'Scope', `${record.importance}; ${record.scope}`, 100);
    appendField(lines, 'Subject', recordName(records, record.subjectRef?.id), 120);
    appendField(lines, 'Summary', record.summary, 180);
    appendField(lines, 'Evidence/details', record.details, 260);
  } else if (record.kind === 'place') {
    appendField(lines, 'Type', record.category, 100);
    appendField(lines, 'Summary', record.summary);
    appendField(lines, 'Atmosphere', record.atmosphere, 220);
    appendField(lines, 'Details', record.details, 260);
    appendField(lines, 'Parent', recordName(records, record.parentPlaceId), 120);
    const connections = (record.connections ?? []).slice(0, 6).map(connection => `${recordName(records, connection.targetPlaceId)} [${connection.connectionKind}]${connection.notes ? `: ${connection.notes}` : ''}`);
    appendField(lines, 'Connections', connections.join(' | '), 280);
  } else if (record.kind === 'world_object') {
    appendField(lines, 'Type', record.category, 100);
    appendField(lines, 'Summary', record.summary);
    appendField(lines, 'Current state', record.state, 220);
    appendField(lines, 'Home', recordName(records, record.homePlaceId), 120);
    appendField(lines, 'Details', record.details, 280);
  }
  appendField(lines, 'Tags', record.tags?.join(', '), 120);
  return boundedBlock(lines.join('\n'), maxChars);
}

function sortCandidates(candidates) {
  return [...candidates].sort((left, right) => (
    Number(right.forced) - Number(left.forced)
    || (right.score + right.bias) - (left.score + left.bias)
    || String(left.name).localeCompare(String(right.name))
    || String(left.id).localeCompare(String(right.id))
  ));
}

export function compileNarratorContext(campaign, {
  messages = [],
  manualFocusIds = [],
  budget: budgetInput = {},
} = {}) {
  const budget = { ...DEFAULT_NARRATOR_CONTEXT_BUDGET, ...budgetInput };
  const base = compileContextCapsuleDetailed(campaign);
  const segments = messageSegments(messages, budget.recentMessages);
  const intents = detectedIntents(segments);
  const candidates = buildCandidates(campaign);
  const manual = scoreCandidates(candidates, segments, intents, manualFocusIds);
  const byId = new Map(candidates.map(candidate => [candidate.id, candidate]));
  const links = recordLinks(campaign);
  const primary = sortCandidates(candidates.filter(candidate => candidate.policy !== 'excluded' && (candidate.forced || candidate.score >= 45)));
  const routed = [...primary];
  const routedIds = new Set(primary.map(candidate => candidate.id));
  for (const source of primary) {
    for (const linkedId of links.get(source.id) ?? []) {
      const linked = byId.get(linkedId);
      if (!linked || linked.policy === 'excluded' || routedIds.has(linked.id)) continue;
      linked.score = Math.max(linked.score, 75);
      addReason(linked, `linked to ${source.name}`);
      routed.push(linked);
      routedIds.add(linked.id);
    }
  }

  const focusHeader = [
    '',
    '',
    'FOCUS DETAILS · RETRIEVED FOR THIS REPLY',
    'Use these details with the indexes above. Do not invent descriptions for index-only records.',
  ].join('\n');
  const maxFocusChars = Math.max(0, Math.min(budget.maxFocusChars, budget.maxChars - base.text.length - focusHeader.length));
  const focusBlocks = [];
  const focus = [];
  const omittedFocus = [];
  let focusChars = 0;
  for (const candidate of sortCandidates(routed)) {
    if (focus.length >= budget.maxFocusRecords) {
      omittedFocus.push({ id: candidate.id, recordId: candidate.id, kind: candidate.kind, name: candidate.name, policy: candidate.policy, controllable: true, reason: 'focus record limit reached', section: 'focus' });
      continue;
    }
    const block = renderRecordDetail(candidate, campaign, budget.maxRecordChars);
    const cost = (focusBlocks.length ? 2 : 0) + block.length;
    if (focusChars + cost > maxFocusChars) {
      omittedFocus.push({ id: candidate.id, recordId: candidate.id, kind: candidate.kind, name: candidate.name, policy: candidate.policy, controllable: true, reason: 'focus character budget reached', section: 'focus' });
      continue;
    }
    focusBlocks.push(block);
    focusChars += cost;
    focus.push({
      id: candidate.id,
      recordId: candidate.id,
      kind: candidate.kind,
      name: candidate.name,
      policy: candidate.policy,
      controllable: true,
      score: candidate.score,
      reasons: candidate.reasons,
      reason: candidate.reasons.join(' · '),
      manual: manual.has(candidate.id),
      usedChars: block.length,
    });
  }
  for (const recordId of manual) {
    const candidate = byId.get(recordId);
    if (candidate?.policy === 'excluded') {
      omittedFocus.push({ id: recordId, recordId, kind: candidate.kind, name: candidate.name, policy: candidate.policy, controllable: true, reason: 'excluded records cannot be focused', section: 'focus' });
    }
  }

  const focusText = focusBlocks.length ? `${focusHeader}\n${focusBlocks.join('\n\n')}` : '';
  const text = `${base.text}${focusText}`;
  const focusIds = new Set(focus.map(record => record.id));
  return {
    campaignRevision: campaign.revision,
    commitId: campaign.commitId,
    text,
    diagnostics: {
      totalChars: text.length,
      maxChars: budget.maxChars,
      overflow: base.diagnostics.overflow || omittedFocus.some(record => record.reason.includes('budget') || record.reason.includes('limit')),
      baseChars: base.text.length,
      focusChars: focusText.length,
      sections: [
        ...base.diagnostics.sections,
        { key: 'focus', label: 'FOCUS DETAILS', usedChars: focusText.length, maxChars: maxFocusChars + focusHeader.length, selectedCount: focus.length, omittedCount: omittedFocus.length },
      ],
      selectedIds: [...new Set([...base.diagnostics.selectedIds, ...focus.map(record => record.id)])],
      selected: base.diagnostics.selected,
      indexed: base.diagnostics.selected.filter(record => !focusIds.has(record.id)),
      focus,
      omitted: [...base.diagnostics.omitted, ...omittedFocus],
      omittedFocus,
      intents: [...intents],
      recentMessageCount: segments.length,
      manualFocusIds: [...manual],
    },
  };
}
