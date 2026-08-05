const clone = (value) => structuredClone(value);

const initialState = {
  campaign: {
    id: 'campaign-emberfall',
    title: 'Emberfall: The Glass March',
    revision: 118,
    status: 'active',
    currentSceneId: 'scene-crimson-vault',
  },
  binding: {
    id: 'binding-lavitz-main',
    revision: 42,
    anchorRevision: 118,
    label: 'Lavitz — main chronicle',
    status: 'active',
    pins: ['actor-seraphine', 'item-mourning-cloak'],
  },
  scene: {
    id: 'scene-crimson-vault',
    title: 'The Crimson Vault',
    place: 'The Ashen Basilica',
    summary: 'Lavitz and Seraphine have reached the reliquary beneath the basilica while the choir above begins the third bell.',
    obstacles: ['A blood-sealed reliquary door', 'Three bells before the ward awakens'],
    exits: ['Collapsed processional stair', 'Reliquary threshold'],
    openThreads: ['Who moved the reliquary key?', 'Why does the vault recognize Lavitz?'],
  },
  collections: {
    actors: [
      { id: 'actor-lavitz', kind: 'Actor', name: 'Lavitz', subtitle: 'Player Character', status: 'Wounded, resolute', summary: 'A sworn blade carrying the mark of a forgotten royal line.' },
      { id: 'actor-seraphine', kind: 'Actor', name: 'Seraphine Vale', subtitle: 'NPC · Companion', status: 'Present in scene', summary: 'An archivist-mage whose composure thins whenever the basilica speaks her childhood name.' },
      { id: 'actor-prior', kind: 'Actor', name: 'Prior Caldus', subtitle: 'NPC · Antagonist', status: 'Location unknown', summary: 'The basilica prior who sealed the lower reliquary after the Red Vigil.' },
    ],
    inventory: [
      { id: 'item-mourning-cloak', kind: 'Item', name: 'Mourning Cloak', subtitle: 'Worn · shoulders', status: 'Good condition', summary: 'Black velvet threaded with silver names that appear only in candle smoke.' },
      { id: 'item-reliquary-key', kind: 'Item', name: 'Reliquary Key', subtitle: 'Quest item', status: 'Missing', summary: 'A red-glass key cut for the blood-sealed door beneath the basilica.' },
      { id: 'item-emberroot', kind: 'Item', name: 'Emberroot Phial', subtitle: 'Consumable · 2 remaining', status: 'Carried', summary: 'A bitter restorative that leaves warmth beneath the skin for several minutes.' },
    ],
    abilities: [
      { id: 'ability-wardbreak', kind: 'Ability', name: 'Wardbreak', subtitle: 'Spell · prepared', status: '1 use remaining', summary: 'Unthreads a visible magical seal by naming the intent that formed it.' },
      { id: 'ability-steel-memory', kind: 'Ability', name: 'Steel Memory', subtitle: 'Feat', status: 'Available', summary: 'Recall a practiced martial sequence with perfect bodily precision.' },
    ],
    objectives: [
      { id: 'quest-red-vigil', kind: 'Quest', name: 'Echoes of the Red Vigil', subtitle: 'Active · 3/5 steps', status: 'Blocked by missing key', summary: 'Discover what the basilica concealed after the Red Vigil.' },
      { id: 'quest-seraphine-oath', kind: 'Quest', name: 'Seraphine’s Oath', subtitle: 'Active · private stakes', status: 'Progressed this scene', summary: 'Help Seraphine confront the vow binding her to the Vale archives.' },
    ],
    world: [
      { id: 'place-basilica', kind: 'Place', name: 'The Ashen Basilica', subtitle: 'Place · current', status: 'Hostile wards active', summary: 'A cathedral of soot-grey stone built over older red-glass foundations.' },
      { id: 'object-third-bell', kind: 'World Object', name: 'The Third Bell', subtitle: 'World Object', status: 'Two tolls complete', summary: 'A cracked bronze bell whose third toll wakes the reliquary ward.' },
      { id: 'fact-vault-lineage', kind: 'Fact', name: 'The Vault Recognizes Blood', subtitle: 'Fact · Narrator Secret', status: 'Verified', summary: 'The reliquary ward tests royal lineage rather than clerical authority.' },
    ],
  },
  proposals: [
    {
      id: 'proposal-1',
      kind: 'Update relationship',
      title: 'Seraphine trusts Lavitz with the Vale secret',
      source: 'Messages 418–423',
      confidence: 'high',
      detail: 'Increase trust and record that Seraphine disclosed the existence of the sealed family archive.',
    },
    {
      id: 'proposal-2',
      kind: 'Update quest step',
      title: 'Locate the reliquary key',
      source: 'Messages 424–427',
      confidence: 'medium',
      detail: 'Mark the current step blocked and add the clue that the key was removed after the second bell.',
    },
  ],
  context: {
    model: 'Qwen 27B · screened profile',
    usedTokens: 4820,
    budgetTokens: 8192,
    selections: [
      { tier: 'Required core', name: 'Current Scene and player state', tokens: 1420, reason: 'Always required' },
      { tier: 'Manual pin', name: 'Seraphine Vale', tokens: 960, reason: 'Pinned for this Chat Binding' },
      { tier: 'Manual pin', name: 'Mourning Cloak', tokens: 510, reason: 'Pinned for this Chat Binding' },
      { tier: 'Exact mention', name: 'Reliquary Key', tokens: 430, reason: 'Unique exact mention in recent chat' },
      { tier: 'Scene anchor', name: 'The Ashen Basilica', tokens: 580, reason: 'Current Scene place' },
    ],
    omissions: [
      { name: 'Prior Caldus', reason: 'Token budget after higher tiers' },
      { name: 'The Third Bell', reason: 'Duplicate facts already represented by Scene core' },
      { name: 'Vault Recognizes Blood', reason: 'Campaign Private material excluded before retrieval' },
    ],
  },
  importPreview: {
    source: 'campaign-content/wardrobes.json',
    creates: 2,
    updates: 3,
    unchanged: 11,
    warnings: 1,
    changes: [
      { action: 'Update', subject: 'Seraphine Vale', field: 'appearance', before: 'Travelling coat', after: 'Travelling coat; crimson court dress' },
      { action: 'Create', subject: 'Court Dress of House Vale', field: 'Item', before: '—', after: 'New reusable Item definition' },
      { action: 'Warning', subject: 'Mourning Cloak', field: 'externalId', before: 'mourning-cloak', after: 'Duplicate external ID in source' },
    ],
  },
  backups: [
    { id: 'backup-2026-08-05', createdAt: '2026-08-05 07:00', kind: 'Daily', size: '3.8 MB', status: 'Validated' },
    { id: 'backup-pre-import', createdAt: '2026-08-04 22:18', kind: 'Pre-import', size: '3.7 MB', status: 'Validated' },
  ],
  events: [],
};

