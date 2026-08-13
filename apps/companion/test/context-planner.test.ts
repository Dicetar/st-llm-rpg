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

test('archived Campaign blocks Context planning before retrieval or narration', async () => {
  let searched = false;
  const archivedCampaign: CampaignDocument = {
    ...campaign,
    campaign: { ...campaign.campaign, status: 'archived' },
  };
  const planner = new ContextPlanner({
    async readAuthority() {
      return { campaign: archivedCampaign, binding, profile };
    },
    async search() {
      searched = true;
      return [];
    },
  });
  const outcome = await planner.plan({
    requestId: 'context-archived',
    campaignId: campaign.campaign.id,
    campaignRevision: 7,
    bindingId: binding.id,
    bindingRevision: 3,
    contextFocusRevision: 2,
    modelProfileId: profile.id,
    generationType: 'normal',
    messages: [{ role: 'user', content: 'Continue.' }],
  }, new AbortController().signal);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(outcome.problem.code, 'CAMPAIGN_ARCHIVED');
  assert.equal(searched, false);
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

test('Actor trackers enter context only with their selected Actor', async () => {
  const trackerCampaign: CampaignDocument = {
    ...campaign,
    actors: [
      {
        ...campaign.actors[0]!,
        trackers: [
          { id: 'tracker-health', label: 'Health', current: 7, maximum: 10, notes: 'Wounded' },
        ],
      },
      {
        id: 'actor-mara',
        name: 'Mara',
        aliases: [],
        summary: 'A distant merchant.',
        visibility: 'known',
        archived: false,
        trackers: [{ id: 'tracker-gold', label: 'Gold', current: 999 }],
      },
    ],
    currentScene: {
      id: 'scene-bedroom',
      name: 'Childhood Bedroom',
      summary: 'A guarded conversation is underway.',
      actorIds: ['actor-lavir'],
      itemIds: [],
    },
  };
  const planner = new ContextPlanner(source([], {
    campaign: trackerCampaign,
    binding: { ...binding, pins: [] },
    profile,
  }));

  const outcome = await planner.plan({
    requestId: 'context-request-selected-trackers',
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
  assert.match(outcome.value.blocks.known, /Live trackers: Health: 7\/10 \(Wounded\)/);
  assert.doesNotMatch(JSON.stringify(outcome.value), /Gold|999/);
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

test('exact Ability mention retrieves definition, live uses, and linked Actor without dumping every description', async () => {
  const abilityCampaign: CampaignDocument = {
    ...campaign,
    abilities: [{
      id: 'ability-hand', name: 'Mage Hand', aliases: ['spectral hand'],
      summary: 'Manipulates a small unattended object at short range.',
      category: 'spell', visibility: 'known', archived: false,
    }, {
      id: 'ability-flame', name: 'Flame Ward', aliases: [],
      summary: 'A different spell that should not be selected.',
      category: 'spell', visibility: 'known', archived: false,
    }],
    learnedAbilities: [{
      id: 'learned-hand', abilityId: 'ability-hand', actorId: 'actor-lavir',
      prepared: true, enabled: true, usesRemaining: 2, usesMaximum: 3, archived: false,
    }],
  };
  const planner = new ContextPlanner(source([], {
    campaign: abilityCampaign,
    binding: { ...binding, pins: [] },
    profile,
  }));
  const outcome = await planner.plan({
    requestId: 'context-ability-exact',
    campaignId: campaign.campaign.id,
    campaignRevision: 7,
    bindingId: binding.id,
    bindingRevision: 3,
    contextFocusRevision: 2,
    modelProfileId: profile.id,
    generationType: 'normal',
    messages: [{ role: 'user', content: 'Lavir casts Mage Hand toward the cabinet.' }],
  }, new AbortController().signal);

  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.value.selections.some(selection => selection.recordId === 'ability-hand' && selection.tier === 'exact-mention'), true);
  assert.match(outcome.value.blocks.known, /ABILITY: Mage Hand/);
  assert.match(outcome.value.blocks.known, /Known by: Lavir, prepared, 2\/3 uses/);
  assert.doesNotMatch(outcome.value.blocks.known, /different spell that should not be selected/);
});

test('exact World Object mention retrieves its Place and attached Fact without dumping the whole world', async () => {
  const worldCampaign: CampaignDocument = {
    ...campaign,
    items: campaign.items.filter(record => record.id !== 'item-wardrobe'),
    places: [{ id: 'place-bedroom', name: 'Childhood Bedroom', summary: 'The heir left it untouched.', archived: false }],
    worldObjects: [{
      id: 'object-wardrobe', name: 'Heirloom Wardrobe', aliases: ['red wardrobe'],
      summary: 'Ancient red mahogany with silver draconic filigree.', placeId: 'place-bedroom',
      visibility: 'known', archived: false,
    }, {
      id: 'object-mirror', name: 'Court Mirror', aliases: [], summary: 'Unrelated furnishing.',
      visibility: 'known', archived: false,
    }],
    facts: [{
      id: 'fact-key-missing', name: 'Wardrobe key is missing', aliases: [],
      summary: 'The silver key was removed before the heir returned.', subjectId: 'object-wardrobe',
      visibility: 'narrator_secret', archived: false,
    }],
    currentScene: {
      id: 'scene-bedroom', name: 'Childhood Bedroom', summary: '', placeId: 'place-bedroom',
      worldObjectIds: ['object-wardrobe'],
    },
  };
  const planner = new ContextPlanner(source([], {
    campaign: worldCampaign,
    binding: { ...binding, pins: [] },
    profile,
  }));
  const outcome = await planner.plan({
    requestId: 'context-world-object', campaignId: campaign.campaign.id, campaignRevision: 7,
    bindingId: binding.id, bindingRevision: 3, contextFocusRevision: 2,
    modelProfileId: profile.id, generationType: 'normal',
    messages: [{ role: 'user', content: 'I inspect the Heirloom Wardrobe carefully.' }],
  }, new AbortController().signal);

  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.value.selections.some(selection => selection.recordId === 'object-wardrobe' && selection.tier === 'exact-mention'), true);
  assert.equal(outcome.value.selections.some(selection => selection.recordId === 'fact-key-missing' && selection.tier === 'relation-hop'), true);
  assert.match(outcome.value.blocks.known, /WORLD OBJECT: Heirloom Wardrobe/);
  assert.match(outcome.value.blocks.secret ?? '', /FACT: Wardrobe key is missing/);
  assert.doesNotMatch(JSON.stringify(outcome.value), /Unrelated furnishing/);
});

test('an Actor mention expands one explicit Relationship and its counterpart without exposing private links', async () => {
  const relationshipCampaign: CampaignDocument = {
    ...campaign,
    actors: [...campaign.actors, {
      id: 'actor-mara', name: 'Mara', aliases: [], summary: 'A careful investigator.', visibility: 'known', archived: false,
    }],
    relationships: [{
      id: 'relationship-patron', sourceActorId: 'actor-lavir', targetActorId: 'actor-mara',
      kind: 'patron', status: 'strained', notes: 'Lavir doubts Mara after the missing key.', visibility: 'known', archived: false,
    }, {
      id: 'relationship-private', sourceActorId: 'actor-mara', targetActorId: 'actor-lavir',
      kind: 'private-note', status: 'other', notes: 'This must never reach narration.', visibility: 'campaign_private', archived: false,
    }],
  };
  const planner = new ContextPlanner(source([], {
    campaign: relationshipCampaign,
    binding: { ...binding, pins: [] },
    profile,
  }));
  const outcome = await planner.plan({
    requestId: 'context-relationship-hop', campaignId: campaign.campaign.id, campaignRevision: 7,
    bindingId: binding.id, bindingRevision: 3, contextFocusRevision: 2,
    modelProfileId: profile.id, generationType: 'normal',
    messages: [{ role: 'user', content: 'I ask Lavir why he no longer trusts Mara.' }],
  }, new AbortController().signal);

  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.value.selections.some(selection => selection.recordId === 'relationship-patron' && selection.tier === 'relation-hop'), true);
  assert.match(outcome.value.blocks.known, /Lavir —patron→ Mara \(strained\)/);
  assert.match(outcome.value.blocks.known, /Lavir doubts Mara after the missing key/);
  assert.doesNotMatch(JSON.stringify(outcome.value), /private-note|must never reach narration/);
});
