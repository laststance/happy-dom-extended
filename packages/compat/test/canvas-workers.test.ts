import assert from 'node:assert/strict'
import { once } from 'node:events'
import { test } from 'node:test'
import {
  MessagePort,
  Worker as NativeWorker,
  threadId,
} from 'node:worker_threads'

import { workerThreads } from '../src/workers/state.ts'

import { imageServers } from './utils/image-servers.ts'
import { renderingWindow } from './utils/rendering-window.ts'

test(
  'early packaged Worker bootstrap failures emit a native error even when unhandled rejections only warn',
  { timeout: 8000 },
  async (context) => {
    // Arrange
    const worker = new NativeWorker(
      new URL('../../jest-happy-dom-extended/src/worker.ts', import.meta.url),
      {
        workerData: null,
        execArgv: ['--experimental-vm-modules', '--unhandled-rejections=warn'],
      },
    )
    context.after(async () => {
      await worker.terminate()
    })
    const failed = new Promise<Error>((resolve) =>
      worker.once('error', resolve),
    )
    const exited = new Promise<number>((resolve) =>
      worker.once('exit', resolve),
    )
    // Act
    const [error, exitCode] = await Promise.all([failed, exited])
    // Assert
    assert.ok(error instanceof TypeError)
    assert.equal(exitCode, 1)
    assert.equal(worker.threadId, -1)
  },
)

test(
  'a timed-out importScripts response cannot execute as the next requested script',
  { timeout: 45_000 },
  async (context) => {
    // Arrange
    const { window } = await renderingWindow(context)
    window.happyDOM.setURL('https://worker.test')
    let releaseStale!: (response: InstanceType<typeof window.Response>) => void
    const stale = new Promise<InstanceType<typeof window.Response>>(
      (resolve) => {
        releaseStale = resolve
      },
    )
    let releaseFresh!: (response: InstanceType<typeof window.Response>) => void
    const fresh = new Promise<InstanceType<typeof window.Response>>(
      (resolve) => {
        releaseFresh = resolve
      },
    )
    let markRequested!: () => void
    const requested = new Promise<void>((resolve) => {
      markRequested = resolve
    })
    let markStaleReplied!: () => void
    const staleReplied = new Promise<void>((resolve) => {
      markStaleReplied = resolve
    })
    let markFinished!: () => void
    const finished = new Promise<void>((resolve) => {
      markFinished = resolve
    })
    const messages: unknown[] = []
    const original = MessagePort.prototype.postMessage
    context.mock.method(
      MessagePort.prototype,
      'postMessage',
      function (this: MessagePort, ...argumentsList: unknown[]) {
        const result = Reflect.apply(original, this, argumentsList)
        const message = argumentsList[0]
        if (
          message &&
          typeof message === 'object' &&
          Reflect.get(message, 'url') === 'https://worker.test/stale.js'
        )
          markStaleReplied()
        return result
      },
    )
    window.happyDOM.settings.fetch.interceptor = {
      beforeAsyncRequest: async ({ request }) => {
        const path = new URL(request.url).pathname
        if (path === '/stale.js') return stale
        if (path === '/fresh.js') {
          markRequested()
          return fresh
        }
        return new window.Response(
          "try { importScripts('/stale.js') } catch (error) { postMessage(error.name) } importScripts('/fresh.js'); postMessage(marker)",
          { headers: { 'content-type': 'text/javascript' } },
        )
      },
    }
    const Constructor = Reflect.get(window, 'Worker')
    const worker = new Constructor('/entry.js')
    context.after(() => worker.terminate())
    worker.onmessage = ({ data }: { data: unknown }) => {
      messages.push(data)
      if (data !== 'TimeoutError') markFinished()
    }
    // Act: release the expired request first, after the child has actually requested its replacement.
    await requested
    releaseStale(
      new window.Response("self.marker = 'stale'", {
        headers: { 'content-type': 'text/javascript' },
      }),
    )
    await staleReplied
    releaseFresh(
      new window.Response("self.marker = 'fresh'", {
        headers: { 'content-type': 'text/javascript' },
      }),
    )
    await finished
    // Assert
    assert.deepEqual(messages, ['TimeoutError', 'fresh'])
  },
)

