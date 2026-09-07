import type { ICanvasAdapterCaller } from 'happy-dom'
import { Path2D } from 'skia-canvas'
import conversions from 'webidl-conversions'

import {
  CANVAS_NUMERIC_ARGUMENTS,
  CANVAS_RADIUS_ARGUMENTS,
  MAX_ROUND_RECT_RADII,
} from './constants.ts'
import { conversionOptions } from './utils/conversion-options.ts'
import { matrixComponents } from './utils/matrix-components.ts'

/** Converts one numeric or DOMPointInit corner radius before roundRect validates the complete sequence.
 * @returns Horizontal and vertical radii while preserving all dictionary getter ordering.
 * @example roundRectRadius(window, { x: 2, y: 3 });
 */
function roundRectRadius(
  window: ICanvasAdapterCaller['window'],
  radius: unknown,
): { x: number; y: number } {
  if (
    (typeof radius === 'object' && radius !== null) ||
    typeof radius === 'function'
  ) {
    const point = new Map<string, number>()
    for (const [key, fallback] of [
      ['w', 1],
      ['x', 0],
      ['y', 0],
      ['z', 0],
    ] as const) {
      const component: unknown = Reflect.get(radius, key)
      point.set(
        key,
        conversions['unrestricted double'](
          component === undefined ? fallback : component,
          conversionOptions(window),
        ),
      )
    }
    return { x: point.get('x')!, y: point.get('y')! }
  }
  const number = conversions['unrestricted double'](
    radius,
    conversionOptions(window),
  )
  return { x: number, y: number }
}

/** Converts roundRect's number/point/sequence union without allowing native coercion to change its error family.
 * @returns Converted radii; algorithm validation runs after all WebIDL conversions.
 * @example roundRectRadii(window, [{ x: 2, y: 3 }]);
 */
function roundRectRadii(
  window: ICanvasAdapterCaller['window'],
  value: unknown,
) {
  let values = [value === undefined ? 0 : value]
  if (
    (typeof value === 'object' && value !== null) ||
    typeof value === 'function'
  ) {
    const iterator: unknown = Reflect.get(value, Symbol.iterator)
    if (iterator !== undefined && iterator !== null) {
      if (typeof iterator !== 'function')
        throw new window.TypeError('Radii must be iterable.')
      values = window.Array.from({
        [Symbol.iterator]: () => Reflect.apply(iterator, value, []),
      })
    }
  }
  return values.map((radius) => roundRectRadius(window, radius))
}

/** Validates converted corners in order after roundRect has rejected nonfinite rectangle coordinates.
 * @returns Whether drawing continues; negative radii throw before later nonfinite radii are examined.
 * @example validRoundRectRadii(window, [{ x: 1, y: 1 }]); // true
 */
function validRoundRectRadii(
  window: ICanvasAdapterCaller['window'],
  radii: ReturnType<typeof roundRectRadii>,
): boolean {
  if (!radii.length || radii.length > MAX_ROUND_RECT_RADII)
    throw new window.RangeError('roundRect requires one to four radii.')
  for (const { x, y } of radii) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false
    if (x < 0 || y < 0)
      throw new window.RangeError('roundRect radii must not be negative.')
  }
  return true
}

/** Converts fill/clip/query rule enums consistently before native path use.
 * @returns One supported fill rule or the caller's TypeError.
 * @example canvasFillRule(window, undefined); // nonzero
 */
function canvasFillRule(
  window: ICanvasAdapterCaller['window'],
  value: unknown,
): 'nonzero' | 'evenodd' {
  const rule =
    value === undefined
      ? 'nonzero'
      : conversions.DOMString(value, conversionOptions(window))
  if (rule !== 'nonzero' && rule !== 'evenodd')
    throw new window.TypeError('Unknown Canvas fill rule.')
  return rule
}

/** Converts path-query overloads and fill rules before native drawing or hit testing.
 * @returns Native arguments, or null for nonfinite query coordinates.
 * @example pathArguments(window, 'fill', ['evenodd']);
 */
function pathArguments(
  window: ICanvasAdapterCaller['window'],
  key: string,
  argumentsList: unknown[],
): unknown[] | null {
  const path = argumentsList[0] instanceof Path2D ? argumentsList[0] : undefined
  const offset = path ? 1 : 0
  if (key === 'stroke') {
    if (argumentsList.length && !path)
      throw new window.TypeError('stroke requires a Path2D.')
    return path ? [path] : []
  }
  const numbers: number[] = []
  if (key.startsWith('isPoint')) {
    if (argumentsList.length < offset + 2)
      throw new window.TypeError('A path query requires coordinates.')
    numbers.push(
      ...argumentsList
        .slice(offset, offset + 2)
        .map((value) =>
          conversions['unrestricted double'](value, conversionOptions(window)),
        ),
    )
  }
  const converted: unknown[] = path ? [path, ...numbers] : [...numbers]
  if (key !== 'isPointInStroke') {
    const value = argumentsList[offset + numbers.length]
    const rule = canvasFillRule(window, value)
    converted.push(rule)
  }
  return numbers.every(Number.isFinite) ? converted : null
}

