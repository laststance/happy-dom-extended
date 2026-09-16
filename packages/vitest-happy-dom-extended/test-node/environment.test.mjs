import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ExtendedCanvasAdapter } from '@happy-dom-extended/compat'

import environment, { createHappyDomExtendedEnvironment } from '../src/index.ts'

/** Builds a sandbox `globalThis` stand-in so Node test globals are not replaced.
 * @returns A fresh object for {@link createHappyDomExtendedEnvironment} `setup`.
 * @example const sandbox = createSandbox()
 */
function createSandbox() {
  return Object.create(null)
}

test('Source environment exposes real Canvas before setup and preserves frozen caller options', async () => {
  // Arrange
  const settings = Object.freeze({ enableImageFileLoading: false })
  const options = Object.freeze({
    url: 'https://example.test/canvas',
    settings,
  })
  const sandbox = createSandbox()
  const result = await environment.setup(sandbox, options)
  try {
    // Act
    const canvas = sandbox.document.createElement('canvas')
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
    assert.equal(sandbox.location.href, 'https://example.test/canvas')
    assert.equal(sandbox.window.happyDOM.settings.enableImageFileLoading, false)
    assert.equal(Object.hasOwn(settings, 'canvasAdapter'), false)
  } finally {
    await result.teardown(sandbox)
  }
})

test('Named environmentOptions and happyDOM wrappers still configure the Window URL', async () => {
  // Arrange
  const sandbox = createSandbox()
  const result = await environment.setup(sandbox, {
    happyDOM: { url: 'https://example.test/happy-dom' },
    'happy-dom-extended': { url: 'https://example.test/named' },
  })
  try {
    // Assert
    assert.equal(sandbox.location.href, 'https://example.test/named')
  } finally {
    await result.teardown(sandbox)
  }
})

test('An explicit null adapter keeps upstream rendering disabled', async () => {
  // Arrange
  const sandbox = createSandbox()
  const result = await environment.setup(sandbox, {
    settings: { canvasAdapter: null },
  })
  try {
    // Act / Assert
    assert.equal(sandbox.window.happyDOM.settings.canvasAdapter, null)
    assert.equal(
      sandbox.document.createElement('canvas').getContext('2d'),
      null,
    )
  } finally {
    await result.teardown(sandbox)
  }
})

test('Invalid settings and serialized adapter objects fail before constructing a Window', async () => {
  // Arrange
  const sandbox = createSandbox()
  // Act / Assert
  await assert.rejects(() => environment.setup(sandbox, { settings: false }), {
    message: 'environmentOptions.settings must be an object.',
  })
  await assert.rejects(
    () => environment.setup(sandbox, { settings: { canvasAdapter: {} } }),
    {
      message:
        'canvasAdapter must implement getContext, toDataURL, and toBlob. Configuration cannot serialize adapter instances; construct custom adapters with createHappyDomExtendedEnvironment({ canvasAdapter }).',
    },
  )
})

test('structuredClone and postMessage throw the Window DOMException after populateGlobal', async () => {
  // Arrange
  const sandbox = createSandbox()
  const result = await environment.setup(sandbox, {})
  try {
    // Act / Assert
    assert.throws(() => sandbox.structuredClone(() => {}), (error) => {
      return (
        error instanceof sandbox.DOMException && error.name === 'DataCloneError'
      )
    })
    const channel = new sandbox.MessageChannel()
    assert.throws(() => channel.port1.postMessage(() => {}), (error) => {
      return (
        error instanceof sandbox.DOMException && error.name === 'DataCloneError'
      )
    })
  } finally {
    await result.teardown(sandbox)
  }
})

test('A populateGlobal write failure restores caller globals before reporting the error', async () => {
  // Arrange
  const sandbox = Object.create(null)
  const lockedEvent = function LockedEvent() {}
  Object.defineProperty(sandbox, 'Event', {
    configurable: false,
    writable: false,
    value: lockedEvent,
  })
  Object.defineProperty(sandbox, 'fetch', {
    configurable: true,
    writable: true,
    value: 'original-fetch',
  })
  // Act
  await assert.rejects(() => environment.setup(sandbox, {}))
  // Assert: partial populateGlobal writes must not leak a closed Window onto the caller.
  assert.equal(sandbox.fetch, 'original-fetch')
  assert.equal(sandbox.Event, lockedEvent)
  assert.equal(Object.hasOwn(sandbox, 'document'), false)
})

