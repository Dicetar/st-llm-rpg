import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CampaignCommandDeck,
  CampaignBookView,
  CampaignHistoryView,
  ChatBindingsPanel,
  RevisionConflictBanner,
  WorkspaceRouteState,
  LegacyImportPreviewCard,
  ContextTray,
  NarrationStatusPanel,
  RecordEditor,
  SceneEditor,
  StorySyncReviewInboxView,
  BackupPanelView,
  AddonPanelView,
  parseWorkspacePath,
} from '../src/App.js';

test('addon inbox makes source diff, blockers, additive policy, and explicit apply visible', () => {
  const campaign = {
    id: 'campaign-1', title: 'House Harcourt', status: 'active' as const, revision: 4,
    createdAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z',
  };
  const sourceFile = { name: 'people_addon.json', sizeBytes: 120, modifiedAt: '2026-08-10T00:00:00.000Z', sha256: 'a'.repeat(64) };
  const after = {
    recordKind: 'actor' as const, externalId: 'lavir', subjectId: 'addon:actor:lavir', sourceFile: sourceFile.name,
    name: 'Lavir', summary: 'A precise court mage.', visibility: 'known' as const,
  };
  const candidate = {
    schema: 'st-rpg.addon-candidate' as const, version: '1.0' as const, id: 'candidate-1', status: 'pending' as const,
    campaignId: campaign.id, expectedRevision: 4, createdAt: '2026-08-10T00:00:01.000Z', directory: 'D:/campaign-content',
    manifestHash: 'b'.repeat(64), files: [sourceFile],
    issues: [{ severity: 'warning' as const, code: 'addon_fields_not_imported', source: sourceFile.name, path: 'people[0]', message: 'details is not imported yet.' }],
    changes: [{ change: 'create' as const, before: null, after, changedFields: ['name', 'summary'] }], canApply: true,
    deletionPolicy: 'missing-addon-rows-never-delete-campaign-records' as const,
  };
  const html = renderToStaticMarkup(<AddonPanelView
    campaigns={[campaign]} campaignId={campaign.id} onCampaignId={() => undefined}
    catalog={{ schema: 'st-rpg.addon-source-catalog', version: '1.0', directory: 'D:/campaign-content', observedAt: '2026-08-10T00:00:01.000Z', manifestHash: candidate.manifestHash, files: [sourceFile], issues: [] }}
    candidate={candidate} receipt={null} busy={false} error=""
    onRescan={() => undefined} onPreview={() => undefined} onApply={() => undefined}
  />);
  assert.match(html, /JSON addon inbox/);
  assert.match(html, /Files are suggestions, never authority/);
  assert.match(html, /Missing rows never remove accepted Campaign records/);
  assert.match(html, /1<\/strong> create/);
  assert.match(html, /Lavir/);
  assert.match(html, /details is not imported yet/);
  assert.match(html, /Apply reviewed diff/);
});

test('backup catalog exposes daily safety, explicit backup, and verified restore preview', () => {
  const verification = { verified: true as const, verifiedAt: '2026-08-10T00:00:00.000Z', durationMs: 12, campaignCount: 2 };
  const backup = {
    schema: 'st-rpg.backup' as const, version: '1.0' as const, id: 'backup-1', kind: 'explicit' as const,
    label: 'Before finale', createdAt: '2026-08-10T00:00:00.000Z', fileName: 'backup-1.sqlite',
    sizeBytes: 2048, sha256: 'a'.repeat(64), availability: 'available' as const, verification,
  };
  const html = renderToStaticMarkup(<BackupPanelView
    catalog={{ schema: 'st-rpg.backup-catalog', version: '1.0', observedAt: '2026-08-10T00:00:01.000Z', automaticDailyHealthy: true, backups: [backup], problems: [] }}
    preview={{ schema: 'st-rpg.restore-preview', version: '1.0', backup, currentAuthority: verification, restoreToken: 'b'.repeat(64) }}
    loading={false} busy={false} error="" message=""
    onRefresh={() => undefined} onCreate={() => undefined} onPreviewRestore={() => undefined} onRestore={() => undefined}
  />);
  assert.match(html, /Backups and Restore/);
  assert.match(html, /Before finale/);
  assert.match(html, /Verified restore preview/);
  assert.match(html, /creates another verified safety backup first/);
  assert.match(html, /Restore this backup/);
});

