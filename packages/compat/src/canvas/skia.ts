import { createRequire } from 'node:module'

import type * as SkiaCanvas from 'skia-canvas'

import { toSkiaInstallError } from '../utils/skia-install-error.ts'

// One CommonJS instance serves the ESM source, the Vitest ESM bundle and the Jest CommonJS bundle, like happy-dom-internals.ts.
const require = createRequire(import.meta.url)

/** Loads skia-canvas; tests inject failures while production uses this bundle's CommonJS require. */
type LoadSkiaCanvas = (specifier: 'skia-canvas') => typeof SkiaCanvas

/** Requires skia-canvas once for every Canvas module, so a missing native binary fails with install guidance.
 * A static `import … from 'skia-canvas'` evaluates skia-canvas before this bundle's own code, so nothing could explain the blocked install script.
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

const skiaCanvas = loadSkiaCanvas()

// Each class keeps skia-canvas's value; the Canvas modules also annotate with the Canvas, Image and ImageData instance types.
export const Canvas = skiaCanvas.Canvas
export type Canvas = SkiaCanvas.Canvas
export const CanvasGradient = skiaCanvas.CanvasGradient
export const CanvasPattern = skiaCanvas.CanvasPattern
export const DOMMatrix = skiaCanvas.DOMMatrix
export const Image = skiaCanvas.Image
export type Image = SkiaCanvas.Image
export const ImageData = skiaCanvas.ImageData
export type ImageData = SkiaCanvas.ImageData
export const Path2D = skiaCanvas.Path2D
