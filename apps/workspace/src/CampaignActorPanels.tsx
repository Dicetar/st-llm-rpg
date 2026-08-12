import { useEffect, useRef, useState } from 'react';
import type {
  CampaignAbility,
  CampaignActor,
  CampaignLearnedAbility,
  CampaignRelationship,
  CampaignRelationshipStatus,
  NarratorVisibility,
} from '@st-llm-rpg/wire';
import { useWorkspaceDirtyDraft } from './workspace-navigation.js';

export type LearnedDraft = Readonly<{
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

export function optionalUses(value: string): number | undefined {
  return value.trim() ? Number(value) : undefined;
}

export function usesFields(usesRemaining: string, usesMaximum: string): Readonly<{
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

export function validUses(draft: LearnedDraft): boolean {
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
  useWorkspaceDirtyDraft(`learned-ability:${props.record.id}`, dirty && !props.readOnly);
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
  useWorkspaceDirtyDraft(
    `create:learned-ability:${props.ability.id}`,
    !props.readOnly && Boolean(actorId || draft.prepared || !draft.enabled || draft.usesRemaining.trim() || draft.usesMaximum.trim()),
  );
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

export type RelationshipDraft = Readonly<{
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
  return <><option value="active">Active</option><option value="strained">Strained</option><option value="dormant">Inactive</option><option value="ended">Ended</option><option value="other">Other</option></>;
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
  useWorkspaceDirtyDraft(`relationship:${props.record.id}`, dirty && !props.readOnly);
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
  useWorkspaceDirtyDraft(
    `create:relationship:${props.focusActorId ?? 'all'}`,
    !props.readOnly && Boolean(
      targetActorId
      || relationshipKind.trim()
      || notes.trim()
      || status !== 'active'
      || visibility !== 'known'
      || (!props.focusActorId && sourceActorId !== defaultSource),
    ),
  );
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
