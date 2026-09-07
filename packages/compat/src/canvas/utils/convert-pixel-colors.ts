import { converter } from 'culori'

import { MAX_COLOR_CHANNEL, RGBA_BYTES_PER_PIXEL } from '../constants.ts'
import type { imageDataSettings } from '../image-data-settings.ts'

/** Converts unpremultiplied ImageData channels in place when pixels cross the renderer's sRGB boundary.
 * @returns Nothing; relative-colorimetric conversion clips out-of-gamut channels and preserves alpha.
 * @example convertPixelColors(pixels, 'srgb', 'display-p3'); // red becomes [234, 51, 35, 255]
 */
export function convertPixelColors(
  pixels: Uint8ClampedArray,
  source: ReturnType<typeof imageDataSettings>['colorSpace'],
  destination: ReturnType<typeof imageDataSettings>['colorSpace'],
): void {
  if (source === destination) return
  const convert = converter(destination === 'srgb' ? 'rgb' : 'p3')
  // Each pixel is independent; changing the color space must never change its opacity.
  for (let offset = 0; offset < pixels.length; offset += RGBA_BYTES_PER_PIXEL) {
    const color = convert({
      mode: source === 'srgb' ? 'rgb' : 'p3',
      r: pixels[offset]! / MAX_COLOR_CHANNEL,
      g: pixels[offset + 1]! / MAX_COLOR_CHANNEL,
      b: pixels[offset + 2]! / MAX_COLOR_CHANNEL,
    })
    pixels[offset] = color.r * MAX_COLOR_CHANNEL
    pixels[offset + 1] = color.g * MAX_COLOR_CHANNEL
    pixels[offset + 2] = color.b * MAX_COLOR_CHANNEL
  }
}
