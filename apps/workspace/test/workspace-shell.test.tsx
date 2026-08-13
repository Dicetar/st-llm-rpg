import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CampaignCommandDeck,
  CampaignBookView,
  CampaignHistoryView,
  CampaignCollectionCreator,
  ChatBindingsPanel,
  RevisionConflictBanner,
  WorkspaceRouteState,
  LegacyImportPreviewCard,
  ContextTray,
  NarrationStatusPanel,
  RecordEditor,
  LearnedAbilitiesPanel,
  RelationshipsPanel,
  ActorTrackersPanel,
  RelationshipMap,
  normalizedTrackerDraft,
  LinkedFactsPanel,
  PlaceWorldObjectsPanel,
  SceneEditor,
  AdvanceScenePanel,
  SceneArchiveList,
  StorySyncReviewInboxView,
  BackupPanelView,
  AddonPanelView,
  SessionHome,
  PlayerGuide,
  WorkspaceProblemBanner,
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
  assert.match(html, /people, places, gear, quests/);
  assert.match(html, /SillyTavern story/);
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
    parseWorkspacePath('/campaigns/campaign-1/abilities/ability-hand'),
    {
      campaignId: 'campaign-1',
      collection: 'abilities',
      recordId: 'ability-hand',
      revision: null,
    },
  );
  assert.deepEqual(parseWorkspacePath('/campaigns/campaign-1/relationships'), {
    campaignId: 'campaign-1', collection: 'relationships', recordId: null, revision: null,
  });
  assert.deepEqual(
    parseWorkspacePath('/campaigns/campaign-1/not-a-collection'),
    {
      campaignId: 'campaign-1',
      collection: 'home',
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
  assert.match(html, /create campaign/);
});

test('stale revision conflict tells the player that no Campaign state was written', () => {
  const html = renderToStaticMarkup(<RevisionConflictBanner
    conflict={{ campaignId: 'campaign-1', expectedRevision: 3, actualRevision: 4 }}
    busy={false}
    onReload={() => undefined}
    onStay={() => undefined}
  />);
  assert.match(html, /This tab is out of date/);
  assert.match(html, /expected revision 3/);
  assert.match(html, /now at revision 4/);
  assert.match(html, /Nothing was written/);
  assert.match(html, /Your draft is still here/);
  assert.match(html, /Keep draft and load latest/);
  assert.match(html, /Stay on this draft/);
});

test('Session Home builds a deterministic recap from the loaded Campaign revision without generation', () => {
  const html = renderToStaticMarkup(<SessionHome
    document={{
      campaign: {
        id: 'campaign-1', title: 'House Harcourt', status: 'active', revision: 12,
        createdAt: '2026-08-09T12:00:00.000Z', updatedAt: '2026-08-12T12:00:00.000Z',
      },
      actors: [
        { id: 'actor-mara', name: 'Mara', summary: 'The heir.', archived: false },
        { id: 'actor-lavir', name: 'Lavir', summary: 'The court mage.', archived: false },
      ],
      items: [{ id: 'item-key', name: 'Wardrobe Key', summary: 'A silver key.', archived: false }],
      quests: [{ id: 'quest-witness', name: 'Find the witness', summary: 'Trace the missing witness.', status: 'active', archived: false }],
      places: [{ id: 'place-bedroom', name: 'Childhood Bedroom', summary: 'Dusty and sealed.', archived: false }],
      worldObjects: [{ id: 'object-wardrobe', name: 'Heirloom Wardrobe', summary: 'Ancient mahogany.', placeId: 'place-bedroom', archived: false }],
      currentScene: {
        id: 'scene-bedroom', name: 'The sealed bedroom', summary: 'Mara and Lavir inspect the room.',
        placeId: 'place-bedroom', actorIds: ['actor-mara', 'actor-lavir'], itemIds: ['item-key'], worldObjectIds: ['object-wardrobe'],
      },
      sceneArchives: [{
        id: 'scene-hall', name: 'The east hall', summary: 'The servants were questioned.',
        outcomes: ['The key was found.'], openThreads: ['Who sealed the bedroom?'],
        closedAt: '2026-08-12T10:00:00.000Z',
      }],
    }}
    readOnly={false}
    onNavigate={() => undefined}
  />);

  assert.match(html, /Pick up the story/);
  assert.match(html, /revision 12/);
  assert.match(html, /makes no model call and changes nothing/);
  assert.match(html, /The sealed bedroom/);
  assert.match(html, /Childhood Bedroom/);
  assert.match(html, />Lavir<\/button>.*>Mara<\/button>/s);
  assert.match(html, /The key was found/);
  assert.match(html, /Who sealed the bedroom/);
  assert.match(html, /Find the witness/);
});

