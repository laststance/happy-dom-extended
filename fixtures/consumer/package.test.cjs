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
