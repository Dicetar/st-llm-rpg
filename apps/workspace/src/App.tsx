import { useCallback, useEffect, useState } from 'react';
import type { HealthDocument, ReadinessDocument } from '@st-llm-rpg/wire';
import { buildStatusCards } from './status-model.js';

type Snapshot = Readonly<{
  health: HealthDocument | null;
  readiness: ReadinessDocument | null;
  loading: boolean;
  error: string;
}>;

async function fetchJson<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal, headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

export function CampaignBookView(props: {
  snapshot: Snapshot;
  onRefresh: () => void;
}) {
  const cards = buildStatusCards(props.snapshot.readiness);
  return (
    <main className="book-shell">
      <header className="book-header">
        <div>
          <p className="eyebrow">Local companion · tracer #32</p>
          <h1>Campaign Book</h1>
          <p className="lede">The production companion host is online beside the working SillyTavern fallback. Campaign editing arrives in the next tracer.</p>
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

      <section className="next-step" aria-labelledby="next-step">
        <h2 id="next-step">What works in this slice</h2>
        <p>Health, readiness, runtime contracts, degraded dependency reporting, static Workspace delivery, and the SillyTavern bridge entry point are active. No Campaign database or narrator routing is claimed yet.</p>
      </section>
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
    }).catch(error => {
      setSnapshot(previous => ({
        ...previous,
        loading: false,
        error: `Status check failed: ${error instanceof Error ? error.message : String(error)}`,
      }));
    });
    return () => controller.abort();
  }, []);

  useEffect(() => refresh(), [refresh]);
  return <CampaignBookView snapshot={snapshot} onRefresh={() => { refresh(); }} />;
}
