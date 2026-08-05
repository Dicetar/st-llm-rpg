import { FakeModelHost, InferenceLane, createJobStore } from './prototype.mjs';

const ids = (() => { let value = 0; return () => `trace-${++value}`; })();
const jobs = createJobStore({ id: ids });
const created = jobs.dispatch({
  jobId: 'story-sync-trace', campaignId: 'campaign-emberfall', bindingId: 'binding-emberfall',
  campaignAnchor: 42, campaignHead: 42, bindingRevision: 8, syncFacetRevision: 3,
  source: {
    bindingId: 'binding-emberfall', locator: 'chat:lavitz/session-1',
    boundary: { throughMessageIndex: 20, prefixHash: 'prefix-20' },
    messages: [
      { index: 21, role: 'player', name: 'Player', content: 'I hand Mara the moon key.' },
      { index: 22, role: 'narrator', name: 'Narrator', content: 'Mara accepts it and hides it beneath her coat.' },
    ],
  },
});
console.log('1. queued', { status: created.status, fingerprint: created.sourceFingerprint.slice(0, 12) });
const attempt = jobs.start(created.jobId);
let review = jobs.finish(created.jobId, attempt.attemptId, JSON.stringify({ proposals: [{
  title: 'Transfer moon key to Mara', confidence: 'high',
  operation: { kind: 'transfer-possession', possessionId: 'moon-key', toActorId: 'mara' },
}] })).job;
review = jobs.decide(created.jobId, review.proposals[0].proposalId, 1, 'accept', review.proposals[0].edited);
const plan = jobs.plan(created.jobId, {
  bindingId: created.bindingId, locator: created.source.locator,
  endPrefixHash: created.sourceEndPrefixHash, syncFacetRevision: created.syncFacetRevision,
  campaignAnchor: 42, campaignHead: 42,
});
console.log('2. authority plan', { requestId: plan.requestId, operations: plan.campaignOperation.operations.length, syncThrough: 22 });
const completed = jobs.acknowledge(created.jobId, {
  requestId: plan.requestId, decisionHash: plan.decisionHash,
  campaignCommit: { eventId: 'campaign-event-43', revision: 43 },
  bindingCommit: { bindingId: created.bindingId, revision: 9 },
});
console.log('3. reconciled', { status: completed.status, sourceContentPruned: completed.source.contentPruned });

const host = new FakeModelHost(5);
const events = [];
const lane = new InferenceLane({ modelHost: host, onEvent: (event) => events.push(event) });
let runs = 0;
const worker = lane.submit({ id: 'worker', kind: 'worker', modelKey: 'worker-model', run: (signal) => new Promise((resolve, reject) => {
  runs += 1; const timer = setTimeout(() => resolve('worker complete'), runs === 1 ? 100 : 10);
  signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
}) });
await new Promise((resolve) => setTimeout(resolve, 25));
const narrator = lane.submit({ id: 'narrator', kind: 'narration', modelKey: 'narrator-model', run: async () => 'narration complete' });
await Promise.all([narrator, worker]);
console.log('4. lane', {
  workerRuns: runs,
  completionOrder: events.filter((event) => event.type === 'completed').map((event) => event.id),
  modelTransitions: host.events,
  maxModelsLoaded: host.maxLoaded,
});
jobs.close();
