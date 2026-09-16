import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isNativeMessageEvent } from '../src/utils/is-native-message-event.ts'

test('isNativeMessageEvent accepts native and tagged MessageEvents and rejects other values', () => {
  // Arrange
  const native = new MessageEvent('message', { data: { count: 3 } })
  const tagged = {
    [Symbol.toStringTag]: 'MessageEvent',
    data: { count: 3 },
  }
  // Act / Assert
  assert.equal(isNativeMessageEvent(native), true)
  assert.equal(Object.prototype.toString.call(tagged), '[object MessageEvent]')
  assert.equal(isNativeMessageEvent(tagged), true)
  assert.equal(isNativeMessageEvent(null), false)
  assert.equal(isNativeMessageEvent(undefined), false)
  assert.equal(isNativeMessageEvent('message'), false)
  assert.equal(isNativeMessageEvent({ data: { count: 3 } }), false)
})

test('isNativeMessageEvent still recognizes a native event after a runner replaces global MessageEvent', () => {
  // Arrange
  const native = new MessageEvent('message', { data: 'ready' })
  const original = globalThis.MessageEvent
  class WindowMessageEvent extends Event {
    data = null
  }
  // Act
  globalThis.MessageEvent = WindowMessageEvent as typeof MessageEvent
  try {
    // Assert: instanceof the replacement constructor fails; the captured native constructor still matches.
    assert.equal(native instanceof globalThis.MessageEvent, false)
    assert.equal(isNativeMessageEvent(native), true)
  } finally {
    globalThis.MessageEvent = original
  }
})
