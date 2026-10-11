/** Captures what a stuck Node test run is doing, without stopping it.
 *
 * Given the pid of a test runner (or of one of its child processes), it opens
 * the Node inspector on that process and on its Node child processes, records
 * a CPU profile for every thread, pauses each busy thread long enough to read
 * its JavaScript stack, resumes it, and writes `summary.txt` for a bug report.
 * It never chooses a process itself and never kills one.
 *
 * Standalone on purpose: it imports only `node:` built-ins so a user can
 * download this one file and run it. TESTING.md ("Capture a hang") and the
 * Troubleshooting sections of both package READMEs link to this path; do not
 * move or rename the file without updating them.
 *
 * @example node capture-hang.mjs --list        // Node processes, busiest first
 * @example node capture-hang.mjs 12345         // capture pid 12345 and its Node children
 * @example node capture-hang.mjs 12345 --out ./evidence --timeout 60
 */
import { execFile, spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseArgs, promisify } from 'node:util'

const run = promisify(execFile)

/** Where every failure message sends the reader. */
const RECIPE_URL =
  'https://github.com/laststance/happy-dom-extended/blob/main/TESTING.md#capture-a-hang'

const DEFAULT_INSPECTOR_PORT = 9229
const defaults = Object.freeze({
  timeoutSeconds: 120,
  profileMs: 5000,
  stepMs: 5000,
  sampleSeconds: 10,
  cpuWindowMs: 2000,
})
/** A thread that spent at least this share of the profile running code is paused for its stack. */
const BUSY_PERCENT = 50
/** No new process is opened this close to the overall timeout, so every pause can be undone. */
const RESERVE_MS = 15_000
const LARGE_OUTPUT = { maxBuffer: 64 * 1024 * 1024 }
const THREAD_INFO = `(() => {
  const info = { pid: process.pid, version: process.version, resources: process.getActiveResourcesInfo() }
  try { info.libuv = process.report.getReport().libuv } catch {}
  return JSON.stringify(info)
})()`

/**
 * Formats a failure the way every message of this script is formatted: what
 * failed with the actual values, why, what to do next, and the recipe.
 *
 * @param problem - `what`, `why` and `next`, each one sentence.
 * @returns Four lines.
 * @example formatProblem({ what: 'pid 1 is not a Node process', why: '...', next: '...' })
 */
export function formatProblem({ what, why, next }) {
  return [what, `Why: ${why}`, `Next: ${next}`, `Recipe: ${RECIPE_URL}`].join(
    '\n',
  )
}

/**
 * Converts the CPU time column of `ps` to seconds.
 *
 * @param text - `MM:SS.ss` (macOS), `HH:MM:SS` or `D-HH:MM:SS` (Linux).
 * @returns Seconds of CPU time.
 * @example parseCpuTime('1:02.50') === 62.5
 */
export function parseCpuTime(text) {
  const [clock, days] = text.trim().split('-').reverse()
  const seconds = clock
    .split(':')
    .reduce((total, part) => total * 60 + Number(part), 0)
  return seconds + Number(days ?? 0) * 86_400
}

/** Reads one `pid command line` row of `ps -Ao pid=,args=` as a Map entry. */
function parsePsCommand(line) {
  const match = /^\s*(\d+)\s+(.*)$/.exec(line)
  return match ? [Number(match[1]), match[2]] : null
}

/** Reads one row of `ps -Ao pid=,ppid=,time=,comm=`; the executable comes last and may contain spaces. */
function parsePsRow(line, commandOf) {
  const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line)
  if (!match) return null
  const pid = Number(match[1])
  const executable = match[4].trim()
  return {
    pid,
    ppid: Number(match[2]),
    cpuSeconds: parseCpuTime(match[3]),
    name: path.basename(executable),
    command: commandOf.get(pid) ?? executable,
  }
}

/**
 * Parses `ps -Ao pid=,ppid=,time=,comm=` joined with `ps -Ao pid=,args=`.
 *
 * @param table - Output with the executable name last (it may contain spaces).
 * @param commands - Output of the second call, for the full command lines.
 * @returns One row per process.
 * @example parsePsTable('  7  1  0:00.10 /usr/bin/node', '  7 node a.mjs')
 */
export function parsePsTable(table, commands) {
  const commandOf = new Map(
    commands.split('\n').map(parsePsCommand).filter(Boolean),
  )
  return table
    .split('\n')
    .map((line) => parsePsRow(line, commandOf))
    .filter(Boolean)
}

/**
 * Parses one `/proc/<pid>/stat` file.
 *
 * @param text - The file's content; the name sits in parentheses and may contain spaces.
 * @returns Name, parent pid and CPU seconds (user plus system, 100 ticks a second).
 * @example parseProcStat('7 (node) S 1 7 7 0 -1 0 0 0 0 0 150 50 0').cpuSeconds === 2
 */
export function parseProcStat(text) {
  const close = text.lastIndexOf(')')
  const fields = text.slice(close + 2).split(' ')
  return {
    name: text.slice(text.indexOf('(') + 1, close),
    ppid: Number(fields[1]),
    cpuSeconds: (Number(fields[11]) + Number(fields[12])) / 100,
  }
}

/**
 * Parses the JSON PowerShell prints for `Win32_Process`.
 *
 * @param json - `ConvertTo-Json` output; times are in 100 ns units.
 * @returns One row per process.
 * @example parseWindowsProcesses('[{"ProcessId":7,"ParentProcessId":1,"Name":"node.exe","CommandLine":"node a.mjs","KernelModeTime":0,"UserModeTime":10000000}]')
 */
export function parseWindowsProcesses(json) {
  return [JSON.parse(json)].flat().map((entry) => ({
    pid: entry.ProcessId,
    ppid: entry.ParentProcessId,
    cpuSeconds:
      (Number(entry.KernelModeTime) + Number(entry.UserModeTime)) / 1e7,
    name: entry.Name ?? '',
    command: entry.CommandLine ?? entry.Name ?? '',
  }))
}

