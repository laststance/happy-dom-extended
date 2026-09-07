import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { test } from 'node:test'
import { setTimeout } from 'node:timers/promises'
import { MessagePort } from 'node:worker_threads'

import { PNG } from 'pngjs'

import { renderingWindow } from './utils/rendering-window.ts'

test(
  'queued placeholder drawing survives garbage collection after its source is discarded',
  { timeout: 10_000 },
  () => {
    // Arrange: hold the real presentation task in a GC-enabled child, without retaining its source.
    const helper = new URL('./utils/rendering-window.ts', import.meta.url).href
    const source = `
      import timers from 'node:timers';
      import { syncBuiltinESMExports } from 'node:module';
      import { setTimeout as delay } from 'node:timers/promises';
      import { renderingWindow } from ${JSON.stringify(helper)};
      const { window, close } = await renderingWindow();
      const nativeImmediate = timers.setImmediate;
      const callbacks = [];
      timers.setImmediate = (callback, ...args) => {
        if (callback.name === 'presentCanvasFrame') {
          callbacks.push(callback);
          return null;
        }
        return nativeImmediate(callback, ...args);
      };
      syncBuiltinESMExports();
      try {
        const html = window.document.createElement('canvas');
        html.width = 1; html.height = 1;
        const reference = (() => {
          const canvas = html.transferControlToOffscreen();
          const drawing = canvas.getContext('2d');
          drawing.fillStyle = 'blue'; drawing.fillRect(0, 0, 1, 1);
          return new WeakRef(canvas);
        })();
        const blank = html.toDataURL();
        for (let attempt = 0; attempt < 5; attempt++) {
          await delay(1); global.gc();
        }
        const retained = reference.deref() !== undefined;
        callbacks.shift()();
        const deadline = Date.now() + 2000;
        while (Date.now() < deadline) {
          await delay(1);
          if (html.toDataURL() !== blank) break;
        }
        console.log(JSON.stringify({ retained, png: html.toDataURL() }));
      } finally {
        timers.setImmediate = nativeImmediate;
        syncBuiltinESMExports();
        await close();
      }
    `
    // Act
    const result = JSON.parse(
      execFileSync(
        process.execPath,
        ['--expose-gc', '--input-type=module', '-e', source],
        {
          encoding: 'utf8',
          timeout: 8000,
        },
      ),
    )
    // Assert
    assert.equal(result.retained, true)
    const png = PNG.sync.read(Buffer.from(result.png.split(',')[1], 'base64'))
    assert.deepEqual([...png.data], [0, 0, 255, 255])
  },
)

test(
  'failed placeholder setup closes both ports and the same HTML canvas can present pixels on retry',
  { timeout: 4000 },
  async (context) => {
    // Arrange
    const { window } = await renderingWindow(context)
    const html = window.document.createElement('canvas')
    html.width = 1
    html.height = 1
    const nativeOn = MessagePort.prototype.on
    const captured: MessagePort[] = []
    context.after(() => {
      for (const port of captured) port.close()
    })
    const failure = new Error('Injected parent presentation listener failure')
    const registration = context.mock.method(
      MessagePort.prototype,
      'on',
      function (this: MessagePort, event: string, ...argumentsList: unknown[]) {
        if (event === 'message') {
          captured.push(this)
          if (captured.length === 2) throw failure
        }
        return Reflect.apply(nativeOn, this, [event, ...argumentsList])
      },
    )
    // Act / Assert
    try {
      assert.throws(
        () => html.transferControlToOffscreen(),
        (error) => error === failure,
      )
    } finally {
      registration.mock.restore()
    }
    assert.equal(captured.length, 2)
    await Promise.all(captured.map(async (port) => once(port, 'close')))
    const drawing = html.transferControlToOffscreen().getContext('2d')!
    drawing.fillStyle = 'red'
    drawing.fillRect(0, 0, 1, 1)
    let png = PNG.sync.read(
      Buffer.from(html.toDataURL().split(',')[1]!, 'base64'),
    )
    const deadline = Date.now() + 3000
    while (png.data[0] !== 255 && Date.now() < deadline) {
      await setTimeout(1)
      png = PNG.sync.read(
        Buffer.from(html.toDataURL().split(',')[1]!, 'base64'),
      )
    }
    assert.deepEqual([...png.data], [255, 0, 0, 255])
  },
)

