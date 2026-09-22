import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setImmediate } from 'node:timers'

import { runFinalizer } from '../src/utils/run-finalizer.ts'

test('a finalizer whose cleanup throws still runs and does not abort the worker collecting the resource', () => {
  // Arrange
  let closed = false
  const close = () => {
    closed = true
    // A native handle collected after its context was disposed reports this.
    throw new Error('illegal access')
  }

  // Act
  assert.doesNotThrow(() => runFinalizer(close))

  // Assert
  assert.equal(closed, true)
})

test('a finalizer whose async cleanup rejects leaves no unhandled rejection behind', async () => {
  // Arrange
  const unhandled: unknown[] = []
  const record = (reason: unknown) => unhandled.push(reason)
  process.on('unhandledRejection', record)

  // Act
  runFinalizer(async () => {
    throw new Error('Video source was discarded.')
  })
  // Node reports an unhandled rejection only after the microtask queue drains.
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
  process.off('unhandledRejection', record)

  // Assert
  assert.deepEqual(unhandled, [])
})

test('a finalizer returning no cleanup value completes without touching the rejection path', () => {
  // Arrange
  let released = 0
  const release = () => {
    released += 1
  }

  // Act
  runFinalizer(release)
  runFinalizer(release)

  // Assert
  assert.equal(released, 2)
})