/** Reads one `/proc/<pid>` entry; `null` when the process ended between the listing and the read. */
function readProcEntry(entry) {
  try {
    const stat = parseProcStat(readFileSync(`/proc/${entry}/stat`, 'utf8'))
    const command = readFileSync(`/proc/${entry}/cmdline`, 'utf8')
      .split('\0')
      .join(' ')
      .trim()
    return { pid: Number(entry), ...stat, command: command || stat.name }
  } catch {
    return null
  }
}

/** Asks PowerShell for the Windows process table. */
async function readWindowsTable() {
  const { stdout } = await run(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine,KernelModeTime,UserModeTime | ConvertTo-Json -Compress',
    ],
    LARGE_OUTPUT,
  )
  return parseWindowsProcesses(stdout)
}

/**
 * Lists the machine's processes with their accumulated CPU time.
 *
 * @param platform - `process.platform`; decides which source is read.
 * @returns One row per process: `pid`, `ppid`, `cpuSeconds`, `name`, `command`.
 * @throws When the platform's process listing tool is missing.
 * @example const rows = await readProcessTable()
 */
async function readProcessTable(platform = process.platform) {
  if (platform === 'win32') return readWindowsTable()
  if (platform === 'linux') {
    return readdirSync('/proc')
      .filter((entry) => /^\d+$/.test(entry))
      .map(readProcEntry)
      .filter(Boolean)
  }
  const [table, commands] = await Promise.all([
    run('ps', ['-Ao', 'pid=,ppid=,time=,comm=']),
    run('ps', ['-Ao', 'pid=,args='], LARGE_OUTPUT),
  ])
  return parsePsTable(table.stdout, commands.stdout)
}

/**
 * Tells whether a process row is a Node process.
 *
 * @param row - A row of {@link readProcessTable}.
 * @returns True for `node`, `node.exe` and titles Node sets such as `node (vitest 1)`.
 * @example isNodeProcess({ pid: 7, name: 'node' }) === true
 */
function isNodeProcess(row) {
  if (/^node(\.exe)?( |$)/i.test(row.name)) return true
  // A process that changed its title keeps its executable; Linux exposes it.
  try {
    return path.basename(readlinkSync(`/proc/${row.pid}/exe`)) === 'node'
  } catch {
    return false
  }
}

/**
 * Turns two readings of the process table into CPU use over the time between them.
 *
 * @param before - First reading.
 * @param after - Second reading.
 * @param seconds - Time between the readings.
 * @returns The rows of `after` with `cpuPercent`, busiest first.
 * @example measureCpu([{ pid: 7, cpuSeconds: 1 }], [{ pid: 7, cpuSeconds: 3 }], 2)[0].cpuPercent === 100
 */
export function measureCpu(before, after, seconds) {
  const earlier = new Map(before.map((row) => [row.pid, row.cpuSeconds]))
  return after
    .map((row) => ({
      ...row,
      cpuPercent: Math.round(
        ((row.cpuSeconds - (earlier.get(row.pid) ?? row.cpuSeconds)) /
          seconds) *
          100,
      ),
    }))
    .sort((a, b) => b.cpuPercent - a.cpuPercent)
}

/** Adds the children of every process already in the tree; true when one was added. */
function growTree(rows, inTree) {
  let grew = false
  for (const row of rows) {
    if (inTree.has(row.ppid) && !inTree.has(row.pid)) {
      inTree.add(row.pid)
      grew = true
    }
  }
  return grew
}

/**
 * Selects what a capture may touch: the given process and its Node descendants.
 * Ancestors and siblings are never included.
 *
 * @param rows - Process rows.
 * @param pid - The process the user named.
 * @param isNode - Predicate for Node processes; replaceable in tests.
 * @returns The Node rows in scope, in the order of `rows`.
 * @example resolveScope(rows, 100).map((row) => row.pid)
 */
export function resolveScope(rows, pid, isNode = isNodeProcess) {
  const inTree = new Set([pid])
  // Parents can come after their children in the table, so repeat until nothing is added.
  while (growTree(rows, inTree));
  return rows.filter((row) => inTree.has(row.pid) && isNode(row))
}

/** Reads the port from one `n<address>:<port>` line of lsof field output. */
function listenerPort(line) {
  const match = /^n.*:(\d+)$/.exec(line)
  return match ? Number(match[1]) : null
}

/**
 * Parses `lsof -Pn -iTCP -sTCP:LISTEN -Fpn`.
 *
 * @param text - Field output: a `p<pid>` line followed by that process's `n<address>` lines.
 * @returns One `{ pid, port }` per listening socket.
 * @example parseLsofListeners('p7\nf12\nn127.0.0.1:9229\n')
 */
export function parseLsofListeners(text) {
  return text
    .split(/^p/m)
    .slice(1)
    .flatMap((block) => {
      const [pid, ...lines] = block.split('\n')
      return lines
        .map(listenerPort)
        .filter(Boolean)
        .map((port) => ({ pid: Number(pid), port }))
    })
}

/**
 * Parses `netstat -ano -p TCP` on Windows.
 *
 * @param text - Lines such as `TCP  127.0.0.1:9229  0.0.0.0:0  LISTENING  7`.
 * @returns One `{ pid, port }` per listening socket.
 * @example parseNetstatListeners('  TCP    127.0.0.1:9229    0.0.0.0:0    LISTENING    7')
 */
export function parseNetstatListeners(text) {
  const listeners = []
  for (const line of text.split('\n')) {
    const match = /^\s*TCP\s+\S*:(\d+)\s+\S+\s+LISTENING\s+(\d+)/.exec(line)
    if (match) listeners.push({ pid: Number(match[2]), port: Number(match[1]) })
  }
  return listeners
}

