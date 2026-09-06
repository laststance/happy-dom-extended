import { expect, test } from '@jest/globals'

import { installCanvasStub } from '../dist/canvas.cjs'

test('the opt-in canvas helper records pixel handoff and restores the original methods', () => {
  // Arrange
  const originalGetContext = HTMLCanvasElement.prototype.getContext
  const originalToDataURL = HTMLCanvasElement.prototype.toDataURL
  const stub = installCanvasStub({ dataURL: 'data:image/png;base64,AA==' })
  const canvas = document.createElement('canvas')
  const pixels = new ImageData(new Uint8ClampedArray([255, 0, 0, 255]), 1, 1)
  try {
    // Act
    const context = canvas.getContext('2d')
    context?.putImageData(pixels, 2, 3)
    // Assert
    expect(context).toBe(canvas.getContext('2d'))
    expect(canvas.getContext('webgl')).toBeNull()
    expect(canvas.toDataURL()).toBe('data:image/png;base64,AA==')
    expect(stub.putImageDataCalls).toEqual([
      { canvas, imageData: pixels, dx: 2, dy: 3 },
    ])
  } finally {
    stub.restore()
  }
  expect(HTMLCanvasElement.prototype.getContext).toBe(originalGetContext)
  expect(HTMLCanvasElement.prototype.toDataURL).toBe(originalToDataURL)
})

test('failed canvas initialization restores getContext when toDataURL cannot be patched', () => {
  // Arrange
  const originalGetContext = () => null
  const prototype = { getContext: originalGetContext }
  Object.defineProperty(prototype, 'toDataURL', {
    configurable: false,
    value: () => 'data:,',
  })
  const window = { HTMLCanvasElement: { prototype } }

  // Act
  expect(() =>
    installCanvasStub({ dataURL: 'data:image/png;base64,AA==' }, window),
  ).toThrow(TypeError)

  // Assert
  expect(Object.getOwnPropertyDescriptor(prototype, 'getContext')).toEqual({
    configurable: true,
    enumerable: true,
    writable: true,
    value: originalGetContext,
  })
})
