import { replaceProperty } from '@happy-dom-extended/compat/replace-property'

const activeCanvasPrototypes = new WeakSet<object>()

interface CanvasStubWindow {
  HTMLCanvasElement: { prototype: object }
}

export interface CanvasStubOptions {
  dataURL: string
}

export interface PutImageDataCall {
  canvas: object
  imageData: Pick<ImageData, 'data' | 'width' | 'height'>
  dx: number
  dy: number
}

export interface CanvasStub {
  readonly putImageDataCalls: readonly PutImageDataCall[]
  restore: () => void
}

/** Installs an explicit non-rendering Canvas stub for tests that assert pixel handoff and a chosen data URL.
 * @param options - The test's expected encoded image response.
 * @param window - Global or Happy DOM window whose canvas prototype is patched.
 * @returns Recorded pixel handoffs and an idempotent restore function.
 * @throws If another Canvas stub already owns the same prototype.
 * @example const stub = installCanvasStub({ dataURL: 'data:image/png;base64,AA==' }); stub.restore();
 */
export function installCanvasStub(
  options: CanvasStubOptions,
  window: CanvasStubWindow = globalThis,
): CanvasStub {
  const prototype = window.HTMLCanvasElement.prototype
  // A second helper would otherwise reuse the first helper's response and recordings.
  if (activeCanvasPrototypes.has(prototype)) {
    throw new Error(
      'A Canvas stub is already installed for this prototype. Restore it before installing another.',
    )
  }
  const putImageDataCalls: PutImageDataCall[] = []
  const contexts = new WeakMap<
    object,
    {
      putImageData: (
        imageData: PutImageDataCall['imageData'],
        dx: number,
        dy: number,
      ) => void
    }
  >()
  const restoreContext = replaceProperty(prototype, 'getContext', {
    writable: true,
    value: function getContext(this: object, contextId: string) {
      // This helper implements only the pixel handoff used by conversion tests.
      if (contextId !== '2d') return null
      let context = contexts.get(this)
      if (!context) {
        context = {
          putImageData: (imageData, dx, dy) => {
            putImageDataCalls.push({ canvas: this, imageData, dx, dy })
          },
        }
        contexts.set(this, context)
      }
      return context
    },
  })
  try {
    const restoreDataURL = replaceProperty(prototype, 'toDataURL', {
      writable: true,
      value: () => options.dataURL,
    })
    activeCanvasPrototypes.add(prototype)
    let restored = false
    return {
      putImageDataCalls,
      restore() {
        // Repeated cleanup must not unlock a helper installed after this one.
        if (restored) return
        restored = true
        restoreDataURL()
        restoreContext()
        activeCanvasPrototypes.delete(prototype)
      },
    }
  } catch (error) {
    // A rejected second patch must not leave the first method changed.
    restoreContext()
    throw error
  }
}
