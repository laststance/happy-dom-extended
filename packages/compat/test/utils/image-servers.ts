import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { TestContext } from 'node:test'

import { PNG } from 'pngjs'

/** Serves real image responses from two origins for Canvas loading, CORS, cookie and cancellation regressions.
 * @returns Both origins, independent red PNG bytes and captured request headers.
 * @example const fixtures = await imageServers(context); image.src = `${fixtures.crossOrigin}/cors.png`;
 */
export async function imageServers(
  context: TestContext,
  videoBytes?: Buffer,
  scripts: Record<string, string> = {},
) {
  const red = new PNG({ width: 1, height: 1 })
  red.data.set([255, 0, 0, 255])
  const blue = new PNG({ width: 1, height: 1 })
  blue.data.set([0, 0, 255, 255])
  const redPng = PNG.sync.write(red)
  const bluePng = PNG.sync.write(blue)
  const requests: {
    path: string
    origin: string | undefined
    cookie: string | undefined
    configured: string | string[] | undefined
  }[] = []
  const timers: NodeJS.Timeout[] = []
  let origin = ''
  let crossOrigin = ''
  const serve = (request: IncomingMessage, response: ServerResponse) => {
    const path = request.url ?? '/'
    requests.push({
      path,
      origin: request.headers.origin,
      cookie: request.headers.cookie,
      configured: request.headers['x-canvas-test'],
    })
    if (path === '/redirect.png' || path === '/redirect.js') {
      response.writeHead(302, {
        Location: `${crossOrigin}/${path.endsWith('.js') ? 'foreign.js' : 'red.png'}`,
      })
      response.end()
      return
    }
    const headers: Record<string, string> = {
      'Content-Type': Object.hasOwn(scripts, path)
        ? 'text/javascript'
        : path.endsWith('.webm')
          ? 'video/webm'
          : 'image/png',
    }
    if (path === '/cors.webm') headers['Access-Control-Allow-Origin'] = origin
    if (
      ['/cors.png', '/credential.png', '/cookie.png', '/cors.js'].includes(path)
    )
      headers['Access-Control-Allow-Origin'] = origin
    if (path === '/credential.png')
      headers['Access-Control-Allow-Credentials'] = 'true'
    if (path === '/wildcard.png') headers['Access-Control-Allow-Origin'] = '*'
    if (path === '/cookie.png')
      headers['Set-Cookie'] = 'media=forbidden; Path=/'
    const send = () => {
      response.writeHead(200, headers)
      response.end(
        scripts[path] ??
          (path.endsWith('.webm') && videoBytes
            ? videoBytes
            : path === '/broken.png'
              ? Buffer.from('not an image')
              : path === '/blue.png'
                ? bluePng
                : redPng),
      )
    }
    // Held responses let cancellation tests observe a real socket before replacing its source.
    if (path === '/held.png' || path === '/held.webm') return
    if (path === '/slow.png' || path === '/slow.webm')
      timers.push(setTimeout(send, 75))
    else send()
  }
  const servers = [createServer(serve), createServer(serve)]
  context.after(async () => {
    for (const timer of timers) clearTimeout(timer)
    await Promise.all(
      servers.map(
        async (server) =>
          new Promise<void>((resolve) => {
            server.closeAllConnections()
            server.close(() => resolve())
          }),
      ),
    )
  })
  const urls: string[] = []
  for (const server of servers) {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    urls.push(`http://127.0.0.1:${address.port}`)
  }
  ;[origin, crossOrigin] = [urls[0]!, urls[1]!]
  return { origin, crossOrigin, redPng, requests, servers }
}
