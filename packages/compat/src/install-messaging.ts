import { randomUUID } from 'node:crypto';
import {
  BroadcastChannel,
  MessageChannel,
  MessagePort,
} from 'node:worker_threads';

import type { Window } from 'happy-dom';

import type { DisposeCompatibility } from './types.ts';
import { replaceProperty } from './utils/replace-property.ts';

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
  const channels = new Set<BroadcastChannel | MessagePort>();
  const namespace = `happy-dom-extended:${randomUUID()}:`;
  restorers.push(() => {
    for (const channel of channels) channel.close();
    channels.clear();
  });

  if (Reflect.get(window, 'BroadcastChannel') === undefined) {
    /** Keeps broadcasts within one test environment and registers channels for teardown. */
    class EnvironmentBroadcastChannel extends BroadcastChannel {
      /** Opens a named channel when test code constructs the Web API.
       * @param name - Public channel name.
       * @example new window.BroadcastChannel('updates');
       */
      constructor(name: string) {
        super(`${namespace}${name}`);
        Object.defineProperty(this, 'name', { value: name, enumerable: true });
        channels.add(this);
      }

      /** Releases native handles when consumers close a channel.
       * @returns Nothing.
       * @example channel.close();
       */
      override close(): void {
        channels.delete(this);
        super.close();
      }
    }
    restorers.push(
      replaceProperty(window, 'BroadcastChannel', {
        value: EnvironmentBroadcastChannel,
        writable: true,
      }),
    );
  }

  if (Reflect.get(window, 'MessageChannel') === undefined) {
    /** Tracks native ports so forgotten close calls cannot leak across test files. */
    class EnvironmentMessageChannel extends MessageChannel {
      /** Creates entangled ports when test code requests a message channel.
       * @example new window.MessageChannel();
       */
      constructor() {
        super();
        channels.add(this.port1);
        channels.add(this.port2);
      }
    }
    // Port identity must match the ports returned by the native channel.
    restorers.push(
      replaceProperty(window, 'MessagePort', {
        value: MessagePort,
        writable: true,
      }),
    );
    restorers.push(
      replaceProperty(window, 'MessageChannel', {
        value: EnvironmentMessageChannel,
        writable: true,
      }),
    );
  }
}
