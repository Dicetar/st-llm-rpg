import { useEffect, useState } from 'react';
import type {
  CampaignActor,
  CampaignItem,
  CampaignPlace,
  CampaignScene,
  CampaignSceneArchive,
  CampaignWorldObject,
} from '@st-llm-rpg/wire';
import { useWorkspaceDirtyDraft } from './workspace-navigation.js';

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
  useWorkspaceDirtyDraft(`scene:${props.scene?.id ?? 'new'}`, dirty && !props.readOnly);

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
          <legend>Present Scene Features</legend>
          {props.worldObjects.length === 0 ? <p className="empty-state">No Scene Features available. Add one from the Place or Scene Features section first.</p> : props.worldObjects.map(record => (
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

export type AdvanceSceneDraft = Readonly<{
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

function sameAdvanceSceneDraft(left: AdvanceSceneDraft, right: AdvanceSceneDraft): boolean {
  return left.closingSummary.trim() === right.closingSummary.trim()
    && left.outcomes.map(value => value.trim()).join('\u0000') === right.outcomes.map(value => value.trim()).join('\u0000')
    && left.openThreads.map(value => value.trim()).join('\u0000') === right.openThreads.map(value => value.trim()).join('\u0000')
    && left.nextName.trim() === right.nextName.trim()
    && left.nextSummary.trim() === right.nextSummary.trim()
    && left.nextPlaceId === right.nextPlaceId
    && left.actorIds.join('\u0000') === right.actorIds.join('\u0000')
    && left.itemIds.join('\u0000') === right.itemIds.join('\u0000')
    && left.worldObjectIds.join('\u0000') === right.worldObjectIds.join('\u0000');
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
  const baseline = availableDraft();
  useWorkspaceDirtyDraft(`advance-scene:${props.scene.id}`, !sameAdvanceSceneDraft(draft, baseline));
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
            <fieldset><legend>Keep Scene Features</legend>{props.worldObjects.filter(record => !record.archived || draft.worldObjectIds.includes(record.id)).map(record => <label key={record.id}><input type="checkbox" checked={draft.worldObjectIds.includes(record.id)} onChange={() => toggle('worldObjectIds', record.id)} disabled={props.busy || record.archived} /><span>{record.name}</span></label>)}</fieldset>
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
