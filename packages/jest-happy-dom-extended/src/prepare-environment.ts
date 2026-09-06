import type HappyDOMEnvironment from '@happy-dom/jest-environment'
import { ExtendedCanvasAdapter } from '@happy-dom-extended/compat'

type EnvironmentConfiguration = ConstructorParameters<
  typeof HappyDOMEnvironment
>[0]

/** Copies Jest configuration for {@link HappyDOMExtendedEnvironment}, creating native adapters inside the test worker.
 * @param configuration - Caller-owned configuration, which may be reused or frozen.
 * @returns The copied configuration and the default adapter owned by this environment, if one was needed.
 * @example const prepared = prepareEnvironment(configuration);
 */
export function prepareEnvironment(configuration: EnvironmentConfiguration): {
  configuration: EnvironmentConfiguration
  adapter: ExtendedCanvasAdapter | undefined
} {
  const project =
    'projectConfig' in configuration
      ? configuration.projectConfig
      : configuration
  const options = project.testEnvironmentOptions
  const suppliedSettings = options.settings
  if (
    suppliedSettings !== undefined &&
    suppliedSettings !== null &&
    typeof suppliedSettings !== 'object'
  ) {
    throw new TypeError('testEnvironmentOptions.settings must be an object.')
  }
  const settings = { enableImageFileLoading: true, ...suppliedSettings }
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
      'canvasAdapter must implement getContext, toDataURL, and toBlob. Jest configuration cannot serialize adapter instances; construct custom adapters inside an environment subclass.',
    )
  }
  // Explicit adapters (including null) belong to the caller; only the default instance is ours to dispose.
  const adapter =
    suppliedAdapter === undefined ? new ExtendedCanvasAdapter() : undefined
  const preparedProject = {
    ...project,
    testEnvironmentOptions: {
      ...options,
      settings: { ...settings, canvasAdapter: adapter ?? suppliedAdapter },
    },
  }
  return {
    configuration:
      'projectConfig' in configuration
        ? { ...configuration, projectConfig: preparedProject }
        : preparedProject,
    adapter,
  }
}
