/** Runs one FinalizationRegistry callback so collecting a dead resource can never end the process.
 * @param release - Cleanup for the collected resource, which may throw or reject once its context is gone.
 * @returns Nothing; V8 reports a throw from a finalizer as an uncaught exception, and a worker tearing down its environment turns that into SIGABRT.
 * @example new FinalizationRegistry<MessagePort>((port) => runFinalizer(() => port.close()))
 */
export function runFinalizer(release: () => unknown): void {
  try {
    const pending = release() as PromiseLike<unknown> | undefined
    // A finalizer cannot await, so an async cleanup would reject with nothing attached.
    if (typeof pending?.then === 'function') pending.then(undefined, () => {})
  } catch {
    // Collection order is not observable, so a late handle is expected rather than an error to report.
  }
}
