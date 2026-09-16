import { disposeAll, installCompatibility } from '@happy-dom-extended/compat'
import type {
  DisposeCompatibility,
  ExtendedCanvasAdapter,
} from '@happy-dom-extended/compat'
import { GlobalWindow, Window } from 'happy-dom'
// Vitest 4.0.0 has `vitest/environments` and no `vitest/runtime` export.
import { populateGlobal, type Environment } from 'vitest/environments'

import {
  prepareEnvironment,
  type HappyDomExtendedFactoryOptions,
} from './prepare-environment.ts'

/** Copies own property descriptors so a failed {@link populateGlobal} can roll back partial writes.
 * @param target - Sandbox or globalThis that populateGlobal is about to mutate.
 * @returns Name/symbol pairs with the descriptor present before mutation.
 * @example const snapshot = snapshotOwnProperties(global)
 */
function snapshotOwnProperties(target: object) {
  return [
    ...Object.getOwnPropertyNames(target),
    ...Object.getOwnPropertySymbols(target),
  ].map(
    (key) =>
      [key, Object.getOwnPropertyDescriptor(target, key)] as const,
  )
}

/** Restores own properties after {@link populateGlobal} throws mid-write.
 * @param target - Same object passed to populateGlobal.
 * @param snapshot - Result of {@link snapshotOwnProperties} taken before mutation.
 * @example restoreOwnProperties(global, snapshot)
 */
function restoreOwnProperties(
  target: object,
  snapshot: ReadonlyArray<
    readonly [string | symbol, PropertyDescriptor | undefined]
  >,
) {
  const known = new Set(snapshot.map(([key]) => key))
  for (const key of [
    ...Object.getOwnPropertyNames(target),
    ...Object.getOwnPropertySymbols(target),
  ]) {
    if (!known.has(key)) Reflect.deleteProperty(target, key)
  }
  for (const [key, descriptor] of snapshot) {
    if (descriptor) Object.defineProperty(target, key, descriptor)
    else Reflect.deleteProperty(target, key)
  }
}

// Keys that already exist on Node's globalThis must still receive the Window/compat implementations.
const additionalKeys = [
  'Request',
  'Response',
  'MessagePort',
  'fetch',
  'Headers',
  'AbortController',
  'AbortSignal',
  'URL',
  'URLSearchParams',
  'FormData',
  'structuredClone',
  'MessageChannel',
  'BroadcastChannel',
  'Blob',
  'File',
  'FileReader',
  'ImageData',
  'ImageBitmap',
  'createImageBitmap',
  'OffscreenCanvas',
  'Worker',
  'Animation',
  'XMLHttpRequest',
  'CompositionEvent',
  'TextEncoderStream',
  'TextDecoderStream',
  'CompressionStream',
  'DecompressionStream',
]

/** Drains owned Canvas output, closes the Window to join Workers/media, then restores compatibility patches.
 * @param window - Happy DOM window created for this environment lifetime.
 * @param adapter - Default {@link ExtendedCanvasAdapter} owned by this environment, if any.
 * @param disposeCompatibility - Restorer returned by {@link installCompatibility}.
 * @returns A promise that reports original and cleanup failures after resources are released.
 * @example await joinEnvironment(window, adapter, dispose)
 */
async function joinEnvironment(
  window: InstanceType<typeof Window>,
  adapter: ExtendedCanvasAdapter | undefined,
  disposeCompatibility: DisposeCompatibility,
): Promise<void> {
  const errors: unknown[] = []
  try {
    await adapter?.drain()
  } catch (error) {
    errors.push(error)
  }
  try {
    await window.happyDOM.close()
  } catch (error) {
    errors.push(error)
  }
  disposeAll([() => disposeCompatibility(), () => adapter?.dispose()], errors)
}

/** Creates a Happy DOM Window with compat installed before any consumer module evaluates.
 * @param options - Vitest environmentOptions for this file or worker.
 * @param factoryOptions - Optional programmatic {@link HappyDomExtendedFactoryOptions.canvasAdapter}.
 * @param WindowImplementation - {@link GlobalWindow} for `setup`, {@link Window} for `setupVM`.
 * @returns The live Window, owned adapter, and compatibility disposer.
 * @example const created = await createExtendedWindow(options, undefined, GlobalWindow)
 */
