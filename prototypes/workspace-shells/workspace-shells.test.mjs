import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createMockCampaignEngine, createMockWorkspace } from './mock-workspace.mjs';

const directory = fileURLToPath(new URL('.', import.meta.url));
const read = (name) => readFile(new URL(name, import.meta.url), 'utf8');

test('mock Workspace exposes every required task document', async () => {
  const engine = createMockCampaignEngine();
  const workspace = createMockWorkspace(engine);
  const requests = [
    { kind: 'home', campaignId: 'campaign-emberfall' },
    { kind: 'collection', campaignId: 'campaign-emberfall', collection: 'actors' },
    { kind: 'record', campaignId: 'campaign-emberfall', recordId: 'actor-seraphine' },
    { kind: 'review', campaignId: 'campaign-emberfall' },
    { kind: 'context', campaignId: 'campaign-emberfall' },
    { kind: 'import', campaignId: 'campaign-emberfall' },
    { kind: 'maintenance', campaignId: 'campaign-emberfall' },
  ];

  for (const request of requests) {
    const result = await workspace.load(request);
    assert.equal(result.ok, true, `expected ${request.kind} document to load`);
  }
});

test('accepted Workspace intent advances Campaign revision exactly once', async () => {
  const engine = createMockCampaignEngine();
  const workspace = createMockWorkspace(engine);
  const before = engine.snapshot().campaign.revision;

  const result = await workspace.act({
    kind: 'save-record',
    requestId: 'request-save-1',
    campaignId: 'campaign-emberfall',
    expectedRevision: before,
    recordId: 'actor-seraphine',
    patch: { status: 'Present and alert' },
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.campaignRevision, before + 1);
  assert.equal(engine.snapshot().campaign.revision, before + 1);
  assert.equal(engine.snapshot().events.length, 1);
});

test('stale Workspace intent returns a structured conflict and preserves state', async () => {
  const engine = createMockCampaignEngine();
  const workspace = createMockWorkspace(engine);
  const before = engine.snapshot();

  const result = await workspace.act({
    kind: 'save-record',
    requestId: 'request-stale-1',
    campaignId: 'campaign-emberfall',
    expectedRevision: before.campaign.revision - 1,
    recordId: 'actor-seraphine',
    patch: { status: 'This must not commit' },
  });

  assert.equal(result.ok, false);
  assert.equal(result.problem.code, 'campaign_revision_conflict');
  assert.equal(engine.snapshot().campaign.revision, before.campaign.revision);
  assert.equal(engine.snapshot().collections.actors[1].status, before.collections.actors[1].status);
  assert.equal(engine.snapshot().events.length, 0);
});

test('manual pin changes advance Binding history without Campaign history', async () => {
  const engine = createMockCampaignEngine();
  const workspace = createMockWorkspace(engine);
  const before = engine.snapshot();

  const result = await workspace.act({
    kind: 'replace-pins',
    requestId: 'request-pins-1',
    bindingId: before.binding.id,
    expectedBindingRevision: before.binding.revision,
    pins: ['item-mourning-cloak'],
  });

  assert.equal(result.ok, true);
  const after = engine.snapshot();
  assert.equal(after.binding.revision, before.binding.revision + 1);
  assert.equal(after.campaign.revision, before.campaign.revision);
  assert.deepEqual(after.binding.pins, ['item-mourning-cloak']);
});

test('prototype contains three distinct shells and required workflows', async () => {
  const app = await read('app.mjs');
  for (const shell of ['ledger', 'deck', 'book']) {
    assert.match(app, new RegExp(`${shell}:`));
  }
  for (const route of ['actors', 'inventory', 'abilities', 'objectives', 'world', 'review', 'context', 'import', 'maintenance']) {
    assert.match(app, new RegExp(`${route}:`));
  }
  for (const workflow of ['save-record', 'accept-proposal', 'replace-pins', 'apply-import', 'create-backup']) {
    assert.match(app, new RegExp(workflow));
  }
});

test('HTML and CSS include keyboard, responsive, reduced-motion, and touch safeguards', async () => {
  const [html, css] = await Promise.all([read('index.html'), read('styles.css')]);
  assert.match(html, /name="viewport"/);
  assert.match(html, /class="skip-link"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /--touch: 46px/);
  assert.ok(directory.endsWith('workspace-shells/'));
});
