import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PHONE_EVIDENCE_STEPS,
  createPhoneEvidenceEntry,
  createPhoneEvidenceReport,
  evaluatePhoneStep,
  sanitizeProxyAttempt,
  selectPhoneAttempt,
  summarizePhoneChat,
} from './phone-evidence.js';

function attempt(patch = {}) {
  return {
    route: 'linked', generation: 'normal', outcome: 'completed', stage: 'completed',
    upstreamCalls: 1, upstreamStatus: 200, upstreamChunks: 1, upstreamBytes: 100,
    visibleChars: 12, responseCommitted: true, cancelled: false, problemCode: null,
    elapsedMs: 25, transitions: [{ stage: 'received' }, { stage: 'completed' }],
    requestId: 'must-not-leak', locator: { private: true }, bodyHash: 'must-not-leak',
    ...patch,
  };
}

function entry(step, chat, proxyAttempt, route = 'linked') {
  return createPhoneEvidenceEntry({
    step,
    chat,
    proxyState: {
      control: { campaignAvailable: true, upstreamMode: 'fixture', linkedDelayMs: 0 },
      attempts: [proxyAttempt],
    },
    environment: {
      hostname: '10.8.1.2', connectionPath: 'vpn', viewportWidth: 360, viewportHeight: 740,
      devicePixelRatio: 3, userAgent: 'Android Browser', hostPrefix: '12345678',
      expectedDesktopHostPrefix: '12345678',
    },
    route,
    statusText: 'linked normal prepared',
    notes: '',
    capturedAt: '2026-08-05T00:00:00.000Z',
  });
}

test('summarizes only fixed sentinels and structural chat state', () => {
  const summary = summarizePhoneChat([
    { is_user: true, mes: 'private user prose' },
    { is_user: false, mes: 'PHONE_REGENERATEPHONE_CONTINUE private prose', swipes: ['PHONE_NORMAL', 'PHONE_SWIPE'], swipe_id: 1 },
  ]);
  assert.equal(summary.messageCount, 2);
  assert.equal(summary.lastRole, 'assistant');
  assert.equal(summary.sentinels.PHONE_NORMAL, 1);
  assert.equal(summary.sentinels.PHONE_SWIPE, 1);
  assert.equal(summary.selectedAssistantSentinels.PHONE_CONTINUE, 1);
  assert.equal(JSON.stringify(summary).includes('private prose'), false);
});

test('sanitizes proxy attempts and excludes IDs, locator, and hashes', () => {
  const sanitized = sanitizeProxyAttempt(attempt());
  const text = JSON.stringify(sanitized);
  assert.equal(text.includes('must-not-leak'), false);
  assert.deepEqual(sanitized.transitions, ['received', 'completed']);
});

test('selects the cancellation attempt for Stop rather than a newer completed normal attempt', () => {
  const selected = selectPhoneAttempt({ attempts: [
    attempt(),
    attempt({ outcome: 'cancelled', cancelled: true, responseCommitted: false }),
  ] }, 'stop');
  assert.equal(selected.outcome, 'cancelled');
});

test('normal, regenerate, continue, and swipe require proxy and chat evidence', () => {
  assert.equal(evaluatePhoneStep('normal', summarizePhoneChat([{ is_user: false, mes: 'PHONE_NORMAL' }]), sanitizeProxyAttempt(attempt())).pass, true);
  assert.equal(evaluatePhoneStep('regenerate', summarizePhoneChat([{ is_user: false, mes: 'PHONE_REGENERATE' }]), sanitizeProxyAttempt(attempt({ generation: 'regenerate' }))).pass, true);
  assert.equal(evaluatePhoneStep('continue', summarizePhoneChat([{ is_user: false, mes: 'base PHONE_CONTINUE' }]), sanitizeProxyAttempt(attempt({ generation: 'continue' }))).pass, true);
  assert.equal(evaluatePhoneStep('swipe', summarizePhoneChat([{ is_user: false, mes: 'PHONE_SWIPE', swipes: ['PHONE_NORMAL', 'PHONE_SWIPE'], swipe_id: 1 }]), sanitizeProxyAttempt(attempt({ generation: 'swipe' }))).pass, true);
});

