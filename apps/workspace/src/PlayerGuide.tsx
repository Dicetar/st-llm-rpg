import type { CollectionKey } from './workspace-navigation.js';

type GuideAction = Readonly<{
  collection: CollectionKey;
  label: string;
}>;

function GuideButton(props: Readonly<{
  action: GuideAction;
  onNavigate: (collection: CollectionKey) => void;
}>) {
  return <button type="button" className="text-button guide-action" onClick={() => props.onNavigate(props.action.collection)}>{props.action.label}</button>;
}

function CampaignFlowIllustration() {
  return (
    <svg className="guide-illustration" viewBox="0 0 760 270" role="img" aria-labelledby="guide-illustration-title guide-illustration-description">
      <title id="guide-illustration-title">Your repeatable session route</title>
      <desc id="guide-illustration-description">Prepare Campaign truth, inspect narrator context, play in SillyTavern, review suggested updates, and decide what becomes saved Campaign truth.</desc>
      <path className="guide-illustration__path" d="M170 72 H590 C650 72 664 112 664 135 C664 175 630 200 590 200 H170 C110 200 96 165 96 135 C96 98 126 72 170 72Z" />
      <g className="guide-illustration__stop" transform="translate(38 96)"><rect width="150" height="78" rx="14" /><text x="75" y="29">1 · Prepare</text><text className="guide-illustration__note" x="75" y="53">Campaign Book</text></g>
      <g className="guide-illustration__stop" transform="translate(218 27)"><rect width="150" height="78" rx="14" /><text x="75" y="29">2 · Inspect</text><text className="guide-illustration__note" x="75" y="53">Narrator Context</text></g>
      <g className="guide-illustration__stop" transform="translate(572 96)"><rect width="150" height="78" rx="14" /><text x="75" y="29">3 · Play</text><text className="guide-illustration__note" x="75" y="53">SillyTavern</text></g>
      <g className="guide-illustration__stop" transform="translate(392 165)"><rect width="150" height="78" rx="14" /><text x="75" y="29">4 · Review</text><text className="guide-illustration__note" x="75" y="53">Story Updates</text></g>
      <g className="guide-illustration__decision" transform="translate(304 102)"><circle cx="76" cy="34" r="48" /><text x="76" y="29">You decide</text><text className="guide-illustration__note" x="76" y="51">what is saved</text></g>
    </svg>
  );
}

const firstSessionSteps: ReadonlyArray<Readonly<{
  title: string;
  description: string;
  action: GuideAction;
}>> = [
  {
    title: 'Link one saved chat',
    description: 'On Session Home, open Linked SillyTavern chats and choose the chat for this Campaign. Linking is always manual.',
    action: { collection: 'home', label: 'Open Session Home' },
  },
  {
    title: 'Set the present Scene',
    description: 'Name where the story is now and attach the place, people, items, and scene features that actually matter.',
    action: { collection: 'scene', label: 'Set Current Scene' },
  },
  {
    title: 'Record the important cast',
    description: 'Add the player character and recurring people. Put changing numbers such as health, gold, or suspicion in Live trackers.',
    action: { collection: 'actors', label: 'Open Actors' },
  },
  {
    title: 'Check narrator context',
    description: 'Choose the exact narrator model profile, inspect the token budget, and pin anything the next reply must not omit.',
    action: { collection: 'context', label: 'Open Narrator Context' },
  },
];

const collectionCards: ReadonlyArray<Readonly<{
  title: string;
  description: string;
  examples: string;
  action: GuideAction;
}>> = [
  { title: 'Actors', description: 'People and creatures with persistent identity.', examples: 'Description, aliases, visibility, Live trackers.', action: { collection: 'actors', label: 'Browse Actors' } },
  { title: 'Items', description: 'Objects worth remembering across scenes.', examples: 'Gear, keys, books, evidence, carried possessions.', action: { collection: 'items', label: 'Browse Items' } },
  { title: 'Abilities', description: 'Reusable spells, skills, and feats.', examples: 'Who knows it, prepared state, and remaining uses.', action: { collection: 'abilities', label: 'Browse Abilities' } },
  { title: 'Quests', description: 'Goals the story can advance or complete.', examples: 'Active objectives, linked people, places, and facts.', action: { collection: 'quests', label: 'Browse Quests' } },
  { title: 'World', description: 'Places, scene features, and lasting facts.', examples: 'Rooms, exits, landmarks, secrets, and world truths.', action: { collection: 'places', label: 'Browse Places' } },
  { title: 'Relationships', description: 'Directed links between two Actors.', examples: 'Trust, rivalry, obligation, status, and private notes.', action: { collection: 'relationships', label: 'Open Relationship Map' } },
];

