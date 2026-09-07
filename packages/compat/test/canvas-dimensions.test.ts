import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Window } from 'happy-dom'

import { installCompatibility } from '../src/index.ts'

import { renderingWindow } from './utils/rendering-window.ts'

for (const alias of ['value', 'nodeValue', 'textContent'] as const) {
  test(`changing Canvas dimensions through Attr.${alias} clears pixels, clip, path and state while retaining the context`, async (context) => {
    // Arrange
    const { window } = await renderingWindow(context)
    const canvas = window.document.createElement('canvas')
    canvas.width = 2
    canvas.height = 1
    const drawing = canvas.getContext('2d')!
    drawing.fillStyle = 'red'
    drawing.fillRect(0, 0, 2, 1)
    drawing.rect(1, 0, 1, 1)
    drawing.clip()
    drawing.translate(1, 0)
    drawing.globalAlpha = 0.5
    // Act
    const attribute = canvas.getAttributeNode('width')!
    Reflect.set(attribute, alias, '1')
    // Assert
    assert.equal(canvas.width, 1)
    assert.equal(canvas.getAttributeNode('width'), attribute)
    assert.equal(attribute.value, '1')
    assert.equal(drawing.globalAlpha, 1)
    assert.equal(drawing.fillStyle, '#000000')
    assert.deepEqual([...drawing.getImageData(0, 0, 1, 1).data], [0, 0, 0, 0])
    drawing.fill()
    assert.deepEqual([...drawing.getImageData(0, 0, 1, 1).data], [0, 0, 0, 0])
    drawing.fillRect(0, 0, 1, 1)
    assert.deepEqual([...drawing.getImageData(0, 0, 1, 1).data], [0, 0, 0, 255])
    assert.equal(canvas.getContext('2d'), drawing)
    Reflect.set(attribute, alias, '1')
    assert.deepEqual([...drawing.getImageData(0, 0, 1, 1).data], [0, 0, 0, 0])
  })
}

test('HTML Canvas dimensions use browser IDL conversion before the first rendering context exists', async (context) => {
  // Arrange
  const { window } = await renderingWindow(context)
  const canvas = window.document.createElement('canvas')
  const cases = [
    { value: -1, expected: 300, attribute: '300' },
    { value: 1.9, expected: 1, attribute: '1' },
    { value: NaN, expected: 0, attribute: '0' },
    { value: Infinity, expected: 0, attribute: '0' },
    { value: null, expected: 0, attribute: '0' },
    { value: undefined, expected: 0, attribute: '0' },
    { value: '2', expected: 2, attribute: '2' },
    { value: 4_294_967_296, expected: 0, attribute: '0' },
    { value: 4_294_967_297, expected: 1, attribute: '1' },
  ]
  for (const { value, expected, attribute } of cases) {
    // Act
    Reflect.set(canvas, 'width', value)
    // Assert
    assert.equal(canvas.width, expected)
    assert.equal(canvas.getAttribute('width'), attribute)
  }
  assert.throws(() => Reflect.set(canvas, 'width', Symbol()), window.TypeError)
  assert.throws(() => Reflect.set(canvas, 'height', 1n), window.TypeError)
  const failure = new Error('Consumer numeric conversion failed')
  assert.throws(
    () =>
      Reflect.set(canvas, 'width', {
        valueOf() {
          throw failure
        },
      }),
    (error) => error === failure,
  )
})

test('HTML content attributes parse nonnegative integers independently from property conversion', async (context) => {
  // Arrange
  const { window } = await renderingWindow(context)
  const canvas = window.document.createElement('canvas')
  for (const [attribute, expected] of [
    ['-1', 300],
    ['+2', 2],
    [' 3px', 3],
    ['1.9', 1],
    ['1e2', 1],
    ['0x10', 0],
    ['', 300],
    ['NaN', 300],
    ['2147483648', 300],
  ] as const) {
    // Act
    canvas.setAttribute('width', attribute)
    // Assert
    assert.equal(canvas.width, expected)
  }
  canvas.setAttribute('height', '-1')
  assert.equal(canvas.height, 150)
})

