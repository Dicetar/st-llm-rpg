import type { CampaignDocument, CampaignHistoryEntry } from '@st-llm-rpg/wire';
import type { ChatBindingDocument } from '@st-llm-rpg/wire';
import type { RevisionConflict } from './workspace-api.js';
import {
  type CollectionKey,
  type WorkspaceRoute,
  workspaceHref,
} from './workspace-navigation.js';

export type WorkspaceSyncState = 'idle' | 'live' | 'reconnecting' | 'update-ready';

export function syncLabel(state: WorkspaceSyncState): string {
  if (state === 'live') return 'Live updates';
  if (state === 'reconnecting') return 'Reconnecting';
  if (state === 'update-ready') return 'Update available';
  return 'Not connected';
}

export function RevisionConflictBanner(props: {
  conflict: RevisionConflict;
  busy: boolean;
  onReload: () => void;
  onStay: () => void;
}) {
  const actual = props.conflict.actualRevision === null
    ? 'a newer revision'
    : `revision ${props.conflict.actualRevision}`;
  return (
    <div className="conflict-banner" role="alert">
      <div>
        <strong>This tab is out of date.</strong>
        <p>Your edit expected revision {props.conflict.expectedRevision}, but the Campaign is now at {actual}. Nothing was written. Your draft is still here.</p>
      </div>
      <div className="conflict-actions">
        <button type="button" onClick={props.onReload} disabled={props.busy}>Keep draft and load latest</button>
        <button type="button" className="button-secondary" onClick={props.onStay} disabled={props.busy}>Stay on this draft</button>
      </div>
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
      <summary>Accepted changes ({props.entries.length})</summary>
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
              <span>{entry.operationKind.replaceAll('_', ' ')}</span>
            </button>
          </li>
        ))}
      </ol>
    </details>
  );
}

export function CampaignCommandDeck(props: {
  campaignId: string;
  revision: number;
  hasCurrentScene: boolean;
  busy: boolean;
  readOnly: boolean;
  onNavigate: (collection: CollectionKey) => void;
}) {
  const actions: ReadonlyArray<Readonly<{
    collection: CollectionKey;
    label: string;
    description: string;
    mutationEntry: boolean;
  }>> = [
    { collection: 'actors', label: 'Add Actor', description: 'Create a persistent character.', mutationEntry: true },
    { collection: 'items', label: 'Add Item', description: 'Create or attach an object.', mutationEntry: true },
    { collection: 'abilities', label: 'Add Ability', description: 'Create a spell, skill, feat, or other capability.', mutationEntry: true },
    { collection: 'relationships', label: 'Add Relationship', description: 'Connect two Actors and describe their current bond.', mutationEntry: true },
    { collection: 'facts', label: 'Add Fact', description: 'Record a lasting truth about the Campaign.', mutationEntry: true },
    { collection: 'world-objects', label: 'Add Scene Feature', description: 'Create a persistent feature attached to a Place.', mutationEntry: true },
    {
      collection: 'scene',
      label: props.hasCurrentScene ? 'Open / Advance Scene' : 'Start Scene',
      description: props.hasCurrentScene ? 'Edit the present or close it into Past Scenes.' : 'Establish the present moment.',
      mutationEntry: false,
    },
    { collection: 'history', label: 'Review Changes', description: 'Open prior read-only revisions.', mutationEntry: false },
  ];

  return (
    <section className="command-deck" aria-labelledby="command-deck-heading">
      <div className="command-deck__heading">
        <div>
          <p className="eyebrow">Next move</p>
          <h4 id="command-deck-heading">Quick Actions</h4>
        </div>
        <span>Revision {props.revision}</span>
      </div>
      <div className="command-deck__actions">
        {actions.map(action => {
          const disabled = props.busy || (props.readOnly && action.mutationEntry);
          const route: WorkspaceRoute = {
            campaignId: props.campaignId,
            collection: action.collection,
            recordId: null,
            revision: props.readOnly ? props.revision : null,
          };
          return (
            <a
              key={action.collection}
              href={workspaceHref(route)}
              className={disabled ? 'command-card command-card--disabled' : 'command-card'}
              aria-disabled={disabled || undefined}
              onClick={event => {
                event.preventDefault();
                if (!disabled) props.onNavigate(action.collection);
              }}
            >
              <strong>{action.label}</strong>
              <span>{action.description}</span>
            </a>
          );
        })}
      </div>
    </section>
  );
}

export function WorkspaceRouteState(props: {
  phase: 'loading' | 'error';
  title: string;
  message?: string;
  onRetry?: () => void;
}) {
  const loading = props.phase === 'loading';
  return (
    <section
      className={`route-state route-state--${props.phase}`}
      aria-busy={loading}
      aria-live="polite"
      role={loading ? 'status' : 'alert'}
    >
      <p className="eyebrow">{loading ? 'Opening Campaign' : 'Campaign unavailable'}</p>
      <h3>{props.title}</h3>
      <p>{props.message ?? 'Reading the saved Campaign from the Companion.'}</p>
      {!loading && props.onRetry ? (
        <button type="button" onClick={props.onRetry}>Try again</button>
      ) : null}
    </section>
  );
}

export function CollectionNavigation(props: {
  route: WorkspaceRoute;
  document: CampaignDocument;
  bindings: readonly ChatBindingDocument[];
  onNavigate: (route: WorkspaceRoute) => void;
}) {
  const entries: ReadonlyArray<Readonly<{ key: CollectionKey; label: string; count?: number }>> = [
    { key: 'home', label: 'Session Home' },
    { key: 'actors', label: 'Actors', count: props.document.actors.filter(record => !record.archived).length },
    { key: 'items', label: 'Items', count: props.document.items.filter(record => !record.archived).length },
    { key: 'quests', label: 'Quests', count: props.document.quests.filter(record => !record.archived).length },
    { key: 'places', label: 'Places', count: props.document.places.filter(record => !record.archived).length },
    { key: 'facts', label: 'Facts', count: (props.document.facts ?? []).filter(record => !record.archived).length },
    { key: 'world-objects', label: 'Scene Features', count: (props.document.worldObjects ?? []).filter(record => !record.archived).length },
    { key: 'abilities', label: 'Abilities', count: (props.document.abilities ?? []).filter(record => !record.archived).length },
    { key: 'relationships', label: 'Relationships', count: (props.document.relationships ?? []).filter(record => !record.archived).length },
    { key: 'scene', label: 'Current Scene', count: props.document.currentScene ? 1 : 0 },
    { key: 'review', label: 'Story Updates' },
    { key: 'context', label: 'Narrator Context', count: props.bindings.reduce((total, binding) => total + (binding.pins?.length ?? 0), 0) },
    { key: 'guide', label: 'Player Handbook' },
    { key: 'history', label: 'Change History' },
  ];
  return (
    <nav className="collection-nav" aria-label="Campaign sections">
      {entries.map(entry => {
        const next: WorkspaceRoute = {
          campaignId: props.route.campaignId,
          collection: entry.key,
          recordId: null,
          revision: props.route.revision,
        };
        return (
          <a
            href={workspaceHref(next)}
            key={entry.key}
            className={props.route.collection === entry.key ? 'collection-tab collection-tab--active' : 'collection-tab'}
            aria-current={props.route.collection === entry.key ? 'page' : undefined}
            onClick={event => {
              event.preventDefault();
              props.onNavigate(next);
            }}
          >
            <span>{entry.label}</span>
            {entry.count === undefined ? null : <strong>{entry.count}</strong>}
          </a>
        );
      })}
    </nav>
  );
}
