import {
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import spawn from 'cross-spawn'

const root = fileURLToPath(new URL('..', import.meta.url))
// Outside the repository, Node cannot fall back to workspace dependencies during resolution.
const temporary = mkdtempSync(
  path.join(tmpdir(), 'happy-dom-extended consumer-'),
)
const rootManifest = JSON.parse(
  readFileSync(path.join(root, 'package.json'), 'utf8'),
)

/** Runs a packaging verification command and reports failures before any following checks execute.
 * @param command - Executable to invoke.
 * @param argumentsList - Separate arguments escaped by the launcher when Windows requires a command shim.
 * @param cwd - Isolated working directory.
 * @returns Nothing on success; throws on failure.
 * @example run(process.execPath, ['esm.mjs'], consumer);
 */
function run(command, argumentsList, cwd) {
  const result = spawn.sync(command, argumentsList, {
    cwd,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `${command} failed with ${result.signal ?? `exit code ${result.status}`}`,
    )
  }
}

try {
  run(
    'pnpm',
    ['pack', '--pack-destination', temporary],
    path.join(root, 'packages/jest-happy-dom-extended'),
  )
  const tarball = readdirSync(temporary).find((name) => name.endsWith('.tgz'))
  if (!tarball) throw new Error('The package command did not create a tarball.')
  // Exercise the advertised Jest floor and the current development version independently.
  for (const jestVersion of ['30.0.0', rootManifest.devDependencies.jest]) {
    const consumer = path.join(temporary, `consumer-${jestVersion}`)
    cpSync(path.join(root, 'fixtures/consumer'), consumer, {
      recursive: true,
      // The consumer must install from the tarball, with no workspace node_modules links.
      filter: (source) => path.basename(source) !== 'node_modules',
    })
    writeFileSync(
      path.join(consumer, 'package.json'),
      JSON.stringify(
        {
          name: 'happy-dom-extended-consumer-verification',
          private: true,
          dependencies: {
            jest: jestVersion,
            'jest-happy-dom-extended': `file:${path.join(temporary, tarball)}`,
          },
        },
        null,
        2,
      ),
    )
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
    )
    run(process.execPath, ['esm.mjs'], consumer)
    const testReport = path.join(consumer, 'jest-results.json')
    run(
      process.execPath,
      [
        'node_modules/jest/bin/jest.js',
        '--runInBand',
        '--no-cache',
        '--json',
        '--outputFile',
        testReport,
      ],
      consumer,
    )
    // A process exiting successfully before asynchronous setup finishes must still fail verification.
    const results = JSON.parse(readFileSync(testReport, 'utf8'))
    if (
      !results.success ||
      results.numTotalTests !== 2 ||
      results.numPassedTests !== 2
    ) {
      throw new Error(`Jest ${jestVersion} did not pass both consumer tests.`)
    }
  }
} finally {
  // This unique directory contains only fixtures created by this invocation.
  rmSync(temporary, { recursive: true, force: true })
}
