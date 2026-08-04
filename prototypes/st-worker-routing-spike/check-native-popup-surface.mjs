import fs from 'node:fs';

const storySync = fs.readFileSync(new URL('../../extension/st-rpg-campaign/story-sync.js', import.meta.url), 'utf8');
const workspaceCss = fs.readFileSync(new URL('../../extension/st-rpg-campaign/style.css', import.meta.url), 'utf8');
const workspace = fs.readFileSync(new URL('../../extension/st-rpg-campaign/index.js', import.meta.url), 'utf8');

const syncAction = workspace.match(/function openStorySync\(trigger\) \{([^]*?)\n\}/)?.[1] ?? '';
const result = {
  usesNativePopup: /new Popup\([^]*POPUP_TYPE\.DISPLAY/.test(storySync),
  productionOwnsStorySync: /import \{ createStorySync \} from '\.\/story-sync\.js'/.test(workspace),
  workspaceCallsOwnedService: /storySync\.open\(trigger\)/.test(syncAction),
  workspaceStaysOpen: !/closeWorkspace\(/.test(syncAction),
  noPrototypeGlobalDependency: !/RpgCampaignWorker/.test(workspace + storySync),
  noCrossExtensionEvent: !/st-rpg:story-sync-requested/.test(storySync + workspace),
  noFixedStorySyncOverlay: !/\.rpgstorysync\s*\{[^}]*position:\s*fixed/.test(workspaceCss),
};

console.log(JSON.stringify(result, null, 2));

if (Object.values(result).some(value => !value)) process.exit(1);
