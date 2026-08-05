import { extension_settings } from '/scripts/extensions.js';
import {
  PHONE_EVIDENCE_VERSION,
  createPhoneEvidenceEntry,
  createPhoneEvidenceReport,
  nextPhoneEvidenceStep,
} from './phone-evidence.js?v=0.3.0';

const SETTINGS_KEY = 'stRpgNarratorProxySpike';
const ROOT_ID = 'st-rpg-proxy-phone-evidence';
const PROXY_STATE = `http://${window.location.hostname}:8002/prototype/state`;
const STEP_LABELS = Object.freeze({
  normal: 'Send one normal message',
  regenerate: 'Use Regenerate',
  continue: 'Use Continue',
  swipe: 'Generate a swipe',
  stop: 'Send and press Stop before 10 seconds',
  'outage-linked': 'Send once while linked and Campaign is offline',
  'outage-unlinked': 'Send once while the chat is unlinked',
});

function context() {
  return globalThis.SillyTavern?.getContext?.() ?? null;
}

function bridge() {
  const value = globalThis.stRpgProxySpike;
  if (!value?.locator || !value?.route || !value?.setProxyControl) {
    throw new Error('Close and reopen SillyTavern so the current proxy bridge loads.');
  }
  return value;
}

function evidenceSettings() {
  const settings = extension_settings[SETTINGS_KEY] ??= {};
  const current = settings.phoneEvidence;
  if (!current || current.version !== PHONE_EVIDENCE_VERSION) {
    settings.phoneEvidence = {
      version: PHONE_EVIDENCE_VERSION,
      entries: [],
      preparedStep: null,
    };
  }
  const evidence = settings.phoneEvidence;
  if (!Array.isArray(evidence.entries)) evidence.entries = [];
  return evidence;
}

function saveSettings() {
  context()?.saveSettingsDebounced?.();
}

function root() {
  return document.querySelector(`#${ROOT_ID}`);
}

function setStatus(text, kind = '') {
  const output = root()?.querySelector('[data-phone-evidence-status]');
  if (!output) return;
  output.textContent = text;
  output.dataset.kind = kind;
}

function viewport() {
  const visual = window.visualViewport;
  return {
    width: Math.round(visual?.width ?? window.innerWidth ?? 0),
    height: Math.round(visual?.height ?? window.innerHeight ?? 0),
  };
}

function report() {
  return createPhoneEvidenceReport(evidenceSettings().entries);
}

function nextStep() {
  return nextPhoneEvidenceStep(report());
}

function setButtonStates(current, upcoming) {
  const recorder = root();
  if (!recorder) return;
  const prepared = evidenceSettings().preparedStep;
  recorder.querySelector('[data-phone-evidence-action="prepare"]').disabled = current.pass;
  recorder.querySelector('[data-phone-evidence-action="capture"]').disabled = !upcoming || prepared !== upcoming;
  recorder.querySelector('[data-phone-evidence-action="copy"]').disabled = !current.pass;
}

function renderSummary() {
  const output = root()?.querySelector('[data-phone-evidence-summary]');
  if (!output) return;
  const current = report();
  const passed = current.entries.filter(entry => entry.pass).length;
  const upcoming = nextPhoneEvidenceStep(current);
  const recordedUpcoming = current.entries.find(entry => entry.step === upcoming);
  output.replaceChildren();

  const headline = document.createElement('p');
  headline.textContent = current.pass ? '7/7 passed · PASS' : `${passed}/7 passed`;
  headline.dataset.kind = current.pass ? 'ok' : '';
  output.append(headline);

  const instruction = document.createElement('p');
  instruction.className = 'notes';
  if (current.pass) {
    instruction.textContent = 'Finished. Tap Copy PASS JSON.';
  } else if (upcoming) {
    const prefix = recordedUpcoming ? 'Retry' : 'Next';
    instruction.textContent = `${prefix}: ${STEP_LABELS[upcoming]}. Tap Prepare, perform that action, then tap Capture.`;
  } else {
    instruction.textContent = 'The recorder has no next step but is not complete. Tap Reset.';
  }
  output.append(instruction);

  if (current.viewportOutOfRangeSteps.length) {
    const detail = document.createElement('p');
    detail.dataset.kind = 'error';
    detail.textContent = 'The browser viewport must be 300–430 CSS pixels wide.';
    output.append(detail);
  } else if (current.environmentIncompleteSteps.length) {
    const detail = document.createElement('p');
    detail.dataset.kind = 'error';
    detail.textContent = 'Phone browser details could not be read. Retry this step.';
    output.append(detail);
  } else if (recordedUpcoming && recordedUpcoming.pass !== true) {
    const detail = document.createElement('p');
    detail.dataset.kind = 'error';
    detail.textContent = 'That result failed. Prepare and retry the same step; the test will not advance.';
    output.append(detail);
  }

  setButtonStates(current, upcoming);
}

