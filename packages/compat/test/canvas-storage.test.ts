import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Canvas } from 'skia-canvas'

import { fetchCanvasResource } from '../src/canvas/resource-fetch.ts'

import { renderingWindow } from './utils/rendering-window.ts'

test('a failed native context constructor releases its reserved bitmap and later Canvas creation succeeds', async (context) => {
  // Arrange
  const { window } = await renderingWindow(context)
  const bitmaps: Canvas[] = []
  const failure = new Error('Native context initialization failed')
  const nativeGetContext = context.mock.method(
    Canvas.prototype,
    'getContext',
    function (this: Canvas) {
      bitmaps.push(this)
      throw failure
    },
  )
  const canvas = new window.OffscreenCanvas(2, 1)
  // Act / Assert
  assert.throws(
    () => canvas.getContext('2d'),
    (error) => error === failure,
  )
  assert.deepEqual(
    bitmaps.map((bitmap) => [bitmap.width, bitmap.height]),
    [[0, 0]],
  )
  nativeGetContext.mock.restore()
  const drawing = canvas.getContext('2d')!
  drawing.fillRect(0, 0, 1, 1)
  assert.deepEqual([...drawing.getImageData(0, 0, 1, 1).data], [0, 0, 0, 255])
})

test('live rasters and pending snapshot requests share a bounded native pixel budget', async (context) => {
  // Arrange
  const { window, adapter } = await renderingWindow(context)
  const first = new window.OffscreenCanvas(4096, 4096)
  const second = window.document.createElement('canvas')
  second.width = 4096
  second.height = 4096
  first.getContext('2d')
  second.getContext('2d')
  // Act / Assert
  assert.throws(
    () => new window.OffscreenCanvas(1, 1).getContext('2d'),
    window.RangeError,
  )
  const blank = window.document.createElement('canvas')
  blank.width = 1
  blank.height = 1
  assert.equal(blank.toDataURL(), 'data:,')
  let callbackRan = false
  const html = new Promise((resolve) =>
    second.toBlob((blob) => {
      callbackRan = true
      resolve(blob)
    }),
  )
  const offscreen = first.convertToBlob()
  assert.equal(callbackRan, false)
  assert.equal(await html, null)
  await assert.rejects(offscreen, { name: 'EncodingError' })
  Reflect.set(first, 'width', 0)
  const small = new window.OffscreenCanvas(1, 1).getContext('2d')!
  small.fillRect(0, 0, 1, 1)
  assert.deepEqual([...small.getImageData(0, 0, 1, 1).data], [0, 0, 0, 255])
  await adapter.drain()
  await window.happyDOM.waitUntilComplete()
})

test('opaque Canvas keeps black backing through clip, compositing, pixel replacement and dimension reset', async (context) => {
  // Arrange
  const { window } = await renderingWindow(context)
  const canvas = window.document.createElement('canvas')
  canvas.width = 2
  canvas.height = 1
  const drawing = canvas.getContext('2d', { alpha: false })!
  assert.deepEqual(
    [...drawing.getImageData(0, 0, 2, 1).data],
    [0, 0, 0, 255, 0, 0, 0, 255],
  )
  // Act
  drawing.save()
  drawing.rect(0, 0, 0.5, 1)
  drawing.clip()
  drawing.clearRect(0, 0, 2, 1)
  drawing.restore()
  drawing.globalCompositeOperation = 'source-in'
  drawing.globalAlpha = 0.5
  drawing.fillStyle = 'blue'
  drawing.fillRect(0, 0, 1, 1)
  // CPU Skia quantizes half alpha to 127; pinned Chrome produces 128 (one color level).
  // Assert
  assert.deepEqual(
    [...drawing.getImageData(0, 0, 2, 1).data],
    [0, 0, 127, 255, 0, 0, 0, 255],
  )
  const pixels = new window.Uint8ClampedArray([255, 0, 0, 128])
  drawing.putImageData(new window.ImageData(pixels, 1), 1, 0)
  assert.deepEqual(
    [...drawing.getImageData(0, 0, 2, 1).data],
    [0, 0, 127, 255, 255, 0, 0, 255],
  )
  assert.deepEqual([...pixels], [255, 0, 0, 128])
  assert.equal(drawing.globalAlpha, 0.5)
  canvas.width = 2
  assert.deepEqual(
    [...drawing.getImageData(0, 0, 2, 1).data],
    [0, 0, 0, 255, 0, 0, 0, 255],
  )
  assert.deepEqual(
    Reflect.apply(Reflect.get(drawing, 'getContextAttributes'), drawing, []),
    {
      alpha: false,
      colorSpace: 'srgb',
      colorType: 'unorm8',
      desynchronized: false,
      willReadFrequently: false,
    },
  )
})

