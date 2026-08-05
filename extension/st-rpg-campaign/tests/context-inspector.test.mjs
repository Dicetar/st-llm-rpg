import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

import { createNarratorContextInspector } from '../context-inspector.js';

test('Narrator Context opens in a native Popup and applies pin controls through Campaign operations', async () => {
  const { document, window } = parseHTML('<!doctype html><html><body><button id="open">Narrator Context</button></body></html>');
  Object.assign(globalThis, { document, window, HTMLElement: window.HTMLElement });
  let popup;
  class FakePopup {
    constructor(content, _type, _message, options) { Object.assign(this, { content, options }); popup = this; }
    show() { this.options.onOpen?.(); return Promise.resolve(); }
    complete() { this.options.onClose?.(); return Promise.resolve(); }
  }
  const context = { Popup: FakePopup, POPUP_TYPE: { DISPLAY: 9 }, POPUP_RESULT: { CANCELLED: 0 } };
  const capsule = {
    text: 'CAMPAIGN STATE · REVISION 3\n\nWORLD\n- Fact: visible',
    diagnostics: {
      totalChars: 52,
      maxChars: 8000,
      overflow: true,
      sections: [{ key: 'world', label: 'WORLD', usedChars: 20, maxChars: 1300, selectedCount: 1, omittedCount: 1 }],
      selected: [],
      indexed: [{ id: 'item-1', kind: 'item', name: 'Wardrobe key', section: 'inventory', policy: 'automatic', controllable: true }],
      focus: [],
      manualFocusIds: [],
      omitted: [{ recordId: 'fact-2', kind: 'fact', name: 'Hidden fact', section: 'world', reason: 'section budget reached', policy: 'automatic', controllable: true }],
    },
  };
  const operations = [];
  const manualFocus = [];
  const inspector = createNarratorContextInspector({
    getContext: () => context,
    getCapsule: () => ({ capsule }),
    executeCampaignOperation: async operation => { operations.push(operation); },
    setManualFocus: async (recordId, enabled) => { manualFocus.push({ recordId, enabled }); },
  });

  assert.equal(inspector.open(document.querySelector('#open')), true);
  assert.match(popup.content.textContent, /Hidden fact/);
  const pin = popup.content.querySelector('[data-context-record-id="fact-2"][data-context-policy="pinned"]');
  pin.dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 10));

  assert.deepEqual(operations, [{ type: 'set_context_policy', recordId: 'fact-2', contextPolicy: 'pinned' }]);
  assert.match(popup.content.querySelector('[role="status"]').textContent, /changed to pinned/i);

  const nextReply = [...popup.content.querySelectorAll('[data-context-focus-id="item-1"]')][0];
  nextReply.dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(manualFocus, [{ recordId: 'item-1', enabled: true }]);
  assert.match(popup.content.querySelector('[role="status"]').textContent, /queued for the next narrator reply/i);
});
