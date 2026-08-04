const RELATIONSHIP_DIMENSIONS = ['affinity', 'trust', 'respect', 'fear', 'tension', 'debt'];

export const DEFAULT_CONTEXT_BUDGET = Object.freeze({
  maxChars: 5_000,
  sections: Object.freeze({
    character: 1_200,
    current_scene: 1_600,
    inventory: 650,
    abilities: 650,
    objectives: 500,
    people: 450,
    relationships: 400,
    world: 700,
  }),
});

function policyOf(record) {
  return record?.contextPolicy ?? 'automatic';
}

function compactText(value, maxChars) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function priorityOf(entry) {
  if (entry.always) return -10;
  if (entry.policy === 'pinned') return -5;
  return entry.priority ?? 0;
}

function sortEntries(entries) {
  return [...entries].sort((left, right) => (
    priorityOf(left) - priorityOf(right)
    || String(left.name ?? '').localeCompare(String(right.name ?? ''))
    || String(left.id ?? '').localeCompare(String(right.id ?? ''))
  ));
}

function entry({ id, recordId = id, kind, name, line, record = null, always = false, priority = 0, eligible = true, reason = '' }) {
  return {
    id,
    recordId,
    kind,
    name,
    line,
    policy: policyOf(record),
    controllable: Boolean(recordId && record),
    always,
    priority,
    eligible,
    reason,
  };
}

function normalizeBudget(input = {}) {
  const maxChars = Number.isInteger(input.maxChars) && input.maxChars >= 2_000
    ? input.maxChars
    : DEFAULT_CONTEXT_BUDGET.maxChars;
  const sections = {};
  for (const [key, fallback] of Object.entries(DEFAULT_CONTEXT_BUDGET.sections)) {
    sections[key] = Number.isInteger(input.sections?.[key]) && input.sections[key] >= 200
      ? input.sections[key]
      : fallback;
  }
  return { maxChars, sections };
}

