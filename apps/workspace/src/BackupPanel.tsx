import { type FormEvent, useCallback, useEffect, useState } from 'react';
import type {
  BackupCatalog,
  BackupDocument,
  RestoreBackupPreview,
  RestoreBackupReceipt,
} from '@st-llm-rpg/wire';

async function responseJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}) },
  });
  const body = await response.json() as unknown;
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'message' in body
      ? String(body.message)
      : `${path} returned HTTP ${response.status}`;
    throw new Error(message);
  }
  return body as T;
}

function backupKind(kind: BackupDocument['kind']): string {
  if (kind === 'pre-operation') return 'Safety backup';
  if (kind === 'daily') return 'Daily backup';
  return 'Manual backup';
}

export type BackupPanelViewProps = Readonly<{
  catalog: BackupCatalog | null;
  preview: RestoreBackupPreview | null;
  loading: boolean;
  busy: boolean;
  error: string;
  message: string;
  onRefresh: () => void;
  onCreate: (label: string) => void;
  onPreviewRestore: (backupId: string) => void;
  onRestore: (preview: RestoreBackupPreview) => void;
}>;

export function BackupPanelView(props: BackupPanelViewProps) {
  const [label, setLabel] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    props.onCreate(label.trim());
    setLabel('');
  };
  const backups = props.catalog?.backups ?? [];
  const preview = props.preview;
  return <details className="backup-panel" open={Boolean(props.error || props.preview || props.catalog?.problems.length)}>
    <summary>
      <span><strong>Backups and Restore</strong><small>Verified SQLite authority · automatic daily safety</small></span>
      <span>{props.catalog?.automaticDailyHealthy ? `${backups.length} verified` : 'check needed'}</span>
    </summary>
    <div className="backup-panel__body">
      <div className="backup-panel__heading">
        <div><p className="eyebrow">Operations</p><h2>Recovery catalog</h2><p>Create a labelled backup now, or preview and verify an existing backup before replacing current Campaign authority.</p></div>
        <button type="button" className="button-secondary" onClick={props.onRefresh} disabled={props.loading || props.busy}>{props.loading ? 'Checking…' : 'Refresh'}</button>
      </div>
      {props.error ? <p className="error-banner" role="alert">{props.error}</p> : null}
      {props.message ? <p className="success-banner" role="status">{props.message}</p> : null}
      {props.catalog && !props.catalog.automaticDailyHealthy ? <p className="error-banner">Today&apos;s automatic backup is not available. Create a manual backup before risky changes.</p> : null}
      {props.catalog?.problems.map(problem => <p className="error-banner" key={`${problem.source}:${problem.message}`}><strong>{problem.source}</strong>: {problem.message}</p>)}
      <form className="backup-create" onSubmit={submit}>
        <label><span>Backup label</span><input value={label} maxLength={160} onChange={event => setLabel(event.target.value)} placeholder="Before major campaign edit" disabled={props.busy} /></label>
        <button type="submit" disabled={props.busy}>Create verified backup</button>
      </form>
      <div className="backup-list">
        {backups.map(backup => <article className={`backup-card backup-card--${backup.availability}`} key={backup.id}>
          <div>
            <p className="eyebrow">{backupKind(backup.kind)}</p>
            <h3>{backup.label ?? new Date(backup.createdAt).toLocaleString()}</h3>
            <p>{new Date(backup.createdAt).toLocaleString()} · {(backup.sizeBytes / 1024).toFixed(1)} KiB · {backup.verification.campaignCount} Campaign{backup.verification.campaignCount === 1 ? '' : 's'}</p>
          </div>
          <div className="backup-card__actions">
            <span>{backup.availability}</span>
            <button type="button" className="button-secondary" disabled={props.busy || backup.availability !== 'available'} onClick={() => props.onPreviewRestore(backup.id)}>Preview restore</button>
          </div>
        </article>)}
        {!props.loading && backups.length === 0 ? <p className="empty-state">No verified backups found.</p> : null}
      </div>
      {preview ? <section className="restore-preview" aria-labelledby="restore-preview-heading">
        <div><p className="eyebrow">Verified restore preview</p><h3 id="restore-preview-heading">{preview.backup.label ?? preview.backup.id}</h3></div>
        <dl><div><dt>Backup Campaigns</dt><dd>{preview.backup.verification.campaignCount}</dd></div><div><dt>Current Campaigns</dt><dd>{preview.currentAuthority.campaignCount}</dd></div><div><dt>Backup hash</dt><dd><code>{preview.backup.sha256.slice(0, 12)}…</code></dd></div></dl>
        <p>Restore replaces current SQLite authority. Wayfinder creates another verified safety backup first, then reloads Workspace from restored truth.</p>
        <button type="button" className="button-danger" disabled={props.busy} onClick={() => props.onRestore(preview)}>Restore this backup</button>
      </section> : null}
    </div>
  </details>;
}

export function BackupPanel() {
  const [catalog, setCatalog] = useState<BackupCatalog | null>(null);
  const [preview, setPreview] = useState<RestoreBackupPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setCatalog(await responseJson<BackupCatalog>('/api/operations/backups'));
      setError('');
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const create = async (label: string) => {
    setBusy(true); setError(''); setMessage(''); setPreview(null);
    try {
      const backup = await responseJson<BackupDocument>('/api/operations/backups', {
        method: 'POST', body: JSON.stringify(label ? { label } : {}),
      });
      await refresh();
      setMessage(`Verified backup created: ${backup.label ?? backup.id}.`);
    } catch (value) { setError(value instanceof Error ? value.message : String(value)); }
    finally { setBusy(false); }
  };
  const previewRestore = async (backupId: string) => {
    setBusy(true); setError(''); setMessage('');
    try {
      setPreview(await responseJson<RestoreBackupPreview>(`/api/operations/backups/${encodeURIComponent(backupId)}/restore-preview`, { method: 'POST' }));
    } catch (value) { setError(value instanceof Error ? value.message : String(value)); }
    finally { setBusy(false); }
  };
  const restore = async (candidate: RestoreBackupPreview) => {
    if (!window.confirm('Restore this verified backup? Current Campaign authority will be replaced after a new safety backup is created.')) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const receipt = await responseJson<RestoreBackupReceipt>(`/api/operations/backups/${encodeURIComponent(candidate.backup.id)}/restore`, {
        method: 'POST', body: JSON.stringify({ restoreToken: candidate.restoreToken }),
      });
      setMessage(`Restore complete and verified. Safety backup: ${receipt.safetyBackupId}. Reloading Campaign truth…`);
      window.setTimeout(() => window.location.reload(), 800);
    } catch (value) { setError(value instanceof Error ? value.message : String(value)); setBusy(false); }
  };
  return <BackupPanelView catalog={catalog} preview={preview} loading={loading} busy={busy} error={error} message={message} onRefresh={() => { void refresh(); }} onCreate={label => { void create(label); }} onPreviewRestore={id => { void previewRestore(id); }} onRestore={candidate => { void restore(candidate); }} />;
}
