import { setTimeout, clearTimeout } from 'node:timers'

import imageSize from 'buffer-image-size'
import { HTMLImageElement, HTMLElement, PropertySymbol } from 'happy-dom'
import type { ICanvasAdapterCaller, Window } from 'happy-dom'
import { Image } from 'skia-canvas'
import conversions from 'webidl-conversions'

import type { DisposeCompatibility } from '../types.ts'
import { disposeAll } from '../utils/dispose-all.ts'
import { replaceProperty } from '../utils/replace-property.ts'

import type { ExtendedCanvasAdapter } from './adapter.ts'
import {
  MAX_MEDIA_INPUT_BYTES,
  MEDIA_OPERATION_TIMEOUT_MS,
} from './constants.ts'
import { DataURIParser, WindowBrowserContext } from './happy-dom-internals.ts'
import {
  fetchCanvasResource,
  installCanvasObjectURLs,
  installResourceFetch,
} from './resource-fetch.ts'
import { conversionOptions } from './utils/conversion-options.ts'
import { pixelBytes } from './utils/pixel-bytes.ts'

interface ImageSourceState {
  native: Image | null
  originClean: boolean
  status: 'loading' | 'ready' | 'broken' | 'cancelled'
  completion: Promise<void>
  dispose: () => void
}

export const imageSources = new WeakMap<HTMLImageElement, ImageSourceState>()
const environments = new WeakMap<
  ICanvasAdapterCaller['window'],
  { adapter: ExtendedCanvasAdapter; sources: Set<WeakRef<ImageSourceState>> }
>()
const collectedSources = new FinalizationRegistry<() => void>((release) =>
  release(),
)

/** Builds finalizer cleanup outside the loading closure so it cannot retain the source element it is meant to collect.
 * @returns A cleanup callback holding decoded storage and a weak source reference only.
 * @example imageRelease(decoded, sources, reference);
 */
function imageRelease(
  decoded: ReturnType<typeof decodeCanvasImage>,
  sources: Set<WeakRef<ImageSourceState>>,
  reference: WeakRef<ImageSourceState>,
): () => void {
  return () => {
    try {
      decoded.release()
    } finally {
      sources.delete(reference)
    }
  }
}

/** Bounds and decodes one image while reserving both retained source bytes and native pixels before allocating them.
 * @returns Real decoded pixels and their complete, idempotent release operation.
 * @example decodeCanvasImage(window, adapter, pngBuffer);
 */
export function decodeCanvasImage(
  window: ICanvasAdapterCaller['window'],
  adapter: ExtendedCanvasAdapter,
  buffer: Buffer,
) {
  if (buffer.length > MAX_MEDIA_INPUT_BYTES)
    throw new window.RangeError('Media input exceeds the byte limit.')
  const { width, height } = imageSize(buffer)
  const bytes = pixelBytes(window, width, height)
  if (!bytes)
    throw new window.DOMException('The image has no pixels.', 'EncodingError')
  const releaseStorage = adapter.reserveStorage(window, bytes + buffer.length)
  let native: Image
  try {
    native = new Image(buffer)
  } catch (error) {
    releaseStorage()
    throw error
  }
  let released = false
  const release = () => {
    if (released) return
    released = true
    // Skia 3.0.8 has no public Image.close; replacing its owned native data frees pixels synchronously without a new fetch.
    disposeAll([
      releaseStorage,
      () =>
        Reflect.apply(Reflect.get(native, 'prop'), native, [
          'data',
          Buffer.alloc(0),
        ]),
    ])
  }
  if (native.width !== width || native.height !== height) {
    release()
    throw new window.DOMException(
      'Decoded dimensions do not match the bounded image header.',
      'EncodingError',
    )
  }
  return { native, release }
}

/** Replaces one image request generation when src/CORS changes, retaining invocation-time readiness and discardable decoded ownership.
 * @returns Nothing; decode() observes completion while load/error events use the owning Window.
 * @example loadCanvasImage(image);
 */
