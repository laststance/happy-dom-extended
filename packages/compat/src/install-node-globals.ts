import {
  CompressionStream,
  DecompressionStream,
  TextDecoderStream,
  TextEncoderStream,
} from 'node:stream/web'

import type { Window } from 'happy-dom'

import type { DisposeCompatibility } from './types.ts'
import { replaceProperty } from './utils/replace-property.ts'

const nodeGlobals = {
  structuredClone: globalThis.structuredClone,
  TextEncoderStream,
  TextDecoderStream,
  CompressionStream,
  DecompressionStream,
}

/** Supplies missing Node-backed Web APIs before a runner evaluates application modules.
 * @param window - Happy DOM environment to extend.
 * @param restorers - Shared teardown registry, updated immediately after each mutation.
 * @returns Nothing; registers cleanup for the runner.
 * @example installNodeGlobals(window, restorers);
 */
export function installNodeGlobals(
  window: Window,
  restorers: DisposeCompatibility[],
): void {
  for (const [name, implementation] of Object.entries(nodeGlobals)) {
    // Existing implementations keep their identity and native behavior.
    if (Reflect.get(window, name) === undefined) {
      restorers.push(
        replaceProperty(window, name, {
          value: implementation,
          writable: true,
        }),
      )
    }
  }
}
