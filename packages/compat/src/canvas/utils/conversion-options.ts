import type { ICanvasAdapterCaller } from 'happy-dom'

/** Supplies the caller's JavaScript realm when Canvas bindings convert WebIDL values.
 * @returns The three realm constructors used by webidl-conversions.
 * @example conversions.long(value, conversionOptions(window));
 */
export function conversionOptions(window: ICanvasAdapterCaller['window']) {
  return {
    globals: {
      Number: window.Number,
      String: window.String,
      TypeError: window.TypeError,
    },
  }
}
