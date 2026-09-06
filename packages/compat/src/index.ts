import type { Window } from 'happy-dom'

import { installAnimation } from './install-animation.ts'
import { installBinary } from './install-binary.ts'
import { installCompositionEvent } from './install-composition-event.ts'
import { installImageData } from './install-image-data.ts'
import { installMessaging } from './install-messaging.ts'
import { installNodeGlobals } from './install-node-globals.ts'
import { installXhrConstants } from './install-xhr-constants.ts'
import type { DisposeCompatibility } from './types.ts'
import { disposeAll } from './utils/dispose-all.ts'

export type { DisposeCompatibility } from './types.ts'
export { ExtendedCanvasAdapter } from './canvas/adapter.ts'
export { disposeAll } from './utils/dispose-all.ts'

/** Installs verified Web API extensions for a runner and owns their complete teardown.
 * @param window - Happy DOM window created by Jest or a future runner adapter.
 * @returns An idempotent disposer that closes resources and restores patched properties.
 * @example const dispose = installCompatibility(window); dispose();
 */
export function installCompatibility(window: Window): DisposeCompatibility {
  const restorers: DisposeCompatibility[] = []
  const dispose = (): void => {
    disposeAll(restorers)
  }
  try {
    installNodeGlobals(window, restorers)
    installMessaging(window, restorers)
    installBinary(window, restorers)
    installImageData(window, restorers)
    installAnimation(window, restorers)
    installXhrConstants(window, restorers)
    installCompositionEvent(window, restorers)
    return dispose
  } catch (error) {
    disposeAll(restorers, [error])
    throw error
  }
}
