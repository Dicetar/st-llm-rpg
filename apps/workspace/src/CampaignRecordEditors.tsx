import { useEffect, useState } from 'react';
import type {
  CampaignAbility,
  CampaignAbilityCategory,
  CampaignActor,
  CampaignFact,
  CampaignItem,
  CampaignPlace,
  CampaignQuest,
  CampaignQuestStatus,
  CampaignWorldObject,
  NarratorVisibility,
} from '@st-llm-rpg/wire';
import { useWorkspaceDirtyDraft } from './workspace-navigation.js';

type EditorDraft = Readonly<{
  name: string;
  summary: string;
  aliases: readonly string[];
  visibility: NarratorVisibility;
  ownerActorId: string;
  status: CampaignQuestStatus;
  category: CampaignAbilityCategory;
}>;

function sameDraft(left: EditorDraft, right: EditorDraft): boolean {
  return left.name.trim() === right.name
    && left.summary.trim() === right.summary
    && left.aliases.map(value => value.trim()).join('\u0000') === right.aliases.map(value => value.trim()).join('\u0000')
    && left.visibility === right.visibility
    && left.ownerActorId === right.ownerActorId
    && left.status === right.status
    && left.category === right.category;
}

export type RecordEditorProps =
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
  useWorkspaceDirtyDraft(`record:${props.kind}:${props.record.id}`, dirty && !props.readOnly);

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
        <span>Who can use this?</span>
        <select
          value={draft.visibility}
          onChange={event => setDraft(previous => ({ ...previous, visibility: event.target.value as NarratorVisibility }))}
          disabled={props.busy || props.readOnly}
        >
          <option value="known">Story knowledge · narrator may reveal</option>
          <option value="narrator_secret">Behind the scenes · use, do not reveal</option>
          <option value="campaign_private">Player notes · never sent</option>
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
          <span>Carried by</span>
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

export type SubjectOption = Readonly<{ id: string; label: string; archived: boolean }>;
export type WorldRecordDraft = Readonly<{
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
  useWorkspaceDirtyDraft(`record:${props.kind}:${props.record.id}`, dirty && !props.readOnly);
  const label = props.kind === 'fact' ? 'Fact' : 'Scene Feature';
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
      <label><span>Who can use this?</span><select value={draft.visibility} onChange={event => setDraft(value => ({ ...value, visibility: event.target.value as NarratorVisibility }))} disabled={props.busy || props.readOnly || props.record.archived}><option value="known">Story knowledge · narrator may reveal</option><option value="narrator_secret">Behind the scenes · use, do not reveal</option><option value="campaign_private">Player notes · never sent</option></select></label>
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
  useWorkspaceDirtyDraft(
    `create:fact:${props.subjectId}`,
    !props.readOnly && Boolean(name.trim() || summary.trim() || visibility !== 'known'),
  );
  return <section className="linked-records"><div className="collection-heading"><div><h4>Facts about {props.subjectLabel}</h4><p>Add and edit lasting truths here without leaving this Record.</p></div></div>
    {!props.readOnly ? <form className="create-record-form create-record-form--inline" onSubmit={event => { event.preventDefault(); void props.onCreate(name, summary, visibility).then(() => { setName(''); setSummary(''); setVisibility('known'); }); }}><label><span>Fact name</span><input value={name} onChange={event => setName(event.target.value)} disabled={props.busy} /></label><label><span>Statement</span><textarea rows={2} value={summary} onChange={event => setSummary(event.target.value)} disabled={props.busy} /></label><label><span>Who can use this?</span><select value={visibility} onChange={event => setVisibility(event.target.value as NarratorVisibility)} disabled={props.busy}><option value="known">Story knowledge</option><option value="narrator_secret">Behind the scenes</option><option value="campaign_private">Player notes</option></select></label><button type="submit" disabled={props.busy || !name.trim()}>+ Add Fact</button></form> : null}
    {linked.length === 0 ? <p className="empty-state">No Facts here yet. Use “Add Fact” above to record the first one.</p> : linked.map(fact => <WorldRecordEditor key={fact.id} kind="fact" record={fact} options={props.options} busy={props.busy} readOnly={props.readOnly} onSave={props.onSave} onArchive={props.onArchive} />)}
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
  useWorkspaceDirtyDraft(
    `create:world-object:${props.placeId}`,
    !props.readOnly && Boolean(name.trim() || summary.trim()),
  );
  return <section className="linked-records"><div className="collection-heading"><div><h4>Scene Features in {props.placeLabel}</h4><p>Persistent, non-portable parts of this Place: doors, wardrobes, altars, hazards, and more.</p></div></div>
    {!props.readOnly ? <form className="create-record-form create-record-form--inline" onSubmit={event => { event.preventDefault(); void props.onCreate(name, summary).then(() => { setName(''); setSummary(''); }); }}><label><span>Feature name</span><input value={name} onChange={event => setName(event.target.value)} disabled={props.busy} /></label><label><span>Description</span><textarea rows={2} value={summary} onChange={event => setSummary(event.target.value)} disabled={props.busy} /></label><button type="submit" disabled={props.busy || !name.trim()}>+ Add Scene Feature</button></form> : null}
    {linked.length === 0 ? <p className="empty-state">No Scene Features here yet. Use “Add Scene Feature” above to create one in this Place.</p> : linked.map(record => <WorldRecordEditor key={record.id} kind="world-object" record={record} options={options} busy={props.busy} readOnly={props.readOnly} onSave={props.onSave} onArchive={props.onArchive} />)}
  </section>;
}
