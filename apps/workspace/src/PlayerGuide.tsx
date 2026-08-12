import type { CollectionKey } from './workspace-navigation.js';

function CampaignFlowIllustration() {
  return (
    <svg className="guide-illustration" viewBox="0 0 760 250" role="img" aria-labelledby="guide-illustration-title guide-illustration-description">
      <title id="guide-illustration-title">Campaign Book and SillyTavern working together</title>
      <desc id="guide-illustration-description">Saved Campaign records are selected for narrator context, used for one SillyTavern reply, and suggested story changes return for your review.</desc>
      <path className="guide-illustration__path" d="M178 124 C238 124 246 58 315 58 M445 58 C515 58 515 124 579 124 M579 142 C515 142 515 206 445 206 M315 206 C245 206 245 142 178 142" />
      <g transform="translate(20 55)"><rect width="158" height="136" rx="18" /><path d="M28 28h102M28 54h70M28 80h94M28 106h54" /><text x="79" y="-16">Campaign Book</text></g>
      <g transform="translate(315 17)"><rect width="130" height="82" rx="16" /><path d="M26 28h78M26 50h54" /><text x="65" y="-10">Narrator context</text></g>
      <g transform="translate(579 55)"><rect width="158" height="136" rx="18" /><path d="M24 28h110v62H72l-24 20v-20H24z" /><text x="79" y="-16">SillyTavern</text></g>
      <g transform="translate(315 165)"><rect width="130" height="82" rx="16" /><path d="M28 26l12 12 20-22M72 27h30M28 56h74" /><text x="65" y="-10">Your review</text></g>
    </svg>
  );
}

export function PlayerGuide(props: Readonly<{ onNavigate: (collection: CollectionKey) => void }>) {
  const steps = [
    ['Set the present moment', 'Open Current Scene and attach the place, people, items, and scene features that matter now.', 'scene'] as const,
    ['Keep records current', 'Add Actors, Items, Abilities, Relationships, Quests, Facts, and Places where you can find and edit them later.', 'actors'] as const,
    ['Choose narrator context', 'Narrator Context shows linked chats, manual pins, budget, and exactly what will be sent before a reply.', 'context'] as const,
    ['Play in SillyTavern', 'Your character card and chat settings control the narrator. Campaign Book supplies only the linked Campaign context.', 'context'] as const,
    ['Review suggested updates', 'Story Sync proposes changes from recent chat. Nothing becomes Campaign truth until you review and apply it.', 'review'] as const,
  ];
  return (
    <section className="player-guide" aria-labelledby="player-guide-heading">
      <header className="player-guide__header">
        <div><p className="eyebrow">Two-minute tour</p><h4 id="player-guide-heading">How Campaign Book fits your session</h4></div>
        <p>Campaign Book stores the world you curate. SillyTavern remains where you chat and generate prose.</p>
      </header>
      <CampaignFlowIllustration />
      <ol className="guide-steps">
        {steps.map(([title, description, collection], index) => (
          <li key={title}>
            <span aria-hidden="true">{index + 1}</span>
            <div><h5>{title}</h5><p>{description}</p><button type="button" className="text-button" onClick={() => props.onNavigate(collection)}>Open {collection === 'context' ? 'Narrator Context' : collection === 'review' ? 'Story Updates' : collection === 'scene' ? 'Current Scene' : 'Actors'}</button></div>
          </li>
        ))}
      </ol>
      <div className="guide-privacy">
        <h5>Who can see a Record?</h5>
        <dl>
          <div><dt>Story knowledge</dt><dd>The narrator may use and reveal it.</dd></div>
          <div><dt>Behind the scenes</dt><dd>The narrator may use it but should not reveal it directly.</dd></div>
          <div><dt>Player notes</dt><dd>Never sent to the narrator.</dd></div>
        </dl>
      </div>
    </section>
  );
}
