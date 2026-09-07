import { CanvasGradient, CanvasPattern } from 'skia-canvas'
import conversions from 'webidl-conversions'

import {
  CANVAS_ENUM_PROPERTIES,
  CANVAS_NUMERIC_PROPERTIES,
  CANVAS_STRING_PROPERTIES,
} from './constants.ts'
import { patternOrigins } from './state.ts'
import type { CanvasState } from './types.ts'
import { canvasColor } from './utils/canvas-color.ts'
import { conversionOptions } from './utils/conversion-options.ts'

/** Parses color strings or retains native shader identity when a Canvas style setter runs.
 * @returns Whether the native setter succeeded; invalid CSS preserves the previous style.
 * @example setCanvasStyle(state, 'fillStyle', 'red');
 */
function setCanvasStyle(
  state: CanvasState,
  name: string,
  value: unknown,
): boolean {
  const window = state.caller.window
  let converted: unknown = value
  if (
    name !== 'shadowColor' &&
    (value instanceof CanvasGradient || value instanceof CanvasPattern)
  ) {
    if (patternOrigins.get(value) === false) state.originClean = false
  } else {
    converted = canvasColor(
      conversions.DOMString(value, conversionOptions(window)),
    )
    if (converted === undefined) return true
  }
  return Reflect.set(state.nativeContext, name, converted, state.nativeContext)
}

/** Converts standard context setters once, preserving existing styles for invalid values and tainting pattern assignments.
 * @returns A handled setter result, or undefined when consumer properties should use the normal proxy path.
 * @example setCanvasProperty(state, 'fillStyle', { toString: () => 'red' });
 */
export function setCanvasProperty(
  state: CanvasState,
  key: PropertyKey,
  value: unknown,
): boolean | undefined {
  const name = String(key)
  const window = state.caller.window
  let converted: unknown = value
  if (CANVAS_NUMERIC_PROPERTIES.has(name)) {
    converted = conversions['unrestricted double'](
      value,
      conversionOptions(window),
    )
    if (!Number.isFinite(converted)) return true
  } else if (name === 'imageSmoothingEnabled') {
    converted = Boolean(value)
  } else if (['fillStyle', 'strokeStyle', 'shadowColor'].includes(name)) {
    return setCanvasStyle(state, name, value)
  } else if (
    CANVAS_STRING_PROPERTIES.has(name) ||
    CANVAS_ENUM_PROPERTIES[name]
  ) {
    const text = conversions.DOMString(value, conversionOptions(window))
    if (
      CANVAS_ENUM_PROPERTIES[name] &&
      !CANVAS_ENUM_PROPERTIES[name].includes(text)
    )
      return true
    converted = text
  } else {
    return undefined
  }
  return Reflect.set(state.nativeContext, key, converted, state.nativeContext)
}
