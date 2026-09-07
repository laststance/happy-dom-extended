import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { ServerResponse } from 'node:http'
import { test } from 'node:test'

import { Window } from 'happy-dom'
import { Image } from 'skia-canvas'

import { fetchCanvasResource } from '../src/canvas/resource-fetch.ts'

import { imageServers } from './utils/image-servers.ts'
import { renderingWindow } from './utils/rendering-window.ts'

test('foreign decoded image bytes without verified origin metadata taint Canvas exports and patterns', async (context) => {
  // Arrange
  const { origin, crossOrigin } = await imageServers(context)
  const foreign = new Window({
    url: crossOrigin,
    settings: { enableImageFileLoading: true },
  })
  context.after(async () => foreign.happyDOM.close())
  const { window } = await renderingWindow(context)
  window.happyDOM.setURL(origin)
  const image = new foreign.Image()
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('Foreign image did not load'))
  })
  image.src = `${crossOrigin}/red.png`
  await loaded
  const canvas = window.document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const drawing = canvas.getContext('2d')!
  // Act
  drawing.drawImage(image, 0, 0)
  const patterned = new window.OffscreenCanvas(1, 1)
  const patternContext = patterned.getContext('2d')!
  patternContext.fillStyle = patternContext.createPattern(image, 'repeat')!
  // Assert
  assert.equal(image.naturalWidth, 1)
  assert.throws(() => drawing.getImageData(0, 0, 1, 1), {
    name: 'SecurityError',
  })
  assert.throws(() => canvas.toDataURL(), { name: 'SecurityError' })
  await assert.rejects(patterned.convertToBlob(), { name: 'SecurityError' })
})

test('undefined image and video CORS settings remove the attribute and restore the no-CORS mode', async (context) => {
  // Arrange
  const { window } = await renderingWindow(context)
  for (const media of [
    new window.Image(),
    window.document.createElement('video'),
  ]) {
    media.crossOrigin = 'anonymous'
    // Act
    Reflect.set(media, 'crossOrigin', undefined)
    // Assert
    assert.equal(media.hasAttribute('crossorigin'), false)
    assert.equal(media.crossOrigin, null)
  }
})

test('rejecting response cancellation preserves media status, byte-limit, CORS and redirect errors', async (context) => {
  // Arrange
  const { window } = await renderingWindow(context)
  window.happyDOM.setURL('https://media.test')
  const cases = [
    {
      status: 503,
      headers: {},
      crossOrigin: null,
      name: 'NetworkError',
      message: 'The media request failed.',
    },
    {
      status: 200,
      headers: { 'content-length': '67108865' },
      crossOrigin: null,
      name: 'RangeError',
      message: 'Media input exceeds the byte limit.',
    },
    {
      status: 200,
      headers: {},
      crossOrigin: 'anonymous',
      name: 'NetworkError',
      message: 'The media response failed its CORS check.',
    },
    {
      status: 302,
      headers: {},
      crossOrigin: null,
      name: 'NetworkError',
      message: 'The media redirect has no location.',
    },
    {
      status: 302,
      headers: { location: 'http://[invalid' },
      crossOrigin: null,
      name: 'NetworkError',
      message: 'The media redirect URL is invalid.',
    },
  ]
  let cancellations = 0
  for (const { status, headers, crossOrigin, name, message } of cases) {
    const body = new window.ReadableStream({
      cancel() {
        cancellations += 1
        throw new Error('Cancellation failed')
      },
    })
    window.happyDOM.settings.fetch.interceptor = {
      beforeAsyncRequest: async () =>
        new window.Response(body, { status, headers }),
    }
    // Act / Assert
    await assert.rejects(
      fetchCanvasResource(
        window,
        'https://other.test/image.png',
        crossOrigin,
        new window.AbortController().signal,
      ),
      { name, message },
    )
  }
  assert.equal(cancellations, 5)
})

