import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function read(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('canonical domain context uses the accepted one-call narration contract', async () => {
  const context = await read('CONTEXT.md');

  assert.match(context, /\*\*Narration Transaction\*\*:/);
  assert.match(context, /makes exactly one narrator model request/);
  assert.doesNotMatch(context, /\*\*Narration Draft\*\*:/);
  assert.doesNotMatch(context, /\*\*Narration Enrichment\*\*:/);
  assert.doesNotMatch(context, /preflight or enrichment planning phase/);
});

test('repo-local agent guidance follows normative companion authority', async () => {
  const agents = await read('AGENTS.md');
  const development = await read('docs/agents/development.md');

  assert.match(agents, /docs\/spec\/companion-v1-specification\.md/);
  assert.match(agents, /one deterministic preflight Context Plan and one narrator model call/);
  assert.match(development, /V1 does \*\*not\*\* use hidden narration drafts/);
  assert.match(development, /Work directly on `main`/);
});

test('superseded ADRs cannot present hidden drafts or vectors as active v1 behavior', async () => {
  const hiddenDraftAdr = await read('docs/adr/0010-use-preflight-context-with-bounded-hidden-draft-enrichment.md');
  const contextAdr = await read('docs/adr/0014-use-deterministic-tiered-context-plans.md');

  assert.match(hiddenDraftAdr, /Status: superseded by/);
  assert.match(hiddenDraftAdr, /Version 1 therefore does not implement this workflow/);
  assert.match(contextAdr, /Version 1 retrieval is FTS5-only/);
  assert.match(contextAdr, /Vector indexes, embeddings, vector result tiers, and embedding thresholds are disabled/);
});

test('README distinguishes the working fallback from the unimplemented companion', async () => {
  const readme = await read('README.md');

  assert.match(readme, /\*\*Working fallback:\*\*/);
  assert.match(readme, /\*\*Companion rebuild:\*\*/);
  assert.match(readme, /production implementation has only now begun at GitHub issue #32/);
  assert.match(readme, /Everything under `prototypes\/` is throwaway decision evidence/);
});

test('the supported Node runtime is pinned explicitly', async () => {
  const version = (await read('.node-version')).trim();
  const checker = await read('tools/check-node-version.mjs');

  assert.equal(version, '24.15.0');
  assert.match(checker, /EXPECTED_NODE_VERSION = '24\.15\.0'/);
  assert.match(checker, /Unsupported Node\.js runtime/);
});
