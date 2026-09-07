import { resolveObjectURL } from 'node:buffer'
import { URL } from 'node:url'

import { PropertySymbol } from 'happy-dom'
import type {
  AbortSignal,
  ICanvasAdapterCaller,
  Request,
  Window,
  Response,
} from 'happy-dom'

import type { DisposeCompatibility } from '../types.ts'
import { disposeAll } from '../utils/dispose-all.ts'
import { replaceProperty } from '../utils/replace-property.ts'

import {
  MAX_MEDIA_INPUT_BYTES,
  MAX_MEDIA_REDIRECTS,
  MEDIA_REDIRECT_STATUSES,
} from './constants.ts'
import {
  Fetch,
  FetchRequestHeaderUtility,
  FetchResponseHeaderUtility,
  WindowBrowserContext,
} from './happy-dom-internals.ts'
import { canvasWindows } from './state.ts'
import { abortableMedia } from './utils/abortable-media.ts'
import { cancelMediaBody } from './utils/cancel-media-body.ts'

const requestOrigins = new WeakMap<Request, string | null>()
const responseCookies = new WeakMap<URL, boolean>()
const objectURLOrigins = new Map<
  string,
  { window: WeakRef<Window>; origin: string }
>()

/** Reserves owned request bytes before copying them, rejecting work after the Canvas environment closes.
 * @returns An idempotent release transferred to the resource consumer on successful fetch.
 * @example const release = reserveResourceBytes(window, chunk.byteLength);
 */
function reserveResourceBytes(
  window: ICanvasAdapterCaller['window'],
  bytes: number,
): () => void {
  const adapter = canvasWindows.get(window)
  if (!adapter)
    throw new window.DOMException(
      'The Canvas environment is closing.',
      'AbortError',
    )
  return adapter.reserveStorage(window, bytes)
}

/** Records the origin of native Blob URLs while preserving the existing URL and Blob constructors.
 * @returns Nothing; the Window's URLs revoke on disposal.
 * @example installCanvasObjectURLs(window, restorers);
 */
export function installCanvasObjectURLs(
  window: Window,
  restorers: DisposeCompatibility[],
): void {
  const urls = new Set<string>()
  const create = window.URL.createObjectURL
  const revoke = window.URL.revokeObjectURL
  restorers.push(() => {
    for (const url of urls) {
      objectURLOrigins.delete(url)
      revoke.call(window.URL, url)
    }
    urls.clear()
  })
  restorers.push(
    replaceProperty(window.URL, 'createObjectURL', {
      writable: true,
      value(...argumentsList: Parameters<typeof create>) {
        const url = Reflect.apply(create, window.URL, argumentsList)
        objectURLOrigins.set(url, {
          window: new WeakRef(window),
          origin: window.location.origin,
        })
        urls.add(url)
        return url
      },
    }),
  )
  restorers.push(
    replaceProperty(window.URL, 'revokeObjectURL', {
      writable: true,
      value(url: string) {
        objectURLOrigins.delete(url)
        urls.delete(url)
        revoke.call(window.URL, url)
      },
    }),
  )
}

/** Corrects only owned media request headers/cookies while retaining Happy DOM's request policy and all unrelated fetches.
 * @returns Nothing; shared internal hooks restore after the final installed Window closes.
 * @example installResourceFetch(restorers);
 */
export function installResourceFetch(restorers: DisposeCompatibility[]): void {
  const requestHeaders = FetchRequestHeaderUtility.getRequestHeaders
  restorers.push(
    replaceProperty(FetchRequestHeaderUtility, 'getRequestHeaders', {
      writable: true,
      value(options: Parameters<typeof requestHeaders>[0]) {
        const headers = requestHeaders(options)
        if (!requestOrigins.has(options.request)) return headers
        // Happy DOM adds Origin to every cross-origin fetch; media no-CORS and redirect-tainted origins differ.
        for (const key of Object.keys(headers))
          if (key.toLowerCase() === 'origin') delete headers[key]
        const origin = requestOrigins.get(options.request)
        if (origin !== null && origin !== undefined) headers.Origin = origin
        return headers
      },
    }),
  )
  const responseHeaders = FetchResponseHeaderUtility.parseResponseHeaders
  restorers.push(
    replaceProperty(FetchResponseHeaderUtility, 'parseResponseHeaders', {
      writable: true,
      value(options: Parameters<typeof responseHeaders>[0]) {
        if (responseCookies.get(options.requestURL) !== false)
          return responseHeaders(options)
        const rawHeaders: string[] = []
        for (let index = 0; index < options.rawHeaders.length; index += 2) {
          if (
            ['set-cookie', 'set-cookie2'].includes(
              options.rawHeaders[index]!.toLowerCase(),
            )
          )
            continue
          rawHeaders.push(
            options.rawHeaders[index]!,
            options.rawHeaders[index + 1]!,
          )
        }
        return responseHeaders({ ...options, rawHeaders })
      },
    }),
  )
}