test(
  'classic Worker entry scripts execute Blob and data URLs without requiring an HTTP JavaScript MIME type',
  { timeout: 8000 },
  async (context) => {
    // Arrange
    const { window } = await renderingWindow(context)
    const Constructor = Reflect.get(window, 'Worker')
    const source = 'postMessage(42); close()'
    const urls = [
      window.URL.createObjectURL(new window.Blob([source])),
      window.URL.createObjectURL(
        new window.Blob([source], { type: 'text/plain' }),
      ),
      `data:text/plain,${encodeURIComponent(source)}`,
    ]
    for (const url of urls) {
      const worker = new Constructor(url)
      const exited = once(workerThreads.get(worker)!, 'exit')
      const received = new Promise<{ data: number }>((resolve, reject) => {
        worker.onmessage = resolve
        worker.onerror = (event: { message: string }) =>
          reject(new Error(event.message))
      })
      // Act / Assert
      assert.equal((await received).data, 42)
      await exited
    }
  },
)

test(
  'a real dedicated worker receives OffscreenCanvas before startup and returns actual Bitmap pixels in the parent realm',
  { timeout: 8000 },
  async (context) => {
    // Arrange
    const environment = await renderingWindow(context)
    const { window } = environment
    const Constructor = Reflect.get(window, 'Worker')
    const source = `onmessage = ({ data }) => {
    const drawing = data.canvas.getContext('2d');
    drawing.fillStyle = 'blue'; drawing.fillRect(0, 0, 1, 1);
    const bitmap = data.canvas.transferToImageBitmap();
    postMessage({ bitmap, brand: data.canvas instanceof OffscreenCanvas,
      sameSelf: self === globalThis, objectRealm: {} instanceof Object,
      globals: [typeof document, typeof window, typeof process, typeof require] }, [bitmap]);
  }`
    const worker = new Constructor(
      `data:text/javascript,${encodeURIComponent(source)}`,
    )
    const thread = workerThreads.get(worker)!
    const nativeId = thread.threadId
    const received = new Promise<{
      data: {
        bitmap: InstanceType<typeof window.ImageBitmap>
        brand: boolean
        sameSelf: boolean
        objectRealm: boolean
        globals: string[]
      }
    }>((resolve, reject) => {
      worker.onmessage = resolve
      worker.onerror = (event: InstanceType<typeof window.ErrorEvent>) =>
        reject(new Error(event.message))
    })
    const canvas = new window.OffscreenCanvas(1, 1)
    const bytes = new Uint8Array([2, 3, 5])
    // Act
    assert.throws(
      () =>
        worker.postMessage({ canvas, bad: () => {} }, [canvas, bytes.buffer]),
      { name: 'DataCloneError' },
    )
    assert.equal(canvas.width, 1)
    assert.equal(bytes.byteLength, 3)
    worker.postMessage({ canvas }, [canvas])
    assert.equal(canvas.width, 0)
    const event = await received
    const output = new window.OffscreenCanvas(1, 1).getContext('2d')!
    output.drawImage(event.data.bitmap, 0, 0)
    assert.deepEqual(
      [...output.getImageData(0, 0, 1, 1).data],
      [0, 0, 255, 255],
    )
    const exit = once(thread, 'exit')
    await environment.close()
    assert.equal(thread.threadId, -1)
    await exit
    // Assert
    assert.notEqual(nativeId, threadId)
    assert.equal(event instanceof window.MessageEvent, true)
    assert.equal(event.data.bitmap instanceof window.ImageBitmap, true)
    assert.equal(event.data.brand, true)
    assert.equal(event.data.sameSelf, true)
    assert.equal(event.data.objectRealm, true)
    assert.deepEqual(event.data.globals, [
      'undefined',
      'undefined',
      'undefined',
      'undefined',
    ])
    assert.equal(thread.threadId, -1)
  },
)

