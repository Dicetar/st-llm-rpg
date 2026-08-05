import { CampaignConflictError } from './campaign-session.js';

export const CAMPAIGN_METADATA_KEY = 'stLlmRpgCampaign';
const JOURNAL_PREFIX = 'st-llm-rpg:campaign:pending:';

export class CampaignPersistenceError extends Error {
  constructor(message, { code = 'campaign_persistence', recoverable = false, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'CampaignPersistenceError';
    this.code = code;
    this.recoverable = recoverable;
  }
}

function clone(value) {
  if (value === undefined) return undefined;
  if (globalThis.structuredClone) return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function sameCommit(left, right) {
  return Boolean(left?.campaign?.commitId && left.campaign.commitId === right?.campaign?.commitId);
}

function commitId(envelope) {
  return envelope?.campaign?.commitId ?? null;
}

function journalKey(chatId) {
  return `${JOURNAL_PREFIX}${chatId}`;
}

async function defaultReadServerEnvelope(getContext, binding) {
  const current = getContext();
  if (!current || current.groupId) {
    throw new CampaignPersistenceError('Verified Campaign storage currently supports character chats only.', {
      code: 'campaign_chat_unsupported',
    });
  }
  const character = current.characters?.[current.characterId];
  if (!character || !binding.chatId) {
    throw new CampaignPersistenceError('No saved character chat is selected.', { code: 'campaign_chat_unbound' });
  }
  const response = await fetch('/api/chats/get', {
    method: 'POST',
    cache: 'no-cache',
    headers: current.getRequestHeaders(),
    body: JSON.stringify({
      ch_name: character.name,
      file_name: binding.chatId,
      avatar_url: character.avatar,
    }),
  });
  if (!response.ok) {
    throw new CampaignPersistenceError(`Campaign readback failed with HTTP ${response.status}.`, {
      code: 'campaign_readback_failed',
      recoverable: true,
    });
  }
  const data = await response.json();
  return clone(data?.[0]?.chat_metadata?.[CAMPAIGN_METADATA_KEY] ?? null);
}

export function createSillyTavernCampaignStorage({
  getContext = () => globalThis.SillyTavern?.getContext?.() ?? null,
  readServerEnvelope = binding => defaultReadServerEnvelope(getContext, binding),
  journalStorage = globalThis.localStorage,
} = {}) {
  function contextMetadata() {
    const metadata = getContext()?.chatMetadata;
    if (!metadata || typeof metadata !== 'object') {
      throw new CampaignPersistenceError('SillyTavern chat metadata is unavailable.', { code: 'campaign_metadata_unavailable' });
    }
    return metadata;
  }

  function getRecovery(binding) {
    if (!binding?.chatId || !journalStorage) return null;
    try {
      const value = JSON.parse(journalStorage.getItem(journalKey(binding.chatId)));
      return value && typeof value === 'object' ? value : null;
    } catch {
      return null;
    }
  }

  function writeRecovery(binding, candidate, expectedCommitId) {
    if (!journalStorage) {
      throw new CampaignPersistenceError('Browser recovery storage is unavailable.', {
        code: 'campaign_journal_unavailable',
      });
    }
    const recovery = {
      chatId: binding.chatId,
      baseCommitId: expectedCommitId,
      candidate: clone(candidate),
      createdAt: new Date().toISOString(),
    };
    try {
      journalStorage.setItem(journalKey(binding.chatId), JSON.stringify(recovery));
    } catch (error) {
      throw new CampaignPersistenceError('The recoverable Campaign draft could not be stored in this browser.', {
        code: 'campaign_journal_failed',
        cause: error,
      });
    }
  }

  function clearRecovery(binding) {
    try {
      journalStorage?.removeItem(journalKey(binding.chatId));
    } catch {
      // A verified Campaign remains authoritative even if stale recovery cleanup fails.
    }
  }

  function replaceMetadata(envelope) {
    const metadata = contextMetadata();
    if (envelope) metadata[CAMPAIGN_METADATA_KEY] = clone(envelope);
    else delete metadata[CAMPAIGN_METADATA_KEY];
  }

  async function load(binding) {
    const inMemory = clone(contextMetadata()[CAMPAIGN_METADATA_KEY] ?? null);
    return inMemory;
  }

  async function commit(binding, candidate, expectedCommitId) {
    const currentContext = getContext();
    if (!currentContext?.saveMetadata) {
      throw new CampaignPersistenceError('SillyTavern cannot save Campaign metadata right now.', {
        code: 'campaign_save_unavailable',
        recoverable: true,
      });
    }

    const serverBefore = await readServerEnvelope(binding);
    if (commitId(serverBefore) !== expectedCommitId) {
      replaceMetadata(serverBefore);
      throw new CampaignConflictError('The saved Campaign changed before this edit could be written.', {
        expectedCommitId,
        actualCommitId: commitId(serverBefore),
      });
    }

    writeRecovery(binding, candidate, expectedCommitId);
    replaceMetadata(candidate);

    try {
      await currentContext.saveMetadata();
    } catch {
      // SillyTavern may swallow this error or throw it. Server readback is authoritative.
    }

    let serverAfter;
    try {
      serverAfter = await readServerEnvelope(binding);
    } catch (error) {
      replaceMetadata(serverBefore);
      throw new CampaignPersistenceError('Campaign save outcome is unknown. The previous verified Campaign remains active and this edit is recoverable.', {
        code: 'campaign_save_unknown',
        recoverable: true,
        cause: error,
      });
    }

    if (sameCommit(serverAfter, candidate)) {
      replaceMetadata(serverAfter);
      clearRecovery(binding);
      return clone(serverAfter);
    }

    replaceMetadata(serverAfter ?? serverBefore);
    if (commitId(serverAfter) === expectedCommitId) {
      throw new CampaignPersistenceError('SillyTavern kept the previous Campaign revision. Your edit is still recoverable.', {
        code: 'campaign_not_saved',
        recoverable: true,
      });
    }

    throw new CampaignConflictError('SillyTavern contains another Campaign revision. Automatic overwrite is blocked and your edit is recoverable.', {
      expectedCommitId,
      actualCommitId: commitId(serverAfter),
    });
  }

  return Object.freeze({ load, commit, getRecovery });
}
