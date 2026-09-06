const { PNG } = require('pngjs')

test('installed Canvas encodes the actual VM pixels into a PNG with matching dimensions', async () => {
  // Arrange
  const canvas = document.createElement('canvas')
  canvas.width = 2
  canvas.height = 1
  const drawing = canvas.getContext('2d')
  const bytes = new Uint8ClampedArray([
    9, 9, 9, 9, 255, 0, 0, 255, 0, 0, 255, 255,
  ])
  const input = new ImageData(bytes.subarray(4), 2, 1)
  // Act
  drawing.putImageData(input, 0, 0)
  const blob = await new Promise((resolve) => canvas.toBlob(resolve))
  const png = PNG.sync.read(Buffer.from(await blob.arrayBuffer()))
  // Assert
  expect(drawing.canvas).toBe(canvas)
  expect(png.width).toBe(2)
  expect(png.height).toBe(1)
  expect([...png.data]).toEqual([255, 0, 0, 255, 0, 0, 255, 255])
  expect(drawing.getImageData(0, 0, 2, 1)).toBeInstanceOf(ImageData)
  expect(drawing.getImageData(0, 0, 2, 1).data).toBeInstanceOf(
    Uint8ClampedArray,
  )
})

test('installed Canvas retains the invocation pixels while another drawing replaces its bitmap', async () => {
  // Arrange
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const drawing = canvas.getContext('2d')
  drawing.fillStyle = 'red'
  drawing.fillRect(0, 0, 1, 1)
  // Act
  const pending = new Promise((resolve) =>
    canvas.toBlob(resolve, 'image/unknown'),
  )
  canvas.width = 2
  drawing.fillStyle = 'blue'
  drawing.fillRect(0, 0, 2, 1)
  const blob = await pending
  const png = PNG.sync.read(Buffer.from(await blob.arrayBuffer()))
  // Assert
  expect(blob.type).toBe('image/png')
  expect(png.width).toBe(1)
  expect(png.height).toBe(1)
  expect([...png.data]).toEqual([255, 0, 0, 255])
  expect([...drawing.getImageData(1, 0, 1, 1).data]).toEqual([0, 0, 255, 255])
})

test('installed Canvas JPEG output loads through Image and draws decodable red pixels', async () => {
  // Arrange
  const canvas = document.createElement('canvas')
  canvas.width = 2
  canvas.height = 2
  const drawing = canvas.getContext('2d')
  drawing.fillStyle = 'red'
  drawing.fillRect(0, 0, 2, 2)
  const image = new Image()
  const loaded = new Promise((resolve, reject) => {
    image.onload = resolve
    image.onerror = reject
  })
  // Act
  image.src = canvas.toDataURL('image/jpeg')
  await loaded
  drawing.clearRect(0, 0, 2, 2)
  drawing.drawImage(image, 0, 0)
  const pixel = drawing.getImageData(0, 0, 1, 1).data
  // Assert
  expect(image.naturalWidth).toBe(2)
  expect(image.naturalHeight).toBe(2)
  expect(Math.abs(pixel[0] - 255)).toBeLessThanOrEqual(3)
  expect(pixel[1]).toBeLessThanOrEqual(3)
  expect(pixel[2]).toBeLessThanOrEqual(3)
  expect(pixel[3]).toBe(255)
})
