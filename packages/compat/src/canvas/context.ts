import { Canvas, CanvasRenderingContext2D } from 'canvas'
import { HTMLCanvasElement, ImageData, OffscreenCanvas } from 'happy-dom'
import type { ICanvasAdapterCaller, ICanvasRenderingContext2D } from 'happy-dom'

import { NATIVE_CANVAS } from './constants.ts'

/** Exposes the DOM owner and Window image types while retaining native method receivers for {@link ExtendedCanvasAdapter}.
 * @param caller - Window and DOM canvas requesting the context.
 * @param context - Official adapter context, whose native canvas property must stay writable.
 * @param bitmap - Native pixels used for drawing and encoding.
 * @returns A stable view that also permits normal consumer spies and method replacement.
 * @example createCanvasContext(caller, context, bitmap).canvas === caller.canvas;
 */
export function createCanvasContext(
  caller: ICanvasAdapterCaller,
  context: ICanvasRenderingContext2D,
  bitmap: Canvas,
): ICanvasRenderingContext2D {
  const methods = new Map<
    PropertyKey,
    { original: unknown; bound: (...argumentsList: unknown[]) => unknown }
  >()
  const replacements = new Set<PropertyKey>()
  return new Proxy(context, {
    get(target, key) {
      if (key === 'canvas') return caller.canvas
      if (key === NATIVE_CANVAS) return bitmap
      const original = Reflect.get(target, key, target)
      // Return consumer replacements verbatim so Jest spies retain mockRestore and call metadata.
      if (replacements.has(key)) return original
      if (typeof original !== 'function') return original
      const cached = methods.get(key)
      if (cached && cached.original === original) return cached.bound
      const bound = (...argumentsList: unknown[]): unknown => {
        const [source] = argumentsList
        if (
          (key === 'drawImage' || key === 'createPattern') &&
          (source instanceof HTMLCanvasElement ||
            source instanceof OffscreenCanvas)
        ) {
          const sourceContext = source.getContext('2d')
          const sourceBitmap: unknown =
            sourceContext &&
            (Reflect.get(sourceContext, NATIVE_CANVAS) ??
              Reflect.get(sourceContext, 'canvas'))
          if (sourceBitmap instanceof Canvas) {
            // Resolve through the source owner so resized and other-environment canvases use their actual pixels.
            return Reflect.apply(
              CanvasRenderingContext2D.prototype[key],
              target,
              [sourceBitmap, ...argumentsList.slice(1)],
            )
          }
        }
        const result: unknown = Reflect.apply(original, target, argumentsList)
        if (
          (key === 'getImageData' || key === 'createImageData') &&
          result instanceof ImageData
        ) {
          return new caller.window.ImageData(
            new caller.window.Uint8ClampedArray(
              result.data.buffer,
              result.data.byteOffset,
              result.data.length,
            ),
            result.width,
            result.height,
          )
        }
        return result
      }
      methods.set(key, { original, bound })
      return bound
    },
    set(target, key, value) {
      replacements.add(key)
      return Reflect.set(target, key, value, target)
    },
    defineProperty(target, key, descriptor) {
      replacements.add(key)
      return Reflect.defineProperty(target, key, descriptor)
    },
    deleteProperty(target, key) {
      replacements.delete(key)
      return Reflect.deleteProperty(target, key)
    },
  })
}