test(
  'Worker module imports preserve cycles, module identity, CORS and parent request headers and credentials',
  { timeout: 8000 },
  async (context) => {
    // Arrange
    const scripts: Record<string, string> = {}
    const { origin, crossOrigin, requests } = await imageServers(
      context,
      undefined,
      scripts,
    )
    const { window } = await renderingWindow(context)
    window.happyDOM.setURL(origin)
    window.document.cookie = 'session=worker; Path=/'
    window.happyDOM.settings.fetch.requestHeaders = [
      { headers: { 'X-Canvas-Test': 'worker-policy' } },
    ]
    scripts['/entry.js'] = `import { getColor } from './a.js';
    import { cross } from '${crossOrigin}/cors.js';
    const again = await import('./a.js');
    postMessage({ color: getColor(), same: getColor === again.getColor, cross });`
    scripts['/a.js'] =
      "import { color } from './b.js'; export function getColor() { return color }"
    scripts['/b.js'] =
      "import { getColor } from './a.js'; export const color = 'red'; export const callback = getColor"
    scripts['/cors.js'] = 'export const cross = true'
    const Constructor = Reflect.get(window, 'Worker')
    const worker = new Constructor('/entry.js', {
      type: 'module',
      credentials: 'omit',
    })
    const received = new Promise<{ data: unknown }>((resolve, reject) => {
      worker.onmessage = resolve
      worker.onerror = (event: { message: string }) =>
        reject(new Error(event.message))
    })
    // Act
    const event = await received
    worker.terminate()
    // Assert
    assert.deepEqual(event.data, { color: 'red', same: true, cross: true })
    assert.deepEqual(requests.map(({ path }) => path).sort(), [
      '/a.js',
      '/b.js',
      '/cors.js',
      '/entry.js',
    ])
    assert.equal(
      requests.every(
        ({ configured, cookie }) =>
          configured === 'worker-policy' && cookie === undefined,
      ),
      true,
    )
    assert.equal(
      requests.find(({ path }) => path === '/cors.js')?.origin,
      origin,
    )
  },
)

test(
  'classic importScripts uses real cross-origin scripts while entry redirects and module CORS failures stay blocked',
  { timeout: 8000 },
  async (context) => {
    // Arrange
    const scripts: Record<string, string> = {}
    const { origin, crossOrigin, requests, servers } = await imageServers(
      context,
      undefined,
      scripts,
    )
    const { window } = await renderingWindow(context)
    window.happyDOM.setURL(origin)
    window.document.cookie = 'session=worker; Path=/'
    servers[1]!.prependListener('request', (_request, response) => {
      response.setHeader('Set-Cookie', 'foreign=forbidden; Path=/')
    })
    scripts['/same.js'] = "self.helperColor = 'red'"
    scripts['/helper.js'] = "self.helperColor = 'blue'"
    scripts['/classic.js'] =
      `importScripts('./same.js', '${crossOrigin}/helper.js'); postMessage(helperColor)`
    scripts['/denied.js'] = `import '${crossOrigin}/helper.js'`
    scripts['/foreign.js'] = "postMessage('should not run')"
    const Constructor = Reflect.get(window, 'Worker')
    const worker = new Constructor('/classic.js', { credentials: 'include' })
    const received = new Promise<{ data: unknown }>((resolve, reject) => {
      worker.onmessage = resolve
      worker.onerror = (event: { message: string }) =>
        reject(new Error(event.message))
    })
    // Act / Assert
    assert.equal((await received).data, 'blue')
    assert.equal(
      requests.find(({ path }) => path === '/classic.js')?.cookie,
      'session=worker',
    )
    assert.equal(
      requests.find(({ path }) => path === '/same.js')?.cookie,
      'session=worker',
    )
    assert.equal(
      requests.find(({ path }) => path === '/helper.js')?.cookie,
      undefined,
    )
    assert.equal(window.document.cookie, 'session=worker')
    worker.terminate()
    for (const { url, expected } of [
      { url: '/redirect.js', expected: /crossed origins/ },
      { url: '/denied.js', expected: /CORS check/ },
    ]) {
      const blocked = new Constructor(url, { type: 'module' })
      const failed = new Promise<{ message: string }>((resolve) => {
        blocked.onerror = resolve
      })
      assert.match((await failed).message, expected)
    }
    assert.equal(
      requests.some(({ path }) => path === '/foreign.js'),
      false,
    )
  },
)

test(
  'explicitly disabled JavaScript loading prevents Worker script execution',
  { timeout: 4000 },
  async (context) => {
    // Arrange
    const { window } = await renderingWindow(context)
    window.happyDOM.settings.disableJavaScriptFileLoading = true
    const Constructor = Reflect.get(window, 'Worker')
    const worker = new Constructor('data:text/javascript,postMessage(1)')
    let ran = false
    worker.onmessage = () => {
      ran = true
    }
    const failed = new Promise<{ message: string }>((resolve) => {
      worker.onerror = resolve
    })
    // Act / Assert
    assert.match((await failed).message, /disabled by the Window settings/)
    assert.equal(ran, false)
  },
)

