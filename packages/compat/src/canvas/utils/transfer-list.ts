import type { ICanvasAdapterCaller } from 'happy-dom'

/** Converts structured-serialization options once, preserving iterator/getter side effects before any sender can detach.
 * @returns The requested transfer list; native serialization validates native transferable brands afterward.
 * @example transferList(window, { transfer: [buffer] });
 */
export function transferList(
  window: ICanvasAdapterCaller['window'],
  options: unknown,
): unknown[] {
  if (options === null || options === undefined) return []
  if (typeof options !== 'object' && typeof options !== 'function')
    throw new window.TypeError('Serialization options must be a dictionary.')
  const value: unknown = Reflect.get(options, 'transfer')
  if (value === undefined) return []
  if (!value || (typeof value !== 'object' && typeof value !== 'function'))
    throw new window.TypeError('The transfer list must be a sequence.')
  const iterator: unknown = Reflect.get(value, Symbol.iterator)
  if (typeof iterator !== 'function')
    throw new window.TypeError('The transfer list must be iterable.')
  // Array.from must not read a consumer's @@iterator getter a second time.
  return window.Array.from({
    [Symbol.iterator]: () => Reflect.apply(iterator, value, []),
  })
}
