import { performance } from 'node:perf_hooks'
import { clearTimeout, setTimeout } from 'node:timers'

import { HTMLMediaElement, HTMLVideoElement, PropertySymbol } from 'happy-dom'
import type { AbortSignal, ICanvasAdapterCaller, Window } from 'happy-dom'
import type { ImageData } from 'skia-canvas'
import conversions from 'webidl-conversions'

import type { DisposeCompatibility } from '../types.ts'
import { registerWindowClose } from '../utils/register-window-close.ts'
import { replaceProperty } from '../utils/replace-property.ts'

import type { ExtendedCanvasAdapter } from './adapter.ts'
import {
  MEDIA_ERR_DECODE,
  MEDIA_ERR_NETWORK,
  MEDIA_HAVE_ENOUGH_DATA,
  MEDIA_HAVE_METADATA,
  MEDIA_HAVE_NOTHING,
  MEDIA_NETWORK_EMPTY,
  MEDIA_NETWORK_IDLE,
  MEDIA_NETWORK_LOADING,
  MEDIA_NETWORK_NO_SOURCE,
  MEDIA_OPERATION_TIMEOUT_MS,
  MILLISECONDS_PER_SECOND,
  VIDEO_FRAME_INTERVAL_MS,
} from './constants.ts'
import { WindowBrowserContext } from './happy-dom-internals.ts'
import { fetchCanvasResource } from './resource-fetch.ts'
import { conversionOptions } from './utils/conversion-options.ts'
import { decodeVideoFrame, probeVideo } from './video-decoder.ts'

export const videoSources = new WeakMap<HTMLVideoElement, CanvasVideoSource>()
const environments = new WeakMap<
  ICanvasAdapterCaller['window'],
  {
    adapter: ExtendedCanvasAdapter
    sources: Set<WeakRef<CanvasVideoSource>>
  }
>()
const collectedSources = new FinalizationRegistry<CanvasVideoSource>(
  (state) => {
    void state.dispose()
  },
)

/** Owns real video source bytes, decoded frames and one serial decoder for an element's Canvas input lifecycle.
 * @example const source = new CanvasVideoSource(video, adapter); source.load();
 */
class CanvasVideoSource {
  readonly reference = new WeakRef(this)
  native: ImageData | null = null
  originClean = true
  width = 0
  height = 0
  completion = Promise.resolve()
  #owner: WeakRef<HTMLVideoElement>
  #window: ICanvasAdapterCaller['window']
  #adapter: ExtendedCanvasAdapter
  #bytes: Buffer = Buffer.alloc(0)
  #metadata: Awaited<ReturnType<typeof probeVideo>> | undefined
  #releaseSource = () => {}
  #releaseFrame = () => {}
  #controller: InstanceType<Window['AbortController']> | undefined
  #timer: NodeJS.Timeout | undefined
  #clockStart = performance.now()
  #clockTime = 0
  #disposed = false
  #playGeneration = 0
  #endPlayback = () => {}

  /** Retains only a weak element reference so a decoded but detached video can be collected.
   * @example new CanvasVideoSource(video, adapter);
   */
  constructor(video: HTMLVideoElement, adapter: ExtendedCanvasAdapter) {
    this.#owner = new WeakRef(video)
    this.#window = video[PropertySymbol.window]
    this.#adapter = adapter
  }

