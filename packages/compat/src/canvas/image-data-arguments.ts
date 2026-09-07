import { types } from 'node:util'

import type { ICanvasAdapterCaller } from 'happy-dom'
import conversions from 'webidl-conversions'

import { imageDataSettings } from './image-data-settings.ts'
import { conversionOptions } from './utils/conversion-options.ts'
import { imageDataHeight } from './utils/image-data-height.ts'
import { pixelBytes } from './utils/pixel-bytes.ts'

/** Converts constructor overloads before allocating pixels, retaining supplied arrays and rejecting inconsistent dimensions.
 * @returns Validated dimensions, original or newly allocated Window pixels, and their color space.
 * @example imageDataArguments(window, [new window.Uint8ClampedArray(8), 1]).height; // 2
 */
export function imageDataArguments(
  window: ICanvasAdapterCaller['window'],
  argumentsList: unknown[],
) {
  if (argumentsList.length < 2)
    throw new window.TypeError('ImageData requires at least two arguments.')
  const [source] = argumentsList
  // Float16Array is absent on supported Node 22; never advertise a floating-point surface as byte storage.
  const float16Check: unknown = Reflect.get(types, 'isFloat16Array')
  const isFloat =
    typeof float16Check === 'function' && float16Check(source) === true
  const isView = types.isUint8ClampedArray(source) || isFloat
  const dimensionIndex = isView ? 1 : 0
  const width = conversions['unsigned long'](
    argumentsList[dimensionIndex],
    conversionOptions(window),
  )
  let height =
    isView && argumentsList[2] === undefined
      ? undefined
      : conversions['unsigned long'](
          argumentsList[dimensionIndex + 1],
          conversionOptions(window),
        )
  const settings = imageDataSettings(window, argumentsList[dimensionIndex + 2])
  if (types.isUint8ClampedArray(source)) {
    height = imageDataHeight(window, source, width, height)
    if (settings.pixelFormat !== 'rgba-unorm8')
      throw new window.DOMException(
        'Byte pixels require rgba-unorm8.',
        'InvalidStateError',
      )
  }
  if (!width || !height)
    throw new window.DOMException(
      'ImageData dimensions must be nonzero.',
      'IndexSizeError',
    )
  if (isFloat || settings.pixelFormat !== 'rgba-unorm8')
    throw new window.DOMException(
      'Floating-point ImageData is not supported by this byte-based Canvas implementation.',
      'NotSupportedError',
    )
  const bytes = pixelBytes(window, width, height)
  return {
    width,
    height,
    pixels: types.isUint8ClampedArray(source)
      ? source
      : new window.Uint8ClampedArray(bytes),
    colorSpace: settings.colorSpace,
  }
}
