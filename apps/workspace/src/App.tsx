import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from 'react';
import {
  isCampaignInvalidation,
  type CampaignActor,
  type CampaignCommit,
  type CampaignDocument,
  type CampaignHistoryEntry,
  type CampaignItem,
  type CampaignOperation,
  type CampaignScene,
  type CampaignSummary,
  type HealthDocument,
  type Problem,
  type ReadinessDocument,
} from '@st-llm-rpg/wire';
import { buildStatusCards } from './status-model.js';

type Snapshot = Readonly<{
  health: HealthDocument | null;
  readiness: ReadinessDocument | null;
  loading: boolean;
  error: string;
}>;

type RevisionConflict = Readonly<{
  campaignId: string;
  expectedRevision: number;
  actualRevision: number | null;
}>;

type CollectionKey = 'actors' | 'items' | 'scene' | 'history';
type SyncState = 'idle' | 'live' | 'reconnecting' | 'update-ready';
type CanonicalUpdate = Readonly<{
  document: CampaignDocument;
  history: CampaignHistoryEntry[];
}>;

class ApiProblem extends Error {
  readonly problem: Problem | null;

  constructor(message: string, problem: Problem | null) {
    super(message);
    this.name = 'ApiProblem';
    this.problem = problem;
  }
}

async function fetchJson<T>(path: string, signal?: AbortSignal, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  const response = await fetch(path, {
    ...init,
    ...(signal === undefined ? {} : { signal }),
    headers,
  });
  const body = await response.json().catch(() => null) as T | Problem | null;
  if (!response.ok) {
    const problem = body && typeof body === 'object' && 'schema' in body && body.schema === 'st-rpg.problem'
      ? body as Problem
      : null;
    throw new ApiProblem(problem?.message ?? `${path} returned HTTP ${response.status}`, problem);
  }
  return body as T;
}

function newRequestId(): string {
  return crypto.randomUUID();
}

function conflictFrom(problem: Problem | null, campaignId: string, expectedRevision: number): RevisionConflict | null {
  if (problem?.code !== 'CAMPAIGN_REVISION_CONFLICT') return null;
  const details = problem.details && typeof problem.details === 'object'
    ? problem.details as Record<string, unknown>
    : null;
  const actual = details && typeof details.actualRevision === 'number' ? details.actualRevision : null;
  return { campaignId, expectedRevision, actualRevision: actual };
}

function syncLabel(state: SyncState): string {
  if (state === 'live') return 'Live updates';
  if (state === 'reconnecting') return 'Reconnecting';
  if (state === 'update-ready') return 'Update available';
  return 'Not connected';
}

export function CampaignBookView(props: {
  snapshot: Snapshot;
  onRefresh: () => void;
  children?: ReactNode;
}) {
  const cards = buildStatusCards(props.snapshot.readiness);
  return (
    <main className="book-shell">
      <header className="book-header">
        <div>
          <p className="eyebrow">Local companion · Campaign Workspace</p>
          <h1>Campaign Book</h1>
          <p className="lede">Edit durable Campaign truth through task-oriented collections. SillyTavern remains available as the independent fallback.</p>
        </div>
        <button type="button" onClick={props.onRefresh} disabled={props.snapshot.loading}>
          {props.snapshot.loading ? 'Checking…' : 'Refresh status'}
        </button>
      </header>

      {props.snapshot.error ? <p className="error-banner" role="alert">{props.snapshot.error}</p> : null}

      <section aria-labelledby="system-status">
        <div className="section-heading">
          <h2 id="system-status">System status</h2>
          <p>{props.snapshot.health ? `Companion alive · ${Math.round(props.snapshot.health.uptimeMs / 1000)}s uptime` : 'Waiting for companion health…'}</p>
        </div>
        <div className="status-grid">
          {cards.map(card => (
            <article className={`status-card status-card--${card.tone}`} key={card.id}>
              <div className="status-card__heading">
                <h3>{card.title}</h3>
                <span>{card.state}</span>
              </div>
              <p>{card.message}</p>
            </article>
          ))}
        </div>
      </section>

      {props.children}
    </main>
  );
}

