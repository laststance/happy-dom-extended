import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
// Outside the repository, Node cannot fall back to workspace dependencies during resolution.
const temporary = mkdtempSync(
  path.join(tmpdir(), 'happy-dom-extended-consumer-'),
);
const consumer = path.join(temporary, 'consumer');
const rootManifest = JSON.parse(
  readFileSync(path.join(root, 'package.json'), 'utf8'),
);

/** Runs a packaging verification command and reports failures before any following checks execute.
 * @param command - Executable to invoke.
 * @param argumentsList - Arguments passed without a shell.
 * @param cwd - Isolated working directory.
 * @returns Nothing on success; throws on failure.
 * @example run(process.execPath, ['esm.mjs'], consumer);
 */
function run(command, argumentsList, cwd) {
  const executable =
    process.platform === 'win32' && ['pnpm', 'npm'].includes(command)
      ? `${command}.cmd`
      : command;
  execFileSync(executable, argumentsList, {
    cwd,
    stdio: 'inherit',
  });
}

try {
  run(
    'pnpm',
    ['pack', '--pack-destination', temporary],
    path.join(root, 'packages/jest-happy-dom-extended'),
  );
  const tarball = readdirSync(temporary).find((name) => name.endsWith('.tgz'));
  if (!tarball)
    throw new Error('The package command did not create a tarball.');
  cpSync(path.join(root, 'fixtures/consumer'), consumer, {
    recursive: true,
    // The consumer must install from the tarball, with no workspace node_modules links.
    filter: (source) => path.basename(source) !== 'node_modules',
  });
  writeFileSync(
    path.join(consumer, 'package.json'),
    JSON.stringify(
      {
        name: 'happy-dom-extended-consumer-verification',
        private: true,
        dependencies: {
          jest: rootManifest.devDependencies.jest,
          'jest-happy-dom-extended': `file:${path.join(temporary, tarball)}`,
        },
      },
      null,
      2,
    ),
  );
  run(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--registry=https://registry.npmjs.org',
    ],
    consumer,
  );
  run(process.execPath, ['esm.mjs'], consumer);
  run(
    process.execPath,
    ['node_modules/jest/bin/jest.js', '--runInBand', '--no-cache'],
    consumer,
  );
} finally {
  // This unique directory contains only fixtures created by this invocation.
  rmSync(temporary, { recursive: true, force: true });
}