/** Runs the platform's socket listing tool. */
async function runListenerTool(platform) {
  if (platform === 'win32') {
    const { stdout } = await run('netstat', ['-ano', '-p', 'TCP'])
    return parseNetstatListeners(stdout)
  }
  const { stdout } = await run('lsof', ['-Pn', '-iTCP', '-sTCP:LISTEN', '-Fpn'])
  return parseLsofListeners(stdout)
}

/** lsof exits 1 when no socket matches: that is an empty table, while anything else means no tool. */
function tableFromFailure(error) {
  return error.code === 1 && typeof error.stdout === 'string'
    ? parseLsofListeners(error.stdout)
    : null
}

/**
 * Reads which process listens on which TCP port.
 *
 * @param platform - `process.platform`.
 * @returns The listeners, or `null` when the platform's tool is missing.
 * @example const listeners = await readListeners()
 */
async function readListeners(platform = process.platform) {
  try {
    return await runListenerTool(platform)
  } catch (error) {
    return tableFromFailure(error)
  }
}

/**
 * Replaces the home directory in text that will be pasted into a report.
 *
 * @param text - Any output of the capture.
 * @param home - The home directory to hide.
 * @returns The text with `~` in its place.
 * @example scrubHome('/Users/ada/app/a.test.ts', '/Users/ada') === '~/app/a.test.ts'
 */
export function scrubHome(text, home = homedir()) {
  if (!home || home === path.parse(home).root) return text
  return text
    .split(home)
    .join('~')
    .split(home.split(path.sep).join('/'))
    .join('~')
}

/**
 * Names the directory one capture writes to.
 *
 * @param pid - The captured process.
 * @param date - Capture time; milliseconds keep two captures apart.
 * @returns A name such as `hang-capture-7-20261011T093000123Z`.
 * @example outputDirectoryName(7, new Date(0)) === 'hang-capture-7-19700101T000000000Z'
 */
export function outputDirectoryName(pid, date) {
  return `hang-capture-${pid}-${date.toISOString().replace(/[-:.]/g, '')}`
}

/** Names a profile node as `function (file:line)`. */
function frameName({ functionName, url, lineNumber }) {
  const where = url ? ` (${url}:${lineNumber + 1})` : ''
  return `${functionName || '(anonymous)'}${where}`
}

/** Adds up the samples per function; `(idle)` is always present so its share can be read. */
function tallyHits(nodes) {
  const hits = new Map([['(idle)', 0]])
  for (const node of nodes) {
    const name = frameName(node.callFrame)
    hits.set(name, (hits.get(name) ?? 0) + (node.hitCount ?? 0))
  }
  return hits
}

/**
 * Reduces a CPU profile to how busy the thread was and where.
 *
 * @param profile - The `profile` object of `Profiler.stop`, or nothing when it did not arrive.
 * @returns `busyPercent` and the five functions with the most samples.
 * @example summarizeProfile(profile).busyPercent >= 50
 */
export function summarizeProfile(profile) {
  const hits = tallyHits(profile?.nodes ?? [])
  const total = [...hits.values()].reduce((sum, count) => sum + count, 0)
  if (total === 0) return { busyPercent: 0, top: [] }
  const idle = hits.get('(idle)')
  hits.delete('(idle)')
  const top = [...hits]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({
      name,
      percent: Math.round((count / total) * 100),
    }))
    .filter((entry) => entry.percent > 0)
  return { busyPercent: Math.round(((total - idle) / total) * 100), top }
}

/** One inspector protocol channel: the main thread's socket, or a worker thread reached through it. */
class Session {
  #nextId = 0
  #pending = new Map()
  #listeners = new Set()
  #children = new Set()
  #closed = false
  #post

  constructor(post) {
    this.#post = post
  }

  /** Opens a session whose messages travel through this one; it closes when this one does. */
  child(post) {
    const session = new Session(post)
    this.#children.add(session)
    return session
  }

  /** Ends the session: commands still waiting, and later ones, resolve with `null` at once. */
  close() {
    this.#closed = true
    for (const settle of this.#pending.values()) settle(null)
    this.#pending.clear()
    for (const session of this.#children) session.close()
  }

  /** Sends a command; resolves with the reply, or `null` when none came in time. */
  async send(method, params = {}, timeoutMs = defaults.stepMs) {
    // The target ended or was disconnected; nothing will answer.
    if (this.#closed) return null
    const id = ++this.#nextId
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        resolve(null)
      }, timeoutMs)
      this.#pending.set(id, (message) => {
        clearTimeout(timer)
        resolve(message)
      })
      this.#post(JSON.stringify({ id, method, params }))
    })
  }

  /** Routes one incoming message to its waiting command or to the event listeners. */
  receive(text) {
    const message = JSON.parse(text)
    const settle = this.#pending.get(message.id)
    // The id comes from the inspected process; only a command this session sent has a waiter.
    if (typeof settle === 'function') {
      this.#pending.delete(message.id)
      settle(message)
      return
    }
    for (const listener of this.#listeners) listener(message)
  }

  /** Subscribes to events; returns the function that unsubscribes. */
  on(listener) {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  /** Resolves with the first event of that name, or `null` after the timeout. */
  async once(method, timeoutMs) {
    return new Promise((resolve) => {
      const off = this.on((message) => {
        if (message.method !== method) return
        clearTimeout(timer)
        off()
        resolve(message.params)
      })
      const timer = setTimeout(() => {
        off()
        resolve(null)
      }, timeoutMs)
    })
  }
}

/** Asks a port for its inspector WebSocket address; `null` when no Node inspector answers there. */
async function inspectorUrl(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
      signal: AbortSignal.timeout(500),
    })
    const [target] = await response.json()
    return target?.webSocketDebuggerUrl ?? null
  } catch {
    return null
  }
}

