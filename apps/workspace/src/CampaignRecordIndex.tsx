import type {
  CampaignAbility,
  CampaignDocument,
  CampaignFact,
  CampaignItem,
  CampaignQuest,
  CampaignWorldObject,
} from '@st-llm-rpg/wire';
import { useEffect, useState } from 'react';
import {
  collectionLabel,
  type RecordCollectionKey,
  type WorkspaceRoute,
  workspaceHref,
} from './workspace-navigation.js';

type CommonRecord = Readonly<{
  id: string;
  name: string;
  summary: string;
  archived: boolean;
}>;

const RECORD_PAGE_SIZE = 40;

function subjectLabel(document: CampaignDocument, subjectId: string): string {
  const groups: ReadonlyArray<readonly [string, readonly CommonRecord[]]> = [
    ['Actor', document.actors],
    ['Item', document.items],
    ['Quest', document.quests],
    ['Place', document.places],
    ['Ability', document.abilities ?? []],
    ['World Object', document.worldObjects ?? []],
  ];
  for (const [kind, records] of groups) {
    const record = records.find(candidate => candidate.id === subjectId);
    if (record) return `${kind} · ${record.name}`;
  }
  return 'Unknown Record';
}

function recordMeta(
  collection: RecordCollectionKey,
  record: CommonRecord,
  document: CampaignDocument,
): string {
  if (collection === 'items') {
    const item = record as CampaignItem;
    return item.ownerActorId
      ? document.actors.find(actor => actor.id === item.ownerActorId)?.name ?? 'Unknown Actor'
      : 'Unattached';
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
    return fact.subjectId ? subjectLabel(document, fact.subjectId) : 'Campaign-wide';
  }
  if (collection === 'world-objects') {
    const worldObject = record as CampaignWorldObject;
    return worldObject.placeId
      ? document.places.find(place => place.id === worldObject.placeId)?.name ?? 'Unknown Place'
      : 'No Place';
  }
  return record.archived ? 'Archived' : 'Active';
}

export function CampaignRecordIndex(props: Readonly<{
  collection: RecordCollectionKey;
  records: readonly CommonRecord[];
  document: CampaignDocument;
  route: WorkspaceRoute;
  onNavigate: (route: WorkspaceRoute) => void;
}>) {
  const active = props.records.filter(record => !record.archived);
  const archived = props.records.filter(record => record.archived);
  const [activeLimit, setActiveLimit] = useState(RECORD_PAGE_SIZE);
  const [archivedLimit, setArchivedLimit] = useState(RECORD_PAGE_SIZE);
  useEffect(() => {
    setActiveLimit(RECORD_PAGE_SIZE);
    setArchivedLimit(RECORD_PAGE_SIZE);
  }, [props.collection]);
  const renderRecords = (
    records: readonly CommonRecord[],
    limit: number,
    onShowMore: () => void,
  ) => (
    <>
      <div className="record-index">
      {records.slice(0, limit).map(record => {
        const next: WorkspaceRoute = { ...props.route, recordId: record.id, query: undefined };
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
      {records.length > limit ? (
        <button type="button" className="record-index__more button-secondary" onClick={onShowMore}>
          Show {Math.min(RECORD_PAGE_SIZE, records.length - limit)} more · {records.length - limit} remaining
        </button>
      ) : null}
    </>
  );

  return (
    <>
      {active.length > 0 ? renderRecords(active, activeLimit, () => setActiveLimit(value => value + RECORD_PAGE_SIZE)) : (
        <p className="empty-state">No active {collectionLabel(props.collection).toLowerCase()} yet.</p>
      )}
      {archived.length > 0 ? (
        <details className="archive-panel">
          <summary>Archived {collectionLabel(props.collection)} ({archived.length})</summary>
          {renderRecords(archived, archivedLimit, () => setArchivedLimit(value => value + RECORD_PAGE_SIZE))}
        </details>
      ) : null}
    </>
  );
}

export function RecordRouteHeader(props: Readonly<{
  route: WorkspaceRoute;
  onNavigate: (route: WorkspaceRoute) => void;
}>) {
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