test('Canvas reports its effective color space and draws CSS Color 4 styles and gradient stops as real sRGB pixels', async (context) => {
  // Arrange
  const { window } = await renderingWindow(context)
  const canvas = new window.OffscreenCanvas(2, 1)
  const drawing = canvas.getContext('2d', { colorSpace: 'display-p3' })!
  const gradient = drawing.createLinearGradient(0, 0, 2, 0)
  // Act
  drawing.fillStyle = 'color(display-p3 1 0 0)'
  drawing.fillRect(0, 0, 1, 1)
  gradient.addColorStop(0, 'color(display-p3 0 0 1)')
  gradient.addColorStop(1, 'color(display-p3 0 0 1)')
  drawing.fillStyle = gradient
  drawing.fillRect(1, 0, 1, 1)
  // Assert
  assert.deepEqual(
    [...drawing.getImageData(0, 0, 2, 1).data],
    [255, 0, 0, 255, 0, 0, 255, 255],
  )
  assert.deepEqual(
    Reflect.apply(Reflect.get(drawing, 'getContextAttributes'), drawing, []),
    {
      alpha: true,
      colorSpace: 'srgb',
      colorType: 'unorm8',
      desynchronized: false,
      willReadFrequently: false,
    },
  )
  assert.throws(() => gradient.addColorStop(-1, 'red'), {
    name: 'IndexSizeError',
  })
  assert.throws(() => gradient.addColorStop(0, 'invalid-color'), {
    name: 'SyntaxError',
  })
  assert.throws(() => gradient.addColorStop(NaN, 'red'), window.TypeError)
  assert.throws(
    () =>
      new window.OffscreenCanvas(1, 1).getContext('2d', {
        colorSpace: 'invalid',
      }),
    window.TypeError,
  )
})

test('ImageData validation rejects nonfinite, detached and oversized input before native allocation', async (context) => {
  // Arrange
  const { window } = await renderingWindow(context)
  const drawing = new window.OffscreenCanvas(1, 1).getContext('2d')!
  const pixels = new window.ImageData(1, 1)
  // Act / Assert
  assert.throws(() => drawing.getImageData(Infinity, 0, 1, 1), window.TypeError)
  assert.throws(() => drawing.createImageData(NaN, 1), window.TypeError)
  assert.throws(
    () => drawing.putImageData(pixels, Infinity, 0),
    window.TypeError,
  )
  assert.throws(() => drawing.getImageData(0, 0, 32_768, 1), window.RangeError)
  assert.throws(() => drawing.createImageData(4097, 4096), window.RangeError)
  structuredClone(pixels.data.buffer, { transfer: [pixels.data.buffer] })
  assert.throws(() => drawing.putImageData(pixels, 0, 0), {
    name: 'InvalidStateError',
  })
  assert.deepEqual([...drawing.getImageData(0, 0, 1, 1).data], [0, 0, 0, 0])
})

test('Canvas source conversions share the destination budget and release storage after successful or rejected use', async (context) => {
  // Arrange
  const { window, adapter } = await renderingWindow(context)
  const drawing = new window.OffscreenCanvas(1, 1).getContext('2d')!
  const source = new window.OffscreenCanvas(2, 2)
  const release = adapter.reserveStorage(window, 134217724)
  // Act / Assert
  try {
    assert.throws(() => drawing.drawImage(source, 0, 0), window.RangeError)
    assert.throws(
      () => drawing.createPattern(source, 'repeat'),
      window.RangeError,
    )
    await assert.rejects(window.createImageBitmap(source), window.RangeError)
  } finally {
    release()
  }
  const remaining = adapter.reserveStorage(window, 134217708)
  try {
    drawing.drawImage(source, 0, 0)
    assert.throws(
      () => Reflect.apply(drawing.createPattern, drawing, [source, 'invalid']),
      { name: 'SyntaxError' },
    )
    const reusable = adapter.reserveStorage(window, 16)
    reusable()
  } finally {
    remaining()
  }
  assert.deepEqual([...drawing.getImageData(0, 0, 1, 1).data], [0, 0, 0, 0])
})

test('media body copies and Blob reads reject exhausted storage and release partial stream reservations', async (context) => {
  // Arrange
  const { window, adapter } = await renderingWindow(context)
  window.happyDOM.setURL('https://media.example/')
  window.happyDOM.settings.fetch.interceptor = {
    beforeAsyncRequest: async () => new window.Response(new Uint8Array(16)),
  }
  const url = window.URL.createObjectURL(new window.Blob([new Uint8Array(16)]))
  const release = adapter.reserveStorage(window, 134217728)
  // Act / Assert
  try {
    await assert.rejects(
      fetchCanvasResource(
        window,
        '/input',
        null,
        new window.AbortController().signal,
      ),
      window.RangeError,
    )
    await assert.rejects(
      fetchCanvasResource(
        window,
        url,
        null,
        new window.AbortController().signal,
      ),
      window.RangeError,
    )
  } finally {
    release()
  }
  let cancelled = false
  window.happyDOM.settings.fetch.interceptor = {
    beforeAsyncRequest: async () =>
      new window.Response(
        new window.ReadableStream({
          start(controller: ReadableStreamDefaultController<Uint8Array>) {
            controller.enqueue(new Uint8Array(8))
            controller.enqueue(new Uint8Array(8))
          },
          cancel() {
            cancelled = true
          },
        }),
      ),
  }
  const remaining = adapter.reserveStorage(window, 134217716)
  try {
    await assert.rejects(
      fetchCanvasResource(
        window,
        '/partial',
        null,
        new window.AbortController().signal,
      ),
      window.RangeError,
    )
    assert.equal(cancelled, true)
    const reusable = adapter.reserveStorage(window, 12)
    reusable()
  } finally {
    remaining()
  }
  const resource = await fetchCanvasResource(
    window,
    url,
    null,
    new window.AbortController().signal,
  )
  assert.equal(resource.buffer.length, 16)
  resource.release()
  const entire = adapter.reserveStorage(window, 134217728)
  entire()
})
