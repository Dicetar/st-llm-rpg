import type {
  ChatBindingDocument,
  NarratorModelProfile,
  PreflightContextRequest,
  SetContextPinsRequest,
} from '@st-llm-rpg/wire';
import { makeProblem } from '../../problem.js';
import type { Outcome } from '../campaign/campaign-engine.js';
import { CampaignExpectedError } from '../campaign/campaign-error.js';
import { ContextPlanner, type ContextPlanningSource } from './context-planner.js';

export interface ContextSettings extends ContextPlanningSource {
  saveNarratorModelProfile(profile: NarratorModelProfile): Promise<NarratorModelProfile>;
  listNarratorModelProfiles(): Promise<readonly NarratorModelProfile[]>;
  setContextPins(input: SetContextPinsRequest & Readonly<{ bindingId: string }>): Promise<ChatBindingDocument>;
}

function failed<T>(error: unknown, requestId: string): Outcome<T> {
  if (error instanceof CampaignExpectedError) {
    return {
      ok: false,
      problem: makeProblem({
        code: error.code,
        message: error.message,
        requestId,
        ...(error.details === undefined ? {} : { details: error.details }),
        actions: [{ id: 'open-context-tray', label: 'Open Context Tray', kind: 'inspect' }],
      }),
    };
  }
  throw error;
}

export class ContextService {
  readonly planner: ContextPlanner;

  constructor(private readonly settings: ContextSettings) {
    this.planner = new ContextPlanner(settings);
  }

  async saveProfile(profileId: string, profile: NarratorModelProfile, requestId: string): Promise<Outcome<NarratorModelProfile>> {
    if (profile.id !== profileId) {
      return {
        ok: false,
        problem: makeProblem({
          code: 'CAMPAIGN_VALIDATION_FAILED',
          message: 'Narrator model profile ID does not match the route.',
          requestId,
          details: { routeProfileId: profileId, bodyProfileId: profile.id },
        }),
      };
    }
    try {
      return { ok: true, value: await this.settings.saveNarratorModelProfile(profile) };
    } catch (error) {
      return failed(error, requestId);
    }
  }

  async profiles(requestId: string): Promise<Outcome<readonly NarratorModelProfile[]>> {
    try {
      return { ok: true, value: await this.settings.listNarratorModelProfiles() };
    } catch (error) {
      return failed(error, requestId);
    }
  }

  async setPins(bindingId: string, input: SetContextPinsRequest): Promise<Outcome<ChatBindingDocument>> {
    try {
      return { ok: true, value: await this.settings.setContextPins({ ...input, bindingId }) };
    } catch (error) {
      return failed(error, input.requestId);
    }
  }

  async plan(request: PreflightContextRequest, signal: AbortSignal): Promise<ReturnType<ContextPlanner['plan']>> {
    try {
      return await this.planner.plan(request, signal);
    } catch (error) {
      return failed(error, request.requestId);
    }
  }
}
