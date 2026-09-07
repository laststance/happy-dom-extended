import type { ICanvasAdapterCaller } from 'happy-dom'
import conversions from 'webidl-conversions'

import { conversionOptions } from './utils/conversion-options.ts'

/** Reads ImageBitmap options in WebIDL dictionary order before source pixels are sampled.
 * @returns Validated crop/render options with optional bounded unsigned resize dimensions.
 * @example bitmapOptions(window, { resizeWidth: 2, imageOrientation: 'flipY' });
 */
export function bitmapOptions(
  window: ICanvasAdapterCaller['window'],
  value: unknown,
) {
  const dictionary = value ?? {}
  if (typeof dictionary !== 'object' && typeof dictionary !== 'function')
    throw new window.TypeError('ImageBitmap options must be a dictionary.')
  const enumValue = (
    key: string,
    values: readonly string[],
    fallback: string,
  ): string => {
    const candidate: unknown = Reflect.get(dictionary, key)
    if (candidate === undefined) return fallback
    const text = conversions.DOMString(candidate, conversionOptions(window))
    if (!values.includes(text))
      throw new window.TypeError('Unknown ImageBitmap option.')
    return text
  }
  const dimension = (key: string): number | undefined => {
    const candidate: unknown = Reflect.get(dictionary, key)
    return candidate === undefined
      ? undefined
      : conversions['unsigned long'](candidate, {
          ...conversionOptions(window),
          enforceRange: true,
        })
  }
  const colorSpaceConversion = enumValue(
    'colorSpaceConversion',
    ['none', 'default'],
    'default',
  )
  const imageOrientation = enumValue(
    'imageOrientation',
    ['from-image', 'flipY'],
    'from-image',
  )
  const premultiplyAlpha = enumValue(
    'premultiplyAlpha',
    ['none', 'premultiply', 'default'],
    'default',
  )
  const resizeHeight = dimension('resizeHeight')
  const resizeQuality = enumValue(
    'resizeQuality',
    ['pixelated', 'low', 'medium', 'high'],
    'low',
  )
  const resizeWidth = dimension('resizeWidth')
  return {
    colorSpaceConversion,
    imageOrientation,
    premultiplyAlpha,
    resizeHeight,
    resizeQuality,
    resizeWidth,
  }
}
