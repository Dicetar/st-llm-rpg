import assert from 'node:assert/strict';
import test from 'node:test';
import { isContextPlan } from '../src/index.js';

const plan = {
  schema: 'st-rpg.context-plan',
  version: '1.0',
  requestId: 'context-wire-plan',
  authority: {
    campaignId: 'campaign-1',
    campaignRevision: 4,
    bindingId: 'binding-1',
    bindingRevision: 3,
    contextFocusRevision: 2,
  },
  modelProfile: { id: 'profile-1', modelId: 'qwen3.6-27b' },
  generationType: 'continue',
  evidence: {
    excerptHash: 'a'.repeat(64),
    estimatedTokens: 2_000,
    messageCount: 8,
  },
  budget: {
    inputCeilingTokens: 28_000,
    campaignBudgetTokens: 6_000,
    existingMessageTokens: 2_000,
    usedCampaignTokens: 300,
    remainingCampaignTokens: 5_700,
  },
  selections: [{
    tier: 'required-core',
    label: 'Campaign core',
    visibility: 'known',
    tokenCost: 300,
    reason: 'Required authority.',
  }],
  omissions: [],
  ambiguities: [],
  blocks: { known: 'CAMPAIGN CORE' },
  contentHash: 'b'.repeat(64),
} as const;

test('Context Plan wire contract pins generation type and bounded evidence', () => {
  assert.equal(isContextPlan(plan), true);
  assert.equal(isContextPlan({ ...plan, generationType: undefined }), false);
  assert.equal(isContextPlan({ ...plan, evidence: { ...plan.evidence, estimatedTokens: 2_001 } }), false);
});