test('a loading image never paints later and decoded intrinsic pixels ignore HTML width and height attributes', async (context) => {
  // Arrange
  const { origin } = await imageServers(context)
  const { window } = await renderingWindow(context)
  window.happyDOM.setURL(origin)
  const image = new window.Image(30, 40)
  const drawing = new window.OffscreenCanvas(1, 1).getContext('2d')!
  image.src = `${origin}/slow.png`
  // Act
  drawing.drawImage(image, 0, 0)
  assert.equal(drawing.createPattern(image, 'repeat'), null)
  assert.equal(
    Reflect.apply(drawing.createPattern, drawing, [image, 'invalid']),
    null,
  )
  assert.equal(image.complete, false)
  await image.decode()
  // Assert
  assert.equal(image.complete, true)
  assert.deepEqual(
    [image.naturalWidth, image.naturalHeight, image.width, image.height],
    [1, 1, 30, 40],
  )
  assert.deepEqual([...drawing.getImageData(0, 0, 1, 1).data], [0, 0, 0, 0])
  drawing.drawImage(image, 0, 0)
  assert.deepEqual([...drawing.getImageData(0, 0, 1, 1).data], [255, 0, 0, 255])
})

test('non-CORS and redirected images load real pixels but taint Canvas readback, outputs, copied canvases and patterns', async (context) => {
  // Arrange
  const { origin, crossOrigin, requests } = await imageServers(context)
  const { window } = await renderingWindow(context)
  window.happyDOM.setURL(origin)
  for (const source of [`${crossOrigin}/red.png`, `${origin}/redirect.png`]) {
    const image = new window.Image()
    image.src = source
    await image.decode()
    const canvas = window.document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const drawing = canvas.getContext('2d')!
    // Act
    drawing.drawImage(image, 0, 0)
    // Assert
    assert.throws(() => drawing.getImageData(0, 0, 1, 1), {
      name: 'SecurityError',
    })
    assert.throws(() => canvas.toDataURL(), { name: 'SecurityError' })
    assert.throws(() => canvas.toBlob(() => {}), { name: 'SecurityError' })
    const copied = new window.OffscreenCanvas(1, 1)
    const target = copied.getContext('2d')!
    target.drawImage(canvas, 0, 0)
    await assert.rejects(copied.convertToBlob(), { name: 'SecurityError' })
    Reflect.get(target, 'reset')()
    assert.deepEqual([...target.getImageData(0, 0, 1, 1).data], [0, 0, 0, 0])
    assert.equal((await copied.convertToBlob()).type, 'image/png')
    const patterned = new window.OffscreenCanvas(1, 1).getContext('2d')!
    patterned.fillStyle = patterned.createPattern(image, 'repeat')!
    assert.throws(() => patterned.getImageData(0, 0, 1, 1), {
      name: 'SecurityError',
    })
    drawing.clearRect(0, 0, 1, 1)
    assert.throws(() => drawing.getImageData(0, 0, 1, 1), {
      name: 'SecurityError',
    })
    const retainedPattern = drawing.createPattern(image, 'repeat')
    Reflect.get(drawing, 'reset')()
    assert.deepEqual([...drawing.getImageData(0, 0, 1, 1).data], [0, 0, 0, 0])
    assert.match(canvas.toDataURL(), /^data:image\/png;base64,/u)
    drawing.fillStyle = retainedPattern
    assert.throws(() => drawing.getImageData(0, 0, 1, 1), {
      name: 'SecurityError',
    })
    canvas.width = 1
    assert.deepEqual([...drawing.getImageData(0, 0, 1, 1).data], [0, 0, 0, 0])
  }
  assert.equal(
    requests.every((request) => request.origin === undefined),
    true,
  )
  await assert.rejects(window.fetch(`${crossOrigin}/red.png`), {
    name: 'NetworkError',
  })
})

test('CORS modes preserve configured request headers and cookies while anonymous cross-origin responses cannot set cookies', async (context) => {
  // Arrange
  const { origin, crossOrigin, requests } = await imageServers(context)
  const { window } = await renderingWindow(context)
  window.happyDOM.setURL(origin)
  window.document.cookie = 'session=owned; Path=/'
  window.happyDOM.settings.fetch.requestHeaders = [
    { headers: { 'X-Canvas-Test': 'configured' } },
  ]
  const anonymous = new window.Image()
  anonymous.crossOrigin = 'anonymous'
  anonymous.src = `${crossOrigin}/cors.png`
  // Act
  await anonymous.decode()
  const credentialed = new window.Image()
  credentialed.crossOrigin = 'use-credentials'
  credentialed.src = `${crossOrigin}/credential.png`
  await credentialed.decode()
  const cookie = new window.Image()
  cookie.crossOrigin = 'anonymous'
  cookie.src = `${crossOrigin}/cookie.png`
  await cookie.decode()
  // Assert
  const drawing = new window.OffscreenCanvas(1, 1).getContext('2d')!
  drawing.drawImage(anonymous, 0, 0)
  assert.deepEqual([...drawing.getImageData(0, 0, 1, 1).data], [255, 0, 0, 255])
  assert.deepEqual(
    requests.filter(({ path }) =>
      ['/cors.png', '/credential.png'].includes(path),
    ),
    [
      {
        path: '/cors.png',
        origin,
        cookie: undefined,
        configured: 'configured',
      },
      {
        path: '/credential.png',
        origin,
        cookie: 'session=owned',
        configured: 'configured',
      },
    ],
  )
  assert.equal(window.document.cookie, 'session=owned')
  for (const [mode, path] of [
    ['anonymous', '/red.png'],
    ['use-credentials', '/wildcard.png'],
  ] as const) {
    const denied = new window.Image()
    denied.crossOrigin = mode
    denied.src = `${crossOrigin}${path}`
    await assert.rejects(denied.decode(), { name: 'EncodingError' })
    assert.throws(() => drawing.drawImage(denied, 0, 0), {
      name: 'InvalidStateError',
    })
  }
})

