import assert from 'node:assert/strict'
import { once } from 'node:events'
import { test } from 'node:test'
import { setTimeout } from 'node:timers/promises'
import {
  markAsUntransferable,
  MessageChannel as NativeMessageChannel,
  MessagePort,
} from 'node:worker_threads'
import type { MessageChannel } from 'node:worker_threads'

import { Canvas } from 'skia-canvas'

import { renderingWindow } from './utils/rendering-window.ts'

test(
  'malformed Canvas envelopes release sender quotas and report messageerror',
  { timeout: 4000 },
  async (context) => {
    // Arrange
    const { window } = await renderingWindow(context)
    const nativePost = MessagePort.prototype.postMessage
    const corrupt = context.mock.method(
      MessagePort.prototype,
      'postMessage',
      function (
        this: MessagePort,
        ...argumentsList: Parameters<typeof nativePost>
      ) {
        const packet: unknown = argumentsList[0]
        const envelope: unknown = Array.isArray(packet) ? packet[1] : undefined
        if (
          envelope &&
          typeof envelope === 'object' &&
          Reflect.get(envelope, 'records') instanceof Map
        )
          Reflect.set(envelope, 'records', null)
        return Reflect.apply(nativePost, this, argumentsList)
      },
    )
    const Constructor: typeof MessageChannel = Reflect.get(
      window,
      'MessageChannel',
    )
    const channel = new Constructor()
    corrupt.mock.restore()
    channel.port2.on('message', () => {})
    let errors = 0
    const decoded = new Promise<void>((resolve) => {
      channel.port2.on('messageerror', () => {
        if (++errors === 64) resolve()
      })
    })
    const source = new window.OffscreenCanvas(1, 1)
    source.getContext('2d')!.fillRect(0, 0, 1, 1)
    const bitmap = source.transferToImageBitmap()
    // Act
    for (let index = 0; index < 64; index += 1)
      channel.port1.postMessage(bitmap)
    await decoded
    let posted = false
    const deadline = Date.now() + 3000
    while (!posted && Date.now() < deadline) {
      await setTimeout(1)
      try {
        channel.port1.postMessage(bitmap)
        posted = true
      } catch (error) {
        assert.ok(
          error instanceof window.DOMException &&
            error.name === 'QuotaExceededError',
        )
      }
    }
    // Assert
    assert.equal(posted, true)
  },
)

test(
  'ordinary native payload arrays keep their transferred ports usable',
  { timeout: 4000 },
  async (context) => {
    // Arrange
    const { window } = await renderingWindow(context)
    const Constructor: typeof MessageChannel = Reflect.get(
      window,
      'MessageChannel',
    )
    const channel = new Constructor()
    const transferred = new NativeMessageChannel()
    context.after(() => {
      transferred.port1.close()
      transferred.port2.close()
    })
    const delivered = once(channel.port2, 'message')
    // Act
    MessagePort.prototype.postMessage.call(
      channel.port1,
      ['application-data', 7, transferred.port1],
      [transferred.port1],
    )
    const [payload] = await delivered
    assert.ok(payload[2] instanceof MessagePort)
    const received: MessagePort = payload[2]
    context.after(() => received.close())
    const replied = once(transferred.port2, 'message')
    received.postMessage('still open')
    // Assert
    assert.deepEqual(await replied, ['still open'])
  },
)

