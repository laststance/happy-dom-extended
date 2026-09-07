/** Rebuilds native Error shells while allowing Canvas values inside cause to participate in the same cycle-preserving graph walk.
 * @returns An Error of the standard cloned name, with stack and recursively mapped own cause.
 * @example mapError(new TypeError('invalid'), seen, mapValue);
 */
export function mapError(
  source: Error,
  seen: Map<object, unknown>,
  mapValue: (value: unknown) => unknown,
): Error {
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