function problem(code, message, actions = []) {
  return {
    ok: false,
    problem: {
      code,
      message,
      requestId: crypto.randomUUID(),
      retryable: false,
      actions,
    },
  };
}

function collectionLabel(key) {
  return {
    actors: 'People',
    inventory: 'Inventory',
    abilities: 'Abilities',
    objectives: 'Objectives',
    world: 'World',
  }[key] ?? key;
}

export function createMockCampaignEngine(seed = initialState) {
  const state = clone(seed);
  const listeners = new Set();

  function emit(scope, hints) {
    const notice = {
      cursor: state.events.length + 1,
      storeEpoch: 'prototype-epoch-1',
      scope,
      campaignRevision: state.campaign.revision,
      bindingRevision: state.binding.revision,
      hints,
    };
    state.events.push(notice);
    for (const listener of listeners) listener(notice);
  }

  return {
    snapshot() {
      return clone(state);
    },

    async read(request) {
      switch (request.kind) {
        case 'campaign-catalog':
          return { ok: true, value: { campaigns: [clone(state.campaign)] } };
        case 'campaign-view': {
          if (request.at !== 'head' && request.at !== state.campaign.revision) {
            return problem('revision_not_available', `Prototype only exposes revision ${state.campaign.revision}.`);
          }
          if (request.view === 'workspace-home') {
            return { ok: true, value: clone({ campaign: state.campaign, binding: state.binding, scene: state.scene, proposals: state.proposals, context: state.context }) };
          }
          if (request.view.startsWith('collection:')) {
            const key = request.view.split(':')[1];
            const rows = state.collections[key];
            if (!rows) return problem('unknown_collection', `Unknown collection: ${key}`);
            return { ok: true, value: { key, label: collectionLabel(key), rows: clone(rows), revision: state.campaign.revision } };
          }
          if (request.view.startsWith('record:')) {
            const id = request.view.split(':')[1];
            const record = Object.values(state.collections).flat().find((candidate) => candidate.id === id);
            if (!record) return problem('record_not_found', `No record ${id}.`);
            return { ok: true, value: { record: clone(record), revision: state.campaign.revision } };
          }
          if (request.view === 'review-inbox') return { ok: true, value: { proposals: clone(state.proposals), revision: state.campaign.revision } };
          if (request.view === 'context-diagnostics') return { ok: true, value: clone({ ...state.context, bindingRevision: state.binding.revision }) };
          if (request.view === 'import-preview') return { ok: true, value: clone({ ...state.importPreview, revision: state.campaign.revision }) };
          if (request.view === 'maintenance') return { ok: true, value: clone({ backups: state.backups, campaign: state.campaign, binding: state.binding }) };
          return problem('unknown_view', `Unknown view: ${request.view}`);
        }
        case 'chat-binding':
          return { ok: true, value: clone(state.binding) };
        default:
          return problem('unknown_read', `Unsupported read: ${request.kind}`);
      }
    },

    async execute(request) {
      if (request.scope === 'campaign') {
        if (request.expectedRevision !== state.campaign.revision) {
          return problem('campaign_revision_conflict', `Expected revision ${request.expectedRevision}; current head is ${state.campaign.revision}.`, [
            { kind: 'reload-document', label: 'Review current Campaign' },
            { kind: 'keep-draft', label: 'Keep local draft' },
          ]);
        }

        const operation = request.operation;
        if (operation.kind === 'edit-record') {
          const record = Object.values(state.collections).flat().find((candidate) => candidate.id === operation.recordId);
          if (!record) return problem('record_not_found', `No record ${operation.recordId}.`);
          Object.assign(record, operation.patch);
        } else if (operation.kind === 'accept-proposal') {
          const proposalIndex = state.proposals.findIndex((proposal) => proposal.id === operation.proposalId);
          if (proposalIndex < 0) return problem('proposal_not_found', `No proposal ${operation.proposalId}.`);
          state.proposals.splice(proposalIndex, 1);
        } else if (operation.kind === 'reject-proposal') {
          const proposalIndex = state.proposals.findIndex((proposal) => proposal.id === operation.proposalId);
          if (proposalIndex < 0) return problem('proposal_not_found', `No proposal ${operation.proposalId}.`);
          state.proposals.splice(proposalIndex, 1);
        } else if (operation.kind === 'apply-import') {
          state.importPreview.unchanged += state.importPreview.creates + state.importPreview.updates;
          state.importPreview.creates = 0;
          state.importPreview.updates = 0;
          state.importPreview.warnings = 0;
          state.importPreview.changes = [];
        } else {
          return problem('unknown_operation', `Unsupported Campaign Operation: ${operation.kind}`);
        }

        state.campaign.revision += 1;
        emit('campaign', [operation.kind]);
        return {
          ok: true,
          value: {
            requestId: request.requestId,
            campaignRevision: state.campaign.revision,
            refreshHints: [operation.kind],
          },
        };
      }

      if (request.scope === 'binding') {
        if (request.expectedPinsRevision !== state.binding.revision) {
          return problem('binding_revision_conflict', `Expected Binding revision ${request.expectedPinsRevision}; current revision is ${state.binding.revision}.`);
        }
        const operation = request.operation;
        if (operation.kind === 'replace-pins') {
          state.binding.pins = [...operation.pins];
          const seraphineIndex = state.context.selections.findIndex((selection) => selection.tier === 'Manual pin' && selection.name === 'Seraphine Vale');
          const shouldIncludeSeraphine = state.binding.pins.includes('actor-seraphine');
          if (shouldIncludeSeraphine && seraphineIndex < 0) {
            state.context.selections.splice(1, 0, { tier: 'Manual pin', name: 'Seraphine Vale', tokens: 960, reason: 'Pinned for this Chat Binding' });
            state.context.usedTokens += 960;
          } else if (!shouldIncludeSeraphine && seraphineIndex >= 0) {
            state.context.selections.splice(seraphineIndex, 1);
            state.context.usedTokens -= 960;
          }
        } else {
          return problem('unknown_binding_operation', `Unsupported Binding Operation: ${operation.kind}`);
        }
        state.binding.revision += 1;
        emit('binding', [operation.kind]);
        return { ok: true, value: { bindingRevision: state.binding.revision, pins: clone(state.binding.pins) } };
      }

      if (request.scope === 'maintenance' && request.command.kind === 'create-backup') {
        const backup = {
          id: `backup-${Date.now()}`,
          createdAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
          kind: 'Manual',
          size: '3.8 MB',
          status: 'Validated',
        };
        state.backups.unshift(backup);
        emit('maintenance', ['backup-created']);
        return { ok: true, value: clone(backup) };
      }

      return problem('unknown_execution', 'Unsupported prototype execution request.');
    },

    async *changes(_request, signal) {
      const queue = [];
      let resume;
      const listener = (notice) => {
        queue.push(notice);
        resume?.();
        resume = undefined;
      };
      listeners.add(listener);
      try {
        while (!signal.aborted) {
          if (queue.length === 0) {
            await new Promise((resolve) => {
              resume = resolve;
              signal.addEventListener('abort', resolve, { once: true });
            });
          }
          while (queue.length) yield clone(queue.shift());
        }
      } finally {
        listeners.delete(listener);
      }
    },
  };
}

