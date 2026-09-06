import type { Window } from 'happy-dom'

import { PROBE_BYTE_LENGTH } from './constants.ts'
import type { DisposeCompatibility } from './types.ts'
import { normalizeBlobArguments } from './utils/normalize-blob-arguments.ts'
import { replaceProperty } from './utils/replace-property.ts'

/** Preserves binary parts from another VM when {@link installBinary} initializes Blob and File construction.
 * @param window - Environment whose constructors receive VM-created arrays.
 * @param restorers - Teardown registry for the replaced constructors.
 * @returns Nothing; keeps working constructors or registers their restoration.
 * @example installBlobConstructors(window, restorers);
 */
export function installBlobConstructors(
  window: Window,
  restorers: DisposeCompatibility[],
): void {
  // Working constructors already preserve the input byte length.
  if (
    new window.Blob([new window.ArrayBuffer(PROBE_BYTE_LENGTH)]).size ===
    PROBE_BYTE_LENGTH
  ) {
    return
  }
  for (const name of ['Blob', 'File'] as const) {
    const implementation = new Proxy(window[name], {
      construct(target, argumentsList: unknown[], newTarget) {
        return Reflect.construct(
          target,
          normalizeBlobArguments(argumentsList),
          newTarget,
        )
      },
    })
    restorers.push(
      replaceProperty(window, name, {
        value: implementation,
        writable: true,
      }),
    )
  }
}
