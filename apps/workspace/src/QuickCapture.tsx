import { useState, type FormEvent, type ReactNode } from 'react';
import type { CampaignOperation } from '@st-llm-rpg/wire';
import type { RecordCollectionKey } from './workspace-navigation.js';
import { collectionLabel, useWorkspaceDirtyDraft } from './workspace-navigation.js';

export function quickCaptureOperation(collection: RecordCollectionKey, name: string): CampaignOperation {
  const cleanName = name.trim();
  if (collection === 'actors') return { kind: 'create_actor', actor: { name: cleanName } };
  if (collection === 'items') return { kind: 'create_item', item: { name: cleanName } };
  if (collection === 'quests') return { kind: 'create_quest', quest: { name: cleanName } };
  if (collection === 'places') return { kind: 'create_place', place: { name: cleanName } };
  if (collection === 'facts') return { kind: 'create_fact', fact: { name: cleanName } };
  if (collection === 'world-objects') return { kind: 'create_world_object', worldObject: { name: cleanName } };
  return { kind: 'create_ability', ability: { name: cleanName } };
}

function singularLabel(collection: RecordCollectionKey): string {
  if (collection === 'world-objects') return 'World Object';
  if (collection === 'abilities') return 'Ability';
  return collectionLabel(collection).replace(/s$/, '');
}

export function QuickCapture(props: Readonly<{
  collection: RecordCollectionKey;
  busy: boolean;
  onCapture: (operation: CampaignOperation) => Promise<boolean>;
  children?: ReactNode;
}>) {
  const [name, setName] = useState('');
  const label = singularLabel(props.collection);
  useWorkspaceDirtyDraft(`quick-capture:${props.collection}`, Boolean(name.trim()));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    const saved = await props.onCapture(quickCaptureOperation(props.collection, name));
    if (saved) setName('');
  }

  return (
    <div className="capture-workflow">
      <form className="quick-capture" onSubmit={event => { void submit(event); }}>
        <label htmlFor={`quick-capture-${props.collection}`}>
          <span>Quick add {label}</span>
          <small>Create a named stub now; open it from the list to add details.</small>
        </label>
        <div>
          <input
            id={`quick-capture-${props.collection}`}
            name={`quick-capture-${props.collection}`}
            autoComplete="off"
            value={name}
            onChange={event => setName(event.target.value)}
            placeholder={`${label} name`}
            maxLength={160}
            disabled={props.busy}
          />
          <button type="submit" disabled={props.busy || !name.trim()}>Add</button>
        </div>
      </form>
      {props.children ? (
        <details className="detailed-create-panel">
          <summary>Add {label} with details</summary>
          <div>{props.children}</div>
        </details>
      ) : null}
    </div>
  );
}
