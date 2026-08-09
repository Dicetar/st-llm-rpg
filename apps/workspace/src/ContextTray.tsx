import {
  type FormEvent,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type {
  CampaignDocument,
  ChatBindingDocument,
  ContextPlan,
  GenerationType,
  NarratorModelProfile,
  NarratorVisibility,
  Problem,
} from '@st-llm-rpg/wire';

class ContextApiError extends Error {
  constructor(readonly problem: Problem | null, fallback: string) {
    super(problem?.message ?? fallback);
    this.name = 'ContextApiError';
  }
}

async function fetchJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  const response = await fetch(path, { ...init, headers });
  const body = await response.json().catch(() => null) as T | Problem | null;
  if (!response.ok) {
    const problem = body && typeof body === 'object' && 'schema' in body && body.schema === 'st-rpg.problem'
      ? body as Problem
      : null;
    throw new ContextApiError(problem, `${path} returned HTTP ${response.status}`);
  }
  return body as T;
}

type ContextRecordChoice = Readonly<{
  id: string;
  kind: 'Actor' | 'Item' | 'Quest' | 'Place';
  name: string;
  archived: boolean;
  visibility: NarratorVisibility;
}>;

function visibilityLabel(value: NarratorVisibility): string {
  if (value === 'narrator_secret') return 'Narrator Secret';
  if (value === 'campaign_private') return 'Campaign Private';
  return 'Known';
}

function bindingLabel(binding: ChatBindingDocument): string {
  return binding.locator.chatId;
}

function movePin(pins: readonly string[], id: string, direction: -1 | 1): string[] {
  const index = pins.indexOf(id);
  const destination = index + direction;
  if (index < 0 || destination < 0 || destination >= pins.length) return [...pins];
  const next = [...pins];
  [next[index], next[destination]] = [next[destination]!, next[index]!];
  return next;
}

