import type { LegacyImportIssue } from '@st-llm-rpg/wire';
import type { CampaignState } from '../campaign/campaign-state.js';

type UnknownRecord = Record<string, unknown>;

export type LegacyEnvelopeInspection = Readonly<{
  valid: boolean;
  title: string;
  legacyRevision: number;
  counts: Readonly<{
    actors: number;
    items: number;
    quests: number;
    places: number;
    abilities: number;
    learnedAbilities: number;
    unsupported: number;
  }>;
  issues: readonly LegacyImportIssue[];
  state: CampaignState | null;
}>;

function object(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function bounded(value: unknown, maximum: number): string {
  return text(value).slice(0, maximum);
}

function validId(value: string): boolean {
  return value.length > 0
    && value.length <= 128
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

export function inspectLegacyEnvelope(
  envelopeValue: unknown,
  now = new Date(),
): LegacyEnvelopeInspection {
  const issues: LegacyImportIssue[] = [];
  const envelope = object(envelopeValue);
  const campaign = object(envelope?.campaign);
  const legacyRevision = Number(campaign?.revision);
  const rawTitle = text(campaign?.title) || 'Imported Campaign';
  const title = rawTitle.slice(0, 160);

  const error = (code: string, path: string, message: string) => {
    issues.push({ severity: 'error', code, path, message });
  };
  const warning = (code: string, path: string, message: string) => {
    issues.push({ severity: 'warning', code, path, message });
  };

  if (envelope?.envelopeVersion !== 1) error('unsupported-envelope-version', 'envelopeVersion', 'Only legacy Campaign envelope version 1 can be imported.');
  if (!campaign) error('campaign-missing', 'campaign', 'Legacy metadata does not contain a Campaign object.');
  if (campaign?.schemaVersion !== 1) error('unsupported-campaign-version', 'campaign.schemaVersion', 'Only legacy Campaign schema version 1 can be imported.');
  if (!text(campaign?.instanceId) || !text(campaign?.commitId)) error('campaign-identity-missing', 'campaign', 'Legacy Campaign identity is incomplete.');
  if (!Number.isInteger(legacyRevision) || legacyRevision < 1) error('campaign-revision-invalid', 'campaign.revision', 'Legacy Campaign revision must be a positive integer.');
  if (!Array.isArray(campaign?.records)) error('records-invalid', 'campaign.records', 'Legacy Campaign records must be an array.');
  for (const key of ['possessions', 'learnedAbilities', 'relationships', 'sceneArchives', 'proposals'] as const) {
    if (!Array.isArray(campaign?.[key])) error('collection-invalid', `campaign.${key}`, `Legacy Campaign ${key} must be an array.`);
  }
  if (rawTitle.length > 160) warning('title-truncated', 'campaign.title', 'Campaign title exceeds 160 characters and will be truncated in Campaign Book.');

  const records = Array.isArray(campaign?.records) ? campaign.records : [];
  const counts = { actors: 0, items: 0, quests: 0, places: 0, abilities: 0, learnedAbilities: 0, unsupported: 0 };
  const actors: CampaignState['actors'] = {};
  const items: CampaignState['items'] = {};
  const quests: NonNullable<CampaignState['quests']> = {};
  const places: NonNullable<CampaignState['places']> = {};
  const abilities: NonNullable<CampaignState['abilities']> = {};
  const learnedAbilities: NonNullable<CampaignState['learnedAbilities']> = {};
  const allIds = new Set<string>();
  const supportedKinds = new Set(['actor', 'item', 'quest', 'place', 'ability']);

  records.forEach((raw, index) => {
    const record = object(raw);
    const path = `campaign.records[${index}]`;
    if (!record) {
      error('record-invalid', path, 'Record must be an object.');
      return;
    }
    const kind = text(record.kind);
    if (!supportedKinds.has(kind)) {
      counts.unsupported += 1;
      warning('unsupported-record-kind', path, `${kind || 'Unknown record'} is preserved in the legacy source but is not projected into Campaign Book yet.`);
      return;
    }
    const id = text(record.id);
    const name = bounded(record.name, 160);
    if (!validId(id)) {
      error('record-id-invalid', `${path}.id`, 'Record ID is missing or contains unsupported characters.');
      return;
    }
    if (allIds.has(id)) {
      error('record-id-duplicate', `${path}.id`, `Record ID ${id} is duplicated.`);
      return;
    }
    allIds.add(id);
    if (!name) {
      error('record-name-missing', `${path}.name`, 'Record name is required.');
      return;
    }
    const summary = bounded(text(record.summary) || text(record.details), 4000);
    const archived = record.archivedAt !== null && record.archivedAt !== undefined && record.archivedAt !== '';
    if (kind === 'actor') {
      counts.actors += 1;
      actors[id] = { id, name, summary, archived };
    } else if (kind === 'item') {
      counts.items += 1;
      items[id] = { id, name, summary, archived };
    } else if (kind === 'quest') {
      counts.quests += 1;
      quests[id] = { id, name, summary, status: text(record.status) === 'completed' ? 'completed' : 'active', archived };
    } else if (kind === 'place') {
      counts.places += 1;
      places[id] = { id, name, summary, archived };
    } else {
      counts.abilities += 1;
      const category = ['spell', 'skill', 'feat'].includes(text(record.category))
        ? text(record.category) as 'spell' | 'skill' | 'feat'
        : 'other';
      abilities[id] = { id, name, summary, category, archived };
    }
  });

  const learnedEntries = Array.isArray(campaign?.learnedAbilities) ? campaign.learnedAbilities : [];
  learnedEntries.forEach((raw, index) => {
    const learned = object(raw);
    const path = `campaign.learnedAbilities[${index}]`;
    const id = text(learned?.id);
    const abilityId = text(learned?.abilityId);
    const actorId = text(learned?.actorId);
    if (!validId(id) || allIds.has(id)) {
      error('learned-ability-id-invalid', `${path}.id`, 'Learned Ability ID is invalid or duplicated.');
      return;
    }
    allIds.add(id);
    if (!abilities[abilityId] || !actors[actorId]) {
      warning('learned-ability-link-missing', path, 'Learned Ability refers to an Actor or Ability that is not projected.');
      return;
    }
    const remaining = Number(learned?.usesRemaining);
    const maximum = Number(learned?.usesMaximum);
    counts.learnedAbilities += 1;
    learnedAbilities[id] = {
      id,
      abilityId,
      actorId,
      prepared: learned?.prepared === true,
      enabled: learned?.enabled !== false,
      ...(Number.isInteger(remaining) && remaining >= 0 ? { usesRemaining: remaining } : {}),
      ...(Number.isInteger(maximum) && maximum >= 0 ? { usesMaximum: maximum } : {}),
      archived: learned?.archivedAt !== null && learned?.archivedAt !== undefined && learned?.archivedAt !== '',
    };
  });

  const possessions = Array.isArray(campaign?.possessions) ? campaign.possessions : [];
  possessions.forEach((raw, index) => {
    const possession = object(raw);
    const itemId = text(possession?.itemId);
    const ownerActorId = text(possession?.ownerActorId);
    if (!items[itemId]) {
      warning('possession-item-missing', `campaign.possessions[${index}].itemId`, 'Possession refers to an Item that is not projected.');
      return;
    }
    if (!actors[ownerActorId]) {
      warning('possession-owner-missing', `campaign.possessions[${index}].ownerActorId`, 'Possession owner is not a projected Actor; the Item will be unattached.');
      return;
    }
    if (items[itemId]?.ownerActorId && items[itemId]?.ownerActorId !== ownerActorId) {
      warning('multiple-possession-owners', `campaign.possessions[${index}]`, 'Campaign Book v1 can attach an Item to only one Actor; the first owner is used.');
      return;
    }
    items[itemId] = { ...items[itemId]!, ownerActorId };
  });

  const unsupportedCollections: Array<readonly [string, unknown, string]> = [
    ['relationships', campaign?.relationships, 'unsupported-relationship'],
    ['sceneArchives', campaign?.sceneArchives, 'unsupported-scene-archive'],
    ['proposals', campaign?.proposals, 'unsupported-proposal'],
  ];
  for (const [name, value, code] of unsupportedCollections) {
    const entries = Array.isArray(value) ? value : [];
    counts.unsupported += entries.length;
    if (entries.length > 0) {
      warning(code, `campaign.${name}`, `${entries.length} ${name} entr${entries.length === 1 ? 'y is' : 'ies are'} preserved in the legacy source but not projected yet.`);
    }
  }

  let currentScene: CampaignState['currentScene'] = null;
  if (campaign?.currentScene !== null && campaign?.currentScene !== undefined) {
    const scene = object(campaign.currentScene);
    const id = text(scene?.id) || 'current-scene';
    const name = bounded(text(scene?.title) || text(scene?.name), 160);
    if (!scene || !validId(id) || !name) {
      error('current-scene-invalid', 'campaign.currentScene', 'Current Scene requires a valid ID and title.');
    } else {
      currentScene = { id, name, summary: bounded(text(scene.summary) || text(scene.transitionNotes), 4000) };
    }
  }

  const valid = !issues.some(issue => issue.severity === 'error');
  if (!valid) {
    return { valid, title, legacyRevision: Number.isInteger(legacyRevision) ? legacyRevision : 1, counts, issues, state: null };
  }
  const timestamp = now.toISOString();
  return {
    valid,
    title,
    legacyRevision,
    counts,
    issues,
    state: {
      campaign: {
        id: 'legacy-import-pending',
        title,
        status: 'active',
        revision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      actors,
      items,
      quests,
      places,
      abilities,
      learnedAbilities,
      currentScene,
    },
  };
}
