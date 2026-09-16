import { expect } from 'vitest'

// Vitest has installed its assertion API, but has not evaluated the consumer's tests yet.
expect(structuredClone({ ready: true })).toEqual({ ready: true })
expect(new CompositionEvent('compositionend', { data: 'あ' }).data).toBe('あ')
