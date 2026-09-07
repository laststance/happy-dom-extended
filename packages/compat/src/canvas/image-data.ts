import { ImageData } from 'happy-dom'
import { ImageData as NativeImageData } from 'skia-canvas'
import conversions from 'webidl-conversions'

import { MAX_COLOR_CHANNEL, RGBA_BYTES_PER_PIXEL } from './constants.ts'
import { imageDataSettings } from './image-data-settings.ts'
import { imageDataColorSpaces } from './state.ts'
import type { CanvasMethod, CanvasState } from './types.ts'
import { conversionOptions } from './utils/conversion-options.ts'
import { convertPixelColors } from './utils/convert-pixel-colors.ts'
import { flattenOpaque } from './utils/flatten-opaque.ts'
import { pixelBytes } from './utils/pixel-bytes.ts'

/** Reads or creates bounded pixels for context bindings while returning the calling Window's ImageData family.
 * @returns ImageData whose view belongs to the test VM.
 * @example context.getImageData(0, 0, 1, 1).data instanceof window.Uint8ClampedArray;
 */
export function readImageData(
  state: CanvasState,
  key: 'getImageData' | 'createImageData',
  method: CanvasMethod,
  argumentsList: unknown[],
): ImageData {
  const window = state.caller.window
  const [source] = argumentsList
  if (
    key === 'createImageData' &&
    argumentsList.length === 1 &&
    source instanceof ImageData
  ) {
    pixelBytes(window, source.width, source.height)
    return Reflect.construct(window.ImageData, [
      source.width,
      source.height,
      { colorSpace: imageDataColorSpaces.get(source) ?? 'srgb' },
    ])
  }
  const required = key === 'getImageData' ? 4 : 2
  if (argumentsList.length < required)
    throw new window.TypeError('Missing image-data dimensions.')
  const numbers = argumentsList.slice(0, required).map((value) =>
    conversions.long(value, {
      ...conversionOptions(window),
      enforceRange: true,
    }),
  )
  const width = Math.abs(numbers.at(-2)!)
  const height = Math.abs(numbers.at(-1)!)
  const settings = imageDataSettings(window, argumentsList[required])
  if (!width || !height)
    throw new window.DOMException(
      'Image data must have nonzero dimensions.',
      'IndexSizeError',
    )
  if (key === 'getImageData' && !state.originClean)
    throw new window.DOMException(
      'Canvas is not origin-clean.',
      'SecurityError',
    )
  if (settings.pixelFormat !== 'rgba-unorm8')
    throw new window.DOMException(
      'Floating-point ImageData is not supported by this byte-based Canvas implementation.',
      'NotSupportedError',
    )
  const bytes = pixelBytes(window, width, height)
  if (key === 'createImageData')
    return Reflect.construct(window.ImageData, [width, height, settings])
  const release = state.reserveStorage(bytes)
  try {
    const result = Reflect.apply(method, state.nativeContext, numbers)
    if (!(result instanceof NativeImageData))
      throw new window.TypeError('Renderer returned invalid ImageData.')
    convertPixelColors(result.data, 'srgb', settings.colorSpace)
    return Reflect.construct(window.ImageData, [
      new window.Uint8ClampedArray(
        result.data.buffer,
        result.data.byteOffset,
        result.data.length,
      ),
      result.width,
      result.height,
      settings,
    ])
  } finally {
    release()
  }
}

/** Copies caller pixels at putImageData invocation, preserving shared buffers, view offsets and dirty rectangles.
 * @returns Nothing; malformed or detached inputs fail before native drawing.
 * @example context.putImageData(new window.ImageData(pixels, 1), 0, 0);
 */
export function writeImageData(
  state: CanvasState,
  method: CanvasMethod,
  argumentsList: unknown[],
): void {
  const window = state.caller.window
  const [source] = argumentsList
  if (
    (argumentsList.length !== 3 && argumentsList.length < 7) ||
    !(source instanceof ImageData)
  )
    throw new window.TypeError(
      'putImageData requires ImageData and coordinates.',
    )
  const numbers = argumentsList
    .slice(1, argumentsList.length >= 7 ? 7 : 3)
    .map((value) =>
      conversions.long(value, {
        ...conversionOptions(window),
        enforceRange: true,
      }),
    )
  if (source.data.byteLength === 0)
    throw new window.DOMException(
      'ImageData storage is detached.',
      'InvalidStateError',
    )
  const bytes = pixelBytes(window, source.width, source.height)
  if (!state.width || !state.height) return
  const release = state.reserveStorage(bytes)
  try {
    const pixels = new Uint8ClampedArray(source.data)
    convertPixelColors(
      pixels,
      imageDataColorSpaces.get(source) ?? 'srgb',
      'srgb',
    )
    // putImageData replaces colors wholesale; an opaque destination ignores the supplied alpha byte.
    if (!state.settings.alpha) {
      for (
        let offset = RGBA_BYTES_PER_PIXEL - 1;
        offset < pixels.length;
        offset += RGBA_BYTES_PER_PIXEL
      )
        pixels[offset] = MAX_COLOR_CHANNEL
    }
    Reflect.apply(method, state.nativeContext, [
      new NativeImageData(pixels, source.width, source.height),
      ...numbers,
    ])
  } finally {
    release()
  }
  flattenOpaque(state)
}
