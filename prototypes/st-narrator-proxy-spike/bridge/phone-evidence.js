export const PHONE_EVIDENCE_VERSION = 3;

export const PHONE_EVIDENCE_STEPS = Object.freeze([
  'normal',
  'regenerate',
  'continue',
  'swipe',
  'stop',
  'outage-linked',
  'outage-unlinked',
]);

export const PHONE_SENTINELS = Object.freeze([
  'PHONE_NORMAL',
  'PHONE_REGENERATE',
  'PHONE_CONTINUE',
  'PHONE_SWIPE',
  'PHONE_DELAYED_NORMAL',
  'PHONE_OUTAGE_NORMAL',
]);

const STEP_EXPECTATIONS = Object.freeze({
  normal: { route: 'linked', generation: 'normal' },
  regenerate: { route: 'linked', generation: 'regenerate' },
  continue: { route: 'linked', generation: 'continue' },
  swipe: { route: 'linked', generation: 'swipe' },
  stop: { route: 'linked', generation: 'normal' },
  'outage-linked': { route: 'linked', generation: 'normal' },
  'outage-unlinked': { route: 'unlinked', generation: 'normal' },
});

function cleanText(value, limit = 500) {
  return String(value ?? '').replace(/\0/g, '').trim().slice(0, limit);
}

function messageText(message) {
  return typeof message?.mes === 'string'
    ? message.mes
    : typeof message?.content === 'string'
      ? message.content
      : '';
}

function messageRole(message) {
  if (message?.is_user === true || message?.role === 'user') return 'user';
  if (message?.is_user === false || message?.role === 'assistant') return 'assistant';
  return 'unknown';
}

function sentinelCounts(values) {
  const counts = Object.fromEntries(PHONE_SENTINELS.map(sentinel => [sentinel, 0]));
  for (const value of values) {
    const text = String(value ?? '');
    for (const sentinel of PHONE_SENTINELS) {
      let offset = 0;
      while ((offset = text.indexOf(sentinel, offset)) >= 0) {
        counts[sentinel] += 1;
        offset += sentinel.length;
      }
    }
  }
  return counts;
}

export function summarizePhoneChat(chat) {
  const messages = Array.isArray(chat) ? chat : [];
  const allCandidateTexts = [];
  let userMessages = 0;
  let assistantMessages = 0;
  let latestAssistant = null;

  for (const message of messages) {
    const role = messageRole(message);
    if (role === 'user') userMessages += 1;
    if (role === 'assistant') {
      assistantMessages += 1;
      latestAssistant = message;
    }
    allCandidateTexts.push(messageText(message));
    if (Array.isArray(message?.swipes)) allCandidateTexts.push(...message.swipes);
  }

  return Object.freeze({
    messageCount: messages.length,
    userMessages,
    assistantMessages,
    lastRole: messages.length ? messageRole(messages.at(-1)) : 'none',
    sentinels: sentinelCounts(allCandidateTexts),
    selectedAssistantSentinels: sentinelCounts([latestAssistant ? messageText(latestAssistant) : '']),
    latestAssistantSwipeCount: Array.isArray(latestAssistant?.swipes) ? latestAssistant.swipes.length : 0,
    latestAssistantSwipeIndex: Number.isInteger(latestAssistant?.swipe_id) ? latestAssistant.swipe_id : null,
  });
}

export function sanitizeProxyAttempt(attempt) {
  if (!attempt || typeof attempt !== 'object') return null;
  return Object.freeze({
    route: attempt.route ?? null,
    generation: attempt.generation ?? null,
    outcome: attempt.outcome ?? null,
    stage: attempt.stage ?? null,
    upstreamCalls: Number(attempt.upstreamCalls ?? 0),
    upstreamStatus: attempt.upstreamStatus ?? null,
    upstreamChunks: Number(attempt.upstreamChunks ?? 0),
    upstreamBytes: Number(attempt.upstreamBytes ?? 0),
    visibleChars: Number(attempt.visibleChars ?? 0),
    responseCommitted: Boolean(attempt.responseCommitted),
    cancelled: Boolean(attempt.cancelled),
    problemCode: attempt.problemCode ?? null,
    elapsedMs: Number.isFinite(attempt.elapsedMs) ? Number(attempt.elapsedMs) : null,
    transitions: Array.isArray(attempt.transitions)
      ? attempt.transitions.map(entry => cleanText(entry?.stage, 80)).filter(Boolean)
      : [],
  });
}