test('Stop requires cancellation before success commit and no delayed sentinel', () => {
  const result = evaluatePhoneStep('stop', summarizePhoneChat([{ is_user: true, mes: 'stop me' }]), sanitizeProxyAttempt(attempt({ outcome: 'cancelled', cancelled: true, responseCommitted: false })));
  assert.equal(result.pass, true);
});

test('linked outage retains user turn and makes no upstream call', () => {
  const result = evaluatePhoneStep('outage-linked', summarizePhoneChat([{ is_user: true, mes: 'kept turn' }]), sanitizeProxyAttempt(attempt({ outcome: 'rejected', problemCode: 'RPG_CAMPAIGN_UNAVAILABLE', upstreamCalls: 0 })));
  assert.equal(result.pass, true);
});

test('explicit unlinked outage bypass saves the sentinel', () => {
  const result = evaluatePhoneStep('outage-unlinked', summarizePhoneChat([{ is_user: false, mes: 'PHONE_OUTAGE_NORMAL' }]), sanitizeProxyAttempt(attempt({ route: 'unlinked' })));
  assert.equal(result.pass, true);
});

test('entry records phone environment without chat prose', () => {
  const result = entry('normal', [{ is_user: true, mes: 'secret' }, { is_user: false, mes: 'PHONE_NORMAL also secret' }], attempt());
  assert.equal(result.pass, true);
  assert.equal(result.environment.viewportWidth, 360);
  assert.equal(result.environment.hostPrefixMatchesExpected, true);
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('report requires all seven passing steps and matching host prefixes', () => {
  const entries = [
    entry('normal', [{ is_user: false, mes: 'PHONE_NORMAL' }], attempt()),
    entry('regenerate', [{ is_user: false, mes: 'PHONE_REGENERATE' }], attempt({ generation: 'regenerate' })),
    entry('continue', [{ is_user: false, mes: 'PHONE_CONTINUE' }], attempt({ generation: 'continue' })),
    entry('swipe', [{ is_user: false, mes: 'PHONE_SWIPE', swipes: ['PHONE_NORMAL', 'PHONE_SWIPE'] }], attempt({ generation: 'swipe' })),
    entry('stop', [{ is_user: true, mes: 'kept' }], attempt({ outcome: 'cancelled', cancelled: true, responseCommitted: false })),
    entry('outage-linked', [{ is_user: true, mes: 'kept' }], attempt({ outcome: 'rejected', problemCode: 'RPG_CAMPAIGN_UNAVAILABLE', upstreamCalls: 0 })),
    entry('outage-unlinked', [{ is_user: false, mes: 'PHONE_OUTAGE_NORMAL' }], attempt({ route: 'unlinked' }), 'unlinked'),
  ];
  const report = createPhoneEvidenceReport(entries);
  assert.deepEqual(entries.map(item => item.step), PHONE_EVIDENCE_STEPS);
  assert.equal(report.complete, true);
  assert.equal(report.pass, true);
  assert.deepEqual(report.failedSteps, []);
});

test('report identifies missing, failed, and host-mismatch steps', () => {
  const bad = entry('normal', [{ is_user: false, mes: 'wrong' }], attempt());
  const changed = { ...bad, environment: { ...bad.environment, hostPrefixMatchesExpected: false } };
  const report = createPhoneEvidenceReport([changed]);
  assert.equal(report.complete, false);
  assert.deepEqual(report.failedSteps, ['normal']);
  assert.deepEqual(report.hostMismatchSteps, ['normal']);
  assert.deepEqual(report.hostUnverifiedSteps, []);
  assert.equal(report.missingSteps.length, 6);
});

test('report refuses an unverified desktop host prefix or non-phone viewport', () => {
  const good = entry('normal', [{ is_user: false, mes: 'PHONE_NORMAL' }], attempt());
  const unverified = { ...good, environment: { ...good.environment, expectedDesktopHostPrefix: '', hostPrefixMatchesExpected: null, viewportWidth: 740 } };
  const report = createPhoneEvidenceReport([unverified]);
  assert.deepEqual(report.hostUnverifiedSteps, ['normal']);
  assert.deepEqual(report.viewportOutOfRangeSteps, ['normal']);
  assert.equal(report.pass, false);
});
