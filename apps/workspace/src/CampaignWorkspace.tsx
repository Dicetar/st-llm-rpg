import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  isCampaignInvalidation,
  type CampaignAbility,
  type CampaignAbilityCategory,
  type CampaignActor,
  type CampaignCommit,
  type CampaignDocument,
  type CampaignFact,
  type CampaignHistoryEntry,
  type CampaignItem,
  type CampaignLearnedAbility,
  type CampaignOperation,
  type CampaignPlace,
  type CampaignQuest,
  type CampaignQuestStatus,
  type CampaignRelationship,
  type CampaignRelationshipStatus,
  type CampaignScene,
  type CampaignSceneArchive,
  type CampaignSummary,
  type CampaignWorldObject,
  type NarratorVisibility,
  type Problem,
} from '@st-llm-rpg/wire';
import type { ChatBindingDocument } from '@st-llm-rpg/wire';
import LegacyImportPanel, { ChatBindingsPanel } from './LegacyImportPanel.js';
import { ContextTray } from './ContextTray.js';
import { createUuid } from './browser-uuid.js';
import { StorySyncReviewInbox } from './StorySyncReviewInbox.js';

export type CollectionKey = 'actors' | 'items' | 'quests' | 'places' | 'facts' | 'world-objects' | 'abilities' | 'relationships' | 'scene' | 'review' | 'context' | 'history';

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
  category: CampaignAbilityCategory;
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
  'facts',
  'world-objects',
  'abilities',
  'relationships',
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
    && left.status === right.status
    && left.category === right.category;
}

function collectionLabel(collection: CollectionKey): string {
  if (collection === 'actors') return 'Actors';
  if (collection === 'items') return 'Items';
  if (collection === 'quests') return 'Quests';
  if (collection === 'places') return 'Places';
  if (collection === 'facts') return 'Facts';
  if (collection === 'world-objects') return 'World Objects';
  if (collection === 'abilities') return 'Abilities';
  if (collection === 'relationships') return 'Relationships';
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
    { collection: 'abilities', label: 'Add Ability', description: 'Create a spell, skill, feat, or other capability.', mutationEntry: true },
    { collection: 'relationships', label: 'Add Relationship', description: 'Connect two Actors with explicit directed state.', mutationEntry: true },
    { collection: 'facts', label: 'Add Fact', description: 'Record a durable truth, optionally about another Record.', mutationEntry: true },
    { collection: 'world-objects', label: 'Add World Object', description: 'Create a persistent feature attached to a Place.', mutationEntry: true },
    {
      collection: 'scene',
      label: props.hasCurrentScene ? 'Open / Advance Scene' : 'Start Scene',
      description: props.hasCurrentScene ? 'Edit now or close it into immutable Past Scenes.' : 'Establish the present moment.',
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
    { key: 'facts', label: 'Facts', count: (props.document.facts ?? []).filter(record => !record.archived).length },
    { key: 'world-objects', label: 'World Objects', count: (props.document.worldObjects ?? []).filter(record => !record.archived).length },
    { key: 'abilities', label: 'Abilities', count: (props.document.abilities ?? []).filter(record => !record.archived).length },
    { key: 'relationships', label: 'Relationships', count: (props.document.relationships ?? []).filter(record => !record.archived).length },
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
    }>
  | Readonly<{
      kind: 'ability';
      record: CampaignAbility;
      actors: readonly CampaignActor[];
      busy: boolean;
      readOnly: boolean;
      onSave: (id: string, name: string, summary: string, aliases: readonly string[], visibility: NarratorVisibility, category: CampaignAbilityCategory) => Promise<void>;
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
    category: props.kind === 'ability' ? props.record.category : 'other',
  };
}

function editorLabel(kind: RecordEditorProps['kind']): string {
  if (kind === 'actor') return 'Actor';
  if (kind === 'item') return 'Item';
  if (kind === 'quest') return 'Quest';
  if (kind === 'ability') return 'Ability';
  return 'Place';
}