export function compileContextCapsuleDetailed(campaign, budgetInput = {}) {
  const budget = normalizeBudget(budgetInput);
  const records = new Map(campaign.records.map(record => [record.id, record]));
  const actor = records.get(campaign.playerCharacterId);
  const currentScene = campaign.currentScene ?? null;
  const currentPlace = currentScene?.placeId ? records.get(currentScene.placeId) : null;
  const omitted = [];
  const selectedIds = new Set();
  const selectedRecords = new Map();
  const lines = [
    `CAMPAIGN STATE · REVISION ${campaign.revision}`,
    'Treat these fields as authoritative current state. Lists are indexes; do not invent details absent from FOCUS DETAILS or recent chat.',
  ];
  const sectionDiagnostics = [];

  const omit = (candidate, section, reason) => {
    omitted.push({
      id: candidate.id,
      recordId: candidate.recordId,
      kind: candidate.kind,
      name: candidate.name,
      section,
      reason,
      policy: candidate.policy,
      controllable: candidate.controllable,
    });
  };

  const appendSection = (key, label, candidates) => {
    const sorted = sortEntries(candidates);
    const sectionLimit = budget.sections[key];
    const accepted = [];
    let sectionChars = label.length;
    const committedChars = lines.join('\n').length;
    const totalAddition = candidateLines => 1 + ['', label, ...candidateLines].join('\n').length;
    for (const candidate of sorted) {
      if (candidate.policy === 'excluded') {
        omit(candidate, key, 'excluded');
        continue;
      }
      if (!candidate.eligible && candidate.policy !== 'pinned') {
        omit(candidate, key, candidate.reason || 'not relevant now');
        continue;
      }
      const sectionCost = 1 + candidate.line.length;
      const sectionFits = sectionChars + sectionCost <= sectionLimit;
      const totalFits = committedChars + totalAddition([...accepted.map(item => item.line), candidate.line]) <= budget.maxChars;
      if (!sectionFits || !totalFits) {
        const available = Math.min(
          sectionLimit - sectionChars - 1,
          budget.maxChars - committedChars - totalAddition(accepted.map(item => item.line)) - 1,
        );
        if (candidate.always && available >= 40) {
          const shortened = { ...candidate, line: `${candidate.line.slice(0, available - 1)}…` };
          accepted.push(shortened);
          sectionChars += 1 + shortened.line.length;
          if (shortened.recordId) {
            selectedIds.add(shortened.recordId);
            if (shortened.controllable && !selectedRecords.has(shortened.recordId)) {
              selectedRecords.set(shortened.recordId, {
                id: shortened.recordId,
                kind: shortened.kind,
                name: shortened.name,
                section: key,
                policy: shortened.policy,
                controllable: true,
              });
            }
          }
          continue;
        }
        omit(candidate, key, sectionFits ? 'total budget reached' : 'section budget reached');
        continue;
      }
      accepted.push(candidate);
      sectionChars += sectionCost;
      if (candidate.recordId) {
        selectedIds.add(candidate.recordId);
        if (candidate.controllable && !selectedRecords.has(candidate.recordId)) {
          selectedRecords.set(candidate.recordId, {
            id: candidate.recordId,
            kind: candidate.kind,
            name: candidate.name,
            section: key,
            policy: candidate.policy,
            controllable: true,
          });
        }
      }
    }
    if (accepted.length) {
      lines.push('', label, ...accepted.map(candidate => candidate.line));
    }
    sectionDiagnostics.push({
      key,
      label,
      usedChars: accepted.length ? sectionChars : 0,
      maxChars: sectionLimit,
      selectedCount: accepted.length,
      omittedCount: sorted.length - accepted.length,
    });
  };

  const characterEntries = [];
  if (actor && !actor.archivedAt) {
    const actorName = `${actor.name ?? 'Player Character'}${actor.pronouns ? ` [${actor.pronouns}]` : ''}${actor.summary ? `: ${actor.summary}` : ''}`;
    characterEntries.push(entry({ id: `${actor.id}:identity`, recordId: actor.id, kind: 'actor', name: actor.name, line: `- ${actorName}`, record: actor, always: true }));
    if (actor.conditions?.length) characterEntries.push(entry({ id: `${actor.id}:conditions`, recordId: actor.id, kind: 'actor', name: `${actor.name} conditions`, line: `- Conditions: ${actor.conditions.join(', ')}`, record: actor, always: true }));
    if (actor.meters?.length) {
      const meters = actor.meters.map(meter => `${meter.label} ${meter.current}${meter.max === null ? '' : `/${meter.max}`}`);
      characterEntries.push(entry({ id: `${actor.id}:meters`, recordId: actor.id, kind: 'actor', name: `${actor.name} meters`, line: `- Meters: ${meters.join('; ')}`, record: actor, always: true }));
    }
    for (const [field, label] of [['appearance', 'Appearance'], ['personality', 'Personality'], ['goals', 'Goals'], ['voiceNotes', 'Voice']]) {
      if (actor[field]) characterEntries.push(entry({ id: `${actor.id}:${field}`, recordId: actor.id, kind: 'actor', name: `${actor.name} ${label}`, line: `- ${label}: ${actor[field]}`, record: actor, always: true }));
    }
  }
  appendSection('character', 'CHARACTER', characterEntries);

  const subjectName = subjectRef => {
    if (!subjectRef) return 'Unknown subject';
    const record = records.get(subjectRef.id);
    if (record) return record.name;
    const possession = campaign.possessions.find(candidate => candidate.id === subjectRef.id);
    return records.get(possession?.itemId)?.name ?? 'Unknown subject';
  };
  const sceneEntries = [];
  if (currentScene) {
    const place = currentPlace ? ` @ ${currentPlace.name}` : '';
    sceneEntries.push(entry({
      id: currentScene.id,
      recordId: currentPlace?.id ?? null,
      kind: 'scene',
      name: currentScene.title,
      line: `- ${currentScene.title}${place}${currentScene.summary ? `: ${currentScene.summary}` : ''}`,
      record: currentPlace,
      always: true,
    }));
    for (const presence of currentScene.presences.filter(candidate => !['departed', 'destroyed'].includes(candidate.state))) {
      const subject = records.get(presence.subjectRef?.id);
      const possession = campaign.possessions.find(candidate => candidate.id === presence.subjectRef?.id);
      const item = possession ? records.get(possession.itemId) : null;
      const controllingRecord = subject ?? item;
      sceneEntries.push(entry({
        id: presence.id,
        recordId: controllingRecord?.id ?? null,
        kind: 'scene_presence',
        name: subjectName(presence.subjectRef),
        line: `- Presence: ${subjectName(presence.subjectRef)} [${presence.role}; ${presence.state}]${presence.notes ? `: ${presence.notes}` : ''}`,
        record: controllingRecord,
        always: true,
      }));
    }
    for (const exit of currentScene.exits) {
      const destination = records.get(exit.destinationPlaceId);
      sceneEntries.push(entry({
        id: exit.id,
        recordId: destination?.id ?? null,
        kind: 'scene_exit',
        name: exit.label,
        line: `- Exit: ${exit.label} [${exit.status}]${destination ? ` -> ${destination.name}` : ''}${exit.notes ? `: ${exit.notes}` : ''}`,
        record: destination,
        always: true,
      }));
    }
    for (const obstacle of currentScene.obstacles.filter(candidate => candidate.status === 'active')) {
      sceneEntries.push(entry({ id: obstacle.id, recordId: null, kind: 'scene_obstacle', name: obstacle.label, line: `- Obstacle: ${obstacle.label}${obstacle.notes ? `: ${obstacle.notes}` : ''}`, always: true }));
    }
    for (const countdown of currentScene.countdowns) {
      sceneEntries.push(entry({ id: countdown.id, recordId: null, kind: 'scene_countdown', name: countdown.label, line: `- Countdown: ${countdown.label} ${countdown.current}/${countdown.max}${countdown.notes ? `: ${countdown.notes}` : ''}`, always: true }));
    }
    for (const thread of currentScene.openThreads.filter(candidate => ['open', 'carried'].includes(candidate.status))) {
      sceneEntries.push(entry({ id: thread.id, recordId: null, kind: 'scene_thread', name: thread.label, line: `- Thread: ${thread.label} [${thread.status}]${thread.notes ? `: ${thread.notes}` : ''}`, always: true }));
    }
  }
  appendSection('current_scene', 'CURRENT SCENE', sceneEntries);

  const inventoryEntries = campaign.possessions
    .filter(possession => !possession.archivedAt && possession.ownerActorId === campaign.playerCharacterId)
    .map(possession => ({ possession, item: records.get(possession.itemId) }))
    .filter(candidate => candidate.item && !candidate.item.archivedAt)
    .map(({ item, possession }) => {
      const equipped = possession.equippedSlots.length
        ? `; equipped ${compactText(possession.equippedSlots.join(', '), 80)}`
        : '';
      const priority = possession.equippedSlots.length
        ? -4
        : ({ worn: -3, carried: -2, stored: 0, other: 1, missing: 2, consumed: 3 }[possession.carriedState] ?? 1);
      return entry({
        id: possession.id,
        recordId: item.id,
        kind: 'item',
        name: item.name,
        line: `- ${compactText(item.name, 100)} ×${possession.quantity} [${possession.carriedState}${equipped}]`,
        record: item,
        priority,
      });
    });
  appendSection('inventory', 'INVENTORY', inventoryEntries);

  const abilityEntries = campaign.learnedAbilities
    .filter(learned => !learned.archivedAt && learned.actorId === campaign.playerCharacterId)
    .map(learned => ({ learned, ability: records.get(learned.abilityId) }))
    .filter(candidate => candidate.ability && !candidate.ability.archivedAt)
    .map(({ ability, learned }) => {
      const uses = learned.maxUses === null
        ? (learned.currentUses === null ? '' : `; uses ${learned.currentUses}`)
        : `; uses ${learned.currentUses ?? 0}/${learned.maxUses}`;
      return entry({
        id: learned.id,
        recordId: ability.id,
        kind: 'ability',
        name: ability.name,
        line: `- ${compactText(ability.name, 100)} [${compactText(ability.category, 40)}; ${learned.accessState}${uses}]`,
        record: ability,
        priority: ['prepared', 'enabled'].includes(learned.accessState) ? -2 : 0,
        eligible: !['unavailable', 'forgotten'].includes(learned.accessState),
        reason: `access is ${learned.accessState}`,
      });
    });
  appendSection('abilities', 'ABILITIES', abilityEntries);

  const questEntries = campaign.records
    .filter(record => record.kind === 'quest' && !record.archivedAt)
    .map(quest => {
      const nextStep = quest.steps?.find(step => ['active', 'blocked', 'pending'].includes(step.status));
      return entry({
        id: quest.id,
        kind: 'quest',
        name: quest.name,
        line: `- ${compactText(quest.name, 100)} [${quest.status}]${nextStep ? `; next: ${compactText(nextStep.label, 120)} [${nextStep.status}]` : ''}`,
        record: quest,
        eligible: ['active', 'blocked'].includes(quest.status),
        reason: `status is ${quest.status}`,
      });
    });
  appendSection('objectives', 'OBJECTIVES', questEntries);

  const peopleEntries = campaign.records
    .filter(record => record.kind === 'actor' && record.role === 'npc' && !record.archivedAt)
    .map(person => entry({
      id: person.id,
      kind: 'actor',
      name: person.name,
      line: `- ${compactText(person.name, 100)} [npc${person.pronouns ? `; ${compactText(person.pronouns, 50)}` : ''}]`,
      record: person,
    }));
  appendSection('people', 'PEOPLE', peopleEntries);

  const relationshipEntries = campaign.relationships
    .filter(relationship => !relationship.archivedAt && relationship.status !== 'ended')
    .map(relationship => ({ relationship, source: records.get(relationship.sourceActorId), target: records.get(relationship.targetActorId) }))
    .filter(candidate => candidate.source && candidate.target && !candidate.source.archivedAt && !candidate.target.archivedAt)
    .map(({ relationship, source, target }) => {
      const dimensions = RELATIONSHIP_DIMENSIONS
        .filter(key => relationship.dimensions?.[key] !== undefined)
        .map(key => `${key} ${relationship.dimensions[key]}`);
      const controllingRecord = source.contextPolicy === 'pinned' ? source : target.contextPolicy === 'pinned' ? target : null;
      return entry({
        id: relationship.id,
        recordId: controllingRecord?.id ?? null,
        kind: 'relationship',
        name: `${source.name} → ${target.name}`,
        line: `- ${compactText(source.name, 70)} -> ${compactText(target.name, 70)} [${relationship.relationshipKind}; ${relationship.status}${dimensions.length ? `; ${dimensions.join(', ')}` : ''}]`,
        record: controllingRecord,
        eligible: source.contextPolicy !== 'excluded' && target.contextPolicy !== 'excluded',
        reason: 'related Actor is excluded',
      });
    });
  appendSection('relationships', 'RELATIONSHIPS', relationshipEntries);

  const worldEntries = [];
  for (const place of campaign.records.filter(record => record.kind === 'place' && !record.archivedAt)) {
    const isCurrent = place.id === currentPlace?.id;
    worldEntries.push(entry({
      id: place.id,
      kind: 'place',
      name: place.name,
      line: `- Place: ${compactText(place.name, 100)}${isCurrent && place.summary ? `: ${compactText(place.summary, 180)}` : ''}${isCurrent && place.atmosphere ? `; atmosphere: ${compactText(place.atmosphere, 140)}` : ''}`,
      record: place,
      eligible: isCurrent,
      reason: 'not the Current Scene location',
      priority: isCurrent ? -2 : 0,
    }));
  }
  for (const worldObject of campaign.records.filter(record => record.kind === 'world_object' && !record.archivedAt)) {
    worldEntries.push(entry({
      id: worldObject.id,
      kind: 'world_object',
      name: worldObject.name,
      line: `- Object: ${compactText(worldObject.name, 100)}${worldObject.state ? ` [${compactText(worldObject.state, 160)}]` : ''}`,
      record: worldObject,
      eligible: Boolean(currentPlace && worldObject.homePlaceId === currentPlace.id),
      reason: 'not at the Current Scene location',
    }));
  }
  for (const fact of campaign.records.filter(record => record.kind === 'fact' && !record.archivedAt)) {
    const includeTruth = fact.importance === 'critical' || policyOf(fact) === 'pinned';
    worldEntries.push(entry({
      id: fact.id,
      kind: 'fact',
      name: fact.name,
      line: includeTruth
        ? `- Fact [${fact.importance}]: ${compactText(fact.proposition, 300)}`
        : `- Fact: ${compactText(fact.name, 120)} [${fact.importance}]`,
      record: fact,
      priority: fact.importance === 'critical' ? -3 : fact.importance === 'important' ? -2 : 0,
    }));
  }
  appendSection('world', 'WORLD', worldEntries);

  const text = lines.join('\n');
  return {
    text,
    diagnostics: {
      totalChars: text.length,
      maxChars: budget.maxChars,
      overflow: omitted.some(candidate => candidate.reason.includes('budget')),
      sections: sectionDiagnostics,
      selectedIds: [...selectedIds],
      selected: [...selectedRecords.values()],
      omitted,
    },
  };
}

export function compileContextCapsule(campaign, budgetInput = {}) {
  return compileContextCapsuleDetailed(campaign, budgetInput).text;
}
