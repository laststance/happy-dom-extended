import { createRequire } from 'node:module'

import type * as SkiaCanvas from 'skia-canvas'

import { toSkiaInstallError } from '../utils/skia-install-error.ts'

// One CommonJS instance serves the ESM source, the Vitest ESM bundles and the Jest CommonJS bundle, like happy-dom-internals.ts.
const require = createRequire(import.meta.url)

/** Loads skia-canvas; tests inject failures while production uses this bundle's CommonJS require. */
type LoadSkiaCanvas = (specifier: 'skia-canvas') => typeof SkiaCanvas

/** Requires skia-canvas so a missing native binary fails with install guidance; the Canvas modules and the Vitest global setup call it.
 * A static `import … from 'skia-canvas'` evaluates skia-canvas before this bundle's own code, so nothing could explain the blocked install script.
 * Importing this module loads nothing, so the global setup entry stays free of side effects until Vitest calls it.
 * @param load - Module loader; defaults to this bundle's require.
 * @returns
 * - The skia-canvas module when its native binary loads
 * - Throws the result of {@link toSkiaInstallError} when loading fails
 * @example const { Canvas } = loadSkiaCanvas() // => skia-canvas's Canvas class
 */
export function loadSkiaCanvas(
  load: LoadSkiaCanvas = require,
): typeof SkiaCanvas {
  try {
    return load('skia-canvas')
  } catch (error) {
    throw toSkiaInstallError(error)
  }
}
