import type { ComponentObservation } from '@st-llm-rpg/wire';
import type { CompanionConfig } from './config.js';

export type DependencyProbe = () => Promise<readonly ComponentObservation[]>;
export type CampaignAuthorityProbe = () => ComponentObservation;

function observedAt(): string {
  return new Date().toISOString();
}

async function probeHttp(input: {
  id: 'sillytavern' | 'lm-studio';
  url: string;
  timeoutMs: number;
  availableMessage: string;
  unavailableMessage: string;
}): Promise<ComponentObservation> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  const started = performance.now();
  try {
    const response = await fetch(input.url, {
      method: 'GET',
      signal: controller.signal,
      headers: { accept: 'application/json,text/html;q=0.8,*/*;q=0.1' },
    });
    const latencyMs = Math.max(0, performance.now() - started);
    if (!response.ok) {
      return {
        id: input.id,
        status: 'degraded',
        blocking: false,
        message: `${input.unavailableMessage} HTTP ${response.status}.`,
        observedAt: observedAt(),
        latencyMs,
      };
    }
    return {
      id: input.id,
      status: 'available',
      blocking: false,
      message: input.availableMessage,
      observedAt: observedAt(),
      latencyMs,
    };
  } catch (error) {
    const reason = error instanceof Error && error.name === 'AbortError' ? 'probe timed out' : 'connection failed';
    return {
      id: input.id,
      status: 'unavailable',
      blocking: false,
      message: `${input.unavailableMessage} ${reason}.`,
      observedAt: observedAt(),
      latencyMs: Math.max(0, performance.now() - started),
    };
  } finally {
    clearTimeout(timer);
  }
}

export function createDefaultDependencyProbe(
  config: CompanionConfig,
  campaignAuthority: CampaignAuthorityProbe,
): DependencyProbe {
  return async () => Promise.all([
    Promise.resolve<ComponentObservation>({
      id: 'workspace',
      status: 'ready',
      blocking: true,
      message: 'Campaign Book production assets are available.',
      observedAt: observedAt(),
    }),
    Promise.resolve(campaignAuthority()),
    probeHttp({
      id: 'sillytavern',
      url: config.sillyTavernBaseUrl,
      timeoutMs: config.probeTimeoutMs,
      availableMessage: 'SillyTavern is reachable. The companion does not own this process.',
      unavailableMessage: 'SillyTavern is not reachable; Campaign Book remains available.',
    }),
    probeHttp({
      id: 'lm-studio',
      url: `${config.lmStudioBaseUrl}/models`,
      timeoutMs: config.probeTimeoutMs,
      availableMessage: 'LM Studio is reachable. The companion observes but does not manage models.',
      unavailableMessage: 'LM Studio is not reachable; model actions are unavailable.',
    }),
  ]);
}
