import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from 'react';
import type {
  CampaignActor,
  CampaignCommit,
  CampaignDocument,
  CampaignHistoryEntry,
  CampaignSummary,
  HealthDocument,
  Problem,
  ReadinessDocument,
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
          <p className="eyebrow">Local companion · durable Campaign milestone</p>
          <h1>Campaign Book</h1>
          <p className="lede">Campaign truth now lives in the companion-owned SQLite journal. The existing SillyTavern extension remains available as the fallback.</p>
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
      <button type="button" onClick={props.onReload} disabled={props.busy}>Reload latest Campaign</button>
    </div>
  );
}

export function CampaignHistoryView(props: {
  entries: readonly CampaignHistoryEntry[];
  currentRevision: number;
  viewingRevision: number | null;
  busy: boolean;
  onOpenRevision: (revision: number) => void;
  onReturnCurrent: () => void;
}) {
  return (
    <details className="history-panel" open={props.viewingRevision !== null}>
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

function ActorEditor(props: {
  actor: CampaignActor;
  busy: boolean;
  readOnly: boolean;
  onRename: (actorId: string, name: string) => Promise<void>;
}) {
  const [name, setName] = useState(props.actor.name);
  useEffect(() => setName(props.actor.name), [props.actor.name]);
  return (
    <form className="record-row" onSubmit={event => {
      event.preventDefault();
      void props.onRename(props.actor.id, name);
    }}>
      <label>
        <span>Actor name</span>
        <input value={name} onChange={event => setName(event.target.value)} disabled={props.busy || props.readOnly} />
      </label>
      <button type="submit" disabled={props.busy || props.readOnly || name.trim() === props.actor.name}>Save actor</button>
    </form>
  );
}

function CampaignAuthorityPanel() {
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [selected, setSelected] = useState<CampaignDocument | null>(null);
  const [historical, setHistorical] = useState<CampaignDocument | null>(null);
  const [history, setHistory] = useState<CampaignHistoryEntry[]>([]);
  const [campaignTitle, setCampaignTitle] = useState('');
  const [actorName, setActorName] = useState('');
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

  const openCampaign = useCallback(async (campaignId: string) => {
    const [document, entries] = await Promise.all([
      fetchJson<CampaignDocument>(`/api/campaigns/${encodeURIComponent(campaignId)}`),
      fetchJson<CampaignHistoryEntry[]>(`/api/campaigns/${encodeURIComponent(campaignId)}/history`),
    ]);
    setSelected(document);
    setHistorical(null);
    setHistory(entries);
    setConflict(null);
  }, []);

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

  async function createCampaign(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const commit = await fetchJson<CampaignCommit>('/api/campaigns', undefined, {
        method: 'POST',
        body: JSON.stringify({ requestId: newRequestId(), title: campaignTitle }),
      });
      setCampaignTitle('');
      await Promise.all([loadCampaigns(), openCampaign(commit.campaignId)]);
      setMessage(`Campaign persisted at revision ${commit.revision}.`);
    });
  }

  async function executeActor(operation: unknown) {
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
      setSelected(commit.document);
      setConflict(null);
      await Promise.all([loadCampaigns(), openCampaign(campaignId)]);
      setMessage(`Accepted ${commit.operationKind} as revision ${commit.revision}.`);
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
      await executeActor({ kind: 'create_actor', actor: { name: actorName } });
      setActorName('');
    });
  }

  async function renameActor(actorId: string, name: string) {
    await run(() => executeActor({ kind: 'rename_actor', actorId, name }));
  }

  return (
    <section className="authority-panel" aria-labelledby="campaign-authority">
      <div className="section-heading">
        <div>
          <h2 id="campaign-authority">Durable Campaign</h2>
          <p>Create one Campaign, edit an Actor, open an old revision, and prove stale tabs cannot overwrite newer truth.</p>
        </div>
        {displayed ? (
          <span className={historical ? 'revision-badge revision-badge--historical' : 'revision-badge'}>
            {historical ? 'Historical' : 'Current'} revision {displayed.campaign.revision}
          </span>
        ) : null}
      </div>

      {conflict && selected ? (
        <RevisionConflictBanner
          conflict={conflict}
          busy={busy}
          onReload={() => { void run(() => openCampaign(selected.campaign.id)); }}
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
            <button type="submit" disabled={busy || !campaignTitle.trim()}>Create durable Campaign</button>
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

              {historical ? (
                <p className="historical-note">Historical revisions are read-only. Return to the current revision before editing.</p>
              ) : (
                <form className="stack-form" onSubmit={createActor}>
                  <label>
                    <span>Add Actor</span>
                    <input value={actorName} onChange={event => setActorName(event.target.value)} disabled={busy} />
                  </label>
                  <button type="submit" disabled={busy || !actorName.trim()}>Add Actor as one revision</button>
                </form>
              )}

              <div className="record-list">
                {displayed.actors.map(actor => (
                  <ActorEditor actor={actor} busy={busy} readOnly={historical !== null} onRename={renameActor} key={actor.id} />
                ))}
                {displayed.actors.length === 0 ? <p className="empty-state">No Actors in this revision.</p> : null}
              </div>

              <CampaignHistoryView
                entries={history}
                currentRevision={selected.campaign.revision}
                viewingRevision={viewingRevision}
                busy={busy}
                onOpenRevision={revision => { void run(() => openRevision(selected.campaign.id, revision)); }}
                onReturnCurrent={() => setHistorical(null)}
              />
            </>
          ) : (
            <p className="empty-state">Create or open a Campaign to start the durable persistence proof.</p>
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