test('source replacement aborts an in-flight HTTP response and decoding failures emit one error without retaining pixels', async (context) => {
  // Arrange
  const { origin, servers } = await imageServers(context)
  const { window } = await renderingWindow(context)
  window.happyDOM.setURL(origin)
  const image = new window.Image()
  let errors = 0
  image.addEventListener('error', () => {
    errors += 1
  })
  const incoming = new Promise<ServerResponse>((resolve) =>
    servers[0]!.once('request', (_request, response) => resolve(response)),
  )
  image.src = `${origin}/held.png`
  const stale = image.decode()
  const response = await incoming
  const disconnected = once(response, 'close')
  // Act
  image.src = `${origin}/blue.png`
  await assert.rejects(stale, { name: 'EncodingError' })
  await disconnected
  assert.equal(response.destroyed, true)
  await image.decode()
  const drawing = new window.OffscreenCanvas(1, 1).getContext('2d')!
  drawing.drawImage(image, 0, 0)
  // Assert
  assert.deepEqual([...drawing.getImageData(0, 0, 1, 1).data], [0, 0, 255, 255])
  assert.equal(errors, 0)
  image.src = `${origin}/broken.png`
  await assert.rejects(image.decode(), { name: 'EncodingError' })
  assert.equal(errors, 1)
  assert.equal(image.complete, true)
  assert.equal(image.naturalWidth, 0)
  assert.throws(() => drawing.drawImage(image, 0, 0), {
    name: 'InvalidStateError',
  })
  assert.throws(
    () => Reflect.apply(drawing.createPattern, drawing, [image, 'invalid']),
    {
      name: 'InvalidStateError',
    },
  )
})

test('configured response interceptors supply image bytes and thrown hooks settle without leaving Happy DOM tasks pending', async (context) => {
  // Arrange
  const { origin, redPng, requests } = await imageServers(context)
  const { window } = await renderingWindow(context)
  window.happyDOM.setURL(origin)
  window.happyDOM.settings.fetch.interceptor = {
    beforeAsyncRequest: async () => new window.Response(redPng),
  }
  const image = new window.Image()
  // Act
  image.src = `${origin}/intercepted.png`
  await image.decode()
  // Assert
  assert.equal(requests.length, 0)
  const drawing = new window.OffscreenCanvas(1, 1).getContext('2d')!
  drawing.drawImage(image, 0, 0)
  assert.deepEqual([...drawing.getImageData(0, 0, 1, 1).data], [255, 0, 0, 255])
  for (const hook of ['beforeAsyncRequest', 'afterAsyncResponse']) {
    window.happyDOM.settings.fetch.interceptor = {
      [hook]: async () => {
        throw new Error('Hook failure')
      },
    }
    image.src = `${origin}/red.png`
    await assert.rejects(image.decode(), { name: 'EncodingError' })
    await window.happyDOM.waitUntilComplete()
  }
})

