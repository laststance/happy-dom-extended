import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
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

// Last Vitest 4 minor: first line with `vitest/runtime`, while `vitest/environments` still warns on import.
const LATEST_VITEST_4 = '4.1.11'
// Vitest 4.1 warns when anything imports this entry and Vitest 5 removed it; the environment must never mention it.
const LEGACY_VITEST_ENTRY = 'vitest/environments'
// Lines every blocked-install guidance contains; see packages/compat/src/utils/skia-install-error.ts.
const SKIA_GUIDANCE_LINES = [
  'skia-canvas cannot load its native binary (lib/skia.node).',
  'pnpm approve-builds',
  'npm approve-scripts skia-canvas && npm rebuild skia-canvas',
  'bun pm trust skia-canvas',
]
// Upper bound for a piped Vitest stderr stream; verbose reporters stay far below it.
const CAPTURED_OUTPUT_MAX_BYTES = 64 * 1024 * 1024
// Each supported Vitest pool with the workers it must use and the execution context its setup files must observe.
const vitestModes = [
  {
    mode: 'serial',
    pool: 'forks',
    workers: 1,
    workerThread: false,
    vmContext: false,
  },
  {
    mode: 'forks',
    pool: 'forks',
    workers: 2,
    workerThread: false,
    vmContext: false,
  },
  {
    mode: 'threads',
    pool: 'threads',
    workers: 2,
    workerThread: true,
    vmContext: false,
  },
  {
    mode: 'vmThreads',
    pool: 'vmThreads',
    workers: 2,
    workerThread: true,
    vmContext: true,
  },
  {
    mode: 'vmForks',
    pool: 'vmForks',
    workers: 2,
    workerThread: false,
    vmContext: true,
  },
]
// Every distinct pool, for fixtures that verify behavior rather than worker counts.
const vitestPools = [
  ...new Set(vitestModes.map((vitestMode) => vitestMode.pool)),
]

/** Throws when a spawnSync result could not start or exited unsuccessfully.
 * {@link spawnChecked} calls this after replaying piped stderr.
 * @param command - Executable named in the failure message.
 * @param result - The spawnSync result.
 * @returns Nothing; throws the launch error or a non-zero exit/signal error.
 * @example assertSpawnSucceeded('npm', { status: 1, signal: null }) // throws "npm failed with exit code 1"
 */
function assertSpawnSucceeded(command, result) {
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `${command} failed with ${result.signal ?? `exit code ${result.status}`}`,
    )
  }
}

/** Spawns one verification command with separate argv values and throws on launch errors or non-zero exits.
 * Piped stderr is replayed afterwards so CI logs keep crashes that JSON reports cannot show.
 * @param command - Executable to invoke.
 * @param argumentsList - Separate arguments escaped by the launcher when Windows requires a command shim.
 * @param cwd - Isolated working directory.
 * @param environment - Child environment variables.
 * @param stdio - `'inherit'`, or a tuple that pipes stderr for inspection.
 * @returns
 * - The spawnSync result: `pid`, and `stderr` text when stderr was piped
 * - Throws when the command cannot start or exits unsuccessfully
 * @example spawnChecked(process.execPath, ['esm.mjs'], consumer, process.env, 'inherit').pid // => 12345
 */
function spawnChecked(command, argumentsList, cwd, environment, stdio) {
  const result = spawn.sync(command, argumentsList, {
    cwd: resolveExistingPath(cwd),
    stdio,
    env: environment,
    encoding: 'utf8',
    maxBuffer: CAPTURED_OUTPUT_MAX_BYTES,
  })
  // Inherited stderr already reached the terminal; only a piped stream needs replaying.
  if (typeof result.stderr === 'string') process.stderr.write(result.stderr)
  assertSpawnSucceeded(command, result)
  return result
}

/** Runs a packaging verification command and reports failures before any following checks execute.
 * @param command - Executable to invoke.
 * @param argumentsList - Separate arguments escaped by the launcher when Windows requires a command shim.
 * @param cwd - Isolated working directory.
 * @returns The child PID on success; throws on failure.
 * @example run(process.execPath, ['esm.mjs'], consumer);
 */
