import type { Animation, Window } from 'happy-dom';

import type { DisposeCompatibility } from './types.ts';
import { replaceProperty } from './utils/replace-property.ts';

/** Marks canceled finished promises handled while keeping their rejection observable to consumers.
 * @param window - Environment whose animations are canceled by application libraries.
 * @param restorers - Shared teardown registry, updated immediately after each mutation.
 * @returns Nothing; registers cleanup for the runner.
 * @example installAnimation(window, restorers);
 */
export function installAnimation(
  window: Window,
  restorers: DisposeCompatibility[],
): void {
  const originalCancel = window.Animation.prototype.cancel;
  restorers.push(
    replaceProperty(window.Animation.prototype, 'cancel', {
      writable: true,
      value: function cancelWithHandledPromise(this: Animation): void {
        // The specification handles this promise internally; the original promise still rejects.
        void this.finished.catch(() => undefined);
        originalCancel.call(this);
      },
    }),
  );
}
