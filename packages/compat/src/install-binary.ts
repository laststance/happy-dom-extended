import { TextDecoder } from 'node:util'

import type { Blob, Window } from 'happy-dom'

import { installBlobConstructors } from './install-blob-constructors.ts'
import type { DisposeCompatibility } from './types.ts'
import { propertyOwner } from './utils/property-owner.ts'
import { replaceProperty } from './utils/replace-property.ts'

/** Supplies bytes() through the public Blob API, including File and sliced Blob instances.
 * @returns A fresh byte array whose mutation cannot change the Blob.
 * @example await blob.bytes();
 */
async function readBlobBytes(this: Blob): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await this.arrayBuffer())
}

/** Applies the File API's UTF-8 decode when text() reads a Blob, consuming a leading BOM.
 * @returns Decoded text with malformed sequences replaced.
 * @example await new Blob(['\uFEFFA']).text() // 'A'
 */
async function readBlobText(this: Blob): Promise<string> {
  return new TextDecoder().decode(await this.arrayBuffer())
}

/** Repairs binary constructors and Blob readers while preserving Happy DOM's Blob/File family.
 * @param window - Environment whose constructors receive VM-created arrays.
 * @param restorers - Shared teardown registry, updated immediately after each mutation.
 * @returns Nothing; registers cleanup for the runner.
 * @example installBinary(window, restorers);
 */
export function installBinary(
  window: Window,
  restorers: DisposeCompatibility[],
): void {
  const blobPrototype = propertyOwner(window.Blob.prototype, 'arrayBuffer')
  installBlobConstructors(window, restorers)
  if (
    Reflect.get(blobPrototype, 'bytes') === undefined ||
    Reflect.get(blobPrototype, 'bytes') === readBlobBytes
  ) {
    restorers.push(
      replaceProperty(blobPrototype, 'bytes', {
        value: readBlobBytes,
        writable: true,
        enumerable: true,
      }),
    )
  }
  // Install the UTF-8 reader before setup modules can read a Blob or another environment can close.
  restorers.push(
    replaceProperty(blobPrototype, 'text', {
      value: readBlobText,
      writable: true,
      enumerable: true,
    }),
  )
}
