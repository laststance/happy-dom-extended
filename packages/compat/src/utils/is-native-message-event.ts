// Capture before a runner replaces globalThis.MessageEvent with the Window constructor.
const NativeMessageEvent = globalThis.MessageEvent

/** Recognizes a Node/EventTarget MessageEvent after a runner replaced the global constructor.
 * @param value - Listener argument from a native port, Worker, or EventTarget.
 * @returns Whether the value is a runtime MessageEvent whose `.data` should be decoded.
 * @example if (isNativeMessageEvent(input)) decode(input.data)
 */
export function isNativeMessageEvent(value: unknown): value is MessageEvent {
  return (
    value instanceof NativeMessageEvent ||
    (value !== null &&
      typeof value === 'object' &&
      Object.prototype.toString.call(value) === '[object MessageEvent]')
  )
}
