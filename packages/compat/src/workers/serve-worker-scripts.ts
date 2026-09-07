import type { MessagePort } from 'node:worker_threads'

import type { Window } from 'happy-dom'

import { fetchCanvasResource } from '../canvas/resource-fetch.ts'

import { JAVASCRIPT_MIME_TYPES } from './constants.ts'
import type { workerOptions } from './utils/worker-options.ts'

/** Serves child script requests through the original Window's policy and wakes synchronous importScripts only after a complete response.
 * @returns Nothing; abort settles blocked child requests during Worker termination.
 * @example serveWorkerScripts(window, port, wake, options, signal);
 */
export function serveWorkerScripts(
  window: Window,
  port: MessagePort,
  wake: Int32Array<SharedArrayBuffer>,
  options: ReturnType<typeof workerOptions>,
  signal: InstanceType<Window['AbortSignal']>,
): void {
  const { credentialMode, workerType } = options
  const crossOrigin =
    workerType === 'classic'
      ? null
      : credentialMode === 'include'
        ? 'use-credentials'
        : 'anonymous'
  let entryRequest = true
  port.on('message', async function serveWorkerScript(request: unknown) {
    let release = () => {}
    let requestId: unknown
    // The bootstrap requests its entry before V8 linking or user importScripts can request dependencies.
    const isEntry = entryRequest
    entryRequest = false
    try {
      if (!request || typeof request !== 'object')
        throw new window.TypeError('Invalid worker script request.')
      requestId = Reflect.get(request, 'requestId')
      if (!Number.isSafeInteger(requestId))
        throw new window.TypeError('Invalid worker script request.')
      if (
        window.happyDOM.settings.disableJavaScriptFileLoading ||
        window.happyDOM.settings.disableJavaScriptEvaluation
      )
        throw new window.DOMException(
          'Worker script execution is disabled by the Window settings.',
          'NetworkError',
        )
      const url: unknown = Reflect.get(request, 'url')
      if (typeof url !== 'string')
        throw new window.TypeError('Invalid worker script URL.')
      const resource = await fetchCanvasResource(
        window,
        url,
        crossOrigin,
        signal,
        {
          ...(workerType === 'classic'
            ? { credentials: 'same-origin' }
            : credentialMode === 'omit'
              ? { credentials: 'omit' }
              : {}),
          sameOrigin: isEntry,
        },
      )
      release = resource.release
      if (
        (workerType === 'module' ||
          !isEntry ||
          /^https?:/.test(resource.url)) &&
        !JAVASCRIPT_MIME_TYPES.has(
          resource.mimeType.split(';')[0]!.trim().toLowerCase(),
        )
      )
        throw new window.DOMException(
          'Worker scripts require a JavaScript MIME type.',
          'NetworkError',
        )
      port.postMessage({
        requestId,
        source: resource.buffer.toString('utf8'),
        url: resource.url,
      })
    } catch (error) {
      port.postMessage({ requestId, error: String(error) })
    } finally {
      release()
      Atomics.add(wake, 0, 1)
      Atomics.notify(wake, 0)
    }
  })
}