test('synchronous clone allocation failures preserve both Bitmap and native buffer senders and release partial receivers', async (context) => {
  // Arrange
  const { window, adapter } = await renderingWindow(context)
  const clone = Reflect.get(window, 'structuredClone')
  const canvas = new window.OffscreenCanvas(1, 1)
  const drawing = canvas.getContext('2d')!
  drawing.fillRect(0, 0, 1, 1)
  const bitmap = canvas.transferToImageBitmap()
  const bytes = new Uint8Array([2, 3, 5])
  const release = adapter.reserveStorage(window, 128 * 1024 * 1024 - 12)
  // Act / Assert: even a receiver-side budget failure occurs before native ArrayBuffer transfer.
  assert.throws(
    () => clone({ bitmap, bytes }, { transfer: [bitmap, bytes.buffer] }),
    window.RangeError,
  )
  assert.equal(bitmap.width, 1)
  assert.deepEqual([...bytes], [2, 3, 5])
  release()
  const failure = new Error('Receiver native allocation failed')
  const createContext = context.mock.method(
    Canvas.prototype,
    'getContext',
    () => {
      throw failure
    },
  )
  assert.throws(
    () => clone({ bitmap, bytes }, { transfer: [bitmap, bytes.buffer] }),
    (error) => error === failure,
  )
  assert.equal(bitmap.width, 1)
  assert.deepEqual([...bytes], [2, 3, 5])
  createContext.mock.restore()
  const received = clone(
    { bitmap, bytes },
    { transfer: [bitmap, bytes.buffer] },
  )
  assert.equal(bitmap.width, 0)
  assert.equal(bytes.byteLength, 0)
  assert.deepEqual([...received.bytes], [2, 3, 5])
  drawing.drawImage(received.bitmap, 0, 0)
  assert.deepEqual([...drawing.getImageData(0, 0, 1, 1).data], [0, 0, 0, 255])
  received.bitmap.close()
})

test('closed ports leave Canvas and native buffers attached and do not serialize discarded payloads', async (context) => {
  // Arrange
  const { window } = await renderingWindow(context)
  const Constructor: typeof MessageChannel = Reflect.get(
    window,
    'MessageChannel',
  )
  const channel = new Constructor()
  const canvas = new window.OffscreenCanvas(1, 1)
  const bytes = new Uint8Array([2, 3, 5])
  channel.port1.close()
  // Act
  Reflect.apply(channel.port1.postMessage, channel.port1, [
    { canvas, bytes },
    [canvas, bytes.buffer],
  ])
  channel.port1.postMessage(() => {})
  // Assert
  assert.equal(canvas.width, 1)
  assert.equal(canvas.height, 1)
  assert.deepEqual([...bytes], [2, 3, 5])
  canvas.getContext('2d')!.fillRect(0, 0, 1, 1)
  assert.throws(
    () => Reflect.apply(channel.port1.postMessage, channel.port1, []),
    window.TypeError,
  )
})

test('metadata-only Offscreen transfer preserves dimensions beyond the native raster limit without allocating pixels', async (context) => {
  // Arrange
  const { window } = await renderingWindow(context)
  const clone = Reflect.get(window, 'structuredClone')
  const canvas = new window.OffscreenCanvas(65536, 1)
  // Act
  const received = clone(canvas, { transfer: [canvas] })
  // Assert
  assert.equal(canvas.width, 0)
  assert.equal(received.width, 65536)
  assert.equal(received.height, 1)
  assert.ok(received instanceof window.OffscreenCanvas)
  assert.throws(() => received.getContext('2d'), window.RangeError)
  Reflect.set(received, 'width', 1)
  assert.deepEqual(
    [...received.getContext('2d')!.getImageData(0, 0, 1, 1).data],
    [0, 0, 0, 0],
  )
})

test(
  'unreceived Canvas messages stay bounded and acknowledged messages release their reserved capacity',
  { timeout: 4000 },
  async (context) => {
    // Arrange
    const { window } = await renderingWindow(context)
    const Constructor: typeof MessageChannel = Reflect.get(
      window,
      'MessageChannel',
    )
    const channel = new Constructor()
    const canvas = new window.OffscreenCanvas(1, 1)
    canvas.getContext('2d')!.fillRect(0, 0, 1, 1)
    const bitmap = canvas.transferToImageBitmap()
    for (let index = 0; index < 64; index += 1)
      channel.port1.postMessage(bitmap)
    const bytes = new Uint8Array([2, 3, 5])
    // Act / Assert: refusing excess Canvas work leaves every requested sender intact.
    assert.throws(
      () =>
        Reflect.apply(channel.port1.postMessage, channel.port1, [
          { bitmap, bytes },
          [bitmap, bytes.buffer],
        ]),
      { name: 'QuotaExceededError' },
    )
    assert.equal(bitmap.width, 1)
    assert.equal(bytes.byteLength, 3)
    let received = 0
    const consumed = new Promise<void>((resolve) => {
      channel.port2.on('message', (value) => {
        value.close()
        received += 1
        if (received === 64) resolve()
      })
    })
    await consumed
    let posted = false
    const deadline = Date.now() + 3000
    while (!posted && Date.now() < deadline) {
      await setTimeout(1)
      try {
        channel.port1.postMessage(bitmap)
        posted = true
      } catch (error) {
        assert.ok(
          error instanceof window.DOMException &&
            error.name === 'QuotaExceededError',
        )
      }
    }
    assert.equal(posted, true)
  },
)

