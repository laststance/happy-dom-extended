import { HTMLCanvasElement, PropertySymbol } from 'happy-dom'

import { replaceProperty } from '../utils/replace-property.ts'

import { CANVAS_DIMENSIONS } from './constants.ts'
import type { CanvasState } from './types.ts'

/** Observes dimension assignments for {@link ExtendedCanvasAdapter}, including assignments that repeat the current size.
 * @param state - Canvas owner and its already allocated native bitmap.
 * @returns Nothing; records instance restorations without changing shared prototypes.
 * @example installCanvasDimensions(state); canvas.width = canvas.width;
 */
export function installCanvasDimensions(state: CanvasState): void {
  const canvas = state.caller.canvas
  if (canvas instanceof HTMLCanvasElement) {
    for (const key of [
      PropertySymbol.onSetAttribute,
      PropertySymbol.onRemoveAttribute,
    ] as const) {
      const original = canvas[key]
      state.restorers.push(
        replaceProperty(canvas, key, {
          writable: true,
          value: (...argumentsList: Parameters<typeof original>): void => {
            Reflect.apply(original, canvas, argumentsList)
            const [attribute] = argumentsList
            if (attribute.namespaceURI !== null) return
            // Property setters and attribute changes meet here, including equal values and removals.
            if (attribute.name === 'width' || attribute.name === 'height') {
              state.bitmap[attribute.name] = canvas[attribute.name]
            }
          },
        }),
      )
    }
    return
  }
  for (const dimension of CANVAS_DIMENSIONS) {
    let size = canvas[dimension]
    state.restorers.push(
      replaceProperty(canvas, dimension, {
        enumerable: true,
        get: () => size,
        set: (value: number): void => {
          state.bitmap[dimension] = value
          size = state.bitmap[dimension]
        },
      }),
    )
  }
}