/** Opens a WebSocket; `null` when the connection fails. */
async function openSocket(url) {
  const socket = new WebSocket(url)
  const opened = await new Promise((resolve) => {
    socket.addEventListener('open', () => resolve(true), { once: true })
    socket.addEventListener('error', () => resolve(false), { once: true })
  })
  return opened ? socket : null
}

/**
 * Connects to a Node inspector on this machine.
 *
 * @param port - The inspector's port on 127.0.0.1.
 * @returns The main thread's session and a `close` function, or `null` when no inspector answers there.
 * @example const connection = await connectInspector(9229)
 */
async function connectInspector(port) {
  const url = await inspectorUrl(port)
  const socket = url && (await openSocket(url))
  if (!socket) return null
  const session = new Session((text) => socket.send(text))
  socket.addEventListener('message', ({ data }) => session.receive(data))
  socket.addEventListener('close', () => session.close(), { once: true })
  return { session, close: () => socket.close() }
}

/** Opens the session of one attached worker thread; its messages are wrapped in the main session's. */
function workerSession(main, { sessionId, workerInfo }) {
  const session = main.child(async (text) =>
    main.send('NodeWorker.sendMessageToWorker', { sessionId, message: text }),
  )
  main.on(({ method, params }) => {
    if (
      method === 'NodeWorker.receivedMessageFromWorker' &&
      params.sessionId === sessionId
    ) {
      session.receive(params.message)
    }
  })
  return { label: workerInfo.title || `worker ${sessionId}`, session }
}

/**
 * Opens a session for every worker thread of the connected process. Node
 * reports nested workers on the main session too, so one level reaches all.
 *
 * @param main - The main thread's session.
 * @returns `{ label, session }` per worker thread.
 */
async function workerSessions(main) {
  const attached = []
  const off = main.on((message) => {
    if (message.method === 'NodeWorker.attachedToWorker') {
      attached.push(message.params)
    }
  })
  await main.send('NodeWorker.enable', { waitForDebuggerOnStart: false })
  await sleep(300)
  off()
  return attached.map((worker) => workerSession(main, worker))
}

/** Renders one call frame of `Debugger.paused` as `name (url:line:column)`; `urls` maps script ids to files. */
function describeFrame(frame, urls) {
  const { scriptId, lineNumber, columnNumber } = frame.location
  const file = frame.url || urls.get(scriptId) || '<no file>'
  return `${frame.functionName || '(anonymous)'} (${file}:${lineNumber + 1}:${columnNumber + 1})`
}

/** Resumes a thread and withdraws a pending pause request; true when the thread acknowledged. */
async function releaseSession(session, timeoutMs) {
  await session.send('Debugger.resume', {}, timeoutMs)
  return (await session.send('Debugger.disable', {}, timeoutMs)) !== null
}

/**
 * Pauses a busy thread, reads its stack and resumes it.
 *
 * @param session - The thread's session.
 * @param state - Shared capture state; tracks what is paused so an abort can undo it.
 * @param options - `stepMs`.
 * @returns `stack` (frames, or `null` when the pause did not land) and `resumed`.
 */
async function pauseForStack(session, state, options) {
  const urls = new Map()
  // Call frames carry a script id; the file names arrive as events while the debugger starts.
  const off = session.on(({ method, params }) => {
    if (method === 'Debugger.scriptParsed')
      urls.set(params.scriptId, params.url)
  })
  state.pausing.add(session)
  await session.send('Debugger.enable', {}, options.stepMs)
  const paused = session.once('Debugger.paused', options.stepMs)
  void session.send('Debugger.pause', {}, options.stepMs)
  const event = await paused
  const resumed = await releaseSession(session, options.stepMs)
  state.pausing.delete(session)
  off()
  const stack = event?.callFrames.map((frame) => describeFrame(frame, urls))
  return { stack: stack ?? null, resumed }
}

/** Reads a thread's pid, Node version and live handles; `null` when it does not answer. */
async function readThreadInfo(session, options) {
  const reply = await session.send(
    'Runtime.evaluate',
    { expression: THREAD_INFO, returnByValue: true },
    options.stepMs,
  )
  const value = reply?.result?.result?.value
  return typeof value === 'string' ? JSON.parse(value) : null
}

/** Records a CPU profile; `null` when the thread ended or left JavaScript before it finished. */
async function recordProfile(session, options) {
  await session.send('Profiler.enable', {}, options.stepMs)
  await session.send('Profiler.start', {}, options.stepMs)
  await sleep(options.profileMs)
  const stopped = await session.send('Profiler.stop', {}, options.stepMs)
  void session.send('Profiler.disable', {}, options.stepMs)
  return stopped?.result?.profile ?? null
}

/** Adds the paused stack to a busy thread's record; an idle thread would only stop at its next timer. */
async function pauseIfBusy(record, session, state, options) {
  if (record.state !== 'busy' || state.aborted) return record
  return { ...record, ...(await pauseForStack(session, state, options)) }
}

/**
 * Records what one thread is doing: live handles, a CPU profile, and the
 * stack when the profile shows it busy.
 *
 * A spinning thread still answers the inspector (measured on Node 24.20.0:
 * `Runtime.evaluate` returned in 1 ms from `while (true) {}`), so an answer
 * proves nothing about progress; the profile decides.
 *
 * @param thread - `{ label, session }`.
 * @param state - Shared capture state.
 * @param options - `stepMs` and `profileMs`.
 * @returns The thread's record for {@link formatSummary}.
 * @example await captureThread({ label: 'main', session }, state, options)
 */
