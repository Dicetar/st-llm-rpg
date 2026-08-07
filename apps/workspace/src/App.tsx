import { type ReactNode, useCallback, useEffect, useState } from 'react';
import type {
  HealthDocument,
  ReadinessDocument,
} from '@st-llm-rpg/wire';
import CampaignWorkspace from './CampaignWorkspace.js';
import { buildStatusCards } from './status-model.js';

export {
  CampaignHistoryView,
  RevisionConflictBanner,
  parseWorkspacePath,
} from './CampaignWorkspace.js';

type Snapshot = Readonly<{
  health: HealthDocument | null;
  readiness: ReadinessDocument | null;
  loading: boolean;
  error: string;
}>;

async function fetchJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    ...(signal === undefined ? {} : { signal }),
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return response.json() as Promise<T>;
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
          <p className="lede">Edit durable Campaign truth through routed collections while SillyTavern remains available as the independent fallback.</p>
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
      <CampaignWorkspace />
    </CampaignBookView>
  );
}
