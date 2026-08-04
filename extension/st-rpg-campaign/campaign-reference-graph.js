function cleanId(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function addNode(nodes, value, fallbackKind, fallbackName) {
  const id = cleanId(value?.id);
  if (!id) return;
  nodes.set(id, {
    id,
    kind: value?.kind ?? fallbackKind,
    name: value?.name ?? value?.title ?? value?.label ?? fallbackName ?? id,
    value,
  });
}

/**
 * Builds the authoritative in-memory reference index for one Campaign snapshot.
 * It knows storage shape; callers only ask resolve(), inbound(), or validate().
 */
export function createCampaignReferenceGraph(campaign) {
  const nodes = new Map();
  const references = [];

  for (const record of campaign?.records ?? []) addNode(nodes, record, record?.kind, 'Record');
  for (const possession of campaign?.possessions ?? []) addNode(nodes, possession, 'possession', 'Possession');
  for (const learned of campaign?.learnedAbilities ?? []) addNode(nodes, learned, 'learned_ability', 'Learned Ability');
  for (const relationship of campaign?.relationships ?? []) addNode(nodes, relationship, 'relationship', 'Relationship');

  const addReference = ({ sourceId, sourceKind, sourceName, field, targetId, targetKind = null, location }) => {
    const normalizedTarget = cleanId(targetId);
    if (!normalizedTarget) return;
    references.push({
      sourceId: cleanId(sourceId),
      sourceKind,
      sourceName,
      field,
      targetId: normalizedTarget,
      targetKind,
      location: location || `${sourceName} ${field}`,
    });
  };

  for (const possession of campaign?.possessions ?? []) {
    addReference({
      sourceId: possession.id,
      sourceKind: 'possession',
      sourceName: possession.label || 'Possession',
      field: 'ownerActorId',
      targetId: possession.ownerActorId,
      targetKind: 'actor',
      location: `Possession ${possession.label || possession.id} owner`,
    });
    addReference({
      sourceId: possession.id,
      sourceKind: 'possession',
      sourceName: possession.label || 'Possession',
      field: 'itemId',
      targetId: possession.itemId,
      targetKind: 'item',
      location: `Possession ${possession.label || possession.id} Item`,
    });
  }

  for (const learned of campaign?.learnedAbilities ?? []) {
    addReference({
      sourceId: learned.id,
      sourceKind: 'learned_ability',
      sourceName: 'Learned Ability',
      field: 'actorId',
      targetId: learned.actorId,
      targetKind: 'actor',
      location: `Learned Ability ${learned.id} Actor`,
    });
    addReference({
      sourceId: learned.id,
      sourceKind: 'learned_ability',
      sourceName: 'Learned Ability',
      field: 'abilityId',
      targetId: learned.abilityId,
      targetKind: 'ability',
      location: `Learned Ability ${learned.id} definition`,
    });
  }

  for (const relationship of campaign?.relationships ?? []) {
    for (const [field, label] of [['sourceActorId', 'source'], ['targetActorId', 'target']]) {
      addReference({
        sourceId: relationship.id,
        sourceKind: 'relationship',
        sourceName: relationship.relationshipKind || 'Relationship',
        field,
        targetId: relationship[field],
        targetKind: 'actor',
        location: `Relationships (${relationship.relationshipKind || relationship.id} ${label})`,
      });
    }
  }

  for (const record of campaign?.records ?? []) {
    if (record.subjectRef) {
      addReference({
        sourceId: record.id,
        sourceKind: record.kind,
        sourceName: record.name,
        field: 'subjectRef',
        targetId: record.subjectRef.id,
        targetKind: record.subjectRef.kind,
        location: `${record.kind === 'fact' ? 'Fact' : 'Record'} ${record.name} subject`,
      });
    }
    for (const reference of record.involvedRefs ?? []) {
      addReference({
        sourceId: record.id,
        sourceKind: record.kind,
        sourceName: record.name,
        field: 'involvedRefs',
        targetId: reference.id,
        targetKind: reference.kind,
        location: `Objective ${record.name} involved reference`,
      });
    }
    addReference({
      sourceId: record.id,
      sourceKind: record.kind,
      sourceName: record.name,
      field: 'parentPlaceId',
      targetId: record.parentPlaceId,
      targetKind: 'place',
      location: `Place ${record.name} parent`,
    });
    addReference({
      sourceId: record.id,
      sourceKind: record.kind,
      sourceName: record.name,
      field: 'homePlaceId',
      targetId: record.homePlaceId,
      targetKind: 'place',
      location: `World Object ${record.name} home`,
    });
    for (const connection of record.connections ?? []) {
      addReference({
        sourceId: connection.id ?? record.id,
        sourceKind: 'place_connection',
        sourceName: record.name,
        field: 'targetPlaceId',
        targetId: connection.targetPlaceId,
        targetKind: 'place',
        location: `Place connection from ${record.name}`,
      });
    }
  }

  const indexScene = (scene, label, sourcePrefix) => {
    if (!scene) return;
    addNode(nodes, scene, 'scene', label);
    addReference({
      sourceId: scene.id,
      sourceKind: 'scene',
      sourceName: label,
      field: 'placeId',
      targetId: scene.placeId,
      targetKind: 'place',
      location: `${sourcePrefix} location`,
    });
    for (const presence of scene.presences ?? []) {
      addNode(nodes, presence, 'scene_presence', `${label} presence`);
      addReference({
        sourceId: presence.id,
        sourceKind: 'scene_presence',
        sourceName: label,
        field: 'subjectRef',
        targetId: presence.subjectRef?.id,
        targetKind: presence.subjectRef?.kind,
        location: `${sourcePrefix} presence`,
      });
    }
    for (const exit of scene.exits ?? []) {
      addNode(nodes, exit, 'scene_exit', exit.label || `${label} exit`);
      addReference({
        sourceId: exit.id,
        sourceKind: 'scene_exit',
        sourceName: label,
        field: 'destinationPlaceId',
        targetId: exit.destinationPlaceId,
        targetKind: 'place',
        location: `${sourcePrefix} exit ${exit.label || exit.id}`,
      });
    }
  };

  indexScene(campaign?.currentScene, campaign?.currentScene?.title || 'Current Scene', 'Current Scene');
  for (const archive of campaign?.sceneArchives ?? []) {
    addNode(nodes, archive, 'scene_archive', archive.title || 'Scene Archive');
    indexScene(archive.scene, archive.title || 'Archived Scene', `Scene Archive ${archive.title || archive.id}`);
  }

  return Object.freeze({
    resolve(id) {
      return nodes.get(cleanId(id)) ?? null;
    },
    inbound(id, { excludeSourceIds = [] } = {}) {
      const excluded = new Set(excludeSourceIds.map(cleanId).filter(Boolean));
      return references
        .filter(reference => reference.targetId === cleanId(id) && !excluded.has(reference.sourceId))
        .map(reference => ({ ...reference }));
    },
    validate() {
      return references
        .filter(reference => !nodes.has(reference.targetId))
        .map(reference => ({ ...reference, message: `${reference.location} points to missing ${reference.targetKind || 'record'} ${reference.targetId}.` }));
    },
  });
}
