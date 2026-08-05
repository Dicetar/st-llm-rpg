import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CompatibilityUpdate, CutoverJournal, classifyHealth, createOperationsStore,
  planSupervisorStart, reconcileAddonDirectory,
} from './prototype.mjs';

const id = (() => { let n = 0; return () => `trace-${++n}`; })();
const dir = await mkdtemp(join(tmpdir(), 'wayfinder-cutover-'));
try {
  const store = createOperationsStore({ dbPath: join(dir, 'campaign.sqlite'), id });
  const envelope = { campaign: {
    commitId: 'legacy-commit-18', revision: 18, title: 'Emberfall',
    records: [{ id: 'pc', kind: 'actor', name: 'Seraphine' }, { id: 'mara', kind: 'actor', name: 'Mara' }],
    possessions: [], learnedAbilities: [], relationships: [], sceneArchives: [], currentScene: { id: 'scene', title: 'Moon Gate' },
    events: [{ id: 'legacy-event', revision: 18 }],
  } };
  const preview = store.previewLegacyImport({ envelope, locator: 'chat:seraphine/main' });
  console.log('1. legacy preview', { kind: preview.kind, summary: preview.summary, metadataPreserved: preview.legacyMetadataPreserved });
  const imported = store.applyLegacyImport(preview);
  console.log('2. accepted import', imported);

  const addonDir = join(dir, 'addons');
  await mkdir(addonDir);
  await writeFile(join(addonDir, 'world.json'), JSON.stringify({ records: [{ externalId: 'fact:moon-gate', kind: 'fact', proposition: 'The gate opens at moonrise.' }] }));
  const scan = await reconcileAddonDirectory(addonDir);
  const candidate = store.previewAddon({ campaignId: imported.campaignId, sourcePath: 'world.json', document: scan.files[0].document, manifestHash: scan.manifestHash });
  console.log('3. addon diff', { creates: candidate.creates.length, updates: candidate.updates.length, unchanged: candidate.unchanged.length });
  console.log('4. addon apply', store.applyAddon(candidate.candidateId, { manifestHash: candidate.manifestHash, expectedRevision: candidate.expectedRevision }));

  const supervisor = planSupervisorStart({ services: [
    { kind: 'sillytavern', port: 8001, owned: true, command: 'node .runtime/SillyTavern/server.js', identity: 'st-pinned' },
    { kind: 'companion', port: 8002, owned: true, command: 'node companion/server.js', identity: 'companion-v1' },
    { kind: 'lmstudio', port: 1234, owned: false, identity: 'lmstudio' },
  ] });
  console.log('5. supervisor', supervisor);
  console.log('6. health', classifyHealth({ companion: { http: true, database: true }, sillyTavern: { http: true, bridgeCompatible: true }, lmStudio: { http: false } }));

  const update = new CompatibilityUpdate({ currentPin: '380e31-old', expectedPin: 'reviewed-new' });
  console.log('7. compatibility update', update.run({ workingTreeClean: true, stagedPin: 'reviewed-new' }));

  const journal = new CutoverJournal(join(dir, 'cutover.json'));
  await journal.load();
  await journal.enterParallel();
  for (const check of ['validatedBackup', 'legacyImported', 'bindingMarker', 'workspaceJourney', 'linkedNarration', 'phoneJourney', 'fallbackVerified']) await journal.mark(check);
  console.log('8. cutover', await journal.cutover());
  console.log('9. fallback remains possible', await journal.fallback('trace-complete'));
  store.close();
} finally {
  await rm(dir, { recursive: true, force: true });
}
