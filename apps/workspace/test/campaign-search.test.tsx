import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CampaignDocument } from '@st-llm-rpg/wire';
import { CampaignSearch, campaignSearchResults } from '../src/CampaignSearch.js';
import { CampaignRecordIndex } from '../src/CampaignRecordIndex.js';
import { quickCaptureOperation, QuickCapture } from '../src/QuickCapture.js';
import {
  parseWorkspacePath,
  requiresDirtyDraftConfirmation,
  workspaceHref,
} from '../src/workspace-navigation.js';

const document: CampaignDocument = {
  campaign: {
    id: 'campaign-1',
    title: 'House Harcourt',
    status: 'active',
    revision: 7,
    createdAt: '2026-08-12T10:00:00.000Z',
    updatedAt: '2026-08-12T11:00:00.000Z',
  },
  actors: [{
    id: 'actor-steward',
    name: 'The Steward',
    aliases: ['Old Fox'],
    summary: 'Runs the estate and watches the eastern gallery.',
    visibility: 'known',
    archived: false,
  }, {
    id: 'actor-heir',
    name: 'The Heir',
    summary: 'Returned home after many years.',
    visibility: 'known',
    archived: false,
  }],
  items: [{
    id: 'item-ledger',
    name: 'Private Ledger',
    summary: 'Contains the blackmail accounts.',
    visibility: 'campaign_private',
    archived: false,
  }],
  quests: [],
  places: [{
    id: 'place-gallery',
    name: 'Eastern Gallery',
    summary: 'A locked portrait gallery.',
    visibility: 'known',
    archived: false,
  }],
  facts: [{
    id: 'fact-bell',
    name: 'Broken bell rope',
    summary: 'The servant bell cannot be used.',
    visibility: 'known',
    archived: true,
  }],
  worldObjects: [],
  abilities: [],
  learnedAbilities: [],
  relationships: [{
    id: 'relationship-watchful',
    sourceActorId: 'actor-steward',
    targetActorId: 'actor-heir',
    kind: 'guardian',
    status: 'strained',
    notes: 'The Steward doubts the heir.',
    visibility: 'narrator_secret',
    archived: false,
  }],
  currentScene: {
    id: 'scene-gallery',
    name: 'Gallery confrontation',
    summary: 'The heir confronts the Steward beside the sealed portrait.',
    placeId: 'place-gallery',
  },
  sceneArchives: [],
};

test('human Campaign search includes aliases, private Records, and relationship text', () => {
  assert.deepEqual(campaignSearchResults(document, 'old fox').map(result => result.name), ['The Steward']);

  const privateResults = campaignSearchResults(document, 'blackmail');
  assert.equal(privateResults[0]?.name, 'Private Ledger');
  assert.equal(privateResults[0]?.visibility, 'campaign_private');

  const relationshipResults = campaignSearchResults(document, 'guardian strained');
  assert.equal(relationshipResults[0]?.kind, 'Relationship');
  assert.equal(relationshipResults[0]?.collection, 'actors');
  assert.equal(relationshipResults[0]?.recordId, 'actor-steward');
});

test('human Campaign search hides archived Records until explicitly included', () => {
  assert.deepEqual(campaignSearchResults(document, 'bell rope'), []);
  assert.equal(campaignSearchResults(document, 'bell rope', true)[0]?.name, 'Broken bell rope');
});

test('Campaign search renders navigable results without exposing a second persistence path', () => {
  const html = renderToStaticMarkup(<CampaignSearch
    document={document}
    route={{ campaignId: 'campaign-1', collection: 'actors', recordId: null, revision: null, query: 'old fox' }}
    onNavigate={() => undefined}
  />);
  assert.match(html, /Find anything/);
  assert.match(html, /The Steward/);
  assert.match(html, /Search names, aliases, descriptions, relationships/);
  assert.match(html, /href="\/campaigns\/campaign-1\/actors\/actor-steward"/);
});

test('Quick Capture maps each ordinary collection to the existing Campaign Operation interface', () => {
  assert.deepEqual(quickCaptureOperation('actors', '  Mara  '), { kind: 'create_actor', actor: { name: 'Mara' } });
  assert.deepEqual(quickCaptureOperation('items', 'Key'), { kind: 'create_item', item: { name: 'Key' } });
  assert.deepEqual(quickCaptureOperation('quests', 'Find witness'), { kind: 'create_quest', quest: { name: 'Find witness' } });
  assert.deepEqual(quickCaptureOperation('places', 'Gallery'), { kind: 'create_place', place: { name: 'Gallery' } });
  assert.deepEqual(quickCaptureOperation('facts', 'Seal broken'), { kind: 'create_fact', fact: { name: 'Seal broken' } });
  assert.deepEqual(quickCaptureOperation('world-objects', 'Wardrobe'), { kind: 'create_world_object', worldObject: { name: 'Wardrobe' } });
  assert.deepEqual(quickCaptureOperation('abilities', 'Mage Hand'), { kind: 'create_ability', ability: { name: 'Mage Hand' } });

  const html = renderToStaticMarkup(<QuickCapture collection="items" busy={false} onCapture={async () => true} />);
  assert.match(html, /Quick add Item/);
  assert.match(html, /Create a named stub now/);
  assert.match(html, /name="quick-capture-items"/);
  const abilityHtml = renderToStaticMarkup(<QuickCapture collection="abilities" busy={false} onCapture={async () => true} />);
  assert.match(abilityHtml, /Quick add Ability/);
  assert.doesNotMatch(abilityHtml, /Abilitie/);
});

test('Workspace navigation preserves search in the URL and guards only route-changing dirty navigation', () => {
  const route = parseWorkspacePath('/campaigns/campaign-1/items/item-key', '?revision=4&q=wardrobe%20key');
  assert.deepEqual(route, {
    campaignId: 'campaign-1',
    collection: 'items',
    recordId: 'item-key',
    revision: 4,
    query: 'wardrobe key',
  });
  assert.equal(workspaceHref(route), '/campaigns/campaign-1/items/item-key?revision=4&q=wardrobe+key');
  assert.equal(requiresDirtyDraftConfirmation(route, { ...route, query: 'key' }, true), false);
  assert.equal(requiresDirtyDraftConfirmation(route, { ...route, recordId: 'item-rope' }, true), true);
  assert.equal(requiresDirtyDraftConfirmation(route, { ...route, recordId: 'item-rope' }, false), false);
});

test('large collection indexes render in bounded pages while search still sees the full document', () => {
  const items = Array.from({ length: 45 }, (_value, index) => ({
    id: `item-${index + 1}`,
    name: `Item ${index + 1}`,
    summary: index === 44 ? 'The final searchable keepsake.' : '',
    archived: false,
  }));
  const largeDocument: CampaignDocument = { ...document, items };
  const html = renderToStaticMarkup(<CampaignRecordIndex
    collection="items"
    records={items}
    document={largeDocument}
    route={{ campaignId: 'campaign-1', collection: 'items', recordId: null, revision: null }}
    onNavigate={() => undefined}
  />);
  assert.equal(html.match(/class="record-index-card"/g)?.length, 40);
  assert.match(html, /Show 5 more · 5 remaining/);
  assert.equal(campaignSearchResults(largeDocument, 'final searchable')[0]?.name, 'Item 45');
});
