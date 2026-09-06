# jest-happy-dom-extended

A Happy DOM Jest environment that supplies missing Node-backed Web APIs and repairs reproduced browser compatibility gaps.

## Usage

After the package is published, install it with Jest 30:

```sh
pnpm add -D jest jest-happy-dom-extended
```

```js
// jest.config.mjs
export default {
  testEnvironment: 'jest-happy-dom-extended',
  testEnvironmentOptions: { url: 'https://example.test/' },
}
```

Application-specific mocks and fixtures stay in your own `setupFiles` / `setupFilesAfterEnv`. The extensions are installed before those files run. Standard Happy DOM environment options continue to pass through to the upstream environment.

Installation completes synchronously in the environment constructor. `Blob.text()` uses the package's UTF-8 reader through the public `arrayBuffer()` API, including during setup. This intentional method replacement restores the original method after the last environment closes; it does not wait for an asynchronous capability probe.

Requires Node.js >=22.18.0 and Jest 30. The initial compatibility baseline is Happy DOM 20.14.0. ESM imports and CommonJS `require` share one CommonJS runtime and matching TypeScript declarations, so both loading styles coordinate the lifetime of shared Web API fixes.

## Included behavior

| API                                        | Extension                                                                                                   |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| HTML Canvas / OffscreenCanvas              | Real native 2D drawing, dimension resets, and PNG/JPEG output                                               |
| `structuredClone`                          | Node's native clone algorithm, including cycles, standard data types, and ArrayBuffer transfer              |
| `TextEncoderStream`, `TextDecoderStream`   | Node's encoding streams                                                                                     |
| `CompressionStream`, `DecompressionStream` | Node's real compression streams                                                                             |
| `BroadcastChannel`                         | Native delivery with a namespace per test environment and teardown cleanup                                  |
| `MessageChannel`, `MessagePort`            | Entangled Node ports with matching constructor identity and cleanup of created ports                        |
| `Blob`, `File`                             | VM ArrayBuffer input normalization while preserving Happy DOM FileReader compatibility and Blob inheritance |
| `Blob.bytes()`                             | Fresh byte arrays, also available on Files and sliced Blobs                                                 |
| `Blob.text()`                              | UTF-8 decoding that consumes a leading BOM                                                                  |
| `ImageData`                                | VM pixel-array handling with preserved input identity, offsets, and shared storage                          |
| `Animation.cancel()`                       | Internally handles the rejected finished promise while allowing callers to observe its AbortError           |
| `XMLHttpRequest`                           | Instance-level `UNSENT`, `OPENED`, `HEADERS_RECEIVED`, `LOADING`, and `DONE` constants                      |
| `CompositionEvent`                         | Composed text via a read-only `data` property, retaining UIEvent flags and dispatch                         |

Sources and reproduction details live in the monorepo's research brief. Relevant upstream reports include [structuredClone #556](https://github.com/capricorn86/happy-dom/issues/556), [binary File #704](https://github.com/capricorn86/happy-dom/issues/704), [BroadcastChannel #1920](https://github.com/capricorn86/happy-dom/issues/1920), [XHR constants #2096](https://github.com/capricorn86/happy-dom/issues/2096), [Blob BOM #2355](https://github.com/capricorn86/happy-dom/issues/2355), and [CompositionEvent #1457](https://github.com/capricorn86/happy-dom/issues/1457).

## Real Canvas rendering

Canvas works immediately with the environment setting above, including inside setupFiles. The package installs canvas and the official Happy DOM adapter as runtime dependencies. No separate Canvas import or setup helper is required.

```ts
import { expect, test } from '@jest/globals'

test('draws a red pixel', async () => {
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const context = canvas.getContext('2d')!
  context.fillStyle = 'red'
  context.fillRect(0, 0, 1, 1)

  expect([...context.getImageData(0, 0, 1, 1).data]).toEqual([255, 0, 0, 255])
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve),
  )
  expect(blob?.type).toBe('image/png')
})
```

HTMLCanvasElement and OffscreenCanvas provide 2D drawing, ImageData, dimension resets, and real PNG/JPEG output. Contexts retain their DOM owner and identity. Canvas width/height assignments reset pixels and state, even when assigned the same value; HTML setAttribute/removeAttribute updates also reset the native bitmap. Unsupported output formats use PNG with a matching MIME type.

