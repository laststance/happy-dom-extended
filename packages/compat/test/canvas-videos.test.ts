import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import type { ServerResponse } from 'node:http'
import { syncBuiltinESMExports } from 'node:module'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import { videoSources } from '../src/canvas/videos.ts'

import { imageServers } from './utils/image-servers.ts'
import { renderingWindow } from './utils/rendering-window.ts'

const videoBytes = await readFile(
  new URL('../../../fixtures/consumer/red-blue.webm', import.meta.url),
)
const videoURL = `data:video/webm;base64,${videoBytes.toString('base64')}`

test('video loads real intrinsic pixels, never paints a deferred draw, and seeks to the frame at or before the requested time', async (context) => {
  // Arrange
  const { window } = await renderingWindow(context)
  const video = window.document.createElement('video')
  const drawing = new window.OffscreenCanvas(16, 16).getContext('2d')!
  const events: string[] = []
  for (const type of [
    'loadedmetadata',
    'loadeddata',
    'canplay',
    'seeking',
    'seeked',
    'error',
  ])
    video.addEventListener(type, () => {
      events.push(type)
    })
  // Act
  video.src = videoURL
  drawing.drawImage(video, 0, 0)
  assert.equal(drawing.createPattern(video, 'repeat'), null)
  assert.equal(video.readyState, 0)
  await videoSources.get(video)!.completion
  // Assert
  assert.deepEqual(
    [
      Reflect.get(video, 'videoWidth'),
      Reflect.get(video, 'videoHeight'),
      video.duration,
      video.readyState,
    ],
    [16, 16, 2, 4],
  )
  assert.deepEqual([...drawing.getImageData(0, 0, 1, 1).data], [0, 0, 0, 0])
  drawing.drawImage(video, 0, 0)
  assert.deepEqual([...drawing.getImageData(0, 0, 1, 1).data], [254, 0, 0, 255])
  video.currentTime = 0.9
  await videoSources.get(video)!.completion
  drawing.drawImage(video, 0, 0)
  assert.deepEqual([...drawing.getImageData(0, 0, 1, 1).data], [254, 0, 0, 255])
  video.currentTime = 1.1
  assert.equal(video.seeking, true)
  await videoSources.get(video)!.completion
  drawing.drawImage(video, 0, 0)
  assert.deepEqual([...drawing.getImageData(0, 0, 1, 1).data], [0, 0, 255, 255])
  assert.equal(video.currentTime, 1.1)
  assert.equal(video.seeking, false)
  assert.deepEqual(events, [
    'loadedmetadata',
    'loadeddata',
    'canplay',
    'seeking',
    'seeked',
    'seeking',
    'seeked',
  ])
})

test('a newer seek cancels the earlier decoder and closed Windows retain no usable video frame', async (context) => {
  // Arrange
  const { window, close } = await renderingWindow(context)
  const video = window.document.createElement('video')
  video.src = videoURL
  await videoSources.get(video)!.completion
  const seeked: number[] = []
  video.onseeked = () => {
    seeked.push(video.currentTime)
  }
  // Act
  video.currentTime = 1.1
  video.currentTime = 0.1
  await videoSources.get(video)!.completion
  const drawing = new window.OffscreenCanvas(1, 1).getContext('2d')!
  drawing.drawImage(video, 0, 0)
  // Assert
  assert.deepEqual(seeked, [0.1])
  assert.equal(video.error, null)
  assert.deepEqual([...drawing.getImageData(0, 0, 1, 1).data], [254, 0, 0, 255])
  video.currentTime = 1.1
  await close()
  assert.equal(videoSources.get(video)!.native, null)
})

test(
  'seeking during the first video decode publishes only the requested frame and completes initial readiness',
  { timeout: 5000 },
  async (context) => {
    // Arrange
    const { window } = await renderingWindow(context)
    const video = window.document.createElement('video')
    const drawing = new window.OffscreenCanvas(1, 1).getContext('2d')!
    const frames: number[][] = []
    const events: string[] = []
    video.onloadeddata = () => {
      drawing.drawImage(video, 0, 0)
      frames.push([...drawing.getImageData(0, 0, 1, 1).data])
    }
    for (const type of ['loadeddata', 'canplay', 'canplaythrough', 'seeked'])
      video.addEventListener(type, () => events.push(type))
    const nativeSpawn = childProcess.spawn
    let held = false
    let notify: (child: ChildProcess) => void = () => {}
    const starting = new Promise<ChildProcess>((resolve) => {
      notify = resolve
    })
    context.mock.method(
      childProcess,
      'spawn',
      (...argumentsList: Parameters<typeof nativeSpawn>) => {
        const child = nativeSpawn(...argumentsList)
        if (argumentsList[0] === 'ffmpeg' && !held) {
          held = true
          assert.ok(child.stdin)
          const input = child.stdin
          // Hold the real first frame decoder so the seek must abort and join it before publishing readiness.
          context.mock.method(input, 'end', () => input)
          notify(child)
        }
        return child
      },
    )
    syncBuiltinESMExports()
    context.after(() => {
      context.mock.restoreAll()
      syncBuiltinESMExports()
    })
    video.src = videoURL
    const discarded = await starting
    assert.equal(video.readyState, 1)
    const exited = once(discarded, 'close')
    // Act
    video.currentTime = 1.1
    await videoSources.get(video)!.completion
    await exited
    // Assert
    assert.equal(discarded.killed, true)
    assert.deepEqual(frames, [[0, 0, 255, 255]])
    assert.deepEqual(events, [
      'loadeddata',
      'canplay',
      'canplaythrough',
      'seeked',
    ])
    assert.deepEqual(
      [video.currentTime, video.readyState, video.seeking, video.error],
      [1.1, 4, false, null],
    )
  },
)

