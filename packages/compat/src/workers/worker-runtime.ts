import { createContext, Script, SourceTextModule } from 'node:vm'
import type { ModuleLinker } from 'node:vm'
import { receiveMessageOnPort, workerData } from 'node:worker_threads'

import { Window, PropertySymbol } from 'happy-dom'

import { bindCanvasPort } from '../canvas/ports.ts'
import {
  ExtendedCanvasAdapter,
  installCompatibility,
  disposeAll,
} from '../index.ts'

import {
  WORKER_GLOBALS,
  WORKER_LOAD_TIMEOUT_MS,
  WORKER_REALM_GLOBALS,
} from './constants.ts'
import type { WorkerStartupData } from './types.ts'
import { workerMessageEvent } from './utils/message-event.ts'

/** Runs our package bootstrap in a real child thread; browser scripts receive only the worker realm globals.
 * @returns A promise that reports startup failures before joining owned cleanup.
 * @example await startOwnedWorker();
 */
export async function startOwnedWorker(): Promise<void> {
  // Only our native constructor creates this private packet; user postMessage data uses a different port.
  const startup = workerData as WorkerStartupData
  const adapter = new ExtendedCanvasAdapter()
  const window = new Window({
    url: startup.url,
    settings: { canvasAdapter: adapter, enableImageFileLoading: true },
  })
  const dispose = installCompatibility(window, new URL(startup.bootstrap))
  const restorePort = bindCanvasPort(window, startup.messages, startup.token)
  let closing: Promise<void> | undefined
  const close = async (): Promise<void> =>
    (closing ??= (async () => {
      try {
        await Promise.all([window.happyDOM.close(), adapter.drain()])
      } finally {
        disposeAll([
          restorePort,
          dispose,
          () => adapter.dispose(),
          () => startup.messages.close(),
          () => startup.requests.close(),
          () => startup.control.close(),
        ])
      }
    })())
  const report = (error: unknown, filename = startup.url) => {
    if (!closing)
      startup.control.postMessage({
        type: 'error',
        message: String(error),
        filename,
      })
  }
  startup.control.on('message', (message) => {
    if (message?.type === 'close') void close()
  })
  window[PropertySymbol.dispatchError] = (error: unknown) => {
    report(error)
  }

  /** Provides an EventTarget global without exposing Window/document or Node's process/require to worker scripts. */
  class WorkerGlobalScope extends window.EventTarget {}
  /** Owns dedicated worker messages and browser-style event handler properties. */
  class DedicatedWorkerGlobalScope extends WorkerGlobalScope {
    onmessage:
      ((event: InstanceType<Window['MessageEvent']>) => unknown) | null = null
    onmessageerror:
      ((event: InstanceType<Window['MessageEvent']>) => unknown) | null = null
    onerror: ((event: InstanceType<Window['ErrorEvent']>) => unknown) | null =
      null
  }
  const scope = new DedicatedWorkerGlobalScope()
  const context = createContext(scope, { name: startup.name || startup.url })
  for (const name of WORKER_GLOBALS) {
    const value: unknown = Reflect.get(window, name)
    if (value !== undefined)
      Reflect.set(
        scope,
        name,
        typeof value === 'function' && /^[a-z]/.test(name)
          ? value.bind(window)
          : value,
      )
  }
  for (const name of WORKER_REALM_GLOBALS)
    Reflect.set(window, name, new Script(name).runInContext(context))
  Object.assign(scope, {
    WorkerGlobalScope,
    DedicatedWorkerGlobalScope,
    name: startup.name,
    origin: startup.origin,
    postMessage: startup.messages.postMessage.bind(startup.messages),
    close: () => {
      void close()
    },
  })
  Object.defineProperty(scope, Symbol.toStringTag, {
    value: 'DedicatedWorkerGlobalScope',
  })
  new Script('self = globalThis').runInContext(context)
  let location = new URL(startup.url)
  Object.defineProperty(scope, 'location', {
    get: () =>
      Object.freeze({
        href: location.href,
        origin: location.origin,
        protocol: location.protocol,
        host: location.host,
        hostname: location.hostname,
        port: location.port,
        pathname: location.pathname,
        search: location.search,
        hash: location.hash,
        toString: () => location.href,
      }),
  })

  let nextRequestId = 0
  /** Uses the parent request pipeline, including cookies/interceptors, while classic importScripts waits in this child only.
   * @returns Validated script text and its redirect-resolved URL.
   * @example const resource = source('https://example.test/worker.js');
   */
  function source(url: string): { source: string; url: string } {
    if (closing)
      throw new window.DOMException('The worker is closing.', 'AbortError')
    const requestId = ++nextRequestId
    const deadline = performance.now() + WORKER_LOAD_TIMEOUT_MS
    startup.requests.postMessage({ requestId, url })
    let response: unknown
    while (true) {
      // Capture before draining so a reply between the drain and wait cannot lose its wake-up.
      const version = Atomics.load(startup.wake, 0)
      response = receiveMessageOnPort(startup.requests)?.message
      if (
        response &&
        typeof response === 'object' &&
        Reflect.get(response, 'requestId') === requestId
      )
        break
      // Drain obsolete replies before waiting; their source must never run under a newer URL.
      if (response !== undefined) continue
      const remaining = deadline - performance.now()
      if (
        remaining <= 0 ||
        Atomics.wait(startup.wake, 0, version, remaining) === 'timed-out'
      )
        throw new window.DOMException(
          'Worker script loading timed out.',
          'TimeoutError',
        )
    }
    if (Reflect.has(response, 'error'))
      throw new window.DOMException(
        String(Reflect.get(response, 'error')),
        'NetworkError',
      )
    const text: unknown = Reflect.get(response, 'source')
    const address: unknown = Reflect.get(response, 'url')
    if (typeof text !== 'string' || typeof address !== 'string')
      throw new window.TypeError('Invalid worker script response.')
    return { source: text, url: address }
  }
  const modules = new Map<string, SourceTextModule>()
  const executions = new WeakMap<SourceTextModule, Promise<void>>()

  /** Compiles each URL once; V8 performs linking, cycles and top-level await instead of a handwritten module parser.
   * @returns The cached module with worker-realm import.meta and dynamic import handling.
   * @example const module = loadModule(scriptURL); await module.link(link);
   */
  function loadModule(url: string): SourceTextModule {
    const existing = modules.get(url)
    if (existing) return existing
    const loaded = source(url)
    const redirected = modules.get(loaded.url)
    if (redirected) {
      modules.set(url, redirected)
      return redirected
    }
    const module = new SourceTextModule(loaded.source, {
      context,
      identifier: loaded.url,
      initializeImportMeta(meta) {
        meta.url = loaded.url
      },
      async importModuleDynamically(specifier, reference, attributes) {
        const dependency = link(specifier, reference, { attributes })
        await evaluate(dependency)
        return dependency
      },
    })
    modules.set(url, module)
    modules.set(loaded.url, module)
    return module
  }
  /** Resolves browser URL imports and rejects Node/bare/import-attribute forms outside the JavaScript worker contract.
   * @returns A module for V8's recursive linker.
   * @example link('./colors.js', module, { attributes: {} });
   */
  function link(
    specifier: string,
    reference: { identifier: string },
    extra: Parameters<ModuleLinker>[2],
  ): SourceTextModule {
    if (
      Object.keys(extra.attributes).length ||
      !/^(?:\.{0,2}\/|[a-zA-Z][a-zA-Z\d+.-]*:)/.test(specifier)
    )
      throw new window.TypeError(
        'Worker modules require JavaScript URL imports.',
      )
    return loadModule(new URL(specifier, reference.identifier).href)
  }
  /** Shares linking/evaluation completion across repeated dynamic imports.
   * @returns A promise after V8 completes the module graph, including top-level await.
   * @example await evaluate(loadModule(scriptURL));
   */
  async function evaluate(module: SourceTextModule): Promise<void> {
    let execution = executions.get(module)
    if (!execution) {
      execution = (async () => {
        if (module.status === 'unlinked') await module.link(link)
        await module.evaluate()
      })()
      executions.set(module, execution)
    }
    return execution
  }
  Reflect.set(scope, 'importScripts', (...urls: unknown[]) => {
    if (startup.type === 'module')
      throw new window.TypeError('Module workers cannot call importScripts.')
    const addresses = urls.map(
      (url) => new URL(window.String(url), location).href,
    )
    for (const address of addresses) {
      const loaded = source(address)
      new Script(loaded.source, { filename: loaded.url }).runInContext(context)
    }
  })
  const messages = (event: Event) => {
    if (!closing && event instanceof MessageEvent)
      scope.dispatchEvent(workerMessageEvent(window, event))
  }
  try {
    if (startup.type === 'module') {
      const entry = loadModule(startup.url)
      location = new URL(entry.identifier)
      await evaluate(entry)
    } else {
      const loaded = source(startup.url)
      location = new URL(loaded.url)
      new Script(loaded.source, { filename: loaded.url }).runInContext(context)
    }
    if (!closing) {
      startup.messages.addEventListener('message', messages)
      startup.messages.addEventListener('messageerror', () =>
        scope.dispatchEvent(new window.MessageEvent('messageerror')),
      )
      startup.messages.start()
      startup.control.postMessage({ type: 'ready' })
    }
  } catch (error) {
    report(error)
    await close()
  }
}
