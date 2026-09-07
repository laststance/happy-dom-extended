import { randomUUID } from 'node:crypto'
import { clearTimeout, setTimeout } from 'node:timers'
import { Worker as NativeWorker, MessageChannel } from 'node:worker_threads'

import type { Window } from 'happy-dom'
import { PropertySymbol } from 'happy-dom'

import { WindowBrowserContext } from '../canvas/happy-dom-internals.ts'
import { bindCanvasPort } from '../canvas/ports.ts'
import type { DisposeCompatibility } from '../types.ts'
import { disposeAll } from '../utils/dispose-all.ts'
import { registerWindowClose } from '../utils/register-window-close.ts'
import { replaceProperty } from '../utils/replace-property.ts'

import { MAX_WORKERS, WORKER_STOP_TIMEOUT_MS } from './constants.ts'
import { serveWorkerScripts } from './serve-worker-scripts.ts'
import { workerThreads } from './state.ts'
import type { WorkerStartupData } from './types.ts'
import { workerMessageEvent } from './utils/message-event.ts'
import { workerOptions } from './utils/worker-options.ts'

/** Installs actual dedicated threads with Canvas transport, parent-controlled script loading and joined teardown.
 * @returns Nothing; explicit consumer Worker implementations keep their identity.
 * @example installWorkers(window, restorers, new URL('./worker.cjs', import.meta.url));
 */
