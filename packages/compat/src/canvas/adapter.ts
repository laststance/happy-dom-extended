import { setImmediate } from 'node:timers'

import { CanvasAdapter } from '@happy-dom/node-canvas-adapter'
import canvas, { Canvas, createCanvas } from 'canvas'
import { OffscreenCanvas, PropertySymbol } from 'happy-dom'
import type {
  ICanvasAdapter,
  ICanvasAdapterCaller,
  ICanvasShape,
} from 'happy-dom'

import { disposeAll } from '../utils/dispose-all.ts'

import {
  EMPTY_IMAGE_DATA_URL,
  JPEG_MIME_TYPE,
  MAX_ENCODER_QUALITY,
  MIN_ENCODER_QUALITY,
  PNG_MIME_TYPE,
} from './constants.ts'
import { createCanvasContext } from './context.ts'
import { installCanvasDimensions } from './dimensions.ts'
import type { CanvasState } from './types.ts'

/** Connects real native rendering to Happy DOM and owns pending output until a runner drains and disposes the environment.
 * @example const adapter = new ExtendedCanvasAdapter(); new Window({ settings: { canvasAdapter: adapter } });
 */
export class ExtendedCanvasAdapter extends CanvasAdapter {
  #states = new WeakMap<ICanvasShape, CanvasState>()
  #liveStates = new Set<WeakRef<CanvasState>>()
  #collectedStates = new FinalizationRegistry<WeakRef<CanvasState>>(
    (reference) => this.#liveStates.delete(reference),
  )
  #pending = new Set<Promise<void>>()
  #callbackErrors: unknown[] = []
  #disposed = false

  /** Supplies one context per owner when Happy DOM calls the adapter, installing dimension tracking once.
   * @returns The owner's stable 2D context, or null for an unsupported context type.
   * @example canvas.getContext('2d') === canvas.getContext('2d');
   */
  override getContext(
    ...argumentsList: Parameters<ICanvasAdapter['getContext']>
  ): ReturnType<ICanvasAdapter['getContext']> {
    const [caller, contextType] = argumentsList
    if (this.#disposed)
      throw new Error('The Canvas environment has been disposed.')
    if (contextType !== '2d') return null
    const existing = this.#states.get(caller.canvas)
    if (existing) return existing.context
    const context = super.getContext(...argumentsList)
    if (!context) return null
    const bitmap: unknown = Reflect.get(context, 'canvas')
    if (!(bitmap instanceof Canvas))
      throw new TypeError('The Canvas adapter did not create a native canvas.')
    const state: CanvasState = {
      caller,
      bitmap,
      context: createCanvasContext(caller, context, bitmap),
      restorers: [
        () => {
          bitmap.width = 0
          bitmap.height = 0
        },
      ],
    }
    try {
      installCanvasDimensions(state)
    } catch (error) {
      disposeAll(state.restorers, [error])
      throw error
    }
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
  override toDataURL(
    caller: ICanvasAdapterCaller,
    type?: string,
    quality?: unknown,
  ): string {
    const mimeType = this.#mimeType(type)
    if (this.#disposed)
      throw new Error('The Canvas environment has been disposed.')
    const existing = this.#states.get(caller.canvas)?.bitmap
    const bitmap =
      existing ?? createCanvas(caller.canvas.width, caller.canvas.height)
    try {
      if (!bitmap.width || !bitmap.height) return EMPTY_IMAGE_DATA_URL
      return mimeType === JPEG_MIME_TYPE
        ? bitmap.toDataURL(mimeType, this.#quality(quality))
        : bitmap.toDataURL(mimeType)
    } catch {
      return EMPTY_IMAGE_DATA_URL
    } finally {
      if (!existing) this.#release(bitmap)
    }
  }

  /** Copies pixels at invocation and registers encoding with Happy DOM before returning to application code.
   * @returns Nothing; delivers a Blob or null asynchronously, including zero-size HTML canvases.
   * @example canvas.toBlob(callback); context.fillRect(0, 0, 1, 1); // Output keeps the earlier image.
   */
  override toBlob(
    ...argumentsList: Parameters<ICanvasAdapter['toBlob']>
  ): void {
    const [caller, callback, type, quality] = argumentsList
    if (this.#disposed)
      throw new Error('The Canvas environment has been disposed.')
    if (typeof callback !== 'function')
      throw new TypeError('Canvas toBlob requires a callback.')
    const mimeType = this.#mimeType(type)
    if (
      caller.canvas instanceof OffscreenCanvas &&
      (!caller.canvas.width || !caller.canvas.height)
    ) {
      throw new caller.window.DOMException(
        'The canvas has no pixels.',
        'IndexSizeError',
      )
    }
    const snapshot = this.#snapshot(caller)
    const deliver = this.#registerOutput(caller, snapshot, callback, mimeType)
    try {
      if (!snapshot.width || !snapshot.height) setImmediate(() => deliver(null))
      else if (mimeType === JPEG_MIME_TYPE) {
        const encoderQuality = this.#quality(quality)
        snapshot.toBuffer(
          deliver,
          mimeType,
          encoderQuality === undefined ? {} : { quality: encoderQuality },
        )
      } else snapshot.toBuffer(deliver, mimeType)
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
    snapshot: Canvas,
    callback: Parameters<ICanvasAdapter['toBlob']>[1],
    mimeType: typeof PNG_MIME_TYPE | typeof JPEG_MIME_TYPE,
  ): (error: Error | null, buffer?: Buffer) => void {
    const tasks = caller.browserFrame[PropertySymbol.asyncTaskManager]
    let taskId: number
    try {
      taskId = tasks.startTask()
    } catch (error) {
      this.#release(snapshot)
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
            () => this.#release(snapshot),
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

  /** Restores surviving Canvas instances after draining output, without retaining canvases already collected.
   * @returns Nothing; repeats safely and attempts every restoration even after a failure.
   * @example await adapter.drain(); adapter.dispose();
   */
  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    const restorers = []
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
    const snapshot = createCanvas(caller.canvas.width, caller.canvas.height)
    const state = this.#states.get(caller.canvas)
    try {
      if (state && Math.min(snapshot.width, snapshot.height) > 0)
        snapshot.getContext('2d').drawImage(state.bitmap, 0, 0)
      return snapshot
    } catch (error) {
      this.#release(snapshot)
      throw error
    }
  }

  /** Releases encoder-owned native storage after completion or an early failure.
   * @returns Nothing.
   * @example this.#release(snapshot);
   */
  #release(bitmap: Canvas): void {
    bitmap.width = 0
    bitmap.height = 0
  }

  /** Normalizes the requested format before allocating native storage or registering asynchronous work.
   * @returns JPEG for its supported MIME type, otherwise the required PNG fallback.
   * @example this.#mimeType('image/webp'); // image/png
   */
  #mimeType(type: unknown): typeof PNG_MIME_TYPE | typeof JPEG_MIME_TYPE {
    // Source builds can omit JPEG; its native encoder otherwise never calls the completion callback.
    return String(type).toLowerCase() === JPEG_MIME_TYPE &&
      canvas.jpegVersion !== undefined
      ? JPEG_MIME_TYPE
      : PNG_MIME_TYPE
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
