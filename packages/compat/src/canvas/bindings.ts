import {
  Attr,
  BrowserWindow,
  HTMLCanvasElement,
  OffscreenCanvas,
  PropertySymbol,
} from 'happy-dom'
import type { Window } from 'happy-dom'
import conversions from 'webidl-conversions'

import type { DisposeCompatibility } from '../types.ts'
import { propertyOwner } from '../utils/property-owner.ts'
import { replaceProperty } from '../utils/replace-property.ts'

import type { ExtendedCanvasAdapter } from './adapter.ts'
import {
  CANVAS_DIMENSIONS,
  DEFAULT_CANVAS_HEIGHT_PX,
  DEFAULT_CANVAS_WIDTH_PX,
  MAX_HTML_DIMENSION_PX,
} from './constants.ts'
import {
  htmlPlaceholders,
  installCanvasPresentation,
  requestCanvasPresentation,
} from './presentation.ts'
import { contextSettings } from './settings.ts'
import {
  canvasStates,
  canvasWindows,
  detachedOffscreens,
  offscreenDimensions,
} from './state.ts'
import { conversionOptions } from './utils/conversion-options.ts'

/** Routes shared HTML prototype hooks by the actual receiver, including an adopted canvas with a live context.
 * @returns Whether this canvas belongs to the installed compatibility implementation.
 * @example ownsCanvas(canvas); // false for a custom adapter's Window
 */
function ownsCanvas(canvas: HTMLCanvasElement): boolean {
  const window = canvas.ownerDocument.defaultView
  return (
    canvasStates.has(canvas) || Boolean(window && canvasWindows.has(window))
  )
}

/** Selects only dimension Attr nodes belonging to owned canvases or not yet attached in an owned Window.
 * @returns Whether an Attr alias should perform Canvas dimension semantics.
 * @example ownsDimensionAttribute(canvas.getAttributeNode('width'));
 */
function ownsDimensionAttribute(attribute: Attr): boolean {
  if (
    attribute.namespaceURI !== null ||
    !['width', 'height'].includes(attribute.name)
  )
    return false
  const owner = attribute.ownerElement
  return owner
    ? owner instanceof HTMLCanvasElement && ownsCanvas(owner)
    : canvasWindows.has(attribute[PropertySymbol.window])
}

/** Installs reflection before setupFiles can create canvases, preserving custom adapters and independent Window teardown.
 * @returns Nothing; each successful patch immediately records its restoration.
 * @example installCanvasBindings(window, adapter, restorers);
 */
