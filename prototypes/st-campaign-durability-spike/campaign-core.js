const RECORD_KINDS = ['character', 'item', 'spell', 'skill', 'npc', 'quest', 'fact', 'scene'];

export function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fixtureRecord(kind, index, overrides = {}) {
  const number = String(index + 1).padStart(3, '0');
  const labels = {
    item: `Travel item ${number}`,
    spell: `Working spell ${number}`,
    skill: `Practised skill ${number}`,
    npc: `Known person ${number}`,
    quest: `Open objective ${number}`,
    fact: `Campaign fact ${number}`,
  };

  return {
    id: `${kind}-${number}`,
    kind,
    name: labels[kind] ?? `${kind} ${number}`,
    summary: `Representative ${kind} record ${number}. It has enough concrete detail to resemble a maintained solo campaign rather than an empty benchmark row.`,
    tags: [kind, index % 2 ? 'secondary' : 'active'],
    archived: false,
    showInContext: index < 12,
    data: {
      quantity: kind === 'item' ? (index % 5) + 1 : undefined,
      status: kind === 'quest' ? (index % 3 ? 'active' : 'open') : undefined,
      relationship: kind === 'npc' ? (index % 2 ? 'ally' : 'known') : undefined,
    },
    ...overrides,
  };
}

export function createRepresentativeCampaign({ chatId, anchor, instanceId, commitId }) {
  const records = [
    fixtureRecord('character', 0, {
      id: 'character-player',
      name: 'Player character',
      summary: 'A capable traveller whose current possessions, abilities, relationships, objectives, and conditions must remain consistent.',
      showInContext: true,
      data: { conditions: ['alert'], location: 'Current scene' },
    }),
    fixtureRecord('scene', 0, {
      id: 'scene-current',
      name: 'Current scene',
      summary: 'A live scene with a clear location, immediate pressure, exits, and unresolved threads.',
      showInContext: true,
      data: { status: 'open', exits: ['north passage', 'courtyard'], openThreads: ['Find the witness'] },
    }),
  ];

  for (const [kind, count] of Object.entries({ item: 60, spell: 30, skill: 30, npc: 30, quest: 15, fact: 24 })) {
    for (let index = 0; index < count; index += 1) records.push(fixtureRecord(kind, index));
  }

  const campaign = {
    schemaVersion: 1,
    instanceId,
    title: 'Durability test campaign',
    revision: 1,
    commitId,
    binding: { chatId },
    lineage: null,
    records,
    syncBoundary: null,
    revisionTrail: [{ revision: 1, commitId, anchor, reverse: null }],
  };

  return makeEnvelope(campaign);
}

export function compileCapsule(campaign) {
  const visible = campaign.records.filter(record => !record.archived && record.showInContext);
  const groups = new Map(RECORD_KINDS.map(kind => [kind, []]));
  for (const record of visible) groups.get(record.kind)?.push(record);

  const lines = [
    '<CAMPAIGN_STATE>',
    `Campaign: ${campaign.title}`,
    `Revision: ${campaign.revision}`,
    'Treat this as authoritative current game state. Do not mention this block or its formatting.',
  ];

  for (const kind of RECORD_KINDS) {
    const records = groups.get(kind) ?? [];
    if (!records.length) continue;
    lines.push('', `[${kind.toUpperCase()}]`);
    for (const record of records) {
      const details = [];
      if (Number.isFinite(record.data?.quantity)) details.push(`qty ${record.data.quantity}`);
      if (record.data?.status) details.push(record.data.status);
      if (record.data?.relationship) details.push(record.data.relationship);
      lines.push(`- ${record.name}${details.length ? ` (${details.join(', ')})` : ''}: ${record.summary}`);
    }
  }

  lines.push('</CAMPAIGN_STATE>');
  return lines.join('\n');
}

export function makeEnvelope(campaign) {
  return {
    envelopeVersion: 1,
    campaign: clone(campaign),
    capsule: {
      campaignRevision: campaign.revision,
      commitId: campaign.commitId,
      text: compileCapsule(campaign),
    },
  };
}