  /** Computes playback time from the native monotonic clock when HTMLMediaElement.currentTime is read.
   * @returns The requested seek time or the progressing time, clamped to real media duration.
   * @example source.time; // 1.1 after a completed seek
   */
  get time(): number {
    const video = this.#owner.deref()
    const elapsed =
      !video || video.paused
        ? 0
        : ((performance.now() - this.#clockStart) / MILLISECONDS_PER_SECOND) *
          video.playbackRate
    return Math.min(
      this.#metadata?.duration ?? Infinity,
      this.#clockTime + elapsed,
    )
  }

  /** Starts an actual media request and initial decode when src/load changes.
   * @returns Nothing; readiness events follow metadata and real first-frame availability.
   * @example source.load(); await source.completion;
   */
  load(): void {
    const video = this.#owner.deref()
    if (!video) return
    video[PropertySymbol.networkState] = MEDIA_NETWORK_LOADING
    this.#schedule(async (signal) => {
      this.#emit('loadstart')
      const source = video.currentSrc
      if (!source)
        throw new this.#window.DOMException(
          'The video has no source.',
          'NotSupportedError',
        )
      const resource = await fetchCanvasResource(
        this.#window,
        source,
        video.crossOrigin,
        signal,
      )
      this.#releaseSource = resource.release
      this.#bytes = resource.buffer
      this.originClean = resource.originClean
      this.#metadata = await probeVideo(this.#window, this.#bytes, signal)
      this.width = this.#metadata.width
      this.height = this.#metadata.height
      video[PropertySymbol.duration] = this.#metadata.duration
      video[PropertySymbol.readyState] = MEDIA_HAVE_METADATA
      this.#emit('durationchange')
      this.#emit('loadedmetadata')
      await this.#decode(this.#clockTime, signal)
    })
  }

  /** Cancels an older decode before selecting the requested frame for a currentTime assignment.
   * @returns Nothing; seeked is emitted only after the newest requested real frame is installed.
   * @example source.seek(1.1);
   */
  seek(time: number): void {
    const video = this.#owner.deref()
    this.#clockTime = Math.max(
      0,
      Math.min(time, this.#metadata?.duration ?? Infinity),
    )
    this.#clockStart = performance.now()
    if (!video || !this.#metadata) return
    clearTimeout(this.#timer)
    video[PropertySymbol.seeking] = true
    video[PropertySymbol.ended] = false
    this.#emit('seeking')
    const target = this.#clockTime
    this.#schedule(async (signal) => {
      await this.#decode(target, signal)
      video[PropertySymbol.seeking] = false
      this.#emit('timeupdate')
      this.#emit('seeked')
      this.#tickLater()
    })
  }

  /** Starts actual clock-driven frame selection for HTMLMediaElement.play after initial decoding succeeds.
   * @returns A promise that rejects on missing/broken/cancelled media and resolves when playback begins.
   * @example await source.play();
   */
  async play(): Promise<void> {
    const generation = this.#playGeneration
    await this.completion
    const video = this.#owner.deref()
    if (!video || this.#disposed || generation !== this.#playGeneration)
      throw new this.#window.DOMException(
        'Playback was interrupted.',
        'AbortError',
      )
    if (!this.native || video.error)
      throw new this.#window.DOMException(
        'The video has no decoded frame.',
        'NotSupportedError',
      )
    if (!video.paused) return
    if (video.ended) this.seek(0)
    // A concurrent replay may already be rewinding; both callers await that work and recheck interruption.
    await this.completion
    if (this.#disposed || generation !== this.#playGeneration)
      throw new this.#window.DOMException(
        'Playback was interrupted.',
        'AbortError',
      )
    if (!video.paused) return
    this.#clockStart = performance.now()
    const manager = new WindowBrowserContext(this.#window).getAsyncTaskManager()
    if (manager) {
      const task = manager.startTask(() => {
        void this.dispose()
      })
      this.#endPlayback = () => manager.endTask(task)
    }
    video[PropertySymbol.paused] = false
    this.#emit('play')
    this.#emit('playing')
    this.#tickLater()
  }

  /** Freezes the native playback clock and cancels future ticks when pause or teardown runs.
   * @returns Nothing; an already paused video emits no duplicate pause event.
   * @example source.pause();
   */
  pause(): void {
    this.#playGeneration += 1
    this.#endPlayback()
    this.#endPlayback = () => {}
    this.#clockTime = this.time
    const video = this.#owner.deref()
    clearTimeout(this.#timer)
    if (!video || video.paused) return
    video[PropertySymbol.paused] = true
    this.#emit('timeupdate')
    this.#emit('pause')
  }

  /** Aborts and joins the current child before releasing source/frame memory on replacement, collection or Window close.
   * @returns A promise settling only after owned decode work and storage are released.
   * @example await source.dispose();
   */
  async dispose(): Promise<void> {
    this.#disposed = true
    collectedSources.unregister(this)
    this.pause()
    this.#controller?.abort(
      new this.#window.DOMException(
        'Video source was discarded.',
        'AbortError',
      ),
    )
    await this.completion.catch(() => {})
    this.native = null
    this.#bytes = Buffer.alloc(0)
    this.#releaseFrame()
    this.#releaseSource()
    environments.get(this.#window)?.sources.delete(this.reference)
  }

  /** Registers serial media work with Happy DOM and a native deadline, suppressing stale-source events.
   * @returns Nothing; completion retains the latest operation's success or failure for play and teardown.
   * @example this.#schedule(async signal => this.#decode(0, signal));
   */
  #schedule(operation: (signal: AbortSignal) => Promise<void>): void {
    this.#controller?.abort(
      new this.#window.DOMException(
        'A newer video operation replaced this one.',
        'AbortError',
      ),
    )
    const controller = new this.#window.AbortController()
    this.#controller = controller
    const manager = new WindowBrowserContext(this.#window).getAsyncTaskManager()
    const task = manager?.startTask(() => {
      void this.dispose()
    })
    const timer = setTimeout(
      () =>
        controller.abort(
          new this.#window.DOMException(
            'Video loading timed out.',
            'TimeoutError',
          ),
        ),
      MEDIA_OPERATION_TIMEOUT_MS,
    )
    this.completion = this.completion
      .catch(() => {})
      .then(async () => {
        if (controller.signal.aborted) throw controller.signal.reason
        await operation(controller.signal)
      })
      .catch((error: unknown) => {
        if (!this.#disposed && this.#controller === controller)
          this.#fail(error)
        throw error
      })
      .finally(() => {
        clearTimeout(timer)
        if (task !== undefined) manager?.endTask(task)
      })
    void this.completion.catch(() => {})
  }

  /** Publishes pixels only after the selected decoder completes and the request is still current.
   * @returns Nothing; stale decoded pixels release immediately instead of overwriting the current frame.
   * @example await this.#decode(1.1, signal);
   */
  async #decode(time: number, signal: AbortSignal): Promise<void> {
    if (!this.#metadata) return
    const frame = await decodeVideoFrame(
      this.#window,
      this.#adapter,
      this.#bytes,
      this.#metadata,
      time,
      signal,
    )
    if (signal.aborted || this.#disposed) {
      frame.release()
      throw signal.reason
    }
    this.#releaseFrame()
    this.native = frame.native
    this.#releaseFrame = frame.release
    this.#markReady()
  }

  /** Publishes initial readiness after the first successful decode, including a seek that replaced loading.
   * @returns Nothing; subsequent frames preserve readiness and emit no duplicate load events.
   * @example this.#markReady();
   */
  #markReady(): void {
    const video = this.#owner.deref()
    if (video?.readyState !== MEDIA_HAVE_METADATA) return
    // A seek can replace the first decode; whichever frame completes first owns initial readiness.
    video[PropertySymbol.networkState] = MEDIA_NETWORK_IDLE
    video[PropertySymbol.readyState] = MEDIA_HAVE_ENOUGH_DATA
    this.#emit('loadeddata')
    this.#emit('canplay')
    this.#emit('canplaythrough')
    if (video.autoplay) void this.play().catch(() => {})
  }

  /** Schedules bounded playback sampling without overlap; media time still follows the actual monotonic clock.
   * @returns Nothing; the last sample emits ended or restarts a looping source.
   * @example this.#tickLater();
   */
  #tickLater(): void {
    const video = this.#owner.deref()
    if (!video || video.paused || this.#disposed) return
    clearTimeout(this.#timer)
    // ponytail: presentation samples at most 20 fps; use one sustained decoder if browser-rate presentation becomes necessary.
    this.#timer = setTimeout(() => {
      const time = this.time
      this.#schedule(async (signal) => {
        await this.#decode(time, signal)
        this.#emit('timeupdate')
        if (this.#metadata && time >= this.#metadata.duration) {
          if (video.loop) this.seek(0)
          else {
            this.pause()
            video[PropertySymbol.ended] = true
            this.#emit('ended')
          }
        } else this.#tickLater()
      })
    }, VIDEO_FRAME_INTERVAL_MS)
  }

  /** Records recoverable media errors after failed request/decode work and stops playback.
   * @returns Nothing; Canvas subsequently sees no usable frame from this broken source.
   * @example this.#fail(error);
   */
  #fail(error: unknown): void {
    const video = this.#owner.deref()
    if (!video) return
    this.pause()
    this.native = null
    this.#releaseFrame()
    this.#releaseSource()
    this.#bytes = Buffer.alloc(0)
    video[PropertySymbol.error] = {
      code:
        error instanceof this.#window.DOMException &&
        error.name === 'NetworkError'
          ? MEDIA_ERR_NETWORK
          : MEDIA_ERR_DECODE,
      message: String(error),
    }
    video[PropertySymbol.seeking] = false
    video[PropertySymbol.networkState] = MEDIA_NETWORK_NO_SOURCE
    this.#emit('error')
  }

  /** Emits media lifecycle events in the element's Window only while its source generation is active.
   * @returns Nothing; replaced, closed or collected elements receive no late event.
   * @example this.#emit('seeked');
   */
  #emit(type: string): void {
    const video = this.#owner.deref()
    if (!this.#disposed && video && videoSources.get(video) === this)
      video.dispatchEvent(new this.#window.Event(type))
  }
}

