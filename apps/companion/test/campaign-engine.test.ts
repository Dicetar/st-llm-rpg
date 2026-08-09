import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  CampaignDocument,
  CampaignSummary,
  CampaignVerificationResult,
} from '@st-llm-rpg/wire';
import { CampaignEngine } from '../src/modules/campaign/campaign-engine.js';
import type {
  CampaignJournal,
  CampaignJournalAppend,
  CampaignJournalReceipt,
  CampaignJournalRead,
  CampaignJournalReadResult,
  CampaignJournalTransaction,
  CampaignJournalTransactionCompletion,
} from '../src/modules/campaign/campaign-journal.js';

const summary: CampaignSummary = {
  id: 'campaign-1',
  title: 'Injected Campaign',
  status: 'active',
  revision: 1,
  createdAt: '2026-08-09T00:00:00.000Z',
  updatedAt: '2026-08-09T00:00:00.000Z',
};

class MemoryCampaignJournal implements CampaignJournal {
  readonly reads: CampaignJournalRead[] = [];
  readonly appends: CampaignJournalAppend[] = [];
  readonly receipts = new Map<string, CampaignJournalReceipt>();
  readonly documents = new Map<string, CampaignDocument>();

  async close(): Promise<void> {}

  observation() {
    return { ready: true, message: 'memory ready', latencyMs: 0 };
  }

  async readAt<R extends CampaignJournalRead>(request: R): Promise<CampaignJournalReadResult<R>> {
    this.reads.push(request);
    if (request.kind === 'campaign-list') return [summary] as CampaignJournalReadResult<R>;
    if (request.kind === 'campaign') {
      const document = this.documents.get(`${request.campaignId}:${request.revision ?? 'current'}`);
      if (document) return document as CampaignJournalReadResult<R>;
    }
    throw new Error(`Unexpected read ${request.kind}`);
  }

  async transact<T>(
    work: (transaction: CampaignJournalTransaction) => CampaignJournalTransactionCompletion<T>,
  ): Promise<T> {
    const completion = work({
      findReceipt: requestId => this.receipts.get(requestId),
      findHead: () => undefined,
      append: input => {
        this.appends.push(input);
        this.receipts.set(input.requestId, { requestHash: input.requestHash, commit: input.commit });
        const document = {
          campaign: input.afterState.campaign,
          actors: Object.values(input.afterState.actors),
          items: Object.values(input.afterState.items),
          quests: Object.values(input.afterState.quests),
          places: Object.values(input.afterState.places),
          currentScene: input.afterState.currentScene,
        };
        this.documents.set(`${input.commit.campaignId}:${input.commit.revision}`, document);
        this.documents.set(`${input.commit.campaignId}:current`, document);
      },
    });
    if (completion.kind === 'complete') return completion.value;
    const value = await this.readAt(completion.request);
    return completion.project(value);
  }

  async verify(): Promise<CampaignVerificationResult> {
    return { verified: true, verifiedAt: '2026-08-09T00:00:00.000Z', durationMs: 0, campaignCount: 1 };
  }

  async backup(request: { destinationPath: string }) {
    return request;
  }

  async restore(): Promise<void> {}
}

test('Campaign Engine depends on injected Campaign Journal interface', async () => {
  const journal = new MemoryCampaignJournal();
  const engine = new CampaignEngine(journal);

  const outcome = await engine.list('engine-read');

  assert.deepEqual(outcome, { ok: true, value: [summary] });
  assert.deepEqual(journal.reads, [{ kind: 'campaign-list' }]);
});

test('Campaign Engine owns accepted Operation policy while Journal only persists the append', async () => {
  const journal = new MemoryCampaignJournal();
  const engine = new CampaignEngine(journal);

  const first = await engine.create({ requestId: 'engine-create', title: 'Engine Campaign' });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.value.revision, 1);
  assert.equal(journal.appends.length, 1);
  assert.equal(journal.appends[0]?.kind, 'create');
  assert.equal(journal.appends[0]?.afterState.campaign.title, 'Engine Campaign');

  const duplicate = await engine.create({ requestId: 'engine-create', title: 'Engine Campaign' });
  assert.equal(duplicate.ok, true);
  if (!duplicate.ok) return;
  assert.equal(duplicate.value.idempotent, true);
  assert.equal(journal.appends.length, 1);
  assert.deepEqual(journal.reads.at(-1), {
    kind: 'campaign',
    campaignId: first.value.campaignId,
    revision: 1,
  });
});
