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
  type CampaignRelationship,
  type CampaignRelationshipStatus,
  type CampaignScene,
  type CampaignSceneArchive,
  type CampaignSummary,
  type CampaignWorldObject,
  type NarratorVisibility,
} from '@st-llm-rpg/wire';
import type { ChatBindingDocument } from '@st-llm-rpg/wire';
import LegacyImportPanel, { ChatBindingsPanel } from './LegacyImportPanel.js';
import { ContextTray } from './ContextTray.js';
import { StorySyncReviewInbox } from './StorySyncReviewInbox.js';
import { CampaignRecordIndex, RecordRouteHeader } from './CampaignRecordIndex.js';
import { CampaignSearch } from './CampaignSearch.js';
import { CampaignCollectionCreator } from './CampaignCollectionCreator.js';
import {
  collectionLabel,
  type CollectionKey,
  parseWorkspacePath,
  type WorkspaceRoute,
  WorkspaceNavigationProvider,
  useWorkspaceDirtyDraft,
  useWorkspaceNavigation,
  workspaceHref,
} from './workspace-navigation.js';
import {
  ApiProblem,
  conflictFrom,
  fetchJson,
  newRequestId,
  type RevisionConflict,
} from './workspace-api.js';
import {
  WorkspaceProblemBanner,
  workspaceFailure,
  type WorkspaceFailure,
} from './WorkspaceProblemBanner.js';
import { SessionHome } from './SessionHome.js';
import { PlayerGuide } from './PlayerGuide.js';
import {
  CampaignCommandDeck,
  CampaignHistoryView,
  CollectionNavigation,
  RevisionConflictBanner,
  syncLabel,
  WorkspaceRouteState,
  type WorkspaceSyncState,
} from './CampaignWorkspaceShell.js';
import {
  LinkedFactsPanel,
  PlaceWorldObjectsPanel,
  RecordEditor,
  WorldRecordEditor,
  type SubjectOption,
} from './CampaignRecordEditors.js';
import {
  LearnedAbilitiesPanel,
  RelationshipsPanel,
  optionalUses,
  usesFields,
} from './CampaignActorPanels.js';
import {
  ActorTrackersPanel,
  normalizedTrackerDraft,
} from './ActorTrackersPanel.js';
import { RelationshipMap } from './RelationshipMap.js';
import {
  AdvanceScenePanel,
  SceneArchiveList,
  SceneEditor,
} from './CampaignScenePanels.js';

export { parseWorkspacePath } from './workspace-navigation.js';
export {
  CampaignCommandDeck,
  CampaignHistoryView,
  RevisionConflictBanner,
  WorkspaceRouteState,
} from './CampaignWorkspaceShell.js';
export {
  LinkedFactsPanel,
  PlaceWorldObjectsPanel,
  RecordEditor,
  WorldRecordEditor,
} from './CampaignRecordEditors.js';
export { LearnedAbilitiesPanel, RelationshipsPanel } from './CampaignActorPanels.js';
export { ActorTrackersPanel, normalizedTrackerDraft } from './ActorTrackersPanel.js';
export { RelationshipMap } from './RelationshipMap.js';
export { AdvanceScenePanel, SceneArchiveList, SceneEditor } from './CampaignScenePanels.js';

type SyncState = WorkspaceSyncState;
type RouteLoadState =
  | Readonly<{ phase: 'idle' }>
  | Readonly<{ phase: 'loading'; title: string }>
  | Readonly<{ phase: 'error'; title: string; message: string }>;
type CanonicalUpdate = Readonly<{
  document: CampaignDocument;
  history: CampaignHistoryEntry[];
}>;
function subjectOptions(document: CampaignDocument): SubjectOption[] {
  const groups: ReadonlyArray<readonly [string, readonly Readonly<{ id: string; name: string; archived: boolean }>[]]> = [
    ['Actor', document.actors],
    ['Item', document.items],
    ['Quest', document.quests],
    ['Place', document.places],
    ['Ability', document.abilities ?? []],
    ['Scene Feature', document.worldObjects ?? []],
  ];
  return groups.flatMap(([kind, records]) => records.map(record => ({
    id: record.id,
    label: `${kind} · ${record.name}`,
    archived: record.archived,
  }))).sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
}