async function captureThread({ label, session }, state, options) {
  const info = await readThreadInfo(session, options)
  const profile = info && (await recordProfile(session, options))
  // No answer: the thread is not running JavaScript and not returning to its event loop.
  if (!profile) return { label, state: 'no answer' }
  const usage = summarizeProfile(profile)
  const record = {
    label,
    state: usage.busyPercent >= BUSY_PERCENT ? 'busy' : 'idle',
    reportedPid: info.pid,
    version: info.version,
    resources: info.resources,
    libuv: info.libuv,
    profile,
    ...usage,
  }
  return pauseIfBusy(record, session, state, options)
}

/** Calls `probe` every 200 ms for 3 s; resolves with its first truthy result or `null`. */
async function pollFor(probe) {
  for (let attempt = 0; attempt < 15; attempt++) {
    await sleep(200)
    const value = await probe()
    if (value) return value
  }
  return null
}

/** Finds, among the ports a process listens on, the one a Node inspector answers on. */
async function ownInspectorPort(pid, wanted) {
  const listeners = (await readListeners()) ?? []
  const ports = listeners
    .filter((listener) => listener.pid === pid)
    .map((listener) => listener.port)
    .sort((a, b) => Number(b === wanted) - Number(a === wanted))
  for (const port of ports) {
    if (await inspectorUrl(port)) return port
  }
  return null
}

/** Says why a process has no inspector port: another process holds it, or it never opened one. */
async function missingPortReason(pid, wanted) {
  const listeners = (await readListeners()) ?? []
  const holder = listeners.find((listener) => listener.port === wanted)
  return holder && holder.pid !== pid
    ? `port ${wanted} is in use by pid ${holder.pid}`
    : `pid ${pid} opened no inspector port within 3 s`
}

/** Without a socket table only the expected port can be tried; its owner is checked in band later. */
async function unverifiedPort(wanted) {
  const answered = await pollFor(async () => inspectorUrl(wanted))
  return answered
    ? { port: wanted, verified: false }
    : { reason: `no inspector answered on port ${wanted} within 3 s` }
}

/**
 * Finds the inspector port a process opened after `process._debugProcess`.
 *
 * @param row - The process.
 * @param options - `port`, when the user named one.
 * @returns `{ port, verified }` or `{ reason }` when no inspector of that process can be reached.
 */
async function findInspectorPort(row, options) {
  const wanted = options.port ?? DEFAULT_INSPECTOR_PORT
  if ((await readListeners()) === null) return unverifiedPort(wanted)
  // The target needs a moment to start its inspector thread.
  const port = await pollFor(async () => ownInspectorPort(row.pid, wanted))
  return port
    ? { port, verified: true }
    : { reason: await missingPortReason(row.pid, wanted) }
}

/** Asks a process to start its inspector; returns why it could not, or `null`. */
function signalInspector(pid) {
  try {
    process._debugProcess(pid)
    return null
  } catch (error) {
    return `pid ${pid} could not be signalled (${error.code})`
  }
}

/** Starts and connects to a process's inspector; `{ reason }` when it cannot be reached. */
async function openInspector(row, options) {
  const failure = signalInspector(row.pid)
  if (failure) return { reason: failure }
  const found = await findInspectorPort(row, options)
  if (found.reason) return found
  const connection = await connectInspector(found.port)
  return connection
    ? { ...found, connection }
    : { reason: `no inspector answered on port ${found.port}` }
}

/** Captures the main thread and every worker thread of a connected process. */
async function captureThreads(row, opened, state, options) {
  const { session } = opened.connection
  const main = await captureThread({ label: 'main', session }, state, options)
  // Without a socket table, the answering process must say it is the one that was asked for.
  if (!opened.verified && main.reportedPid !== row.pid) {
    const actual = main.reportedPid ?? 'a process that did not answer'
    return {
      unavailable: `port ${opened.port} belongs to ${actual}, not pid ${row.pid}`,
    }
  }
  const workers = await workerSessions(session)
  const captured = await Promise.all(
    workers.map(async (worker) => captureThread(worker, state, options)),
  )
  return { port: opened.port, threads: [main, ...captured] }
}

/**
 * Captures one process: its main thread and every worker thread.
 *
 * @param row - The process row, with `cpuPercent`.
 * @param state - Shared capture state.
 * @param options - Capture options.
 * @returns The process record for {@link formatSummary}.
 * @example await capturePid({ pid: 7, command: 'node a.mjs', cpuPercent: 100 }, state, options)
 */
async function capturePid(row, state, options) {
  const record = { pid: row.pid, command: row.command, cpu: row.cpuPercent }
  const opened = await openInspector(row, options)
  if (opened.reason) return { ...record, unavailable: opened.reason }
  state.connections.add(opened.connection)
  try {
    return { ...record, ...(await captureThreads(row, opened, state, options)) }
  } finally {
    state.connections.delete(opened.connection)
    opened.connection.close()
  }
}

/** Renders the paused stack of a thread, or says that the pause did not land. */
function stackLines(thread) {
  if (thread.stack) {
    return [
      '    paused stack:',
      ...thread.stack.map((frame) => `      ${frame}`),
    ]
  }
  return thread.state === 'busy'
    ? ['    paused stack: the pause did not land within the time limit']
    : []
}

/** Renders the functions that used the most CPU. */
function profileLines(thread) {
  if (thread.top.length === 0) return []
  return [
    '    cpu profile, top functions:',
    ...thread.top.map((entry) => `      ${entry.percent}% ${entry.name}`),
  ]
}

/** Counts how often each name occurs. */
function countNames(names) {
  const counts = new Map()
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1)
  return counts
}

/** Renders a thread's live handles and requests as `Name xN`. */
function resourceLine(thread) {
  const handles = [...countNames(thread.resources ?? [])].map(
    ([name, count]) => `${name} x${count}`,
  )
  return `    active resources: ${handles.join(', ') || 'none'}`
}

