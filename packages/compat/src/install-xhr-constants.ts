import type { Window } from 'happy-dom';

import { XHR_READY_STATES } from './constants.ts';
import type { DisposeCompatibility } from './types.ts';
import { replaceProperty } from './utils/replace-property.ts';

/** Exposes XMLHttpRequest ready-state constants on instances as required by Web IDL.
 * @param window - Environment whose XMLHttpRequest prototype lacks constants.
 * @param restorers - Shared teardown registry, updated immediately after each mutation.
 * @returns Nothing; registers cleanup for the runner.
 * @example new window.XMLHttpRequest().DONE // 4
 */
export function installXhrConstants(
  window: Window,
  restorers: DisposeCompatibility[],
): void {
  for (const [name, value] of Object.entries(XHR_READY_STATES)) {
    if (Reflect.get(window.XMLHttpRequest.prototype, name) === undefined) {
      restorers.push(
        replaceProperty(window.XMLHttpRequest.prototype, name, {
          value,
          enumerable: true,
          writable: false,
        }),
      );
    }
  }
}
