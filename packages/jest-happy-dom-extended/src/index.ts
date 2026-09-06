import { createRequire } from 'node:module';

import type HappyDOMEnvironment from '@happy-dom/jest-environment';
import { installCompatibility } from '@happy-dom-extended/compat';
import type { DisposeCompatibility } from '@happy-dom-extended/compat';

// Load the upstream ESM namespace consistently from both npm entry formats.
const HappyDOMBase: typeof HappyDOMEnvironment = createRequire(import.meta.url)(
  '@happy-dom/jest-environment',
).default;

/** Extends Jest's Happy DOM environment before application setup and releases every extension at teardown.
 * @example export default { testEnvironment: 'jest-happy-dom-extended' };
 */
export default class HappyDOMExtendedEnvironment extends HappyDOMBase {
  #disposeCompatibility: DisposeCompatibility | undefined;

  /** Installs Web API extensions when Jest initializes a test file.
   * @returns A promise that resolves before application setup executes.
   * @example await environment.setup();
   */
  override async setup(): Promise<void> {
    await super.setup();
    this.#disposeCompatibility = await installCompatibility(this.window);
  }

  /** Closes native resources and restores compatibility patches when Jest releases a test file.
   * @returns A promise that resolves after Happy DOM is disposed.
   * @example await environment.teardown();
   */
  override async teardown(): Promise<void> {
    try {
      await super.teardown();
    } finally {
      this.#disposeCompatibility?.();
      this.#disposeCompatibility = undefined;
    }
  }
}
