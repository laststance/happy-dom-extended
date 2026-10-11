import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { after, test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

import {
  capture,
  exitCodeFor,
  formatProblem,
  formatSummary,
  measureCpu,
  outputDirectoryName,
  parseCpuTime,
  parseLsofListeners,
  parseNetstatListeners,
  parseProcStat,
  parsePsTable,
  parseWindowsProcesses,
  resolveScope,
  scrubHome,
  summarizeProfile,
} from '../capture-hang.mjs'

const script = fileURLToPath(new URL('../capture-hang.mjs', import.meta.url))
const scratch = mkdtempSync(path.join(tmpdir(), 'capture-hang-test-'))
const children = new Set()

// Short profiles and no macOS `sample` keep each live case to a few seconds.
const fast = {
  profileMs: 1000,
  stepMs: 3000,
  sampleSeconds: 0,
  cpuWindowMs: 300,
  timeoutSeconds: 40,
}

/** A main thread that never returns to its event loop but leaves a trace of progress. */
const spinMain = `
const { appendFileSync } = require('node:fs')
function spinForever() {
  let last = 0
  while (true) {
    const now = Date.now()
    if (now - last > 20) { appendFileSync(process.argv[1], '.'); last = now }
  }
}
setTimeout(spinForever, 50)
`
const idleMain = `setInterval(() => {}, 1000)`
/** A worker thread that spins while the main thread keeps answering. */
const spinWorker = `
const { Worker } = require('node:worker_threads')
new Worker('function spinInWorker() { while (true) {} } setTimeout(spinInWorker, 50)', { eval: true })
setInterval(() => {}, 1000)
`

after(() => {
  // A failed assertion must not leave a spinning child behind.
  for (const child of children) child.kill('SIGKILL')
  rmSync(scratch, { recursive: true, force: true })
})

/** Reserves a TCP port nothing listens on, so each live case has its own inspector port.
 * @returns A free port on 127.0.0.1.
 * @example const port = await freePort()
 */
async function freePort() {
  const server = createServer().listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address()
  server.close()
  await once(server, 'close')
  return port
}

/** Starts a Node child whose inspector, once requested, opens on its own port.
 * @param code - CommonJS source for `node -e`.
 * @param name - Names the child's progress file and the capture directory.
 * @returns The child, its inspector port, its progress file and a fresh output path.
 * @example const target = await startTarget(spinMain, 'spin')
 */
async function startTarget(code, name) {
  const port = await freePort()
  const progress = path.join(scratch, `${name}.progress`)
  writeFileSync(progress, '')
  const child = spawn(
    process.execPath,
    [`--inspect-port=${port}`, '-e', code, progress],
    { stdio: 'ignore' },
  )
  children.add(child)
  await once(child, 'spawn')
  // Let the timer that starts the spin fire before the capture measures CPU.
  await sleep(400)
  return { child, port, progress, out: path.join(scratch, `${name}-out`) }
}

/** Measures whether a child still appends to its progress file.
 * @returns Bytes appended during 300 ms.
 * @example assert.ok((await progressDuring(target.progress)) > 0)
 */
async function progressDuring(file) {
  const before = statSync(file).size
  await sleep(300)
  return statSync(file).size - before
}

test('CPU time columns of macOS and Linux ps convert to seconds', () => {
  // Arrange
  const macos = '1:02.50'
  const linux = '01:02:03'
  const linuxWithDays = '1-00:00:01'

  // Act
  const seconds = [macos, linux, linuxWithDays].map(parseCpuTime)

  // Assert
  assert.deepEqual(seconds, [62.5, 3723, 86401])
})

test('ps output becomes rows even when the executable path contains spaces', () => {
  // Arrange
  const table = [
    '  101     1   0:01.50 /usr/local/bin/node',
    '  202   101   0:00.25 /Applications/Some App.app/Contents/MacOS/Some App',
    '  303   101   2:00.00 node (vitest 1)',
  ].join('\n')
  const commands = [
    '  101 node /repo/node_modules/vitest/vitest.mjs run',
    '  202 /Applications/Some App.app/Contents/MacOS/Some App --flag',
  ].join('\n')

  // Act
  const rows = parsePsTable(table, commands)

  // Assert
  assert.deepEqual(rows, [
    {
      pid: 101,
      ppid: 1,
      cpuSeconds: 1.5,
      name: 'node',
      command: 'node /repo/node_modules/vitest/vitest.mjs run',
    },
    {
      pid: 202,
      ppid: 101,
      cpuSeconds: 0.25,
      name: 'Some App',
      command: '/Applications/Some App.app/Contents/MacOS/Some App --flag',
    },
    {
      pid: 303,
      ppid: 101,
      cpuSeconds: 120,
      name: 'node (vitest 1)',
      command: 'node (vitest 1)',
    },
  ])
})

test('a Linux process whose title contains parentheses keeps its parent and CPU time', () => {
  // Arrange
  const stat =
    '303 (node (vitest 1)) R 101 303 303 0 -1 4194304 10 0 0 0 150 50 0 0 20 0 11 0 100 0 0'

  // Act
  const row = parseProcStat(stat)

  // Assert
  assert.deepEqual(row, { name: 'node (vitest 1)', ppid: 101, cpuSeconds: 2 })
})

test('Windows process JSON becomes rows, also when PowerShell prints a single object', () => {
  // Arrange
  const json = JSON.stringify({
    ProcessId: 7,
    ParentProcessId: 1,
    Name: 'node.exe',
    CommandLine: 'node vitest.mjs run',
    KernelModeTime: 5_000_000,
    UserModeTime: 15_000_000,
  })

  // Act
  const rows = parseWindowsProcesses(json)

  // Assert
  assert.deepEqual(rows, [
    {
      pid: 7,
      ppid: 1,
      cpuSeconds: 2,
      name: 'node.exe',
      command: 'node vitest.mjs run',
    },
  ])
})

test('the process list ranks by CPU used during the window, not over the lifetime', () => {
  // Arrange
  const before = [
    { pid: 1, cpuSeconds: 500 },
    { pid: 2, cpuSeconds: 1 },
  ]
  const after = [
    { pid: 1, cpuSeconds: 500.1 },
    { pid: 2, cpuSeconds: 3 },
    { pid: 3, cpuSeconds: 9 },
  ]

  // Act
  const rows = measureCpu(before, after, 2)

  // Assert
  assert.deepEqual(
    rows.map((row) => [row.pid, row.cpuPercent]),
    [
      [2, 100],
      [1, 5],
      [3, 0],
    ],
  )
})

test('a capture never reaches the parent or a sibling of the named process', () => {
  // Arrange
  const rows = [
    { pid: 10, ppid: 1, name: 'node' }, // parent: a dev tool that started the runner
    { pid: 20, ppid: 10, name: 'node' }, // the runner the user named
    { pid: 21, ppid: 10, name: 'node' }, // sibling: an unrelated dev server
    { pid: 30, ppid: 20, name: 'node' }, // worker
    { pid: 31, ppid: 20, name: 'sh' }, // shell started by the runner
    { pid: 40, ppid: 31, name: 'node' }, // Node process under that shell
    { pid: 41, ppid: 31, name: 'esbuild' },
  ]
  const isNode = (row) => row.name === 'node'

  // Act
  const scope = resolveScope(rows, 20, isNode)

  // Assert
  assert.deepEqual(
    scope.map((row) => row.pid),
    [20, 30, 40],
  )
})

test('lsof field output maps every listening port to its process', () => {
  // Arrange
  const output = [
    'p101',
    'f21',
    'n127.0.0.1:9229',
    'f22',
    'n*:5173',
    'p202',
    'f9',
    'n[::1]:3000',
    '',
  ].join('\n')

  // Act
  const listeners = parseLsofListeners(output)

  // Assert
  assert.deepEqual(listeners, [
    { pid: 101, port: 9229 },
    { pid: 101, port: 5173 },
    { pid: 202, port: 3000 },
  ])
})

test('netstat output maps listening ports to processes and ignores connections', () => {
  // Arrange
  const output = [
    'Active Connections',
    '',
    '  Proto  Local Address          Foreign Address        State           PID',
    '  TCP    127.0.0.1:9229         0.0.0.0:0              LISTENING       4321',
    '  TCP    127.0.0.1:50123        127.0.0.1:9229         ESTABLISHED     999',
    '  TCP    [::]:445               [::]:0                 LISTENING       4',
  ].join('\r\n')

  // Act
  const listeners = parseNetstatListeners(output)

  // Assert
  assert.deepEqual(listeners, [
    { pid: 4321, port: 9229 },
    { pid: 4, port: 445 },
  ])
})

test('pasted evidence shows ~ instead of the home directory', () => {
  // Arrange
  const text =
    'spin (file:///Users/ada/app/a.test.ts:3:5)\n/Users/ada/app/out/summary.txt'

  // Act
  const scrubbed = scrubHome(text, '/Users/ada')

  // Assert
  assert.equal(
    scrubbed,
    'spin (file://~/app/a.test.ts:3:5)\n~/app/out/summary.txt',
  )
})

test('two captures of one process a millisecond apart get different directories', () => {
  // Arrange
  const first = new Date('2026-10-11T09:30:00.123Z')
  const second = new Date('2026-10-11T09:30:00.124Z')

  // Act
  const names = [first, second].map((date) => outputDirectoryName(7, date))

  // Assert
  assert.deepEqual(names, [
    'hang-capture-7-20261011T093000123Z',
    'hang-capture-7-20261011T093000124Z',
  ])
})

test('a CPU profile is reduced to the busy share and the functions that used it', () => {
  // Arrange
  const frame = (functionName, url = '', lineNumber = -1) => ({
    functionName,
    url,
    lineNumber,
  })
  const profile = {
    nodes: [
      { callFrame: frame('(root)'), hitCount: 0 },
      { callFrame: frame('(idle)'), hitCount: 10 },
      { callFrame: frame('spin', 'file:///app/a.test.ts', 2), hitCount: 80 },
      { callFrame: frame('spin', 'file:///app/a.test.ts', 2), hitCount: 5 },
      { callFrame: frame('(garbage collector)'), hitCount: 5 },
    ],
  }

  // Act
  const usage = summarizeProfile(profile)

  // Assert
  assert.deepEqual(usage, {
    busyPercent: 90,
    top: [
      { name: 'spin (file:///app/a.test.ts:3)', percent: 85 },
      { name: '(garbage collector)', percent: 5 },
    ],
  })
})

test('a thread whose profile never arrived is reported as not busy with no functions', () => {
  // Arrange
  const missing = undefined

  // Act
  const usage = summarizeProfile(missing)

  // Assert
  assert.deepEqual(usage, { busyPercent: 0, top: [] })
})

test('the summary lists each process and thread without the home directory', () => {
  // Arrange
  const result = {
    startedAt: '2026-10-11T09:30:00.123Z',
    target: 100,
    platform: 'darwin arm64',
    notes: ['Capture ended early: the time limit.'],
    processes: [
      {
        pid: 101,
        cpu: 99,
        command: 'node (vitest 1)',
        port: 9229,
        sample: '101.sample.txt',
        threads: [
          {
            label: 'main',
            state: 'busy',
            busyPercent: 100,
            version: 'v24.20.0',
            stack: [
              'spin (file:///Users/ada/app/a.test.ts:3:5)',
              'listOnTimeout (node:internal/timers:685:17)',
            ],
            resumed: true,
            top: [
              { name: 'spin (file:///Users/ada/app/a.test.ts:3)', percent: 99 },
            ],
            resources: ['Timeout', 'Timeout', 'TCPSocketWrap'],
          },
          {
            label: '[worker 1] WorkerThread',
            state: 'idle',
            busyPercent: 0,
            top: [],
            resources: [],
          },
          { label: '[worker 2] WorkerThread', state: 'no answer' },
        ],
      },
      {
        pid: 100,
        cpu: 0,
        command: 'node /Users/ada/app/node_modules/vitest/vitest.mjs run',
        unavailable: 'port 9229 is in use by pid 101',
      },
    ],
  }

  // Act
  const summary = formatSummary(result, '/Users/ada')

  // Assert
  assert.equal(
    summary,
    `hang capture 2026-10-11T09:30:00.123Z
target pid 100, 2 Node process(es) in scope, darwin arm64

pid 101 (cpu 99%): node (vitest 1)
  inspector: 127.0.0.1:9229, Node v24.20.0
  thread main: busy, running code 100% of the profile
    paused stack:
      spin (file://~/app/a.test.ts:3:5)
      listOnTimeout (node:internal/timers:685:17)
    cpu profile, top functions:
      99% spin (file://~/app/a.test.ts:3)
    active resources: Timeout x2, TCPSocketWrap x1
  thread [worker 1] WorkerThread: idle, running code 0% of the profile
    active resources: none
  thread [worker 2] WorkerThread: no answer from the inspector (it may be inside native code, or the process ended)
  native sample: 101.sample.txt

pid 100 (cpu 0%): node ~/app/node_modules/vitest/vitest.mjs run
  inspector unavailable: port 9229 is in use by pid 101

Capture ended early: the time limit.
`,
  )
})

test('the exit code tells complete, partial and failed captures apart', () => {
  // Arrange
  const busy = { state: 'busy', stack: ['spin (a.mjs:1:1)'], resumed: true }
  const idle = { state: 'idle' }
  const complete = [{ pid: 1, port: 9229, threads: [busy, idle] }]
  const oneProcessMissing = [
    ...complete,
    { pid: 2, unavailable: 'port 9229 is in use by pid 1' },
  ]
  const silentThread = [
    { pid: 1, port: 9229, threads: [{ state: 'no answer' }] },
  ]
  const nothing = [{ pid: 2, unavailable: 'port 9229 is in use by pid 9' }]
  const leftPaused = [
    { pid: 1, port: 9229, threads: [{ ...busy, resumed: false }] },
  ]

  // Act
  const codes = [
    complete,
    oneProcessMissing,
    silentThread,
    nothing,
    leftPaused,
  ].map(exitCodeFor)

  // Assert
  assert.deepEqual(codes, [0, 2, 2, 1, 1])
})

test('every failure message says what failed, why, what to do and where the recipe is', () => {
  // Arrange
  const problem = {
    what: 'pid 7 is not a Node process: sleep 30',
    why: 'Only Node processes have the inspector.',
    next: 'Pass the pid of the test runner.',
  }

  // Act
  const message = formatProblem(problem)

  // Assert
  assert.equal(
    message,
    `pid 7 is not a Node process: sleep 30
Why: Only Node processes have the inspector.
Next: Pass the pid of the test runner.
Recipe: https://github.com/laststance/happy-dom-extended/blob/main/TESTING.md#capture-a-hang`,
  )
})

test('a spinning main thread is captured with its stack and keeps running afterwards', async () => {
  // Arrange
  const target = await startTarget(spinMain, 'spin-main')

  // Act
  const outcome = await capture(target.child.pid, {
    ...fast,
    port: target.port,
    out: target.out,
  })
  const appended = await progressDuring(target.progress)

  // Assert
  assert.equal(outcome.exitCode, 0)
  assert.match(outcome.summary, /thread main: busy/)
  assert.match(outcome.summary, /paused stack:\n\s+spinForever \(/)
  assert.ok(
    appended > 0,
    'the target stopped making progress after the capture',
  )
  assert.equal(target.child.exitCode, null)
  assert.equal(
    readFileSync(path.join(target.out, 'summary.txt'), 'utf8'),
    outcome.summary,
  )
})

test('a process that is only waiting is reported as idle and is not paused', async () => {
  // Arrange
  const target = await startTarget(idleMain, 'idle-main')

  // Act
  const outcome = await capture(target.child.pid, {
    ...fast,
    port: target.port,
    out: target.out,
  })

  // Assert
  assert.equal(outcome.exitCode, 0)
  assert.match(outcome.summary, /thread main: idle/)
  assert.doesNotMatch(outcome.summary, /paused stack/)
})

test('a spinning worker thread is captured while the main thread stays responsive', async () => {
  // Arrange
  const target = await startTarget(spinWorker, 'spin-worker')

  // Act
  const outcome = await capture(target.child.pid, {
    ...fast,
    port: target.port,
    out: target.out,
  })

  // Assert
  assert.equal(outcome.exitCode, 0)
  assert.match(outcome.summary, /thread main: idle/)
  assert.match(outcome.summary, /WorkerThread: busy/)
  assert.match(outcome.summary, /paused stack:\n\s+spinInWorker \(/)
})

test('an inspector port held by another program is reported and nothing is claimed', async () => {
  // Arrange
  const holder = createServer().listen(0, '127.0.0.1')
  await once(holder, 'listening')
  const { port } = holder.address()
  const progress = path.join(scratch, 'held.progress')
  const child = spawn(
    process.execPath,
    [`--inspect-port=${port}`, '-e', idleMain, progress],
    { stdio: 'ignore' },
  )
  children.add(child)
  await once(child, 'spawn')
  await sleep(400)
  const out = path.join(scratch, 'held-out')

  // Act
  const outcome = await capture(child.pid, { ...fast, port, out })
  holder.close()

  // Assert
  assert.equal(outcome.exitCode, 1)
  assert.match(outcome.summary, /inspector unavailable: .*port \d+/)
  assert.doesNotMatch(outcome.summary, /thread main/)
  assert.match(
    outcome.messages[0],
    new RegExp(`^pid ${child.pid} was not captured: `),
  )
  assert.match(
    outcome.messages[0],
    /\nRecipe: https:\/\/github\.com\/laststance\/happy-dom-extended\/blob\/main\/TESTING\.md#capture-a-hang$/,
  )
})

test('a pid that is not a Node process is refused before anything is signalled', async () => {
  // Arrange
  const [command, args] =
    process.platform === 'win32'
      ? ['ping', ['-n', '30', '127.0.0.1']]
      : ['sleep', ['30']]
  const child = spawn(command, args, { stdio: 'ignore' })
  children.add(child)
  await once(child, 'spawn')
  const out = path.join(scratch, 'not-node-out')

  // Act
  const outcome = await capture(child.pid, { ...fast, out })

  // Assert
  assert.equal(outcome.exitCode, 1)
  assert.match(
    outcome.messages[0],
    new RegExp(`^pid ${child.pid} is not a Node process: `),
  )
  assert.match(
    outcome.messages[0],
    /\nNext: Run `node capture-hang\.mjs --list` and pass the pid of the test runner\.\n/,
  )
  assert.equal(existsSync(out), false)
  assert.equal(child.exitCode, null)
})

test('a run that ends during the capture produces a report instead of a crash', async () => {
  // Arrange
  const target = await startTarget(spinMain, 'vanishing')
  const killer = setTimeout(() => target.child.kill('SIGKILL'), 1300)

  // Act
  const outcome = await capture(target.child.pid, {
    ...fast,
    port: target.port,
    out: target.out,
  })
  clearTimeout(killer)

  // Assert
  assert.ok(
    [1, 2].includes(outcome.exitCode),
    `exit code ${outcome.exitCode} claims a complete capture of a process that ended`,
  )
  assert.match(outcome.messages.join('\n'), /pid \d+/)
})

// Windows cannot deliver SIGINT to another process; there the signal ends the script outright.
test(
  'interrupting the script during a capture leaves the stuck run running',
  { skip: process.platform === 'win32' },
  async () => {
    // Arrange
    const target = await startTarget(spinMain, 'interrupted')
    const cli = spawn(
      process.execPath,
      [
        script,
        String(target.child.pid),
        '--port',
        String(target.port),
        '--out',
        target.out,
      ],
      { stdio: 'ignore' },
    )
    children.add(cli)

    // Act
    await sleep(4000)
    cli.kill('SIGINT')
    const [exitCode] = await once(cli, 'exit')
    const appended = await progressDuring(target.progress)

    // Assert
    assert.equal(exitCode, 1)
    assert.match(
      readFileSync(path.join(target.out, 'summary.txt'), 'utf8'),
      /Capture ended early: it was interrupted\./,
    )
    assert.ok(
      appended > 0,
      'the target stopped making progress after the interrupt',
    )
    assert.equal(target.child.exitCode, null)
  },
)