/** Reads decoded response bytes under a fixed bound, cancelling the stream on failure before retaining a complete image.
 * @returns One bounded byte buffer and its storage release operation.
 * @example await mediaResponseBytes(window, response, signal);
 */
async function mediaResponseBytes(
  window: ICanvasAdapterCaller['window'],
  response: Response,
  signal: AbortSignal,
) {
  if (!response.ok) {
    await cancelMediaBody(response.body)
    throw new window.DOMException('The media request failed.', 'NetworkError')
  }
  const reader = response.body?.getReader()
  const chunks: Buffer[] = []
  const releases: (() => void)[] = []
  let total = 0
  try {
    if (Number(response.headers.get('content-length')) > MAX_MEDIA_INPUT_BYTES)
      throw new window.RangeError('Media input exceeds the byte limit.')
    while (reader) {
      // Intercepted response streams do not inherit fetch cancellation; abort their pending reads explicitly.
      const { done, value } = await abortableMedia(signal, reader.read())
      if (done) break
      total += value.byteLength
      if (total > MAX_MEDIA_INPUT_BYTES)
        throw new window.RangeError('Media input exceeds the byte limit.')
      releases.push(reserveResourceBytes(window, value.byteLength))
      chunks.push(Buffer.from(value))
    }
    const release = reserveResourceBytes(window, total)
    try {
      return { buffer: Buffer.concat(chunks, total), release }
    } catch (error) {
      release()
      throw error
    }
  } catch (error) {
    await cancelMediaBody(reader, error)
    throw error
  } finally {
    disposeAll([() => reader?.releaseLock(), ...releases])
  }
}

/** Executes Happy DOM's configured request pipeline while preserving thrown interceptor errors without leaking its task counters.
 * @returns The original or intercepted response after the upstream request task has ended.
 * @example await mediaRequest(window, request);
 */
async function mediaRequest(
  window: ICanvasAdapterCaller['window'],
  request: Request,
): Promise<Response> {
  const browser = new WindowBrowserContext(window)
  const browserFrame = browser.getBrowserFrame()
  if (!browserFrame)
    throw new window.DOMException('The Window is closing.', 'AbortError')
  const fetch = new Fetch({
    browserFrame,
    window,
    url: request,
    disableCache: true,
    disablePreload: true,
    disableSameOriginPolicy: true,
  })
  const interceptor = browser.getSettings()?.fetch.interceptor
  const sendRequest = Reflect.get(fetch, 'sendRequest')
  Object.defineProperty(fetch, 'sendRequest', {
    value() {
      // Upstream awaits interceptors and caches before sending; a replaced source must not open a socket afterward.
      if (request.signal.aborted) throw request.signal.reason
      return Reflect.apply(sendRequest, fetch, [])
    },
  })
  const failures: unknown[] = []
  if (interceptor) {
    // Happy DOM 20.14's interceptor awaits lack finally blocks; successful sentinel responses let its own task cleanup run.
    Object.defineProperty(fetch, 'interceptor', {
      value: {
        beforeAsyncRequest: async (
          options: Parameters<
            NonNullable<typeof interceptor.beforeAsyncRequest>
          >[0],
        ) => {
          try {
            return await abortableMedia(
              request.signal,
              Promise.resolve(interceptor.beforeAsyncRequest?.(options)),
            )
          } catch (error) {
            failures.push(error)
            return new window.Response(null, { status: 500 })
          }
        },
        afterAsyncResponse: async (
          options: Parameters<
            NonNullable<typeof interceptor.afterAsyncResponse>
          >[0],
        ) => {
          try {
            return await abortableMedia(
              request.signal,
              Promise.resolve(interceptor.afterAsyncResponse?.(options)),
            )
          } catch (error) {
            failures.push(error)
            return new window.Response(null, { status: 500 })
          }
        },
      },
    })
  }
  const response = await fetch.send()
  if (failures.length) {
    await cancelMediaBody(response.body)
    throw failures[0]
  }
  return response
}

/** Reads a registered Blob URL only within its origin and bounds the copied resource bytes.
 * @returns Immutable input bytes and clean origin metadata.
 * @example await blobResource(window, url, signal);
 */
async function blobResource(
  window: ICanvasAdapterCaller['window'],
  url: URL,
  signal: AbortSignal,
) {
  const owner = objectURLOrigins.get(url.href)
  const sameOrigin =
    owner?.origin === window.location.origin &&
    (owner.origin !== 'null' || owner.window.deref() === window)
  const blob = sameOrigin ? resolveObjectURL(url.href) : undefined
  if (!blob)
    throw new window.DOMException(
      'The Blob URL is revoked or belongs to another origin.',
      'NetworkError',
    )
  if (blob.size > MAX_MEDIA_INPUT_BYTES)
    throw new window.RangeError('Media input exceeds the byte limit.')
  const release = reserveResourceBytes(window, blob.size)
  try {
    const buffer = Buffer.from(await blob.arrayBuffer())
    if (signal.aborted) throw signal.reason
    return {
      buffer,
      release,
      url: url.href,
      originClean: true,
      mimeType: blob.type,
    }
  } catch (error) {
    release()
    throw error
  }
}

