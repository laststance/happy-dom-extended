import type { AbortSignal } from 'happy-dom'

/** Lets media cancellation settle an intercepted request even when consumer interceptor code never resolves.
 * @returns The original result or abort reason, removing its abort listener on either outcome.
 * @example await abortableMedia(signal, interceptor.beforeAsyncRequest(options));
 */
export async function abortableMedia<Value>(
  signal: AbortSignal,
  pending: Promise<Value>,
): Promise<Value> {
  if (signal.aborted) throw signal.reason
  let abort = () => {}
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        abort = () => reject(signal.reason)
        signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) abort()
      }),
    ])
  } finally {
    signal.removeEventListener('abort', abort)
  }
}