export function selectPhoneAttempt(proxyState, step) {
  const expected = STEP_EXPECTATIONS[step];
  if (!expected) throw new Error(`Unknown phone evidence step: ${step}`);
  const attempts = Array.isArray(proxyState?.attempts) ? proxyState.attempts : [];
  const candidates = attempts.filter(attempt =>
    attempt?.route === expected.route && attempt?.generation === expected.generation);

  if (step === 'stop') {
    return candidates.find(attempt => attempt?.outcome === 'cancelled' || attempt?.cancelled === true) ?? null;
  }
  if (step === 'outage-linked') {
    return candidates.find(attempt => attempt?.problemCode === 'RPG_CAMPAIGN_UNAVAILABLE') ?? null;
  }
  if (step === 'outage-unlinked') {
    return candidates.find(attempt => attempt?.outcome === 'completed') ?? null;
  }
  return candidates.find(attempt => attempt?.outcome === 'completed') ?? null;
}

function completed(attempt, route, generation) {
  return Boolean(attempt
    && attempt.route === route
    && attempt.generation === generation
    && attempt.outcome === 'completed'
    && attempt.responseCommitted === true
    && attempt.upstreamCalls === 1);
}

export function evaluatePhoneStep(step, chat, attempt) {
  const checks = {};

  if (step === 'normal') {
    checks.proxyCompleted = completed(attempt, 'linked', 'normal');
    checks.normalSentinelSaved = chat.sentinels.PHONE_NORMAL > 0;
  } else if (step === 'regenerate') {
    checks.proxyCompleted = completed(attempt, 'linked', 'regenerate');
    checks.regenerateSentinelSaved = chat.sentinels.PHONE_REGENERATE > 0;
  } else if (step === 'continue') {
    checks.proxyCompleted = completed(attempt, 'linked', 'continue');
    checks.continueSentinelSelected = chat.selectedAssistantSentinels.PHONE_CONTINUE > 0;
  } else if (step === 'swipe') {
    checks.proxyCompleted = completed(attempt, 'linked', 'swipe');
    checks.swipeSentinelSaved = chat.sentinels.PHONE_SWIPE > 0;
    checks.multipleSwipeCandidates = chat.latestAssistantSwipeCount >= 2;
  } else if (step === 'stop') {
    checks.proxyCancelled = Boolean(attempt
      && attempt.route === 'linked'
      && attempt.generation === 'normal'
      && attempt.outcome === 'cancelled'
      && attempt.cancelled === true);
    checks.noSuccessCommit = Boolean(attempt && attempt.responseCommitted === false);
    checks.noDelayedSentinel = chat.sentinels.PHONE_DELAYED_NORMAL === 0;
  } else if (step === 'outage-linked') {
    checks.failedBeforeUpstream = Boolean(attempt
      && attempt.route === 'linked'
      && attempt.problemCode === 'RPG_CAMPAIGN_UNAVAILABLE'
      && attempt.upstreamCalls === 0);
    checks.userTurnRetained = chat.lastRole === 'user';
    checks.noOutageAssistantSaved = chat.sentinels.PHONE_OUTAGE_NORMAL === 0;
  } else if (step === 'outage-unlinked') {
    checks.proxyCompleted = completed(attempt, 'unlinked', 'normal');
    checks.outageSentinelSaved = chat.sentinels.PHONE_OUTAGE_NORMAL > 0;
  } else {
    throw new Error(`Unknown phone evidence step: ${step}`);
  }

  return Object.freeze({
    checks: Object.freeze(checks),
    pass: Object.values(checks).every(Boolean),
  });
}

