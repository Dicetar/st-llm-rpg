import { main_api } from '/script.js';
import { extension_settings } from '/scripts/extensions.js';
import { chat_completion_sources, oai_settings } from '/scripts/openai.js';
import { bindingRoute, encodeNarrationExchange, mergeExchangeHeader } from './wire.js?v=0.2.1';

const LAUNCHER_ID = 'st-rpg-companion-launcher';
const SETTINGS_KEY = 'stRpgCompanionBridge';
const BINDING_META_KEY = 'stLlmRpgBinding';
const COMPANION_PORT = 8002;
const BRIDGE_VERSION = '0.2.1';
const SILLYTAVERN_REVISION = '380e31e8c58d196969b6a0da74f431ba999c7e0a';
const GENERATION_TYPES = new Set(['normal', 'regenerate', 'continue', 'swipe', 'quiet', 'impersonate']);
const LINKED_GENERATION_TYPES = new Set(['normal', 'regenerate', 'continue', 'swipe']);
let pendingExchange = null;
let eventsMounted = false;
let settingsHookReady = false;

function context() {
  return globalThis.SillyTavern?.getContext?.() ?? null;
}

function companionUrl(path = '/') {
  const hostname = window.location.hostname || '127.0.0.1';
  return `http://${hostname}:${COMPANION_PORT}${path}`;
}

