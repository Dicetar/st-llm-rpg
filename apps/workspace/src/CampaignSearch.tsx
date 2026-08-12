import { useState } from 'react';
import type {
  CampaignDocument,
  NarratorVisibility,
} from '@st-llm-rpg/wire';
import type { CollectionKey, WorkspaceRoute } from './workspace-navigation.js';
import { workspaceHref } from './workspace-navigation.js';

export type CampaignSearchResult = Readonly<{
  key: string;
  collection: CollectionKey;
  recordId: string | null;
  kind: string;
  name: string;
  summary: string;
  meta: string;
  archived: boolean;
  visibility: NarratorVisibility;
  searchText: string;
}>;

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en').replace(/\s+/g, ' ').trim();
}

function scoreResult(result: CampaignSearchResult, query: string): number | null {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return null;
  const tokens = normalizedQuery.split(' ').filter(Boolean);
  const name = normalize(result.name);
  const haystack = normalize(result.searchText);
  if (!tokens.every(token => haystack.includes(token))) return null;
  if (name === normalizedQuery) return 0;
  if (name.startsWith(normalizedQuery)) return 10 + name.length;
  if (name.includes(normalizedQuery)) return 30 + name.indexOf(normalizedQuery);
  return 100 + tokens.reduce((total, token) => total + haystack.indexOf(token), 0);
}

function recordResult(
  collection: CollectionKey,
  kind: string,
  record: Readonly<{
    id: string;
    name: string;
    summary: string;
    aliases?: readonly string[];
    archived: boolean;
    visibility?: NarratorVisibility;
  }>,
  meta: string,
): CampaignSearchResult {
  return {
    key: `${collection}:${record.id}`,
    collection,
    recordId: record.id,
    kind,
    name: record.name,
    summary: record.summary,
    meta,
    archived: record.archived,
    visibility: record.visibility ?? 'known',
    searchText: [record.name, ...(record.aliases ?? []), record.summary, meta, kind].join('\n'),
  };
}

export function campaignSearchResults(
  document: CampaignDocument,
  query: string,
  includeArchived = false,
  limit = 50,
): readonly CampaignSearchResult[] {
  if (!query.trim()) return [];
  const actorNames = new Map(document.actors.map(actor => [actor.id, actor.name]));
  const placeNames = new Map(document.places.map(place => [place.id, place.name]));
  const results: CampaignSearchResult[] = [
    ...document.actors.map(record => recordResult('actors', 'Actor', record, record.archived ? 'Archived' : 'Active')),
    ...document.items.map(record => recordResult(
      'items',
      'Item',
      record,
      record.ownerActorId ? `Carried by ${actorNames.get(record.ownerActorId) ?? 'unknown Actor'}` : 'Unattached',
    )),
    ...document.quests.map(record => recordResult('quests', 'Quest', record, record.status === 'completed' ? 'Completed' : 'Active')),
    ...document.places.map(record => recordResult('places', 'Place', record, record.archived ? 'Archived' : 'Active')),
    ...(document.facts ?? []).map(record => recordResult('facts', 'Fact', record, record.subjectId ? 'Attached Fact' : 'Campaign-wide')),
    ...(document.worldObjects ?? []).map(record => recordResult(
      'world-objects',
      'Scene Feature',
      record,
      record.placeId ? placeNames.get(record.placeId) ?? 'Unknown Place' : 'No Place',
    )),
    ...(document.abilities ?? []).map(record => recordResult('abilities', 'Ability', record, record.category)),
    ...(document.relationships ?? []).map(record => {
      const source = actorNames.get(record.sourceActorId) ?? 'Unknown Actor';
      const target = actorNames.get(record.targetActorId) ?? 'Unknown Actor';
      const name = `${source} → ${target}`;
      return {
        key: `relationship:${record.id}`,
        collection: 'actors' as const,
        recordId: record.sourceActorId,
        kind: 'Relationship',
        name,
        summary: record.notes,
        meta: `${record.kind} · ${record.status}`,
        archived: record.archived,
        visibility: record.visibility ?? 'known',
        searchText: [name, record.kind, record.status, record.notes].join('\n'),
      };
    }),
    ...(document.currentScene ? [{
      key: `scene:${document.currentScene.id}`,
      collection: 'scene' as const,
      recordId: null,
      kind: 'Current Scene',
      name: document.currentScene.name,
      summary: document.currentScene.summary,
      meta: document.currentScene.placeId ? placeNames.get(document.currentScene.placeId) ?? 'Unknown Place' : 'No Place',
      archived: false,
      visibility: 'known' as const,
      searchText: [document.currentScene.name, document.currentScene.summary, 'current scene'].join('\n'),
    }] : []),
    ...(document.sceneArchives ?? []).map(record => ({
      key: `scene-archive:${record.id}`,
      collection: 'scene' as const,
      recordId: null,
      kind: 'Past Scene',
      name: record.name,
      summary: record.summary,
      meta: new Date(record.closedAt).toLocaleDateString(),
      archived: true,
      visibility: 'known' as const,
      searchText: [record.name, record.summary, ...record.outcomes, ...record.openThreads, 'past scene'].join('\n'),
    })),
  ];

  return results
    .filter(result => includeArchived || !result.archived)
    .map(result => ({ result, score: scoreResult(result, query) }))
    .filter((entry): entry is Readonly<{ result: CampaignSearchResult; score: number }> => entry.score !== null)
    .sort((left, right) => left.score - right.score || left.result.name.localeCompare(right.result.name) || left.result.key.localeCompare(right.result.key))
    .slice(0, limit)
    .map(entry => entry.result);
}

