import { MAX_COLOR_CHANNEL, RGBA_BYTES_PER_PIXEL } from '../constants.ts'
import type { CanvasState } from '../types.ts'

import { pixelBytes } from './pixel-bytes.ts'

/** Preserves opaque black backing after drawing/reset because the renderer exposes only alpha-enabled surfaces.
 * @returns Nothing; pixels are flattened without changing the consumer's transform, clip or drawing state.
 * @example context.clearRect(0, 0, 1, 1); // alpha:false remains opaque black.
 */
export function flattenOpaque(state: CanvasState): void {
  if (state.settings.alpha || !state.width || !state.height) return
  // ponytail: O(pixel count) for alpha:false; replace with native opaque surfaces when the renderer supports them.
  const release = state.reserveStorage(
    pixelBytes(state.caller.window, state.width, state.height),
  )
  try {
    const pixels = state.readPixels(0, 0, state.width, state.height)
    for (
      let offset = 0;
      offset < pixels.data.length;
      offset += RGBA_BYTES_PER_PIXEL
    ) {
      const opacity = pixels.data[offset + 3]! / MAX_COLOR_CHANNEL
      pixels.data[offset] = Math.round(pixels.data[offset]! * opacity)
      pixels.data[offset + 1] = Math.round(pixels.data[offset + 1]! * opacity)
      pixels.data[offset + 2] = Math.round(pixels.data[offset + 2]! * opacity)
      pixels.data[offset + 3] = MAX_COLOR_CHANNEL
    }
    state.writePixels(pixels, 0, 0)
  } finally {
    release()
  }
}
