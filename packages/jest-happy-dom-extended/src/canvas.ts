import { replaceProperty } from '@happy-dom-extended/compat/replace-property';

interface CanvasStubWindow {
  HTMLCanvasElement: { prototype: object };
}

export interface CanvasStubOptions {
  dataURL: string;
}

export interface PutImageDataCall {
  canvas: object;
  imageData: Pick<ImageData, 'data' | 'width' | 'height'>;
  dx: number;
  dy: number;
}

export interface CanvasStub {
  readonly putImageDataCalls: readonly PutImageDataCall[];
  restore: () => void;
}

/** Installs an explicit non-rendering Canvas stub for tests that assert pixel handoff and a chosen data URL.
 * @param options - The test's expected encoded image response.
 * @param window - Global or Happy DOM window whose canvas prototype is patched.
 * @returns Recorded pixel handoffs and an idempotent restore function.
 * @example const stub = installCanvasStub({ dataURL: 'data:image/png;base64,AA==' }); stub.restore();
 */
export function installCanvasStub(
  options: CanvasStubOptions,
  window: CanvasStubWindow = globalThis,
): CanvasStub {
  const putImageDataCalls: PutImageDataCall[] = [];
  const contexts = new WeakMap<
    object,
    {
      putImageData: (
        imageData: PutImageDataCall['imageData'],
        dx: number,
        dy: number,
      ) => void;
    }
  >();
  const prototype = window.HTMLCanvasElement.prototype;
  const restoreContext = replaceProperty(prototype, 'getContext', {
    writable: true,
    value: function getContext(this: object, contextId: string) {
      // This helper implements only the pixel handoff used by conversion tests.
      if (contextId !== '2d') return null;
      let context = contexts.get(this);
      if (!context) {
        context = {
          putImageData: (imageData, dx, dy) => {
            putImageDataCalls.push({ canvas: this, imageData, dx, dy });
          },
        };
        contexts.set(this, context);
      }
      return context;
    },
  });
  const restoreDataURL = replaceProperty(prototype, 'toDataURL', {
    writable: true,
    value: () => options.dataURL,
  });
  return {
    putImageDataCalls,
    restore() {
      restoreDataURL();
      restoreContext();
    },
  };
}
