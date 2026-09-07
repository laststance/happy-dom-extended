import assert from 'node:assert/strict'
import { test } from 'node:test'

import { imageServers } from './utils/image-servers.ts'
import { renderingWindow } from './utils/rendering-window.ts'

test('Blob bitmaps preserve resource-limit and shutdown failures while malformed headers remain decode errors', async (context) => {
  // Arrange
  const { redPng } = await imageServers(context)
  const { window, adapter } = await renderingWindow(context)
  const blob = new window.Blob([new window.Uint8Array(redPng)])
  const release = adapter.reserveStorage(window, 134217728)
  // Act / Assert
  try {
    await assert.rejects(
      Reflect.apply(window.createImageBitmap, window, [blob]),
      window.RangeError,
    )
  } finally {
    release()
  }
  const bitmap = await Reflect.apply(window.createImageBitmap, window, [blob])
  assert.deepEqual([bitmap.width, bitmap.height], [1, 1])
  bitmap.close()
  for (const bytes of [
    [66, 77],
    [71, 73, 70, 56, 57, 97],
  ])
    await assert.rejects(
      Reflect.apply(window.createImageBitmap, window, [
        new window.Blob([new window.Uint8Array(bytes)]),
      ]),
      {
        name: 'InvalidStateError',
        message: 'The Blob is not a decodable image.',
      },
    )
  adapter.dispose()
  await assert.rejects(
    Reflect.apply(window.createImageBitmap, window, [blob]),
    {
      name: 'InvalidStateError',
      message: 'The Canvas environment is closing.',
    },
  )
})

test('ImageBitmap snapshots ImageData and Canvas pixels before the creating call returns', async (context) => {
  // Arrange
  const { window } = await renderingWindow(context)
  const pixels = new window.ImageData(
    new window.Uint8ClampedArray([255, 0, 0, 255]),
    1,
  )
  const pending = Reflect.apply(window.createImageBitmap, window, [pixels])
  pixels.data.set([0, 0, 255, 255])
  // Act
  const bitmap = await pending
  const source = new window.OffscreenCanvas(1, 1)
  const drawing = source.getContext('2d')!
  drawing.drawImage(bitmap, 0, 0)
  const canvasSnapshot = window.createImageBitmap(source)
  drawing.clearRect(0, 0, 1, 1)
  drawing.drawImage(await canvasSnapshot, 0, 0)
  // Assert
  assert.ok(bitmap instanceof window.ImageBitmap)
  assert.deepEqual([bitmap.width, bitmap.height], [1, 1])
  assert.deepEqual([...drawing.getImageData(0, 0, 1, 1).data], [255, 0, 0, 255])
  const copy = await window.createImageBitmap(bitmap)
  bitmap.close()
  bitmap.close()
  assert.deepEqual([bitmap.width, bitmap.height], [0, 0])
  assert.throws(() => drawing.drawImage(bitmap, 0, 0), {
    name: 'InvalidStateError',
  })
  drawing.drawImage(copy, 0, 0)
  assert.deepEqual([...drawing.getImageData(0, 0, 1, 1).data], [255, 0, 0, 255])
})

test('bitmap crop rectangles preserve outside transparency and negative extents while resize and flipY use actual source pixels', async (context) => {
  // Arrange
  const { window } = await renderingWindow(context)
  const pixels = new window.ImageData(
    new window.Uint8ClampedArray([
      255, 0, 0, 255, 0, 0, 255, 255, 0, 255, 0, 255, 255, 255, 255, 255,
    ]),
    2,
  )
  const drawing = new window.OffscreenCanvas(4, 4).getContext('2d')!
  // Act / Assert
  const outside = await Reflect.apply(window.createImageBitmap, window, [
    pixels,
    -1,
    0,
    2,
    2,
  ])
  drawing.drawImage(outside, 0, 0)
  assert.deepEqual(
    [...drawing.getImageData(0, 0, 2, 1).data],
    [0, 0, 0, 0, 255, 0, 0, 255],
  )
  const negative = await Reflect.apply(window.createImageBitmap, window, [
    pixels,
    2,
    2,
    -2,
    -2,
  ])
  drawing.drawImage(negative, 0, 0)
  assert.deepEqual(
    [...drawing.getImageData(0, 0, 2, 2).data],
    [255, 0, 0, 255, 0, 0, 255, 255, 0, 255, 0, 255, 255, 255, 255, 255],
  )
  const flipped = await Reflect.apply(window.createImageBitmap, window, [
    pixels,
    {
      imageOrientation: 'flipY',
      resizeWidth: 4,
      resizeQuality: 'pixelated',
    },
  ])
  drawing.drawImage(flipped, 0, 0)
  assert.deepEqual([flipped.width, flipped.height], [4, 4])
  assert.deepEqual(
    [...drawing.getImageData(0, 0, 4, 1).data],
    [0, 255, 0, 255, 0, 255, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255],
  )
})

