import type { ICanvasAdapterCaller } from 'happy-dom'
import {
  BrowserWindow,
  HTMLCanvasElement,
  HTMLImageElement,
  HTMLVideoElement,
  ImageBitmap,
  OffscreenCanvas,
  PropertySymbol,
} from 'happy-dom'
import type { Image } from 'skia-canvas'
import {
  Canvas,
  CanvasPattern,
  ImageData as NativeImageData,
} from 'skia-canvas'
import conversions from 'webidl-conversions'

import { disposeAll } from '../utils/dispose-all.ts'

import { NATIVE_CANVAS } from './constants.ts'
import { decodeCanvasImage, imageSources } from './images.ts'
import { htmlPlaceholders } from './presentation.ts'
import {
  canvasStates,
  canvasWindows,
  detachedOffscreens,
  patternOrigins,
} from './state.ts'
import type { CanvasMethod, CanvasState } from './types.ts'
import { conversionOptions } from './utils/conversion-options.ts'
import { flattenOpaque } from './utils/flatten-opaque.ts'
import { matrixComponents } from './utils/matrix-components.ts'
import { pixelBytes } from './utils/pixel-bytes.ts'
import { videoSources } from './videos.ts'

/** Resolves an owned or foreign Canvas's actual current pixels for drawImage/createPattern bindings.
 * @returns Native pixels without replacing a foreign adapter's renderer.
 * @example canvasSource(window, sourceCanvas);
 */
function canvasSource(
  window: ICanvasAdapterCaller['window'],
  source: HTMLCanvasElement | OffscreenCanvas,
  releases: (() => void)[],
): Canvas | NativeImageData | null {
  if (source instanceof HTMLCanvasElement)
    source = htmlPlaceholders.get(source) ?? source
  if (source instanceof OffscreenCanvas && detachedOffscreens.has(source))
    throw new window.DOMException(
      'OffscreenCanvas is detached.',
      'InvalidStateError',
    )
  if (!source.width || !source.height)
    throw new window.DOMException(
      'The source canvas has no pixels.',
      'InvalidStateError',
    )
  pixelBytes(window, source.width, source.height)
  const owned = canvasStates.get(source)
  if (owned) return owned.bitmap
  const ownerWindow: unknown = Reflect.get(source, PropertySymbol.window)
  // Reading an untouched owned source must not permanently choose its context mode or settings.
  if (ownerWindow instanceof BrowserWindow && canvasWindows.has(ownerWindow)) {
    releases.push(
      canvasWindows
        .get(window)!
        .reserveStorage(
          window,
          pixelBytes(window, source.width, source.height),
        ),
    )
    return new NativeImageData(source.width, source.height)
  }
  const context = source.getContext('2d')
  const bitmap: unknown =
    context &&
    (Reflect.get(context, NATIVE_CANVAS) ?? Reflect.get(context, 'canvas'))
  if (bitmap instanceof Canvas) return bitmap
  if (!context) return null
  // Foreign adapters keep their renderer; copy its actual RGBA bytes at this invocation.
  releases.push(
    canvasWindows
      .get(window)!
      .reserveStorage(
        window,
        pixelBytes(window, source.width, source.height) * 2,
      ),
  )
  const pixels = context.getImageData(0, 0, source.width, source.height)
  return new NativeImageData(
    new Uint8ClampedArray(pixels.data),
    pixels.width,
    pixels.height,
  )
}

/** Validates the CanvasImageSource union before any later argument can run consumer coercion code.
 * @returns Nothing; unsupported source brands throw in the destination Window.
 * @example validateImageSource(window, image);
 */
export function validateImageSource(
  window: ICanvasAdapterCaller['window'],
  source: unknown,
): void {
  if (!(
    source instanceof ImageBitmap ||
    source instanceof HTMLCanvasElement ||
    source instanceof OffscreenCanvas ||
    source instanceof HTMLImageElement ||
    source instanceof HTMLVideoElement
  ))
    throw new window.TypeError('The source is not a Canvas image.')
}

/** Reads the current owned decode or a foreign adapter's loaded image without scheduling a future draw.
 * @returns Ready native pixels or null during loading; broken images throw InvalidStateError.
 * @example imageElementSource(window, image);
 */
function imageElementSource(
  window: ICanvasAdapterCaller['window'],
  source: HTMLImageElement,
  releases: (() => void)[],
): Image | null {
  const owned = imageSources.get(source)
  if (owned?.native) return owned.native
  if (owned?.status === 'loading' || owned?.status === 'cancelled') return null
  const buffer = source[PropertySymbol.buffer]
  if (buffer) {
    const decoded = decodeCanvasImage(
      window,
      canvasWindows.get(window)!,
      buffer,
    )
    releases.push(decoded.release)
    return decoded.native
  }
  if (source.complete && source.src)
    throw new window.DOMException(
      'The image could not be decoded.',
      'InvalidStateError',
    )
  return null
}

/** Samples image-source readiness once for Canvas bindings, never scheduling a deferred draw after loading.
 * @returns Usable native pixels or null for an incomplete source.
 * @example imageSource(window, image); // null while image is loading
 */
