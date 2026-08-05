import { performance } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';
import { copyFile, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import {
  AuthoritySpike,
  canonicalJson,
  corruptFileCopy,
  restoreDatabase,
  sha256,
  SpikeProblem,
  validateDatabase,
} from './authority-spike.mjs';

const HUMAN = Object.freeze({ kind: 'prototype-human', clientId: 'evidence-trace' });
const LOCATOR = Object.freeze({ ownerKind: 'character', owner: 'Narrator', chat: 'main' });

function check(condition, message, details = null) {
  if (!condition) {
    const suffix = details == null ? '' : `\n${JSON.stringify(details, null, 2)}`;
    throw new Error(`CHECK FAILED: ${message}${suffix}`);
  }
}

function accepted(outcome, label) {
  check(outcome?.ok === true, `${label} should be accepted`, outcome);
  return outcome.value;
}

function rejected(outcome, code, label) {
  check(outcome?.ok === false, `${label} should be rejected`, outcome);
  check(outcome.problem?.code === code, `${label} should reject with ${code}`, outcome);
  return outcome.problem;
}

function semanticBranchState(state) {
  return { subjects: state.subjects, references: state.references };
}

function printStep(number, title, evidence) {
  console.log(`\n[${String(number).padStart(2, '0')}] PASS  ${title}`);
  console.log(JSON.stringify(evidence, null, 2));
}

async function timed(action) {
  const started = performance.now();
  const value = await action();
  return { value, milliseconds: Number((performance.now() - started).toFixed(1)) };
}

function campaignRequest(requestId, campaignId, expectedRevision, operation, extra = {}) {
  return { requestId, campaignId, expectedRevision, operation, acceptedBy: HUMAN, ...extra };
}

async function runEvidenceTrace() {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'st-rpg-campaign-authority-PROTOTYPE-'));
  const databasePath = path.join(scratch, 'authority.sqlite');
  const backupDirectory = path.join(scratch, 'backups');
  const replacedPath = path.join(scratch, 'authority.replaced.sqlite');
  let authority = null;
  let completed = false;
  let step = 0;
  const metrics = {};

  console.log('THROWAWAY PROTOTYPE: Campaign authority persistence/recovery evidence trace');
  console.log(`Scratch directory: ${scratch}`);

  try {
    authority = new AuthoritySpike(databasePath);
    check(authority.schemaVersion() === 1, 'base migration should install schema v1');
    check(authority.validate().ok, 'new authority database should validate');
    printStep(++step, 'Bootstrap uses WAL, FULL durability, migrations, and integrity checks', {
      node: process.version,
      sqlite: authority.db.prepare('SELECT sqlite_version() version').get().version,
      journalMode: authority.db.prepare('PRAGMA journal_mode').get().journal_mode,
      synchronous: authority.db.prepare('PRAGMA synchronous').get().synchronous,
      schemaVersion: authority.schemaVersion(),
      validation: authority.validate(),
    });

    const created = accepted(authority.createCampaign({
      requestId: 'create-main',
      campaignId: 'campaign-main',
      title: 'House Harcourt',
      acceptedBy: HUMAN,
      subjects: [
        { id: 'player-dan', kind: 'character', name: 'Dan', description: 'Sole heir.' },
        { id: 'wardrobe', kind: 'scene_object', name: 'Heirloom Wardrobe', description: 'Red mahogany.' },
        { id: 'wardrobe-key', kind: 'item', name: 'Wardrobe Key', description: 'Silver key.' },
      ],
      references: [
        { id: 'wardrobe-unlocks-with', sourceId: 'wardrobe', targetId: 'wardrobe-key', path: 'unlocks_with' },
      ],
      binding: { bindingId: 'binding-main', locator: LOCATOR, label: 'Narrator / main' },
    }), 'create Campaign and Binding');
    check(created.campaign.revision === 1, 'Campaign genesis should be Revision 1');
    check(created.binding.revision === 1, 'Binding genesis should be Binding Revision 1');
    check(authority.projectionMatches('campaign-main'), 'initial projection should equal reconstruction');
    const cursorAfterCreate = created.cursor;
    printStep(++step, 'Campaign and Chat Binding genesis are one accepted commit', {
      result: created,
      counts: authority.counts('campaign-main'),
      binding: authority.binding('binding-main'),
      state: authority.currentState('campaign-main'),
    });

    accepted(authority.executeBinding({
      requestId: 'pins-1', bindingId: 'binding-main', expectedFacets: { pins: 0 },
      operation: { kind: 'replace-pins', pins: ['wardrobe'] }, acceptedBy: HUMAN,
    }), 'replace pins');
    accepted(authority.executeBinding({
      requestId: 'sync-1', bindingId: 'binding-main', expectedFacets: { sync: 0 },
      operation: { kind: 'set-sync-boundary', boundary: { messageId: 44, hash: 'sync-44' } }, acceptedBy: HUMAN,
    }), 'set sync boundary');
    const beforeStaleBinding = authority.binding('binding-main');
    rejected(authority.executeBinding({
      requestId: 'pins-stale', bindingId: 'binding-main', expectedFacets: { pins: 0 },
      operation: { kind: 'replace-pins', pins: ['wardrobe-key'] }, acceptedBy: HUMAN,
    }), 'binding_revision_conflict', 'stale pin edit');
    const afterStaleBinding = authority.binding('binding-main');
    check(canonicalJson(beforeStaleBinding) === canonicalJson(afterStaleBinding), 'stale Binding write must be side-effect free');
    printStep(++step, 'Independent Binding facets allow concurrent edits and reject only stale facets', {
      binding: afterStaleBinding,
      staleWritePreservedState: true,
    });

    const editWithAnchorRequest = campaignRequest(
      'edit-wardrobe-anchor',
      'campaign-main',
      1,
      { kind: 'put-subject', subject: {
        id: 'wardrobe', kind: 'scene_object', name: 'Heirloom Wardrobe',
        description: 'Ancient red mahogany with silver draconic filigree.',
      } },
      { anchor: { bindingId: 'binding-main', expectedFacets: { identity: 1, anchor: 1 } } },
    );
    const editWithAnchor = accepted(authority.executeCampaign(editWithAnchorRequest), 'Campaign edit with anchor');
    check(editWithAnchor.campaign.revision === 2, 'Campaign should advance once');
    check(editWithAnchor.binding.revision === 4, 'Binding event history should advance once');
    check(authority.binding('binding-main').campaignAnchor === 2, 'anchor should advance atomically');
    const combinedChanges = authority.readChanges({ after: cursorAfterCreate });
    const combinedCommit = combinedChanges.commits.find(commit => commit.requestId === 'edit-wardrobe-anchor');
    check(combinedCommit?.changes.length === 2, 'one durable commit should expose Campaign and Binding scopes', combinedChanges);

    const countsBeforeReplay = authority.counts('campaign-main');
    const replay = accepted(authority.executeCampaign(editWithAnchorRequest), 'idempotent replay');
    check(replay.idempotentReplay, 'exact Request ID replay should return recorded outcome');
    check(canonicalJson(countsBeforeReplay) === canonicalJson(authority.counts('campaign-main')), 'replay must not duplicate commits/events');
    printStep(++step, 'Campaign mutation and anchor advance commit atomically and replay idempotently', {
      result: editWithAnchor,
      changeCommit: combinedCommit,
      replay: { idempotentReplay: replay.idempotentReplay, cursor: replay.cursor },
      counts: authority.counts('campaign-main'),
    });

    const beforeStaleCampaign = authority.currentState('campaign-main');
    rejected(authority.executeCampaign(campaignRequest(
      'campaign-stale-tab', 'campaign-main', 1,
      { kind: 'put-subject', subject: { id: 'stale-note', kind: 'fact', name: 'Must Not Exist' } },
    )), 'campaign_revision_conflict', 'stale Campaign tab');
    check(canonicalJson(beforeStaleCampaign) === canonicalJson(authority.currentState('campaign-main')), 'stale Campaign edit must not mutate projection');

    const beforeInjectedFailure = authority.counts('campaign-main');
    let injectedFailure = null;
    try {
      authority.executeCampaign(campaignRequest(
        'injected-failure', 'campaign-main', 2,
        { kind: 'put-subject', subject: { id: 'rolled-back', kind: 'fact', name: 'Rolled Back' } },
        { injectFailureAt: 'after-event' },
      ));
    } catch (error) {
      injectedFailure = error;
    }
    check(injectedFailure?.message.includes('injected failure'), 'injected storage failure should escape as infrastructure failure');
    check(canonicalJson(beforeInjectedFailure) === canonicalJson(authority.counts('campaign-main')), 'injected failure must roll back projection, Event, and commit');
    check(!authority.currentState('campaign-main').subjects['rolled-back'], 'rolled-back subject must not exist');
    printStep(++step, 'Stale tabs fail cleanly and transaction failure rolls back all authority surfaces', {
      staleProblem: 'campaign_revision_conflict',
      injectedFailure: injectedFailure.message,
      countsAfterRollback: authority.counts('campaign-main'),
    });

    accepted(authority.executeCampaign(campaignRequest(
      'add-fact', 'campaign-main', 2,
      { kind: 'put-subject', subject: { id: 'house-expectations', kind: 'fact', name: 'House Expectations', description: 'Ritual, duty, scrutiny.' } },
    )), 'unanchored Campaign mutation');
    const mismatch = authority.inspectBinding('binding-main', LOCATOR);
    const collision = authority.inspectBinding('binding-main', { ...LOCATOR, chat: 'copied-chat' });
    check(mismatch.state === 'mismatch' && mismatch.campaignHead === 3 && mismatch.campaignAnchor === 2, 'unanchored edit should create visible mismatch');
    check(collision.state === 'collision', 'copied Binding identity should be detected');
    accepted(authority.executeBinding({
      requestId: 'follow-head', bindingId: 'binding-main', expectedFacets: { anchor: 2 },
      operation: { kind: 'follow-campaign-head', revision: 3 }, acceptedBy: HUMAN,
    }), 'follow Campaign head');
    check(authority.inspectBinding('binding-main', LOCATOR).state === 'verified', 'explicit follow should resolve mismatch');
    printStep(++step, 'Chat Binding mismatch and copied-chat collision are explicit, never auto-repaired', {
      mismatch,
      collision: { state: collision.state, registeredLocator: collision.registeredLocator, presentedLocator: collision.presentedLocator },
      afterExplicitFollow: authority.inspectBinding('binding-main', LOCATOR),
    });

    const snapshot = authority.createSnapshot('campaign-main', 3);
    accepted(authority.executeCampaign(campaignRequest(
      'add-quest', 'campaign-main', 3,
      { kind: 'put-subject', subject: { id: 'find-witness', kind: 'quest', name: 'Find the Witness', status: 'active' } },
    )), 'add quest');
    const reconstructed = [1, 2, 3, 4].map(revision => authority.reconstruct('campaign-main', revision));
    check(reconstructed[0].state.subjects.wardrobe.description === 'Red mahogany.', 'Revision 1 should preserve original wardrobe');
    check(reconstructed[1].state.subjects.wardrobe.description.includes('draconic'), 'Revision 2 should preserve wardrobe edit');
    check(!reconstructed[2].state.subjects['find-witness'], 'Revision 3 should predate quest');
    check(reconstructed[3].state.subjects['find-witness'], 'Revision 4 should contain quest');
    authority.prototypeCorruptSnapshot('campaign-main', 3);
    const snapshotFallback = authority.reconstruct('campaign-main', 4);
    check(snapshotFallback.diagnostics.some(item => item.kind === 'snapshot-rejected'), 'bad snapshot should be rejected');
    check(snapshotFallback.state.subjects['find-witness'], 'bad snapshot should fall back to verified Event replay');
    authority.createSnapshot('campaign-main', 3);
    printStep(++step, 'Arbitrary revisions reconstruct; corrupt snapshots fall back to verified Event history', {
      snapshot,
      revisions: reconstructed.map(item => ({ revision: item.revision, replayed: item.replayed, subjects: Object.keys(item.state.subjects) })),
      corruptSnapshotFallback: { replayed: snapshotFallback.replayed, diagnostics: snapshotFallback.diagnostics },
    });

    accepted(authority.executeCampaign(campaignRequest(
      'archive-key', 'campaign-main', 4, { kind: 'archive-subject', subjectId: 'wardrobe-key' },
    )), 'archive referenced key');
    rejected(authority.executeCampaign(campaignRequest(
      'delete-key-blocked', 'campaign-main', 5, { kind: 'delete-subject', subjectId: 'wardrobe-key' },
    )), 'reference_blocked', 'delete referenced key');
    const deletion = accepted(authority.executeCampaign(campaignRequest(
      'delete-key-safe', 'campaign-main', 5,
      { kind: 'batch', operations: [
        { kind: 'delete-reference', referenceId: 'wardrobe-unlocks-with' },
        { kind: 'delete-subject', subjectId: 'wardrobe-key' },
      ] },
    )), 'atomic reference cleanup and delete');
    check(deletion.campaign.revision === 6, 'batch should produce exactly one Campaign Revision');
    check(authority.reconstruct('campaign-main', 5).state.subjects['wardrobe-key'], 'historical Revision should retain deleted record');
    check(!authority.currentState('campaign-main').subjects['wardrobe-key'], 'current projection should remove deleted record');
    rejected(authority.executeCampaign(campaignRequest(
      'reuse-key-id', 'campaign-main', 6,
      { kind: 'put-subject', subject: { id: 'wardrobe-key', kind: 'item', name: 'Reused ID' } },
    )), 'subject_id_reused', 'deleted ID reuse');
    printStep(++step, 'Delete is archive-first, reference-safe, historical, atomic, and ID-stable', {
      blockedCode: 'reference_blocked',
      deletion,
      currentSubjects: Object.keys(authority.currentState('campaign-main').subjects),
      revisionFiveSubjects: Object.keys(authority.reconstruct('campaign-main', 5).state.subjects),
    });

    authority.prototypeCorruptProjection('campaign-main', 'wardrobe');
    check(!authority.projectionMatches('campaign-main'), 'projection corruption should be detected');
    const preRepairBackup = await authority.createValidatedBackup(backupDirectory, 'pre-repair');
    check(authority.rebuildProjection('campaign-main'), 'projection should rebuild from verified history');
    check(authority.currentState('campaign-main').subjects.wardrobe.description.includes('draconic'), 'rebuild should recover canonical value');
    printStep(++step, 'Projection corruption is detectable and rebuildable after a validated backup', {
      preRepairBackup,
      projectionMatches: authority.projectionMatches('campaign-main'),
    });

    const beforeKilledWriter = {
      state: authority.currentState('campaign-main'),
      counts: authority.counts('campaign-main'),
    };
    authority.close();
    authority = null;
    const killedWriterSource = `
      const { parentPort } = require('node:worker_threads');
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(${JSON.stringify(databasePath)});
      db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; BEGIN IMMEDIATE;');
      db.prepare(\"UPDATE subject_current SET name = 'UNCOMMITTED CRASH WRITE', state_json = '{\\\"corrupt\\\":true}' WHERE campaign_id = 'campaign-main' AND subject_id = 'wardrobe'\").run();
      db.prepare(\"INSERT INTO accepted_commits(commit_id, request_id, accepted_by_json, committed_at) VALUES ('crash-commit', 'crash-request', '{}', 'prototype')\").run();
      parentPort.postMessage('uncommitted-write-ready');
      setInterval(() => {}, 1000);
    `;
    const killedWriter = new Worker(killedWriterSource, { eval: true });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Crash writer did not reach uncommitted state.')), 10_000);
      killedWriter.once('message', message => {
        clearTimeout(timeout);
        if (message !== 'uncommitted-write-ready') reject(new Error(`Unexpected crash writer message: ${message}`));
        else resolve();
      });
      killedWriter.once('error', error => {
        clearTimeout(timeout);
        reject(error);
      });
    });
    const killedWriterExitCode = await killedWriter.terminate();
    check(killedWriterExitCode !== 0, 'crash writer should terminate before commit', { killedWriterExitCode });
    authority = new AuthoritySpike(databasePath);
    check(canonicalJson(beforeKilledWriter.state) === canonicalJson(authority.currentState('campaign-main')), 'uncommitted WAL mutation should disappear after writer death');
    check(canonicalJson(beforeKilledWriter.counts) === canonicalJson(authority.counts('campaign-main')), 'writer death should not create Event or accepted commit');
    check(authority.validate().ok, 'database should validate after interrupted writer');
    printStep(++step, 'Abrupt writer exit inside a WAL transaction leaves no partial accepted mutation', {
      workerExitCode: killedWriterExitCode,
      countsBefore: beforeKilledWriter.counts,
      countsAfter: authority.counts('campaign-main'),
      validation: authority.validate(),
    });

    const beforeRestart = {
      state: authority.currentState('campaign-main'),
      binding: authority.binding('binding-main'),
      counts: authority.counts('campaign-main'),
      epoch: authority.storeEpoch(),
    };
    authority.close();
    authority = new AuthoritySpike(databasePath);
    check(canonicalJson(beforeRestart.state) === canonicalJson(authority.currentState('campaign-main')), 'Campaign should survive restart');
    check(canonicalJson(beforeRestart.binding) === canonicalJson(authority.binding('binding-main')), 'Binding should survive restart');
    check(beforeRestart.epoch === authority.storeEpoch(), 'ordinary restart should preserve Store Epoch');
    printStep(++step, 'Campaign, Binding, receipts, and Event history survive process restart', {
      before: { counts: beforeRestart.counts, epoch: beforeRestart.epoch },
      after: { counts: authority.counts('campaign-main'), epoch: authority.storeEpoch() },
    });

    const sourceAtTwo = authority.reconstruct('campaign-main', 2).state;
    const branchTimed = await timed(async () => accepted(authority.branchCampaign({
      requestId: 'branch-revision-two',
      sourceCampaignId: 'campaign-main',
      sourceRevision: 2,
      campaignId: 'campaign-branch',
      title: 'House Harcourt / alternate path',
      acceptedBy: HUMAN,
      binding: {
        kind: 'create', bindingId: 'binding-branch',
        locator: { ...LOCATOR, chat: 'alternate-path' }, label: 'Alternate path',
      },
    }), 'branch at Revision 2'));
    const branchHead = authority.currentState('campaign-branch');
    check(canonicalJson(semanticBranchState(sourceAtTwo)) === canonicalJson(semanticBranchState(branchHead)), 'branch base should equal selected source Revision');
    accepted(authority.executeCampaign(campaignRequest(
      'branch-only-fact', 'campaign-branch', 1,
      { kind: 'put-subject', subject: { id: 'branch-only', kind: 'fact', name: 'Branch Only' } },
    )), 'mutate branch');
    check(!authority.currentState('campaign-main').subjects['branch-only'], 'child mutation must not affect source');
    check(authority.reconstruct('campaign-branch', 1).state.campaign.lineage.revision === 2, 'branch should retain auditable lineage');
    metrics.branchSmallMs = branchTimed.milliseconds;
    printStep(++step, 'Branch-at-revision creates a self-contained, independently mutable Campaign', {
      branch: branchTimed.value,
      milliseconds: branchTimed.milliseconds,
      lineage: authority.reconstruct('campaign-branch', 1).state.campaign.lineage,
      sourceRevision: 6,
      sourceUnaffected: !authority.currentState('campaign-main').subjects['branch-only'],
    });

    const purgeCreated = accepted(authority.createCampaign({
      requestId: 'create-purge-campaign', campaignId: 'campaign-purge', title: 'Disposable Campaign',
      acceptedBy: HUMAN, subjects: [], references: [],
    }), 'create purge Campaign');
    const purgeArchived = accepted(authority.executeCampaign(campaignRequest(
      'archive-purge-campaign', 'campaign-purge', purgeCreated.campaign.revision,
      { kind: 'archive-campaign' },
    )), 'archive purge Campaign');
    const purgeRequest = {
      requestId: 'purge-campaign', campaignId: 'campaign-purge', expectedRevision: 2,
      expectedHeadEventHash: purgeArchived.campaign.eventHash, acceptedBy: HUMAN,
    };
    const purged = accepted(await authority.purgeCampaign(purgeRequest, backupDirectory), 'purge archived Campaign');
    const purgeReplay = accepted(await authority.purgeCampaign(purgeRequest, backupDirectory), 'replay purge receipt');
    check(purgeReplay.idempotentReplay, 'purge retry should return its durable receipt after live content is gone');
    let purgedReadCode = null;
    try { authority.currentState('campaign-purge'); } catch (error) { purgedReadCode = error.code; }
    check(purgedReadCode === 'campaign_purged', 'purged Campaign should retain a fail-closed receipt');
    check(validateDatabase(purged.purge.backupReceipt.path).ok, 'pre-purge backup should validate');
    printStep(++step, 'Purge requires archive, final head precondition, and validated recovery backup', {
      purge: purged.purge,
      idempotentReplayAfterContentRemoval: purgeReplay.idempotentReplay,
      readAfterPurge: purgedReadCode,
    });

    const preImportState = authority.currentState('campaign-main');
    const preImportBackup = await authority.createValidatedBackup(backupDirectory, 'pre-import');
    check(validateDatabase(preImportBackup.path).ok, 'pre-import backup should validate');
    accepted(authority.executeCampaign(campaignRequest(
      'import-batch', 'campaign-main', 6,
      { kind: 'batch', operations: [
        { kind: 'put-subject', subject: { id: 'imported-item', kind: 'item', name: 'Imported Item' } },
        { kind: 'put-subject', subject: { id: 'imported-npc', kind: 'npc', name: 'Imported NPC' } },
      ] },
    )), 'import batch');
    check(authority.currentState('campaign-main').subjects['imported-item'], 'import should change live state after backup');

    const dailyAt = new Date();
    const dailyOne = await authority.ensureDailyBackup(backupDirectory, dailyAt);
    const dailyTwo = await authority.ensureDailyBackup(backupDirectory, new Date(dailyAt.getTime() + 60 * 60 * 1000));
    const dailyThree = await authority.ensureDailyBackup(backupDirectory, new Date(dailyAt.getTime() + 25 * 60 * 60 * 1000));
    check(dailyOne.created && !dailyTwo.created && dailyThree.created, 'daily scheduler should create at most one backup per 24 hours');
    printStep(++step, 'Online backups validate before publication; daily policy coalesces within 24 hours', {
      preImportBackup,
      daily: [dailyOne, dailyTwo, dailyThree],
    });

    const migrationV2 = {
      version: 2,
      name: 'prototype-notes',
      source: 'CREATE TABLE prototype_notes(note TEXT NOT NULL);',
      apply(db) { db.exec(this.source); },
    };
    const migrationV3Fail = {
      version: 3,
      name: 'prototype-failing-migration',
      source: 'CREATE TABLE prototype_partial(value TEXT); THROW PROTOTYPE FAILURE;',
      apply(db) {
        db.exec('CREATE TABLE prototype_partial(value TEXT);');
        throw new Error('PROTOTYPE injected migration failure');
      },
    };
    await authority.applyMigrations([migrationV2], { backupDirectory });
    check(authority.schemaVersion() === 2, 'successful migration should advance user_version');
    let migrationFailure = null;
    try { await authority.applyMigrations([migrationV3Fail], { backupDirectory }); } catch (error) { migrationFailure = error; }
    check(migrationFailure?.message.includes('migration failure'), 'failing migration should surface');
    check(authority.schemaVersion() === 2, 'failing migration should not advance schema version');
    check(!authority.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='prototype_partial'").get(), 'failing migration DDL should roll back');
    let checksumFailure = null;
    try {
      await authority.applyMigrations([{ ...migrationV2, source: `${migrationV2.source} -- changed` }]);
    } catch (error) { checksumFailure = error; }
    check(checksumFailure?.code === 'migration_checksum_mismatch', 'changed applied migration should be rejected');
    printStep(++step, 'Migrations are backed up, transactional, versioned, and checksum-locked', {
      schemaVersion: authority.schemaVersion(),
      injectedFailure: migrationFailure.message,
      partialTableExists: false,
      changedMigrationCode: checksumFailure.code,
    });

    const epochBeforeRestore = authority.storeEpoch();
    const cursorBeforeRestore = authority.readChanges({ after: null }).cursor;
    authority.close();
    authority = null;
    const restored = await restoreDatabase({ databasePath, backupPath: preImportBackup.path, replacedPath });
    authority = new AuthoritySpike(databasePath);
    check(authority.storeEpoch() !== epochBeforeRestore, 'restore should rotate Store Epoch');
    check(canonicalJson(authority.currentState('campaign-main')) === canonicalJson(preImportState), 'restore should recover exact pre-import Campaign state');
    check(!authority.currentState('campaign-main').subjects['imported-item'], 'restore should remove post-backup import');
    const postRestoreChanges = authority.readChanges({ after: cursorBeforeRestore });
    check(postRestoreChanges.resetRequired, 'old subscriber cursor should reset after restore');
    printStep(++step, 'Restore validates staging, atomically swaps files, and invalidates stale cursors via Store Epoch', {
      restored,
      oldEpoch: epochBeforeRestore,
      newEpoch: authority.storeEpoch(),
      oldCursor: cursorBeforeRestore,
      subscriptionAfterRestore: postRestoreChanges,
      restoredCounts: authority.counts('campaign-main'),
    });

    const corruptEventBackup = await authority.createValidatedBackup(backupDirectory, 'corrupt-event-source');
    const corruptEventDb = path.join(scratch, 'corrupt-event.sqlite');
    await copyFile(corruptEventBackup.path, corruptEventDb);
    const corruptAuthority = new AuthoritySpike(corruptEventDb);
    corruptAuthority.prototypeCorruptEvent('campaign-main', 2);
    let eventCorruptionCode = null;
    try { corruptAuthority.reconstruct('campaign-main', 6); } catch (error) { eventCorruptionCode = error.code; }
    corruptAuthority.close();
    check(eventCorruptionCode === 'history_corrupt', 'Event tampering should fail reconstruction closed');

    authority.close();
    authority = null;
    const databaseHashBeforeRejectedRestore = sha256(await readFile(databasePath));
    const corruptCandidate = await corruptFileCopy(preImportBackup.path, path.join(scratch, 'corrupt-candidate.sqlite'));
    let corruptRestoreCode = null;
    try {
      await restoreDatabase({ databasePath, backupPath: corruptCandidate, replacedPath });
    } catch (error) { corruptRestoreCode = error.code; }
    check(corruptRestoreCode === 'restore_candidate_invalid', 'corrupt restore candidate should be rejected before swap');
    check(sha256(await readFile(databasePath)) === databaseHashBeforeRejectedRestore, 'rejected restore must leave current DB byte-identical');
    authority = new AuthoritySpike(databasePath);
    printStep(++step, 'Event tampering and corrupt restore candidates fail closed without replacing known-good data', {
      eventCorruptionCode,
      corruptRestoreCode,
      liveDatabaseUnchanged: true,
      validation: authority.validate(),
    });

    const scaleDbPath = path.join(scratch, 'scale.sqlite');
    const scaleAuthority = new AuthoritySpike(scaleDbPath);
    accepted(scaleAuthority.createCampaign({
      requestId: 'scale-create', campaignId: 'campaign-scale', title: 'Scale Campaign',
      acceptedBy: HUMAN, subjects: [], references: [],
    }), 'create scale Campaign');
    const scaleSubjects = Array.from({ length: 10_000 }, (_, index) => ({
      id: `subject-${String(index).padStart(5, '0')}`,
      kind: index % 5 === 0 ? 'item' : index % 5 === 1 ? 'npc' : index % 5 === 2 ? 'spell' : index % 5 === 3 ? 'quest' : 'fact',
      name: `Record ${String(index).padStart(5, '0')}`,
      description: `Representative campaign record ${index} with concise narrator-facing detail.`,
      tags: [`group-${index % 23}`, `tier-${index % 7}`],
    }));
    const importTimed = await timed(async () => accepted(scaleAuthority.executeCampaign(campaignRequest(
      'scale-import-10k', 'campaign-scale', 1,
      { kind: 'batch', operations: scaleSubjects.map(subject => ({ kind: 'put-subject', subject })) },
    )), '10k import'));
    const pageTimed = await timed(async () => scaleAuthority.listSubjects('campaign-scale', { limit: 50, offset: 4_950 }));
    const editTimed = await timed(async () => accepted(scaleAuthority.executeCampaign(campaignRequest(
      'scale-single-edit', 'campaign-scale', 2,
      { kind: 'put-subject', subject: { ...scaleSubjects[5_000], description: 'Edited representative record.' } },
    )), 'single edit at scale'));
    const snapshotTimed = await timed(async () => scaleAuthority.createSnapshot('campaign-scale', 3));
    const reconstructionTimed = await timed(async () => scaleAuthority.reconstruct('campaign-scale', 3));
    const scaleBranchTimed = await timed(async () => accepted(scaleAuthority.branchCampaign({
      requestId: 'scale-branch', sourceCampaignId: 'campaign-scale', sourceRevision: 3,
      campaignId: 'campaign-scale-branch', title: 'Scale Branch', acceptedBy: HUMAN,
    }), '10k branch'));
    const scaleStat = await stat(scaleDbPath);
    check(scaleAuthority.counts('campaign-scale').subjects === 10_000, 'scale Campaign should retain 10k records');
    check(pageTimed.value.length === 50, 'scale page should return requested 50 records');
    check(scaleAuthority.projectionMatches('campaign-scale'), 'scale projection should match history');
    check(scaleAuthority.counts('campaign-scale-branch').subjects === 10_000, 'scale branch should be self-contained');
    metrics.scale = {
      records: 10_000,
      importMs: importTimed.milliseconds,
      page50Ms: pageTimed.milliseconds,
      singleEditMs: editTimed.milliseconds,
      snapshotMs: snapshotTimed.milliseconds,
      snapshotBytes: snapshotTimed.value.bytes,
      reconstructionMs: reconstructionTimed.milliseconds,
      reconstructionEventsReplayed: reconstructionTimed.value.replayed,
      branchMs: scaleBranchTimed.milliseconds,
      databaseBytes: scaleStat.size,
    };
    printStep(++step, '10,000-record Campaign remains pageable, reconstructable, snapshotable, and branchable', metrics.scale);
    scaleAuthority.close();

    check(authority.validate().ok, 'main authority should end with clean SQLite/foreign-key checks');
    const verdict = {
      result: 'GO WITH CONSTRAINTS',
      selectedStack: 'Node 24 node:sqlite + WAL + synchronous=FULL + online backup',
      proven: [
        'atomic Campaign/Event/projection/Binding commit',
        'Request ID idempotency and stale-revision rejection',
        'arbitrary reconstruction with snapshot fallback',
        'self-contained branch-at-revision',
        'restart, validated backup, restore, Store Epoch reset',
        'transactional/checksummed migrations and corrupt-history fail-closed behavior',
        '10,000-record representative local Campaign',
      ],
      constraints: [
        'single local writer service owns the SQLite connection',
        'all mutations use BEGIN IMMEDIATE and expected revisions/facets',
        'snapshots are disposable accelerators; Events and Bases remain authority',
        'restore/migration/import/purge are maintenance workflows with validated backups',
        'production must bound Event payload size and move scale imports through reviewed batches',
        'HTTP subscriptions and real multi-process lock contention remain separate bridge work',
      ],
      metrics,
    };
    printStep(++step, 'Prototype verdict', verdict);
    completed = true;
    authority.close();
    authority = null;
    await rm(scratch, { recursive: true, force: true });
    console.log('\nEvidence trace complete. Disposable scratch directory removed.');
    return verdict;
  } finally {
    authority?.close();
    if (!completed) console.error(`\nTRACE FAILED. Scratch evidence preserved at: ${scratch}`);
  }
}

