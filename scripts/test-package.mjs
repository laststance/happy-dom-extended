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

/** Packs one public workspace into the isolated temporary directory.
 * @param packageDirectory - Workspace folder that contains the publishable package.json.
 * @returns Absolute path of the created tarball.
 * @example const tarball = packWorkspace('packages/jest-happy-dom-extended')
 */
function packWorkspace(packageDirectory) {
  const destination = mkdtempSync(path.join(temporary, 'pack-'))
  run('pnpm', ['pack', '--pack-destination', destination], packageDirectory)
  const tarball = readdirSync(destination).find((name) => name.endsWith('.tgz'))
  if (!tarball) throw new Error('The package command did not create a tarball.')
  return path.join(destination, tarball)
}

/** Confirms setupFiles recorded the expected worker process identities.
 * @param workerRecords - Directory of `{ pid }` JSON files written by setupFiles.
 * @param mode - `serial` expects setup to run; `parallel` expects at least two distinct PIDs.
 * @param runnerPid - Parent CLI PID; Jest `--runInBand` must match it, Vitest forks must not require that.
 * @param requireRunnerPid - When true, serial mode must be exactly one process and match the CLI PID.
 * @returns Nothing; throws when the recorded workers do not match the mode.
 * @example assertWorkerRecords(directory, 'parallel', pid, false)
 */
function assertWorkerRecords(workerRecords, mode, runnerPid, requireRunnerPid) {
  const workers = readdirSync(workerRecords).map((name) =>
    JSON.parse(readFileSync(path.join(workerRecords, name), 'utf8')),
  )
  const pids = new Set(workers.map((worker) => worker.pid))
  if (mode === 'parallel') {
    if (pids.size < 2) {
      throw new Error(
        'Parallel verification did not run setup in at least two separate worker processes.',
      )
    }
    return
  }
  if (pids.size === 0) {
    throw new Error('Serial verification did not record a worker.')
  }
  // Vitest forks+isolate starts a child per file even with `--maxWorkers=1`.
  if (requireRunnerPid) {
    if (pids.size !== 1) {
      throw new Error('Serial verification did not record exactly one worker.')
    }
    if (workers[0]?.pid !== runnerPid) {
      throw new Error('Serial verification unexpectedly used a worker process.')
    }
  }
}

/** Confirms a runner JSON report executed every expected consumer suite.
 * @param results - Parsed Jest-compatible or Vitest JSON report.
 * @param expectedSuites - Basename to assertion count.
 * @param label - Failure prefix that names the runner and version.
 * @returns Nothing; throws when counts or suite names regress.
 * @example assertConsumerReport(results, suites, 'Jest 30.5.1 (serial)')
 */
function assertConsumerReport(results, expectedSuites, label) {
  const total = results.numTotalTests
  const passed = results.numPassedTests
  if (!results.success || total !== 10 || passed !== 10) {
    throw new Error(`${label} did not pass all ten consumer tests.`)
  }
  const remaining = new Map(expectedSuites)
  for (const suite of results.testResults) {
    const name = path.basename(suite.name)
    const assertions = suite.assertionResults?.length
    if (remaining.get(name) !== assertions) {
      throw new Error(`Unexpected consumer suite or assertion count: ${name}`)
    }
    remaining.delete(name)
  }
  if (remaining.size) throw new Error(`${label} skipped a consumer suite.`)
}

try {
  const jestTarball = packWorkspace(
    path.join(root, 'packages/jest-happy-dom-extended'),
  )
  // Exercise the advertised Jest floor and the current development version independently.
  for (const jestVersion of ['30.0.0', rootManifest.devDependencies.jest]) {
    const consumer = path.join(temporary, `consumer-jest-${jestVersion}`)
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
          // npm 12 requires explicit approval to install Skia's native binary.
          allowScripts: { 'skia-canvas': true },
          devDependencies: {
            ...fixtureManifest.devDependencies,
            jest: jestVersion,
            'jest-happy-dom-extended': `file:${jestTarball}`,
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
      assertWorkerRecords(workerRecords, mode, runnerPid, true)
      // A process exiting successfully before asynchronous setup finishes must still fail verification.
      const results = JSON.parse(readFileSync(testReport, 'utf8'))
      if (
        results.numTotalTestSuites !== 3 ||
        results.numPassedTestSuites !== 3
      ) {
        throw new Error(
          `Jest ${jestVersion} (${mode}) did not pass three consumer suites.`,
        )
      }
      assertConsumerReport(
        results,
        new Map([
          ['package.test.cjs', 5],
          ['canvas.test.cjs', 3],
          ['offscreen.test.cjs', 2],
        ]),
        `Jest ${jestVersion} (${mode})`,
      )
    }
  }

  const vitestTarball = packWorkspace(
    path.join(root, 'packages/vitest-happy-dom-extended'),
  )
  // Exercise the advertised Vitest floor and the current development version independently.
  for (const vitestVersion of ['4.0.0', rootManifest.devDependencies.vitest]) {
    const consumer = path.join(temporary, `consumer-vitest-${vitestVersion}`)
    cpSync(path.join(root, 'fixtures/consumer-vitest'), consumer, {
      recursive: true,
      filter: (source) => path.basename(source) !== 'node_modules',
    })
    const fixtureManifest = JSON.parse(
      readFileSync(path.join(consumer, 'package.json'), 'utf8'),
    )
    writeFileSync(
      path.join(consumer, 'package.json'),
      JSON.stringify(
        {
          name: 'happy-dom-extended-vitest-consumer-verification',
          private: true,
          type: 'module',
          allowScripts: { 'skia-canvas': true },
          devDependencies: {
            ...fixtureManifest.devDependencies,
            vitest: vitestVersion,
            // Vitest 4.0.0's module runner does not implement Vite 7.2+'s `getBuiltins`.
            ...(vitestVersion === '4.0.0' ? { vite: '7.1.12' } : {}),
            'vitest-environment-happy-dom-extended': `file:${vitestTarball}`,
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
      const testReport = path.join(consumer, `vitest-results-${mode}.json`)
      const workerRecords = path.join(consumer, `workers-${mode}`)
      mkdirSync(workerRecords)
      const runnerPid = run(
        path.join(consumer, 'node_modules/.bin/vitest'),
        [
          'run',
          ...(mode === 'serial'
            ? ['--fileParallelism=false', '--maxWorkers=1']
            : ['--maxWorkers=2']),
          '--reporter=json',
          `--outputFile=${testReport}`,
        ],
        consumer,
        { ...process.env, HAPPY_DOM_WORKER_RECORD_DIRECTORY: workerRecords },
      )
      // Vitest's default forks pool always uses a child even with one worker.
      assertWorkerRecords(workerRecords, mode, runnerPid, false)
      const results = JSON.parse(readFileSync(testReport, 'utf8'))
      assertConsumerReport(
        results,
        new Map([
          ['package.test.mjs', 5],
          ['canvas.test.mjs', 3],
          ['offscreen.test.mjs', 2],
        ]),
        `Vitest ${vitestVersion} (${mode})`,
      )
    }
  }
} finally {
  // This unique directory contains only fixtures created by this invocation.
  rmSync(temporary, { recursive: true, force: true })
}
