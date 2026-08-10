import { type FormEvent, useEffect, useMemo, useState } from 'react';
import type {
  AddonCandidate,
  AddonCandidateCatalog,
  AddonSourceCatalog,
  ApplyAddonReceipt,
  CampaignSummary,
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

function count(candidate: AddonCandidate | null, kind: 'create' | 'update' | 'unchanged'): number {
  return candidate?.changes.filter(change => change.change === kind).length ?? 0;
}

export function AddonPanelView(props: {
  campaigns: readonly CampaignSummary[];
  campaignId: string;
  onCampaignId: (campaignId: string) => void;
  catalog: AddonSourceCatalog | null;
  candidate: AddonCandidate | null;
  receipt: ApplyAddonReceipt | null;
  busy: boolean;
  error: string;
  onRescan: () => void;
  onPreview: () => void;
  onApply: () => void;
}) {
  const errors = props.candidate?.issues.filter(issue => issue.severity === 'error').length ?? 0;
  const warnings = props.candidate?.issues.filter(issue => issue.severity === 'warning').length ?? 0;
  const attention = Boolean(props.error || errors || props.receipt);
  return (
    <details className="addon-panel" open={attention}>
      <summary>
        <span><strong>JSON addon inbox</strong><small>Watch files · review diff · verified backup · one atomic apply</small></span>
        <span>{props.catalog ? `${props.catalog.files.length} file${props.catalog.files.length === 1 ? '' : 's'}` : 'Checking'}</span>
      </summary>
      <div className="addon-panel__body">
        <div className="addon-intro">
          <div>
            <p className="eyebrow">External authoring</p>
            <h3>Reconcile campaign-content</h3>
            <p>Files are suggestions, never authority. Missing rows never remove accepted Campaign records.</p>
          </div>
          <button type="button" className="button-secondary" disabled={props.busy} onClick={props.onRescan}>Rescan files</button>
        </div>

        {props.error ? <p className="error-banner" role="alert">{props.error}</p> : null}
        {props.catalog?.issues.map((entry, index) => (
          <p className="addon-source-error" role="alert" key={`${entry.source}-${entry.path}-${index}`}>
            <strong>{entry.source}</strong> · {entry.message}
          </p>
        ))}

        <form className="addon-target" onSubmit={(event: FormEvent) => { event.preventDefault(); props.onPreview(); }}>
          <label>
            Apply additions and updates to
            <select value={props.campaignId} onChange={event => props.onCampaignId(event.target.value)} disabled={props.busy}>
              <option value="">Choose Campaign</option>
              {props.campaigns.map(campaign => (
                <option value={campaign.id} key={campaign.id}>{campaign.title} · revision {campaign.revision}</option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={props.busy || !props.campaignId || !props.catalog}>Preview import diff</button>
        </form>

        {props.candidate ? (
          <section className={`addon-candidate addon-candidate--${props.candidate.status}`} aria-label="Addon import diff">
            <div className="addon-counts">
              <span><strong>{count(props.candidate, 'create')}</strong> create</span>
              <span><strong>{count(props.candidate, 'update')}</strong> update</span>
              <span><strong>{count(props.candidate, 'unchanged')}</strong> unchanged</span>
              <span><strong>{warnings}</strong> warnings</span>
              <span><strong>{errors}</strong> blockers</span>
            </div>
            <p className="addon-proof">Campaign revision {props.candidate.expectedRevision} · manifest {props.candidate.manifestHash.slice(0, 12)}…</p>

            {props.candidate.issues.length ? (
              <details className="addon-issues" open={errors > 0}>
                <summary>{props.candidate.issues.length} validation note{props.candidate.issues.length === 1 ? '' : 's'}</summary>
                <ul>
                  {props.candidate.issues.map((entry, index) => (
                    <li className={`addon-issue addon-issue--${entry.severity}`} key={`${entry.source}-${entry.path}-${index}`}>
                      <strong>{entry.source} · {entry.path}</strong>
                      <span>{entry.message}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}

            <div className="addon-diff-list">
              {props.candidate.changes.filter(change => change.change !== 'unchanged').map(change => (
                <article className={`addon-diff addon-diff--${change.change}`} key={`${change.after.recordKind}:${change.after.externalId}`}>
                  <div>
                    <p className="eyebrow">{change.change} · {change.after.recordKind}</p>
                    <strong>{change.after.name}</strong>
                    <p>{change.after.summary || 'No summary'}</p>
                  </div>
                  <small>{change.changedFields.join(', ')}</small>
                </article>
              ))}
              {props.candidate.changes.length === 0 ? <p className="empty-state">No supported addon rows found.</p> : null}
            </div>

            <div className="addon-apply-bar">
              <p>{props.candidate.canApply ? 'Apply creates one verified pre-import backup and one Campaign revision.' : errors ? 'Fix blockers, then preview again.' : 'Campaign already matches supported addon rows.'}</p>
              <button type="button" disabled={props.busy || !props.candidate.canApply} onClick={props.onApply}>Apply reviewed diff</button>
            </div>
          </section>
        ) : null}

        {props.receipt ? (
          <div className="success-banner" role="status">
            <strong>Addon batch accepted</strong>
            <span>{props.receipt.changed} changes · Campaign revision {props.receipt.commit?.revision ?? 'unchanged'} · safety backup {props.receipt.backup?.id ?? 'not needed'}</span>
          </div>
        ) : null}
      </div>
    </details>
  );
}

export function AddonPanel() {
  const [campaigns, setCampaigns] = useState<readonly CampaignSummary[]>([]);
  const [campaignId, setCampaignId] = useState('');
  const [catalog, setCatalog] = useState<AddonSourceCatalog | null>(null);
  const [candidate, setCandidate] = useState<AddonCandidate | null>(null);
  const [savedCandidates, setSavedCandidates] = useState<readonly AddonCandidate[]>([]);
  const [receipt, setReceipt] = useState<ApplyAddonReceipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const selected = useMemo(() => campaigns.find(campaign => campaign.id === campaignId) ?? null, [campaignId, campaigns]);

  async function load() {
    setBusy(true);
    setError('');
    try {
      const [nextCatalog, nextCampaigns, candidateCatalog] = await Promise.all([
        requestJson<AddonSourceCatalog>('/api/operations/addons'),
        requestJson<CampaignSummary[]>('/api/campaigns'),
        requestJson<AddonCandidateCatalog>('/api/operations/addons/candidates'),
      ]);
      setCatalog(nextCatalog);
      setCampaigns(nextCampaigns);
      setSavedCandidates(candidateCatalog.candidates);
      const nextId = campaignId || nextCampaigns[0]?.id || '';
      setCampaignId(nextId);
      setCandidate(candidateCatalog.candidates.find(saved => saved.campaignId === nextId && saved.status !== 'applied') ?? null);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function rescan() {
    setBusy(true);
    setError('');
    setReceipt(null);
    try {
      setCatalog(await requestJson<AddonSourceCatalog>('/api/operations/addons/rescan', { method: 'POST' }));
      setCandidate(null);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setBusy(false);
    }
  }

  async function preview() {
    if (!campaignId) return;
    setBusy(true);
    setError('');
    setReceipt(null);
    try {
      const previewed = await requestJson<AddonCandidate>('/api/operations/addons/preview', {
        method: 'POST', body: JSON.stringify({ campaignId }),
      });
      setCandidate(previewed);
      setSavedCandidates(previous => [previewed, ...previous.filter(saved => saved.id !== previewed.id)]);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!candidate || !selected) return;
    setBusy(true);
    setError('');
    try {
      const applied = await requestJson<ApplyAddonReceipt>('/api/operations/addons/apply', {
        method: 'POST', body: JSON.stringify({
          candidateId: candidate.id,
          campaignId: candidate.campaignId,
          manifestHash: candidate.manifestHash,
          expectedRevision: candidate.expectedRevision,
        }),
      });
      setReceipt(applied);
      setCandidate(previous => previous ? { ...previous, status: 'applied', canApply: false, appliedRevision: applied.commit?.revision ?? previous.expectedRevision } : null);
      setSavedCandidates(previous => previous.map(saved => saved.id === applied.candidateId
        ? { ...saved, status: 'applied', canApply: false, appliedRevision: applied.commit?.revision ?? saved.expectedRevision }
        : saved));
      setCampaigns(previous => previous.map(campaign => campaign.id === selected.id && applied.commit
        ? { ...campaign, revision: applied.commit.revision, updatedAt: applied.commit.committedAt }
        : campaign));
      setCatalog(await requestJson<AddonSourceCatalog>('/api/operations/addons'));
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AddonPanelView
      campaigns={campaigns}
      campaignId={campaignId}
      onCampaignId={value => {
        setCampaignId(value);
        setCandidate(savedCandidates.find(saved => saved.campaignId === value && saved.status !== 'applied') ?? null);
        setReceipt(null);
      }}
      catalog={catalog}
      candidate={candidate}
      receipt={receipt}
      busy={busy}
      error={error}
      onRescan={() => { void rescan(); }}
      onPreview={() => { void preview(); }}
      onApply={() => { void apply(); }}
    />
  );
}
