import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

import { ExtendedCanvasAdapter } from '@happy-dom-extended/compat'

import Environment from '../src/index.ts'

const project = {
  globals: {},
  fakeTimers: {},
  rootDir: process.cwd(),
  testEnvironmentOptions: {},
}

test('Source environment exposes real Canvas before setup and preserves frozen caller options', async () => {
  // Arrange
  const settings = Object.freeze({ enableImageFileLoading: false })
  const projectConfig = Object.freeze({
    ...project,
    testEnvironmentOptions: Object.freeze({ settings }),
  })
  const configuration = Object.freeze({ globalConfig: {}, projectConfig })
  const environment = new Environment(configuration, { console })
  try {
    // Act
    const canvas = environment.window.document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const drawing = canvas.getContext('2d')
    drawing.fillStyle = 'red'
    drawing.fillRect(0, 0, 1, 1)
    // Assert
    assert.deepEqual(
      [...drawing.getImageData(0, 0, 1, 1).data],
      [255, 0, 0, 255],
    )
    assert.equal(
      environment.window.happyDOM.settings.enableImageFileLoading,
      false,
    )
    assert.equal(Object.hasOwn(settings, 'canvasAdapter'), false)
  } finally {
    await environment.teardown()
  }
})

test('An explicit null adapter keeps upstream rendering disabled', async () => {
  // Arrange
  const environment = new Environment(
    {
      ...project,
      testEnvironmentOptions: { settings: { canvasAdapter: null } },
    },
    { console },
  )
  try {
    // Act / Assert
    assert.equal(environment.window.happyDOM.settings.canvasAdapter, null)
    assert.equal(
      environment.window.document.createElement('canvas').getContext('2d'),
      null,
    )
  } finally {
    await environment.teardown()
  }
})

test('Invalid settings and serialized adapter objects fail before constructing a Window', () => {
  // Arrange / Act / Assert
  assert.throws(
    () =>
      new Environment(
        { ...project, testEnvironmentOptions: { settings: false } },
        { console },
      ),
    /settings must be an object/,
  )
  assert.throws(
    () =>
      new Environment(
        {
          ...project,
          testEnvironmentOptions: { settings: { canvasAdapter: {} } },
        },
        { console },
      ),
    /cannot serialize adapter instances/,
  )
})

test('Rejected upstream Jest options release the newly owned Canvas adapter', (context) => {
  // Arrange
  const dispose = context.mock.method(
    ExtendedCanvasAdapter.prototype,
    'dispose',
  )

  // Act / Assert
  assert.throws(
    () =>
      new Environment(
        {
          ...project,
          testEnvironmentOptions: { customExportConditions: [false] },
        },
        { console },
      ),
    /not an array of strings/,
  )
  assert.equal(dispose.mock.callCount(), 1)
})

test('Failed Web API installation closes the Window and attempts every cleanup while retaining both errors', async (context) => {
  // Arrange
  const require = createRequire(import.meta.url)
  const upstreamRequire = createRequire(
    require.resolve('@happy-dom/jest-environment'),
  )
  const { LegacyFakeTimers, ModernFakeTimers } =
    upstreamRequire('@jest/fake-timers')
  const installationError = new Error('Web API installation failed')
  const cleanupError = new Error('Legacy timers cleanup failed')
  const originalDispose = LegacyFakeTimers.prototype.dispose
  const legacyDispose = context.mock.method(
    LegacyFakeTimers.prototype,
    'dispose',
    function () {
      originalDispose.call(this)
      throw cleanupError
    },
  )
  const modernDispose = context.mock.method(
    ModernFakeTimers.prototype,
    'dispose',
  )
  const adapterDispose = context.mock.method(
    ExtendedCanvasAdapter.prototype,
    'dispose',
  )
  const defineProperty = Object.defineProperty
  let failedWindow
  let close
  context.mock.method(Object, 'defineProperty', (target, key, descriptor) => {
    // Fail after earlier globals have been installed, as a locked browser API would.
    if (key === 'MessagePort' && target.happyDOM) {
      failedWindow = target
      close = context.mock.method(target.happyDOM, 'close')
      throw installationError
    }
    return defineProperty(target, key, descriptor)
  })

  // Act / Assert
  assert.throws(
    () => new Environment(project, { console }),
    (error) => {
      assert.equal(error instanceof AggregateError, true)
      assert.deepEqual(error.errors, [installationError, cleanupError])
      assert.equal(error.cause, installationError)
      return true
    },
  )
  assert.equal(legacyDispose.mock.callCount(), 1)
  assert.equal(modernDispose.mock.callCount(), 1)
  assert.equal(adapterDispose.mock.callCount(), 1)
  assert.equal(close.mock.callCount(), 1)
  await close.mock.calls[0].result
  assert.equal(Object.hasOwn(failedWindow, 'structuredClone'), false)
  assert.equal(Object.hasOwn(failedWindow, 'BroadcastChannel'), false)
})
