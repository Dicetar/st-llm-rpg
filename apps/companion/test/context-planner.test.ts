import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  CampaignDocument,
  ChatBindingDocument,
  NarratorModelProfile,
} from '@st-llm-rpg/wire';
import {
  ContextPlanner,
  type ContextPlanningSource,
} from '../src/modules/context/context-planner.js';

const campaign: CampaignDocument = {
  campaign: {
    id: 'campaign-context',
    title: 'House Harcourt',
    status: 'active',
    revision: 7,
    createdAt: '2026-08-09T00:00:00.000Z',
    updatedAt: '2026-08-09T00:00:00.000Z',
  },
  actors: [
    {
      id: 'actor-lavir',
      name: 'Lavir',
      aliases: ['Lord Harcourt'],
      summary: 'A demanding noble who expects precision.',
      visibility: 'known',
      archived: false,
    },
  ],
  items: [
    {
      id: 'item-key',
      name: 'Wardrobe Key',
      aliases: ['silver key'],
      summary: 'A small silver key cut for the heirloom wardrobe.',
      visibility: 'known',
      archived: false,
      ownerActorId: 'actor-lavir',
    },
    {
      id: 'item-wardrobe',
      name: 'Heirloom Wardrobe',
      aliases: [],
      summary: 'Ancient red mahogany with silver draconic filigree.',
      visibility: 'known',
      archived: false,
    },
  ],
  quests: [],
  places: [],
  currentScene: {
    id: 'scene-bedroom',
    name: 'Childhood Bedroom',
    summary: 'A quiet room dominated by an old wardrobe.',
  },
};

const binding: ChatBindingDocument = {
  schema: 'st-rpg.chat-binding',
  version: '1.0',
  id: 'binding-context',
  campaignId: campaign.campaign.id,
  revision: 3,
  campaignAnchor: campaign.campaign.revision,
  contextFocusRevision: 2,
  pins: ['item-key'],
  locator: { kind: 'character', chatId: 'context-chat', avatar: 'Narrator.png' },
  sourceFingerprint: 'a'.repeat(64),
  contentFingerprint: 'b'.repeat(64),
  markerState: 'verified',
  createdAt: '2026-08-09T00:00:00.000Z',
  updatedAt: '2026-08-09T00:00:00.000Z',
};

const profile: NarratorModelProfile = {
  id: 'profile-nemo',
  modelId: 'mistralai/mistral-nemo-instruct-2407',
  contextWindowTokens: 16_384,
  requestedVisibleOutputTokens: 2_048,
  safetyMarginTokens: 1_024,
  maxCampaignTokens: 4_096,
  maxAutomaticRecords: 10,
  maxRelationExpansions: 4,
};

function source(
  searchHits: Awaited<ReturnType<ContextPlanningSource['search']>> = [],
  authority: Readonly<{
    campaign: CampaignDocument;
    binding: ChatBindingDocument;
    profile: NarratorModelProfile;
  }> = { campaign, binding, profile },
): ContextPlanningSource {
  return {
    async readAuthority() {
      return authority;
    },
    async search() {
      return searchHits;
    },
  };
}

test('Context plan keeps ordered pins ahead of exact textual mentions', async () => {
  const planner = new ContextPlanner(source());

  const outcome = await planner.plan({
    requestId: 'context-request-1',
    campaignId: campaign.campaign.id,
    campaignRevision: 7,
    bindingId: binding.id,
    bindingRevision: 3,
    contextFocusRevision: 2,
    modelProfileId: profile.id,
    generationType: 'normal',
    messages: [
      { role: 'assistant', content: 'The wardrobe waits in the dark.' },
      { role: 'user', content: 'I show the Wardrobe Key to Lavir.' },
    ],
  }, new AbortController().signal);

  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.deepEqual(
    outcome.value.selections.map(selection => [selection.tier, selection.recordId ?? null]),
    [
      ['required-core', null],
      ['manual-pin', 'item-key'],
      ['exact-mention', 'actor-lavir'],
    ],
  );
  assert.match(outcome.value.blocks.known, /Wardrobe Key/);
  assert.match(outcome.value.blocks.known, /Lavir/);
});

