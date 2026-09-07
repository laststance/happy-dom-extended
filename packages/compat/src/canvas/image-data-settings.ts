import type { ICanvasAdapterCaller } from 'happy-dom'
import conversions from 'webidl-conversions'

import { conversionOptions } from './utils/conversion-options.ts'

/** Reads ImageData dictionary members once before constructor/readback validation in WebIDL order.
 * @returns Valid color-space and pixel-format requests; renderer support is checked after argument conversion.
 * @example imageDataSettings(window, { colorSpace: 'display-p3' }).colorSpace; // display-p3
 */
export function imageDataSettings(
  window: ICanvasAdapterCaller['window'],
  value: unknown,
) {
  const dictionary = value ?? {}
  if (typeof dictionary !== 'object' && typeof dictionary !== 'function')
    throw new window.TypeError('ImageData settings must be a dictionary.')
  const colorValue: unknown = Reflect.get(dictionary, 'colorSpace')
  const colorSpace =
    colorValue === undefined
      ? 'srgb'
      : conversions.DOMString(colorValue, conversionOptions(window))
  if (colorSpace !== 'srgb' && colorSpace !== 'display-p3')
    throw new window.TypeError('Unknown ImageData color space.')
  const formatValue: unknown = Reflect.get(dictionary, 'pixelFormat')
  const pixelFormat =
    formatValue === undefined
      ? 'rgba-unorm8'
      : conversions.DOMString(formatValue, conversionOptions(window))
  if (pixelFormat !== 'rgba-unorm8' && pixelFormat !== 'rgba-float16')
    throw new window.TypeError('Unknown ImageData pixel format.')
  return { colorSpace, pixelFormat }
}