test('Factory-owned custom adapters retain identity and are not disposed by teardown', async () => {
  // Arrange
  let calls = 0
  let disposed = false
  const adapter = {
    getContext() {
      calls += 1
      return null
    },
    toDataURL() {
      return 'custom'
    },
    toBlob(_caller, callback) {
      callback(null)
    },
    dispose() {
      disposed = true
    },
  }
  const created = createHappyDomExtendedEnvironment({ canvasAdapter: adapter })
  const sandbox = createSandbox()
  const result = await created.setup(sandbox, {})
  // Act
  assert.equal(sandbox.document.createElement('canvas').getContext('2d'), null)
  assert.equal(sandbox.window.happyDOM.settings.canvasAdapter, adapter)
  await result.teardown(sandbox)
  // Assert
  assert.equal(calls, 1)
  assert.equal(disposed, false)
})

test('Factory rejects a serialized empty adapter object', async () => {
  // Arrange
  const created = createHappyDomExtendedEnvironment({ canvasAdapter: {} })
  const sandbox = createSandbox()
  // Act / Assert
  await assert.rejects(
    () => created.setup(sandbox, {}),
    /cannot serialize adapter instances/,
  )
})

test('setupVM exposes Canvas on the VM context and teardown drains toBlob', async () => {
  // Arrange
  const vm = await environment.setupVM({
    url: 'https://example.test/vm',
  })
  try {
    const window = vm.getVmContext()
    const canvas = window.document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const drawing = canvas.getContext('2d')
    drawing.fillStyle = 'blue'
    drawing.fillRect(0, 0, 1, 1)
    let completed = false
    canvas.toBlob((blob) => {
      assert.ok(blob)
      completed = true
    })
    // Act
    await vm.teardown()
    // Assert
    assert.equal(completed, true)
    assert.equal(Object.hasOwn(canvas, 'getContext'), false)
  } catch (error) {
    await vm.teardown().catch(() => {})
    throw error
  }
})

test('teardown restores overwritten Node globals and a second setup paints again', async () => {
  // Arrange
  const originalClone = () => 'original'
  const sandbox = {
    structuredClone: originalClone,
    Blob: function OriginalBlob() {},
  }
  const first = await environment.setup(sandbox, {})
  assert.notEqual(sandbox.structuredClone, originalClone)
  const firstCanvas = sandbox.document.createElement('canvas')
  firstCanvas.width = 1
  firstCanvas.height = 1
  firstCanvas.toBlob(() => {
    throw new Error('Image consumer failed')
  })
  // Act
  await assert.rejects(first.teardown(sandbox), /Image consumer failed/)
  // Assert
  assert.equal(sandbox.structuredClone, originalClone)
  assert.equal(typeof sandbox.document, 'undefined')
  const second = await environment.setup(sandbox, {})
  try {
    const canvas = sandbox.document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const drawing = canvas.getContext('2d')
    drawing.fillStyle = 'red'
    drawing.fillRect(0, 0, 1, 1)
    assert.deepEqual(
      [...drawing.getImageData(0, 0, 1, 1).data],
      [255, 0, 0, 255],
    )
  } finally {
    await second.teardown(sandbox)
  }
})

test('globalThis.structuredClone transfers a canvas the same as window.structuredClone', async () => {
  // Arrange
  const sandbox = createSandbox()
  const result = await environment.setup(sandbox, {})
  try {
    const source = new sandbox.OffscreenCanvas(1, 1)
    // Act
    const receiver = sandbox.structuredClone(source, { transfer: [source] })
    const drawing = receiver.getContext('2d')
    drawing.fillStyle = 'red'
    drawing.fillRect(0, 0, 1, 1)
    // Assert
    assert.equal(sandbox.structuredClone, sandbox.window.structuredClone)
    assert.ok(receiver instanceof sandbox.OffscreenCanvas)
    assert.equal(source.width, 0)
    assert.deepEqual(
      [...drawing.getImageData(0, 0, 1, 1).data],
      [255, 0, 0, 255],
    )
  } finally {
    await result.teardown(sandbox)
  }
})

