(() => {
  const currentScript = document.currentScript;
  if (!currentScript?.src) {
    console.error('[LLM RPG Bridge]', 'Unable to determine script base path.');
    return;
  }

  const base = currentScript.src.slice(0, currentScript.src.lastIndexOf('/') + 1);
  const scriptQueue = [
    'scripts/01-core.js',
    'scripts/02-rendering.js',
    'scripts/03-panel.js',
    'scripts/04-commands.js',
  ];

  function loadScript(relativePath) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `${base}${relativePath}`;
      script.async = false;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load ${relativePath}`));
      document.head.appendChild(script);
    });
  }

  scriptQueue
    .reduce((promise, relativePath) => promise.then(() => loadScript(relativePath)), Promise.resolve())
    .catch((error) => console.error('[LLM RPG Bridge]', error));
})();
