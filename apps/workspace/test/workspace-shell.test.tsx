import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CampaignBookView,
  CampaignHistoryView,
  RevisionConflictBanner,
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
  />);
  assert.match(html, /This tab is stale/);
  assert.match(html, /expected revision 3/);
  assert.match(html, /now at revision 4/);
  assert.match(html, /Nothing was written/);
  assert.match(html, /Load canonical Campaign/);
});

test('narrow CSS prevents horizontal overflow and keeps routed controls touch-sized', async () => {
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /overflow-x:\s*hidden/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /\.authority-layout \{ grid-template-columns: 1fr; \}/);
  assert.match(css, /\.collection-nav \{ grid-template-columns: 1fr; \}/);
});
