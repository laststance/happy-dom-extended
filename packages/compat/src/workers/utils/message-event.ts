import type { Window } from 'happy-dom'

/** Wraps native transport in the receiver's Web event family with the actual native MessagePort identities installed by compatibility.
 * @returns A Window MessageEvent carrying the decoded value and transferred ports.
 * @example worker.dispatchEvent(workerMessageEvent(window, nativeEvent));
 */
export function workerMessageEvent(window: Window, event: MessageEvent) {
  const message = new window.MessageEvent('message', { data: event.data })
  // Upstream types still name its placeholder MessagePort; runtime ports must match our installed native constructor.
  Object.defineProperty(message, 'ports', {
    value: window.Array.from(event.ports),
    enumerable: true,
  })
  return message
}
