// Jest has installed its assertion globals, but has not evaluated the consumer's tests yet.
expect(structuredClone({ ready: true })).toEqual({ ready: true });
expect(new CompositionEvent('compositionend', { data: 'あ' }).data).toBe('あ');
