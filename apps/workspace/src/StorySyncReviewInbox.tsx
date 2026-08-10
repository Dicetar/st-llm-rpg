import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import type {
  CampaignDocument,
  CampaignOperation,
  DecideStorySyncProposalRequest,
  StorySyncJobDocument,
  StorySyncFinalizationReceipt,
  StorySyncProposal,
  StorySyncProposalDecision,
  WorkerModelProfile,
} from '@st-llm-rpg/wire';

type SupportedOperationKind =
  | 'create_actor'
  | 'update_actor'
  | 'create_item'
  | 'update_item'
  | 'create_quest'
  | 'update_quest'
  | 'create_place'
  | 'update_place'
  | 'set_current_scene';

const ACTIVE_JOB_STATES = new Set(['queued', 'waiting-for-lane', 'running', 'parsing', 'repairing']);
const SUPPORTED_KINDS: readonly SupportedOperationKind[] = [
  'create_actor', 'update_actor', 'create_item', 'update_item', 'create_quest',
  'update_quest', 'create_place', 'update_place', 'set_current_scene',
];

function kindLabel(kind: string): string {
  return ({
    create_actor: 'New Actor', update_actor: 'Update Actor', create_item: 'New Item',
    update_item: 'Update Item', create_quest: 'New Quest', update_quest: 'Update Quest',
    create_place: 'New Place', update_place: 'Update Place', set_current_scene: 'Current Scene',
  } as Record<string, string>)[kind] ?? kind.replaceAll('_', ' ');
}

function blankOperation(kind: SupportedOperationKind, campaign: CampaignDocument): CampaignOperation {
  const actor = campaign.actors.find(record => !record.archived);
  const item = campaign.items.find(record => !record.archived);
  const quest = campaign.quests.find(record => !record.archived);
  const place = campaign.places.find(record => !record.archived);
  switch (kind) {
    case 'create_actor': return { kind, actor: { name: '', summary: '' } };
    case 'update_actor': return { kind, actorId: actor?.id ?? '', name: actor?.name ?? '', summary: actor?.summary ?? '' };
    case 'create_item': return { kind, item: { name: '', summary: '' } };
    case 'update_item': return { kind, itemId: item?.id ?? '', name: item?.name ?? '', summary: item?.summary ?? '', ownerActorId: item?.ownerActorId ?? null };
    case 'create_quest': return { kind, quest: { name: '', summary: '', status: 'active' } };
    case 'update_quest': return { kind, questId: quest?.id ?? '', name: quest?.name ?? '', summary: quest?.summary ?? '', status: quest?.status ?? 'active' };
    case 'create_place': return { kind, place: { name: '', summary: '' } };
    case 'update_place': return { kind, placeId: place?.id ?? '', name: place?.name ?? '', summary: place?.summary ?? '' };
    case 'set_current_scene': {
      const placeId = campaign.currentScene?.placeId ?? place?.id;
      return {
        kind,
        scene: {
          name: campaign.currentScene?.name ?? '', summary: campaign.currentScene?.summary ?? '',
          ...(placeId ? { placeId } : {}),
          actorIds: campaign.currentScene?.actorIds ?? [], itemIds: campaign.currentScene?.itemIds ?? [],
        },
      };
    }
  }
}

function isSupportedOperation(operation: CampaignOperation | null): operation is CampaignOperation & { kind: SupportedOperationKind } {
  return operation !== null && SUPPORTED_KINDS.includes(operation.kind as SupportedOperationKind);
}

function CommonFields(props: {
  name: string;
  summary: string;
  nameLabel: string;
  summaryLabel: string;
  disabled: boolean;
  onName: (value: string) => void;
  onSummary: (value: string) => void;
}) {
  return <>
    <label><span>{props.nameLabel}</span><input value={props.name} onChange={event => props.onName(event.target.value)} disabled={props.disabled} /></label>
    <label><span>{props.summaryLabel}</span><textarea rows={4} value={props.summary} onChange={event => props.onSummary(event.target.value)} disabled={props.disabled} /></label>
  </>;
}

