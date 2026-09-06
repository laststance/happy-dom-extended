import { types } from 'node:util'

/** Identifies iterable Blob parts when a constructor receives untyped JavaScript arguments.
 * @param value - First constructor argument.
 * @returns Whether the value can be iterated without inventing a Blob part list.
 * @example isIterableParts([new ArrayBuffer(2)]) // true
 */
function isIterableParts(value: unknown): value is Iterable<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Symbol.iterator in value &&
    typeof value[Symbol.iterator] === 'function'
  )
}

/** Converts foreign ArrayBuffers before Blob/File construction without disturbing Blob identity or view offsets.
 * @param argumentsList - Original constructor arguments.
 * @returns Constructor arguments with supported binary parts preserved.
 * @example normalizeBlobArguments([[new ArrayBuffer(2)], { type: 'text/plain' }]);
 */
export function normalizeBlobArguments(argumentsList: unknown[]): unknown[] {
  const [parts, ...remaining] = argumentsList
  if (!isIterableParts(parts)) return argumentsList
  return [
    Array.from(parts, (part) =>
      types.isArrayBuffer(part) ? new Uint8Array(part) : part,
    ),
    ...remaining,
  ]
}