test('structured cloning copies real ImageBitmap pixels and preserves cycles, sparse arrays, Map keys and repeated aliases', async (context) => {
  // Arrange
  const { window } = await renderingWindow(context)
  const clone = Reflect.get(window, 'structuredClone')
  const canvas = new window.OffscreenCanvas(1, 1)
  const drawing = canvas.getContext('2d')!
  drawing.fillStyle = 'red'
  drawing.fillRect(0, 0, 1, 1)
  const bitmap = canvas.transferToImageBitmap()
  const graph: Record<string, unknown> = {
    bitmap,
    alias: bitmap,
    sparse: [bitmap, , 3],
    map: new Map([[bitmap, new Set([bitmap])]]),
  }
  graph.self = graph
  // Act
  const copied = clone(graph)
  bitmap.close()
  drawing.drawImage(copied.bitmap, 0, 0)
  // Assert
  assert.equal(copied.self, copied)
  assert.equal(copied.bitmap, copied.alias)
  assert.equal(copied.bitmap, copied.sparse[0])
  assert.equal(1 in copied.sparse, false)
  assert.equal(copied.map.get(copied.bitmap).has(copied.bitmap), true)
  assert.equal(copied.bitmap instanceof window.ImageBitmap, true)
  assert.deepEqual([...drawing.getImageData(0, 0, 1, 1).data], [255, 0, 0, 255])
  copied.bitmap.close()
})

test('native buffers and ImageBitmap ownership move together only after successful serialization', async (context) => {
  // Arrange
  const { window } = await renderingWindow(context)
  const clone = Reflect.get(window, 'structuredClone')
  const canvas = new window.OffscreenCanvas(1, 1)
  const drawing = canvas.getContext('2d')!
  drawing.fillStyle = 'blue'
  drawing.fillRect(0, 0, 1, 1)
  const bitmap = canvas.transferToImageBitmap()
  const bytes = new Uint8Array([2, 3, 5])
  const blocked = new ArrayBuffer(4)
  markAsUntransferable(blocked)
  // Act / Assert: every failed preparation leaves all otherwise valid senders intact.
  assert.throws(
    () =>
      clone(
        {
          bitmap,
          get failure() {
            throw new Error('getter failed')
          },
        },
        { transfer: [bitmap, bytes.buffer] },
      ),
    /getter failed/,
  )
  assert.throws(
    () =>
      clone({ bitmap, bytes }, { transfer: [bitmap, bytes.buffer, blocked] }),
    { name: 'DataCloneError' },
  )
  assert.throws(() => clone({ bitmap }, { transfer: [bitmap, bitmap] }), {
    name: 'DataCloneError',
  })
  assert.equal(bitmap.width, 1)
  assert.equal(bytes.byteLength, 3)
  const copied = clone({ bitmap, bytes }, { transfer: [bitmap, bytes.buffer] })
  assert.equal(bitmap.width, 0)
  assert.equal(bytes.byteLength, 0)
  assert.deepEqual([...copied.bytes], [2, 3, 5])
  drawing.drawImage(copied.bitmap, 0, 0)
  assert.deepEqual([...drawing.getImageData(0, 0, 1, 1).data], [0, 0, 255, 255])
  assert.throws(() => clone(bitmap), { name: 'DataCloneError' })
})