/** Replaces the source generation and clears media state when a video src or load call changes.
 * @returns The new source, or undefined for a foreign Window or absent URL.
 * @example loadCanvasVideo(video);
 */
function loadCanvasVideo(
  video: HTMLVideoElement,
): CanvasVideoSource | undefined {
  const environment = environments.get(video[PropertySymbol.window])
  if (!environment) return
  const previous = videoSources.get(video)
  videoSources.delete(video)
  const closing = previous?.dispose() ?? Promise.resolve()
  video[PropertySymbol.readyState] = MEDIA_HAVE_NOTHING
  video[PropertySymbol.networkState] = MEDIA_NETWORK_EMPTY
  video[PropertySymbol.duration] = NaN
  video[PropertySymbol.error] = null
  video[PropertySymbol.seeking] = false
  video[PropertySymbol.ended] = false
  video[PropertySymbol.paused] = true
  video[PropertySymbol.currentTime] = 0
  if (!video.currentSrc) return
  const state = new CanvasVideoSource(video, environment.adapter)
  state.completion = closing
  videoSources.set(video, state)
  environment.sources.add(state.reference)
  collectedSources.register(video, state, state)
  state.load()
  return state
}

/** Applies converted time/rate assignments without duplicating clock-reset behavior in shared property bindings.
 * @returns Nothing; invalid rates throw before changing the current playback state.
 * @example setVideoTime(video, 'currentTime', 1.1);
 */