test('Actor live trackers keep quick changes and detailed editing beside the Actor', () => {
  const html = renderToStaticMarkup(<ActorTrackersPanel
    actor={{
      id: 'actor-mara', name: 'Mara', summary: 'The heir.', archived: false,
      trackers: [{ id: 'tracker-health', label: 'Health', current: 7, maximum: 10, notes: 'Wounded' }],
    }}
    busy={false}
    readOnly={false}
    onCreate={async () => undefined}
    onSave={async () => undefined}
    onAdjust={async () => undefined}
    onRemove={async () => undefined}
  />);

  assert.match(html, /Live trackers/);
  assert.match(html, /Health/);
  assert.match(html, /7 \/ 10/);
  assert.match(html, /role="meter"/);
  assert.match(html, /Decrease Health by one/);
  assert.match(html, /Increase Health by one/);
  assert.match(html, /\+ Add tracker/);
  assert.match(html, /Edit tracker/);
  assert.match(html, /Remove tracker/);
  assert.deepEqual(normalizedTrackerDraft({ label: ' Resolve ', current: '4', maximum: '9', notes: ' steady ' }), {
    label: 'Resolve', current: 4, maximum: 9, notes: 'steady',
  });
  assert.equal(normalizedTrackerDraft({ label: 'Resolve', current: '10', maximum: '9', notes: '' }), null);
});

test('Relationship Map provides deterministic diagram and keyboard-button routes', () => {
  const html = renderToStaticMarkup(<RelationshipMap
    actors={[
      { id: 'actor-mara', name: 'Mara', summary: '', archived: false },
      { id: 'actor-lavir', name: 'Lavir', summary: '', archived: false },
      { id: 'actor-archived', name: 'Old Rival', summary: '', archived: true },
    ]}
    relationships={[
      { id: 'relationship-trust', sourceActorId: 'actor-mara', targetActorId: 'actor-lavir', kind: 'trusts', status: 'active', notes: '', archived: false },
      { id: 'relationship-old', sourceActorId: 'actor-lavir', targetActorId: 'actor-archived', kind: 'rival', status: 'ended', notes: '', archived: true },
    ]}
    onOpenActor={() => undefined}
  />);

  assert.match(html, /Relationship Map/);
  assert.match(html, /role="img"/);
  assert.match(html, /Relationship routes/);
  assert.match(html, />Mara<\/button>/);
  assert.match(html, />Lavir<\/button>/);
  assert.match(html, /trusts/);
  assert.doesNotMatch(html, /Old Rival|rival/);
  assert.match(html, /1 link/);
});

test('every ordinary collection keeps quick capture and detailed creation in the same block', () => {
  const document = {
    campaign: {
      id: 'campaign-1', title: 'House Harcourt', status: 'active' as const, revision: 12,
      createdAt: '2026-08-09T12:00:00.000Z', updatedAt: '2026-08-12T12:00:00.000Z',
    },
    actors: [{ id: 'actor-mara', name: 'Mara', summary: 'The heir.', archived: false }],
    items: [], quests: [], places: [], facts: [], abilities: [], worldObjects: [], currentScene: null,
  };
  const actors = renderToStaticMarkup(<CampaignCollectionCreator
    collection="actors" document={document} subjects={[]} busy={false}
    onCapture={async () => false} onCreate={async () => null} onCreated={() => undefined}
  />);
  const abilities = renderToStaticMarkup(<CampaignCollectionCreator
    collection="abilities" document={document} subjects={[]} busy={false}
    onCapture={async () => false} onCreate={async () => null} onCreated={() => undefined}
  />);

  assert.match(actors, /Quick add Actor/);
  assert.match(actors, /Add Actor with details/);
  assert.match(actors, /Actor name/);
  assert.match(actors, /Create Actor with carried Item/);
  assert.match(abilities, /Add Ability with details/);
  assert.match(abilities, /Learn now \(optional\)/);
  assert.match(abilities, /Definition only/);
});