test('Narration status shows one operational failure with recovery and no recorder workflow', () => {
  const html = renderToStaticMarkup(<NarrationStatusPanel
    document={{
      schema: 'st-rpg.narration-status', version: '1.0', observedAt: '2026-08-09T12:00:10.000Z', active: [],
      latest: {
        requestId: 'request-failed', route: 'linked', generation: 'continue', state: 'failed', bindingId: 'binding-1',
        startedAt: '2026-08-09T12:00:03.000Z', completedAt: '2026-08-09T12:00:04.000Z', elapsedMs: 1000, httpStatus: 502,
        problem: {
          schema: 'st-rpg.problem', version: '1.0', code: 'NARRATION_UPSTREAM_FAILED',
          message: 'LM Studio did not answer.', requestId: 'request-failed', retryable: true,
          actions: [{ id: 'inspect-lm-studio', label: 'Check LM Studio, then retry in SillyTavern.', kind: 'inspect' }],
        },
      },
    }}
    loading={false}
    error=""
    onRefresh={() => undefined}
  />);

  assert.match(html, /Narration status/);
  assert.match(html, /Latest outcome/);
  assert.match(html, /NARRATION_UPSTREAM_FAILED/);
  assert.match(html, /LM Studio did not answer/);
  assert.match(html, /Check LM Studio, then retry in SillyTavern/);
  assert.match(html, /does not record request history/);
  assert.match(html, /No prompts or generated prose are retained/);
  assert.doesNotMatch(html, /observed|Clear finished/);
});

test('Narration status does not promise atomic delivery for cancelled unlinked streaming', () => {
  const html = renderToStaticMarkup(<NarrationStatusPanel
    document={{
      schema: 'st-rpg.narration-status', version: '1.0', observedAt: '2026-08-09T12:00:10.000Z', active: [],
      latest: {
        requestId: 'request-cancelled', route: 'unlinked', generation: 'normal', state: 'cancelled',
        startedAt: '2026-08-09T12:00:03.000Z', completedAt: '2026-08-09T12:00:04.000Z', elapsedMs: 1000, httpStatus: 499,
      },
    }}
    loading={false}
    error=""
    onRefresh={() => undefined}
  />);

  assert.match(html, /Transparent unlinked streaming may already have delivered partial output/);
  assert.doesNotMatch(html, /before a companion reply was delivered/);
});

test('Campaign Book renders the routed Campaign workspace honestly', () => {
  const html = renderToStaticMarkup(<CampaignBookView
    snapshot={{ health: null, readiness: null, loading: false, error: '' }}
    onRefresh={() => undefined}
  />);
  assert.match(html, /<h1>Campaign Book<\/h1>/);
  assert.match(html, /routed collections/);
  assert.match(html, /SillyTavern remains available as the independent fallback/);
  assert.match(html, /Refresh status/);
});

test('healthy system status collapses so Campaign work stays near the top of the page', () => {
  const observedAt = new Date().toISOString();
  const html = renderToStaticMarkup(<CampaignBookView
    snapshot={{
      health: {
        schema: 'st-rpg.health', version: '1.0', service: 'st-rpg-companion', status: 'alive',
        requestId: 'request', startedAt: observedAt, uptimeMs: 1000,
      },
      readiness: {
        schema: 'st-rpg.readiness', version: '1.0', service: 'st-rpg-companion', ready: true,
        status: 'ready', requestId: 'request', observedAt, components: [],
      },
      loading: false,
      error: '',
    }}
    onRefresh={() => undefined}
  />);

  assert.match(html, /<details class="system-status">/);
  assert.match(html, /<summary>/);
  assert.doesNotMatch(html, /<details class="system-status" open=""/);
});

test('workspace URLs identify Campaign, collection, record, and historical revision', () => {
  assert.deepEqual(
    parseWorkspacePath('/campaigns/campaign-1/quests/quest-9', '?revision=4'),
    {
      campaignId: 'campaign-1',
      collection: 'quests',
      recordId: 'quest-9',
      revision: 4,
    },
  );
  assert.deepEqual(
    parseWorkspacePath('/campaigns/campaign-1/not-a-collection'),
    {
      campaignId: 'campaign-1',
      collection: 'actors',
      recordId: null,
      revision: null,
    },
  );
});