export function createMockWorkspace(engine) {
  return {
    async load(request) {
      if (request.kind === 'home') {
        return engine.read({ kind: 'campaign-view', campaignId: request.campaignId, at: 'head', view: 'workspace-home' });
      }
      if (request.kind === 'collection') {
        return engine.read({ kind: 'campaign-view', campaignId: request.campaignId, at: 'head', view: `collection:${request.collection}` });
      }
      if (request.kind === 'record') {
        return engine.read({ kind: 'campaign-view', campaignId: request.campaignId, at: 'head', view: `record:${request.recordId}` });
      }
      const viewByKind = {
        review: 'review-inbox',
        context: 'context-diagnostics',
        import: 'import-preview',
        maintenance: 'maintenance',
      };
      const view = viewByKind[request.kind];
      if (!view) return problem('unknown_workspace_document', `Unknown Workspace document: ${request.kind}`);
      return engine.read({ kind: 'campaign-view', campaignId: request.campaignId, at: 'head', view });
    },

    async act(intent) {
      if (intent.kind === 'save-record') {
        return engine.execute({
          scope: 'campaign',
          requestId: intent.requestId,
          campaignId: intent.campaignId,
          expectedRevision: intent.expectedRevision,
          operation: { kind: 'edit-record', recordId: intent.recordId, patch: intent.patch },
        });
      }
      if (intent.kind === 'accept-proposal' || intent.kind === 'reject-proposal') {
        return engine.execute({
          scope: 'campaign',
          requestId: intent.requestId,
          campaignId: intent.campaignId,
          expectedRevision: intent.expectedRevision,
          operation: { kind: intent.kind, proposalId: intent.proposalId },
        });
      }
      if (intent.kind === 'replace-pins') {
        return engine.execute({
          scope: 'binding',
          requestId: intent.requestId,
          bindingId: intent.bindingId,
          expectedPinsRevision: intent.expectedBindingRevision,
          operation: { kind: 'replace-pins', pins: intent.pins },
        });
      }
      if (intent.kind === 'apply-import') {
        return engine.execute({
          scope: 'campaign',
          requestId: intent.requestId,
          campaignId: intent.campaignId,
          expectedRevision: intent.expectedRevision,
          operation: { kind: 'apply-import' },
        });
      }
      if (intent.kind === 'create-backup') {
        return engine.execute({ scope: 'maintenance', requestId: intent.requestId, command: { kind: 'create-backup' } });
      }
      return problem('unknown_workspace_intent', `Unknown Workspace intent: ${intent.kind}`);
    },
  };
}

export const prototypeSeed = clone(initialState);
