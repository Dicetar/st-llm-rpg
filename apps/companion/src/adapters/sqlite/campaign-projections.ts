import type {
  CampaignActor,
  CampaignAbility,
  CampaignFact,
  CampaignItem,
  CampaignLearnedAbility,
  CampaignPlace,
  CampaignQuest,
  CampaignRelationship,
  CampaignScene,
  CampaignSceneArchive,
  CampaignWorldObject,
} from '@st-llm-rpg/wire';
import type { DatabaseSync } from 'node:sqlite';
import type { CampaignState, CampaignSubjectChange } from '../../modules/campaign/campaign-state.js';
import { normalizeCampaignState, parseJson } from '../../modules/campaign/campaign-state.js';
import type { CampaignRow } from './campaign-rows.js';

export const LEGACY_CURRENT_STATE_MARKER = '{}';

type ActorProjectionRow = {
  actor_id: string;
  name: string;
  aliases_json: string | null;
  summary: string;
  visibility: Exclude<CampaignActor['visibility'], undefined> | null;
  trackers_json: string | null;
  archived: number;
};

type ItemProjectionRow = {
  item_id: string;
  name: string;
  aliases_json: string | null;
  summary: string;
  visibility: Exclude<CampaignItem['visibility'], undefined> | null;
  archived: number;
  owner_actor_id: string | null;
};

type QuestProjectionRow = {
  quest_id: string;
  name: string;
  aliases_json: string | null;
  summary: string;
  visibility: Exclude<CampaignQuest['visibility'], undefined> | null;
  status: CampaignQuest['status'];
  archived: number;
};

type PlaceProjectionRow = {
  place_id: string;
  name: string;
  aliases_json: string | null;
  summary: string;
  visibility: Exclude<CampaignPlace['visibility'], undefined> | null;
  archived: number;
};

type AbilityProjectionRow = {
  ability_id: string;
  name: string;
  aliases_json: string | null;
  summary: string;
  visibility: Exclude<CampaignAbility['visibility'], undefined> | null;
  category: CampaignAbility['category'];
  archived: number;
};

type FactProjectionRow = {
  fact_id: string;
  name: string;
  aliases_json: string | null;
  summary: string;
  visibility: Exclude<CampaignFact['visibility'], undefined> | null;
  archived: number;
  subject_id: string | null;
};

type WorldObjectProjectionRow = {
  world_object_id: string;
  name: string;
  aliases_json: string | null;
  summary: string;
  visibility: Exclude<CampaignWorldObject['visibility'], undefined> | null;
  archived: number;
  place_id: string | null;
};

type LearnedAbilityProjectionRow = {
  learned_ability_id: string;
  ability_id: string;
  actor_id: string;
  prepared: number;
  enabled: number;
  uses_remaining: number | null;
  uses_maximum: number | null;
  archived: number;
};

type RelationshipProjectionRow = {
  relationship_id: string;
  source_actor_id: string;
  target_actor_id: string;
  relationship_kind: string;
  status: CampaignRelationship['status'];
  notes: string;
  visibility: Exclude<CampaignRelationship['visibility'], undefined> | null;
  archived: number;
};

type SceneProjectionRow = {
  scene_id: string;
  name: string;
  summary: string;
  place_id: string | null;
  actor_ids_json: string | null;
  item_ids_json: string | null;
  world_object_ids_json: string | null;
};

type SceneArchiveProjectionRow = {
  scene_archive_id: string;
  name: string;
  summary: string;
  place_id: string | null;
  actor_ids_json: string | null;
  item_ids_json: string | null;
  world_object_ids_json: string | null;
  outcomes_json: string;
  open_threads_json: string;
  closed_at: string;
};

export function hasCurrentCampaignProjections(database: DatabaseSync): boolean {
  return Boolean(database.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'campaign_actor_projections'
  `).get());
}

function hasCurrentAbilityProjections(database: DatabaseSync): boolean {
  return Boolean(database.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'campaign_ability_projections'
  `).get());
}

function hasCurrentRelationshipProjections(database: DatabaseSync): boolean {
  return Boolean(database.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'campaign_relationship_projections'
  `).get());
}

function hasCurrentWorldRecordProjections(database: DatabaseSync): boolean {
  return Boolean(database.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'campaign_fact_projections'
  `).get());
}

