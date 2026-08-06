import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export const RECOMMENDED_NODE_VERSION = '24.15.0';
export const MINIMUM_NODE_VERSION = '24.15.0';
export const MAXIMUM_NODE_MAJOR = 25;

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version);
  if (!match) return null;
  return match.slice(1, 4).map(Number);
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

export function evaluateNodeVersion(version) {
  const parsed = parseVersion(version);
  const minimum = parseVersion(MINIMUM_NODE_VERSION);
  if (!parsed || !minimum) {
    return {
      supported: false,
      recommended: false,
      message: `Unsupported Node.js runtime: ${version}. Expected Node.js >=${MINIMUM_NODE_VERSION} <${MAXIMUM_NODE_MAJOR}.`,
    };
  }

  const supported = parsed[0] < MAXIMUM_NODE_MAJOR && compareVersions(parsed, minimum) >= 0;
  if (!supported) {
    return {
      supported: false,
      recommended: false,
      message: `Unsupported Node.js runtime: ${version}. Expected Node.js >=${MINIMUM_NODE_VERSION} <${MAXIMUM_NODE_MAJOR}.`,
    };
  }

  if (version === RECOMMENDED_NODE_VERSION) {
    return {
      supported: true,
      recommended: true,
      message: `Node.js ${version} runtime verified.`,
    };
  }

  return {
    supported: true,
    recommended: false,
    message: `Node.js ${version} is supported. Recommended and CI-tested version: ${RECOMMENDED_NODE_VERSION}.`,
  };
}

function isMainModule() {
  const entry = process.argv[1];
  return Boolean(entry && pathToFileURL(resolve(entry)).href === import.meta.url);
}

if (isMainModule()) {
  const result = evaluateNodeVersion(process.versions.node);
  const write = result.supported
    ? (result.recommended ? console.log : console.warn)
    : console.error;
  write(result.message);
  if (!result.supported) process.exitCode = 1;
}
