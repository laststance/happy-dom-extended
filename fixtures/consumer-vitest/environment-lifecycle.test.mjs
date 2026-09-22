import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'

import Environment, {
  createHappyDomExtendedEnvironment,
} from 'vitest-environment-happy-dom-extended'

const require = createRequire(import.meta.url)

/** Builds a sandbox `globalThis` stand-in so Node test globals are not replaced.
 * @returns A fresh object for {@link createHappyDomExtendedEnvironment} `setup`.
 * @example const sandbox = createSandbox()
 */
function createSandbox() {
  return Object.create(null)
}

test('Canvas accepts its environment inputs and rejects constructors from a separate Happy DOM module copy', async () => {
  // Arrange: Node caches distinct module URLs separately, even when their installed version matches.
  const packageRequire = createRequire(
    require.resolve('vitest-environment-happy-dom-extended/package.json'),
  )
  const happyDOMEntry = pathToFileURL(packageRequire.resolve('happy-dom'))
  const { default: ForeignBlob } = await import(
    new URL('./file/Blob.js?separate-copy', happyDOMEntry).href
  )
  const { default: ForeignImageData } = await import(
    new URL('./canvas/ImageData.js?separate-copy', happyDOMEntry).href
  )
  const sandbox = createSandbox()
  const result = await Environment.setup(sandbox, {})
  const bitmaps = []
  try {
    const window = sandbox.window
    const drawing = new window.OffscreenCanvas(1, 1).getContext('2d')
    const pixels = new window.ImageData(
      new Uint8ClampedArray([255, 0, 0, 255]),
      1,
      1,
    )
    const foreignPixels = new ForeignImageData(
      new Uint8ClampedArray([255, 0, 0, 255]),
      1,
      1,
    )
    // Act / Assert
    drawing.putImageData(pixels, 0, 0)
    assert.deepEqual(
      [...drawing.getImageData(0, 0, 1, 1).data],
      [255, 0, 0, 255],
    )
    assert.equal(drawing.createImageData(pixels).width, 1)
    bitmaps.push(await window.createImageBitmap(pixels))
    const blob = await drawing.canvas.convertToBlob()
    bitmaps.push(await window.createImageBitmap(blob))
    for (const bitmap of bitmaps) {
      drawing.drawImage(bitmap, 0, 0)
      assert.deepEqual(
        [...drawing.getImageData(0, 0, 1, 1).data],
        [255, 0, 0, 255],
      )
    }
    await assert.rejects(
      window.createImageBitmap(
        new ForeignBlob([await blob.arrayBuffer()], { type: 'image/png' }),
      ),
      { name: 'TypeError' },
    )
    await assert.rejects(window.createImageBitmap(foreignPixels), {
      name: 'TypeError',
    })
    assert.throws(() => drawing.createImageData(foreignPixels), {
      name: 'TypeError',
    })
    assert.throws(() => drawing.putImageData(foreignPixels, 0, 0), {
      name: 'TypeError',
    })
  } finally {
    for (const bitmap of bitmaps) bitmap.close()
    await result.teardown(sandbox)
  }
})

test('Canvas and Blob readers survive mixed factory teardown', async () => {
  // Arrange
  const firstEnvironment = createHappyDomExtendedEnvironment()
  const secondEnvironment = createHappyDomExtendedEnvironment()
  const firstSandbox = createSandbox()
  const secondSandbox = createSandbox()
  const first = await firstEnvironment.setup(firstSandbox, {})
  const second = await secondEnvironment.setup(secondSandbox, {})
  try {
    const canvases = [firstSandbox, secondSandbox].map((sandbox) => {
      const canvas = sandbox.document.createElement('canvas')
      canvas.width = 1
      canvas.height = 1
      const drawing = canvas.getContext('2d')
      drawing.fillStyle = 'red'
      drawing.fillRect(0, 0, 1, 1)
      return canvas
    })
    // Act
    await first.teardown(firstSandbox)
    const blob = new secondSandbox.Blob(['\uFEFFA'])
    const file = new secondSandbox.File(['\uFEFFB'], 'bom.txt')
    // Assert
    assert.equal(await blob.text(), 'A')
    assert.deepEqual([...(await blob.bytes())], [239, 187, 191, 65])
    assert.equal(await file.text(), 'B')
    assert.deepEqual([...(await file.bytes())], [239, 187, 191, 66])
    const remainingCanvas = canvases[1]
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
    assert.ok(blobImage instanceof secondSandbox.Blob)
  } finally {
    await second.teardown(secondSandbox)
  }
})

test(
  'Environment teardown drains Canvas output without waiting for a user interval',
  { timeout: 2000 },
  async (context) => {
    // Arrange
    const sandbox = createSandbox()
    const result = await Environment.setup(sandbox, {})
    const happyDOM = sandbox.happyDOM
    // A regressed teardown must still fail promptly instead of keeping the runner alive.
    context.after(async () => happyDOM.close())
    sandbox.setInterval(() => {}, 50)
    const canvas = sandbox.document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    let completed = false
    canvas.toBlob((blob) => {
      assert.ok(blob)
      completed = true
    })
    // Act
    const teardown = result.teardown(sandbox)
    await Promise.all([teardown, result.teardown(sandbox)])
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
  const sandbox = createSandbox()
  const result = await Environment.setup(sandbox, options)
  try {
    // Assert
    assert.equal(sandbox.location.href, 'https://example.test/canvas')
    assert.equal(sandbox.window.happyDOM.settings.enableImageFileLoading, false)
    assert.equal(Object.hasOwn(settings, 'canvasAdapter'), false)
    assert.ok(sandbox.document.createElement('canvas').getContext('2d'))
  } finally {
    await result.teardown(sandbox)
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

test('Invalid serialized adapters fail with actionable configuration guidance', async () => {
  // Arrange
  const sandbox = createSandbox()
  // Act / Assert
  await assert.rejects(
    async () => Environment.setup(sandbox, { settings: { canvasAdapter: {} } }),
    /cannot serialize adapter instances/,
  )
})

test('Environment teardown restores compatibility after a Canvas callback throws', async () => {
  // Arrange
  const sandbox = createSandbox()
  const result = await Environment.setup(sandbox, {})
  const window = sandbox.window
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
    result.teardown(sandbox),
    (error) => error === originalError,
  )
  assert.notEqual(window.CompositionEvent, patchedComposition)
})