test('Overlapping environments keep Canvas after one teardown', async () => {
  // Arrange
  const firstSandbox = createSandbox()
  const secondSandbox = createSandbox()
  const first = await environment.setup(firstSandbox, {})
  const second = await environment.setup(secondSandbox, {})
  try {
    const firstCanvas = firstSandbox.document.createElement('canvas')
    firstCanvas.width = 1
    firstCanvas.height = 1
    const firstDrawing = firstCanvas.getContext('2d')
    firstDrawing.fillStyle = 'red'
    firstDrawing.fillRect(0, 0, 1, 1)
    const secondCanvas = secondSandbox.document.createElement('canvas')
    secondCanvas.width = 1
    secondCanvas.height = 1
    const secondDrawing = secondCanvas.getContext('2d')
    secondDrawing.fillStyle = 'blue'
    secondDrawing.fillRect(0, 0, 1, 1)
    // Act
    await first.teardown(firstSandbox)
    // Assert
    assert.deepEqual(
      [...secondDrawing.getImageData(0, 0, 1, 1).data],
      [0, 0, 255, 255],
    )
    const blob = new secondSandbox.Blob(['\uFEFFA'])
    assert.equal(await blob.text(), 'A')
  } finally {
    await second.teardown(secondSandbox)
  }
})

test('File-path environmentOptions and a non-string URL still construct a usable Window', async () => {
  // Arrange
  const sandbox = createSandbox()
  const result = await environment.setup(sandbox, {
    '/virtual/vitest-environment-happy-dom-extended': {
      url: 'https://example.test/file-path',
    },
    url: 123,
    'happy-dom-extended': false,
  })
  try {
    // Assert: nested file-path options win over a non-string top-level url; a non-record named wrapper is ignored.
    assert.equal(sandbox.location.href, 'https://example.test/file-path')
  } finally {
    await result.teardown(sandbox)
  }
})

test('Non-record environmentOptions still open the default localhost Window', async () => {
  // Arrange
  const sandbox = createSandbox()
  const result = await environment.setup(sandbox, null)
  try {
    // Assert
    assert.equal(sandbox.location.href, 'http://localhost:3000/')
  } finally {
    await result.teardown(sandbox)
  }
})

test('File-path width and height options still size the Window', async () => {
  // Arrange
  const sandbox = createSandbox()
  const result = await environment.setup(sandbox, {
    '/virtual/vitest-environment-happy-dom-extended': {
      width: 321,
      height: 123,
    },
  })
  try {
    // Assert
    assert.equal(sandbox.innerWidth, 321)
    assert.equal(sandbox.innerHeight, 123)
  } finally {
    await result.teardown(sandbox)
  }
})

test('File-path settings-only options still disable image file loading', async () => {
  // Arrange
  const sandbox = createSandbox()
  const result = await environment.setup(sandbox, {
    '/virtual/vitest-environment-happy-dom-extended': {
      settings: { enableImageFileLoading: false },
    },
  })
  try {
    // Assert
    assert.equal(sandbox.window.happyDOM.settings.enableImageFileLoading, false)
    assert.equal(sandbox.location.href, 'http://localhost:3000/')
  } finally {
    await result.teardown(sandbox)
  }
})

test('A factory adapter does not replace invalid non-object settings', async () => {
  // Arrange
  const created = createHappyDomExtendedEnvironment({
    canvasAdapter: {
      getContext() {
        return null
      },
      toDataURL() {
        return ''
      },
      toBlob(_caller, callback) {
        callback(null)
      },
    },
  })
  const sandbox = createSandbox()
  // Act / Assert: merge is skipped so the historical settings TypeError still wins.
  await assert.rejects(() => created.setup(sandbox, { settings: false }), {
    message: 'environmentOptions.settings must be an object.',
  })
})

test('Factory-owned adapters win over a serialized settings.canvasAdapter object', async () => {
  // Arrange
  let calls = 0
  const adapter = {
    getContext() {
      calls += 1
      return null
    },
    toDataURL() {
      return 'custom'
    },
    toBlob(_caller, callback) {
      callback(null)
    },
  }
  const created = createHappyDomExtendedEnvironment({ canvasAdapter: adapter })
  const sandbox = createSandbox()
  // Act: an empty serialized object would throw if the factory override did not win.
  const result = await created.setup(sandbox, {
    settings: { canvasAdapter: {} },
  })
  try {
    // Assert
    assert.equal(
      sandbox.document.createElement('canvas').getContext('2d'),
      null,
    )
    assert.equal(sandbox.window.happyDOM.settings.canvasAdapter, adapter)
    assert.equal(calls, 1)
  } finally {
    await result.teardown(sandbox)
  }
})

