import { randomUUID } from 'node:crypto'
import {
  BroadcastChannel,
  MessageChannel,
  MessagePort,
} from 'node:worker_threads'

import type { Window } from 'happy-dom'

import { ExtendedCanvasAdapter } from './canvas/adapter.ts'
import { bindCanvasPort } from './canvas/ports.ts'
import { canvasPortInstallers } from './canvas/state.ts'
import type { DisposeCompatibility } from './types.ts'
import { disposeAll } from './utils/dispose-all.ts'
import { replaceProperty } from './utils/replace-property.ts'

/** Adds native message channels with per-environment cleanup and isolated broadcast names.
 * @param window - Happy DOM environment that owns these channels.
 * @param restorers - Shared teardown registry, updated immediately after each mutation.
 * @returns Nothing; registers cleanup for the runner.
 * @example installMessaging(window, restorers);
 */
export function installMessaging(
  window: Window,
  restorers: DisposeCompatibility[],
): void {
  const channels = new Set<BroadcastChannel | MessagePort>()
  const namespace = `happy-dom-extended:${randomUUID()}:`
  const ownsCanvas =
    window.happyDOM.settings.canvasAdapter instanceof ExtendedCanvasAdapter
  const portRestorers = new WeakMap<MessagePort, DisposeCompatibility>()
  const ports = new Set<WeakRef<MessagePort>>()
  const collectedPorts = new FinalizationRegistry<WeakRef<MessagePort>>(
    (reference) => ports.delete(reference),
  )
  /** Tracks live native handles without retaining a port after its close event.
   * @returns Nothing; the Window retains only active channels strongly.
   * @example trackPort(channel.port1);
   */
  const trackPort = (port: MessagePort): void => {
    channels.add(port)
    port.once('close', () => channels.delete(port))
  }
  const installPort = (port: MessagePort, token: string) => {
    if (portRestorers.has(port)) return
    trackPort(port)
    portRestorers.set(port, bindCanvasPort(window, port, token))
    const reference = new WeakRef(port)
    ports.add(reference)
    collectedPorts.register(port, reference, reference)
  }
  if (ownsCanvas) {
    canvasPortInstallers.set(window, installPort)
    restorers.push(() => {
      canvasPortInstallers.delete(window)
    })
  }
  restorers.push(() => {
    const closers = [...channels].map((channel) => () => channel.close())
    channels.clear()
    disposeAll(closers)
  })

  if (Reflect.get(window, 'BroadcastChannel') === undefined) {
    /** Keeps broadcasts within one test environment and registers channels for teardown. */
    class EnvironmentBroadcastChannel extends BroadcastChannel {
      /** Opens a named channel when test code constructs the Web API.
       * @param name - Public channel name.
       * @example new window.BroadcastChannel('updates');
       */
      constructor(name: string) {
        super(`${namespace}${name}`)
        Object.defineProperty(this, 'name', { value: name, enumerable: true })
        channels.add(this)
      }

      /** Releases native handles when consumers close a channel.
       * @returns Nothing.
       * @example channel.close();
       */
      override close(): void {
        channels.delete(this)
        super.close()
      }
    }
    restorers.push(
      replaceProperty(window, 'BroadcastChannel', {
        value: EnvironmentBroadcastChannel,
        writable: true,
      }),
    )
  }

  if (Reflect.get(window, 'MessageChannel') === undefined) {
    /** Tracks native ports so forgotten close calls cannot leak across test files. */
    class EnvironmentMessageChannel extends MessageChannel {
      /** Creates entangled ports when test code requests a message channel.
       * @example new window.MessageChannel();
       */
      constructor() {
        super()
        if (ownsCanvas) {
          const token = randomUUID()
          installPort(this.port1, token)
          installPort(this.port2, token)
        } else {
          trackPort(this.port1)
          trackPort(this.port2)
        }
      }
    }
    // Port identity must match the ports returned by the native channel.
    restorers.push(
      replaceProperty(window, 'MessagePort', {
        value: MessagePort,
        writable: true,
      }),
    )
    restorers.push(
      replaceProperty(window, 'MessageChannel', {
        value: EnvironmentMessageChannel,
        writable: true,
      }),
    )
  }
  restorers.push(() => {
    // Retained closed ports still restore on teardown; discarded ones must not keep their Window alive.
    const releases = [...ports].map((reference) => () => {
      collectedPorts.unregister(reference)
      const port = reference.deref()
      if (port) {
        const restore = portRestorers.get(port)
        portRestorers.delete(port)
        restore?.()
      }
    })
    ports.clear()
    disposeAll(releases)
  })
}
