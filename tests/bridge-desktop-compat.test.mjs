import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../extension/st-rpg-bridge/index.js', import.meta.url), 'utf8');

function element() {
  return {
    style: {},
    append() {},
    addEventListener() {},
    setAttribute() {},
    innerHTML: '',
    tabIndex: 0,
  };
}

test('desktop bridge generates request IDs when randomUUID is unavailable on an insecure LAN origin', async () => {
  const aborts = [];
  const errors = [];
  let settingsReady;
  let exchange;
  let route = { kind: 'linked', bindingId: 'binding-1' };
  const menu = { appendChild() {} };
  const stContext = {
    eventTypes: { CHAT_COMPLETION_SETTINGS_READY: 'settings-ready' },
    eventSource: { makeLast(_event, listener) { settingsReady = listener; } },
    getCurrentChatId: () => 'Court',
    characters: [{ avatar: 'Narrator.png' }],
    characterId: 0,
    chatMetadata: {},
    saveSettingsDebounced() {},
  };
  const sandbox = {
    main_api: 'openai',
    extension_settings: {},
    chat_completion_sources: { CUSTOM: 'custom' },
    oai_settings: { chat_completion_source: 'custom' },
    bindingRoute: () => route,
    encodeNarrationExchange(value) {
      exchange = JSON.parse(JSON.stringify(value));
      return JSON.stringify(value);
    },
    mergeExchangeHeader: (_headers, value) => `X-ST-RPG-Exchange: ${value}`,
    crypto: {
      getRandomValues(bytes) {
        for (let index = 0; index < bytes.length; index += 1) bytes[index] = index + 1;
        return bytes;
      },
    },
    SillyTavern: { getContext: () => stContext },
    toastr: { error(message) { errors.push(message); } },
    console: { error() {}, warn() {} },
    window: { location: { hostname: '10.8.1.2' } },
    document: {
      readyState: 'complete',
      getElementById(id) { return id === 'extensionsMenu' ? menu : null; },
      createElement: element,
    },
    AbortSignal,
    fetch,
  };
  sandbox.globalThis = sandbox;

  const executable = source.replace(/^import .*;\r?$/gm, '');
  vm.runInNewContext(executable, sandbox, { filename: 'st-rpg-bridge/index.js' });
  assert.equal(typeof settingsReady, 'function');

  await sandbox.stRpgCompanionGenerationInterceptor([], 4096, value => aborts.push(value), 'normal');
  assert.deepEqual(aborts, [], `generation was blocked: ${errors.join('; ')}`);
  assert.deepEqual(errors, []);

  const generateData = { n: 2 };
  await settingsReady(generateData);
  assert.match(exchange.requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.match(exchange.locator.hostId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(generateData.custom_url, 'http://10.8.1.2:8002/v1');
  assert.match(generateData.custom_include_headers, /X-ST-RPG-Exchange/);
  assert.equal(generateData.n, 1, 'linked narration must request exactly one atomic candidate');

  route = { kind: 'unlinked' };
  await sandbox.stRpgCompanionGenerationInterceptor([], 4096, value => aborts.push(value), 'normal');
  const unlinkedGenerateData = { n: 2 };
  await settingsReady(unlinkedGenerateData);
  assert.equal(unlinkedGenerateData.n, 2, 'unlinked narration preserves SillyTavern multiple-candidate behavior');
});