function OperationEditor(props: {
  operation: CampaignOperation | null;
  campaign: CampaignDocument;
  disabled: boolean;
  onChange: (operation: CampaignOperation) => void;
}) {
  const operation = props.operation;
  const selectedKind = isSupportedOperation(operation) ? operation.kind : '';
  const actorOptions = props.campaign.actors.filter(record => !record.archived);
  const itemOptions = props.campaign.items.filter(record => !record.archived);
  const questOptions = props.campaign.quests.filter(record => !record.archived);
  const placeOptions = props.campaign.places.filter(record => !record.archived);

  return <fieldset className="story-operation-editor">
    <legend>Campaign change</legend>
    <label>
      <span>Record type</span>
      <select
        value={selectedKind}
        disabled={props.disabled}
        onChange={event => props.onChange(blankOperation(event.target.value as SupportedOperationKind, props.campaign))}
      >
        <option value="" disabled>Choose a structured change</option>
        {SUPPORTED_KINDS.map(kind => <option value={kind} key={kind}>{kindLabel(kind)}</option>)}
      </select>
    </label>
    {!isSupportedOperation(operation) ? <p className="story-operation-warning">The worker did not produce an editable supported change. Choose a record type to repair it.</p> : null}

    {operation?.kind === 'create_actor' ? <CommonFields
      name={operation.actor.name} summary={operation.actor.summary ?? ''} nameLabel="Actor name" summaryLabel="Actor summary" disabled={props.disabled}
      onName={name => props.onChange({ ...operation, actor: { ...operation.actor, name } })}
      onSummary={summary => props.onChange({ ...operation, actor: { ...operation.actor, summary } })}
    /> : null}
    {operation?.kind === 'update_actor' ? <>
      <label><span>Actor</span><select value={operation.actorId} disabled={props.disabled} onChange={event => {
        const record = props.campaign.actors.find(candidate => candidate.id === event.target.value);
        props.onChange({ ...operation, actorId: event.target.value, name: record?.name ?? operation.name, summary: record?.summary ?? operation.summary });
      }}><option value="" disabled>Choose Actor</option>{actorOptions.map(record => <option key={record.id} value={record.id}>{record.name}</option>)}</select></label>
      <CommonFields name={operation.name} summary={operation.summary} nameLabel="Actor name" summaryLabel="Actor summary" disabled={props.disabled}
        onName={name => props.onChange({ ...operation, name })} onSummary={summary => props.onChange({ ...operation, summary })} />
    </> : null}
    {operation?.kind === 'create_item' ? <>
      <CommonFields name={operation.item.name} summary={operation.item.summary ?? ''} nameLabel="Item name" summaryLabel="Item summary" disabled={props.disabled}
        onName={name => props.onChange({ ...operation, item: { ...operation.item, name } })}
        onSummary={summary => props.onChange({ ...operation, item: { ...operation.item, summary } })} />
      <label><span>Attach to Actor</span><select value={operation.item.ownerActorId ?? ''} disabled={props.disabled} onChange={event => {
        const item = { ...operation.item };
        if (event.target.value) item.ownerActorId = event.target.value;
        else delete item.ownerActorId;
        props.onChange({ ...operation, item });
      }}><option value="">Unattached</option>{actorOptions.map(record => <option key={record.id} value={record.id}>{record.name}</option>)}</select></label>
    </> : null}
    {operation?.kind === 'update_item' ? <>
      <label><span>Item</span><select value={operation.itemId} disabled={props.disabled} onChange={event => {
        const record = props.campaign.items.find(candidate => candidate.id === event.target.value);
        props.onChange({ ...operation, itemId: event.target.value, name: record?.name ?? operation.name, summary: record?.summary ?? operation.summary, ownerActorId: record?.ownerActorId ?? null });
      }}><option value="" disabled>Choose Item</option>{itemOptions.map(record => <option key={record.id} value={record.id}>{record.name}</option>)}</select></label>
      <CommonFields name={operation.name} summary={operation.summary} nameLabel="Item name" summaryLabel="Item summary" disabled={props.disabled}
        onName={name => props.onChange({ ...operation, name })} onSummary={summary => props.onChange({ ...operation, summary })} />
      <label><span>Attach to Actor</span><select value={operation.ownerActorId ?? ''} disabled={props.disabled} onChange={event => props.onChange({ ...operation, ownerActorId: event.target.value || null })}><option value="">Unattached</option>{actorOptions.map(record => <option key={record.id} value={record.id}>{record.name}</option>)}</select></label>
    </> : null}
    {operation?.kind === 'create_quest' ? <>
      <CommonFields name={operation.quest.name} summary={operation.quest.summary ?? ''} nameLabel="Quest name" summaryLabel="Quest summary" disabled={props.disabled}
        onName={name => props.onChange({ ...operation, quest: { ...operation.quest, name } })}
        onSummary={summary => props.onChange({ ...operation, quest: { ...operation.quest, summary } })} />
      <label><span>Status</span><select value={operation.quest.status ?? 'active'} disabled={props.disabled} onChange={event => props.onChange({ ...operation, quest: { ...operation.quest, status: event.target.value as 'active' | 'completed' } })}><option value="active">Active</option><option value="completed">Completed</option></select></label>
    </> : null}
    {operation?.kind === 'update_quest' ? <>
      <label><span>Quest</span><select value={operation.questId} disabled={props.disabled} onChange={event => {
        const record = props.campaign.quests.find(candidate => candidate.id === event.target.value);
        props.onChange({ ...operation, questId: event.target.value, name: record?.name ?? operation.name, summary: record?.summary ?? operation.summary, status: record?.status ?? operation.status });
      }}><option value="" disabled>Choose Quest</option>{questOptions.map(record => <option key={record.id} value={record.id}>{record.name}</option>)}</select></label>
      <CommonFields name={operation.name} summary={operation.summary} nameLabel="Quest name" summaryLabel="Quest summary" disabled={props.disabled}
        onName={name => props.onChange({ ...operation, name })} onSummary={summary => props.onChange({ ...operation, summary })} />
      <label><span>Status</span><select value={operation.status} disabled={props.disabled} onChange={event => props.onChange({ ...operation, status: event.target.value as 'active' | 'completed' })}><option value="active">Active</option><option value="completed">Completed</option></select></label>
    </> : null}
    {operation?.kind === 'create_place' ? <CommonFields name={operation.place.name} summary={operation.place.summary ?? ''} nameLabel="Place name" summaryLabel="Place summary" disabled={props.disabled}
      onName={name => props.onChange({ ...operation, place: { ...operation.place, name } })}
      onSummary={summary => props.onChange({ ...operation, place: { ...operation.place, summary } })} /> : null}
    {operation?.kind === 'update_place' ? <>
      <label><span>Place</span><select value={operation.placeId} disabled={props.disabled} onChange={event => {
        const record = props.campaign.places.find(candidate => candidate.id === event.target.value);
        props.onChange({ ...operation, placeId: event.target.value, name: record?.name ?? operation.name, summary: record?.summary ?? operation.summary });
      }}><option value="" disabled>Choose Place</option>{placeOptions.map(record => <option key={record.id} value={record.id}>{record.name}</option>)}</select></label>
      <CommonFields name={operation.name} summary={operation.summary} nameLabel="Place name" summaryLabel="Place summary" disabled={props.disabled}
        onName={name => props.onChange({ ...operation, name })} onSummary={summary => props.onChange({ ...operation, summary })} />
    </> : null}
    {operation?.kind === 'set_current_scene' ? <>
      <CommonFields name={operation.scene.name} summary={operation.scene.summary ?? ''} nameLabel="Scene name" summaryLabel="Scene summary" disabled={props.disabled}
        onName={name => props.onChange({ ...operation, scene: { ...operation.scene, name } })}
        onSummary={summary => props.onChange({ ...operation, scene: { ...operation.scene, summary } })} />
      <label><span>Scene Place</span><select value={operation.scene.placeId ?? ''} disabled={props.disabled} onChange={event => {
        const scene = { ...operation.scene };
        if (event.target.value) scene.placeId = event.target.value;
        else delete scene.placeId;
        props.onChange({ ...operation, scene });
      }}><option value="">No Place</option>{placeOptions.map(record => <option key={record.id} value={record.id}>{record.name}</option>)}</select></label>
    </> : null}
  </fieldset>;
}

