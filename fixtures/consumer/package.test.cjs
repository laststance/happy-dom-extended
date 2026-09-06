const { installCanvasStub } = require('jest-happy-dom-extended/canvas')

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

test('installed canvas subpath exposes its opt-in helper', () => {
  // Arrange
  const stub = installCanvasStub({ dataURL: 'data:image/png;base64,AA==' })
  // Act
  const dataURL = document.createElement('canvas').toDataURL()
  stub.restore()
  // Assert
  expect(dataURL).toBe('data:image/png;base64,AA==')
})
