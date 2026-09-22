/** Options accepted by Vitest's populateGlobal in every supported major. */
type PopulateGlobalOptions = {
  bindFunctions?: boolean
  additionalKeys?: string[]
}

/** Vitest's populateGlobal. Only `keys` is consumed: `originals` holds values in Vitest 4 and descriptors in Vitest 5. */
export type PopulateGlobal = (
  global: object,
  window: object,
  options: PopulateGlobalOptions,
) => { keys: Set<string> }

/** Loads one module specifier; injectable so tests can reproduce each Vitest layout. */
type ImportModule = (specifier: string) => Promise<unknown>

// Vitest 4.1 added `vitest/runtime` and deprecated `vitest/environments`; Vitest 5 removed the latter; 4.0.x has only the latter.
const vitestEntries = ['vitest/runtime', 'vitest/environments']

// Node 25+ defines these by default, and Node 22/24 with --experimental-webstorage, as lazy getters on every worker global.
// Vitest 5 overrides both; Vitest 4's key list omits them, so tests kept Node's `localStorage`, which is unusable without --localstorage-file.
const webStorageKeys = ['localStorage', 'sessionStorage']

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
  ...webStorageKeys,
]

/** Narrows an imported `populateGlobal` export; TypeScript cannot infer a callable signature from `typeof === 'function'`.
 * @param value - `populateGlobal` property read from a Vitest entry module.
 * @returns Whether the export can be called as {@link PopulateGlobal}.
 * @example if (isPopulateGlobal(entry.populateGlobal)) return entry.populateGlobal
 */
function isPopulateGlobal(value: unknown): value is PopulateGlobal {
  return typeof value === 'function'
}

// Vitest's own manifest in a missing-export message, with POSIX or Windows separators; `@vitest/*` manifests do not match.
const vitestManifestPattern = /[\\/]vitest[\\/]package\.json/

/** True when the error only means this Vitest install does not expose the requested entry.
 * Node (ERR_PACKAGE_PATH_NOT_EXPORTED) and Vite's resolver (an inlined or linked environment, no code) share this message.
 * The message must name the requested subpath in Vitest's manifest, so a dependency failing inside `vitest/runtime` still surfaces.
 * @param error - Rejection from importing a Vitest entry.
 * @param specifier - The entry that was requested, such as `vitest/runtime`.
 * @returns
 * - true: Vitest itself does not export that entry, so the next entry should be tried
 * - false: any other failure, including another package's missing export, which must propagate
 * @example
 * isMissingEntryError(new Error(`Package subpath './runtime' is not defined by "exports" in /app/node_modules/vitest/package.json`), 'vitest/runtime') // => true
 * isMissingEntryError(new Error(`Package subpath './x' is not defined by "exports" in /app/node_modules/dep/package.json`), 'vitest/runtime') // => false
 */
function isMissingEntryError(error: unknown, specifier: string): boolean {
  if (typeof error !== 'object' || error === null) return false
  const message = Reflect.get(error, 'message')
  if (typeof message !== 'string') return false
  const subpath = `./${specifier.slice('vitest/'.length)}`
  return (
    message.includes(`'${subpath}' is not defined by "exports"`) &&
    vitestManifestPattern.test(message)
  )
}

/** Imports populateGlobal from `vitest/runtime` (Vitest 4.1+ and 5), falling back to `vitest/environments` only on 4.0.x.
 * Avoids Vitest 4.1's deprecation warning and Vitest 5's removed subpath; `setup` calls this before creating a Window.
 * @param importModule - Module loader; defaults to native dynamic import resolved from this package.
 * @returns
 * - Vitest 4.1+ / 5: populateGlobal from `vitest/runtime`
 * - Vitest 4.0.x: populateGlobal from `vitest/environments`
 * - Rejects with the original error when an existing entry fails, or an AggregateError when both entries are absent
 * @example const populateGlobal = await importPopulateGlobal() // => Vitest's populateGlobal
 */
export async function importPopulateGlobal(
  importModule: ImportModule = async (specifier) => import(specifier),
): Promise<PopulateGlobal> {
  const missing: unknown[] = []
  for (const specifier of vitestEntries) {
    let entry: unknown
    try {
      entry = await importModule(specifier)
    } catch (error) {
      // A Vitest module that exists but fails to evaluate is a real error, not a reason to use the legacy entry.
      if (!isMissingEntryError(error, specifier)) throw error
      missing.push(error)
      continue
    }
    const populateGlobal =
      typeof entry === 'object' && entry !== null
        ? Reflect.get(entry, 'populateGlobal')
        : undefined
    if (!isPopulateGlobal(populateGlobal)) {
      throw new TypeError(`${specifier} does not export populateGlobal.`)
    }
    return populateGlobal
  }
  throw new AggregateError(
    missing,
    'The installed Vitest exposes neither vitest/runtime nor vitest/environments. Install Vitest 4 or 5.',
  )
}

/** Replaces Node's lazy Web Storage getters with inert data properties so Vitest 4's populateGlobal cannot run them.
 * Vitest 4 reads each overridden key's value first: Node 25+ then warns, and Node 22/24 --experimental-webstorage throws, when `localStorage` has no --localstorage-file.
 * @param global - Worker global about to receive the Window keys; teardown restores the real descriptors from its own snapshot.
 * @example shadowLazyWebStorage(globalThis) // globalThis.localStorage === undefined until populateGlobal redefines it
 */
function shadowLazyWebStorage(global: object) {
  for (const key of webStorageKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(global, key)
    // Node defines both as configurable own accessors on the main thread and in workers; any other shape is safe to read.
    if (descriptor?.get && descriptor.configurable) {
      Object.defineProperty(global, key, {
        configurable: true,
        enumerable: descriptor.enumerable === true,
        writable: true,
        value: undefined,
      })
    }
  }
}

/** Writes the Window's keys onto a forks/threads worker global with Vitest's populateGlobal; `setup` calls this once compat is installed.
 * Adds the keys Node already defines, after hiding Node's lazy Web Storage getters, so Vitest 4 and 5 expose the same Window APIs.
 * @param global - Worker global passed to `setup`.
 * @param window - Happy DOM GlobalWindow with compat installed.
 * @param populateGlobal - Vitest's populateGlobal from {@link importPopulateGlobal}.
 * @returns Names populateGlobal defined, which teardown restores or deletes.
 * @example const keys = populateWindowGlobals(global, window, await importPopulateGlobal()) // keys.has('localStorage') === true
 */
export function populateWindowGlobals(
  global: object,
  window: object,
  populateGlobal: PopulateGlobal,
): ReadonlySet<string> {
  shadowLazyWebStorage(global)
  return populateGlobal(global, window, { bindFunctions: true, additionalKeys })
    .keys
}