function loadCanvasImage(image: HTMLImageElement): void {
  const window = image[PropertySymbol.window]
  const environment = environments.get(window)
  if (!environment) return
  imageSources.get(image)?.dispose()
  image[PropertySymbol.complete] = false
  image[PropertySymbol.buffer] = null
  image[PropertySymbol.naturalWidth] = 0
  image[PropertySymbol.naturalHeight] = 0
  const source = image.src
  // Disabled requests stay pending, matching Happy DOM without sending UI error events.
  if (
    source &&
    !source.startsWith('data:') &&
    !new WindowBrowserContext(window).getSettings()?.enableImageFileLoading
  ) {
    imageSources.delete(image)
    return
  }
  const controller = new window.AbortController()
  let releasePixels = () => {}
  const state: ImageSourceState = {
    native: null,
    originClean: true,
    status: 'loading',
    completion: Promise.resolve(),
    dispose() {
      state.status = 'cancelled'
      collectedSources.unregister(state)
      state.native = null
      environment.sources.delete(reference)
      if (imageSources.get(image) === state) image[PropertySymbol.buffer] = null
      disposeAll([releasePixels, () => controller.abort()])
    },
  }
  imageSources.set(image, state)
  const reference = new WeakRef(state)
  environment.sources.add(reference)
  const manager = new WindowBrowserContext(window).getAsyncTaskManager()
  const task = manager?.startTask(() => state.dispose())
  const timer = setTimeout(
    () =>
      controller.abort(
        new window.DOMException('Media loading timed out.', 'TimeoutError'),
      ),
    MEDIA_OPERATION_TIMEOUT_MS,
  )
  const fail = (error: unknown) => {
    if (state.status !== 'cancelled') {
      state.status = 'broken'
      image[PropertySymbol.complete] = true
      image.dispatchEvent(new window.Event('error'))
    }
    throw error
  }
  const accept = ({
    buffer,
    originClean,
  }: {
    buffer: Buffer
    originClean: boolean
  }) => {
    if (controller.signal.aborted || imageSources.get(image) !== state)
      throw new window.DOMException(
        'The image request changed.',
        'EncodingError',
      )
    const decoded = decodeCanvasImage(window, environment.adapter, buffer)
    releasePixels = imageRelease(decoded, environment.sources, reference)
    collectedSources.register(image, releasePixels, state)
    state.native = decoded.native
    state.originClean = originClean
    state.status = 'ready'
    image[PropertySymbol.buffer] = buffer
    image[PropertySymbol.naturalWidth] = decoded.native.width
    image[PropertySymbol.naturalHeight] = decoded.native.height
    image[PropertySymbol.complete] = true
    queueMicrotask(() => {
      if (state.status === 'ready' && imageSources.get(image) === state)
        image.dispatchEvent(new window.Event('load'))
    })
  }
  try {
    if (!source)
      throw new window.DOMException('The image has no source.', 'EncodingError')
    if (source.startsWith('data:')) {
      if (source.length > MAX_MEDIA_INPUT_BYTES * 4)
        throw new window.RangeError('Media input exceeds the byte limit.')
      // Keep the package's synchronous data-URL decode boundary; events still run after the setter returns.
      const releaseInput = environment.adapter.reserveStorage(
        window,
        source.length,
      )
      let buffer: Buffer
      try {
        buffer = DataURIParser.parse(source).buffer
      } finally {
        releaseInput()
      }
      accept({ buffer, originClean: true })
    } else {
      state.completion = fetchCanvasResource(
        window,
        source,
        image.crossOrigin,
        controller.signal,
      ).then((resource) => {
        // Hand input ownership to synchronous decodeCanvasImage without leaving an unreserved async interval.
        resource.release()
        accept(resource)
      })
    }
  } catch (error) {
    state.completion = Promise.reject(error)
  }
  state.completion = state.completion.catch(fail).finally(() => {
    clearTimeout(timer)
    if (task !== undefined) manager?.endTask(task)
    // Completed decoded sources remain weakly tracked for Window teardown.
    if (state.status !== 'ready') environment.sources.delete(reference)
  })
  void state.completion.catch(() => {})
}