export function installWorkers(
  window: Window,
  restorers: DisposeCompatibility[],
  // fallow-ignore-next-line circular-dependency -- This URL executes in a separate native Worker isolate, never as a parent import.
  bootstrap = new URL('./worker-bootstrap.ts', import.meta.url),
): void {
  if (Reflect.get(window, 'Worker') !== undefined) return
  const children = new Set<() => Promise<void>>()
  restorers.push(() => {
    // Emergency synchronous restoration requests stops; normal runner teardown joins them through Window close first.
    for (const stop of children) void stop()
  })
  registerWindowClose(
    window,
    async () => {
      await Promise.all([...children].map(async (stop) => stop()))
    },
    restorers,
  )

  /** Presents browser message/error events while the private native thread owns execution. */
  class Worker extends window.EventTarget {
    onmessage:
      ((event: InstanceType<Window['MessageEvent']>) => unknown) | null = null
    onmessageerror:
      ((event: InstanceType<Window['MessageEvent']>) => unknown) | null = null
    onerror: ((event: InstanceType<Window['ErrorEvent']>) => unknown) | null =
      null
    #messages = new MessageChannel()
    #control = new MessageChannel()
    #requests = new MessageChannel()
    #abort = new window.AbortController()
    #thread!: NativeWorker
    #stopped = false
    #closed!: Promise<void>
    #stopTimer: ReturnType<typeof setTimeout> | undefined
    #restore: DisposeCompatibility = () => {}
    #endStartup: DisposeCompatibility = () => {}

    /** Converts Worker URL/options before creating a child; startup failure reaches the public error event.
     * @example new window.Worker(scriptURL, { type: 'module' });
     */
    constructor(...argumentsList: unknown[]) {
      super()
      try {
        const options = workerOptions(window, argumentsList)
        const { url, workerName, workerType } = options
        if (children.size >= MAX_WORKERS)
          throw new window.DOMException(
            'The environment Worker limit was reached.',
            'QuotaExceededError',
          )
        const wake = new Int32Array(
          new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT),
        )
        const token = randomUUID()
        this.#restore = bindCanvasPort(window, this.#messages.port1, token)
        this.#registerStartup()
        const startup: WorkerStartupData = {
          messages: this.#messages.port2,
          requests: this.#requests.port2,
          control: this.#control.port2,
          wake,
          token,
          url: url.href,
          origin: window.location.origin,
          type: workerType,
          name: workerName,
          bootstrap: bootstrap.href,
        }
        this.#thread = new NativeWorker(bootstrap, {
          workerData: startup,
          transferList: [startup.messages, startup.requests, startup.control],
          execArgv: ['--experimental-vm-modules'],
          name: workerName,
        })
        workerThreads.set(this, this.#thread)
        children.add(this.#stop)
        this.#closed = new Promise((resolve) =>
          this.#thread.once('exit', () => {
            this.#stopped = true
            this.#abort.abort()
            clearTimeout(this.#stopTimer)
            children.delete(this.#stop)
            this.#release()
            resolve()
          }),
        )
        this.#thread.on('error', (error) => this.#error(error.message))
        this.#control.port1.on(
          'message',
          (message: { type: string; message?: string; filename?: string }) => {
            if (message.type === 'ready') this.#endStartup()
            if (message.type === 'error')
              this.#error(
                String(message.message),
                String(message.filename ?? url.href),
              )
          },
        )
        this.#messages.port1.addEventListener('message', (event) => {
          if (!this.#stopped && event instanceof MessageEvent)
            this.dispatchEvent(workerMessageEvent(window, event))
        })
        this.#messages.port1.addEventListener('messageerror', () => {
          if (!this.#stopped)
            this.dispatchEvent(new window.MessageEvent('messageerror'))
        })
        this.#messages.port1.start()
        serveWorkerScripts(
          window,
          this.#requests.port1,
          wake,
          options,
          this.#abort.signal,
        )
      } catch (error) {
        this.#release()
        throw error
      }
    }

    /** Serializes at invocation, including before startup completes; termination suppresses later delivery.
     * @returns Nothing; invalid transfer lists throw before sender detachment.
     * @example worker.postMessage({ canvas }, [canvas]);
     */
    postMessage(...argumentsList: unknown[]): void {
      if (this.#stopped) return
      Reflect.apply(
        this.#messages.port1.postMessage,
        this.#messages.port1,
        argumentsList,
      )
    }

    /** Cancels startup and requests child cleanup, forcing a blocked script to exit after a bounded grace period.
     * @returns Nothing, matching the browser API; Window teardown joins the private completion promise.
     * @example worker.terminate();
     */
    terminate(): void {
      void this.#stop()
    }

    /** Tracks startup until V8 is ready or the native child exits, so Window completion observes queued loads.
     * @returns Nothing; constructor cleanup releases a partially registered task.
     * @example this.#registerStartup();
     */
    #registerStartup(): void {
      const tasks = new WindowBrowserContext(window).getBrowserFrame()?.[
        PropertySymbol.asyncTaskManager
      ]
      if (!tasks)
        throw new window.DOMException(
          'The Window is closing.',
          'InvalidStateError',
        )
      const taskId = tasks.startTask(() => {
        void this.#stop()
      })
      let startupEnded = false
      this.#endStartup = () => {
        if (startupEnded) return
        startupEnded = true
        tasks.endTask(taskId)
      }
    }

    #stop = async (): Promise<void> => {
      if (!this.#stopped) {
        this.#stopped = true
        this.#abort.abort()
        this.#control.port1.postMessage({ type: 'close' })
        this.#stopTimer = setTimeout(() => {
          void this.#thread.terminate()
        }, WORKER_STOP_TIMEOUT_MS)
      }
      return this.#closed
    }

    /** Reports execution/load failures through the owning Window's ErrorEvent before consumers handle them.
     * @returns Nothing.
     * @example this.#error('Script failed', scriptURL);
     */
    #error(message: string, filename = ''): void {
      if (!this.#stopped)
        this.dispatchEvent(
          new window.ErrorEvent('error', {
            message,
            filename,
            cancelable: true,
          }),
        )
    }

    /** Closes every native endpoint, including a constructor that failed before thread creation.
     * @returns Nothing.
     * @example this.#release();
     */
    #release(): void {
      disposeAll([
        this.#endStartup,
        this.#restore,
        ...[this.#messages, this.#control, this.#requests].flatMap(
          (channel) => [
            () => channel.port1.close(),
            () => channel.port2.close(),
          ],
        ),
      ])
    }
  }
  restorers.push(
    replaceProperty(window, 'Worker', { value: Worker, writable: true }),
  )
}
