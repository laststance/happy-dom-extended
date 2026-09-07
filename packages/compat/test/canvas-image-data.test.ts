import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ImageBitmap, ImageData } from 'happy-dom'

import { renderingWindow } from './utils/rendering-window.ts'

test('ImageData retains supplied subarrays, infers rows, and converts numeric dimensions before allocating Window pixels', async (context) => {
  // Arrange
  const { window } = await renderingWindow(context)
  const backing = new window.Uint8ClampedArray([
    1, 2, 3, 4, 255, 0, 0, 255, 0, 0, 255, 255,
  ])
  const pixels = backing.subarray(4)
  // Act
  const supplied = new window.ImageData(pixels, 1)
  const numeric: ImageData = Reflect.construct(window.ImageData, [
    { valueOf: () => 4294967297 },
    '1',
  ])
  // Assert
  assert.equal(supplied.data, pixels)
  assert.equal(supplied.width, 1)
  assert.equal(supplied.height, 2)
  assert.equal(supplied.data.byteOffset, 4)
  assert.equal(Reflect.get(supplied, 'colorSpace'), 'srgb')
  assert.equal(Reflect.get(supplied, 'pixelFormat'), 'rgba-unorm8')
  assert.ok(numeric instanceof window.ImageData)
  assert.ok(numeric.data instanceof window.Uint8ClampedArray)
  assert.deepEqual([...numeric.data], [0, 0, 0, 0])
  supplied.data[0] = 12
  assert.equal(backing[4], 12)
})

test('ImageData rejects incomplete pixels, inconsistent dimensions, detached storage and invalid settings with Window errors', async (context) => {
  // Arrange
  const { window } = await renderingWindow(context)
  const detached = new window.Uint8ClampedArray(4)
  structuredClone(detached.buffer, { transfer: [detached.buffer] })
  const cases: { argumentsList: unknown[]; name: string }[] = [
    { argumentsList: [1], name: 'TypeError' },
    { argumentsList: [0, 1], name: 'IndexSizeError' },
    {
      argumentsList: [new window.Uint8ClampedArray(0), 1],
      name: 'InvalidStateError',
    },
    {
      argumentsList: [new window.Uint8ClampedArray(3), 1],
      name: 'InvalidStateError',
    },
    {
      argumentsList: [new window.Uint8ClampedArray(12), 2],
      name: 'IndexSizeError',
    },
    {
      argumentsList: [new window.Uint8ClampedArray(8), 1, 1],
      name: 'IndexSizeError',
    },
    {
      argumentsList: [new window.Uint8ClampedArray(4), 0],
      name: 'IndexSizeError',
    },
    { argumentsList: [detached, 1], name: 'InvalidStateError' },
    { argumentsList: [1, 1, 2], name: 'TypeError' },
    { argumentsList: [0, 1, { colorSpace: 'other' }], name: 'TypeError' },
    { argumentsList: [1, 1, { pixelFormat: 'other' }], name: 'TypeError' },
    {
      argumentsList: [1, 1, { pixelFormat: 'rgba-float16' }],
      name: 'NotSupportedError',
    },
    {
      argumentsList: [
        new window.Uint8ClampedArray(4),
        1,
        1,
        { pixelFormat: 'rgba-float16' },
      ],
      name: 'InvalidStateError',
    },
    { argumentsList: [32768, 1], name: 'RangeError' },
  ]
  // Act / Assert
  for (const { argumentsList, name } of cases)
    assert.throws(
      () => Reflect.construct(window.ImageData, argumentsList),
      (error) => {
        assert.ok(
          error instanceof window.Error || error instanceof window.DOMException,
        )
        assert.equal(error.name, name)
        return true
      },
    )
})