test('history exposes numbered read-only reconstruction and return to current truth', () => {
  const html = renderToStaticMarkup(<CampaignHistoryView
    entries={[
      { revision: 2, eventId: 'event-2', requestId: 'request-2', operationKind: 'update_actor', committedAt: new Date().toISOString() },
      { revision: 1, eventId: 'event-1', requestId: 'request-1', operationKind: 'create_campaign', committedAt: new Date().toISOString() },
    ]}
    currentRevision={2}
    viewingRevision={1}
    busy={false}
    onOpenRevision={() => undefined}
    onReturnCurrent={() => undefined}
  />);
  assert.match(html, /Viewing read-only revision 1/);
  assert.match(html, /Return to current revision 2/);
  assert.match(html, /Revision 1/);
  assert.match(html, /create_campaign/);
});

test('stale revision conflict tells the player that no Campaign state was written', () => {
  const html = renderToStaticMarkup(<RevisionConflictBanner
    conflict={{ campaignId: 'campaign-1', expectedRevision: 3, actualRevision: 4 }}
    busy={false}
    onReload={() => undefined}
    onStay={() => undefined}
  />);
  assert.match(html, /This tab is stale/);
  assert.match(html, /expected revision 3/);
  assert.match(html, /now at revision 4/);
  assert.match(html, /Nothing was written/);
  assert.match(html, /Your draft is still here/);
  assert.match(html, /Keep draft and load canonical/);
  assert.match(html, /Stay on this draft/);
});

test('Command Deck exposes the common Campaign actions without leaving the current Campaign', () => {
  const html = renderToStaticMarkup(<CampaignCommandDeck
    campaignId="campaign-1"
    revision={7}
    hasCurrentScene={false}
    busy={false}
    readOnly={false}
    onNavigate={() => undefined}
  />);

  assert.match(html, /Command Deck/);
  assert.match(html, /Add Actor/);
  assert.match(html, /Add Item/);
  assert.match(html, /Start Scene/);
  assert.match(html, /Inspect History/);
  assert.match(html, /Revision 7/);
  assert.match(html, /\/campaigns\/campaign-1\/actors/);
  assert.match(html, /\/campaigns\/campaign-1\/history/);
});

test('legacy import preview makes preserved and unsupported data explicit before mutation', () => {
  const html = renderToStaticMarkup(<LegacyImportPreviewCard
    preview={{
      schema: 'st-rpg.legacy-import-preview', version: '1.0', kind: 'new-import',
      locator: { kind: 'character', chatId: 'Emberfall', avatar: 'Seraphine.png' },
      sourceFingerprint: 'a'.repeat(64), contentFingerprint: 'b'.repeat(64),
      title: 'Emberfall', legacyRevision: 7,
      counts: { actors: 2, items: 1, quests: 1, places: 1, unsupported: 3 },
      issues: [{ severity: 'warning', code: 'unsupported-record-kind', path: 'campaign.records[5]', message: 'Ability is preserved but not projected yet.' }],
      decisions: ['create-campaign', 'cancel'], legacyMetadataPreserved: true,
    }}
  />);
  assert.match(html, /Revision 7/);
  assert.match(html, /<strong>2<\/strong> Actors/);
  assert.match(html, /<strong>3<\/strong> preserved for later/);
  assert.match(html, /Ability is preserved but not projected yet/);
  assert.match(html, /Legacy metadata stays in SillyTavern/);
});

test('Chat Binding inspection stays available after the import result is gone', () => {
  const html = renderToStaticMarkup(<ChatBindingsPanel
    bindings={[{
      schema: 'st-rpg.chat-binding', version: '1.0', id: 'binding-1', campaignId: 'campaign-1',
      revision: 1, campaignAnchor: 7,
      locator: { kind: 'character', chatId: 'Emberfall', avatar: 'Seraphine.png' },
      sourceFingerprint: 'a'.repeat(64), contentFingerprint: 'b'.repeat(64),
      markerState: 'blocked', markerProblem: 'SillyTavern was unavailable.',
      createdAt: '2026-08-09T12:00:00.000Z', updatedAt: '2026-08-09T12:00:00.000Z',
    }]}
    busy={false}
    onRetryMarker={() => undefined}
  />);
  assert.match(html, /Linked SillyTavern chats/);
  assert.match(html, /Emberfall/);
  assert.match(html, /Campaign anchor 7/);
  assert.match(html, /marker blocked/);
  assert.match(html, /Retry marker/);
});