test(
  'resizing an Offscreen placeholder publishes blank pixels without requiring another draw',
  { timeout: 4000 },
  async (context) => {
    // Arrange
    const { window, close } = await renderingWindow(context)
    const html = window.document.createElement('canvas')
    html.width = 1
    html.height = 1
    const offscreen = html.transferControlToOffscreen()
    const drawing = offscreen.getContext('2d')!
    // Act
    Reflect.set(offscreen, 'width', 2)
    let png = PNG.sync.read(
      Buffer.from(html.toDataURL().split(',')[1]!, 'base64'),
    )
    const deadline = Date.now() + 3000
    while (png.width !== 2 && Date.now() < deadline) {
      await setTimeout(10)
      png = PNG.sync.read(
        Buffer.from(html.toDataURL().split(',')[1]!, 'base64'),
      )
    }
    // Assert
    assert.equal(png.width, 2)
    assert.deepEqual([...png.data], [0, 0, 0, 0, 0, 0, 0, 0])
    assert.equal(offscreen.getContext('2d'), drawing)
    await close()
    assert.equal(offscreen.width, 2)
  },
)

test(
  'an HTML placeholder presents actual Offscreen pixels and preserves its attribute dimensions independently of the bitmap',
  { timeout: 4000 },
  async (context) => {
    // Arrange
    const { window } = await renderingWindow(context)
    const html = window.document.createElement('canvas')
    html.width = 1
    html.height = 1
    const offscreen = html.transferControlToOffscreen()
    const drawing = offscreen.getContext('2d')!
    assert.throws(() => html.getContext('2d'), { name: 'InvalidStateError' })
    assert.throws(() => html.transferControlToOffscreen(), {
      name: 'InvalidStateError',
    })
    assert.throws(
      () => {
        html.width = 2
      },
      { name: 'InvalidStateError' },
    )
    // Act
    Reflect.set(offscreen, 'width', 2)
    drawing.fillStyle = 'red'
    drawing.fillRect(0, 0, 2, 1)
    let png = PNG.sync.read(
      Buffer.from(html.toDataURL().split(',')[1]!, 'base64'),
    )
    for (let attempt = 0; attempt < 100 && png.width !== 2; attempt += 1) {
      await setTimeout(10)
      png = PNG.sync.read(
        Buffer.from(html.toDataURL().split(',')[1]!, 'base64'),
      )
    }
    html.setAttribute('width', '5')
    html.getAttributeNode('width')!.value = '6'
    const copied = new window.OffscreenCanvas(2, 1).getContext('2d')!
    copied.drawImage(html, 0, 0)
    // Assert
    assert.equal(html.width, 6)
    assert.equal(png.width, 2)
    assert.deepEqual([...png.data], [255, 0, 0, 255, 255, 0, 0, 255])
    assert.deepEqual(
      [...copied.getImageData(0, 0, 2, 1).data],
      [255, 0, 0, 255, 255, 0, 0, 255],
    )
  },
)

test(
  'a Worker updates the original HTML placeholder after transfer with actual independently decoded blue pixels',
  { timeout: 8000 },
  async (context) => {
    // Arrange
    const { window } = await renderingWindow(context)
    const Constructor = Reflect.get(window, 'Worker')
    const source = `onmessage = ({data: canvas}) => {
    const drawing = canvas.getContext('2d'); drawing.fillStyle = 'blue';
    drawing.fillRect(0, 0, 1, 1); postMessage('drawn');
  }`
    const worker = new Constructor(
      `data:text/javascript,${encodeURIComponent(source)}`,
    )
    context.after(() => worker.terminate())
    const drawn = new Promise<void>((resolve, reject) => {
      worker.onmessage = () => resolve()
      worker.onerror = (event: { message: string }) =>
        reject(new Error(event.message))
    })
    const html = window.document.createElement('canvas')
    html.width = 1
    html.height = 1
    const offscreen = html.transferControlToOffscreen()
    // Act
    worker.postMessage(offscreen, [offscreen])
    await drawn
    let png = PNG.sync.read(
      Buffer.from(html.toDataURL().split(',')[1]!, 'base64'),
    )
    for (let attempt = 0; attempt < 100 && png.data[2] !== 255; attempt += 1) {
      await setTimeout(10)
      png = PNG.sync.read(
        Buffer.from(html.toDataURL().split(',')[1]!, 'base64'),
      )
    }
    // Assert
    assert.equal(offscreen.width, 0)
    assert.deepEqual([...png.data], [0, 0, 255, 255])
    assert.throws(() => html.getContext('2d'), { name: 'InvalidStateError' })
  },
)
