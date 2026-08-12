import { ApiProblem } from './workspace-api.js';

export type WorkspaceFailure = Readonly<{
  title: string;
  message: string;
  recovery: string;
  technical?: string;
}>;

const KNOWN_FAILURES: Readonly<Record<string, Omit<WorkspaceFailure, 'technical'>>> = {
  CAMPAIGN_NOT_FOUND: {
    title: 'Campaign not found',
    message: 'This Campaign is no longer available at this address.',
    recovery: 'Choose another Campaign from the list or return to Campaign Book.',
  },
  CAMPAIGN_REVISION_NOT_FOUND: {
    title: 'That version is unavailable',
    message: 'Campaign Book could not reconstruct the requested historical revision.',
    recovery: 'Return to the current Campaign or choose another revision from Change History.',
  },
  CAMPAIGN_STORE_UNAVAILABLE: {
    title: 'Saved Campaigns are unavailable',
    message: 'Campaign Book cannot reach its saved Campaign data right now.',
    recovery: 'Keep this page open, restart the Companion if needed, then try again. Unsaved text remains in this tab.',
  },
  DEPENDENCY_UNAVAILABLE: {
    title: 'A required service is unavailable',
    message: 'Campaign Book cannot finish this action until the local service is reachable.',
    recovery: 'Check that the Companion and SillyTavern are running, then try again. Unsaved text remains in this tab.',
  },
  CAMPAIGN_VALIDATION_FAILED: {
    title: 'Some details need attention',
    message: 'Campaign Book did not save this change because one or more values are invalid.',
    recovery: 'Review the visible fields and try again. Nothing was written.',
  },
  CHAT_BINDING_NOT_FOUND: {
    title: 'Linked chat not found',
    message: 'The selected SillyTavern chat link is no longer available.',
    recovery: 'Refresh the linked chats, then choose or link the saved chat again.',
  },
  SILLYTAVERN_CHAT_UNAVAILABLE: {
    title: 'SillyTavern chat is unavailable',
    message: 'Campaign Book could not read the selected saved chat.',
    recovery: 'Confirm SillyTavern is running at :8001, then retry. Campaign data was not changed.',
  },
};

export function workspaceFailure(value: unknown): WorkspaceFailure {
  const apiProblem = value instanceof ApiProblem ? value.problem : null;
  const known = apiProblem ? KNOWN_FAILURES[apiProblem.code] : undefined;
  const technical = value instanceof Error ? value.message : String(value);
  if (known) return { ...known, technical };
  return {
    title: 'Campaign Book could not finish that action',
    message: 'The requested change was not completed.',
    recovery: 'Keep this page open and try again. Any unsaved text remains in this tab.',
    technical,
  };
}

export function WorkspaceProblemBanner(props: Readonly<{
  failure: WorkspaceFailure;
  onRetry?: (() => void) | undefined;
  onDismiss?: (() => void) | undefined;
}>) {
  return (
    <div className="workspace-problem" role="alert">
      <div>
        <strong>{props.failure.title}</strong>
        <p>{props.failure.message}</p>
        <p className="workspace-problem__recovery">{props.failure.recovery}</p>
      </div>
      <div className="workspace-problem__actions">
        {props.onRetry ? <button type="button" onClick={props.onRetry}>Try again</button> : null}
        {props.onDismiss ? <button type="button" className="button-secondary" onClick={props.onDismiss}>Dismiss</button> : null}
      </div>
      {props.failure.technical && props.failure.technical !== props.failure.message ? (
        <details>
          <summary>Technical details</summary>
          <code>{props.failure.technical}</code>
        </details>
      ) : null}
    </div>
  );
}
