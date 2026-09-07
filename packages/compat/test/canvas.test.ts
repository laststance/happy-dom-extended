import assert from 'node:assert/strict'
import { test } from 'node:test'

import { CanvasAdapter } from '@happy-dom/node-canvas-adapter'
import canvasModule, {
  Canvas,
  CanvasRenderingContext2D,
  createCanvas,
  loadImage,
} from 'canvas'
import { HTMLCanvasElement, PropertySymbol, Window } from 'happy-dom'
import type { Blob, OffscreenCanvas } from 'happy-dom'

import type { ExtendedCanvasAdapter } from '../src/index.ts'

import { renderingWindow } from './utils/rendering-window.ts'

/** Resolves the output of either public Canvas API for non-empty image regression tests.
 * @returns The exported image Blob, rejecting unexpected encoding failure.
 * @example const blob = await exportImage(canvas);
 */
async function exportImage(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  type?: string,
): Promise<Blob> {
  return canvas instanceof HTMLCanvasElement
    ? new Promise((resolve, reject) =>
        canvas.toBlob(
          (blob) =>
            blob ? resolve(blob) : reject(new Error('Encoding failed')),
          type,
        ),
      )
    : canvas.convertToBlob(type === undefined ? {} : { type })
}

/** Decodes an actual encoded image so output assertions inspect pixels instead of a data URL prefix.
 * @returns Dimensions and decoded RGBA values.
 * @example await decodedImage(await exportImage(canvas));
 */
async function decodedImage(blob: Blob) {
  const image = await loadImage(Buffer.from(await blob.arrayBuffer()))
  const bitmap = createCanvas(image.width, image.height)
  const context = bitmap.getContext('2d')
  context.drawImage(image, 0, 0)
  const pixels = Array.from(
    context.getImageData(0, 0, image.width, image.height).data,
  )
  bitmap.width = 0
  bitmap.height = 0
  return { width: image.width, height: image.height, pixels }
}