export function RecordEditor(props: RecordEditorProps) {
  const initial = canonicalDraft(props);
  const [draft, setDraft] = useState<EditorDraft>(initial);
  const [baseline, setBaseline] = useState<EditorDraft>(initial);
  const ownerActorId = props.kind === 'item' ? props.record.ownerActorId ?? '' : '';
  const questStatus = props.kind === 'quest' ? props.record.status : 'active';
  const abilityCategory = props.kind === 'ability' ? props.record.category : 'other';
  const aliasesKey = (props.record.aliases ?? []).join('\u0000');
  const visibility = props.record.visibility ?? 'known';
  const dirty = !sameDraft(draft, baseline);

  useEffect(() => {
    const next = canonicalDraft(props);
    const wasDirty = !sameDraft(draft, baseline);
    setBaseline(next);
    if (!wasDirty) setDraft(next);
  }, [props.kind, props.record.id, props.record.name, props.record.summary, props.record.archived, aliasesKey, visibility, ownerActorId, questStatus, abilityCategory]);

  const label = editorLabel(props.kind);
  return (
    <form className={props.record.archived ? 'record-card record-card--archived' : 'record-card'} onSubmit={event => {
      event.preventDefault();
      const aliases = draft.aliases.map(value => value.trim()).filter(Boolean);
      if (props.kind === 'actor' || props.kind === 'place') {
        void props.onSave(props.record.id, draft.name, draft.summary, aliases, draft.visibility);
      } else if (props.kind === 'item') {
        void props.onSave(props.record.id, draft.name, draft.summary, aliases, draft.visibility, draft.ownerActorId || null);
      } else if (props.kind === 'quest') {
        void props.onSave(props.record.id, draft.name, draft.summary, aliases, draft.visibility, draft.status);
      } else {
        void props.onSave(props.record.id, draft.name, draft.summary, aliases, draft.visibility, draft.category);
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
      {props.kind === 'ability' ? (
        <label>
          <span>Category</span>
          <select
            value={draft.category}
            onChange={event => setDraft(previous => ({ ...previous, category: event.target.value as CampaignAbilityCategory }))}
            disabled={props.busy || props.readOnly}
          >
            <option value="spell">Spell</option>
            <option value="skill">Skill</option>
            <option value="feat">Feat</option>
            <option value="other">Other</option>
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

type SubjectOption = Readonly<{ id: string; label: string; archived: boolean }>;
type WorldRecordDraft = Readonly<{
  name: string;
  summary: string;
  aliases: readonly string[];
  visibility: NarratorVisibility;
  relationId: string;
}>;

function sameWorldRecordDraft(left: WorldRecordDraft, right: WorldRecordDraft): boolean {
  return left.name.trim() === right.name.trim()
    && left.summary.trim() === right.summary.trim()
    && left.aliases.map(value => value.trim()).join('\u0000') === right.aliases.map(value => value.trim()).join('\u0000')
    && left.visibility === right.visibility
    && left.relationId === right.relationId;
}

export function WorldRecordEditor(props: Readonly<{
  kind: 'fact' | 'world-object';
  record: CampaignFact | CampaignWorldObject;
  options: readonly SubjectOption[];
  busy: boolean;
  readOnly: boolean;
  onSave: (id: string, draft: WorldRecordDraft) => Promise<void>;
  onArchive: (id: string, archived: boolean) => Promise<void>;
}>) {
  const relationId = props.kind === 'fact'
    ? (props.record as CampaignFact).subjectId ?? ''
    : (props.record as CampaignWorldObject).placeId ?? '';
  const initial: WorldRecordDraft = {
    name: props.record.name,
    summary: props.record.summary,
    aliases: props.record.aliases ?? [],
    visibility: props.record.visibility ?? 'known',
    relationId,
  };
  const [draft, setDraft] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  const aliasesKey = (props.record.aliases ?? []).join('\u0000');
  useEffect(() => {
    const next: WorldRecordDraft = {
      name: props.record.name,
      summary: props.record.summary,
      aliases: props.record.aliases ?? [],
      visibility: props.record.visibility ?? 'known',
      relationId,
    };
    const dirty = !sameWorldRecordDraft(draft, baseline);
    setBaseline(next);
    if (!dirty) setDraft(next);
  }, [props.kind, props.record.id, props.record.name, props.record.summary, aliasesKey, props.record.visibility, props.record.archived, relationId]);
  const dirty = !sameWorldRecordDraft(draft, baseline);
  const label = props.kind === 'fact' ? 'Fact' : 'World Object';
  const relationLabel = props.kind === 'fact' ? 'About Record' : 'Place';
  return (
    <form className={props.record.archived ? 'record-card record-card--archived' : 'record-card'} onSubmit={event => {
      event.preventDefault();
      void props.onSave(props.record.id, {
        ...draft,
        aliases: draft.aliases.map(value => value.trim()).filter(Boolean),
      });
    }}>
      <div className="record-card__heading"><strong>{props.record.archived ? `Removed ${label}` : label}</strong><span>{props.record.id}</span></div>
      <label><span>Name</span><input value={draft.name} onChange={event => setDraft(value => ({ ...value, name: event.target.value }))} disabled={props.busy || props.readOnly || props.record.archived} /></label>
      <label><span>{relationLabel}</span><select value={draft.relationId} onChange={event => setDraft(value => ({ ...value, relationId: event.target.value }))} disabled={props.busy || props.readOnly || props.record.archived}><option value="">{props.kind === 'fact' ? 'Campaign-wide' : 'No attached Place'}</option>{props.options.map(option => <option key={option.id} value={option.id} disabled={option.archived && option.id !== relationId}>{option.label}{option.archived ? ' · archived' : ''}</option>)}</select></label>
      <fieldset className="alias-editor"><legend>Aliases</legend>
        {draft.aliases.map((alias, index) => <div className="alias-row" key={`${index}-${alias}`}><label><span>Alias {index + 1}</span><input value={alias} onChange={event => setDraft(value => ({ ...value, aliases: value.aliases.map((entry, candidate) => candidate === index ? event.target.value : entry) }))} disabled={props.busy || props.readOnly || props.record.archived} /></label><button type="button" className="button-secondary" onClick={() => setDraft(value => ({ ...value, aliases: value.aliases.filter((_entry, candidate) => candidate !== index) }))} disabled={props.busy || props.readOnly || props.record.archived}>Remove</button></div>)}
        <button type="button" className="button-secondary" onClick={() => setDraft(value => ({ ...value, aliases: [...value.aliases, ''] }))} disabled={props.busy || props.readOnly || props.record.archived || draft.aliases.length >= 32}>+ Add alias</button>
      </fieldset>
      <label><span>Narrator Visibility</span><select value={draft.visibility} onChange={event => setDraft(value => ({ ...value, visibility: event.target.value as NarratorVisibility }))} disabled={props.busy || props.readOnly || props.record.archived}><option value="known">Known · may be used and revealed</option><option value="narrator_secret">Narrator Secret · use silently</option><option value="campaign_private">Campaign Private · never sent</option></select></label>
      <label><span>{props.kind === 'fact' ? 'Statement' : 'Description'}</span><textarea rows={5} value={draft.summary} onChange={event => setDraft(value => ({ ...value, summary: event.target.value }))} disabled={props.busy || props.readOnly || props.record.archived} /></label>
      <div className="record-actions">
        {!props.record.archived ? <button type="submit" disabled={props.busy || props.readOnly || !draft.name.trim() || !dirty}>Save {label}</button> : null}
        <button type="button" className="button-secondary" disabled={props.busy || props.readOnly} onClick={() => { void props.onArchive(props.record.id, !props.record.archived); }}>{props.record.archived ? `Restore ${label}` : `Remove ${label}`}</button>
      </div>
    </form>
  );
}

export function LinkedFactsPanel(props: Readonly<{
  facts: readonly CampaignFact[];
  subjectId: string;
  subjectLabel: string;
  options: readonly SubjectOption[];
  busy: boolean;
  readOnly: boolean;
  onCreate: (name: string, summary: string, visibility: NarratorVisibility) => Promise<void>;
  onSave: (id: string, draft: WorldRecordDraft) => Promise<void>;
  onArchive: (id: string, archived: boolean) => Promise<void>;
}>) {
  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const [visibility, setVisibility] = useState<NarratorVisibility>('known');
  const linked = props.facts.filter(fact => fact.subjectId === props.subjectId);
  return <section className="linked-records"><div className="collection-heading"><div><h4>Facts about {props.subjectLabel}</h4><p>Add and edit durable truths here, without leaving this Record.</p></div></div>
    {!props.readOnly ? <form className="create-record-form create-record-form--inline" onSubmit={event => { event.preventDefault(); void props.onCreate(name, summary, visibility).then(() => { setName(''); setSummary(''); setVisibility('known'); }); }}><label><span>Fact name</span><input value={name} onChange={event => setName(event.target.value)} disabled={props.busy} /></label><label><span>Statement</span><textarea rows={2} value={summary} onChange={event => setSummary(event.target.value)} disabled={props.busy} /></label><label><span>Visibility</span><select value={visibility} onChange={event => setVisibility(event.target.value as NarratorVisibility)} disabled={props.busy}><option value="known">Known</option><option value="narrator_secret">Narrator Secret</option><option value="campaign_private">Campaign Private</option></select></label><button type="submit" disabled={props.busy || !name.trim()}>+ Add Fact</button></form> : null}
    {linked.length === 0 ? <p className="empty-state">No attached Facts yet.</p> : linked.map(fact => <WorldRecordEditor key={fact.id} kind="fact" record={fact} options={props.options} busy={props.busy} readOnly={props.readOnly} onSave={props.onSave} onArchive={props.onArchive} />)}
  </section>;
}

export function PlaceWorldObjectsPanel(props: Readonly<{
  worldObjects: readonly CampaignWorldObject[];
  placeId: string;
  placeLabel: string;
  places: readonly CampaignPlace[];
  busy: boolean;
  readOnly: boolean;
  onCreate: (name: string, summary: string) => Promise<void>;
  onSave: (id: string, draft: WorldRecordDraft) => Promise<void>;
  onArchive: (id: string, archived: boolean) => Promise<void>;
}>) {
  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const linked = props.worldObjects.filter(record => record.placeId === props.placeId);
  const options = props.places.map(record => ({ id: record.id, label: record.name, archived: record.archived }));
  return <section className="linked-records"><div className="collection-heading"><div><h4>World Objects in {props.placeLabel}</h4><p>Persistent non-portable features. Add and edit them beside their Place.</p></div></div>
    {!props.readOnly ? <form className="create-record-form create-record-form--inline" onSubmit={event => { event.preventDefault(); void props.onCreate(name, summary).then(() => { setName(''); setSummary(''); }); }}><label><span>World Object name</span><input value={name} onChange={event => setName(event.target.value)} disabled={props.busy} /></label><label><span>Description</span><textarea rows={2} value={summary} onChange={event => setSummary(event.target.value)} disabled={props.busy} /></label><button type="submit" disabled={props.busy || !name.trim()}>+ Add World Object</button></form> : null}
    {linked.length === 0 ? <p className="empty-state">No World Objects attached yet.</p> : linked.map(record => <WorldRecordEditor key={record.id} kind="world-object" record={record} options={options} busy={props.busy} readOnly={props.readOnly} onSave={props.onSave} onArchive={props.onArchive} />)}
  </section>;
}

type LearnedDraft = Readonly<{
  prepared: boolean;
  enabled: boolean;
  usesRemaining: string;
  usesMaximum: string;
}>;

function learnedDraft(record: CampaignLearnedAbility): LearnedDraft {
  return {
    prepared: record.prepared,
    enabled: record.enabled,
    usesRemaining: record.usesRemaining === undefined ? '' : String(record.usesRemaining),
    usesMaximum: record.usesMaximum === undefined ? '' : String(record.usesMaximum),
  };
}

function sameLearnedDraft(left: LearnedDraft, right: LearnedDraft): boolean {
  return left.prepared === right.prepared
    && left.enabled === right.enabled
    && left.usesRemaining.trim() === right.usesRemaining
    && left.usesMaximum.trim() === right.usesMaximum;
}

function optionalUses(value: string): number | undefined {
  return value.trim() ? Number(value) : undefined;
}

function usesFields(usesRemaining: string, usesMaximum: string): Readonly<{
  usesRemaining?: number;
  usesMaximum?: number;
}> {
  const remaining = optionalUses(usesRemaining);
  const maximum = optionalUses(usesMaximum);
  return {
    ...(remaining === undefined ? {} : { usesRemaining: remaining }),
    ...(maximum === undefined ? {} : { usesMaximum: maximum }),
  };
}

function validUses(draft: LearnedDraft): boolean {
  const remaining = optionalUses(draft.usesRemaining);
  const maximum = optionalUses(draft.usesMaximum);
  return (remaining === undefined || (Number.isInteger(remaining) && remaining >= 0))
    && (maximum === undefined || (Number.isInteger(maximum) && maximum >= 0))
    && (remaining === undefined || maximum === undefined || remaining <= maximum);
}

function LearnedAbilityRow(props: {
  record: CampaignLearnedAbility;
  actor: CampaignActor | undefined;
  busy: boolean;
  readOnly: boolean;
  onSave: (id: string, draft: LearnedDraft) => Promise<void>;
  onArchive: (id: string, archived: boolean) => Promise<void>;
}) {
  const initial = learnedDraft(props.record);
  const [draft, setDraft] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  useEffect(() => {
    const next = learnedDraft(props.record);
    const dirty = !sameLearnedDraft(draft, baseline);
    setBaseline(next);
    if (!dirty) setDraft(next);
  }, [props.record.id, props.record.prepared, props.record.enabled, props.record.usesRemaining, props.record.usesMaximum, props.record.archived]);
  const dirty = !sameLearnedDraft(draft, baseline);
  return (
    <form className={props.record.archived ? 'learned-ability-row learned-ability-row--archived' : 'learned-ability-row'} onSubmit={event => {
      event.preventDefault();
      void props.onSave(props.record.id, draft);
    }}>
      <div className="learned-ability-row__actor">
        <strong>{props.actor?.name ?? props.record.actorId}</strong>
        <small>{props.record.archived ? 'Archived learning' : props.record.id}</small>
      </div>
      <label className="check-row"><input type="checkbox" checked={draft.prepared} onChange={event => setDraft(value => ({ ...value, prepared: event.target.checked }))} disabled={props.busy || props.readOnly || props.record.archived} /><span>Prepared</span></label>
      <label className="check-row"><input type="checkbox" checked={draft.enabled} onChange={event => setDraft(value => ({ ...value, enabled: event.target.checked }))} disabled={props.busy || props.readOnly || props.record.archived} /><span>Enabled</span></label>
      <label><span>Uses left</span><input type="number" min="0" step="1" value={draft.usesRemaining} onChange={event => setDraft(value => ({ ...value, usesRemaining: event.target.value }))} disabled={props.busy || props.readOnly || props.record.archived} placeholder="Unlimited" /></label>
      <label><span>Maximum</span><input type="number" min="0" step="1" value={draft.usesMaximum} onChange={event => setDraft(value => ({ ...value, usesMaximum: event.target.value }))} disabled={props.busy || props.readOnly || props.record.archived} placeholder="Untracked" /></label>
      <div className="record-actions">
        {!props.record.archived ? <button type="submit" disabled={props.busy || props.readOnly || !dirty || !validUses(draft)}>Save state</button> : null}
        <button type="button" className="button-secondary" disabled={props.busy || props.readOnly} onClick={() => { void props.onArchive(props.record.id, !props.record.archived); }}>{props.record.archived ? 'Restore' : 'Remove'}</button>
      </div>
      {!validUses(draft) ? <p className="field-error">Uses must be whole non-negative numbers; remaining cannot exceed maximum.</p> : null}
    </form>
  );
}

export function LearnedAbilitiesPanel(props: {
  ability: CampaignAbility;
  learned: readonly CampaignLearnedAbility[];
  actors: readonly CampaignActor[];
  busy: boolean;
  readOnly: boolean;
  onCreate: (actorId: string, draft: LearnedDraft) => Promise<void>;
  onSave: (id: string, draft: LearnedDraft) => Promise<void>;
  onArchive: (id: string, archived: boolean) => Promise<void>;
}) {
  const [actorId, setActorId] = useState('');
  const [draft, setDraft] = useState<LearnedDraft>({ prepared: false, enabled: true, usesRemaining: '', usesMaximum: '' });
  const linkedActorIds = new Set(props.learned.filter(record => !record.archived).map(record => record.actorId));
  const availableActors = props.actors.filter(actor => !actor.archived && !linkedActorIds.has(actor.id));
  const linkedKey = [...linkedActorIds].sort().join('\u0000');
  useEffect(() => {
    if (actorId && linkedActorIds.has(actorId)) {
      setActorId('');
      setDraft({ prepared: false, enabled: true, usesRemaining: '', usesMaximum: '' });
    }
  }, [actorId, linkedKey]);
  return (
    <section className="learned-abilities-panel" aria-labelledby="learned-abilities-heading">
      <div className="collection-heading">
        <div><h4 id="learned-abilities-heading">Known by Actors</h4><p>Add and edit who knows this Ability here. Removing archives the link.</p></div>
      </div>
      {!props.readOnly && !props.ability.archived ? (
        <form className="learned-ability-create" onSubmit={event => {
          event.preventDefault();
          if (!actorId || !validUses(draft)) return;
          void props.onCreate(actorId, draft);
        }}>
          <label><span>Actor</span><select value={actorId} onChange={event => setActorId(event.target.value)} disabled={props.busy}><option value="">Choose Actor</option>{availableActors.map(actor => <option key={actor.id} value={actor.id}>{actor.name}</option>)}</select></label>
          <label className="check-row"><input type="checkbox" checked={draft.prepared} onChange={event => setDraft(value => ({ ...value, prepared: event.target.checked }))} disabled={props.busy} /><span>Prepared</span></label>
          <label className="check-row"><input type="checkbox" checked={draft.enabled} onChange={event => setDraft(value => ({ ...value, enabled: event.target.checked }))} disabled={props.busy} /><span>Enabled</span></label>
          <label><span>Uses left</span><input type="number" min="0" step="1" value={draft.usesRemaining} onChange={event => setDraft(value => ({ ...value, usesRemaining: event.target.value }))} disabled={props.busy} placeholder="Unlimited" /></label>
          <label><span>Maximum</span><input type="number" min="0" step="1" value={draft.usesMaximum} onChange={event => setDraft(value => ({ ...value, usesMaximum: event.target.value }))} disabled={props.busy} placeholder="Untracked" /></label>
          <button type="submit" disabled={props.busy || !actorId || !validUses(draft)}>+ Add Actor</button>
        </form>
      ) : null}
      {availableActors.length === 0 && props.learned.length === 0 ? <p className="empty-state">Create an Actor first, then add them here.</p> : null}
      <div className="learned-ability-list">
        {props.learned.map(record => <LearnedAbilityRow key={record.id} record={record} actor={props.actors.find(actor => actor.id === record.actorId)} busy={props.busy} readOnly={props.readOnly} onSave={props.onSave} onArchive={props.onArchive} />)}
      </div>
    </section>
  );
}

type RelationshipDraft = Readonly<{
  sourceActorId: string;
  targetActorId: string;
  relationshipKind: string;
  status: CampaignRelationshipStatus;
  notes: string;
  visibility: NarratorVisibility;
}>;

function relationshipDraft(record: CampaignRelationship): RelationshipDraft {
  return {
    sourceActorId: record.sourceActorId,
    targetActorId: record.targetActorId,
    relationshipKind: record.kind,
    status: record.status,
    notes: record.notes,
    visibility: record.visibility ?? 'known',
  };
}

function sameRelationshipDraft(left: RelationshipDraft, right: RelationshipDraft): boolean {
  return left.sourceActorId === right.sourceActorId
    && left.targetActorId === right.targetActorId
    && left.relationshipKind.trim() === right.relationshipKind
    && left.status === right.status
    && left.notes.trim() === right.notes
    && left.visibility === right.visibility;
}

function RelationshipStatusOptions() {
  return <><option value="active">Active</option><option value="strained">Strained</option><option value="dormant">Dormant</option><option value="ended">Ended</option><option value="other">Other</option></>;
}

function RelationshipRow(props: {
  record: CampaignRelationship;
  actors: readonly CampaignActor[];
  busy: boolean;
  readOnly: boolean;
  onSave: (id: string, draft: RelationshipDraft) => Promise<void>;
  onArchive: (id: string, archived: boolean) => Promise<void>;
}) {
  const initial = relationshipDraft(props.record);
  const [draft, setDraft] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  useEffect(() => {
    const next = relationshipDraft(props.record);
    const dirty = !sameRelationshipDraft(draft, baseline);
    setBaseline(next);
    if (!dirty) setDraft(next);
  }, [props.record.id, props.record.sourceActorId, props.record.targetActorId, props.record.kind, props.record.status, props.record.notes, props.record.visibility, props.record.archived]);
  const dirty = !sameRelationshipDraft(draft, baseline);
  const selectableActors = props.actors.filter(actor => !actor.archived || actor.id === draft.sourceActorId || actor.id === draft.targetActorId);
  return (
    <form className={props.record.archived ? 'relationship-row relationship-row--archived' : 'relationship-row'} onSubmit={event => {
      event.preventDefault();
      void props.onSave(props.record.id, draft);
    }}>
      <div className="relationship-row__identity"><strong>{props.record.kind}</strong><small>{props.record.archived ? 'Archived relationship' : props.record.id}</small></div>
      <label><span>From</span><select aria-label="Relationship source" value={draft.sourceActorId} onChange={event => setDraft(value => ({ ...value, sourceActorId: event.target.value }))} disabled={props.busy || props.readOnly || props.record.archived}>{selectableActors.map(actor => <option key={actor.id} value={actor.id}>{actor.name}</option>)}</select></label>
      <label><span>To</span><select aria-label="Relationship target" value={draft.targetActorId} onChange={event => setDraft(value => ({ ...value, targetActorId: event.target.value }))} disabled={props.busy || props.readOnly || props.record.archived}>{selectableActors.map(actor => <option key={actor.id} value={actor.id}>{actor.name}</option>)}</select></label>
      <label><span>Kind</span><input value={draft.relationshipKind} onChange={event => setDraft(value => ({ ...value, relationshipKind: event.target.value }))} disabled={props.busy || props.readOnly || props.record.archived} placeholder="ally, rival, employer…" /></label>
      <label><span>Status</span><select value={draft.status} onChange={event => setDraft(value => ({ ...value, status: event.target.value as CampaignRelationshipStatus }))} disabled={props.busy || props.readOnly || props.record.archived}><RelationshipStatusOptions /></select></label>
      <label><span>Visibility</span><select value={draft.visibility} onChange={event => setDraft(value => ({ ...value, visibility: event.target.value as NarratorVisibility }))} disabled={props.busy || props.readOnly || props.record.archived}><option value="known">Known</option><option value="narrator_secret">Narrator secret</option><option value="campaign_private">Campaign private</option></select></label>
      <label className="relationship-row__notes"><span>Notes</span><textarea rows={2} value={draft.notes} onChange={event => setDraft(value => ({ ...value, notes: event.target.value }))} disabled={props.busy || props.readOnly || props.record.archived} /></label>
      <div className="record-actions">
        {!props.record.archived ? <button type="submit" disabled={props.busy || props.readOnly || !dirty || !draft.relationshipKind.trim() || draft.sourceActorId === draft.targetActorId}>Save Relationship</button> : null}
        <button type="button" className="button-secondary" disabled={props.busy || props.readOnly} onClick={() => { void props.onArchive(props.record.id, !props.record.archived); }}>{props.record.archived ? 'Restore' : 'Remove'}</button>
      </div>
    </form>
  );
}

export function RelationshipsPanel(props: {
  relationships: readonly CampaignRelationship[];
  actors: readonly CampaignActor[];
  focusActorId?: string;
  busy: boolean;
  readOnly: boolean;
  onCreate: (draft: RelationshipDraft) => Promise<void>;
  onSave: (id: string, draft: RelationshipDraft) => Promise<void>;
  onArchive: (id: string, archived: boolean) => Promise<void>;
}) {
  const activeActors = props.actors.filter(actor => !actor.archived);
  const defaultSource = props.focusActorId ?? activeActors[0]?.id ?? '';
  const [direction, setDirection] = useState<'outgoing' | 'incoming'>('outgoing');
  const [sourceActorId, setSourceActorId] = useState(defaultSource);
  const [targetActorId, setTargetActorId] = useState('');
  const [relationshipKind, setRelationshipKind] = useState('');
  const [status, setStatus] = useState<CampaignRelationshipStatus>('active');
  const [notes, setNotes] = useState('');
  const [visibility, setVisibility] = useState<NarratorVisibility>('known');
  const pendingCreate = useRef<RelationshipDraft | null>(null);
  const relationshipKey = props.relationships.map(record => `${record.id}:${record.archived}`).join('\u0000');
  useEffect(() => {
    const pending = pendingCreate.current;
    if (!pending || !props.relationships.some(record => !record.archived
      && record.sourceActorId === pending.sourceActorId
      && record.targetActorId === pending.targetActorId
      && record.kind === pending.relationshipKind)) return;
    pendingCreate.current = null;
    setTargetActorId('');
    setRelationshipKind('');
    setStatus('active');
    setNotes('');
    setVisibility('known');
  }, [relationshipKey]);
  useEffect(() => {
    if (props.focusActorId) setSourceActorId(props.focusActorId);
  }, [props.focusActorId]);
  const visible = props.focusActorId
    ? props.relationships.filter(record => record.sourceActorId === props.focusActorId || record.targetActorId === props.focusActorId)
    : props.relationships;
  const selectedSource = props.focusActorId
    ? direction === 'outgoing' ? props.focusActorId : targetActorId
    : sourceActorId;
  const selectedTarget = props.focusActorId
    ? direction === 'outgoing' ? targetActorId : props.focusActorId
    : targetActorId;
  const headingId = `relationships-heading-${props.focusActorId ?? 'all'}`;
  return (
    <section className="relationships-panel" aria-labelledby={headingId}>
      <div className="collection-heading"><div><h4 id={headingId}>Relationships</h4><p>Directed Actor links with explicit status and editable notes. Removing archives the link.</p></div></div>
      {!props.readOnly ? (
        <form className="relationship-create" onSubmit={event => {
          event.preventDefault();
          if (!selectedSource || !selectedTarget || selectedSource === selectedTarget || !relationshipKind.trim()) return;
          const draft = { sourceActorId: selectedSource, targetActorId: selectedTarget, relationshipKind, status, notes, visibility };
          pendingCreate.current = draft;
          void props.onCreate(draft);
        }}>
          {props.focusActorId ? <label><span>Direction</span><select value={direction} onChange={event => setDirection(event.target.value as 'outgoing' | 'incoming')} disabled={props.busy}><option value="outgoing">This Actor → other</option><option value="incoming">Other → this Actor</option></select></label> : <label><span>From</span><select aria-label="New relationship source" value={sourceActorId} onChange={event => setSourceActorId(event.target.value)} disabled={props.busy}><option value="">Choose Actor</option>{activeActors.map(actor => <option key={actor.id} value={actor.id}>{actor.name}</option>)}</select></label>}
          <label><span>{props.focusActorId ? 'Other Actor' : 'To'}</span><select aria-label="New relationship target" value={targetActorId} onChange={event => setTargetActorId(event.target.value)} disabled={props.busy}><option value="">Choose Actor</option>{activeActors.filter(actor => actor.id !== props.focusActorId).map(actor => <option key={actor.id} value={actor.id}>{actor.name}</option>)}</select></label>
          <label><span>Kind</span><input value={relationshipKind} onChange={event => setRelationshipKind(event.target.value)} disabled={props.busy} placeholder="ally, rival, employer…" /></label>
          <label><span>Status</span><select value={status} onChange={event => setStatus(event.target.value as CampaignRelationshipStatus)} disabled={props.busy}><RelationshipStatusOptions /></select></label>
          <label><span>Visibility</span><select value={visibility} onChange={event => setVisibility(event.target.value as NarratorVisibility)} disabled={props.busy}><option value="known">Known</option><option value="narrator_secret">Narrator secret</option><option value="campaign_private">Campaign private</option></select></label>
          <label className="relationship-create__notes"><span>Notes</span><textarea rows={2} value={notes} onChange={event => setNotes(event.target.value)} disabled={props.busy} placeholder="What this link means now" /></label>
          <button type="submit" disabled={props.busy || !selectedSource || !selectedTarget || selectedSource === selectedTarget || !relationshipKind.trim()}>+ Add Relationship</button>
        </form>
      ) : null}
      {activeActors.length < 2 && visible.length === 0 ? <p className="empty-state">Create at least two Actors to add a Relationship.</p> : null}
      <div className="relationship-list">
        {visible.map(record => <RelationshipRow key={record.id} record={record} actors={props.actors} busy={props.busy} readOnly={props.readOnly} onSave={props.onSave} onArchive={props.onArchive} />)}
      </div>
    </section>
  );
}

type SceneDraft = Readonly<{
  name: string;
  summary: string;
  placeId: string;
  actorIds: readonly string[];
  itemIds: readonly string[];
  worldObjectIds: readonly string[];
}>;

function sceneDraft(scene: CampaignScene | null): SceneDraft {
  return {
    name: scene?.name ?? '',
    summary: scene?.summary ?? '',
    placeId: scene?.placeId ?? '',
    actorIds: scene?.actorIds ?? [],
    itemIds: scene?.itemIds ?? [],
    worldObjectIds: scene?.worldObjectIds ?? [],
  };
}

function sameSceneDraft(left: SceneDraft, right: SceneDraft): boolean {
  return left.name.trim() === right.name.trim()
    && left.summary.trim() === right.summary.trim()
    && left.placeId === right.placeId
    && left.actorIds.join('\u0000') === right.actorIds.join('\u0000')
    && left.itemIds.join('\u0000') === right.itemIds.join('\u0000')
    && left.worldObjectIds.join('\u0000') === right.worldObjectIds.join('\u0000');
}

export function SceneEditor(props: {
  scene: CampaignScene | null;
  actors: readonly CampaignActor[];
  items: readonly CampaignItem[];
  places: readonly CampaignPlace[];
  worldObjects: readonly CampaignWorldObject[];
  busy: boolean;
  readOnly: boolean;
  onSave: (name: string, summary: string, placeId: string | null, actorIds: readonly string[], itemIds: readonly string[], worldObjectIds: readonly string[]) => Promise<void>;
}) {
  const canonical = sceneDraft(props.scene);
  const [draft, setDraft] = useState(canonical);
  const [baseline, setBaseline] = useState(canonical);
  const dirty = !sameSceneDraft(draft, baseline);
  const actorIdsKey = (props.scene?.actorIds ?? []).join('\u0000');
  const itemIdsKey = (props.scene?.itemIds ?? []).join('\u0000');
  const worldObjectIdsKey = (props.scene?.worldObjectIds ?? []).join('\u0000');

  useEffect(() => {
    const next = sceneDraft(props.scene);
    const wasDirty = !sameSceneDraft(draft, baseline);
    setBaseline(next);
    if (!wasDirty) setDraft(next);
  }, [props.scene?.id, props.scene?.name, props.scene?.summary, props.scene?.placeId, actorIdsKey, itemIdsKey, worldObjectIdsKey]);

  const toggle = (field: 'actorIds' | 'itemIds' | 'worldObjectIds', id: string) => setDraft(previous => ({
    ...previous,
    [field]: previous[field].includes(id)
      ? previous[field].filter(candidate => candidate !== id)
      : [...previous[field], id],
  }));

  return (
    <form className="record-card" onSubmit={event => {
      event.preventDefault();
      void props.onSave(draft.name, draft.summary, draft.placeId || null, draft.actorIds, draft.itemIds, draft.worldObjectIds);
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
        <fieldset>
          <legend>Present World Objects</legend>
          {props.worldObjects.length === 0 ? <p className="empty-state">No World Objects available.</p> : props.worldObjects.map(record => (
            <label key={record.id}>
              <input type="checkbox" checked={draft.worldObjectIds.includes(record.id)} onChange={() => toggle('worldObjectIds', record.id)} disabled={props.busy || props.readOnly || (record.archived && !draft.worldObjectIds.includes(record.id))} />
              <span>{record.name}{record.archived ? ' · archived' : ''}</span>
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

type AdvanceSceneDraft = Readonly<{
  closingSummary: string;
  outcomes: readonly string[];
  openThreads: readonly string[];
  nextName: string;
  nextSummary: string;
  nextPlaceId: string;
  actorIds: readonly string[];
  itemIds: readonly string[];
  worldObjectIds: readonly string[];
}>;

function advanceSceneDraft(scene: CampaignScene): AdvanceSceneDraft {
  return {
    closingSummary: scene.summary,
    outcomes: [''],
    openThreads: [''],
    nextName: '',
    nextSummary: '',
    nextPlaceId: scene.placeId ?? '',
    actorIds: scene.actorIds ?? [],
    itemIds: scene.itemIds ?? [],
    worldObjectIds: scene.worldObjectIds ?? [],
  };
}

function SceneNoteRows(props: {
  label: string;
  values: readonly string[];
  busy: boolean;
  onChange: (values: readonly string[]) => void;
}) {
  return (
    <fieldset className="scene-note-rows">
      <legend>{props.label}</legend>
      {props.values.map((value, index) => (
        <div className="scene-note-row" key={index}>
          <label><span>{props.label.slice(0, -1)} {index + 1}</span><input value={value} maxLength={1000} onChange={event => props.onChange(props.values.map((entry, candidate) => candidate === index ? event.target.value : entry))} disabled={props.busy} /></label>
          <button type="button" className="button-secondary" onClick={() => props.onChange(props.values.filter((_entry, candidate) => candidate !== index))} disabled={props.busy}>Remove</button>
        </div>
      ))}
      <button type="button" className="button-secondary" onClick={() => props.onChange([...props.values, ''])} disabled={props.busy || props.values.length >= 64}>+ Add {props.label.slice(0, -1).toLowerCase()}</button>
    </fieldset>
  );
}

export function AdvanceScenePanel(props: {
  scene: CampaignScene;
  actors: readonly CampaignActor[];
  items: readonly CampaignItem[];
  places: readonly CampaignPlace[];
  worldObjects: readonly CampaignWorldObject[];
  busy: boolean;
  onAdvance: (draft: AdvanceSceneDraft) => Promise<void>;
}) {
  const availableDraft = () => {
    const next = advanceSceneDraft(props.scene);
    const activeActorIds = new Set(props.actors.filter(record => !record.archived).map(record => record.id));
    const activeItemIds = new Set(props.items.filter(record => !record.archived).map(record => record.id));
    const activeWorldObjectIds = new Set(props.worldObjects.filter(record => !record.archived).map(record => record.id));
    const activePlaceIds = new Set(props.places.filter(record => !record.archived).map(record => record.id));
    return {
      ...next,
      nextPlaceId: activePlaceIds.has(next.nextPlaceId) ? next.nextPlaceId : '',
      actorIds: next.actorIds.filter(id => activeActorIds.has(id)),
      itemIds: next.itemIds.filter(id => activeItemIds.has(id)),
      worldObjectIds: next.worldObjectIds.filter(id => activeWorldObjectIds.has(id)),
    };
  };
  const [draft, setDraft] = useState(availableDraft);
  useEffect(() => setDraft(availableDraft()), [props.scene.id]);
  const toggle = (field: 'actorIds' | 'itemIds' | 'worldObjectIds', id: string) => setDraft(previous => ({
    ...previous,
    [field]: previous[field].includes(id)
      ? previous[field].filter(candidate => candidate !== id)
      : [...previous[field], id],
  }));
  return (
    <details className="advance-scene-panel">
      <summary><strong>Advance Scene</strong><span>Archive “{props.scene.name}” and open the next scene</span></summary>
      <form onSubmit={event => {
        event.preventDefault();
        void props.onAdvance({
          ...draft,
          outcomes: draft.outcomes.map(value => value.trim()).filter(Boolean),
          openThreads: draft.openThreads.map(value => value.trim()).filter(Boolean),
        });
      }}>
        <p className="form-note">One accepted mutation closes the current Scene into immutable history and opens the editable next Scene. Nothing is generated automatically; archived attachments are not carried forward.</p>
        <label><span>Closing summary</span><textarea rows={4} value={draft.closingSummary} onChange={event => setDraft(previous => ({ ...previous, closingSummary: event.target.value }))} disabled={props.busy} /></label>
        <div className="advance-scene-notes">
          <SceneNoteRows label="Outcomes" values={draft.outcomes} busy={props.busy} onChange={outcomes => setDraft(previous => ({ ...previous, outcomes }))} />
          <SceneNoteRows label="Open threads" values={draft.openThreads} busy={props.busy} onChange={openThreads => setDraft(previous => ({ ...previous, openThreads }))} />
        </div>
        <div className="advance-scene-next">
          <div className="collection-heading"><div><h5>Next Scene</h5><p>Start from carried attachments, then change anything that should not continue.</p></div></div>
          <label><span>Name</span><input value={draft.nextName} onChange={event => setDraft(previous => ({ ...previous, nextName: event.target.value }))} disabled={props.busy} placeholder="What happens next?" /></label>
          <label><span>Place</span><select value={draft.nextPlaceId} onChange={event => setDraft(previous => ({ ...previous, nextPlaceId: event.target.value }))} disabled={props.busy}><option value="">No attached Place</option>{props.places.filter(record => !record.archived || record.id === draft.nextPlaceId).map(record => <option key={record.id} value={record.id}>{record.name}{record.archived ? ' · archived' : ''}</option>)}</select></label>
          <label><span>Opening situation</span><textarea rows={4} value={draft.nextSummary} onChange={event => setDraft(previous => ({ ...previous, nextSummary: event.target.value }))} disabled={props.busy} /></label>
          <div className="scene-attachments">
            <fieldset><legend>Carry Actors</legend>{props.actors.filter(record => !record.archived || draft.actorIds.includes(record.id)).map(record => <label key={record.id}><input type="checkbox" checked={draft.actorIds.includes(record.id)} onChange={() => toggle('actorIds', record.id)} disabled={props.busy || record.archived} /><span>{record.name}</span></label>)}</fieldset>
            <fieldset><legend>Carry Items</legend>{props.items.filter(record => !record.archived || draft.itemIds.includes(record.id)).map(record => <label key={record.id}><input type="checkbox" checked={draft.itemIds.includes(record.id)} onChange={() => toggle('itemIds', record.id)} disabled={props.busy || record.archived} /><span>{record.name}</span></label>)}</fieldset>
            <fieldset><legend>Carry World Objects</legend>{props.worldObjects.filter(record => !record.archived || draft.worldObjectIds.includes(record.id)).map(record => <label key={record.id}><input type="checkbox" checked={draft.worldObjectIds.includes(record.id)} onChange={() => toggle('worldObjectIds', record.id)} disabled={props.busy || record.archived} /><span>{record.name}</span></label>)}</fieldset>
          </div>
        </div>
        <div className="sticky-action-bar"><button type="submit" disabled={props.busy || !draft.nextName.trim()}>Close current and open next</button></div>
      </form>
    </details>
  );
}

export function SceneArchiveList(props: { archives: readonly CampaignSceneArchive[]; places: readonly CampaignPlace[] }) {
  return (
    <details className="scene-archive-list">
      <summary><strong>Past Scenes</strong><span>{props.archives.length} immutable</span></summary>
      {props.archives.length === 0 ? <p className="empty-state">No Scene has been closed yet.</p> : (
        <ol>
          {props.archives.map(archive => (
            <li key={archive.id}>
              <article className="scene-archive-card">
                <div className="record-card__heading"><strong>{archive.name}</strong><span>{new Date(archive.closedAt).toLocaleString()}</span></div>
                {archive.placeId ? <p className="record-meta">{props.places.find(place => place.id === archive.placeId)?.name ?? archive.placeId}</p> : null}
                <p>{archive.summary || 'No closing summary.'}</p>
                {archive.outcomes.length ? <div><strong>Outcomes</strong><ul>{archive.outcomes.map(value => <li key={value}>{value}</li>)}</ul></div> : null}
                {archive.openThreads.length ? <div><strong>Open threads</strong><ul>{archive.openThreads.map(value => <li key={value}>{value}</li>)}</ul></div> : null}
              </article>
            </li>
          ))}
        </ol>
      )}
    </details>
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
  if (collection === 'abilities') {
    const ability = record as CampaignAbility;
    const learnedCount = (document.learnedAbilities ?? []).filter(entry => entry.abilityId === ability.id && !entry.archived).length;
    return `${ability.category} · ${learnedCount} Actor${learnedCount === 1 ? '' : 's'}`;
  }
  if (collection === 'facts') {
    const fact = record as CampaignFact;
    return fact.subjectId ? subjectOptions(document).find(option => option.id === fact.subjectId)?.label ?? 'Unknown Record' : 'Campaign-wide';
  }
  if (collection === 'world-objects') {
    const worldObject = record as CampaignWorldObject;
    return worldObject.placeId
      ? document.places.find(place => place.id === worldObject.placeId)?.name ?? 'Unknown Place'
      : 'No Place';
  }
  return record.archived ? 'Archived' : 'Active';
}

function subjectOptions(document: CampaignDocument): SubjectOption[] {
  const groups: ReadonlyArray<readonly [string, readonly CommonRecord[]]> = [
    ['Actor', document.actors],
    ['Item', document.items],
    ['Quest', document.quests],
    ['Place', document.places],
    ['Ability', document.abilities ?? []],
    ['World Object', document.worldObjects ?? []],
  ];
  return groups.flatMap(([kind, records]) => records.map(record => ({
    id: record.id,
    label: `${kind} · ${record.name}`,
    archived: record.archived,
  }))).sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
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
  const [factName, setFactName] = useState('');
  const [factSummary, setFactSummary] = useState('');
  const [factSubjectId, setFactSubjectId] = useState('');
  const [worldObjectName, setWorldObjectName] = useState('');
  const [worldObjectSummary, setWorldObjectSummary] = useState('');
  const [worldObjectPlaceId, setWorldObjectPlaceId] = useState('');
  const [abilityName, setAbilityName] = useState('');
  const [abilitySummary, setAbilitySummary] = useState('');
  const [abilityCategory, setAbilityCategory] = useState<CampaignAbilityCategory>('spell');
  const [abilityActorId, setAbilityActorId] = useState('');
  const [abilityPrepared, setAbilityPrepared] = useState(false);
  const [abilityEnabled, setAbilityEnabled] = useState(true);
  const [abilityUsesRemaining, setAbilityUsesRemaining] = useState('');
  const [abilityUsesMaximum, setAbilityUsesMaximum] = useState('');
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

  async function createAbility(event: FormEvent) {
    event.preventDefault();
    const usesDraft: LearnedDraft = {
      prepared: abilityPrepared,
      enabled: abilityEnabled,
      usesRemaining: abilityUsesRemaining,
      usesMaximum: abilityUsesMaximum,
    };
    if (!validUses(usesDraft)) return;
    await run(async () => {
      const definition = { name: abilityName, summary: abilitySummary, category: abilityCategory };
      const remaining = optionalUses(abilityUsesRemaining);
      const maximum = optionalUses(abilityUsesMaximum);
      const commit = abilityActorId
        ? await executeOperation({
          kind: 'create_ability_with_learning',
          ability: definition,
          learnedAbility: {
            actorId: abilityActorId,
            prepared: abilityPrepared,
            enabled: abilityEnabled,
            ...(remaining === undefined ? {} : { usesRemaining: remaining }),
            ...(maximum === undefined ? {} : { usesMaximum: maximum }),
          },
        })
        : await executeOperation({ kind: 'create_ability', ability: definition });
      setAbilityName('');
      setAbilitySummary('');
      setAbilityCategory('spell');
      setAbilityActorId('');
      setAbilityPrepared(false);
      setAbilityEnabled(true);
      setAbilityUsesRemaining('');
      setAbilityUsesMaximum('');
      navigateCollection('abilities', commit.affectedIds[0] ?? null);
    });
  }

  async function createFact(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const commit = await executeOperation({
        kind: 'create_fact',
        fact: {
          name: factName,
          summary: factSummary,
          ...(factSubjectId ? { subjectId: factSubjectId } : {}),
        },
      });
      setFactName('');
      setFactSummary('');
      setFactSubjectId('');
      navigateCollection('facts', commit.affectedIds[0] ?? null);
    });
  }

  async function createWorldObject(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const commit = await executeOperation({
        kind: 'create_world_object',
        worldObject: {
          name: worldObjectName,
          summary: worldObjectSummary,
          ...(worldObjectPlaceId ? { placeId: worldObjectPlaceId } : {}),
        },
      });
      setWorldObjectName('');
      setWorldObjectSummary('');
      setWorldObjectPlaceId('');
      navigateCollection('world-objects', commit.affectedIds[0] ?? null);
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
  const ability = route.collection === 'abilities' && recordId
    ? (displayed?.abilities ?? []).find(record => record.id === recordId) ?? null
    : null;
  const fact = route.collection === 'facts' && recordId
    ? (displayed?.facts ?? []).find(record => record.id === recordId) ?? null
    : null;
  const worldObject = route.collection === 'world-objects' && recordId
    ? (displayed?.worldObjects ?? []).find(record => record.id === recordId) ?? null
    : null;
  const availableSubjects = displayed ? subjectOptions(displayed) : [];
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
          <p>Routed Actors, Items, Abilities, Relationships, Quests, Facts, Places, World Objects, Scene, and immutable history backed by one SQLite authority.</p>
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
                  campaignId={displayed.campaign.id}
                  campaignRevision={displayed.campaign.revision}
                  onLinked={binding => setBindings(current => [
                    ...current.filter(candidate => candidate.id !== binding.id),
                    binding,
                  ])}
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
                        <>
                          <RecordEditor
                            kind="actor"
                            record={actor}
                            actors={displayed.actors}
                            busy={busy}
                            readOnly={readOnly}
                            onSave={(actorId, name, summary, aliases, visibility) => run(() => executeOperation({ kind: 'update_actor', actorId, name, summary, aliases: [...aliases], visibility }).then(() => undefined))}
                            onArchive={(actorId, archived) => run(() => executeOperation({ kind: 'set_actor_archived', actorId, archived }).then(() => undefined))}
                          />
                          <RelationshipsPanel
                            relationships={displayed.relationships ?? []}
                            actors={displayed.actors}
                            focusActorId={actor.id}
                            busy={busy}
                            readOnly={readOnly || actor.archived}
                            onCreate={draft => run(() => executeOperation({ kind: 'create_relationship', relationship: {
                              sourceActorId: draft.sourceActorId, targetActorId: draft.targetActorId,
                              kind: draft.relationshipKind, status: draft.status, notes: draft.notes, visibility: draft.visibility,
                            } }).then(() => undefined))}
                            onSave={(relationshipId, draft) => run(() => executeOperation({ kind: 'update_relationship',
                              relationshipId, sourceActorId: draft.sourceActorId, targetActorId: draft.targetActorId,
                              relationshipKind: draft.relationshipKind, status: draft.status, notes: draft.notes, visibility: draft.visibility,
                            }).then(() => undefined))}
                            onArchive={(relationshipId, archived) => run(() => executeOperation({ kind: 'set_relationship_archived', relationshipId, archived }).then(() => undefined))}
                          />
                          <LinkedFactsPanel
                            facts={displayed.facts ?? []}
                            subjectId={actor.id}
                            subjectLabel={actor.name}
                            options={availableSubjects}
                            busy={busy}
                            readOnly={readOnly || actor.archived}
                            onCreate={(name, summary, visibility) => run(() => executeOperation({ kind: 'create_fact', fact: { name, summary, visibility, subjectId: actor.id } }).then(() => undefined))}
                            onSave={(factId, draft) => run(() => executeOperation({ kind: 'update_fact', factId, name: draft.name, summary: draft.summary, aliases: [...draft.aliases], visibility: draft.visibility, subjectId: draft.relationId || null }).then(() => undefined))}
                            onArchive={(factId, archived) => run(() => executeOperation({ kind: 'set_fact_archived', factId, archived }).then(() => undefined))}
                          />
                        </>
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
                      {item ? (<>
                        <RecordEditor
                          kind="item"
                          record={item}
                          actors={displayed.actors}
                          busy={busy}
                          readOnly={readOnly}
                           onSave={(itemId, name, summary, aliases, visibility, ownerActorId) => run(() => executeOperation({ kind: 'update_item', itemId, name, summary, aliases: [...aliases], visibility, ownerActorId }).then(() => undefined))}
                          onArchive={(itemId, archived) => run(() => executeOperation({ kind: 'set_item_archived', itemId, archived }).then(() => undefined))}
                        />
                        <LinkedFactsPanel facts={displayed.facts ?? []} subjectId={item.id} subjectLabel={item.name} options={availableSubjects} busy={busy} readOnly={readOnly || item.archived}
                          onCreate={(name, summary, visibility) => run(() => executeOperation({ kind: 'create_fact', fact: { name, summary, visibility, subjectId: item.id } }).then(() => undefined))}
                          onSave={(factId, draft) => run(() => executeOperation({ kind: 'update_fact', factId, name: draft.name, summary: draft.summary, aliases: [...draft.aliases], visibility: draft.visibility, subjectId: draft.relationId || null }).then(() => undefined))}
                          onArchive={(factId, archived) => run(() => executeOperation({ kind: 'set_fact_archived', factId, archived }).then(() => undefined))} />
                      </>) : <p className="error-banner">Item {recordId} does not exist in this revision.</p>}
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
                      {quest ? (<>
                        <RecordEditor
                          kind="quest"
                          record={quest}
                          actors={displayed.actors}
                          busy={busy}
                          readOnly={readOnly}
                           onSave={(questId, name, summary, aliases, visibility, status) => run(() => executeOperation({ kind: 'update_quest', questId, name, summary, aliases: [...aliases], visibility, status }).then(() => undefined))}
                          onArchive={(questId, archived) => run(() => executeOperation({ kind: 'set_quest_archived', questId, archived }).then(() => undefined))}
                        />
                        <LinkedFactsPanel facts={displayed.facts ?? []} subjectId={quest.id} subjectLabel={quest.name} options={availableSubjects} busy={busy} readOnly={readOnly || quest.archived}
                          onCreate={(name, summary, visibility) => run(() => executeOperation({ kind: 'create_fact', fact: { name, summary, visibility, subjectId: quest.id } }).then(() => undefined))}
                          onSave={(factId, draft) => run(() => executeOperation({ kind: 'update_fact', factId, name: draft.name, summary: draft.summary, aliases: [...draft.aliases], visibility: draft.visibility, subjectId: draft.relationId || null }).then(() => undefined))}
                          onArchive={(factId, archived) => run(() => executeOperation({ kind: 'set_fact_archived', factId, archived }).then(() => undefined))} />
                      </>) : <p className="error-banner">Quest {recordId} does not exist in this revision.</p>}
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
                      {place ? (<>
                        <RecordEditor
                          kind="place"
                          record={place}
                          actors={displayed.actors}
                          busy={busy}
                          readOnly={readOnly}
                          onSave={(placeId, name, summary, aliases, visibility) => run(() => executeOperation({ kind: 'update_place', placeId, name, summary, aliases: [...aliases], visibility }).then(() => undefined))}
                          onArchive={(placeId, archived) => run(() => executeOperation({ kind: 'set_place_archived', placeId, archived }).then(() => undefined))}
                        />
                        <PlaceWorldObjectsPanel
                          worldObjects={displayed.worldObjects ?? []}
                          placeId={place.id}
                          placeLabel={place.name}
                          places={displayed.places}
                          busy={busy}
                          readOnly={readOnly || place.archived}
                          onCreate={(name, summary) => run(() => executeOperation({ kind: 'create_world_object', worldObject: { name, summary, placeId: place.id } }).then(() => undefined))}
                          onSave={(worldObjectId, draft) => run(() => executeOperation({ kind: 'update_world_object', worldObjectId, name: draft.name, summary: draft.summary, aliases: [...draft.aliases], visibility: draft.visibility, placeId: draft.relationId || null }).then(() => undefined))}
                          onArchive={(worldObjectId, archived) => run(() => executeOperation({ kind: 'set_world_object_archived', worldObjectId, archived }).then(() => undefined))}
                        />
                        <LinkedFactsPanel
                          facts={displayed.facts ?? []}
                          subjectId={place.id}
                          subjectLabel={place.name}
                          options={availableSubjects}
                          busy={busy}
                          readOnly={readOnly || place.archived}
                          onCreate={(name, summary, visibility) => run(() => executeOperation({ kind: 'create_fact', fact: { name, summary, visibility, subjectId: place.id } }).then(() => undefined))}
                          onSave={(factId, draft) => run(() => executeOperation({ kind: 'update_fact', factId, name: draft.name, summary: draft.summary, aliases: [...draft.aliases], visibility: draft.visibility, subjectId: draft.relationId || null }).then(() => undefined))}
                          onArchive={(factId, archived) => run(() => executeOperation({ kind: 'set_fact_archived', factId, archived }).then(() => undefined))}
                        />
                      </>) : <p className="error-banner">Place {recordId} does not exist in this revision.</p>}
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

              {route.collection === 'facts' ? (
                <section className="collection-view" aria-labelledby="facts-heading">
                  <div className="collection-heading"><div><h4 id="facts-heading">Facts</h4><p>Durable Campaign truths, optionally attached to a specific Record.</p></div></div>
                  {recordId ? (<><RecordRouteHeader route={route} onNavigate={navigate} />
                    {fact ? <WorldRecordEditor kind="fact" record={fact} options={availableSubjects} busy={busy} readOnly={readOnly}
                      onSave={(factId, draft) => run(() => executeOperation({ kind: 'update_fact', factId, name: draft.name, summary: draft.summary, aliases: [...draft.aliases], visibility: draft.visibility, subjectId: draft.relationId || null }).then(() => undefined))}
                      onArchive={(factId, archived) => run(() => executeOperation({ kind: 'set_fact_archived', factId, archived }).then(() => undefined))} />
                      : <p className="error-banner">Fact {recordId} does not exist in this revision.</p>}
                  </>) : (<>
                    {!readOnly ? <form className="create-record-form" onSubmit={createFact}>
                      <label><span>Fact name</span><input value={factName} onChange={event => setFactName(event.target.value)} disabled={busy} /></label>
                      <label><span>Statement</span><textarea rows={3} value={factSummary} onChange={event => setFactSummary(event.target.value)} disabled={busy} /></label>
                      <label><span>About Record</span><select value={factSubjectId} onChange={event => setFactSubjectId(event.target.value)} disabled={busy}><option value="">Campaign-wide</option>{availableSubjects.filter(option => !option.archived).map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
                      <button type="submit" disabled={busy || !factName.trim()}>Create Fact</button>
                    </form> : null}
                    <RecordIndex collection="facts" records={displayed.facts ?? []} document={displayed} route={route} onNavigate={navigate} />
                  </>)}
                </section>
              ) : null}

              {route.collection === 'world-objects' ? (
                <section className="collection-view" aria-labelledby="world-objects-heading">
                  <div className="collection-heading"><div><h4 id="world-objects-heading">World Objects</h4><p>Persistent non-portable objects and features, with optional Place attachment.</p></div></div>
                  {recordId ? (<><RecordRouteHeader route={route} onNavigate={navigate} />
                    {worldObject ? <>
                      <WorldRecordEditor kind="world-object" record={worldObject} options={displayed.places.map(record => ({ id: record.id, label: record.name, archived: record.archived }))} busy={busy} readOnly={readOnly}
                        onSave={(worldObjectId, draft) => run(() => executeOperation({ kind: 'update_world_object', worldObjectId, name: draft.name, summary: draft.summary, aliases: [...draft.aliases], visibility: draft.visibility, placeId: draft.relationId || null }).then(() => undefined))}
                        onArchive={(worldObjectId, archived) => run(() => executeOperation({ kind: 'set_world_object_archived', worldObjectId, archived }).then(() => undefined))} />
                      <LinkedFactsPanel facts={displayed.facts ?? []} subjectId={worldObject.id} subjectLabel={worldObject.name} options={availableSubjects} busy={busy} readOnly={readOnly || worldObject.archived}
                        onCreate={(name, summary, visibility) => run(() => executeOperation({ kind: 'create_fact', fact: { name, summary, visibility, subjectId: worldObject.id } }).then(() => undefined))}
                        onSave={(factId, draft) => run(() => executeOperation({ kind: 'update_fact', factId, name: draft.name, summary: draft.summary, aliases: [...draft.aliases], visibility: draft.visibility, subjectId: draft.relationId || null }).then(() => undefined))}
                        onArchive={(factId, archived) => run(() => executeOperation({ kind: 'set_fact_archived', factId, archived }).then(() => undefined))} />
                    </> : <p className="error-banner">World Object {recordId} does not exist in this revision.</p>}
                  </>) : (<>
                    {!readOnly ? <form className="create-record-form" onSubmit={createWorldObject}>
                      <label><span>World Object name</span><input value={worldObjectName} onChange={event => setWorldObjectName(event.target.value)} disabled={busy} /></label>
                      <label><span>Description</span><textarea rows={3} value={worldObjectSummary} onChange={event => setWorldObjectSummary(event.target.value)} disabled={busy} /></label>
                      <label><span>Place</span><select value={worldObjectPlaceId} onChange={event => setWorldObjectPlaceId(event.target.value)} disabled={busy}><option value="">No attached Place</option>{displayed.places.filter(record => !record.archived).map(record => <option key={record.id} value={record.id}>{record.name}</option>)}</select></label>
                      <button type="submit" disabled={busy || !worldObjectName.trim()}>Create World Object</button>
                    </form> : null}
                    <RecordIndex collection="world-objects" records={displayed.worldObjects ?? []} document={displayed} route={route} onNavigate={navigate} />
                  </>)}
                </section>
              ) : null}

              {route.collection === 'abilities' ? (
                <section className="collection-view" aria-labelledby="abilities-heading">
                  <div className="collection-heading"><div><h4 id="abilities-heading">Abilities</h4><p>Reusable spells, skills, feats, and their live Actor state.</p></div></div>
                  {recordId ? (
                    <>
                      <RecordRouteHeader route={route} onNavigate={navigate} />
                      {ability ? (
                        <>
                          <RecordEditor
                            kind="ability"
                            record={ability}
                            actors={displayed.actors}
                            busy={busy}
                            readOnly={readOnly}
                            onSave={(abilityId, name, summary, aliases, visibility, category) => run(() => executeOperation({ kind: 'update_ability', abilityId, name, summary, aliases: [...aliases], visibility, category }).then(() => undefined))}
                            onArchive={(abilityId, archived) => run(() => executeOperation({ kind: 'set_ability_archived', abilityId, archived }).then(() => undefined))}
                          />
                          <LearnedAbilitiesPanel
                            ability={ability}
                            learned={(displayed.learnedAbilities ?? []).filter(entry => entry.abilityId === ability.id)}
                            actors={displayed.actors}
                            busy={busy}
                            readOnly={readOnly}
                            onCreate={(actorId, draft) => run(() => executeOperation({
                              kind: 'create_learned_ability',
                              learnedAbility: {
                                abilityId: ability.id,
                                actorId,
                                prepared: draft.prepared,
                                enabled: draft.enabled,
                                ...usesFields(draft.usesRemaining, draft.usesMaximum),
                              },
                            }).then(() => undefined))}
                            onSave={(learnedAbilityId, draft) => run(() => executeOperation({
                              kind: 'update_learned_ability',
                              learnedAbilityId,
                              prepared: draft.prepared,
                              enabled: draft.enabled,
                              usesRemaining: optionalUses(draft.usesRemaining) ?? null,
                              usesMaximum: optionalUses(draft.usesMaximum) ?? null,
                            }).then(() => undefined))}
                            onArchive={(learnedAbilityId, archived) => run(() => executeOperation({ kind: 'set_learned_ability_archived', learnedAbilityId, archived }).then(() => undefined))}
                          />
                          <LinkedFactsPanel facts={displayed.facts ?? []} subjectId={ability.id} subjectLabel={ability.name} options={availableSubjects} busy={busy} readOnly={readOnly || ability.archived}
                            onCreate={(name, summary, visibility) => run(() => executeOperation({ kind: 'create_fact', fact: { name, summary, visibility, subjectId: ability.id } }).then(() => undefined))}
                            onSave={(factId, draft) => run(() => executeOperation({ kind: 'update_fact', factId, name: draft.name, summary: draft.summary, aliases: [...draft.aliases], visibility: draft.visibility, subjectId: draft.relationId || null }).then(() => undefined))}
                            onArchive={(factId, archived) => run(() => executeOperation({ kind: 'set_fact_archived', factId, archived }).then(() => undefined))} />
                        </>
                      ) : <p className="error-banner">Ability {recordId} does not exist in this revision.</p>}
                    </>
                  ) : (
                    <>
                      {!readOnly ? (
                        <form className="create-record-form ability-create-form" onSubmit={createAbility}>
                          <label><span>Ability name</span><input value={abilityName} onChange={event => setAbilityName(event.target.value)} disabled={busy} /></label>
                          <label><span>Summary</span><textarea rows={3} value={abilitySummary} onChange={event => setAbilitySummary(event.target.value)} disabled={busy} /></label>
                          <label><span>Category</span><select value={abilityCategory} onChange={event => setAbilityCategory(event.target.value as CampaignAbilityCategory)} disabled={busy}><option value="spell">Spell</option><option value="skill">Skill</option><option value="feat">Feat</option><option value="other">Other</option></select></label>
                          <fieldset className="ability-learning-create">
                            <legend>Learn now (optional)</legend>
                            <label><span>Actor</span><select value={abilityActorId} onChange={event => setAbilityActorId(event.target.value)} disabled={busy}><option value="">Definition only</option>{activeActors.map(record => <option key={record.id} value={record.id}>{record.name}</option>)}</select></label>
                            {abilityActorId ? <>
                              <label className="check-row"><input type="checkbox" checked={abilityPrepared} onChange={event => setAbilityPrepared(event.target.checked)} disabled={busy} /><span>Prepared</span></label>
                              <label className="check-row"><input type="checkbox" checked={abilityEnabled} onChange={event => setAbilityEnabled(event.target.checked)} disabled={busy} /><span>Enabled</span></label>
                              <label><span>Uses left</span><input type="number" min="0" step="1" value={abilityUsesRemaining} onChange={event => setAbilityUsesRemaining(event.target.value)} disabled={busy} placeholder="Unlimited" /></label>
                              <label><span>Maximum</span><input type="number" min="0" step="1" value={abilityUsesMaximum} onChange={event => setAbilityUsesMaximum(event.target.value)} disabled={busy} placeholder="Untracked" /></label>
                            </> : null}
                          </fieldset>
                          <button type="submit" disabled={busy || !abilityName.trim() || !validUses({ prepared: abilityPrepared, enabled: abilityEnabled, usesRemaining: abilityUsesRemaining, usesMaximum: abilityUsesMaximum })}>Create Ability{abilityActorId ? ' and learn it' : ''}</button>
                        </form>
                      ) : null}
                      <RecordIndex collection="abilities" records={displayed.abilities ?? []} document={displayed} route={route} onNavigate={navigate} />
                    </>
                  )}
                </section>
              ) : null}

              {route.collection === 'relationships' ? (
                <section className="collection-view" aria-labelledby="relationships-collection-heading">
                  <div className="collection-heading"><div><h4 id="relationships-collection-heading">All Relationships</h4><p>Create and maintain directed links without leaving this collection.</p></div></div>
                  <RelationshipsPanel
                    relationships={displayed.relationships ?? []}
                    actors={displayed.actors}
                    busy={busy}
                    readOnly={readOnly}
                    onCreate={draft => run(() => executeOperation({ kind: 'create_relationship', relationship: {
                      sourceActorId: draft.sourceActorId, targetActorId: draft.targetActorId,
                      kind: draft.relationshipKind, status: draft.status, notes: draft.notes, visibility: draft.visibility,
                    } }).then(() => undefined))}
                    onSave={(relationshipId, draft) => run(() => executeOperation({ kind: 'update_relationship',
                      relationshipId, sourceActorId: draft.sourceActorId, targetActorId: draft.targetActorId,
                      relationshipKind: draft.relationshipKind, status: draft.status, notes: draft.notes, visibility: draft.visibility,
                    }).then(() => undefined))}
                    onArchive={(relationshipId, archived) => run(() => executeOperation({ kind: 'set_relationship_archived', relationshipId, archived }).then(() => undefined))}
                  />
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
                    worldObjects={displayed.worldObjects ?? []}
                    busy={busy}
                    readOnly={readOnly}
                    onSave={(name, summary, placeId, actorIds, itemIds, worldObjectIds) => run(() => executeOperation({
                      kind: 'set_current_scene',
                      scene: {
                        name,
                        summary,
                        ...(placeId ? { placeId } : {}),
                        actorIds: [...actorIds],
                        itemIds: [...itemIds],
                        worldObjectIds: [...worldObjectIds],
                      },
                    }).then(() => undefined))}
                  />
                  {!readOnly && displayed.currentScene ? (
                    <AdvanceScenePanel
                      scene={displayed.currentScene}
                      actors={displayed.actors}
                      items={displayed.items}
                      places={displayed.places}
                      worldObjects={displayed.worldObjects ?? []}
                      busy={busy}
                      onAdvance={draft => run(() => executeOperation({
                        kind: 'advance_scene',
                        closingSummary: draft.closingSummary,
                        outcomes: [...draft.outcomes],
                        openThreads: [...draft.openThreads],
                        nextScene: {
                          name: draft.nextName,
                          summary: draft.nextSummary,
                          ...(draft.nextPlaceId ? { placeId: draft.nextPlaceId } : {}),
                          actorIds: [...draft.actorIds],
                          itemIds: [...draft.itemIds],
                          worldObjectIds: [...draft.worldObjectIds],
                        },
                      }).then(() => undefined))}
                    />
                  ) : null}
                  <SceneArchiveList archives={displayed.sceneArchives ?? []} places={displayed.places} />
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
