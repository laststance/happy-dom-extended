import { expect, test } from 'vitest'

declare global {
  // isolate:false reuses one Window; the second file asserts this exact document.
  var __happyDomExtendedIsolateDocument: Document | undefined
}

test('first isolate:false file paints red on a Window that later files must reuse', () => {
  // Arrange
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const drawing = canvas.getContext('2d')!
  // Act
  drawing.fillStyle = 'red'
  drawing.fillRect(0, 0, 1, 1)
  globalThis.__happyDomExtendedIsolateDocument = document
  // Assert
  expect([...drawing.getImageData(0, 0, 1, 1).data]).toEqual([255, 0, 0, 255])
})
