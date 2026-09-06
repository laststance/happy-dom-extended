import type { Window } from 'happy-dom'

import type { DisposeCompatibility } from './types.ts'
import { replaceProperty } from './utils/replace-property.ts'

type CompositionEventOptions = NonNullable<
  ConstructorParameters<Window['UIEvent']>[1]
> & {
  data?: string
}

/** Adds the IME composition payload when Happy DOM's constructor omits composition data.
 * @param window - Environment used by editor and input-method tests.
 * @param restorers - Shared teardown registry, updated immediately after each mutation.
 * @returns Nothing; registers cleanup for the runner.
 * @example new window.CompositionEvent('compositionend', { data: 'あ' }).data // 'あ'
 */
export function installCompositionEvent(
  window: Window,
  restorers: DisposeCompatibility[],
): void {
  const probe = Reflect.construct(window.CompositionEvent, [
    'compositionend',
    { data: 'probe' },
  ])
  if (Reflect.get(probe, 'data') === 'probe') return

  /** Preserves Happy DOM event dispatch while carrying the composed text. */
  class ExtendedCompositionEvent extends window.UIEvent {
    #data: string

    /** Creates a composition event when an input-method consumer supplies composed text.
     * @param type - Composition event name.
     * @param eventInit - Standard UI event flags and composition text.
     * @example new ExtendedCompositionEvent('compositionend', { data: 'あ' });
     */
    constructor(type: string, eventInit: CompositionEventOptions = {}) {
      super(type, eventInit)
      this.#data = eventInit?.data === undefined ? '' : String(eventInit.data)
    }

    /** Exposes the composed text without permitting consumers to overwrite it.
     * @returns The event's text payload, defaulting to an empty string.
     * @example event.data // 'あ'
     */
    get data(): string {
      return this.#data
    }
  }
  restorers.push(
    replaceProperty(window, 'CompositionEvent', {
      value: ExtendedCompositionEvent,
      writable: true,
    }),
  )
}
