import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

test('Campaign launcher opens on a chat with no Campaign metadata', async () => {
  const { document, window } = parseHTML('<!doctype html><html><body><div id="extensions_settings"></div></body></html>');

  Object.assign(globalThis, {
    document,
    window,
    HTMLElement: window.HTMLElement,
    Event: window.Event,
    CustomEvent: window.CustomEvent,
    localStorage: window.localStorage ?? { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    requestAnimationFrame: callback => setTimeout(callback, 0),
    cancelAnimationFrame: clearTimeout,
    toastr: { error() {}, warning() {}, info() {}, success() {} },
    confirm: () => true,
  });

  globalThis.SillyTavern = {
    getContext() {
      return {
        chatId: 'launcher-empty-campaign',
        chat: [{ mes: 'Test message', is_user: true }],
        chatMetadata: {},
        extensionSettings: {},
        saveMetadata: async () => {},
        eventSource: { on() {} },
        event_types: { CHAT_CHANGED: 'chat_changed' },
      };
    },
  };

  await import(`${new URL('../index.js', import.meta.url).href}?test=${Date.now()}`);

  const launcher = document.querySelector('#rpgcampaign-launcher');
  const workspace = document.querySelector('[aria-label="RPG Campaign Workspace"]');
  assert.ok(launcher, 'Campaign launcher did not mount');
  assert.ok(workspace, 'Campaign workspace did not mount');
  assert.equal(workspace.getAttribute('aria-hidden'), 'true', 'Workspace must begin closed');

  launcher.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));
  await new Promise(resolve => setTimeout(resolve, 20));

  assert.equal(workspace.getAttribute('aria-hidden'), 'false', 'Campaign click did nothing: workspace remained closed');
});
