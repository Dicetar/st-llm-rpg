import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export class JobProblem extends Error {
  constructor(code, message, actions = []) { super(message); this.code = code; this.actions = actions; }
}
export class Preempted extends Error { constructor() { super('preempted by narration'); this.name = 'Preempted'; } }
const json = (value) => JSON.stringify(value);
const parse = (value) => JSON.parse(value);
export const hash = (value) => createHash('sha256').update(typeof value === 'string' ? value : stable(value)).digest('hex');
function stable(value) {
  if (value === null || typeof value !== 'object') return json(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${json(key)}:${stable(value[key])}`).join(',')}}`;
}
export function sourceEnvelope({ bindingId, locator, boundary, messages }) {
  if (!messages?.length) throw new JobProblem('source_empty', 'No messages to analyze.', ['capture-again']);
  const normalized = messages.map((m) => ({
    index: Number(m.index), role: String(m.role).toLowerCase(), name: String(m.name ?? ''),
    content: String(m.content ?? '').replace(/\0/g, '').trim(),
  })).map((m) => ({ ...m, contentHash: hash(m.content) }));
  if (!Number.isInteger(boundary?.throughMessageIndex) || normalized[0].index !== boundary.throughMessageIndex + 1)
    throw new JobProblem('source_not_contiguous', 'Source does not begin after the Sync Boundary.', ['capture-again']);
  for (let i = 1; i < normalized.length; i++) if (normalized[i].index !== normalized[i - 1].index + 1)
    throw new JobProblem('source_not_contiguous', 'Source contains a message gap.', ['capture-again']);
  const compact = normalized.map(({ index, role, name, contentHash }) => ({ index, role, name, contentHash }));
  const endPrefixHash = hash({ previous: boundary.prefixHash, compact });
  return {
    bindingId, locator, boundary, messages: normalized,
    firstMessageIndex: normalized[0].index, lastMessageIndex: normalized.at(-1).index,
    rangeHash: hash(compact), endPrefixHash,
    fingerprint: hash({ bindingId, locator, boundary, compact }),
  };
}
function proposalDoc(raw) {
  const text = String(raw ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const first = text.indexOf('{'), last = text.lastIndexOf('}');
  if (first < 0 || last <= first) throw new JobProblem('worker_output_malformed', 'Worker returned no JSON object.');
  let parsed; try { parsed = parse(text.slice(first, last + 1)); } catch { throw new JobProblem('worker_output_malformed', 'Worker JSON could not be parsed.'); }
  if (!Array.isArray(parsed.proposals)) throw new JobProblem('worker_output_malformed', 'Worker JSON has no proposals array.');
  return parsed.proposals.slice(0, 50).map((p, ordinal) => {
    if (!p?.operation?.kind) throw new JobProblem('worker_output_invalid', `Proposal ${ordinal + 1} has no typed operation.`);
    return { title: String(p.title ?? p.operation.kind), operation: p.operation,
      evidence: Array.isArray(p.evidence) ? p.evidence.slice(0, 8) : [],
      confidence: ['high', 'medium', 'low'].includes(p.confidence) ? p.confidence : 'low' };
  });
}
const rowJob = (r) => r && ({
  jobId: r.job_id, campaignId: r.campaign_id, bindingId: r.binding_id, status: r.status,
  source: parse(r.source_json), sourceFingerprint: r.source_fingerprint, sourceEndPrefixHash: r.source_end_prefix_hash,
  campaignAnchor: r.campaign_anchor, bindingRevision: r.binding_revision, syncFacetRevision: r.sync_facet_revision,
  attemptCount: r.attempt_count, cancelRequested: Boolean(r.cancel_requested),
  finalizationRequestId: r.finalization_request_id, decisionHash: r.decision_hash,
  authorityCommit: r.authority_commit_json ? parse(r.authority_commit_json) : null,
});
const rowProposal = (r) => ({ proposalId: r.proposal_id, revision: r.revision, decision: r.decision,
  draft: parse(r.draft_json), edited: parse(r.edited_json), authoritySubject: r.authority_subject_json ? parse(r.authority_subject_json) : null });

export function createJobStore({ dbPath = ':memory:', id = randomUUID } = {}) {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
  db.exec(`CREATE TABLE IF NOT EXISTS jobs(job_id TEXT PRIMARY KEY,campaign_id TEXT,binding_id TEXT,status TEXT,source_json TEXT,
    source_fingerprint TEXT,source_end_prefix_hash TEXT,campaign_anchor INTEGER,binding_revision INTEGER,sync_facet_revision INTEGER,
    attempt_count INTEGER DEFAULT 0,cancel_requested INTEGER DEFAULT 0,finalization_request_id TEXT,decision_hash TEXT,authority_commit_json TEXT);
    CREATE TABLE IF NOT EXISTS attempts(attempt_id TEXT PRIMARY KEY,job_id TEXT REFERENCES jobs(job_id),number INTEGER,status TEXT,termination TEXT,output_hash TEXT);
    CREATE TABLE IF NOT EXISTS proposals(proposal_id TEXT PRIMARY KEY,job_id TEXT REFERENCES jobs(job_id),ordinal INTEGER,revision INTEGER,decision TEXT,
    draft_json TEXT,edited_json TEXT,authority_subject_json TEXT,UNIQUE(job_id,ordinal));`);
  const s = {
    job: db.prepare('SELECT * FROM jobs WHERE job_id=?'), proposals: db.prepare('SELECT * FROM proposals WHERE job_id=? ORDER BY ordinal'),
    attempts: db.prepare('SELECT * FROM attempts WHERE job_id=? ORDER BY number'),
    insertJob: db.prepare(`INSERT INTO jobs VALUES(?,?,?,'queued',?,?,?,?,?, ?,0,0,NULL,NULL,NULL)`),
    runJob: db.prepare(`UPDATE jobs SET status='running',attempt_count=attempt_count+1,cancel_requested=0 WHERE job_id=?`),
    insertAttempt: db.prepare(`INSERT INTO attempts VALUES(?,?,?,'running',NULL,NULL)`),
    finishAttempt: db.prepare(`UPDATE attempts SET status=?,termination=?,output_hash=? WHERE attempt_id=?`),
    clearProposals: db.prepare('DELETE FROM proposals WHERE job_id=?'),
    insertProposal: db.prepare(`INSERT INTO proposals VALUES(?,?,?,1,'pending',?,?,NULL)`),
    setStatus: db.prepare('UPDATE jobs SET status=?,cancel_requested=0 WHERE job_id=?'),
    requestCancel: db.prepare('UPDATE jobs SET cancel_requested=1 WHERE job_id=?'),
    decide: db.prepare('UPDATE proposals SET revision=revision+1,decision=?,edited_json=? WHERE proposal_id=? AND job_id=? AND revision=?'),
    finalizing: db.prepare(`UPDATE jobs SET status='awaiting-authority',finalization_request_id=?,decision_hash=? WHERE job_id=?`),
    committed: db.prepare(`UPDATE jobs SET status='completed',authority_commit_json=?,source_json=? WHERE job_id=?`),
    authoritySubject: db.prepare('UPDATE proposals SET authority_subject_json=? WHERE proposal_id=?'),
    restartJobs: db.prepare(`UPDATE jobs SET status='interrupted',cancel_requested=0 WHERE status='running'`),
    restartAttempts: db.prepare(`UPDATE attempts SET status='interrupted',termination='host-restarted' WHERE status='running'`),
  };
  const tx = (fn) => { db.exec('BEGIN IMMEDIATE'); try { const v = fn(); db.exec('COMMIT'); return v; } catch (e) { db.exec('ROLLBACK'); throw e; } };
  const get = (jobId) => { const job = rowJob(s.job.get(jobId)); if (!job) throw new JobProblem('job_not_found', jobId); return { ...job, proposals: s.proposals.all(jobId).map(rowProposal) }; };
  function dispatch(c) {
    const source = sourceEnvelope(c.source);
    if (c.campaignAnchor !== c.campaignHead) throw new JobProblem('binding_mismatch', 'Campaign Anchor is stale.', ['follow', 'branch']);
    s.insertJob.run(c.jobId ?? id(), c.campaignId, c.bindingId, json(source), source.fingerprint, source.endPrefixHash,
      c.campaignAnchor, c.bindingRevision, c.syncFacetRevision);
    return get(c.jobId);
  }
  function start(jobId) {
    return tx(() => { const job = get(jobId); if (job.status !== 'queued') throw new JobProblem('job_not_queued', job.status);
      s.runJob.run(jobId); const attemptId = id(); s.insertAttempt.run(attemptId, jobId, job.attemptCount + 1); return { attemptId, job: get(jobId) }; });
  }
  function fail(jobId, attemptId, error) {
    tx(() => { s.finishAttempt.run('failed', error.code ?? 'failed', null, attemptId); s.setStatus.run('failed', jobId); });
  }
  function finish(jobId, attemptId, raw, repair) {
    let proposals, repaired = false, finalRaw = raw;
    try { proposals = proposalDoc(raw); } catch (first) {
      if (!repair) { fail(jobId, attemptId, first); throw first; }
      repaired = true; finalRaw = repair(raw);
      try { proposals = proposalDoc(finalRaw); } catch {
        const problem = new JobProblem('worker_output_unusable', 'One repair still produced unusable output.', ['retry', 'add-manually', 'discard']);
        fail(jobId, attemptId, problem); throw problem;
      }
    }
    tx(() => { s.clearProposals.run(jobId); proposals.forEach((p, i) => { const body = json(p); s.insertProposal.run(id(), jobId, i, body, body); });
      s.finishAttempt.run('completed', repaired ? 'repaired' : 'parsed', hash(finalRaw), attemptId); s.setStatus.run('ready-for-review', jobId); });
    return { repaired, job: get(jobId) };
  }
  function cancel(jobId, attemptId) {
    const job = get(jobId); if (job.status === 'running' && !attemptId) { s.requestCancel.run(jobId); return get(jobId); }
    if (attemptId) tx(() => { s.finishAttempt.run('cancelled', 'user-cancelled', null, attemptId); s.setStatus.run('cancelled', jobId); });
    else s.setStatus.run('cancelled', jobId); return get(jobId);
  }
  function interrupt(jobId, attemptId, autoResume = false) {
    tx(() => { s.finishAttempt.run('interrupted', autoResume ? 'narration-preempted' : 'interrupted', null, attemptId);
      s.setStatus.run(autoResume ? 'queued' : 'interrupted', jobId); }); return get(jobId);
  }
  function resume(jobId, e) {
    const job = get(jobId); if (!['interrupted', 'failed', 'cancelled'].includes(job.status)) throw new JobProblem('job_not_resumable', job.status);
    if (e.bindingId !== job.bindingId || e.locator !== job.source.locator || e.sourceFingerprint !== job.sourceFingerprint ||
      e.campaignAnchor !== job.campaignAnchor || e.syncFacetRevision !== job.syncFacetRevision)
      throw new JobProblem('job_source_stale', 'Source or binding changed.', ['discard', 'start-new']);
    s.setStatus.run('queued', jobId); return get(jobId);
  }
  function decide(jobId, proposalId, expectedRevision, decision, edited) {
    const job = get(jobId); if (job.status !== 'ready-for-review') throw new JobProblem('review_locked', job.status);
    if (!['pending', 'accept', 'reject'].includes(decision)) throw new JobProblem('bad_decision', decision);
    if (s.decide.run(decision, json(edited), proposalId, jobId, expectedRevision).changes !== 1)
      throw new JobProblem('proposal_revision_conflict', 'Proposal changed elsewhere.', ['reload']);
    return get(jobId);
  }
  function plan(jobId, e) {
    let job = get(jobId); if (job.status === 'awaiting-authority') return planFrom(job);
    if (job.status !== 'ready-for-review' || job.proposals.some((p) => p.decision === 'pending')) throw new JobProblem('review_incomplete', 'Decide every Proposal.');
    if (e.bindingId !== job.bindingId || e.locator !== job.source.locator || e.endPrefixHash !== job.sourceEndPrefixHash ||
      e.syncFacetRevision !== job.syncFacetRevision || e.campaignAnchor !== e.campaignHead)
      throw new JobProblem('review_source_stale', 'Chat prefix or authority changed.', ['capture-again']);
    const decisionHash = hash(job.proposals.map((p) => ({ id: p.proposalId, revision: p.revision, decision: p.decision, operation: p.edited.operation })));
    s.finalizing.run(`story-sync:${jobId}:${decisionHash.slice(0, 20)}`, decisionHash, jobId); job = get(jobId); return planFrom(job);
  }
  function planFrom(job) {
    const accepted = job.proposals.filter((p) => p.decision === 'accept');
    return { jobId: job.jobId, requestId: job.finalizationRequestId, decisionHash: job.decisionHash,
      campaignOperation: accepted.length ? { kind: 'atomic-batch', operations: accepted.map((p) => p.edited.operation) } : null,
      bindingOperation: { kind: 'set-sync-boundary', boundary: { throughMessageIndex: job.source.lastMessageIndex,
        prefixHash: job.sourceEndPrefixHash, sourceFingerprint: job.sourceFingerprint } } };
  }
  function acknowledge(jobId, receipt) {
    const job = get(jobId); if (job.status === 'completed') return job;
    if (job.status !== 'awaiting-authority' || receipt.requestId !== job.finalizationRequestId || receipt.decisionHash !== job.decisionHash ||
      receipt.bindingCommit?.bindingId !== job.bindingId) throw new JobProblem('authority_receipt_mismatch', 'Receipt does not match.', ['reconcile']);
    if (job.proposals.some((p) => p.decision === 'accept') && !receipt.campaignCommit) throw new JobProblem('authority_receipt_incomplete', 'Campaign commit missing.');
    tx(() => { job.proposals.forEach((p) => s.authoritySubject.run(json(p.decision === 'accept' ?
        { eventId: receipt.campaignCommit.eventId, revision: receipt.campaignCommit.revision } : { rejectedByHuman: true }), p.proposalId));
      const pruned = { ...job.source, messages: undefined, contentPruned: true }; s.committed.run(json(receipt), json(pruned), jobId); });
    return get(jobId);
  }
  function recover() { tx(() => { s.restartAttempts.run(); s.restartJobs.run(); }); }
  return { get, dispatch, start, finish, cancel, interrupt, resume, decide, plan, acknowledge, recover,
    attempts: (jobId) => s.attempts.all(jobId), close: () => db.close() };
}

export class InferenceLane {
  constructor({ modelHost, onEvent = () => {} }) { this.host = modelHost; this.onEvent = onEvent; this.queue = []; this.active = null; this.pumping = false; }
  submit(task) { return new Promise((resolve, reject) => { const entry = { ...task, resolve, reject, sequence: Date.now() + Math.random() };
    this.queue.push(entry); this.sort(); this.onEvent({ type: 'queued', id: task.id, kind: task.kind });
    if (task.kind === 'narration' && this.active?.task.kind === 'worker' && this.active.stage === 'running') this.active.controller.abort(new Preempted());
    queueMicrotask(() => this.pump()); }); }
  sort() { this.queue.sort((a, b) => (a.kind === 'narration' ? 0 : 1) - (b.kind === 'narration' ? 0 : 1) || a.sequence - b.sequence); }
  async pump() { if (this.pumping) return; this.pumping = true; try { while (!this.active && this.queue.length) {
    const task = this.queue.shift(), controller = new AbortController(); this.active = { task, controller, stage: 'switching' };
    try { await this.host.ensureOnly(task.modelKey); if (task.kind === 'worker' && this.queue.some((q) => q.kind === 'narration')) throw new Preempted();
      this.active.stage = 'running'; const result = await task.run(controller.signal); this.onEvent({ type: 'completed', id: task.id }); task.resolve(result);
    } catch (error) { const preempted = error instanceof Preempted || controller.signal.reason instanceof Preempted;
      if (task.kind === 'worker' && preempted) { this.onEvent({ type: 'preempted', id: task.id }); this.queue.push(task); this.sort(); }
      else task.reject(error); } finally { this.active = null; }
  } } finally { this.pumping = false; if (this.queue.length) queueMicrotask(() => this.pump()); } }
}
export class FakeModelHost {
  constructor(delay = 2) { this.delay = delay; this.loaded = null; this.events = []; this.maxLoaded = 0; }
  async ensureOnly(modelKey) { if (this.loaded === modelKey) return; if (this.loaded) { this.events.push(`unload:${this.loaded}`); await wait(this.delay); this.loaded = null; }
    this.events.push(`load:${modelKey}`); await wait(this.delay); this.loaded = modelKey; this.maxLoaded = Math.max(this.maxLoaded, 1); }
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
