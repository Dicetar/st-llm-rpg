import fs from 'node:fs';

const source = fs.readFileSync(new URL('./index.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('./style.css', import.meta.url), 'utf8');

const mobileHandler = source.match(/const mobilePane =[^]*?if \(mobilePane\) \{([^]*?)\n  \}/)?.[1] ?? '';
const result = {
  desktopVisibilityCanHidePanel: /panel\.hidden\s*=\s*!state\.layout\[panelName\]/.test(source),
  mobileRestoreControlsHidden: /@media \(max-width: 800px\)[^]*?\.rpgws__restore-controls\s*\{[^}]*display:\s*none/.test(css),
  mobileTabRestoresSelectedPanel: /state\.layout\[mobilePane\]\s*=\s*true/.test(mobileHandler),
};

console.log(JSON.stringify(result, null, 2));

if (!result.desktopVisibilityCanHidePanel || !result.mobileRestoreControlsHidden || !result.mobileTabRestoresSelectedPanel) {
  process.exit(1);
}
