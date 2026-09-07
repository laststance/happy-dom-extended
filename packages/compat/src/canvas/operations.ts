import { DOMMatrix } from 'skia-canvas'

import { PIXEL_DRAWING_METHODS } from './constants.ts'
import { bindGradient } from './gradient.ts'
import { readImageData, writeImageData } from './image-data.ts'
import { createPattern, drawImage } from './image-sources.ts'
import { canvasArguments } from './method-arguments.ts'
import type { CanvasMethod, CanvasState } from './types.ts'
import { flattenOpaque } from './utils/flatten-opaque.ts'

/** Dispatches stable context methods through their Web API bindings before invoking the native renderer.
 * @returns The method's Web API result, preserving errors from caller code.
 * @example invokeCanvasMethod(state, 'fillRect', method, [0, 0, 1, 1]);
 */
export function invokeCanvasMethod(
  state: CanvasState,
  key: PropertyKey,
  method: CanvasMethod,
  argumentsList: unknown[],
): unknown {
  if (state.unavailable)
    throw new state.caller.window.DOMException(
      'Canvas is unavailable.',
      'InvalidStateError',
    )
  switch (key) {
    case 'getContextAttributes':
      return { ...state.settings }
    case 'getImageData':
    case 'createImageData':
      return readImageData(state, key, method, argumentsList)
    case 'putImageData':
      return writeImageData(state, method, argumentsList)
    case 'drawImage':
      return drawImage(state, method, argumentsList)
    case 'createPattern':
      return createPattern(state, method, argumentsList)
  }
  const converted = canvasArguments(state.caller.window, key, argumentsList)
  if (converted === null)
    return String(key).startsWith('isPoint') ? false : undefined
  const drawsPixels = PIXEL_DRAWING_METHODS.has(key)
  if (drawsPixels && (!state.width || !state.height)) return
  const result = Reflect.apply(method, state.nativeContext, converted)
  if (key === 'getTransform') {
    if (!(result instanceof DOMMatrix))
      throw new state.caller.window.TypeError(
        'Renderer returned an invalid transform.',
      )
    const { a, b, c, d, e, f } = result
    return new state.caller.window.DOMMatrix([a, b, c, d, e, f])
  }
  if (
    [
      'createLinearGradient',
      'createRadialGradient',
      'createConicGradient',
    ].includes(String(key))
  )
    return bindGradient(state.caller.window, result)
  // Reset discards all pixels and saved styles, so previously cross-origin content no longer taints the bitmap.
  if (key === 'reset') state.originClean = true
  if (drawsPixels || key === 'reset') flattenOpaque(state)
  return result
}