async function runInteractive() {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'st-rpg-campaign-authority-TUI-PROTOTYPE-'));
  const authority = new AuthoritySpike(path.join(scratch, 'interactive.sqlite'));
  accepted(authority.createCampaign({
    requestId: 'tui-create', campaignId: 'tui', title: 'Interactive Scratch', acceptedBy: HUMAN,
    subjects: [{ id: 'wardrobe', kind: 'scene_object', name: 'Wardrobe', description: 'Old mahogany.' }],
    references: [], binding: { bindingId: 'tui-binding', locator: LOCATOR, label: 'TUI chat' },
  }), 'create TUI Campaign');
  let requestNumber = 0;
  let branchNumber = 0;
  const render = message => {
    console.clear();
    const state = authority.currentState('tui');
    console.log('THROWAWAY Campaign authority TUI');
    console.log(`Scratch: ${scratch}`);
    console.log(JSON.stringify({
      message,
      counts: authority.counts('tui'),
      binding: authority.inspectBinding('tui-binding', LOCATOR),
      wardrobe: state.subjects.wardrobe,
    }, null, 2));
    console.log('\n[e] edit wardrobe  [p] toggle pin  [s] snapshot  [b] branch head  [x] show copied-chat collision  [q] quit');
  };
  render('Ready');
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  await new Promise((resolve, reject) => {
    process.stdin.on('keypress', async (_text, key) => {
      try {
        if (key.name === 'q' || (key.ctrl && key.name === 'c')) return resolve();
        if (key.name === 'e') {
          const revision = authority.counts('tui').campaignRevision;
          requestNumber += 1;
          const result = authority.executeCampaign(campaignRequest(
            `tui-edit-${requestNumber}`, 'tui', revision,
            { kind: 'put-subject', subject: {
              id: 'wardrobe', kind: 'scene_object', name: 'Wardrobe',
              description: `Edited mahogany version ${requestNumber}.`,
            } },
          ));
          render(result);
        }
        if (key.name === 'p') {
          const binding = authority.binding('tui-binding');
          requestNumber += 1;
          const result = authority.executeBinding({
            requestId: `tui-pin-${requestNumber}`, bindingId: 'tui-binding',
            expectedFacets: { pins: binding.facets.pins },
            operation: { kind: 'replace-pins', pins: binding.pins.length ? [] : ['wardrobe'] },
            acceptedBy: HUMAN,
          });
          render(result);
        }
        if (key.name === 's') {
          render(authority.createSnapshot('tui', authority.counts('tui').campaignRevision));
        }
        if (key.name === 'b') {
          branchNumber += 1;
          render(authority.branchCampaign({
            requestId: `tui-branch-${branchNumber}`, sourceCampaignId: 'tui',
            sourceRevision: authority.counts('tui').campaignRevision,
            campaignId: `tui-branch-${branchNumber}`, title: `TUI branch ${branchNumber}`, acceptedBy: HUMAN,
          }));
        }
        if (key.name === 'x') render(authority.inspectBinding('tui-binding', { ...LOCATOR, chat: 'copied' }));
      } catch (error) { reject(error); }
    });
  });
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  authority.close();
  await rm(scratch, { recursive: true, force: true });
  console.log('\nInteractive scratch removed.');
}

const interactive = process.argv.includes('--interactive');
try {
  if (interactive) await runInteractive();
  else await runEvidenceTrace();
} catch (error) {
  if (process.stdin.isTTY) process.stdin.setRawMode?.(false);
  console.error(error instanceof SpikeProblem ? { code: error.code, message: error.message, details: error.details } : error);
  process.exitCode = 1;
}