const recoveryRows: ReadonlyArray<Readonly<{
  problem: string;
  meaning: string;
  recovery: string;
  action?: GuideAction;
}>> = [
  {
    problem: 'Campaign changed since this chat last followed it',
    meaning: 'The chat is still anchored to an older saved revision. Narration stops instead of guessing.',
    recovery: 'Open Narrator Context, review the change, then choose Follow current Campaign.',
    action: { collection: 'context', label: 'Review chat context' },
  },
  {
    problem: 'This tab is out of date',
    meaning: 'Another tab or device saved a newer revision. Your stale edit was not written.',
    recovery: 'Keep the draft, load the latest Campaign, then reapply the change if it still belongs.',
  },
  {
    problem: 'LM Studio is unavailable',
    meaning: 'Campaign editing still works, but a narrator or Story Update model call cannot start.',
    recovery: 'Start the LM Studio server and load the configured model, then retry from SillyTavern.',
  },
  {
    problem: 'Campaign Book is unavailable',
    meaning: 'Linked narration fails closed. Already saved Campaign data is not silently replaced or bypassed.',
    recovery: 'Keep the page open, restart Wayfinder if needed, and use Refresh status before retrying.',
  },
];

export function PlayerGuide(props: Readonly<{ onNavigate: (collection: CollectionKey) => void }>) {
  return (
    <section className="player-guide" aria-labelledby="player-guide-heading">
      <header className="player-guide__header">
        <div><p className="eyebrow">Player handbook · about five minutes</p><h4 id="player-guide-heading">Run the story without babysitting the machinery</h4></div>
        <p>Campaign Book keeps the facts you choose. SillyTavern writes the story. Story Updates suggest changes, but only you decide what becomes saved Campaign truth.</p>
      </header>

      <aside className="guide-principle" aria-label="The one rule to remember">
        <span>One rule</span>
        <div><strong>Chat is the story. Campaign Book is the reference.</strong><p>Keep only durable information here. You do not need to copy every sentence or moment from the chat.</p></div>
      </aside>

      <CampaignFlowIllustration />

      <section className="guide-section" aria-labelledby="guide-first-session">
        <div className="guide-section__heading"><div><p className="eyebrow">Start here</p><h5 id="guide-first-session">Prepare a first session</h5></div><p>Four actions make a Campaign ready for linked narration.</p></div>
        <ol className="guide-setup">
          {firstSessionSteps.map((step, index) => (
            <li key={step.title}>
              <span aria-hidden="true">{index + 1}</span>
              <div><h6>{step.title}</h6><p>{step.description}</p><GuideButton action={step.action} onNavigate={props.onNavigate} /></div>
            </li>
          ))}
        </ol>
      </section>

      <section className="guide-section" aria-labelledby="guide-session-loop">
        <div className="guide-section__heading"><div><p className="eyebrow">Repeat each session</p><h5 id="guide-session-loop">A simple play loop</h5></div><p>Most sessions use only these three passes.</p></div>
        <div className="guide-session-loop">
          <article><span>Before play</span><h6>Read the recap</h6><p>Session Home composes the current Scene, latest outcomes, open threads, active Quests, and visible Actor trackers. It makes no model call.</p><GuideButton action={{ collection: 'home', label: 'Read Session Home' }} onNavigate={props.onNavigate} /></article>
          <article><span>During play</span><h6>Change only what changed</h6><p>Use tracker −/+ buttons for immediate numbers. Save multi-field forms deliberately. Quick add a newly improvised person or object now; enrich it later.</p><GuideButton action={{ collection: 'actors', label: 'Update live state' }} onNavigate={props.onNavigate} /></article>
          <article><span>After a scene</span><h6>Close and review</h6><p>Advance Scene records outcomes and open threads. Story Updates can suggest durable changes from recent chat, but suggestions are not truth until applied.</p><div className="guide-inline-actions"><GuideButton action={{ collection: 'scene', label: 'Advance Scene' }} onNavigate={props.onNavigate} /><GuideButton action={{ collection: 'review', label: 'Review Story Updates' }} onNavigate={props.onNavigate} /></div></article>
        </div>
      </section>

      <section className="guide-section" aria-labelledby="guide-collections">
        <div className="guide-section__heading"><div><p className="eyebrow">Where things belong</p><h5 id="guide-collections">Find the right shelf</h5></div><p>Use Find anything when you remember the detail but not its collection.</p></div>
        <div className="guide-collection-grid">
          {collectionCards.map(card => <article key={card.title}><h6>{card.title}</h6><p>{card.description}</p><small>{card.examples}</small><GuideButton action={card.action} onNavigate={props.onNavigate} /></article>)}
        </div>
      </section>

      <section className="guide-section guide-context" aria-labelledby="guide-context-heading">
        <div className="guide-section__heading"><div><p className="eyebrow">What reaches the narrator</p><h5 id="guide-context-heading">Relevant detail, not the whole database</h5></div><GuideButton action={{ collection: 'context', label: 'Inspect Narrator Context' }} onNavigate={props.onNavigate} /></div>
        <div className="guide-context__grid">
          <article><strong>Automatic choices</strong><p>The current Scene, exact mentions, search matches, and a small number of related records can be selected within the saved budget.</p></article>
          <article><strong>Manual pins</strong><p>Pins stay included until you remove them. If pins alone exceed the budget, narration pauses and asks you to change them.</p></article>
          <article><strong>Visible omissions</strong><p>The Context Plan shows what was selected, what was omitted, and why. Building a plan is an inspection; it makes no model call.</p></article>
        </div>
      </section>

      <section className="guide-section guide-privacy" aria-labelledby="guide-privacy-heading">
        <div className="guide-section__heading"><div><p className="eyebrow">Privacy inside one Campaign</p><h5 id="guide-privacy-heading">Choose who may use a Record</h5></div><p>Visibility follows the Record into search and context planning.</p></div>
        <dl>
          <div><dt>Story knowledge</dt><dd>The narrator may use and reveal it normally.</dd></div>
          <div><dt>Behind the scenes</dt><dd>The narrator may use it to stay consistent but should not reveal it directly.</dd></div>
          <div><dt>Player notes</dt><dd>Visible to you in Campaign Book and never sent to the narrator.</dd></div>
        </dl>
      </section>

      <section className="guide-section guide-commit-model" aria-labelledby="guide-saving-heading">
        <div className="guide-section__heading"><div><p className="eyebrow">Know when data changes</p><h5 id="guide-saving-heading">Three kinds of action</h5></div></div>
        <div>
          <article><strong>Immediate</strong><p>Tracker −/+, counters, simple toggles, archive, and restore save one accepted change immediately.</p></article>
          <article><strong>Save or Cancel</strong><p>Forms with several fields keep a draft until you press Save. Navigation warns before abandoning unsaved input.</p></article>
          <article><strong>Review then apply</strong><p>Story Update suggestions remain editable proposals. Apply reviewed updates is the only action that makes accepted suggestions Campaign truth.</p></article>
        </div>
      </section>

      <section className="guide-section guide-recovery" aria-labelledby="guide-recovery-heading">
        <div className="guide-section__heading"><div><p className="eyebrow">When play stops</p><h5 id="guide-recovery-heading">Read the block; keep the draft</h5></div><p>Campaign Book fails closed around saved truth and tells you what to do next.</p></div>
        <dl>
          {recoveryRows.map(row => <div key={row.problem}><dt>{row.problem}</dt><dd><strong>What it means</strong><p>{row.meaning}</p><strong>What to do</strong><p>{row.recovery}</p>{row.action ? <GuideButton action={row.action} onNavigate={props.onNavigate} /> : null}</dd></div>)}
        </dl>
      </section>

      <footer className="guide-finish">
        <div><p className="eyebrow">Ready to play</p><strong>Return to the present, then write in SillyTavern.</strong><p>Come back when something durable changes or when you want to review the next reply’s context.</p></div>
        <GuideButton action={{ collection: 'home', label: 'Open Session Home' }} onNavigate={props.onNavigate} />
      </footer>
    </section>
  );
}
