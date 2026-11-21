import {
  PropertySymbol,
  type HTMLElement,
  type ICanvasAdapterCaller,
} from 'happy-dom'
import conversions from 'webidl-conversions'

import { conversionOptions } from './conversion-options.ts'

/** Creates the shared CORS attribute reflection used when Canvas installs image and video bindings.
 * @param original - Native happy-dom descriptor used outside managed Windows.
 * @param isManaged - Whether the element's Window has the Canvas adapter installed.
 * @returns A reversible crossOrigin property descriptor for image or video prototypes.
 * @example replaceProperty(prototype, 'crossOrigin', crossOriginDescriptor(original, window => environments.has(window)))
 */
export function crossOriginDescriptor(
  original: PropertyDescriptor,
  isManaged: (window: ICanvasAdapterCaller['window']) => boolean,
): PropertyDescriptor {
  return {
    enumerable: true,
    get(this: HTMLElement) {
      // Unmanaged Windows retain happy-dom's original behavior.
      if (!isManaged(this[PropertySymbol.window]))
        return original.get!.call(this)
      const value = this.getAttribute('crossorigin')
      return value === null
        ? null
        : value.toLowerCase() === 'use-credentials'
          ? 'use-credentials'
          : 'anonymous'
    },
    set(this: HTMLElement, value: unknown): void {
      // Nullish values remove the attribute; other values use the caller's WebIDL conversion rules.
      if (!isManaged(this[PropertySymbol.window])) {
        original.set!.call(this, value)
        return
      }
      if (value === null || value === undefined)
        this.removeAttribute('crossorigin')
      else
        this.setAttribute(
          'crossorigin',
          conversions.DOMString(
            value,
            conversionOptions(this[PropertySymbol.window]),
          ),
        )
    },
  }
}
