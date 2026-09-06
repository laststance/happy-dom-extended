import { expect, jest, test } from '@jest/globals'

test('Canvas draws ImageData from Jest VM subarrays and returns the same Window image family', () => {
  // Arrange
  const canvas = document.createElement('canvas')
  canvas.width = 2
  canvas.height = 1
  const drawing = canvas.getContext('2d')!
  const bytes = new Uint8ClampedArray([9, 9, 9, 9, 255, 0, 0, 255])
  const pixels = bytes.subarray(4)
  const input = new ImageData(pixels, 1, 1)
  // Act
  drawing.putImageData(input, 1, 0)
  const output = drawing.getImageData(0, 0, 2, 1)
  // Assert
  expect(input.data).toBe(pixels)
  expect(output).toBeInstanceOf(ImageData)
  expect(output.data).toBeInstanceOf(Uint8ClampedArray)
  expect([...output.data]).toEqual([0, 0, 0, 0, 255, 0, 0, 255])
  expect(drawing.canvas).toBe(canvas)
  expect(drawing.createImageData(1, 1)).toBeInstanceOf(ImageData)
})

test('Consumers can spy on real Canvas methods and restore drawing without replacing the context', () => {
  // Arrange
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const drawing = canvas.getContext('2d')!
  const spy = jest.spyOn(drawing, 'fillRect')
  // Act
  drawing.fillStyle = 'blue'
  drawing.fillRect(0, 0, 1, 1)
  spy.mockRestore()
  drawing.fillStyle = 'red'
  drawing.fillRect(0, 0, 1, 1)
  // Assert
  expect([...drawing.getImageData(0, 0, 1, 1).data]).toEqual([255, 0, 0, 255])
  expect(canvas.getContext('2d')).toBe(drawing)
})

test('Real Canvas output completes even while Jest fake timers are enabled', async () => {
  // Arrange
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  jest.useFakeTimers()
  try {
    // Act
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve),
    )
    // Assert
    expect(blob).toBeInstanceOf(Blob)
    expect(blob?.type).toBe('image/png')
    expect(blob?.size).toBeGreaterThan(0)
  } finally {
    jest.useRealTimers()
  }
})

test('Restoring Canvas method descriptors preserves Window ImageData and source Canvas drawing', () => {
  // Arrange
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const drawing = canvas.getContext('2d')!
  const imageDescriptor = Object.getOwnPropertyDescriptor(
    drawing,
    'createImageData',
  )!
  const drawDescriptor = Object.getOwnPropertyDescriptor(drawing, 'drawImage')!
  const putDescriptor = Object.getOwnPropertyDescriptor(
    drawing,
    'putImageData',
  )!
  const replacement = jest.fn<typeof drawing.createImageData>(
    () => new ImageData(1, 1),
  )
  Object.defineProperty(drawing, 'createImageData', { value: replacement })
  Object.defineProperty(drawing, 'drawImage', { value: jest.fn() })
  Object.defineProperty(drawing, 'putImageData', { value: jest.fn() })

  // Act / Assert: consumer overrides stay observable before restoration.
  expect(drawing.createImageData).toBe(replacement)
  drawing.createImageData(1, 1)
  expect(replacement).toHaveBeenCalledWith(1, 1)
  Object.defineProperty(drawing, 'createImageData', imageDescriptor)
  Object.defineProperty(drawing, 'drawImage', drawDescriptor)
  Object.defineProperty(drawing, 'putImageData', putDescriptor)

  // Assert: restoring raw adapter descriptors still goes through compatibility.
  const pixels = drawing.createImageData(1, 1)
  expect(pixels).toBeInstanceOf(ImageData)
  expect(pixels.data).toBeInstanceOf(Uint8ClampedArray)
  pixels.data.set([255, 0, 0, 255])
  drawing.putImageData(pixels, 0, 0)
  expect([...drawing.getImageData(0, 0, 1, 1).data]).toEqual([255, 0, 0, 255])
  const source = document.createElement('canvas')
  source.width = 1
  source.height = 1
  const sourceDrawing = source.getContext('2d')!
  sourceDrawing.fillStyle = 'blue'
  sourceDrawing.fillRect(0, 0, 1, 1)
  drawing.drawImage(source, 0, 0)
  expect([...drawing.getImageData(0, 0, 1, 1).data]).toEqual([0, 0, 255, 255])
  const restored = drawing.createImageData
  drawing.createImageData = restored
  expect(drawing.createImageData).toBe(restored)
})
