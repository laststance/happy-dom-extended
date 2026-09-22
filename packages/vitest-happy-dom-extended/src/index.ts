import { disposeAll, installCompatibility } from '@happy-dom-extended/compat'
import type {
  DisposeCompatibility,
  ExtendedCanvasAdapter,
} from '@happy-dom-extended/compat'
import { GlobalWindow, Window } from 'happy-dom'
// Type-only: checks conformance against the development Vitest without emitting a runtime import.
import type { Environment as VitestEnvironment } from 'vitest/runtime'

import { importPopulateGlobal } from './populate-global.ts'
import {
  prepareEnvironment,
  type HappyDomExtendedFactoryOptions,
} from './prepare-environment.ts'

/** Own-property descriptors captured before {@link PopulateGlobal} runs so failed setup and teardown restore the exact prior state. */
type OwnPropertySnapshot = ReadonlyArray<
  readonly [string | symbol, PropertyDescriptor | undefined]
>

/** Resources one environment lifetime owns: the Window, its default Canvas adapter, and the compatibility restorer. */
type ExtendedWindow = {
  window: InstanceType<typeof Window>
  adapter: ExtendedCanvasAdapter | undefined
  dispose: DisposeCompatibility
}

/** Vitest environment object returned by {@link createHappyDomExtendedEnvironment}.
 * Structural so the published types do not import `vitest/environments` (Vitest 4) or `vitest/runtime` (Vitest 4.1+/5).
 */
export type HappyDomExtendedEnvironment = {
  name: 'happy-dom-extended'
  viteEnvironment: 'client'
  setupVM(options: Record<string, unknown>): Promise<{
    getVmContext(): InstanceType<typeof Window>
    teardown(): Promise<void>
  }>
  setup(
    global: object,
    options: Record<string, unknown>,
  ): Promise<{ teardown(global: object): Promise<void> }>
}

/** Copies own property descriptors so a failed {@link PopulateGlobal} can roll back and teardown can restore populated keys.
 * Reads descriptors, never values, so lazy native getters such as Node's `localStorage` are not invoked.
 * @param target - Sandbox or globalThis that populateGlobal is about to mutate.
 * @returns Name/symbol pairs with the descriptor present before mutation.
 * @example const snapshot = snapshotOwnProperties(global)
 */
function snapshotOwnProperties(target: object): OwnPropertySnapshot {
  return [
    ...Object.getOwnPropertyNames(target),
    ...Object.getOwnPropertySymbols(target),
  ].map((key) => [key, Object.getOwnPropertyDescriptor(target, key)] as const)
}

/** Deletes own keys added after the snapshot so a failed {@link PopulateGlobal} does not leave Window leftovers.
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

/** Reapplies snapshot descriptors, deleting keys that had no descriptor before {@link PopulateGlobal}.
 * {@link restoreOwnProperties} calls this after removing unknown keys.
 * @example applyOwnPropertySnapshot(global, snapshot)
 */
function applyOwnPropertySnapshot(
  target: object,
  snapshot: OwnPropertySnapshot,
) {
  for (const [key, descriptor] of snapshot) {
    if (descriptor) Object.defineProperty(target, key, descriptor)
    else Reflect.deleteProperty(target, key)
  }
}

/** Restores every own property after {@link PopulateGlobal} throws mid-write.
 * @param target - Same object passed to populateGlobal.
 * @param snapshot - Result of {@link snapshotOwnProperties} taken before mutation.
 * @example restoreOwnProperties(global, snapshot)
 */
function restoreOwnProperties(target: object, snapshot: OwnPropertySnapshot) {
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

/** Puts back the pre-setup descriptor of every key {@link PopulateGlobal} wrote, deleting keys that did not exist before.
 * Uses this environment's own snapshot because Vitest 4 `originals` holds values while Vitest 5 holds descriptors.
 * Runs even when drain/close failed so the next setup sees Node globals.
 * @param globalThisValue - Sandbox or worker global mutated by setup.
 * @param keys - Names populateGlobal wrote, including `window`/`self`/`top`/`parent`.
 * @param snapshot - Descriptors from {@link snapshotOwnProperties} taken before populateGlobal.
 * @example restorePopulatedGlobals(global, keys, snapshot)
 */
function restorePopulatedGlobals(
  globalThisValue: object,
  keys: ReadonlySet<string>,
  snapshot: OwnPropertySnapshot,
) {
  const before = new Map(snapshot)
  for (const key of keys) {
    const descriptor = before.get(key)
    // Keys that existed regain their exact descriptor; keys the Window introduced are removed.
    if (descriptor) Object.defineProperty(globalThisValue, key, descriptor)
    else Reflect.deleteProperty(globalThisValue, key)
  }
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

/** Restores a partial {@link PopulateGlobal} write, then joins the Window so setup failures do not leak ports.
 * `setup` catch calls this after populateGlobal throws.
 * @example await recoverFailedPopulate(global, snapshot, created, error)
 */
async function recoverFailedPopulate(
  global: object,
  globalSnapshot: OwnPropertySnapshot,
  created: ExtendedWindow,
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
 * @param keys - populateGlobal keys to restore or delete.
 * @param snapshot - Descriptors captured by {@link snapshotOwnProperties} before populateGlobal.
 * @example await teardownPopulatedEnvironment(global, created, keys, snapshot)
 */
async function teardownPopulatedEnvironment(
  globalThisValue: object,
  created: ExtendedWindow,
  keys: ReadonlySet<string>,
  snapshot: OwnPropertySnapshot,
) {
  const errors: unknown[] = []
  try {
    await joinEnvironment(created.window, created.adapter, created.dispose)
  } catch (error) {
    errors.push(error)
  }
  try {
    restorePopulatedGlobals(globalThisValue, keys, snapshot)
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
): Promise<ExtendedWindow> {
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

/** Builds the Vitest 4/5 {@link HappyDomExtendedEnvironment} that installs the same Happy DOM extensions as the Jest package.
 * setup: populateGlobal import → options → Window → compat → populateGlobal(+additionalKeys). teardown: drain → happyDOM.close → dispose → restore descriptors.
 * @param factoryOptions - Optional caller-owned `canvasAdapter`; omitted adapters are created per setup.
 * @returns An environment whose `setup` (forks/threads) and `setupVM` (vmThreads/vmForks) expose Canvas before tests and setupFiles evaluate.
 * @example export default createHappyDomExtendedEnvironment()
 */
export function createHappyDomExtendedEnvironment(
  factoryOptions?: HappyDomExtendedFactoryOptions,
): HappyDomExtendedEnvironment {
  const environment: HappyDomExtendedEnvironment = {
    name: 'happy-dom-extended',
    viteEnvironment: 'client',
    async setupVM(options) {
      // vmThreads/vmForks require a `vm.createContext` Window, not {@link GlobalWindow}.
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
      // Resolve Vitest's entry before creating a Window so an unsupported Vitest cannot leak one.
      const populateGlobal = await importPopulateGlobal()
      const created = await createExtendedWindow(
        options,
        factoryOptions,
        GlobalWindow || Window,
      )
      let keys: ReadonlySet<string>
      const globalSnapshot = snapshotOwnProperties(global)
      try {
        // populateGlobal can throw after Window+compat exist; join so ports/Workers do not leak.
        ;({ keys } = populateGlobal(global, created.window, {
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
            globalSnapshot,
          ))
        },
      }
    },
  }
  // Compile-time check against the development Vitest; the structural type keeps it out of the published declarations.
  return environment satisfies VitestEnvironment
}

export default createHappyDomExtendedEnvironment()