for (const kind of ['HTML', 'Offscreen']) {
  test(`${kind} Canvas draws distinct colors and preserves its owner and Window image types`, async (context) => {
    // Arrange
    const { window } = renderingWindow(context)
    const canvas =
      kind === 'HTML'
        ? window.document.createElement('canvas')
        : new window.OffscreenCanvas(3, 1)
    Reflect.set(canvas, 'width', 3)
    Reflect.set(canvas, 'height', 1)
    const drawing = canvas.getContext('2d')
    assert.ok(drawing)
    // Act
    drawing.fillStyle = '#ff0000'
    drawing.fillRect(0, 0, 1, 1)
    drawing.fillStyle = '#0000ff'
    drawing.fillRect(1, 0, 1, 1)
    const pixels = drawing.getImageData(0, 0, 3, 1)
    const blank = drawing.createImageData(1, 1)
    // Assert
    assert.deepEqual(
      Array.from(pixels.data),
      [255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 0, 0],
    )
    assert.equal(pixels instanceof window.ImageData, true)
    assert.equal(pixels.data instanceof window.Uint8ClampedArray, true)
    assert.equal(blank instanceof window.ImageData, true)
    assert.equal(blank.data instanceof window.Uint8ClampedArray, true)
    assert.equal(drawing.canvas, canvas)
    assert.equal(canvas.getContext('2d'), drawing)
    assert.equal(drawing.fillRect, drawing.fillRect)
    assert.equal(canvas.getContext('webgl'), null)
  })

  test(`${kind} Canvas resets pixels and drawing state even when assigning the same dimensions`, (context) => {
    // Arrange
    const { window } = renderingWindow(context)
    const canvas =
      kind === 'HTML'
        ? window.document.createElement('canvas')
        : new window.OffscreenCanvas(2, 1)
    Reflect.set(canvas, 'width', 2)
    Reflect.set(canvas, 'height', 1)
    const drawing = canvas.getContext('2d')
    assert.ok(drawing)
    for (const dimension of ['width', 'height'] as const) {
      drawing.fillStyle = '#ff0000'
      drawing.fillRect(0, 0, 2, 1)
      drawing.translate(1, 0)
      // Act
      Reflect.set(canvas, dimension, canvas[dimension])
      // Assert
      assert.deepEqual(
        Array.from(drawing.getImageData(0, 0, 2, 1).data),
        [0, 0, 0, 0, 0, 0, 0, 0],
      )
      assert.equal(drawing.fillStyle, '#000000')
      drawing.fillRect(0, 0, 1, 1)
      assert.deepEqual(
        Array.from(drawing.getImageData(0, 0, 1, 1).data),
        [0, 0, 0, 255],
      )
      assert.equal(canvas.getContext('2d'), drawing)
    }
  })

  test(`${kind} Canvas keeps each export's original pixels after redraw and resize`, async (context) => {
    // Arrange
    const { window } = renderingWindow(context)
    const canvas =
      kind === 'HTML'
        ? window.document.createElement('canvas')
        : new window.OffscreenCanvas(1, 1)
    Reflect.set(canvas, 'width', 1)
    Reflect.set(canvas, 'height', 1)
    const drawing = canvas.getContext('2d')
    assert.ok(drawing)
    drawing.fillStyle = '#ff0000'
    drawing.fillRect(0, 0, 1, 1)
    // Act
    const red = exportImage(canvas)
    drawing.fillStyle = '#0000ff'
    drawing.fillRect(0, 0, 1, 1)
    const blue = exportImage(canvas)
    Reflect.set(canvas, 'width', 2)
    await window.happyDOM.waitUntilComplete()
    // Assert
    assert.deepEqual(await decodedImage(await red), {
      width: 1,
      height: 1,
      pixels: [255, 0, 0, 255],
    })
    assert.deepEqual(await decodedImage(await blue), {
      width: 1,
      height: 1,
      pixels: [0, 0, 255, 255],
    })
  })

  test(`${kind} Canvas exports PNG fallback and a decodable JPEG from actual pixels`, async (context) => {
    // Arrange
    const { window } = renderingWindow(context)
    const canvas =
      kind === 'HTML'
        ? window.document.createElement('canvas')
        : new window.OffscreenCanvas(2, 2)
    Reflect.set(canvas, 'width', 2)
    Reflect.set(canvas, 'height', 2)
    const drawing = canvas.getContext('2d')
    assert.ok(drawing)
    drawing.fillStyle = '#ff0000'
    drawing.fillRect(0, 0, 2, 2)
    // Act
    const png = await exportImage(canvas, 'image/unsupported')
    const jpeg = await exportImage(canvas, 'IMAGE/JPEG')
    const decoded = await decodedImage(jpeg)
    // Assert
    assert.equal(png.type, 'image/png')
    assert.deepEqual(
      (await decodedImage(png)).pixels.slice(0, 4),
      [255, 0, 0, 255],
    )
    assert.equal(jpeg.type, 'image/jpeg')
    assert.equal(decoded.width, 2)
    assert.equal(decoded.height, 2)
    assert.ok(Math.abs(decoded.pixels[0]! - 255) <= 3)
    assert.ok(decoded.pixels[1]! <= 3)
    assert.ok(decoded.pixels[2]! <= 3)
    assert.equal(decoded.pixels[3], 255)
  })
}

test('Canvas attribute assignments and removals resize the existing drawing context', (context) => {
  // Arrange
  const { window } = renderingWindow(context)
  const canvas = window.document.createElement('canvas')
  canvas.width = 2
  canvas.height = 1
  const drawing = canvas.getContext('2d')
  assert.ok(drawing)
  drawing.fillStyle = 'red'
  drawing.fillRect(0, 0, 2, 1)
  // Act
  canvas.setAttribute('width', '2')
  // Assert
  assert.deepEqual(
    Array.from(drawing.getImageData(0, 0, 2, 1).data),
    [0, 0, 0, 0, 0, 0, 0, 0],
  )
  canvas.setAttribute('width', '3')
  drawing.fillRect(2, 0, 1, 1)
  assert.deepEqual(
    Array.from(drawing.getImageData(2, 0, 1, 1).data),
    [0, 0, 0, 255],
  )
  canvas.removeAttribute('width')
  canvas.removeAttribute('height')
  assert.equal(canvas.width, 300)
  assert.equal(canvas.height, 150)
  assert.deepEqual(
    Array.from(drawing.getImageData(2, 0, 1, 1).data),
    [0, 0, 0, 0],
  )
})

