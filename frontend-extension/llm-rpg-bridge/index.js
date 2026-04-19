const scriptQueue = [
  'scripts/01-core.js',
  'scripts/02-rendering.js',
  'scripts/03-panel.js',
  'scripts/04-commands.js',
];

function loadScript(relativePath) {
  const sourceUrl = new URL(relativePath, import.meta.url).href;
  const scriptId = `llm-rpg-bridge-${relativePath.replaceAll(/[^\w-]+/g, '-')}`;

  return new Promise((resolve, reject) => {
    const existing = document.getElementById(scriptId);
    if (existing) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.id = scriptId;
    script.src = sourceUrl;
    script.async = false;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${relativePath}`));
    document.head.appendChild(script);
  });
}

scriptQueue
  .reduce((promise, relativePath) => promise.then(() => loadScript(relativePath)), Promise.resolve())
  .catch((error) => console.error('[LLM RPG Bridge]', error));
