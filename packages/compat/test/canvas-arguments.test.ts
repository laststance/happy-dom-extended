import assert from 'node:assert/strict'
import { test } from 'node:test'

import { renderingWindow } from './utils/rendering-window.ts'

test('the first context reads settings once in WebIDL order and later calls retain the original context', async (context) => {
  // Arrange
  const { window } = await renderingWindow(context)
  const reads: PropertyKey[] = []
  const settings = new Proxy(
    { alpha: false, colorSpace: 'srgb' },
    {
      get(target, key) {
        reads.push(key)
        return Reflect.get(target, key)
      },
    },
  )
  for (const canvas of [
    window.document.createElement('canvas'),
    new window.OffscreenCanvas(1, 1),
  ]) {
    reads.length = 0
    // Act
    assert.equal(
      Reflect.apply(canvas.getContext, canvas, ['unknown', settings]),
      null,
    )
    assert.throws(
      () => Reflect.apply(canvas.getContext, canvas, []),
      window.TypeError,
    )
    assert.throws(
      () => canvas.getContext('2d', { colorSpace: 'invalid' }),
      window.TypeError,
    )
    const drawing = canvas.getContext('2d', settings)!
    // Assert
    assert.deepEqual(reads, [
      'alpha',
      'colorSpace',
      'colorType',
      'desynchronized',
      'willReadFrequently',
    ])
    assert.equal(
      canvas.getContext(
        '2d',
        new Proxy(
          {},
          {
            get() {
              throw new Error('Settings were read again')
            },
          },
        ),
      ),
      drawing,
    )
    assert.deepEqual([...drawing.getImageData(0, 0, 1, 1).data], [0, 0, 0, 255])
  }
})

test('invalid rectangle and path arguments preserve pixels while throwing only the specified Window errors', async (context) => {
  // Arrange
  const { window } = await renderingWindow(context)
  const drawing = new window.OffscreenCanvas(2, 1).getContext('2d')!
  const cause = new Error('Consumer conversion failed')
  // Act / Assert
  assert.throws(
    () => Reflect.apply(drawing.fillRect, drawing, [0, 0, 1]),
    window.TypeError,
  )
  assert.throws(
    () => Reflect.apply(drawing.fillRect, drawing, [Symbol(), 0, 1, 1]),
    window.TypeError,
  )
  assert.throws(
    () =>
      Reflect.apply(drawing.fillRect, drawing, [
        {
          valueOf() {
            throw cause
          },
        },
        0,
        1,
        1,
      ]),
    (error) => error === cause,
  )
  drawing.fillRect(NaN, 0, 2, 1)
  drawing.fillRect(0, 0, Infinity, 1)
  drawing.arc(NaN, 0, -1, 0, 1)
  assert.throws(() => drawing.arc(0, 0, -1, 0, 1), { name: 'IndexSizeError' })
  assert.throws(() => drawing.createRadialGradient(0, 0, -1, 0, 0, 1), {
    name: 'IndexSizeError',
  })
  assert.throws(
    () => drawing.createLinearGradient(NaN, 0, 1, 1),
    window.TypeError,
  )
  assert.deepEqual(
    [...drawing.getImageData(0, 0, 2, 1).data],
    [0, 0, 0, 0, 0, 0, 0, 0],
  )
  Reflect.apply(drawing.fillRect, drawing, ['0', 0, true, '1'])
  assert.deepEqual(
    [...drawing.getImageData(0, 0, 2, 1).data],
    [0, 0, 0, 255, 0, 0, 0, 0],
  )
})

test('transform dictionaries preserve getter order, validate aliases and return the calling Window DOMMatrix', async (context) => {
  // Arrange
  const { window } = await renderingWindow(context)
  const drawing = new window.OffscreenCanvas(2, 1).getContext('2d')!
  const reads: PropertyKey[] = []
  const matrix = new Proxy(
    { e: 1, m41: 1 },
    {
      get(target, key) {
        reads.push(key)
        return Reflect.get(target, key)
      },
    },
  )
  // Act
  Reflect.apply(drawing.setTransform, drawing, [matrix])
  drawing.fillRect(0, 0, 1, 1)
  const transform = drawing.getTransform()
  // Assert
  assert.deepEqual(reads, [
    'a',
    'b',
    'c',
    'd',
    'e',
    'f',
    'm11',
    'm12',
    'm21',
    'm22',
    'm41',
    'm42',
  ])
  assert.ok(transform instanceof window.DOMMatrix)
  assert.equal(transform.e, 1)
  assert.deepEqual(
    [...drawing.getImageData(0, 0, 2, 1).data],
    [0, 0, 0, 0, 0, 0, 0, 255],
  )
  assert.throws(
    () => Reflect.apply(drawing.setTransform, drawing, [{ a: 1, m11: 2 }]),
    window.TypeError,
  )
  assert.throws(
    () => Reflect.apply(drawing.setTransform, drawing, [1, 2]),
    window.TypeError,
  )
  Reflect.apply(drawing.setTransform, drawing, [{ e: Infinity }])
  assert.equal(drawing.getTransform().e, 1)
  Reflect.apply(drawing.setTransform, drawing, [])
  assert.equal(drawing.getTransform().e, 0)
})

