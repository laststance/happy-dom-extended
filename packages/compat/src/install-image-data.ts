import { types } from 'node:util'

import type { Window } from 'happy-dom'

import { PROBE_IMAGE_WIDTH_PX, RGBA_CHANNEL_COUNT } from './constants.ts'
import type { DisposeCompatibility } from './types.ts'
import { replaceProperty } from './utils/replace-property.ts'

/** Checks whether ImageData already accepts pixels allocated in the test's VM.
 * @param window - Environment to probe.
 * @returns Whether the upstream implementation needs an ArrayBuffer realm bridge.
 * @example needsImageDataBridge(window);
 */
function needsImageDataBridge(window: Window): boolean {
  try {
    new window.ImageData(
      new window.Uint8ClampedArray(RGBA_CHANNEL_COUNT),
      PROBE_IMAGE_WIDTH_PX,
    )
    return false
  } catch {
    return true
  }
}

/** Bridges VM pixel arrays to Happy DOM while retaining the caller's data reference and shared storage.
 * @param window - Environment to patch after its built-in constructors are installed.
 * @param restorers - Shared teardown registry, updated immediately after each mutation.
 * @returns Nothing; registers cleanup for the runner.
 * @example installImageData(window, restorers);
 */
export function installImageData(
  window: Window,
  restorers: DisposeCompatibility[],
): void {
  if (!needsImageDataBridge(window)) return
  const implementation = new Proxy(window.ImageData, {
    construct(target, argumentsList: unknown[], newTarget) {
      const [pixels, ...dimensions] = argumentsList
      if (
        !types.isUint8ClampedArray(pixels) ||
        Uint8ClampedArray.prototype.isPrototypeOf(pixels)
      ) {
        return Reflect.construct(target, argumentsList, newTarget)
      }
      const nativePixels = new Uint8ClampedArray(
        pixels.buffer,
        pixels.byteOffset,
        pixels.length,
      )
      const image = Reflect.construct(
        target,
        [nativePixels, ...dimensions],
        newTarget,
      )
      // The view shares bytes; callers also retain the original data object's identity.
      Object.defineProperty(image, 'data', {
        configurable: true,
        enumerable: true,
        get: () => pixels,
      })
      return image
    },
  })
  restorers.push(
    replaceProperty(window, 'ImageData', {
      value: implementation,
      writable: true,
    }),
  )
}