test('Canvas draws resized source canvases and patterns using the source environment pixels', (context) => {
  // Arrange
  const first = renderingWindow(context)
  const second = renderingWindow(context)
  const source = first.window.document.createElement('canvas')
  source.width = 1
  source.height = 1
  const sourceDrawing = source.getContext('2d')
  assert.ok(sourceDrawing)
  source.width = 2
  sourceDrawing.fillStyle = 'blue'
  sourceDrawing.fillRect(1, 0, 1, 1)
  const target = new second.window.OffscreenCanvas(2, 1)
  const targetDrawing = target.getContext('2d')
  assert.ok(targetDrawing)
  // Act
  targetDrawing.drawImage(source, 0, 0)
  // Assert
  assert.deepEqual(
    Array.from(targetDrawing.getImageData(0, 0, 2, 1).data),
    [0, 0, 0, 0, 0, 0, 255, 255],
  )
  targetDrawing.clearRect(0, 0, 2, 1)
  targetDrawing.fillStyle = targetDrawing.createPattern(source, 'repeat')
  targetDrawing.fillRect(0, 0, 2, 1)
  assert.deepEqual(
    Array.from(targetDrawing.getImageData(0, 0, 2, 1).data),
    [0, 0, 0, 0, 0, 0, 255, 255],
  )
})

test('Canvas export before drawing preserves a later context choice and encodes transparent pixels', async (context) => {
  // Arrange
  const { window } = renderingWindow(context)
  const canvas = window.document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  // Act
  const blank = await exportImage(canvas)
  const dataURL = canvas.toDataURL('image/unknown')
  const drawing = canvas.getContext('2d', { alpha: false })
  assert.ok(drawing)
  // Assert
  assert.deepEqual(await decodedImage(blank), {
    width: 1,
    height: 1,
    pixels: [0, 0, 0, 0],
  })
  assert.match(dataURL, /^data:image\/png;base64,/)
  assert.deepEqual(
    Array.from(drawing.getImageData(0, 0, 1, 1).data),
    [0, 0, 0, 255],
  )
})

test('Empty HTML canvases notify asynchronously while empty Offscreen canvases reject with IndexSizeError', async (context) => {
  // Arrange
  const { window } = renderingWindow(context)
  const canvas = window.document.createElement('canvas')
  canvas.width = 0
  let called = false
  // Act
  canvas.toBlob((blob) => {
    called = true
    assert.equal(blob, null)
  })
  // Assert
  assert.equal(called, false)
  assert.equal(canvas.toDataURL(), 'data:,')
  await window.happyDOM.waitUntilComplete()
  assert.equal(called, true)
  await assert.rejects(new window.OffscreenCanvas(0, 1).convertToBlob(), {
    name: 'IndexSizeError',
  })
  await assert.rejects(new window.OffscreenCanvas(1, 0).convertToBlob(), {
    name: 'IndexSizeError',
  })
})

test('Happy DOM waits for native encoding and releases each temporary bitmap after its callback', async (context) => {
  // Arrange
  const { window } = renderingWindow(context)
  const canvas = window.document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const original = Canvas.prototype.toBuffer
  const snapshots: Canvas[] = []
  context.mock.method(
    Canvas.prototype,
    'toBuffer',
    function (this: Canvas, ...argumentsList: unknown[]) {
      snapshots.push(this)
      return Reflect.apply(original, this, argumentsList)
    },
  )
  let completed = false
  // Act
  canvas.toBlob(() => {
    completed = true
  })
  await window.happyDOM.waitUntilComplete()
  // Assert
  assert.equal(completed, true)
  assert.equal(snapshots.length, 1)
  assert.equal(snapshots[0]?.width, 0)
  assert.equal(snapshots[0]?.height, 0)
})

