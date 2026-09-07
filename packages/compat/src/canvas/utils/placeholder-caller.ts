import { HTMLCanvasElement } from 'happy-dom'
import type { ICanvasAdapterCaller } from 'happy-dom'

import { htmlPlaceholders } from '../presentation.ts'

/** Routes HTML export callers to the last presented bitmap without exposing the placeholder's hidden drawing context.
 * @returns The original caller or one targeting the displayed OffscreenCanvas surface.
 * @example const displayed = placeholderCaller(caller);
 */
export function placeholderCaller(
  caller: ICanvasAdapterCaller,
): ICanvasAdapterCaller {
  const canvas =
    caller.canvas instanceof HTMLCanvasElement
      ? htmlPlaceholders.get(caller.canvas)
      : undefined
  return canvas ? { ...caller, canvas } : caller
}