function run(command, argumentsList, cwd, environment = process.env) {
  return spawnChecked(command, argumentsList, cwd, environment, 'inherit').pid
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

/** Loads `{ pid }` records written by consumer setupFiles; Vitest records add `threadId` and `vmContext`.
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

/** Confirms Jest `--runInBand` ran every setupFile inside the CLI process itself.
 * @param workerRecords - Directory of `{ pid }` JSON files written by setupFiles.
 * @param runnerPid - Jest CLI PID.
 * @returns Nothing; throws when setup ran elsewhere or in more than one process.
 * @example assertSerialWorkerRecords(directory, 12345)
 */
function assertSerialWorkerRecords(workerRecords, runnerPid) {
  const pids = new Set(
    readWorkerRecords(workerRecords).map((worker) => worker.pid),
  )
  if (pids.size !== 1 || !pids.has(runnerPid)) {
    throw new Error(
      'Serial verification did not run setup only in the CLI process.',
    )
  }
}

/** True when a Vitest setupFile record also names its worker thread and VM context.
 * {@link assertVitestWorkerRecords} rejects records written by an outdated consumer setupFile.
 * @example if (!isVitestWorkerRecord(worker)) throw new Error('Invalid worker record')
 */
function isVitestWorkerRecord(worker) {
  return (
    Number.isInteger(worker.threadId) &&
    worker.threadId >= 0 &&
    typeof worker.vmContext === 'boolean'
  )
}

/** True when a record's process and thread match the pool: thread pools share the CLI process on a non-zero thread, process pools are child processes on their main thread.
 * {@link assertWorkerRecordMatchesPool} combines this with the VM context check.
 * @example ranInPoolProcess({ pid: 12345, threadId: 2, vmContext: false }, 12345, { workerThread: true }) // => true
 */
function ranInPoolProcess(worker, runnerPid, vitestMode) {
  return vitestMode.workerThread
    ? worker.threadId > 0 && worker.pid === runnerPid
    : worker.threadId === 0 && worker.pid !== runnerPid
}

/** Throws when one Vitest setupFile record is incomplete or ran outside the requested pool's execution context.
 * {@link assertVitestWorkerRecords} calls this for every record.
 * @example assertWorkerRecordMatchesPool({ pid: 23456, threadId: 0, vmContext: true }, 12345, vitestModes[4])
 */
function assertWorkerRecordMatchesPool(worker, runnerPid, vitestMode) {
  if (!isVitestWorkerRecord(worker)) {
    throw new Error(
      `Vitest ${vitestMode.mode} wrote an incomplete worker record.`,
    )
  }
  if (
    !ranInPoolProcess(worker, runnerPid, vitestMode) ||
    worker.vmContext !== vitestMode.vmContext
  ) {
    throw new Error(
      `Vitest ${vitestMode.mode} ran setup outside its pool context: ${JSON.stringify(worker)}`,
    )
  }
}

/** Confirms Vitest setup ran in the execution context the requested pool promises, not a silent forks fallback.
 * @param workerRecords - Directory of `{ pid, threadId, vmContext }` JSON files written by the consumer setupFile.
 * @param runnerPid - Vitest CLI PID; thread pools run inside it, process pools never do.
 * @param vitestMode - One {@link vitestModes} entry.
 * @returns Nothing; throws when a record contradicts the pool or fewer workers than the mode requires recorded setup.
 * @example assertVitestWorkerRecords(directory, 12345, { mode: 'threads', pool: 'threads', workers: 2, workerThread: true, vmContext: false })
 */
function assertVitestWorkerRecords(workerRecords, runnerPid, vitestMode) {
  const workers = readWorkerRecords(workerRecords)
  for (const worker of workers) {
    assertWorkerRecordMatchesPool(worker, runnerPid, vitestMode)
  }
  // Serial mode must record its one worker; a parallel mode that recorded fewer workers silently lost its concurrency.
  const workerIdentities = new Set(
    workers.map((worker) => `${worker.pid}-${worker.threadId}`),
  )
  if (workerIdentities.size < vitestMode.workers) {
    throw new Error(
      `Vitest ${vitestMode.mode} ran setup in ${workerIdentities.size} of the ${vitestMode.workers} required workers.`,
    )
  }
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
  const expectedTests = [...expectedSuites.values()].reduce(
    (total, count) => total + count,
    0,
  )
  if (
    !results.success ||
    results.numTotalTests !== expectedTests ||
    results.numPassedTests !== expectedTests
  ) {
    throw new Error(
      `${label} did not pass all ${expectedTests} consumer tests.`,
    )
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
 * Clears Vite's default cache, points `VITE_CACHE_DIR` at a per-run directory, and pipes stderr for warning checks.
 * @param consumer - Isolated consumer directory with Vitest installed.
 * @param argumentsList - Vitest CLI arguments.
 * @param environment - Child environment, including the worker record directory when the fixture writes records.
 * @param cacheLabel - Distinct suffix for this run's Vite cache directory.
 * @returns The CLI process PID and its stderr text.
 * @example runVitest(consumer, ['run'], process.env, 'threads') // => { pid: 12345, stderr: '' }
 */
function runVitest(consumer, argumentsList, environment, cacheLabel) {
  rmSync(path.join(consumer, 'node_modules/.vite'), {
    recursive: true,
    force: true,
  })
  const result = spawnChecked(
    process.execPath,
    [path.join(consumer, 'node_modules/vitest/vitest.mjs'), ...argumentsList],
    consumer,
    {
      ...environment,
      VITE_CACHE_DIR: path.join(consumer, `.vite-cache-${cacheLabel}`),
    },
    ['inherit', 'inherit', 'pipe'],
  )
  return { pid: result.pid, stderr: result.stderr }
}

/** Fails a Vitest run whose stderr mentions the deprecated entry, which Vitest 4.1 prints once per imported worker.
 * @param stderr - Captured Vitest stderr.
 * @param label - Failure prefix naming the Vitest version and pool.
 * @returns Nothing; throws when the legacy entry appears.
 * @example assertNoLegacyEntryWarning(stderr, 'Vitest 4.1.11 (threads)')
 */
function assertNoLegacyEntryWarning(stderr, label) {
  if (stderr.includes(LEGACY_VITEST_ENTRY)) {
    throw new Error(`${label} printed a ${LEGACY_VITEST_ENTRY} warning.`)
  }
}

/** Copies one fixture into an isolated directory and installs it from packed tarballs, never from workspace links.
 * @param fixture - Folder name under `fixtures/`.
 * @param label - Temp directory prefix naming the runner and version.
 * @param manifest - package.json written in place of the workspace manifest.
 * @returns Absolute path of the installed consumer.
 * @example const consumer = installFixture('consumer', 'happy-dom-extended-jest-30.0.0', manifest)
 */
function installFixture(fixture, label, manifest) {
  const consumer = createIsolatedDirectory(label)
  cpSync(path.join(root, 'fixtures', fixture), consumer, {
    recursive: true,
    // The consumer must install from the tarball, with no workspace node_modules links.
    filter: (source) => path.basename(source) !== 'node_modules',
  })
  writeFileSync(
    path.join(consumer, 'package.json'),
    JSON.stringify(manifest, null, 2),
  )
  installConsumer(consumer)
  return consumer
}

/** Builds the isolated manifest of a Vitest fixture: its own dependencies, one Vitest version and the packed environment.
 * @param fixture - Folder name under `fixtures/`.
 * @param vitestVersion - Exact Vitest version to install.
 * @param tarball - Packed vitest-environment-happy-dom-extended tarball.
 * @returns A private ESM package.json object.
 * @example vitestManifest('consumer-vitest-product', '5.0.1', tarball).devDependencies.vitest // => '5.0.1'
 */
function vitestManifest(fixture, vitestVersion, tarball) {
  const fixtureManifest = readJson(
    path.join(root, 'fixtures', fixture, 'package.json'),
  )
  return {
    name: `happy-dom-extended-${fixture}-verification`,
    private: true,
    type: 'module',
    // npm 12 requires explicit approval to install Skia's native binary.
    allowScripts: { 'skia-canvas': true },
    dependencies: fixtureManifest.dependencies ?? {},
    devDependencies: {
      ...fixtureManifest.devDependencies,
      vitest: vitestVersion,
      // Vitest 4.0.0's module runner does not implement Vite 7.2+'s `getBuiltins`.
      ...(vitestVersion === '4.0.0' ? { vite: '7.1.12' } : {}),
      'vitest-environment-happy-dom-extended': `file:${tarball}`,
    },
  }
}

/** Hides skia-canvas's native binary, as a blocked install script leaves it, and expects the runner to print the approval commands.
 * @param consumer - Installed consumer whose runner loads the environment.
 * @param argumentsList - Runner arguments after `process.execPath`, limited to one test file.
 * @param label - Failure prefix naming the runner and version.
 * @returns Nothing; throws when the run passes or omits the guidance. The binary is restored either way.
 * @example assertMissingSkiaGuidance(consumer, ['node_modules/jest/bin/jest.js', 'canvas.test.cjs'], 'Jest 30.5.1')
 */
function assertMissingSkiaGuidance(consumer, argumentsList, label) {
  const binary = path.join(consumer, 'node_modules/skia-canvas/lib/skia.node')
  const hiddenBinary = `${binary}.hidden`
  renameSync(binary, hiddenBinary)
  try {
    const result = spawn.sync(process.execPath, argumentsList, {
      cwd: resolveExistingPath(consumer),
      env: process.env,
      encoding: 'utf8',
      maxBuffer: CAPTURED_OUTPUT_MAX_BYTES,
    })
    if (result.error) throw result.error
    const output = `${result.stdout}${result.stderr}`
    const explainsFix = SKIA_GUIDANCE_LINES.every((line) =>
      output.includes(line),
    )
    if (result.status === 0 || !explainsFix) {
      process.stderr.write(output)
      throw new Error(
        `${label} did not explain the missing skia-canvas binary.`,
      )
    }
    // The failing run's output stays captured, so CI logs need an explicit line proving the check ran.
    console.log(
      `${label}: a missing skia-canvas binary prints the approval commands.`,
    )
  } finally {
    renameSync(hiddenBinary, binary)
  }
}

try {
  const jestTarball = packWorkspace(
    path.join(root, 'packages/jest-happy-dom-extended'),
  )
  const jestFixtureManifest = readJson(
    path.join(root, 'fixtures/consumer/package.json'),
  )
  // Exercise the advertised Jest floor and the current development version independently.
  for (const jestVersion of ['30.0.0', rootManifest.devDependencies.jest]) {
    const consumer = installFixture(
      'consumer',
      `happy-dom-extended-jest-${jestVersion}`,
      {
        name: 'happy-dom-extended-consumer-verification',
        private: true,
        // npm 12 requires explicit approval to install Skia's native binary.
        allowScripts: { 'skia-canvas': true },
        devDependencies: {
          ...jestFixtureManifest.devDependencies,
          jest: jestVersion,
          'jest-happy-dom-extended': `file:${jestTarball}`,
        },
      },
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
      if (mode === 'parallel') assertParallelWorkerRecords(workerRecords)
      else assertSerialWorkerRecords(workerRecords, runnerPid)
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
    // The guidance comes from shared code, so one Jest version proves the CommonJS bundle surfaces it.
    if (jestVersion === rootManifest.devDependencies.jest) {
      assertMissingSkiaGuidance(
        consumer,
        [
          'node_modules/jest/bin/jest.js',
          '--runInBand',
          '--no-cache',
          'canvas.test.cjs',
        ],
        `Jest ${jestVersion}`,
      )
    }
  }

  const vitestTarball = packWorkspace(
    path.join(root, 'packages/vitest-happy-dom-extended'),
  )
  // Floor (vitest/environments only), last Vitest 4 (both entries, legacy one warns), and the development Vitest 5.
  for (const vitestVersion of [
    '4.0.0',
    LATEST_VITEST_4,
    rootManifest.devDependencies.vitest,
  ]) {
    const consumer = installFixture(
      'consumer-vitest',
      `happy-dom-extended-vitest-${vitestVersion}`,
      vitestManifest('consumer-vitest', vitestVersion, vitestTarball),
    )
    run(process.execPath, ['esm.mjs'], consumer)
    run(
      process.execPath,
      ['--test', 'environment-lifecycle.test.mjs'],
      consumer,
    )
    for (const vitestMode of vitestModes) {
      const label = `Vitest ${vitestVersion} (${vitestMode.mode})`
      const testReport = path.join(
        consumer,
        `vitest-results-${vitestMode.mode}.json`,
      )
      const workerRecords = path.join(consumer, `workers-${vitestMode.mode}`)
      mkdirSync(workerRecords)
      const { pid: runnerPid, stderr } = runVitest(
        consumer,
        [
          'run',
          `--pool=${vitestMode.pool}`,
          ...(vitestMode.workers === 1
            ? ['--fileParallelism=false', '--maxWorkers=1']
            : [`--maxWorkers=${vitestMode.workers}`]),
          '--no-cache',
          // JSON-only reporter hid the Windows parallel crash after the serial report.
          '--reporter=verbose',
          '--reporter=json',
          `--outputFile=${testReport}`,
        ],
        { ...process.env, HAPPY_DOM_WORKER_RECORD_DIRECTORY: workerRecords },
        vitestMode.mode,
      )
      assertVitestWorkerRecords(workerRecords, runnerPid, vitestMode)
      assertNoLegacyEntryWarning(stderr, label)
      assertConsumerReport(
        readJson(testReport),
        new Map([
          ['package.test.mjs', 5],
          ['canvas.test.mjs', 3],
          ['offscreen.test.mjs', 2],
        ]),
        label,
      )
    }

    // A React product: TSX, an `@` alias, a named project, Testing Library and jest-dom in every pool.
    const product = installFixture(
      'consumer-vitest-product',
      `happy-dom-extended-vitest-product-${vitestVersion}`,
      vitestManifest('consumer-vitest-product', vitestVersion, vitestTarball),
    )
    for (const pool of vitestPools) {
      const label = `Vitest ${vitestVersion} product (${pool})`
      const testReport = path.join(product, `vitest-results-${pool}.json`)
      const { stderr } = runVitest(
        product,
        [
          'run',
          `--pool=${pool}`,
          '--no-cache',
          '--reporter=verbose',
          '--reporter=json',
          `--outputFile=${testReport}`,
        ],
        process.env,
        pool,
      )
      assertNoLegacyEntryWarning(stderr, label)
      assertConsumerReport(
        readJson(testReport),
        new Map([
          ['SalesChart.test.tsx', 2],
          ['AvatarUploader.test.tsx', 1],
          ['SearchBox.test.tsx', 2],
          ['AccountMenu.test.tsx', 2],
        ]),
        label,
      )
    }
    // The guidance comes from shared code, so the development Vitest proves the ESM bundle surfaces it.
    if (vitestVersion === rootManifest.devDependencies.vitest) {
      assertMissingSkiaGuidance(
        product,
        [
          path.join(product, 'node_modules/vitest/vitest.mjs'),
          'run',
          '--no-cache',
          'src/components/SalesChart.test.tsx',
        ],
        `Vitest ${vitestVersion} product`,
      )
    }
  }
} finally {
  for (const directory of isolatedDirectories) {
    rmSync(directory, { recursive: true, force: true })
  }
}
