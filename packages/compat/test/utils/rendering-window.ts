import type { TestContext } from 'node:test'

import { Window } from 'happy-dom'

import {
  ExtendedCanvasAdapter,
  disposeAll,
  installCompatibility,
} from '../../src/index.ts'

/** Gives regressions and each generated case a real Window with complete, repeatable cleanup.
 * @param context - Optional Node test lifecycle; properties instead await close in their own finally block.
 * @returns The Window, adapter, and asynchronous close operation.
 * @example const environment = renderingWindow(); await environment.close();
 */
export function renderingWindow(context?: TestContext) {
  const adapter = new ExtendedCanvasAdapter()
  const window = new Window({
    settings: { canvasAdapter: adapter, enableImageFileLoading: true },
  })
  const dispose = installCompatibility(window)
  const close = async (): Promise<void> => {
    try {
      await adapter.drain()
    } finally {
      try {
        await window.happyDOM.close()
      } finally {
        // Restoration must also run when native output or Window shutdown fails.
        disposeAll([dispose, () => adapter.dispose()])
      }
    }
  }
  context?.after(close)
  return { window, adapter, close }
}
