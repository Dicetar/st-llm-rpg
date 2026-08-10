import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  isCampaignInvalidation,
  type CampaignActor,
  type CampaignCommit,
  type CampaignDocument,
  type CampaignHistoryEntry,
  type CampaignItem,
  type CampaignOperation,
  type CampaignPlace,
  type CampaignQuest,
  type CampaignQuestStatus,
  type CampaignScene,
  type CampaignSummary,
  type NarratorVisibility,
  type Problem,
} from '@st-llm-rpg/wire';
import type { ChatBindingDocument } from '@st-llm-rpg/wire';
import LegacyImportPanel, { ChatBindingsPanel } from './LegacyImportPanel.js';
import { ContextTray } from './ContextTray.js';
import { createUuid } from './browser-uuid.js';
import { StorySyncReviewInbox } from './StorySyncReviewInbox.js';

export type CollectionKey = 'actors' | 'items' | 'quests' | 'places' | 'scene' | 'review' | 'context' | 'history';

type WorkspaceRoute = Readonly<{
  campaignId: string | null;
  collection: CollectionKey;
  recordId: string | null;
  revision: number | null;
}>;

type RevisionConflict = Readonly<{
  campaignId: string;
  expectedRevision: number;
  actualRevision: number | null;
}>;

type SyncState = 'idle' | 'live' | 'reconnecting' | 'update-ready';
type RouteLoadState =
  | Readonly<{ phase: 'idle' }>
  | Readonly<{ phase: 'loading'; title: string }>
  | Readonly<{ phase: 'error'; title: string; message: string }>;
type CanonicalUpdate = Readonly<{
  document: CampaignDocument;
  history: CampaignHistoryEntry[];
}>;
type EditorDraft = Readonly<{
  name: string;
  summary: string;
  aliases: readonly string[];
  visibility: NarratorVisibility;
  ownerActorId: string;
  status: CampaignQuestStatus;
}>;

type CommonRecord = Readonly<{
  id: string;
  name: string;
  summary: string;
  archived: boolean;
}>;

const COLLECTION_KEYS: readonly CollectionKey[] = [
  'actors',
  'items',
  'quests',
  'places',
  'scene',
  'review',
  'context',
  'history',
];

class ApiProblem extends Error {
  readonly problem: Problem | null;