test(
  'source removal and Window close cancel intercepted image and video streams and release their buffered storage',
  { timeout: 5000 },
  async (context) => {
    // Arrange
    for (const [kind, closeWindow] of [
      ['image', false],
      ['video', false],
      ['image', true],
      ['video', true],
    ] as const) {
      const { window, adapter } = await renderingWindow(context)
      window.happyDOM.setURL('https://media.example/')
      let streamController:
        ReadableStreamDefaultController<Uint8Array> | undefined
      let notify = () => {}
      const reading = new Promise<void>((resolve) => {
        notify = resolve
      })
      let cancelled = false
      window.happyDOM.settings.fetch.interceptor = {
        beforeAsyncRequest: async () =>
          new window.Response(
            new window.ReadableStream({
              start(controller: ReadableStreamDefaultController<Uint8Array>) {
                streamController = controller
                controller.enqueue(new Uint8Array([1, 2, 3, 4]))
              },
              pull() {
                notify()
              },
              cancel() {
                cancelled = true
              },
            }),
          ),
      }
      const image = new window.Image()
      const video = window.document.createElement('video')
      const media = kind === 'image' ? image : video
      media.src = `/held.${kind}`
      const decoding = (
        kind === 'image' ? image.decode() : videoSources.get(video)!.completion
      ).then(
        () => 'resolved',
        (error: Error) => error.name,
      )
      await reading
      // Act
      let closing = Promise.resolve()
      if (closeWindow) closing = window.happyDOM.close()
      else media.removeAttribute('src')
      const outcome = await Promise.race([decoding, delay(1000, 'pending')])
      // A broken cancellation path must still let this test's Window cleanup finish.
      if (!cancelled) streamController?.close()
      await Promise.all([decoding, closing])
      // Assert
      assert.equal(cancelled, true)
      assert.equal(outcome, kind === 'image' ? 'EncodingError' : 'AbortError')
      const reusable = adapter.reserveStorage(window, 134217728)
      reusable()
    }
  },
)

test('play advances real video frames and pause freezes the media clock', async (context) => {
  // Arrange
  const { window } = await renderingWindow(context)
  const video = window.document.createElement('video')
  video.src = videoURL
  await videoSources.get(video)!.completion
  video.currentTime = 0.95
  await videoSources.get(video)!.completion
  const playingFrame = new Promise<void>((resolve) => {
    video.ontimeupdate = () => {
      if (video.currentTime > 1.05) resolve()
    }
  })
  // Act
  const playing = video.play()
  assert.equal(playing instanceof window.Promise, true)
  await playing
  await playingFrame
  video.pause()
  await videoSources.get(video)!.completion
  const drawing = new window.OffscreenCanvas(1, 1).getContext('2d')!
  drawing.drawImage(video, 0, 0)
  // Assert
  assert.equal(video.paused, true)
  const pausedTime = video.currentTime
  await delay(30)
  assert.equal(video.currentTime, pausedTime)
  assert.deepEqual([...drawing.getImageData(0, 0, 1, 1).data], [0, 0, 255, 255])
})

test('invalid video emits a recoverable media error and a later valid source decodes normally', async (context) => {
  // Arrange
  const { window } = await renderingWindow(context)
  const video = window.document.createElement('video')
  const errors: number[] = []
  video.onerror = () => {
    errors.push(video.error?.code ?? 0)
  }
  // Act
  video.src = 'data:video/webm;base64,YmFk'
  await assert.rejects(videoSources.get(video)!.completion)
  await assert.rejects(video.play())
  // Assert
  assert.deepEqual(errors, [3])
  assert.match(video.error?.message ?? '', /ffprobe/)
  assert.equal(videoSources.get(video)!.native, null)
  video.src = videoURL
  await videoSources.get(video)!.completion
  assert.equal(video.error, null)
  assert.equal(video.readyState, 4)
})

