import type {
  CampaignActor,
  CampaignItem,
  CampaignPlace,
  CampaignQuest,
  CampaignScene,
} from '@st-llm-rpg/wire';
import type { DatabaseSync } from 'node:sqlite';
import type { CampaignState, CampaignSubjectChange } from '../../modules/campaign/campaign-state.js';
import { normalizeCampaignState, parseJson } from '../../modules/campaign/campaign-state.js';
import type { CampaignRow } from './campaign-rows.js';

export const LEGACY_CURRENT_STATE_MARKER = '{}';

type ActorProjectionRow = {
  actor_id: string;
  name: string;
  summary: string;
  archived: number;
};

type ItemProjectionRow = {
  item_id: string;
  name: string;
  summary: string;
  archived: number;
  owner_actor_id: string | null;
};

type QuestProjectionRow = {
  quest_id: string;
  name: string;
  summary: string;
  status: CampaignQuest['status'];
  archived: number;
};

type PlaceProjectionRow = {
  place_id: string;
  name: string;
  summary: string;
  archived: number;
};

type SceneProjectionRow = {
  scene_id: string;
  name: string;
  summary: string;
};

export function hasCurrentCampaignProjections(database: DatabaseSync): boolean {
  return Boolean(database.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'campaign_actor_projections'
  `).get());
}

export function readCurrentCampaignState(database: DatabaseSync, campaign: CampaignRow): CampaignState {
  if (!hasCurrentCampaignProjections(database)) {
    return normalizeCampaignState(parseJson<CampaignState>(campaign.current_state_json));
  }

  const actorRows = database.prepare(`
    SELECT actor_id, name, summary, archived
    FROM campaign_actor_projections WHERE campaign_id = ? ORDER BY actor_id
  `).all(campaign.campaign_id) as ActorProjectionRow[];
  const itemRows = database.prepare(`
    SELECT item_id, name, summary, archived, owner_actor_id
    FROM campaign_item_projections WHERE campaign_id = ? ORDER BY item_id
  `).all(campaign.campaign_id) as ItemProjectionRow[];
  const questRows = database.prepare(`
    SELECT quest_id, name, summary, status, archived
    FROM campaign_quest_projections WHERE campaign_id = ? ORDER BY quest_id
  `).all(campaign.campaign_id) as QuestProjectionRow[];
  const placeRows = database.prepare(`
    SELECT place_id, name, summary, archived
    FROM campaign_place_projections WHERE campaign_id = ? ORDER BY place_id
  `).all(campaign.campaign_id) as PlaceProjectionRow[];
  const sceneRow = database.prepare(`
    SELECT scene_id, name, summary FROM campaign_scene_projections WHERE campaign_id = ?
  `).get(campaign.campaign_id) as SceneProjectionRow | undefined;

  return {
    campaign: {
      id: campaign.campaign_id,
      title: campaign.title,
      status: campaign.status,
      revision: Number(campaign.current_revision),
      createdAt: campaign.created_at,
      updatedAt: campaign.updated_at,
    },
    actors: Object.fromEntries(actorRows.map(row => [row.actor_id, {
      id: row.actor_id,
      name: row.name,
      summary: row.summary,
      archived: Boolean(row.archived),
    } satisfies CampaignActor])),
    items: Object.fromEntries(itemRows.map(row => [row.item_id, {
      id: row.item_id,
      name: row.name,
      summary: row.summary,
      archived: Boolean(row.archived),
      ...(row.owner_actor_id === null ? {} : { ownerActorId: row.owner_actor_id }),
    } satisfies CampaignItem])),
    quests: Object.fromEntries(questRows.map(row => [row.quest_id, {
      id: row.quest_id,
      name: row.name,
      summary: row.summary,
      status: row.status,
      archived: Boolean(row.archived),
    } satisfies CampaignQuest])),
    places: Object.fromEntries(placeRows.map(row => [row.place_id, {
      id: row.place_id,
      name: row.name,
      summary: row.summary,
      archived: Boolean(row.archived),
    } satisfies CampaignPlace])),
    currentScene: sceneRow ? {
      id: sceneRow.scene_id,
      name: sceneRow.name,
      summary: sceneRow.summary,
    } satisfies CampaignScene : null,
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
  database.prepare('DELETE FROM campaign_scene_projections WHERE campaign_id = ?').run(campaignId);

  for (const actor of Object.values(state.actors)) upsertActor(database, campaignId, actor);
  for (const item of Object.values(state.items)) upsertItem(database, campaignId, item);
  for (const quest of Object.values(state.quests ?? {})) upsertQuest(database, campaignId, quest);
  for (const place of Object.values(state.places ?? {})) upsertPlace(database, campaignId, place);
  if (state.currentScene) upsertScene(database, campaignId, state.currentScene);
}

export function applyCurrentCampaignProjectionChanges(
  database: DatabaseSync,
  campaignId: string,
  changes: readonly CampaignSubjectChange[],
): void {
  for (const change of changes) {
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
    if (change.afterImage === null) {
      database.prepare('DELETE FROM campaign_scene_projections WHERE campaign_id = ?').run(campaignId);
    } else {
      upsertScene(database, campaignId, change.afterImage as CampaignScene);
    }
  }
}

function upsertActor(database: DatabaseSync, campaignId: string, actor: CampaignActor): void {
  database.prepare(`
    INSERT INTO campaign_actor_projections(campaign_id, actor_id, name, summary, archived)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(campaign_id, actor_id) DO UPDATE SET
      name = excluded.name, summary = excluded.summary, archived = excluded.archived
  `).run(campaignId, actor.id, actor.name, actor.summary, actor.archived ? 1 : 0);
}

function upsertItem(database: DatabaseSync, campaignId: string, item: CampaignItem): void {
  database.prepare(`
    INSERT INTO campaign_item_projections(campaign_id, item_id, name, summary, archived, owner_actor_id)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(campaign_id, item_id) DO UPDATE SET
      name = excluded.name, summary = excluded.summary, archived = excluded.archived,
      owner_actor_id = excluded.owner_actor_id
  `).run(campaignId, item.id, item.name, item.summary, item.archived ? 1 : 0, item.ownerActorId ?? null);
}

function upsertQuest(database: DatabaseSync, campaignId: string, quest: CampaignQuest): void {
  database.prepare(`
    INSERT INTO campaign_quest_projections(campaign_id, quest_id, name, summary, status, archived)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(campaign_id, quest_id) DO UPDATE SET
      name = excluded.name, summary = excluded.summary, status = excluded.status, archived = excluded.archived
  `).run(campaignId, quest.id, quest.name, quest.summary, quest.status, quest.archived ? 1 : 0);
}

function upsertPlace(database: DatabaseSync, campaignId: string, place: CampaignPlace): void {
  database.prepare(`
    INSERT INTO campaign_place_projections(campaign_id, place_id, name, summary, archived)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(campaign_id, place_id) DO UPDATE SET
      name = excluded.name, summary = excluded.summary, archived = excluded.archived
  `).run(campaignId, place.id, place.name, place.summary, place.archived ? 1 : 0);
}

function upsertScene(database: DatabaseSync, campaignId: string, scene: CampaignScene): void {
  database.prepare(`
    INSERT INTO campaign_scene_projections(campaign_id, scene_id, name, summary)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(campaign_id) DO UPDATE SET
      scene_id = excluded.scene_id, name = excluded.name, summary = excluded.summary
  `).run(campaignId, scene.id, scene.name, scene.summary);
}
