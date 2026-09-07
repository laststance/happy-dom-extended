import { MessageChannel, MessagePort } from 'node:worker_threads'

import type { ICanvasAdapterCaller } from 'happy-dom'

import type { DisposeCompatibility } from '../types.ts'
import { disposeAll } from '../utils/dispose-all.ts'
import { replaceProperty } from '../utils/replace-property.ts'

import { MAX_PENDING_CANVAS_MESSAGES } from './constants.ts'
import { canvasPortTokens } from './state.ts'
import { prepareCanvasTransfer, receiveCanvasTransfer } from './transfer.ts'
import type { CanvasTransferEnvelope } from './transfer.ts'
import { transferList } from './utils/transfer-list.ts'

/** Resolves postMessage's sequence/dictionary overload without rereading a consumer iterator getter.
 * @returns Converted transfer entries before serialization can detach any sender.
 * @example messageTransfers(window, [buffer]);
 */
function messageTransfers(
  window: ICanvasAdapterCaller['window'],
  options: unknown,
): unknown[] {
  if (
    options &&
    (typeof options === 'object' || typeof options === 'function')
  ) {
    const iterator: unknown = Reflect.get(options, Symbol.iterator)
    if (iterator !== undefined) {
      if (typeof iterator !== 'function')
        throw new window.TypeError('The transfer list must be iterable.')
      return transferList(window, {
        transfer: {
          [Symbol.iterator]: () => Reflect.apply(iterator, options, []),
        },
      })
    }
  }
  return transferList(window, options)
}

/** Recognizes only this entangled pair's private outer packet; payload keys never identify Canvas markers.
 * @returns A validated envelope header or undefined for an ordinary message from a native peer.
 * @example portEnvelope(received, token);
 */
function portEnvelope(
  value: unknown,
  token: string,
): CanvasTransferEnvelope | undefined {
  if (!Array.isArray(value) || value[0] !== token) return undefined
  const envelope: unknown = value[1]
  if (!envelope || typeof envelope !== 'object')
    throw new TypeError('Invalid Canvas message envelope.')
  const records: unknown = Reflect.get(envelope, 'records')
  const ports: unknown = Reflect.get(envelope, 'ports')
  if (!(records instanceof Map) || !(ports instanceof Map))
    throw new TypeError('Invalid Canvas message records.')
  return { value: Reflect.get(envelope, 'value'), records, ports }
}

/** Adds Canvas serialization to an actual native MessagePort, retaining its identity and both Node/EventTarget listener APIs.
 * @returns A disposer restoring instance methods and removing owned listener wrappers on Window teardown.
 * @example const restore = bindCanvasPort(window, channel.port1, token);
 */
