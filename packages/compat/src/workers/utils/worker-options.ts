import type { Window } from 'happy-dom'
import conversions from 'webidl-conversions'

import { conversionOptions } from '../../canvas/utils/conversion-options.ts'

/** Converts Worker arguments once in WebIDL order before allocating ports or starting a native child.
 * @returns The permitted absolute entry URL and validated browser Worker options.
 * @example workerOptions(window, ['./worker.js', { type: 'module' }]);
 */
export function workerOptions(
  window: Window,
  argumentsList: unknown[],
): {
  url: URL
  credentialMode: string
  workerName: string
  workerType: 'classic' | 'module'
} {
  if (!argumentsList.length)
    throw new window.TypeError('Worker requires a script URL.')
  const source = conversions.USVString(
    argumentsList[0],
    conversionOptions(window),
  )
  const options = argumentsList[1] ?? {}
  if (typeof options !== 'object' && typeof options !== 'function')
    throw new window.TypeError('Worker options must be a dictionary.')
  const credentials = Reflect.get(options, 'credentials')
  const credentialMode =
    credentials === undefined
      ? 'same-origin'
      : conversions.DOMString(credentials, conversionOptions(window))
  if (!['omit', 'same-origin', 'include'].includes(credentialMode))
    throw new window.TypeError('Invalid Worker credentials.')
  const name = Reflect.get(options, 'name')
  const workerName =
    name === undefined
      ? ''
      : conversions.DOMString(name, conversionOptions(window))
  const type = Reflect.get(options, 'type')
  const workerType =
    type === undefined
      ? 'classic'
      : conversions.DOMString(type, conversionOptions(window))
  if (workerType !== 'classic' && workerType !== 'module')
    throw new window.TypeError('Invalid Worker type.')
  let url: URL
  try {
    url = new URL(source, window.location.href)
  } catch {
    throw new window.DOMException('Invalid Worker script URL.', 'SyntaxError')
  }
  if (
    !['http:', 'https:', 'blob:', 'data:'].includes(url.protocol) ||
    (['http:', 'https:'].includes(url.protocol) &&
      url.origin !== window.location.origin)
  )
    throw new window.DOMException(
      'Worker entry scripts require a same-origin HTTP URL, data URL or owned Blob URL.',
      'SecurityError',
    )
  return { url, credentialMode, workerName, workerType }
}
