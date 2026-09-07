import { setImmediate } from 'node:timers'

import { OffscreenCanvas, PropertySymbol } from 'happy-dom'
import type {
  ICanvasAdapter,
  ICanvasAdapterCaller,
  ICanvasShape,
} from 'happy-dom'
import { Canvas } from 'skia-canvas'
import conversions from 'webidl-conversions'

import { disposeAll } from '../utils/dispose-all.ts'

import {
  EMPTY_IMAGE_DATA_URL,
  ENCODER_FORMATS,
  MAX_NATIVE_STORAGE_BYTES,
  MIN_NATIVE_SIZE_PX,
  RGBA_BYTES_PER_PIXEL,
  WEBP_MIME_TYPE,
  JPEG_MIME_TYPE,
  MAX_ENCODER_QUALITY,
  MIN_ENCODER_QUALITY,
  PNG_MIME_TYPE,
} from './constants.ts'
import { createCanvasContext } from './context.ts'
import { installCanvasDimensions } from './dimensions.ts'
import { requestCanvasPresentation } from './presentation.ts'
import { contextSettings } from './settings.ts'
import { canvasStates } from './state.ts'
import type { CanvasState } from './types.ts'
import { conversionOptions } from './utils/conversion-options.ts'
import { flattenOpaque } from './utils/flatten-opaque.ts'
import { pixelBytes } from './utils/pixel-bytes.ts'
import { placeholderCaller } from './utils/placeholder-caller.ts'

type ImageMimeType =
  typeof PNG_MIME_TYPE | typeof JPEG_MIME_TYPE | typeof WEBP_MIME_TYPE

/** Connects real native rendering to Happy DOM and owns pending output until a runner drains and disposes the environment.
 * @example const adapter = new ExtendedCanvasAdapter(); new Window({ settings: { canvasAdapter: adapter } });
 */