test('video HTTP requests preserve CORS taint and source replacement cancels stale network work', async (context) => {
  // Arrange
  const { origin, crossOrigin, servers } = await imageServers(
    context,
    videoBytes,
  )
  const { window } = await renderingWindow(context)
  window.happyDOM.setURL(origin)
  const video = window.document.createElement('video')
  const drawing = new window.OffscreenCanvas(1, 1).getContext('2d')!
  // Act
  video.src = `${crossOrigin}/video.webm`
  await videoSources.get(video)!.completion
  drawing.drawImage(video, 0, 0)
  // Assert
  assert.throws(() => drawing.getImageData(0, 0, 1, 1), {
    name: 'SecurityError',
  })
  video.crossOrigin = 'anonymous'
  video.src = `${crossOrigin}/video.webm`
  await assert.rejects(videoSources.get(video)!.completion, {
    name: 'NetworkError',
  })
  assert.equal(video.error?.code, 2)
  video.src = `${crossOrigin}/cors.webm`
  await videoSources.get(video)!.completion
  Reflect.set(drawing.canvas, 'width', 1)
  drawing.drawImage(video, 0, 0)
  assert.deepEqual([...drawing.getImageData(0, 0, 1, 1).data], [254, 0, 0, 255])
  const incoming = new Promise<ServerResponse>((resolve) =>
    servers[0]!.once('request', (_request, response) => resolve(response)),
  )
  video.src = `${origin}/held.webm`
  const stale = videoSources.get(video)!
  const response = await incoming
  const disconnected = once(response, 'close')
  video.src = videoURL
  await videoSources.get(video)!.completion
  await disconnected
  assert.equal(response.destroyed, true)
  assert.equal(stale.native, null)
  assert.equal(video.error, null)
  assert.equal(video.readyState, 4)
})

test(
  'Window close cancels never-resolving image and video interceptors and leaves their promises settled',
  { timeout: 2000 },
  async (context) => {
    // Arrange
    const { window, close } = await renderingWindow(context)
    window.happyDOM.setURL('https://media.example/')
    let entered!: () => void
    const intercepting = new Promise<void>((resolve) => {
      entered = resolve
    })
    window.happyDOM.settings.fetch.interceptor = {
      beforeAsyncRequest: async () => {
        entered()
        return new Promise<never>(() => {})
      },
    }
    const image = new window.Image()
    image.src = '/pending.png'
    const imageDecode = assert.rejects(image.decode(), {
      name: 'EncodingError',
    })
    const video = window.document.createElement('video')
    video.src = '/pending.webm'
    const videoDecode = assert.rejects(videoSources.get(video)!.completion)
    // Act
    await intercepting
    await close()
    // Assert
    await imageDecode
    await videoDecode
    assert.equal(videoSources.get(video)!.native, null)
  },
)

test('absent FFmpeg prerequisites fail explicitly and keep ordinary Canvas drawing usable', async (context) => {
  // Arrange
  const { window } = await renderingWindow(context)
  const savedPath = process.env.PATH
  const video = window.document.createElement('video')
  // Act
  try {
    process.env.PATH = ''
    video.src = videoURL
    await assert.rejects(
      videoSources.get(video)!.completion,
      /ffprobe could not run/,
    )
  } finally {
    process.env.PATH = savedPath
  }
  // Assert
  assert.match(
    video.error?.message ?? '',
    /requires ffmpeg and ffprobe on PATH/,
  )
  const drawing = new window.OffscreenCanvas(1, 1).getContext('2d')!
  drawing.fillStyle = 'blue'
  drawing.fillRect(0, 0, 1, 1)
  assert.deepEqual([...drawing.getImageData(0, 0, 1, 1).data], [0, 0, 255, 255])
})

test(
  'concurrent play calls settle together and Happy DOM completion waits for the real final frame',
  { timeout: 3000 },
  async (context) => {
    // Arrange
    const { window } = await renderingWindow(context)
    const video = window.document.createElement('video')
    video.src = videoURL
    await videoSources.get(video)!.completion
    video.currentTime = 1.95
    await videoSources.get(video)!.completion
    // Act
    await Promise.all([video.play(), video.play()])
    await window.happyDOM.waitUntilComplete()
    // Assert
    assert.equal(video.currentTime, 2)
    assert.equal(video.ended, true)
    assert.equal(video.paused, true)
    const drawing = new window.OffscreenCanvas(1, 1).getContext('2d')!
    drawing.drawImage(video, 0, 0)
    assert.deepEqual(
      [...drawing.getImageData(0, 0, 1, 1).data],
      [0, 0, 255, 255],
    )
  },
)

