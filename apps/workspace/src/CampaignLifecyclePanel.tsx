import { useEffect, useState, type FormEvent } from 'react';
import type { CampaignDocument } from '@st-llm-rpg/wire';

export function CampaignLifecyclePanel(props: {
  document: CampaignDocument;
  sourceRevision: number;
  historical: boolean;
  busy: boolean;
  onArchiveChange: (archived: boolean) => Promise<void>;
  onBranch: (title: string, sourceRevision: number) => Promise<void>;
  onExport: () => Promise<void>;
}) {
  const [title, setTitle] = useState(`${props.document.campaign.title} — branch`);
  const [sourceRevision, setSourceRevision] = useState(String(props.sourceRevision));

  useEffect(() => {
    setTitle(`${props.document.campaign.title} — branch`);
    setSourceRevision(String(props.sourceRevision));
  }, [props.document.campaign.id, props.document.campaign.title, props.sourceRevision]);

  async function submitBranch(event: FormEvent) {
    event.preventDefault();
    const revision = Number(sourceRevision);
    if (!title.trim() || !Number.isInteger(revision) || revision < 1) return;
    await props.onBranch(title.trim(), revision);
  }

  const archived = props.document.campaign.status === 'archived';
  return (
    <section className="campaign-lifecycle" aria-labelledby="campaign-lifecycle-heading">
      <div className="campaign-lifecycle__heading">
        <div>
          <p className="eyebrow">Campaign</p>
          <h4 id="campaign-lifecycle-heading">Lifecycle &amp; portability</h4>
          <p>Archive a finished Campaign, fork an earlier choice into a new Campaign, or save a portable JSON copy.</p>
        </div>
        <span className={archived ? 'lifecycle-status lifecycle-status--archived' : 'lifecycle-status'}>
          {archived ? 'Archived' : 'Active'}
        </span>
      </div>

      {props.document.campaign.lineage ? (
        <p className="lineage-note">
          Branched from <strong>{props.document.campaign.lineage.sourceTitle}</strong> at revision {props.document.campaign.lineage.sourceRevision}.
        </p>
      ) : null}

      <div className="campaign-lifecycle__grid">
        <article>
          <h5>{archived ? 'Return to play' : 'Put away safely'}</h5>
          <p>{archived
            ? 'Restore enables edits, narration, and Story Updates again.'
            : 'Archive keeps history and exports readable while blocking accidental edits and generation.'}</p>
          {props.historical ? (
            <span className="lifecycle-hint">Return to the current revision to change archive status.</span>
          ) : (
            <button
              type="button"
              className={archived ? undefined : 'button-danger'}
              disabled={props.busy}
              onClick={() => {
                if (!archived && !window.confirm('Archive this Campaign? Edits and linked narration will pause until you restore it.')) return;
                void props.onArchiveChange(!archived);
              }}
            >
              {archived ? 'Restore Campaign' : 'Archive Campaign'}
            </button>
          )}
        </article>

        <article>
          <h5>Branch from a revision</h5>
          <p>Create an independent active Campaign from an accepted revision. Chat Bindings and jobs are not copied.</p>
          <form className="campaign-branch-form" onSubmit={event => { void submitBranch(event); }}>
            <label>
              <span>New Campaign title</span>
              <input value={title} onChange={event => setTitle(event.target.value)} disabled={props.busy} maxLength={160} />
            </label>
            <label>
              <span>Source revision</span>
              <input type="number" min="1" max={props.document.campaign.revision} value={sourceRevision} onChange={event => setSourceRevision(event.target.value)} disabled={props.busy} />
            </label>
            <button type="submit" disabled={props.busy || !title.trim() || !Number.isInteger(Number(sourceRevision)) || Number(sourceRevision) < 1}>
              Create branch
            </button>
          </form>
        </article>

        <article>
          <h5>Portable JSON</h5>
          <p>Download current canonical Campaign truth, lineage, and the accepted history index. Drafts, prompts, jobs, and diagnostics are excluded.</p>
          <button type="button" className="button-secondary" onClick={() => { void props.onExport(); }} disabled={props.busy}>
            Export Campaign JSON
          </button>
        </article>
      </div>
    </section>
  );
}