export function ContextTray(props: {
  document: CampaignDocument;
  bindings: readonly ChatBindingDocument[];
  busy: boolean;
  readOnly: boolean;
  onBindingChanged: (binding: ChatBindingDocument) => void;
  onStatus: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [working, setWorking] = useState(false);
  const [profiles, setProfiles] = useState<readonly NarratorModelProfile[]>([]);
  const [bindingId, setBindingId] = useState(props.bindings[0]?.id ?? '');
  const [profileId, setProfileId] = useState('');
  const [draftPins, setDraftPins] = useState<readonly string[]>(props.bindings[0]?.pins ?? []);
  const [message, setMessage] = useState('I inspect the wardrobe and ask who used it last.');
  const [generationType, setGenerationType] = useState<GenerationType>('normal');
  const [plan, setPlan] = useState<ContextPlan | null>(null);

  const [profileDraftId, setProfileDraftId] = useState('local-narrator');
  const [modelId, setModelId] = useState('mistralai/mistral-nemo-instruct-2407');
  const [contextWindowTokens, setContextWindowTokens] = useState(16_384);
  const [requestedVisibleOutputTokens, setRequestedVisibleOutputTokens] = useState(2_048);
  const [safetyMarginTokens, setSafetyMarginTokens] = useState(1_024);
  const [maxCampaignTokens, setMaxCampaignTokens] = useState(4_096);
  const [maxAutomaticRecords, setMaxAutomaticRecords] = useState(10);
  const [maxRelationExpansions, setMaxRelationExpansions] = useState(4);

  const selectedBinding = props.bindings.find(binding => binding.id === bindingId) ?? props.bindings[0] ?? null;
  const selectedProfile = profiles.find(profile => profile.id === profileId) ?? profiles[0] ?? null;
  const mismatch = selectedBinding
    ? selectedBinding.campaignAnchor !== props.document.campaign.revision
    : false;
  const controlsBusy = props.busy || working;
  const records = useMemo<ContextRecordChoice[]>(() => [
    ...props.document.actors.map(record => ({
      id: record.id, kind: 'Actor' as const, name: record.name, archived: record.archived,
      visibility: record.visibility ?? 'known' as const,
    })),
    ...props.document.items.map(record => ({
      id: record.id, kind: 'Item' as const, name: record.name, archived: record.archived,
      visibility: record.visibility ?? 'known' as const,
    })),
    ...props.document.quests.map(record => ({
      id: record.id, kind: 'Quest' as const, name: record.name, archived: record.archived,
      visibility: record.visibility ?? 'known' as const,
    })),
    ...props.document.places.map(record => ({
      id: record.id, kind: 'Place' as const, name: record.name, archived: record.archived,
      visibility: record.visibility ?? 'known' as const,
    })),
  ].sort((left, right) => left.kind.localeCompare(right.kind) || left.name.localeCompare(right.name) || left.id.localeCompare(right.id)), [props.document]);

  useEffect(() => {
    let cancelled = false;
    void fetchJson<NarratorModelProfile[]>('/api/narrator-model-profiles').then(next => {
      if (cancelled) return;
      setProfiles(next);
      setProfileId(current => current || next[0]?.id || '');
    }).catch(value => {
      if (!cancelled) props.onError(value instanceof Error ? value.message : String(value));
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!selectedBinding && props.bindings[0]) setBindingId(props.bindings[0].id);
    setDraftPins(selectedBinding?.pins ?? []);
    setPlan(null);
  }, [selectedBinding?.id, selectedBinding?.revision, props.bindings]);

  useEffect(() => {
    if (!selectedProfile) return;
    setProfileDraftId(selectedProfile.id);
    setModelId(selectedProfile.modelId);
    setContextWindowTokens(selectedProfile.contextWindowTokens);
    setRequestedVisibleOutputTokens(selectedProfile.requestedVisibleOutputTokens);
    setSafetyMarginTokens(selectedProfile.safetyMarginTokens);
    setMaxCampaignTokens(selectedProfile.maxCampaignTokens);
    setMaxAutomaticRecords(selectedProfile.maxAutomaticRecords);
    setMaxRelationExpansions(selectedProfile.maxRelationExpansions);
  }, [selectedProfile?.id]);

  async function perform(work: () => Promise<void>) {
    setWorking(true);
    props.onError('');
    try {
      await work();
    } catch (value) {
      props.onError(value instanceof Error ? value.message : String(value));
    } finally {
      setWorking(false);
    }
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    await perform(async () => {
      const profile: NarratorModelProfile = {
        id: profileDraftId.trim(),
        modelId: modelId.trim(),
        contextWindowTokens,
        requestedVisibleOutputTokens,
        safetyMarginTokens,
        maxCampaignTokens,
        maxAutomaticRecords,
        maxRelationExpansions,
      };
      const saved = await fetchJson<NarratorModelProfile>(
        `/api/narrator-model-profiles/${encodeURIComponent(profile.id)}`,
        { method: 'PUT', body: JSON.stringify(profile) },
      );
      setProfiles(current => [...current.filter(candidate => candidate.id !== saved.id), saved]
        .sort((left, right) => left.id.localeCompare(right.id)));
      setProfileId(saved.id);
      props.onStatus(`Narrator model profile ${saved.id} saved.`);
    });
  }

  function togglePin(record: ContextRecordChoice) {
    if (record.archived || record.visibility === 'campaign_private') return;
    setDraftPins(current => current.includes(record.id)
      ? current.filter(id => id !== record.id)
      : [...current, record.id]);
    setPlan(null);
  }

  async function savePins() {
    if (!selectedBinding) return;
    await perform(async () => {
      const updated = await fetchJson<ChatBindingDocument>(
        `/api/chat-bindings/${encodeURIComponent(selectedBinding.id)}/context-pins`,
        {
          method: 'PUT',
          body: JSON.stringify({
            requestId: crypto.randomUUID(),
            eventId: crypto.randomUUID(),
            expectedBindingRevision: selectedBinding.revision,
            expectedContextFocusRevision: selectedBinding.contextFocusRevision ?? 1,
            pins: draftPins,
          }),
        },
      );
      props.onBindingChanged(updated);
      setDraftPins(updated.pins ?? []);
      props.onStatus(`Saved ${updated.pins?.length ?? 0} ordered Context pins at Binding revision ${updated.revision}.`);
    });
  }

  async function buildPlan() {
    if (!selectedBinding || !selectedProfile) return;
    await perform(async () => {
      const next = await fetchJson<ContextPlan>('/api/context-plans', {
        method: 'POST',
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          campaignId: props.document.campaign.id,
          campaignRevision: selectedBinding.campaignAnchor,
          bindingId: selectedBinding.id,
          bindingRevision: selectedBinding.revision,
          contextFocusRevision: selectedBinding.contextFocusRevision ?? 1,
          modelProfileId: selectedProfile.id,
          generationType,
          messages: [{ role: 'user', content: message }],
        }),
      });
      setPlan(next);
      props.onStatus(`Context Plan selected ${next.selections.length} complete blocks.`);
    });
  }

  return (
    <section className="context-tray" aria-labelledby="context-tray-heading">
      <div className="collection-heading">
        <div>
          <h4 id="context-tray-heading">Context Tray</h4>
          <p>Inspect exactly what Campaign truth a linked narration would receive before any model call.</p>
        </div>
      </div>

      {props.bindings.length === 0 ? (
        <p className="empty-state">Link a SillyTavern chat before configuring Context Focus.</p>
      ) : (
        <div className="context-tray__grid">
          <section className="context-card" aria-labelledby="context-authority-heading">
            <p className="eyebrow">Pinned authority</p>
            <h5 id="context-authority-heading">Chat Binding</h5>
            <label>
              <span>Linked chat</span>
              <select value={selectedBinding?.id ?? ''} onChange={event => setBindingId(event.target.value)} disabled={controlsBusy}>
                {props.bindings.map(binding => (
                  <option key={binding.id} value={binding.id}>{bindingLabel(binding)} · revision {binding.revision}</option>
                ))}
              </select>
            </label>
            {selectedBinding ? (
              <dl className="context-facts">
                <div><dt>Campaign anchor</dt><dd>{selectedBinding.campaignAnchor}</dd></div>
                <div><dt>Context Focus</dt><dd>{selectedBinding.contextFocusRevision ?? 1}</dd></div>
                <div><dt>Marker</dt><dd>{selectedBinding.markerState}</dd></div>
              </dl>
            ) : null}
            {mismatch ? (
              <p className="context-warning" role="alert">This Binding is anchored to revision {selectedBinding?.campaignAnchor}, while Campaign head is {props.document.campaign.revision}. Reconcile the Binding before narration.</p>
            ) : null}
          </section>

          <details className="context-card context-profile" open={profiles.length === 0}>
            <summary>Narrator model profile</summary>
            <div className="context-card__body">
              {profiles.length ? (
                <label>
                  <span>Reviewed profile</span>
                  <select value={selectedProfile?.id ?? ''} onChange={event => setProfileId(event.target.value)} disabled={controlsBusy}>
                    {profiles.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.id} · {candidate.modelId}</option>)}
                  </select>
                </label>
              ) : <p className="empty-state">Save the exact LM Studio model and its budget before planning.</p>}
              {!props.readOnly ? (
                <form className="context-profile-form" onSubmit={event => { void saveProfile(event); }}>
                  <label><span>Profile ID</span><input value={profileDraftId} onChange={event => setProfileDraftId(event.target.value)} disabled={controlsBusy} /></label>
                  <label><span>Exact LM Studio model ID</span><input value={modelId} onChange={event => setModelId(event.target.value)} disabled={controlsBusy} /></label>
                  <div className="context-profile-numbers">
                    <label><span>Context window</span><input type="number" min="1" value={contextWindowTokens} onChange={event => setContextWindowTokens(Number(event.target.value))} disabled={controlsBusy} /></label>
                    <label><span>Visible output reserve</span><input type="number" min="1" value={requestedVisibleOutputTokens} onChange={event => setRequestedVisibleOutputTokens(Number(event.target.value))} disabled={controlsBusy} /></label>
                    <label><span>Safety margin</span><input type="number" min="0" value={safetyMarginTokens} onChange={event => setSafetyMarginTokens(Number(event.target.value))} disabled={controlsBusy} /></label>
                    <label><span>Maximum Campaign tokens</span><input type="number" min="1" value={maxCampaignTokens} onChange={event => setMaxCampaignTokens(Number(event.target.value))} disabled={controlsBusy} /></label>
                    <label><span>Automatic Record limit</span><input type="number" min="0" max="100" value={maxAutomaticRecords} onChange={event => setMaxAutomaticRecords(Number(event.target.value))} disabled={controlsBusy} /></label>
                    <label><span>Relation expansion limit</span><input type="number" min="0" max="100" value={maxRelationExpansions} onChange={event => setMaxRelationExpansions(Number(event.target.value))} disabled={controlsBusy} /></label>
                  </div>
                  <button type="submit" disabled={controlsBusy || !profileDraftId.trim() || !modelId.trim()}>Save model profile</button>
                </form>
              ) : null}
            </div>
          </details>

          <section className="context-card context-pins" aria-labelledby="context-pins-heading">
            <div className="context-card__heading">
              <div>
                <p className="eyebrow">Tier 1 · never truncated</p>
                <h5 id="context-pins-heading">Ordered manual pins</h5>
              </div>
              <span>{draftPins.length} pinned</span>
            </div>
            <div className="context-record-choices">
              {records.map(record => {
                const pinnedIndex = draftPins.indexOf(record.id);
                const blocked = record.archived || record.visibility === 'campaign_private';
                return (
                  <div className={blocked ? 'context-record-choice context-record-choice--blocked' : 'context-record-choice'} key={record.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={pinnedIndex >= 0}
                        onChange={() => togglePin(record)}
                        disabled={controlsBusy || props.readOnly || blocked}
                      />
                      <span><strong>{record.name}</strong><small>{record.kind} · {visibilityLabel(record.visibility)}{record.archived ? ' · Archived' : ''}</small></span>
                    </label>
                    {pinnedIndex >= 0 ? (
                      <div className="pin-order-actions" aria-label={`Order ${record.name}`}>
                        <button type="button" aria-label={`Move ${record.name} earlier`} onClick={() => setDraftPins(current => movePin(current, record.id, -1))} disabled={controlsBusy || props.readOnly || pinnedIndex === 0}>↑</button>
                        <span>{pinnedIndex + 1}</span>
                        <button type="button" aria-label={`Move ${record.name} later`} onClick={() => setDraftPins(current => movePin(current, record.id, 1))} disabled={controlsBusy || props.readOnly || pinnedIndex === draftPins.length - 1}>↓</button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {!props.readOnly ? (
              <button type="button" onClick={() => { void savePins(); }} disabled={controlsBusy || !selectedBinding || mismatch}>
                Save ordered pins
              </button>
            ) : null}
          </section>

          <section className="context-card context-preview" aria-labelledby="context-preview-heading">
            <p className="eyebrow">Dry run · no model call</p>
            <h5 id="context-preview-heading">Preview retrieval</h5>
            <label>
              <span>Current user message</span>
              <textarea rows={4} value={message} onChange={event => setMessage(event.target.value)} disabled={controlsBusy} />
            </label>
            <label>
              <span>Generation type</span>
              <select value={generationType} onChange={event => setGenerationType(event.target.value as GenerationType)} disabled={controlsBusy}>
                <option value="normal">Normal reply</option>
                <option value="regenerate">Regenerate</option>
                <option value="swipe">Swipe</option>
                <option value="continue">Continue</option>
              </select>
            </label>
            <button type="button" onClick={() => { void buildPlan(); }} disabled={controlsBusy || !selectedBinding || !selectedProfile || !message.trim() || mismatch}>
              Build Context Plan
            </button>
          </section>
        </div>
      )}

      {plan ? (
        <section className="context-plan" aria-labelledby="context-plan-heading">
          <div className="context-card__heading">
            <div><p className="eyebrow">Inspectable result</p><h5 id="context-plan-heading">Context Plan</h5></div>
            <span>{plan.budget.usedCampaignTokens} / {plan.budget.campaignBudgetTokens} tokens</span>
          </div>
          <div className="context-budget" aria-label="Context token budget">
            <span style={{ width: `${Math.min(100, plan.budget.campaignBudgetTokens ? plan.budget.usedCampaignTokens / plan.budget.campaignBudgetTokens * 100 : 100)}%` }} />
          </div>
          <dl className="context-facts context-plan-facts">
            <div><dt>Generation</dt><dd>{plan.generationType}</dd></div>
            <div><dt>Evidence</dt><dd>{plan.evidence.estimatedTokens} tokens · {plan.evidence.messageCount} message{plan.evidence.messageCount === 1 ? '' : 's'}</dd></div>
            <div><dt>Excerpt hash</dt><dd title={plan.evidence.excerptHash}>{plan.evidence.excerptHash.slice(0, 12)}…</dd></div>
          </dl>
          <ol className="context-selection-list">
            {plan.selections.map((selection, index) => (
              <li key={`${selection.tier}-${selection.recordId ?? index}`}>
                <div><strong>{selection.label}</strong><span>{selection.tier} · {visibilityLabel(selection.visibility)}</span></div>
                <span>{selection.tokenCost} tokens</span>
                <p>{selection.reason}</p>
              </li>
            ))}
          </ol>
          {plan.ambiguities.length ? (
            <details className="context-diagnostics" open>
              <summary>Ambiguity · selected nothing ({plan.ambiguities.length})</summary>
              {plan.ambiguities.map(entry => <p key={entry.phrase}><strong>{entry.phrase}</strong>: {entry.candidates.map(candidate => candidate.label).join(', ')}</p>)}
            </details>
          ) : null}
          {plan.omissions.length ? (
            <details className="context-diagnostics">
              <summary>Omitted ({plan.omissions.length})</summary>
              <ul>{plan.omissions.map((entry, index) => <li key={`${entry.recordId ?? entry.label}-${index}`}>{entry.label} · {entry.reason}{entry.tokenCost === undefined ? '' : ` · ${entry.tokenCost} tokens`}</li>)}</ul>
            </details>
          ) : null}
          <details className="context-rendered-block">
            <summary>Rendered Known block</summary>
            <pre>{plan.blocks.known}</pre>
          </details>
          {plan.blocks.secret ? <p className="context-secret-note">Narrator Secret material is isolated in a separate model-only block. Its contents are not repeated in this diagnostic.</p> : null}
        </section>
      ) : null}
    </section>
  );
}