test('bitmap option coercion preserves WebIDL ordering and rejects invalid, zero, detached and closed input', async (context) => {
  // Arrange
  const { window } = await renderingWindow(context)
  const pixels = new window.ImageData(1, 1)
  const reads: PropertyKey[] = []
  const options = new Proxy(
    {},
    {
      get(target, key) {
        reads.push(key)
        return Reflect.get(target, key)
      },
    },
  )
  // Act / Assert
  const bitmap = await Reflect.apply(window.createImageBitmap, window, [
    pixels,
    options,
  ])
  assert.deepEqual(reads, [
    'colorSpaceConversion',
    'imageOrientation',
    'premultiplyAlpha',
    'resizeHeight',
    'resizeQuality',
    'resizeWidth',
  ])
  reads.length = 0
  await assert.rejects(
    Reflect.apply(window.createImageBitmap, window, [{}, options]),
    window.TypeError,
  )
  assert.deepEqual(reads, [])
  await assert.rejects(
    Reflect.apply(window.createImageBitmap, window, [
      pixels,
      0,
      0,
      0,
      1,
      { resizeWidth: 0 },
    ]),
    window.RangeError,
  )
  await assert.rejects(
    Reflect.apply(window.createImageBitmap, window, [
      pixels,
      { resizeWidth: 0 },
    ]),
    {
      name: 'InvalidStateError',
    },
  )
  await assert.rejects(
    Reflect.apply(window.createImageBitmap, window, [
      pixels,
      { resizeWidth: -1 },
    ]),
    window.TypeError,
  )
  await assert.rejects(
    Reflect.apply(window.createImageBitmap, window, [
      pixels,
      { resizeQuality: 'invalid' },
    ]),
    window.TypeError,
  )
  bitmap.close()
  await assert.rejects(window.createImageBitmap(bitmap), {
    name: 'InvalidStateError',
  })
  structuredClone(pixels.data.buffer, { transfer: [pixels.data.buffer] })
  await assert.rejects(
    Reflect.apply(window.createImageBitmap, window, [pixels]),
    {
      name: 'InvalidStateError',
    },
  )
  await assert.rejects(
    Reflect.apply(window.createImageBitmap, window, [
      new window.Blob(['not an image']),
    ]),
    { name: 'InvalidStateError' },
  )
})

test('Blob and loaded-image bitmaps retain real pixels, intrinsic size and source taint', async (context) => {
  // Arrange
  const { origin, crossOrigin, redPng } = await imageServers(context)
  const { window } = await renderingWindow(context)
  window.happyDOM.setURL(origin)
  const fromBlob = await Reflect.apply(window.createImageBitmap, window, [
    new window.Blob([redPng], { type: 'image/png' }),
  ])
  const drawing = new window.OffscreenCanvas(1, 1).getContext('2d')!
  // Act / Assert
  drawing.drawImage(fromBlob, 0, 0)
  assert.deepEqual([...drawing.getImageData(0, 0, 1, 1).data], [255, 0, 0, 255])
  const image = new window.Image(30, 40)
  image.src = `${crossOrigin}/red.png`
  await assert.rejects(window.createImageBitmap(image), {
    name: 'InvalidStateError',
  })
  await image.decode()
  const tainted = await window.createImageBitmap(image)
  assert.deepEqual([tainted.width, tainted.height], [1, 1])
  drawing.drawImage(tainted, 0, 0)
  assert.throws(() => drawing.getImageData(0, 0, 1, 1), {
    name: 'SecurityError',
  })
})

test('Offscreen snapshots clear the entire bitmap while preserving clip, path, transform and style state', async (context) => {
  // Arrange
  const { window } = await renderingWindow(context)
  const canvas = new window.OffscreenCanvas(2, 1)
  const drawing = canvas.getContext('2d')!
  drawing.fillStyle = 'red'
  drawing.fillRect(0, 0, 2, 1)
  drawing.rect(0, 0, 1, 1)
  drawing.clip()
  drawing.translate(1, 0)
  drawing.fillStyle = 'blue'
  // Act
  const bitmap = canvas.transferToImageBitmap()
  // Assert
  assert.deepEqual(
    [...drawing.getImageData(0, 0, 2, 1).data],
    [0, 0, 0, 0, 0, 0, 0, 0],
  )
  assert.equal(drawing.getTransform().e, 1)
  assert.equal(drawing.fillStyle, '#0000ff')
  drawing.fillRect(-1, 0, 2, 1)
  assert.deepEqual(
    [...drawing.getImageData(0, 0, 2, 1).data],
    [0, 0, 255, 255, 0, 0, 0, 0],
  )
  const target = new window.OffscreenCanvas(2, 1).getContext('2d')!
  target.drawImage(bitmap, 0, 0)
  assert.deepEqual(
    [...target.getImageData(0, 0, 2, 1).data],
    [255, 0, 0, 255, 255, 0, 0, 255],
  )
  assert.throws(
    () => new window.OffscreenCanvas(1, 1).transferToImageBitmap(),
    { name: 'InvalidStateError' },
  )
})