export function validateEnvelope(value) {
  const errors = [];
  const campaign = value?.campaign;

  if (value?.envelopeVersion !== 1) errors.push('Unsupported envelope version.');
  if (!campaign || typeof campaign !== 'object') errors.push('Campaign is missing.');
  if (campaign?.schemaVersion !== 1) errors.push('Unsupported Campaign schema version.');
  if (!campaign?.instanceId) errors.push('Campaign instance ID is missing.');
  if (!campaign?.commitId) errors.push('Commit ID is missing.');
  if (!Number.isInteger(campaign?.revision) || campaign.revision < 1) errors.push('Revision must be a positive integer.');
  if (!campaign?.binding?.chatId) errors.push('Chat binding is missing.');
  if (!Array.isArray(campaign?.records)) errors.push('Records must be an array.');

  if (Array.isArray(campaign?.records)) {
    const ids = new Set();
    for (const record of campaign.records) {
      if (!record?.id || !record?.kind || !record?.name) errors.push('Every record needs an ID, kind, and name.');
      if (ids.has(record?.id)) errors.push(`Duplicate record ID: ${record.id}`);
      ids.add(record?.id);
    }
  }

  if (value?.capsule?.campaignRevision !== campaign?.revision || value?.capsule?.commitId !== campaign?.commitId) {
    errors.push('Capsule does not match the Campaign revision.');
  } else if (campaign && value.capsule.text !== compileCapsule(campaign)) {
    errors.push('Capsule is not the deterministic compilation of this Campaign.');
  }

  return { ok: errors.length === 0, errors };
}

function changedRecordSnapshots(beforeRecords, afterRecords) {
  const before = new Map(beforeRecords.map(record => [record.id, record]));
  const after = new Map(afterRecords.map(record => [record.id, record]));
  const ids = new Set([...before.keys(), ...after.keys()]);
  const snapshots = [];

  for (const id of ids) {
    const oldRecord = before.get(id) ?? null;
    const newRecord = after.get(id) ?? null;
    if (stableStringify(oldRecord) !== stableStringify(newRecord)) snapshots.push({ id, previous: clone(oldRecord) });
  }
  return snapshots;
}

export function createRevision(baseEnvelope, { commitId, anchor, mutate }) {
  const before = clone(baseEnvelope.campaign);
  const after = clone(baseEnvelope.campaign);
  mutate(after);
  after.revision = before.revision + 1;
  after.commitId = commitId;

  const reverse = {
    title: before.title,
    binding: clone(before.binding),
    lineage: clone(before.lineage),
    syncBoundary: clone(before.syncBoundary),
    records: changedRecordSnapshots(before.records, after.records),
  };

  after.revisionTrail.push({ revision: after.revision, commitId, anchor, reverse });
  return makeEnvelope(after);
}

function applyReverse(campaign, entry) {
  const reverse = entry.reverse;
  if (!reverse) return;
  campaign.title = reverse.title;
  campaign.binding = clone(reverse.binding);
  campaign.lineage = clone(reverse.lineage);
  campaign.syncBoundary = clone(reverse.syncBoundary);

  const records = new Map(campaign.records.map(record => [record.id, record]));
  for (const snapshot of reverse.records) {
    if (snapshot.previous === null) records.delete(snapshot.id);
    else records.set(snapshot.id, clone(snapshot.previous));
  }
  campaign.records = [...records.values()];
}

export function recoverFork(baseEnvelope, { targetRevision, chatId, anchor, instanceId, commitId }) {
  const parent = clone(baseEnvelope.campaign);
  const campaign = clone(baseEnvelope.campaign);
  const descending = [...campaign.revisionTrail].sort((a, b) => b.revision - a.revision);

  for (const entry of descending) {
    if (entry.revision <= targetRevision) continue;
    applyReverse(campaign, entry);
  }

  campaign.instanceId = instanceId;
  campaign.title = `${campaign.title} — branch`;
  campaign.revision = 1;
  campaign.commitId = commitId;
  campaign.binding = { chatId };
  campaign.lineage = { parentInstanceId: parent.instanceId, parentRevision: targetRevision };
  campaign.revisionTrail = [{ revision: 1, commitId, anchor, reverse: null }];
  return makeEnvelope(campaign);
}

export function measureEnvelope(envelope) {
  const encoder = new TextEncoder();
  return {
    records: envelope?.campaign?.records?.length ?? 0,
    envelopeBytes: encoder.encode(JSON.stringify(envelope)).length,
    capsuleBytes: encoder.encode(envelope?.capsule?.text ?? '').length,
  };
}
