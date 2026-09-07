import { types } from 'node:util'
import type { Transferable } from 'node:worker_threads'
import { MessagePort } from 'node:worker_threads'

import {
  BrowserWindow,
  ImageBitmap,
  Node,
  OffscreenCanvas,
  PropertySymbol,
} from 'happy-dom'
import type { ICanvasAdapterCaller, Window } from 'happy-dom'
import { Canvas, ImageData } from 'skia-canvas'

import type { DisposeCompatibility } from '../types.ts'
import { disposeAll } from '../utils/dispose-all.ts'
import { replaceProperty } from '../utils/replace-property.ts'

import { ExtendedCanvasAdapter } from './adapter.ts'
import { bitmapOptions } from './bitmap-options.ts'
import { closeBitmapStorage, makeImageBitmap } from './bitmaps.ts'
import { WindowBrowserContext } from './happy-dom-internals.ts'
import { bindCanvasPresenter, offscreenPresenters } from './presentation.ts'
import {
  bitmapStates,
  canvasStates,
  canvasWindows,
  detachedOffscreens,
  offscreenDimensions,
  canvasPortTokens,
  canvasPortInstallers,
} from './state.ts'
import { mapError } from './utils/map-error.ts'
import { nativeStructuredValue } from './utils/native-structured-value.ts'
import { pixelBytes } from './utils/pixel-bytes.ts'
import { transferList } from './utils/transfer-list.ts'

const nativeClone = globalThis.structuredClone

interface CanvasTransferRecord {
  kind: 'bitmap' | 'offscreen'
  width: number
  height: number
  data: Uint8ClampedArray
  presentation: MessagePort | undefined
}

/** The outer map uses object identity, so ordinary user keys can never masquerade as Canvas placeholders. */
export interface CanvasTransferEnvelope {
  value: unknown
  records: Map<object, CanvasTransferRecord>
  ports: Map<MessagePort, string>
}

/** Rejects closed, tainted, foreign or context-bound Canvas transfer entries without changing any sender.
 * @returns Nothing; the caller Window supplies the standard exception family.
 * @example validateCanvasTransfer(window, bitmap);
 */
function validateCanvasTransfer(
  window: ICanvasAdapterCaller['window'],
  value: ImageBitmap | OffscreenCanvas,
): void {
  if (value instanceof ImageBitmap) {
    const state = bitmapStates.get(value)
    if (
      !state ||
      state.unavailable ||
      !state.originClean ||
      !value[PropertySymbol.canvas]
    )
      throw new window.DOMException(
        'ImageBitmap is closed, tainted or not owned.',
        'DataCloneError',
      )
    return
  }
  const owner: unknown = Reflect.get(value, PropertySymbol.window)
  if (
    !(owner instanceof BrowserWindow) ||
    !canvasWindows.has(owner) ||
    !offscreenDimensions.has(value) ||
    detachedOffscreens.has(value)
  )
    throw new window.DOMException(
      'OffscreenCanvas is detached or not owned.',
      'DataCloneError',
    )
  if (canvasStates.has(value))
    throw new window.DOMException(
      'An OffscreenCanvas with a context cannot transfer.',
      'InvalidStateError',
    )
}

/** Walks ordinary structured data once, replacing Canvas objects while leaving native special values to the native serializer.
 * @returns A graph preserving cycles, aliases, sparse arrays, Map keys and Set entries.
 * @example mapCanvasGraph(value, object => replacements.get(object));
 */
