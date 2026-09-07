import type { ICanvasAdapterCaller } from 'happy-dom'

import { RGBA_BYTES_PER_PIXEL } from '../constants.ts'

/** Validates supplied byte pixels before ImageData construction can retain a malformed or detached buffer.
 * @returns The exact row count; omitted height is inferred without copying caller storage.
 * @example imageDataHeight(window, new Uint8ClampedArray(8), 1, undefined); // 2
 */
export function imageDataHeight(
  window: ICanvasAdapterCaller['window'],
  pixels: Uint8ClampedArray,
  width: number,
  height: number | undefined,
): number {
  if (!pixels.byteLength || pixels.byteLength % RGBA_BYTES_PER_PIXEL)
    throw new window.DOMException(
      'ImageData requires complete nonempty RGBA pixels.',
      'InvalidStateError',
    )
  const rows = pixels.length / RGBA_BYTES_PER_PIXEL / width
  if (!Number.isInteger(rows) || (height !== undefined && height !== rows))
    throw new window.DOMException(
      'ImageData dimensions do not match its pixels.',
      'IndexSizeError',
    )
  return rows
}
