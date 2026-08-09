import type { NarrationStatusDocument, NarrationStatusFinished, NarrationStatusRunning, Problem } from '@st-llm-rpg/wire';

function requestLabel(request: NarrationStatusRunning | NarrationStatusFinished): string {
  if (request.route === 'invalid') return 'Invalid bridge request';
  const mode = request.generation === 'normal'
    ? 'Send'
    : request.generation === null
      ? 'Unknown'
      : request.generation[0]!.toUpperCase() + request.generation.slice(1);
  return `${mode} · ${request.route}`;
}

function requestTime(request: NarrationStatusRunning | NarrationStatusFinished): string {
  const timestamp = 'completedAt' in request ? request.completedAt : request.startedAt;
  return timestamp.length >= 19 ? timestamp.slice(11, 19) : timestamp;
}

function RecoveryActions(props: { problem: Problem }) {
  if (!props.problem.actions.length) return null;
  return (
    <div className="narration-recovery">
      <strong>What to do</strong>
      <ul>
        {props.problem.actions.map(action => (
          <li key={action.id}>
            {action.kind === 'open-url' && action.target ? <a href={action.target}>{action.label}</a> : null}
            {action.kind === 'run-command' && action.target ? <><span>{action.label}</span><code>{action.target}</code></> : null}
            {!((action.kind === 'open-url' || action.kind === 'run-command') && action.target) ? <span>{action.label}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function NarrationStatusPanel(props: {
  document: NarrationStatusDocument | null;
  loading: boolean;
  error: string;
  onRefresh: () => void;
}) {
  const latest = props.document?.latest ?? null;
  const needsAttention = Boolean(props.error)
    || Boolean(props.document?.active.length)
    || latest?.state === 'failed'
    || latest?.state === 'rejected';

  return (
    <details className="narration-status" open={needsAttention}>
      <summary>
        <div>
          <h2>Narration status</h2>
          <p>Current request and latest outcome from this Companion process.</p>
        </div>
        <span>{props.document?.active.length ? `${props.document.active.length} running` : latest?.state ?? 'idle'}</span>
      </summary>

      <div className="narration-status__body">
        <p className="narration-status__caveat">Operational status only: this does not record request history or prove SillyTavern saved the expected chat history.</p>
        <p className="narration-status__privacy">No prompts or generated prose are retained.</p>
        <div className="narration-status__actions">
          <button type="button" onClick={props.onRefresh} disabled={props.loading}>{props.loading ? 'Refreshing…' : 'Refresh status'}</button>
        </div>

        {props.error ? <p className="error-banner" role="alert">Narration status failed. Reload Campaign Book or inspect the Companion console. {props.error}</p> : null}

        {props.document?.active.length ? (
          <div className="narration-status__list" aria-label="Active narration requests">
            {props.document.active.map(request => (
              <article className="narration-status__row narration-status__row--running" key={`${request.requestId}-${request.startedAt}`}>
                <div><strong>{requestLabel(request)}</strong><span>Running since {requestTime(request)}</span></div>
                <span>running</span>
              </article>
            ))}
          </div>
        ) : null}

        {latest ? (
          <div className="narration-status__latest">
            <h3>Latest outcome</h3>
            <article className={`narration-status__row narration-status__row--${latest.state}`}>
              <div>
                <strong>{requestLabel(latest)}</strong>
                <span>{requestTime(latest)} · {latest.elapsedMs} ms · HTTP {latest.httpStatus}</span>
              </div>
              <span>{latest.state}</span>
            </article>
            {latest.state === 'failed' || latest.state === 'rejected' ? (
              <div className="narration-status__problem" role="alert">
                <strong>{latest.problem.code}</strong>
                <p>{latest.problem.message}</p>
                <RecoveryActions problem={latest.problem} />
              </div>
            ) : latest.state === 'cancelled' ? (
              <p className="narration-status__note">
                {latest.route === 'linked'
                  ? 'Stopped before a companion reply was delivered.'
                  : 'Stopped. Transparent unlinked streaming may already have delivered partial output.'}
              </p>
            ) : null}
          </div>
        ) : !props.loading && !props.error ? <p className="empty-state">No narration request has reached this Companion process.</p> : null}
      </div>
    </details>
  );
}
