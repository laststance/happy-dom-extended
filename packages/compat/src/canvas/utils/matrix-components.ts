import type { ICanvasAdapterCaller } from 'happy-dom'
import conversions from 'webidl-conversions'

import { MATRIX_COMPONENTS } from '../constants.ts'

import { conversionOptions } from './conversion-options.ts'

/** Converts Canvas's DOMMatrix2DInit in dictionary order, rejecting contradictory aliases before a transform changes.
 * @returns Six affine components, including nonfinite values for the caller's specified no-op handling.
 * @example matrixComponents(window, { e: 2, m41: 2 }); // [1, 0, 0, 1, 2, 0]
 */
export function matrixComponents(
  window: ICanvasAdapterCaller['window'],
  value: unknown,
): number[] {
  const dictionary = value ?? {}
  if (typeof dictionary !== 'object' && typeof dictionary !== 'function')
    throw new window.TypeError('The transform must be a dictionary.')
  const components = new Map<string, number>()
  // Convert all short names before their long aliases, preserving observable getter/coercion ordering.
  for (const key of MATRIX_COMPONENTS.flatMap(([short, long]) => [
    short,
    long,
  ]).sort()) {
    const component: unknown = Reflect.get(dictionary, key)
    if (component !== undefined)
      components.set(
        key,
        conversions['unrestricted double'](
          component,
          conversionOptions(window),
        ),
      )
  }
  return MATRIX_COMPONENTS.map((component) =>
    matrixComponent(window, components, component),
  )
}

/** Resolves one short/long matrix alias pair after all dictionary conversions are complete.
 * @returns The agreed component or its identity-matrix default.
 * @example matrixComponent(window, new Map([['e', 2]]), ['e', 'm41', 0]); // 2
 */
function matrixComponent(
  window: ICanvasAdapterCaller['window'],
  components: Map<string, number>,
  [short, long, fallback]: (typeof MATRIX_COMPONENTS)[number],
): number {
  const first = components.get(short)
  const second = components.get(long)
  if (first === undefined) return second ?? fallback
  if (second === undefined) return first
  if (first !== second && !Object.is(first, second))
    throw new window.TypeError(
      'The transform has conflicting component aliases.',
    )
  return first
}
