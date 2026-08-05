import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export class OpsProblem extends Error {
  constructor(code, message, actions = [], details = undefined) {
    super(message);
    this.name = 'OpsProblem';
    this.code = code;
    this.actions = actions;
    this.details = details;
  }
}

export function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}

export function digest(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : stable(value)).digest('hex');
}

function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function now() { return new Date().toISOString(); }

function legacyCampaign(envelope) {
  const campaign = envelope?.campaign;
  if (!campaign || typeof campaign !== 'object') {
    throw new OpsProblem('legacy_envelope_invalid', 'Legacy metadata has no Campaign document.', ['return-to-fallback']);
  }
  if (!campaign.commitId || !Number.isInteger(campaign.revision) || campaign.revision < 1) {
    throw new OpsProblem('legacy_envelope_invalid', 'Legacy Campaign has no valid commit ID or revision.', ['return-to-fallback']);
  }
  if (!Array.isArray(campaign.records) || !Array.isArray(campaign.events)) {
    throw new OpsProblem('legacy_envelope_invalid', 'Legacy Campaign collections are incomplete.', ['return-to-fallback']);
  }
  return clone(campaign);
}

function legacySummary(campaign) {
  const count = (kind) => campaign.records.filter((record) => record?.kind === kind).length;
  return {
    title: String(campaign.title || campaign.name || 'Imported Campaign'),
    legacyRevision: campaign.revision,
    records: campaign.records.length,
    actors: count('actor'),
    items: count('item'),
    abilities: count('ability'),
    quests: count('quest'),
    facts: count('fact'),
    places: count('place'),
    worldObjects: count('world_object'),
    possessions: campaign.possessions?.length ?? 0,
    learnedAbilities: campaign.learnedAbilities?.length ?? 0,
    relationships: campaign.relationships?.length ?? 0,
    sceneArchives: campaign.sceneArchives?.length ?? 0,
    hasCurrentScene: Boolean(campaign.currentScene),
  };
}

