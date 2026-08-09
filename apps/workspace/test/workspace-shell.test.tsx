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
  parseWorkspacePath,
} from '../src/App.js';

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