test('setupVM exposes Node Buffer on the VM context Window', async () => {
  // Arrange
  const vm = await environment.setupVM({})
  try {
    // Act
    const window = vm.getVmContext()
    // Assert
    assert.equal(window.Buffer, Buffer)
    assert.equal(window.location.href, 'http://localhost:3000/')
  } finally {
    await vm.teardown()
  }
})

test('Failed Web API installation still closes the Window when close itself rejects', async (context) => {
  // Arrange
  const installationError = new Error('Web API installation failed')
  const cleanupError = new Error('Window close failed')
  const adapterDispose = context.mock.method(
    ExtendedCanvasAdapter.prototype,
    'dispose',
  )
  const defineProperty = Object.defineProperty
  context.mock.method(Object, 'defineProperty', (target, key, descriptor) => {
    if (key === 'MessagePort' && target.happyDOM) {
      context.mock.method(target.happyDOM, 'close', async () => {
        throw cleanupError
      })
      throw installationError
    }
    return defineProperty(target, key, descriptor)
  })
  const sandbox = createSandbox()
  // Act / Assert
  await assert.rejects(
    () => environment.setup(sandbox, {}),
    (error) => {
      assert.equal(error instanceof AggregateError, true)
      assert.deepEqual(error.errors, [installationError, cleanupError])
      assert.equal(error.cause, installationError)
      return true
    },
  )
  assert.equal(adapterDispose.mock.callCount(), 1)
})

test('Failed Web API installation closes the Window and disposes the owned adapter', async (context) => {
  // Arrange
  const installationError = new Error('Web API installation failed')
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
  const sandbox = createSandbox()
  // Act / Assert
  await assert.rejects(
    () => environment.setup(sandbox, {}),
    (error) => error === installationError,
  )
  assert.equal(adapterDispose.mock.callCount(), 1)
  assert.equal(close.mock.callCount(), 1)
  await close.mock.calls[0].result
  assert.equal(Object.hasOwn(failedWindow, 'structuredClone'), false)
})

test('setupVM teardown can run twice and still drains pending toBlob output', async () => {
  // Arrange
  const vm = await environment.setupVM({})
  const window = vm.getVmContext()
  const canvas = window.document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  let completed = false
  canvas.toBlob((blob) => {
    assert.ok(blob)
    completed = true
  })
  // Act
  await Promise.all([vm.teardown(), vm.teardown()])
  // Assert
  assert.equal(completed, true)
  assert.equal(Object.hasOwn(canvas, 'getContext'), false)
})

test('Window close failure during teardown still restores overwritten Node globals', async () => {
  // Arrange
  const closeError = new Error('close failed')
  const originalClone = () => 'original'
  const sandbox = { structuredClone: originalClone }
  const result = await environment.setup(sandbox, {})
  const close = sandbox.window.happyDOM.close.bind(sandbox.window.happyDOM)
  sandbox.window.happyDOM.close = async () => {
    await close()
    throw closeError
  }
  // Act
  await assert.rejects(
    result.teardown(sandbox),
    (error) => error === closeError,
  )
  // Assert
  assert.equal(sandbox.structuredClone, originalClone)
  assert.equal(typeof sandbox.document, 'undefined')
})

test('Drain failure still closes the Window and restores overwritten Node globals', async (context) => {
  // Arrange
  const drainError = new Error('drain failed')
  context.mock.method(ExtendedCanvasAdapter.prototype, 'drain', async () => {
    throw drainError
  })
  const originalClone = () => 'original'
  const sandbox = {
    structuredClone: originalClone,
  }
  const result = await environment.setup(sandbox, {})
  assert.notEqual(sandbox.structuredClone, originalClone)
  // Act
  await assert.rejects(
    result.teardown(sandbox),
    (error) => error === drainError,
  )
  // Assert
  assert.equal(sandbox.structuredClone, originalClone)
  assert.equal(typeof sandbox.document, 'undefined')
})