test('closing an environment releases decoded native image storage without waiting for garbage collection', async (context) => {
  // Arrange
  const { redPng } = await imageServers(context)
  const environment = await renderingWindow(context)
  const image = new environment.window.Image()
  image.src = `data:image/png;base64,${redPng.toString('base64')}`
  await image.decode()
  const nativeImages: Image[] = []
  const original = Reflect.get(Image.prototype, 'prop')
  context.mock.method(
    Object.getPrototypeOf(Image.prototype),
    'prop',
    function (this: Image, ...argumentsList: unknown[]) {
      if (
        argumentsList[0] === 'data' &&
        Buffer.isBuffer(argumentsList[1]) &&
        argumentsList[1].length === 0
      )
        nativeImages.push(this)
      return Reflect.apply(original, this, argumentsList)
    },
  )
  // Act
  await environment.close()
  // Assert
  assert.equal(nativeImages.length, 1)
  assert.deepEqual(
    nativeImages.map((native) => [native.width, native.height]),
    [[0, 0]],
  )
})

test('Blob URLs render decoded bytes only in their originating context or the same non-opaque origin', async (context) => {
  // Arrange
  const { redPng } = await imageServers(context)
  const first = await renderingWindow(context)
  const second = await renderingWindow(context)
  const opaqueURL = first.window.URL.createObjectURL(
    new first.window.Blob([redPng]),
  )
  const own = new first.window.Image()
  own.src = opaqueURL
  // Act / Assert
  await own.decode()
  const denied = new second.window.Image()
  denied.src = opaqueURL
  await assert.rejects(denied.decode(), { name: 'EncodingError' })
  first.window.happyDOM.setURL('https://images.example.test')
  second.window.happyDOM.setURL('https://images.example.test')
  const sharedURL = first.window.URL.createObjectURL(
    new first.window.Blob([redPng]),
  )
  const shared = new second.window.Image()
  shared.src = sharedURL
  await shared.decode()
  const drawing = new second.window.OffscreenCanvas(1, 1).getContext('2d')!
  drawing.drawImage(shared, 0, 0)
  assert.deepEqual([...drawing.getImageData(0, 0, 1, 1).data], [255, 0, 0, 255])
  first.window.URL.revokeObjectURL(sharedURL)
  shared.src = sharedURL
  await assert.rejects(shared.decode(), { name: 'EncodingError' })
  const beforeNavigation = first.window.URL.createObjectURL(
    new first.window.Blob([redPng]),
  )
  first.window.happyDOM.setURL('https://different.example.test')
  own.src = beforeNavigation
  await assert.rejects(own.decode(), { name: 'EncodingError' })
})

test('changing CORS without a source and removing src keep an empty image complete without dispatching load errors', async (context) => {
  // Arrange
  const { redPng } = await imageServers(context)
  const { window } = await renderingWindow(context)
  const image = new window.Image()
  let errors = 0
  image.addEventListener('error', () => {
    errors += 1
  })
  // Act
  image.crossOrigin = 'anonymous'
  await window.happyDOM.waitUntilComplete()
  image.src = `data:image/png;base64,${redPng.toString('base64')}`
  await image.decode()
  image.removeAttribute('src')
  await window.happyDOM.waitUntilComplete()
  // Assert
  assert.equal(errors, 0)
  assert.equal(image.complete, true)
  assert.equal(image.naturalWidth, 0)
  assert.equal(image.naturalHeight, 0)
  await assert.rejects(image.decode(), { name: 'EncodingError' })
})

test('Offscreen bitmap extraction preserves cross-origin taint and saved patterns until a dimension reset', async (context) => {
  // Arrange
  const { origin, crossOrigin } = await imageServers(context)
  const { window } = await renderingWindow(context)
  window.happyDOM.setURL(origin)
  const image = new window.Image()
  image.src = `${crossOrigin}/red.png`
  await image.decode()
  const canvas = new window.OffscreenCanvas(1, 1)
  const drawing = canvas.getContext('2d')!
  drawing.fillStyle = drawing.createPattern(image, 'repeat')!
  drawing.save()
  drawing.fillRect(0, 0, 1, 1)
  // Act
  canvas.transferToImageBitmap().close()
  // Assert
  assert.throws(() => drawing.getImageData(0, 0, 1, 1), {
    name: 'SecurityError',
  })
  drawing.fillStyle = 'blue'
  drawing.restore()
  drawing.fillRect(0, 0, 1, 1)
  assert.throws(() => drawing.getImageData(0, 0, 1, 1), {
    name: 'SecurityError',
  })
  await assert.rejects(canvas.convertToBlob(), { name: 'SecurityError' })
  Reflect.set(canvas, 'width', 1)
  assert.deepEqual([...drawing.getImageData(0, 0, 1, 1).data], [0, 0, 0, 0])
})