test(
  'Worker load, module import and uncaught startup errors dispatch Window ErrorEvents and release their real threads',
  { timeout: 8000 },
  async (context) => {
    // Arrange
    const { window } = await renderingWindow(context)
    const Constructor = Reflect.get(window, 'Worker')
    const cases = [
      ['data:text/plain,postMessage(1)', 'module', /JavaScript MIME/],
      [
        `data:text/javascript,${encodeURIComponent("throw new Error('startup exploded')")}`,
        'classic',
        /startup exploded/,
      ],
      [
        `data:text/javascript,${encodeURIComponent("import 'node:fs'")}`,
        'module',
        /Unsupported media URL protocol/,
      ],
    ] as const
    for (const [url, type, expected] of cases) {
      const worker = new Constructor(url, { type })
      const thread = workerThreads.get(worker)!
      const exited = once(thread, 'exit')
      const failed = new Promise<InstanceType<typeof window.ErrorEvent>>(
        (resolve) => {
          worker.onerror = resolve
        },
      )
      // Act
      const event = await failed
      await exited
      // Assert
      assert.equal(event instanceof window.ErrorEvent, true)
      assert.match(event.message, expected)
      assert.equal(thread.threadId, -1)
    }
  },
)

test(
  'closing a Window cancels a never-resolving Worker request interceptor and joins the child before returning',
  { timeout: 6000 },
  async (context) => {
    // Arrange
    const environment = await renderingWindow(context)
    const { window } = environment
    window.happyDOM.setURL('http://worker.test')
    let requested!: () => void
    const entered = new Promise<void>((resolve) => {
      requested = resolve
    })
    window.happyDOM.settings.fetch.interceptor = {
      beforeAsyncRequest: async () => {
        requested()
        return new Promise(() => {})
      },
    }
    const Constructor = Reflect.get(window, 'Worker')
    const worker = new Constructor('/pending.js')
    const thread = workerThreads.get(worker)!
    await entered
    // Act
    await environment.close()
    // Assert
    assert.equal(thread.threadId, -1)
  },
)

test(
  'closing a Window joins a Worker running an infinite user loop without leaving a live child',
  { timeout: 6000 },
  async (context) => {
    // Arrange
    const environment = await renderingWindow(context)
    const Constructor = Reflect.get(environment.window, 'Worker')
    const worker = new Constructor(
      `data:text/javascript,${encodeURIComponent("postMessage('running'); while (true) {}")}`,
    )
    const thread = workerThreads.get(worker)!
    await new Promise<void>((resolve) => {
      worker.onmessage = () => resolve()
    })
    // Act
    await environment.close()
    // Assert
    assert.equal(thread.threadId, -1)
  },
)

test(
  'Worker limits reject excess threads and release their slot after termination',
  { timeout: 8000 },
  async (context) => {
    // Arrange
    const { window } = await renderingWindow(context)
    const Constructor = Reflect.get(window, 'Worker')
    const children = Array.from(
      { length: 8 },
      () => new Constructor('data:text/javascript,onmessage%3D()%3D%3E%7B%7D'),
    )
    // Act / Assert
    assert.throws(() => new Constructor('data:text/javascript,'), {
      name: 'QuotaExceededError',
    })
    const exited = once(workerThreads.get(children[0])!, 'exit')
    children[0].terminate()
    await exited
    const replacement = new Constructor('data:text/javascript,')
    assert.ok(workerThreads.get(replacement)!.threadId > 0)
    replacement.terminate()
    for (const worker of children) worker.terminate()
  },
)

test(
  'module workers run real imports and top-level await before delivering queued messages',
  { timeout: 8000 },
  async (context) => {
    // Arrange
    const { window } = await renderingWindow(context)
    const Constructor = Reflect.get(window, 'Worker')
    const dependency = `data:text/javascript,${encodeURIComponent('export const color = "red"')}`
    const source = `import { color } from '${dependency}';
    await new Promise(resolve => setTimeout(resolve, 10));
    onmessage = () => { const canvas = new OffscreenCanvas(1, 1);
      const drawing = canvas.getContext('2d'); drawing.fillStyle = color;
      drawing.fillRect(0, 0, 1, 1);
      postMessage({ pixels: [...drawing.getImageData(0, 0, 1, 1).data], url: import.meta.url });
    }`
    const url = `data:text/javascript,${encodeURIComponent(source)}`
    const worker = new Constructor(url, { type: 'module' })
    const received = new Promise<{ data: { pixels: number[]; url: string } }>(
      (resolve, reject) => {
        worker.onmessage = resolve
        worker.onerror = (event: InstanceType<typeof window.ErrorEvent>) =>
          reject(new Error(event.message))
      },
    )
    // Act
    worker.postMessage('start')
    const event = await received
    worker.terminate()
    // Assert
    assert.deepEqual(event.data.pixels, [255, 0, 0, 255])
    assert.equal(event.data.url, url)
  },
)
