const { PNG } = require('pngjs')

test('installed OffscreenCanvas resets its retained context and exports the new dimensions', async () => {
  // Arrange
  const canvas = new OffscreenCanvas(1, 1)
  const drawing = canvas.getContext('2d')
  drawing.fillStyle = 'red'
  drawing.fillRect(0, 0, 1, 1)
  // Act
  canvas.width = 2
  drawing.fillStyle = 'blue'
  drawing.fillRect(1, 0, 1, 1)
  const blob = await canvas.convertToBlob()
  const png = PNG.sync.read(Buffer.from(await blob.arrayBuffer()))
  // Assert
  expect(drawing.canvas).toBe(canvas)
  expect(png.width).toBe(2)
  expect(png.height).toBe(1)
  expect([...png.data]).toEqual([0, 0, 0, 0, 0, 0, 255, 255])
})

test('installed OffscreenCanvas preserves an export snapshot and rejects empty bitmaps', async () => {
  // Arrange
  const canvas = new OffscreenCanvas(1, 1)
  const drawing = canvas.getContext('2d')
  drawing.fillStyle = 'red'
  drawing.fillRect(0, 0, 1, 1)
  // Act
  const pending = canvas.convertToBlob({ type: 'image/unsupported' })
  canvas.width = 0
  const blob = await pending
  const png = PNG.sync.read(Buffer.from(await blob.arrayBuffer()))
  // Assert
  expect(blob.type).toBe('image/png')
  expect([...png.data]).toEqual([255, 0, 0, 255])
  await expect(canvas.convertToBlob()).rejects.toMatchObject({
    name: 'IndexSizeError',
  })
})