/** Renders one thread's lines of the summary. */
function formatThread(thread) {
  if (thread.state === 'no answer') {
    return [
      `  thread ${thread.label}: no answer from the inspector (it may be inside native code, or the process ended)`,
    ]
  }
  const warning =
    thread.resumed === false
      ? ['    NOT RESUMED: this thread did not acknowledge the resume']
      : []
  return [
    `  thread ${thread.label}: ${thread.state}, running code ${thread.busyPercent}% of the profile`,
    ...stackLines(thread),
    ...warning,
    ...profileLines(thread),
    resourceLine(thread),
  ]
}

/** Renders one process's lines of the summary. */
function formatProcess(entry) {
  const lines = ['', `pid ${entry.pid} (cpu ${entry.cpu}%): ${entry.command}`]
  if (entry.unavailable) {
    lines.push(`  inspector unavailable: ${entry.unavailable}`)
  } else {
    const version = entry.threads[0].version ?? 'unknown version'
    lines.push(`  inspector: 127.0.0.1:${entry.port}, Node ${version}`)
    lines.push(...entry.threads.flatMap(formatThread))
  }
  if (entry.sample) lines.push(`  native sample: ${entry.sample}`)
  return lines
}

/**
 * Renders the text a reporter pastes into an issue.
 *
 * @param result - `{ startedAt, target, platform, processes, notes }` as {@link capture} builds it.
 * @param home - Home directory to hide.
 * @returns The content of `summary.txt`.
 * @example formatSummary(result, '/Users/ada')
 */
export function formatSummary(result, home = homedir()) {
  const lines = [
    `hang capture ${result.startedAt}`,
    `target pid ${result.target}, ${result.processes.length} Node process(es) in scope, ${result.platform}`,
    ...result.processes.flatMap(formatProcess),
  ]
  if (result.notes.length > 0) lines.push('', ...result.notes)
  return scrubHome(`${lines.join('\n')}\n`, home)
}

/** True for a thread the debugger could not resume. */
const leftPaused = (thread) => thread.resumed === false

/** True for a thread whose evidence is missing: it did not answer, or it was busy and never paused. */
const isIncomplete = (thread) =>
  thread.state === 'no answer' || (thread.state === 'busy' && !thread.stack)

/** True when no process was captured, or a thread was left paused: both make the capture a failure. */
const nothingUsable = (captured, threads) =>
  captured === 0 || threads.some(leftPaused)

/** Lists the threads of a process record; a process that was not captured has none. */
const threadsOf = (entry) => entry.threads ?? []

/**
 * Decides the exit code from what was captured.
 *
 * @param processes - The process records.
 * @returns 0 when every process and thread in scope was captured, 2 when some
 * were, 1 when none were or a thread could not be resumed.
 * @example exitCodeFor([{ unavailable: 'port 9229 is in use by pid 4' }]) === 1
 */
export function exitCodeFor(processes) {
  const threads = processes.flatMap(threadsOf)
  const captured = processes.filter((entry) => !entry.unavailable).length
  if (nothingUsable(captured, threads)) return 1
  return captured === processes.length && !threads.some(isIncomplete) ? 0 : 2
}

/** Runs macOS `sample` on one process; resolves with a note when the tool is missing. */
async function sampleProcess(row, directory, options, sampling) {
  const file = `${row.pid}.sample.txt`
  const child = spawn(
    'sample',
    [
      String(row.pid),
      String(options.sampleSeconds),
      '-file',
      path.join(directory, file),
    ],
    { stdio: 'ignore' },
  )
  sampling.children.push(child)
  return new Promise((resolve) => {
    child.on('error', () =>
      resolve('`sample` is not installed; native stacks were not recorded'),
    )
    child.on('close', () => {
      if (existsSync(path.join(directory, file))) {
        sampling.files.set(row.pid, file)
      }
      resolve(null)
    })
  })
}

/** Starts macOS `sample` for every process at once; `done` resolves with notes for the summary. */
function startSampling(scope, directory, options) {
  const sampling = { files: new Map(), children: [], done: Promise.resolve([]) }
  if (process.platform !== 'darwin' || options.sampleSeconds <= 0) {
    return sampling
  }
  sampling.done = Promise.all(
    scope.map(async (row) => sampleProcess(row, directory, options, sampling)),
  ).then((notes) => [...new Set(notes.filter(Boolean))])
  return sampling
}

/** Writes one raw evidence file with the home directory replaced; nothing when the value is missing. */
function writeEvidence(file, value, indent) {
  if (!value) return
  writeFileSync(file, scrubHome(JSON.stringify(value, null, indent)))
}

/** Writes the raw profile and libuv section of every thread of one process. */
function writeProcessFiles(entry, directory) {
  for (const thread of threadsOf(entry)) {
    const stem = path.join(
      directory,
      `${entry.pid}-${thread.label.replace(/[^\w.-]+/g, '_')}`,
    )
    writeEvidence(`${stem}.cpuprofile`, thread.profile)
    writeEvidence(`${stem}.libuv.json`, thread.libuv, 2)
  }
}

/** Builds the result of a capture that was refused before anything was touched. */
function refusal(problem) {
  return { refusal: { exitCode: 1, messages: [formatProblem(problem)] } }
}

/** Checks the named process and measures CPU; `{ scope }`, or `{ refusal }` when it cannot be captured. */
async function resolveTarget(pid, options) {
  const before = await readProcessTable()
  const target = before.find((row) => row.pid === pid)
  if (!target) {
    return refusal({
      what: `No process with pid ${pid} exists.`,
      why: 'The run may have ended, or the number is not a process id.',
      next: 'Run `node capture-hang.mjs --list` and pass a pid from that list.',
    })
  }
  if (!isNodeProcess(target)) {
    return refusal({
      what: `pid ${pid} is not a Node process: ${target.command}`,
      why: 'Only Node processes have the inspector this script uses, and it signals nothing else.',
      next: 'Run `node capture-hang.mjs --list` and pass the pid of the test runner.',
    })
  }
  await sleep(options.cpuWindowMs)
  const measured = measureCpu(
    before,
    await readProcessTable(),
    options.cpuWindowMs / 1000,
  )
  const scope = resolveScope(measured, pid)
  if (scope.length > 0) return { scope }
  return refusal({
    what: `pid ${pid} ended before it could be captured.`,
    why: 'The run finished, or was stopped, while its CPU use was being measured.',
    next: 'If the run hangs again, capture it while it is still stuck.',
  })
}

