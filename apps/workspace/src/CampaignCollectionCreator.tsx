import { useState, type FormEvent, type ReactNode } from 'react';
import type {
  CampaignAbilityCategory,
  CampaignCommit,
  CampaignDocument,
  CampaignOperation,
  CampaignQuestStatus,
} from '@st-llm-rpg/wire';
import { QuickCapture } from './QuickCapture.js';
import { useWorkspaceDirtyDraft, type RecordCollectionKey } from './workspace-navigation.js';
import { optionalUses, validUses, type LearnedDraft } from './CampaignActorPanels.js';
import type { SubjectOption } from './CampaignRecordEditors.js';

type CreateOperation = (operation: CampaignOperation) => Promise<CampaignCommit | null>;

type CommonProps = Readonly<{
  collection: RecordCollectionKey;
  document: CampaignDocument;
  subjects: readonly SubjectOption[];
  busy: boolean;
  onCapture: (operation: CampaignOperation) => Promise<boolean>;
  onCreate: CreateOperation;
  onCreated: (collection: RecordCollectionKey, recordId: string) => void;
}>;

function DetailedForm(props: CommonProps) {
  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const [relationId, setRelationId] = useState('');
  const [questStatus, setQuestStatus] = useState<CampaignQuestStatus>('active');
  const [abilityCategory, setAbilityCategory] = useState<CampaignAbilityCategory>('spell');
  const [abilityActorId, setAbilityActorId] = useState('');
  const [abilityPrepared, setAbilityPrepared] = useState(false);
  const [abilityEnabled, setAbilityEnabled] = useState(true);
  const [usesRemaining, setUsesRemaining] = useState('');
  const [usesMaximum, setUsesMaximum] = useState('');
  const [joinedActorName, setJoinedActorName] = useState('');
  const [joinedActorSummary, setJoinedActorSummary] = useState('');
  const [joinedItemName, setJoinedItemName] = useState('');
  const [joinedItemSummary, setJoinedItemSummary] = useState('');
  const activeActors = props.document.actors.filter(record => !record.archived);
  const usesDraft: LearnedDraft = {
    prepared: abilityPrepared,
    enabled: abilityEnabled,
    usesRemaining,
    usesMaximum,
  };
  const dirty = Boolean(
    name.trim() || summary.trim() || relationId || questStatus !== 'active'
    || abilityCategory !== 'spell' || abilityActorId || abilityPrepared || !abilityEnabled
    || usesRemaining.trim() || usesMaximum.trim() || joinedActorName.trim()
    || joinedActorSummary.trim() || joinedItemName.trim() || joinedItemSummary.trim(),
  );
  useWorkspaceDirtyDraft(`detailed-create:${props.collection}`, dirty);

  function reset(): void {
    setName('');
    setSummary('');
    setRelationId('');
    setQuestStatus('active');
    setAbilityCategory('spell');
    setAbilityActorId('');
    setAbilityPrepared(false);
    setAbilityEnabled(true);
    setUsesRemaining('');
    setUsesMaximum('');
  }

  async function create(event: FormEvent): Promise<void> {
    event.preventDefault();
    let operation: CampaignOperation;
    if (props.collection === 'actors') operation = { kind: 'create_actor', actor: { name, summary } };
    else if (props.collection === 'items') operation = { kind: 'create_item', item: { name, summary, ...(relationId ? { ownerActorId: relationId } : {}) } };
    else if (props.collection === 'quests') operation = { kind: 'create_quest', quest: { name, summary, status: questStatus } };
    else if (props.collection === 'places') operation = { kind: 'create_place', place: { name, summary } };
    else if (props.collection === 'facts') operation = { kind: 'create_fact', fact: { name, summary, ...(relationId ? { subjectId: relationId } : {}) } };
    else if (props.collection === 'world-objects') operation = { kind: 'create_world_object', worldObject: { name, summary, ...(relationId ? { placeId: relationId } : {}) } };
    else {
      const ability = { name, summary, category: abilityCategory };
      const remaining = optionalUses(usesRemaining);
      const maximum = optionalUses(usesMaximum);
      operation = abilityActorId ? {
        kind: 'create_ability_with_learning',
        ability,
        learnedAbility: {
          actorId: abilityActorId,
          prepared: abilityPrepared,
          enabled: abilityEnabled,
          ...(remaining === undefined ? {} : { usesRemaining: remaining }),
          ...(maximum === undefined ? {} : { usesMaximum: maximum }),
        },
      } : { kind: 'create_ability', ability };
    }
    const commit = await props.onCreate(operation);
    if (!commit) return;
    reset();
    const id = commit.affectedIds[0];
    if (id) props.onCreated(props.collection, id);
  }

  async function createActorWithItem(event: FormEvent): Promise<void> {
    event.preventDefault();
    const commit = await props.onCreate({
      kind: 'create_actor_with_item',
      actor: { name: joinedActorName, summary: joinedActorSummary },
      item: { name: joinedItemName, summary: joinedItemSummary },
    });
    if (!commit) return;
    setJoinedActorName('');
    setJoinedActorSummary('');
    setJoinedItemName('');
    setJoinedItemSummary('');
    const itemId = commit.affectedIds[1];
    if (itemId) props.onCreated('items', itemId);
  }

  let fields: ReactNode;
  if (props.collection === 'actors') fields = <>
    <label><span>Actor name</span><input value={name} onChange={event => setName(event.target.value)} disabled={props.busy} /></label>
    <label><span>Summary</span><textarea rows={3} value={summary} onChange={event => setSummary(event.target.value)} disabled={props.busy} /></label>
  </>;
  else if (props.collection === 'items') fields = <>
    <label><span>Item name</span><input value={name} onChange={event => setName(event.target.value)} disabled={props.busy} /></label>
    <label><span>Summary</span><textarea rows={3} value={summary} onChange={event => setSummary(event.target.value)} disabled={props.busy} /></label>
    <label><span>Carried by</span><select value={relationId} onChange={event => setRelationId(event.target.value)} disabled={props.busy}><option value="">Unattached</option>{activeActors.map(record => <option key={record.id} value={record.id}>{record.name}</option>)}</select></label>
  </>;
  else if (props.collection === 'quests') fields = <>
    <label><span>Quest name</span><input value={name} onChange={event => setName(event.target.value)} disabled={props.busy} /></label>
    <label><span>Summary</span><textarea rows={3} value={summary} onChange={event => setSummary(event.target.value)} disabled={props.busy} /></label>
    <label><span>Status</span><select value={questStatus} onChange={event => setQuestStatus(event.target.value as CampaignQuestStatus)} disabled={props.busy}><option value="active">Active</option><option value="completed">Completed</option></select></label>
  </>;
  else if (props.collection === 'places') fields = <>
    <label><span>Place name</span><input value={name} onChange={event => setName(event.target.value)} disabled={props.busy} /></label>
    <label><span>Summary</span><textarea rows={4} value={summary} onChange={event => setSummary(event.target.value)} disabled={props.busy} /></label>
  </>;
  else if (props.collection === 'facts') fields = <>
    <label><span>Fact name</span><input value={name} onChange={event => setName(event.target.value)} disabled={props.busy} /></label>
    <label><span>Statement</span><textarea rows={3} value={summary} onChange={event => setSummary(event.target.value)} disabled={props.busy} /></label>
    <label><span>About Record</span><select value={relationId} onChange={event => setRelationId(event.target.value)} disabled={props.busy}><option value="">Campaign-wide</option>{props.subjects.filter(option => !option.archived).map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
  </>;
  else if (props.collection === 'world-objects') fields = <>
    <label><span>Scene Feature name</span><input value={name} onChange={event => setName(event.target.value)} disabled={props.busy} /></label>
    <label><span>Description</span><textarea rows={3} value={summary} onChange={event => setSummary(event.target.value)} disabled={props.busy} /></label>
    <label><span>Place</span><select value={relationId} onChange={event => setRelationId(event.target.value)} disabled={props.busy}><option value="">No attached Place</option>{props.document.places.filter(record => !record.archived).map(record => <option key={record.id} value={record.id}>{record.name}</option>)}</select></label>
  </>;
  else fields = <>
    <label><span>Ability name</span><input value={name} onChange={event => setName(event.target.value)} disabled={props.busy} /></label>
    <label><span>Summary</span><textarea rows={3} value={summary} onChange={event => setSummary(event.target.value)} disabled={props.busy} /></label>
    <label><span>Category</span><select value={abilityCategory} onChange={event => setAbilityCategory(event.target.value as CampaignAbilityCategory)} disabled={props.busy}><option value="spell">Spell</option><option value="skill">Skill</option><option value="feat">Feat</option><option value="other">Other</option></select></label>
    <fieldset className="ability-learning-create"><legend>Learn now (optional)</legend>
      <label><span>Actor</span><select value={abilityActorId} onChange={event => setAbilityActorId(event.target.value)} disabled={props.busy}><option value="">Definition only</option>{activeActors.map(record => <option key={record.id} value={record.id}>{record.name}</option>)}</select></label>
      {abilityActorId ? <><label className="check-row"><input type="checkbox" checked={abilityPrepared} onChange={event => setAbilityPrepared(event.target.checked)} disabled={props.busy} /><span>Prepared</span></label><label className="check-row"><input type="checkbox" checked={abilityEnabled} onChange={event => setAbilityEnabled(event.target.checked)} disabled={props.busy} /><span>Enabled</span></label><label><span>Uses left</span><input type="number" min="0" step="1" value={usesRemaining} onChange={event => setUsesRemaining(event.target.value)} disabled={props.busy} placeholder="Unlimited" /></label><label><span>Maximum</span><input type="number" min="0" step="1" value={usesMaximum} onChange={event => setUsesMaximum(event.target.value)} disabled={props.busy} placeholder="Untracked" /></label></> : null}
    </fieldset>
  </>;

  const label = props.collection === 'world-objects' ? 'Scene Feature' : props.collection === 'abilities' ? 'Ability' : props.collection.slice(0, -1).replace(/^./, value => value.toUpperCase());
  return <>
    <form className={props.collection === 'abilities' ? 'create-record-form ability-create-form' : 'create-record-form'} onSubmit={event => { void create(event); }}>
      {fields}
      <button type="submit" disabled={props.busy || !name.trim() || (props.collection === 'abilities' && !validUses(usesDraft))}>Create {label}{props.collection === 'abilities' && abilityActorId ? ' and learn it' : ' with details'}</button>
    </form>
    {props.collection === 'actors' ? <details className="joined-create-panel"><summary>Create Actor with carried Item</summary><form className="joined-create-form" onSubmit={event => { void createActorWithItem(event); }}><fieldset><legend>Actor</legend><label><span>Name</span><input value={joinedActorName} onChange={event => setJoinedActorName(event.target.value)} disabled={props.busy} /></label><label><span>Summary</span><textarea rows={3} value={joinedActorSummary} onChange={event => setJoinedActorSummary(event.target.value)} disabled={props.busy} /></label></fieldset><fieldset><legend>Carried Item</legend><label><span>Name</span><input value={joinedItemName} onChange={event => setJoinedItemName(event.target.value)} disabled={props.busy} /></label><label><span>Summary</span><textarea rows={3} value={joinedItemSummary} onChange={event => setJoinedItemSummary(event.target.value)} disabled={props.busy} /></label></fieldset><button type="submit" disabled={props.busy || !joinedActorName.trim() || !joinedItemName.trim()}>Create both in one saved change</button></form></details> : null}
  </>;
}

export function CampaignCollectionCreator(props: CommonProps) {
  return (
    <QuickCapture collection={props.collection} busy={props.busy} onCapture={props.onCapture}>
      <DetailedForm key={props.collection} {...props} />
    </QuickCapture>
  );
}