function ProposalCard(props: {
  proposal: StorySyncProposal;
  campaign: CampaignDocument;
  busy: boolean;
  onSave: (proposalId: string, request: DecideStorySyncProposalRequest) => Promise<void>;
}) {
  const [draft, setDraft] = useState(props.proposal.draft);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(props.proposal.draft), [props.proposal.id, props.proposal.revision]);
  const save = async (decision: StorySyncProposalDecision) => {
    setSaving(true);
    try { await props.onSave(props.proposal.id, { expectedRevision: props.proposal.revision, decision, draft }); }
    finally { setSaving(false); }
  };
  const disabled = props.busy || saving;
  return <article className={`story-proposal story-proposal--${props.proposal.decision}`}>
    <header className="story-proposal__heading">
      <div><p className="eyebrow">{props.proposal.confidence} confidence · proposal {props.proposal.ordinal + 1}</p><h5>{draft.title}</h5></div>
      <span>{props.proposal.decision}</span>
    </header>
    <label><span>Proposal title</span><input value={draft.title} disabled={disabled} onChange={event => setDraft(current => ({ ...current, title: event.target.value }))} /></label>
    <OperationEditor operation={draft.operation} campaign={props.campaign} disabled={disabled} onChange={operation => setDraft(current => ({ ...current, operation }))} />
    <label><span>Review note</span><textarea rows={3} value={draft.note} disabled={disabled} onChange={event => setDraft(current => ({ ...current, note: event.target.value }))} /></label>
    {props.proposal.sourceLinks.length ? <details className="story-evidence"><summary>Evidence from {props.proposal.sourceLinks.length} chat message{props.proposal.sourceLinks.length === 1 ? '' : 's'}</summary><ol>{props.proposal.sourceLinks.map(link => <li key={link.messageIndex}><strong>#{link.messageIndex}</strong><span>{link.excerpt}</span></li>)}</ol></details> : null}
    {props.proposal.validationProblems.length ? <ul className="story-validation">{props.proposal.validationProblems.map(problem => <li key={problem}>{problem}</li>)}</ul> : null}
    <div className="story-proposal__actions">
      <button type="button" disabled={disabled || draft.operation === null || !draft.title.trim()} onClick={() => { void save('accept'); }}>Accept</button>
      <button type="button" className="button-secondary" disabled={disabled} onClick={() => { void save('reject'); }}>Reject</button>
      <button type="button" className="button-secondary" disabled={disabled} onClick={() => { void save('defer'); }}>Defer</button>
      <button type="button" className="button-secondary" disabled={disabled || draft.operation === null || !draft.title.trim()} onClick={() => { void save('pending'); }}>Save edit</button>
    </div>
  </article>;
}

export type StorySyncReviewInboxViewProps = Readonly<{
  campaign: CampaignDocument;
  profiles: readonly WorkerModelProfile[];
  jobs: readonly StorySyncJobDocument[];
  loading: boolean;
  busy: boolean;
  error: string;
  message: string;
  onSaveProfile: (modelId: string, requestedOutputTokens: number) => Promise<void>;
  onSaveProposal: (proposalId: string, request: DecideStorySyncProposalRequest) => Promise<void>;
  onFinalizeJob: (job: StorySyncJobDocument) => Promise<void>;
  onJobAction: (job: StorySyncJobDocument, action: 'cancel' | 'resume' | 'discard') => Promise<void>;
  onRefresh: () => void;
}>;

export function StorySyncReviewInboxView(props: StorySyncReviewInboxViewProps) {
  const currentProfile = props.profiles[0];
  const [modelId, setModelId] = useState(currentProfile?.modelId ?? '');
  const [requestedOutputTokens, setRequestedOutputTokens] = useState(currentProfile?.requestedOutputTokens ?? 1600);
  useEffect(() => {
    setModelId(currentProfile?.modelId ?? '');
    setRequestedOutputTokens(currentProfile?.requestedOutputTokens ?? 1600);
  }, [currentProfile?.modelId, currentProfile?.requestedOutputTokens]);
  const saveProfile = (event: FormEvent) => {
    event.preventDefault();
    void props.onSaveProfile(modelId.trim(), requestedOutputTokens);
  };
  return <section className="collection-view story-review" aria-labelledby="story-review-heading">
    <div className="collection-heading story-review__heading"><div><p className="eyebrow">Story Sync</p><h4 id="story-review-heading">Review Inbox</h4><p>Worker suggestions remain drafts until you review them. Decisions alone change nothing; <strong>Finalize review</strong> applies all accepted changes as one atomic Campaign revision and advances this chat's Sync Boundary.</p></div><button type="button" className="button-secondary" onClick={props.onRefresh} disabled={props.loading || props.busy}>Refresh</button></div>
    {props.error ? <p className="error-banner" role="alert">{props.error}</p> : null}
    {props.message ? <p className="success-banner" role="status">{props.message}</p> : null}
    <details className="worker-profile" open={!currentProfile}>
      <summary><span><strong>Campaign worker model</strong><small>Used only for Story Sync analysis; the SillyTavern narrator stays unchanged.</small></span><span>{currentProfile ? 'configured' : 'setup needed'}</span></summary>
      <form className="worker-profile__form" onSubmit={saveProfile}>
        <label><span>LM Studio model ID</span><input value={modelId} onChange={event => setModelId(event.target.value)} disabled={props.busy} placeholder="mistralai/mistral-nemo-instruct-2407" /></label>
        <label><span>Maximum worker output tokens</span><input type="number" min={128} max={8192} value={requestedOutputTokens} onChange={event => setRequestedOutputTokens(Number(event.target.value))} disabled={props.busy} /></label>
        <button type="submit" disabled={props.busy || !modelId.trim() || requestedOutputTokens < 128 || requestedOutputTokens > 8192}>Save worker model</button>
      </form>
    </details>
    {props.loading && props.jobs.length === 0 ? <p className="empty-state">Loading Story Sync jobs…</p> : null}
    {!props.loading && props.jobs.length === 0 ? <div className="story-empty"><p className="eyebrow">Nothing waiting</p><h5>Sync from the linked chat</h5><p>In SillyTavern, open RPG Companion and choose <strong>Sync Story</strong>. The bounded new chat range will appear here as editable proposals.</p></div> : null}
    <div className="story-job-list">
      {props.jobs.map(job => {
        const acceptedCount = job.proposals.filter(proposal => proposal.decision === 'accept').length;
        const reviewComplete = job.proposals.every(proposal => proposal.decision === 'accept' || proposal.decision === 'reject');
        return <section className={`story-job story-job--${job.status}`} key={job.id}>
        <header className="story-job__heading"><div><p className="eyebrow">Messages {job.source.firstMessageIndex}–{job.source.lastMessageIndex} · {job.source.messageCount} captured</p><h5>{job.status === 'ready-for-review' ? 'Ready for review' : kindLabel(job.status)}</h5></div><span>{job.attemptCount} attempt{job.attemptCount === 1 ? '' : 's'}</span></header>
        {job.problem ? <p className="error-banner">{job.problem.message}</p> : null}
        {ACTIVE_JOB_STATES.has(job.status) ? <p className="story-job__progress" role="status">The Campaign Worker is analyzing this bounded chat range. This page updates automatically.</p> : null}
        {ACTIVE_JOB_STATES.has(job.status) ? <div className="story-job__controls"><button type="button" className="button-secondary" disabled={props.busy} onClick={() => { void props.onJobAction(job, 'cancel'); }}>Stop analysis</button></div> : null}
        {['cancelled', 'interrupted', 'failed'].includes(job.status) ? <div className="story-job__controls"><button type="button" disabled={props.busy} onClick={() => { void props.onJobAction(job, 'resume'); }}>{job.status === 'failed' ? 'Retry analysis' : 'Resume analysis'}</button></div> : null}
        {job.proposals.map(proposal => <ProposalCard key={proposal.id} proposal={proposal} campaign={props.campaign} busy={props.busy} onSave={props.onSaveProposal} />)}
        {job.status === 'ready-for-review' ? <div className="story-finalize">
          <div><strong>Finalize review</strong><span>{reviewComplete ? `${acceptedCount} accepted · ${job.proposals.length - acceptedCount} rejected` : 'Every Proposal needs Accept or Reject'}</span></div>
          <button type="button" disabled={props.busy || !reviewComplete} onClick={() => { void props.onFinalizeJob(job); }}>
            {acceptedCount > 0 ? `Apply ${acceptedCount} and finish` : 'Finish with no changes'}
          </button>
        </div> : null}
        {!['completed', 'discarded'].includes(job.status) ? <div className="story-job__discard"><button type="button" className="button-secondary" disabled={props.busy} onClick={() => { void props.onJobAction(job, 'discard'); }}>Discard review</button></div> : null}
      </section>;
      })}
    </div>
  </section>;
}

async function responseJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}) } });
  const body = await response.json() as unknown;
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'message' in body ? String(body.message) : `${path} returned HTTP ${response.status}`;
    throw new Error(message);
  }
  return body as T;
}