test('Context Tray keeps profile, ordered pins, planning evidence, and privacy in one routed surface', () => {
  const html = renderToStaticMarkup(<ContextTray
    document={{
      campaign: {
        id: 'campaign-1', title: 'House Harcourt', status: 'active', revision: 7,
        createdAt: '2026-08-09T12:00:00.000Z', updatedAt: '2026-08-09T12:00:00.000Z',
      },
      actors: [{ id: 'actor-lavir', name: 'Lavir', summary: 'A noble.', archived: false, visibility: 'known' }],
      items: [{ id: 'item-private', name: 'Private Ledger', summary: 'Never sent.', archived: false, visibility: 'campaign_private' }],
      quests: [], places: [], currentScene: null,
    }}
    bindings={[{
      schema: 'st-rpg.chat-binding', version: '1.0', id: 'binding-1', campaignId: 'campaign-1',
      revision: 2, campaignAnchor: 7, contextFocusRevision: 1, pins: [],
      locator: { kind: 'character', chatId: 'Harcourt', avatar: 'Narrator.png' },
      sourceFingerprint: 'a'.repeat(64), contentFingerprint: 'b'.repeat(64), markerState: 'verified',
      createdAt: '2026-08-09T12:00:00.000Z', updatedAt: '2026-08-09T12:00:00.000Z',
    }]}
    busy={false}
    readOnly={false}
    onBindingChanged={() => undefined}
    onStatus={() => undefined}
    onError={() => undefined}
  />);
  assert.match(html, /Context Tray/);
  assert.match(html, /Narrator model profile/);
  assert.match(html, /Ordered manual pins/);
  assert.match(html, /Private Ledger/);
  assert.match(html, /Campaign Private/);
  assert.match(html, /Safety margin/);
  assert.match(html, /Automatic Record limit/);
  assert.match(html, /Generation type/);
  assert.match(html, /Continue/);
  assert.match(html, /Build Context Plan/);
});

test('Record editor exposes repeatable aliases and Narrator Visibility beside ordinary fields', () => {
  const html = renderToStaticMarkup(<RecordEditor
    kind="actor"
    record={{
      id: 'actor-secret', name: 'The Steward', aliases: ['Old Fox'], summary: 'Runs the estate.',
      visibility: 'narrator_secret', archived: false,
    }}
    actors={[]}
    busy={false}
    readOnly={false}
    onSave={async () => undefined}
    onArchive={async () => undefined}
  />);
  assert.match(html, /Aliases/);
  assert.match(html, /Old Fox/);
  assert.match(html, /Add alias/);
  assert.match(html, /Narrator Visibility/);
  assert.match(html, /Narrator Secret/);
  assert.doesNotMatch(html, /comma-separated/i);
});

test('Scene editor exposes structural Place, Actor, and Item attachments for Context anchors', () => {
  const html = renderToStaticMarkup(<SceneEditor
    scene={{
      id: 'scene-1', name: 'Bedroom', summary: 'A guarded meeting.', placeId: 'place-house',
      actorIds: ['actor-lavir'], itemIds: ['item-key'],
    }}
    actors={[{ id: 'actor-lavir', name: 'Lavir', summary: '', archived: false }]}
    items={[{ id: 'item-key', name: 'Wardrobe Key', summary: '', archived: false }]}
    places={[{ id: 'place-house', name: 'House Harcourt', summary: '', archived: false }]}
    busy={false}
    readOnly={false}
    onSave={async () => undefined}
  />);
  assert.match(html, /Scene Place/);
  assert.match(html, /Present Actors/);
  assert.match(html, /Present Items/);
  assert.match(html, /Lavir/);
  assert.match(html, /Wardrobe Key/);
});

