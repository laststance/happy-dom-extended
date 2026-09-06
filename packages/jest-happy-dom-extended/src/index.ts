import { createRequire } from 'node:module'

import type HappyDOMEnvironment from '@happy-dom/jest-environment'
import { disposeAll, installCompatibility } from '@happy-dom-extended/compat'
import type {
  DisposeCompatibility,
  ExtendedCanvasAdapter,
} from '@happy-dom-extended/compat'

import { prepareEnvironment } from './prepare-environment.ts'

// Load the upstream ESM namespace consistently from both npm entry formats.
const HappyDOMBase: typeof HappyDOMEnvironment = createRequire(import.meta.url)(
  '@happy-dom/jest-environment',
).default

/** Extends Jest's Happy DOM environment before application setup and releases every extension at teardown.
 * @example export default { testEnvironment: 'jest-happy-dom-extended' };
 */
export default class HappyDOMExtendedEnvironment extends HappyDOMBase {
  #disposeCompatibility: DisposeCompatibility | undefined
  #canvasAdapter: ExtendedCanvasAdapter | undefined
  #teardown: Promise<void> | undefined

  /** Installs Web APIs when Jest constructs the environment, before it evaluates application setup modules.
   * @param argumentsList - Upstream Jest configuration and environment context.
   * @example new HappyDOMExtendedEnvironment(config, context);
   */
  constructor(...argumentsList: ConstructorParameters<typeof HappyDOMBase>) {
    const [configuration, context] = argumentsList
    const prepared = prepareEnvironment(configuration)
    try {
      super(prepared.configuration, context)
    } catch (error) {
      disposeAll([() => prepared.adapter?.dispose()], [error])
      throw error
    }
    this.#canvasAdapter = prepared.adapter
    try {
      this.#disposeCompatibility = installCompatibility(this.window)
    } catch (error) {
      // Jest cannot tear down an environment whose constructor failed.
      void this.window.happyDOM.close().catch((cleanupError: unknown) => {
        this.window.console.error(
          'Environment cleanup failed:',
          String(cleanupError),
        )
      })
      disposeAll(
        [
          () => prepared.adapter?.dispose(),
          () => this.fakeTimers?.dispose(),
          () => this.fakeTimersModern?.dispose(),
        ],
        [error],
      )
      throw error
    }
  }

  /** Closes native resources and restores compatibility patches when Jest releases a test file.
   * @returns A promise that resolves after Happy DOM is disposed.
   * @example await environment.teardown();
   */
  override async teardown(): Promise<void> {
    return (this.#teardown ??= this.#close())
  }

  /** Drains Canvas output before closing the Window and attempts all restorations even if an earlier step fails.
   * @returns A promise that reports original and cleanup failures after resources are released.
   * @example await this.#close();
   */
  async #close(): Promise<void> {
    const errors: unknown[] = []
    try {
      await this.#canvasAdapter?.drain()
    } catch (error) {
      errors.push(error)
    }
    try {
      await super.teardown()
    } catch (error) {
      errors.push(error)
    }
    const disposeCompatibility = this.#disposeCompatibility
    const adapter = this.#canvasAdapter
    this.#disposeCompatibility = undefined
    this.#canvasAdapter = undefined
    disposeAll(
      [() => disposeCompatibility?.(), () => adapter?.dispose()],
      errors,
    )
  }
}
