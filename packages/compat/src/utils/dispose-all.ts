import type { DisposeCompatibility } from '../types.ts'

/** Runs every registered restoration for an installer, preserving original failures when cleanup also fails.
 * @param restorers - Consumed in reverse installation order.
 * @param errors - Earlier failures to retain before any cleanup errors.
 * @returns Nothing; throws the original error or an aggregate after attempting every restoration.
 * @example disposeAll(restorers, [initializationError]);
 */
export function disposeAll(
  restorers: DisposeCompatibility[],
  errors: unknown[] = [],
): void {
  for (const restore of restorers.splice(0).reverse()) {
    try {
      restore()
    } catch (error) {
      // A failed property restoration must not strand other native resources.
      errors.push(error)
    }
  }
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) {
    throw new AggregateError(errors, 'Compatibility cleanup failed.', {
      cause: errors[0],
    })
  }
}