async function createExtendedWindow(
  options: unknown,
  factoryOptions: HappyDomExtendedFactoryOptions | undefined,
  WindowImplementation: typeof Window,
): Promise<{
  window: InstanceType<typeof Window>
  adapter: ExtendedCanvasAdapter | undefined
  dispose: DisposeCompatibility
}> {
  const prepared = prepareEnvironment(options, factoryOptions)
  const happyDOM = prepared.happyDOM
  const settings = {
    ...(happyDOM.settings as object),
    disableErrorCapturing: true,
  }
  const windowOptions: ConstructorParameters<typeof Window>[0] = {
    ...happyDOM,
    settings,
    url:
      typeof happyDOM.url === 'string' ? happyDOM.url : 'http://localhost:3000',
  }
  // exactOptionalPropertyTypes forbids `console: undefined` on the Happy DOM options object.
  if (console && globalThis.console) windowOptions.console = globalThis.console
  let window: InstanceType<typeof Window>
  try {
    window = new WindowImplementation(windowOptions)
  } catch (error) {
    disposeAll([() => prepared.adapter?.dispose()], [error])
    throw error
  }
  try {
    const dispose = installCompatibility(
      window,
      // fallow-ignore-next-line unresolved-import -- tsdown emits this private bootstrap; installed-tarball tests execute it.
      new URL('./worker.cjs', import.meta.url),
    )
    return { window, adapter: prepared.adapter, dispose }
  } catch (error) {
    const errors = [error]
    try {
      await window.happyDOM.close()
    } catch (cleanupError) {
      errors.push(cleanupError)
    }
    disposeAll([() => prepared.adapter?.dispose()], errors)
    throw error
  }
}

export type { HappyDomExtendedFactoryOptions } from './prepare-environment.ts'

/** Builds a Vitest {@link Environment} that installs the same Happy DOM extensions as the Jest package.
 * setup: options → Window → compat → populateGlobal(+additionalKeys). teardown: drain → happyDOM.close → dispose → restore.
 * @param factoryOptions - Optional caller-owned `canvasAdapter`; omitted adapters are created per setup.
 * @returns An environment whose `setup`/`setupVM` expose Canvas before tests and setupFiles evaluate.
 * @example export default createHappyDomExtendedEnvironment()
 */
export function createHappyDomExtendedEnvironment(
  factoryOptions?: HappyDomExtendedFactoryOptions,
): Environment {
  return {
    name: 'happy-dom-extended',
    viteEnvironment: 'client',
    async setupVM(options: Record<string, unknown>) {
      // vmThreads requires a `vm.createContext` Window, not {@link GlobalWindow}.
      const created = await createExtendedWindow(
        options,
        factoryOptions,
        Window,
      )
      // vmThreads/vmForks evaluate tests against the Window as the VM context.
      const window = created.window as InstanceType<typeof Window> & {
        Buffer: typeof Buffer
      }
      window.Buffer = Buffer
      let teardown: Promise<void> | undefined
      return {
        getVmContext() {
          return window
        },
        async teardown() {
          return (teardown ??= joinEnvironment(
            created.window,
            created.adapter,
            created.dispose,
          ))
        },
      }
    },
    async setup(global, options) {
      const created = await createExtendedWindow(
        options,
        factoryOptions,
        GlobalWindow || Window,
      )
      let keys: Set<string>
      let originals: Map<string | symbol, unknown>
      const globalSnapshot = snapshotOwnProperties(global)
      try {
        // populateGlobal can throw after Window+compat exist; join so ports/Workers do not leak.
        ;({ keys, originals } = populateGlobal(global, created.window, {
          bindFunctions: true,
          additionalKeys,
        }))
      } catch (error) {
        const errors = [error]
        try {
          restoreOwnProperties(global, globalSnapshot)
        } catch (restoreError) {
          errors.push(restoreError)
        }
        try {
          await joinEnvironment(
            created.window,
            created.adapter,
            created.dispose,
          )
        } catch (cleanupError) {
          errors.push(cleanupError)
        }
        if (errors.length === 1) throw errors[0]
        throw new AggregateError(errors, 'Environment setup failed.', {
          cause: errors[0],
        })
      }
      let teardown: Promise<void> | undefined
      return {
        async teardown(globalThisValue) {
          return (teardown ??= (async () => {
            const errors: unknown[] = []
            try {
              await joinEnvironment(
                created.window,
                created.adapter,
                created.dispose,
              )
            } catch (error) {
              errors.push(error)
            }
            try {
              keys.forEach((key) => {
                // Restore even when drain/close failed so a second setup sees Node globals again.
                Reflect.deleteProperty(globalThisValue, key)
              })
              originals.forEach((value, key) => {
                Reflect.set(globalThisValue, key, value)
              })
            } catch (error) {
              errors.push(error)
            }
            if (errors.length === 1) throw errors[0]
            if (errors.length > 1) {
              throw new AggregateError(errors, 'Environment teardown failed.', {
                cause: errors[0],
              })
            }
          })())
        },
      }
    },
  }
}

export default createHappyDomExtendedEnvironment()