/** Creates the output directory; `{ refusal }` when it exists, because a capture never overwrites. */
function prepareDirectory(pid, startedAt, options) {
  const directory = path.resolve(
    options.out ?? outputDirectoryName(pid, startedAt),
  )
  if (existsSync(directory)) {
    return refusal({
      what: `The output directory already exists: ${directory}`,
      why: 'A capture never overwrites an earlier one.',
      next: 'Pass another `--out <dir>` or remove that directory.',
    })
  }
  mkdirSync(directory, { recursive: true })
  return { directory }
}

/** Captures the processes in scope, busiest first, until done, aborted or close to the deadline. */
async function captureScope(scope, state, result, deadline, options) {
  for (const row of scope) {
    // Stop opening processes while there is still time to undo every pause.
    if (state.aborted || Date.now() > deadline - RESERVE_MS) {
      result.processes.push({
        pid: row.pid,
        command: row.command,
        cpu: row.cpuPercent,
        unavailable: 'not captured: the time limit was reached first',
      })
      continue
    }
    result.processes.push(await capturePid(row, state, options))
  }
}

/** Waits for the work, the deadline or the abort signal; resolves with the reason it stopped early, if any. */
async function raceAbort(work, deadline, signal) {
  const controller = new AbortController()
  const timeout = sleep(Math.max(0, deadline - Date.now()), 'the time limit', {
    signal: controller.signal,
  }).catch(() => null)
  const aborted = new Promise((resolve) => {
    signal?.addEventListener('abort', () => resolve('it was interrupted'), {
      once: true,
    })
  })
  const reason = await Promise.race([work.then(() => null), timeout, aborted])
  controller.abort()
  return reason
}

/** Ends a capture early: resumes every thread that may be paused and closes every connection. */
async function abortCapture(state, sampling, timeoutMs) {
  state.aborted = true
  await Promise.all(
    [...state.pausing].map(async (session) =>
      releaseSession(session, timeoutMs),
    ),
  )
  for (const connection of state.connections) connection.close()
  for (const child of sampling.children) child.kill()
}

/** Writes the summary and the raw files; returns the summary text. */
function writeCapture(result, sampling, directory) {
  for (const entry of result.processes) {
    entry.sample = sampling.files.get(entry.pid)
    writeProcessFiles(entry, directory)
  }
  for (const file of sampling.files.values()) {
    const full = path.join(directory, file)
    writeFileSync(full, scrubHome(readFileSync(full, 'utf8')))
  }
  const summary = formatSummary(result)
  writeFileSync(path.join(directory, 'summary.txt'), summary)
  return summary
}

/**
 * Captures a process and its Node descendants and writes the evidence.
 *
 * @param pid - The process the user named; never chosen by this script.
 * @param overrides - `port`, `out`, `timeoutSeconds`, `profileMs`, `stepMs`,
 * `sampleSeconds`, `cpuWindowMs`, `signal` (an AbortSignal that ends the
 * capture early and resumes everything).
 * @returns `{ exitCode, directory, summary, messages }`; `directory` and
 * `summary` are absent when the pid was refused.
 * @throws Never for a failed capture; failures are reported through `exitCode` and `messages`.
 * @example const { exitCode, directory } = await capture(12345, { timeoutSeconds: 60 })
 */
export async function capture(pid, overrides = {}) {
  const options = { ...defaults, ...overrides }
  const startedAt = new Date()
  const target = await resolveTarget(pid, options)
  if (target.refusal) return target.refusal
  const place = prepareDirectory(pid, startedAt, options)
  if (place.refusal) return place.refusal

  const state = { pausing: new Set(), connections: new Set(), aborted: false }
  const result = {
    startedAt: startedAt.toISOString(),
    target: pid,
    platform: `${process.platform} ${process.arch}`,
    processes: [],
    notes: [],
  }
  const sampling = startSampling(target.scope, place.directory, options)
  const deadline = startedAt.getTime() + options.timeoutSeconds * 1000
  const work = captureScope(target.scope, state, result, deadline, options)
  const stopped = await raceAbort(work, deadline, options.signal)
  if (stopped) {
    result.notes.push(`Capture ended early: ${stopped}.`)
    await abortCapture(state, sampling, options.stepMs)
  }
  result.notes.push(...(await sampling.done))
  return {
    exitCode: exitCodeFor(result.processes),
    directory: place.directory,
    summary: writeCapture(result, sampling, place.directory),
    messages: closingMessages(result.processes, place.directory),
  }
}

/** Reports a thread that did not acknowledge the resume. */
function resumeProblem(entry) {
  const stuck = threadsOf(entry).filter(leftPaused)
  if (stuck.length === 0) return null
  return formatProblem({
    what: `pid ${entry.pid} did not acknowledge the resume on thread ${stuck.map((thread) => thread.label).join(', ')}.`,
    why: 'The process may have ended, or it is still paused in the debugger.',
    next: `Check whether pid ${entry.pid} still makes progress; if not, stop it.`,
  })
}

/** Reports a process whose inspector could not be reached. */
function unavailableProblem(entry) {
  if (!entry.unavailable) return null
  return formatProblem({
    what: `pid ${entry.pid} was not captured: ${entry.unavailable}.`,
    why: 'Its inspector could not be reached; one inspector port serves one process, so a port held by another process blocks it.',
    next: entry.sample
      ? `Attach ${entry.sample} from the output directory; it holds that process's native stacks.`
      : 'Stop the program that holds the port, or pass the pid of the busy process itself.',
  })
}