test('Context plan isolates Narrator Secret material and erases Campaign Private material', async () => {
  const visibilityCampaign: CampaignDocument = {
    ...campaign,
    actors: [
      ...campaign.actors,
      {
        id: 'actor-secret',
        name: 'Hidden Master',
        aliases: [],
        summary: 'Secretly directs the household from below the chapel.',
        visibility: 'narrator_secret',
        archived: false,
      },
    ],
    items: [
      ...campaign.items,
      {
        id: 'item-private',
        name: 'Blackmail Ledger',
        aliases: [],
        summary: 'Campaign-owner notes that must never reach narration.',
        visibility: 'campaign_private',
        archived: false,
      },
    ],
  };
  const visibilityBinding = { ...binding, pins: [] };
  const planner = new ContextPlanner(source([], {
    campaign: visibilityCampaign,
    binding: visibilityBinding,
    profile,
  }));

  const outcome = await planner.plan({
    requestId: 'context-request-visibility',
    campaignId: campaign.campaign.id,
    campaignRevision: 7,
    bindingId: binding.id,
    bindingRevision: 3,
    contextFocusRevision: 2,
    modelProfileId: profile.id,
    generationType: 'normal',
    messages: [
      { role: 'user', content: 'I follow the Hidden Master toward the Blackmail Ledger.' },
    ],
  }, new AbortController().signal);

  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.doesNotMatch(outcome.value.blocks.known, /Hidden Master|Blackmail Ledger/);
  assert.match(outcome.value.blocks.secret ?? '', /Hidden Master/);
  assert.doesNotMatch(JSON.stringify(outcome.value), /Blackmail Ledger|Campaign-owner notes/);
});

test('one pinned identity resolves a shared alias without selecting its unpinned namesake', async () => {
  const ambiguousCampaign: CampaignDocument = {
    ...campaign,
    actors: [
      {
        id: 'actor-warden-east',
        name: 'Edric',
        aliases: ['the warden'],
        summary: 'Warden of the eastern gate.',
        visibility: 'known',
        archived: false,
      },
      {
        id: 'actor-warden-west',
        name: 'Mara',
        aliases: ['the warden'],
        summary: 'Warden of the western gate.',
        visibility: 'known',
        archived: false,
      },
    ],
    items: [],
  };
  const ambiguousBinding = { ...binding, pins: ['actor-warden-east'] };
  const planner = new ContextPlanner(source([], {
    campaign: ambiguousCampaign,
    binding: ambiguousBinding,
    profile,
  }));

  const outcome = await planner.plan({
    requestId: 'context-request-pinned-identity',
    campaignId: campaign.campaign.id,
    campaignRevision: 7,
    bindingId: binding.id,
    bindingRevision: 3,
    contextFocusRevision: 2,
    modelProfileId: profile.id,
    generationType: 'normal',
    messages: [{ role: 'user', content: 'I ask the warden to open the gate.' }],
  }, new AbortController().signal);

  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.deepEqual(
    outcome.value.selections.map(selection => selection.recordId).filter(Boolean),
    ['actor-warden-east'],
  );
  assert.deepEqual(outcome.value.ambiguities, []);
});

test('Context plan adds qualified SQLite search hits after exact mentions', async () => {
  const planner = new ContextPlanner(source([
    { recordId: 'item-wardrobe', rank: -4.2, matchedTerms: 2 },
  ]));

  const outcome = await planner.plan({
    requestId: 'context-request-fts',
    campaignId: campaign.campaign.id,
    campaignRevision: 7,
    bindingId: binding.id,
    bindingRevision: 3,
    contextFocusRevision: 2,
    modelProfileId: profile.id,
    generationType: 'normal',
    messages: [
      { role: 'user', content: 'I inspect the ancient mahogany panels.' },
    ],
  }, new AbortController().signal);

  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.deepEqual(
    outcome.value.selections.map(selection => [selection.tier, selection.recordId ?? null]),
    [
      ['required-core', null],
      ['manual-pin', 'item-key'],
      ['fts5', 'item-wardrobe'],
      ['relation-hop', 'actor-lavir'],
    ],
  );
});

