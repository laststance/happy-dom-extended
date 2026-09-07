import type { ICanvasAdapterCaller } from 'happy-dom'
import { CanvasGradient } from 'skia-canvas'
import conversions from 'webidl-conversions'

import { canvasColor } from './utils/canvas-color.ts'
import { conversionOptions } from './utils/conversion-options.ts'

/** Adds realm-correct errors and CSS Color 4 stops to native gradients created by the context bindings.
 * @returns The same native gradient, preserving the renderer's brand and interpolation.
 * @example gradient.addColorStop(0.5, 'color(display-p3 1 0 0)');
 */
export function bindGradient(
  window: ICanvasAdapterCaller['window'],
  value: unknown,
): unknown {
  if (!(value instanceof CanvasGradient)) return value
  const addColorStop = value.addColorStop
  Object.defineProperty(value, 'addColorStop', {
    configurable: true,
    writable: true,
    value(offset: unknown, color: unknown): void {
      const position = conversions.double(offset, conversionOptions(window))
      const text = conversions.DOMString(color, conversionOptions(window))
      if (position < 0 || position > 1)
        throw new window.DOMException(
          'Gradient offset must be between zero and one.',
          'IndexSizeError',
        )
      const converted = canvasColor(text)
      if (!converted)
        throw new window.DOMException('Invalid gradient color.', 'SyntaxError')
      addColorStop.call(value, position, converted)
    },
  })
  return value
}
