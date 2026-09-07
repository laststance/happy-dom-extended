import type { TestContext } from 'node:test'

import { Window } from 'happy-dom'

import {
  ExtendedCanvasAdapter,
  disposeAll,
  installCompatibility,
} from '../../src/index.ts'

/** Gives regressions and each generated case a real Window with complete, repeatable cleanup.
 * @param context - Optional Node test lifecycle; properties instead await close in their own finally block.
 * @returns The initialized Window, adapter, and asynchronous close operation.
 * @example const environment = await renderingWindow(); await environment.close();
 */
export async function renderingWindow(context?: TestContext) {
  const adapter = new ExtendedCanvasAdapter()
  let window: Window
  try {
    window = new Window({
      settings: { canvasAdapter: adapter, enableImageFileLoading: true },
    })
  } catch (error) {
    // A failed constructor still leaves the already created adapter to release.
    disposeAll([() => adapter.dispose()], [error])
    throw error
  }
  let dispose: ReturnType<typeof installCompatibility>
  try {
    dispose = installCompatibility(window)
  } catch (error) {
    const errors = [error]
    try {
      await window.happyDOM.close()
    } catch (cleanupError) {
      errors.push(cleanupError)
    }
    // Keep the setup error alongside any Window or adapter cleanup failures.
    disposeAll([() => adapter.dispose()], errors)
    throw error
  }
  const close = async (): Promise<void> => {
    const errors: unknown[] = []
    try {
      await adapter.drain()
    } catch (error) {
      errors.push(error)
    }
    try {
      await window.happyDOM.close()
    } catch (error) {
      errors.push(error)
    }
    // Every stage runs, and later cleanup errors must not hide the first failure.
    disposeAll([dispose, () => adapter.dispose()], errors)
  }
  context?.after(close)
  return { window, adapter, close }
}
