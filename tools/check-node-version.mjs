const EXPECTED_NODE_VERSION = '24.15.0';

if (process.versions.node !== EXPECTED_NODE_VERSION) {
  console.error([
    `Unsupported Node.js runtime: ${process.versions.node}.`,
    `This repository is pinned to Node.js ${EXPECTED_NODE_VERSION}.`,
    'Install or select the version recorded in .node-version, then rerun the command.',
  ].join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Node.js ${EXPECTED_NODE_VERSION} runtime verified.`);
}
