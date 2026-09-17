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
  ].map((key) => [key, Object.getOwnPropertyDescriptor(target, key)] as const)
}

/** Restores own properties after {@link populateGlobal} throws mid-write.
 * @param target - Same object passed to populateGlobal.
 * @param snapshot - Result of {@link snapshotOwnProperties} taken before mutation.
 * @example restoreOwnProperties(global, snapshot)
 */
/** Deletes own keys added after the snapshot so a failed {@link populateGlobal} does not leave Window leftovers.
 * {@link restoreOwnProperties} calls this before reapplying saved descriptors.
 * @example deleteUnknownOwnProperties(global, known)
 */
function deleteUnknownOwnProperties(
  target: object,
  known: ReadonlySet<string | symbol>,
) {
  for (const key of [
    ...Object.getOwnPropertyNames(target),
    ...Object.getOwnPropertySymbols(target),
  ]) {
    if (!known.has(key)) Reflect.deleteProperty(target, key)
  }
}

/** Reapplies snapshot descriptors, deleting keys that had no descriptor before {@link populateGlobal}.
 * {@link restoreOwnProperties} calls this after removing unknown keys.
 * @example applyOwnPropertySnapshot(global, snapshot)
 */
function applyOwnPropertySnapshot(
  target: object,
  snapshot: ReadonlyArray<
    readonly [string | symbol, PropertyDescriptor | undefined]
  >,
) {
  for (const [key, descriptor] of snapshot) {
    if (descriptor) Object.defineProperty(target, key, descriptor)
    else Reflect.deleteProperty(target, key)
  }
}

function restoreOwnProperties(
  target: object,
  snapshot: ReadonlyArray<
    readonly [string | symbol, PropertyDescriptor | undefined]
  >,
) {
  deleteUnknownOwnProperties(target, new Set(snapshot.map(([key]) => key)))
  applyOwnPropertySnapshot(target, snapshot)
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

/** Restores {@link populateGlobal} keys even when drain/close failed so the next setup sees Node globals.
 * @param globalThisValue - Sandbox or worker global mutated by setup.
 * @param keys - Names populateGlobal added.
 * @param originals - Prior values to put back.
 * @example restorePopulatedGlobals(global, keys, originals)
 */
function restorePopulatedGlobals(
  globalThisValue: object,
  keys: Set<string>,
  originals: Map<string | symbol, unknown>,
) {
  keys.forEach((key) => {
    Reflect.deleteProperty(globalThisValue, key)
  })
  originals.forEach((value, key) => {
    Reflect.set(globalThisValue, key, value)
  })
}

/** Throws a single error or an AggregateError after setup/teardown collected more than one failure.
 * @param errors - Failures from join, restore, or populateGlobal.
 * @param message - AggregateError message when more than one failure exists.
 * @example throwCollectedErrors(errors, 'Environment teardown failed.')
 */
function throwCollectedErrors(errors: unknown[], message: string) {
  // A single failure keeps the original error so callers do not unwrap AggregateError.
  if (errors.length === 1) throw errors[0]
  // Multiple failures wrap so drain/close/restore errors are all visible.
  if (errors.length > 1) {
    throw new AggregateError(errors, message, { cause: errors[0] })
  }
}

/** Restores a partial {@link populateGlobal} write, then joins the Window so setup failures do not leak ports.
 * `setup` catch calls this after populateGlobal throws.
 * @example await recoverFailedPopulate(global, snapshot, created, error)
 */
async function recoverFailedPopulate(
  global: object,
  globalSnapshot: ReadonlyArray<
    readonly [string | symbol, PropertyDescriptor | undefined]
  >,
  created: {
    window: InstanceType<typeof Window>
    adapter: ExtendedCanvasAdapter | undefined
    dispose: DisposeCompatibility
  },
  error: unknown,
): Promise<never> {
  const errors = [error]
  try {
    restoreOwnProperties(global, globalSnapshot)
  } catch (restoreError) {
    errors.push(restoreError)
  }
  try {
    await joinEnvironment(created.window, created.adapter, created.dispose)
  } catch (cleanupError) {
    errors.push(cleanupError)
  }
  throwCollectedErrors(errors, 'Environment setup failed.')
  throw new Error('Environment setup failed.')
}

/** Joins the Window then restores populateGlobal writes so a second setup does not see leftover Window keys.
 * @param globalThisValue - Same object passed to setup.
 * @param created - Window/adapter/dispose from {@link createExtendedWindow}.
 * @param keys - populateGlobal keys to delete.
 * @param originals - populateGlobal originals to restore.
 * @example await teardownPopulatedEnvironment(global, created, keys, originals)
 */
async function teardownPopulatedEnvironment(
  globalThisValue: object,
  created: {
    window: InstanceType<typeof Window>
    adapter: ExtendedCanvasAdapter | undefined
    dispose: DisposeCompatibility
  },
  keys: Set<string>,
  originals: Map<string | symbol, unknown>,
) {
  const errors: unknown[] = []
  try {
    await joinEnvironment(created.window, created.adapter, created.dispose)
  } catch (error) {
    errors.push(error)
  }
  try {
    restorePopulatedGlobals(globalThisValue, keys, originals)
  } catch (error) {
    errors.push(error)
  }
  throwCollectedErrors(errors, 'Environment teardown failed.')
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
        await recoverFailedPopulate(global, globalSnapshot, created, error)
      }
      let teardown: Promise<void> | undefined
      return {
        async teardown(globalThisValue) {
          return (teardown ??= teardownPopulatedEnvironment(
            globalThisValue,
            created,
            keys,
            originals,
          ))
        },
      }
    },
  }
}

export default createHappyDomExtendedEnvironment()
