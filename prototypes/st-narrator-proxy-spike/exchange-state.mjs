const MAX_ATTEMPTS = 24;

export function createState({ listenUrl, lmStudioUrl, startedAt }) {
  return {
    kind: 'st-narrator-proxy-spike',
    throwaway: true,
    startedAt,
    listenUrl,
    lmStudioUrl,
    control: {
      campaignAvailable: true,
      upstreamMode: 'live',
      linkedDelayMs: 0,
      fixtureText: 'The deterministic proxy fixture completes this reply.',
    },
    totals: {
      received: 0,
      linked: 0,
      unlinked: 0,
      unknown: 0,
      upstreamCalls: 0,
      completed: 0,
      rejected: 0,
      cancelled: 0,
    },
    attempts: [],
  };
}

export function reduceState(state, event) {
  const next = structuredClone(state);

  if (event.type === 'control') {
    next.control = { ...next.control, ...event.patch };
    return next;
  }

  if (event.type === 'clear') {
    next.attempts = [];
    return next;
  }

  if (event.type === 'received') {
    next.totals.received += 1;
    next.totals[event.attempt.route] += 1;
    next.attempts.unshift(event.attempt);
    next.attempts = next.attempts.slice(0, MAX_ATTEMPTS);
    return next;
  }

  const attempt = next.attempts.find(candidate => candidate.traceId === event.traceId);
  if (!attempt) return next;

  if (event.type === 'stage') {
    attempt.stage = event.stage;
    attempt.transitions.push({ stage: event.stage, at: event.at });
    Object.assign(attempt, event.patch ?? {});
    return next;
  }

  if (event.type === 'upstream') {
    next.totals.upstreamCalls += 1;
    attempt.upstreamCalls += 1;
    attempt.stage = 'upstream';
    attempt.transitions.push({ stage: 'upstream', at: event.at });
    return next;
  }

  if (event.type === 'terminal') {
    attempt.stage = event.outcome;
    attempt.outcome = event.outcome;
    attempt.finishedAt = event.at;
    attempt.elapsedMs = event.elapsedMs;
    Object.assign(attempt, event.patch ?? {});
    attempt.transitions.push({ stage: event.outcome, at: event.at });
    if (event.outcome === 'completed') next.totals.completed += 1;
    else if (event.outcome === 'cancelled') next.totals.cancelled += 1;
    else next.totals.rejected += 1;
    return next;
  }

  return next;
}

export function createAttemptSummary({
  traceId,
  receivedAt,
  envelope,
  body,
  bodyHash,
  bodyBytes,
}) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  return {
    traceId,
    requestId: envelope.requestId,
    route: envelope.route.kind,
    bindingId: envelope.route.kind === 'linked' ? envelope.route.bindingId : null,
    generation: envelope.generation,
    locator: envelope.locator,
    model: typeof body?.model === 'string' ? body.model : null,
    stream: body?.stream === true,
    bodyHash,
    bodyBytes,
    messageCount: messages.length,
    messageRoles: messages.map(message => String(message?.role ?? 'unknown')),
    messageChars: messages.map(message => contentLength(message?.content)),
    stage: 'received',
    outcome: null,
    upstreamCalls: 0,
    upstreamStatus: null,
    upstreamChunks: 0,
    upstreamBytes: 0,
    visibleChars: 0,
    responseCommitted: false,
    cancelled: false,
    problemCode: null,
    receivedAt,
    finishedAt: null,
    elapsedMs: null,
    transitions: [{ stage: 'received', at: receivedAt }],
  };
}

export function createAdmissionFailureSummary({ traceId, receivedAt, bodyHash, bodyBytes }) {
  return {
    traceId,
    requestId: null,
    route: 'unknown',
    bindingId: null,
    generation: null,
    locator: null,
    model: null,
    stream: null,
    bodyHash,
    bodyBytes,
    messageCount: null,
    messageRoles: [],
    messageChars: [],
    stage: 'received',
    outcome: null,
    upstreamCalls: 0,
    upstreamStatus: null,
    upstreamChunks: 0,
    upstreamBytes: 0,
    visibleChars: 0,
    responseCommitted: false,
    cancelled: false,
    problemCode: null,
    receivedAt,
    finishedAt: null,
    elapsedMs: null,
    transitions: [{ stage: 'received', at: receivedAt }],
  };
}

function contentLength(content) {
  if (typeof content === 'string') return content.length;
  if (Array.isArray(content)) return JSON.stringify(content).length;
  return 0;
}
