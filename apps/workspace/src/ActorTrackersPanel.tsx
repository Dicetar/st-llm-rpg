import { useEffect, useRef, useState } from 'react';
import type { CampaignActor, CampaignActorTracker } from '@st-llm-rpg/wire';
import { useWorkspaceDirtyDraft } from './workspace-navigation.js';

export type ActorTrackerDraft = Readonly<{
  label: string;
  current: string;
  maximum: string;
  notes: string;
}>;

const emptyDraft: ActorTrackerDraft = { label: '', current: '0', maximum: '', notes: '' };
const minimumTrackerValue = -1_000_000_000;
const maximumTrackerValue = 1_000_000_000;

function trackerDraft(tracker: CampaignActorTracker): ActorTrackerDraft {
  return {
    label: tracker.label,
    current: String(tracker.current),
    maximum: tracker.maximum === undefined ? '' : String(tracker.maximum),
    notes: tracker.notes ?? '',
  };
}

function sameDraft(left: ActorTrackerDraft, right: ActorTrackerDraft): boolean {
  return left.label.trim() === right.label
    && left.current.trim() === right.current
    && left.maximum.trim() === right.maximum
    && left.notes.trim() === right.notes;
}

function wholeTrackerValue(value: string): number | null {
  if (!/^-?\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimumTrackerValue && parsed <= maximumTrackerValue
    ? parsed
    : null;
}

export function normalizedTrackerDraft(draft: ActorTrackerDraft): Readonly<{
  label: string;
  current: number;
  maximum: number | null;
  notes: string;
}> | null {
  const label = draft.label.trim();
  const current = wholeTrackerValue(draft.current);
  const maximum = draft.maximum.trim() ? wholeTrackerValue(draft.maximum) : null;
  if (!label || label.length > 160 || current === null || (draft.maximum.trim() && maximum === null)) return null;
  if (maximum !== null && current > maximum) return null;
  if (draft.notes.trim().length > 500) return null;
  return { label, current, maximum, notes: draft.notes.trim() };
}

function TrackerFields(props: {
  draft: ActorTrackerDraft;
  onDraft: (draft: ActorTrackerDraft) => void;
  disabled: boolean;
  prefix: string;
}) {
  return (
    <div className="actor-tracker-fields">
      <label><span>Tracker name</span><input aria-label={`${props.prefix} tracker name`} value={props.draft.label} maxLength={160} onChange={event => props.onDraft({ ...props.draft, label: event.target.value })} disabled={props.disabled} placeholder="Health, gold, suspicion…" /></label>
      <label><span>Current</span><input aria-label={`${props.prefix} current value`} type="number" step="1" min={minimumTrackerValue} max={maximumTrackerValue} value={props.draft.current} onChange={event => props.onDraft({ ...props.draft, current: event.target.value })} disabled={props.disabled} /></label>
      <label><span>Maximum <small>optional</small></span><input aria-label={`${props.prefix} maximum value`} type="number" step="1" min={minimumTrackerValue} max={maximumTrackerValue} value={props.draft.maximum} onChange={event => props.onDraft({ ...props.draft, maximum: event.target.value })} disabled={props.disabled} placeholder="No limit" /></label>
      <label className="actor-tracker-fields__notes"><span>Notes <small>optional</small></span><input aria-label={`${props.prefix} tracker notes`} value={props.draft.notes} maxLength={500} onChange={event => props.onDraft({ ...props.draft, notes: event.target.value })} disabled={props.disabled} placeholder="Wounded, owes the guild…" /></label>
    </div>
  );
}

function trackerPercent(tracker: CampaignActorTracker): number | null {
  if (tracker.maximum === undefined || tracker.maximum <= 0 || tracker.current < 0) return null;
  return Math.min(100, Math.max(0, (tracker.current / tracker.maximum) * 100));
}

function ActorTrackerCard(props: {
  actorId: string;
  tracker: CampaignActorTracker;
  busy: boolean;
  readOnly: boolean;
  onSave: (trackerId: string, draft: ActorTrackerDraft) => Promise<void>;
  onAdjust: (trackerId: string, delta: number) => Promise<void>;
  onRemove: (trackerId: string) => Promise<void>;
}) {
  const initial = trackerDraft(props.tracker);
  const [draft, setDraft] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  useEffect(() => {
    const next = trackerDraft(props.tracker);
    const dirty = !sameDraft(draft, baseline);
    setBaseline(next);
    if (!dirty) setDraft(next);
  }, [props.tracker.id, props.tracker.label, props.tracker.current, props.tracker.maximum, props.tracker.notes]);
  const dirty = !sameDraft(draft, baseline);
  const normalized = normalizedTrackerDraft(draft);
  const percent = trackerPercent(props.tracker);
  useWorkspaceDirtyDraft(`actor-tracker:${props.actorId}:${props.tracker.id}`, dirty && !props.readOnly);

  return (
    <article className="actor-tracker-card">
      <div className="actor-tracker-card__reading">
        <div><strong>{props.tracker.label}</strong>{props.tracker.notes ? <small>{props.tracker.notes}</small> : null}</div>
        <output aria-label={`${props.tracker.label} value`}>{props.tracker.current}{props.tracker.maximum === undefined ? '' : ` / ${props.tracker.maximum}`}</output>
      </div>
      {percent === null ? null : <div className="actor-tracker-gauge" role="meter" aria-label={`${props.tracker.label} level`} aria-valuemin={0} aria-valuemax={props.tracker.maximum} aria-valuenow={Math.max(0, props.tracker.current)}><span style={{ width: `${percent}%` }} /></div>}
      {!props.readOnly ? (
        <div className="actor-tracker-card__quick" aria-label={`Adjust ${props.tracker.label}`}>
          <button type="button" className="button-secondary tracker-step" aria-label={`Decrease ${props.tracker.label} by one`} disabled={props.busy || props.tracker.current <= minimumTrackerValue} onClick={() => { void props.onAdjust(props.tracker.id, -1); }}>−</button>
          <button type="button" className="button-secondary tracker-step" aria-label={`Increase ${props.tracker.label} by one`} disabled={props.busy || props.tracker.current >= (props.tracker.maximum ?? maximumTrackerValue)} onClick={() => { void props.onAdjust(props.tracker.id, 1); }}>+</button>
        </div>
      ) : null}
      <details className="actor-tracker-card__editor">
        <summary>Edit tracker</summary>
        <form onSubmit={event => { event.preventDefault(); if (normalized) void props.onSave(props.tracker.id, draft); }}>
          <TrackerFields draft={draft} onDraft={setDraft} disabled={props.busy || props.readOnly} prefix={props.tracker.label} />
          {!normalized ? <p className="field-error">Use a name and whole values; current cannot exceed maximum. Notes allow 500 characters.</p> : null}
          <div className="record-actions">
            <button type="submit" disabled={props.busy || props.readOnly || !dirty || !normalized}>Save tracker</button>
            <button type="button" className="button-secondary" disabled={props.busy || props.readOnly || !dirty} onClick={() => setDraft(baseline)}>Cancel changes</button>
            <button type="button" className="button-danger" disabled={props.busy || props.readOnly} onClick={() => {
              if (window.confirm(`Remove ${props.tracker.label} from this Actor? The Campaign history remains available.`)) void props.onRemove(props.tracker.id);
            }}>Remove tracker</button>
          </div>
        </form>
      </details>
    </article>
  );
}

export function ActorTrackersPanel(props: {
  actor: CampaignActor;
  busy: boolean;
  readOnly: boolean;
  onCreate: (draft: ActorTrackerDraft) => Promise<void>;
  onSave: (trackerId: string, draft: ActorTrackerDraft) => Promise<void>;
  onAdjust: (trackerId: string, delta: number) => Promise<void>;
  onRemove: (trackerId: string) => Promise<void>;
}) {
  const trackers = props.actor.trackers ?? [];
  const [draft, setDraft] = useState(emptyDraft);
  const pendingIds = useRef<Set<string> | null>(null);
  const normalized = normalizedTrackerDraft(draft);
  const trackerKey = trackers.map(tracker => tracker.id).join('\u0000');
  useWorkspaceDirtyDraft(`create:actor-tracker:${props.actor.id}`, !props.readOnly && !sameDraft(draft, emptyDraft));
  useEffect(() => {
    if (!pendingIds.current || !trackers.some(tracker => !pendingIds.current?.has(tracker.id))) return;
    pendingIds.current = null;
    setDraft(emptyDraft);
  }, [trackerKey]);

  return (
    <section className="actor-trackers-panel" aria-labelledby={`actor-trackers-${props.actor.id}`}>
      <div className="collection-heading">
        <div><h4 id={`actor-trackers-${props.actor.id}`}>Live trackers</h4><p>Numbers that change during play. Quick buttons save immediately; detailed edits use Save or Cancel.</p></div>
        <span className="tracker-count">{trackers.length} / 32</span>
      </div>
      {!props.readOnly ? (
        <form className="actor-tracker-create" onSubmit={event => {
          event.preventDefault();
          if (!normalized || trackers.length >= 32) return;
          pendingIds.current = new Set(trackers.map(tracker => tracker.id));
          void props.onCreate(draft);
        }}>
          <TrackerFields draft={draft} onDraft={setDraft} disabled={props.busy} prefix="New" />
          {!normalized && !sameDraft(draft, emptyDraft) ? <p className="field-error">Use a name and whole values; current cannot exceed maximum. Notes allow 500 characters.</p> : null}
          <button type="submit" disabled={props.busy || !normalized || trackers.length >= 32}>+ Add tracker</button>
        </form>
      ) : null}
      {trackers.length === 0 ? <p className="empty-state">No live trackers yet. Add health, currency, charges, reputation, or any other changing number here.</p> : null}
      <div className="actor-tracker-list">
        {trackers.map(tracker => <ActorTrackerCard key={tracker.id} actorId={props.actor.id} tracker={tracker} busy={props.busy} readOnly={props.readOnly} onSave={props.onSave} onAdjust={props.onAdjust} onRemove={props.onRemove} />)}
      </div>
    </section>
  );
}
