import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RECOMMENDED_NODE_VERSION,
  evaluateNodeVersion,
} from '../tools/check-node-version.mjs';

test('recommended Node runtime is accepted without a warning state', () => {
  assert.deepEqual(evaluateNodeVersion(RECOMMENDED_NODE_VERSION), {
    supported: true,
    recommended: true,
    message: `Node.js ${RECOMMENDED_NODE_VERSION} runtime verified.`,
  });
});

test('later Node 24 patches are supported but identified as non-recommended', () => {
  const result = evaluateNodeVersion('24.15.1');
  assert.equal(result.supported, true);
  assert.equal(result.recommended, false);
  assert.match(result.message, /Recommended and CI-tested version: 24\.15\.0/);
});

test('unsupported older and next-major runtimes fail clearly', () => {
  for (const version of ['22.22.2', '24.14.9', '25.0.0', 'not-a-version']) {
    const result = evaluateNodeVersion(version);
    assert.equal(result.supported, false, version);
    assert.match(result.message, />=24\.15\.0 <25/);
  }
});