function mapCanvasGraph(
  value: unknown,
  replace: (value: object) => object | undefined,
  seen = new Map<object, unknown>(),
): unknown {
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return seen.get(value)
  const replacement = replace(value)
  if (replacement) {
    seen.set(value, replacement)
    return replacement
  }
  // Native typed storage/errors/ports retain their own serialization rules; proxies must reach the native rejection path intact.
  if (nativeStructuredValue(value)) return value
  if (types.isNativeError(value))
    return mapError(value, seen, (entry) =>
      mapCanvasGraph(entry, replace, seen),
    )
  if (types.isMap(value)) {
    const mapped = new Map<unknown, unknown>()
    seen.set(value, mapped)
    Map.prototype.forEach.call(value, (entry: unknown, key: unknown) => {
      mapped.set(
        mapCanvasGraph(key, replace, seen),
        mapCanvasGraph(entry, replace, seen),
      )
    })
    return mapped
  }
  if (types.isSet(value)) {
    const mapped = new Set<unknown>()
    seen.set(value, mapped)
    for (const entry of Set.prototype.values.call(value))
      mapped.add(mapCanvasGraph(entry, replace, seen))
    return mapped
  }
  const mapped: object = Array.isArray(value) ? new Array(value.length) : {}
  seen.set(value, mapped)
  for (const key of Object.keys(value)) {
    if (!Object.getOwnPropertyDescriptor(value, key)?.enumerable) continue
    // Define data properties so '__proto__' stays a user key and each getter runs only once.
    Object.defineProperty(mapped, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: mapCanvasGraph(Reflect.get(value, key), replace, seen),
    })
  }
  return mapped
}

/** Prepares one Canvas serialization without detaching anything; callers commit only after the native operation succeeds.
 * @returns The envelope, native transferables and explicit success/failure cleanup callbacks.
 * @example const prepared = prepareCanvasTransfer(window, message, []); nativePort.postMessage(prepared.envelope, prepared.transfer); prepared.commit();
 */
export function prepareCanvasTransfer(
  window: ICanvasAdapterCaller['window'],
  value: unknown,
  transfers: unknown[],
) {
  const requested = new Set<unknown>()
  const owned: (ImageBitmap | OffscreenCanvas)[] = []
  const native: Transferable[] = []
  const releases: DisposeCompatibility[] = []
  const records = new Map<object, CanvasTransferRecord>()
  const ports = new Map<MessagePort, string>()
  const markers = new Map<object, object>()
  const adapter = new WindowBrowserContext(window).getSettings()?.canvasAdapter
  if (!(adapter instanceof ExtendedCanvasAdapter))
    throw new window.DOMException(
      'The Canvas environment is unavailable.',
      'InvalidStateError',
    )
  try {
    transfers.forEach(function collectTransferEntry(entry) {
      if (requested.has(entry))
        throw new window.DOMException(
          'The transfer list contains duplicates.',
          'DataCloneError',
        )
      requested.add(entry)
      if (entry instanceof ImageBitmap || entry instanceof OffscreenCanvas) {
        validateCanvasTransfer(window, entry)
        owned.push(entry)
      } else {
        // Native serialization performs the authoritative native-brand and detached-buffer validation once.
        native.push(entry as Transferable)
        if (entry instanceof MessagePort) {
          const token = canvasPortTokens.get(entry)
          if (token) ports.set(entry, token)
        }
      }
    })
    const replacement = (source: object): object | undefined => {
      if (source instanceof Node)
        throw new window.DOMException(
          'DOM nodes cannot be cloned.',
          'DataCloneError',
        )
      if (
        !(source instanceof ImageBitmap) &&
        !(source instanceof OffscreenCanvas)
      )
        return undefined
      const existing = markers.get(source)
      if (existing) return existing
      validateCanvasTransfer(window, source)
      if (source instanceof OffscreenCanvas && !requested.has(source))
        throw new window.DOMException(
          'OffscreenCanvas requires a transfer entry.',
          'DataCloneError',
        )
      const width = source.width
      const height = source.height
      const length =
        source instanceof ImageBitmap ? pixelBytes(window, width, height) : 0
      releases.push(adapter.reserveStorage(window, length))
      const state =
        source instanceof ImageBitmap ? bitmapStates.get(source) : undefined
      const data =
        state && width && height
          ? state.readPixels(0, 0, width, height).data
          : new Uint8ClampedArray()
      const marker = {}
      const presentation =
        source instanceof OffscreenCanvas
          ? offscreenPresenters.get(source)
          : undefined
      if (presentation) native.push(presentation)
      records.set(marker, {
        kind: source instanceof ImageBitmap ? 'bitmap' : 'offscreen',
        width,
        height,
        data,
        presentation,
      })
      markers.set(source, marker)
      if (!types.isArrayBuffer(data.buffer))
        throw new window.TypeError(
          'A raster snapshot must own transferable storage.',
        )
      native.push(data.buffer)
      return marker
    }
    const mapped = mapCanvasGraph(value, replacement)
    // A listed Canvas can transfer without being reachable from the message.
    for (const source of owned) replacement(source)
    // Consumer getters may have closed a bitmap or created a context during graph preparation.
    for (const source of owned) validateCanvasTransfer(window, source)
    return {
      envelope: {
        value: mapped,
        records,
        ports,
      } satisfies CanvasTransferEnvelope,
      transfer: native,
      commit() {
        for (const source of owned) {
          if (source instanceof ImageBitmap) closeBitmapStorage(source)
          else {
            detachedOffscreens.add(source)
            const dimensions = offscreenDimensions.get(source)!
            dimensions.width = 0
            dimensions.height = 0
          }
        }
      },
      release() {
        disposeAll(releases)
      },
    }
  } catch (error) {
    disposeAll(releases, [error])
    throw error
  }
}