function visibilityLabel(visibility: NarratorVisibility): string {
  if (visibility === 'campaign_private') return 'Private';
  if (visibility === 'narrator_secret') return 'Narrator-only';
  return '';
}

export function CampaignSearch(props: Readonly<{
  document: CampaignDocument;
  route: WorkspaceRoute;
  onNavigate: (route: WorkspaceRoute, replace?: boolean) => void;
}>) {
  const [includeArchived, setIncludeArchived] = useState(false);
  const query = props.route.query ?? '';
  const results = campaignSearchResults(props.document, query, includeArchived);
  const updateQuery = (value: string) => props.onNavigate({ ...props.route, query: value || undefined }, true);

  return (
    <section className="campaign-search" aria-labelledby="campaign-search-heading">
      <div className="campaign-search__heading">
        <div>
          <h4 id="campaign-search-heading">Find anything</h4>
          <p>Search names, aliases, descriptions, relationships, and past Scene notes in this Campaign.</p>
        </div>
        <label className="check-row">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={event => setIncludeArchived(event.target.checked)}
          />
          <span>Include archived</span>
        </label>
      </div>
      <form role="search" className="campaign-search__form" onSubmit={event => event.preventDefault()}>
        <label htmlFor="campaign-search-input">Search Campaign</label>
        <div>
          <input
            id="campaign-search-input"
            name="campaign-search"
            type="search"
            autoComplete="off"
            value={query}
            onChange={event => updateQuery(event.target.value)}
            placeholder="Try a person, place, item, alias, or clue…"
          />
          {query ? <button type="button" className="button-secondary" onClick={() => updateQuery('')}>Clear</button> : null}
        </div>
      </form>
      {query ? (
        <div className="campaign-search__results" aria-live="polite">
          <p className="campaign-search__count">{results.length} result{results.length === 1 ? '' : 's'} for “{query}”</p>
          {results.length ? (
            <ul>
              {results.map(result => {
                const next: WorkspaceRoute = {
                  ...props.route,
                  collection: result.collection,
                  recordId: result.recordId,
                  query: undefined,
                };
                const visibility = visibilityLabel(result.visibility);
                return (
                  <li key={result.key}>
                    <a
                      href={workspaceHref(next)}
                      onClick={event => {
                        event.preventDefault();
                        props.onNavigate(next);
                      }}
                    >
                      <span className="campaign-search__kind">{result.kind}</span>
                      <strong>{result.name}</strong>
                      <span className="campaign-search__meta">
                        {[result.meta, visibility, result.archived ? 'Archived' : ''].filter(Boolean).join(' · ')}
                      </span>
                      <p>{result.summary || 'No description yet.'}</p>
                    </a>
                  </li>
                );
              })}
            </ul>
          ) : <p className="empty-state">Nothing matched. Try fewer words or include archived Records.</p>}
        </div>
      ) : null}
    </section>
  );
}
