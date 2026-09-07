import type { ICanvasAdapterCaller } from 'happy-dom'

import {
  MAX_CANVAS_DIMENSION_PX,
  MAX_CANVAS_PIXELS,
  RGBA_BYTES_PER_PIXEL,
} from '../constants.ts'

/** Validates logical raster sizes before Canvas allocation, readback or source conversion enters native code.
 * @returns The required RGBA byte count; a logical zero dimension uses no pixel storage.
 * @example pixelBytes(window, 2, 1); // 8
 */
export function pixelBytes(
  window: ICanvasAdapterCaller['window'],
  width: number,
  height: number,
): number {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 0 ||
    height < 0
  )
    throw new window.RangeError(
      'Canvas dimensions must be nonnegative integers.',
    )
  if (!width || !height) return 0
  if (
    width > MAX_CANVAS_DIMENSION_PX ||
    height > MAX_CANVAS_DIMENSION_PX ||
    width * height > MAX_CANVAS_PIXELS
  )
    throw new window.RangeError(
      'Canvas exceeds the supported native raster size.',
    )
  return width * height * RGBA_BYTES_PER_PIXEL
}
