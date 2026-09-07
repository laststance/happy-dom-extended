import { setImmediate } from 'node:timers'
import { types } from 'node:util'
import type { MessagePort } from 'node:worker_threads'
import { MessageChannel } from 'node:worker_threads'

import { HTMLCanvasElement, OffscreenCanvas, PropertySymbol } from 'happy-dom'
import type { Window, BrowserWindow } from 'happy-dom'
import { ImageData } from 'skia-canvas'

import type { DisposeCompatibility } from '../types.ts'
import { disposeAll } from '../utils/dispose-all.ts'
import { replaceProperty } from '../utils/replace-property.ts'

import type { ExtendedCanvasAdapter } from './adapter.ts'
import { canvasStates, canvasWindows, detachedOffscreens } from './state.ts'
import { pixelBytes } from './utils/pixel-bytes.ts'

export const htmlPlaceholders = new WeakMap<
  HTMLCanvasElement,
  OffscreenCanvas
>()
export const offscreenPresenters = new WeakMap<OffscreenCanvas, MessagePort>()
const presentationUpdates = new WeakMap<OffscreenCanvas, () => void>()
const presentationClosers = new WeakMap<
  BrowserWindow,
  { adapter: ExtendedCanvasAdapter; closers: Set<DisposeCompatibility> }
>()
const collectedPlaceholders = new FinalizationRegistry<MessagePort>((port) =>
  port.close(),
)

/** Registers a native presentation endpoint with its Window and drops it promptly when a transfer closes the old endpoint.
 * @returns Nothing; all ports close on Window disposal even if consumers retain detached canvases.
 * @example trackPresentationPort(window, port, releaseFrame);
 */
function trackPresentationPort(
  window: BrowserWindow,
  port: MessagePort,
  release: DisposeCompatibility,
): void {
  const { closers } = presentationClosers.get(window)!
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    closers.delete(close)
    port.removeAllListeners()
    release()
    port.close()
  }
  closers.add(close)
  port.once('close', close)
}

/** Coalesces drawing within one event-loop turn and bounds presentation to one unacknowledged real frame per canvas.
 * @returns Nothing; resize or drawing asks this channel to present the latest state.
 * @example bindCanvasPresenter(canvas, transferredPresentationPort);
 */
export function bindCanvasPresenter(
  canvas: OffscreenCanvas,
  port: MessagePort,
): void {
  const window = canvas[PropertySymbol.window]
  const reference = new WeakRef(canvas)
  offscreenPresenters.set(canvas, port)
  let scheduled = false
  let pending = false
  let dirty = false
  let release = () => {}
  const update = () => {
    dirty = true
    if (scheduled || pending) return
    scheduled = true
    setImmediate(function presentCanvasFrame() {
      scheduled = false
      const owner = reference.deref()
      if (
        !owner ||
        detachedOffscreens.has(owner) ||
        offscreenPresenters.get(owner) !== port
      )
        return
      const adapter = presentationClosers.get(window)?.adapter
      if (!adapter) return
      try {
        const state = canvasStates.get(owner)
        if (state?.unavailable) return
        release = adapter.reserveStorage(
          window,
          state ? pixelBytes(window, state.width, state.height) : 0,
        )
        const data =
          state?.width && state.height
            ? state.readPixels(0, 0, state.width, state.height).data
            : new Uint8ClampedArray()
        if (!types.isArrayBuffer(data.buffer))
          throw new window.TypeError(
            'Presentation pixels must own transferable storage.',
          )
        pending = true
        dirty = false
        port.postMessage(
          {
            width: owner.width,
            height: owner.height,
            data,
            originClean: state?.originClean ?? true,
          },
          [data.buffer],
        )
      } catch (error) {
        release()
        pending = false
        window.dispatchEvent(
          new window.ErrorEvent('error', {
            message: 'Canvas presentation failed.',
            error:
              error instanceof Error ? error : new window.Error(String(error)),
          }),
        )
      }
    })
  }
  presentationUpdates.set(canvas, update)
  port.on('message', (message) => {
    release()
    pending = false
    if (message?.error) {
      window.dispatchEvent(
        new window.ErrorEvent('error', { message: String(message.error) }),
      )
    }
    if (dirty) update()
  })
  trackPresentationPort(window, port, () => {
    release()
    const owner = reference.deref()
    if (owner && offscreenPresenters.get(owner) === port) {
      offscreenPresenters.delete(owner)
      presentationUpdates.delete(owner)
    }
  })
}

