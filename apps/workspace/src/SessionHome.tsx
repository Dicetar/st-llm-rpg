import type {
  CampaignDocument,
  CampaignActorTracker,
  CampaignQuest,
  CampaignSceneArchive,
} from '@st-llm-rpg/wire';
import type { CollectionKey } from './workspace-navigation.js';

type NamedSummary = Readonly<{ id: string; name: string; summary: string }>;
type SessionActor = NamedSummary & Readonly<{ trackers?: readonly CampaignActorTracker[] }>;

export type SessionBrief = Readonly<{
  currentScene: Readonly<{
    name: string;
    summary: string;
    place: NamedSummary | null;
    actors: readonly SessionActor[];
    items: readonly NamedSummary[];
    worldObjects: readonly NamedSummary[];
  }> | null;
  latestClosedScene: CampaignSceneArchive | null;
  activeQuests: readonly CampaignQuest[];
  openThreads: readonly string[];
  recentOutcomes: readonly string[];
}>;

function byName<T extends { name: string; id: string }>(left: T, right: T): number {
  if (left.name < right.name) return -1;
  if (left.name > right.name) return 1;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function namedRecords<T extends NamedSummary & { archived: boolean }>(
  records: readonly T[],
  ids: readonly string[] | undefined,
): T[] {
  const selected = new Set(ids ?? []);
  return records.filter(record => !record.archived && selected.has(record.id)).sort(byName);
}

export function buildSessionBrief(document: CampaignDocument): SessionBrief {
  const archives = [...(document.sceneArchives ?? [])].sort((left, right) => {
    if (left.closedAt !== right.closedAt) return left.closedAt < right.closedAt ? 1 : -1;
    return left.id < right.id ? 1 : left.id > right.id ? -1 : 0;
  });
  const latestClosedScene = archives[0] ?? null;
  const current = document.currentScene;
  const currentScene = current ? {
    name: current.name,
    summary: current.summary,
    place: document.places.find(record => !record.archived && record.id === current.placeId) ?? null,
    actors: namedRecords(document.actors, current.actorIds),
    items: namedRecords(document.items, current.itemIds),
    worldObjects: namedRecords(document.worldObjects ?? [], current.worldObjectIds),
  } : null;
  return {
    currentScene,
    latestClosedScene,
    activeQuests: document.quests.filter(record => !record.archived && record.status === 'active').sort(byName),
    openThreads: latestClosedScene?.openThreads ?? [],
    recentOutcomes: latestClosedScene?.outcomes ?? [],
  };
}

function RecordLinks(props: Readonly<{
  records: readonly NamedSummary[];
  collection: CollectionKey;
  empty: string;
  onNavigate: (collection: CollectionKey, recordId?: string | null) => void;
}>) {
  if (props.records.length === 0) return <span className="brief-muted">{props.empty}</span>;
  return (
    <ul className="brief-link-list">
      {props.records.map(record => (
        <li key={record.id}>
          <button type="button" className="text-button" onClick={() => props.onNavigate(props.collection, record.id)}>
            {record.name}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function SessionHome(props: Readonly<{
  document: CampaignDocument;
  readOnly: boolean;
  onNavigate: (collection: CollectionKey, recordId?: string | null) => void;
}>) {
  const brief = buildSessionBrief(props.document);
  const scene = brief.currentScene;
  return (
    <section className="session-home" aria-labelledby="session-home-heading">
      <header className="session-home__header">
        <div>
          <p className="eyebrow">Session brief · revision {props.document.campaign.revision}</p>
          <h4 id="session-home-heading">Pick up the story</h4>
          <p>This view is assembled from saved Campaign records. It makes no model call and changes nothing.</p>
        </div>
        <button type="button" onClick={() => props.onNavigate('scene')}>
          {scene ? 'Open current Scene' : props.readOnly ? 'View Scene' : 'Start a Scene'}
        </button>
      </header>

      <div className="session-brief-grid">
        <article className="brief-card brief-card--scene">
          <p className="eyebrow">Now</p>
          {scene ? (
            <>
              <h5>{scene.name}</h5>
              <p>{scene.summary || 'No Scene summary yet.'}</p>
              <dl className="brief-facts">
                <div><dt>Place</dt><dd>{scene.place ? <button type="button" className="text-button" onClick={() => props.onNavigate('places', scene.place?.id)}>{scene.place.name}</button> : 'Not set'}</dd></div>
                <div><dt>Present</dt><dd><RecordLinks records={scene.actors} collection="actors" empty="No Actors attached" onNavigate={props.onNavigate} /></dd></div>
                {scene.actors.some(actor => actor.trackers?.length) ? <div><dt>Live state</dt><dd><ul className="brief-tracker-list">
                  {scene.actors.flatMap(actor => (actor.trackers ?? []).map(tracker => <li key={`${actor.id}:${tracker.id}`}>
                    <button type="button" className="text-button" onClick={() => props.onNavigate('actors', actor.id)}>{actor.name}</button>
                    <span>{tracker.label}</span>
                    <strong>{tracker.current}{tracker.maximum === undefined ? '' : ` / ${tracker.maximum}`}</strong>
                  </li>))}
                </ul></dd></div> : null}
                <div><dt>In play</dt><dd><RecordLinks records={[...scene.items, ...scene.worldObjects]} collection="items" empty="No Items or scene features attached" onNavigate={(collection, recordId) => {
                  const worldObject = scene.worldObjects.some(record => record.id === recordId);
                  props.onNavigate(worldObject ? 'world-objects' : collection, recordId);
                }} /></dd></div>
              </dl>
            </>
          ) : (
            <div className="brief-empty">
              <h5>No current Scene</h5>
              <p>Set the present place, cast, and important objects so both you and the narrator have a clear starting point.</p>
              {!props.readOnly ? <button type="button" onClick={() => props.onNavigate('scene')}>Start the current Scene</button> : null}
            </div>
          )}
        </article>

        <article className="brief-card">
          <p className="eyebrow">Last time</p>
          {brief.latestClosedScene ? (
            <>
              <h5>{brief.latestClosedScene.name}</h5>
              <p>{brief.latestClosedScene.summary || 'No closing summary was recorded.'}</p>
              {brief.recentOutcomes.length > 0 ? <ul>{brief.recentOutcomes.slice(0, 4).map(value => <li key={value}>{value}</li>)}</ul> : <p className="brief-muted">No outcomes recorded.</p>}
            </>
          ) : (
            <div className="brief-empty"><h5>No past Scenes yet</h5><p>When you advance a Scene, its summary and outcomes will appear here.</p></div>
          )}
        </article>

        <article className="brief-card">
          <p className="eyebrow">Still unresolved</p>
          <h5>{brief.openThreads.length || brief.activeQuests.length ? 'What may come next' : 'Nothing listed yet'}</h5>
          {brief.openThreads.length > 0 ? <ul>{brief.openThreads.slice(0, 5).map(value => <li key={value}>{value}</li>)}</ul> : null}
          <RecordLinks records={brief.activeQuests.slice(0, 5)} collection="quests" empty="No active Quests or open Scene threads." onNavigate={props.onNavigate} />
          <button type="button" className="button-secondary brief-card__action" onClick={() => props.onNavigate('quests')}>Review Quests</button>
        </article>
      </div>

      <div className="session-home__footer">
        <p><strong>Need a refresher?</strong> The player guide explains what to edit here, what reaches the narrator, and what stays only in Campaign Book.</p>
        <button type="button" className="button-secondary" onClick={() => props.onNavigate('guide')}>Open player guide</button>
      </div>
    </section>
  );
}
