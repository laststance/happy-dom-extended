import { prepareOwnedCanvasSettings } from '@happy-dom-extended/compat'
import type { ExtendedCanvasAdapter } from '@happy-dom-extended/compat'

export type HappyDomExtendedFactoryOptions = {
  canvasAdapter?: unknown
}

/** True when `value` can be spread as Happy DOM Window or settings fields.
 * @param value - Unknown environmentOptions fragment.
 * @returns Whether the value is a non-null object.
 * @example if (isRecord(options.happyDOM)) ...
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** True when Vitest wrapped `@vitest-environment-options` under the resolved environment module path.
 * @param key - Top-level environmentOptions key, often an absolute module path.
 * @param value - Nested options object.
 * @returns Whether the object should be flattened as Window options.
 * @example if (isFilePathWrappedOptions(key, value)) Object.assign(nested, value)
 */
function isFilePathWrappedOptions(key: string, value: unknown): boolean {
  if (!isRecord(value)) return false
  if ('url' in value || 'settings' in value) return true
  const looksLikeModulePath =
    key.includes('/') ||
    key.endsWith('.mjs') ||
    key.endsWith('.mts') ||
    key.endsWith('.cjs') ||
    key.endsWith('.js') ||
    key.endsWith('.ts')
  if (!looksLikeModulePath) return false
  return (
    'width' in value ||
    'height' in value ||
    'innerWidth' in value ||
    'innerHeight' in value ||
    'console' in value
  )
}

/** Merges Vitest `happyDOM`, `happy-dom-extended`, and top-level Window options for {@link createHappyDomExtendedEnvironment}.
 * @param options - `setup`/`setupVM` environmentOptions, including file-level `@vitest-environment-options`.
 * @returns Flat Happy DOM Window options without the runner wrapper keys.
 * @example resolveHappyDomOptions({ 'happy-dom-extended': { url: 'https://example.test/' } })
 */
function resolveHappyDomOptions(
  options: unknown,
): Record<string, unknown> {
  const record = isRecord(options) ? options : {}
  const named = isRecord(record['happy-dom-extended'])
    ? record['happy-dom-extended']
    : {}
  const happyDOM = isRecord(record.happyDOM) ? record.happyDOM : {}
  const { happyDOM: _happyDOM, 'happy-dom-extended': _named, ...rest } = record
  const nested: Record<string, unknown> = {}
  const topLevel: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(rest)) {
    if (isFilePathWrappedOptions(key, value)) {
      Object.assign(nested, value)
      continue
    }
    topLevel[key] = value
  }
  return { ...topLevel, ...nested, ...happyDOM, ...named }
}

/** Prepares Window settings and an owned {@link ExtendedCanvasAdapter} for one Vitest environment lifetime.
 * @param options - Runner environmentOptions plus optional factory `canvasAdapter` override.
 * @param factoryOptions - Adapter supplied by {@link createHappyDomExtendedEnvironment}, if any.
 * @returns Window constructor fields and the adapter this environment must drain and dispose.
 * @example const prepared = prepareEnvironment(options, factory)
 */
export function prepareEnvironment(
  options: unknown,
  factoryOptions?: HappyDomExtendedFactoryOptions,
): {
  happyDOM: Record<string, unknown>
  adapter: ExtendedCanvasAdapter | undefined
} {
  const happyDOM = resolveHappyDomOptions(options)
  let suppliedSettings: unknown = happyDOM.settings
  if (
    factoryOptions !== undefined &&
    Object.hasOwn(factoryOptions, 'canvasAdapter')
  ) {
    // Factory ownership wins over serialized settings so programmatic adapters keep their identity.
    if (
      suppliedSettings === undefined ||
      suppliedSettings === null ||
      typeof suppliedSettings === 'object'
    ) {
      suppliedSettings = {
        ...(suppliedSettings as object | undefined),
        canvasAdapter: factoryOptions.canvasAdapter,
      }
    }
  }
  const { settings, adapter } = prepareOwnedCanvasSettings(suppliedSettings, {
    settings: 'environmentOptions.settings must be an object.',
    adapter:
      'canvasAdapter must implement getContext, toDataURL, and toBlob. Configuration cannot serialize adapter instances; construct custom adapters with createHappyDomExtendedEnvironment({ canvasAdapter }).',
  })
  return {
    happyDOM: { ...happyDOM, settings },
    adapter,
  }
}
