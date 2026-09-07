import {
  Blob,
  BrowserWindow,
  ImageBitmap,
  ImageData,
  OffscreenCanvas,
  PropertySymbol,
} from 'happy-dom'
import type { ICanvasAdapterCaller, Window } from 'happy-dom'
import { ImageData as NativeImageData } from 'skia-canvas'
import conversions from 'webidl-conversions'

import type { DisposeCompatibility } from '../types.ts'
import { disposeAll } from '../utils/dispose-all.ts'
import { replaceProperty } from '../utils/replace-property.ts'

import { ExtendedCanvasAdapter } from './adapter.ts'
import { bitmapOptions } from './bitmap-options.ts'
import { MAX_COLOR_CHANNEL, RGBA_BYTES_PER_PIXEL } from './constants.ts'
import {
  imageSource,
  sourceOriginClean,
  validateImageSource,
} from './image-sources.ts'
import { decodeCanvasImage } from './images.ts'
import { requestCanvasPresentation } from './presentation.ts'
import {
  bitmapStates,
  canvasStates,
  canvasWindows,
  imageDataColorSpaces,
} from './state.ts'
import { conversionOptions } from './utils/conversion-options.ts'
import { convertPixelColors } from './utils/convert-pixel-colors.ts'
import { pixelBytes } from './utils/pixel-bytes.ts'

/** Allocates an owned, independently drawable ImageBitmap and copies source pixels synchronously at the invocation boundary.
 * @returns A Happy DOM ImageBitmap with real raster storage and origin-clean metadata.
 * @example makeImageBitmap(window, pixels, true, bitmapOptions(window, {}));
 */
export function makeImageBitmap(
  window: ICanvasAdapterCaller['window'],
  source: NonNullable<ReturnType<typeof imageSource>['native']>,
  originClean: boolean,
  options: ReturnType<typeof bitmapOptions>,
  crop?: number[],
): ImageBitmap {
  const [
    sourceX = 0,
    sourceY = 0,
    sourceWidth = source.width,
    sourceHeight = source.height,
  ] = crop ?? []
  const width =
    options.resizeWidth ??
    (options.resizeHeight === undefined
      ? Math.abs(sourceWidth)
      : Math.ceil(options.resizeHeight * Math.abs(sourceWidth / sourceHeight)))
  const height =
    options.resizeHeight ??
    (options.resizeWidth === undefined
      ? Math.abs(sourceHeight)
      : Math.ceil(options.resizeWidth * Math.abs(sourceHeight / sourceWidth)))
  pixelBytes(window, width, height)
  const canvas = new window.OffscreenCanvas(width, height)
  try {
    canvas.getContext('2d')
    const state = canvasStates.get(canvas)!
    state.nativeContext.imageSmoothingEnabled =
      options.resizeQuality !== 'pixelated'
    if (options.resizeQuality === 'medium' || options.resizeQuality === 'high')
      state.nativeContext.imageSmoothingQuality = options.resizeQuality
    if (options.imageOrientation === 'flipY') {
      state.nativeContext.translate(0, height)
      state.nativeContext.scale(1, -1)
    }
    if (width && height)
      state.nativeContext.drawImage(
        source,
        Math.min(sourceX, sourceX + sourceWidth),
        Math.min(sourceY, sourceY + sourceHeight),
        Math.abs(sourceWidth),
        Math.abs(sourceHeight),
        0,
        0,
        width,
        height,
      )
    state.originClean = originClean
    // Happy DOM's ImageBitmap has symbol-backed state; avoid its unsupported source conversion and duplicate allocation.
    const bitmap: ImageBitmap = Object.create(window.ImageBitmap.prototype)
    bitmap[PropertySymbol.canvas] = canvas
    bitmap[PropertySymbol.width] = width
    bitmap[PropertySymbol.height] = height
    bitmap[PropertySymbol.options] = null
    bitmapStates.set(bitmap, state)
    return bitmap
  } catch (error) {
    disposeAll(
      [
        () => Reflect.set(canvas, 'width', 0),
        () => Reflect.set(canvas, 'height', 0),
      ],
      [error],
    )
    throw error
  }
}