function hasCurrentSceneArchiveProjections(database: DatabaseSync): boolean {
  return Boolean(database.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'campaign_scene_archive_projections'
  `).get());
}

function hasProjectionColumn(database: DatabaseSync, table: string, column: string): boolean {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return columns.some(candidate => candidate.name === column);
}

export function readCurrentCampaignState(database: DatabaseSync, campaign: CampaignRow): CampaignState {
  if (!hasCurrentCampaignProjections(database)) {
    return normalizeCampaignState(parseJson<CampaignState>(campaign.current_state_json));
  }
  const hasContextColumns = hasProjectionColumn(database, 'campaign_actor_projections', 'aliases_json');
  const trackerColumn = hasProjectionColumn(database, 'campaign_actor_projections', 'trackers_json')
    ? 'trackers_json'
    : 'NULL AS trackers_json';
  const narratorColumns = hasContextColumns ? 'aliases_json, summary, visibility' : 'NULL AS aliases_json, summary, NULL AS visibility';
  const sceneContextColumns = hasContextColumns
    ? `place_id, actor_ids_json, item_ids_json, ${hasProjectionColumn(database, 'campaign_scene_projections', 'world_object_ids_json') ? 'world_object_ids_json' : 'NULL AS world_object_ids_json'}`
    : 'NULL AS place_id, NULL AS actor_ids_json, NULL AS item_ids_json, NULL AS world_object_ids_json';

  const actorRows = database.prepare(`
    SELECT actor_id, name, ${narratorColumns}, ${trackerColumn}, archived
    FROM campaign_actor_projections WHERE campaign_id = ? ORDER BY actor_id
  `).all(campaign.campaign_id) as ActorProjectionRow[];
  const itemRows = database.prepare(`
    SELECT item_id, name, ${narratorColumns}, archived, owner_actor_id
    FROM campaign_item_projections WHERE campaign_id = ? ORDER BY item_id
  `).all(campaign.campaign_id) as ItemProjectionRow[];
  const questRows = database.prepare(`
    SELECT quest_id, name, ${narratorColumns}, status, archived
    FROM campaign_quest_projections WHERE campaign_id = ? ORDER BY quest_id
  `).all(campaign.campaign_id) as QuestProjectionRow[];
  const placeRows = database.prepare(`
    SELECT place_id, name, ${narratorColumns}, archived
    FROM campaign_place_projections WHERE campaign_id = ? ORDER BY place_id
  `).all(campaign.campaign_id) as PlaceProjectionRow[];
  const abilityRows = hasCurrentAbilityProjections(database) ? database.prepare(`
    SELECT ability_id, name, aliases_json, summary, visibility, category, archived
    FROM campaign_ability_projections WHERE campaign_id = ? ORDER BY ability_id
  `).all(campaign.campaign_id) as AbilityProjectionRow[] : [];
  const learnedAbilityRows = hasCurrentAbilityProjections(database) ? database.prepare(`
    SELECT learned_ability_id, ability_id, actor_id, prepared, enabled,
           uses_remaining, uses_maximum, archived
    FROM campaign_learned_ability_projections WHERE campaign_id = ? ORDER BY learned_ability_id
  `).all(campaign.campaign_id) as LearnedAbilityProjectionRow[] : [];
  const relationshipRows = hasCurrentRelationshipProjections(database) ? database.prepare(`
    SELECT relationship_id, source_actor_id, target_actor_id, relationship_kind,
           status, notes, visibility, archived
    FROM campaign_relationship_projections WHERE campaign_id = ? ORDER BY relationship_id
  `).all(campaign.campaign_id) as RelationshipProjectionRow[] : [];
  const factRows = hasCurrentWorldRecordProjections(database) ? database.prepare(`
    SELECT fact_id, name, aliases_json, summary, visibility, archived, subject_id
    FROM campaign_fact_projections WHERE campaign_id = ? ORDER BY fact_id
  `).all(campaign.campaign_id) as FactProjectionRow[] : [];
  const worldObjectRows = hasCurrentWorldRecordProjections(database) ? database.prepare(`
    SELECT world_object_id, name, aliases_json, summary, visibility, archived, place_id
    FROM campaign_world_object_projections WHERE campaign_id = ? ORDER BY world_object_id
  `).all(campaign.campaign_id) as WorldObjectProjectionRow[] : [];
  const sceneRow = database.prepare(`
    SELECT scene_id, name, summary, ${sceneContextColumns}
    FROM campaign_scene_projections WHERE campaign_id = ?
  `).get(campaign.campaign_id) as SceneProjectionRow | undefined;
  const sceneArchiveRows = hasCurrentSceneArchiveProjections(database) ? database.prepare(`
    SELECT scene_archive_id, name, summary, place_id, actor_ids_json, item_ids_json,
           world_object_ids_json, outcomes_json, open_threads_json, closed_at
    FROM campaign_scene_archive_projections
    WHERE campaign_id = ? ORDER BY closed_at DESC, scene_archive_id
  `).all(campaign.campaign_id) as SceneArchiveProjectionRow[] : [];

  return {
    campaign: {
      id: campaign.campaign_id,
      title: campaign.title,
      status: campaign.status,
      revision: Number(campaign.current_revision),
      createdAt: campaign.created_at,
      updatedAt: campaign.updated_at,
      ...(campaign.lineage_json == null
        ? {}
        : { lineage: parseJson<NonNullable<CampaignState['campaign']['lineage']>>(campaign.lineage_json) }),
    },
    actors: Object.fromEntries(actorRows.map(row => [row.actor_id, {
      id: row.actor_id,
      name: row.name,
      ...(row.aliases_json === null ? {} : { aliases: parseJson<string[]>(row.aliases_json) }),
      summary: row.summary,
      ...(row.visibility === null ? {} : { visibility: row.visibility }),
      ...(row.trackers_json === null ? {} : { trackers: parseJson<NonNullable<CampaignActor['trackers']>>(row.trackers_json) }),
      archived: Boolean(row.archived),
    } satisfies CampaignActor])),
    items: Object.fromEntries(itemRows.map(row => [row.item_id, {
      id: row.item_id,
      name: row.name,
      ...(row.aliases_json === null ? {} : { aliases: parseJson<string[]>(row.aliases_json) }),
      summary: row.summary,
      ...(row.visibility === null ? {} : { visibility: row.visibility }),
      archived: Boolean(row.archived),
      ...(row.owner_actor_id === null ? {} : { ownerActorId: row.owner_actor_id }),
    } satisfies CampaignItem])),
    quests: Object.fromEntries(questRows.map(row => [row.quest_id, {
      id: row.quest_id,
      name: row.name,
      ...(row.aliases_json === null ? {} : { aliases: parseJson<string[]>(row.aliases_json) }),
      summary: row.summary,
      ...(row.visibility === null ? {} : { visibility: row.visibility }),
      status: row.status,
      archived: Boolean(row.archived),
    } satisfies CampaignQuest])),
    places: Object.fromEntries(placeRows.map(row => [row.place_id, {
      id: row.place_id,
      name: row.name,
      ...(row.aliases_json === null ? {} : { aliases: parseJson<string[]>(row.aliases_json) }),
      summary: row.summary,
      ...(row.visibility === null ? {} : { visibility: row.visibility }),
      archived: Boolean(row.archived),
    } satisfies CampaignPlace])),
    facts: Object.fromEntries(factRows.map(row => [row.fact_id, {
      id: row.fact_id,
      name: row.name,
      ...(row.aliases_json === null ? {} : { aliases: parseJson<string[]>(row.aliases_json) }),
      summary: row.summary,
      ...(row.visibility === null ? {} : { visibility: row.visibility }),
      archived: Boolean(row.archived),
      ...(row.subject_id === null ? {} : { subjectId: row.subject_id }),
    } satisfies CampaignFact])),
    worldObjects: Object.fromEntries(worldObjectRows.map(row => [row.world_object_id, {
      id: row.world_object_id,
      name: row.name,
      ...(row.aliases_json === null ? {} : { aliases: parseJson<string[]>(row.aliases_json) }),
      summary: row.summary,
      ...(row.visibility === null ? {} : { visibility: row.visibility }),
      archived: Boolean(row.archived),
      ...(row.place_id === null ? {} : { placeId: row.place_id }),
    } satisfies CampaignWorldObject])),
    abilities: Object.fromEntries(abilityRows.map(row => [row.ability_id, {
      id: row.ability_id,
      name: row.name,
      ...(row.aliases_json === null ? {} : { aliases: parseJson<string[]>(row.aliases_json) }),
      summary: row.summary,
      ...(row.visibility === null ? {} : { visibility: row.visibility }),
      category: row.category,
      archived: Boolean(row.archived),
    } satisfies CampaignAbility])),
    learnedAbilities: Object.fromEntries(learnedAbilityRows.map(row => [row.learned_ability_id, {
      id: row.learned_ability_id,
      abilityId: row.ability_id,
      actorId: row.actor_id,
      prepared: Boolean(row.prepared),
      enabled: Boolean(row.enabled),
      ...(row.uses_remaining === null ? {} : { usesRemaining: Number(row.uses_remaining) }),
      ...(row.uses_maximum === null ? {} : { usesMaximum: Number(row.uses_maximum) }),
      archived: Boolean(row.archived),
    } satisfies CampaignLearnedAbility])),
    relationships: Object.fromEntries(relationshipRows.map(row => [row.relationship_id, {
      id: row.relationship_id,
      sourceActorId: row.source_actor_id,
      targetActorId: row.target_actor_id,
      kind: row.relationship_kind,
      status: row.status,
      notes: row.notes,
      ...(row.visibility === null ? {} : { visibility: row.visibility }),
      archived: Boolean(row.archived),
    } satisfies CampaignRelationship])),
    currentScene: sceneRow ? {
      id: sceneRow.scene_id,
      name: sceneRow.name,
      summary: sceneRow.summary,
      ...(sceneRow.place_id === null ? {} : { placeId: sceneRow.place_id }),
      ...(sceneRow.actor_ids_json === null ? {} : { actorIds: parseJson<string[]>(sceneRow.actor_ids_json) }),
      ...(sceneRow.item_ids_json === null ? {} : { itemIds: parseJson<string[]>(sceneRow.item_ids_json) }),
      ...(sceneRow.world_object_ids_json === null ? {} : { worldObjectIds: parseJson<string[]>(sceneRow.world_object_ids_json) }),
    } satisfies CampaignScene : null,
    sceneArchives: Object.fromEntries(sceneArchiveRows.map(row => [row.scene_archive_id, {
      id: row.scene_archive_id,
      name: row.name,
      summary: row.summary,
      ...(row.place_id === null ? {} : { placeId: row.place_id }),
      ...(row.actor_ids_json === null ? {} : { actorIds: parseJson<string[]>(row.actor_ids_json) }),
      ...(row.item_ids_json === null ? {} : { itemIds: parseJson<string[]>(row.item_ids_json) }),
      ...(row.world_object_ids_json === null ? {} : { worldObjectIds: parseJson<string[]>(row.world_object_ids_json) }),
      outcomes: parseJson<string[]>(row.outcomes_json),
      openThreads: parseJson<string[]>(row.open_threads_json),
      closedAt: row.closed_at,
    } satisfies CampaignSceneArchive])),
  };
}

export function replaceCurrentCampaignProjections(
  database: DatabaseSync,
  campaignId: string,
  state: CampaignState,
): void {
  database.prepare('DELETE FROM campaign_actor_projections WHERE campaign_id = ?').run(campaignId);
  database.prepare('DELETE FROM campaign_item_projections WHERE campaign_id = ?').run(campaignId);
  database.prepare('DELETE FROM campaign_quest_projections WHERE campaign_id = ?').run(campaignId);
  database.prepare('DELETE FROM campaign_place_projections WHERE campaign_id = ?').run(campaignId);
  if (hasCurrentWorldRecordProjections(database)) {
    database.prepare('DELETE FROM campaign_fact_projections WHERE campaign_id = ?').run(campaignId);
    database.prepare('DELETE FROM campaign_world_object_projections WHERE campaign_id = ?').run(campaignId);
  }
  if (hasCurrentAbilityProjections(database)) {
    database.prepare('DELETE FROM campaign_ability_projections WHERE campaign_id = ?').run(campaignId);
    database.prepare('DELETE FROM campaign_learned_ability_projections WHERE campaign_id = ?').run(campaignId);
  }
  if (hasCurrentRelationshipProjections(database)) {
    database.prepare('DELETE FROM campaign_relationship_projections WHERE campaign_id = ?').run(campaignId);
  }
  database.prepare('DELETE FROM campaign_scene_projections WHERE campaign_id = ?').run(campaignId);
  if (hasCurrentSceneArchiveProjections(database)) {
    database.prepare('DELETE FROM campaign_scene_archive_projections WHERE campaign_id = ?').run(campaignId);
  }

  for (const actor of Object.values(state.actors)) upsertActor(database, campaignId, actor);
  for (const item of Object.values(state.items)) upsertItem(database, campaignId, item);
  for (const quest of Object.values(state.quests ?? {})) upsertQuest(database, campaignId, quest);
  for (const place of Object.values(state.places ?? {})) upsertPlace(database, campaignId, place);
  for (const fact of Object.values(state.facts ?? {})) upsertFact(database, campaignId, fact);
  for (const worldObject of Object.values(state.worldObjects ?? {})) upsertWorldObject(database, campaignId, worldObject);
  for (const ability of Object.values(state.abilities ?? {})) upsertAbility(database, campaignId, ability);
  for (const learned of Object.values(state.learnedAbilities ?? {})) upsertLearnedAbility(database, campaignId, learned);
  for (const relationship of Object.values(state.relationships ?? {})) upsertRelationship(database, campaignId, relationship);
  if (state.currentScene) upsertScene(database, campaignId, state.currentScene);
  for (const archive of Object.values(state.sceneArchives ?? {})) upsertSceneArchive(database, campaignId, archive);
}

export function applyCurrentCampaignProjectionChanges(
  database: DatabaseSync,
  campaignId: string,
  changes: readonly CampaignSubjectChange[],
): void {
  for (const change of changes) {
    if (change.subjectKind === 'campaign') continue;
    if (change.subjectKind === 'actor') {
      if (change.afterImage === null) {
        database.prepare('DELETE FROM campaign_actor_projections WHERE campaign_id = ? AND actor_id = ?')
          .run(campaignId, change.subjectId);
      } else {
        upsertActor(database, campaignId, change.afterImage as CampaignActor);
      }
      continue;
    }
    if (change.subjectKind === 'item') {
      if (change.afterImage === null) {
        database.prepare('DELETE FROM campaign_item_projections WHERE campaign_id = ? AND item_id = ?')
          .run(campaignId, change.subjectId);
      } else {
        upsertItem(database, campaignId, change.afterImage as CampaignItem);
      }
      continue;
    }
    if (change.subjectKind === 'quest') {
      if (change.afterImage === null) {
        database.prepare('DELETE FROM campaign_quest_projections WHERE campaign_id = ? AND quest_id = ?')
          .run(campaignId, change.subjectId);
      } else {
        upsertQuest(database, campaignId, change.afterImage as CampaignQuest);
      }
      continue;
    }
    if (change.subjectKind === 'place') {
      if (change.afterImage === null) {
        database.prepare('DELETE FROM campaign_place_projections WHERE campaign_id = ? AND place_id = ?')
          .run(campaignId, change.subjectId);
      } else {
        upsertPlace(database, campaignId, change.afterImage as CampaignPlace);
      }
      continue;
    }
    if (change.subjectKind === 'fact') {
      if (change.afterImage === null) {
        database.prepare('DELETE FROM campaign_fact_projections WHERE campaign_id = ? AND fact_id = ?')
          .run(campaignId, change.subjectId);
      } else {
        upsertFact(database, campaignId, change.afterImage as CampaignFact);
      }
      continue;
    }
    if (change.subjectKind === 'world_object') {
      if (change.afterImage === null) {
        database.prepare('DELETE FROM campaign_world_object_projections WHERE campaign_id = ? AND world_object_id = ?')
          .run(campaignId, change.subjectId);
      } else {
        upsertWorldObject(database, campaignId, change.afterImage as CampaignWorldObject);
      }
      continue;
    }
    if (change.subjectKind === 'ability') {
      if (change.afterImage === null) {
        database.prepare('DELETE FROM campaign_ability_projections WHERE campaign_id = ? AND ability_id = ?')
          .run(campaignId, change.subjectId);
      } else {
        upsertAbility(database, campaignId, change.afterImage as CampaignAbility);
      }
      continue;
    }
    if (change.subjectKind === 'learned_ability') {
      if (change.afterImage === null) {
        database.prepare('DELETE FROM campaign_learned_ability_projections WHERE campaign_id = ? AND learned_ability_id = ?')
          .run(campaignId, change.subjectId);
      } else {
        upsertLearnedAbility(database, campaignId, change.afterImage as CampaignLearnedAbility);
      }
      continue;
    }
    if (change.subjectKind === 'relationship') {
      if (change.afterImage === null) {
        database.prepare('DELETE FROM campaign_relationship_projections WHERE campaign_id = ? AND relationship_id = ?')
          .run(campaignId, change.subjectId);
      } else {
        upsertRelationship(database, campaignId, change.afterImage as CampaignRelationship);
      }
      continue;
    }
    if (change.subjectKind === 'scene_archive') {
      if (change.afterImage === null) {
        database.prepare('DELETE FROM campaign_scene_archive_projections WHERE campaign_id = ? AND scene_archive_id = ?')
          .run(campaignId, change.subjectId);
      } else {
        upsertSceneArchive(database, campaignId, change.afterImage as CampaignSceneArchive);
      }
      continue;
    }
    if (change.afterImage === null) {
      database.prepare('DELETE FROM campaign_scene_projections WHERE campaign_id = ?').run(campaignId);
    } else {
      upsertScene(database, campaignId, change.afterImage as CampaignScene);
    }
  }
}

function upsertActor(database: DatabaseSync, campaignId: string, actor: CampaignActor): void {
  if (!hasProjectionColumn(database, 'campaign_actor_projections', 'aliases_json')) {
    database.prepare(`
      INSERT INTO campaign_actor_projections(campaign_id, actor_id, name, summary, archived)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(campaign_id, actor_id) DO UPDATE SET
        name = excluded.name, summary = excluded.summary, archived = excluded.archived
    `).run(campaignId, actor.id, actor.name, actor.summary, actor.archived ? 1 : 0);
    return;
  }
  if (!hasProjectionColumn(database, 'campaign_actor_projections', 'trackers_json')) {
    database.prepare(`
      INSERT INTO campaign_actor_projections(campaign_id, actor_id, name, aliases_json, summary, visibility, archived)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(campaign_id, actor_id) DO UPDATE SET
        name = excluded.name, aliases_json = excluded.aliases_json, summary = excluded.summary,
        visibility = excluded.visibility, archived = excluded.archived
    `).run(campaignId, actor.id, actor.name, actor.aliases === undefined ? null : JSON.stringify(actor.aliases), actor.summary,
      actor.visibility ?? null, actor.archived ? 1 : 0);
    return;
  }
  database.prepare(`
    INSERT INTO campaign_actor_projections(campaign_id, actor_id, name, aliases_json, summary, visibility, trackers_json, archived)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(campaign_id, actor_id) DO UPDATE SET
      name = excluded.name, aliases_json = excluded.aliases_json, summary = excluded.summary,
      visibility = excluded.visibility, trackers_json = excluded.trackers_json, archived = excluded.archived
  `).run(campaignId, actor.id, actor.name, actor.aliases === undefined ? null : JSON.stringify(actor.aliases), actor.summary,
    actor.visibility ?? null, actor.trackers === undefined ? null : JSON.stringify(actor.trackers), actor.archived ? 1 : 0);
}

function upsertItem(database: DatabaseSync, campaignId: string, item: CampaignItem): void {
  if (!hasProjectionColumn(database, 'campaign_item_projections', 'aliases_json')) {
    database.prepare(`
      INSERT INTO campaign_item_projections(campaign_id, item_id, name, summary, archived, owner_actor_id)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(campaign_id, item_id) DO UPDATE SET
        name = excluded.name, summary = excluded.summary, archived = excluded.archived,
        owner_actor_id = excluded.owner_actor_id
    `).run(campaignId, item.id, item.name, item.summary, item.archived ? 1 : 0, item.ownerActorId ?? null);
    return;
  }
  database.prepare(`
    INSERT INTO campaign_item_projections(campaign_id, item_id, name, aliases_json, summary, visibility, archived, owner_actor_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(campaign_id, item_id) DO UPDATE SET
      name = excluded.name, aliases_json = excluded.aliases_json, summary = excluded.summary,
      visibility = excluded.visibility, archived = excluded.archived,
      owner_actor_id = excluded.owner_actor_id
  `).run(campaignId, item.id, item.name, item.aliases === undefined ? null : JSON.stringify(item.aliases), item.summary,
    item.visibility ?? null, item.archived ? 1 : 0, item.ownerActorId ?? null);
}

function upsertQuest(database: DatabaseSync, campaignId: string, quest: CampaignQuest): void {
  if (!hasProjectionColumn(database, 'campaign_quest_projections', 'aliases_json')) {
    database.prepare(`
      INSERT INTO campaign_quest_projections(campaign_id, quest_id, name, summary, status, archived)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(campaign_id, quest_id) DO UPDATE SET
        name = excluded.name, summary = excluded.summary, status = excluded.status,
        archived = excluded.archived
    `).run(campaignId, quest.id, quest.name, quest.summary, quest.status, quest.archived ? 1 : 0);
    return;
  }
  database.prepare(`
    INSERT INTO campaign_quest_projections(campaign_id, quest_id, name, aliases_json, summary, visibility, status, archived)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(campaign_id, quest_id) DO UPDATE SET
      name = excluded.name, aliases_json = excluded.aliases_json, summary = excluded.summary,
      visibility = excluded.visibility, status = excluded.status, archived = excluded.archived
  `).run(campaignId, quest.id, quest.name, quest.aliases === undefined ? null : JSON.stringify(quest.aliases), quest.summary,
    quest.visibility ?? null, quest.status, quest.archived ? 1 : 0);
}

function upsertPlace(database: DatabaseSync, campaignId: string, place: CampaignPlace): void {
  if (!hasProjectionColumn(database, 'campaign_place_projections', 'aliases_json')) {
    database.prepare(`
      INSERT INTO campaign_place_projections(campaign_id, place_id, name, summary, archived)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(campaign_id, place_id) DO UPDATE SET
        name = excluded.name, summary = excluded.summary, archived = excluded.archived
    `).run(campaignId, place.id, place.name, place.summary, place.archived ? 1 : 0);
    return;
  }
  database.prepare(`
    INSERT INTO campaign_place_projections(campaign_id, place_id, name, aliases_json, summary, visibility, archived)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(campaign_id, place_id) DO UPDATE SET
      name = excluded.name, aliases_json = excluded.aliases_json, summary = excluded.summary,
      visibility = excluded.visibility, archived = excluded.archived
  `).run(campaignId, place.id, place.name, place.aliases === undefined ? null : JSON.stringify(place.aliases), place.summary,
    place.visibility ?? null, place.archived ? 1 : 0);
}

function upsertFact(database: DatabaseSync, campaignId: string, fact: CampaignFact): void {
  database.prepare(`
    INSERT INTO campaign_fact_projections(
      campaign_id, fact_id, name, aliases_json, summary, visibility, archived, subject_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(campaign_id, fact_id) DO UPDATE SET
      name = excluded.name, aliases_json = excluded.aliases_json, summary = excluded.summary,
      visibility = excluded.visibility, archived = excluded.archived, subject_id = excluded.subject_id
  `).run(
    campaignId,
    fact.id,
    fact.name,
    fact.aliases === undefined ? null : JSON.stringify(fact.aliases),
    fact.summary,
    fact.visibility ?? null,
    fact.archived ? 1 : 0,
    fact.subjectId ?? null,
  );
}

function upsertWorldObject(database: DatabaseSync, campaignId: string, worldObject: CampaignWorldObject): void {
  database.prepare(`
    INSERT INTO campaign_world_object_projections(
      campaign_id, world_object_id, name, aliases_json, summary, visibility, archived, place_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(campaign_id, world_object_id) DO UPDATE SET
      name = excluded.name, aliases_json = excluded.aliases_json, summary = excluded.summary,
      visibility = excluded.visibility, archived = excluded.archived, place_id = excluded.place_id
  `).run(
    campaignId,
    worldObject.id,
    worldObject.name,
    worldObject.aliases === undefined ? null : JSON.stringify(worldObject.aliases),
    worldObject.summary,
    worldObject.visibility ?? null,
    worldObject.archived ? 1 : 0,
    worldObject.placeId ?? null,
  );
}

function upsertAbility(database: DatabaseSync, campaignId: string, ability: CampaignAbility): void {
  database.prepare(`
    INSERT INTO campaign_ability_projections(
      campaign_id, ability_id, name, aliases_json, summary, visibility, category, archived
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(campaign_id, ability_id) DO UPDATE SET
      name = excluded.name, aliases_json = excluded.aliases_json, summary = excluded.summary,
      visibility = excluded.visibility, category = excluded.category, archived = excluded.archived
  `).run(
    campaignId,
    ability.id,
    ability.name,
    ability.aliases === undefined ? null : JSON.stringify(ability.aliases),
    ability.summary,
    ability.visibility ?? null,
    ability.category,
    ability.archived ? 1 : 0,
  );
}

function upsertLearnedAbility(database: DatabaseSync, campaignId: string, learned: CampaignLearnedAbility): void {
  database.prepare(`
    INSERT INTO campaign_learned_ability_projections(
      campaign_id, learned_ability_id, ability_id, actor_id, prepared, enabled,
      uses_remaining, uses_maximum, archived
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(campaign_id, learned_ability_id) DO UPDATE SET
      ability_id = excluded.ability_id, actor_id = excluded.actor_id,
      prepared = excluded.prepared, enabled = excluded.enabled,
      uses_remaining = excluded.uses_remaining, uses_maximum = excluded.uses_maximum,
      archived = excluded.archived
  `).run(
    campaignId,
    learned.id,
    learned.abilityId,
    learned.actorId,
    learned.prepared ? 1 : 0,
    learned.enabled ? 1 : 0,
    learned.usesRemaining ?? null,
    learned.usesMaximum ?? null,
    learned.archived ? 1 : 0,
  );
}

function upsertRelationship(database: DatabaseSync, campaignId: string, relationship: CampaignRelationship): void {
  database.prepare(`
    INSERT INTO campaign_relationship_projections(
      campaign_id, relationship_id, source_actor_id, target_actor_id,
      relationship_kind, status, notes, visibility, archived
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(campaign_id, relationship_id) DO UPDATE SET
      source_actor_id = excluded.source_actor_id, target_actor_id = excluded.target_actor_id,
      relationship_kind = excluded.relationship_kind, status = excluded.status,
      notes = excluded.notes, visibility = excluded.visibility, archived = excluded.archived
  `).run(
    campaignId,
    relationship.id,
    relationship.sourceActorId,
    relationship.targetActorId,
    relationship.kind,
    relationship.status,
    relationship.notes,
    relationship.visibility ?? null,
    relationship.archived ? 1 : 0,
  );
}

function upsertScene(database: DatabaseSync, campaignId: string, scene: CampaignScene): void {
  if (!hasProjectionColumn(database, 'campaign_scene_projections', 'place_id')) {
    database.prepare(`
      INSERT INTO campaign_scene_projections(campaign_id, scene_id, name, summary)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(campaign_id) DO UPDATE SET
        scene_id = excluded.scene_id, name = excluded.name, summary = excluded.summary
    `).run(campaignId, scene.id, scene.name, scene.summary);
    return;
  }
  database.prepare(`
    INSERT INTO campaign_scene_projections(
      campaign_id, scene_id, name, summary, place_id, actor_ids_json, item_ids_json, world_object_ids_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(campaign_id) DO UPDATE SET
      scene_id = excluded.scene_id, name = excluded.name, summary = excluded.summary,
      place_id = excluded.place_id, actor_ids_json = excluded.actor_ids_json,
      item_ids_json = excluded.item_ids_json, world_object_ids_json = excluded.world_object_ids_json
  `).run(campaignId, scene.id, scene.name, scene.summary, scene.placeId ?? null,
    scene.actorIds === undefined ? null : JSON.stringify(scene.actorIds),
    scene.itemIds === undefined ? null : JSON.stringify(scene.itemIds),
    scene.worldObjectIds === undefined ? null : JSON.stringify(scene.worldObjectIds));
}

function upsertSceneArchive(database: DatabaseSync, campaignId: string, archive: CampaignSceneArchive): void {
  database.prepare(`
    INSERT INTO campaign_scene_archive_projections(
      campaign_id, scene_archive_id, name, summary, place_id, actor_ids_json, item_ids_json,
      world_object_ids_json, outcomes_json, open_threads_json, closed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(campaign_id, scene_archive_id) DO UPDATE SET
      name = excluded.name, summary = excluded.summary, place_id = excluded.place_id,
      actor_ids_json = excluded.actor_ids_json, item_ids_json = excluded.item_ids_json,
      world_object_ids_json = excluded.world_object_ids_json,
      outcomes_json = excluded.outcomes_json, open_threads_json = excluded.open_threads_json,
      closed_at = excluded.closed_at
  `).run(
    campaignId,
    archive.id,
    archive.name,
    archive.summary,
    archive.placeId ?? null,
    archive.actorIds === undefined ? null : JSON.stringify(archive.actorIds),
    archive.itemIds === undefined ? null : JSON.stringify(archive.itemIds),
    archive.worldObjectIds === undefined ? null : JSON.stringify(archive.worldObjectIds),
    JSON.stringify(archive.outcomes),
    JSON.stringify(archive.openThreads),
    archive.closedAt,
  );
}