test('Story Sync Review Inbox keeps worker setup and structured editable proposals together', () => {
  const html = renderToStaticMarkup(<StorySyncReviewInboxView
    campaign={{
      campaign: {
        id: 'campaign-1', title: 'House Harcourt', status: 'active', revision: 7,
        createdAt: '2026-08-09T12:00:00.000Z', updatedAt: '2026-08-09T12:00:00.000Z',
      },
      actors: [{ id: 'actor-lavir', name: 'Lavir', summary: 'A noble.', archived: false }],
      items: [], quests: [], places: [], currentScene: null,
    }}
    profiles={[{
      schema: 'st-rpg.worker-model-profile', version: '1.0', id: 'worker-default',
      modelId: 'mistralai/mistral-nemo-instruct-2407', requestedOutputTokens: 1600,
      updatedAt: '2026-08-09T12:00:00.000Z',
    }]}
    jobs={[{
      schema: 'st-rpg.story-sync-job', version: '1.0', id: 'job-1', campaignId: 'campaign-1',
      bindingId: 'binding-1', profileId: 'worker-default', status: 'ready-for-review',
      campaignAnchor: 7, bindingRevision: 2, syncFacetRevision: 1,
      source: {
        firstMessageIndex: 4, lastMessageIndex: 9, messageCount: 6,
        fingerprint: 'a'.repeat(64), endPrefixHash: 'b'.repeat(64), contentPruned: false,
      },
      attemptCount: 1,
      proposals: [{
        id: 'proposal-1', jobId: 'job-1', ordinal: 0, revision: 1, decision: 'pending',
        draft: {
          title: 'Lavir reveals the locked gallery', note: 'Directly stated by the narrator.',
          operation: { kind: 'update_actor', actorId: 'actor-lavir', name: 'Lavir', summary: 'Knows how to enter the locked gallery.' },
        },
        sourceLinks: [{ messageIndex: 8, excerpt: 'Lavir admits he has the gallery key.' }],
        validationProblems: [], confidence: 'high',
      }],
      createdAt: '2026-08-09T12:00:00.000Z', updatedAt: '2026-08-09T12:00:01.000Z',
    }]}
    loading={false}
    busy={false}
    error=""
    message=""
    onSaveProfile={async () => undefined}
    onSaveProposal={async () => undefined}
    onFinalizeJob={async () => undefined}
    onJobAction={async () => undefined}
    onRefresh={() => undefined}
  />);

  assert.match(html, /Review Inbox/);
  assert.match(html, /Campaign worker model/);
  assert.match(html, /mistralai\/mistral-nemo-instruct-2407/);
  assert.match(html, /Lavir reveals the locked gallery/);
  assert.match(html, /Record type/);
  assert.match(html, /Actor summary/);
  assert.match(html, /Accept/);
  assert.match(html, /Reject/);
  assert.match(html, /Defer/);
  assert.match(html, /Finalize review/);
  assert.match(html, /one atomic Campaign revision/);
  assert.match(html, /Discard review/);
  assert.doesNotMatch(html, /Draft JSON/);
});

test('route state explains pending and failed navigation with an explicit retry', () => {
  const pending = renderToStaticMarkup(<WorkspaceRouteState
    phase="loading"
    title="Loading historical revision 4"
  />);
  assert.match(pending, /Loading historical revision 4/);
  assert.match(pending, /aria-busy="true"/);
  assert.match(pending, /role="status"/);

  const failed = renderToStaticMarkup(<WorkspaceRouteState
    phase="error"
    title="Historical revision unavailable"
    message="Revision 4 could not be loaded."
    onRetry={() => undefined}
  />);
  assert.match(failed, /Historical revision unavailable/);
  assert.match(failed, /Revision 4 could not be loaded/);
  assert.match(failed, /Retry route/);
  assert.match(failed, /role="alert"/);
});

test('narrow CSS prevents horizontal overflow and keeps routed controls touch-sized', async () => {
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /overflow-x:\s*hidden/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /\.authority-layout \{ grid-template-columns: 1fr; \}/);
  assert.match(css, /\.campaign-detail \{ order: -1; \}/);
  assert.match(css, /\.collection-nav \{ grid-template-columns: 1fr; \}/);
  assert.match(css, /\.command-deck__actions \{ grid-template-columns: 1fr; \}/);
});