export function RevisionConflictBanner(props: {
  conflict: RevisionConflict;
  busy: boolean;
  onReload: () => void;
}) {
  const actual = props.conflict.actualRevision === null
    ? 'a newer revision'
    : `revision ${props.conflict.actualRevision}`;
  return (
    <div className="conflict-banner" role="alert">
      <div>
        <strong>This tab is stale.</strong>
        <p>Your edit expected revision {props.conflict.expectedRevision}, but the Campaign is now at {actual}. Nothing was written.</p>
      </div>
      <button type="button" onClick={props.onReload} disabled={props.busy}>Load canonical Campaign</button>
    </div>
  );
}

export function CampaignHistoryView(props: {
  entries: readonly CampaignHistoryEntry[];
  currentRevision: number;
  viewingRevision: number | null;
  busy: boolean;
  expanded?: boolean;
  onOpenRevision: (revision: number) => void;
  onReturnCurrent: () => void;
}) {
  return (
    <details className="history-panel" open={props.expanded || props.viewingRevision !== null}>
      <summary>Immutable history ({props.entries.length})</summary>
      {props.viewingRevision !== null ? (
        <div className="historical-banner" role="status">
          <span>Viewing read-only revision {props.viewingRevision}.</span>
          <button type="button" onClick={props.onReturnCurrent} disabled={props.busy}>Return to current revision {props.currentRevision}</button>
        </div>
      ) : null}
      <ol className="history-list">
        {props.entries.map(entry => (
          <li key={entry.eventId}>
            <button
              type="button"
              className={props.viewingRevision === entry.revision ? 'history-entry history-entry--active' : 'history-entry'}
              onClick={() => props.onOpenRevision(entry.revision)}
              disabled={props.busy}
            >
              <strong>Revision {entry.revision}</strong>
              <span>{entry.operationKind}</span>
            </button>
          </li>
        ))}
      </ol>
    </details>
  );
}

function CollectionNavigation(props: {
  active: CollectionKey;
  document: CampaignDocument;
  onSelect: (collection: CollectionKey) => void;
}) {
  const entries: ReadonlyArray<Readonly<{ key: CollectionKey; label: string; count?: number }>> = [
    { key: 'actors', label: 'Actors', count: props.document.actors.filter(record => !record.archived).length },
    { key: 'items', label: 'Items', count: props.document.items.filter(record => !record.archived).length },
    { key: 'scene', label: 'Current Scene', count: props.document.currentScene ? 1 : 0 },
    { key: 'history', label: 'History' },
  ];
  return (
    <nav className="collection-nav" aria-label="Campaign collections">
      {entries.map(entry => (
        <button
          type="button"
          key={entry.key}
          className={props.active === entry.key ? 'collection-tab collection-tab--active' : 'collection-tab'}
          aria-current={props.active === entry.key ? 'page' : undefined}
          onClick={() => props.onSelect(entry.key)}
        >
          <span>{entry.label}</span>
          {entry.count === undefined ? null : <strong>{entry.count}</strong>}
        </button>
      ))}
    </nav>
  );
}

function ActorEditor(props: {
  actor: CampaignActor;
  busy: boolean;
  readOnly: boolean;
  onSave: (actorId: string, name: string, summary: string) => Promise<void>;
  onArchive: (actorId: string, archived: boolean) => Promise<void>;
}) {
  const [name, setName] = useState(props.actor.name);
  const [summary, setSummary] = useState(props.actor.summary);
  const dirty = name.trim() !== props.actor.name || summary.trim() !== props.actor.summary;
  useEffect(() => {
    if (dirty) return;
    setName(props.actor.name);
    setSummary(props.actor.summary);
  }, [dirty, props.actor.name, props.actor.summary]);
  return (
    <form className={props.actor.archived ? 'record-card record-card--archived' : 'record-card'} onSubmit={event => {
      event.preventDefault();
      void props.onSave(props.actor.id, name, summary);
    }}>
      <div className="record-card__heading">
        <strong>{props.actor.archived ? 'Archived Actor' : 'Actor'}</strong>
        <span>{props.actor.id}</span>
      </div>
      <label>
        <span>Name</span>
        <input value={name} onChange={event => setName(event.target.value)} disabled={props.busy || props.readOnly} />
      </label>
      <label>
        <span>Summary</span>
        <textarea rows={4} value={summary} onChange={event => setSummary(event.target.value)} disabled={props.busy || props.readOnly} />
      </label>
      <div className="record-actions">
        <button type="submit" disabled={props.busy || props.readOnly || !name.trim() || !dirty}>Save Actor</button>
        <button
          type="button"
          className="button-secondary"
          disabled={props.busy || props.readOnly}
          onClick={() => { void props.onArchive(props.actor.id, !props.actor.archived); }}
        >
          {props.actor.archived ? 'Restore Actor' : 'Archive Actor'}
        </button>
      </div>
    </form>
  );
}