export function StorySyncReviewInbox(props: Readonly<{ campaign: CampaignDocument }>) {
  const [profiles, setProfiles] = useState<WorkerModelProfile[]>([]);
  const [jobs, setJobs] = useState<StorySyncJobDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const hasActiveJob = useMemo(() => jobs.some(job => ACTIVE_JOB_STATES.has(job.status)), [jobs]);
  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [nextProfiles, nextJobs] = await Promise.all([
        responseJson<WorkerModelProfile[]>('/api/story-sync/worker-profiles'),
        responseJson<StorySyncJobDocument[]>(`/api/campaigns/${encodeURIComponent(props.campaign.campaign.id)}/review-inbox`),
      ]);
      setProfiles(nextProfiles); setJobs(nextJobs); setError('');
    } catch (value) { setError(value instanceof Error ? value.message : String(value)); }
    finally { if (!quiet) setLoading(false); }
  }, [props.campaign.campaign.id]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!hasActiveJob) return undefined;
    const timer = window.setInterval(() => { void refresh(true); }, 1800);
    return () => window.clearInterval(timer);
  }, [hasActiveJob, refresh]);
  const saveProfile = async (modelId: string, requestedOutputTokens: number) => {
    setBusy(true); setMessage(''); setError('');
    try {
      const profile = await responseJson<WorkerModelProfile>('/api/story-sync/worker-profile', { method: 'PUT', body: JSON.stringify({ modelId, requestedOutputTokens }) });
      setProfiles([profile]); setMessage('Campaign Worker model saved. Your SillyTavern narrator was not changed.');
    } catch (value) { setError(value instanceof Error ? value.message : String(value)); }
    finally { setBusy(false); }
  };
  const saveProposal = async (proposalId: string, request: DecideStorySyncProposalRequest) => {
    setBusy(true); setMessage(''); setError('');
    try {
      const updated = await responseJson<StorySyncJobDocument>(`/api/story-sync/proposals/${encodeURIComponent(proposalId)}`, { method: 'PUT', body: JSON.stringify(request) });
      setJobs(current => current.map(job => job.id === updated.id ? updated : job));
      setMessage(request.decision === 'pending' ? 'Proposal edit saved.' : `Proposal marked ${request.decision}. Campaign truth is unchanged.`);
    } catch (value) { setError(value instanceof Error ? value.message : String(value)); }
    finally { setBusy(false); }
  };
  const finalizeJob = async (job: StorySyncJobDocument) => {
    setBusy(true); setMessage(''); setError('');
    try {
      const receipt = await responseJson<StorySyncFinalizationReceipt>(`/api/story-sync/jobs/${encodeURIComponent(job.id)}/finalize`, {
        method: 'POST',
        body: JSON.stringify({
          proposals: job.proposals.map(proposal => ({
            proposalId: proposal.id,
            expectedRevision: proposal.revision,
            decision: proposal.decision,
          })),
        }),
      });
      await refresh(true);
      setMessage(`${receipt.acceptedProposalIds.length} accepted change${receipt.acceptedProposalIds.length === 1 ? '' : 's'} finalized. Campaign is now revision ${receipt.campaignRevision}; this chat's Sync Boundary advanced.`);
    } catch (value) { setError(value instanceof Error ? value.message : String(value)); }
    finally { setBusy(false); }
  };
  const jobAction = async (job: StorySyncJobDocument, action: 'cancel' | 'resume' | 'discard') => {
    if (action === 'discard' && !window.confirm('Discard this unresolved Story Sync review? Its retained source and proposals will be removed. Campaign truth and the Sync Boundary will not change.')) return;
    setBusy(true); setMessage(''); setError('');
    try {
      const updated = await responseJson<StorySyncJobDocument>(`/api/story-sync/jobs/${encodeURIComponent(job.id)}/${action}`, { method: 'POST' });
      setJobs(current => current.map(candidate => candidate.id === updated.id ? updated : candidate));
      setMessage(action === 'cancel' ? 'Story Sync stopped. You can resume or discard it.' : action === 'resume' ? 'Story Sync resumed with fresh Campaign and Binding checks.' : 'Story Sync review discarded. Campaign truth and Sync Boundary were unchanged.');
    } catch (value) { setError(value instanceof Error ? value.message : String(value)); }
    finally { setBusy(false); }
  };
  return <StorySyncReviewInboxView campaign={props.campaign} profiles={profiles} jobs={jobs} loading={loading} busy={busy} error={error} message={message} onSaveProfile={saveProfile} onSaveProposal={saveProposal} onFinalizeJob={finalizeJob} onJobAction={jobAction} onRefresh={() => { void refresh(); }} />;
}
