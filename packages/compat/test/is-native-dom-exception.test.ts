import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isNativeDOMException } from '../src/utils/is-native-dom-exception.ts'

test('isNativeDOMException accepts a native DOMException and rejects other values', () => {
  // Arrange
  const native = new DOMException('The object could not be cloned.', 'DataCloneError')
  // Act / Assert
  assert.equal(isNativeDOMException(native), true)
  assert.equal(isNativeDOMException(new TypeError('no')), false)
  assert.equal(isNativeDOMException(null), false)
  assert.equal(isNativeDOMException({ name: 'DataCloneError' }), false)
})

test('isNativeDOMException still recognizes a native exception after a runner replaces global DOMException', () => {
  // Arrange
  const native = new DOMException('The object could not be cloned.', 'DataCloneError')
  const original = globalThis.DOMException
  class WindowDOMException extends Error {
    constructor(message?: string, name?: string) {
      super(message)
      this.name = name ?? 'Error'
    }
  }
  // Act
  globalThis.DOMException = WindowDOMException as typeof DOMException
  try {
    // Assert: instanceof the replacement constructor fails; the captured native constructor still matches.
    assert.equal(native instanceof globalThis.DOMException, false)
    assert.equal(isNativeDOMException(native), true)
  } finally {
    globalThis.DOMException = original
  }
})