/** Releases owned Bitmap pixels for close and transfer without invoking a consumer-overridden public close method.
 * @returns Nothing; already closed bitmaps remain closed without a second release.
 * @example closeBitmapStorage(bitmap);
 */
export function closeBitmapStorage(bitmap: ImageBitmap): void {
  const state = bitmapStates.get(bitmap)
  if (!state || !bitmap[PropertySymbol.canvas]) return
  bitmap[PropertySymbol.canvas] = null
  bitmap[PropertySymbol.width] = 0
  bitmap[PropertySymbol.height] = 0
  disposeAll([
    () => {
      state.caller.canvas.width = 0
    },
    () => {
      state.caller.canvas.height = 0
    },
  ])
}

/** Resolves createImageBitmap's Blob/ImageData/source union, releasing temporary decoder storage after the owned copy is complete.
 * @returns A bitmap captured before control returns to user code.
 * @example bitmapFromSource(window, adapter, imageData, options);
 */
function bitmapFromSource(
  window: ICanvasAdapterCaller['window'],
  adapter: ExtendedCanvasAdapter,
  source: unknown,
  options: ReturnType<typeof bitmapOptions>,
  crop?: number[],
): ImageBitmap {
  if (source instanceof Blob) {
    let decoded: ReturnType<typeof decodeCanvasImage>
    try {
      decoded = decodeCanvasImage(
        window,
        adapter,
        source[PropertySymbol.buffer],
      )
    } catch {
      throw new window.DOMException(
        'The Blob is not a decodable image.',
        'InvalidStateError',
      )
    }
    try {
      return makeImageBitmap(window, decoded.native, true, options, crop)
    } finally {
      decoded.release()
    }
  }
  if (source instanceof ImageData) {
    if (!source.data.byteLength)
      throw new window.DOMException(
        'ImageData storage is detached.',
        'InvalidStateError',
      )
    const release = adapter.reserveStorage(
      window,
      pixelBytes(window, source.width, source.height),
    )
    try {
      const pixels = new Uint8ClampedArray(source.data)
      convertPixelColors(
        pixels,
        imageDataColorSpaces.get(source) ?? 'srgb',
        'srgb',
      )
      return makeImageBitmap(
        window,
        new NativeImageData(pixels, source.width, source.height),
        true,
        options,
        crop,
      )
    } finally {
      release()
    }
  }
  const acquired = imageSource(window, source)
  try {
    if (!acquired.native)
      throw new window.DOMException(
        'The source is not ready.',
        'InvalidStateError',
      )
    return makeImageBitmap(
      window,
      acquired.native,
      sourceOriginClean(source),
      options,
      crop,
    )
  } finally {
    acquired.release()
  }
}

/** Snapshots Offscreen output and replaces its pixels without changing the current path, clip, transform or saved drawing state.
 * @returns An independently owned bitmap; allocation failure leaves the sender untouched.
 * @example canvas.transferToImageBitmap();
 */
function transferBitmap(
  window: ICanvasAdapterCaller['window'],
  canvas: OffscreenCanvas,
  adapter: ExtendedCanvasAdapter,
): ImageBitmap {
  const state = canvasStates.get(canvas)
  if (!state || state.unavailable)
    throw new window.DOMException(
      'The Canvas has no usable context.',
      'InvalidStateError',
    )
  const release = adapter.reserveStorage(
    window,
    pixelBytes(window, state.width, state.height),
  )
  try {
    const blank =
      state.width && state.height
        ? new NativeImageData(state.width, state.height)
        : undefined
    if (blank && !state.settings.alpha)
      for (
        let offset = RGBA_BYTES_PER_PIXEL - 1;
        offset < blank.data.length;
        offset += RGBA_BYTES_PER_PIXEL
      )
        blank.data[offset] = MAX_COLOR_CHANNEL
    const bitmap = makeImageBitmap(
      window,
      state.bitmap,
      state.originClean,
      bitmapOptions(window, {}),
      [0, 0, state.width, state.height],
    )
    try {
      if (blank) state.writePixels(blank, 0, 0)
      // Extraction preserves context taint with its styles and saved patterns, as browsers do.
    } catch (error) {
      disposeAll([() => bitmap.close()], [error])
      throw error
    }
    return bitmap
  } finally {
    release()
  }
}

