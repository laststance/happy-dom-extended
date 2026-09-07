import { spawn } from 'node:child_process'
import { clearTimeout, setTimeout } from 'node:timers'

import type { AbortSignal, ICanvasAdapterCaller } from 'happy-dom'
import { ImageData } from 'skia-canvas'

import type { ExtendedCanvasAdapter } from './adapter.ts'
import {
  MAX_MEDIA_METADATA_BYTES,
  MAX_MEDIA_PROCESSES,
  MAX_NATIVE_STORAGE_BYTES,
  MEDIA_OPERATION_TIMEOUT_MS,
  VIDEO_TIMESTAMP_EPSILON_SECONDS,
} from './constants.ts'
import { pixelBytes } from './utils/pixel-bytes.ts'
import { videoGeometry } from './utils/video-geometry.ts'

const processes = new WeakMap<ICanvasAdapterCaller['window'], number>()

/** Runs one bounded codec process for video loading/seeking, resolving only after the child and its pipes close.
 * @returns Nothing; spawn, decode, cancellation, timeout and output-handler failures reject after process cleanup.
 * @example await runDecoder(window, 'ffprobe', args, bytes, signal, consumeMetadata);
 */
async function runDecoder(
  window: ICanvasAdapterCaller['window'],
  executable: 'ffmpeg' | 'ffprobe',
  argumentsList: string[],
  input: Buffer,
  signal: AbortSignal,
  consume: (chunk: Buffer) => void,
): Promise<void> {
  if (signal.aborted) throw signal.reason
  const count = processes.get(window) ?? 0
  if (count >= MAX_MEDIA_PROCESSES)
    throw new window.RangeError('Too many active video decoder processes.')
  processes.set(window, count + 1)
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(executable, argumentsList, { windowsHide: true })
      let failure: unknown
      let diagnostics = ''
      const stop = (error: unknown) => {
        failure ??= error
        child.kill('SIGKILL')
      }
      const abort = () => stop(signal.reason)
      const timer = setTimeout(
        () =>
          stop(
            new window.DOMException(
              'Video decoding timed out.',
              'TimeoutError',
            ),
          ),
        MEDIA_OPERATION_TIMEOUT_MS,
      )
      signal.addEventListener('abort', abort, { once: true })
      child.on('error', (error) => {
        failure ??= new window.Error(
          `${executable} could not run. Video input requires ffmpeg and ffprobe on PATH: ${error.message}`,
          { cause: error },
        )
      })
      child.stdin.on('error', (error: NodeJS.ErrnoException) => {
        // A decoder may finish before consuming the encoded tail; other pipe failures still stop it.
        if (error.code !== 'EPIPE') stop(error)
      })
      child.stdout.on('data', (chunk: Buffer) => {
        if (failure !== undefined) return
        try {
          consume(chunk)
        } catch (error) {
          stop(error)
        }
      })
      child.stderr.on('data', (chunk: Buffer) => {
        if (diagnostics.length < MAX_MEDIA_METADATA_BYTES)
          diagnostics += chunk
            .toString('utf8')
            .slice(0, MAX_MEDIA_METADATA_BYTES - diagnostics.length)
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        if (failure !== undefined) reject(failure)
        else if (code !== 0)
          reject(
            new window.Error(
              `${executable} could not decode this video: ${diagnostics.trim()}`,
            ),
          )
        else resolve()
      })
      child.stdin.end(input)
      if (signal.aborted) abort()
    })
  } finally {
    processes.set(window, (processes.get(window) ?? 1) - 1)
  }
}

/** Reads real video metadata before reserving frame storage, rejecting unsupported geometry and unbounded/live media.
 * @returns The displayed dimensions and finite duration used by the same decoder's frame scaling.
 * @example await probeVideo(window, bytes, controller.signal); // { width: 16, height: 16, duration: 2 }
 */
