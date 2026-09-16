// Capture before a runner replaces globalThis.DOMException with the Window constructor.
const NativeDOMException = globalThis.DOMException

/** True when `value` is Node's DOMException after a runner replaced the global constructor.
 * @param value - Thrown value from structuredClone, postMessage, or native serialization.
 * @returns Whether the value is the runtime DOMException captured before environment setup.
 * @example if (isNativeDOMException(error) && error.name === 'DataCloneError')
 */
export function isNativeDOMException(value: unknown): value is DOMException {
  return value instanceof NativeDOMException
}
