import type { ComponentId, ComponentObservation, ReadinessDocument } from '@st-llm-rpg/wire';

export type StatusTone = 'good' | 'warning' | 'bad' | 'neutral';
export type StatusCard = Readonly<{
  id: ComponentId | 'campaign-authority';
  title: string;
  state: string;
  message: string;
  tone: StatusTone;
}>;

const TITLES: Readonly<Record<ComponentId, string>> = Object.freeze({
  workspace: 'Campaign Book',
  'sqlite-runtime': 'SQLite capability',
  sillytavern: 'SillyTavern',
  'lm-studio': 'LM Studio',
});

function toneFor(component: ComponentObservation): StatusTone {
  if (component.status === 'ready' || component.status === 'available') return 'good';
  if (component.blocking) return 'bad';
  return component.status === 'not-configured' ? 'neutral' : 'warning';
}

export function buildStatusCards(readiness: ReadinessDocument | null): readonly StatusCard[] {
  const authority: StatusCard = {
    id: 'campaign-authority',
    title: 'Campaign authority',
    state: 'Not enabled',
    message: 'Tracer #32 does not own Campaign truth. The existing SillyTavern extension remains the working fallback.',
    tone: 'neutral',
  };
  if (!readiness) return [authority];
  return [
    ...readiness.components.map(component => ({
      id: component.id,
      title: TITLES[component.id],
      state: component.status.replace('-', ' '),
      message: component.message,
      tone: toneFor(component),
    })),
    authority,
  ];
}