/** Converts an iterable line-dash argument while preserving caller iterator errors.
 * @returns Native dash arguments, or null when a segment is negative or nonfinite.
 * @example dashArguments(window, [[2, 3]]); // [[2, 3]]
 */
function dashArguments(
  window: ICanvasAdapterCaller['window'],
  argumentsList: unknown[],
): unknown[] | null {
  const [segments] = argumentsList
  if (
    segments === null ||
    (typeof segments !== 'object' && typeof segments !== 'function')
  )
    throw new window.TypeError('Line dashes require an iterable object.')
  const iterator: unknown = Reflect.get(segments, Symbol.iterator)
  if (typeof iterator !== 'function')
    throw new window.TypeError('Line dashes must be iterable.')
  const numbers = window.Array.from(
    { [Symbol.iterator]: () => Reflect.apply(iterator, segments, []) },
    (value) =>
      conversions['unrestricted double'](value, conversionOptions(window)),
  )
  return numbers.every((value) => Number.isFinite(value) && value >= 0)
    ? [numbers]
    : null
}

/** Converts text before its coordinates, retaining optional maximum-width no-op behavior.
 * @returns Native text arguments, or null when drawing has no finite positive extent.
 * @example textArguments(window, 'fillText', ['hi', 0, 12]);
 */
function textArguments(
  window: ICanvasAdapterCaller['window'],
  name: string,
  argumentsList: unknown[],
): unknown[] | null {
  const required = name === 'measureText' ? 1 : 3
  if (argumentsList.length < required)
    throw new window.TypeError('Missing text drawing arguments.')
  const text = conversions.DOMString(
    argumentsList[0],
    conversionOptions(window),
  )
  const coordinates = argumentsList
    .slice(1, required)
    .map((value) =>
      conversions['unrestricted double'](value, conversionOptions(window)),
    )
  if (name !== 'measureText' && argumentsList[3] !== undefined)
    coordinates.push(
      conversions['unrestricted double'](
        argumentsList[3],
        conversionOptions(window),
      ),
    )
  return coordinates.every(Number.isFinite) &&
    (coordinates.length < 3 || coordinates[2]! > 0)
    ? [text, ...coordinates]
    : null
}

/** Normalizes standard 2D calls before Skia, leaving extension methods available with their native contracts.
 * @returns Native arguments, or null when the HTML specification requires a no-op.
 * @example canvasArguments(window, 'fillRect', ['0', 0, 2, 1]); // [0, 0, 2, 1]
 */
export function canvasArguments(
  window: ICanvasAdapterCaller['window'],
  key: PropertyKey,
  argumentsList: unknown[],
): unknown[] | null {
  const name = String(key)
  if (
    ['fill', 'stroke', 'clip', 'isPointInPath', 'isPointInStroke'].includes(
      name,
    )
  )
    return pathArguments(window, name, argumentsList)
  if (name === 'setTransform' && argumentsList.length < 2) {
    const components = matrixComponents(window, argumentsList[0])
    return components.every(Number.isFinite) ? components : null
  }
  if (name === 'setLineDash') return dashArguments(window, argumentsList)
  if (['measureText', 'fillText', 'strokeText'].includes(name))
    return textArguments(window, name, argumentsList)
  return numericArguments(window, name, argumentsList)
}

/** Applies shared numeric arities and radius rules to Canvas geometry before native rendering.
 * @returns Converted geometry or null for a specified no-op.
 * @example numericArguments(window, 'rect', [0, 0, 1, 1]);
 */
function numericArguments(
  window: ICanvasAdapterCaller['window'],
  name: string,
  argumentsList: unknown[],
): unknown[] | null {
  const count = name === 'setTransform' ? 6 : CANVAS_NUMERIC_ARGUMENTS[name]
  if (count === undefined) return argumentsList
  if (argumentsList.length < count)
    throw new window.TypeError(`Missing ${name} arguments.`)
  const converter = name.startsWith('create')
    ? conversions.double
    : conversions['unrestricted double']
  const numbers = argumentsList
    .slice(0, count)
    .map((value) => converter(value, conversionOptions(window)))
  const radii =
    name === 'roundRect' ? roundRectRadii(window, argumentsList[4]) : undefined
  if (!numbers.every(Number.isFinite)) return null
  if (CANVAS_RADIUS_ARGUMENTS[name]?.some((index) => numbers[index]! < 0))
    throw new window.DOMException(
      'The radius must not be negative.',
      'IndexSizeError',
    )
  if (radii)
    return validRoundRectRadii(window, radii) ? [...numbers, radii] : null
  if (name === 'arc' || name === 'ellipse')
    return [...numbers, Boolean(argumentsList[count])]
  return numbers
}
