import type { Window } from 'happy-dom'

import { ExtendedCanvasAdapter } from './canvas/adapter.ts'
import { installCanvasBindings } from './canvas/bindings.ts'
import { installCanvasBitmaps } from './canvas/bitmaps.ts'
import { installCanvasImages } from './canvas/images.ts'
import { installCanvasTransfer } from './canvas/transfer.ts'
import { installCanvasVideos } from './canvas/videos.ts'
import { installAnimation } from './install-animation.ts'
import { installBinary } from './install-binary.ts'
import { installCompositionEvent } from './install-composition-event.ts'
import { installImageData } from './install-image-data.ts'
import { installMessaging } from './install-messaging.ts'
import { installNodeGlobals } from './install-node-globals.ts'
import { installXhrConstants } from './install-xhr-constants.ts'
import type { DisposeCompatibility } from './types.ts'
import { disposeAll } from './utils/dispose-all.ts'
import { installWorkers } from './workers/install-workers.ts'

export type { DisposeCompatibility } from './types.ts'
export { ExtendedCanvasAdapter } from './canvas/adapter.ts'
export { disposeAll } from './utils/dispose-all.ts'

/** Installs verified Web API extensions; runners first await Window close to join asynchronous resources, then restore patches.
 * @param window - Happy DOM window created by Jest or a future runner adapter.
 * @returns An idempotent synchronous disposer that requests cancellation and restores properties; it does not join child threads.
 * @example const dispose = installCompatibility(window); await window.happyDOM.close(); dispose();
 */
export function installCompatibility(
  window: Window,
  workerBootstrap?: URL,
): DisposeCompatibility {
  const restorers: DisposeCompatibility[] = []
  const dispose = (): void => {
    disposeAll(restorers)
  }
  try {
    // Own the clone slot before the generic fallback; shared patch reference counting intentionally does not stack replacements.
    if (window.happyDOM.settings.canvasAdapter instanceof ExtendedCanvasAdapter)
      installCanvasTransfer(window, restorers)
    installNodeGlobals(window, restorers)
    installMessaging(window, restorers)
    installBinary(window, restorers)
    installImageData(
      window,
      restorers,
      window.happyDOM.settings.canvasAdapter instanceof ExtendedCanvasAdapter,
    )
    if (
      window.happyDOM.settings.canvasAdapter instanceof ExtendedCanvasAdapter
    ) {
      installCanvasBindings(
        window,
        window.happyDOM.settings.canvasAdapter,
        restorers,
      )
      installCanvasImages(
        window,
        window.happyDOM.settings.canvasAdapter,
        restorers,
      )
      installCanvasVideos(
        window,
        window.happyDOM.settings.canvasAdapter,
        restorers,
      )
      installCanvasBitmaps(
        window,
        window.happyDOM.settings.canvasAdapter,
        restorers,
      )
      installWorkers(window, restorers, workerBootstrap)
    }
    installAnimation(window, restorers)
    installXhrConstants(window, restorers)
    installCompositionEvent(window, restorers)
    return dispose
  } catch (error) {
    disposeAll(restorers, [error])
    throw error
  }
}
