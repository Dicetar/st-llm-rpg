import { extension_settings } from '/scripts/extensions.js';
import {
  PHONE_EVIDENCE_STEPS,
  createPhoneEvidenceEntry,
  createPhoneEvidenceReport,
} from './phone-evidence.js?v=0.1.0';

const SETTINGS_KEY = 'stRpgNarratorProxySpike';
const ROOT_ID = 'st-rpg-proxy-phone-evidence';
const PROXY_STATE = `http://${window.location.hostname}:8002/prototype/state`;
const STEP_LABELS = Object.freeze({
  normal: 'Linked normal',
  regenerate: 'Linked regenerate',
  continue: 'Linked continue',
  swipe: 'Linked swipe',
  stop: 'Linked Stop during 10 s delay',
  'outage-linked': 'Linked Campaign outage',
  'outage-unlinked': 'Explicit unlinked during outage',
});

function context() {
  return globalThis.SillyTavern?.getContext?.() ?? null;
}

function bridge() {
  const value = globalThis.stRpgProxySpike;
  if (!value?.locator || !value?.route) throw new Error('Reload SillyTavern so the proxy bridge loads before recording evidence.');
  return value;
}

function evidenceSettings() {
  const settings = extension_settings[SETTINGS_KEY] ??= {};
  const evidence = settings.phoneEvidence ??= {
    connectionPath: 'vpn',
    expectedDesktopHostPrefix: '',
    entries: [],
  };
  if (!Array.isArray(evidence.entries)) evidence.entries = [];
  return evidence;
}

function saveSettings() {
  context()?.saveSettingsDebounced?.();
}

function root() {
  return document.querySelector(`#${ROOT_ID}`);
}

