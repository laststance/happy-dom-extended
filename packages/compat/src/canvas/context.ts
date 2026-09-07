import type { ICanvasRenderingContext2D } from 'happy-dom'

import { NATIVE_CANVAS, PIXEL_DRAWING_METHODS } from './constants.ts'
import { invokeCanvasMethod } from './operations.ts'
import { requestCanvasPresentation } from './presentation.ts'
import { setCanvasProperty } from './properties.ts'
import type { CanvasState } from './types.ts'

/** Exposes the DOM owner and Window image types while retaining native receivers for {@link ExtendedCanvasAdapter}.
 * @param state - Canvas owner, renderer and lifetime being exposed.
 * @returns A stable context that permits normal consumer spies and method replacement.
 * @example canvas.getContext('2d').canvas === canvas;
 */
export function createCanvasContext(
  state: CanvasState,
): ICanvasRenderingContext2D {
  const { caller, nativeContext: context, bitmap } = state
  const methods = new Map<
    PropertyKey,
    { original: unknown; bound: (...argumentsList: unknown[]) => unknown }
  >()
  const replacements = new Map<PropertyKey, unknown>()

  /** Tracks successful consumer mutations for the proxy traps without treating restored methods as overrides.
   * @returns Whether the property mutation succeeded.
   * @example updateReplacement('drawImage', () => Reflect.defineProperty(context, 'drawImage', descriptor));
   */
  function updateReplacement(key: PropertyKey, mutate: () => boolean): boolean {
    const original = replacements.has(key)
      ? replacements.get(key)
      : Reflect.get(context, key, context)
    if (!mutate()) return false
    const descriptor = Reflect.getOwnPropertyDescriptor(context, key)
    const cached = methods.get(key)
    // Inspect descriptors so installing a consumer getter does not execute it.
    if (
      !descriptor ||
      ('value' in descriptor &&
        (descriptor.value === original ||
          (cached && descriptor.value === cached.bound)))
    ) {
      replacements.delete(key)
    } else {
      replacements.set(key, original)
    }
    return true
  }

  // Keep the adapter's existing own-method descriptors so descriptor-based spies can restore the original bindings.
  for (const key of [
    'createImageData',
    'getImageData',
    'putImageData',
    'drawImage',
  ]) {
    Object.defineProperty(context, key, {
      configurable: true,
      writable: true,
      value: Reflect.get(context, key),
    })
  }
  Object.defineProperty(context, 'getContextAttributes', {
    configurable: true,
    writable: true,
    value: () => ({ ...state.settings }),
  })
  const proxy = new Proxy(context, {
    get(target, key) {
      if (key === 'canvas') return caller.canvas
      if (key === NATIVE_CANVAS) return bitmap
      const original = Reflect.get(target, key, target)
      // Return consumer replacements verbatim so Jest spies retain mockRestore and call metadata.
      if (replacements.has(key)) return original
      if (typeof original !== 'function') return original
      const cached = methods.get(key)
      if (cached && (cached.original === original || cached.bound === original))
        return cached.bound
      const bound = (...argumentsList: unknown[]): unknown => {
        const result = invokeCanvasMethod(state, key, original, argumentsList)
        if (
          PIXEL_DRAWING_METHODS.has(key) ||
          ['drawImage', 'putImageData', 'reset'].includes(String(key))
        )
          requestCanvasPresentation(caller.canvas)
        return result
      }
      methods.set(key, { original, bound })
      return bound
    },
    set(target, key, value) {
      const handled = setCanvasProperty(state, key, value)
      if (handled !== undefined) return handled
      return updateReplacement(key, () =>
        Reflect.set(target, key, value, target),
      )
    },
    defineProperty(target, key, descriptor) {
      return updateReplacement(key, () =>
        Reflect.defineProperty(target, key, descriptor),
      )
    },
    deleteProperty(target, key) {
      return updateReplacement(key, () => Reflect.deleteProperty(target, key))
    },
  })
  // The proxy translates source/ImageData brands; Happy DOM's interface also includes optional Cairo-only extensions.
  return proxy as unknown as ICanvasRenderingContext2D
}
