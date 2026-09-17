import { ExtendedCanvasAdapter } from './canvas/adapter.ts'

export type PreparedOwnedCanvasSettings = {
  settings: Record<string, unknown> & {
    enableImageFileLoading: boolean
    canvasAdapter: unknown
  }
  adapter: ExtendedCanvasAdapter | undefined
}

export type PrepareOwnedCanvasSettingsErrors = {
  settings?: string
  adapter?: string
}

/** Copies Happy DOM `settings` and owns a default {@link ExtendedCanvasAdapter} when the caller did not supply one.
 * @param suppliedSettings - Runner `settings` object, or `undefined` to apply defaults.
 * @param errors - Optional TypeError messages so a runner can keep its historical wording.
 * @returns Settings ready for Window construction plus the adapter that runner must drain and dispose, if any.
 * @example const { settings, adapter } = prepareOwnedCanvasSettings(options.settings)
 */
export function prepareOwnedCanvasSettings(
  suppliedSettings: unknown,
  errors?: PrepareOwnedCanvasSettingsErrors,
): PreparedOwnedCanvasSettings {
  if (
    suppliedSettings !== undefined &&
    suppliedSettings !== null &&
    (typeof suppliedSettings !== 'object' || Array.isArray(suppliedSettings))
  ) {
    // Arrays are objects; spreading them would inject numeric keys into Window settings.
    throw new TypeError(errors?.settings ?? 'settings must be an object.')
  }
  const settings = {
    enableImageFileLoading: true,
    ...(suppliedSettings as object),
  }
  const suppliedAdapter: unknown = Reflect.get(settings, 'canvasAdapter')
  if (
    suppliedAdapter !== undefined &&
    suppliedAdapter !== null &&
    (typeof suppliedAdapter !== 'object' ||
      ['getContext', 'toDataURL', 'toBlob'].some(
        (method) => typeof Reflect.get(suppliedAdapter, method) !== 'function',
      ))
  ) {
    throw new TypeError(
      errors?.adapter ??
        'canvasAdapter must implement getContext, toDataURL, and toBlob. Configuration cannot serialize adapter instances.',
    )
  }
  // Explicit adapters (including null) belong to the caller; only the default instance is ours to dispose.
  const adapter =
    suppliedAdapter === undefined ? new ExtendedCanvasAdapter() : undefined
  return {
    settings: { ...settings, canvasAdapter: adapter ?? suppliedAdapter },
    adapter,
  }
}
