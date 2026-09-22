import { loadSkiaCanvas } from '../../compat/src/canvas/load-skia-canvas.ts'

/** Vitest `globalSetup` hook that loads skia-canvas's native binary in the main thread before `threads` or `vmThreads` workers start.
 * Windows unmaps an addon when the last worker thread that loaded it exits, while skia-canvas's own native threads still run its code; a main-thread load keeps it mapped.
 * Vitest passes its TestProject as the first argument, so the hook takes no parameters.
 * @returns Nothing; throws skia-canvas install guidance when the native binary is missing.
 * @example
 * // vitest.config.ts
 * export default defineConfig({ test: { pool: 'threads', environment: 'happy-dom-extended', globalSetup: ['vitest-environment-happy-dom-extended/global-setup'] } })
 */
export function setup(): void {
  loadSkiaCanvas()
}