async function fetchProxyState() {
  const response = await fetch(PROXY_STATE, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error(`Proxy state failed with HTTP ${response.status}.`);
  return response.json();
}

function controlFor(step) {
  if (step === 'stop') {
    return {
      reset: true,
      campaignAvailable: true,
      upstreamMode: 'fixture',
      linkedDelayMs: 10000,
      fixtureText: 'PHONE_DELAYED_{generation}',
    };
  }
  if (step === 'outage-linked' || step === 'outage-unlinked') {
    return {
      reset: true,
      campaignAvailable: false,
      upstreamMode: 'fixture',
      linkedDelayMs: 0,
      fixtureText: 'PHONE_OUTAGE_{generation}',
    };
  }
  return {
    reset: true,
    campaignAvailable: true,
    upstreamMode: 'fixture',
    linkedDelayMs: 0,
    fixtureText: 'PHONE_{generation}',
  };
}

async function prepareNext() {
  const step = nextStep();
  if (!step) {
    setStatus(report().pass ? 'All tests passed.' : 'No next step. Tap Reset.', report().pass ? 'ok' : 'error');
    return;
  }

  const settings = evidenceSettings();
  settings.entries = settings.entries.filter(candidate => candidate?.step !== step);
  settings.preparedStep = step;

  const currentBridge = bridge();
  await currentBridge.setProxyControl(controlFor(step));
  if (step === 'outage-unlinked') await currentBridge.unlinkCurrentChat();
  else await currentBridge.linkCurrentChat();

  saveSettings();
  renderSummary();
  setStatus(`Ready: ${STEP_LABELS[step]}.`, 'ok');
}

async function captureResult() {
  const step = nextStep();
  if (!step) {
    setStatus(report().pass ? 'All tests passed.' : 'No next step. Tap Reset.', report().pass ? 'ok' : 'error');
    return;
  }

  const settings = evidenceSettings();
  if (settings.preparedStep !== step) {
    throw new Error(`Tap Prepare before capturing: ${STEP_LABELS[step]}.`);
  }

  const currentBridge = bridge();
  const currentContext = context();
  const state = await fetchProxyState();
  const size = viewport();
  const entry = createPhoneEvidenceEntry({
    step,
    chat: currentContext?.chat,
    proxyState: state,
    environment: {
      hostname: window.location.hostname,
      connectionPath: 'trusted-network',
      viewportWidth: size.width,
      viewportHeight: size.height,
      devicePixelRatio: window.devicePixelRatio ?? 1,
      userAgent: navigator.userAgent,
    },
    route: currentBridge.route().kind,
    statusText: document.querySelector('#st-rpg-proxy-spike-status')?.textContent ?? '',
  });

  settings.entries = settings.entries.filter(candidate => candidate?.step !== step);
  settings.entries.push(entry);
  settings.preparedStep = null;
  saveSettings();
  renderSummary();
  setStatus(
    entry.pass ? `${step}: pass.` : `${step}: failed. Tap Prepare to retry this same step.`,
    entry.pass ? 'ok' : 'error',
  );
}

async function copyReport() {
  const current = report();
  if (!current.pass) throw new Error('The report is not PASS yet.');
  const text = JSON.stringify(current, null, 2);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.append(textarea);
    textarea.select();
    if (!document.execCommand('copy')) throw new Error('Clipboard is unavailable.');
    textarea.remove();
  }
  setStatus('PASS JSON copied.', 'ok');
}

function resetReport() {
  const settings = evidenceSettings();
  settings.entries = [];
  settings.preparedStep = null;
  saveSettings();
  renderSummary();
  setStatus('Phone test reset.');
}

function mountRecorder() {
  if (root()) return;
  evidenceSettings();
  saveSettings();

  const recorder = document.createElement('div');
  recorder.id = ROOT_ID;
  recorder.className = 'inline-drawer wide100p';
  recorder.innerHTML = `
    <div class="inline-drawer-toggle inline-drawer-header">
      <b>Phone proxy test</b>
      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content">
      <p class="notes">Use a disposable chat. Prepare one test, perform the shown action, then capture it. Failed tests stay selected until they pass.</p>
      <div class="st-rpg-proxy-spike__actions">
        <button type="button" class="menu_button" data-phone-evidence-action="prepare">Prepare</button>
        <button type="button" class="menu_button" data-phone-evidence-action="capture">Capture</button>
        <button type="button" class="menu_button" data-phone-evidence-action="copy">Copy PASS JSON</button>
        <button type="button" class="menu_button" data-phone-evidence-action="reset">Reset</button>
      </div>
      <div data-phone-evidence-summary></div>
      <p data-phone-evidence-status role="status"></p>
    </div>`;

  const target = document.querySelector('#extensions_settings2') ?? document.querySelector('#extensions_settings');
  target?.append(recorder);

  recorder.addEventListener('click', event => {
    const action = event.target.closest('[data-phone-evidence-action]')?.dataset.phoneEvidenceAction;
    if (action === 'prepare') prepareNext().catch(error => setStatus(String(error?.message ?? error), 'error'));
    if (action === 'capture') captureResult().catch(error => setStatus(String(error?.message ?? error), 'error'));
    if (action === 'copy') copyReport().catch(error => setStatus(String(error?.message ?? error), 'error'));
    if (action === 'reset') resetReport();
  });

  renderSummary();
}

function mountWhenReady(attempt = 0) {
  if (document.querySelector('#extensions_settings2') || document.querySelector('#extensions_settings')) {
    mountRecorder();
    return;
  }
  if (attempt < 20) setTimeout(() => mountWhenReady(attempt + 1), 250);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => mountWhenReady(), { once: true });
else mountWhenReady();