/** Requests asynchronous placeholder presentation after successful pixel mutations or logical resizing.
 * @returns Nothing for ordinary canvases without an HTML placeholder.
 * @example requestCanvasPresentation(state.caller.canvas);
 */
export function requestCanvasPresentation(canvas: object): void {
  if (canvas instanceof OffscreenCanvas) presentationUpdates.get(canvas)?.()
}

/** Copies a validated frame into the parent's hidden display surface; HTML exports and image sources read this exact surface.
 * @returns Nothing; receiver failures are reported to the sender without retaining transferred pixel buffers.
 * @example receiveCanvasPresentation(window, display, message);
 */
function receiveCanvasPresentation(
  window: BrowserWindow,
  display: OffscreenCanvas,
  message: unknown,
): void {
  if (!message || typeof message !== 'object')
    throw new window.TypeError('Invalid canvas presentation.')
  const width: unknown = Reflect.get(message, 'width')
  const height: unknown = Reflect.get(message, 'height')
  const data: unknown = Reflect.get(message, 'data')
  const originClean: unknown = Reflect.get(message, 'originClean')
  if (
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    !types.isUint8ClampedArray(data) ||
    typeof originClean !== 'boolean'
  )
    throw new window.TypeError('Invalid canvas presentation fields.')
  const bytes = pixelBytes(window, width, height)
  if (data.byteLength && data.byteLength !== bytes)
    throw new window.TypeError('Invalid presentation pixels.')
  const adapter = presentationClosers.get(window)?.adapter
  if (!adapter) return
  const release = adapter.reserveStorage(window, data.byteLength)
  try {
    Reflect.set(display, 'width', width)
    Reflect.set(display, 'height', height)
    display.getContext('2d')
    const state = canvasStates.get(display)!
    state.originClean = originClean
    if (data.byteLength)
      state.writePixels(new ImageData(data, width, height), 0, 0)
  } finally {
    release()
  }
}

/** Creates owned HTML placeholders and tracks both ends of the private presentation channel through transfer and teardown.
 * @returns Nothing; shared HTML hooks continue to route foreign adapters to their original implementation.
 * @example installCanvasPresentation(window, adapter, restorers);
 */
export function installCanvasPresentation(
  window: Window,
  adapter: ExtendedCanvasAdapter,
  restorers: DisposeCompatibility[],
): void {
  const closers = new Set<DisposeCompatibility>()
  presentationClosers.set(window, { adapter, closers })
  restorers.push(() => {
    try {
      disposeAll([...closers])
    } finally {
      presentationClosers.delete(window)
    }
  })
  const transfer = HTMLCanvasElement.prototype.transferControlToOffscreen
  restorers.push(
    replaceProperty(HTMLCanvasElement.prototype, 'transferControlToOffscreen', {
      writable: true,
      value(this: HTMLCanvasElement) {
        const owner = this[PropertySymbol.window]
        if (!canvasWindows.has(owner)) return transfer.call(this)
        if (htmlPlaceholders.has(this) || canvasStates.has(this))
          throw new owner.DOMException(
            'Canvas already has a context or placeholder.',
            'InvalidStateError',
          )
        const canvas = new owner.OffscreenCanvas(this.width, this.height)
        const display = new owner.OffscreenCanvas(this.width, this.height)
        const channel = new MessageChannel()
        const reference = new WeakRef(this)
        try {
          bindCanvasPresenter(canvas, channel.port2)
          htmlPlaceholders.set(this, display)
          channel.port1.on('message', (message: unknown) => {
            const element = reference.deref()
            if (!element) {
              channel.port1.close()
              return
            }
            try {
              receiveCanvasPresentation(
                owner,
                htmlPlaceholders.get(element)!,
                message,
              )
              channel.port1.postMessage({})
            } catch (error) {
              channel.port1.postMessage({ error: String(error) })
            }
          })
          collectedPlaceholders.register(this, channel.port1, channel.port1)
          trackPresentationPort(owner, channel.port1, () =>
            collectedPlaceholders.unregister(channel.port1),
          )
          return canvas
        } catch (error) {
          // A failed setup must leave this HTML canvas eligible for another transfer attempt.
          htmlPlaceholders.delete(this)
          offscreenPresenters.delete(canvas)
          presentationUpdates.delete(canvas)
          collectedPlaceholders.unregister(channel.port1)
          disposeAll(
            [() => channel.port1.close(), () => channel.port2.close()],
            [error],
          )
          throw error
        }
      },
    }),
  )
}
