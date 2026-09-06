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

test('a second canvas helper cannot replace an active helper or capture its calls', () => {
  // Arrange
  const stub = installCanvasStub({ dataURL: 'data:image/png;base64,AA==' })
  const canvas = document.createElement('canvas')
  const pixels = new ImageData(new Uint8ClampedArray([0, 255, 0, 255]), 1, 1)
  try {
    // Act
    expect(() => {
      const unexpectedStub = installCanvasStub({
        dataURL: 'data:image/png;base64,AQ==',
      })
      unexpectedStub.restore()
    }).toThrow('A Canvas stub is already installed for this prototype')
    canvas.getContext('2d')?.putImageData(pixels, 1, 2)

    // Assert
    expect(canvas.toDataURL()).toBe('data:image/png;base64,AA==')
    expect(stub.putImageDataCalls).toEqual([
      { canvas, imageData: pixels, dx: 1, dy: 2 },
    ])
  } finally {
    stub.restore()
  }
})

test('restoring an old canvas helper again cannot unlock a newer installation', () => {
  // Arrange
  const previousStub = installCanvasStub({
    dataURL: 'data:image/png;base64,AA==',
  })
  previousStub.restore()
  const currentStub = installCanvasStub({
    dataURL: 'data:image/png;base64,AQ==',
  })
  try {
    // Act
    previousStub.restore()

    // Assert
    expect(document.createElement('canvas').toDataURL()).toBe(
      'data:image/png;base64,AQ==',
    )
    expect(() => {
      const unexpectedStub = installCanvasStub({
        dataURL: 'data:image/png;base64,Ag==',
      })
      unexpectedStub.restore()
    }).toThrow('A Canvas stub is already installed for this prototype')
  } finally {
    currentStub.restore()
  }
})