function ItemEditor(props: {
  item: CampaignItem;
  actors: readonly CampaignActor[];
  busy: boolean;
  readOnly: boolean;
  onSave: (itemId: string, name: string, summary: string, ownerActorId: string | null) => Promise<void>;
  onArchive: (itemId: string, archived: boolean) => Promise<void>;
}) {
  const [name, setName] = useState(props.item.name);
  const [summary, setSummary] = useState(props.item.summary);
  const [ownerActorId, setOwnerActorId] = useState(props.item.ownerActorId ?? '');
  const dirty = name.trim() !== props.item.name
    || summary.trim() !== props.item.summary
    || ownerActorId !== (props.item.ownerActorId ?? '');
  useEffect(() => {
    if (dirty) return;
    setName(props.item.name);
    setSummary(props.item.summary);
    setOwnerActorId(props.item.ownerActorId ?? '');
  }, [dirty, props.item.name, props.item.ownerActorId, props.item.summary]);
  return (
    <form className={props.item.archived ? 'record-card record-card--archived' : 'record-card'} onSubmit={event => {
      event.preventDefault();
      void props.onSave(props.item.id, name, summary, ownerActorId || null);
    }}>
      <div className="record-card__heading">
        <strong>{props.item.archived ? 'Archived Item' : 'Item'}</strong>
        <span>{props.item.id}</span>
      </div>
      <label>
        <span>Name</span>
        <input value={name} onChange={event => setName(event.target.value)} disabled={props.busy || props.readOnly} />
      </label>
      <label>
        <span>Summary</span>
        <textarea rows={4} value={summary} onChange={event => setSummary(event.target.value)} disabled={props.busy || props.readOnly} />
      </label>
      <label>
        <span>Attached Actor</span>
        <select value={ownerActorId} onChange={event => setOwnerActorId(event.target.value)} disabled={props.busy || props.readOnly}>
          <option value="">Unattached</option>
          {props.actors.map(actor => (
            <option key={actor.id} value={actor.id} disabled={actor.archived && actor.id !== props.item.ownerActorId}>
              {actor.name}{actor.archived ? ' · archived' : ''}
            </option>
          ))}
        </select>
      </label>
      <div className="record-actions">
        <button type="submit" disabled={props.busy || props.readOnly || !name.trim() || !dirty}>Save Item</button>
        <button
          type="button"
          className="button-secondary"
          disabled={props.busy || props.readOnly}
          onClick={() => { void props.onArchive(props.item.id, !props.item.archived); }}
        >
          {props.item.archived ? 'Restore Item' : 'Archive Item'}
        </button>
      </div>
    </form>
  );
}

function SceneEditor(props: {
  scene: CampaignScene | null;
  busy: boolean;
  readOnly: boolean;
  onSave: (name: string, summary: string) => Promise<void>;
}) {
  const [name, setName] = useState(props.scene?.name ?? '');
  const [summary, setSummary] = useState(props.scene?.summary ?? '');
  const dirty = name.trim() !== (props.scene?.name ?? '') || summary.trim() !== (props.scene?.summary ?? '');
  useEffect(() => {
    if (dirty) return;
    setName(props.scene?.name ?? '');
    setSummary(props.scene?.summary ?? '');
  }, [dirty, props.scene?.id, props.scene?.name, props.scene?.summary]);
  return (
    <form className="record-card" onSubmit={event => {
      event.preventDefault();
      void props.onSave(name, summary);
    }}>
      <div className="record-card__heading">
        <strong>{props.scene ? 'Current Scene' : 'Start Current Scene'}</strong>
        {props.scene ? <span>{props.scene.id}</span> : null}
      </div>
      <label>
        <span>Name</span>
        <input value={name} onChange={event => setName(event.target.value)} disabled={props.busy || props.readOnly} />
      </label>
      <label>
        <span>Summary</span>
        <textarea rows={7} value={summary} onChange={event => setSummary(event.target.value)} disabled={props.busy || props.readOnly} />
      </label>
      <div className="record-actions">
        <button type="submit" disabled={props.busy || props.readOnly || !name.trim() || !dirty}>
          {props.scene ? 'Save Scene' : 'Start Scene'}
        </button>
      </div>
    </form>
  );
}

