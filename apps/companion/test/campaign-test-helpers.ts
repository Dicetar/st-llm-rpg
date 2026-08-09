import type {
  CampaignCommit,
  CreateCampaignRequest,
  ExecuteCampaignRequest,
  ProblemCode,
} from '@st-llm-rpg/wire';
import { CampaignEngine } from '../src/modules/campaign/campaign-engine.js';
import type { CampaignJournal } from '../src/modules/campaign/campaign-journal.js';

const engines = new WeakMap<CampaignJournal, CampaignEngine>();

function engineFor(journal: CampaignJournal): CampaignEngine {
  const existing = engines.get(journal);
  if (existing) return existing;
  const engine = new CampaignEngine(journal);
  engines.set(journal, engine);
  return engine;
}

export class CampaignOutcomeError extends Error {
  readonly code: ProblemCode;

  constructor(code: ProblemCode, message: string) {
    super(message);
    this.name = 'CampaignOutcomeError';
    this.code = code;
  }
}

function accepted(outcome: Awaited<ReturnType<CampaignEngine['create']>>): CampaignCommit {
  if (outcome.ok) return outcome.value;
  throw new CampaignOutcomeError(outcome.problem.code, outcome.problem.message);
}

export async function acceptCampaignCreate(
  journal: CampaignJournal,
  request: CreateCampaignRequest,
): Promise<CampaignCommit> {
  return accepted(await engineFor(journal).create(request));
}

export async function acceptCampaignOperation(
  journal: CampaignJournal,
  campaignId: string,
  request: ExecuteCampaignRequest,
): Promise<CampaignCommit> {
  return accepted(await engineFor(journal).execute(campaignId, request));
}