export function installCanvasBindings(
  window: Window,
  adapter: ExtendedCanvasAdapter,
  restorers: DisposeCompatibility[],
): void {
  canvasWindows.set(window, adapter)
  restorers.push(() => {
    canvasWindows.delete(window)
  })
  installCanvasPresentation(window, adapter, restorers)

  for (const prototype of [
    HTMLCanvasElement.prototype,
    OffscreenCanvas.prototype,
  ]) {
    const original = prototype.getContext
    restorers.push(
      replaceProperty(prototype, 'getContext', {
        writable: true,
        value(
          this: HTMLCanvasElement | OffscreenCanvas,
          ...argumentsList: unknown[]
        ) {
          const ownerWindow: unknown = Reflect.get(this, PropertySymbol.window)
          if (!(ownerWindow instanceof BrowserWindow))
            return Reflect.apply(original, this, argumentsList)
          const owned =
            this instanceof HTMLCanvasElement
              ? ownsCanvas(this)
              : canvasWindows.has(ownerWindow)
          if (!owned) return Reflect.apply(original, this, argumentsList)
          if (argumentsList.length === 0)
            throw new ownerWindow.TypeError(
              'getContext requires a context identifier.',
            )
          const type = conversions.DOMString(
            argumentsList[0],
            conversionOptions(ownerWindow),
          )
          if (this instanceof HTMLCanvasElement && htmlPlaceholders.has(this))
            throw new ownerWindow.DOMException(
              'Canvas is an OffscreenCanvas placeholder.',
              'InvalidStateError',
            )
          if (this instanceof OffscreenCanvas && detachedOffscreens.has(this))
            throw new ownerWindow.DOMException(
              'OffscreenCanvas is detached.',
              'InvalidStateError',
            )
          if (type !== '2d') return null
          const attributes = canvasStates.has(this)
            ? argumentsList[1]
            : contextSettings(ownerWindow, argumentsList[1])
          return Reflect.apply(original, this, [type, attributes])
        },
      }),
    )
  }

  for (const dimension of CANVAS_DIMENSIONS) {
    const fallback =
      dimension === 'width' ? DEFAULT_CANVAS_WIDTH_PX : DEFAULT_CANVAS_HEIGHT_PX
    const original = Object.getOwnPropertyDescriptor(
      HTMLCanvasElement.prototype,
      dimension,
    )!
    restorers.push(
      replaceProperty(HTMLCanvasElement.prototype, dimension, {
        enumerable: Boolean(original.enumerable),
        get(this: HTMLCanvasElement): number {
          if (!ownsCanvas(this)) return Reflect.apply(original.get!, this, [])
          // HTML content attributes parse a leading nonnegative integer; IDL assignment follows a different conversion.
          const matched = this.getAttributeNS(null, dimension)?.match(
            /^[\t\n\f\r ]*\+?\d+/,
          )
          const parsed = matched ? Number(matched[0]) : NaN
          return Number.isFinite(parsed) && parsed <= MAX_HTML_DIMENSION_PX
            ? parsed
            : fallback
        },
        set(this: HTMLCanvasElement, value: unknown): void {
          if (!ownsCanvas(this)) {
            Reflect.apply(original.set!, this, [value])
            return
          }
          const size = conversions['unsigned long'](
            value,
            conversionOptions(this[PropertySymbol.window]),
          )
          if (htmlPlaceholders.has(this))
            throw new this[PropertySymbol.window].DOMException(
              'Placeholder dimensions cannot be changed.',
              'InvalidStateError',
            )
          this.setAttribute(
            dimension,
            String(size > MAX_HTML_DIMENSION_PX ? fallback : size),
          )
        },
      }),
    )
  }

  for (const alias of ['value', 'nodeValue', 'textContent'] as const) {
    const original = Object.getOwnPropertyDescriptor(
      propertyOwner(Attr.prototype, alias),
      alias,
    )!
    restorers.push(
      replaceProperty(Attr.prototype, alias, {
        enumerable: true,
        get(this: Attr): unknown {
          return ownsDimensionAttribute(this)
            ? (this[PropertySymbol.value] ?? '')
            : original.get?.call(this)
        },
        set(this: Attr, value: unknown): void {
          if (!ownsDimensionAttribute(this)) {
            original.set?.call(this, value)
            return
          }
          const text = conversions.DOMString(value, {
            ...conversionOptions(this[PropertySymbol.window]),
            treatNullAsEmptyString: alias !== 'value',
          })
          const previous = this.cloneNode()
          this[PropertySymbol.value] = text
          // Keep the same Attr identity; the existing callback also notifies mutation observers.
          this.ownerElement?.[PropertySymbol.onSetAttribute](this, previous)
        },
      }),
    )
  }

  const implementation = new Proxy(window.OffscreenCanvas, {
    construct(target, argumentsList: unknown[], newTarget) {
      if (argumentsList.length < CANVAS_DIMENSIONS.length)
        throw new window.TypeError('OffscreenCanvas requires width and height.')
      const dimensions = argumentsList
        .slice(0, CANVAS_DIMENSIONS.length)
        .map((value) =>
          conversions['unsigned long'](value, {
            ...conversionOptions(window),
            enforceRange: true,
          }),
        )
      const canvas = Reflect.construct(target, dimensions, newTarget)
      const sizes = { width: canvas.width, height: canvas.height }
      offscreenDimensions.set(canvas, sizes)
      for (const dimension of CANVAS_DIMENSIONS) {
        Object.defineProperty(canvas, dimension, {
          configurable: true,
          enumerable: true,
          get: () => sizes[dimension],
          set(value: unknown) {
            sizes[dimension] = conversions['unsigned long'](value, {
              ...conversionOptions(window),
              enforceRange: true,
            })
            canvasStates.get(canvas)?.reset()
            requestCanvasPresentation(canvas)
          },
        })
      }
      return canvas
    },
  })
  restorers.push(
    replaceProperty(window, 'OffscreenCanvas', {
      value: implementation,
      writable: true,
    }),
  )
  const convert = OffscreenCanvas.prototype.convertToBlob
  restorers.push(
    replaceProperty(OffscreenCanvas.prototype, 'convertToBlob', {
      writable: true,
      // eslint-disable-next-line @typescript-eslint/promise-function-async -- Detached failures must use the caller Window's Promise realm.
      value(
        this: OffscreenCanvas,
        ...argumentsList: Parameters<typeof convert>
      ) {
        const owner: unknown = Reflect.get(this, PropertySymbol.window)
        if (owner instanceof BrowserWindow && detachedOffscreens.has(this))
          return owner.Promise.reject(
            new owner.DOMException(
              'OffscreenCanvas is detached.',
              'InvalidStateError',
            ),
          )
        return Reflect.apply(convert, this, argumentsList)
      },
    }),
  )
}
