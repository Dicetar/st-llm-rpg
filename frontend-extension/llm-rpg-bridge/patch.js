setTimeout(() => {
  try {
    if (typeof bindInventorySearchHandlers === 'function') {
      bindInventorySearchHandlers();
    }
    if (typeof bindQuestEditorHandlers === 'function') {
      bindQuestEditorHandlers();
    }
    if (typeof refreshPanel === 'function') {
      refreshPanel().catch((error) => warn('Patch compatibility refresh failed.', error));
    }
  } catch (error) {
    console.warn('[LLM RPG Bridge]', 'Patch compatibility shim failed.', error);
  }
}, 0);
