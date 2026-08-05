const LAUNCHER_ID = 'st-rpg-companion-launcher';
const COMPANION_PORT = 8002;

function companionUrl(path = '/') {
  const hostname = window.location.hostname || '127.0.0.1';
  return `http://${hostname}:${COMPANION_PORT}${path}`;
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

function mount() {
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

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
else mount();