function resolveImageSource(
  window: ICanvasAdapterCaller['window'],
  source: unknown,
  releases: (() => void)[],
): Canvas | Image | NativeImageData | null {
  if (source instanceof ImageBitmap) {
    const canvas = source[PropertySymbol.canvas]
    if (!canvas)
      throw new window.DOMException(
        'ImageBitmap is closed.',
        'InvalidStateError',
      )
    return canvasSource(window, canvas, releases)
  }
  if (source instanceof HTMLCanvasElement || source instanceof OffscreenCanvas)
    return canvasSource(window, source, releases)
  if (source instanceof HTMLImageElement)
    return imageElementSource(window, source, releases)
  if (source instanceof HTMLVideoElement)
    return videoSources.get(source)?.native ?? null
  throw new window.TypeError('The source is not a Canvas image.')
}

/** Holds temporary source copies only until a draw, pattern or Bitmap consumer finishes using them.
 * @returns Invocation-time pixels with one idempotent release; failed acquisition releases partial storage.
 * @example const source = imageSource(window, canvas); try { draw(source.native); } finally { source.release(); }
 */
export function imageSource(
  window: ICanvasAdapterCaller['window'],
  source: unknown,
) {
  const releases: (() => void)[] = []
  try {
    const native = resolveImageSource(window, source, releases)
    return { native, release: () => disposeAll(releases) }
  } catch (error) {
    disposeAll(releases, [error])
    throw error
  }
}

/** Carries source security state independently from decode success or pixel contents.
 * @returns Whether an invocation may preserve a destination's origin-clean flag.
 * @example sourceOriginClean(crossOriginImage); // false without CORS
 */
export function sourceOriginClean(source: unknown): boolean {
  if (source instanceof HTMLCanvasElement)
    source = htmlPlaceholders.get(source) ?? source
  if (source instanceof HTMLImageElement)
    // Foreign decoded bytes carry no validated origin metadata, so readback must remain protected.
    return imageSources.get(source)?.originClean ?? false
  if (source instanceof HTMLVideoElement)
    return videoSources.get(source)?.originClean ?? true
  if (source instanceof HTMLCanvasElement || source instanceof OffscreenCanvas)
    return canvasStates.get(source)?.originClean ?? true
  if (source instanceof ImageBitmap)
    return sourceOriginClean(source[PropertySymbol.canvas])
  return true
}

/** Draws a source at invocation after WebIDL argument conversion and source validation.
 * @returns Nothing; nonfinite coordinates and incomplete images leave current pixels untouched.
 * @example context.drawImage(source, 0, 0);
 */
export function drawImage(
  state: CanvasState,
  method: CanvasMethod,
  argumentsList: unknown[],
): void {
  if (![3, 5].includes(argumentsList.length) && argumentsList.length < 9)
    throw new state.caller.window.TypeError('Missing image source arguments.')
  validateImageSource(state.caller.window, argumentsList[0])
  const count =
    argumentsList.length >= 9 ? 9 : argumentsList.length >= 5 ? 5 : 3
  const coordinates = argumentsList
    .slice(1, count)
    .map((value) =>
      conversions['unrestricted double'](
        value,
        conversionOptions(state.caller.window),
      ),
    )
  const source = imageSource(state.caller.window, argumentsList[0])
  try {
    if (
      !coordinates.every(Number.isFinite) ||
      !source.native ||
      !state.width ||
      !state.height
    )
      return
    Reflect.apply(method, state.nativeContext, [source.native, ...coordinates])
    if (!sourceOriginClean(argumentsList[0])) state.originClean = false
    flattenOpaque(state)
  } finally {
    source.release()
  }
}

/** Creates a native pattern from the invocation's image after validating the repetition enum.
 * @returns A real pattern or null for an incomplete source.
 * @example context.createPattern(source, 'repeat');
 */
export function createPattern(
  state: CanvasState,
  method: CanvasMethod,
  argumentsList: unknown[],
) {
  const window = state.caller.window
  if (argumentsList.length < 2)
    throw new window.TypeError('Missing pattern arguments.')
  validateImageSource(state.caller.window, argumentsList[0])
  const repeat =
    argumentsList[1] === null
      ? ''
      : conversions.DOMString(argumentsList[1], conversionOptions(window))
  const source = imageSource(state.caller.window, argumentsList[0])
  try {
    if (!source.native) return null
    if (!['', 'repeat', 'repeat-x', 'repeat-y', 'no-repeat'].includes(repeat))
      throw new window.DOMException(
        'Invalid pattern repetition.',
        'SyntaxError',
      )
    const pattern = Reflect.apply(method, state.nativeContext, [
      source.native,
      repeat || 'repeat',
    ])
    if (!(pattern instanceof CanvasPattern))
      throw new window.TypeError('Renderer returned an invalid pattern.')
    patternOrigins.set(pattern, sourceOriginClean(argumentsList[0]))
    const transform = pattern.setTransform
    Object.defineProperty(pattern, 'setTransform', {
      configurable: true,
      writable: true,
      value(value?: unknown) {
        const components = matrixComponents(window, value)
        if (components.every(Number.isFinite))
          Reflect.apply(transform, pattern, [new window.DOMMatrix(components)])
      },
    })
    return pattern
  } finally {
    source.release()
  }
}