function createUuid() {
  const webCrypto = globalThis.crypto;
  if (typeof webCrypto?.randomUUID === 'function') return webCrypto.randomUUID();
  if (typeof webCrypto?.getRandomValues !== 'function') {
    throw new Error('This browser cannot create secure RPG Companion request IDs. Update the browser or open SillyTavern through a secure origin.');
  }
  const bytes = new Uint8Array(16);
  webCrypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function hostId() {
  const settings = extension_settings[SETTINGS_KEY] ??= {};
  if (typeof settings.hostId !== 'string' || !settings.hostId) {
    settings.hostId = createUuid();
    context()?.saveSettingsDebounced?.();
  }
  return settings.hostId;
}

function currentLocator() {
  const current = context();
  const chatId = String(current?.getCurrentChatId?.() ?? current?.chatId ?? '');
  if (!chatId) throw new Error('Open a saved SillyTavern chat before generating.');
  const groupId = String(current?.groupId ?? '');
  if (groupId) {
    return { version: 1, hostId: hostId(), chat: { kind: 'group', ownerId: groupId, chatId } };
  }
  const character = current?.characters?.[current?.characterId];
  const ownerId = String(character?.avatar ?? '');
  if (!ownerId) throw new Error('RPG Companion could not read the current character locator.');
  return { version: 1, hostId: hostId(), chat: { kind: 'character', ownerId, chatId } };
}

function currentRoute() {
  return bindingRoute(context()?.chatMetadata?.[BINDING_META_KEY]);
}

function assertCustomConnection() {
  if (main_api !== 'openai' || oai_settings.chat_completion_source !== chat_completion_sources.CUSTOM) {
    throw new Error('Select Custom Chat Completions before generating through RPG Companion.');
  }
}

function reportBlocked(error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[RPG Companion Bridge] Generation blocked:', error);
  globalThis.toastr?.error?.(message, 'RPG Companion blocked generation');
}

async function generationInterceptor(_chat, _contextSize, abort, type) {
  try {
    if (!settingsHookReady) throw new Error('RPG Companion routing hook is not ready. Reload SillyTavern before generating.');
    assertCustomConnection();
    const route = currentRoute();
    const generation = type ?? 'normal';
    if (!GENERATION_TYPES.has(generation)) throw new Error(`Generation type ${generation} is not supported by RPG Companion.`);
    if (route.kind === 'linked' && !LINKED_GENERATION_TYPES.has(generation)) {
      throw new Error(`Linked generation does not support ${generation}.`);
    }
    pendingExchange = {
      protocol: 'st-rpg.narration',
      version: 1,
      requestId: createUuid(),
      route,
      generation,
      locator: currentLocator(),
      bridge: { version: BRIDGE_VERSION, sillyTavernRevision: SILLYTAVERN_REVISION },
    };
  } catch (error) {
    pendingExchange = null;
    reportBlocked(error);
    abort(true);
  }
}

async function applyExchangeHeader(generateData) {
  if (!pendingExchange) return;
  const exchange = pendingExchange;
  pendingExchange = null;
  if (!generateData || typeof generateData !== 'object') {
    reportBlocked(new Error('SillyTavern did not expose mutable Chat Completion settings; generation cannot be routed safely.'));
    return;
  }
  // SillyTavern swallows event-listener exceptions. Never depend on throwing
  // here to stop a linked request: make the transient destination explicit.
  generateData.chat_completion_source = chat_completion_sources.CUSTOM;
  generateData.custom_url = companionUrl('/v1');
  generateData.custom_include_headers = mergeExchangeHeader(
    generateData.custom_include_headers,
    encodeNarrationExchange(exchange),
  );
}

function renderFailure(target, error) {
  if (!target) return;
  target.document.title = 'Campaign Book unavailable';
  target.document.body.innerHTML = '';
  const message = target.document.createElement('main');
  message.style.cssText = 'font:16px system-ui;padding:2rem;max-width:48rem;margin:auto;line-height:1.6';
  const heading = target.document.createElement('h1');
  heading.textContent = 'Campaign Book is unavailable';
  const detail = target.document.createElement('p');
  detail.textContent = `${error instanceof Error ? error.message : String(error)} Start it from the project root with: npm run start:companion`;
  message.append(heading, detail);
  target.document.body.appendChild(message);
}

async function openCampaignBook() {
  const target = window.open('about:blank', '_blank');
  if (target) target.opener = null;
  try {
    const response = await fetch(companionUrl('/health'), { cache: 'no-store', signal: AbortSignal.timeout(1500) });
    if (!response.ok) throw new Error(`Companion health returned HTTP ${response.status}.`);
    if (target) target.location.replace(companionUrl('/'));
    else window.location.assign(companionUrl('/'));
  } catch (error) {
    renderFailure(target, error);
    if (!target) globalThis.alert?.(`Campaign Book is unavailable. Start it with npm run start:companion. ${error instanceof Error ? error.message : String(error)}`);
  }
}

function mountLauncher() {
  if (document.getElementById(LAUNCHER_ID)) return;
  const menu = document.getElementById('extensionsMenu');
  if (!menu) {
    console.warn('[RPG Companion Bridge] SillyTavern extensions menu was not found.');
    return;
  }
  const launcher = document.createElement('div');
  launcher.id = LAUNCHER_ID;
  launcher.className = 'list-group-item flex-container flexGap5 interactable';
  launcher.tabIndex = 0;
  launcher.setAttribute('role', 'button');
  launcher.setAttribute('aria-label', 'Open Campaign Book');
  launcher.innerHTML = '<i class="fa-solid fa-book-open" aria-hidden="true"></i><span>Campaign Book</span>';
  launcher.addEventListener('click', openCampaignBook);
  launcher.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      void openCampaignBook();
    }
  });
  menu.appendChild(launcher);
}

function mount() {
  if (!eventsMounted) {
    const current = context();
    const events = current?.eventTypes ?? current?.event_types;
    const event = events?.CHAT_COMPLETION_SETTINGS_READY;
    if (event && typeof current?.eventSource?.makeLast === 'function') {
      current.eventSource.makeLast(event, applyExchangeHeader);
      settingsHookReady = true;
    } else if (event && typeof current?.eventSource?.on === 'function') {
      current.eventSource.on(event, applyExchangeHeader);
      settingsHookReady = true;
    } else {
      reportBlocked(new Error('Pinned SillyTavern Chat Completion settings hook is unavailable.'));
    }
    eventsMounted = true;
  }
  mountLauncher();
}

globalThis.stRpgCompanionGenerationInterceptor = generationInterceptor;
globalThis.stRpgCompanionBridge = Object.freeze({ openCampaignBook, currentLocator, currentRoute });

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
else mount();
