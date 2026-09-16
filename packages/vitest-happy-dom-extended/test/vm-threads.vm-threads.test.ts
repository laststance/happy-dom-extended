import { expect, test } from 'vitest'

test('vmThreads setupVM paints real Canvas pixels on the VM context Window', () => {
  // Arrange
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const drawing = canvas.getContext('2d')!
  // Act
  drawing.fillStyle = 'red'
  drawing.fillRect(0, 0, 1, 1)
  // Assert
  expect([...drawing.getImageData(0, 0, 1, 1).data]).toEqual([255, 0, 0, 255])
  expect(window.location.href).toBe('http://localhost:3000/')
})
