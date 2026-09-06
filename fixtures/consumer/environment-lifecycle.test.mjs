import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

import ESMEnvironment from 'jest-happy-dom-extended'

const require = createRequire(import.meta.url)
const CommonJSEnvironment = require('jest-happy-dom-extended')
const configuration = {
  globalConfig: {},
  projectConfig: {
    globals: {},
    testEnvironmentOptions: {},
    fakeTimers: {},
    rootDir: process.cwd(),
  },
}

for (const { label, constructors } of [
  { label: 'ESM first', constructors: [ESMEnvironment, CommonJSEnvironment] },
  {
    label: 'CommonJS first',
    constructors: [CommonJSEnvironment, ESMEnvironment],
  },
]) {
  for (const closingIndex of [0, 1]) {
    test(`Canvas and Blob readers survive mixed module teardown (${label}, close environment ${closingIndex + 1})`, async () => {
      // Arrange
      const activeEnvironments = []
      try {
        for (const Environment of constructors) {
          activeEnvironments.push(new Environment(configuration, { console }))
        }
        const canvases = activeEnvironments.map((environment) => {
          const canvas = environment.window.document.createElement('canvas')
          canvas.width = 1
          canvas.height = 1
          const drawing = canvas.getContext('2d')
          drawing.fillStyle = 'red'
          drawing.fillRect(0, 0, 1, 1)
          return canvas
        })

        // Act
        const [closingEnvironment] = activeEnvironments.splice(closingIndex, 1)
        await closingEnvironment.teardown()
        const [remainingEnvironment] = activeEnvironments
        const blob = new remainingEnvironment.window.Blob(['\uFEFFA'])
        const file = new remainingEnvironment.window.File(
          ['\uFEFFB'],
          'bom.txt',
        )

        // Assert
        assert.equal(await blob.text(), 'A')
        assert.deepEqual([...(await blob.bytes())], [239, 187, 191, 65])
        assert.equal(await file.text(), 'B')
        assert.deepEqual([...(await file.bytes())], [239, 187, 191, 66])
        const remainingCanvas = canvases[closingIndex === 0 ? 1 : 0]
        const drawing = remainingCanvas.getContext('2d')
        assert.deepEqual(
          [...drawing.getImageData(0, 0, 1, 1).data],
          [255, 0, 0, 255],
        )
        remainingCanvas.width = 2
        drawing.fillStyle = 'blue'
        drawing.fillRect(1, 0, 1, 1)
        assert.deepEqual(
          [...drawing.getImageData(1, 0, 1, 1).data],
          [0, 0, 255, 255],
        )
        const blobImage = await new Promise((resolve) =>
          remainingCanvas.toBlob(resolve),
        )
        assert.ok(blobImage instanceof remainingEnvironment.window.Blob)
      } finally {
        for (const environment of activeEnvironments) {
          await environment.teardown()
        }
      }
    })
  }
}

test(
  'Environment teardown drains Canvas output without waiting for a user interval',
  { timeout: 2000 },
  async (context) => {
    // Arrange
    const environment = new ESMEnvironment(configuration, { console })
    const window = environment.window
    // A regressed teardown must still fail promptly instead of keeping the runner alive.
    context.after(async () => window.happyDOM.close())
    window.setInterval(() => {}, 50)
    const canvas = window.document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    let completed = false
    canvas.toBlob((blob) => {
      assert.ok(blob)
      completed = true
    })
    // Act
    const teardown = environment.teardown()
    await Promise.all([teardown, environment.teardown()])
    // Assert
    assert.equal(completed, true)
    assert.equal(Object.hasOwn(canvas, 'getContext'), false)
  },
)

test('Environment construction preserves frozen configuration and an explicit image-loading opt-out', async () => {
  // Arrange
  const settings = Object.freeze({ enableImageFileLoading: false })
  const options = Object.freeze({
    url: 'https://example.test/canvas',
    settings,
  })
  const project = Object.freeze({
    ...configuration.projectConfig,
    testEnvironmentOptions: options,
  })
  const config = Object.freeze({ ...configuration, projectConfig: project })
  // Act
  const environment = new ESMEnvironment(config, { console })
  try {
    // Assert
    assert.equal(
      environment.window.location.href,
      'https://example.test/canvas',
    )
    assert.equal(
      environment.window.happyDOM.settings.enableImageFileLoading,
      false,
    )
    assert.equal(Object.hasOwn(settings, 'canvasAdapter'), false)
    assert.ok(
      environment.window.document.createElement('canvas').getContext('2d'),
    )
  } finally {
    await environment.teardown()
  }
})

test('Programmatic custom adapters retain identity and are not disposed by the environment', async () => {
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
  const config = {
    ...configuration,
    projectConfig: {
      ...configuration.projectConfig,
      testEnvironmentOptions: { settings: { canvasAdapter: adapter } },
    },
  }
  const environment = new ESMEnvironment(config, { console })
  // Act
  assert.equal(
    environment.window.document.createElement('canvas').getContext('2d'),
    null,
  )
  assert.equal(environment.window.happyDOM.settings.canvasAdapter, adapter)
  await environment.teardown()
  // Assert
  assert.equal(calls, 1)
  assert.equal(disposed, false)
})

test('Invalid serialized adapters fail with actionable configuration guidance', () => {
  // Arrange
  const config = {
    ...configuration,
    projectConfig: {
      ...configuration.projectConfig,
      testEnvironmentOptions: { settings: { canvasAdapter: {} } },
    },
  }
  // Act / Assert
  assert.throws(
    () => new ESMEnvironment(config, { console }),
    /Jest configuration cannot serialize adapter instances/,
  )
})

test('Environment teardown restores compatibility after a Canvas callback throws', async () => {
  // Arrange
  const environment = new ESMEnvironment(configuration, { console })
  const window = environment.window
  const patchedComposition = window.CompositionEvent
  const canvas = window.document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const originalError = new Error('Image consumer failed')
  canvas.toBlob(() => {
    throw originalError
  })
  // Act / Assert
  await assert.rejects(
    environment.teardown(),
    (error) => error === originalError,
  )
  assert.notEqual(window.CompositionEvent, patchedComposition)
})

test('A failing upstream teardown still restores Canvas instance hooks and other Web APIs', async (context) => {
  // Arrange
  const environment = new ESMEnvironment(configuration, { console })
  const window = environment.window
  const patchedComposition = window.CompositionEvent
  const canvas = window.document.createElement('canvas')
  canvas.getContext('2d')
  const upstream = Object.getPrototypeOf(ESMEnvironment.prototype)
  const failure = new Error('Upstream teardown failed')
  context.mock.method(upstream, 'teardown', async () => {
    throw failure
  })
  try {
    // Act / Assert
    await assert.rejects(environment.teardown(), (error) => error === failure)
    assert.notEqual(window.CompositionEvent, patchedComposition)
    assert.equal(
      Object.getOwnPropertySymbols(canvas).some(
        (symbol) => symbol.description === 'onSetAttribute',
      ),
      false,
    )
  } finally {
    await window.happyDOM.close()
  }
})