/** Enforces response CORS before redirect following or image decoding.
 * @returns Nothing; denied responses cancel their body and reject.
 * @example await validateCorsResponse(window, response, origin, true);
 */
async function validateCorsResponse(
  window: ICanvasAdapterCaller['window'],
  response: Response,
  requestOrigin: string,
  credentialed: boolean,
): Promise<void> {
  const allowed = response.headers.get('access-control-allow-origin')
  if (
    (allowed !== requestOrigin && !(allowed === '*' && !credentialed)) ||
    (credentialed &&
      response.headers.get('access-control-allow-credentials') !== 'true')
  ) {
    await cancelMediaBody(response.body)
    throw new window.DOMException(
      'The media response failed its CORS check.',
      'NetworkError',
    )
  }
}

/** Issues one media hop with the original browser policy and validates CORS before handing the response to redirect/byte handling.
 * @returns The response and whether this hop crossed the Window's origin.
 * @example await resourceResponse(window, url, origin, 'same-origin', signal);
 */
async function resourceResponse(
  window: ICanvasAdapterCaller['window'],
  url: URL,
  requestOrigin: string | null,
  credentials: 'include' | 'same-origin' | 'omit',
  signal: AbortSignal,
  sameOrigin = false,
) {
  if (!['http:', 'https:', 'data:'].includes(url.protocol))
    throw new window.DOMException(
      'Unsupported media URL protocol.',
      'NetworkError',
    )
  const cross =
    url.protocol !== 'data:' && url.origin !== window.location.origin
  if (sameOrigin && cross)
    throw new window.DOMException(
      'The script request crossed origins.',
      'SecurityError',
    )
  const request = new window.Request(url.href, {
    signal,
    credentials,
    mode: requestOrigin === null ? 'no-cors' : 'cors',
    redirect: 'manual',
  })
  requestOrigins.set(request, requestOrigin)
  responseCookies.set(
    request[PropertySymbol.url],
    credentials === 'include' || (credentials === 'same-origin' && !cross),
  )
  const response = await mediaRequest(window, request)
  if (
    url.protocol !== 'data:' &&
    requestOrigin !== null &&
    (cross || requestOrigin === 'null')
  )
    await validateCorsResponse(
      window,
      response,
      requestOrigin,
      credentials === 'include',
    )
  return { response, cross }
}

/** Consumes a redirect response before resolving its next URL, including missing-location failures.
 * @returns The next absolute request URL.
 * @example await redirectURL(window, response, currentURL);
 */
async function redirectURL(
  window: ICanvasAdapterCaller['window'],
  response: Response,
  url: URL,
): Promise<URL> {
  const location = response.headers.get('location')
  await cancelMediaBody(response.body)
  if (!location)
    throw new window.DOMException(
      'The media redirect has no location.',
      'NetworkError',
    )
  try {
    return new URL(location, url)
  } catch {
    throw new window.DOMException(
      'The media redirect URL is invalid.',
      'NetworkError',
    )
  }
}

/** Fetches a Canvas subresource with per-hop CORS, credentials and byte limits, without relaxing its Window's normal fetch policy.
 * @returns The bounded resource bytes, final URL and origin-clean status.
 * @example await fetchCanvasResource(window, image.src, image.crossOrigin, controller.signal);
 */
export async function fetchCanvasResource(
  window: ICanvasAdapterCaller['window'],
  source: string,
  crossOrigin: string | null,
  signal: AbortSignal,
  options: { credentials?: 'omit' | 'same-origin'; sameOrigin?: boolean } = {},
) {
  let url = new URL(source, window.location.href)
  if (url.protocol === 'blob:') return blobResource(window, url, signal)
  let requestOrigin = window.location.origin
  let originClean = true
  const cors = crossOrigin !== null
  const credentials =
    options.credentials ??
    (!cors || crossOrigin === 'use-credentials' ? 'include' : 'same-origin')
  for (let redirects = 0; redirects <= MAX_MEDIA_REDIRECTS; redirects += 1) {
    const { response, cross } = await resourceResponse(
      window,
      url,
      cors ? requestOrigin : null,
      credentials,
      signal,
      options.sameOrigin,
    )
    // Every redirect hop must be same-origin or explicitly CORS checked to preserve clean pixels.
    originClean &&= cors || !cross
    if (!MEDIA_REDIRECT_STATUSES.has(response.status))
      return {
        ...(await mediaResponseBytes(window, response, signal)),
        url: url.href,
        originClean,
        mimeType: response.headers.get('content-type') ?? '',
      }
    const destination = await redirectURL(window, response, url)
    if (cors && cross && destination.origin !== url.origin)
      requestOrigin = 'null'
    url = destination
  }
  throw new window.DOMException('Too many media redirects.', 'NetworkError')
}