function setRecorderStatus(text, kind = '') {
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

function renderSummary() {
  const output = root()?.querySelector('[data-phone-evidence-summary]');
  if (!output) return;
  const current = report();
  const byStep = new Map(current.entries.map(entry => [entry.step, entry]));
  output.replaceChildren();

  const headline = document.createElement('p');
  const passed = current.entries.filter(entry => entry.pass).length;
  headline.textContent = `${current.entries.length}/7 captured · ${passed} passing · final verdict ${current.pass ? 'PASS' : 'not ready'}`;
  headline.dataset.kind = current.pass ? 'ok' : '';
  output.append(headline);

  const list = document.createElement('ol');
  list.className = 'st-rpg-proxy-phone-evidence__steps';
  for (const step of PHONE_EVIDENCE_STEPS) {
    const item = document.createElement('li');
    const entry = byStep.get(step);
    item.textContent = `${STEP_LABELS[step]} — ${entry ? (entry.pass ? 'pass' : 'failed checks') : 'not recorded'}`;
    item.dataset.kind = entry?.pass ? 'ok' : entry ? 'error' : '';
    list.append(item);
  }
  output.append(list);

  const problems = [
    current.missingSteps.length ? `missing: ${current.missingSteps.join(', ')}` : '',
    current.failedSteps.length ? `failed: ${current.failedSteps.join(', ')}` : '',
    current.hostMismatchSteps.length ? `host mismatch: ${current.hostMismatchSteps.join(', ')}` : '',
    current.hostUnverifiedSteps.length ? `desktop host prefix missing: ${current.hostUnverifiedSteps.join(', ')}` : '',
    current.environmentIncompleteSteps.length ? `environment incomplete: ${current.environmentIncompleteSteps.join(', ')}` : '',
    current.viewportOutOfRangeSteps.length ? `viewport outside 300–430 CSS px: ${current.viewportOutOfRangeSteps.join(', ')}` : '',
  ].filter(Boolean);
  if (problems.length) {
    const detail = document.createElement('p');
    detail.className = 'notes';
    detail.textContent = problems.join(' · ');
    output.append(detail);
  }
}

async function fetchProxyState() {
  const response = await fetch(PROXY_STATE, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error(`Proxy state failed with HTTP ${response.status}.`);
  return response.json();
}

async function recordCurrentStep() {
  const recorder = root();
  const selectedStep = recorder?.querySelector('[data-phone-evidence-step]')?.value;
  if (!PHONE_EVIDENCE_STEPS.includes(selectedStep)) throw new Error('Choose a phone evidence step.');

  const currentBridge = bridge();
  const currentContext = context();
  const currentLocator = currentBridge.locator();
  const currentRoute = currentBridge.route();
  const state = await fetchProxyState();
  const size = viewport();
  const settings = evidenceSettings();
  const entry = createPhoneEvidenceEntry({
    step: selectedStep,
    chat: currentContext?.chat,
    proxyState: state,
    environment: {
      hostname: window.location.hostname,
      connectionPath: settings.connectionPath,
      viewportWidth: size.width,
      viewportHeight: size.height,
      devicePixelRatio: window.devicePixelRatio ?? 1,
      userAgent: navigator.userAgent,
      hostPrefix: String(currentLocator.hostId ?? '').slice(0, 8),
      expectedDesktopHostPrefix: settings.expectedDesktopHostPrefix,
    },
    route: currentRoute.kind,
    statusText: document.querySelector('#st-rpg-proxy-spike-status')?.textContent ?? '',
    notes: recorder?.querySelector('[data-phone-evidence-notes]')?.value ?? '',
  });

  settings.entries = settings.entries.filter(candidate => candidate?.step !== selectedStep);
  settings.entries.push(entry);
  saveSettings();
  renderSummary();
  setRecorderStatus(`${STEP_LABELS[selectedStep]} recorded: ${entry.pass ? 'pass' : 'failed checks'}.`, entry.pass ? 'ok' : 'error');
}

async function copyReport() {
  const text = JSON.stringify(report(), null, 2);
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
  setRecorderStatus('Redacted phone evidence JSON copied.', 'ok');
}

function resetReport() {
  evidenceSettings().entries = [];
  saveSettings();
  renderSummary();
  setRecorderStatus('Recorded phone evidence cleared.');
}

function mountRecorder() {
  if (root()) return;
  const settings = evidenceSettings();
  const recorder = document.createElement('div');
  recorder.id = ROOT_ID;
  recorder.className = 'inline-drawer wide100p';
  recorder.innerHTML = `
    <div class="inline-drawer-toggle inline-drawer-header">
      <b>Proxy physical-phone evidence</b>
      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content">
      <p class="notes">Run each proxy action in a disposable chat, then record the matching step. The report stores fixed sentinel counts and transport metadata only—never chat prose, prompts, Campaign data, IDs, or generated text.</p>
      <div class="st-rpg-proxy-phone-evidence__fields">
        <label>Connection path
          <select data-phone-evidence-path>
            <option value="vpn">VPN</option>
            <option value="lan">LAN</option>
            <option value="other">Other trusted path</option>
          </select>
        </label>
        <label>Desktop host prefix
          <input data-phone-evidence-host maxlength="8" inputmode="text" autocomplete="off" placeholder="8 characters">
        </label>
        <label>Step to record
          <select data-phone-evidence-step>
            ${PHONE_EVIDENCE_STEPS.map(step => `<option value="${step}">${STEP_LABELS[step]}</option>`).join('')}
          </select>
        </label>
        <label>Observed wording or issue
          <textarea data-phone-evidence-notes rows="2" maxlength="1000" placeholder="Optional error/toast wording; do not paste campaign prose."></textarea>
        </label>
      </div>
      <div class="st-rpg-proxy-spike__actions">
        <button type="button" class="menu_button" data-phone-evidence-action="record">Record current step</button>
        <button type="button" class="menu_button" data-phone-evidence-action="copy">Copy evidence JSON</button>
        <button type="button" class="menu_button" data-phone-evidence-action="reset">Reset evidence</button>
      </div>
      <div data-phone-evidence-summary></div>
      <p data-phone-evidence-status role="status"></p>
    </div>`;

  const target = document.querySelector('#extensions_settings2') ?? document.querySelector('#extensions_settings');
  target?.append(recorder);
  recorder.querySelector('[data-phone-evidence-path]').value = settings.connectionPath ?? 'vpn';
  recorder.querySelector('[data-phone-evidence-host]').value = settings.expectedDesktopHostPrefix ?? '';

  recorder.addEventListener('change', event => {
    if (event.target.matches('[data-phone-evidence-path]')) settings.connectionPath = event.target.value;
    if (event.target.matches('[data-phone-evidence-host]')) settings.expectedDesktopHostPrefix = event.target.value.trim().slice(0, 8);
    saveSettings();
    renderSummary();
  });

  recorder.addEventListener('click', event => {
    const action = event.target.closest('[data-phone-evidence-action]')?.dataset.phoneEvidenceAction;
    if (action === 'record') recordCurrentStep().catch(error => setRecorderStatus(String(error?.message ?? error), 'error'));
    if (action === 'copy') copyReport().catch(error => setRecorderStatus(String(error?.message ?? error), 'error'));
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
