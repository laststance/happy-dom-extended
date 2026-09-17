import { MessageChannel, MessagePort } from 'node:worker_threads'

import type { ICanvasAdapterCaller } from 'happy-dom'

import type { DisposeCompatibility } from '../types.ts'
import { disposeAll } from '../utils/dispose-all.ts'
import { isNativeDOMException } from '../utils/is-native-dom-exception.ts'
import { isNativeMessageEvent } from '../utils/is-native-message-event.ts'
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

/** Reads the private Canvas receipt port from a token-prefixed native packet.
 * {@link collectDeliveredPorts} hides this port from consumer `event.ports`.
 * @example const receipt = canvasReceipt(nativeEvent.data, token)
 */
function canvasReceipt(data: unknown, token: string) {
  if (!Array.isArray(data) || data[0] !== token) return undefined
  return data[2]
}

/** Deduplicates MessagePorts by identity after merging decoded and native lists.
 * {@link collectDeliveredPorts} uses this so reconstructed Canvas ports are not listed twice.
 * @example uniqueMessagePorts([...decoded, ...native])
 */
function uniqueMessagePorts(ports: MessagePort[]) {
  return [...new Set(ports)]
}

/** Combines decoded Canvas ports with ordinary native ports and hides the private receipt.
 * MessageEvent proxy `ports` getter calls this so mixed transfers keep both lists.
 * @example collectDeliveredPorts(result.ports, nativeEvent, token)
 */
function collectDeliveredPorts(
  decodedPorts: MessagePort[],
  nativeEvent: MessageEvent,
  token: string,
): MessagePort[] {
  const receipt = canvasReceipt(nativeEvent.data, token)
  const nativePorts = [...nativeEvent.ports].filter(
    (port) => port !== receipt,
  ) as unknown as MessagePort[]
  return uniqueMessagePorts([...decodedPorts, ...nativePorts])
}

/** Replaces only `data`/`ports` on a native MessageEvent so listeners keep target and bubbling getters.
 * {@link bindCanvasPort} caches the proxy per native event.
 * @example const event = decodedMessageEvent(nativeEvent, result, token)
 */
function decodedMessageEvent(
  nativeEvent: MessageEvent,
  result: { value: unknown; ports: MessagePort[] },
  token: string,
): MessageEvent {
  return new Proxy(nativeEvent, {
    get(target, key) {
      if (key === 'data') return result.value
      if (key === 'ports')
        return collectDeliveredPorts(result.ports, target, token)
      const value: unknown = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
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
            if (isNativeDOMException(error) && error.name === 'DataCloneError')
              throw new window.DOMException(error.message, 'DataCloneError')
            throw error
          } finally {
            // Transfer retains the sender's pixel reservation until the receiver consumes or rejects the envelope.
            if (!sent || !receipt) release()
          }
        },
      }),
    )
    /** Decodes Canvas envelopes before a consumer listener sees the message.
     * @returns The native EventTarget listener installed on this port.
     * @example wrapMessageListener(listener)
     */
    const ownedWrappers = new WeakSet<object>()
    const wrapMessageListener = (listener: object | Function) => {
      // Node's onmessage setter re-enters patched addEventListener with this wrapper.
      if (ownedWrappers.has(listener)) {
        return listener as (input: unknown) => void
      }
      let wrapped = wrappers.get(listener)
      if (!wrapped) {
        wrapped = function receiveCanvasMessage(input: unknown) {
          const nativeEvent = isNativeMessageEvent(input) ? input : null
          const result = decode(nativeEvent ? nativeEvent.data : input)
          if (!result) return
          let delivered = result.value
          if (nativeEvent) {
            let event = events.get(nativeEvent)
            if (!event) {
              event = decodedMessageEvent(nativeEvent, result, token)
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
        ownedWrappers.add(wrapped)
        registered.add(new WeakRef(wrapped))
      }
      return wrapped
    }
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
          return Reflect.apply(add, port, [
            type,
            wrapMessageListener(listener),
            options,
          ])
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
    const originalOnmessage = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(port),
      'onmessage',
    )
    let messageHandler: ((event: MessageEvent) => unknown) | null = null
    restorers.push(
      replaceProperty(port, 'onmessage', {
        configurable: true,
        enumerable: true,
        get() {
          // Identity matches the assigned handler; Node dispatch uses the wrapped setter registration.
          return messageHandler
        },
        set(listener: unknown) {
          messageHandler =
            typeof listener === 'function'
              ? (listener as (event: MessageEvent) => unknown)
              : null
          originalOnmessage?.set?.call(
            port,
            messageHandler ? wrapMessageListener(messageHandler) : null,
          )
        },
      }),
    )
    return () => disposeAll(restorers)
  } catch (error) {
    disposeAll(restorers, [error])
    throw error
  }
}