export function bindCanvasPort(
  window: ICanvasAdapterCaller['window'],
  port: MessagePort,
  token: string,
): DisposeCompatibility {
  if (canvasPortTokens.has(port)) return () => {}
  canvasPortTokens.set(port, token)
  const restorers: DisposeCompatibility[] = []
  const post = port.postMessage
  const close = port.close
  const add = port.addEventListener
  const remove = port.removeEventListener
  const wrappers = new WeakMap<object, (event: unknown) => void>()
  const registered = new Set<WeakRef<(event: unknown) => void>>()
  const decoded = new WeakMap<
    object,
    { value: unknown; ports: MessagePort[] } | null
  >()
  const events = new WeakMap<MessageEvent, MessageEvent>()
  const pending = new Set<DisposeCompatibility>()
  let closed = false
  const markClosed = () => {
    closed = true
    disposeAll([...pending])
  }
  port.once('close', markClosed)
  restorers.push(() => {
    port.removeListener('close', markClosed)
    canvasPortTokens.delete(port)
    for (const reference of registered) {
      const listener = reference.deref()
      if (listener) {
        remove.call(port, 'message', listener)
        remove.call(port, 'message', listener, { capture: true })
      }
    }
    registered.clear()
    disposeAll([...pending])
  })
  const decode = (message: unknown) => {
    if (message && typeof message === 'object' && decoded.has(message))
      return decoded.get(message)!
    try {
      try {
        const envelope = portEnvelope(message, token)
        if (!envelope) return { value: message, ports: [] }
        const ports = [...envelope.ports.keys()]
        const value = receiveCanvasTransfer(window, envelope)
        const result = { value, ports }
        if (message && typeof message === 'object') decoded.set(message, result)
        return result
      } finally {
        // Rejecting our header still acknowledges its reservation; ordinary payload ports belong to the caller.
        const receipt: unknown =
          Array.isArray(message) && message[0] === token
            ? message[2]
            : undefined
        if (receipt instanceof MessagePort) {
          try {
            receipt.postMessage(null)
          } finally {
            receipt.close()
          }
        }
      }
    } catch {
      if (message && typeof message === 'object') decoded.set(message, null)
      port.dispatchEvent(new MessageEvent('messageerror'))
      return null
    }
  }
  try {
    restorers.push(
      replaceProperty(port, 'close', {
        writable: true,
        value(...argumentsList: unknown[]) {
          try {
            markClosed()
          } finally {
            Reflect.apply(close, port, argumentsList)
          }
        },
      }),
    )
    restorers.push(
      replaceProperty(port, 'postMessage', {
        writable: true,
        value(...argumentsList: unknown[]) {
          if (!argumentsList.length)
            throw new window.TypeError('postMessage requires a value.')
          const transfers = messageTransfers(window, argumentsList[1])
          // Browser closed ports do not serialize or detach; Node's native method still does both.
          if (closed) return
          const prepared = prepareCanvasTransfer(
            window,
            argumentsList[0],
            transfers,
          )
          let release = prepared.release
          let receipt: MessagePort | undefined
          let sent = false
          try {
            if (prepared.envelope.records.size) {
              if (pending.size >= MAX_PENDING_CANVAS_MESSAGES)
                throw new window.DOMException(
                  'Too many unreceived Canvas messages.',
                  'QuotaExceededError',
                )
              const channel = new MessageChannel()
              receipt = channel.port2
              let released = false
              release = () => {
                if (released) return
                released = true
                pending.delete(release)
                prepared.release()
                channel.port1.close()
                channel.port2.close()
              }
              pending.add(release)
              channel.port1.once('message', release)
              channel.port1.once('close', release)
              prepared.transfer.push(receipt)
            }
            Reflect.apply(post, port, [
              [token, prepared.envelope, receipt],
              prepared.transfer,
            ])
            prepared.commit()
            sent = true
          } catch (error) {
            if (
              error instanceof DOMException &&
              error.name === 'DataCloneError'
            )
              throw new window.DOMException(error.message, 'DataCloneError')
            throw error
          } finally {
            // Transfer retains the sender's pixel reservation until the receiver consumes or rejects the envelope.
            if (!sent || !receipt) release()
          }
        },
      }),
    )
    restorers.push(
      replaceProperty(port, 'addEventListener', {
        writable: true,
        value(type: string, listener: unknown, options?: unknown) {
          if (
            type !== 'message' ||
            !listener ||
            (typeof listener !== 'function' && typeof listener !== 'object')
          )
            return Reflect.apply(add, port, [type, listener, options])
          let wrapped = wrappers.get(listener)
          if (!wrapped) {
            wrapped = function receiveCanvasMessage(input: unknown) {
              const nativeEvent = input instanceof MessageEvent ? input : null
              const result = decode(nativeEvent ? nativeEvent.data : input)
              if (!result) return
              let delivered = result.value
              if (nativeEvent) {
                let event = events.get(nativeEvent)
                if (!event) {
                  // Keep native event propagation and target getters while replacing only the decoded message fields.
                  event = new Proxy(nativeEvent, {
                    get(target, key) {
                      if (key === 'data') return result.value
                      if (key === 'ports') return result.ports
                      const value: unknown = Reflect.get(target, key, target)
                      return typeof value === 'function'
                        ? value.bind(target)
                        : value
                    },
                  })
                  events.set(nativeEvent, event)
                }
                delivered = event
              }
              if (typeof listener === 'function')
                Reflect.apply(listener, port, [delivered])
              else {
                const handler: unknown = Reflect.get(listener, 'handleEvent')
                if (typeof handler === 'function')
                  Reflect.apply(handler, listener, [delivered])
              }
            }
            wrappers.set(listener, wrapped)
            registered.add(new WeakRef(wrapped))
          }
          return Reflect.apply(add, port, [type, wrapped, options])
        },
      }),
    )
    restorers.push(
      replaceProperty(port, 'removeEventListener', {
        writable: true,
        value(type: string, listener: unknown, options?: unknown) {
          const wrapper =
            type === 'message' &&
            listener &&
            (typeof listener === 'function' || typeof listener === 'object')
              ? wrappers.get(listener)
              : undefined
          return Reflect.apply(remove, port, [
            type,
            wrapper ?? listener,
            options,
          ])
        },
      }),
    )
    return () => disposeAll(restorers)
  } catch (error) {
    disposeAll(restorers, [error])
    throw error
  }
}
