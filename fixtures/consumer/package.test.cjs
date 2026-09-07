const { readFileSync } = require('node:fs')

test('installed npm package runs its bundled Worker and returns real Canvas pixels through a Window MessageEvent', async () => {
  // Arrange
  const source = `onmessage = ({data: canvas}) => {
    const context = canvas.getContext('2d'); context.fillStyle = 'blue'; context.fillRect(0, 0, 1, 1);
    const bitmap = canvas.transferToImageBitmap(); postMessage(bitmap, [bitmap]);
  }`
  const url = URL.createObjectURL(new Blob([source]))
  let worker
  let bitmap
  try {
    worker = new Worker(url)
    const received = new Promise((resolve, reject) => {
      worker.onmessage = resolve
      worker.onerror = (event) => reject(new Error(event.message))
    })
    const canvas = new OffscreenCanvas(1, 1)
    // Act
    worker.postMessage(canvas, [canvas])
    const event = await received
    bitmap = event.data
    const context = new OffscreenCanvas(1, 1).getContext('2d')
    context.drawImage(event.data, 0, 0)
    // Assert
    expect(canvas.width).toBe(0)
    expect(event).toBeInstanceOf(MessageEvent)
    expect(event.data).toBeInstanceOf(ImageBitmap)
    expect([...context.getImageData(0, 0, 1, 1).data]).toEqual([0, 0, 255, 255])
  } finally {
    if (bitmap instanceof ImageBitmap) bitmap.close()
    worker?.terminate()
    URL.revokeObjectURL(url)
  }
})

test('installed npm package initializes its Web APIs in a separate consumer', async () => {
  // Arrange
  const file = new File([new Uint8Array([65, 66]).buffer], 'binary.txt')
  // Act
  const text = await file.text()
  // Assert
  expect(text).toBe('AB')
  expect(file).toBeInstanceOf(Blob)
  expect(await new Blob(['\uFEFFcsv']).text()).toBe('csv')
  expect(structuredClone({ count: 3 })).toEqual({ count: 3 })
  expect(new CompositionEvent('compositionend', { data: 'あ' }).data).toBe('あ')
  expect(new XMLHttpRequest().DONE).toBe(4)
})

test('installed npm package snapshots ImageData and decodes a Blob URL with the consumer Window constructors', async () => {
  // Arrange
  const pixels = new ImageData(new Uint8ClampedArray([0, 0, 255, 255]), 1)
  const pending = createImageBitmap(pixels)
  pixels.data.fill(0)
  // Act
  const bitmap = await pending
  let url
  try {
    const drawing = new OffscreenCanvas(1, 1).getContext('2d')
    drawing.drawImage(bitmap, 0, 0)
    url = URL.createObjectURL(await drawing.canvas.convertToBlob())
    const image = new Image()
    image.src = url
    await image.decode()
    drawing.drawImage(image, 0, 0)
    // Assert
    expect(pending).toBeInstanceOf(Promise)
    expect(bitmap).toBeInstanceOf(ImageBitmap)
    expect([...drawing.getImageData(0, 0, 1, 1).data]).toEqual([0, 0, 255, 255])
    expect(() =>
      Reflect.apply(drawing.fillRect, drawing, [1n, 0, 1, 1]),
    ).toThrow(TypeError)
  } finally {
    bitmap.close()
    if (url) URL.revokeObjectURL(url)
  }
})

test('installed npm package decodes and seeks actual Blob video frames with Window promises', async () => {
  // Arrange
  const bytes = readFileSync(require.resolve('./red-blue.webm'))
  const url = URL.createObjectURL(
    new Blob([new Uint8Array(bytes)], { type: 'video/webm' }),
  )
  const video = document.createElement('video')
  try {
    const loaded = new Promise((resolve, reject) => {
      video.onloadeddata = resolve
      video.onerror = () => reject(new Error(video.error?.message))
    })
    // Act
    video.src = url
    await loaded
    const seeked = new Promise((resolve) => {
      video.onseeked = resolve
    })
    video.currentTime = 1.1
    await seeked
    const drawing = new OffscreenCanvas(1, 1).getContext('2d')
    drawing.drawImage(video, 0, 0)
    // Assert
    expect([video.videoWidth, video.videoHeight, video.currentTime]).toEqual([
      16, 16, 1.1,
    ])
    const pixel = drawing.getImageData(0, 0, 1, 1).data
    // FFmpeg builds vary by up to two RGB byte levels; frame color and opacity remain observable.
    for (const [index, expected] of [0, 0, 255, 255].entries())
      expect(Math.abs(pixel[index] - expected)).toBeLessThanOrEqual(
        index === 3 ? 0 : 2,
      )
    const playing = video.play()
    expect(playing).toBeInstanceOf(Promise)
    await playing
    video.pause()
    expect(() => {
      video.currentTime = Infinity
    }).toThrow(TypeError)
  } finally {
    video.pause()
    video.removeAttribute('src')
    URL.revokeObjectURL(url)
  }
})

test('installed npm package transfers real Canvas ownership with native buffer detachment', () => {
  // Arrange
  const source = new OffscreenCanvas(1, 1)
  const pixels = new Uint8Array([2, 3, 5])
  // Act
  const receiver = structuredClone(source, { transfer: [source] })
  const drawing = receiver.getContext('2d')
  drawing.fillStyle = 'blue'
  drawing.fillRect(0, 0, 1, 1)
  const bitmap = receiver.transferToImageBitmap()
  let moved
  try {
    moved = structuredClone(
      { bitmap, pixels },
      { transfer: [bitmap, pixels.buffer] },
    )
    drawing.drawImage(moved.bitmap, 0, 0)
    // Assert
    expect(receiver).toBeInstanceOf(OffscreenCanvas)
    expect(moved.bitmap).toBeInstanceOf(ImageBitmap)
    expect(source.width).toBe(0)
    expect(bitmap.width).toBe(0)
    expect(pixels.byteLength).toBe(0)
    expect([...moved.pixels]).toEqual([2, 3, 5])
    expect([...drawing.getImageData(0, 0, 1, 1).data]).toEqual([0, 0, 255, 255])
  } finally {
    moved?.bitmap.close()
    bitmap.close()
  }
})