test('ImageData settings getters run once after dimensions and before zero-size validation without swallowing consumer errors', async (context) => {
  // Arrange
  const { window } = await renderingWindow(context)
  const reads: string[] = []
  const settings = {
    get colorSpace() {
      reads.push('colorSpace')
      return 'display-p3'
    },
    get pixelFormat() {
      reads.push('pixelFormat')
      return 'rgba-unorm8'
    },
  }
  const failure = new Error('Consumer dimension conversion failed')
  // Act / Assert
  assert.throws(
    () =>
      Reflect.construct(window.ImageData, [
        {
          valueOf() {
            reads.push('width')
            return 0
          },
        },
        {
          valueOf() {
            reads.push('height')
            return 1
          },
        },
        settings,
      ]),
    { name: 'IndexSizeError' },
  )
  assert.deepEqual(reads, ['width', 'height', 'colorSpace', 'pixelFormat'])
  assert.throws(
    () =>
      Reflect.construct(window.ImageData, [
        {
          valueOf() {
            throw failure
          },
        },
        1,
      ]),
    (error) => error === failure,
  )
})

test('P3 readback, pixel replacement and Bitmap creation preserve real colors while keeping caller bytes unchanged', async (context) => {
  // Arrange
  const { window } = await renderingWindow(context)
  const drawing = new window.OffscreenCanvas(1, 1).getContext('2d')!
  drawing.fillStyle = 'red'
  drawing.fillRect(0, 0, 1, 1)
  // Act
  const p3: ImageData = Reflect.apply(drawing.getImageData, drawing, [
    0,
    0,
    1,
    1,
    { colorSpace: 'display-p3' },
  ])
  const blank = drawing.createImageData(p3)
  drawing.clearRect(0, 0, 1, 1)
  drawing.putImageData(p3, 0, 0)
  const replaced = [...drawing.getImageData(0, 0, 1, 1).data]
  const pendingBitmap: Promise<ImageBitmap> = Reflect.apply(
    window.createImageBitmap,
    window,
    [p3],
  )
  const bitmap = await pendingBitmap
  drawing.clearRect(0, 0, 1, 1)
  drawing.drawImage(bitmap, 0, 0)
  // Assert
  assert.deepEqual([...p3.data], [234, 51, 35, 255])
  assert.equal(Reflect.get(p3, 'colorSpace'), 'display-p3')
  assert.equal(Reflect.get(blank, 'colorSpace'), 'display-p3')
  assert.notEqual(blank.data, p3.data)
  assert.deepEqual([...blank.data], [0, 0, 0, 0])
  assert.deepEqual(replaced, [255, 0, 0, 255])
  assert.deepEqual([...drawing.getImageData(0, 0, 1, 1).data], [255, 0, 0, 255])
  bitmap.close()
  assert.throws(
    () =>
      Reflect.apply(drawing.getImageData, drawing, [
        0,
        0,
        1,
        1,
        { colorSpace: 'other' },
      ]),
    window.TypeError,
  )
  assert.throws(
    () =>
      Reflect.apply(drawing.createImageData, drawing, [
        1,
        1,
        { pixelFormat: 'rgba-float16' },
      ]),
    { name: 'NotSupportedError' },
  )
})

test('pixel conversion and readback refuse an exhausted raster budget and recover after the reservation is released', async (context) => {
  // Arrange
  const { window, adapter } = await renderingWindow(context)
  const drawing = new window.OffscreenCanvas(1, 1).getContext('2d')!
  const source = new window.ImageData(
    new window.Uint8ClampedArray([255, 0, 0, 255]),
    1,
  )
  const release = adapter.reserveStorage(window, 128 * 1024 * 1024 - 4)
  // Act / Assert
  assert.throws(() => drawing.getImageData(0, 0, 1, 1), window.RangeError)
  assert.throws(() => drawing.putImageData(source, 0, 0), window.RangeError)
  const pendingBitmap: Promise<ImageBitmap> = Reflect.apply(
    window.createImageBitmap,
    window,
    [source],
  )
  await assert.rejects(pendingBitmap, window.RangeError)
  release()
  drawing.putImageData(source, 0, 0)
  assert.deepEqual([...drawing.getImageData(0, 0, 1, 1).data], [255, 0, 0, 255])
})