test('Native encoding errors notify callers and leave no pending export or temporary bitmap', async (context) => {
  // Arrange
  const { window, adapter } = renderingWindow(context)
  const snapshots: Canvas[] = []
  context.mock.method(Canvas.prototype, 'toBuffer', function (this: Canvas) {
    snapshots.push(this)
    throw new Error('Encoder rejected the image')
  })
  const canvas = window.document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  // Act
  const html = new Promise((resolve) => canvas.toBlob(resolve))
  const offscreen = new window.OffscreenCanvas(1, 1).convertToBlob()
  // Assert
  assert.equal(await html, null)
  await assert.rejects(offscreen, { name: 'EncodingError' })
  await adapter.drain()
  assert.deepEqual(
    snapshots.map((snapshot) => [snapshot.width, snapshot.height]),
    [
      [0, 0],
      [0, 0],
    ],
  )
})

test('Callback errors release pending exports before the runner reports the original error', async (context) => {
  // Arrange
  const { window, adapter } = renderingWindow(context)
  const canvas = window.document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const error = new Error('Consumer callback failed')
  // Act
  canvas.toBlob(() => {
    throw error
  })
  // Assert
  await assert.rejects(adapter.drain(), (actual) => actual === error)
  await window.happyDOM.waitUntilComplete()
  await adapter.drain()
})

test('Canvas initialization rolls back earlier instance patches when a later hook is locked', (context) => {
  // Arrange
  const { window } = renderingWindow(context)
  const canvas = window.document.createElement('canvas')
  const original = canvas[PropertySymbol.onSetAttribute]
  Object.defineProperty(canvas, PropertySymbol.onRemoveAttribute, {
    value: canvas[PropertySymbol.onRemoveAttribute],
    configurable: false,
  })
  // Act / Assert
  assert.throws(() => canvas.getContext('2d'), TypeError)
  assert.equal(canvas[PropertySymbol.onSetAttribute], original)
  assert.equal(Object.hasOwn(canvas, PropertySymbol.onSetAttribute), false)
})

test('Synchronous encoding failure produces an empty data URL while retaining drawable pixels', (context) => {
  // Arrange
  const { window } = renderingWindow(context)
  const canvas = window.document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const drawing = canvas.getContext('2d')!
  drawing.fillRect(0, 0, 1, 1)
  context.mock.method(Canvas.prototype, 'toDataURL', () => {
    throw new Error('Encoder failed')
  })
  // Act / Assert
  assert.equal(canvas.toDataURL(), 'data:,')
  assert.deepEqual([...drawing.getImageData(0, 0, 1, 1).data], [0, 0, 0, 255])
})

test('Invalid output arguments register no asynchronous work and later exports still complete', async (context) => {
  // Arrange
  const { window } = renderingWindow(context)
  const canvas = window.document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const failure = new Error('MIME conversion failed')
  // Act / Assert
  assert.throws(() => Reflect.apply(canvas.toBlob, canvas, [null]), TypeError)
  assert.throws(
    () =>
      Reflect.apply(canvas.toBlob, canvas, [
        () => {},
        {
          toString() {
            throw failure
          },
        },
      ]),
    (error) => error === failure,
  )
  assert.equal((await exportImage(canvas)).type, 'image/png')
  await window.happyDOM.waitUntilComplete()
})

test('Failed snapshot drawing releases its temporary bitmap and a later export keeps the original pixels', async (context) => {
  // Arrange
  const { window, adapter } = renderingWindow(context)
  const canvas = window.document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const drawing = canvas.getContext('2d')!
  drawing.fillStyle = 'red'
  drawing.fillRect(0, 0, 1, 1)
  const failure = new Error('Snapshot drawing failed')
  const snapshots: Canvas[] = []
  const drawImage = context.mock.method(
    CanvasRenderingContext2D.prototype,
    'drawImage',
    function (this: CanvasRenderingContext2D) {
      snapshots.push(this.canvas)
      throw failure
    },
  )
  // Act / Assert
  assert.throws(
    () => canvas.toBlob(() => {}),
    (error) => error === failure,
  )
  assert.deepEqual(
    snapshots.map((snapshot) => [snapshot.width, snapshot.height]),
    [[0, 0]],
  )
  drawImage.mock.restore()
  await adapter.drain()
  assert.deepEqual(await decodedImage(await exportImage(canvas)), {
    width: 1,
    height: 1,
    pixels: [255, 0, 0, 255],
  })
})