test('OffscreenCanvas transfers before context selection and detached senders cannot render or export after resizing', async (context) => {
  // Arrange
  const { window } = await renderingWindow(context)
  const clone = Reflect.get(window, 'structuredClone')
  const source = new window.OffscreenCanvas(2, 3)
  assert.throws(() => clone(source), { name: 'DataCloneError' })
  // Act
  const receiver = clone(source, { transfer: [source] })
  // Assert
  assert.equal(receiver instanceof window.OffscreenCanvas, true)
  assert.deepEqual(
    [source.width, source.height, receiver.width, receiver.height],
    [0, 0, 2, 3],
  )
  Reflect.set(source, 'width', 4)
  Reflect.set(source, 'height', 5)
  assert.deepEqual([source.width, source.height], [4, 5])
  assert.throws(() => source.getContext('2d'), { name: 'InvalidStateError' })
  await assert.rejects(source.convertToBlob(), { name: 'InvalidStateError' })
  assert.throws(() => source.transferToImageBitmap(), {
    name: 'InvalidStateError',
  })
  const drawing = receiver.getContext('2d')!
  drawing.fillStyle = 'red'
  drawing.fillRect(0, 0, 1, 1)
  assert.throws(() => drawing.drawImage(source, 0, 0), {
    name: 'InvalidStateError',
  })
  assert.throws(() => clone(receiver, { transfer: [receiver] }), {
    name: 'InvalidStateError',
  })
  assert.deepEqual([...drawing.getImageData(0, 0, 1, 1).data], [255, 0, 0, 255])
})

test('serialization runs enumerable getters and the transfer iterator once without reading toStringTag or resurrecting deleted properties', async (context) => {
  // Arrange
  const { window } = await renderingWindow(context)
  const clone = Reflect.get(window, 'structuredClone')
  let getterReads = 0
  let iteratorReads = 0
  let tagReads = 0
  const source = {
    get first() {
      getterReads += 1
      Reflect.deleteProperty(this, 'second')
      return 2
    },
    second: 3,
    get [Symbol.toStringTag]() {
      tagReads += 1
      return 'Object'
    },
  }
  const transfers = {
    get [Symbol.iterator]() {
      iteratorReads += 1
      return function* () {}
    },
  }
  // Act
  const copied = clone(source, { transfer: transfers })
  // Assert
  assert.deepEqual(copied, { first: 2 })
  assert.deepEqual([getterReads, iteratorReads, tagReads], [1, 1, 0])
  assert.throws(() => clone({}, { transfer: { length: 0 } }), window.TypeError)
})

test('Error causes preserve Canvas aliases and transfer bypasses consumer close overrides', async (context) => {
  // Arrange
  const { window } = await renderingWindow(context)
  const clone = Reflect.get(window, 'structuredClone')
  const canvas = new window.OffscreenCanvas(1, 1)
  canvas.getContext('2d')
  const bitmap = canvas.transferToImageBitmap()
  const error = new TypeError('invalid', { cause: bitmap })
  bitmap.close = () => {
    throw new Error('Public close must not run during transfer')
  }
  // Act
  const copied = clone({ error, bitmap }, { transfer: [bitmap] })
  // Assert
  assert.equal(copied.error instanceof TypeError, true)
  assert.equal(copied.error.message, 'invalid')
  assert.equal(copied.error.cause, copied.bitmap)
  assert.equal(copied.bitmap instanceof window.ImageBitmap, true)
  assert.equal(bitmap.width, 0)
})

test('cloning DOMExceptions from another Window preserves names, messages, aliases and the receiver brand', async (context) => {
  // Arrange
  const first = await renderingWindow(context)
  const second = await renderingWindow(context)
  const exception = new first.window.DOMException(
    'Canvas unavailable',
    'InvalidStateError',
  )
  const native = new DOMException('Aborted', 'AbortError')
  const clone = Reflect.get(second.window, 'structuredClone')
  // Act
  const copied = clone({
    exception,
    alias: exception,
    wrapped: new Error('outer', { cause: exception }),
    native,
  })
  // Assert
  assert.ok(copied.exception instanceof second.window.DOMException)
  assert.equal(copied.exception.name, 'InvalidStateError')
  assert.equal(copied.exception.message, 'Canvas unavailable')
  assert.equal(copied.exception, copied.alias)
  assert.equal(copied.exception, copied.wrapped.cause)
  assert.ok(copied.native instanceof second.window.DOMException)
  assert.equal(copied.native.name, 'AbortError')
  assert.equal(copied.native.message, 'Aborted')
})

