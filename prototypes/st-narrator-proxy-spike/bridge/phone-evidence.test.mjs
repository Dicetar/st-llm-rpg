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

function entry(step, chat, proxyAttempt, route = 'linked', environmentPatch = {}) {
  return createPhoneEvidenceEntry({
    step,
    chat,
    proxyState: {
      control: { campaignAvailable: true, upstreamMode: 'fixture', linkedDelayMs: 0 },
      attempts: [proxyAttempt],
    },
    environment: {
      hostname: '10.8.1.2', connectionPath: 'vpn', viewportWidth: 360, viewportHeight: 740,
      devicePixelRatio: 3, userAgent: 'Android Browser', ...environmentPatch,
    },
    route,
    statusText: 'linked normal prepared',
    capturedAt: '2026-08-05T00:00:00.000Z',
  });
}

function passingEntries() {
  return [
    entry('normal', [{ is_user: false, mes: 'PHONE_NORMAL' }], attempt()),
    entry('regenerate', [{ is_user: false, mes: 'PHONE_REGENERATE' }], attempt({ generation: 'regenerate' })),
    entry('continue', [{ is_user: false, mes: 'PHONE_CONTINUE' }], attempt({ generation: 'continue' })),
    entry('swipe', [{ is_user: false, mes: 'PHONE_SWIPE', swipes: ['PHONE_NORMAL', 'PHONE_SWIPE'] }], attempt({ generation: 'swipe' })),
    entry('stop', [{ is_user: true, mes: 'kept' }], attempt({ outcome: 'cancelled', cancelled: true, responseCommitted: false })),
    entry('outage-linked', [{ is_user: true, mes: 'kept' }], attempt({ outcome: 'rejected', problemCode: 'RPG_CAMPAIGN_UNAVAILABLE', upstreamCalls: 0 })),
    entry('outage-unlinked', [{ is_user: false, mes: 'PHONE_OUTAGE_NORMAL' }], attempt({ route: 'unlinked' }), 'unlinked'),
  ];
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

test('selects exact cancellation and outage attempts instead of unrelated normal attempts', () => {
  const state = { attempts: [
    attempt(),
    attempt({ outcome: 'cancelled', cancelled: true, responseCommitted: false }),
    attempt({ outcome: 'rejected', problemCode: 'RPG_CAMPAIGN_UNAVAILABLE', upstreamCalls: 0 }),
  ] };
  assert.equal(selectPhoneAttempt(state, 'stop').outcome, 'cancelled');
  assert.equal(selectPhoneAttempt(state, 'outage-linked').problemCode, 'RPG_CAMPAIGN_UNAVAILABLE');
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

test('entry records phone environment without host codes or chat prose', () => {
  const result = entry('normal', [{ is_user: true, mes: 'secret' }, { is_user: false, mes: 'PHONE_NORMAL also secret' }], attempt());
  const text = JSON.stringify(result);
  assert.equal(result.pass, true);
  assert.equal(result.environment.viewportWidth, 360);
  assert.equal('hostPrefix' in result.environment, false);
  assert.equal(text.includes('secret'), false);
});

test('report passes from seven valid phone results without desktop verification', () => {
  const entries = passingEntries();
  const report = createPhoneEvidenceReport(entries);
  assert.deepEqual(entries.map(item => item.step), PHONE_EVIDENCE_STEPS);
  assert.equal(report.complete, true);
  assert.equal(report.pass, true);
  assert.deepEqual(report.failedSteps, []);
  assert.equal('hostMismatchSteps' in report, false);
});

test('report identifies missing and failed steps', () => {
  const bad = entry('normal', [{ is_user: false, mes: 'wrong' }], attempt());
  const report = createPhoneEvidenceReport([bad]);
  assert.equal(report.complete, false);
  assert.deepEqual(report.failedSteps, ['normal']);
  assert.equal(report.missingSteps.length, 6);
});

test('report still refuses desktop-sized or incomplete environments', () => {
  const entries = passingEntries();
  entries[0] = entry('normal', [{ is_user: false, mes: 'PHONE_NORMAL' }], attempt(), 'linked', {
    viewportWidth: 740,
    userAgent: '',
  });
  const report = createPhoneEvidenceReport(entries);
  assert.deepEqual(report.environmentIncompleteSteps, ['normal']);
  assert.deepEqual(report.viewportOutOfRangeSteps, ['normal']);
  assert.equal(report.pass, false);
});