test('Rejected output registration releases its snapshot without blocking a later export', async (context) => {
  // Arrange
  const { window, adapter } = renderingWindow(context)
  const canvas = window.document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const drawing = canvas.getContext('2d')!
  drawing.fillStyle = 'red'
  drawing.fillRect(0, 0, 1, 1)
  const failure = new Error('Output registration failed')
  const snapshots: Canvas[] = []
  const originalDrawImage = CanvasRenderingContext2D.prototype.drawImage
  context.mock.method(
    CanvasRenderingContext2D.prototype,
    'drawImage',
    function (this: CanvasRenderingContext2D, ...argumentsList: unknown[]) {
      snapshots.push(this.canvas)
      return Reflect.apply(originalDrawImage, this, argumentsList)
    },
  )
  const originalToBlob = adapter.toBlob
  context.mock.method(
    adapter,
    'toBlob',
    (...argumentsList: Parameters<ExtendedCanvasAdapter['toBlob']>) => {
      const tasks =
        argumentsList[0].browserFrame[PropertySymbol.asyncTaskManager]
      context.mock.method(tasks, 'startTask', () => {
        throw failure
      })
      originalToBlob.apply(adapter, argumentsList)
    },
  )
  // Act / Assert
  assert.throws(
    () => canvas.toBlob(() => {}),
    (error) => error === failure,
  )
  assert.deepEqual(
    snapshots.map((snapshot) => [snapshot.width, snapshot.height]),
    [[0, 0]],
  )
  context.mock.restoreAll()
  await adapter.drain()
  assert.deepEqual(await decodedImage(await exportImage(canvas)), {
    width: 1,
    height: 1,
    pixels: [255, 0, 0, 255],
  })
  await window.happyDOM.waitUntilComplete()
})

test('Output task cleanup errors release the image and pending export before drain reports the original failure', async (context) => {
  // Arrange
  const { window, adapter } = renderingWindow(context)
  const canvas = window.document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const failure = new Error('Output task cleanup failed')
  const snapshots: Canvas[] = []
  const originalToBuffer = Canvas.prototype.toBuffer
  context.mock.method(
    Canvas.prototype,
    'toBuffer',
    function (this: Canvas, ...argumentsList: unknown[]) {
      snapshots.push(this)
      return Reflect.apply(originalToBuffer, this, argumentsList)
    },
  )
  const originalToBlob = adapter.toBlob
  context.mock.method(
    adapter,
    'toBlob',
    (...argumentsList: Parameters<ExtendedCanvasAdapter['toBlob']>) => {
      const tasks =
        argumentsList[0].browserFrame[PropertySymbol.asyncTaskManager]
      const startTask = context.mock.method(tasks, 'startTask')
      const originalEndTask = tasks.endTask
      originalToBlob.apply(adapter, argumentsList)
      const outputTaskId = startTask.mock.calls[0]?.result
      context.mock.method(
        tasks,
        'endTask',
        (taskId: Parameters<typeof tasks.endTask>[0]) => {
          originalEndTask.call(tasks, taskId)
          // Unrelated Happy DOM jobs must retain their normal completion behavior.
          if (taskId === outputTaskId) throw failure
        },
      )
    },
  )
  // Act
  const output = new Promise<Blob | null>((resolve) => canvas.toBlob(resolve))
  // Assert
  await assert.rejects(adapter.drain(), (error) => error === failure)
  assert.ok((await output) instanceof window.Blob)
  assert.deepEqual(
    snapshots.map((snapshot) => [snapshot.width, snapshot.height]),
    [[0, 0]],
  )
  context.mock.restoreAll()
  await window.happyDOM.waitUntilComplete()
  await adapter.drain()
  assert.equal((await exportImage(canvas)).type, 'image/png')
})