export function createOperationsStore({ dbPath = ':memory:', id = randomUUID } = {}) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA foreign_keys=ON;
    PRAGMA journal_mode=WAL;
    PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS backups(
      backup_id TEXT PRIMARY KEY,
      reason TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS campaigns(
      campaign_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      revision INTEGER NOT NULL,
      source_kind TEXT NOT NULL,
      content_fingerprint TEXT,
      body_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bindings(
      binding_id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(campaign_id),
      locator TEXT NOT NULL,
      campaign_anchor INTEGER NOT NULL,
      binding_revision INTEGER NOT NULL,
      sync_boundary_json TEXT,
      marker_state TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS legacy_imports(
      source_fingerprint TEXT PRIMARY KEY,
      content_fingerprint TEXT NOT NULL,
      locator TEXT NOT NULL,
      campaign_id TEXT NOT NULL REFERENCES campaigns(campaign_id),
      binding_id TEXT NOT NULL REFERENCES bindings(binding_id),
      imported_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS legacy_content_idx ON legacy_imports(content_fingerprint);
    CREATE TABLE IF NOT EXISTS campaign_events(
      campaign_id TEXT NOT NULL REFERENCES campaigns(campaign_id),
      revision INTEGER NOT NULL,
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY(campaign_id, revision)
    );
    CREATE TABLE IF NOT EXISTS external_records(
      campaign_id TEXT NOT NULL REFERENCES campaigns(campaign_id),
      external_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      body_json TEXT NOT NULL,
      source_path TEXT NOT NULL,
      PRIMARY KEY(campaign_id, external_id)
    );
    CREATE TABLE IF NOT EXISTS addon_candidates(
      candidate_id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(campaign_id),
      expected_revision INTEGER NOT NULL,
      manifest_hash TEXT NOT NULL,
      preview_json TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  const q = {
    source: db.prepare('SELECT * FROM legacy_imports WHERE source_fingerprint=?'),
    content: db.prepare('SELECT * FROM legacy_imports WHERE content_fingerprint=? LIMIT 1'),
    campaign: db.prepare('SELECT * FROM campaigns WHERE campaign_id=?'),
    binding: db.prepare('SELECT * FROM bindings WHERE binding_id=?'),
    insertBackup: db.prepare('INSERT INTO backups VALUES(?,?,?,?)'),
    insertCampaign: db.prepare('INSERT INTO campaigns VALUES(?,?,?,?,?,?)'),
    insertBinding: db.prepare('INSERT INTO bindings VALUES(?,?,?,?,?,?,?)'),
    insertLegacy: db.prepare('INSERT INTO legacy_imports VALUES(?,?,?,?,?,?)'),
    insertEvent: db.prepare('INSERT INTO campaign_events VALUES(?,?,?,?)'),
    record: db.prepare('SELECT * FROM external_records WHERE campaign_id=? AND external_id=?'),
    allRecords: db.prepare('SELECT * FROM external_records WHERE campaign_id=? ORDER BY external_id'),
    upsertRecord: db.prepare(`INSERT INTO external_records VALUES(?,?,?,?,?)
      ON CONFLICT(campaign_id,external_id) DO UPDATE SET kind=excluded.kind,body_json=excluded.body_json,source_path=excluded.source_path`),
    insertCandidate: db.prepare('INSERT INTO addon_candidates VALUES(?,?,?,?,?,?,?)'),
    candidate: db.prepare('SELECT * FROM addon_candidates WHERE candidate_id=?'),
    applyCandidate: db.prepare("UPDATE addon_candidates SET status='applied' WHERE candidate_id=?"),
    updateCampaign: db.prepare('UPDATE campaigns SET revision=?,body_json=? WHERE campaign_id=?'),
    backups: db.prepare('SELECT * FROM backups ORDER BY created_at, backup_id'),
    events: db.prepare('SELECT * FROM campaign_events WHERE campaign_id=? ORDER BY revision'),
  };

  const tx = (fn) => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };

  function backup(reason) {
    const source = q.campaign.all().map((row) => ({ ...row })).sort((a, b) => a.campaign_id.localeCompare(b.campaign_id));
    const receipt = { backupId: id(), reason, sourceHash: digest(source), createdAt: now() };
    q.insertBackup.run(receipt.backupId, reason, receipt.sourceHash, receipt.createdAt);
    return receipt;
  }

  function previewLegacyImport({ envelope, locator }) {
    if (!locator) throw new OpsProblem('legacy_locator_missing', 'Current SillyTavern chat locator is required.', ['return-to-chat']);
    const campaign = legacyCampaign(envelope);
    const contentFingerprint = digest(campaign);
    const sourceFingerprint = digest({ contentFingerprint, locator });
    const exact = q.source.get(sourceFingerprint);
    if (exact) {
      return {
        kind: 'already-imported', sourceFingerprint, contentFingerprint,
        campaignId: exact.campaign_id, bindingId: exact.binding_id,
        actions: ['open-existing-campaign'], summary: legacySummary(campaign),
      };
    }
    const copied = q.content.get(contentFingerprint);
    return {
      kind: copied ? 'copied-source' : 'new-import',
      sourceFingerprint, contentFingerprint, locator,
      existingCampaignId: copied?.campaign_id ?? null,
      existingBindingId: copied?.binding_id ?? null,
      actions: copied ? ['link-existing', 'create-independent-import', 'cancel'] : ['create-campaign', 'cancel'],
      summary: legacySummary(campaign),
      campaign,
      previewHash: digest({ sourceFingerprint, contentFingerprint, locator, campaign }),
      legacyMetadataPreserved: true,
    };
  }

  function applyLegacyImport(preview, { decision = 'create-campaign', title } = {}) {
    if (!['new-import', 'copied-source'].includes(preview?.kind)) {
      throw new OpsProblem('legacy_preview_not_applicable', 'This preview cannot create another Campaign.', ['open-existing-campaign']);
    }
    const recalculated = digest({
      sourceFingerprint: preview.sourceFingerprint,
      contentFingerprint: preview.contentFingerprint,
      locator: preview.locator,
      campaign: preview.campaign,
    });
    if (recalculated !== preview.previewHash) throw new OpsProblem('legacy_preview_stale', 'Legacy preview changed before acceptance.', ['preview-again']);
    if (preview.kind === 'copied-source' && decision === 'link-existing') {
      return { kind: 'link-existing-required', campaignId: preview.existingCampaignId, bindingId: preview.existingBindingId };
    }
    if (!['create-campaign', 'create-independent-import'].includes(decision)) {
      throw new OpsProblem('legacy_decision_invalid', 'Choose an explicit import decision.', preview.actions);
    }
    if (q.source.get(preview.sourceFingerprint)) return previewLegacyImport({ envelope: { campaign: preview.campaign }, locator: preview.locator });

    const backupReceipt = backup('before-legacy-import');
    return tx(() => {
      if (q.source.get(preview.sourceFingerprint)) throw new OpsProblem('legacy_import_raced', 'Legacy source was imported by another tab.', ['open-existing-campaign']);
      const campaignId = id();
      const bindingId = id();
      const imported = {
        ...clone(preview.campaign),
        id: campaignId,
        title: String(title || preview.summary.title),
        revision: 1,
        legacyImport: {
          sourceFingerprint: preview.sourceFingerprint,
          contentFingerprint: preview.contentFingerprint,
          legacyRevision: preview.summary.legacyRevision,
          importedAt: now(),
        },
      };
      q.insertCampaign.run(campaignId, imported.title, 1, 'legacy_import', preview.contentFingerprint, JSON.stringify(imported));
      q.insertEvent.run(campaignId, 1, 'campaign-imported-from-legacy-metadata', JSON.stringify({
        sourceFingerprint: preview.sourceFingerprint,
        legacyRevision: preview.summary.legacyRevision,
        summary: preview.summary,
      }));
      q.insertBinding.run(bindingId, campaignId, preview.locator, 1, 1, null, 'pending-chat-marker');
      q.insertLegacy.run(preview.sourceFingerprint, preview.contentFingerprint, preview.locator, campaignId, bindingId, now());
      return {
        kind: 'imported', campaignId, bindingId, campaignRevision: 1, bindingRevision: 1,
        markerState: 'pending-chat-marker', backupReceipt, legacyMetadataPreserved: true,
      };
    });
  }

  function campaignView(campaignId) {
    const row = q.campaign.get(campaignId);
    if (!row) throw new OpsProblem('campaign_not_found', campaignId);
    return { campaignId, title: row.title, revision: row.revision, body: JSON.parse(row.body_json) };
  }

  function previewAddon({ campaignId, sourcePath, document, manifestHash = digest(document) }) {
    const campaign = campaignView(campaignId);
    if (!document || !Array.isArray(document.records)) {
      throw new OpsProblem('addon_invalid', 'Addon must contain a records array.', ['fix-file', 'rescan']);
    }
    const seen = new Set();
    const creates = [], updates = [], unchanged = [], warnings = [];
    for (const raw of document.records) {
      const externalId = String(raw?.externalId ?? '').trim();
      const kind = String(raw?.kind ?? '').trim();
      if (!externalId || !kind) { warnings.push({ code: 'missing_identity', record: raw }); continue; }
      if (seen.has(externalId)) throw new OpsProblem('addon_duplicate_external_id', `Duplicate external ID: ${externalId}`, ['fix-file']);
      seen.add(externalId);
      const normalized = { ...clone(raw), externalId, kind };
      const existing = q.record.get(campaignId, externalId);
      if (!existing) creates.push(normalized);
      else if (digest(JSON.parse(existing.body_json)) === digest(normalized)) unchanged.push(normalized);
      else updates.push({ before: JSON.parse(existing.body_json), after: normalized });
    }
    const preview = {
      campaignId, sourcePath, expectedRevision: campaign.revision, manifestHash,
      creates, updates, unchanged, warnings,
      deletionPolicy: 'missing-rows-do-not-delete',
    };
    const candidateId = id();
    q.insertCandidate.run(candidateId, campaignId, campaign.revision, manifestHash, JSON.stringify(preview), 'pending', now());
    return { candidateId, ...preview };
  }

  function applyAddon(candidateId, { manifestHash, expectedRevision }) {
    const row = q.candidate.get(candidateId);
    if (!row) throw new OpsProblem('addon_candidate_not_found', candidateId, ['rescan']);
    if (row.status !== 'pending') throw new OpsProblem('addon_candidate_not_pending', row.status, ['rescan']);
    const preview = JSON.parse(row.preview_json);
    if (manifestHash !== row.manifest_hash) throw new OpsProblem('addon_candidate_stale', 'Addon files changed after preview.', ['rescan']);
    const campaign = campaignView(row.campaign_id);
    if (expectedRevision !== row.expected_revision || campaign.revision !== row.expected_revision) {
      throw new OpsProblem('campaign_revision_conflict', 'Campaign changed after addon preview.', ['reload-diff']);
    }
    const changed = preview.creates.length + preview.updates.length;
    if (!changed) return { kind: 'no-changes', candidateId, revision: campaign.revision };
    const backupReceipt = backup('before-addon-import');
    return tx(() => {
      const current = campaignView(row.campaign_id);
      if (current.revision !== row.expected_revision) throw new OpsProblem('campaign_revision_conflict', 'Campaign changed during addon apply.', ['reload-diff']);
      for (const record of preview.creates) q.upsertRecord.run(row.campaign_id, record.externalId, record.kind, JSON.stringify(record), preview.sourcePath);
      for (const change of preview.updates) q.upsertRecord.run(row.campaign_id, change.after.externalId, change.after.kind, JSON.stringify(change.after), preview.sourcePath);
      const nextRevision = current.revision + 1;
      const body = { ...current.body, revision: nextRevision };
      q.updateCampaign.run(nextRevision, JSON.stringify(body), row.campaign_id);
      q.insertEvent.run(row.campaign_id, nextRevision, 'addon-import-applied', JSON.stringify({
        candidateId, sourcePath: preview.sourcePath,
        createdExternalIds: preview.creates.map((record) => record.externalId),
        updatedExternalIds: preview.updates.map((change) => change.after.externalId),
        manifestHash,
      }));
      q.applyCandidate.run(candidateId);
      return { kind: 'applied', candidateId, revision: nextRevision, changed, backupReceipt };
    });
  }

  return {
    previewLegacyImport, applyLegacyImport, previewAddon, applyAddon, campaignView,
    bindingView: (bindingId) => q.binding.get(bindingId),
    records: (campaignId) => q.allRecords.all(campaignId).map((row) => JSON.parse(row.body_json)),
    events: (campaignId) => q.events.all(campaignId).map((row) => ({ ...row, payload: JSON.parse(row.payload_json) })),
    backups: () => q.backups.all(), close: () => db.close(),
  };
}