function CampaignAuthorityPanel() {
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [selected, setSelected] = useState<CampaignDocument | null>(null);
  const [historical, setHistorical] = useState<CampaignDocument | null>(null);
  const [history, setHistory] = useState<CampaignHistoryEntry[]>([]);
  const [pendingCanonical, setPendingCanonical] = useState<CanonicalUpdate | null>(null);
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [activeCollection, setActiveCollection] = useState<CollectionKey>('actors');
  const [campaignTitle, setCampaignTitle] = useState('');
  const [actorName, setActorName] = useState('');
  const [actorSummary, setActorSummary] = useState('');
  const [itemName, setItemName] = useState('');
  const [itemSummary, setItemSummary] = useState('');
  const [itemOwnerActorId, setItemOwnerActorId] = useState('');
  const [joinedActorName, setJoinedActorName] = useState('');
  const [joinedActorSummary, setJoinedActorSummary] = useState('');
  const [joinedItemName, setJoinedItemName] = useState('');
  const [joinedItemSummary, setJoinedItemSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState<RevisionConflict | null>(null);

  const displayed = historical ?? selected;
  const viewingRevision = historical?.campaign.revision ?? null;

  const loadCampaigns = useCallback(async () => {
    const result = await fetchJson<CampaignSummary[]>('/api/campaigns');
    setCampaigns(result);
    return result;
  }, []);

  const fetchCampaignSnapshot = useCallback(async (campaignId: string): Promise<CanonicalUpdate> => {
    const [document, entries] = await Promise.all([
      fetchJson<CampaignDocument>(`/api/campaigns/${encodeURIComponent(campaignId)}`),
      fetchJson<CampaignHistoryEntry[]>(`/api/campaigns/${encodeURIComponent(campaignId)}/history`),
    ]);
    return { document, history: entries };
  }, []);

  const openCampaign = useCallback(async (campaignId: string) => {
    const canonical = await fetchCampaignSnapshot(campaignId);
    setSelected(canonical.document);
    setHistorical(null);
    setHistory(canonical.history);
    setPendingCanonical(null);
    setConflict(null);
  }, [fetchCampaignSnapshot]);

  const openRevision = useCallback(async (campaignId: string, revision: number) => {
    const document = await fetchJson<CampaignDocument>(
      `/api/campaigns/${encodeURIComponent(campaignId)}?revision=${revision}`,
    );
    setHistorical(document);
    setMessage(`Reconstructed immutable revision ${revision}.`);
  }, []);

  useEffect(() => {
    loadCampaigns().catch(value => setError(value instanceof Error ? value.message : String(value)));
  }, [loadCampaigns]);

  useEffect(() => {
    if (!selected) {
      setSyncState('idle');
      return undefined;
    }
    const campaignId = selected.campaign.id;
    const afterRevision = selected.campaign.revision;
    const source = new EventSource(
      `/api/campaigns/${encodeURIComponent(campaignId)}/changes?afterRevision=${afterRevision}`,
    );
    let closed = false;
    let latestRevision = afterRevision;
    let debounce: number | undefined;

    source.onopen = () => {
      if (!closed && !pendingCanonical) setSyncState('live');
    };
    source.onerror = () => {
      if (!closed && !pendingCanonical) setSyncState('reconnecting');
    };
    const receiveInvalidation = (event: Event) => {
      const messageEvent = event as MessageEvent<string>;
      let value: unknown;
      try {
        value = JSON.parse(messageEvent.data);
      } catch {
        return;
      }
      if (!isCampaignInvalidation(value) || value.campaignId !== campaignId || value.revision <= afterRevision) return;
      latestRevision = Math.max(latestRevision, value.revision);
      if (debounce !== undefined) return;
      debounce = window.setTimeout(() => {
        debounce = undefined;
        void fetchCampaignSnapshot(campaignId).then(canonical => {
          if (closed || canonical.document.campaign.revision <= afterRevision) return;
          setPendingCanonical(canonical);
          setSyncState('update-ready');
          setMessage(`Canonical revision ${latestRevision} is available from another view. Local drafts were not overwritten.`);
        }).catch(() => {
          if (!closed) setSyncState('reconnecting');
        });
      }, 80);
    };
    source.addEventListener('campaign-revision', receiveInvalidation);

    return () => {
      closed = true;
      if (debounce !== undefined) window.clearTimeout(debounce);
      source.removeEventListener('campaign-revision', receiveInvalidation);
      source.close();
    };
  }, [fetchCampaignSnapshot, pendingCanonical, selected?.campaign.id, selected?.campaign.revision]);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await work();
    } catch (value) {
      const isRevisionConflict = value instanceof ApiProblem
        && value.problem?.code === 'CAMPAIGN_REVISION_CONFLICT';
      if (!isRevisionConflict) setError(value instanceof Error ? value.message : String(value));
    } finally {
      setBusy(false);
    }
  }

  function acceptCanonicalUpdate() {
    if (!pendingCanonical) return;
    setSelected(pendingCanonical.document);
    setHistory(pendingCanonical.history);
    setHistorical(null);
    setConflict(null);
    setPendingCanonical(null);
    setSyncState('live');
    setError('');
    setMessage(`Loaded canonical revision ${pendingCanonical.document.campaign.revision}.`);
  }

  async function createCampaign(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const commit = await fetchJson<CampaignCommit>('/api/campaigns', undefined, {
        method: 'POST',
        body: JSON.stringify({ requestId: newRequestId(), title: campaignTitle }),
      });
      const entries = await fetchJson<CampaignHistoryEntry[]>(`/api/campaigns/${encodeURIComponent(commit.campaignId)}/history`);
      setCampaignTitle('');
      setActiveCollection('actors');
      setSelected(commit.document);
      setHistorical(null);
      setHistory(entries);
      setPendingCanonical(null);
      setConflict(null);
      await loadCampaigns();
      setMessage(`Campaign persisted at revision ${commit.revision}.`);
    });
  }

  async function executeOperation(operation: CampaignOperation): Promise<void> {
    if (!selected || historical) return;
    const campaignId = selected.campaign.id;
    const expectedRevision = selected.campaign.revision;
    try {
      const commit = await fetchJson<CampaignCommit>(`/api/campaigns/${encodeURIComponent(campaignId)}/operations`, undefined, {
        method: 'POST',
        body: JSON.stringify({
          requestId: newRequestId(),
          expectedRevision,
          operation,
        }),
      });
      const [campaignList, entries] = await Promise.all([
        fetchJson<CampaignSummary[]>('/api/campaigns'),
        fetchJson<CampaignHistoryEntry[]>(`/api/campaigns/${encodeURIComponent(campaignId)}/history`),
      ]);
      setSelected(commit.document);
      setCampaigns(campaignList);
      setHistory(entries);
      setHistorical(null);
      setPendingCanonical(null);
      setConflict(null);
      setMessage(`Saved ${commit.operationKind} as revision ${commit.revision}.`);
    } catch (value) {
      const apiError = value instanceof ApiProblem ? value : null;
      const revisionConflict = conflictFrom(apiError?.problem ?? null, campaignId, expectedRevision);
      if (revisionConflict) {
        setConflict(revisionConflict);
        setError('The server rejected the stale edit before writing any Campaign state.');
      }
      throw value;
    }
  }

  async function createActor(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await executeOperation({ kind: 'create_actor', actor: { name: actorName, summary: actorSummary } });
      setActorName('');
      setActorSummary('');
    });
  }

  async function createItem(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await executeOperation({
        kind: 'create_item',
        item: {
          name: itemName,
          summary: itemSummary,
          ...(itemOwnerActorId ? { ownerActorId: itemOwnerActorId } : {}),
        },
      });
      setItemName('');
      setItemSummary('');
      setItemOwnerActorId('');
    });
  }

  async function createJoinedActorItem(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await executeOperation({
        kind: 'create_actor_with_item',
        actor: { name: joinedActorName, summary: joinedActorSummary },
        item: { name: joinedItemName, summary: joinedItemSummary },
      });
      setJoinedActorName('');
      setJoinedActorSummary('');
      setJoinedItemName('');
      setJoinedItemSummary('');
      setActiveCollection('items');
    });
  }

  const activeActors = displayed?.actors.filter(record => !record.archived) ?? [];
  const archivedActors = displayed?.actors.filter(record => record.archived) ?? [];
  const activeItems = displayed?.items.filter(record => !record.archived) ?? [];
  const archivedItems = displayed?.items.filter(record => record.archived) ?? [];

  return (
    <section className="authority-panel" aria-labelledby="campaign-authority">
      <div className="section-heading">
        <div>
          <h2 id="campaign-authority">Campaign Workspace</h2>
          <p>Edit Actors, Items, and the Current Scene without constructing Events or references manually.</p>
        </div>
        {displayed ? (
          <div className="workspace-state">
            <span className={historical ? 'revision-badge revision-badge--historical' : 'revision-badge'}>
              {historical ? 'Historical' : 'Current'} revision {displayed.campaign.revision}
            </span>
            <span className={`sync-state sync-state--${syncState}`} role="status">{syncLabel(syncState)}</span>
            <span className="pending-state" role="status">{busy ? 'Saving…' : historical ? 'Read-only' : 'Ready'}</span>
          </div>
        ) : null}
      </div>

      {pendingCanonical && selected ? (
        <div className="canonical-update-banner" role="status">
          <div>
            <strong>Canonical revision {pendingCanonical.document.campaign.revision} is ready.</strong>
            <p>The companion refetched current truth after another view committed. Your visible draft was left untouched.</p>
          </div>
          <button type="button" onClick={acceptCanonicalUpdate} disabled={busy}>Review canonical update</button>
        </div>
      ) : null}
      {conflict && selected ? (
        <RevisionConflictBanner
          conflict={conflict}
          busy={busy}
          onReload={() => {
            if (pendingCanonical) {
              acceptCanonicalUpdate();
              return;
            }
            void run(() => openCampaign(selected.campaign.id));
          }}
        />
      ) : null}
      {error ? <p className="error-banner" role="alert">{error}</p> : null}
      {message ? <p className="success-banner" role="status">{message}</p> : null}

      <div className="authority-layout">
        <aside className="campaign-list" aria-label="Campaigns">
          <form className="stack-form" onSubmit={createCampaign}>
            <label>
              <span>New Campaign title</span>
              <input value={campaignTitle} onChange={event => setCampaignTitle(event.target.value)} disabled={busy} />
            </label>
            <button type="submit" disabled={busy || !campaignTitle.trim()}>Create Campaign</button>
          </form>

          <div className="campaign-buttons">
            {campaigns.map(campaign => (
              <button
                type="button"
                className={selected?.campaign.id === campaign.id ? 'campaign-button campaign-button--active' : 'campaign-button'}
                key={campaign.id}
                onClick={() => { void run(() => openCampaign(campaign.id)); }}
                disabled={busy}
              >
                <strong>{campaign.title}</strong>
                <span>Revision {campaign.revision}</span>
              </button>
            ))}
            {campaigns.length === 0 ? <p className="empty-state">No companion Campaigns yet.</p> : null}
          </div>
        </aside>

        <div className="campaign-detail">
          {displayed && selected ? (
            <>
              <div className="campaign-title-row">
                <div>
                  <p className="eyebrow">{historical ? 'Immutable reconstruction' : 'SQLite authority'}</p>
                  <h3>{displayed.campaign.title}</h3>
                </div>
                <button type="button" onClick={() => { void run(() => openCampaign(selected.campaign.id)); }} disabled={busy}>
                  Reload current
                </button>
              </div>

              <CollectionNavigation active={activeCollection} document={displayed} onSelect={setActiveCollection} />

              {historical ? (
                <p className="historical-note">Historical revisions are read-only. Inspect any collection, then return to current truth before editing.</p>
              ) : null}

              {activeCollection === 'actors' ? (
                <section className="collection-view" aria-labelledby="actors-heading">
                  <div className="collection-heading">
                    <div>
                      <h4 id="actors-heading">Actors</h4>
                      <p>Identity and concise Campaign-facing context.</p>
                    </div>
                  </div>
                  {!historical ? (
                    <>
                      <form className="create-record-form" onSubmit={createActor}>
                        <label>
                          <span>Actor name</span>
                          <input value={actorName} onChange={event => setActorName(event.target.value)} disabled={busy} />
                        </label>
                        <label>
                          <span>Summary</span>
                          <textarea rows={3} value={actorSummary} onChange={event => setActorSummary(event.target.value)} disabled={busy} />
                        </label>
                        <button type="submit" disabled={busy || !actorName.trim()}>Create Actor</button>
                      </form>

                      <details className="joined-create-panel">
                        <summary>Create Actor with attached Item</summary>
                        <form className="joined-create-form" onSubmit={createJoinedActorItem}>
                          <fieldset>
                            <legend>Actor</legend>
                            <label>
                              <span>Name</span>
                              <input value={joinedActorName} onChange={event => setJoinedActorName(event.target.value)} disabled={busy} />
                            </label>
                            <label>
                              <span>Summary</span>
                              <textarea rows={3} value={joinedActorSummary} onChange={event => setJoinedActorSummary(event.target.value)} disabled={busy} />
                            </label>
                          </fieldset>
                          <fieldset>
                            <legend>Attached Item</legend>
                            <label>
                              <span>Name</span>
                              <input value={joinedItemName} onChange={event => setJoinedItemName(event.target.value)} disabled={busy} />
                            </label>
                            <label>
                              <span>Summary</span>
                              <textarea rows={3} value={joinedItemSummary} onChange={event => setJoinedItemSummary(event.target.value)} disabled={busy} />
                            </label>
                          </fieldset>
                          <button type="submit" disabled={busy || !joinedActorName.trim() || !joinedItemName.trim()}>
                            Create both in one revision
                          </button>
                        </form>
                      </details>
                    </>
                  ) : null}
                  <div className="record-list">
                    {activeActors.map(actor => (
                      <ActorEditor
                        actor={actor}
                        busy={busy}
                        readOnly={historical !== null}
                        onSave={(actorId, name, summary) => run(() => executeOperation({ kind: 'update_actor', actorId, name, summary }))}
                        onArchive={(actorId, archived) => run(() => executeOperation({ kind: 'set_actor_archived', actorId, archived }))}
                        key={actor.id}
                      />
                    ))}
                    {activeActors.length === 0 ? <p className="empty-state">No active Actors in this revision.</p> : null}
                  </div>
                  {archivedActors.length > 0 ? (
                    <details className="archive-panel">
                      <summary>Archived Actors ({archivedActors.length})</summary>
                      <div className="record-list">
                        {archivedActors.map(actor => (
                          <ActorEditor
                            actor={actor}
                            busy={busy}
                            readOnly={historical !== null}
                            onSave={(actorId, name, summary) => run(() => executeOperation({ kind: 'update_actor', actorId, name, summary }))}
                            onArchive={(actorId, archived) => run(() => executeOperation({ kind: 'set_actor_archived', actorId, archived }))}
                            key={actor.id}
                          />
                        ))}
                      </div>
                    </details>
                  ) : null}
                </section>
              ) : null}

              {activeCollection === 'items' ? (
                <section className="collection-view" aria-labelledby="items-heading">
                  <div className="collection-heading">
                    <div>
                      <h4 id="items-heading">Items</h4>
                      <p>Durable objects, concise descriptions, and optional Actor attachment.</p>
                    </div>
                  </div>
                  {!historical ? (
                    <form className="create-record-form" onSubmit={createItem}>
                      <label>
                        <span>Item name</span>
                        <input value={itemName} onChange={event => setItemName(event.target.value)} disabled={busy} />
                      </label>
                      <label>
                        <span>Summary</span>
                        <textarea rows={3} value={itemSummary} onChange={event => setItemSummary(event.target.value)} disabled={busy} />
                      </label>
                      <label>
                        <span>Attach to Actor</span>
                        <select value={itemOwnerActorId} onChange={event => setItemOwnerActorId(event.target.value)} disabled={busy}>
                          <option value="">Unattached</option>
                          {activeActors.map(actor => <option key={actor.id} value={actor.id}>{actor.name}</option>)}
                        </select>
                      </label>
                      <button type="submit" disabled={busy || !itemName.trim()}>Create Item</button>
                    </form>
                  ) : null}
                  <div className="record-list">
                    {activeItems.map(item => (
                      <ItemEditor
                        item={item}
                        actors={displayed.actors}
                        busy={busy}
                        readOnly={historical !== null}
                        onSave={(itemId, name, summary, ownerActorId) => run(() => executeOperation({
                          kind: 'update_item', itemId, name, summary, ownerActorId,
                        }))}
                        onArchive={(itemId, archived) => run(() => executeOperation({ kind: 'set_item_archived', itemId, archived }))}
                        key={item.id}
                      />
                    ))}
                    {activeItems.length === 0 ? <p className="empty-state">No active Items in this revision.</p> : null}
                  </div>
                  {archivedItems.length > 0 ? (
                    <details className="archive-panel">
                      <summary>Archived Items ({archivedItems.length})</summary>
                      <div className="record-list">
                        {archivedItems.map(item => (
                          <ItemEditor
                            item={item}
                            actors={displayed.actors}
                            busy={busy}
                            readOnly={historical !== null}
                            onSave={(itemId, name, summary, ownerActorId) => run(() => executeOperation({
                              kind: 'update_item', itemId, name, summary, ownerActorId,
                            }))}
                            onArchive={(itemId, archived) => run(() => executeOperation({ kind: 'set_item_archived', itemId, archived }))}
                            key={item.id}
                          />
                        ))}
                      </div>
                    </details>
                  ) : null}
                </section>
              ) : null}

              {activeCollection === 'scene' ? (
                <section className="collection-view" aria-labelledby="scene-heading">
                  <div className="collection-heading">
                    <div>
                      <h4 id="scene-heading">Current Scene</h4>
                      <p>One canonical scene record for the Campaign’s present moment.</p>
                    </div>
                  </div>
                  <SceneEditor
                    scene={displayed.currentScene}
                    busy={busy}
                    readOnly={historical !== null}
                    onSave={(name, summary) => run(() => executeOperation({ kind: 'set_current_scene', scene: { name, summary } }))}
                  />
                </section>
              ) : null}

              {activeCollection === 'history' ? (
                <section className="collection-view" aria-labelledby="history-heading">
                  <div className="collection-heading">
                    <div>
                      <h4 id="history-heading">Immutable History</h4>
                      <p>Open any accepted revision as a read-only Campaign document.</p>
                    </div>
                  </div>
                  <CampaignHistoryView
                    entries={history}
                    currentRevision={selected.campaign.revision}
                    viewingRevision={viewingRevision}
                    busy={busy}
                    expanded
                    onOpenRevision={revision => { void run(() => openRevision(selected.campaign.id, revision)); }}
                    onReturnCurrent={() => setHistorical(null)}
                  />
                </section>
              ) : null}
            </>
          ) : (
            <p className="empty-state">Create or open a Campaign to begin editing durable Campaign truth.</p>
          )}
        </div>
      </div>
    </section>
  );
}

export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot>({ health: null, readiness: null, loading: true, error: '' });

  const refresh = useCallback(() => {
    const controller = new AbortController();
    setSnapshot(previous => ({ ...previous, loading: true, error: '' }));
    Promise.all([
      fetchJson<HealthDocument>('/health', controller.signal),
      fetchJson<ReadinessDocument>('/ready', controller.signal),
    ]).then(([health, readiness]) => {
      setSnapshot({ health, readiness, loading: false, error: '' });
    }).catch(value => {
      setSnapshot(previous => ({
        ...previous,
        loading: false,
        error: `Status check failed: ${value instanceof Error ? value.message : String(value)}`,
      }));
    });
    return () => controller.abort();
  }, []);

  useEffect(() => refresh(), [refresh]);
  return (
    <CampaignBookView snapshot={snapshot} onRefresh={() => { refresh(); }}>
      <CampaignAuthorityPanel />
    </CampaignBookView>
  );
}