/** Allocates receiver rasters before synchronous clone can detach senders, or immediately after asynchronous message delivery.
 * @returns Receiver objects keyed by private marker identity; failed allocation releases all partial receivers.
 * @example const receivers = allocateCanvasReceivers(window, prepared.envelope);
 */
function allocateCanvasReceivers(
  window: ICanvasAdapterCaller['window'],
  envelope: CanvasTransferEnvelope,
) {
  const replacements = new Map<object, ImageBitmap | OffscreenCanvas>()
  let release = () => {}
  try {
    const adapter = new WindowBrowserContext(window).getSettings()
      ?.canvasAdapter
    if (!(adapter instanceof ExtendedCanvasAdapter))
      throw new window.DOMException(
        'The Canvas environment is unavailable.',
        'InvalidStateError',
      )
    let bytes = 0
    for (const record of envelope.records.values()) {
      // Metadata-only Offscreen transfers retain valid dimensions beyond the native allocation ceiling.
      const pixels =
        record.kind === 'bitmap'
          ? pixelBytes(window, record.width, record.height)
          : 0
      if (
        !types.isUint8ClampedArray(record.data) ||
        !['bitmap', 'offscreen'].includes(record.kind) ||
        record.data.byteLength !== (record.kind === 'bitmap' ? pixels : 0)
      )
        throw new window.DOMException(
          'Invalid Canvas transfer storage.',
          'DataCloneError',
        )
      bytes += record.data.byteLength
    }
    release = adapter.reserveStorage(window, bytes)
    mapCanvasGraph(envelope.value, function receiveCanvasRecord(marker) {
      const existing = replacements.get(marker)
      if (existing) return existing
      const record = envelope.records.get(marker)
      if (!record) return undefined
      const result =
        record.kind === 'offscreen'
          ? new window.OffscreenCanvas(record.width, record.height)
          : makeImageBitmap(
              window,
              record.width && record.height
                ? new ImageData(record.data, record.width, record.height)
                : new Canvas(0, 0),
              true,
              bitmapOptions(window, {}),
              [0, 0, record.width, record.height],
            )
      replacements.set(marker, result)
      return result
    })
    return replacements
  } catch (error) {
    disposeAll([() => releaseCanvasReceivers(replacements)], [error])
    throw error
  } finally {
    release()
  }
}

/** Releases only newly allocated receiver resources when cloning or message reconstruction fails.
 * @returns Nothing; the original sender ownership is untouched.
 * @example releaseCanvasReceivers(receivers);
 */
