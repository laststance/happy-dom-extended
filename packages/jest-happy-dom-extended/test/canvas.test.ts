import { expect, jest, test } from '@jest/globals'

test('P3 ImageData keeps Jest VM arrays and real colors through readback and pixel replacement', () => {
  // Arrange
  const drawing = new OffscreenCanvas(1, 1).getContext('2d')!
  drawing.fillStyle = 'red'
  drawing.fillRect(0, 0, 1, 1)
  // Act
  const pixels = drawing.getImageData(0, 0, 1, 1, { colorSpace: 'display-p3' })
  const blank = new ImageData(1, 1)
  drawing.putImageData(pixels, 0, 0)
  // Assert
  expect(pixels).toBeInstanceOf(ImageData)
  expect(pixels.data).toBeInstanceOf(Uint8ClampedArray)
  expect(blank.data).toBeInstanceOf(Uint8ClampedArray)
  expect(pixels.colorSpace).toBe('display-p3')
  expect([...pixels.data]).toEqual([234, 51, 35, 255])
  expect([...blank.data]).toEqual([0, 0, 0, 0])
  expect([...drawing.getImageData(0, 0, 1, 1).data]).toEqual([255, 0, 0, 255])
  expect(() => new ImageData(new Uint8ClampedArray(3), 1)).toThrow(DOMException)
})

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
  // Assert: an active spy observes the call and still draws the requested pixels.
  expect(spy).toHaveBeenCalledWith(0, 0, 1, 1)
  expect([...drawing.getImageData(0, 0, 1, 1).data]).toEqual([0, 0, 255, 255])
  // Act: restoring the spy keeps the original drawing implementation usable.
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

test('bitmap creation, decoded Blob URLs and binding failures retain the Jest Window realm', async () => {
  // Arrange
  const pixels = new ImageData(new Uint8ClampedArray([255, 0, 0, 255]), 1)
  const pending = createImageBitmap(pixels)
  const drawing = new OffscreenCanvas(1, 1).getContext('2d')!
  // Act
  const bitmap = await pending
  drawing.drawImage(bitmap, 0, 0)
  const blob = await drawing.canvas.convertToBlob()
  const url = URL.createObjectURL(blob)
  const image = new Image()
  image.src = url
  const decoded = image.decode()
  await decoded
  drawing.drawImage(image, 0, 0)
  // Assert
  expect(pending).toBeInstanceOf(Promise)
  expect(decoded).toBeInstanceOf(Promise)
  expect(bitmap).toBeInstanceOf(ImageBitmap)
  expect(drawing.getTransform()).toBeInstanceOf(DOMMatrix)
  expect([...drawing.getImageData(0, 0, 1, 1).data]).toEqual([255, 0, 0, 255])
  expect(() =>
    Reflect.apply(drawing.fillRect, drawing, [Symbol(), 0, 1, 1]),
  ).toThrow(TypeError)
  await expect(
    createImageBitmap(pixels, { resizeWidth: -1 }),
  ).rejects.toBeInstanceOf(TypeError)
  bitmap.close()
  URL.revokeObjectURL(url)
})

test('structured Canvas transfers keep Jest Window brands and detach the original canvas and bitmap', () => {
  // Arrange
  const source = new OffscreenCanvas(1, 1)
  // Act
  const receiver = structuredClone(source, { transfer: [source] })
  const drawing = receiver.getContext('2d')!
  drawing.fillStyle = 'red'
  drawing.fillRect(0, 0, 1, 1)
  const bitmap = receiver.transferToImageBitmap()
  const moved = structuredClone(
    { bitmap, alias: bitmap },
    { transfer: [bitmap] },
  )
  drawing.drawImage(moved.bitmap, 0, 0)
  // Assert
  expect(receiver).toBeInstanceOf(OffscreenCanvas)
  expect(moved.bitmap).toBeInstanceOf(ImageBitmap)
  expect(moved.alias).toBe(moved.bitmap)
  expect(source.width).toBe(0)
  expect(bitmap.width).toBe(0)
  expect([...drawing.getImageData(0, 0, 1, 1).data]).toEqual([255, 0, 0, 255])
  expect(() => structuredClone(bitmap)).toThrow(DOMException)
  moved.bitmap.close()
})