/** Owns image request/decode semantics only in default Canvas environments and restores shared hooks independently.
 * @returns Nothing; pending requests abort and decoded pixels release during compatibility teardown.
 * @example installCanvasImages(window, adapter, restorers);
 */
export function installCanvasImages(
  window: Window,
  adapter: ExtendedCanvasAdapter,
  restorers: DisposeCompatibility[],
): void {
  const sources = new Set<WeakRef<ImageSourceState>>()
  environments.set(window, { adapter, sources })
  restorers.push(() => {
    environments.delete(window)
    const disposers = [...sources].flatMap((reference) => {
      const state = reference.deref()
      return state ? [state.dispose] : []
    })
    sources.clear()
    disposeAll(disposers)
  })
  installResourceFetch(restorers)
  installCanvasObjectURLs(window, restorers)
  for (const hook of [
    PropertySymbol.onSetAttribute,
    PropertySymbol.onRemoveAttribute,
  ] as const) {
    const original = HTMLImageElement.prototype[hook]
    const parent = HTMLElement.prototype[hook]
    restorers.push(
      replaceProperty(HTMLImageElement.prototype, hook, {
        writable: true,
        value(
          this: HTMLImageElement,
          ...argumentsList: Parameters<typeof original>
        ) {
          if (!environments.has(this[PropertySymbol.window]))
            return Reflect.apply(original, this, argumentsList)
          Reflect.apply(parent, this, argumentsList)
          const [attribute] = argumentsList
          if (
            attribute.namespaceURI !== null ||
            !['src', 'crossorigin'].includes(attribute.name)
          )
            return
          if (!this.hasAttribute('src')) {
            imageSources.get(this)?.dispose()
            imageSources.delete(this)
            this[PropertySymbol.complete] = true
            this[PropertySymbol.naturalWidth] = 0
            this[PropertySymbol.naturalHeight] = 0
            return
          }
          loadCanvasImage(this)
        },
      }),
    )
  }
  const originalDecode = HTMLImageElement.prototype.decode
  restorers.push(
    replaceProperty(HTMLImageElement.prototype, 'decode', {
      writable: true,
      // eslint-disable-next-line @typescript-eslint/promise-function-async -- decode() must keep the calling Window's Promise realm.
      value(this: HTMLImageElement) {
        if (!environments.has(this[PropertySymbol.window]))
          return originalDecode.call(this)
        const ownerWindow = this[PropertySymbol.window]
        const state = imageSources.get(this)
        if (!state)
          return ownerWindow.Promise.reject(
            new ownerWindow.DOMException(
              'The image has no decoded source.',
              'EncodingError',
            ),
          )
        return ownerWindow.Promise.resolve(state.completion).catch(() => {
          throw new ownerWindow.DOMException(
            'The image could not be decoded.',
            'EncodingError',
          )
        })
      },
    }),
  )
  const originalCORS = Object.getOwnPropertyDescriptor(
    HTMLImageElement.prototype,
    'crossOrigin',
  )!
  restorers.push(
    replaceProperty(HTMLImageElement.prototype, 'crossOrigin', {
      enumerable: true,
      get(this: HTMLImageElement) {
        if (!environments.has(this[PropertySymbol.window]))
          return originalCORS.get!.call(this)
        const value = this.getAttribute('crossorigin')
        return value === null
          ? null
          : value.toLowerCase() === 'use-credentials'
            ? 'use-credentials'
            : 'anonymous'
      },
      set(this: HTMLImageElement, value: unknown) {
        if (!environments.has(this[PropertySymbol.window])) {
          originalCORS.set!.call(this, value)
          return
        }
        if (value === null || value === undefined)
          this.removeAttribute('crossorigin')
        else
          this.setAttribute(
            'crossorigin',
            conversions.DOMString(
              value,
              conversionOptions(this[PropertySymbol.window]),
            ),
          )
      },
    }),
  )
}