test('JPEG output forwards inclusive quality bounds and uses encoder defaults for invalid qualities', async (context) => {
  // Arrange
  const { window } = renderingWindow(context)
  const canvas = window.document.createElement('canvas')
  canvas.width = 2
  canvas.height = 2
  canvas.getContext('2d')!.fillRect(0, 0, 2, 2)
  const dataURLCalls = context.mock.method(Canvas.prototype, 'toDataURL')
  const bufferCalls = context.mock.method(Canvas.prototype, 'toBuffer')
  const cases = [
    { quality: 0, expectedQuality: 0, expectedOptions: { quality: 0 } },
    { quality: 1, expectedQuality: 1, expectedOptions: { quality: 1 } },
    {
      quality: 0.45,
      expectedQuality: 0.45,
      expectedOptions: { quality: 0.45 },
    },
    { quality: -1, expectedQuality: undefined, expectedOptions: {} },
    { quality: 2, expectedQuality: undefined, expectedOptions: {} },
    { quality: NaN, expectedQuality: undefined, expectedOptions: {} },
    { quality: Infinity, expectedQuality: undefined, expectedOptions: {} },
    { quality: '0.5', expectedQuality: undefined, expectedOptions: {} },
  ]
  for (const { quality, expectedQuality, expectedOptions } of cases) {
    // Act
    const dataURL = Reflect.apply(canvas.toDataURL, canvas, [
      'image/jpeg',
      quality,
    ])
    const blob = await new Promise<Blob | null>((resolve) =>
      Reflect.apply(canvas.toBlob, canvas, [resolve, 'image/jpeg', quality]),
    )
    // Assert
    assert.match(dataURL, /^data:image\/jpeg;base64,/)
    assert.deepEqual(dataURLCalls.mock.calls.at(-1)?.arguments, [
      'image/jpeg',
      expectedQuality,
    ])
    assert.deepEqual(bufferCalls.mock.calls.at(-1)?.arguments.slice(1), [
      'image/jpeg',
      expectedOptions,
    ])
    assert.ok(blob)
    assert.equal(blob.type, 'image/jpeg')
    const decoded = await decodedImage(blob)
    assert.equal(decoded.width, 2)
    assert.equal(decoded.height, 2)
  }
  // OffscreenCanvas passes its options through the same native quality contract.
  const offscreen = new window.OffscreenCanvas(1, 1)
  await offscreen.convertToBlob({ type: 'image/jpeg', quality: 0.75 })
  assert.deepEqual(bufferCalls.mock.calls.at(-1)?.arguments.slice(1), [
    'image/jpeg',
    { quality: 0.75 },
  ])
})

test('Editing Canvas readback pixels changes the drawing only after putImageData copies them back', (context) => {
  // Arrange
  const { window } = renderingWindow(context)
  const canvas = window.document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const drawing = canvas.getContext('2d')!
  drawing.fillStyle = 'red'
  drawing.fillRect(0, 0, 1, 1)
  const output = drawing.getImageData(0, 0, 1, 1)
  // Act
  output.data.set([0, 0, 255, 255])
  // Assert
  assert.ok(output instanceof window.ImageData)
  assert.ok(output.data instanceof window.Uint8ClampedArray)
  assert.deepEqual([...output.data], [0, 0, 255, 255])
  assert.deepEqual([...drawing.getImageData(0, 0, 1, 1).data], [255, 0, 0, 255])
  drawing.putImageData(output, 0, 0)
  assert.deepEqual([...drawing.getImageData(0, 0, 1, 1).data], [0, 0, 255, 255])
})

