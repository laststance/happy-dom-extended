import { expect, test } from 'vitest'

declare global {
  var __happyDomExtendedIsolateDocument: Document | undefined
}

test('second isolate:false file sees the live document and paints blue', () => {
  // Arrange
  expect(document).toBe(globalThis.__happyDomExtendedIsolateDocument)
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const drawing = canvas.getContext('2d')!
  // Act
  drawing.fillStyle = 'blue'
  drawing.fillRect(0, 0, 1, 1)
  // Assert
  expect([...drawing.getImageData(0, 0, 1, 1).data]).toEqual([0, 0, 255, 255])
})