/** Reports a thread that gave no stack. */
function silentProblem(entry) {
  if (!threadsOf(entry).some(isIncomplete)) return null
  return formatProblem({
    what: `A thread of pid ${entry.pid} did not answer or did not stop for the debugger within the time limit.`,
    why: 'It may be inside native code, which the JavaScript debugger cannot pause, or the process ended.',
    next: entry.sample
      ? `Attach ${entry.sample} from the output directory as well.`
      : 'Attach the .cpuprofile files from the output directory as well.',
  })
}

/** Builds what the command prints after a capture: problems first, then where the evidence is. */
function closingMessages(processes, directory) {
  const problems = processes
    .flatMap((entry) => [
      resumeProblem(entry),
      unavailableProblem(entry),
      silentProblem(entry),
    ])
    .filter(Boolean)
  const notices = processes
    .filter((entry) => entry.port)
    .map(
      (entry) =>
        `The inspector of pid ${entry.pid} stays open on 127.0.0.1:${entry.port} until that process ends.`,
    )
  if (notices.length > 0) {
    notices.push('Stop the stuck run once the capture is saved.')
  }
  return [
    ...problems,
    `Paste this file into your report: ${path.join(directory, 'summary.txt')}`,
    ...notices,
  ]
}

/**
 * Lists Node processes with their CPU use over a short window. Attaches to nothing.
 *
 * @param windowMs - Time between the two readings.
 * @returns The text `--list` prints.
 * @example console.log(await listNodeProcesses())
 */
async function listNodeProcesses(windowMs = defaults.cpuWindowMs) {
  const before = await readProcessTable()
  await sleep(windowMs)
  const rows = measureCpu(
    before,
    await readProcessTable(),
    windowMs / 1000,
  ).filter((row) => isNodeProcess(row) && row.pid !== process.pid)
  if (rows.length === 0) return 'No Node process is running.\n'
  const lines = rows.map(
    (row) =>
      `${String(row.pid).padStart(7)} ${String(row.ppid).padStart(7)} ${String(row.cpuPercent).padStart(4)}%  ${row.command.slice(0, 160)}`,
  )
  return scrubHome(
    [
      `    PID    PPID   CPU  COMMAND (CPU measured over ${windowMs / 1000} s)`,
      ...lines,
      '',
      'Capture the test runner and its workers with: node capture-hang.mjs <PID>',
      '',
    ].join('\n'),
  )
}

const usage = `Usage:
  node capture-hang.mjs --list
  node capture-hang.mjs <pid> [--port <n>] [--out <dir>] [--timeout <seconds>]

  --list      Print the Node processes, busiest first. Attaches to nothing.
  <pid>       Capture this process and its Node child processes.
  --port      Inspector port of <pid>, when it was started with --inspect-port.
  --out       Output directory (default ./hang-capture-<pid>-<UTC time>/).
  --timeout   Overall limit in seconds (default ${defaults.timeoutSeconds}).

Exit codes: 0 everything captured, 2 partly captured, 1 nothing captured.
Recipe: ${RECIPE_URL}
`

/** Parses the command line; prints the problem and returns `null` when it is not understood. */
function readArguments(argv) {
  try {
    return parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        list: { type: 'boolean' },
        help: { type: 'boolean' },
        port: { type: 'string' },
        out: { type: 'string' },
        timeout: { type: 'string' },
      },
    })
  } catch (error) {
    console.error(`${error.message}\n\n${usage}`)
    return null
  }
}

/** Turns command-line values into {@link capture} overrides. */
function overridesFrom(values, signal) {
  const overrides = { signal }
  if (values.port) overrides.port = Number(values.port)
  if (values.out) overrides.out = values.out
  if (values.timeout) overrides.timeoutSeconds = Number(values.timeout)
  return overrides
}

/** Prints the summary to stdout and the problems and notices to stderr. */
function printOutcome(outcome) {
  if (outcome.summary) console.log(outcome.summary)
  for (const message of outcome.messages) console.error(`${message}\n`)
}

/** Captures the pid given on the command line and prints the outcome; returns the exit code. */
async function runCapture(text, values) {
  const pid = Number(text)
  if (!Number.isInteger(pid) || pid <= 0) {
    console.error(
      formatProblem({
        what: `"${text}" is not a process id.`,
        why: 'The first argument must be the pid of a Node process.',
        next: 'Run `node capture-hang.mjs --list` and pass a pid from that list.',
      }),
    )
    return 1
  }
  // Ctrl+C ends the capture early and resumes whatever is paused.
  const interrupt = new AbortController()
  process.once('SIGINT', () => interrupt.abort())
  process.once('SIGTERM', () => interrupt.abort())
  const outcome = await capture(pid, overridesFrom(values, interrupt.signal))
  printOutcome(outcome)
  return outcome.exitCode
}

/** True when the command asks for the process list; without a pid the script never picks one itself. */
const wantsList = ({ values, positionals }) =>
  values.list || positionals.length === 0

/**
 * Runs the command line.
 *
 * @param argv - Arguments after the script name.
 * @returns The exit code.
 * @example process.exitCode = await main(['--list'])
 */
async function main(argv) {
  const parsed = readArguments(argv)
  if (!parsed) return 1
  if (parsed.values.help) {
    console.log(usage)
    return 0
  }
  if (wantsList(parsed)) {
    console.log(await listNodeProcesses())
    return 0
  }
  return runCapture(parsed.positionals[0], parsed.values)
}

// Run only as a command; the test imports the functions above.
if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2))
  // An open inspector socket would keep the process alive after the work is done.
  process.exit()
}
