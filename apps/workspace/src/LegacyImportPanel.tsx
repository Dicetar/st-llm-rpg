import { type FormEvent, useEffect, useMemo, useState } from 'react';
import type {
  ApplyLegacyImportRequest,
  ChatBindingDocument,
  LegacyChatListItem,
  LegacyImportDecision,
  LegacyImportPreview,
  LegacyImportResult,
  Problem,
} from '@st-llm-rpg/wire';

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  const response = await fetch(path, { ...init, headers });
  const body = await response.json().catch(() => null) as T | Problem | null;
  if (!response.ok) {
    const problem = body && typeof body === 'object' && 'schema' in body && body.schema === 'st-rpg.problem'
      ? body as Problem
      : null;
    throw new Error(problem?.message ?? `${path} returned HTTP ${response.status}`);
  }
  return body as T;
}

function decisionLabel(decision: LegacyImportDecision): string {
  if (decision === 'create-campaign') return 'Create a new Campaign and Binding';
  if (decision === 'link-existing') return 'Link this copied chat to the existing Campaign';
  if (decision === 'create-independent-import') return 'Create an independent Campaign and Binding';
  if (decision === 'open-existing') return 'Open the existing Campaign';
  return 'Cancel';
}

export function LegacyImportPreviewCard(props: { preview: LegacyImportPreview }) {
  const counts = props.preview.counts;
  return (
    <article className={`legacy-preview legacy-preview--${props.preview.kind}`}>
      <div className="legacy-preview__heading">
        <div>
          <p className="eyebrow">{props.preview.kind.replaceAll('-', ' ')}</p>
          <h4>{props.preview.title}</h4>
        </div>
        <span>Revision {props.preview.legacyRevision}</span>
      </div>
      <ul className="legacy-counts" aria-label="Import summary">
        <li><strong>{counts.actors}</strong> Actors</li>
        <li><strong>{counts.items}</strong> Items</li>
        <li><strong>{counts.quests}</strong> Quests</li>
        <li><strong>{counts.places}</strong> Places</li>
        <li><strong>{counts.unsupported}</strong> preserved for later</li>
      </ul>
      <p className="preservation-note">Legacy metadata stays in SillyTavern. Import adds a small Binding marker only after SQLite backup and commit.</p>
      {props.preview.issues.length > 0 ? (
        <details className="legacy-issues" open={props.preview.issues.some(issue => issue.severity === 'error')}>
          <summary>{props.preview.issues.length} import note{props.preview.issues.length === 1 ? '' : 's'}</summary>
          <ul>
            {props.preview.issues.map((issue, index) => (
              <li className={`legacy-issue legacy-issue--${issue.severity}`} key={`${issue.path}-${issue.code}-${index}`}>
                <strong>{issue.path}</strong>
                <span>{issue.message}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </article>
  );
}

function bindingSource(binding: ChatBindingDocument): string {
  return binding.locator.kind === 'character'
    ? `${binding.locator.chatId} · ${binding.locator.avatar}`
    : `${binding.locator.chatId} · group ${binding.locator.groupId}`;
}

export function ChatBindingsPanel(props: {
  bindings: readonly ChatBindingDocument[];
  busy: boolean;
  onRetryMarker: (bindingId: string) => void;
}) {
  const attention = props.bindings.filter(binding => binding.markerState !== 'verified').length;
  return (
    <details className="chat-bindings-panel" open={attention > 0}>
      <summary>
        <span><strong>Linked SillyTavern chats</strong><small>Durable Campaign ownership and source markers</small></span>
        <span>{props.bindings.length}{attention > 0 ? ` · ${attention} needs attention` : ''}</span>
      </summary>
      <div className="chat-bindings-list">
        {props.bindings.map(binding => (
          <article className={`chat-binding chat-binding--${binding.markerState}`} key={binding.id}>
            <div>
              <p className="eyebrow">{binding.locator.kind} chat</p>
              <strong>{bindingSource(binding)}</strong>
              <p>Campaign anchor {binding.campaignAnchor} · Binding revision {binding.revision} · marker {binding.markerState}</p>
              {binding.markerProblem ? <p className="chat-binding__problem">{binding.markerProblem}</p> : null}
            </div>
            {binding.markerState !== 'verified' ? (
              <button type="button" className="button-secondary" disabled={props.busy} onClick={() => props.onRetryMarker(binding.id)}>
                Retry marker
              </button>
            ) : null}
          </article>
        ))}
        {props.bindings.length === 0 ? <p className="empty-state">This Campaign is not linked to a SillyTavern chat yet.</p> : null}
      </div>
    </details>
  );
}

export default function LegacyImportPanel(props: {
  onImported: (campaignId: string, binding: ChatBindingDocument) => void | Promise<void>;
}) {
  const [chats, setChats] = useState<readonly LegacyChatListItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState('');
  const [preview, setPreview] = useState<LegacyImportPreview | null>(null);
  const [decision, setDecision] = useState<ApplyLegacyImportRequest['decision'] | ''>('');
  const [title, setTitle] = useState('');
  const [result, setResult] = useState<LegacyImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');

  const selected = useMemo(() => {
    const index = Number(selectedIndex);
    return Number.isInteger(index) && index >= 0 ? chats[index] ?? null : null;
  }, [chats, selectedIndex]);

  async function loadChats() {
    setBusy(true);
    setError('');
    try {
      const next = await requestJson<LegacyChatListItem[]>('/api/migrations/legacy-chats');
      setChats(next);
      setLoaded(true);
      if (selectedIndex && !next[Number(selectedIndex)]) setSelectedIndex('');
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void loadChats();
    // The saved-chat catalogue is refreshed explicitly after this initial bounded read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function previewSelected(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const next = await requestJson<LegacyImportPreview>('/api/migrations/legacy-preview', {
        method: 'POST',
        body: JSON.stringify({ locator: selected.locator }),
      });
      setPreview(next);
      setTitle(next.title);
      const actionable = next.decisions.find(candidate => !['cancel', 'open-existing'].includes(candidate));
      setDecision((actionable ?? '') as ApplyLegacyImportRequest['decision'] | '');
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setBusy(false);
    }
  }

  async function applyImport(event: FormEvent) {
    event.preventDefault();
    if (!preview || !decision) return;
    setBusy(true);
    setError('');
    try {
      const applied = await requestJson<LegacyImportResult>('/api/migrations/legacy-import', {
        method: 'POST',
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          locator: preview.locator,
          sourceFingerprint: preview.sourceFingerprint,
          decision,
          title,
        }),
      });
      setResult(applied);
      setPreview(null);
      await props.onImported(applied.campaignId, applied.binding);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setBusy(false);
    }
  }

  async function openExisting() {
    if (!preview?.existingBindingId || !preview.existingCampaignId) return;
    setBusy(true);
    setError('');
    try {
      const binding = await requestJson<ChatBindingDocument>(
        `/api/chat-bindings/${encodeURIComponent(preview.existingBindingId)}`,
      );
      await props.onImported(preview.existingCampaignId, binding);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setBusy(false);
    }
  }

  async function retryMarker() {
    if (!result) return;
    setBusy(true);
    setError('');
    try {
      const binding = await requestJson<ChatBindingDocument>(
        `/api/chat-bindings/${encodeURIComponent(result.binding.id)}/retry-marker`,
        { method: 'POST' },
      );
      setResult({ ...result, binding });
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="legacy-import-panel">
      <summary>
        <span><strong>Import a fallback chat</strong><small>Preview first · backup · no destructive conversion</small></span>
        <span>{result ? result.binding.markerState : error ? 'Unavailable' : loaded ? `${chats.filter(chat => chat.hasLegacyCampaign).length} found` : 'Checking'}</span>
      </summary>
      <div className="legacy-import-panel__body">
        <div className="migration-intro">
          <div>
            <p className="eyebrow">Migration</p>
            <h3>Bring an existing RPG chat into Campaign Book</h3>
            <p>Select a saved SillyTavern chat. Nothing changes until you review the diff and choose Apply.</p>
          </div>
          <button type="button" className="button-secondary" onClick={() => { void loadChats(); }} disabled={busy}>Refresh chats</button>
        </div>

        {error ? <p className="error-banner" role="alert">{error}</p> : null}
        {result ? (
          <div className={result.binding.markerState === 'verified' ? 'binding-result binding-result--verified' : 'binding-result binding-result--blocked'} role="status">
            <div>
              <strong>{result.binding.markerState === 'verified' ? 'Campaign imported and chat verified' : 'Campaign imported; chat link needs attention'}</strong>
              <p>Campaign revision {result.campaignRevision} · Binding revision {result.binding.revision} · marker {result.binding.markerState}</p>
              {result.binding.markerProblem ? <p>{result.binding.markerProblem}</p> : null}
            </div>
            <div className="binding-result__actions">
              {result.binding.markerState === 'blocked' ? (
                <button type="button" className="button-secondary" onClick={() => { void retryMarker(); }} disabled={busy}>Retry marker</button>
              ) : null}
              <button type="button" onClick={() => { void props.onImported(result.campaignId, result.binding); }} disabled={busy}>Open Campaign</button>
            </div>
          </div>
        ) : null}

        <form className="legacy-source-form" onSubmit={previewSelected}>
          <label>
            <span>Saved SillyTavern chat</span>
            <select
              value={selectedIndex}
              onChange={event => {
                setSelectedIndex(event.target.value);
                setPreview(null);
                setResult(null);
              }}
              disabled={busy}
            >
              <option value="">Choose a saved chat</option>
              {chats.map((chat, index) => (
                <option key={`${chat.locator.kind}:${chat.locator.chatId}:${index}`} value={index} disabled={!chat.hasLegacyCampaign}>
                  {chat.title} · {chat.hasLegacyCampaign ? `legacy revision ${chat.legacyRevision ?? '?'}` : 'no legacy Campaign'}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={busy || !selected}>Preview import</button>
        </form>

        {loaded && chats.length === 0 ? <p className="empty-state">SillyTavern has no saved chats available to this companion session.</p> : null}
        {preview ? (
          <div className="legacy-apply-grid">
            <LegacyImportPreviewCard preview={preview} />
            {preview.kind === 'already-imported' && preview.existingCampaignId ? (
              <div className="legacy-apply-form">
                <strong>This exact chat is already bound.</strong>
                <button type="button" onClick={() => { void openExisting(); }} disabled={busy}>Open existing Campaign</button>
              </div>
            ) : preview.kind !== 'invalid-source' ? (
              <form className="legacy-apply-form" onSubmit={applyImport}>
                <label><span>Campaign title</span><input value={title} onChange={event => setTitle(event.target.value)} disabled={busy} /></label>
                <label>
                  <span>Import choice</span>
                  <select value={decision} onChange={event => setDecision(event.target.value as ApplyLegacyImportRequest['decision'])} disabled={busy}>
                    {preview.decisions.filter(candidate => !['cancel', 'open-existing'].includes(candidate)).map(candidate => (
                      <option key={candidate} value={candidate}>{decisionLabel(candidate)}</option>
                    ))}
                  </select>
                </label>
                <button type="submit" disabled={busy || !title.trim() || !decision}>{busy ? 'Applying…' : 'Back up and import'}</button>
              </form>
            ) : null}
          </div>
        ) : null}
      </div>
    </details>
  );
}