/** Validates bitmap overloads and options in WebIDL order before constructing the owned snapshot.
 * @returns A real ImageBitmap; invalid arguments fail before source pixels or ownership change.
 * @example createBitmap(window, adapter, [imageData]);
 */
function createBitmap(
  window: Window,
  adapter: ExtendedCanvasAdapter,
  argumentsList: unknown[],
): ImageBitmap {
  if (
    !argumentsList.length ||
    (argumentsList.length > 2 && argumentsList.length < 5)
  )
    throw new window.TypeError('Missing createImageBitmap arguments.')
  if (
    !(argumentsList[0] instanceof Blob) &&
    !(argumentsList[0] instanceof ImageData)
  )
    validateImageSource(window, argumentsList[0])
  const crop =
    argumentsList.length >= 5
      ? argumentsList
          .slice(1, 5)
          .map((value) => conversions.long(value, conversionOptions(window)))
      : undefined
  const options = bitmapOptions(window, argumentsList[crop ? 5 : 1])
  if (crop && (!crop[2] || !crop[3]))
    throw new window.RangeError('ImageBitmap crop dimensions must not be zero.')
  if (options.resizeWidth === 0 || options.resizeHeight === 0)
    throw new window.DOMException(
      'ImageBitmap resize dimensions must not be zero.',
      'InvalidStateError',
    )
  return bitmapFromSource(window, adapter, argumentsList[0], options, crop)
}

/** Installs bitmap creation/close and Offscreen snapshots with Window ownership and reusable native allocation accounting.
 * @returns Nothing; bitmap raster ownership follows the adapter's existing cleanup.
 * @example installCanvasBitmaps(window, adapter, restorers);
 */
export function installCanvasBitmaps(
  window: Window,
  adapter: ExtendedCanvasAdapter,
  restorers: DisposeCompatibility[],
): void {
  restorers.push(
    replaceProperty(window, 'createImageBitmap', {
      writable: true,
      // eslint-disable-next-line @typescript-eslint/promise-function-async -- Return the caller Window's Promise instead of an async function's host Promise.
      value(...argumentsList: unknown[]) {
        return new window.Promise<ImageBitmap>((resolve, reject) => {
          try {
            resolve(createBitmap(window, adapter, argumentsList))
          } catch (error) {
            reject(error)
          }
        })
      },
    }),
  )
  const close = ImageBitmap.prototype.close
  restorers.push(
    replaceProperty(ImageBitmap.prototype, 'close', {
      writable: true,
      value(this: ImageBitmap) {
        const state = bitmapStates.get(this)
        if (!state) return close.call(this)
        closeBitmapStorage(this)
      },
    }),
  )
  const transfer = OffscreenCanvas.prototype.transferToImageBitmap
  restorers.push(
    replaceProperty(OffscreenCanvas.prototype, 'transferToImageBitmap', {
      writable: true,
      value(this: OffscreenCanvas) {
        const owner: unknown = Reflect.get(this, PropertySymbol.window)
        if (!(owner instanceof BrowserWindow) || !canvasWindows.has(owner))
          return transfer.call(this)
        // Each receiver owns its adapter; the shared hook must not retain the first installed Window.
        const state = canvasStates.get(this)
        if (!state)
          throw new owner.DOMException(
            'The Canvas has no context.',
            'InvalidStateError',
          )
        const activeAdapter =
          state.caller.browserFrame.page.context.browser.settings.canvasAdapter
        if (!(activeAdapter instanceof ExtendedCanvasAdapter))
          return transfer.call(this)
        const bitmap = transferBitmap(owner, this, activeAdapter)
        requestCanvasPresentation(this)
        return bitmap
      },
    }),
  )
}