test('A locked Canvas hook still releases every owned bitmap and preserves rendering in another environment', (context) => {
  // Arrange
  const { window, adapter } = renderingWindow(context)
  const survivor = renderingWindow(context)
  const bitmaps: Canvas[] = []
  const originalGetContext = Canvas.prototype.getContext
  context.mock.method(
    Canvas.prototype,
    'getContext',
    function (this: Canvas, ...argumentsList: unknown[]) {
      bitmaps.push(this)
      return Reflect.apply(originalGetContext, this, argumentsList)
    },
  )
  const locked = window.document.createElement('canvas')
  const sibling = window.document.createElement('canvas')
  const survivingCanvas = survivor.window.document.createElement('canvas')
  for (const canvas of [locked, sibling, survivingCanvas]) {
    canvas.width = 1
    canvas.height = 1
    const drawing = canvas.getContext('2d')!
    drawing.fillStyle = 'red'
    drawing.fillRect(0, 0, 1, 1)
  }
  Object.defineProperty(locked, PropertySymbol.onSetAttribute, {
    configurable: false,
  })
  // Act / Assert
  assert.throws(() => adapter.dispose(), /Cannot restore property/)
  assert.deepEqual(
    bitmaps.map((bitmap) => [bitmap.width, bitmap.height]),
    [
      [0, 0],
      [0, 0],
      [1, 1],
    ],
  )
  assert.equal(Object.hasOwn(sibling, PropertySymbol.onSetAttribute), false)
  assert.equal(Object.hasOwn(sibling, PropertySymbol.onRemoveAttribute), false)
  assert.doesNotThrow(() => adapter.dispose())
  assert.throws(() => sibling.getContext('2d'), /has been disposed/)
  assert.throws(() => sibling.toDataURL(), /has been disposed/)
  assert.throws(() => sibling.toBlob(() => {}), /has been disposed/)
  assert.deepEqual(
    [...survivingCanvas.getContext('2d')!.getImageData(0, 0, 1, 1).data],
    [255, 0, 0, 255],
  )
})

test('Canvas drawing and patterns retain pixels from a caller-owned official source adapter', (context) => {
  // Arrange
  const sourceWindow = new Window({
    settings: { canvasAdapter: new CanvasAdapter() },
  })
  context.after(async () => sourceWindow.happyDOM.close())
  const { window } = renderingWindow(context)
  const source = sourceWindow.document.createElement('canvas')
  source.width = 1
  source.height = 1
  const sourceDrawing = source.getContext('2d')!
  sourceDrawing.fillStyle = 'red'
  sourceDrawing.fillRect(0, 0, 1, 1)
  const destination = new window.OffscreenCanvas(2, 1)
  const drawing = destination.getContext('2d')!
  // Act
  drawing.drawImage(source, 0, 0)
  // Assert
  assert.deepEqual(
    [...drawing.getImageData(0, 0, 2, 1).data],
    [255, 0, 0, 255, 0, 0, 0, 0],
  )
  drawing.clearRect(0, 0, 2, 1)
  drawing.fillStyle = drawing.createPattern(source, 'repeat')
  drawing.fillRect(0, 0, 2, 1)
  assert.deepEqual(
    [...drawing.getImageData(0, 0, 2, 1).data],
    [255, 0, 0, 255, 255, 0, 0, 255],
  )
})

test(
  'Missing native JPEG support produces real PNG output with matching MIME types and completes every export',
  { timeout: 2000 },
  async (context) => {
    // Arrange
    const { window, adapter } = renderingWindow(context)
    const jpegVersion = Object.getOwnPropertyDescriptor(
      canvasModule,
      'jpegVersion',
    )
    assert.ok(jpegVersion)
    Object.defineProperty(canvasModule, 'jpegVersion', {
      ...jpegVersion,
      value: undefined,
    })
    try {
      const html = window.document.createElement('canvas')
      html.width = 1
      html.height = 1
      const offscreen = new window.OffscreenCanvas(1, 1)
      for (const canvas of [html, offscreen]) {
        const drawing = canvas.getContext('2d')!
        drawing.fillStyle = 'red'
        drawing.fillRect(0, 0, 1, 1)
      }
      // Act
      const dataURL = html.toDataURL('image/jpeg')
      const htmlOutput = exportImage(html, 'image/jpeg')
      const offscreenOutput = exportImage(offscreen, 'image/jpeg')
      await adapter.drain()
      // Assert
      assert.match(dataURL, /^data:image\/png;base64,/)
      assert.deepEqual(
        [...Buffer.from(dataURL.split(',')[1]!, 'base64').subarray(0, 8)],
        [137, 80, 78, 71, 13, 10, 26, 10],
      )
      for (const blob of [await htmlOutput, await offscreenOutput]) {
        assert.equal(blob.type, 'image/png')
        assert.deepEqual(await decodedImage(blob), {
          width: 1,
          height: 1,
          pixels: [255, 0, 0, 255],
        })
      }
      await window.happyDOM.waitUntilComplete()
    } finally {
      Object.defineProperty(canvasModule, 'jpegVersion', jpegVersion)
    }
  },
)