export class ExtendedCanvasAdapter implements ICanvasAdapter {
  #states = new WeakMap<ICanvasShape, CanvasState>()
  #liveStates = new Set<WeakRef<CanvasState>>()
  #collectedStates = new FinalizationRegistry<WeakRef<CanvasState>>(
    (reference) => this.#liveStates.delete(reference),
  )
  #pending = new Set<Promise<void>>()
  #callbackErrors: unknown[] = []
  #disposed = false
  #allocatedBytes = 0
  #reservations = new Set<() => void>()
  #allocations = new WeakMap<Canvas, { bytes: number }>()
  #collectedBitmaps = new FinalizationRegistry<{ bytes: number }>(
    (allocation) => {
      this.#allocatedBytes -= allocation.bytes
    },
  )

  /** Supplies one context per owner when Happy DOM calls the adapter, installing dimension tracking once.
   * @returns The owner's stable 2D context, or null for an unsupported context type.
   * @example canvas.getContext('2d') === canvas.getContext('2d');
   */
  getContext(
    ...argumentsList: Parameters<ICanvasAdapter['getContext']>
  ): ReturnType<ICanvasAdapter['getContext']> {
    const [caller, contextType] = argumentsList
    if (this.#disposed)
      throw new Error('The Canvas environment has been disposed.')
    if (contextType !== '2d') return null
    const existing = this.#states.get(caller.canvas)
    if (existing) {
      if (existing.unavailable)
        throw new caller.window.DOMException(
          'Canvas is unavailable.',
          'InvalidStateError',
        )
      return existing.context
    }
    const settings = contextSettings(caller.window, argumentsList[2])
    const bitmap = this.#allocate(
      caller,
      caller.canvas.width,
      caller.canvas.height,
    )
    let nativeContext
    try {
      nativeContext = bitmap.getContext('2d')
    } catch (error) {
      disposeAll([() => this.#release(bitmap)], [error])
      throw error
    }
    const state: CanvasState = {
      caller,
      bitmap,
      nativeContext,
      readPixels: nativeContext.getImageData.bind(nativeContext),
      writePixels: nativeContext.putImageData.bind(nativeContext),
      reserveStorage: (bytes) => this.reserveStorage(caller.window, bytes),
      context: null,
      width: caller.canvas.width,
      height: caller.canvas.height,
      originClean: true,
      unavailable: false,
      settings,
      reset: () => this.#reset(state),
      restorers: [
        () => {
          state.unavailable = true
          canvasStates.delete(caller.canvas)
          this.#release(bitmap)
        },
      ],
    }
    try {
      state.context = createCanvasContext(state)
      flattenOpaque(state)
      installCanvasDimensions(state)
    } catch (error) {
      disposeAll(state.restorers, [error])
      throw error
    }
    canvasStates.set(caller.canvas, state)
    this.#states.set(caller.canvas, state)
    const reference = new WeakRef(state)
    this.#liveStates.add(reference)
    this.#collectedStates.register(state, reference, reference)
    return state.context
  }

  /** Encodes current pixels when Happy DOM requests a synchronous data URL, without creating a context for blank canvases.
   * @returns A real PNG/JPEG data URL, or data:, for an empty or unencodable bitmap.
   * @example canvas.toDataURL('image/unsupported').startsWith('data:image/png;');
   */
  toDataURL(
    caller: ICanvasAdapterCaller,
    type?: string,
    quality?: unknown,
  ): string {
    caller = placeholderCaller(caller)
    const mimeType = this.#mimeType(caller, type)
    if (this.#disposed)
      throw new Error('The Canvas environment has been disposed.')
    const state = this.#states.get(caller.canvas)
    this.#readable(state)
    if (!caller.canvas.width || !caller.canvas.height)
      return EMPTY_IMAGE_DATA_URL
    const existing = state?.bitmap
    let bitmap = existing
    try {
      bitmap ??= this.#allocate(
        caller,
        caller.canvas.width,
        caller.canvas.height,
      )
      if (!bitmap.width || !bitmap.height) return EMPTY_IMAGE_DATA_URL
      return mimeType !== PNG_MIME_TYPE
        ? bitmap.toDataURL(ENCODER_FORMATS[mimeType], this.#quality(quality))
        : bitmap.toDataURL(ENCODER_FORMATS[mimeType])
    } catch {
      return EMPTY_IMAGE_DATA_URL
    } finally {
      if (!existing && bitmap) this.#release(bitmap)
    }
  }

  /** Copies pixels at invocation and registers encoding with Happy DOM before returning to application code.
   * @returns Nothing; delivers a Blob or null asynchronously, including zero-size HTML canvases.
   * @example canvas.toBlob(callback); context.fillRect(0, 0, 1, 1); // Output keeps the earlier image.
   */
  toBlob(...argumentsList: Parameters<ICanvasAdapter['toBlob']>): void {
    const [sourceCaller, callback, type, quality] = argumentsList
    const caller = placeholderCaller(sourceCaller)
    if (this.#disposed)
      throw new Error('The Canvas environment has been disposed.')
    if (typeof callback !== 'function')
      throw new caller.window.TypeError('Canvas toBlob requires a callback.')
    const mimeType = this.#mimeType(caller, type)
    if (
      sourceCaller.canvas instanceof OffscreenCanvas &&
      (!caller.canvas.width || !caller.canvas.height)
    ) {
      throw new caller.window.DOMException(
        'The canvas has no pixels.',
        'IndexSizeError',
      )
    }
    this.#readable(this.#states.get(caller.canvas))
    const empty = !caller.canvas.width || !caller.canvas.height
    let snapshot: Canvas
    try {
      snapshot = this.#snapshot(caller)
    } catch {
      // Refused copies are encoding failures; keep callbacks asynchronous and visible to drain.
      const deliver = this.#registerOutput(caller, null, callback, mimeType)
      setImmediate(() => deliver(null))
      return
    }
    const deliver = this.#registerOutput(caller, snapshot, callback, mimeType)
    try {
      if (empty) setImmediate(() => deliver(null))
      else {
        const encoderQuality = this.#quality(quality)
        const output = snapshot.toBuffer(
          ENCODER_FORMATS[mimeType],
          encoderQuality === undefined ? {} : { quality: encoderQuality },
        )
        void output.then(
          (buffer) => deliver(null, buffer),
          (error: unknown) =>
            deliver(error instanceof Error ? error : new Error(String(error))),
        )
      }
    } catch (error) {
      // Native synchronous failures still follow the asynchronous Web API callback contract.
      setImmediate(() =>
        deliver(error instanceof Error ? error : new Error(String(error))),
      )
    }
  }

  /** Registers one native output with both Happy DOM and the runner's own completion queue.
   * @returns A callback that releases the image and task even when consumer code throws.
   * @example const deliver = this.#registerOutput(caller, snapshot, callback, 'image/png');
   */
  #registerOutput(
    caller: ICanvasAdapterCaller,
    snapshot: Canvas | null,
    callback: Parameters<ICanvasAdapter['toBlob']>[1],
    mimeType: ImageMimeType,
  ): (error: Error | null, buffer?: Buffer) => void {
    const tasks = caller.browserFrame[PropertySymbol.asyncTaskManager]
    let taskId: number
    try {
      taskId = tasks.startTask()
    } catch (error) {
      disposeAll(snapshot ? [() => this.#release(snapshot)] : [], [error])
      throw error
    }
    let complete!: () => void
    const pending = new Promise<void>((resolve) => {
      complete = resolve
    })
    this.#pending.add(pending)
    const deliver = (error: Error | null, buffer?: Buffer): void => {
      try {
        callback(
          error || !buffer
            ? null
            : new caller.window.Blob([new caller.window.Uint8Array(buffer)], {
                type: mimeType,
              }),
        )
      } catch (callbackError) {
        // Report user exceptions after every native job and restoration has completed.
        this.#callbackErrors.push(callbackError)
      } finally {
        try {
          disposeAll([
            () => tasks.endTask(taskId),
            () => {
              if (snapshot) this.#release(snapshot)
            },
          ])
        } catch (cleanupError) {
          this.#callbackErrors.push(cleanupError)
        } finally {
          this.#pending.delete(pending)
          complete()
        }
      }
    }
    return deliver
  }

  /** Waits only for this adapter's output when the runner is about to close its Window.
   * @returns A promise settling after callbacks and temporary images are released, reporting callback failures.
   * @example await adapter.drain(); await environment.teardown();
   */
  async drain(): Promise<void> {
    while (this.#pending.size) await Promise.all(this.#pending)
    disposeAll([], this.#callbackErrors.splice(0))
  }

  /** Reserves non-Canvas image storage before a decoder runs, sharing the adapter's live raster and snapshot budget.
   * @internal
   * @returns An idempotent release callback for the owning source lifecycle.
   * @example const release = adapter.reserveStorage(window, encoded.length + pixelBytes); release();
   */
  reserveStorage(
    window: ICanvasAdapterCaller['window'],
    bytes: number,
  ): () => void {
    if (this.#disposed)
      throw new window.DOMException(
        'The Canvas environment is closing.',
        'InvalidStateError',
      )
    if (
      !Number.isSafeInteger(bytes) ||
      bytes < 0 ||
      this.#allocatedBytes + bytes > MAX_NATIVE_STORAGE_BYTES
    )
      throw new window.RangeError(
        'Canvas exceeds the environment native pixel budget.',
      )
    this.#allocatedBytes += bytes
    let released = false
    const release = () => {
      if (released) return
      released = true
      this.#allocatedBytes -= bytes
      this.#reservations.delete(release)
    }
    this.#reservations.add(release)
    return release
  }

  /** Restores surviving Canvas instances after draining output, without retaining canvases already collected.
   * @returns Nothing; repeats safely and attempts every restoration even after a failure.
   * @example await adapter.drain(); adapter.dispose();
   */
  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    const restorers = [...this.#reservations]
    for (const reference of this.#liveStates) {
      const state = reference.deref()
      this.#collectedStates.unregister(reference)
      if (state) restorers.push(() => disposeAll(state.restorers))
    }
    this.#liveStates.clear()
    this.#states = new WeakMap()
    disposeAll(restorers)
  }

  /** Captures pixels directly for encoders without an image encode/decode round trip.
   * @returns An independently owned bitmap released by the output operation.
   * @example const snapshot = this.#snapshot(caller);
   */
  #snapshot(caller: ICanvasAdapterCaller): Canvas {
    const snapshot = this.#allocate(
      caller,
      caller.canvas.width,
      caller.canvas.height,
    )
    const state = this.#states.get(caller.canvas)
    try {
      if (state && state.width * state.height > 0)
        snapshot.getContext('2d').drawImage(state.bitmap, 0, 0)
      return snapshot
    } catch (error) {
      disposeAll([() => this.#release(snapshot)], [error])
      throw error
    }
  }

  /** Releases encoder-owned native storage after completion or an early failure.
   * @returns Nothing.
   * @example this.#release(snapshot);
   */
  #release(bitmap: Canvas): void {
    const allocation = this.#allocations.get(bitmap)
    try {
      // Both axes must be attempted even if one native reset fails.
      disposeAll([
        () => {
          bitmap.width = MIN_NATIVE_SIZE_PX
        },
        () => {
          bitmap.height = MIN_NATIVE_SIZE_PX
        },
      ])
    } finally {
      if (allocation) {
        const bytes = bitmap.width * bitmap.height * RGBA_BYTES_PER_PIXEL
        this.#allocatedBytes += bytes - allocation.bytes
        allocation.bytes = bytes
        if (bytes === 0) {
          this.#allocations.delete(bitmap)
          this.#collectedBitmaps.unregister(bitmap)
        }
      }
    }
  }

  /** Normalizes the requested format before allocating native storage or registering asynchronous work.
   * @returns A supported PNG/JPEG/WebP MIME type, with PNG for unknown formats.
   * @example this.#mimeType(caller, 'image/unknown'); // image/png
   */
  #mimeType(caller: ICanvasAdapterCaller, type: unknown): ImageMimeType {
    const requested = conversions
      .DOMString(type, conversionOptions(caller.window))
      .toLowerCase()
    return requested === JPEG_MIME_TYPE || requested === WEBP_MIME_TYPE
      ? requested
      : PNG_MIME_TYPE
  }

  /** Rejects native allocation before an encoder or context can exhaust the environment's raster budget.
   * @returns The physical byte count, including the minimal surface for logical zero.
   * @example this.#storage(caller, 2, 1); // 8
   */
  #storage(
    caller: ICanvasAdapterCaller,
    width: number,
    height: number,
    previous = 0,
  ): number {
    const bytes = pixelBytes(caller.window, width, height)
    if (this.#allocatedBytes - previous + bytes > MAX_NATIVE_STORAGE_BYTES) {
      throw new caller.window.RangeError(
        'Canvas exceeds the environment native pixel budget.',
      )
    }
    return bytes
  }

  /** Allocates one tracked raster for a context or invocation snapshot, reserving budget before native code runs.
   * @returns A real native Canvas owned by this adapter until released.
   * @example const snapshot = this.#allocate(caller, 1, 1);
   */
  #allocate(
    caller: ICanvasAdapterCaller,
    width: number,
    height: number,
  ): Canvas {
    const bytes = this.#storage(caller, width, height)
    const empty = width * height === 0
    const bitmap = new Canvas(
      empty ? MIN_NATIVE_SIZE_PX : width,
      empty ? MIN_NATIVE_SIZE_PX : height,
    )
    bitmap.gpu = false
    const allocation = { bytes }
    this.#allocatedBytes += bytes
    this.#allocations.set(bitmap, allocation)
    this.#collectedBitmaps.register(bitmap, allocation, bitmap)
    return bitmap
  }

  /** Resets pixels, path and drawing state synchronously after any owner dimension mutation.
   * @returns Nothing; an oversized request clears old pixels and reports the native limit.
   * @example canvas.width = canvas.width; // Clears the existing context.
   */
  #reset(state: CanvasState): void {
    const { bitmap, caller } = state
    if (this.#disposed)
      throw new caller.window.DOMException(
        'Canvas is unavailable.',
        'InvalidStateError',
      )
    const allocation = this.#allocations.get(bitmap)!
    state.width = caller.canvas.width
    state.height = caller.canvas.height
    state.originClean = true
    state.unavailable = true
    try {
      this.#storage(caller, state.width, state.height, allocation.bytes)
    } catch (error) {
      // Reflection keeps the requested size, but stale pixels cannot survive a rejected allocation.
      disposeAll([() => this.#resizeBitmap(bitmap, 0, 0)], [error])
      throw error
    }
    this.#resizeBitmap(bitmap, state.width, state.height)
    state.nativeContext.reset()
    flattenOpaque(state)
    state.unavailable = false
    requestCanvasPresentation(caller.canvas)
  }

  /** Updates physical storage after validation, shrinking first to avoid an oversized intermediate rectangle.
   * @returns Nothing; native failures still update the accounting for storage that remains live.
   * @example this.#resizeBitmap(bitmap, 2, 1);
   */
  #resizeBitmap(bitmap: Canvas, width: number, height: number): void {
    const empty = width * height === 0
    try {
      bitmap.width = MIN_NATIVE_SIZE_PX
      bitmap.height = empty ? MIN_NATIVE_SIZE_PX : height
      bitmap.width = empty ? MIN_NATIVE_SIZE_PX : width
    } finally {
      this.#accountBitmap(bitmap)
    }
  }

  /** Reconciles native byte ownership after resizing succeeds or partially fails.
   * @returns Nothing; a zero-size live Canvas retains its allocation record for later resizes.
   * @example this.#accountBitmap(bitmap);
   */
  #accountBitmap(bitmap: Canvas): void {
    const allocation = this.#allocations.get(bitmap)
    if (!allocation) return
    const bytes = bitmap.width * bitmap.height * RGBA_BYTES_PER_PIXEL
    this.#allocatedBytes += bytes - allocation.bytes
    allocation.bytes = bytes
  }

  /** Blocks readback before native work when the owning raster is unavailable or origin-tainted.
   * @returns Nothing for a readable or uninitialized canvas.
   * @example this.#readable(this.#states.get(canvas));
   */
  #readable(state: CanvasState | undefined): void {
    if (!state) return
    if (state.unavailable)
      throw new state.caller.window.DOMException(
        'Canvas is unavailable.',
        'InvalidStateError',
      )
    if (!state.originClean)
      throw new state.caller.window.DOMException(
        'Canvas is not origin-clean.',
        'SecurityError',
      )
  }

  /** Applies the Web API's valid quality range before passing an optional setting to native encoders.
   * @returns A valid quality or undefined, which selects the encoder default.
   * @example this.#quality(2); // undefined
   */
  #quality(quality: unknown): number | undefined {
    return typeof quality === 'number' &&
      quality >= MIN_ENCODER_QUALITY &&
      quality <= MAX_ENCODER_QUALITY
      ? quality
      : undefined
  }
}
