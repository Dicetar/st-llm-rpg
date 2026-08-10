import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import type {
  HealthDocument,
  NarrationStatusDocument,
  ReadinessDocument,
} from '@st-llm-rpg/wire';
import CampaignWorkspace from './CampaignWorkspace.js';
import { NarrationStatusPanel } from './NarrationStatusPanel.js';
import { BackupPanel } from './BackupPanel.js';
import { buildStatusCards } from './status-model.js';

export {
  CampaignCommandDeck,
  CampaignHistoryView,
  RecordEditor,
  SceneEditor,
  RevisionConflictBanner,
  WorkspaceRouteState,
  parseWorkspacePath,
} from './CampaignWorkspace.js';
export { ChatBindingsPanel, LegacyImportPreviewCard } from './LegacyImportPanel.js';
export { ContextTray } from './ContextTray.js';
export { NarrationStatusPanel } from './NarrationStatusPanel.js';
export { StorySyncReviewInbox, StorySyncReviewInboxView } from './StorySyncReviewInbox.js';
export { BackupPanel, BackupPanelView } from './BackupPanel.js';

type Snapshot = Readonly<{
  health: HealthDocument | null;
  readiness: ReadinessDocument | null;
  loading: boolean;
  error: string;
}>;

type NarrationSnapshot = Readonly<{
  document: NarrationStatusDocument | null;
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
  narration?: NarrationSnapshot;
  onRefreshNarration?: () => void;
  children?: ReactNode;
}) {
  const cards = buildStatusCards(props.snapshot.readiness);
  const statusExpanded = props.snapshot.loading
    || Boolean(props.snapshot.error)
    || props.snapshot.readiness?.status !== 'ready';
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

      <details className="system-status" open={statusExpanded}>
        <summary>
          <div className="section-heading">
            <h2 id="system-status">System status</h2>
            <p>{props.snapshot.health ? `Companion alive · ${Math.round(props.snapshot.health.uptimeMs / 1000)}s uptime` : 'Waiting for companion health…'}</p>
          </div>
          <span>{props.snapshot.readiness?.status ?? 'checking'}</span>
        </summary>
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
      </details>

      {props.narration ? (
        <NarrationStatusPanel
          document={props.narration.document}
          loading={props.narration.loading}
          error={props.narration.error}
          onRefresh={props.onRefreshNarration ?? (() => undefined)}
        />
      ) : null}

      {props.children}
    </main>
  );
}

export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot>({ health: null, readiness: null, loading: true, error: '' });
  const [narration, setNarration] = useState<NarrationSnapshot>({ document: null, loading: true, error: '' });
  const narrationRequest = useRef(0);

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

  const refreshNarration = useCallback((signal?: AbortSignal, foreground = false) => {
    const request = ++narrationRequest.current;
    if (foreground) setNarration(previous => ({ ...previous, loading: true, error: '' }));
    fetchJson<NarrationStatusDocument>('/api/narration/status', signal).then(document => {
      if (request !== narrationRequest.current) return;
      setNarration({ document, loading: false, error: '' });
    }).catch(value => {
      if (signal?.aborted || request !== narrationRequest.current) return;
      setNarration(previous => ({
        ...previous,
        loading: false,
        error: value instanceof Error ? value.message : String(value),
      }));
    });
  }, []);

  useEffect(() => refresh(), [refresh]);
  useEffect(() => {
    let controller = new AbortController();
    const poll = () => {
      controller.abort();
      controller = new AbortController();
      refreshNarration(controller.signal);
    };
    poll();
    const interval = window.setInterval(poll, 4_000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [refreshNarration]);
  return (
    <CampaignBookView
      snapshot={snapshot}
      onRefresh={() => { refresh(); }}
      narration={narration}
      onRefreshNarration={() => { refreshNarration(undefined, true); }}
    >
      <BackupPanel />
      <CampaignWorkspace />
    </CampaignBookView>
  );
}