test('Offscreen dimensions reject invalid unsigned values both before and after context creation', async (context) => {
  // Arrange
  const { window } = await renderingWindow(context)
  const invalid = [-1, NaN, Infinity, undefined, 4_294_967_296, Symbol(), 1n]
  for (const value of invalid) {
    // Act / Assert
    assert.throws(
      () => Reflect.construct(window.OffscreenCanvas, [value, 1]),
      window.TypeError,
    )
  }
  assert.throws(
    () => Reflect.construct(window.OffscreenCanvas, [1]),
    window.TypeError,
  )
  const canvas = new window.OffscreenCanvas(2, 1)
  for (const createContext of [false, true]) {
    const drawing = createContext ? canvas.getContext('2d') : null
    for (const value of invalid) {
      assert.throws(() => Reflect.set(canvas, 'width', value), window.TypeError)
      assert.equal(canvas.width, 2)
    }
    drawing?.fillRect(0, 0, 1, 1)
  }
  Reflect.set(canvas, 'width', 1.9)
  assert.equal(canvas.width, 1)
  assert.deepEqual(
    [...canvas.getContext('2d')!.getImageData(0, 0, 1, 1).data],
    [0, 0, 0, 0],
  )
})

test('shared dimension hooks keep a surviving Window and adopted canvas usable after the first Window closes', async (context) => {
  // Arrange
  const first = await renderingWindow(context)
  const second = await renderingWindow(context)
  const third = new Window()
  context.after(async () => third.happyDOM.close())
  const untouched = third.document.createElement('canvas')
  Reflect.set(untouched, 'width', -1)
  assert.equal(untouched.width, -1)
  const canvas = second.window.document.createElement('canvas')
  canvas.width = 2
  canvas.height = 1
  const drawing = canvas.getContext('2d')!
  drawing.fillRect(0, 0, 1, 1)
  // Act
  await first.close()
  canvas.getAttributeNode('width')!.value = '1'
  // Assert
  assert.deepEqual([...drawing.getImageData(0, 0, 1, 1).data], [0, 0, 0, 0])
  const adopted = third.document.adoptNode(canvas)
  assert.equal(adopted, canvas)
  drawing.fillRect(0, 0, 1, 1)
  adopted.getAttributeNode('width')!.value = '1'
  assert.deepEqual([...drawing.getImageData(0, 0, 1, 1).data], [0, 0, 0, 0])
})

test('detached and namespaced Attr mutations cannot reset an unrelated Canvas bitmap', async (context) => {
  // Arrange
  const { window } = await renderingWindow(context)
  const canvas = window.document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const drawing = canvas.getContext('2d')!
  const detached = canvas.removeAttributeNode(canvas.getAttributeNode('width')!)
  assert.ok(detached)
  drawing.fillRect(0, 0, 1, 1)
  // Act
  detached.nodeValue = '2'
  canvas.setAttributeNS('urn:canvas-test', 'width', '3')
  canvas.getAttributeNodeNS('urn:canvas-test', 'width')!.value = '4'
  // Assert
  assert.equal(detached.value, '2')
  assert.equal(canvas.width, 300)
  assert.deepEqual([...drawing.getImageData(0, 0, 1, 1).data], [0, 0, 0, 255])
})

test('a rejected native size clears stale pixels and a subsequent supported size restores rendering', async (context) => {
  // Arrange
  const { window } = await renderingWindow(context)
  const canvas = new window.OffscreenCanvas(1, 1)
  const drawing = canvas.getContext('2d')!
  drawing.fillRect(0, 0, 1, 1)
  // Act / Assert
  assert.throws(() => Reflect.set(canvas, 'width', 32_768), window.RangeError)
  assert.equal(canvas.width, 32_768)
  assert.throws(() => drawing.getImageData(0, 0, 1, 1), {
    name: 'InvalidStateError',
  })
  Reflect.set(canvas, 'width', 1)
  assert.deepEqual([...drawing.getImageData(0, 0, 1, 1).data], [0, 0, 0, 0])
  drawing.fillRect(0, 0, 1, 1)
  assert.deepEqual([...drawing.getImageData(0, 0, 1, 1).data], [0, 0, 0, 255])
})

test('disabled Canvas adapters keep their original dimension and Attr behavior after compatibility installation', async (context) => {
  // Arrange
  const window = new Window({ settings: { canvasAdapter: null } })
  const dispose = installCompatibility(window)
  context.after(async () => {
    dispose()
    await window.happyDOM.close()
  })
  // Act
  const canvas = window.document.createElement('canvas')
  Reflect.set(canvas, 'width', -1)
  // Assert
  assert.equal(canvas.width, -1)
  assert.equal(canvas.getContext('2d'), null)
})
