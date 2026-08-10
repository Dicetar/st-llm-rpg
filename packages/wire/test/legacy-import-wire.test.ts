import test from 'node:test';
import assert from 'node:assert/strict';
import { Value } from '@sinclair/typebox/value';
import {
  CreateChatBindingRequestSchema,
  isChatBindingDocument,
  isLegacyImportPreview,
} from '../src/index.js';

const locator = {
  kind: 'group' as const,
  chatId: 'Gate - 2026-08-01',
  groupId: 'party-1',
};

test('legacy import preview is bounded and requires explicit collision choices', () => {
  const preview = {
    schema: 'st-rpg.legacy-import-preview',
    version: '1.0',
    kind: 'copied-source',
    locator,
    sourceFingerprint: 'a'.repeat(64),
    contentFingerprint: 'b'.repeat(64),
    title: 'Emberfall',
    legacyRevision: 7,
    counts: { actors: 2, items: 1, quests: 1, places: 1, abilities: 1, learnedAbilities: 1, unsupported: 1 },
    issues: [{ severity: 'warning', code: 'unsupported-record-kind', path: 'campaign.records[4]', message: 'Ability is preserved but not projected yet.' }],
    decisions: ['link-existing', 'create-independent-import', 'cancel'],
    existingCampaignId: 'campaign-1',
    existingBindingId: 'binding-1',
    legacyMetadataPreserved: true,
  };
  assert.equal(isLegacyImportPreview(preview), true);
  assert.equal(isLegacyImportPreview({ ...preview, decisions: [] }), false);
  assert.equal(isLegacyImportPreview({ ...preview, arbitrary: true }), false);
});

test('binding document exposes marker verification without conflating Campaign revision', () => {
  const binding = {
    schema: 'st-rpg.chat-binding',
    version: '1.0',
    id: 'binding-1',
    campaignId: 'campaign-1',
    revision: 1,
    campaignAnchor: 1,
    locator,
    sourceFingerprint: 'a'.repeat(64),
    contentFingerprint: 'b'.repeat(64),
    markerState: 'verified',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  assert.equal(isChatBindingDocument(binding), true);
  assert.equal(isChatBindingDocument({ ...binding, campaignAnchor: 0 }), false);
  assert.equal(isChatBindingDocument({ ...binding, markerState: 'unknown' }), false);
});

test('fresh Chat Binding request pins explicit Campaign revision and saved-chat locator', () => {
  const request = {
    requestId: 'link-fresh-chat',
    expectedCampaignRevision: 7,
    locator,
  };
  assert.equal(Value.Check(CreateChatBindingRequestSchema, request), true);
  assert.equal(Value.Check(CreateChatBindingRequestSchema, { ...request, expectedCampaignRevision: 0 }), false);
  assert.equal(Value.Check(CreateChatBindingRequestSchema, { ...request, automatic: true }), false);
});