test('current Scene structural IDs select detail before lexical search', async () => {
  const sceneCampaign: CampaignDocument = {
    ...campaign,
    currentScene: {
      id: 'scene-bedroom',
      name: 'Childhood Bedroom',
      summary: 'A guarded conversation is underway.',
      actorIds: ['actor-lavir'],
      itemIds: [],
    },
  };
  const sceneBinding = { ...binding, pins: [] };
  const planner = new ContextPlanner(source([], { campaign: sceneCampaign, binding: sceneBinding, profile }));

  const outcome = await planner.plan({
    requestId: 'context-request-scene',
    campaignId: campaign.campaign.id,
    campaignRevision: 7,
    bindingId: binding.id,
    bindingRevision: 3,
    contextFocusRevision: 2,
    modelProfileId: profile.id,
    generationType: 'normal',
    messages: [{ role: 'user', content: 'I wait for an answer.' }],
  }, new AbortController().signal);

  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.value.selections[1]?.tier, 'scene-anchor');
  assert.equal(outcome.value.selections[1]?.recordId, 'actor-lavir');
});

test('one bounded relation hop follows an explicitly selected Record after retrieval', async () => {
  const relationBinding = { ...binding, pins: [] };
  const planner = new ContextPlanner(source([], { campaign, binding: relationBinding, profile }));

  const outcome = await planner.plan({
    requestId: 'context-request-relation',
    campaignId: campaign.campaign.id,
    campaignRevision: 7,
    bindingId: binding.id,
    bindingRevision: 3,
    contextFocusRevision: 2,
    modelProfileId: profile.id,
    generationType: 'normal',
    messages: [{ role: 'user', content: 'I turn the Wardrobe Key in the lock.' }],
  }, new AbortController().signal);

  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.deepEqual(
    outcome.value.selections.map(selection => [selection.tier, selection.recordId ?? null]),
    [
      ['required-core', null],
      ['exact-mention', 'item-key'],
      ['relation-hop', 'actor-lavir'],
    ],
  );
});

test('oversized manual pins fail before inference with explicit unpin and profile actions', async () => {
  const oversizedCampaign: CampaignDocument = {
    ...campaign,
    items: campaign.items.map(item => item.id === 'item-key'
      ? { ...item, summary: 'x'.repeat(2_000) }
      : item),
  };
  const tightProfile = { ...profile, maxCampaignTokens: 300 };
  const planner = new ContextPlanner(source([], {
    campaign: oversizedCampaign,
    binding,
    profile: tightProfile,
  }));

  const outcome = await planner.plan({
    requestId: 'context-request-pin-budget',
    campaignId: campaign.campaign.id,
    campaignRevision: 7,
    bindingId: binding.id,
    bindingRevision: 3,
    contextFocusRevision: 2,
    modelProfileId: profile.id,
    generationType: 'normal',
    messages: [{ role: 'user', content: 'I wait.' }],
  }, new AbortController().signal);

  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.problem.code, 'CONTEXT_PINS_OVER_BUDGET');
  assert.deepEqual(outcome.problem.actions.map(action => action.id), [
    'open-context-tray',
    'unpin-record',
    'choose-larger-profile',
  ]);

  const coreOutcome = await new ContextPlanner(source([], {
    campaign,
    binding: { ...binding, pins: [] },
    profile: { ...profile, maxCampaignTokens: 1 },
  })).plan({
    requestId: 'context-request-core-budget',
    campaignId: campaign.campaign.id,
    campaignRevision: 7,
    bindingId: binding.id,
    bindingRevision: 3,
    contextFocusRevision: 2,
    modelProfileId: profile.id,
    generationType: 'normal',
    messages: [{ role: 'user', content: 'I wait.' }],
  }, new AbortController().signal);
  assert.equal(coreOutcome.ok, false);
  if (!coreOutcome.ok) {
    assert.equal(coreOutcome.problem.code, 'CONTEXT_CORE_OVER_BUDGET');
    assert.deepEqual(coreOutcome.problem.actions.map(action => action.id), [
      'open-context-tray',
      'choose-larger-profile',
    ]);
  }
});

