import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import spawn from 'cross-spawn'

const root = fileURLToPath(new URL('..', import.meta.url))
const isolatedDirectories = []
/** Resolves Windows 8.3 temp paths so Vite `/@fs/` and Node import the same directory.
 * @example const cwd = resolveExistingPath(consumer)
 */
function resolveExistingPath(directory) {
  try {
    return realpathSync.native(directory)
  } catch {
    return realpathSync(directory)
  }
}

/** Creates an isolated temp directory with a space-free prefix under `os.tmpdir()`.
 * The OS temp root itself may contain spaces; spawn passes argv without a shell.
 * @example const consumer = createIsolatedDirectory('happy-dom-extended-vitest-4.0.0')
 */
function createIsolatedDirectory(label) {
  const directory = mkdtempSync(
    path.join(resolveExistingPath(tmpdir()), `${label}-`),
  )
  isolatedDirectories.push(directory)
  return resolveExistingPath(directory)
}
// Outside the repository, Node cannot fall back to workspace dependencies during resolution.
const temporary = createIsolatedDirectory('happy-dom-extended-pack')
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
    cwd: resolveExistingPath(cwd),
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

/** Reads a JSON file written by a consumer runner or setupFile.
 * @param file - Absolute path to a JSON document.
 * @returns The parsed value.
 * @example const results = readJson(testReport)
 */
function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

/** True when a setupFile JSON record names a positive integer process id.
 * {@link readWorkerRecords} rejects empty objects so they cannot count as a second PID.
 * @example if (!isWorkerRecord(worker)) throw new Error(name)
 */
function isWorkerRecord(worker) {
  return (
    worker !== null &&
    typeof worker === 'object' &&
    Number.isInteger(worker.pid) &&
    worker.pid > 0
  )
}

/** Loads `{ pid }` records written by consumer setupFiles.
 * @param workerRecords - Directory of JSON files.
 * @returns Parsed worker records.
 * @example const workers = readWorkerRecords(directory)
 */
function readWorkerRecords(workerRecords) {
  return readdirSync(workerRecords).map((name) => {
    const worker = readJson(path.join(workerRecords, name))
    if (!isWorkerRecord(worker)) {
      throw new Error(`Invalid worker record: ${name}`)
    }
    return worker
  })
}

/** Confirms parallel setup ran in at least two worker processes.
 * @param workerRecords - Directory of `{ pid }` JSON files written by setupFiles.
 * @returns Nothing; throws when fewer than two PIDs were recorded.
 * @example assertParallelWorkerRecords(directory)
 */
function assertParallelWorkerRecords(workerRecords) {
  const pids = new Set(
    readWorkerRecords(workerRecords).map((worker) => worker.pid),
  )
  if (pids.size < 2) {
    throw new Error(
      'Parallel verification did not run setup in at least two separate worker processes.',
    )
  }
}

/** Confirms serial Jest recorded exactly the CLI PID.
 * {@link assertSerialWorkerRecords} calls this when `requireRunnerPid` is true.
 * @example assertExactRunnerPid(workers, runnerPid)
 */
function assertExactRunnerPid(workers, runnerPid) {
  const pids = new Set(workers.map((worker) => worker.pid))
  if (pids.size !== 1) {
    throw new Error('Serial verification did not record exactly one worker.')
  }
  if (workers[0]?.pid !== runnerPid) {
    throw new Error('Serial verification unexpectedly used a worker process.')
  }
}

/** Confirms serial setup recorded a worker, and optionally that it is the CLI PID.
 * @param workerRecords - Directory of `{ pid }` JSON files written by setupFiles.
 * @param runnerPid - Parent CLI PID; Jest `--runInBand` must match it.
 * @param requireRunnerPid - When true, serial mode must be exactly one process and match the CLI PID.
 * @returns Nothing; throws when the recorded workers do not match serial mode.
 * @example assertSerialWorkerRecords(directory, pid, true)
 */
function assertSerialWorkerRecords(workerRecords, runnerPid, requireRunnerPid) {
  const workers = readWorkerRecords(workerRecords)
  if (workers.length === 0) {
    throw new Error('Serial verification did not record a worker.')
  }
  // Vitest forks+isolate starts a child per file even with `--maxWorkers=1`.
  if (requireRunnerPid) assertExactRunnerPid(workers, runnerPid)
}

/** Removes one report suite from the expected map or throws on a name/count mismatch.
 * {@link assertExpectedSuites} calls this for each `testResults` entry.
 * @example consumeExpectedSuite(remaining, suite)
 */
function consumeExpectedSuite(remaining, suite) {
  const name = path.basename(suite.name)
  if (remaining.get(name) !== suite.assertionResults?.length) {
    throw new Error(`Unexpected consumer suite or assertion count: ${name}`)
  }
  remaining.delete(name)
}