export async function probeVideo(
  window: ICanvasAdapterCaller['window'],
  input: Buffer,
  signal: AbortSignal,
) {
  const chunks: Buffer[] = []
  let length = 0
  await runDecoder(
    window,
    'ffprobe',
    [
      '-v',
      'error',
      '-max_alloc',
      String(MAX_NATIVE_STORAGE_BYTES),
      '-protocol_whitelist',
      'pipe',
      '-threads',
      '1',
      '-i',
      'pipe:0',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height,sample_aspect_ratio:stream_side_data=rotation:format=duration',
      '-of',
      'json',
    ],
    input,
    signal,
    (chunk) => {
      length += chunk.length
      if (length > MAX_MEDIA_METADATA_BYTES)
        throw new window.RangeError('Video metadata exceeds the byte limit.')
      chunks.push(chunk)
    },
  )
  const result: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!result || typeof result !== 'object')
    throw new window.TypeError('Invalid video metadata.')
  const streams: unknown = Reflect.get(result, 'streams')
  const stream: unknown = Array.isArray(streams) ? streams[0] : null
  const format: unknown = Reflect.get(result, 'format')
  if (
    !stream ||
    typeof stream !== 'object' ||
    !format ||
    typeof format !== 'object'
  )
    throw new window.TypeError('The media has no video stream.')
  const duration = Number(Reflect.get(format, 'duration'))
  if (!Number.isFinite(duration) || duration <= 0)
    throw new window.TypeError('Video requires finite duration.')
  return { ...videoGeometry(window, stream), duration }
}

/** Selects the last actual presentation frame at or before a seek time, keeping only two bounded RGBA buffers.
 * @returns A real ImageData frame and an idempotent storage release operation.
 * @example await decodeVideoFrame(window, adapter, bytes, metadata, 1.1, signal);
 */
export async function decodeVideoFrame(
  window: ICanvasAdapterCaller['window'],
  adapter: ExtendedCanvasAdapter,
  input: Buffer,
  metadata: Awaited<ReturnType<typeof probeVideo>>,
  time: number,
  signal: AbortSignal,
) {
  const { width, height } = metadata
  const length = pixelBytes(window, width, height)
  const releaseScratch = adapter.reserveStorage(window, length)
  let releasePixels = () => {}
  try {
    releasePixels = adapter.reserveStorage(window, length)
    let writing = Buffer.alloc(length)
    let latest = Buffer.alloc(length)
    let offset = 0
    let complete = false
    const timestamp = Math.max(0, time)
    await runDecoder(
      window,
      'ffmpeg',
      [
        '-v',
        'error',
        '-nostdin',
        '-max_alloc',
        String(MAX_NATIVE_STORAGE_BYTES),
        '-protocol_whitelist',
        'pipe',
        '-threads',
        '1',
        '-i',
        'pipe:0',
        '-map',
        '0:v:0',
        '-an',
        '-sn',
        '-dn',
        '-t',
        String(timestamp + VIDEO_TIMESTAMP_EPSILON_SECONDS),
        '-vf',
        `select=lte(t\\,${timestamp}),scale=${width}:${height},setsar=1`,
        '-threads',
        '1',
        '-filter_threads',
        '1',
        '-fps_mode',
        'passthrough',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'rgba',
        'pipe:1',
      ],
      input,
      signal,
      (chunk) => {
        // Pipe chunks need not align to frames; publish only the last fully copied frame.
        let consumed = 0
        while (consumed < chunk.length) {
          const copied = Math.min(length - offset, chunk.length - consumed)
          chunk.copy(writing, offset, consumed, consumed + copied)
          consumed += copied
          offset += copied
          if (offset === length) {
            ;[writing, latest] = [latest, writing]
            offset = 0
            complete = true
          }
        }
      },
    )
    if (!complete || offset !== 0)
      throw new window.DOMException(
        'Video has no complete frame at this time.',
        'EncodingError',
      )
    return {
      native: new ImageData(
        new Uint8ClampedArray(
          latest.buffer,
          latest.byteOffset,
          latest.byteLength,
        ),
        width,
        height,
      ),
      release: releasePixels,
    }
  } catch (error) {
    releasePixels()
    throw error
  } finally {
    releaseScratch()
  }
}
