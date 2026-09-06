import {
  cpSync,
  mkdirSync,
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
 * @returns The child PID on success; throws on failure.
 * @example run(process.execPath, ['esm.mjs'], consumer);
 */
function run(command, argumentsList, cwd, environment = process.env) {
  const result = spawn.sync(command, argumentsList, {
    cwd,
    stdio: 'inherit',
    env: environment,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `${command} failed with ${result.signal ?? `exit code ${result.status}`}`,
    )
  }
  return result.pid
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
    const fixtureManifest = JSON.parse(
      readFileSync(path.join(consumer, 'package.json'), 'utf8'),
    )
    writeFileSync(
      path.join(consumer, 'package.json'),
      JSON.stringify(
        {
          name: 'happy-dom-extended-consumer-verification',
          private: true,
          devDependencies: {
            ...fixtureManifest.devDependencies,
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
        '--no-audit',
        '--no-fund',
        '--registry=https://registry.npmjs.org',
      ],
      consumer,
    )
    run(process.execPath, ['esm.mjs'], consumer)
    run(
      process.execPath,
      ['--test', 'environment-lifecycle.test.mjs'],
      consumer,
    )
    for (const mode of ['serial', 'parallel']) {
      const testReport = path.join(consumer, `jest-results-${mode}.json`)
      const workerRecords = path.join(consumer, `workers-${mode}`)
      mkdirSync(workerRecords)
      const runnerPid = run(
        process.execPath,
        [
          'node_modules/jest/bin/jest.js',
          ...(mode === 'serial'
            ? ['--runInBand']
            : ['--maxWorkers=2', '--workerIdleMemoryLimit=512MB']),
          '--no-cache',
          '--cacheDirectory',
          path.join(consumer, `.jest-cache-${mode}`),
          '--json',
          '--outputFile',
          testReport,
        ],
        consumer,
        { ...process.env, HAPPY_DOM_WORKER_RECORD_DIRECTORY: workerRecords },
      )
      const workers = readdirSync(workerRecords).map((name) =>
        JSON.parse(readFileSync(path.join(workerRecords, name), 'utf8')),
      )
      if (mode === 'parallel') {
        if (
          workers.length !== 2 ||
          workers.some((worker) => worker.pid === runnerPid)
        ) {
          throw new Error(
            'Parallel verification did not run setup in two separate Jest worker processes.',
          )
        }
      } else if (workers.length !== 1 || workers[0]?.pid !== runnerPid) {
        throw new Error(
          'Serial verification unexpectedly used a worker process.',
        )
      }
      // A process exiting successfully before asynchronous setup finishes must still fail verification.
      const results = JSON.parse(readFileSync(testReport, 'utf8'))
      if (
        !results.success ||
        results.numTotalTests !== 6 ||
        results.numPassedTests !== 6 ||
        results.numTotalTestSuites !== 3 ||
        results.numPassedTestSuites !== 3
      ) {
        throw new Error(
          `Jest ${jestVersion} (${mode}) did not pass all six tests in three consumer suites.`,
        )
      }
      const expectedSuites = new Map([
        ['package.test.cjs', 1],
        ['canvas.test.cjs', 3],
        ['offscreen.test.cjs', 2],
      ])
      for (const suite of results.testResults) {
        const name = path.basename(suite.name)
        if (expectedSuites.get(name) !== suite.assertionResults.length) {
          throw new Error(
            `Unexpected consumer suite or assertion count: ${name}`,
          )
        }
        expectedSuites.delete(name)
      }
      if (expectedSuites.size)
        throw new Error('A consumer suite was not executed.')
    }
  }
} finally {
  // This unique directory contains only fixtures created by this invocation.
  rmSync(temporary, { recursive: true, force: true })
}
