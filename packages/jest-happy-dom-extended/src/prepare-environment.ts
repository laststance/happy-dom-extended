import type HappyDOMEnvironment from '@happy-dom/jest-environment'
import {
  prepareOwnedCanvasSettings,
  type ExtendedCanvasAdapter,
} from '@happy-dom-extended/compat'

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
  const { settings, adapter } = prepareOwnedCanvasSettings(options.settings, {
    settings: 'testEnvironmentOptions.settings must be an object.',
    adapter:
      'canvasAdapter must implement getContext, toDataURL, and toBlob. Jest configuration cannot serialize adapter instances; construct custom adapters inside an environment subclass.',
  })
  const preparedProject = {
    ...project,
    testEnvironmentOptions: {
      ...options,
      settings,
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
