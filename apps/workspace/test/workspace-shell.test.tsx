import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderToStaticMarkup } from 'react-dom/server';
import { CampaignBookView } from '../src/App.js';

test('Campaign Book renders an honest tracer-32 shell', () => {
  const html = renderToStaticMarkup(<CampaignBookView
    snapshot={{ health: null, readiness: null, loading: false, error: '' }}
    onRefresh={() => undefined}
  />);
  assert.match(html, /<h1>Campaign Book<\/h1>/);
  assert.match(html, /Campaign authority/);
  assert.match(html, /does not own Campaign truth/);
  assert.match(html, /Refresh status/);
});

test('phone CSS prevents horizontal overflow and preserves touch targets', async () => {
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /overflow-x:\s*hidden/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /@media \(max-width: 600px\)/);
  assert.match(css, /grid-template-columns:\s*1fr/);
});
