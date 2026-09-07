import { DOMException as HappyDOMException } from 'happy-dom'
import type { ICanvasAdapterCaller } from 'happy-dom'

/** Maps Error causes and DOMException brands for Canvas cloning without changing native Error-subclass serialization.
 * @param source - Original error before or after native serialization.
 * @param seen - Existing graph aliases.
 * @param mapValue - Maps nested Canvas causes in the same graph.
 * @param receiver - Destination Window; preparation uses the native DOMException serializer.
 * @returns An Error of the standard cloned name, with stack and recursively mapped own cause.
 * @example mapError(new TypeError('invalid'), seen, mapValue);
 */
export function mapError(
  source: Error,
  seen: Map<object, unknown>,
  mapValue: (value: unknown) => unknown,
  receiver?: ICanvasAdapterCaller['window'],
): Error {
  if (source instanceof DOMException || source instanceof HappyDOMException) {
    // Native serialization preserves these fields; restore the public brand only in the receiving Window.
    const Constructor = receiver?.DOMException ?? DOMException
    const mapped =
      source instanceof Constructor
        ? source
        : new Constructor(source.message, source.name)
    seen.set(source, mapped)
    return mapped
  }
  const name: unknown = source.name
  const Constructor =
    [
      Error,
      EvalError,
      RangeError,
      ReferenceError,
      SyntaxError,
      TypeError,
      URIError,
    ].find((candidate) => candidate.name === name) ?? Error
  const message: unknown = Object.getOwnPropertyDescriptor(
    source,
    'message',
  )?.value
  const mapped = new Constructor(
    typeof message === 'string' ? message : undefined,
  )
  seen.set(source, mapped)
  const stack: unknown = source.stack
  if (typeof stack === 'string') mapped.stack = stack
  if (Object.hasOwn(source, 'cause'))
    Object.defineProperty(mapped, 'cause', {
      value: mapValue(source.cause),
      configurable: true,
      writable: true,
    })
  return mapped
}
