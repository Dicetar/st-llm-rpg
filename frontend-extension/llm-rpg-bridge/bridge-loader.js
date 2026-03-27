(() => {
  const currentSrc = document.currentScript?.src || '';
  const base = currentSrc.slice(0, currentSrc.lastIndexOf('/') + 1);

  function loadScript(filename) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `${base}${filename}`;
      script.async = false;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load ${filename}`));
      document.head.appendChild(script);
    });
  }

  loadScript('index.js')
    .then(() => loadScript('patch.js'))
    .catch((error) => console.error('[LLM RPG Bridge Loader]', error));
})();
