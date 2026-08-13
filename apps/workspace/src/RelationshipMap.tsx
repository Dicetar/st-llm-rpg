import type { CampaignActor, CampaignRelationship } from '@st-llm-rpg/wire';

const visualActorLimit = 20;

function actorName(actors: ReadonlyMap<string, CampaignActor>, id: string): string {
  return actors.get(id)?.name ?? id;
}

function shortName(name: string): string {
  return name.length > 18 ? `${name.slice(0, 17)}…` : name;
}

function edgeEndpoints(source: Readonly<{ x: number; y: number }>, target: Readonly<{ x: number; y: number }>) {
  const deltaX = target.x - source.x;
  const deltaY = target.y - source.y;
  const length = Math.max(1, Math.hypot(deltaX, deltaY));
  const unitX = deltaX / length;
  const unitY = deltaY / length;
  const nodeEdge = Math.min(
    68 / Math.max(0.001, Math.abs(unitX)),
    22 / Math.max(0.001, Math.abs(unitY)),
  );
  return {
    x1: source.x + unitX * (nodeEdge + 2),
    y1: source.y + unitY * (nodeEdge + 2),
    x2: target.x - unitX * (nodeEdge + 10),
    y2: target.y - unitY * (nodeEdge + 10),
  };
}

export function RelationshipMap(props: {
  actors: readonly CampaignActor[];
  relationships: readonly CampaignRelationship[];
  onOpenActor: (actorId: string) => void;
}) {
  const actorById = new Map(props.actors.map(actor => [actor.id, actor]));
  const relationships = props.relationships
    .filter(record => !record.archived)
    .sort((left, right) => actorName(actorById, left.sourceActorId).localeCompare(actorName(actorById, right.sourceActorId))
      || actorName(actorById, left.targetActorId).localeCompare(actorName(actorById, right.targetActorId))
      || left.kind.localeCompare(right.kind)
      || left.id.localeCompare(right.id));
  const actorIds = [...new Set(relationships.flatMap(record => [record.sourceActorId, record.targetActorId]))]
    .sort((left, right) => actorName(actorById, left).localeCompare(actorName(actorById, right)) || left.localeCompare(right));
  const visualActorIds = actorIds.slice(0, visualActorLimit);
  const visualSet = new Set(visualActorIds);
  const centerX = 400;
  const centerY = 210;
  const radiusX = 300;
  const radiusY = 155;
  const positions = new Map(visualActorIds.map((id, index) => {
    const angle = ((Math.PI * 2 * index) / Math.max(1, visualActorIds.length)) - (Math.PI / 2);
    return [id, { x: centerX + Math.cos(angle) * radiusX, y: centerY + Math.sin(angle) * radiusY }] as const;
  }));

  return (
    <section className="relationship-map" aria-labelledby="relationship-map-heading">
      <div className="collection-heading">
        <div><h4 id="relationship-map-heading">Relationship Map</h4><p>Current links at a glance. The route list below is the keyboard and phone view.</p></div>
        <span className="relationship-map__count">{relationships.length} {relationships.length === 1 ? 'link' : 'links'}</span>
      </div>
      {relationships.length === 0 ? <p className="empty-state">No current links yet. Add a Relationship below and it will appear here.</p> : (
        <>
          <div className="relationship-map__canvas">
            <svg viewBox="0 0 800 420" role="img" aria-labelledby="relationship-map-svg-title relationship-map-svg-description">
              <title id="relationship-map-svg-title">Actor relationship diagram</title>
              <desc id="relationship-map-svg-description">Directed links between Actors. Use the route list after the diagram to open an Actor.</desc>
              <defs><marker id="relationship-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" /></marker></defs>
              {relationships.filter(record => visualSet.has(record.sourceActorId) && visualSet.has(record.targetActorId)).map(record => {
                const source = positions.get(record.sourceActorId)!;
                const target = positions.get(record.targetActorId)!;
                const edge = edgeEndpoints(source, target);
                return <g key={record.id} className={`relationship-map__edge relationship-map__edge--${record.status} relationship-map__edge--${record.visibility ?? 'known'}`}><title>{`${actorName(actorById, record.sourceActorId)} ${record.kind} ${actorName(actorById, record.targetActorId)} (${record.status})`}</title><line {...edge} markerEnd="url(#relationship-arrow)" /></g>;
              })}
              {visualActorIds.map(id => {
                const actor = actorById.get(id);
                const position = positions.get(id)!;
                return <g key={id} className={actor?.archived ? 'relationship-map__node relationship-map__node--archived' : 'relationship-map__node'} transform={`translate(${position.x - 68} ${position.y - 22})`}><rect width="136" height="44" rx="12" /><text x="68" y="27" textAnchor="middle">{shortName(actorName(actorById, id))}</text></g>;
              })}
            </svg>
            {actorIds.length > visualActorLimit ? <p>Diagram shows {visualActorLimit} of {actorIds.length} linked Actors. Every link remains in the route list.</p> : null}
          </div>
          <ol className="relationship-map__routes" aria-label="Relationship routes">
            {relationships.map(record => (
              <li key={record.id}>
                <button type="button" className="relationship-map__actor" onClick={() => props.onOpenActor(record.sourceActorId)}>{actorName(actorById, record.sourceActorId)}</button>
                <span><strong>{record.kind}</strong><small>{record.status.replace('_', ' ')}</small></span>
                <span aria-hidden="true">→</span>
                <button type="button" className="relationship-map__actor" onClick={() => props.onOpenActor(record.targetActorId)}>{actorName(actorById, record.targetActorId)}</button>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