function CampaignWorkspaceContent() {
  const { route, navigate } = useWorkspaceNavigation();
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
  const [error, setError] = useState<WorkspaceFailure | null>(null);
  const [conflict, setConflict] = useState<RevisionConflict | null>(null);
  const [bindings, setBindings] = useState<readonly ChatBindingDocument[]>([]);

  const [campaignTitle, setCampaignTitle] = useState('');

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
    loadCampaigns().catch(value => setError(workspaceFailure(value)));
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
      if (!cancelled) setError(workspaceFailure(value));
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
      if (!cancelled) {
        const failure = workspaceFailure(value);
        setRouteLoad({
          phase: 'error',
          title: failure.title,
          message: `${failure.message} ${failure.recovery}`,
        });
      }
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
      if (!cancelled) {
        const failure = workspaceFailure(value);
        setRouteLoad({
          phase: 'error',
          title: failure.title,
          message: `${failure.message} ${failure.recovery}`,
        });
      }
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

  async function run(work: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    setMessage('');
    try {
      await work();
    } catch (value) {
      const isRevisionConflict = value instanceof ApiProblem
        && value.problem?.code === 'CAMPAIGN_REVISION_CONFLICT';
      if (!isRevisionConflict) setError(workspaceFailure(value));
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
    setError(null);
    setMessage(`Loaded saved revision ${pendingCanonical.document.campaign.revision}.`);
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
      navigate({ campaignId: commit.campaignId, collection: 'home', recordId: null, revision: null });
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
  const retryRoute = () => {
    setError(null);
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
    navigate({ campaignId, collection: 'home', recordId: null, revision: null });
    setMessage(binding.markerState === 'verified'
      ? 'Imported Campaign opened. The SillyTavern Chat Binding marker was verified.'
      : 'Imported Campaign opened. Its Chat Binding is blocked until the marker can be verified.');
  }

  async function quickCapture(operation: CampaignOperation): Promise<boolean> {
    let saved = false;
    await run(async () => {
      await executeOperation(operation);
      saved = true;
    });
    return saved;
  }

  async function createDetailed(operation: CampaignOperation): Promise<CampaignCommit | null> {
    let commit: CampaignCommit | null = null;
    await run(async () => {
      commit = await executeOperation(operation);
    });
    return commit;
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
          <h2 id="campaign-authority">Campaign Library</h2>
          <p>Your cast, gear, abilities, relationships, quests, places, facts, scene features, current Scene, and accepted change history.</p>
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
            <strong>Saved revision {pendingCanonical.document.campaign.revision} is ready.</strong>
            <p>Another tab or device saved a change. Your visible draft was left untouched.</p>
          </div>
          <button type="button" onClick={acceptCanonicalUpdate} disabled={busy}>Load latest Campaign</button>
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
            setError(null);
            setMessage('Draft kept. Load the latest saved Campaign before trying to save it again.');
          }}
        />
      ) : null}
      {error ? <WorkspaceProblemBanner failure={error} onDismiss={() => setError(null)} /> : null}
      {message ? <p className="success-banner" role="status">{message}</p> : null}

      <div className="authority-layout">
        <aside className="campaign-list" aria-label="Campaigns">
          <form className="stack-form" onSubmit={createCampaign}>
            <label>
              <span>New Campaign title</span>
              <input id="new-campaign-title" value={campaignTitle} onChange={event => setCampaignTitle(event.target.value)} disabled={busy} />
            </label>
            <button type="submit" disabled={busy || !campaignTitle.trim()}>Create Campaign</button>
          </form>

          <div className="campaign-buttons">
            {campaigns.map(campaign => {
              const next: WorkspaceRoute = {
                campaignId: campaign.id,
                collection: 'home',
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
            {campaigns.length === 0 ? <div className="empty-state empty-state--action"><p>No Campaigns yet.</p><button type="button" className="button-secondary" onClick={() => document.getElementById('new-campaign-title')?.focus()}>Name your first Campaign</button></div> : null}
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
                  <p className="eyebrow">{readOnly ? 'Earlier read-only version' : 'Saved Campaign'}</p>
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

              <CampaignSearch
                document={displayed}
                route={route}
                onNavigate={navigate}
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

              {route.collection === 'home' ? (
                <SessionHome document={displayed} readOnly={readOnly} onNavigate={navigateCollection} />
              ) : null}

              {route.collection === 'guide' ? (
                <PlayerGuide onNavigate={collection => navigateCollection(collection)} />
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
                            key={actor.id}
                            kind="actor"
                            record={actor}
                            actors={displayed.actors}
                            busy={busy}
                            readOnly={readOnly}
                            onSave={(actorId, name, summary, aliases, visibility) => run(() => executeOperation({ kind: 'update_actor', actorId, name, summary, aliases: [...aliases], visibility }).then(() => undefined))}
                            onArchive={(actorId, archived) => run(() => executeOperation({ kind: 'set_actor_archived', actorId, archived }).then(() => undefined))}
                          />
                          <ActorTrackersPanel
                            actor={actor}
                            busy={busy}
                            readOnly={readOnly || actor.archived}
                            onCreate={draft => {
                              const tracker = normalizedTrackerDraft(draft);
                              if (!tracker) return Promise.resolve();
                              return run(() => executeOperation({ kind: 'create_actor_tracker', actorId: actor.id, tracker: {
                                label: tracker.label, current: tracker.current, notes: tracker.notes,
                                ...(tracker.maximum === null ? {} : { maximum: tracker.maximum }),
                              } }).then(() => undefined));
                            }}
                            onSave={(trackerId, draft) => {
                              const tracker = normalizedTrackerDraft(draft);
                              if (!tracker) return Promise.resolve();
                              return run(() => executeOperation({ kind: 'update_actor_tracker', actorId: actor.id, trackerId,
                                label: tracker.label, current: tracker.current, maximum: tracker.maximum, notes: tracker.notes,
                              }).then(() => undefined));
                            }}
                            onAdjust={(trackerId, delta) => run(() => executeOperation({ kind: 'adjust_actor_tracker', actorId: actor.id, trackerId, delta }).then(() => undefined))}
                            onRemove={trackerId => run(() => executeOperation({ kind: 'remove_actor_tracker', actorId: actor.id, trackerId }).then(() => undefined))}
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
                      {!readOnly ? <CampaignCollectionCreator collection="actors" document={displayed} subjects={availableSubjects} busy={busy} onCapture={quickCapture} onCreate={createDetailed} onCreated={(collection, id) => navigateCollection(collection, id)} /> : null}
                      <CampaignRecordIndex collection="actors" records={displayed.actors} document={displayed} route={route} onNavigate={navigate} />
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
                          key={item.id}
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
                      {!readOnly ? <CampaignCollectionCreator collection="items" document={displayed} subjects={availableSubjects} busy={busy} onCapture={quickCapture} onCreate={createDetailed} onCreated={(collection, id) => navigateCollection(collection, id)} /> : null}
                      <CampaignRecordIndex collection="items" records={displayed.items} document={displayed} route={route} onNavigate={navigate} />
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
                          key={quest.id}
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
                      {!readOnly ? <CampaignCollectionCreator collection="quests" document={displayed} subjects={availableSubjects} busy={busy} onCapture={quickCapture} onCreate={createDetailed} onCreated={(collection, id) => navigateCollection(collection, id)} /> : null}
                      <CampaignRecordIndex collection="quests" records={displayed.quests} document={displayed} route={route} onNavigate={navigate} />
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
                          key={place.id}
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
                      {!readOnly ? <CampaignCollectionCreator collection="places" document={displayed} subjects={availableSubjects} busy={busy} onCapture={quickCapture} onCreate={createDetailed} onCreated={(collection, id) => navigateCollection(collection, id)} /> : null}
                      <CampaignRecordIndex collection="places" records={displayed.places} document={displayed} route={route} onNavigate={navigate} />
                    </>
                  )}
                </section>
              ) : null}

              {route.collection === 'facts' ? (
                <section className="collection-view" aria-labelledby="facts-heading">
                  <div className="collection-heading"><div><h4 id="facts-heading">Facts</h4><p>Durable Campaign truths, optionally attached to a specific Record.</p></div></div>
                  {recordId ? (<><RecordRouteHeader route={route} onNavigate={navigate} />
                    {fact ? <WorldRecordEditor key={fact.id} kind="fact" record={fact} options={availableSubjects} busy={busy} readOnly={readOnly}
                      onSave={(factId, draft) => run(() => executeOperation({ kind: 'update_fact', factId, name: draft.name, summary: draft.summary, aliases: [...draft.aliases], visibility: draft.visibility, subjectId: draft.relationId || null }).then(() => undefined))}
                      onArchive={(factId, archived) => run(() => executeOperation({ kind: 'set_fact_archived', factId, archived }).then(() => undefined))} />
                      : <p className="error-banner">Fact {recordId} does not exist in this revision.</p>}
                  </>) : (<>
                    {!readOnly ? <CampaignCollectionCreator collection="facts" document={displayed} subjects={availableSubjects} busy={busy} onCapture={quickCapture} onCreate={createDetailed} onCreated={(collection, id) => navigateCollection(collection, id)} /> : null}
                    <CampaignRecordIndex collection="facts" records={displayed.facts ?? []} document={displayed} route={route} onNavigate={navigate} />
                  </>)}
                </section>
              ) : null}

              {route.collection === 'world-objects' ? (
                <section className="collection-view" aria-labelledby="world-objects-heading">
                  <div className="collection-heading"><div><h4 id="world-objects-heading">Scene Features</h4><p>Persistent, non-portable parts of the world, optionally attached to a Place.</p></div></div>
                  {recordId ? (<><RecordRouteHeader route={route} onNavigate={navigate} />
                    {worldObject ? <>
                      <WorldRecordEditor key={worldObject.id} kind="world-object" record={worldObject} options={displayed.places.map(record => ({ id: record.id, label: record.name, archived: record.archived }))} busy={busy} readOnly={readOnly}
                        onSave={(worldObjectId, draft) => run(() => executeOperation({ kind: 'update_world_object', worldObjectId, name: draft.name, summary: draft.summary, aliases: [...draft.aliases], visibility: draft.visibility, placeId: draft.relationId || null }).then(() => undefined))}
                        onArchive={(worldObjectId, archived) => run(() => executeOperation({ kind: 'set_world_object_archived', worldObjectId, archived }).then(() => undefined))} />
                      <LinkedFactsPanel facts={displayed.facts ?? []} subjectId={worldObject.id} subjectLabel={worldObject.name} options={availableSubjects} busy={busy} readOnly={readOnly || worldObject.archived}
                        onCreate={(name, summary, visibility) => run(() => executeOperation({ kind: 'create_fact', fact: { name, summary, visibility, subjectId: worldObject.id } }).then(() => undefined))}
                        onSave={(factId, draft) => run(() => executeOperation({ kind: 'update_fact', factId, name: draft.name, summary: draft.summary, aliases: [...draft.aliases], visibility: draft.visibility, subjectId: draft.relationId || null }).then(() => undefined))}
                        onArchive={(factId, archived) => run(() => executeOperation({ kind: 'set_fact_archived', factId, archived }).then(() => undefined))} />
                    </> : <p className="error-banner">Scene Feature {recordId} does not exist in this revision.</p>}
                  </>) : (<>
                    {!readOnly ? <CampaignCollectionCreator collection="world-objects" document={displayed} subjects={availableSubjects} busy={busy} onCapture={quickCapture} onCreate={createDetailed} onCreated={(collection, id) => navigateCollection(collection, id)} /> : null}
                    <CampaignRecordIndex collection="world-objects" records={displayed.worldObjects ?? []} document={displayed} route={route} onNavigate={navigate} />
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
                            key={ability.id}
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
                      {!readOnly ? <CampaignCollectionCreator collection="abilities" document={displayed} subjects={availableSubjects} busy={busy} onCapture={quickCapture} onCreate={createDetailed} onCreated={(collection, id) => navigateCollection(collection, id)} /> : null}
                      <CampaignRecordIndex collection="abilities" records={displayed.abilities ?? []} document={displayed} route={route} onNavigate={navigate} />
                    </>
                  )}
                </section>
              ) : null}

              {route.collection === 'relationships' ? (
                <section className="collection-view" aria-labelledby="relationships-collection-heading">
                  <div className="collection-heading"><div><h4 id="relationships-collection-heading">All Relationships</h4><p>Create and maintain directed links without leaving this collection.</p></div></div>
                  <RelationshipMap
                    actors={displayed.actors}
                    relationships={displayed.relationships ?? []}
                    onOpenActor={actorId => navigateCollection('actors', actorId)}
                  />
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
                  <div className="collection-heading"><div><h4 id="scene-heading">Current Scene</h4><p>The Campaign’s present place, cast, important objects, and situation.</p></div></div>
                  <SceneEditor
                    key={displayed.currentScene?.id ?? 'new-scene'}
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
                  onError={value => setError(workspaceFailure(value))}
                />
              ) : null}

              {route.collection === 'review' ? (
                readOnly
                  ? <p className="historical-note">Suggested story updates belong to the current Campaign and are unavailable while viewing an earlier version.</p>
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
            <div className="empty-state empty-state--action"><p>Create or open a Campaign to start.</p><button type="button" className="button-secondary" onClick={() => document.getElementById('new-campaign-title')?.focus()}>Create a Campaign</button></div>
          )}
        </div>
      </div>
    </section>
  );
}

export default function CampaignWorkspace() {
  return (
    <WorkspaceNavigationProvider>
      <CampaignWorkspaceContent />
    </WorkspaceNavigationProvider>
  );
}