  constructor(message: string, problem: Problem | null) {
    super(message);
    this.name = 'ApiProblem';
    this.problem = problem;
  }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isCollectionKey(value: string | undefined): value is CollectionKey {
  return value !== undefined && COLLECTION_KEYS.includes(value as CollectionKey);
}

export function parseWorkspacePath(pathname: string, search = ''): WorkspaceRoute {
  const parts = pathname.split('/').filter(Boolean).map(safeDecode);
  const campaignId = parts[0] === 'campaigns' && parts[1] ? parts[1] : null;
  const collection = isCollectionKey(parts[2]) ? parts[2] : 'actors';
  const recordId = campaignId && parts[3] ? parts[3] : null;
  const revisionValue = new URLSearchParams(search).get('revision');
  const parsedRevision = revisionValue === null ? null : Number(revisionValue);
  const revision = parsedRevision !== null && Number.isInteger(parsedRevision) && parsedRevision >= 1
    ? parsedRevision
    : null;
  return { campaignId, collection, recordId, revision };
}

function workspaceHref(route: WorkspaceRoute): string {
  if (!route.campaignId) return '/';
  const parts = [
    'campaigns',
    encodeURIComponent(route.campaignId),
    route.collection,
    ...(route.recordId ? [encodeURIComponent(route.recordId)] : []),
  ];
  const query = route.revision === null ? '' : `?revision=${route.revision}`;
  return `/${parts.join('/')}${query}`;
}

function currentWorkspaceRoute(): WorkspaceRoute {
  return parseWorkspacePath(window.location.pathname, window.location.search);
}

function useWorkspaceRoute(): readonly [WorkspaceRoute, (route: WorkspaceRoute, replace?: boolean) => void] {
  const [route, setRoute] = useState<WorkspaceRoute>(currentWorkspaceRoute);

  useEffect(() => {
    const onPopState = () => setRoute(currentWorkspaceRoute());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((next: WorkspaceRoute, replace = false) => {
    const href = workspaceHref(next);
    if (replace) window.history.replaceState(null, '', href);
    else window.history.pushState(null, '', href);
    setRoute(next);
  }, []);

  return [route, navigate] as const;
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
  return createUuid();
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

function sameDraft(left: EditorDraft, right: EditorDraft): boolean {
  return left.name.trim() === right.name
    && left.summary.trim() === right.summary
    && left.aliases.map(value => value.trim()).join('\u0000') === right.aliases.map(value => value.trim()).join('\u0000')
    && left.visibility === right.visibility
    && left.ownerActorId === right.ownerActorId
    && left.status === right.status;
}

function collectionLabel(collection: CollectionKey): string {
  if (collection === 'actors') return 'Actors';
  if (collection === 'items') return 'Items';
  if (collection === 'quests') return 'Quests';
  if (collection === 'places') return 'Places';
  if (collection === 'scene') return 'Current Scene';
  if (collection === 'context') return 'Context Tray';
  return 'History';
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
        <strong>This tab is stale.</strong>
        <p>Your edit expected revision {props.conflict.expectedRevision}, but the Campaign is now at {actual}. Nothing was written. Your draft is still here.</p>
      </div>
      <div className="conflict-actions">
        <button type="button" onClick={props.onReload} disabled={props.busy}>Keep draft and load canonical</button>
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
    {
      collection: 'scene',
      label: props.hasCurrentScene ? 'Open Scene' : 'Start Scene',
      description: props.hasCurrentScene ? 'Edit the present moment.' : 'Establish the present moment.',
      mutationEntry: false,
    },
    { collection: 'history', label: 'Inspect History', description: 'Open immutable revisions.', mutationEntry: false },
  ];

  return (
    <section className="command-deck" aria-labelledby="command-deck-heading">
      <div className="command-deck__heading">
        <div>
          <p className="eyebrow">Next move</p>
          <h4 id="command-deck-heading">Command Deck</h4>
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
      <p className="eyebrow">{loading ? 'Opening route' : 'Route unavailable'}</p>
      <h3>{props.title}</h3>
      <p>{props.message ?? 'Reading canonical Campaign truth from the companion.'}</p>
      {!loading && props.onRetry ? (
        <button type="button" onClick={props.onRetry}>Retry route</button>
      ) : null}
    </section>
  );
}

function CollectionNavigation(props: {
  route: WorkspaceRoute;
  document: CampaignDocument;
  bindings: readonly ChatBindingDocument[];
  onNavigate: (route: WorkspaceRoute) => void;
}) {
  const entries: ReadonlyArray<Readonly<{ key: CollectionKey; label: string; count?: number }>> = [
    { key: 'actors', label: 'Actors', count: props.document.actors.filter(record => !record.archived).length },
    { key: 'items', label: 'Items', count: props.document.items.filter(record => !record.archived).length },
    { key: 'quests', label: 'Quests', count: props.document.quests.filter(record => !record.archived).length },
    { key: 'places', label: 'Places', count: props.document.places.filter(record => !record.archived).length },
    { key: 'scene', label: 'Current Scene', count: props.document.currentScene ? 1 : 0 },
    { key: 'review', label: 'Review Inbox' },
    { key: 'context', label: 'Context Tray', count: props.bindings.reduce((total, binding) => total + (binding.pins?.length ?? 0), 0) },
    { key: 'history', label: 'History' },
  ];
  return (
    <nav className="collection-nav" aria-label="Campaign collections">
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

type RecordEditorProps =
  | Readonly<{
      kind: 'actor';
      record: CampaignActor;
      actors: readonly CampaignActor[];
      busy: boolean;
      readOnly: boolean;
      onSave: (id: string, name: string, summary: string, aliases: readonly string[], visibility: NarratorVisibility) => Promise<void>;
      onArchive: (id: string, archived: boolean) => Promise<void>;
    }>
  | Readonly<{
      kind: 'item';
      record: CampaignItem;
      actors: readonly CampaignActor[];
      busy: boolean;
      readOnly: boolean;
      onSave: (id: string, name: string, summary: string, aliases: readonly string[], visibility: NarratorVisibility, ownerActorId: string | null) => Promise<void>;
      onArchive: (id: string, archived: boolean) => Promise<void>;
    }>
  | Readonly<{
      kind: 'quest';
      record: CampaignQuest;
      actors: readonly CampaignActor[];
      busy: boolean;
      readOnly: boolean;
      onSave: (id: string, name: string, summary: string, aliases: readonly string[], visibility: NarratorVisibility, status: CampaignQuestStatus) => Promise<void>;
      onArchive: (id: string, archived: boolean) => Promise<void>;
    }>
  | Readonly<{
      kind: 'place';
      record: CampaignPlace;
      actors: readonly CampaignActor[];
      busy: boolean;
      readOnly: boolean;
      onSave: (id: string, name: string, summary: string, aliases: readonly string[], visibility: NarratorVisibility) => Promise<void>;
      onArchive: (id: string, archived: boolean) => Promise<void>;
    }>;

function canonicalDraft(props: RecordEditorProps): EditorDraft {
  return {
    name: props.record.name,
    summary: props.record.summary,
    aliases: props.record.aliases ?? [],
    visibility: props.record.visibility ?? 'known',
    ownerActorId: props.kind === 'item' ? props.record.ownerActorId ?? '' : '',
    status: props.kind === 'quest' ? props.record.status : 'active',
  };
}

function editorLabel(kind: RecordEditorProps['kind']): string {
  if (kind === 'actor') return 'Actor';
  if (kind === 'item') return 'Item';
  if (kind === 'quest') return 'Quest';
  return 'Place';
}

export function RecordEditor(props: RecordEditorProps) {
  const initial = canonicalDraft(props);
  const [draft, setDraft] = useState<EditorDraft>(initial);
  const [baseline, setBaseline] = useState<EditorDraft>(initial);
  const ownerActorId = props.kind === 'item' ? props.record.ownerActorId ?? '' : '';
  const questStatus = props.kind === 'quest' ? props.record.status : 'active';
  const aliasesKey = (props.record.aliases ?? []).join('\u0000');
  const visibility = props.record.visibility ?? 'known';
  const dirty = !sameDraft(draft, baseline);

  useEffect(() => {
    const next = canonicalDraft(props);
    const wasDirty = !sameDraft(draft, baseline);
    setBaseline(next);
    if (!wasDirty) setDraft(next);
  }, [props.kind, props.record.id, props.record.name, props.record.summary, props.record.archived, aliasesKey, visibility, ownerActorId, questStatus]);

  const label = editorLabel(props.kind);
  return (
    <form className={props.record.archived ? 'record-card record-card--archived' : 'record-card'} onSubmit={event => {
      event.preventDefault();
      const aliases = draft.aliases.map(value => value.trim()).filter(Boolean);
      if (props.kind === 'actor' || props.kind === 'place') {
        void props.onSave(props.record.id, draft.name, draft.summary, aliases, draft.visibility);
      } else if (props.kind === 'item') {
        void props.onSave(props.record.id, draft.name, draft.summary, aliases, draft.visibility, draft.ownerActorId || null);
      } else {
        void props.onSave(props.record.id, draft.name, draft.summary, aliases, draft.visibility, draft.status);
      }
    }}>
      <div className="record-card__heading">
        <strong>{props.record.archived ? `Archived ${label}` : label}</strong>
        <span>{props.record.id}</span>
      </div>
      <label>
        <span>Name</span>
        <input
          value={draft.name}
          onChange={event => setDraft(previous => ({ ...previous, name: event.target.value }))}
          disabled={props.busy || props.readOnly}
        />
      </label>
      <fieldset className="alias-editor">
        <legend>Aliases</legend>
        {draft.aliases.length === 0 ? <p className="empty-state">No alternate names.</p> : null}
        {draft.aliases.map((alias, index) => (
          <div className="alias-row" key={`${index}-${alias}`}>
            <label>
              <span>Alias {index + 1}</span>
              <input
                value={alias}
                onChange={event => setDraft(previous => ({
                  ...previous,
                  aliases: previous.aliases.map((value, candidate) => candidate === index ? event.target.value : value),
                }))}
                disabled={props.busy || props.readOnly}
              />
            </label>
            <button
              type="button"
              className="button-secondary"
              onClick={() => setDraft(previous => ({ ...previous, aliases: previous.aliases.filter((_value, candidate) => candidate !== index) }))}
              disabled={props.busy || props.readOnly}
              aria-label={`Remove alias ${index + 1}`}
            >Remove</button>
          </div>
        ))}
        <button
          type="button"
          className="button-secondary"
          onClick={() => setDraft(previous => ({ ...previous, aliases: [...previous.aliases, ''] }))}
          disabled={props.busy || props.readOnly || draft.aliases.length >= 32}
        >+ Add alias</button>
      </fieldset>
      <label>
        <span>Narrator Visibility</span>
        <select
          value={draft.visibility}
          onChange={event => setDraft(previous => ({ ...previous, visibility: event.target.value as NarratorVisibility }))}
          disabled={props.busy || props.readOnly}
        >
          <option value="known">Known · may be used and revealed</option>
          <option value="narrator_secret">Narrator Secret · use silently</option>
          <option value="campaign_private">Campaign Private · never sent</option>
        </select>
      </label>
      <label>
        <span>Summary</span>
        <textarea
          rows={6}
          value={draft.summary}
          onChange={event => setDraft(previous => ({ ...previous, summary: event.target.value }))}
          disabled={props.busy || props.readOnly}
        />
      </label>
      {props.kind === 'item' ? (
        <label>
          <span>Attached Actor</span>
          <select
            value={draft.ownerActorId}
            onChange={event => setDraft(previous => ({ ...previous, ownerActorId: event.target.value }))}
            disabled={props.busy || props.readOnly}
          >
            <option value="">Unattached</option>
            {props.actors.map(actor => (
              <option key={actor.id} value={actor.id} disabled={actor.archived && actor.id !== props.record.ownerActorId}>
                {actor.name}{actor.archived ? ' · archived' : ''}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {props.kind === 'quest' ? (
        <label>
          <span>Status</span>
          <select
            value={draft.status}
            onChange={event => setDraft(previous => ({
              ...previous,
              status: event.target.value as CampaignQuestStatus,
            }))}
            disabled={props.busy || props.readOnly}
          >
            <option value="active">Active</option>
            <option value="completed">Completed</option>
          </select>
        </label>
      ) : null}
      <div className="record-actions">
        <button type="submit" disabled={props.busy || props.readOnly || !draft.name.trim() || !dirty}>
          Save {label}
        </button>
        <button
          type="button"
          className="button-secondary"
          disabled={props.busy || props.readOnly}
          onClick={() => { void props.onArchive(props.record.id, !props.record.archived); }}
        >
          {props.record.archived ? `Restore ${label}` : `Archive ${label}`}
        </button>
      </div>
    </form>
  );
}

type SceneDraft = Readonly<{
  name: string;
  summary: string;
  placeId: string;
  actorIds: readonly string[];
  itemIds: readonly string[];
}>;

function sceneDraft(scene: CampaignScene | null): SceneDraft {
  return {
    name: scene?.name ?? '',
    summary: scene?.summary ?? '',
    placeId: scene?.placeId ?? '',
    actorIds: scene?.actorIds ?? [],
    itemIds: scene?.itemIds ?? [],
  };
}

function sameSceneDraft(left: SceneDraft, right: SceneDraft): boolean {
  return left.name.trim() === right.name.trim()
    && left.summary.trim() === right.summary.trim()
    && left.placeId === right.placeId
    && left.actorIds.join('\u0000') === right.actorIds.join('\u0000')
    && left.itemIds.join('\u0000') === right.itemIds.join('\u0000');
}

export function SceneEditor(props: {
  scene: CampaignScene | null;
  actors: readonly CampaignActor[];
  items: readonly CampaignItem[];
  places: readonly CampaignPlace[];
  busy: boolean;
  readOnly: boolean;
  onSave: (name: string, summary: string, placeId: string | null, actorIds: readonly string[], itemIds: readonly string[]) => Promise<void>;
}) {
  const canonical = sceneDraft(props.scene);
  const [draft, setDraft] = useState(canonical);
  const [baseline, setBaseline] = useState(canonical);
  const dirty = !sameSceneDraft(draft, baseline);
  const actorIdsKey = (props.scene?.actorIds ?? []).join('\u0000');
  const itemIdsKey = (props.scene?.itemIds ?? []).join('\u0000');

  useEffect(() => {
    const next = sceneDraft(props.scene);
    const wasDirty = !sameSceneDraft(draft, baseline);
    setBaseline(next);
    if (!wasDirty) setDraft(next);
  }, [props.scene?.id, props.scene?.name, props.scene?.summary, props.scene?.placeId, actorIdsKey, itemIdsKey]);

  const toggle = (field: 'actorIds' | 'itemIds', id: string) => setDraft(previous => ({
    ...previous,
    [field]: previous[field].includes(id)
      ? previous[field].filter(candidate => candidate !== id)
      : [...previous[field], id],
  }));

  return (
    <form className="record-card" onSubmit={event => {
      event.preventDefault();
      void props.onSave(draft.name, draft.summary, draft.placeId || null, draft.actorIds, draft.itemIds);
    }}>
      <div className="record-card__heading">
        <strong>{props.scene ? 'Current Scene' : 'Start Current Scene'}</strong>
        {props.scene ? <span>{props.scene.id}</span> : null}
      </div>
      <label>
        <span>Name</span>
        <input
          value={draft.name}
          onChange={event => setDraft(previous => ({ ...previous, name: event.target.value }))}
          disabled={props.busy || props.readOnly}
        />
      </label>
      <label>
        <span>Scene Place</span>
        <select value={draft.placeId} onChange={event => setDraft(previous => ({ ...previous, placeId: event.target.value }))} disabled={props.busy || props.readOnly}>
          <option value="">No attached Place</option>
          {props.places.map(place => <option key={place.id} value={place.id} disabled={place.archived && place.id !== props.scene?.placeId}>{place.name}{place.archived ? ' · archived' : ''}</option>)}
        </select>
      </label>
      <div className="scene-attachments">
        <fieldset>
          <legend>Present Actors</legend>
          {props.actors.length === 0 ? <p className="empty-state">No Actors available.</p> : props.actors.map(actor => (
            <label key={actor.id}>
              <input type="checkbox" checked={draft.actorIds.includes(actor.id)} onChange={() => toggle('actorIds', actor.id)} disabled={props.busy || props.readOnly || (actor.archived && !draft.actorIds.includes(actor.id))} />
              <span>{actor.name}{actor.archived ? ' · archived' : ''}</span>
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>Present Items</legend>
          {props.items.length === 0 ? <p className="empty-state">No Items available.</p> : props.items.map(item => (
            <label key={item.id}>
              <input type="checkbox" checked={draft.itemIds.includes(item.id)} onChange={() => toggle('itemIds', item.id)} disabled={props.busy || props.readOnly || (item.archived && !draft.itemIds.includes(item.id))} />
              <span>{item.name}{item.archived ? ' · archived' : ''}</span>
            </label>
          ))}
        </fieldset>
      </div>
      <label>
        <span>Summary</span>
        <textarea
          rows={8}
          value={draft.summary}
          onChange={event => setDraft(previous => ({ ...previous, summary: event.target.value }))}
          disabled={props.busy || props.readOnly}
        />
      </label>
      <div className="record-actions">
        <button type="submit" disabled={props.busy || props.readOnly || !draft.name.trim() || !dirty}>
          {props.scene ? 'Save Scene' : 'Start Scene'}
        </button>
      </div>
    </form>
  );
}

function recordMeta(
  collection: Exclude<CollectionKey, 'scene' | 'history'>,
  record: CommonRecord,
  document: CampaignDocument,
): string {
  if (collection === 'items') {
    const item = record as CampaignItem;
    const owner = item.ownerActorId
      ? document.actors.find(actor => actor.id === item.ownerActorId)?.name ?? 'Unknown Actor'
      : 'Unattached';
    return owner;
  }
  if (collection === 'quests') {
    return (record as CampaignQuest).status === 'completed' ? 'Completed' : 'Active';
  }
  return record.archived ? 'Archived' : 'Active';
}

function RecordIndex(props: {
  collection: Exclude<CollectionKey, 'scene' | 'history'>;
  records: readonly CommonRecord[];
  document: CampaignDocument;
  route: WorkspaceRoute;
  onNavigate: (route: WorkspaceRoute) => void;
}) {
  const active = props.records.filter(record => !record.archived);
  const archived = props.records.filter(record => record.archived);
  const renderRecords = (records: readonly CommonRecord[]) => (
    <div className="record-index">
      {records.map(record => {
        const next: WorkspaceRoute = { ...props.route, recordId: record.id };
        return (
          <a
            href={workspaceHref(next)}
            className="record-index-card"
            key={record.id}
            onClick={event => {
              event.preventDefault();
              props.onNavigate(next);
            }}
          >
            <div>
              <strong>{record.name}</strong>
              <span>{recordMeta(props.collection, record, props.document)}</span>
            </div>
            <p>{record.summary || 'No summary yet.'}</p>
          </a>
        );
      })}
    </div>
  );

  return (
    <>
      {active.length > 0 ? renderRecords(active) : <p className="empty-state">No active {collectionLabel(props.collection).toLowerCase()} in this revision.</p>}
      {archived.length > 0 ? (
        <details className="archive-panel">
          <summary>Archived {collectionLabel(props.collection)} ({archived.length})</summary>
          {renderRecords(archived)}
        </details>
      ) : null}
    </>
  );
}

function RecordRouteHeader(props: {
  route: WorkspaceRoute;
  onNavigate: (route: WorkspaceRoute) => void;
}) {
  const next = { ...props.route, recordId: null };
  return (
    <div className="record-route-header">
      <a
        href={workspaceHref(next)}
        className="route-back"
        onClick={event => {
          event.preventDefault();
          props.onNavigate(next);
        }}
      >
        ← Back to {collectionLabel(props.route.collection)}
      </a>
    </div>
  );
}

export default function CampaignWorkspace() {
  const [route, navigate] = useWorkspaceRoute();
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [selected, setSelected] = useState<CampaignDocument | null>(null);
  const [historical, setHistorical] = useState<CampaignDocument | null>(null);
  const [history, setHistory] = useState<CampaignHistoryEntry[]>([]);
  const [pendingCanonical, setPendingCanonical] = useState<CanonicalUpdate | null>(null);
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [busy, setBusy] = useState(false);
  const [routeLoad, setRouteLoad] = useState<RouteLoadState>(() => route.campaignId
    ? { phase: 'loading', title: 'Loading Campaign' }
    : { phase: 'idle' });
  const [routeRetry, setRouteRetry] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState<RevisionConflict | null>(null);
  const [bindings, setBindings] = useState<readonly ChatBindingDocument[]>([]);

  const [campaignTitle, setCampaignTitle] = useState('');
  const [actorName, setActorName] = useState('');
  const [actorSummary, setActorSummary] = useState('');
  const [itemName, setItemName] = useState('');
  const [itemSummary, setItemSummary] = useState('');
  const [itemOwnerActorId, setItemOwnerActorId] = useState('');
  const [questName, setQuestName] = useState('');
  const [questSummary, setQuestSummary] = useState('');
  const [questStatus, setQuestStatus] = useState<CampaignQuestStatus>('active');
  const [placeName, setPlaceName] = useState('');
  const [placeSummary, setPlaceSummary] = useState('');
  const [joinedActorName, setJoinedActorName] = useState('');
  const [joinedActorSummary, setJoinedActorSummary] = useState('');
  const [joinedItemName, setJoinedItemName] = useState('');
  const [joinedItemSummary, setJoinedItemSummary] = useState('');

  const selectedRevisionRef = useRef(0);
  const readOnly = route.revision !== null;
  const routeCampaign = selected?.campaign.id === route.campaignId ? selected : null;
  const displayed = readOnly
    ? historical?.campaign.id === route.campaignId && historical.campaign.revision === route.revision
      ? historical
      : null
    : routeCampaign;

  useEffect(() => {
    selectedRevisionRef.current = selected?.campaign.revision ?? 0;
  }, [selected?.campaign.revision]);

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

  const loadBindings = useCallback(async (campaignId: string) => {
    const next = await fetchJson<ChatBindingDocument[]>(
      `/api/campaigns/${encodeURIComponent(campaignId)}/chat-bindings`,
    );
    setBindings(next);
    return next;
  }, []);

  const openCampaign = useCallback(async (campaignId: string) => {
    const canonical = await fetchCampaignSnapshot(campaignId);
    selectedRevisionRef.current = canonical.document.campaign.revision;
    setSelected(canonical.document);
    setHistory(canonical.history);
    setPendingCanonical(null);
    setConflict(null);
    if (route.revision === null) setHistorical(null);
  }, [fetchCampaignSnapshot, route.revision]);

  useEffect(() => {
    loadCampaigns().catch(value => setError(value instanceof Error ? value.message : String(value)));
  }, [loadCampaigns]);

  useEffect(() => {
    if (!route.campaignId) {
      setBindings([]);
      return undefined;
    }
    let cancelled = false;
    setBindings([]);
    void fetchJson<ChatBindingDocument[]>(
      `/api/campaigns/${encodeURIComponent(route.campaignId)}/chat-bindings`,
    ).then(next => {
      if (!cancelled) setBindings(next);
    }).catch(value => {
      if (!cancelled) setError(value instanceof Error ? value.message : String(value));
    });
    return () => { cancelled = true; };
  }, [route.campaignId]);

  useEffect(() => {
    if (!route.campaignId) {
      setSelected(null);
      setHistorical(null);
      setHistory([]);
      setPendingCanonical(null);
      setConflict(null);
      setSyncState('idle');
      setRouteLoad({ phase: 'idle' });
      return undefined;
    }
    if (selected?.campaign.id === route.campaignId) return undefined;
    let cancelled = false;
    setRouteLoad({ phase: 'loading', title: 'Loading Campaign' });
    void fetchCampaignSnapshot(route.campaignId).then(canonical => {
      if (cancelled) return;
      selectedRevisionRef.current = canonical.document.campaign.revision;
      setSelected(canonical.document);
      setHistory(canonical.history);
      setPendingCanonical(null);
      setConflict(null);
      if (route.revision === null) setRouteLoad({ phase: 'idle' });
    }).catch(value => {
      if (!cancelled) setRouteLoad({
        phase: 'error',
        title: 'Campaign route unavailable',
        message: value instanceof Error ? value.message : String(value),
      });
    });
    return () => { cancelled = true; };
  }, [fetchCampaignSnapshot, route.campaignId, route.revision, routeRetry, selected?.campaign.id]);

  useEffect(() => {
    if (!selected || route.revision === null) {
      setHistorical(null);
      if (selected?.campaign.id === route.campaignId) setRouteLoad({ phase: 'idle' });
      return undefined;
    }
    if (selected.campaign.id !== route.campaignId) return undefined;
    let cancelled = false;
    setHistorical(null);
    setRouteLoad({ phase: 'loading', title: `Loading historical revision ${route.revision}` });
    void fetchJson<CampaignDocument>(
      `/api/campaigns/${encodeURIComponent(selected.campaign.id)}?revision=${route.revision}`,
    ).then(document => {
      if (!cancelled) {
        setHistorical(document);
        setRouteLoad({ phase: 'idle' });
      }
    }).catch(value => {
      if (!cancelled) setRouteLoad({
        phase: 'error',
        title: 'Historical revision unavailable',
        message: value instanceof Error ? value.message : String(value),
      });
    });
    return () => { cancelled = true; };
  }, [route.campaignId, route.revision, routeRetry, selected?.campaign.id]);

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
      if (!closed) setSyncState('live');
    };
    source.onerror = () => {
      if (!closed) setSyncState('reconnecting');
    };
    const receiveInvalidation = (event: Event) => {
      const messageEvent = event as MessageEvent<string>;
      let value: unknown;
      try {
        value = JSON.parse(messageEvent.data);
      } catch {
        return;
      }
      if (!isCampaignInvalidation(value)
        || value.campaignId !== campaignId
        || value.revision <= selectedRevisionRef.current) return;
      latestRevision = Math.max(latestRevision, value.revision);
      if (debounce !== undefined) return;
      debounce = window.setTimeout(() => {
        debounce = undefined;
        void fetchCampaignSnapshot(campaignId).then(canonical => {
          if (closed || canonical.document.campaign.revision <= selectedRevisionRef.current) return;
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
  }, [fetchCampaignSnapshot, selected?.campaign.id, selected?.campaign.revision]);

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
    selectedRevisionRef.current = pendingCanonical.document.campaign.revision;
    setSelected(pendingCanonical.document);
    setHistory(pendingCanonical.history);
    setConflict(null);
    setPendingCanonical(null);
    setSyncState('live');
    setError('');
    setMessage(`Loaded canonical revision ${pendingCanonical.document.campaign.revision}.`);
    if (route.revision === null) setHistorical(null);
  }

  function navigateCollection(collection: CollectionKey, recordId: string | null = null) {
    navigate({
      campaignId: selected?.campaign.id ?? route.campaignId,
      collection,
      recordId,
      revision: route.revision,
    });
  }

  async function createCampaign(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const commit = await fetchJson<CampaignCommit>('/api/campaigns', undefined, {
        method: 'POST',
        body: JSON.stringify({ requestId: newRequestId(), title: campaignTitle }),
      });
      const entries = await fetchJson<CampaignHistoryEntry[]>(`/api/campaigns/${encodeURIComponent(commit.campaignId)}/history`);
      selectedRevisionRef.current = commit.revision;
      setCampaignTitle('');
      setSelected(commit.document);
      setHistorical(null);
      setHistory(entries);
      setPendingCanonical(null);
      setConflict(null);
      await loadCampaigns();
      navigate({ campaignId: commit.campaignId, collection: 'actors', recordId: null, revision: null });
      setMessage(`Campaign persisted at revision ${commit.revision}.`);
    });
  }

  async function executeOperation(operation: CampaignOperation): Promise<CampaignCommit> {
    if (!selected || readOnly) throw new Error('Return to the current Campaign revision before editing.');
    const campaignId = selected.campaign.id;
    const expectedRevision = selected.campaign.revision;
    try {
      const commit = await fetchJson<CampaignCommit>(`/api/campaigns/${encodeURIComponent(campaignId)}/operations`, undefined, {
        method: 'POST',
        body: JSON.stringify({ requestId: newRequestId(), expectedRevision, operation }),
      });
      const [campaignList, entries] = await Promise.all([
        fetchJson<CampaignSummary[]>('/api/campaigns'),
        fetchJson<CampaignHistoryEntry[]>(`/api/campaigns/${encodeURIComponent(campaignId)}/history`),
      ]);
      selectedRevisionRef.current = commit.revision;
      setSelected(commit.document);
      setCampaigns(campaignList);
      setHistory(entries);
      setHistorical(null);
      setPendingCanonical(null);
      setConflict(null);
      setMessage(`Saved ${commit.operationKind} as revision ${commit.revision}.`);
      return commit;
    } catch (value) {
      const apiError = value instanceof ApiProblem ? value : null;
      const revisionConflict = conflictFrom(apiError?.problem ?? null, campaignId, expectedRevision);
      if (revisionConflict) {
        setConflict(revisionConflict);
      }
      throw value;
    }
  }

  async function createActor(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const commit = await executeOperation({ kind: 'create_actor', actor: { name: actorName, summary: actorSummary } });
      setActorName('');
      setActorSummary('');
      navigateCollection('actors', commit.affectedIds[0] ?? null);
    });
  }

  async function createItem(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const commit = await executeOperation({
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
      navigateCollection('items', commit.affectedIds[0] ?? null);
    });
  }

  async function createQuest(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const commit = await executeOperation({
        kind: 'create_quest',
        quest: { name: questName, summary: questSummary, status: questStatus },
      });
      setQuestName('');
      setQuestSummary('');
      setQuestStatus('active');
      navigateCollection('quests', commit.affectedIds[0] ?? null);
    });
  }

  async function createPlace(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const commit = await executeOperation({
        kind: 'create_place',
        place: { name: placeName, summary: placeSummary },
      });
      setPlaceName('');
      setPlaceSummary('');
      navigateCollection('places', commit.affectedIds[0] ?? null);
    });
  }

  async function createJoinedActorItem(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const commit = await executeOperation({
        kind: 'create_actor_with_item',
        actor: { name: joinedActorName, summary: joinedActorSummary },
        item: { name: joinedItemName, summary: joinedItemSummary },
      });
      setJoinedActorName('');
      setJoinedActorSummary('');
      setJoinedItemName('');
      setJoinedItemSummary('');
      navigateCollection('items', commit.affectedIds[1] ?? null);
    });
  }

  const recordId = route.recordId;
  const actor = route.collection === 'actors' && recordId
    ? displayed?.actors.find(record => record.id === recordId) ?? null
    : null;
  const item = route.collection === 'items' && recordId
    ? displayed?.items.find(record => record.id === recordId) ?? null
    : null;
  const quest = route.collection === 'quests' && recordId
    ? displayed?.quests.find(record => record.id === recordId) ?? null
    : null;
  const place = route.collection === 'places' && recordId
    ? displayed?.places.find(record => record.id === recordId) ?? null
    : null;
  const activeActors = displayed?.actors.filter(record => !record.archived) ?? [];
  const retryRoute = () => {
    setError('');
    setRouteRetry(value => value + 1);
  };
  const waitingForDisplayedRoute = Boolean(
    route.campaignId && !displayed && routeLoad.phase === 'idle',
  );
  const routeLoadingTitle = routeLoad.phase === 'loading'
    ? routeLoad.title
    : route.revision === null
      ? 'Loading Campaign'
      : `Loading historical revision ${route.revision}`;

  async function openImportedCampaign(campaignId: string, binding: ChatBindingDocument) {
    await Promise.all([loadCampaigns(), openCampaign(campaignId), loadBindings(campaignId)]);
    navigate({ campaignId, collection: 'actors', recordId: null, revision: null });
    setMessage(binding.markerState === 'verified'
      ? 'Imported Campaign opened. The SillyTavern Chat Binding marker was verified.'
      : 'Imported Campaign opened. Its Chat Binding is blocked until the marker can be verified.');
  }

  async function retryBindingMarker(bindingId: string) {
    await run(async () => {
      const binding = await fetchJson<ChatBindingDocument>(
        `/api/chat-bindings/${encodeURIComponent(bindingId)}/retry-marker`,
        undefined,
        { method: 'POST' },
      );
      setBindings(current => current.map(candidate => candidate.id === binding.id ? binding : candidate));
      setMessage(binding.markerState === 'verified'
        ? 'The SillyTavern Chat Binding marker is now verified.'
        : 'The Campaign remains safe, but its SillyTavern marker is still blocked.');
    });
  }

  return (
    <section className="authority-panel" aria-labelledby="campaign-authority">
      <div className="section-heading">
        <div>
          <h2 id="campaign-authority">Campaign Workspace</h2>
          <p>Routed Actors, Items, Quests, Places, Scene, and immutable history backed by one SQLite authority.</p>
        </div>
        {displayed ? (
          <div className="workspace-state">
            <span className={readOnly ? 'revision-badge revision-badge--historical' : 'revision-badge'}>
              {readOnly ? 'Historical' : 'Current'} revision {displayed.campaign.revision}
            </span>
            <span className={`sync-state sync-state--${syncState}`} role="status">{syncLabel(syncState)}</span>
            <span className="pending-state" role="status">{routeLoad.phase === 'loading' ? 'Opening…' : busy ? 'Working…' : readOnly ? 'Read-only' : 'Ready'}</span>
          </div>
        ) : null}
      </div>

      <LegacyImportPanel onImported={openImportedCampaign} />

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
          onStay={() => {
            setConflict(null);
            setError('');
            setMessage('Draft kept. Load canonical Campaign truth before trying to save it again.');
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
            {campaigns.map(campaign => {
              const next: WorkspaceRoute = {
                campaignId: campaign.id,
                collection: 'actors',
                recordId: null,
                revision: null,
              };
              return (
                <a
                  href={workspaceHref(next)}
                  className={selected?.campaign.id === campaign.id ? 'campaign-button campaign-button--active' : 'campaign-button'}
                  key={campaign.id}
                  onClick={event => {
                    event.preventDefault();
                    navigate(next);
                  }}
                >
                  <strong>{campaign.title}</strong>
                  <span>Revision {campaign.revision}</span>
                </a>
              );
            })}
            {campaigns.length === 0 ? <p className="empty-state">No companion Campaigns yet.</p> : null}
          </div>
        </aside>

        <div className="campaign-detail">
          {route.campaignId && (routeLoad.phase === 'loading' || waitingForDisplayedRoute) ? (
            <WorkspaceRouteState phase="loading" title={routeLoadingTitle} />
          ) : route.campaignId && routeLoad.phase === 'error' ? (
            <WorkspaceRouteState
              phase="error"
              title={routeLoad.title}
              message={routeLoad.message}
              onRetry={retryRoute}
            />
          ) : displayed && selected ? (
            <>
              <div className="campaign-title-row">
                <div>
                  <p className="eyebrow">{readOnly ? 'Immutable reconstruction' : 'SQLite authority'}</p>
                  <h3>{displayed.campaign.title}</h3>
                </div>
                <button type="button" onClick={() => { void run(() => openCampaign(selected.campaign.id)); }} disabled={busy}>
                  Reload current
                </button>
              </div>

              <CampaignCommandDeck
                campaignId={displayed.campaign.id}
                revision={displayed.campaign.revision}
                hasCurrentScene={displayed.currentScene !== null}
                busy={busy}
                readOnly={readOnly}
                onNavigate={navigateCollection}
              />

              {!readOnly ? (
                <ChatBindingsPanel
                  bindings={bindings}
                  busy={busy}
                  onRetryMarker={bindingId => { void retryBindingMarker(bindingId); }}
                />
              ) : null}

              <CollectionNavigation route={route} document={displayed} bindings={bindings} onNavigate={navigate} />

              {readOnly ? (
                <p className="historical-note">Historical revision {route.revision} is read-only. Collection and record routes remain available for inspection.</p>
              ) : null}

              {route.collection === 'actors' ? (
                <section className="collection-view" aria-labelledby="actors-heading">
                  <div className="collection-heading">
                    <div>
                      <h4 id="actors-heading">Actors</h4>
                      <p>Identity and concise Campaign-facing context.</p>
                    </div>
                  </div>
                  {recordId ? (
                    <>
                      <RecordRouteHeader route={route} onNavigate={navigate} />
                      {actor ? (
                        <RecordEditor
                          kind="actor"
                          record={actor}
                          actors={displayed.actors}
                          busy={busy}
                          readOnly={readOnly}
                           onSave={(actorId, name, summary, aliases, visibility) => run(() => executeOperation({ kind: 'update_actor', actorId, name, summary, aliases: [...aliases], visibility }).then(() => undefined))}
                          onArchive={(actorId, archived) => run(() => executeOperation({ kind: 'set_actor_archived', actorId, archived }).then(() => undefined))}
                        />
                      ) : <p className="error-banner">Actor {recordId} does not exist in this revision.</p>}
                    </>
                  ) : (
                    <>
                      {!readOnly ? (
                        <>
                          <form className="create-record-form" onSubmit={createActor}>
                            <label><span>Actor name</span><input value={actorName} onChange={event => setActorName(event.target.value)} disabled={busy} /></label>
                            <label><span>Summary</span><textarea rows={3} value={actorSummary} onChange={event => setActorSummary(event.target.value)} disabled={busy} /></label>
                            <button type="submit" disabled={busy || !actorName.trim()}>Create Actor</button>
                          </form>
                          <details className="joined-create-panel">
                            <summary>Create Actor with attached Item</summary>
                            <form className="joined-create-form" onSubmit={createJoinedActorItem}>
                              <fieldset>
                                <legend>Actor</legend>
                                <label><span>Name</span><input value={joinedActorName} onChange={event => setJoinedActorName(event.target.value)} disabled={busy} /></label>
                                <label><span>Summary</span><textarea rows={3} value={joinedActorSummary} onChange={event => setJoinedActorSummary(event.target.value)} disabled={busy} /></label>
                              </fieldset>
                              <fieldset>
                                <legend>Attached Item</legend>
                                <label><span>Name</span><input value={joinedItemName} onChange={event => setJoinedItemName(event.target.value)} disabled={busy} /></label>
                                <label><span>Summary</span><textarea rows={3} value={joinedItemSummary} onChange={event => setJoinedItemSummary(event.target.value)} disabled={busy} /></label>
                              </fieldset>
                              <button type="submit" disabled={busy || !joinedActorName.trim() || !joinedItemName.trim()}>Create both in one revision</button>
                            </form>
                          </details>
                        </>
                      ) : null}
                      <RecordIndex collection="actors" records={displayed.actors} document={displayed} route={route} onNavigate={navigate} />
                    </>
                  )}
                </section>
              ) : null}

              {route.collection === 'items' ? (
                <section className="collection-view" aria-labelledby="items-heading">
                  <div className="collection-heading"><div><h4 id="items-heading">Items</h4><p>Durable objects with optional Actor attachment.</p></div></div>
                  {recordId ? (
                    <>
                      <RecordRouteHeader route={route} onNavigate={navigate} />
                      {item ? (
                        <RecordEditor
                          kind="item"
                          record={item}
                          actors={displayed.actors}
                          busy={busy}
                          readOnly={readOnly}
                           onSave={(itemId, name, summary, aliases, visibility, ownerActorId) => run(() => executeOperation({ kind: 'update_item', itemId, name, summary, aliases: [...aliases], visibility, ownerActorId }).then(() => undefined))}
                          onArchive={(itemId, archived) => run(() => executeOperation({ kind: 'set_item_archived', itemId, archived }).then(() => undefined))}
                        />
                      ) : <p className="error-banner">Item {recordId} does not exist in this revision.</p>}
                    </>
                  ) : (
                    <>
                      {!readOnly ? (
                        <form className="create-record-form" onSubmit={createItem}>
                          <label><span>Item name</span><input value={itemName} onChange={event => setItemName(event.target.value)} disabled={busy} /></label>
                          <label><span>Summary</span><textarea rows={3} value={itemSummary} onChange={event => setItemSummary(event.target.value)} disabled={busy} /></label>
                          <label>
                            <span>Attach to Actor</span>
                            <select value={itemOwnerActorId} onChange={event => setItemOwnerActorId(event.target.value)} disabled={busy}>
                              <option value="">Unattached</option>
                              {activeActors.map(record => <option key={record.id} value={record.id}>{record.name}</option>)}
                            </select>
                          </label>
                          <button type="submit" disabled={busy || !itemName.trim()}>Create Item</button>
                        </form>
                      ) : null}
                      <RecordIndex collection="items" records={displayed.items} document={displayed} route={route} onNavigate={navigate} />
                    </>
                  )}
                </section>
              ) : null}

              {route.collection === 'quests' ? (
                <section className="collection-view" aria-labelledby="quests-heading">
                  <div className="collection-heading"><div><h4 id="quests-heading">Quests</h4><p>Active and completed objectives with durable summaries.</p></div></div>
                  {recordId ? (
                    <>
                      <RecordRouteHeader route={route} onNavigate={navigate} />
                      {quest ? (
                        <RecordEditor
                          kind="quest"
                          record={quest}
                          actors={displayed.actors}
                          busy={busy}
                          readOnly={readOnly}
                           onSave={(questId, name, summary, aliases, visibility, status) => run(() => executeOperation({ kind: 'update_quest', questId, name, summary, aliases: [...aliases], visibility, status }).then(() => undefined))}
                          onArchive={(questId, archived) => run(() => executeOperation({ kind: 'set_quest_archived', questId, archived }).then(() => undefined))}
                        />
                      ) : <p className="error-banner">Quest {recordId} does not exist in this revision.</p>}
                    </>
                  ) : (
                    <>
                      {!readOnly ? (
                        <form className="create-record-form" onSubmit={createQuest}>
                          <label><span>Quest name</span><input value={questName} onChange={event => setQuestName(event.target.value)} disabled={busy} /></label>
                          <label><span>Summary</span><textarea rows={3} value={questSummary} onChange={event => setQuestSummary(event.target.value)} disabled={busy} /></label>
                          <label>
                            <span>Status</span>
                            <select value={questStatus} onChange={event => setQuestStatus(event.target.value as CampaignQuestStatus)} disabled={busy}>
                              <option value="active">Active</option>
                              <option value="completed">Completed</option>
                            </select>
                          </label>
                          <button type="submit" disabled={busy || !questName.trim()}>Create Quest</button>
                        </form>
                      ) : null}
                      <RecordIndex collection="quests" records={displayed.quests} document={displayed} route={route} onNavigate={navigate} />
                    </>
                  )}
                </section>
              ) : null}

              {route.collection === 'places' ? (
                <section className="collection-view" aria-labelledby="places-heading">
                  <div className="collection-heading"><div><h4 id="places-heading">Places</h4><p>Locations and concise world context.</p></div></div>
                  {recordId ? (
                    <>
                      <RecordRouteHeader route={route} onNavigate={navigate} />
                      {place ? (
                        <RecordEditor
                          kind="place"
                          record={place}
                          actors={displayed.actors}
                          busy={busy}
                          readOnly={readOnly}
                           onSave={(placeId, name, summary, aliases, visibility) => run(() => executeOperation({ kind: 'update_place', placeId, name, summary, aliases: [...aliases], visibility }).then(() => undefined))}
                          onArchive={(placeId, archived) => run(() => executeOperation({ kind: 'set_place_archived', placeId, archived }).then(() => undefined))}
                        />
                      ) : <p className="error-banner">Place {recordId} does not exist in this revision.</p>}
                    </>
                  ) : (
                    <>
                      {!readOnly ? (
                        <form className="create-record-form" onSubmit={createPlace}>
                          <label><span>Place name</span><input value={placeName} onChange={event => setPlaceName(event.target.value)} disabled={busy} /></label>
                          <label><span>Summary</span><textarea rows={4} value={placeSummary} onChange={event => setPlaceSummary(event.target.value)} disabled={busy} /></label>
                          <button type="submit" disabled={busy || !placeName.trim()}>Create Place</button>
                        </form>
                      ) : null}
                      <RecordIndex collection="places" records={displayed.places} document={displayed} route={route} onNavigate={navigate} />
                    </>
                  )}
                </section>
              ) : null}

              {route.collection === 'scene' ? (
                <section className="collection-view" aria-labelledby="scene-heading">
                  <div className="collection-heading"><div><h4 id="scene-heading">Current Scene</h4><p>One canonical record for the Campaign’s present moment.</p></div></div>
                  <SceneEditor
                    scene={displayed.currentScene}
                    actors={displayed.actors}
                    items={displayed.items}
                    places={displayed.places}
                    busy={busy}
                    readOnly={readOnly}
                    onSave={(name, summary, placeId, actorIds, itemIds) => run(() => executeOperation({
                      kind: 'set_current_scene',
                      scene: {
                        name,
                        summary,
                        ...(placeId ? { placeId } : {}),
                        actorIds: [...actorIds],
                        itemIds: [...itemIds],
                      },
                    }).then(() => undefined))}
                  />
                </section>
              ) : null}

              {route.collection === 'context' ? (
                <ContextTray
                  document={displayed}
                  bindings={bindings}
                  busy={busy}
                  readOnly={readOnly}
                  onBindingChanged={binding => setBindings(current => current.map(candidate => candidate.id === binding.id ? binding : candidate))}
                  onStatus={setMessage}
                  onError={setError}
                />
              ) : null}

              {route.collection === 'review' ? (
                readOnly
                  ? <p className="historical-note">Story Sync proposals belong to the current Campaign and are unavailable inside an immutable historical reconstruction.</p>
                  : <StorySyncReviewInbox campaign={displayed} />
              ) : null}

              {route.collection === 'history' ? (
                <section className="collection-view" aria-labelledby="history-heading">
                  <div className="collection-heading"><div><h4 id="history-heading">Immutable History</h4><p>Open any accepted revision and keep navigating its collections and records read-only.</p></div></div>
                  <CampaignHistoryView
                    entries={history}
                    currentRevision={selected.campaign.revision}
                    viewingRevision={route.revision}
                    busy={busy}
                    expanded
                    onOpenRevision={revision => navigate({ ...route, recordId: null, revision })}
                    onReturnCurrent={() => navigate({ ...route, recordId: null, revision: null })}
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