function releaseCanvasReceivers(
  receivers: ReturnType<typeof allocateCanvasReceivers>,
): void {
  disposeAll(
    [...receivers.values()].map((value) => () => {
      if (value instanceof ImageBitmap) closeBitmapStorage(value)
      else offscreenPresenters.get(value)?.close()
    }),
  )
  receivers.clear()
}

/** Reconstructs the message graph using receiver-owned objects and binds only the successfully transferred native ports.
 * @returns Receiver Window Canvas brands and graph aliases; partial reconstruction releases receiver resources.
 * @example receiveCanvasTransfer(window, clonedEnvelope);
 */
export function receiveCanvasTransfer(
  window: ICanvasAdapterCaller['window'],
  envelope: CanvasTransferEnvelope,
  replacements?: ReturnType<typeof allocateCanvasReceivers>,
): unknown {
  try {
    replacements ??= allocateCanvasReceivers(window, envelope)
    for (const [port, token] of envelope.ports)
      canvasPortInstallers.get(window)?.(port, token)
    for (const [marker, result] of replacements) {
      const presentation = envelope.records.get(marker)?.presentation
      if (result instanceof OffscreenCanvas && presentation)
        bindCanvasPresenter(result, presentation)
    }
    return mapCanvasGraph(envelope.value, (marker) => replacements?.get(marker))
  } catch (error) {
    if (replacements) {
      const allocated = replacements
      disposeAll([() => releaseCanvasReceivers(allocated)], [error])
    }
    throw error
  } finally {
    // Unreachable transfer-list entries still detach, but no receiver owns their private presentation endpoint.
    for (const [marker, record] of envelope.records)
      if (!replacements?.has(marker)) record.presentation?.close()
    // Event proxies can outlive dispatch; keeping their tiny packet must not retain the consumed raw pixel copies.
    envelope.records.clear()
  }
}

/** Extends only the native fallback clone installed by this package, retaining explicitly supplied consumer clone functions.
 * @returns Nothing; cloned/transferred Canvas objects use the receiver's real raster owner.
 * @example installCanvasTransfer(window, restorers);
 */
export function installCanvasTransfer(
  window: Window,
  restorers: DisposeCompatibility[],
): void {
  const original: unknown = Reflect.get(window, 'structuredClone')
  if (original !== undefined && original !== nativeClone) return
  restorers.push(
    replaceProperty(window, 'structuredClone', {
      writable: true,
      value(...argumentsList: unknown[]) {
        if (argumentsList.length === 0)
          throw new window.TypeError('structuredClone requires a value.')
        const prepared = prepareCanvasTransfer(
          window,
          argumentsList[0],
          transferList(window, argumentsList[1]),
        )
        let receivers: ReturnType<typeof allocateCanvasReceivers> | undefined
        try {
          // All fallible raster allocation precedes the one native operation that transfers ArrayBuffers.
          receivers = allocateCanvasReceivers(window, prepared.envelope)
          const originals = [...prepared.envelope.records.keys()]
          const cloned = nativeClone(prepared.envelope, {
            transfer: prepared.transfer,
          })
          const clonedReceivers: ReturnType<typeof allocateCanvasReceivers> =
            new Map()
          let index = 0
          // Native cloning preserves Map insertion order while replacing marker object identities.
          for (const marker of cloned.records.keys()) {
            const receiver = receivers.get(originals[index++]!)
            if (receiver) clonedReceivers.set(marker, receiver)
          }
          prepared.commit()
          receivers.clear()
          return receiveCanvasTransfer(window, cloned, clonedReceivers)
        } catch (error) {
          const failure =
            error instanceof DOMException && error.name === 'DataCloneError'
              ? new window.DOMException(error.message, 'DataCloneError')
              : error
          if (receivers) {
            const allocated = receivers
            disposeAll([() => releaseCanvasReceivers(allocated)], [failure])
          }
          throw failure
        } finally {
          prepared.release()
        }
      },
    }),
  )
}