test('getters that select an Offscreen context invalidate transfer before native buffers detach', async (context) => {
  // Arrange
  const { window } = await renderingWindow(context)
  const clone = Reflect.get(window, 'structuredClone')
  const canvas = new window.OffscreenCanvas(1, 1)
  const buffer = new Uint8Array([7]).buffer
  const graph = {
    canvas,
    get context() {
      canvas.getContext('2d')
      return 1
    },
  }
  // Act / Assert
  assert.throws(() => clone(graph, { transfer: [canvas, buffer] }), {
    name: 'InvalidStateError',
  })
  assert.equal(canvas.width, 1)
  assert.equal(buffer.byteLength, 1)
})

test(
  'native MessageChannel transfers actual Bitmap pixels through Node listeners and EventTarget handlers with shared aliases',
  { timeout: 2000 },
  async (context) => {
    // Arrange
    const { window } = await renderingWindow(context)
    const Constructor: typeof MessageChannel = Reflect.get(
      window,
      'MessageChannel',
    )
    const channel = new Constructor()
    const canvas = new window.OffscreenCanvas(1, 1)
    const drawing = canvas.getContext('2d')!
    drawing.fillStyle = 'red'
    drawing.fillRect(0, 0, 1, 1)
    const bitmap = canvas.transferToImageBitmap()
    const nodeReceived = once(channel.port2, 'message')
    const eventReceived = new Promise<MessageEvent>((resolve) => {
      Reflect.set(channel.port2, 'onmessage', resolve)
    })
    // Act
    Reflect.apply(channel.port1.postMessage, channel.port1, [
      { bitmap, alias: bitmap },
      [bitmap],
    ])
    const [nodeValue] = await nodeReceived
    const event = await eventReceived
    drawing.drawImage(nodeValue.bitmap, 0, 0)
    // Assert
    assert.equal(bitmap.width, 0)
    assert.equal(nodeValue.bitmap instanceof window.ImageBitmap, true)
    assert.equal(nodeValue.bitmap, nodeValue.alias)
    assert.equal(event.data, nodeValue)
    assert.equal(event.target, channel.port2)
    assert.deepEqual(
      [...drawing.getImageData(0, 0, 1, 1).data],
      [255, 0, 0, 255],
    )
  },
)

test(
  'a transferred native port keeps Canvas transport and receiver ownership in another Window',
  { timeout: 2000 },
  async (context) => {
    // Arrange
    const first = await renderingWindow(context)
    const second = await renderingWindow(context)
    const Constructor: typeof MessageChannel = Reflect.get(
      first.window,
      'MessageChannel',
    )
    const channel = new Constructor()
    const clone = Reflect.get(second.window, 'structuredClone')
    const receiver = clone(channel.port2, { transfer: [channel.port2] })
    const canvas = new first.window.OffscreenCanvas(1, 1)
    const drawing = canvas.getContext('2d')!
    drawing.fillStyle = 'blue'
    drawing.fillRect(0, 0, 1, 1)
    const bitmap = canvas.transferToImageBitmap()
    const received = once(receiver, 'message')
    // Act
    Reflect.apply(channel.port1.postMessage, channel.port1, [
      { bitmap },
      { transfer: new Set([bitmap]) },
    ])
    const [message] = await received
    // Assert
    assert.equal(
      receiver instanceof Reflect.get(second.window, 'MessagePort'),
      true,
    )
    assert.equal(message.bitmap instanceof second.window.ImageBitmap, true)
    const output = new second.window.OffscreenCanvas(1, 1).getContext('2d')!
    output.drawImage(message.bitmap, 0, 0)
    assert.deepEqual(
      [...output.getImageData(0, 0, 1, 1).data],
      [0, 0, 255, 255],
    )
  },
)