test('Player Handbook teaches setup, play, context, saving, privacy, and recovery in player language', () => {
  const html = renderToStaticMarkup(<PlayerGuide onNavigate={() => undefined} />);
  assert.match(html, /Player handbook/);
  assert.match(html, /Chat is the story. Campaign Book is the reference/);
  assert.match(html, /Your repeatable session route/);
  assert.match(html, /Link one saved chat/);
  assert.match(html, /Set the present Scene/);
  assert.match(html, /Live trackers/);
  assert.match(html, /Relationship Map/);
  assert.match(html, /Relevant detail, not the whole database/);
  assert.match(html, /Immediate/);
  assert.match(html, /Save or Cancel/);
  assert.match(html, /Review then apply/);
  assert.match(html, /Player notes/);
  assert.match(html, /never sent to the narrator/);
  assert.match(html, /This tab is out of date/);
  assert.match(html, /LM Studio is unavailable/);
  assert.match(html, /Open Session Home/);
  assert.doesNotMatch(html, /SQLite|FTS5|projection|Binding Event/);
});

test('Workspace error presentation leads with recovery and keeps technical detail secondary', () => {
  const html = renderToStaticMarkup(<WorkspaceProblemBanner
    failure={{
      title: 'Saved Campaigns are unavailable',
      message: 'Campaign Book cannot reach its saved Campaign data right now.',
      recovery: 'Keep this page open, restart the Companion if needed, then try again.',
      technical: 'connect ECONNREFUSED 127.0.0.1:8002',
    }}
    onRetry={() => undefined}
  />);
  assert.match(html, /Saved Campaigns are unavailable/);
  assert.match(html, /Keep this page open/);
  assert.match(html, /Try again/);
  assert.match(html, /Technical details/);
  assert.ok(html.indexOf('Technical details') < html.indexOf('ECONNREFUSED'));
});

test('Quick Actions expose common Campaign actions without leaving the current Campaign', () => {
  const html = renderToStaticMarkup(<CampaignCommandDeck
    campaignId="campaign-1"
    revision={7}
    hasCurrentScene={false}
    busy={false}
    readOnly={false}
    onNavigate={() => undefined}
  />);

  assert.match(html, /Quick Actions/);
  assert.match(html, /Add Actor/);
  assert.match(html, /Add Item/);
  assert.match(html, /Add Ability/);
  assert.match(html, /Add Relationship/);
  assert.match(html, /Start Scene/);
  assert.match(html, /Review Changes/);
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
      counts: { actors: 2, items: 1, quests: 1, places: 1, abilities: 1, learnedAbilities: 1, relationships: 1, unsupported: 1 },
      issues: [{ severity: 'warning', code: 'unsupported-scene-archive', path: 'campaign.sceneArchives', message: 'Scene Archive is preserved but not projected yet.' }],
      decisions: ['create-campaign', 'cancel'], legacyMetadataPreserved: true,
    }}
  />);
  assert.match(html, /Revision 7/);
  assert.match(html, /<strong>2<\/strong> Actors/);
  assert.match(html, /<strong>1<\/strong> relationships/);
  assert.match(html, /<strong>1<\/strong> preserved for later/);
  assert.match(html, /Scene Archive is preserved but not projected yet/);
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
    campaignId="campaign-1"
    campaignRevision={7}
    onLinked={() => undefined}
    onRetryMarker={() => undefined}
  />);
  assert.match(html, /Linked SillyTavern chats/);
  assert.match(html, /Emberfall/);
  assert.match(html, /Campaign anchor 7/);
  assert.match(html, /marker blocked/);
  assert.match(html, /Retry marker/);
  assert.match(html, /Link a saved SillyTavern chat/);
  assert.match(html, /Link chat/);
});

