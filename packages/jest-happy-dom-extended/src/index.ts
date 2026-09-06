import { createRequire } from 'node:module'

import type HappyDOMEnvironment from '@happy-dom/jest-environment'
import { installCompatibility } from '@happy-dom-extended/compat'
import type { DisposeCompatibility } from '@happy-dom-extended/compat'

// Load the upstream ESM namespace consistently from both npm entry formats.
const HappyDOMBase: typeof HappyDOMEnvironment = createRequire(import.meta.url)(
  '@happy-dom/jest-environment',
).default

/** Extends Jest's Happy DOM environment before application setup and releases every extension at teardown.
 * @example export default { testEnvironment: 'jest-happy-dom-extended' };
 */
export default class HappyDOMExtendedEnvironment extends HappyDOMBase {
  #disposeCompatibility: DisposeCompatibility | undefined

  /** Installs Web APIs when Jest constructs the environment, before it evaluates application setup modules.
   * @param argumentsList - Upstream Jest configuration and environment context.
   * @example new HappyDOMExtendedEnvironment(config, context);
   */
  constructor(...argumentsList: ConstructorParameters<typeof HappyDOMBase>) {
    super(...argumentsList)
    try {
      this.#disposeCompatibility = installCompatibility(this.window)
    } catch (error) {
      // Jest cannot tear down an environment whose constructor failed.
      this.fakeTimers?.dispose()
      this.fakeTimersModern?.dispose()
      void this.window.happyDOM.close().catch((cleanupError: unknown) => {
        this.window.console.error(
          'Environment cleanup failed:',
          String(cleanupError),
        )
      })
      throw error
    }
  }

  /** Closes native resources and restores compatibility patches when Jest releases a test file.
   * @returns A promise that resolves after Happy DOM is disposed.
   * @example await environment.teardown();
   */
  override async teardown(): Promise<void> {
    try {
      await super.teardown()
    } finally {
      this.#disposeCompatibility?.()
      this.#disposeCompatibility = undefined
    }
  }
}
