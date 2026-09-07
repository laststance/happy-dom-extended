import type { Window } from 'happy-dom'

import type { DisposeCompatibility } from '../types.ts'

import { disposeAll } from './dispose-all.ts'
import { replaceProperty } from './replace-property.ts'

const windowClosers = new WeakMap<Window, Set<() => Promise<void>>>()

/** Joins all owned asynchronous resources through one close wrapper; reference-counted property patches cannot stack wrappers.
 * @returns Nothing; normal teardown still reaches upstream close even when an owned resource fails.
 * @example registerWindowClose(window, closeWorkers, restorers);
 */
export function registerWindowClose(
  window: Window,
  closeResource: () => Promise<void>,
  restorers: DisposeCompatibility[],
): void {
  const closers = windowClosers.get(window) ?? new Set<() => Promise<void>>()
  const close = window.happyDOM.close
  const restore = replaceProperty(window.happyDOM, 'close', {
    writable: true,
    async value() {
      const results = await Promise.allSettled(
        [...closers].map(async (dispose) => dispose()),
      )
      const errors = results.flatMap((result) =>
        result.status === 'rejected' ? [result.reason] : [],
      )
      try {
        await close.call(window.happyDOM)
      } catch (error) {
        errors.push(error)
      }
      disposeAll([], errors)
    },
  })
  closers.add(closeResource)
  windowClosers.set(window, closers)
  restorers.push(() => {
    closers.delete(closeResource)
    if (!closers.size) windowClosers.delete(window)
    restore()
  })
}
