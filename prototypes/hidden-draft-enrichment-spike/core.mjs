export const REQUIRED_ANCHORS = Object.freeze([
  Object.freeze({ id: 'protagonist', pattern: /\bNera\b/i }),
  Object.freeze({ id: 'archive', pattern: /\barchive\b/i }),
  Object.freeze({ id: 'alone', pattern: /\balone\b|by herself/i }),
  Object.freeze({ id: 'dialogue', pattern: /Three turns,\s*then pull\./i }),
  Object.freeze({ id: 'distance', pattern: /\b12\b|\btwelve\b/i }),
  Object.freeze({
    id: 'wardrobe-closed',
    pattern: /(?:wardrobe|cabinet)[\s\S]{0,100}(?:remain(?:ed|s)? closed|still closed|unopened|did not open|not opened)|(?:remain(?:ed|s)? closed|still closed|unopened|did not open|not opened)[\s\S]{0,100}(?:wardrobe|cabinet)/i,
  }),
]);

export const REVISION_ONE_DETAILS = Object.freeze([
  Object.freeze({ id: 'blue-glass-eye', pattern: /blue glass eye/i }),
  Object.freeze({ id: 'brass-raven', pattern: /Brass Raven/i }),
]);

export const REVISION_TWO_DETAILS = Object.freeze([
  Object.freeze({ id: 'debt-mark', pattern: /debt mark|debt[^.!?]{0,40}paid|paid[^.!?]{0,40}debt/i }),
]);

export const FORBIDDEN_SECRET_PATTERNS = Object.freeze([
  Object.freeze({ id: 'secret-code', pattern: /VIOLET[- ]?NEEDLE[- ]?73/i }),
  Object.freeze({ id: 'secret-device', pattern: /poison(?:ed)? needle/i }),
]);

export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function phrasePattern(value) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`, 'iu');
}

export function resolveExactEntityMentions(text, records) {
  const source = normalizeText(text);
  const matches = [];
  for (const record of Array.isArray(records) ? records : []) {
    const terms = [record?.name, ...(Array.isArray(record?.aliases) ? record.aliases : [])]
      .filter(Boolean);
    const matchedTerms = terms.filter(term => phrasePattern(term)?.test(source));
    if (matchedTerms.length) {
      matches.push(Object.freeze({ id: String(record.id), name: String(record.name), matchedTerms }));
    }
  }
  return Object.freeze({
    selected: matches.length === 1 ? matches[0] : null,
    ambiguity: matches.length > 1 ? Object.freeze(matches) : Object.freeze([]),
  });
}

export function evaluateText(text, { required = REQUIRED_ANCHORS, details = [], forbidden = FORBIDDEN_SECRET_PATTERNS } = {}) {
  const value = String(text ?? '');
  const requiredChecks = Object.fromEntries(required.map(item => [item.id, item.pattern.test(value)]));
  const detailChecks = Object.fromEntries(details.map(item => [item.id, item.pattern.test(value)]));
  const forbiddenChecks = Object.fromEntries(forbidden.map(item => [item.id, !item.pattern.test(value)]));
  const checks = Object.freeze({ ...requiredChecks, ...detailChecks, ...forbiddenChecks });
  return Object.freeze({
    chars: value.length,
    words: value.trim() ? value.trim().split(/\s+/).length : 0,
    checks,
    failedChecks: Object.entries(checks).filter(([, ok]) => !ok).map(([id]) => id),
    pass: value.trim().length > 0 && Object.values(checks).every(Boolean),
  });
}

export function createRecoveryEntry({ modelId, stage, draft, error }) {
  if (!String(draft ?? '').trim()) throw new Error('Cannot recover without a usable draft.');
  return {
    modelId: String(modelId),
    stage: String(stage),
    draft: String(draft),
    error: String(error?.message ?? error),
    createdAt: new Date().toISOString(),
  };
}

export function summarizeRecovery(entry) {
  return Object.freeze({
    modelId: entry.modelId,
    stage: entry.stage,
    recoverable: Boolean(entry.draft),
    draftChars: String(entry.draft ?? '').length,
    error: entry.error,
  });
}

export function makeModelVerdict({ readiness, draft, revisionOne, revisionTwo, ambiguity, recovery }) {
  const hardFailures = [];
  if (!readiness?.pass) hardFailures.push('visible-output-readiness');
  if (!draft?.pass) hardFailures.push(...draft.failedChecks.map(id => `draft:${id}`));
  if (!revisionOne?.pass) hardFailures.push(...revisionOne.failedChecks.map(id => `revision-1:${id}`));
  if (!revisionTwo?.pass) hardFailures.push(...revisionTwo.failedChecks.map(id => `revision-2:${id}`));
  if (ambiguity?.selected || ambiguity?.ambiguity?.length !== 2) hardFailures.push('ambiguity-skip');
  if (!recovery?.recoverable) hardFailures.push('failure-recovery');
  return Object.freeze({
    verdict: hardFailures.length ? 'no-go' : 'go-two-revisions',
    hardFailures: Object.freeze(hardFailures),
  });
}

export function assertSummaryContainsNoDraftText(summary, rawCandidates) {
  const candidates = rawCandidates.map(value => String(value ?? '')).filter(Boolean);
  const visit = value => {
    if (typeof value === 'string') {
      if (candidates.some(candidate => value.includes(candidate))) {
        throw new Error('Summary persisted raw draft or revision prose.');
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value && typeof value === 'object') {
      for (const item of Object.values(value)) visit(item);
    }
  };
  visit(summary);
}
