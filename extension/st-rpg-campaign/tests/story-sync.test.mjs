import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

import { createStorySync, createStorySyncSource, parseStorySyncOutput } from '../story-sync.js';
import { createCampaignSession, createMemoryCampaignStorage } from '../campaign-session.js';

test('Story Sync bounds the earliest unseen source without silently skipping later backlog', () => {
  const chat = Array.from({ length: 15 }, (_, index) => ({
    mes: index === 1 ? '   ' : `${index}: ${'x'.repeat(1_400)}`,
    is_user: index % 2 === 0,
    name: index % 2 === 0 ? 'Player' : 'Narrator',
  }));

  const source = createStorySyncSource(chat, 'bounded-chat', 2);

  assert.equal(source.messages.length, 10, 'The character budget should retain only the newest complete/partial messages');
  assert.equal(source.messages[0].index, 3);
  assert.equal(source.messages.at(-1).index, 12);
  assert.equal(source.remainingMessages, 2);
  assert.ok(source.transcript.length <= 14_700, 'Transcript labels may add bounded overhead beyond source content');
  assert.match(source.identity, /^bounded-chat:[0-9a-f]{8}$/);
  assert.doesNotMatch(source.transcript, /\[message 0\]/);
  assert.match(source.transcript, /\[message 3\]/);
  assert.doesNotMatch(source.transcript, /\[message 14\]/);
});

test('Story Sync normalizes safe aliases but rejects unknown or incomplete proposal shapes', () => {
  const proposals = parseStorySyncOutput(`\n\`\`\`json
    {"proposals":[
      {"collection":"inventory","subject":"Wardrobe key","change":"Player picked it up","evidence":"message 14","confidence":"HIGH"},
      {"collection":"made-up","subject":"Lavir","summary":"Seems worried","confidence":"certain"},
      {"collection":"quest","subject":"Find the witness","change":"Quest became active","confidence":"certain"},
      {"collection":"world","subject":"","change":""}
    ]}
  \`\`\``);

  assert.deepEqual(proposals, [
    {
      collection: 'inventory',
      recordType: 'item',
      subject: 'Wardrobe key',
      field: 'summary',
      value: 'Player picked it up',
      evidence: 'message 14',
      confidence: 'high',
    },
    {
      collection: 'objectives',
      recordType: 'quest',
      subject: 'Find the witness',
      field: 'summary',
      value: 'Quest became active',
      evidence: '',
      confidence: 'low',
    },
  ]);
});

test('Story Sync opens synchronously in a native Popup without closing its Workspace', async () => {
  const { document, window } = parseHTML('<!doctype html><html><body><section id="workspace" class="is-open"></section><button id="sync">Sync Story</button></body></html>');
  Object.assign(globalThis, {
    document,
    window,
    HTMLElement: window.HTMLElement,
  });

  const popups = [];
  class FakePopup {
    constructor(content, type, _message, options) {
      Object.assign(this, { content, type, options, shown: false });
      popups.push(this);
    }

    show() {
      this.shown = true;
      this.options.onOpen?.();
      return Promise.resolve();
    }

    complete() {
      this.options.onClose?.();
      return Promise.resolve();
    }
  }

  const context = {
    Popup: FakePopup,
    POPUP_TYPE: { DISPLAY: 9 },
    POPUP_RESULT: { CANCELLED: 0 },
    extensionSettings: { connectionManager: { profiles: [] } },
    ConnectionManagerRequestService: { getSupportedProfiles: () => [] },
    chat: [],
    chatId: 'story-sync-chat',
    chatCompletionSettings: {},
    textCompletionSettings: {},
    saveSettingsDebounced() {},
  };
  const storySync = createStorySync({ getContext: () => context });
  const trigger = document.querySelector('#sync');
  const workspace = document.querySelector('#workspace');

  const opened = storySync.open(trigger);

  assert.equal(opened, true);
  assert.equal(popups.length, 1);
  assert.equal(popups[0].type, context.POPUP_TYPE.DISPLAY);
  assert.equal(popups[0].shown, true, 'Popup.show must run before open() returns');
  assert.equal(workspace.classList.contains('is-open'), true, 'Story Sync must not close its owning Workspace');
  assert.match(popups[0].content.textContent, /Campaign Worker/);
});