function setVideoTime(
  video: HTMLVideoElement,
  key: 'currentTime' | 'playbackRate',
  value: unknown,
): void {
  const window = video[PropertySymbol.window]
  const number = conversions.double(value, conversionOptions(window))
  const state = videoSources.get(video)
  if (key === 'currentTime') {
    if (state) state.seek(number)
    else video[PropertySymbol.currentTime] = number
    return
  }
  if (number < 0)
    throw new window.DOMException(
      'Reverse playback is unsupported.',
      'NotSupportedError',
    )
  const time = state?.time
  video[PropertySymbol.playbackRate] = number
  if (time !== undefined) state?.seek(time)
  video.dispatchEvent(new window.Event('ratechange'))
}

/** Installs owned video loading, seek/play bindings and asynchronous Window-close joining without changing audio/foreign environments.
 * @returns Nothing; shared descriptors restore after the final Canvas environment closes.
 * @example installCanvasVideos(window, adapter, restorers);
 */
export function installCanvasVideos(
  window: Window,
  adapter: ExtendedCanvasAdapter,
  restorers: DisposeCompatibility[],
): void {
  const sources = new Set<WeakRef<CanvasVideoSource>>()
  environments.set(window, { adapter, sources })
  const closeSources = async () => {
    await Promise.all(
      [...sources].map(async (reference) => reference.deref()?.dispose()),
    )
    sources.clear()
  }
  restorers.push(() => {
    environments.delete(window)
    void closeSources()
  })
  registerWindowClose(window, closeSources, restorers)
  const prototype = HTMLVideoElement.prototype
  for (const hook of [
    PropertySymbol.onSetAttribute,
    PropertySymbol.onRemoveAttribute,
  ] as const) {
    const original = prototype[hook]
    restorers.push(
      replaceProperty(prototype, hook, {
        writable: true,
        value(
          this: HTMLVideoElement,
          ...argumentsList: Parameters<typeof original>
        ) {
          Reflect.apply(original, this, argumentsList)
          const [attribute] = argumentsList
          if (attribute.namespaceURI === null && attribute.name === 'src')
            loadCanvasVideo(this)
        },
      }),
    )
  }
  for (const key of ['videoWidth', 'videoHeight'] as const) {
    restorers.push(
      replaceProperty(prototype, key, {
        enumerable: true,
        get(this: HTMLVideoElement) {
          if (!environments.has(this[PropertySymbol.window])) return undefined
          return (
            videoSources.get(this)?.[
              key === 'videoWidth' ? 'width' : 'height'
            ] ?? 0
          )
        },
      }),
    )
  }
  for (const key of ['src', 'currentTime', 'playbackRate'] as const) {
    const original = Object.getOwnPropertyDescriptor(
      HTMLMediaElement.prototype,
      key,
    )!
    restorers.push(
      replaceProperty(prototype, key, {
        enumerable: true,
        get(this: HTMLVideoElement) {
          return key === 'currentTime' && videoSources.has(this)
            ? videoSources.get(this)!.time
            : original.get!.call(this)
        },
        set(this: HTMLVideoElement, value: unknown) {
          if (!environments.has(this[PropertySymbol.window])) {
            original.set!.call(this, value)
            return
          }
          const ownerWindow = this[PropertySymbol.window]
          if (key === 'src')
            this.setAttribute(
              'src',
              conversions.DOMString(value, conversionOptions(ownerWindow)),
            )
          else setVideoTime(this, key, value)
        },
      }),
    )
  }
  for (const key of ['load', 'pause', 'play', 'fastSeek'] as const) {
    const original = prototype[key]
    restorers.push(
      replaceProperty(prototype, key, {
        writable: true,
        value(this: HTMLVideoElement, ...argumentsList: unknown[]) {
          if (!environments.has(this[PropertySymbol.window]))
            return Reflect.apply(original, this, argumentsList)
          if (key === 'load') {
            loadCanvasVideo(this)
            return
          }
          if (key === 'fastSeek') {
            if (argumentsList.length === 0)
              throw new this[PropertySymbol.window].TypeError(
                'A seek time is required.',
              )
            this.currentTime = conversions.double(
              argumentsList[0],
              conversionOptions(this[PropertySymbol.window]),
            )
            return
          }
          const state =
            videoSources.get(this) ??
            (key === 'play' ? loadCanvasVideo(this) : undefined)
          if (key === 'pause') {
            state?.pause()
            return
          }
          const ownerWindow = this[PropertySymbol.window]
          return state
            ? ownerWindow.Promise.resolve(state.play())
            : ownerWindow.Promise.reject(
                new ownerWindow.DOMException(
                  'The video has no source.',
                  'NotSupportedError',
                ),
              )
        },
      }),
    )
  }
  const originalCORS = Object.getOwnPropertyDescriptor(
    HTMLMediaElement.prototype,
    'crossOrigin',
  )!
  restorers.push(
    replaceProperty(prototype, 'crossOrigin', {
      enumerable: true,
      get(this: HTMLVideoElement) {
        if (!environments.has(this[PropertySymbol.window]))
          return originalCORS.get!.call(this)
        const value = this.getAttribute('crossorigin')
        return value === null
          ? null
          : value.toLowerCase() === 'use-credentials'
            ? 'use-credentials'
            : 'anonymous'
      },
      set(this: HTMLVideoElement, value: unknown) {
        if (!environments.has(this[PropertySymbol.window])) {
          originalCORS.set!.call(this, value)
          return
        }
        if (value === null) this.removeAttribute('crossorigin')
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