test(
  'active FFmpeg children exit before a replacement seek starts or Window close resolves',
  { timeout: 5000 },
  async (context) => {
    // Arrange
    const { window, close } = await renderingWindow(context)
    const video = window.document.createElement('video')
    video.src = videoURL
    await videoSources.get(video)!.completion
    const nativeSpawn = childProcess.spawn
    const children: ChildProcess[] = []
    const closed = new Set<ChildProcess>()
    let holdNext = true
    let notify: (child: ChildProcess) => void = () => {}
    context.mock.method(
      childProcess,
      'spawn',
      (...argumentsList: Parameters<typeof nativeSpawn>) => {
        const previous = children.at(-1)
        if (previous) assert.equal(closed.has(previous), true)
        const child = nativeSpawn(...argumentsList)
        children.push(child)
        child.once('close', () => closed.add(child))
        if (holdNext) {
          holdNext = false
          assert.ok(child.stdin)
          const input = child.stdin
          // Keep the real decoder blocked on its pipe so cancellation must kill and join it.
          context.mock.method(input, 'end', () => input)
          notify(child)
        }
        return child
      },
    )
    syncBuiltinESMExports()
    context.after(() => {
      context.mock.restoreAll()
      syncBuiltinESMExports()
    })
    const seeked: number[] = []
    video.onseeked = () => seeked.push(video.currentTime)
    const starting = new Promise<ChildProcess>((resolve) => {
      notify = resolve
    })
    // Act
    video.currentTime = 1.1
    const discarded = await starting
    assert.ok(discarded.pid)
    assert.equal(closed.has(discarded), false)
    video.currentTime = 0.1
    await videoSources.get(video)!.completion
    // Assert
    assert.equal(discarded.killed, true)
    assert.equal(closed.has(discarded), true)
    assert.deepEqual(seeked, [0.1])
    assert.equal(video.error, null)
    const drawing = new window.OffscreenCanvas(1, 1).getContext('2d')!
    drawing.drawImage(video, 0, 0)
    assert.deepEqual(
      [...drawing.getImageData(0, 0, 1, 1).data],
      [254, 0, 0, 255],
    )
    holdNext = true
    const restarting = new Promise<ChildProcess>((resolve) => {
      notify = resolve
    })
    video.currentTime = 1.1
    const closing = await restarting
    assert.ok(closing.pid)
    await close()
    assert.equal(closing.killed, true)
    assert.equal(closed.has(closing), true)
    assert.equal(children.length, 3)
    assert.equal(videoSources.get(video)!.native, null)
  },
)

test(
  'Window close aborts real pending image and video HTTP responses before settling',
  { timeout: 3000 },
  async (context) => {
    // Arrange
    const { origin, servers } = await imageServers(context, videoBytes)
    const { window, close } = await renderingWindow(context)
    window.happyDOM.setURL(origin)
    const responses: ServerResponse[] = []
    const arrived = new Promise<void>((resolve) => {
      servers[0]!.on('request', (_request, response) => {
        responses.push(response)
        if (responses.length === 2) resolve()
      })
    })
    const image = new window.Image()
    const video = window.document.createElement('video')
    image.src = `${origin}/held.png`
    video.src = `${origin}/held.webm`
    const imageDecode = assert.rejects(image.decode(), {
      name: 'EncodingError',
    })
    const videoDecode = assert.rejects(videoSources.get(video)!.completion)
    await arrived
    const disconnected = Promise.all(
      responses.map(async (response) => once(response, 'close')),
    )
    // Act
    await close()
    await disconnected
    // Assert
    await imageDecode
    await videoDecode
    assert.deepEqual(
      responses.map((response) => response.destroyed),
      [true, true],
    )
    assert.equal(videoSources.get(video)!.native, null)
  },
)

test(
  'pause during replay rewind rejects play and concurrent replays start only one playback task',
  { timeout: 5000 },
  async (context) => {
    // Arrange
    const { window } = await renderingWindow(context)
    const video = window.document.createElement('video')
    video.src = videoURL
    await videoSources.get(video)!.completion
    video.currentTime = 1.99
    await videoSources.get(video)!.completion
    await video.play()
    await window.happyDOM.waitUntilComplete()
    assert.equal(video.ended, true)
    video.addEventListener('seeking', () => video.pause(), { once: true })
    // Act / Assert
    await assert.rejects(video.play(), { name: 'AbortError' })
    assert.equal(video.paused, true)
    video.currentTime = 1.99
    await videoSources.get(video)!.completion
    await video.play()
    await window.happyDOM.waitUntilComplete()
    let starts = 0
    video.addEventListener('play', () => {
      starts += 1
    })
    await Promise.all([video.play(), video.play()])
    assert.equal(starts, 1)
    video.pause()
    await window.happyDOM.waitUntilComplete()
  },
)