test('dash sequences, rounded rectangles and fill-rule overloads validate before changing the path', async (context) => {
  // Arrange
  const { window } = await renderingWindow(context)
  const drawing = new window.OffscreenCanvas(4, 4).getContext('2d')!
  // Act / Assert
  Reflect.apply(drawing.setLineDash, drawing, [new Set(['2', 3])])
  assert.deepEqual(drawing.getLineDash(), [2, 3])
  drawing.setLineDash([-1, 4])
  assert.deepEqual(drawing.getLineDash(), [2, 3])
  assert.throws(
    () => Reflect.apply(drawing.setLineDash, drawing, ['12']),
    window.TypeError,
  )
  assert.throws(() => drawing.roundRect(0, 0, 4, 4, []), window.RangeError)
  assert.throws(() => drawing.roundRect(0, 0, 4, 4, -1), window.RangeError)
  drawing.roundRect(NaN, 0, 4, 4, [])
  drawing.roundRect(0, 0, 4, 4, [Infinity, -1])
  assert.throws(
    () => drawing.roundRect(0, 0, 4, 4, [-1, Infinity]),
    window.RangeError,
  )
  assert.throws(
    () => Reflect.apply(drawing.roundRect, drawing, [NaN, 0, 4, 4, [Symbol()]]),
    window.TypeError,
  )
  Reflect.apply(drawing.roundRect, drawing, [0, 0, 4, 4, { x: 0, y: 0 }])
  assert.throws(
    () => Reflect.apply(drawing.fill, drawing, ['invalid']),
    window.TypeError,
  )
  assert.throws(
    () => Reflect.apply(drawing.isPointInPath, drawing, []),
    window.TypeError,
  )
  assert.equal(drawing.isPointInPath(NaN, 1), false)
  assert.equal(drawing.isPointInPath(1, 1), true)
  drawing.fill('evenodd')
  assert.deepEqual([...drawing.getImageData(1, 1, 1, 1).data], [0, 0, 0, 255])
})

test('style setters coerce once and preserve accepted values for invalid numeric and enum assignments', async (context) => {
  // Arrange
  const { window } = await renderingWindow(context)
  const drawing = new window.OffscreenCanvas(1, 1).getContext('2d')!
  let coercions = 0
  // Act
  Reflect.set(drawing, 'fillStyle', {
    toString() {
      coercions += 1
      return 'color(display-p3 1 0 0)'
    },
  })
  Reflect.set(drawing, 'globalAlpha', '0.5')
  drawing.globalAlpha = -1
  drawing.globalAlpha = NaN
  drawing.lineWidth = 2
  drawing.lineWidth = 0
  Reflect.set(drawing, 'lineCap', 'invalid')
  drawing.fillRect(0, 0, 1, 1)
  // Assert
  assert.equal(coercions, 1)
  assert.equal(drawing.globalAlpha, 0.5)
  assert.equal(drawing.lineWidth, 2)
  assert.equal(drawing.lineCap, 'butt')
  assert.throws(
    () => Reflect.set(drawing, 'fillStyle', Symbol()),
    window.TypeError,
  )
  assert.throws(() => Reflect.set(drawing, 'lineWidth', 1n), window.TypeError)
  // CPU Skia rounds half alpha down; the recorded browser comparison permits one channel level.
  assert.deepEqual([...drawing.getImageData(0, 0, 1, 1).data], [255, 0, 0, 127])
})

test('image overload conversion precedes readiness and drawing an untouched Canvas preserves its first context settings', async (context) => {
  // Arrange
  const { window } = await renderingWindow(context)
  const drawing = new window.OffscreenCanvas(1, 1).getContext('2d')!
  const untouched = window.document.createElement('canvas')
  let coercions = 0
  const coordinate = {
    valueOf() {
      coercions += 1
      return 0
    },
  }
  // Act / Assert
  assert.throws(
    () => Reflect.apply(drawing.drawImage, drawing, [{}, coordinate, 0]),
    window.TypeError,
  )
  assert.equal(coercions, 0)
  assert.throws(
    () => Reflect.apply(drawing.drawImage, drawing, [untouched, 0, 0, 1]),
    window.TypeError,
  )
  drawing.drawImage(untouched, 0, 0)
  const first = untouched.getContext('2d', { alpha: false })!
  assert.deepEqual([...first.getImageData(0, 0, 1, 1).data], [0, 0, 0, 255])
  const pixels = new window.ImageData(1, 1)
  structuredClone(pixels.data.buffer, { transfer: [pixels.data.buffer] })
  assert.throws(
    () => Reflect.apply(drawing.putImageData, drawing, [pixels, coordinate, 0]),
    { name: 'InvalidStateError' },
  )
  assert.equal(coercions, 1)
  assert.throws(
    () => drawing.putImageData(pixels, Infinity, 0),
    window.TypeError,
  )
})

test('an explicitly undefined text maximum width draws normally while null, zero and nonfinite maximum widths do not paint', async (context) => {
  // Arrange
  const { window } = await renderingWindow(context)
  const drawing = new window.OffscreenCanvas(40, 20).getContext('2d')!
  for (const method of ['fillText', 'strokeText'] as const) {
    // Act / Assert
    Reflect.apply(drawing[method], drawing, ['M', 0, 15, undefined])
    assert.equal(
      drawing
        .getImageData(0, 0, 40, 20)
        .data.some((value, index) => index % 4 === 3 && value > 0),
      true,
    )
    drawing.clearRect(0, 0, 40, 20)
    for (const maximum of [null, 0, -1, NaN, Infinity])
      Reflect.apply(drawing[method], drawing, ['M', 0, 15, maximum])
    assert.equal(
      drawing
        .getImageData(0, 0, 40, 20)
        .data.some((value, index) => index % 4 === 3 && value > 0),
      false,
    )
  }
})
