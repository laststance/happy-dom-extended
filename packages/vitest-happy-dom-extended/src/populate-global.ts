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

/** Narrows an imported `populateGlobal` export; TypeScript cannot infer a callable signature from `typeof === 'function'`.
 * @param value - `populateGlobal` property read from a Vitest entry module.
 * @returns Whether the export can be called as {@link PopulateGlobal}.
 * @example if (isPopulateGlobal(entry.populateGlobal)) return entry.populateGlobal
 */
function isPopulateGlobal(value: unknown): value is PopulateGlobal {
  return typeof value === 'function'
}

/** True when the error only means this Vitest install does not expose the requested entry.
 * Node reports ERR_PACKAGE_PATH_NOT_EXPORTED; Vite's resolver (an inlined or linked environment) reports the same text without a code.
 * @param error - Rejection from importing a Vitest entry.
 * @returns
 * - true: the entry is absent, so the next entry should be tried
 * - false: any other failure, which must propagate
 * @example
 * isMissingEntryError(Object.assign(new Error(), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' })) // => true
 * isMissingEntryError(new TypeError('boom')) // => false
 */
function isMissingEntryError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  if (Reflect.get(error, 'code') === 'ERR_PACKAGE_PATH_NOT_EXPORTED')
    return true
  const message = Reflect.get(error, 'message')
  return (
    typeof message === 'string' &&
    message.includes('is not defined by "exports"')
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
      if (!isMissingEntryError(error)) throw error
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