test('Context plan pins generation intent and deterministically bounds retrieval evidence', async () => {
  const planner = new ContextPlanner(source());
  const request = {
    requestId: 'context-request-bounded-evidence',
    campaignId: campaign.campaign.id,
    campaignRevision: 7,
    bindingId: binding.id,
    bindingRevision: 3,
    contextFocusRevision: 2,
    modelProfileId: profile.id,
    generationType: 'continue' as const,
    messages: [{ role: 'user' as const, content: 'wardrobe '.repeat(10_000) }],
  };

  const first = await planner.plan(request, new AbortController().signal);
  const second = await planner.plan(request, new AbortController().signal);

  assert.equal(first.ok, true);
  assert.deepEqual(second, first);
  if (!first.ok) return;
  assert.equal(first.value.generationType, 'continue');
  assert.equal(first.value.evidence.estimatedTokens, 2_000);
  assert.equal(first.value.evidence.messageCount, 1);
  assert.match(first.value.evidence.excerptHash, /^[a-f0-9]{64}$/);
});

test('an unpinned shared alias produces an ambiguity and selects neither identity', async () => {
  const ambiguousCampaign: CampaignDocument = {
    ...campaign,
    actors: [
      {
        id: 'actor-warden-east',
        name: 'Edric',
        aliases: ['the warden'],
        summary: 'Warden of the eastern gate.',
        visibility: 'known',
        archived: false,
      },
      {
        id: 'actor-warden-west',
        name: 'Mara',
        aliases: ['the warden'],
        summary: 'Warden of the western gate.',
        visibility: 'known',
        archived: false,
      },
    ],
    items: [],
  };
  const planner = new ContextPlanner(source([], {
    campaign: ambiguousCampaign,
    binding: { ...binding, pins: [] },
    profile,
  }));

  const outcome = await planner.plan({
    requestId: 'context-request-unpinned-ambiguity',
    campaignId: campaign.campaign.id,
    campaignRevision: 7,
    bindingId: binding.id,
    bindingRevision: 3,
    contextFocusRevision: 2,
    modelProfileId: profile.id,
    generationType: 'normal',
    messages: [{ role: 'user', content: 'I ask the warden to open the gate.' }],
  }, new AbortController().signal);

  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.deepEqual(outcome.value.selections.map(selection => selection.recordId).filter(Boolean), []);
  assert.deepEqual(outcome.value.ambiguities, [{
    phrase: 'the warden',
    candidates: [
      { recordId: 'actor-warden-east', label: 'Edric' },
      { recordId: 'actor-warden-west', label: 'Mara' },
    ],
  }]);
});

test('stale and private pins both offer a direct unpin recovery action', async () => {
  const privateCampaign: CampaignDocument = {
    ...campaign,
    items: campaign.items.map(item => item.id === 'item-key'
      ? { ...item, visibility: 'campaign_private' as const }
      : item),
  };
  const cases = [
    { campaign, pins: ['missing-record'], code: 'CONTEXT_STALE_PIN' },
    { campaign: privateCampaign, pins: ['item-key'], code: 'CONTEXT_PRIVATE_PIN' },
  ] as const;

  for (const candidate of cases) {
    const planner = new ContextPlanner(source([], {
      campaign: candidate.campaign,
      binding: { ...binding, pins: [...candidate.pins] },
      profile,
    }));
    const outcome = await planner.plan({
      requestId: `context-request-${candidate.code.toLowerCase()}`,
      campaignId: campaign.campaign.id,
      campaignRevision: 7,
      bindingId: binding.id,
      bindingRevision: 3,
      contextFocusRevision: 2,
      modelProfileId: profile.id,
      generationType: 'normal',
      messages: [{ role: 'user', content: 'I wait.' }],
    }, new AbortController().signal);

    assert.equal(outcome.ok, false);
    if (outcome.ok) continue;
    assert.equal(outcome.problem.code, candidate.code);
    assert.deepEqual(outcome.problem.actions.map(action => action.id), ['open-context-tray', 'unpin-record']);
  }
});