test('Context Tray keeps profile, ordered pins, planning evidence, and privacy in one routed surface', () => {
  const html = renderToStaticMarkup(<ContextTray
    document={{
      campaign: {
        id: 'campaign-1', title: 'House Harcourt', status: 'active', revision: 7,
        createdAt: '2026-08-09T12:00:00.000Z', updatedAt: '2026-08-09T12:00:00.000Z',
      },
      actors: [{ id: 'actor-lavir', name: 'Lavir', summary: 'A noble.', archived: false, visibility: 'known' }, { id: 'actor-mara', name: 'Mara', summary: 'An investigator.', archived: false, visibility: 'known' }],
      items: [{ id: 'item-private', name: 'Private Ledger', summary: 'Never sent.', archived: false, visibility: 'campaign_private' }],
      quests: [], places: [], abilities: [{ id: 'ability-hand', name: 'Mage Hand', summary: 'Moves objects.', category: 'spell', archived: false }],
      relationships: [{ id: 'relationship-patron', sourceActorId: 'actor-lavir', targetActorId: 'actor-mara', kind: 'patron', status: 'active', notes: '', archived: false }],
      currentScene: null,
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
  assert.match(html, /Narrator Context/);
  assert.match(html, /Narrator model profile/);
  assert.match(html, /Ordered manual pins/);
  assert.match(html, /Private Ledger/);
  assert.match(html, /Mage Hand/);
  assert.match(html, /Lavir → Mara: patron/);
  assert.match(html, /Player notes/);
  assert.match(html, /Safety margin/);
  assert.match(html, /Automatic Record limit/);
  assert.match(html, /Generation type/);
  assert.match(html, /Continue/);
  assert.match(html, /Build Context Plan/);
});

test('Context Tray offers an explicit Follow current Campaign action for a Binding mismatch', () => {
  const html = renderToStaticMarkup(<ContextTray
    document={{
      campaign: {
        id: 'campaign-1', title: 'House Harcourt', status: 'active', revision: 8,
        createdAt: '2026-08-09T12:00:00.000Z', updatedAt: '2026-08-10T12:00:00.000Z',
      },
      actors: [], items: [], quests: [], places: [], abilities: [], relationships: [], currentScene: null,
    }}
    bindings={[{
      schema: 'st-rpg.chat-binding', version: '1.0', id: 'binding-1', campaignId: 'campaign-1',
      revision: 3, campaignAnchor: 7, contextFocusRevision: 1, pins: [],
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
  assert.match(html, /anchored to revision 7/);
  assert.match(html, /Follow current Campaign/);
  assert.match(html, /revision 8/);
  assert.match(html, /never follows automatically/i);
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
  assert.match(html, /Who can use this/);
  assert.match(html, /Behind the scenes/);
  assert.doesNotMatch(html, /comma-separated/i);
});

test('Ability editor keeps learned Actor state and add action in the same block', () => {
  const html = renderToStaticMarkup(<>
    <RecordEditor
      kind="ability"
      record={{ id: 'ability-hand', name: 'Mage Hand', aliases: [], summary: 'Moves light objects.', category: 'spell', archived: false }}
      actors={[{ id: 'actor-mara', name: 'Mara', summary: '', archived: false }]}
      busy={false}
      readOnly={false}
      onSave={async () => undefined}
      onArchive={async () => undefined}
    />
    <LearnedAbilitiesPanel
      ability={{ id: 'ability-hand', name: 'Mage Hand', aliases: [], summary: 'Moves light objects.', category: 'spell', archived: false }}
      learned={[{ id: 'learned-hand', abilityId: 'ability-hand', actorId: 'actor-mara', prepared: true, enabled: true, usesRemaining: 2, usesMaximum: 3, archived: false }]}
      actors={[{ id: 'actor-mara', name: 'Mara', summary: '', archived: false }, { id: 'actor-lavir', name: 'Lavir', summary: '', archived: false }]}
      busy={false}
      readOnly={false}
      onCreate={async () => undefined}
      onSave={async () => undefined}
      onArchive={async () => undefined}
    />
  </>);
  assert.match(html, /Category/);
  assert.match(html, /Known by Actors/);
  assert.match(html, /Add Actor/);
  assert.match(html, /Mara/);
  assert.match(html, /Uses left/);
  assert.match(html, /Remove/);
});

test('Actor-local Relationships editor creates, edits, and removes directed links in the same block', () => {
  const actors = [
    { id: 'actor-lavir', name: 'Lavir', summary: '', archived: false },
    { id: 'actor-mara', name: 'Mara', summary: '', archived: false },
  ];
  const html = renderToStaticMarkup(<RelationshipsPanel
    focusActorId="actor-lavir"
    actors={actors}
    relationships={[{
      id: 'relationship-patron', sourceActorId: 'actor-lavir', targetActorId: 'actor-mara',
      kind: 'patron', status: 'strained', notes: 'Lavir expects proof.', visibility: 'known', archived: false,
    }]}
    busy={false}
    readOnly={false}
    onCreate={async () => undefined}
    onSave={async () => undefined}
    onArchive={async () => undefined}
  />);
  assert.match(html, /Relationships/);
  assert.match(html, /This Actor → other/);
  assert.match(html, /Other → this Actor/);
  assert.match(html, /Add Relationship/);
  assert.match(html, /patron/);
  assert.match(html, /Strained/);
  assert.match(html, /Lavir expects proof/);
  assert.match(html, /Save Relationship/);
  assert.match(html, /Remove/);
});

test('Scene editor exposes structural Place, Actor, Item, and World Object attachments for Context anchors', () => {
  const html = renderToStaticMarkup(<SceneEditor
    scene={{
      id: 'scene-1', name: 'Bedroom', summary: 'A guarded meeting.', placeId: 'place-house',
      actorIds: ['actor-lavir'], itemIds: ['item-key'], worldObjectIds: ['object-wardrobe'],
    }}
    actors={[{ id: 'actor-lavir', name: 'Lavir', summary: '', archived: false }]}
    items={[{ id: 'item-key', name: 'Wardrobe Key', summary: '', archived: false }]}
    places={[{ id: 'place-house', name: 'House Harcourt', summary: '', archived: false }]}
    worldObjects={[{ id: 'object-wardrobe', name: 'Heirloom Wardrobe', summary: '', placeId: 'place-house', archived: false }]}
    busy={false}
    readOnly={false}
    onSave={async () => undefined}
  />);
  assert.match(html, /Scene Place/);
  assert.match(html, /Present Actors/);
  assert.match(html, /Present Items/);
  assert.match(html, /Present Scene Features/);
  assert.match(html, /Lavir/);
  assert.match(html, /Wardrobe Key/);
  assert.match(html, /Heirloom Wardrobe/);
});

test('Advance Scene keeps closure, carry-forward controls, and immutable archives in one workflow', () => {
  const scene = {
    id: 'scene-bedroom', name: 'Bedroom confrontation', summary: 'Lavir faces the heir.', placeId: 'place-house',
    actorIds: ['actor-lavir'], itemIds: ['item-key'], worldObjectIds: ['object-wardrobe'],
  };
  const actors = [{ id: 'actor-lavir', name: 'Lavir', summary: '', archived: false }];
  const items = [{ id: 'item-key', name: 'Wardrobe Key', summary: '', archived: false }];
  const places = [{ id: 'place-house', name: 'House Harcourt', summary: '', archived: false }];
  const worldObjects = [{ id: 'object-wardrobe', name: 'Heirloom Wardrobe', summary: '', placeId: 'place-house', archived: false }];
  const advance = renderToStaticMarkup(<AdvanceScenePanel scene={scene} actors={actors} items={items} places={places} worldObjects={worldObjects} busy={false} onAdvance={async () => undefined} />);
  assert.match(advance, /Advance Scene/);
  assert.match(advance, /Closing summary/);
  assert.match(advance, /Outcomes/);
  assert.match(advance, /Open threads/);
  assert.match(advance, /Next Scene/);
  assert.match(advance, /Carry Actors/);
  assert.match(advance, /Close current and open next/);
  assert.match(advance, /Nothing is generated automatically/);

  const archive = renderToStaticMarkup(<SceneArchiveList places={places} archives={[{
    ...scene,
    summary: 'The heir secures the key.',
    outcomes: ['Wardrobe opened.'],
    openThreads: ['Who altered the seal?'],
    closedAt: '2026-08-10T15:00:00.000Z',
  }]} />);
  assert.match(archive, /Past Scenes/);
  assert.match(archive, /1 immutable/);
  assert.match(archive, /Wardrobe opened/);
  assert.match(archive, /Who altered the seal/);
});

test('Fact and World Object blocks keep add, edit, and remove controls beside their parent Record', () => {
  const factsHtml = renderToStaticMarkup(<LinkedFactsPanel
    facts={[{ id: 'fact-key', name: 'Key is missing', summary: 'Removed before dawn.', subjectId: 'object-wardrobe', visibility: 'narrator_secret', archived: false }]}
    subjectId="object-wardrobe"
    subjectLabel="Heirloom Wardrobe"
    options={[{ id: 'object-wardrobe', label: 'World Object · Heirloom Wardrobe', archived: false }]}
    busy={false}
    readOnly={false}
    onCreate={async () => undefined}
    onSave={async () => undefined}
    onArchive={async () => undefined}
  />);
  assert.match(factsHtml, /Facts about Heirloom Wardrobe/);
  assert.match(factsHtml, /\+ Add Fact/);
  assert.match(factsHtml, /Save Fact/);
  assert.match(factsHtml, /Remove Fact/);

  const objectsHtml = renderToStaticMarkup(<PlaceWorldObjectsPanel
    worldObjects={[{ id: 'object-wardrobe', name: 'Heirloom Wardrobe', summary: 'Ancient red mahogany.', placeId: 'place-bedroom', archived: false }]}
    placeId="place-bedroom"
    placeLabel="Childhood Bedroom"
    places={[{ id: 'place-bedroom', name: 'Childhood Bedroom', summary: '', archived: false }]}
    busy={false}
    readOnly={false}
    onCreate={async () => undefined}
    onSave={async () => undefined}
    onArchive={async () => undefined}
  />);
  assert.match(objectsHtml, /Scene Features in Childhood Bedroom/);
  assert.match(objectsHtml, /\+ Add Scene Feature/);
  assert.match(objectsHtml, /Save Scene Feature/);
  assert.match(objectsHtml, /Remove Scene Feature/);
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

  assert.match(html, /Suggested Story Updates/);
  assert.match(html, /Campaign worker model/);
  assert.match(html, /New Fact/);
  assert.match(html, /New Scene Feature/);
  assert.match(html, /mistralai\/mistral-nemo-instruct-2407/);
  assert.match(html, /Lavir reveals the locked gallery/);
  assert.match(html, /Record type/);
  assert.match(html, /New Ability/);
  assert.match(html, /New Relationship/);
  assert.match(html, /Actor summary/);
  assert.match(html, /Accept/);
  assert.match(html, /Reject/);
  assert.match(html, /Defer/);
  assert.match(html, /Apply reviewed updates/);
  assert.match(html, /saves all accepted changes together/);
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
  assert.match(failed, /Try again/);
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
  assert.match(css, /\.guide-setup, \.guide-collection-grid \{ grid-template-columns: 1fr; \}/);
  assert.match(css, /\.guide-principle \{ grid-template-columns: 1fr; \}/);
});