/** Confirms every expected consumer suite ran with the advertised assertion count.
 * {@link assertConsumerReport} calls this after the ten-test totals match.
 * @example assertExpectedSuites(results.testResults, suites, 'Jest 30.5.1 (serial)')
 */
function assertExpectedSuites(testResults, expectedSuites, label) {
  const remaining = new Map(expectedSuites)
  for (const suite of testResults) consumeExpectedSuite(remaining, suite)
  if (remaining.size) throw new Error(`${label} skipped a consumer suite.`)
}

/** Confirms a runner JSON report executed every expected consumer suite.
 * @param results - Parsed Jest-compatible or Vitest JSON report.
 * @param expectedSuites - Basename to assertion count.
 * @param label - Failure prefix that names the runner and version.
 * @returns Nothing; throws when counts or suite names regress.
 * @example assertConsumerReport(results, suites, 'Jest 30.5.1 (serial)')
 */
function assertConsumerReport(results, expectedSuites, label) {
  if (
    !results.success ||
    results.numTotalTests !== 10 ||
    results.numPassedTests !== 10
  ) {
    throw new Error(`${label} did not pass all ten consumer tests.`)
  }
  assertExpectedSuites(results.testResults, expectedSuites, label)
}

/** Installs an isolated consumer; retries with npm 11 when npm 10's arborist throws `edgesOut`.
 * @param consumer - Isolated working directory.
 * @returns Nothing; throws when npm install fails.
 * @example installConsumer(consumer)
 */
function installConsumer(consumer) {
  const argumentsList = [
    'install',
    '--no-audit',
    '--no-fund',
    '--registry=https://registry.npmjs.org',
  ]
  const environment = {
    ...process.env,
    // A sibling cache under one parent can still confuse npm 10's arborist graph.
    npm_config_cache: createIsolatedDirectory('happy-dom-extended-npm-cache'),
  }
  try {
    run('npm', argumentsList, consumer, environment)
  } catch {
    rmSync(path.join(consumer, 'node_modules'), {
      recursive: true,
      force: true,
    })
    rmSync(path.join(consumer, 'package-lock.json'), { force: true })
    // Node 22 ships npm 10, which can throw `edgesOut` null on the second Vitest tree.
    run(
      'npx',
      ['--yes', 'npm@11.19.0', ...argumentsList],
      consumer,
      environment,
    )
  }
}

/** Runs installed Vitest through `process.execPath` so Windows does not treat a drive-letter shim as an ESM URL.
 * Clears Vite's default cache and points `VITE_CACHE_DIR` at a per-mode directory.
 * @example runVitest(consumer, ['run'], env)
 */
function runVitest(consumer, argumentsList, environment) {
  const viteCache = path.join(
    consumer,
    `.vite-cache-${path.basename(environment.HAPPY_DOM_WORKER_RECORD_DIRECTORY ?? 'default')}`,
  )
  rmSync(path.join(consumer, 'node_modules/.vite'), {
    recursive: true,
    force: true,
  })
  return run(
    process.execPath,
    [path.join(consumer, 'node_modules/vitest/vitest.mjs'), ...argumentsList],
    consumer,
    { ...environment, VITE_CACHE_DIR: viteCache },
  )
}

try {
  const jestTarball = packWorkspace(
    path.join(root, 'packages/jest-happy-dom-extended'),
  )
  // Exercise the advertised Jest floor and the current development version independently.
  for (const jestVersion of ['30.0.0', rootManifest.devDependencies.jest]) {
    const consumer = createIsolatedDirectory(
      `happy-dom-extended-jest-${jestVersion}`,
    )
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
    installConsumer(consumer)
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
      if (mode === 'parallel') assertParallelWorkerRecords(workerRecords)
      else assertSerialWorkerRecords(workerRecords, runnerPid, true)
      // A process exiting successfully before asynchronous setup finishes must still fail verification.
      const results = readJson(testReport)
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
    const consumer = createIsolatedDirectory(
      `happy-dom-extended-vitest-${vitestVersion}`,
    )
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
    installConsumer(consumer)
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
      const runnerPid = runVitest(
        consumer,
        [
          'run',
          ...(mode === 'serial'
            ? ['--fileParallelism=false', '--maxWorkers=1']
            : ['--maxWorkers=2']),
          '--pool=forks',
          '--no-cache',
          // JSON-only reporter hid the Windows parallel crash after the serial report.
          '--reporter=verbose',
          '--reporter=json',
          `--outputFile=${testReport}`,
        ],
        { ...process.env, HAPPY_DOM_WORKER_RECORD_DIRECTORY: workerRecords },
      )
      // Vitest's default forks pool always uses a child even with one worker.
      if (mode === 'parallel') assertParallelWorkerRecords(workerRecords)
      else assertSerialWorkerRecords(workerRecords, runnerPid, false)
      const results = readJson(testReport)
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
  for (const directory of isolatedDirectories) {
    rmSync(directory, { recursive: true, force: true })
  }
}
