import { Blob } from 'node:buffer'
import {
  ReadableStream,
  WritableStream,
  TransformStream,
} from 'node:stream/web'
import { types } from 'node:util'
import { MessagePort } from 'node:worker_threads'

/** Identifies native structured-clone brands without invoking consumer toStringTag or constructor getters.
 * @returns Whether graph preparation must preserve the original object for one native serialization operation.
 * @example nativeStructuredValue(new Uint8Array(4)); // true
 */
export function nativeStructuredValue(value: object): boolean {
  return (
    [
      types.isProxy,
      types.isAnyArrayBuffer,
      types.isArrayBufferView,
      types.isDate,
      types.isRegExp,
      types.isWeakMap,
      types.isWeakSet,
      types.isPromise,
      types.isBoxedPrimitive,
      types.isKeyObject,
      types.isCryptoKey,
    ].some((check) => check(value)) ||
    value instanceof Blob ||
    value instanceof MessagePort ||
    value instanceof ReadableStream ||
    value instanceof WritableStream ||
    value instanceof TransformStream
  )
}