test('Story Sync repairs malformed worker output once and renders an editable proposal draft', async () => {
  const { document, window } = parseHTML('<!doctype html><html><body><button id="sync">Sync Story</button></body></html>');
  Object.assign(globalThis, { document, window, HTMLElement: window.HTMLElement });

  let popup;
  class FakePopup {
    constructor(content, _type, _message, options) {
      Object.assign(this, { content, options });
      popup = this;
    }

    show() {
      this.options.onOpen?.();
      return Promise.resolve();
    }
  }

  const responses = [
    'This is not JSON.',
    '{"proposals":[{"collection":"inventory","subject":"Silver key","change":"Add to inventory","evidence":"message 0","confidence":"high"}]}',
  ];
  const requests = [];
  const profile = { id: 'worker-1', name: 'RPG Campaign Worker', model: 'mistral-nemo', 'api-url': 'http://localhost:1234/v1' };
  const context = {
    Popup: FakePopup,
    POPUP_TYPE: { DISPLAY: 9 },
    extensionSettings: {
      rpgCampaignWorker: { profileId: profile.id },
      connectionManager: { selectedProfile: 'narrator-profile', profiles: [profile] },
    },
    ConnectionManagerRequestService: {
      getSupportedProfiles: () => [profile],
      async sendRequest(...args) {
        requests.push(args);
        return { content: responses.shift() };
      },
    },
    chat: [{ mes: 'I take the silver key.', is_user: true, name: 'Player' }],
    chatId: 'repair-chat',
    mainApi: 'openai',
    getChatCompletionModel: () => 'narrator-model',
    chatCompletionSettings: { chat_completion_source: 'custom' },
    textCompletionSettings: {},
    saveSettingsDebounced() {},
  };

  const campaignSession = createCampaignSession({ storage: createMemoryCampaignStorage() });
  let campaignRevision = (await campaignSession.open({ chatId: context.chatId })).revision;

  const storySync = createStorySync({
    getContext: () => context,
    getCampaignContext: () => 'CAMPAIGN STATE · REVISION 3\nINVENTORY\n- Silver key ×1',
    getReviewInbox: () => campaignSession.query({ collection: 'story_sync_proposals' }),
    executeCampaignOperation: async operation => {
      const result = await campaignSession.execute(operation, campaignRevision);
      campaignRevision = result.revision;
      return result;
    },
  });
  storySync.open(document.querySelector('#sync'));
  popup.content.querySelector('[data-story-sync-action="analyze"]')
    .dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 20));

  assert.equal(requests.length, 2, 'Malformed output should receive one repair call');
  assert.match(requests[0][1][1].content, /CAMPAIGN STATE · REVISION 3/);
  assert.equal(requests[0][3].includePreset, false, 'Worker must not inherit the narrator generation preset');
  assert.equal(requests[0][4].custom_prompt_post_processing, '', 'Worker must bypass narrator prompt post-processing');
  assert.equal(popup.content.querySelector('[data-story-sync-field="subject"]').value, 'Silver key');
  assert.equal(popup.content.querySelector('[data-story-sync-field="value"]').value, 'Add to inventory');
  assert.match(popup.content.querySelector('[role="status"]').textContent, /saved for review after one repair/i);

  const selection = popup.content.querySelector('[data-story-sync-select]');
  selection.checked = true;
  selection.dispatchEvent(new window.Event('input', { bubbles: true }));
  popup.content.querySelector('[data-story-sync-action="accept-selected"]')
    .dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 30));

  assert.equal(campaignSession.query({ collection: 'inventory' }).entries[0].item.name, 'Silver key');
  assert.equal(campaignSession.query({ collection: 'story_sync_proposals', statuses: ['pending'] }).entries.length, 0);
  assert.equal(campaignSession.query({ collection: 'story_sync_proposals' }).syncBoundary.messageIndex, 0);
});

test('Story Sync reports a disabled Connection Manager instead of asking for a missing profile', async () => {
  const { document, window } = parseHTML('<!doctype html><html><body><button id="sync">Sync Story</button></body></html>');
  Object.assign(globalThis, { document, window, HTMLElement: window.HTMLElement });
  let popup;
  class FakePopup {
    constructor(content, _type, _message, options) { Object.assign(this, { content, options }); popup = this; }
    show() { return Promise.resolve(); }
  }
  const context = {
    Popup: FakePopup,
    POPUP_TYPE: { DISPLAY: 9 },
    extensionSettings: {
      disabledExtensions: ['connection-manager'],
      connectionManager: { profiles: [] },
    },
    ConnectionManagerRequestService: {
      getSupportedProfiles() { throw new Error('Connection Manager is not available'); },
    },
    chat: [{ mes: 'Something changed.', is_user: true }],
    chatId: 'disabled-manager-chat',
    chatCompletionSettings: {},
    textCompletionSettings: {},
  };
  createStorySync({ getContext: () => context }).open(document.querySelector('#sync'));
  popup.content.querySelector('[data-story-sync-action="analyze"]')
    .dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.match(popup.content.querySelector('[role="status"]').textContent, /enable SillyTavern Connection Manager/i);
});

test('Story Sync recognizes SillyTavern-wrapped cancellation as a neutral stopped state', async () => {
  const { document, window } = parseHTML('<!doctype html><html><body><button id="sync">Sync Story</button></body></html>');
  Object.assign(globalThis, { document, window, HTMLElement: window.HTMLElement });
  let popup;
  class FakePopup {
    constructor(content, _type, _message, options) { Object.assign(this, { content, options }); popup = this; }
    show() { return Promise.resolve(); }
  }
  const profile = { id: 'worker-abort', name: 'Worker', model: 'worker-model' };
  const abort = Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
  const context = {
    Popup: FakePopup,
    POPUP_TYPE: { DISPLAY: 9 },
    extensionSettings: {
      disabledExtensions: [],
      rpgCampaignWorker: { profileId: profile.id },
      connectionManager: { selectedProfile: 'narrator', profiles: [profile] },
    },
    ConnectionManagerRequestService: {
      getSupportedProfiles: () => [profile],
      async sendRequest() { throw new Error('API request failed', { cause: abort }); },
    },
    chat: [{ mes: 'Something changed.', is_user: true }],
    chatId: 'abort-chat',
    mainApi: 'openai',
    getChatCompletionModel: () => 'narrator-model',
    chatCompletionSettings: {},
    textCompletionSettings: {},
  };
  createStorySync({ getContext: () => context }).open(document.querySelector('#sync'));
  popup.content.querySelector('[data-story-sync-action="analyze"]')
    .dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 0));

  const status = popup.content.querySelector('[role="status"]');
  assert.match(status.textContent, /request stopped/i);
  assert.equal(status.dataset.tone, 'neutral');
});
