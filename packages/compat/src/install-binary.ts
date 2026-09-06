import { TextDecoder } from 'node:util';

import type { Blob, Window } from 'happy-dom';

import { PROBE_BYTE_LENGTH, UTF8_BOM_PROBE } from './constants.ts';
import type { DisposeCompatibility } from './types.ts';
import { normalizeBlobArguments } from './utils/normalize-blob-arguments.ts';
import { propertyOwner } from './utils/property-owner.ts';
import { replaceProperty } from './utils/replace-property.ts';

/** Supplies bytes() through the public Blob API, including File and sliced Blob instances.
 * @returns A fresh byte array whose mutation cannot change the Blob.
 * @example await blob.bytes();
 */
async function readBlobBytes(this: Blob): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await this.arrayBuffer());
}

/** Applies the File API's UTF-8 decode when text() reads a Blob, consuming a leading BOM.
 * @returns Decoded text with malformed sequences replaced.
 * @example await new Blob(['\uFEFFA']).text() // 'A'
 */
async function readBlobText(this: Blob): Promise<string> {
  return new TextDecoder().decode(await this.arrayBuffer());
}

/** Repairs binary constructors and Blob readers while preserving Happy DOM's Blob/File family.
 * @param window - Environment whose constructors receive VM-created arrays.
 * @param restorers - Shared teardown registry, updated immediately after each mutation.
 * @returns Nothing; registers cleanup for the runner.
 * @example await installBinary(window, restorers);
 */
export async function installBinary(
  window: Window,
  restorers: DisposeCompatibility[],
): Promise<void> {
  const blobPrototype = propertyOwner(window.Blob.prototype, 'arrayBuffer');
  if (
    new window.Blob([new window.ArrayBuffer(PROBE_BYTE_LENGTH)]).size !==
    PROBE_BYTE_LENGTH
  ) {
    for (const name of ['Blob', 'File'] as const) {
      const implementation = new Proxy(window[name], {
        construct(target, argumentsList: unknown[], newTarget) {
          return Reflect.construct(
            target,
            normalizeBlobArguments(argumentsList),
            newTarget,
          );
        },
      });
      restorers.push(
        replaceProperty(window, name, {
          value: implementation,
          writable: true,
        }),
      );
    }
  }
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
    );
  }
  const needsTextPatch =
    (await new window.Blob([UTF8_BOM_PROBE]).text()) !== 'A';
  // Register shared methods even when another environment has already repaired this prototype.
  if (needsTextPatch || Reflect.get(blobPrototype, 'text') === readBlobText) {
    restorers.push(
      replaceProperty(blobPrototype, 'text', {
        value: readBlobText,
        writable: true,
        enumerable: true,
      }),
    );
  }
}
