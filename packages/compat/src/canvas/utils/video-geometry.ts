import type { ICanvasAdapterCaller } from 'happy-dom'

import { HALF_TURN_DEGREES, RIGHT_ANGLE_DEGREES } from '../constants.ts'

import { pixelBytes } from './pixel-bytes.ts'

/** Bounds both encoded and displayed video dimensions before FFmpeg decodes, including pixel aspect and rotation metadata.
 * @returns Positive displayed dimensions after native autorotation and square-pixel scaling.
 * @example videoGeometry(window, { width: 16, height: 16 }); // { width: 16, height: 16 }
 */
export function videoGeometry(
  window: ICanvasAdapterCaller['window'],
  stream: object,
) {
  const width = Number(Reflect.get(stream, 'width'))
  const height = Number(Reflect.get(stream, 'height'))
  pixelBytes(window, width, height)
  const aspect: unknown = Reflect.get(stream, 'sample_aspect_ratio')
  const [numerator, denominator] =
    typeof aspect === 'string' ? aspect.split(':').map(Number) : [1, 1]
  const ratio = numerator && denominator ? numerator / denominator : 1
  const sideData: unknown = Reflect.get(stream, 'side_data_list')
  let rotation = 0
  if (Array.isArray(sideData)) {
    for (const value of sideData) {
      if (value && typeof value === 'object' && 'rotation' in value) {
        rotation = Number(value.rotation)
        break
      }
    }
  }
  if (rotation % RIGHT_ANGLE_DEGREES !== 0)
    throw new window.TypeError('Video requires right-angle display rotation.')
  const swapped = Math.abs(rotation % HALF_TURN_DEGREES) === RIGHT_ANGLE_DEGREES
  const displayedWidth = Math.round(swapped ? height : width * ratio)
  const displayedHeight = Math.round(swapped ? width * ratio : height)
  if (!pixelBytes(window, displayedWidth, displayedHeight))
    throw new window.TypeError('Video has no pixels.')
  return { width: displayedWidth, height: displayedHeight }
}
