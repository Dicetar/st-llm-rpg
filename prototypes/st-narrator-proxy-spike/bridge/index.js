import { main_api } from '/script.js';
import { extension_settings } from '/scripts/extensions.js';
import { chat_completion_sources, oai_settings } from '/scripts/openai.js';

const META_KEY = 'stRpgProxySpikeBinding';
const SETTINGS_KEY = 'stRpgNarratorProxySpike';
const ROOT_ID = 'st-rpg-proxy-spike-settings';
const PROXY_BASE = 'http://127.0.0.1:8002/v1';
const BROWSER_PROXY_BASE = `http://${window.location.hostname}:8002`;
const PROXY_STATE = `${BROWSER_PROXY_BASE}/prototype/state`;
const PROXY_CONTROL = `${BROWSER_PROXY_BASE}/prototype/control`;
const HEADER = 'X-ST-RPG-Exchange';
const ST_REVISION = '380e31e8c58d196969b6a0da74f431ba999c7e0a';
let pendingExchange = null;
let localIdCounter = 0;

function context() {
  return globalThis.SillyTavern?.getContext?.() ?? null;
}

function nextLocalId(prefix) {
  localIdCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${localIdCounter.toString(36)}`;
}

function hostId() {
  const settings = extension_settings[SETTINGS_KEY] ??= {};
  if (typeof settings.hostId !== 'string' || !settings.hostId) {
    settings.hostId = nextLocalId('host');
    context()?.saveSettingsDebounced?.();
  }
  return settings.hostId;
}

function bindingMarker() {
  return context()?.chatMetadata?.[META_KEY] ?? null;
}

function locator() {
  const current = context();
  const chatId = String(current?.getCurrentChatId?.() ?? current?.chatId ?? '');
  if (!chatId) throw new Error('Open a saved SillyTavern chat before generating.');
  const groupId = String(current?.groupId ?? '');
  if (groupId) {
    return { version: 1, hostId: hostId(), chat: { kind: 'group', ownerId: groupId, chatId } };
  }
  const character = current?.characters?.[current?.characterId];
  const ownerId = String(character?.avatar ?? '');
  if (!ownerId) throw new Error('Could not read the current character avatar locator.');
  return { version: 1, hostId: hostId(), chat: { kind: 'character', ownerId, chatId } };
}

function route() {
  const marker = bindingMarker();
  if (marker === undefined || marker === null) return { kind: 'unlinked' };
  if (marker?.version !== 1 || typeof marker?.bindingId !== 'string') {
    throw new Error('This chat has malformed RPG proxy Binding metadata.');
  }
  return { kind: 'linked', bindingId: marker.bindingId };
}

function assertConnection() {
  if (main_api !== 'openai' || oai_settings.chat_completion_source !== chat_completion_sources.CUSTOM) {
    throw new Error('Select Custom Chat Completions before using the RPG proxy spike.');
  }
  const actual = String(oai_settings.custom_url ?? '').replace(/\/$/, '');
  if (actual !== PROXY_BASE) {
    throw new Error(`Set the Custom endpoint to ${PROXY_BASE}; current value is ${actual || 'empty'}.`);
  }
}

function encodeEnvelope(envelope) {
  const bytes = new TextEncoder().encode(JSON.stringify(envelope));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `v1.${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}`;
}

function mergeHeaderYaml(existing, value) {
  const kept = String(existing ?? '')
    .split(/\r?\n/)
    .filter(line => !new RegExp(`^\\s*${HEADER}\\s*:`, 'i').test(line));
  kept.push(`${HEADER}: ${value}`);
  return kept.filter((line, index, all) => line.trim() || (index > 0 && index < all.length - 1)).join('\n');
}

function setStatus(text, kind = '') {
  const output = document.querySelector('#st-rpg-proxy-spike-status');
  if (!output) return;
  output.textContent = text;
  output.dataset.kind = kind;
}

async function refreshStatus() {
  const marker = bindingMarker();
  const routeText = marker ? `linked ${marker.bindingId.slice(0, 18)}...` : 'explicitly unlinked';
  const hostText = `host ${hostId().slice(0, 8)}`;
  try {
    const response = await fetch(PROXY_STATE, { signal: AbortSignal.timeout(1500) });
    const proxy = await response.json();
    setStatus(`${routeText} | ${hostText} | proxy ${proxy.control.upstreamMode} | Campaign ${proxy.control.campaignAvailable ? 'available' : 'outage'}`, 'ok');
  } catch {
    setStatus(`${routeText} | ${hostText} | proxy unavailable`, 'error');
  }
}

async function setProxyControl(patch) {
  const response = await fetch(PROXY_CONTROL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error(`Proxy control failed with HTTP ${response.status}.`);
  await refreshStatus();
}

async function linkCurrentChat() {
  const current = context();
  locator();
  current.chatMetadata[META_KEY] = {
    version: 1,
    bindingId: bindingMarker()?.bindingId ?? nextLocalId('binding'),
  };
  await current.saveMetadata();
  await refreshStatus();
}

async function unlinkCurrentChat() {
  const current = context();
  if (current?.chatMetadata) delete current.chatMetadata[META_KEY];
  await current?.saveMetadata?.();
  await refreshStatus();
}

async function generationInterceptor(_chat, _contextSize, abort, type) {
  try {
    assertConnection();
    const requestRoute = route();
    const generation = type ?? 'normal';
    if (requestRoute.kind === 'linked' && !['normal', 'regenerate', 'continue', 'swipe'].includes(generation)) {
      throw new Error(`Linked generation type ${generation} is unsupported by the proxy spike.`);
    }
    pendingExchange = {
      protocol: 'st-rpg.narration',
      version: 1,
      requestId: nextLocalId('request'),
      route: requestRoute,
      generation,
      locator: locator(),
      bridge: { version: '0.1.4', sillyTavernRevision: ST_REVISION },
    };
    setStatus(`${requestRoute.kind} ${generation} · request ${pendingExchange.requestId.slice(0, 8)} prepared`, 'ok');
  } catch (error) {
    pendingExchange = null;
    setStatus(String(error?.message ?? error), 'error');
    globalThis.toastr?.error?.(String(error?.message ?? error), 'RPG proxy blocked generation');
    abort(true);
  }
}

async function applyExchangeHeader(generateData) {
  if (!pendingExchange) return;
  const current = pendingExchange;
  pendingExchange = null;
  if (generateData?.chat_completion_source !== chat_completion_sources.CUSTOM) {
    throw new Error('RPG proxy request changed away from Custom after interception.');
  }
  const actual = String(generateData?.custom_url ?? '').replace(/\/$/, '');
  if (actual !== PROXY_BASE) throw new Error('RPG proxy Custom URL changed after interception.');
  generateData.custom_include_headers = mergeHeaderYaml(
    generateData.custom_include_headers,
    encodeEnvelope(current),
  );
}

function mountControls() {
  if (document.querySelector(`#${ROOT_ID}`)) return;
  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.className = 'inline-drawer wide100p';
  root.innerHTML = `
    <div class="inline-drawer-toggle inline-drawer-header">
      <b>RPG Narrator Proxy Spike</b>
      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content">
      <p class="notes">Throwaway compatibility bridge. Custom endpoint must be <code>${PROXY_BASE}</code>.</p>
      <div class="st-rpg-proxy-spike__actions">
        <button type="button" class="menu_button" data-proxy-action="link">Link this chat</button>
        <button type="button" class="menu_button" data-proxy-action="unlink">Make this chat unlinked</button>
        <button type="button" class="menu_button" data-proxy-action="refresh">Refresh status</button>
      </div>
      <p class="notes">Physical-phone evidence controls:</p>
      <div class="st-rpg-proxy-spike__actions">
        <button type="button" class="menu_button" data-proxy-control="fixture">Fixture</button>
        <button type="button" class="menu_button" data-proxy-control="stop-delay">10 s Stop delay</button>
        <button type="button" class="menu_button" data-proxy-control="outage">Campaign outage</button>
        <button type="button" class="menu_button" data-proxy-control="live">Live LM Studio</button>
      </div>
      <p id="st-rpg-proxy-spike-status" role="status">Checking...</p>
    </div>`;
  const target = document.querySelector('#extensions_settings2') ?? document.querySelector('#extensions_settings');
  target?.append(root);
  root.addEventListener('click', event => {
    const action = event.target.closest('[data-proxy-action]')?.dataset.proxyAction;
    if (action === 'link') linkCurrentChat().catch(error => setStatus(String(error.message ?? error), 'error'));
    if (action === 'unlink') unlinkCurrentChat().catch(error => setStatus(String(error.message ?? error), 'error'));
    if (action === 'refresh') refreshStatus();
    const control = event.target.closest('[data-proxy-control]')?.dataset.proxyControl;
    if (control === 'fixture') {
      setProxyControl({ campaignAvailable: true, upstreamMode: 'fixture', linkedDelayMs: 0, fixtureText: 'PHONE_{generation}' })
        .catch(error => setStatus(String(error.message ?? error), 'error'));
    }
    if (control === 'stop-delay') {
      setProxyControl({ campaignAvailable: true, upstreamMode: 'fixture', linkedDelayMs: 10000, fixtureText: 'PHONE_DELAYED_{generation}' })
        .catch(error => setStatus(String(error.message ?? error), 'error'));
    }
    if (control === 'outage') {
      setProxyControl({ campaignAvailable: false, upstreamMode: 'fixture', linkedDelayMs: 0, fixtureText: 'PHONE_OUTAGE_{generation}' })
        .catch(error => setStatus(String(error.message ?? error), 'error'));
    }
    if (control === 'live') {
      setProxyControl({ campaignAvailable: true, upstreamMode: 'live', linkedDelayMs: 0 })
        .catch(error => setStatus(String(error.message ?? error), 'error'));
    }
  });
  refreshStatus();
}

function mount() {
  globalThis.stRpgProxySpikeGenerationInterceptor = generationInterceptor;
  globalThis.stRpgProxySpike = { linkCurrentChat, unlinkCurrentChat, refreshStatus, setProxyControl, locator, route };
  const current = context();
  const events = current?.eventTypes ?? current?.event_types;
  current?.eventSource?.on?.(events?.CHAT_COMPLETION_SETTINGS_READY, applyExchangeHeader);
  current?.eventSource?.on?.(events?.CHAT_CHANGED, refreshStatus);
  mountControls();
}

globalThis.stRpgProxySpikeGenerationInterceptor = generationInterceptor;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
else mount();