export function createPhoneEvidenceEntry({
  step,
  chat,
  proxyState,
  environment,
  route,
  statusText,
  capturedAt = new Date().toISOString(),
}) {
  if (!PHONE_EVIDENCE_STEPS.includes(step)) throw new Error(`Unknown phone evidence step: ${step}`);
  const chatSummary = summarizePhoneChat(chat);
  const attempt = sanitizeProxyAttempt(selectPhoneAttempt(proxyState, step));
  const evaluation = evaluatePhoneStep(step, chatSummary, attempt);

  return Object.freeze({
    schemaVersion: PHONE_EVIDENCE_VERSION,
    step,
    capturedAt,
    environment: Object.freeze({
      hostname: cleanText(environment?.hostname, 255),
      connectionPath: cleanText(environment?.connectionPath, 32),
      viewportWidth: Number(environment?.viewportWidth ?? 0),
      viewportHeight: Number(environment?.viewportHeight ?? 0),
      devicePixelRatio: Number(environment?.devicePixelRatio ?? 1),
      userAgent: cleanText(environment?.userAgent, 400),
    }),
    route: route === 'linked' || route === 'unlinked' ? route : 'unknown',
    proxyControl: Object.freeze({
      campaignAvailable: Boolean(proxyState?.control?.campaignAvailable),
      upstreamMode: cleanText(proxyState?.control?.upstreamMode, 32),
      linkedDelayMs: Number(proxyState?.control?.linkedDelayMs ?? 0),
    }),
    attempt,
    chat: chatSummary,
    statusText: cleanText(statusText, 500),
    checks: evaluation.checks,
    pass: evaluation.pass,
  });
}

export function createPhoneEvidenceReport(entries) {
  const latestByStep = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (entry?.schemaVersion !== PHONE_EVIDENCE_VERSION) continue;
    if (PHONE_EVIDENCE_STEPS.includes(entry?.step)) latestByStep.set(entry.step, entry);
  }
  const orderedEntries = PHONE_EVIDENCE_STEPS.map(step => latestByStep.get(step)).filter(Boolean);
  const missingSteps = PHONE_EVIDENCE_STEPS.filter(step => !latestByStep.has(step));
  const failedSteps = orderedEntries.filter(entry => entry.pass !== true).map(entry => entry.step);
  const environmentIncompleteSteps = orderedEntries
    .filter(entry => !entry.environment?.hostname
      || !entry.environment?.connectionPath
      || !entry.environment?.userAgent)
    .map(entry => entry.step);
  const viewportOutOfRangeSteps = orderedEntries
    .filter(entry => entry.environment?.viewportWidth < 300 || entry.environment?.viewportWidth > 430)
    .map(entry => entry.step);
  const retrySet = new Set([
    ...failedSteps,
    ...environmentIncompleteSteps,
    ...viewportOutOfRangeSteps,
  ]);
  const retrySteps = PHONE_EVIDENCE_STEPS.filter(step => retrySet.has(step));

  return Object.freeze({
    schema: 'st-rpg.proxy-phone-evidence',
    version: PHONE_EVIDENCE_VERSION,
    generatedAt: new Date().toISOString(),
    redaction: 'No chat prose, prompts, campaign data, IDs, or generated text are included; only fixed sentinel counts and sanitized transport metadata.',
    complete: missingSteps.length === 0,
    pass: missingSteps.length === 0 && retrySteps.length === 0,
    missingSteps,
    failedSteps,
    retrySteps,
    environmentIncompleteSteps,
    viewportOutOfRangeSteps,
    entries: orderedEntries,
  });
}

export function nextPhoneEvidenceStep(report) {
  const pending = new Set([
    ...(Array.isArray(report?.retrySteps) ? report.retrySteps : []),
    ...(Array.isArray(report?.missingSteps) ? report.missingSteps : []),
  ]);
  return PHONE_EVIDENCE_STEPS.find(step => pending.has(step)) ?? null;
}
