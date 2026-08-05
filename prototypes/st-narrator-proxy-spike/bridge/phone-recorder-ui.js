import { extension_settings } from '/scripts/extensions.js';
import {
  PHONE_EVIDENCE_STEPS,
  createPhoneEvidenceEntry,
  createPhoneEvidenceReport,
} from './phone-evidence.js?v=0.2.0';

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
  'outage-unlinked': 'Send once after making the chat unlinked',
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
  const evidence = settings.phoneEvidence ??= { connectionPath: 'vpn', entries: [] };
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
  return report().missingSteps[0] ?? null;
}

function renderSummary() {
  const output = root()?.querySelector('[data-phone-evidence-summary]');
  if (!output) return;
  const current = report();
  const passed = current.entries.filter(entry => entry.pass).length;
  const upcoming = current.missingSteps[0];
  output.replaceChildren();

  const headline = document.createElement('p');
  headline.textContent = `${current.entries.length}/7 captured · ${passed} passing · ${current.pass ? 'PASS' : 'in progress'}`;
  headline.dataset.kind = current.pass ? 'ok' : '';
  output.append(headline);

  const instruction = document.createElement('p');
  instruction.className = 'notes';
  instruction.textContent = upcoming
    ? `Next: ${STEP_LABELS[upcoming]}. Then return here and tap Capture result.`
    : 'All seven results are captured. Copy the PASS JSON.';
  output.append(instruction);

  if (current.failedSteps.length || current.viewportOutOfRangeSteps.length || current.environmentIncompleteSteps.length) {
    const detail = document.createElement('p');
    detail.dataset.kind = 'error';
    detail.textContent = [
      current.failedSteps.length ? `Failed: ${current.failedSteps.join(', ')}` : '',
      current.viewportOutOfRangeSteps.length ? 'This is not a phone-sized viewport (required: 300–430 CSS px).' : '',
      current.environmentIncompleteSteps.length ? 'Phone environment details are incomplete.' : '',
    ].filter(Boolean).join(' ');
    output.append(detail);
  }
}

async function fetchProxyState() {
  const response = await fetch(PROXY_STATE, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error(`Proxy state failed with HTTP ${response.status}.`);
  return response.json();
}

async function prepareNext() {
  const step = nextStep();
  if (!step) {
    setStatus('All tests are already captured.', 'ok');
    return;
  }

  const currentBridge = bridge();
  if (step === 'normal') {
    evidenceSettings().entries = [];
    await currentBridge.setProxyControl({
      reset: true,
      campaignAvailable: true,
      upstreamMode: 'fixture',
      linkedDelayMs: 0,
      fixtureText: 'PHONE_{generation}',
    });
    await currentBridge.linkCurrentChat();
  } else if (step === 'stop') {
    await currentBridge.setProxyControl({
      campaignAvailable: true,
      upstreamMode: 'fixture',
      linkedDelayMs: 10000,
      fixtureText: 'PHONE_DELAYED_{generation}',
    });
  } else if (step === 'outage-linked') {
    await currentBridge.linkCurrentChat();
    await currentBridge.setProxyControl({
      campaignAvailable: false,
      upstreamMode: 'fixture',
      linkedDelayMs: 0,
      fixtureText: 'PHONE_OUTAGE_{generation}',
    });
  } else if (step === 'outage-unlinked') {
    await currentBridge.unlinkCurrentChat();
  }

  saveSettings();
  renderSummary();
  setStatus(`Ready: ${STEP_LABELS[step]}.`, 'ok');
}

async function captureResult() {
  const step = nextStep();
  if (!step) {
    setStatus('Nothing left to capture.', 'ok');
    return;
  }

  const currentBridge = bridge();
  const currentContext = context();
  const state = await fetchProxyState();
  const size = viewport();
  const settings = evidenceSettings();
  const entry = createPhoneEvidenceEntry({
    step,
    chat: currentContext?.chat,
    proxyState: state,
    environment: {
      hostname: window.location.hostname,
      connectionPath: settings.connectionPath,
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
  saveSettings();
  renderSummary();
  setStatus(`${step}: ${entry.pass ? 'pass' : 'failed checks'}.`, entry.pass ? 'ok' : 'error');
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
  evidenceSettings().entries = [];
  saveSettings();
  renderSummary();
  setStatus('Phone test reset.');
}

function mountRecorder() {
  if (root()) return;
  const settings = evidenceSettings();
  const recorder = document.createElement('div');
  recorder.id = ROOT_ID;
  recorder.className = 'inline-drawer wide100p';
  recorder.innerHTML = `
    <div class="inline-drawer-toggle inline-drawer-header">
      <b>Phone proxy test</b>
      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content">
      <p class="notes">Use a disposable chat. Tap Prepare next test, perform the one action shown, then tap Capture result. No desktop code, UUID, cryptography, or manual step selection.</p>
      <label>Connection
        <select data-phone-evidence-path>
          <option value="vpn">VPN</option>
          <option value="lan">LAN</option>
          <option value="other">Other trusted path</option>
        </select>
      </label>
      <div class="st-rpg-proxy-spike__actions">
        <button type="button" class="menu_button" data-phone-evidence-action="prepare">Prepare next test</button>
        <button type="button" class="menu_button" data-phone-evidence-action="capture">Capture result</button>
        <button type="button" class="menu_button" data-phone-evidence-action="copy">Copy PASS JSON</button>
        <button type="button" class="menu_button" data-phone-evidence-action="reset">Reset</button>
      </div>
      <div data-phone-evidence-summary></div>
      <p data-phone-evidence-status role="status"></p>
    </div>`;

  const target = document.querySelector('#extensions_settings2') ?? document.querySelector('#extensions_settings');
  target?.append(recorder);
  recorder.querySelector('[data-phone-evidence-path]').value = settings.connectionPath ?? 'vpn';

  recorder.addEventListener('change', event => {
    if (event.target.matches('[data-phone-evidence-path]')) {
      settings.connectionPath = event.target.value;
      saveSettings();
      renderSummary();
    }
  });

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