Asynchronous output copies pixels at invocation. Later drawing or resizing does not change the pending image. Happy DOM's waitUntilComplete() includes these outputs; teardown drains this environment's outputs before closing the Window, without waiting for unrelated application intervals. Encoding failures produce a null HTML toBlob result or an OffscreenCanvas EncodingError rejection. Zero-size HTML canvases produce data:, or an asynchronous null callback; zero-size Offscreen canvases reject with IndexSizeError. User callback exceptions are retained and reported by environment teardown after cleanup.

Image file loading is enabled by default. Preserve a deliberate opt-out with the upstream setting:

```js
export default {
  testEnvironment: 'jest-happy-dom-extended',
  testEnvironmentOptions: {
    settings: { enableImageFileLoading: false },
  },
}
```

Jest serializes configuration when starting workers. Create custom Canvas adapter instances inside a custom environment subclass before calling super(), or when constructing the environment directly. Those instances retain their identity and are not disposed by this package; their owner supplies any required cleanup. An explicit canvasAdapter: null retains upstream behavior with rendering disabled. Normal Jest configuration only needs the environment name.

The former /canvas subpath and fixed-result helper have been removed. Consumers wanting specific return values can use their test framework's mocks or spies in individual tests.

## Native installation

Permit canvas's install script so its native binary can be installed. This repository uses pnpm 12 allowBuilds with canvas: true; consuming pnpm projects must likewise approve canvas according to their pnpm version. Avoid installing with all lifecycle scripts disabled. A native loading failure is reported by the module loader instead of silently switching to simulated output.

The canvas 3.2.3 baseline offers prebuilt binaries for macOS x64/arm64, Linux x64 with glibc, and Windows x64. Other platforms or source builds require Cairo, Pango, build tools, and image libraries. JPEG support requires libjpeg when compiling from source; when a build omits JPEG, JPEG export requests fall back to PNG with the matching MIME type. Follow the [node-canvas installation instructions](https://github.com/Automattic/node-canvas/tree/v3.2.3#installation) for platform-specific prerequisites. Missing native builds or dependencies must be fixed before running Jest.

## Runtime boundaries

- Node-backed APIs use Node's implementations and event/clone semantics. They do not make every Happy DOM object serializable by `structuredClone`; Happy DOM Blob, File, DOM nodes, and platform objects must not be treated as Node-native cloneable objects.
- Broadcast names are isolated per environment. Cross-window/origin browser broadcasting is not simulated. Consumers must close ports received from elsewhere or transferred out of the environment; teardown tracks the channels and ports created by the provided constructors.
- Jest 30.5.1 skips the environment teardown hook when `setupFiles` throws. A setup module that opens native channels must close them in its own `try/finally` if initialization fails. Native channel references are preserved so asynchronous setup cannot silently exit before running tests.
- Existing fetch, FormData, Blob, FileReader, and DOM event families are not replaced wholesale with Node equivalents.
- ImageData repair targets the reproduced array-realm problem and Canvas return-value identity; full argument-validation parity is not established.
- Animation support repairs unhandled cancellation promises. Other upstream animation limitations remain, and actual motion should be checked in a browser.
- Canvas uses Cairo/Pango through node-canvas. Font availability, text metrics, anti-aliasing, color handling, image codecs, and browser rendering can differ. WebGL, Worker transfer, video drawing, complete ImageBitmap/transferControlToOffscreen behavior, Canvas origin-clean/CORS state, and complete attribute/argument validation are not guaranteed. Real layout, Worker execution, and idle scheduling remain upstream limitations; no no-op implementations are supplied.

## Local packaging

This package is initially developed in the `happy-dom-extended` monorepo. `pnpm build` produces `dist`; `pnpm check:package` validates export/type resolution; `pnpm test:package` installs an npm tarball into separate consumer fixtures for Jest 30.0.0 and the development version. Both setup phases, decoded PNG/JPEG output, ten lifecycle tests per Jest version, and six Jest tests in three suites are checked. Each Jest version runs serially and in two worker processes; process identities and JSON reports prove the requested execution paths actually ran. The private compatibility package is bundled and is not needed by consumers.

MIT licensed.
