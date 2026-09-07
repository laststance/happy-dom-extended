import type { ICanvasAdapterCaller } from 'happy-dom'
import conversions from 'webidl-conversions'

import { conversionOptions } from './utils/conversion-options.ts'

/** Converts the first getContext dictionary once in WebIDL member order, reporting the renderer's effective settings.
 * @returns Supported context settings; invalid dictionaries/enums use the caller's TypeError.
 * @example contextSettings(window, { alpha: false, colorSpace: 'display-p3' }).colorSpace; // srgb
 */
export function contextSettings(
  window: ICanvasAdapterCaller['window'],
  attributes: unknown,
) {
  const dictionary = attributes ?? {}
  if (typeof dictionary !== 'object' && typeof dictionary !== 'function')
    throw new window.TypeError('Canvas context settings must be a dictionary.')
  const alpha: unknown = Reflect.get(dictionary, 'alpha')
  const colorSpace: unknown = Reflect.get(dictionary, 'colorSpace')
  if (
    colorSpace !== undefined &&
    !['srgb', 'display-p3'].includes(
      conversions.DOMString(colorSpace, conversionOptions(window)),
    )
  )
    throw new window.TypeError('Unknown Canvas color space.')
  const colorType: unknown = Reflect.get(dictionary, 'colorType')
  if (
    colorType !== undefined &&
    !['unorm8', 'float16'].includes(
      conversions.DOMString(colorType, conversionOptions(window)),
    )
  )
    throw new window.TypeError('Unknown Canvas color type.')
  // Reading each declared member once preserves consumer getter ordering even when an optimization is unavailable.
  Reflect.get(dictionary, 'desynchronized')
  const willReadFrequently: unknown = Reflect.get(
    dictionary,
    'willReadFrequently',
  )
  return {
    alpha: alpha === undefined ? true : Boolean(alpha),
    colorSpace: 'srgb' as const,
    colorType: 'unorm8' as const,
    desynchronized: false,
    willReadFrequently: Boolean(willReadFrequently),
  }
}
